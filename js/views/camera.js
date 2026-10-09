// Camera inside Lodestar, with the Smart Photo information shown live over the picture: which way
// the camera looks (compass tape, bearing, tilt), a crosshair, and the station's details. The
// bearing is read at the moment of the shutter. The phone's own camera (more pixels, HDR) is one
// tap away; then the bearing is read when that button is tapped.

import * as attitude from '../attitude.js';
import * as store from '../store.js';
import { toUTM, gridRef } from '../utm.js';
import { lithName } from '../vocab.js';
import { openOverlay, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, stamp } from '../util.js';
import { az3, cardinal, norm360, hasMeasurement } from '../geomath.js';

const PPD = 4; // compass tape: pixels per degree

function tapeHTML() {
  let h = '';
  for (let d = -180; d <= 540; d += 5) {
    const x = (d + 180) * PPD;
    const n = norm360(d);
    const major = n % 15 === 0;
    const label = n % 90 === 0 ? ['N', 'E', 'S', 'W'][n / 90] : n % 30 === 0 ? String(n) : '';
    h += `<i class="${major ? 'mj' : ''}" style="left:${x}px"></i>`;
    if (label) h += `<b class="${n % 90 === 0 ? 'card' : ''}" style="left:${x}px">${label}</b>`;
  }
  return h;
}

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return typeof window.orientation === 'number' ? window.orientation : 0;
}

/**
 * @param {{getStation: () => object, onCapture: (file: File, extra: object) => Promise<void>,
 *          onNative: (files: File[], extra: object) => Promise<void>}} o
 */
export function openCamera({ getStation, onCapture, onNative }) {
  // iPhone: the motion permission prompt must come straight from the tap that opened the camera
  if (attitude.needsPermission()) attitude.requestPermission();
  const decl = Number(store.getSettings().declination) || 0;
  let stream = null;
  let pose = null; // { bearing, pitch, roll, t }
  let frame = 0;
  let shots = 0;
  let busy = false;
  let closed = false;
  let nativeBearing = null;
  let lastThumb = null;

  const { el, close } = openOverlay(`<div class="cam" role="dialog" aria-label="กล้อง Smart Photo">
      <video playsinline muted autoplay></video>
      <div class="cam-flash"></div>
      <div class="cam-msg hidden" id="camMsg"></div>
      <header class="cam-top">
        <button type="button" class="cam-x" data-close aria-label="ปิดกล้อง">${icon('close')}</button>
        <div class="cam-tape" aria-hidden="true"><div class="cam-tape-in" id="camTape">${tapeHTML()}</div><span class="cam-tape-mk"></span></div>
        <div class="cam-brg"><b id="camBrg">—</b><span id="camSub">กำลังอ่านเข็มทิศ</span></div>
      </header>
      <footer class="cam-bottom">
        <div class="cam-strip" id="camStrip"></div>
        <div class="cam-controls">
          <label class="cam-native">${icon('camera')}<span>กล้องปกติ</span><input class="vh" type="file" accept="image/*" capture="environment" data-native></label>
          <button type="button" class="cam-shutter" data-shoot aria-label="ถ่ายรูป"><i></i></button>
          <button type="button" class="cam-done" data-done aria-label="เสร็จ กลับไปหน้า Station"><span class="cam-done-txt">เสร็จ</span><img alt="" hidden><b id="camCount" hidden></b></button>
        </div>
      </footer>
    </div>`, {
    cls: 'full',
    onClose: () => {
      closed = true;
      stop();
      if (lastThumb) URL.revokeObjectURL(lastThumb);
      unsub();
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVis);
    },
    onClick: (e) => {
      if (e.target.closest('[data-shoot]')) shoot();
      if (e.target.closest('[data-done]')) close();
      if (e.target.matches('[data-native]')) {
        // the phone's camera app needs the camera: release it, remember which way we face
        nativeBearing = pose && performance.now() - pose.t < 1500 ? pose.bearing : null;
        stop();
      }
    },
  });
  const $ = (id) => el.querySelector(`#${id}`);
  const video = el.querySelector('video');

  // ---------- live information ----------
  function stripHTML() {
    const st = getStation();
    const L = st.location;
    const u = L ? toUTM(L.lat, L.lon, store.zoneLock()) : null;
    const g = gridRef(u);
    const m = (st.measurements || []).find((x) => hasMeasurement(x) && x.strike != null && x.dip != null);
    return `<p class="cs-1"><em>LODESTAR</em><b>${esc(st.code)}</b>${esc(lithName(st) || '')}</p>
      <p class="cs-2">${g ? `<span>Grid Ref</span><b>${g.gr}</b><small>${u.zone}${u.band} ${g.square}</small>` : '<span>Station นี้ยังไม่มีพิกัด</span>'}
      ${m ? `<span class="cs-m">${esc(m.type || '')} ${az3(Math.round(m.strike) % 360)}/${Math.round(m.dip)}</span>` : ''}</p>`;
  }
  $('camStrip').innerHTML = stripHTML();

  function paint() {
    frame = 0;
    if (!pose) return;
    $('camTape').style.transform = `translateX(${(-(pose.bearing + 180) * PPD).toFixed(1)}px)`;
    $('camBrg').textContent = `${az3(Math.round(pose.bearing) % 360)}° ${cardinal(pose.bearing)}`;
    const p = Math.round(pose.pitch);
    $('camSub').textContent = p > 0 ? `เงย ${p}°` : p < 0 ? `ก้ม ${-p}°` : 'ระดับ';
  }

  const unsub = attitude.subscribe((a) => {
    if (a.status !== 'ok' || !a.sample) {
      pose = null;
      $('camBrg').textContent = '—';
      $('camSub').textContent = { unavailable: 'ไม่มีเซนเซอร์เข็มทิศ', denied: 'ไม่ได้รับสิทธิ์ใช้เข็มทิศ', 'needs-permission': 'แตะเพื่ออนุญาตเข็มทิศ' }[a.status] || 'กำลังอ่านเข็มทิศ';
      return;
    }
    if (!a.sample.north) { $('camSub').textContent = 'อ่านทิศเหนือไม่ได้'; return; }
    const R = attitude.sampleRotation(a.sample, decl);
    const cp = attitude.cameraPose(R);
    if (cp.bearing == null) return;
    pose = { ...cp, t: performance.now() };
    if (!frame) frame = requestAnimationFrame(paint);
  });
  el.querySelector('.cam-brg').addEventListener('click', () => { if (attitude.needsPermission()) attitude.requestPermission(); });

  // ---------- camera stream ----------
  async function start() {
    if (stream || closed) return;
    const msg = $('camMsg');
    if (!navigator.mediaDevices?.getUserMedia) {
      msg.textContent = 'เบราว์เซอร์นี้เปิดกล้องในแอปไม่ได้ ใช้ปุ่ม กล้องปกติ ด้านล่างแทน';
      msg.classList.remove('hidden');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      });
      if (closed) { stop(); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      msg.classList.add('hidden');
    } catch (err) {
      stream = null;
      msg.textContent = err.name === 'NotAllowedError'
        ? 'ไม่ได้รับสิทธิ์ใช้กล้อง อนุญาตกล้องให้เว็บนี้ในการตั้งค่า หรือใช้ปุ่ม กล้องปกติ'
        : `เปิดกล้องไม่ได้ (${err.message}) ใช้ปุ่ม กล้องปกติ แทน`;
      msg.classList.remove('hidden');
    }
  }
  function stop() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }
  const onVis = () => { if (!document.hidden) start(); };
  document.addEventListener('visibilitychange', onVis);
  start();

  // ---------- shutter ----------
  async function shoot() {
    if (busy) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!stream || !vw || !vh) { toast('กล้องยังไม่พร้อม'); return; }
    busy = true;
    const at = pose && performance.now() - pose.t < 1500 ? pose : null;
    try {
      // turn the picture upright when the phone is held sideways
      const quarter = at ? Math.round(at.roll / 90) * 90 : 0;
      const turn = norm360(quarter - screenAngle());
      const side = turn === 90 || turn === 270;
      const c = document.createElement('canvas');
      c.width = side ? vh : vw;
      c.height = side ? vw : vh;
      const ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((-turn * Math.PI) / 180);
      ctx.drawImage(video, -vw / 2, -vh / 2, vw, vh);
      el.querySelector('.cam-flash').classList.remove('go');
      void el.offsetWidth;
      el.querySelector('.cam-flash').classList.add('go');
      try { navigator.vibrate?.(30); } catch { /* not supported */ }
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) throw new Error('บันทึกภาพไม่ได้');
      const file = new File([blob], `IMG_${stamp()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      await onCapture(file, at ? { bearing: at.bearing, bearingSrc: 'camera', pitch: at.pitch } : {});
      shots += 1;
      // the last shot as a thumbnail on the "done" button
      const done = el.querySelector('[data-done]');
      const thumb = done.querySelector('img');
      if (lastThumb) URL.revokeObjectURL(lastThumb);
      lastThumb = URL.createObjectURL(blob);
      thumb.src = lastThumb;
      thumb.hidden = false;
      done.querySelector('.cam-done-txt').hidden = true;
      $('camCount').hidden = false;
      $('camCount').textContent = String(shots);
      done.classList.remove('pop'); void done.offsetWidth; done.classList.add('pop');
      $('camStrip').innerHTML = stripHTML();
    } catch (err) {
      toast(`ถ่ายรูปไม่สำเร็จ: ${err.message}`, 4000);
    } finally {
      busy = false;
    }
  }

  // ---------- the phone's own camera ----------
  el.querySelector('[data-native]').addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) { start(); return; }
    close();
    await onNative(files, nativeBearing != null ? { bearing: nativeBearing, bearingSrc: 'auto' } : {});
  });

  return close;
}

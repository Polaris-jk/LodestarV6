// FIELD GPS — where am I. The GPS is off until you tap "ดูตำแหน่ง" and switches off
// again as soon as the fix is good enough. UTM is the main readout.

import * as gps from '../gps.js';
import * as compass from '../compass.js';
import * as store from '../store.js';
import { coordMode, coordRows, emptyRows, coordText, fixAge, COORD_MODES } from '../coords.js';
import { cardinal, accClass, accBars, fmtAcc, norm360 } from '../geomath.js';
import { createMap } from '../map.js';
import { ensureColors } from '../rockcolors.js';
import { icon } from '../icons.js';
import { mainHeader, toast, canPromptInstall, promptInstall } from '../ui.js';
import { esc, isIOS, isStandalone } from '../util.js';

function dialSVG() {
  let ticks = '';
  for (let d = 0; d < 360; d += 10) {
    const major = d % 30 === 0;
    const a = (d * Math.PI) / 180;
    const r1 = 46, r2 = major ? 37.5 : 41.5;
    ticks += `<line class="tick${major ? ' major' : ''}" x1="${(50 + r1 * Math.sin(a)).toFixed(2)}" y1="${(50 - r1 * Math.cos(a)).toFixed(2)}" x2="${(50 + r2 * Math.sin(a)).toFixed(2)}" y2="${(50 - r2 * Math.cos(a)).toFixed(2)}"/>`;
  }
  const letters = [['N', 0], ['E', 90], ['S', 180], ['W', 270]]
    .map(([t, d]) => {
      const a = (d * Math.PI) / 180;
      const x = (50 + 28 * Math.sin(a)).toFixed(1);
      const y = (50 - 28 * Math.cos(a)).toFixed(1);
      return `<text x="${x}" y="${y}" transform="rotate(${d} ${x} ${y})"${t === 'N' ? ' class="n"' : ''}>${t}</text>`;
    })
    .join('');
  return `<svg class="dial" viewBox="0 0 100 100" aria-hidden="true">
    <circle class="ring" cx="50" cy="50" r="48.5"/>
    <g id="dialCard">${ticks}${letters}</g>
    <path class="lubber" d="M50 0.5 55.5 11h-11z"/>
    <circle class="hub" cx="50" cy="50" r="2.6"/>
  </svg>`;
}

function bannerHTML() {
  const s = store.getSettings();
  if (s.bannerDismissed || isStandalone()) return '';
  const body = isIOS()
    ? `<p><b>ติดตั้ง Lodestar ลงหน้าจอโฮมก่อนออกภาคสนาม</b><br>แตะ ${icon('share', 'inline')} Share แล้วเลือก Add to Home Screen ถ้าใช้ผ่าน Safari ข้อมูลอาจถูกล้างเมื่อไม่ได้เปิดเกิน 7 วัน</p>`
    : `<p><b>ติดตั้ง Lodestar เป็นแอปบนเครื่อง</b><br>${canPromptInstall() ? 'ใช้งาน offline ได้เต็มที่และเปิดได้จากหน้าจอโฮม' : 'ใน Chrome แตะเมนู ⋮ แล้วเลือก Install app หรือ Add to Home screen'}</p>`;
  return `<div class="banner" id="banner">
    ${body}
    <div class="banner-actions">
      ${!isIOS() && canPromptInstall() ? '<button type="button" class="btn sm" data-install>ติดตั้ง</button>' : ''}
      <button type="button" class="icon-btn" data-dismiss aria-label="ปิดข้อความนี้">${icon('close')}</button>
    </div>
  </div>`;
}

export async function render(root) {
  mainHeader();
  root.innerHTML = `
  <div class="screen gps-screen">
    <div id="bannerSlot">${bannerHTML()}</div>
    <div class="minimap" id="mm" role="button" tabindex="0" aria-label="เปิดแผนที่">
      <div class="gps-chip" id="gpsChip"></div>
    </div>
    <div class="help hidden" id="gpsHelp"></div>
    <div class="compass" id="cmp">
      ${dialSVG()}
      <div class="cmp-read">
        <div class="cmp-label">Bearing</div>
        <div class="cmp-val"><span id="vBrg">—</span><span class="cmp-card" id="vCard"></span></div>
        <div class="cmp-sub" id="vCmpSub"></div>
      </div>
      <button type="button" class="btn sm hidden" id="btnCmp">เปิดเข็มทิศ</button>
    </div>
    <div class="coord-head">
      <span class="pill-select"><select id="coordSys" aria-label="ระบบพิกัด">${COORD_MODES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>${icon('chevron')}</span>
      <span class="pill">WGS84</span>
      <button type="button" class="icon-btn copy" id="btnCopy" aria-label="คัดลอกพิกัด">${icon('copy')}</button>
    </div>
    <dl class="readout" id="readout"></dl>
    <div class="fix-line" id="fixLine"></div>
  </div>
  <div class="cta cta-2">
    <button type="button" class="btn-secondary" id="btnLocate">${icon('locate')}<span>ดูตำแหน่ง</span></button>
    <button type="button" class="btn-primary" id="btnNew">${icon('pin')}<span>NEW STATION</span></button>
  </div>`;

  const el = (id) => root.querySelector('#' + id);
  const mapEl = el('mm');
  const mm = createMap(mapEl, { interactive: false });
  const sysSel = el('coordSys');
  sysSel.value = coordMode();
  store.listStations().then(async (list) => { await ensureColors(list); mm.setStations(list); }).catch(() => {});

  // ----- GPS readout -----
  let shownFix = null;
  function renderReadout(fix, live) {
    const mode = coordMode();
    const rows = fix ? coordRows(fix, mode) : emptyRows(mode);
    const q = fix ? accClass(fix.acc) : 'none';
    const bars = fix ? accBars(fix.acc) : 0;
    const extra = [
      ['Accuracy', fix && fix.acc != null
        ? `<span class="q-${q}">±${fmtAcc(fix.acc)}<span class="u">m</span></span><span class="qbar q-${q}" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i${i <= bars ? ' class="on"' : ''}></i>`).join('')}</span>`
        : '—'],
      ['Altitude', fix
        ? (fix.alt != null ? `${Math.round(fix.alt)}<span class="u">m</span>${fix.altAcc != null ? `<small>±${Math.round(fix.altAcc)}</small>` : ''}` : '<span class="na">เครื่องไม่ส่งค่าความสูง</span>')
        : '—'],
    ];
    el('readout').innerHTML = [...rows.map(([k, v, c]) => [k, esc(v), c]), ...extra]
      .map(([k, v, c]) => `<div class="ro-row${c ? ` ${c}` : ''}"><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');
    el('readout').classList.toggle('no-fix', !fix);
    el('readout').classList.toggle('live', !!live);
    shownFix = fix;
  }

  const btnLocate = el('btnLocate');
  function paint(s) {
    const chip = el('gpsChip');
    const help = el('gpsHelp');
    const line = el('fixLine');
    const p = s.progress;
    const locating = s.status === 'locating' || s.status === 'averaging';

    if (locating) {
      const best = p?.best;
      renderReadout(best || null, true);
      chip.innerHTML = `<i class="dot pulse q-${best ? accClass(best.acc) : 'fair'}"></i>${best ? `กำลังหาพิกัด ±${fmtAcc(best.acc)} m` : 'กำลังหาสัญญาณ GPS'}`;
      const pct = p ? Math.min(100, (p.elapsed / p.maxMs) * 100) : 0;
      line.innerHTML = `<div class="progress"><i style="width:${pct.toFixed(0)}%"></i></div>
        <p>${best ? `ดีที่สุดตอนนี้ ±${fmtAcc(best.acc)} m เป้าหมาย ±${p.target} m` : 'รอสัญญาณดาวเทียม ออกไปที่โล่งจะเร็วขึ้น'} (${Math.round((p?.elapsed || 0) / 1000)}/${Math.round((p?.maxMs || 0) / 1000)} วินาที)</p>`;
      btnLocate.innerHTML = `${icon('check')}<span>ใช้ค่านี้</span>`;
      btnLocate.disabled = !best;
      btnLocate.classList.add('active');
      if (best) mm.setPosition(best, { follow: true });
    } else {
      renderReadout(s.fix, false);
      btnLocate.innerHTML = `${icon('locate')}<span>ดูตำแหน่ง</span>`;
      btnLocate.disabled = false;
      btnLocate.classList.remove('active');
      if (s.fix) {
        chip.innerHTML = `<i class="dot"></i>GPS ปิดอยู่`;
        line.innerHTML = `<p>${fixAge(s.fix)}</p>`;
        mm.setPosition(s.fix, { follow: true });
      } else {
        chip.innerHTML = `<i class="dot"></i>GPS ปิดอยู่`;
        line.innerHTML = '<p>ยังไม่มีพิกัด แตะ ดูตำแหน่ง เพื่อหาพิกัดปัจจุบัน</p>';
      }
    }

    if (s.status === 'denied') {
      chip.innerHTML = '<i class="dot q-bad"></i>ไม่ได้รับสิทธิ์ใช้ตำแหน่ง';
      help.classList.remove('hidden');
      help.innerHTML = `<p><b>เปิดสิทธิ์ตำแหน่งให้ Lodestar</b><br>
        iPhone: Settings → Privacy &amp; Security → Location Services → Safari Websites → While Using the App<br>
        Android: แตะไอคอนข้างช่องที่อยู่เว็บ → Permissions → Location → Allow</p>
        <button type="button" class="btn sm" id="btnRetry">${icon('refresh')}ลองอีกครั้ง</button>`;
      el('btnRetry').onclick = () => { gps.retry(); locateNow(); };
    } else if (s.status === 'insecure' || s.status === 'unsupported') {
      chip.innerHTML = `<i class="dot q-bad"></i>${s.status === 'insecure' ? 'ต้องเปิดผ่าน https' : 'เครื่องนี้ไม่มี GPS'}`;
      help.classList.remove('hidden');
      help.innerHTML = `<p>${gps.GPS_ERRORS[s.status]}</p>`;
    } else {
      help.classList.add('hidden');
    }
  }
  const unsubGps = gps.subscribe(paint);
  // keep "x minutes ago" fresh without touching the GPS
  const ticker = setInterval(() => { const s = gps.current(); if (s.status === 'idle' && s.fix) el('fixLine').innerHTML = `<p>${fixAge(s.fix)}</p>`; }, 15000);

  const abort = new AbortController();
  async function locateNow() {
    if (gps.isRunning()) { gps.stopNow(); return; }
    try {
      const fix = await gps.locate({ target: Number(store.getSettings().gpsTarget) || 5, signal: abort.signal });
      toast(`ได้พิกัดแล้ว ±${fmtAcc(fix.acc)} m ปิด GPS แล้ว`);
    } catch (err) {
      if (err.name !== 'AbortError' && err.message !== 'denied') toast(gps.GPS_ERRORS[err.message] || `GPS ผิดพลาด: ${err.message}`, 4000);
    }
  }
  btnLocate.onclick = locateNow;

  sysSel.onchange = async () => {
    await store.updateSettings({ coordFormat: sysSel.value });
    paint(gps.current());
  };

  el('btnCopy').onclick = async () => {
    const s = gps.current();
    const text = coordText(s.progress?.best || s.fix);
    if (!text) return toast('ยังไม่มีพิกัดให้คัดลอก');
    try {
      await navigator.clipboard.writeText(text);
      toast(`คัดลอกแล้ว: ${text}`);
    } catch {
      toast(text, 4000);
    }
  };

  // ----- Compass -----
  const btnCmp = el('btnCmp');
  function renderHeading(c) {
    const sub = el('vCmpSub');
    btnCmp.classList.toggle('hidden', c.status !== 'needs-permission');
    el('cmp').classList.toggle('off', c.status !== 'ok');
    if (c.status !== 'ok') {
      el('vBrg').textContent = '—';
      el('vCard').textContent = '';
      sub.textContent = {
        'needs-permission': 'แตะปุ่มเพื่อให้ Lodestar อ่านเข็มทิศ',
        waiting: 'กำลังอ่านเซนเซอร์',
        unavailable: 'เครื่องนี้ไม่มีเซนเซอร์เข็มทิศ',
        denied: 'ไม่ได้รับสิทธิ์ใช้เซนเซอร์ทิศทาง',
        off: '',
      }[c.status] || '';
      return;
    }
    const decl = Number(store.getSettings().declination) || 0;
    const h = norm360(c.heading + decl);
    root.querySelector('#dialCard').setAttribute('transform', `rotate(${(-h).toFixed(1)} 50 50)`);
    el('vBrg').textContent = `${String(Math.round(h) % 360).padStart(3, '0')}°`;
    el('vCard').textContent = cardinal(h);
    const ref = decl ? `ทิศเหนือจริง (declination ${decl > 0 ? '+' : ''}${decl}°)` : 'ทิศเหนือแม่เหล็ก';
    sub.textContent = c.accuracy != null && c.accuracy > 20
      ? 'เข็มทิศคลาดเคลื่อน หมุนโทรศัพท์เป็นเลข 8 เพื่อปรับเทียบ'
      : `${ref}${c.accuracy != null ? ` ±${Math.round(c.accuracy)}°` : ''}`;
  }
  const unsubCmp = compass.subscribe(renderHeading);
  btnCmp.onclick = () => compass.requestPermission();

  // ----- other actions -----
  const openMap = () => { location.hash = '#/map'; };
  mapEl.addEventListener('click', openMap);
  mapEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') openMap(); });

  const slot = el('bannerSlot');
  slot.addEventListener('click', async (e) => {
    if (e.target.closest('[data-dismiss]')) {
      await store.updateSettings({ bannerDismissed: true });
      slot.innerHTML = '';
      mm.invalidate();
    } else if (e.target.closest('[data-install]')) {
      if (await promptInstall()) slot.innerHTML = '';
    }
  });
  const onInstallable = () => { slot.innerHTML = bannerHTML(); };
  document.addEventListener('geo:installable', onInstallable);

  const btnNew = el('btnNew');
  btnNew.onclick = async () => {
    btnNew.disabled = true;
    try {
      abort.abort(); // the station takes its own fix
      const st = await store.createStation(null);
      store.freshIds.add(st.id);
      location.hash = `#/station/${st.id}/edit`;
    } catch (err) {
      toast(`สร้าง Station ไม่สำเร็จ: ${err.message}`);
      btnNew.disabled = false;
    }
  };

  return () => {
    abort.abort();
    unsubGps();
    unsubCmp();
    clearInterval(ticker);
    document.removeEventListener('geo:installable', onInstallable);
    mm.destroy();
  };
}

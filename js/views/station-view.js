// Geological station — one page of the field notebook, tied to one coordinate.
// A new station switches the GPS on once to take its point, then the GPS goes off.
// Every change is saved to the phone straight away; SAVE STATION marks the page complete.

import * as store from '../store.js';
import * as gps from '../gps.js';
import { coordMode, coordRows, emptyRows } from '../coords.js';
import { LITHOLOGY, LITHOLOGY_AREA, WEATHERING, STRUCTURE_TYPES, COLORS, lithInfo } from '../vocab.js';
import { icon, strikeDipSymbol } from '../icons.js';
import { setHeader, toast } from '../ui.js';
import { openGallery } from '../gallery.js';
import { openClino } from './clino.js';
import { openCamera } from './camera.js';
import { finishStation, canAutoSave } from '../smartauto.js';
import { esc, pad, debounce, parseNum, trim1, fmtClock, fmtDay, uuid } from '../util.js';
import { strikeToDipDir, dipDirToStrike, accClass, fmtAcc } from '../geomath.js';

const opt = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
const weatheringOptions = (sel) => opt('', 'เลือกระดับการผุ', sel) + WEATHERING.map(([c, en, th]) => opt(c, `${c} ${en} (${th})`, sel)).join('');
const structOptions = (sel) => STRUCTURE_TYPES.map(([en, th]) => opt(en, `${en} (${th})`, sel)).join('');

export async function render(root, ctx, id) {
  const backHTML = `<button type="button" class="icon-btn" id="hdrBack" aria-label="กลับ">${icon('back')}</button>`;
  setHeader({ left: backHTML });
  const st = await store.getStation(id);
  if (!ctx.alive()) return;
  const fromElsewhere = ctx.prev && !ctx.prev.startsWith('#/station') ? ctx.prev : '#/gps';
  let fallback = fromElsewhere;

  if (!st) {
    root.innerHTML = `<div class="empty"><p>ไม่พบ Station นี้ อาจถูกลบไปแล้ว</p><a class="btn" href="#/stations">ดูรายการ Station</a></div>`;
    document.getElementById('hdrBack').onclick = () => { location.hash = fallback; };
    return;
  }

  // A station opened straight from NEW STATION returns to the GPS screen;
  // an existing station opened with แก้ไข returns to its read-only page.
  const openedAsNew = store.freshIds.has(st.id);
  if (!openedAsNew) fallback = `#/station/${st.id}`;
  let discarded = false;
  let closed = false;
  let gpsCtl = new AbortController(); // aborting it switches this page's GPS session off
  let thumbUrls = [];

  setHeader({
    left: backHTML,
    title: `<div class="hdr-st"><span>${openedAsNew ? 'Station' : 'แก้ไข'}</span><b>${String(st.number).padStart(3, '0')}</b></div>`,
    right: '<span class="save-state" id="saveState" aria-live="polite"></span>',
  });

  const saveState = document.getElementById('saveState');
  function setSaveState(s) {
    saveState.className = `save-state ${s}`;
    saveState.innerHTML = s === 'saving' ? 'กำลังบันทึก' : s === 'error' ? 'บันทึกไม่ได้' : `${icon('check')}บันทึกแล้ว`;
  }
  setSaveState('saved');

  async function saveNow() {
    if (discarded) return;
    try {
      await store.saveStation(st);
      if (!closed) setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      toast(`บันทึกไม่สำเร็จ: ${err.message}`, 4000);
    }
  }
  const autosave = debounce(saveNow, 350);
  const touch = () => {
    store.freshIds.delete(st.id);
    setSaveState('saving');
    autosave();
  };

  const lithChips = LITHOLOGY.map(([en, th]) =>
    `<button type="button" class="chip" data-lith="${esc(en)}" aria-pressed="false">${esc(en)}<i>${esc(th)}</i></button>`).join('');

  root.innerHTML = `
  <div class="screen page station-screen">
    <section class="loc-panel" id="locPanel">
      <h2 class="sec-h">Location <span class="fix-tag" id="locTag"></span></h2>
      <p class="loc-sys" id="locSys"></p>
      <dl class="loc-rows" id="locRows"></dl>
      <div id="locProg"></div>
      <p class="loc-note" id="locNote"></p>
      <div class="btn-row" id="locBtns"></div>
    </section>

    <section class="sec">
      <h2 class="sec-h">Rock / outcrop</h2>
      <label class="field"><span class="lbl">Lithology</span>
        <input type="text" data-f="lithology" value="${esc(st.lithology)}" placeholder="พิมพ์ชนิดหิน หรือแตะตัวเลือกด้านล่าง" autocomplete="off" autocapitalize="sentences"></label>
      <div class="chips" role="group" aria-label="หินที่พบใน${LITHOLOGY_AREA}">
        <p class="chips-label">หินที่พบใน${LITHOLOGY_AREA}</p>
        ${lithChips}
      </div>
      <label class="field"><span class="lbl">Weathering</span>
        <span class="select"><select data-f="weathering">${weatheringOptions(st.weathering)}</select></span></label>
      <label class="field"><span class="lbl">Color</span>
        <input type="text" data-f="color" list="colorList" value="${esc(st.color)}" autocomplete="off" placeholder="เช่น Reddish brown"></label>
      <datalist id="colorList">${COLORS.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    </section>

    <section class="sec">
      <h2 class="sec-h">Structure <span class="sec-note">right-hand rule</span></h2>
      <div id="measList"></div>
      <div class="btn-row meas-add">
        <button type="button" class="btn sensor" data-act="clino-new">${icon('clino')}วัดด้วยเซนเซอร์</button>
        <button type="button" class="btn" data-act="add-meas">${icon('plus')}กรอกเอง</button>
      </div>
    </section>

    <section class="sec">
      <h2 class="sec-h">Samples</h2>
      <div id="sampleList"></div>
      <button type="button" class="btn add" data-act="add-sample">${icon('plus')}Add sample</button>
    </section>

    <section class="sec">
      <h2 class="sec-h">Photos <span class="sec-note" id="photoCount"></span></h2>
      <div class="photo-grid" id="photoGrid"></div>
      <div class="btn-row">
        <button type="button" class="btn sensor" data-act="camera">${icon('camera')}ถ่ายรูป</button>
        <label class="btn">${icon('image')}เลือกจากคลัง<input class="vh" type="file" accept="image/*" multiple data-photo></label>
      </div>
    </section>

    <section class="sec">
      <h2 class="sec-h">Notes</h2>
      <textarea data-f="notes" rows="4" placeholder="สิ่งที่สังเกตเห็น เช่น ความหนาชั้น ขนาดเม็ดตะกอน ซากดึกดำบรรพ์">${esc(st.notes)}</textarea>
    </section>

    <button type="button" class="btn-text danger" data-act="delete">${icon('trash')}ลบ Station นี้</button>
  </div>
  <div class="cta"><button type="button" class="btn-primary xl" data-act="save">${icon('check')}<span>SAVE STATION</span></button></div>`;

  const q = (sel) => root.querySelector(sel);

  // ---------- location (UTM first) ----------
  let locMode = null; // null | 'locate' | 'average'

  function rowsHTML(fix) {
    const mode = coordMode();
    const rows = fix ? coordRows(fix, mode).map(([k, v, c]) => [k, esc(v), c]) : emptyRows(mode);
    rows.push(['Accuracy', fix && fix.acc != null ? `<span class="q-${accClass(fix.acc)}">±${fmtAcc(fix.acc)}<span class="u">m</span></span>` : '—']);
    rows.push(['Altitude', fix && fix.alt != null ? `${Math.round(fix.alt)}<span class="u">m</span>` : '—']);
    return rows.map(([k, v, c]) => `<div${c ? ` class="${c}"` : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }

  function renderLocation() {
    const L = st.location;
    q('#locSys').textContent = coordMode() === 'utm' ? 'Grid Ref / UTM WGS84' : 'Lat/Long WGS84';
    const tag = q('#locTag');
    const btns = q('#locBtns');
    if (locMode) {
      tag.className = 'fix-tag q-fair';
      tag.textContent = locMode === 'average' ? 'กำลังเฉลี่ย' : 'กำลังหาพิกัด';
      btns.innerHTML = locMode === 'locate'
        ? `<button type="button" class="btn" data-act="use-now" disabled>${icon('check')}ใช้ค่านี้</button>
           <button type="button" class="btn" data-act="cancel-gps">ยกเลิก</button>`
        : `<button type="button" class="btn" data-act="cancel-gps">ยกเลิก</button>`;
      return;
    }
    q('#locRows').innerHTML = rowsHTML(L);
    q('#locProg').innerHTML = '';
    if (L) {
      tag.className = `fix-tag q-${accClass(L.acc)}`;
      tag.textContent = L.method === 'average' ? `เฉลี่ย ${L.n} ค่า` : 'ค่าเดียว';
      q('#locNote').textContent = `ปักพิกัดเมื่อ ${fmtClock(L.time, true)}, ${fmtDay(L.time)}${L.method === 'average' && L.spread != null ? `, กระจาย ${L.spread.toFixed(1)} m` : ''} (GPS ปิดแล้ว)`;
    } else {
      tag.className = 'fix-tag';
      tag.textContent = 'ยังไม่มีพิกัด';
      q('#locNote').textContent = 'แตะ จับพิกัด เมื่ออยู่ที่ outcrop';
    }
    btns.innerHTML = `<button type="button" class="btn" data-act="recap">${icon('locate')}${L ? 'จับพิกัดใหม่' : 'จับพิกัด'}</button>
      <button type="button" class="btn" data-act="avg">${icon('target')}เฉลี่ย 10 วินาที</button>`;
  }

  function showProgress(fix, pct, text) {
    q('#locRows').innerHTML = rowsHTML(fix);
    q('#locProg').innerHTML = `<div class="progress"><i style="width:${Math.min(100, pct).toFixed(0)}%"></i></div>`;
    q('#locNote').textContent = text;
    const use = q('[data-act=use-now]');
    if (use) use.disabled = !fix;
  }

  // live updates while this page's GPS session runs
  const unsubGps = gps.subscribe((s) => {
    if (locMode !== 'locate' || s.status !== 'locating' || !s.progress) return;
    const p = s.progress;
    showProgress(p.best, (p.elapsed / p.maxMs) * 100,
      p.best ? `ดีที่สุดตอนนี้ ±${fmtAcc(p.best.acc)} m เป้าหมาย ±${p.target} m (${Math.round(p.elapsed / 1000)}/${Math.round(p.maxMs / 1000)} วินาที)` : 'กำลังรอสัญญาณดาวเทียม');
  });

  async function applyFix(fix, message) {
    if (discarded || closed) return;
    st.location = store.makeLocation(fix);
    store.freshIds.delete(st.id);
    autosave.cancel();
    await saveNow();
    if (message) toast(message);
  }

  async function locateHere(isNew = false) {
    if (gps.isRunning()) return;
    locMode = 'locate';
    renderLocation();
    showProgress(null, 0, 'กำลังเปิด GPS');
    try {
      const fix = await gps.locate({ target: Number(store.getSettings().gpsTarget) || 5, signal: gpsCtl.signal });
      locMode = null;
      await applyFix(fix, `${isNew ? 'ปักพิกัด Station แล้ว' : 'อัปเดตพิกัดแล้ว'} ±${fmtAcc(fix.acc)} m ปิด GPS แล้ว`);
    } catch (err) {
      locMode = null;
      if (err.name !== 'AbortError') toast(gps.GPS_ERRORS[err.message] || `GPS ผิดพลาด: ${err.message}`, 4000);
    }
    if (!closed) renderLocation();
  }

  async function averageHere() {
    if (gps.isRunning()) return;
    locMode = 'average';
    renderLocation();
    showProgress(st.location, 0, 'ยืนนิ่ง ๆ กำลังเฉลี่ยพิกัด');
    try {
      const fix = await gps.average(10000, (p) => {
        if (closed || locMode !== 'average') return;
        showProgress(st.location, (p.elapsed / p.total) * 100, `ยืนนิ่ง ๆ กำลังเฉลี่ยพิกัด (${p.n} ค่า)`);
      }, gpsCtl.signal);
      locMode = null;
      await applyFix(fix, `เฉลี่ยจาก ${fix.n} ค่า ±${fmtAcc(fix.acc)} m ปิด GPS แล้ว`);
    } catch (err) {
      locMode = null;
      if (err.name !== 'AbortError') toast(gps.GPS_ERRORS[err.message] || `GPS ผิดพลาด: ${err.message}`, 4000);
    }
    if (!closed) renderLocation();
  }

  // ---------- lithology ----------
  function syncChips() {
    const hit = lithInfo(st.lithology);
    root.querySelectorAll('.chip[data-lith]').forEach((c) => {
      c.setAttribute('aria-pressed', String(!!hit && hit.en === c.dataset.lith));
    });
  }

  // ---------- structure ----------
  function measHTML(m, i) {
    const sym = m.strike != null ? strikeDipSymbol(m.strike, 'sdsym live') : strikeDipSymbol(0, 'sdsym live idle');
    return `<div class="meas" data-i="${i}">
      <div class="meas-top">
        ${sym}
        <span class="select"><select data-m="type" aria-label="ชนิดโครงสร้าง">${structOptions(m.type)}</select></span>
        <button type="button" class="icon-btn" data-act="clino-row" aria-label="วัดค่านี้ใหม่ด้วยเซนเซอร์">${icon('clino')}</button>
        <button type="button" class="icon-btn" data-act="rm-meas" aria-label="ลบการวัดนี้">${icon('close')}</button>
      </div>
      <div class="meas-grid">
        <label><span>Strike</span><input type="text" inputmode="numeric" data-m="strike" value="${trim1(m.strike)}" placeholder="000" autocomplete="off"></label>
        <label><span>Dip</span><input type="text" inputmode="numeric" data-m="dip" value="${trim1(m.dip)}" placeholder="00" autocomplete="off"></label>
        <label><span>Dip dir</span><input type="text" inputmode="numeric" data-m="dipdir" value="${trim1(m.dipdir)}" placeholder="000" autocomplete="off"></label>
      </div>
      ${srcHTML(m)}
    </div>`;
  }
  function srcHTML(m) {
    if (m.src !== 'sensor') return '<p class="m-src hidden"></p>';
    const x = m.sensor || {};
    return `<p class="m-src">${icon('clino')}วัดด้วยเซนเซอร์ ${x.at ? fmtClock(x.at) : ''}${x.spread != null ? ` · กระจาย ${x.spread}°` : ''}${x.calibrated ? '' : ' · ยังไม่ปรับศูนย์'}</p>`;
  }
  function markManual(box, m) {
    if (m.src !== 'sensor') return;
    m.src = 'manual';
    box.querySelector('.m-src')?.classList.add('hidden');
  }
  function renderMeasurements() {
    q('#measList').innerHTML = st.measurements.length
      ? st.measurements.map(measHTML).join('')
      : '<p class="sec-empty">ยังไม่มีการวัด</p>';
  }
  function updateSymbol(box, m) {
    const svg = box.querySelector('.sdsym');
    svg.classList.toggle('idle', m.strike == null);
    svg.style.transform = `rotate(${m.strike ?? 0}deg)`;
  }

  // ---------- samples ----------
  function renderSamples() {
    q('#sampleList').innerHTML = st.samples.length
      ? st.samples.map((s, i) => `<div class="sample" data-i="${i}">
          <input type="text" class="mono" data-s="id" value="${esc(s.id)}" aria-label="รหัสตัวอย่าง" autocomplete="off">
          <input type="text" data-s="note" value="${esc(s.note)}" placeholder="หมายเหตุ" autocomplete="off">
          <button type="button" class="icon-btn" data-act="rm-sample" aria-label="ลบตัวอย่างนี้">${icon('close')}</button>
        </div>`).join('')
      : '<p class="sec-empty">ยังไม่มีตัวอย่าง</p>';
  }
  function nextSampleId() {
    st.sampleSeq = Math.max(st.sampleSeq || 0, st.samples.length) + 1;
    const prefix = store.getProject().samplePrefix || 'GEO';
    return `${prefix}-${String(st.number).padStart(3, '0')}-${pad(st.sampleSeq)}`;
  }

  // ---------- photos ----------
  let photoBusy = 0;
  async function renderPhotos() {
    const metas = await store.listPhotos(st);
    if (closed) return;
    thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    thumbUrls = [];
    const tiles = metas.map((p, i) => {
      const url = URL.createObjectURL(new Blob([p.thumb], { type: 'image/jpeg' }));
      thumbUrls.push(url);
      return `<button type="button" class="ph" data-photo-id="${p.id}" aria-label="ดูรูปที่ ${i + 1}"><img src="${url}" alt=""><span>${pad(i + 1)}</span></button>`;
    });
    for (let k = 0; k < photoBusy; k++) tiles.push('<div class="ph busy"><i class="spinner"></i></div>');
    q('#photoGrid').innerHTML = tiles.join('');
    q('#photoCount').textContent = metas.length ? `${metas.length} รูป` : '';
  }

  // Photos: the in-app camera shows the Smart Photo details live and records the bearing at the
  // shutter; photos from the library keep their own EXIF direction if they have one.
  let photoAdded = false;

  async function addFiles(files, extra = {}) {
    if (!files.length) return;
    photoAdded = true;
    photoBusy += files.length;
    await renderPhotos();
    for (const f of files) {
      try {
        await store.addPhoto(st, f, extra);
        store.freshIds.delete(st.id);
      } catch (err) {
        toast(`เพิ่มรูปไม่สำเร็จ: ${err.message}`, 4000);
      }
      photoBusy -= 1;
      await renderPhotos();
    }
    setSaveState('saved');
  }
  async function addPhotos(input) {
    const files = [...(input.files || [])];
    input.value = '';
    await addFiles(files);
  }

  function openPhoto(photoId) {
    openGallery(st, photoId, {
      onDelete: async (id) => {
        await store.deletePhoto(st, id);
        renderPhotos();
      },
    });
  }

  // ---------- events ----------
  function onEdit(e) {
    const t = e.target;
    const isSelect = t.tagName === 'SELECT';
    if ((e.type === 'change') !== isSelect) return; // text → input events, selects → change events

    if (t.dataset.f) {
      st[t.dataset.f] = t.value;
      if (t.dataset.f === 'lithology') syncChips();
      touch();
      return;
    }
    if (t.dataset.m) {
      const box = t.closest('.meas');
      const m = st.measurements[Number(box.dataset.i)];
      const key = t.dataset.m;
      if (key === 'type') { m.type = t.value; touch(); return; }
      const v = parseNum(t.value);
      const ok = v === null || (!Number.isNaN(v) && v >= 0 && v <= (key === 'dip' ? 90 : 360));
      t.classList.toggle('invalid', !ok);
      t.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (!ok) return;
      markManual(box, m);
      if (key === 'dip') {
        m.dip = v;
      } else if (key === 'strike') {
        m.strike = v === null ? null : v % 360;
        if (v !== null) {
          m.dipdir = strikeToDipDir(m.strike);
          const dd = box.querySelector('[data-m=dipdir]');
          dd.value = trim1(m.dipdir);
          dd.classList.remove('invalid');
        }
        updateSymbol(box, m);
      } else if (key === 'dipdir') {
        m.dipdir = v === null ? null : v % 360;
        if (v !== null) {
          m.strike = dipDirToStrike(m.dipdir);
          const sk = box.querySelector('[data-m=strike]');
          sk.value = trim1(m.strike);
          sk.classList.remove('invalid');
        }
        updateSymbol(box, m);
      }
      touch();
      return;
    }
    if (t.dataset.s) {
      const row = t.closest('.sample');
      st.samples[Number(row.dataset.i)][t.dataset.s] = t.value;
      touch();
    }
  }
  root.addEventListener('input', onEdit);
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-photo]')) return addPhotos(e.target);
    onEdit(e);
  });

  root.addEventListener('click', async (e) => {
    const ph = e.target.closest('[data-photo-id]');
    if (ph) return openPhoto(ph.dataset.photoId);
    const chip = e.target.closest('.chip[data-lith]');
    if (chip) {
      st.lithology = chip.dataset.lith;
      q('[data-f=lithology]').value = st.lithology;
      syncChips();
      touch();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;

    if (act === 'camera') {
      openCamera({
        getStation: () => st,
        onCapture: (file, extra) => addFiles([file], extra),
        onNative: (files, extra) => addFiles(files, extra),
      });
    } else if (act === 'clino-new') {
      const prev = st.measurements[st.measurements.length - 1];
      openClino({
        type: prev?.type || 'Bedding',
        allowMore: true,
        onSave: (m) => {
          st.measurements.push(m);
          renderMeasurements();
          touch();
        },
      });
    } else if (act === 'clino-row') {
      const i = Number(btn.closest('.meas').dataset.i);
      const cur = st.measurements[i];
      openClino({
        type: cur.type || 'Bedding',
        allowMore: false,
        onSave: (m) => {
          Object.assign(cur, { ...m, id: cur.id });
          renderMeasurements();
          touch();
        },
      });
    } else if (act === 'add-meas') {
      const prev = st.measurements[st.measurements.length - 1];
      st.measurements.push({ id: uuid(), type: prev?.type || 'Bedding', strike: null, dip: null, dipdir: null });
      renderMeasurements();
      root.querySelector(`.meas[data-i="${st.measurements.length - 1}"] [data-m=strike]`)?.focus();
      touch();
    } else if (act === 'rm-meas') {
      const i = Number(btn.closest('.meas').dataset.i);
      const m = st.measurements[i];
      if ((m.strike != null || m.dip != null) && !confirm('ลบการวัดนี้?')) return;
      st.measurements.splice(i, 1);
      renderMeasurements();
      touch();
    } else if (act === 'add-sample') {
      st.samples.push({ id: nextSampleId(), note: '' });
      renderSamples();
      root.querySelector(`.sample[data-i="${st.samples.length - 1}"] [data-s=note]`)?.focus();
      touch();
    } else if (act === 'rm-sample') {
      const i = Number(btn.closest('.sample').dataset.i);
      if (!confirm(`ลบตัวอย่าง ${st.samples[i].id}?`)) return;
      st.samples.splice(i, 1);
      renderSamples();
      touch();
    } else if (act === 'recap') {
      locateHere(false);
    } else if (act === 'avg') {
      averageHere();
    } else if (act === 'use-now') {
      gps.stopNow();
    } else if (act === 'cancel-gps') {
      gpsCtl.abort();
      gpsCtl = new AbortController();
    } else if (act === 'save') {
      btn.disabled = true;
      st.status = 'saved';
      store.freshIds.delete(st.id);
      autosave.cancel();
      await saveNow();
      store.ensurePersistence();
      toast(`บันทึก ${st.code} แล้ว`);
      smartAfterSave();
      location.hash = openedAsNew ? '#/gps' : `#/station/${st.id}`;
    } else if (act === 'delete') {
      const n = st.photoIds.length;
      if (!confirm(`ลบ ${st.code}${n ? ` และรูป ${n} รูป` : ''}? ย้อนกลับไม่ได้`)) return;
      discarded = true;
      autosave.cancel();
      gpsCtl.abort();
      await store.deleteStation(st);
      toast(`ลบ ${st.code} แล้ว`);
      location.hash = '#/stations';
    }
  });

  // Smart Photos: kept in the app and (Android) saved to the phone once the station is saved
  function smartAfterSave() {
    if (!st.photoIds.length) return;
    finishStation(st.id).then(({ kept, saved }) => {
      if (saved) toast(`บันทึก Smart Photo ${saved} รูปลงเครื่องแล้ว (โฟลเดอร์ Download)`, 3500);
      else if (kept && !canAutoSave() && store.getSettings().smartAutoSave !== false && photoAdded) {
        toast('Smart Photo เก็บไว้ในแอปแล้ว แตะรูปแล้วกด Smart Photo เพื่อบันทึกลงรูปภาพ', 4000);
      }
    });
  }

  document.getElementById('hdrBack').onclick = async () => {
    await autosave.flush();
    if (st.status === 'draft' && store.freshIds.has(st.id) && store.isEmptyStation(st)) {
      discarded = true;
      gpsCtl.abort();
      await store.deleteStation(st);
      store.freshIds.delete(st.id);
      toast('ยกเลิก Station ที่ยังไม่ได้กรอกข้อมูล');
    }
    if (!discarded) smartAfterSave();
    location.hash = fallback;
  };

  const onHide = () => autosave.flush();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);

  renderLocation();
  syncChips();
  renderMeasurements();
  renderSamples();
  renderPhotos();
  // A brand-new station takes its point straight away; the GPS switches off afterwards.
  if (!st.location && store.freshIds.has(st.id)) locateHere(true);

  return () => {
    closed = true;
    gpsCtl.abort();
    unsubGps();
    autosave.flush();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  };
}

// Map — every station with its strike/dip symbol. Shows your last known position;
// the locate button switches the GPS on once and off again.

import * as gps from '../gps.js';
import * as store from '../store.js';
import { createMap } from '../map.js';
import { icon } from '../icons.js';
import { mainHeader, toast } from '../ui.js';
import { accClass, fmtAcc } from '../geomath.js';
import { fixAge } from '../coords.js';
import { ensureColors, legend } from '../rockcolors.js';
import { esc } from '../util.js';

export async function render(root, ctx) {
  mainHeader();
  root.innerHTML = `<div class="map-screen">
    <div class="bigmap" id="bigmap"></div>
    <div class="gps-chip map-chip" id="mapChip"></div>
    <div class="map-legend hidden" id="mapLegend"></div>
    <div class="map-fabs">
      <a class="fab" href="#/summary" aria-label="สร้างแผนที่สรุปเป็นรูป">${icon('image')}</a>
      <button type="button" class="fab" id="fabFit" aria-label="แสดงทุก Station">${icon('fit')}</button>
      <button type="button" class="fab" id="fabMe" aria-label="หาตำแหน่งปัจจุบัน">${icon('locate')}</button>
    </div>
  </div>`;

  const m = createMap(root.querySelector('#bigmap'), { interactive: true });
  const list = await store.listStations();
  await ensureColors(list);
  if (!ctx.alive()) { m.destroy(); return; }
  m.setStations(list, (st) => { location.hash = `#/station/${st.id}`; });

  // legend: what each pin colour means
  const lg = root.querySelector('#mapLegend');
  const entries = legend(list.filter((s) => s.location));
  if (entries.length) {
    let open = store.getSettings().legendOpen !== false;
    const paint = () => {
      lg.classList.toggle('closed', !open);
      lg.innerHTML = `<button type="button" class="lg-head" aria-expanded="${open}">สัญลักษณ์สีหิน<span>${open ? '−' : '+'}</span></button>
        ${open ? `<ul>${entries.map((e) => `<li><i style="background:${e.color}"></i><span><b>${esc(e.name)}</b>${e.th ? ` ${esc(e.th)}` : ''}<small>${esc(e.note)}</small></span><em>${e.n}</em></li>`).join('')}</ul>` : ''}`;
    };
    lg.classList.remove('hidden');
    paint();
    lg.addEventListener('click', (e) => {
      if (!e.target.closest('.lg-head')) return;
      open = !open;
      store.updateSettings({ legendOpen: open });
      paint();
    });
    L.DomEvent?.disableClickPropagation?.(lg);
    L.DomEvent?.disableScrollPropagation?.(lg);
  }
  if (m.hasStations()) m.fitStations();

  const chip = root.querySelector('#mapChip');
  const fab = root.querySelector('#fabMe');
  let centred = m.hasStations();
  const unsub = gps.subscribe((s) => {
    const live = s.status === 'locating' ? s.progress?.best : null;
    const f = live || s.fix;
    if (f) {
      m.setPosition(f);
      if (!centred) { m.centerOn(f, 16); centred = true; }
    }
    fab.classList.toggle('busy', s.status === 'locating');
    if (s.status === 'locating') {
      chip.innerHTML = `<i class="dot pulse q-${live ? accClass(live.acc) : 'fair'}"></i>${live ? `กำลังหาพิกัด ±${fmtAcc(live.acc)} m` : 'กำลังหาสัญญาณ GPS'}`;
    } else if (s.fix) {
      chip.innerHTML = `<i class="dot"></i>${fixAge(s.fix)}`;
    } else {
      chip.innerHTML = '<i class="dot"></i>แตะปุ่มตำแหน่งเพื่อหาพิกัด';
    }
  });

  const abort = new AbortController();
  fab.onclick = async () => {
    if (gps.isRunning()) { gps.stopNow(); return; }
    try {
      const f = await gps.locate({ target: Number(store.getSettings().gpsTarget) || 5, signal: abort.signal });
      m.centerOn(f, 17);
      toast(`ได้พิกัดแล้ว ±${fmtAcc(f.acc)} m ปิด GPS แล้ว`);
    } catch (err) {
      if (err.name !== 'AbortError') toast(gps.GPS_ERRORS[err.message] || `GPS ผิดพลาด: ${err.message}`, 4000);
    }
  };
  root.querySelector('#fabFit').onclick = () => {
    if (m.hasStations()) m.fitStations();
    else toast('ยังไม่มี Station บนแผนที่');
  };

  return () => { abort.abort(); unsub(); m.destroy(); };
}

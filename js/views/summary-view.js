// Project summary image — preview, a few options, then save or share (Instagram, LINE, Photos).

import * as store from '../store.js';
import { renderSummary, duration } from '../summary.js';
import { icon } from '../icons.js';
import { setHeader, toast } from '../ui.js';
import { esc, debounce, stamp } from '../util.js';
import { deliver } from '../export.js';

const seg = (key, value, options) =>
  `<div class="seg" role="radiogroup" data-k="${key}">${options
    .map(([v, label]) => `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${label}</button>`)
    .join('')}</div>`;

export async function render(root, ctx) {
  const back = ctx.prev && !ctx.prev.startsWith('#/summary') ? ctx.prev : '#/stations';
  setHeader({
    left: `<button type="button" class="icon-btn" id="hdrBack" aria-label="กลับ">${icon('back')}</button>`,
    title: '<span class="hdr-title">แผนที่สรุป</span>',
  });
  document.getElementById('hdrBack').onclick = () => { location.hash = back; };

  const project = store.getProject();
  const stations = await store.listStations();
  if (!ctx.alive()) return;
  const located = stations.filter((s) => s.location);
  if (!located.length) {
    root.innerHTML = `<div class="empty"><p>โปรเจกต์นี้ยังไม่มี Station ที่มีพิกัด<br>บันทึก Station อย่างน้อยหนึ่งจุดก่อน</p><a class="btn" href="#/gps">${icon('gps')}ไปหน้า GPS</a></div>`;
    return;
  }

  const saved = store.getSettings().summary || {};
  const opts = { format: 'post', theme: 'dark', basemap: true, rotate: true, ...saved };
  const first = Math.min(...located.map((s) => s.createdAt));
  const last = Math.max(...located.map((s) => s.createdAt));

  root.innerHTML = `<div class="screen summary-screen">
    <div class="sum-preview" id="sumBox"><p class="loading"><i class="spinner"></i></p></div>
    <p class="sum-facts">${esc(project.name)}: ${located.length} Stations, เก็บข้อมูล ${located.length > 1 ? duration(last - first) : '—'}</p>
    <div class="field"><span class="lbl">ขนาดรูป</span>${seg('format', opts.format, [['post', 'โพสต์ 4:5'], ['story', 'สตอรี่ 9:16']])}</div>
    <div class="field"><span class="lbl">พื้นหลัง</span>${seg('basemap', opts.basemap, [['true', 'แผนที่'], ['false', 'เรียบ']])}</div>
    <div class="field"><span class="lbl">สี</span>${seg('theme', opts.theme, [['dark', 'มืด'], ['light', 'สว่าง']])}</div>
    <div class="field"><span class="lbl">หมุนแผนที่ให้พอดีกรอบ</span>${seg('rotate', opts.rotate, [['true', 'หมุนได้'], ['false', 'ทิศเหนือขึ้นเสมอ']])}</div>
    <p class="hint" id="sumNote">แผนที่พื้นหลังต้องใช้อินเทอร์เน็ต หรือเคยเปิดแผนที่บริเวณนี้มาก่อน เวลาของแต่ละจุดคือเวลาที่กด NEW STATION ไม่นับการแก้ไขภายหลัง</p>
  </div>
  <div class="cta"><button type="button" class="btn-primary xl" id="btnShare" disabled>${icon('share')}<span>บันทึกหรือแชร์รูป</span></button></div>`;

  const box = root.querySelector('#sumBox');
  const btn = root.querySelector('#btnShare');
  let file = null;
  let url = null;
  let job = 0;

  async function draw() {
    const my = ++job;
    btn.disabled = true;
    box.classList.add('busy');
    try {
      const out = await renderSummary({ project, stations, ...opts, zoneLock: store.zoneLock() });
      if (my !== job || !ctx.alive()) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(out.blob);
      const name = `Lodestar_${project.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30)}_${stamp()}.jpg`;
      file = new File([out.blob], name, { type: 'image/jpeg' });
      box.innerHTML = `<img src="${url}" alt="แผนที่สรุปโปรเจกต์ ${esc(project.name)}" width="${out.width}" height="${out.height}">`;
      box.dataset.rotation = String(out.rotation);
      box.dataset.tiles = String(out.tilesDrawn);
      const note = root.querySelector('#sumNote');
      if (opts.basemap && !out.tilesDrawn) note.textContent = 'โหลดแผนที่พื้นหลังไม่ได้ (ไม่มีอินเทอร์เน็ต) รูปนี้ใช้พื้นหลังแบบเรียบแทน';
      btn.disabled = false;
    } catch (err) {
      if (my === job) box.innerHTML = `<p class="x-error">สร้างรูปไม่สำเร็จ: ${esc(err.message)}</p>`;
    } finally {
      if (my === job) box.classList.remove('busy');
    }
  }
  const redraw = debounce(draw, 150);

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    const group = b.closest('.seg');
    group.querySelectorAll('button').forEach((x) => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', String(on));
    });
    const k = group.dataset.k;
    opts[k] = b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v;
    store.updateSettings({ summary: { ...opts } });
    redraw();
  });

  btn.onclick = async () => {
    if (!file) return;
    const res = await deliver(file);
    if (res === 'downloaded') toast('บันทึกรูปแล้ว');
    else if (res === 'shared') toast('แชร์รูปแล้ว');
  };

  draw();
  return () => { job += 1; if (url) URL.revokeObjectURL(url); };
}

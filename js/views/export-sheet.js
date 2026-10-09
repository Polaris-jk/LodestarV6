// Export sheet: choose which projects, then which kind of file.

import * as store from '../store.js';
import * as exporter from '../export.js';
import { icon } from '../icons.js';
import { toast, openOverlay } from '../ui.js';
import { esc, fmtSize } from '../util.js';

const FORMATS = [
  ['zip', 'Project ZIP', 'ทุกอย่างในไฟล์เดียว: Excel, CSV, GeoJSON, KML, GPX, รูปภาพ และไฟล์สำรอง', true],
  ['xlsx', 'Excel (.xlsx)', 'ตาราง Stations, Structures และ Samples แยกแผ่นงาน'],
  ['csv', 'CSV', 'ตาราง Stations สำหรับ Google Sheets หรือโปรแกรมอื่น'],
  ['geojson', 'GeoJSON Stations', 'จุด Station สำหรับ QGIS และ ArcGIS'],
  ['struct', 'GeoJSON Structures', 'หนึ่งจุดต่อหนึ่งการวัด สำหรับทำสัญลักษณ์ strike/dip'],
  ['kml', 'KML', 'เปิดใน Google Earth พร้อมเส้นทางตามลำดับเวลา'],
  ['gpx', 'GPX', 'จุดและเส้นทางสำหรับแอป GPS และแอปนำทาง'],
  ['smart', 'Smart Photos', 'ทุกรูปพร้อมแถบข้อมูล Station พิกัด ทิศที่ถ่าย และ Strike/Dip (ZIP)'],
];

export async function openExportSheet() {
  const projects = await store.listProjects();
  const current = store.getProject().id;
  const multi = projects.length > 1;

  const { el, close } = openOverlay(`<div class="sheet" role="dialog" aria-label="Export">
      <div class="sheet-grip"></div>
      <h3>Export</h3>
      <p class="sheet-sub">เลือกโปรเจกต์ แล้วเลือกรูปแบบไฟล์</p>
      <div class="x-h"><span>โปรเจกต์</span>${multi ? '<button type="button" class="link-btn" data-all>เลือกทั้งหมด</button>' : ''}</div>
      <div class="x-projects">
        ${projects.map((p) => `<label class="x-proj">
          <input type="checkbox" value="${p.id}"${p.id === current ? ' checked' : ''}>
          <span class="x-check" aria-hidden="true">${icon('check')}</span>
          <span class="x-pname"><b>${esc(p.name)}</b><small>${p.stats.stations} Stations, ${p.stats.photos} Photos</small></span>
        </label>`).join('')}
      </div>
      <div class="x-h"><span>รูปแบบไฟล์</span></div>
      <div class="x-list">
        ${FORMATS.map(([k, name, desc, main]) => `<button type="button" class="x-item${main ? ' main' : ''}" data-x="${k}"><b>${name}</b><span>${desc}</span></button>`).join('')}
      </div>
      <div class="x-ready hidden" id="xReady"></div>
      <button type="button" class="btn block" data-close>ปิด</button>
    </div>`, {
    onClick: async (e) => {
      if (e.target.closest('[data-all]')) {
        const boxes = [...el.querySelectorAll('.x-proj input')];
        const all = boxes.every((b) => b.checked);
        boxes.forEach((b) => { b.checked = !all; });
        e.target.closest('[data-all]').textContent = all ? 'เลือกทั้งหมด' : 'ยกเลิกทั้งหมด';
        return;
      }
      const item = e.target.closest('[data-x]');
      if (!item) return;
      const ids = [...el.querySelectorAll('.x-proj input:checked')].map((b) => b.value);
      if (!ids.length) return toast('เลือกอย่างน้อยหนึ่งโปรเจกต์');
      const ready = el.querySelector('#xReady');
      el.querySelectorAll('[data-x]').forEach((b) => { b.disabled = true; });
      ready.classList.remove('hidden');
      ready.innerHTML = '<p class="x-busy"><i class="spinner"></i><span>กำลังเตรียมไฟล์</span></p>';
      ready.scrollIntoView({ block: 'nearest' });
      try {
        const kind = item.dataset.x;
        const file = await exporter.build(kind, ids, (done, total) => {
          const s = ready.querySelector('.x-busy span');
          if (s) s.textContent = `${kind === 'smart' ? 'กำลังสร้าง Smart Photo' : 'กำลังรวมรูป'} ${done}/${total}`;
        });
        // A fresh tap is needed to open the share sheet, so offer a button once the file is ready.
        ready.innerHTML = `<div class="x-file">
            ${icon('file')}
            <div><b>${esc(file.name)}</b><span>${fmtSize(file.size)}</span></div>
          </div>
          <button type="button" class="btn-primary block" id="xGo">${icon('share')}<span>บันทึกหรือแชร์ไฟล์</span></button>`;
        ready.scrollIntoView({ block: 'nearest' });
        ready.querySelector('#xGo').onclick = async () => {
          const res = await exporter.deliver(file);
          if (res === 'downloaded') toast('ดาวน์โหลดไฟล์แล้ว');
          else if (res === 'shared') toast('ส่งไฟล์แล้ว');
          if (res !== 'cancelled') close();
        };
      } catch (err) {
        ready.innerHTML = `<p class="x-error">สร้างไฟล์ไม่สำเร็จ: ${esc(err.message)}</p>`;
      } finally {
        el.querySelectorAll('[data-x]').forEach((b) => { b.disabled = false; });
      }
    },
  });
}

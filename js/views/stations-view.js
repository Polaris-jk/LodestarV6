// Stations — the notebook index for the current project.
// Tap a row to read it; swipe a row left for Edit / Delete; Export and the summary map live here.

import * as store from '../store.js';
import { icon, strikeDipSymbol } from '../icons.js';
import { mainHeader, toast } from '../ui.js';
import { enableSwipe } from '../swipe.js';
import { openExportSheet } from './export-sheet.js';
import { esc, fmtClock, fmtDay } from '../util.js';
import { fmtPlane, hasMeasurement } from '../geomath.js';
import { lithInfo, lithName } from '../vocab.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function row(st) {
  const m = (st.measurements || []).find((x) => hasMeasurement(x) && x.strike != null);
  const lith = lithName(st);
  const th = lithInfo(st.lithology)?.th;
  const t = st.createdAt;
  const nS = (st.samples || []).length;
  const nP = (st.photoIds || []).length;
  return `<li class="sw-item" data-id="${st.id}">
    <div class="sw-actions">
      <button type="button" class="sw-edit" data-swipe-act="edit">${icon('edit')}แก้ไข</button>
      <button type="button" class="sw-del" data-swipe-act="delete">${icon('trash')}ลบ</button>
    </div>
    <a class="st-row sw-front" href="#/station/${st.id}" draggable="false">
      <span class="st-num">${String(st.number).padStart(3, '0')}</span>
      <span class="st-body">
        <span class="st-lith">${lith ? esc(lith) : '<span class="muted">ยังไม่ระบุชนิดหิน</span>'}${th && th !== lith ? `<i>${esc(th)}</i>` : ''}</span>
        <span class="st-meta">
          ${m ? `<span class="st-plane">${strikeDipSymbol(m.strike)}${fmtPlane(m) || ''}</span>` : ''}
          ${nS ? `<span title="${plural(nS, 'sample')}">${icon('sample')}${nS}</span>` : ''}
          ${nP ? `<span title="${plural(nP, 'photo')}">${icon('photo')}${nP}</span>` : ''}
          ${!st.location ? '<span class="warn">ไม่มีพิกัด</span>' : ''}
        </span>
      </span>
      <span class="st-side">
        <span>${fmtClock(t)}</span>
        <small>${fmtDay(t, false)}</small>
        ${st.status === 'draft' ? '<em class="draft">Draft</em>' : ''}
      </span>
    </a>
  </li>`;
}

export async function render(root, ctx) {
  mainHeader();
  root.innerHTML = '<div class="screen"><p class="loading"><i class="spinner"></i></p></div>';
  let detachSwipe = null;

  async function paint() {
    const list = await store.listStations();
    if (!ctx.alive()) return;
    const project = store.getProject();
    const samples = list.reduce((n, s) => n + (s.samples || []).length, 0);
    const photos = list.reduce((n, s) => n + (s.photoIds || []).length, 0);

    root.innerHTML = `<div class="screen list-screen">
      <header class="proj">
        <div class="proj-top">
          <h1>${esc(project.name)}</h1>
          <a class="btn sm" href="#/projects">${icon('folder')}เปลี่ยนโปรเจกต์</a>
        </div>
        <p class="proj-stats">
          <span><b>${list.length}</b> Stations</span>
          <span><b>${samples}</b> Samples</span>
          <span><b>${photos}</b> Photos</span>
        </p>
        ${list.length ? `<a class="btn summary-btn" href="#/summary">${icon('map')}แผนที่สรุปโปรเจกต์</a>` : ''}
      </header>
      ${list.length
        ? `<ul class="st-list" id="stList">${list.map(row).join('')}</ul>
           <p class="hint swipe-hint">ปัดรายการไปทางซ้ายเพื่อแก้ไขหรือลบ</p>`
        : `<div class="empty">
            <p>ยังไม่มี Station ในโปรเจกต์นี้<br>ไปที่หน้า GPS แล้วกด NEW STATION เมื่อเจอ outcrop แรก</p>
            <a class="btn" href="#/gps">${icon('gps')}ไปหน้า GPS</a>
          </div>`}
    </div>
    ${list.length ? `<div class="cta"><button type="button" class="btn-primary xl" id="btnExport">${icon('share')}<span>EXPORT</span></button></div>` : ''}`;

    root.querySelector('#btnExport')?.addEventListener('click', () => openExportSheet());
    detachSwipe?.();
    const ul = root.querySelector('#stList');
    detachSwipe = ul ? enableSwipe(ul, {
      onAction: async (act, li) => {
        const id = li.dataset.id;
        if (act === 'edit') { location.hash = `#/station/${id}/edit`; return; }
        const st = await store.getStation(id);
        if (!st) return paint();
        const n = (st.photoIds || []).length;
        if (!confirm(`ลบ ${st.code}${n ? ` และรูป ${n} รูป` : ''}? ย้อนกลับไม่ได้`)) return;
        await store.deleteStation(st);
        toast(`ลบ ${st.code} แล้ว`);
        paint();
      },
    }) : null;
  }
  await paint();
  return () => detachSwipe?.();
}

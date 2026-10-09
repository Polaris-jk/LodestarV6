// Full-screen photo viewer. Every photo is shown as its Smart Photo (the picture with the
// information strip below it). Swipe left/right — the photos follow the finger and slide into
// place — or use the arrows / arrow keys. Save or share the Smart Photo from here. In the station
// editor (`onDelete` given) a photo can also be deleted.

import * as store from './store.js';
import { openOverlay, toast } from './ui.js';
import { icon } from './icons.js';
import { esc } from './util.js';
import { az3, cardinal } from './geomath.js';
import { smartFor } from './smartauto.js';
import { deliver } from './export.js';

const SRC = { exif: 'จากกล้อง', auto: 'อ่านตอนกดถ่ายรูป', aimed: 'เล็งตั้งเอง', camera: 'กล้องในแอป' };
const SLIDE_MS = 260;

export async function openGallery(st, startId, { onDelete } = {}) {
  let metas = await store.listPhotos(st);
  if (!metas.length) return;
  const editable = !!onDelete;
  let i = Math.max(0, metas.findIndex((p) => p.id === startId));
  let cache = new Map(); // photo id → { file, url } | Promise
  let animating = false;

  const { el, close } = openOverlay(`<div class="lightbox" role="dialog" aria-label="รูปของ ${esc(st.code)}">
      <div class="lb-stage">
        <div class="lb-track">
          <div class="lb-slide"><img alt="" draggable="false"><i class="spinner"></i></div>
          <div class="lb-slide"><img alt="" draggable="false"><i class="spinner"></i></div>
          <div class="lb-slide"><img alt="" draggable="false"><i class="spinner"></i></div>
        </div>
        <button type="button" class="lb-nav prev" aria-label="รูปก่อนหน้า">${icon('back')}</button>
        <button type="button" class="lb-nav next" aria-label="รูปถัดไป">${icon('back')}</button>
      </div>
      <div class="lb-info">
        <span class="lb-title"></span>
        <span class="lb-brg"></span>
      </div>
      <div class="lb-bar">
        <div class="lb-btns">
          ${editable ? `<button type="button" class="btn sm danger icon-only" data-lb="del" aria-label="ลบรูป">${icon('trash')}</button>` : ''}
          <button type="button" class="btn-primary sm" data-lb="share" disabled>${icon('share')}<span>บันทึกหรือแชร์</span></button>
          <button type="button" class="btn sm" data-lb="close">ปิด</button>
        </div>
      </div>
    </div>`, {
    cls: 'full',
    onClose: () => {
      for (const v of cache.values()) if (v && v.url) URL.revokeObjectURL(v.url);
      cache = new Map();
      document.removeEventListener('keydown', onKey);
    },
    onClick: async (e, closeIt) => {
      if (e.target.closest('.lb-nav.prev')) return go(-1);
      if (e.target.closest('.lb-nav.next')) return go(1);
      const b = e.target.closest('[data-lb]');
      if (!b || b.disabled) return;
      const act = b.dataset.lb;
      if (act === 'del' && onDelete) {
        if (!confirm('ลบรูปนี้? ย้อนกลับไม่ได้')) return;
        await onDelete(metas[i].id);
        toast('ลบรูปแล้ว');
        metas = await store.listPhotos(st);
        if (!metas.length) return closeIt();
        i = Math.min(i, metas.length - 1);
        layout();
      } else if (act === 'share') {
        const got = cache.get(metas[i].id);
        if (!got || !got.file) return;
        const res = await deliver(got.file);
        if (res === 'downloaded') toast('ดาวน์โหลดรูปแล้ว');
        else if (res === 'shared') toast('ส่งรูปแล้ว');
        if (res !== 'cancelled') {
          metas[i] = await store.updatePhoto(metas[i].id, { smartSavedAt: Date.now() }, { touch: false });
          renderInfo();
        }
      } else if (act === 'close') {
        closeIt();
      }
    },
  });

  const stage = el.querySelector('.lb-stage');
  const track = el.querySelector('.lb-track');
  const slides = [...el.querySelectorAll('.lb-slide')]; // previous, current, next
  const title = el.querySelector('.lb-title');
  const brg = el.querySelector('.lb-brg');
  const share = el.querySelector('[data-lb=share]');

  /** The Smart Photo for photo n (kept copy, or drawn now). */
  function smartAt(n) {
    const meta = metas[n];
    if (!meta) return Promise.resolve(null);
    const have = cache.get(meta.id);
    if (have) return have instanceof Promise ? have : Promise.resolve(have);
    const job = (async () => {
      const cur = await store.getStation(st.id) || st;
      const { file, meta: next } = await smartFor(cur, meta, n, metas.length);
      const idx = metas.findIndex((m) => m.id === meta.id);
      if (idx >= 0) metas[idx] = next;
      const got = { file, url: URL.createObjectURL(file) };
      cache.set(meta.id, got);
      return got;
    })().catch((err) => {
      cache.delete(meta.id);
      toast(`สร้าง Smart Photo ไม่สำเร็จ: ${err.message}`, 4000);
      return null;
    });
    cache.set(meta.id, job);
    return job;
  }

  function fill(slide, n) {
    const img = slide.querySelector('img');
    const spin = slide.querySelector('.spinner');
    slide.dataset.n = String(n);
    if (n < 0 || n >= metas.length) { img.removeAttribute('src'); img.hidden = true; spin.hidden = true; return; }
    const have = cache.get(metas[n].id);
    if (have && have.url) { img.src = have.url; img.hidden = false; spin.hidden = true; }
    else {
      img.hidden = true; spin.hidden = false;
      smartAt(n).then((got) => {
        if (!got || slide.dataset.n !== String(n)) return;
        img.src = got.url; img.hidden = false; spin.hidden = true;
        if (n === i) { share.disabled = false; renderInfo(); }
      });
    }
    img.alt = `${st.code} Smart Photo รูปที่ ${n + 1}`;
  }

  function renderInfo() {
    const m = metas[i];
    title.textContent = `${st.code} รูปที่ ${i + 1}/${metas.length}`;
    const dir = m.bearing != null
      ? `ทิศที่ถ่าย ${m.bearingSrc === 'auto' ? '≈' : ''}${az3(Math.round(m.bearing) % 360)}° ${cardinal(m.bearing)} (${SRC[m.bearingSrc] || ''})`
      : '';
    const kept = m.smartSavedAt ? 'บันทึกลงเครื่องแล้ว' : '';
    brg.textContent = [dir, kept].filter(Boolean).join(' · ');
  }

  /** Put photos i−1, i, i+1 on the three slides, centred, without animation. */
  function layout() {
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
    fill(slides[0], i - 1);
    fill(slides[1], i);
    fill(slides[2], i + 1);
    const cur = cache.get(metas[i].id);
    share.disabled = !(cur && cur.file);
    el.querySelector('.lb-nav.prev').hidden = i === 0;
    el.querySelector('.lb-nav.next').hidden = i === metas.length - 1;
    renderInfo();
    // get the neighbours ready so the next swipe is instant
    smartAt(i).then(() => { smartAt(i + 1); smartAt(i - 1); });
  }

  /** Slide to the next (+1) or previous (−1) photo. */
  function go(dir, fromPx = 0) {
    const n = i + dir;
    if (animating) return;
    if (n < 0 || n >= metas.length) { settle(fromPx); return; }
    animating = true;
    track.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(.2,.7,.3,1)`;
    track.style.transform = `translateX(${-dir * 100}%)`;
    setTimeout(() => {
      i = n;
      animating = false;
      layout();
    }, SLIDE_MS);
  }
  function settle(px) {
    if (!px) return;
    track.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(.2,.7,.3,1)`;
    track.style.transform = 'translateX(0)';
  }

  // ---------- swipe: the photos follow the finger ----------
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (animating || e.target.closest('.lb-nav') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, on: false, id: e.pointerId };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
      drag.on = true;
      try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      track.style.transition = 'none';
    }
    const atEdge = (dx > 0 && i === 0) || (dx < 0 && i === metas.length - 1);
    drag.dx = atEdge ? dx * 0.3 : dx;
    track.style.transform = `translateX(${drag.dx}px)`;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.on) return;
    const w = stage.clientWidth || 1;
    const v = d.dx / Math.max(1, performance.now() - d.t); // px per ms
    if (d.dx < -w * 0.18 || v < -0.45) go(1, d.dx);
    else if (d.dx > w * 0.18 || v > 0.45) go(-1, d.dx);
    else settle(d.dx);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  function onKey(e) {
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  }
  document.addEventListener('keydown', onKey);

  layout();
  return close;
}

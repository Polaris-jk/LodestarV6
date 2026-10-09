// Shared screen chrome: header, tab bar, toasts, bottom sheets, theme, install prompt.

import { $, $$, esc } from './util.js';
import { icon } from './icons.js';
import * as store from './store.js';

export function setHeader({ left = '', title = '', right = '' } = {}) {
  $('#tbLeft').innerHTML = left;
  $('#tbTitle').innerHTML = title;
  $('#tbRight').innerHTML = right;
}

/** Header used on the main tabs: Lodestar wordmark, project name, sun/dark switch. */
export function mainHeader() {
  const sun = document.documentElement.dataset.theme === 'sun';
  setHeader({
    title: `<a class="brand" href="#/projects" aria-label="โปรเจกต์ ${esc(store.getProject()?.name || '')} แตะเพื่อเปลี่ยนโปรเจกต์"><b>LODESTAR</b><small>${esc(store.getProject()?.name || '')}${icon('chevron', 'chev')}</small></a>`,
    right: `<button type="button" class="icon-btn" id="themeBtn" aria-label="${sun ? 'สลับเป็นโหมดมืด' : 'สลับเป็นโหมดกลางแดด'}">${icon(sun ? 'moon' : 'sun')}</button>`,
  });
  $('#themeBtn').onclick = async () => {
    const next = document.documentElement.dataset.theme === 'sun' ? 'dark' : 'sun';
    applyTheme(next);
    await store.updateSettings({ theme: next });
    mainHeader();
  };
}

export function setTabbar(visible, active) {
  const bar = $('#tabbar');
  bar.classList.toggle('hide', !visible);
  for (const a of $$('.tab', bar)) {
    const on = a.dataset.tab === active;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'sun' ? 'sun' : 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'sun' ? '#ffffff' : '#000000';
}

let toastTimer = null;
export function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/**
 * Open an overlay (bottom sheet or full-screen). Clicks on [data-close] close it.
 * Returns { el, close }.
 */
export function openOverlay(html, { cls = 'sheet-wrap', onClick, onClose } = {}) {
  const ov = $('#overlay');
  ov.className = `open ${cls}`;
  ov.innerHTML = `<div class="scrim" data-close></div>${html}`;
  const close = () => {
    ov.className = '';
    ov.innerHTML = '';
    ov.onclick = null;
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.onclick = (e) => {
    if (e.target.closest('[data-close]')) return close();
    onClick?.(e, close);
  };
  const sheet = ov.querySelector('.sheet');
  if (sheet) {
    // a close button at the top, so nobody has to scroll to the bottom to get out
    sheet.insertAdjacentHTML('afterbegin', `<button type="button" class="sheet-x" data-close aria-label="ปิด">${icon('close')}</button>`);
    dragToClose(ov, sheet, close);
  }
  return { el: ov, close };
}

/** Pull a bottom sheet down to close it (from its top, or anywhere once it is scrolled to the top). */
function dragToClose(ov, sheet, close) {
  const scrim = ov.querySelector('.scrim');
  let y0 = null, t0 = 0, dy = 0, active = false;
  const reset = (animate) => {
    sheet.style.transition = animate ? 'transform 0.22s ease-out' : '';
    sheet.style.transform = '';
    if (scrim) { scrim.style.transition = animate ? 'opacity 0.22s' : ''; scrim.style.opacity = ''; }
  };
  const finish = () => {
    if (!active) { y0 = null; return; }
    const v = dy / Math.max(1, performance.now() - t0);
    y0 = null;
    active = false;
    if (dy > 110 || (dy > 30 && v > 0.6)) {
      sheet.style.transition = 'transform 0.2s ease-in';
      sheet.style.transform = 'translateY(100%)';
      if (scrim) { scrim.style.transition = 'opacity 0.2s'; scrim.style.opacity = '0'; }
      setTimeout(close, 190);
    } else reset(true);
  };
  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { y0 = null; return; }
    y0 = e.touches[0].clientY; t0 = performance.now(); dy = 0; active = false;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    const d = e.touches[0].clientY - y0;
    if (!active) {
      if (d > 8 && sheet.scrollTop <= 0) { active = true; sheet.style.transition = 'none'; }
      else if (d < -4 || sheet.scrollTop > 0) { y0 = null; return; }
      else return;
    }
    e.preventDefault();
    dy = Math.max(0, d - 8);
    sheet.style.transform = `translateY(${dy}px)`;
    if (scrim) scrim.style.opacity = String(Math.max(0.15, 1 - dy / 400));
  }, { passive: false });
  sheet.addEventListener('touchend', finish);
  sheet.addEventListener('touchcancel', finish);
  // mouse: drag the grip
  const grip = sheet.querySelector('.sheet-grip');
  grip?.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    y0 = e.clientY; t0 = performance.now(); dy = 0; active = true; sheet.style.transition = 'none';
    const move = (ev) => { dy = Math.max(0, ev.clientY - y0); sheet.style.transform = `translateY(${dy}px)`; };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); finish(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

// Android/desktop Chrome offer an install prompt we can trigger from a button.
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  document.dispatchEvent(new CustomEvent('geo:installable'));
});
export const canPromptInstall = () => !!deferredInstall;
export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice.catch(() => null);
  deferredInstall = null;
  return choice?.outcome === 'accepted';
}

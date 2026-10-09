// GEO — boot and screen routing:
// #/gps  #/map  #/stations  #/station/<id> (read-only)  #/station/<id>/edit  #/projects  #/summary  #/settings

import * as store from './store.js';
import * as gps from './gps.js';
import { icon } from './icons.js';
import { setTabbar, toast, applyTheme } from './ui.js';
import { esc } from './util.js';
import * as gpsView from './views/gps-view.js';
import * as mapView from './views/map-view.js';
import * as stationsView from './views/stations-view.js';
import * as stationView from './views/station-view.js';
import * as stationDetail from './views/station-detail.js';
import * as summaryView from './views/summary-view.js';
import * as settingsView from './views/settings-view.js';
import * as projectsView from './views/projects-view.js';

const ROUTES = {
  gps: gpsView.render,
  map: mapView.render,
  stations: stationsView.render,
  station: stationDetail.render,
  stationEdit: stationView.render,
  summary: summaryView.render,
  settings: settingsView.render,
  projects: projectsView.render,
};
const TAB_ICONS = { gps: 'gps', map: 'map', stations: 'stations', settings: 'settings' };

let cleanup = null;
let navToken = 0;
let prevHash = '#/gps';

async function route() {
  const hash = location.hash || '#/gps';
  const [name, arg, sub] = hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const key = name === 'station' && sub === 'edit' ? 'stationEdit' : name;
  const view = ROUTES[key] ? key : 'gps';
  if (cleanup) {
    try { cleanup(); } catch (err) { console.error(err); }
    cleanup = null;
  }
  const token = ++navToken;
  const ctx = { alive: () => token === navToken, prev: prevHash };
  prevHash = hash;

  // Each screen gets a brand-new container, so event listeners from the previous screen
  // (e.g. another station's form) can never fire on this one.
  const host = document.getElementById('view');
  host.className = `view-${view}`;
  host.scrollTop = 0;
  host.replaceChildren();
  const root = document.createElement('div');
  root.className = 'view-root';
  host.appendChild(root);
  const isSub = ['station', 'stationEdit', 'projects', 'summary'].includes(view);
  setTabbar(!isSub, isSub ? '' : view);

  try {
    const c = await ROUTES[view](root, ctx, arg);
    if (typeof c === 'function') {
      if (token === navToken) cleanup = c;
      else c();
    }
  } catch (err) {
    console.error(err);
    if (token === navToken) root.innerHTML = `<div class="empty"><p>เกิดข้อผิดพลาด: ${esc(err.message)}</p></div>`;
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker:', err));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Never reload by itself — someone may be typing field notes.
    if (hadController) toast('มี Lodestar เวอร์ชันใหม่ ปิดแล้วเปิดแอปอีกครั้งเพื่อใช้งาน', 6000);
  });
}

async function boot() {
  for (const a of document.querySelectorAll('.tab')) {
    a.insertAdjacentHTML('afterbegin', icon(TAB_ICONS[a.dataset.tab]));
  }
  try {
    await store.init();
  } catch (err) {
    document.getElementById('view').innerHTML = `<div class="empty"><p>เปิดที่เก็บข้อมูลในเครื่องไม่ได้ (${esc(err.message)})</p><p>ถ้าใช้โหมด Private Browsing ให้ปิดก่อน แล้วเปิด Lodestar ใหม่</p></div>`;
    return;
  }
  await gps.init(); // last known position only; the GPS itself stays off
  applyTheme(store.getSettings().theme);
  window.addEventListener('hashchange', route);
  if (!location.hash) history.replaceState(null, '', '#/gps');
  route();
  registerServiceWorker();
}

boot();

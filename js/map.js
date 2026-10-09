// Leaflet map with geological station symbols.
// Map tiles you have viewed while online are kept for offline use by the service worker.

/* global L */
import { esc } from './util.js';
import { az3, fmtPlane, hasMeasurement } from './geomath.js';
import { lithName } from './vocab.js';
import { colorFor } from './rockcolors.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const THAILAND = [15.5, 101.2];

const firstMeas = (st) => (st.measurements || []).find((m) => hasMeasurement(m) && m.strike != null) || null;

function stationIcon(st) {
  const m = firstMeas(st);
  const lith = lithName(st);
  // pin in the rock's colour; the strike/dip symbol, when measured, is drawn over it
  let sym = `<i class="rk" style="background:${colorFor(st)}"></i>`;
  if (m) {
    const dd = ((m.dipdir ?? m.strike + 90) * Math.PI) / 180;
    const x = 15 + Math.sin(dd) * 15.5;
    const y = 15 - Math.cos(dd) * 15.5;
    sym += `<svg class="sd" viewBox="0 0 30 30" style="transform:rotate(${m.strike}deg)"><path d="M15 2.5v25M15 15h7.5"/></svg>`
      + (m.dip != null ? `<b class="sd-dip" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${Math.round(m.dip)}</b>` : '');
  }
  return L.divIcon({
    className: 'st-icon',
    html: `${sym}<span class="st-lbl">${esc(st.code)}${lith ? `<small>${esc(lith)}</small>` : ''}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

function popupHTML(st) {
  const m = firstMeas(st);
  const plane = m ? fmtPlane(m) : null;
  const lith = lithName(st);
  return `<div class="pp">
    <b>${esc(st.code)}</b>
    <span>${lith ? esc(lith) : 'No lithology yet'}</span>
    ${plane ? `<span class="mono">${plane}${m.dipdir != null ? ` → ${az3(m.dipdir)}` : ''}</span>` : ''}
    <button type="button" class="btn sm" data-open>Open station</button>
  </div>`;
}

export function createMap(el, { interactive = true } = {}) {
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    dragging: interactive,
    touchZoom: interactive,
    doubleClickZoom: interactive,
    scrollWheelZoom: interactive,
    boxZoom: false,
    keyboard: interactive,
    tap: false,
    zoomSnap: 0.25,
    fadeAnimation: false,
  }).setView(THAILAND, 6);
  map.attributionControl.setPrefix('');
  L.tileLayer(TILES, {
    maxZoom: 19,
    crossOrigin: true,
    attribution: '© OpenStreetMap',
  }).addTo(map);
  if (interactive) L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

  const stationLayer = L.layerGroup().addTo(map);
  let bounds = null;
  let me = null;
  let meAcc = null;
  let centered = false;

  return {
    map,
    setStations(list, onOpen) {
      stationLayer.clearLayers();
      const pts = [];
      for (const st of list) {
        if (!st.location) continue;
        const ll = [st.location.lat, st.location.lon];
        pts.push(ll);
        const mk = L.marker(ll, { icon: stationIcon(st), keyboard: false, riseOnHover: true });
        if (onOpen) {
          mk.bindPopup(popupHTML(st), { closeButton: false, className: 'geo-popup', autoPanPadding: [24, 24] });
          mk.on('popupopen', (e) => {
            e.popup.getElement()?.querySelector('[data-open]')?.addEventListener('click', () => onOpen(st));
          });
        }
        mk.addTo(stationLayer);
      }
      // join the stations in the order they were recorded
      const route = list.filter((st) => st.location).sort((x, y) => x.createdAt - y.createdAt)
        .map((st) => [st.location.lat, st.location.lon]);
      if (route.length > 1) {
        // smoothFactor 0: keep every station as a corner of the line
        L.polyline(route, { className: 'route-halo', interactive: false, smoothFactor: 0 }).addTo(stationLayer);
        L.polyline(route, { className: 'route-line', interactive: false, smoothFactor: 0 }).addTo(stationLayer);
      }
      bounds = pts.length ? L.latLngBounds(pts) : null;
    },
    hasStations: () => !!bounds,
    fitStations(maxZoom = 17) {
      if (bounds) map.fitBounds(bounds.pad(0.3), { maxZoom, animate: false });
    },
    /** Show the live position. `follow` keeps it centred (mini map). */
    setPosition(fix, { follow = false } = {}) {
      const ll = [fix.lat, fix.lon];
      if (!me) {
        meAcc = L.circle(ll, { radius: fix.acc || 0, className: 'me-acc', interactive: false }).addTo(map);
        me = L.circleMarker(ll, { radius: 7, className: 'me-dot', interactive: false }).addTo(map);
      } else {
        me.setLatLng(ll);
        meAcc.setLatLng(ll).setRadius(fix.acc || 0);
      }
      if (follow) {
        if (!centered) { map.setView(ll, 17, { animate: false }); centered = true; }
        else map.panTo(ll, { animate: false });
      }
    },
    centerOn(fix, zoom = 17) {
      map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), zoom), { animate: false });
    },
    invalidate() { map.invalidateSize(false); },
    destroy() { map.remove(); },
  };
}

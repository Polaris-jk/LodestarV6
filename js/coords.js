// How coordinates are shown: 6-figure grid reference first (for plotting on 1:50,000 maps), with
// UTM easting/northing smaller below it; Lat/Long when chosen.

import * as store from './store.js';
import { toUTM, gridRef } from './utm.js';
import { fmtLat, fmtLon } from './geomath.js';

export const COORD_MODES = [
  ['utm', 'Grid Ref / UTM'],
  ['dd', 'Lat/Long'],
  ['dms', 'Lat/Long DMS'],
];

export const coordMode = () => {
  const m = store.getSettings().coordFormat;
  return m === 'dd' || m === 'dms' ? m : 'utm';
};

/**
 * Rows of [label (HTML), value (text), row class] for a position in the chosen display mode.
 * UTM mode: the grid reference big, easting/northing as one smaller row.
 */
export function coordRows(fix, mode = coordMode()) {
  if (!fix) return [];
  if (mode === 'utm') {
    const u = toUTM(fix.lat, fix.lon, store.zoneLock());
    if (u) {
      const g = gridRef(u);
      return [
        [`Grid Ref<small>${u.zone}${u.band} ${g.square}</small>`, g.gr, 'gr'],
        ['UTM', `E ${Math.round(u.easting)}  N ${Math.round(u.northing)}`, 'sub'],
      ];
    }
  }
  const fmt = mode === 'dms' ? 'dms' : 'dd';
  return [
    ['Latitude', fmtLat(fix.lat, fmt)],
    ['Longitude', fmtLon(fix.lon, fmt)],
  ];
}

/** Text put on the clipboard by the copy button. */
export function coordText(fix, mode = coordMode()) {
  if (!fix) return '';
  if (mode === 'utm') {
    const u = toUTM(fix.lat, fix.lon, store.zoneLock());
    if (u) {
      const g = gridRef(u);
      return `GR ${g.gr6} (${u.zone}${u.band} ${g.square}) · E ${Math.round(u.easting)} N ${Math.round(u.northing)}`;
    }
  }
  if (mode === 'dms') return `${fmtLat(fix.lat, 'dms')} ${fmtLon(fix.lon, 'dms')}`;
  return `${fix.lat.toFixed(6)}, ${fix.lon.toFixed(6)}`;
}

/** "เมื่อ 16:49:05 (2 นาทีก่อน)" */
export function fixAge(fix, now = Date.now()) {
  if (!fix) return '';
  const t = fix.received || fix.time;
  const s = Math.max(0, Math.round((now - t) / 1000));
  const d = new Date(fix.time || t);
  const clock = d.toLocaleTimeString('en-GB', { hour12: false });
  let ago;
  if (s < 10) ago = 'เมื่อสักครู่';
  else if (s < 60) ago = `${s} วินาทีก่อน`;
  else if (s < 3600) ago = `${Math.round(s / 60)} นาทีก่อน`;
  else if (s < 86400) ago = `${Math.round(s / 3600)} ชั่วโมงก่อน`;
  else ago = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  return `เมื่อ ${clock} (${ago})`;
}

/** Rows with dashes before there is a fix, in the same layout. */
export function emptyRows(mode = coordMode()) {
  if (mode === 'utm') return [['Grid Ref<small>—</small>', '— —', 'gr'], ['UTM', 'E —  N —', 'sub']];
  return [['Latitude', '—'], ['Longitude', '—']];
}

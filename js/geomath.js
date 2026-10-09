// Angles, structural geology helpers and coordinate formatting.

export const norm360 = (d) => ((d % 360) + 360) % 360;

/** Right-hand rule: dip direction is 90° clockwise from strike. */
export const strikeToDipDir = (strike) => norm360(strike + 90);
export const dipDirToStrike = (dipDir) => norm360(dipDir - 90);

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const cardinal = (deg) => POINTS[Math.round(norm360(deg) / 22.5) % 16];

/** 45 → "045", 45.5 → "045.5" — azimuths are written with three digits. */
export function az3(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = Math.round(v * 10) / 10;
  const [i, d] = String(r).split('.');
  return i.padStart(3, '0') + (d ? '.' + d : '');
}

/** Strike/dip written the field-notebook way: 045/32. */
export function fmtPlane(m) {
  if (!m || m.strike == null || m.dip == null) return null;
  return `${az3(m.strike)}/${Math.round(m.dip * 10) / 10}`;
}

export const hasMeasurement = (m) => m && (m.strike != null || m.dip != null || m.dipdir != null);

/** Decimal degrees → 16°26'28.4"N (rounded to 0.1 arc-second). */
export function toDMS(deg, pos, neg) {
  const hemi = deg < 0 ? neg : pos;
  const tenths = Math.round(Math.abs(deg) * 36000);
  const d = Math.floor(tenths / 36000);
  const m = Math.floor((tenths % 36000) / 600);
  const s = (tenths % 600) / 10;
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${hemi}`;
}

export function fmtLat(lat, format = 'dd') {
  return format === 'dms' ? toDMS(lat, 'N', 'S') : `${lat.toFixed(6)}°`;
}
export function fmtLon(lon, format = 'dd') {
  return format === 'dms' ? toDMS(lon, 'E', 'W') : `${lon.toFixed(6)}°`;
}

/** Great-circle distance in metres. */
export function metersBetween(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** GPS accuracy class used for colours and the signal bar. */
export function accClass(acc) {
  if (acc == null || !Number.isFinite(acc)) return 'none';
  if (acc <= 5) return 'good';
  if (acc <= 15) return 'fair';
  return 'bad';
}
export function accBars(acc) {
  if (acc == null || !Number.isFinite(acc)) return 0;
  return acc <= 3 ? 5 : acc <= 5 ? 4 : acc <= 10 ? 3 : acc <= 20 ? 2 : acc <= 50 ? 1 : 0;
}
export const fmtAcc = (acc) => (acc == null ? '—' : acc < 10 ? acc.toFixed(1) : String(Math.round(acc)));

// WGS84 latitude/longitude → UTM, using the Krüger series (Karney 2011, 6th order).
// Accurate to well under a millimetre inside a zone, so it matches QGIS/PROJ output.

const a = 6378137;
const f = 1 / 298.257223563;
const k0 = 0.9996;
const n = f / (2 - f);
const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
const e = Math.sqrt(f * (2 - f));
const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
const ALPHA = [
  0,
  n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
  (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
  (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
  (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
  (212378941 * n6) / 319334400,
];
const BANDS = 'CDEFGHJKLMNPQRSTUVWXX';

const normLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

export function utmZone(lat, lon) {
  const L = normLon(lon);
  let zone = Math.floor((L + 180) / 6) + 1;
  if (zone > 60) zone = 60;
  if (lat >= 56 && lat < 64 && L >= 3 && L < 12) zone = 32; // Norway
  if (lat >= 72 && lat <= 84 && L >= 0 && L < 42) zone = L < 9 ? 31 : L < 21 ? 33 : L < 33 ? 35 : 37; // Svalbard
  return zone;
}

export function utmBand(lat) {
  if (lat < -80 || lat > 84) return null;
  return BANDS[Math.min(20, Math.floor((lat + 80) / 8))];
}

/**
 * @param {number} lat  degrees
 * @param {number} lon  degrees
 * @param {number} [forceZone] lock to a zone (e.g. a project that straddles 47/48)
 */
export function toUTM(lat, lon, forceZone) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -80 || lat > 84) return null;
  const zone = forceZone || utmZone(lat, lon);
  const lon0 = (zone - 1) * 6 - 180 + 3;
  const phi = (lat * Math.PI) / 180;
  const lam = (normLon(lon - lon0) * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sinPhi) - e * Math.atanh(e * sinPhi));
  const xiP = Math.atan2(t, Math.cos(lam));
  const etaP = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 6; j++) {
    xi += ALPHA[j] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += ALPHA[j] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  const easting = 500000 + k0 * A * eta;
  let northing = k0 * A * xi;
  if (lat < 0) northing += 10000000;
  return {
    zone,
    band: utmBand(lat),
    hemisphere: lat < 0 ? 'S' : 'N',
    easting,
    northing,
    epsg: (lat < 0 ? 32700 : 32600) + zone,
  };
}

export const utmZoneLabel = (u) => (u ? `${u.zone}${u.band}` : '');
export const utmText = (u) => (u ? `${u.zone}${u.band} ${Math.round(u.easting)} E ${Math.round(u.northing)} N` : '');

// ---------- Grid reference (MGRS letters + 6-figure GR, as printed on 1:50,000 topographic maps) ----------
const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

/**
 * Grid reference from a toUTM() result. Digits are truncated, like reading a map: the 6-figure GR
 * names the 100 m square the point is in.
 * @returns {{square: string, gr: string, gr6: string, mgrs: string}}  e.g. square 'TD', gr '688 189',
 *   gr6 '688189', mgrs '48QTD6885318979' (1 m)
 */
export function gridRef(u) {
  if (!u) return null;
  const e = Math.floor(u.easting);
  const n = Math.floor(u.northing);
  const col = COL_SETS[(u.zone - 1) % 3][Math.floor(e / 100000) - 1] || '?';
  const row = ROW_LETTERS[(Math.floor(n / 100000) + (u.zone % 2 === 0 ? 5 : 0)) % 20];
  const e5 = String(e % 100000).padStart(5, '0');
  const n5 = String(n % 100000).padStart(5, '0');
  return {
    square: col + row,
    gr: `${e5.slice(0, 3)} ${n5.slice(0, 3)}`,
    gr6: e5.slice(0, 3) + n5.slice(0, 3),
    mgrs: `${u.zone}${u.band}${col}${row}${e5}${n5}`,
  };
}

// Draws the project summary as a portrait image (Instagram post 4:5 or story 9:16):
// every station joined in the order it was recorded, the time at each station, total time
// from first to last, a UTM grid, north arrow and scale bar. The map is zoomed — and turned
// if that fills the frame better — to fit the stations. Optional OpenStreetMap background.

import { toUTM } from './utm.js';
import { metersBetween, hasMeasurement } from './geomath.js';
import { lithName } from './vocab.js';
import { pad } from './util.js';
import { roundRect, wrap, loadFonts, SANS, MONO } from './draw.js';

const R = 6378137;
const D2R = Math.PI / 180;
const TILES = 'https://tile.openstreetmap.org';

export const FORMATS = { post: [1080, 1350], story: [1080, 1920] };

const THEMES = {
  dark: {
    bg: '#000000', mapBg: '#121516', text: '#ecebe3', text2: '#a8aaa3', text3: '#74776f',
    accent: '#f5c933', halo: 'rgba(0,0,0,0.9)', grid: 'rgba(236,235,227,0.13)', gridText: 'rgba(236,235,227,0.55)',
    veil: 'rgba(0,0,0,0.5)', labelBg: 'rgba(0,0,0,0.74)', labelText: '#ffffff', ring: '#000000', frame: 'rgba(236,235,227,0.16)',
    timeText: '#f5c933', dipText: '#f5c933', leader: 'rgba(255,255,255,0.75)',
  },
  light: {
    bg: '#ffffff', mapBg: '#eeede7', text: '#0b0b0b', text2: '#3b3b37', text3: '#6c6c65',
    accent: '#f5c933', halo: 'rgba(0,0,0,0.92)', grid: 'rgba(0,0,0,0.12)', gridText: 'rgba(0,0,0,0.55)',
    veil: 'rgba(255,255,255,0.22)', labelBg: 'rgba(255,255,255,0.92)', labelText: '#000000', ring: '#000000', frame: 'rgba(0,0,0,0.18)',
    timeText: '#7a5c00', dipText: '#f5c933', leader: 'rgba(0,0,0,0.7)', // dip numbers sit on a dark halo in both themes
  },
};

const merc = (lat, lon) => ({ x: R * lon * D2R, y: R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)) });
const unmerc = (x, y) => ({ lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / D2R, lon: x / R / D2R });

const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (t) => { const d = new Date(t); return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export function duration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${pad(min % 60)}m`;
}
const distText = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

function loadImage(url, ms = 8000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => { img.src = ''; resolve(null); }, ms);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = url;
  });
}

const NICE = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];

/**
 * @param {{project, stations, format?: 'post'|'story', theme?: 'dark'|'light', basemap?: boolean, rotate?: boolean, zoneLock?: number}} o
 */
export async function renderSummary(o) {
  const { project, format = 'post', theme = 'dark', basemap = true, rotate = true, zoneLock } = o;
  const C = THEMES[theme] || THEMES.dark;
  const [W, H] = FORMATS[format] || FORMATS.post;
  const story = format === 'story';

  const stations = o.stations.filter((s) => s.location).sort((a, b) => a.createdAt - b.createdAt);
  if (!stations.length) throw new Error('ไม่มี Station ที่มีพิกัดในโปรเจกต์นี้');

  await loadFonts();

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // ---------- numbers ----------
  const first = stations[0].createdAt;
  const last = stations[stations.length - 1].createdAt;
  let dist = 0;
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1].location, b = stations[i].location;
    dist += metersBetween(a.lat, a.lon, b.lat, b.lon);
  }
  const liths = [...new Set(stations.map(lithName).filter(Boolean))];

  // ---------- header ----------
  const P = 64;
  let y = story ? 170 : 72;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text;
  ctx.font = `600 ${story ? 66 : 60}px ${SANS}`;
  const titleLines = wrap(ctx, project.name, W - 2 * P, 2);
  const lh = story ? 78 : 70;
  for (const line of titleLines) { y += lh; ctx.fillText(line, P, y - 14); }
  ctx.font = `400 ${story ? 30 : 28}px ${SANS}`;
  ctx.fillStyle = C.text2;
  const when = sameDay(first, last) ? `${day(first)}   ${clock(first)}–${clock(last)}` : `${day(first)} – ${day(last)}`;
  y += 34;
  ctx.fillText(when, P, y);
  const headerBottom = y + 30;

  // ---------- footer layout (drawn later) ----------
  const footerH = story ? 470 : 300;
  const mapRect = { x: P, y: headerBottom, w: W - 2 * P, h: H - footerH - headerBottom };

  // ---------- fit the stations in the map frame ----------
  const pts = stations.map((s) => { const m = merc(s.location.lat, s.location.lon); return { s, ux: m.x, uy: -m.y }; });
  const lat0 = stations.reduce((a, s) => a + s.location.lat, 0) / stations.length;
  const cosLat = Math.cos(lat0 * D2R);
  const pad2 = { l: 70, r: 150, t: 80, b: 110 }; // room for labels, north arrow and scale bar
  const availW = mapRect.w - pad2.l - pad2.r;
  const availH = mapRect.h - pad2.t - pad2.b;
  const sMax = cosLat / 0.7; // never closer than 0.7 m per pixel
  let best = null;
  const angles = rotate ? Array.from({ length: 91 }, (_, i) => -90 + i * 2) : [0];
  for (const deg of angles) {
    const th = deg * D2R, c = Math.cos(th), sn = Math.sin(th);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      const rx = c * p.ux - sn * p.uy, ry = sn * p.ux + c * p.uy;
      x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, ry); y1 = Math.max(y1, ry);
    }
    const s = Math.min(sMax, availW / Math.max(x1 - x0, 1e-9), availH / Math.max(y1 - y0, 1e-9));
    const score = s * (1 - 0.18 * (Math.abs(deg) / 90)); // keep north up unless turning clearly helps
    if (!best || score > best.score + 1e-12) best = { deg, th, c, sn, s, rcx: (x0 + x1) / 2, rcy: (y0 + y1) / 2, score };
  }
  const { th, c: cosT, sn: sinT, s, rcx, rcy } = best;
  const cx = mapRect.x + pad2.l + availW / 2;
  const cy = mapRect.y + pad2.t + availH / 2;
  const toCanvas = (ux, uy) => {
    const rx = cosT * ux - sinT * uy, ry = sinT * ux + cosT * uy;
    return [cx + s * (rx - rcx), cy + s * (ry - rcy)];
  };
  const toMerc = (X, Y) => {
    const rx = (X - cx) / s + rcx, ry = (Y - cy) / s + rcy;
    const ux = cosT * rx + sinT * ry, uy = -sinT * rx + cosT * ry;
    return { x: ux, y: -uy };
  };

  // ---------- map frame ----------
  ctx.save();
  roundRect(ctx, mapRect.x, mapRect.y, mapRect.w, mapRect.h, 30);
  ctx.fillStyle = C.mapBg;
  ctx.fill();
  ctx.clip();

  let tilesDrawn = 0;
  if (basemap) {
    const corners = [[mapRect.x, mapRect.y], [mapRect.x + mapRect.w, mapRect.y], [mapRect.x, mapRect.y + mapRect.h], [mapRect.x + mapRect.w, mapRect.y + mapRect.h]].map(([X, Y]) => toMerc(X, Y));
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    let z = Math.min(19, Math.max(2, Math.floor(Math.log2((s * 2 * Math.PI * R) / 256) + 0.7)));
    let range;
    for (;;) {
      const n = 2 ** z, T = (2 * Math.PI * R) / n;
      const tx0 = Math.floor((Math.min(...xs) + Math.PI * R) / T), tx1 = Math.floor((Math.max(...xs) + Math.PI * R) / T);
      const ty0 = Math.floor((Math.PI * R - Math.max(...ys)) / T), ty1 = Math.floor((Math.PI * R - Math.min(...ys)) / T);
      range = { n, T, tx0, tx1, ty0: Math.max(0, ty0), ty1: Math.min(n - 1, ty1) };
      if ((tx1 - tx0 + 1) * (range.ty1 - range.ty0 + 1) <= 90 || z <= 2) break;
      z -= 1;
    }
    const jobs = [];
    for (let tx = range.tx0; tx <= range.tx1; tx++) {
      for (let ty = range.ty0; ty <= range.ty1; ty++) {
        const wx = ((tx % range.n) + range.n) % range.n;
        jobs.push(loadImage(`${TILES}/${z}/${wx}/${ty}.png`).then((img) => ({ img, tx, ty })));
      }
    }
    const tiles = await Promise.all(jobs);
    const k = range.T / 256;
    for (const { img, tx, ty } of tiles) {
      if (!img) continue;
      const x0 = -Math.PI * R + tx * range.T;
      const yTop = Math.PI * R - ty * range.T;
      // tile pixel (px, py) → mercator (x0 + k·px, yTop − k·py) → canvas
      ctx.setTransform(
        s * k * cosT, s * k * sinT, -s * k * sinT, s * k * cosT,
        cx + s * (cosT * x0 + sinT * yTop - rcx),
        cy + s * (sinT * x0 - cosT * yTop - rcy),
      );
      ctx.drawImage(img, -0.4, -0.4, 256.8, 256.8);
      tilesDrawn += 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (tilesDrawn) {
      ctx.fillStyle = C.veil;
      ctx.fillRect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
    }
  }

  // Map furniture that labels must not cover: north arrow (top right), scale bar (bottom left),
  // OpenStreetMap credit (bottom right).
  const furniture = [
    { x: mapRect.x + mapRect.w - 92, y: mapRect.y + 12, w: 80, h: 80 },
    { x: mapRect.x + 10, y: mapRect.y + mapRect.h - 84, w: Math.min(mapRect.w * 0.3 + 40, 360), h: 76 },
    ...(basemap ? [{ x: mapRect.x + mapRect.w - 300, y: mapRect.y + mapRect.h - 44, w: 290, h: 36 }] : []),
  ];
  const hit = (b, list) => list.some((o2) => b.x < o2.x + o2.w && b.x + b.w > o2.x && b.y < o2.y + o2.h && b.y + b.h > o2.y);
  const gridBoxes = [];

  // ---------- UTM grid (affine fit of mercator → UTM over the frame) ----------
  const zone = zoneLock || toUTM(stations[0].location.lat, stations[0].location.lon)?.zone;
  const samples = [];
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
    const m = toMerc(mapRect.x + (mapRect.w * i) / 2, mapRect.y + (mapRect.h * j) / 2);
    const g = unmerc(m.x, m.y);
    const u = toUTM(g.lat, g.lon, zone);
    if (u) samples.push({ x: m.x, y: m.y, e: u.easting, n: u.northing });
  }
  if (samples.length >= 3) {
    // least squares: [x y 1]·[a b c]ᵀ = E (and N)
    const fit = (key) => {
      let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0, sxv = 0, syv = 0, sv = 0;
      const mx = samples.reduce((a, p) => a + p.x, 0) / samples.length, my = samples.reduce((a, p) => a + p.y, 0) / samples.length;
      for (const p of samples) {
        const x = p.x - mx, yy = p.y - my, v = p[key];
        sxx += x * x; sxy += x * yy; syy += yy * yy; sx += x; sy += yy; n += 1; sxv += x * v; syv += yy * v; sv += v;
      }
      // centred data: sx = sy = 0
      const det = sxx * syy - sxy * sxy;
      const a = (sxv * syy - syv * sxy) / det;
      const b = (syv * sxx - sxv * sxy) / det;
      const c = sv / n - a * mx - b * my;
      return [a, b, c];
    };
    const [ea, eb, ec] = fit('e');
    const [na, nb, nc] = fit('n');
    const det = ea * nb - eb * na;
    const toM = (E, N) => { const e = E - ec, n2 = N - nc; return { x: (nb * e - eb * n2) / det, y: (-na * e + ea * n2) / det }; };
    const es = samples.map((p) => p.e), ns = samples.map((p) => p.n);
    const eMin = Math.min(...es), eMax = Math.max(...es), nMin = Math.min(...ns), nMax = Math.max(...ns);
    const span = Math.min(eMax - eMin, nMax - nMin);
    const step = NICE.find((v) => span / v <= 5) || 100000;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.grid;
    ctx.font = `400 17px ${MONO}`;
    const labels = [];
    const line = (E1, N1, E2, N2, text) => {
      const a = toM(E1, N1), b = toM(E2, N2);
      const [x1, y1] = toCanvas(a.x, -a.y), [x2, y2] = toCanvas(b.x, -b.y);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // label where the line enters the frame, top or left edge first
      const hits = [];
      const R0 = mapRect;
      const seg = (t) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
      const tryEdge = (t) => { if (t >= 0 && t <= 1) { const [hx, hy] = seg(t); if (hx >= R0.x - 1 && hx <= R0.x + R0.w + 1 && hy >= R0.y - 1 && hy <= R0.y + R0.h + 1) hits.push([hx, hy]); } };
      if (y2 !== y1) { tryEdge((R0.y - y1) / (y2 - y1)); tryEdge((R0.y + R0.h - y1) / (y2 - y1)); }
      if (x2 !== x1) { tryEdge((R0.x - x1) / (x2 - x1)); tryEdge((R0.x + R0.w - x1) / (x2 - x1)); }
      hits.sort((p, q) => (p[1] - q[1]) || (p[0] - q[0]));
      if (hits.length) labels.push([hits[0], text]);
    };
    const pad3 = step * 2;
    for (let E = Math.ceil(eMin / step) * step; E <= eMax; E += step) line(E, nMin - pad3, E, nMax + pad3, `${Math.round(E)}E`);
    for (let N = Math.ceil(nMin / step) * step; N <= nMax; N += step) line(eMin - pad3, N, eMax + pad3, N, `${Math.round(N)}N`);
    ctx.fillStyle = C.gridText;
    ctx.textBaseline = 'top';
    const placed = [...furniture];
    for (const [[hx, hy], text] of labels) {
      const w = ctx.measureText(text).width;
      const lx = Math.min(Math.max(hx + 6, mapRect.x + 8), mapRect.x + mapRect.w - w - 8);
      const ly = Math.min(Math.max(hy + 6, mapRect.y + 8), mapRect.y + mapRect.h - 26);
      const box = { x: lx - 4, y: ly - 2, w: w + 8, h: 22 };
      if (hit(box, placed)) continue;
      placed.push(box);
      gridBoxes.push(box);
      ctx.fillText(text, lx, ly);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ---------- route in recorded order ----------
  const cpts = pts.map((p) => { const [X, Y] = toCanvas(p.ux, p.uy); return { ...p, X, Y }; });
  if (cpts.length > 1) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    cpts.forEach((p, i) => (i ? ctx.lineTo(p.X, p.Y) : ctx.moveTo(p.X, p.Y)));
    ctx.strokeStyle = C.halo;
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 5.5;
    ctx.stroke();
    // direction arrows half way along longer legs
    for (let i = 1; i < cpts.length; i++) {
      const a = cpts[i - 1], b = cpts[i];
      const len = Math.hypot(b.X - a.X, b.Y - a.Y);
      if (len < 90) continue;
      const mx = (a.X + b.X) / 2, my = (a.Y + b.Y) / 2, ang = Math.atan2(b.Y - a.Y, b.X - a.X);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(11, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath();
      ctx.fillStyle = C.accent; ctx.strokeStyle = C.halo; ctx.lineWidth = 3;
      ctx.stroke(); ctx.fill();
      ctx.restore();
    }
  }

  // ---------- stations ----------
  // Everything a label should keep clear of, weighted by how bad it is to cover it.
  const obstacles = [
    ...furniture.map((b) => ({ ...b, wt: 1000 })),
    ...gridBoxes.map((b) => ({ ...b, wt: 0.5 })),
    ...cpts.map((p) => ({ x: p.X - 22, y: p.Y - 22, w: 44, h: 44, wt: 60 })),
  ];
  const dot = (x, y, r, wt) => obstacles.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r, wt });
  for (let i = 1; i < cpts.length; i++) { // the route, sampled every ~12 px
    const a = cpts[i - 1], b = cpts[i];
    const n = Math.ceil(Math.hypot(b.X - a.X, b.Y - a.Y) / 12);
    for (let k = 1; k < n; k++) dot(a.X + ((b.X - a.X) * k) / n, a.Y + ((b.Y - a.Y) * k) / n, 6, 2);
  }
  const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inside = (b) => b.x >= mapRect.x + 8 && b.y >= mapRect.y + 8 && b.x + b.w <= mapRect.x + mapRect.w - 8 && b.y + b.h <= mapRect.y + mapRect.h - 8;
  /** Best spot for a w×h label next to point p: 8 directions, close or a little further out (with a leader line). */
  const placeLabel = (p, w, h) => {
    let pick = null;
    for (const [ring, d] of [[0, 0], [1, 36]]) {
      const e = d * 0.7;
      [
        [p.X + 30 + d, p.Y - h / 2], [p.X - 30 - d - w, p.Y - h / 2],
        [p.X - w / 2, p.Y - 34 - d - h], [p.X - w / 2, p.Y + 34 + d],
        [p.X + 26 + e, p.Y - h - 14 - e], [p.X + 26 + e, p.Y + 14 + e],
        [p.X - 26 - e - w, p.Y - h - 14 - e], [p.X - 26 - e - w, p.Y + 14 + e],
      ].forEach(([x, yy], i) => {
        const b = { x, y: yy, w, h, ring };
        let cost = (inside(b) ? 0 : 1e9) + ring * 250 + i;
        for (const o of obstacles) cost += overlapArea(b, o) * o.wt;
        if (!pick || cost < pick.cost) pick = { ...b, cost };
      });
    }
    return pick;
  };

  for (const p of cpts) {
    const m = (p.s.measurements || []).find((x) => hasMeasurement(x) && x.strike != null);
    if (m) {
      const a = (m.strike + best.deg) * D2R;
      const dx = Math.sin(a), dy = -Math.cos(a); // along strike on canvas
      const tx = Math.cos(a), ty = Math.sin(a); // towards dip direction (90° clockwise)
      const L = 26, T = 15;
      for (const [col, w] of [[C.halo, 11], [C.accent, 5]]) {
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.X - dx * L, p.Y - dy * L); ctx.lineTo(p.X + dx * L, p.Y + dy * L);
        ctx.moveTo(p.X, p.Y); ctx.lineTo(p.X + tx * T, p.Y + ty * T);
        ctx.stroke();
      }
      for (let k = -L; k <= L; k += 8) dot(p.X + dx * k, p.Y + dy * k, 7, 20);
      dot(p.X + tx * T, p.Y + ty * T, 7, 20);
      if (m.dip != null) {
        ctx.font = `500 21px ${MONO}`;
        const txt = String(Math.round(m.dip));
        const w = ctx.measureText(txt).width;
        const lx = p.X + tx * (T + 18) - w / 2, ly = p.Y + ty * (T + 18) + 7;
        ctx.lineWidth = 6; ctx.strokeStyle = C.halo; ctx.strokeText(txt, lx, ly);
        ctx.fillStyle = C.dipText; ctx.fillText(txt, lx, ly);
        obstacles.push({ x: lx - 4, y: ly - 20, w: w + 8, h: 26, wt: 30 });
      }
    } else {
      ctx.beginPath();
      ctx.arc(p.X, p.Y, 12, 0, Math.PI * 2);
      ctx.fillStyle = C.accent; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = C.ring; ctx.stroke();
    }
  }

  // labels: code + recorded time, placed where they don't collide
  for (const [i, p] of cpts.entries()) {
    const code = p.s.code;
    const time = clock(p.s.createdAt);
    ctx.font = `500 22px ${MONO}`;
    const w = Math.max(ctx.measureText(code).width, ctx.measureText(time).width) + 22;
    const h = 62;
    const box = placeLabel(p, w, h);
    obstacles.push({ ...box, wt: 200 });
    if (box.ring) {
      // leader line from just outside the symbol to the nearest edge of the label
      const qx = Math.max(box.x, Math.min(p.X, box.x + box.w)), qy = Math.max(box.y, Math.min(p.Y, box.y + box.h));
      const len = Math.hypot(qx - p.X, qy - p.Y) || 1;
      ctx.beginPath();
      ctx.moveTo(p.X + ((qx - p.X) / len) * 20, p.Y + ((qy - p.Y) / len) * 20);
      ctx.lineTo(qx, qy);
      ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = C.leader; ctx.stroke();
    }
    roundRect(ctx, box.x, box.y, box.w, box.h, 10);
    ctx.fillStyle = C.labelBg; ctx.fill();
    if (i === 0 || i === cpts.length - 1) { ctx.lineWidth = 2; ctx.strokeStyle = C.accent; ctx.stroke(); }
    ctx.fillStyle = C.labelText;
    ctx.fillText(code, box.x + 11, box.y + 26);
    ctx.fillStyle = C.timeText;
    ctx.font = `400 22px ${MONO}`;
    ctx.fillText(time, box.x + 11, box.y + 53);
  }

  // ---------- north arrow ----------
  {
    const ax = mapRect.x + mapRect.w - 52, ay = mapRect.y + 52;
    ctx.beginPath(); ctx.arc(ax, ay, 32, 0, Math.PI * 2);
    ctx.fillStyle = C.labelBg; ctx.fill();
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(th);
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(9, 6); ctx.lineTo(0, 1); ctx.lineTo(-9, 6); ctx.closePath();
    ctx.fillStyle = C.accent; ctx.fill();
    ctx.font = `600 17px ${SANS}`;
    ctx.fillStyle = C.labelText;
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, 22);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // ---------- scale bar ----------
  {
    const pxPerGroundM = s / cosLat;
    const maxPx = mapRect.w * 0.3;
    const len = [...NICE].reverse().find((v) => v * pxPerGroundM <= maxPx) || NICE[0];
    const px = len * pxPerGroundM;
    const bx = mapRect.x + 26, by = mapRect.y + mapRect.h - 34;
    roundRect(ctx, bx - 12, by - 40, px + 24, 56, 10);
    ctx.fillStyle = C.labelBg; ctx.fill();
    ctx.fillStyle = C.labelText;
    ctx.fillRect(bx, by - 4, px, 6);
    ctx.fillRect(bx, by - 12, 3, 14);
    ctx.fillRect(bx + px - 3, by - 12, 3, 14);
    ctx.font = `500 18px ${MONO}`;
    ctx.fillText(distText(len), bx, by - 18);
  }

  if (tilesDrawn) {
    ctx.font = `400 15px ${SANS}`;
    const txt = '© OpenStreetMap contributors';
    const w = ctx.measureText(txt).width;
    roundRect(ctx, mapRect.x + mapRect.w - w - 30, mapRect.y + mapRect.h - 36, w + 16, 26, 8);
    ctx.fillStyle = C.labelBg; ctx.fill();
    ctx.fillStyle = C.labelText;
    ctx.fillText(txt, mapRect.x + mapRect.w - w - 22, mapRect.y + mapRect.h - 17);
  }
  ctx.restore();

  // frame line
  roundRect(ctx, mapRect.x + 0.5, mapRect.y + 0.5, mapRect.w - 1, mapRect.h - 1, 30);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = C.frame;
  ctx.stroke();

  // ---------- footer: totals ----------
  const fy = mapRect.y + mapRect.h + (story ? 70 : 54);
  const stats = [
    [stations.length > 1 ? duration(last - first) : '—', 'เวลาเก็บข้อมูล'],
    [String(stations.length), 'Stations'],
    [stations.length > 1 ? distText(dist) : '—', 'ระยะระหว่างจุด'],
  ];
  const colW = (W - 2 * P) / 3;
  stats.forEach(([v, label], i) => {
    const x = P + i * colW;
    ctx.fillStyle = i === 0 ? C.accent : C.text;
    ctx.font = `600 ${story ? 60 : 52}px ${SANS}`;
    ctx.fillText(v, x, fy + (story ? 52 : 46));
    ctx.fillStyle = C.text3;
    ctx.font = `400 ${story ? 26 : 23}px ${SANS}`;
    ctx.fillText(label, x, fy + (story ? 92 : 80));
  });
  ctx.font = `400 ${story ? 25 : 22}px ${SANS}`;
  ctx.fillStyle = C.text2;
  if (liths.length) {
    const lithLine = wrap(ctx, liths.join('  /  '), W - 2 * P, 1)[0];
    ctx.fillText(lithLine, P, fy + (story ? 150 : 128));
  }
  ctx.fillStyle = C.text3;
  ctx.font = `500 ${story ? 22 : 20}px ${MONO}`;
  ctx.fillText('Lodestar · Geotechnology KKU', P, H - (story ? 200 : 40));

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  return {
    blob,
    width: W,
    height: H,
    rotation: best.deg,
    tilesDrawn,
    stats: { count: stations.length, durationMs: last - first, distance: dist },
  };
}

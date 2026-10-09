// Smart Photo: the photo with an information strip added below it (the picture itself is not
// covered or changed), so the file still says where and when it was taken and what was measured
// after it leaves the app. The original photo in Lodestar stays untouched.

import { toUTM, gridRef } from './utm.js';
import { lithInfo, lithName } from './vocab.js';
import { az3, cardinal, hasMeasurement, fmtAcc } from './geomath.js';
import { fmtDay, pad } from './util.js';
import { loadFonts, SANS, MONO } from './draw.js';

const C = { bg: '#0b0b0b', text: '#f2f1ea', label: '#8f928a', dim: '#6f726b', accent: '#f5c933', ring: '#3a3e3f' };
const MAX_PIXELS = 16e6; // iPhone Safari refuses larger canvases

function loadPhoto(data, type) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([data], { type: type || 'image/jpeg' }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')); };
    img.src = url;
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-06 10:42:05" (camera local time) → "06 Oct 2026 10:42" */
function fmtTaken(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s || '');
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]} ${m[4]}:${m[5]}` : null;
}
const fmtWhen = (meta) => fmtTaken(meta.taken) || (() => {
  const d = new Date(meta.createdAt);
  return `${fmtDay(meta.createdAt)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
})();

/** The rows of the strip as [label, value] items. Also used for tests and plain-text captions. */
/** Version of the strip layout; Smart Photos kept from an older layout are redrawn. */
export const SMART_LAYOUT = 6;

export function stripContent({ st, project, meta, index, total, zoneLock, collector }) {
  const lith = lithName(st);
  const info = lithInfo(lith);
  const L = st.location;
  const rows = [];
  // the large first line: grid reference (what students plot on the 1:50,000 map) and the
  // direction the photo looks
  const big = [];
  rows.push({ big: true, items: big });
  if (L) {
    const u = toUTM(L.lat, L.lon, zoneLock);
    const g = gridRef(u);
    // the 6-figure grid reference first and larger: what students plot on the 1:50,000 map
    if (g) big.push(['Grid Ref', g.gr, 'gr'], ['', `${u.zone}${u.band} ${g.square}`, 'sq']);
    const loc = [];
    if (u) loc.push([`UTM ${u.zone}${u.band}`, `E ${Math.round(u.easting)}  N ${Math.round(u.northing)}`]);
    loc.push(['', `${Math.abs(L.lat).toFixed(6)}°${L.lat >= 0 ? 'N' : 'S'} ${Math.abs(L.lon).toFixed(6)}°${L.lon >= 0 ? 'E' : 'W'}`]);
    if (L.alt != null) loc.push(['Elev.', `${Math.round(L.alt)} m`]);
    if (L.acc != null) loc.push(['±', `${fmtAcc(L.acc)} m`]);
    rows.push({ items: loc });
  } else {
    rows.push({ items: [['', 'Station นี้ยังไม่มีพิกัด']] });
  }
  const obs = [];
  const bearingText = meta.bearing != null ? `${meta.bearingSrc === 'auto' ? '≈' : ''}${az3(Math.round(meta.bearing) % 360)}° ${cardinal(meta.bearing)}` : null;
  const meas = (st.measurements || []).filter(hasMeasurement);
  for (const m of meas.slice(0, 3)) {
    const plane = m.strike != null && m.dip != null ? `${az3(Math.round(m.strike) % 360)}°/${Math.round(m.dip)}°` : m.dip != null ? `Dip ${Math.round(m.dip)}°` : '—';
    obs.push([m.type || 'Plane', plane]);
  }
  if (meas.length > 3) obs.push(['', `+${meas.length - 3}`]);
  if (obs.length) rows.push({ items: obs });
  if (!big.length) rows.shift();
  const foot = [fmtWhen(meta), project?.name, total > 1 ? `Photo ${index + 1}/${total}` : null, collector || st.collector].filter(Boolean).join('  ·  ');
  return {
    code: st.code,
    lith: lith || '',
    lithTh: info && info.th !== lith ? info.th : '',
    rows,
    foot,
    plane: meas.find((m) => m.strike != null && m.dip != null) || null,
    bearing: meta.bearing,
    bearingText,
  };
}

/** Place items left to right, wrapping to new lines; returns lines of positioned runs. */
function flow(ctx, items, maxW, fonts, gap) {
  const lines = [[]];
  let x = 0;
  for (const [label, value, kind] of items) {
    ctx.font = fonts.label;
    const lw = label ? ctx.measureText(label + ' ').width : 0;
    ctx.font = (kind && fonts[kind]) || fonts.value;
    const vw = ctx.measureText(value).width;
    const w = lw + vw;
    // the 100 km square sits right after the grid reference
    const g = kind === 'sq' ? gap * 0.45 : gap;
    if (x > 0 && x + g + w > maxW) { lines.push([]); x = 0; }
    const start = x > 0 ? x + g : 0;
    lines[lines.length - 1].push({ x: start, label, value, lw, kind });
    x = start + w;
  }
  return lines;
}

/**
 * The direction the photo looks, as a yellow badge ending at xRight on the first line:
 * an arrow turned to the bearing, then e.g. "200° SSW". Returns its width.
 */
function bearingPill(ctx, xRight, yBase, headF, text, bearing, f) {
  ctx.save();
  const h = Math.round(headF * 1.22);
  const top = yBase - headF * 0.98;
  ctx.font = `700 ${Math.round(headF * 0.8)}px ${MONO}`;
  const tw = ctx.measureText(text).width;
  const a = h * 0.66; // arrow box
  const pad = f * 0.55;
  const w = pad + a + f * 0.4 + tw + pad;
  const x = xRight - w;
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, top);
  ctx.arcTo(x + w, top, x + w, top + h, r);
  ctx.arcTo(x + w, top + h, x, top + h, r);
  ctx.arcTo(x, top + h, x, top, r);
  ctx.arcTo(x, top, x + w, top, r);
  ctx.closePath();
  ctx.fillStyle = C.accent;
  ctx.fill();
  // arrow pointing to the bearing (north up)
  const cx = x + pad + a / 2, cy = top + h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(((bearing || 0) * Math.PI) / 180);
  // a thin ring, then an arrow with a shaft — unmistakable even when small
  ctx.strokeStyle = 'rgba(26, 21, 0, 0.35)';
  ctx.lineWidth = Math.max(1, a * 0.07);
  ctx.beginPath();
  ctx.arc(0, 0, a * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#1a1500';
  ctx.lineWidth = Math.max(1.5, a * 0.13);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, a * 0.42);
  ctx.lineTo(0, -a * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -a * 0.5);
  ctx.lineTo(a * 0.26, -a * 0.06);
  ctx.lineTo(-a * 0.26, -a * 0.06);
  ctx.closePath();
  ctx.fillStyle = '#1a1500';
  ctx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1a1500';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + pad + a + f * 0.4, top + h / 2 + headF * 0.03);
  ctx.restore();
  return w;
}

function drawDial(ctx, cx, cy, r, plane, bearing, f) {
  ctx.save();
  ctx.lineCap = 'round';
  // camera view: a soft wedge towards the bearing
  if (bearing != null) {
    const a = ((bearing - 90) * Math.PI) / 180;
    const half = (24 * Math.PI) / 180;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.38)');
    g.addColorStop(1, 'rgba(255,255,255,0.04)');
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r * 0.97, a - half, a + half);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, f * 0.06);
  ctx.strokeStyle = C.ring;
  ctx.stroke();
  for (let d = 0; d < 360; d += 30) {
    const a = (d * Math.PI) / 180;
    const major = d % 90 === 0;
    const r2 = r * (major ? 0.8 : 0.88);
    ctx.beginPath();
    ctx.moveTo(cx + r * Math.sin(a), cy - r * Math.cos(a));
    ctx.lineTo(cx + r2 * Math.sin(a), cy - r2 * Math.cos(a));
    ctx.lineWidth = Math.max(1.2, f * (major ? 0.07 : 0.045));
    ctx.strokeStyle = major ? C.label : C.ring;
    ctx.stroke();
  }
  // north: a small triangle on the ring with N above it, outside the dial
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r - f * 0.42);
  ctx.lineTo(cx + f * 0.26, cy - r + f * 0.02);
  ctx.lineTo(cx - f * 0.26, cy - r + f * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.font = `600 ${Math.round(f * 0.62)}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('N', cx, cy - r - f * 0.55);
  ctx.textBaseline = 'middle';
  if (plane) {
    const s = (plane.strike * Math.PI) / 180;
    const dx = Math.sin(s), dy = -Math.cos(s);
    const tx = Math.cos(s), ty = Math.sin(s); // towards the dip direction
    const L = r * 0.62, T = r * 0.26;
    ctx.beginPath();
    ctx.moveTo(cx - dx * L, cy - dy * L); ctx.lineTo(cx + dx * L, cy + dy * L);
    ctx.moveTo(cx, cy); ctx.lineTo(cx + tx * T, cy + ty * T);
    ctx.lineWidth = Math.max(2.5, f * 0.16);
    ctx.strokeStyle = C.accent;
    ctx.stroke();
    ctx.font = `500 ${Math.round(f * 0.62)}px ${MONO}`;
    ctx.fillStyle = C.text;
    ctx.fillText(String(Math.round(plane.dip)), cx + tx * (T + f * 0.55), cy + ty * (T + f * 0.55));
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, f * 0.1), 0, Math.PI * 2);
    ctx.fillStyle = C.label;
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw a Smart Photo.
 * @returns {Promise<{blob: Blob, width: number, height: number, content: object}>}
 */
export async function renderSmartPhoto({ st, project, meta, data, index = 0, total = 1, zoneLock, collector, maxSide = 3072, quality = 0.9 }) {
  await loadFonts();
  const img = await loadPhoto(data, meta.type);
  const content = stripContent({ st, project, meta, index, total, zoneLock, collector });
  const iw = img.naturalWidth, ih = img.naturalHeight;
  let scale = Math.min(1, maxSide / Math.max(iw, ih));

  for (let attempt = 0; attempt < 4; attempt++) {
    const W = Math.round(iw * scale);
    const Hp = Math.round(ih * scale);
    const f = Math.max(17, Math.round(W / 40));
    const P = Math.round(f * 1.05);
    const hasDial = !!(content.plane || content.bearing != null);
    const dialR = Math.round(f * 2.35);
    const textW = W - 2 * P - (hasDial ? 2 * dialR + P : 0);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fonts = { label: `400 ${f}px ${SANS}`, value: `500 ${f}px ${MONO}` };
    const bigF = Math.round(f * 1.3);
    const bigFonts = { label: `400 ${f}px ${SANS}`, value: `600 ${bigF}px ${MONO}`, sq: `500 ${f}px ${MONO}` };
    const gap = f * 1.3;
    const rowLines = content.rows.map((row) => ({
      big: !!row.big,
      fonts: row.big ? bigFonts : fonts,
      lines: flow(ctx, row.items, textW, row.big ? bigFonts : fonts, gap),
    }));
    const headF = Math.round(f * 1.45);
    const lineH = Math.round(f * 1.5);
    const bigH = Math.round(bigF * 1.45);
    const footF = Math.round(f * 0.8);
    const textH = Math.round(headF * 1.3) + Math.round(f * 0.35)
      + rowLines.reduce((n, r) => n + r.lines.length * (r.big ? bigH : lineH), 0) + Math.round(footF * 1.9);
    const stripH = Math.max(textH, hasDial ? 2 * dialR + Math.round(f * 1.4) : 0) + 2 * P;
    const H = Hp + stripH;
    if (W * H > MAX_PIXELS && attempt < 3) { scale *= Math.sqrt(MAX_PIXELS / (W * H)) * 0.98; continue; }

    canvas.width = W;
    canvas.height = H;
    ctx.drawImage(img, 0, 0, W, Hp);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, Hp, W, stripH);
    ctx.fillStyle = C.accent;
    ctx.fillRect(0, Hp, W, Math.max(2, Math.round(f * 0.12)));

    // first line: LODESTAR  ST-024  Sandstone หินทราย ............ [➤ 200° SSW]
    let y = Hp + P + headF;
    let x = P;
    ctx.textBaseline = 'alphabetic';
    const pillW = content.bearingText ? bearingPill(ctx, P + textW, y, headF, content.bearingText, content.bearing, f) : 0;
    const lineEnd = P + textW - (pillW ? pillW + f * 0.8 : 0);
    ctx.font = `600 ${Math.round(f * 0.9)}px ${MONO}`;
    ctx.fillStyle = C.accent;
    ctx.fillText('LODESTAR', x, y);
    x += ctx.measureText('LODESTAR').width + f * 0.7;
    ctx.font = `500 ${headF}px ${MONO}`;
    ctx.fillStyle = C.text;
    ctx.fillText(content.code, x, y);
    x += ctx.measureText(content.code).width + f * 0.8;
    if (content.lith) {
      ctx.font = `600 ${headF}px ${SANS}`;
      const room = lineEnd - x;
      let lith = content.lith;
      while (lith.length > 1 && ctx.measureText(lith).width > room) lith = lith.slice(0, -1);
      if (lith !== content.lith) lith = lith.slice(0, -1) + '…';
      ctx.fillText(lith, x, y);
      x += ctx.measureText(lith).width + f * 0.6;
      if (content.lithTh) {
        ctx.font = `400 ${Math.round(f * 1.05)}px ${SANS}`;
        ctx.fillStyle = C.label;
        if (x + ctx.measureText(content.lithTh).width <= lineEnd) ctx.fillText(content.lithTh, x, y);
      }
    }
    y += Math.round(f * 0.35);

    for (const row of rowLines) {
      for (const line of row.lines) {
        y += row.big ? bigH : lineH;
        for (const run of line) {
          if (run.label) {
            ctx.font = row.fonts.label;
            ctx.fillStyle = C.label;
            ctx.fillText(run.label, P + run.x, y);
          }
          // large line: grid reference in field-book yellow, bearing in white, the square quieter
          ctx.font = (run.kind && row.fonts[run.kind]) || row.fonts.value;
          ctx.fillStyle = run.kind === 'gr' ? C.accent : run.kind === 'sq' ? C.label : C.text;
          ctx.fillText(run.value, P + run.x + run.lw, y);
        }
      }
    }
    ctx.font = `400 ${footF}px ${SANS}`;
    ctx.fillStyle = C.dim;
    let foot = content.foot;
    while (foot.length > 1 && ctx.measureText(foot).width > textW) foot = foot.slice(0, -2) + '…';
    ctx.fillText(foot, P, y + Math.round(footF * 1.9));

    if (hasDial) {
      const cx = W - P - dialR;
      const cy = Hp + stripH / 2 + f * 0.45;
      drawDial(ctx, cx, cy, dialR, content.plane, content.bearing, f);
    }

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('สร้างรูปไม่สำเร็จ หน่วยความจำอาจไม่พอ');
    return { blob, width: W, height: H, content };
  }
  throw new Error('รูปใหญ่เกินไป');
}

/** ST-001, 1st photo → ST001_01_smart.jpg (same naming as photos/ in the Project ZIP). */
export const smartName = (code, index) => `${String(code).replace(/[^A-Za-z0-9]/g, '')}_${pad(index + 1)}_smart.jpg`;

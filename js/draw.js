// Canvas helpers shared by the summary map and Smart Photo.

export const SANS = '"IBM Plex Sans Thai", system-ui, -apple-system, sans-serif';
export const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

/** Make sure the app fonts are ready before drawing text on a canvas. */
export async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load(`600 60px ${SANS}`, 'GEO กขค'),
      document.fonts.load(`500 26px ${SANS}`, 'GEO กขค'),
      document.fonts.load(`400 26px ${SANS}`, 'GEO กขค'),
      document.fonts.load(`500 22px ${MONO}`, '0123'),
      document.fonts.load(`400 22px ${MONO}`, '0123'),
    ]);
  } catch { /* fall back to system fonts */ }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Wrap text into at most `maxLines` lines no wider than `w` (adds … when cut). */
export function wrap(ctx, text, w, maxLines) {
  const parts = text.split(/(\s+)/);
  const lines = [];
  let cur = '';
  for (const p of parts) {
    const next = cur + p;
    if (ctx.measureText(next.trim()).width <= w || !cur.trim()) { cur = next; continue; }
    lines.push(cur.trim());
    cur = p.trimStart();
  }
  if (cur.trim()) lines.push(cur.trim());
  // break very long words / Thai runs without spaces
  const out = [];
  for (let line of lines) {
    while (ctx.measureText(line).width > w) {
      let k = line.length - 1;
      while (k > 1 && ctx.measureText(line.slice(0, k)).width > w) k--;
      out.push(line.slice(0, k));
      line = line.slice(k);
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > w) last = last.slice(0, -1);
    kept[maxLines - 1] = last + '…';
    return kept;
  }
  return out;
}

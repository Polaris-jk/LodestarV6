// Colours for station pins by rock type.
//
// The quick-pick rocks use the geological time-scale colour (the convention DMR geological maps
// follow) of the Khon Kaen formation each rock is most characteristic of, from DMR "ธรณีวิทยาของ
// จังหวัดขอนแก่น"; shades are adjusted so every pin can be told apart. Any other rock typed in
// a station gets its own colour, picked away from all colours already in use and remembered.

import * as store from './store.js';
import { LITHOLOGY } from './vocab.js';

export const ROCK_COLORS = {
  Sandstone: ['#3BB4D0', 'หมวดหินพระวิหาร · จูแรสซิก'],
  Mudstone: ['#2F6FB5', 'หมวดหินภูกระดึง · จูแรสซิก'],
  Siltstone: ['#8CCD57', 'หมวดหินเสาขัว · ครีเทเชียส'],
  Conglomerate: ['#2E9E5B', 'หมวดหินภูพาน · ครีเทเชียส'],
  'Pebbly sandstone': ['#C6E89E', 'หมวดหินภูพาน · ครีเทเชียส'],
  'Rock salt': ['#E9EF7C', 'หมวดหินมหาสารคาม · ครีเทเชียสตอนปลาย'],
  Gypsum: ['#F4F1DE', 'หมวดหินโคกกรวด / มหาสารคาม · ครีเทเชียส'],
  Shale: ['#67A599', 'หมวดหินดอนดู่ · คาร์บอนิเฟอรัส'],
  Chert: ['#3F7268', 'หมวดหินดอนดู่ · คาร์บอนิเฟอรัส'],
  Limestone: ['#F04028', 'หมวดหินผานกเค้า · เพอร์เมียน'],
  'Volcanic rock': ['#9B3FA0', 'หินภูเขาไฟ · เพอร์เมียน–ไทรแอสซิก'],
};
export const UNKNOWN_COLOR = '#9AA0A6';

// longest names first, so "Pebbly sandstone" wins over "Sandstone"
const NAMES = LITHOLOGY.flatMap(([en, th]) => [[en.toLowerCase(), en], [th, en]])
  .sort((a, b) => b[0].length - a[0].length);

/** The quick-pick rock a typed lithology refers to ("Siltstone, laminated" → Siltstone), or null. */
export function rockKey(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  for (const [name, en] of NAMES) if (t.includes(name.toLowerCase())) return en;
  return null;
}

const customKey = (text) => String(text || '').trim().toLowerCase();
const customMap = () => store.getSettings().rockColors || {};

function hueOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return null;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
function hashHue(text) {
  let h = 2166136261;
  for (const c of text) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 360;
}

/** A new colour whose hue is well away from every colour in `used`. */
function newColor(text, used) {
  const hues = used.map(hueOf).filter((h) => h != null);
  let best = null;
  for (let k = 0; k < 48; k++) {
    const h = (hashHue(text) + k * 137.508) % 360;
    const gap = Math.min(...hues.map((u) => Math.min(Math.abs(h - u), 360 - Math.abs(h - u))), 360);
    if (!best || gap > best.gap) best = { h, gap };
    if (gap >= 24) break;
  }
  const light = [0.58, 0.45, 0.68][Object.keys(customMap()).length % 3];
  return hsl(best.h, 0.68, light);
}

/** Colour of a station's pin. */
export function colorFor(st) {
  const lith = String(st?.lithology || '').trim();
  if (!lith) return UNKNOWN_COLOR;
  const key = rockKey(lith);
  if (key) return ROCK_COLORS[key][0];
  return customMap()[customKey(lith)] || newColor(lith, Object.values(ROCK_COLORS).map((c) => c[0]));
}

/** Give every rock typed in these stations a colour of its own, and remember it. */
export async function ensureColors(stations) {
  const map = { ...customMap() };
  let changed = false;
  for (const st of stations) {
    const lith = String(st.lithology || '').trim();
    if (!lith || rockKey(lith)) continue;
    const k = customKey(lith);
    if (map[k]) continue;
    map[k] = newColor(lith, [...Object.values(ROCK_COLORS).map((c) => c[0]), ...Object.values(map)]);
    changed = true;
  }
  if (changed) await store.updateSettings({ rockColors: map });
}

/** Legend entries for the rocks in these stations, quick-pick rocks first. */
export function legend(stations) {
  const seen = new Map();
  for (const st of stations) {
    const lith = String(st.lithology || '').trim();
    const key = lith ? rockKey(lith) : null;
    const id = !lith ? '_none' : key || `c:${customKey(lith)}`;
    if (seen.has(id)) { seen.get(id).n += 1; continue; }
    const info = key ? LITHOLOGY.find(([en]) => en === key) : null;
    seen.set(id, {
      color: !lith ? UNKNOWN_COLOR : key ? ROCK_COLORS[key][0] : colorFor(st),
      name: !lith ? 'ยังไม่ระบุหิน' : key || lith,
      th: info ? info[1] : '',
      note: key ? ROCK_COLORS[key][1] : lith ? 'หินที่พิมพ์เอง' : '',
      order: !lith ? 999 : key ? Object.keys(ROCK_COLORS).indexOf(key) : 100,
      n: 1,
    });
  }
  return [...seen.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

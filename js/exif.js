// Minimal EXIF reader for JPEG photos: when the photo was taken, and which way the camera
// faced (GPSImgDirection) if the camera app recorded it. Everything else is ignored.

const TAG = {
  DateTime: 0x0132, ExifIFD: 0x8769, GPSIFD: 0x8825,
  DateTimeOriginal: 0x9003, OffsetTimeOriginal: 0x9011,
  GPSImgDirectionRef: 0x0010, GPSImgDirection: 0x0011,
};
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/**
 * @param {ArrayBuffer} buf
 * @returns {{taken: string|null, offset: string|null, bearing: number|null, bearingRef: string|null}}
 *   taken is "YYYY-MM-DD HH:MM:SS" in the camera's local time.
 */
export function readExif(buf) {
  const out = { taken: null, offset: null, bearing: null, bearingRef: null };
  try {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return out;
    let p = 2;
    const end = Math.min(v.byteLength, 1 << 20);
    while (p + 4 <= end) {
      if (v.getUint8(p) !== 0xff) return out;
      const marker = v.getUint8(p + 1);
      if (marker === 0xd9 || marker === 0xda) return out; // end of image / start of scan
      const len = v.getUint16(p + 2);
      if (marker === 0xe1 && len > 8 &&
          v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) { // "Exif\0\0"
        parseTiff(v, p + 10, Math.min(end, p + 2 + len), out);
        return out;
      }
      p += 2 + len;
    }
  } catch { /* damaged or unusual file: no EXIF */ }
  return out;
}

function parseTiff(v, t0, limit, out) {
  const order = v.getUint16(t0);
  const le = order === 0x4949;
  if (!le && order !== 0x4d4d) return;
  const u16 = (o) => v.getUint16(o, le);
  const u32 = (o) => v.getUint32(o, le);
  if (u16(t0 + 2) !== 42) return;

  const readIFD = (off) => {
    const entries = new Map();
    const at = t0 + off;
    if (off <= 0 || at + 2 > limit) return entries;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > limit) break;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (SIZE[type] || 1) * count;
      const valAt = size <= 4 ? e + 8 : t0 + u32(e + 8);
      entries.set(u16(e), { type, count, valAt, raw: u32(e + 8) });
    }
    return entries;
  };
  const ascii = (e) => {
    if (!e || e.type !== 2 || e.valAt + e.count > limit) return null;
    let s = '';
    for (let i = 0; i < e.count; i++) {
      const c = v.getUint8(e.valAt + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.trim() || null;
  };
  const rational = (e) => {
    if (!e || (e.type !== 5 && e.type !== 10) || e.valAt + 8 > limit) return null;
    const a = e.type === 10 ? v.getInt32(e.valAt, le) : u32(e.valAt);
    const b = e.type === 10 ? v.getInt32(e.valAt + 4, le) : u32(e.valAt + 4);
    return b ? a / b : null;
  };
  const when = (s) => {
    const m = s && /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
    return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : null;
  };

  const ifd0 = readIFD(u32(t0 + 4));
  const exif = ifd0.has(TAG.ExifIFD) ? readIFD(ifd0.get(TAG.ExifIFD).raw) : new Map();
  out.taken = when(ascii(exif.get(TAG.DateTimeOriginal))) || when(ascii(ifd0.get(TAG.DateTime)));
  out.offset = ascii(exif.get(TAG.OffsetTimeOriginal));
  if (ifd0.has(TAG.GPSIFD)) {
    const gps = readIFD(ifd0.get(TAG.GPSIFD).raw);
    const dir = rational(gps.get(TAG.GPSImgDirection));
    if (dir != null && Number.isFinite(dir) && dir >= 0 && dir <= 360) {
      out.bearing = dir % 360;
      out.bearingRef = (ascii(gps.get(TAG.GPSImgDirectionRef)) || 'T').toUpperCase().startsWith('M') ? 'M' : 'T';
    }
  }
}

// One-tap GPS.
// GEO never leaves the GPS running: a tap starts it, GEO keeps the most accurate fix,
// and switches it off as soon as the fix is good enough (or the time limit is reached).
// The last fix is remembered on the phone so it can be shown without using the GPS.

import * as db from './db.js';
import { metersBetween, norm360 } from './geomath.js';
import { geoidN } from './geoid-th.js';
import { isAppleWebKit } from './util.js';

const subs = new Set();
// status: idle | locating | averaging | denied | unsupported | insecure
let state = { status: 'idle', fix: null, progress: null };
let session = null;

const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
// iPhone/iPad report altitude above mean sea level; Android (and the W3C spec) report
// height above the WGS84 ellipsoid, ~30 m different in Khon Kaen. Normalise to MSL.
const ALT_IS_MSL = isAppleWebKit();

function emit() {
  for (const fn of subs) {
    try { fn(state); } catch (err) { console.error(err); }
  }
}
function set(patch) {
  state = { ...state, ...patch };
  emit();
}

function toFix(p) {
  const c = p.coords;
  const lat = c.latitude;
  const lon = c.longitude;
  let alt = null;
  let altRef = null;
  const raw = Number.isFinite(c.altitude) ? c.altitude : null;
  if (raw != null) {
    if (ALT_IS_MSL) { alt = raw; altRef = 'msl'; }
    else {
      const N = geoidN(lat, lon);
      if (N != null) { alt = raw - N; altRef = 'egm96'; }
      else { alt = raw; altRef = 'ellipsoid'; }
    }
  }
  return {
    lat,
    lon,
    acc: Number.isFinite(c.accuracy) ? c.accuracy : null,
    alt,
    altRaw: raw,
    altRef,
    altAcc: Number.isFinite(c.altitudeAccuracy) ? c.altitudeAccuracy : null,
    heading: Number.isFinite(c.heading) ? norm360(c.heading) : null,
    speed: Number.isFinite(c.speed) ? c.speed : null,
    time: p.timestamp || Date.now(),
    received: Date.now(),
  };
}

function remember(fix) {
  state = { ...state, fix };
  db.put('kv', fix, 'lastFix').catch(() => {});
}

/** Load the last fix saved on the phone (no GPS involved). */
export async function init() {
  try {
    const f = await db.get('kv', 'lastFix');
    if (f && Number.isFinite(f.lat) && Number.isFinite(f.lon)) state = { ...state, fix: f };
  } catch { /* first run */ }
}

export const current = () => state;
export const isRunning = () => !!session;

/** Listen for GPS state changes. Subscribing does NOT switch the GPS on. */
export function subscribe(fn) {
  subs.add(fn);
  fn(state);
  return () => subs.delete(fn);
}

function blocked() {
  if (!supported) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  return null;
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/**
 * Switch the GPS on, keep the most accurate fix and switch it off again when
 * the fix reaches `target` metres or after `maxMs`. Resolves with the best fix.
 */
export function locate({ target = 5, maxMs = 30000, minMs = 1500, signal } = {}) {
  if (session) return session.promise;
  const why = blocked();
  if (why) { set({ status: why }); return Promise.reject(new Error(why)); }

  const t0 = Date.now();
  let best = null;
  let count = 0;
  let watchId = null;
  let timer = null;
  let ticker = null;
  let resolveP, rejectP;
  const promise = new Promise((res, rej) => { resolveP = res; rejectP = rej; });

  const progress = (last) => ({ best, last, n: count, elapsed: Date.now() - t0, maxMs, target });

  function finish(err) {
    if (!session || session.promise !== promise) return;
    session = null;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    clearTimeout(timer);
    clearInterval(ticker);
    signal?.removeEventListener('abort', onAbort);
    document.removeEventListener('visibilitychange', onHide);
    if (err?.message === 'denied') {
      set({ status: 'denied', progress: null });
      return rejectP(err);
    }
    const result = best ? { ...best, method: 'single', n: 1, samples: count } : null;
    if (result) remember(result);
    set({ status: 'idle', progress: null });
    if (err) return rejectP(err);
    if (!result) return rejectP(new Error('timeout'));
    resolveP(result);
  }
  const onAbort = () => finish(abortError());
  const onHide = () => { if (document.hidden) finish(); };

  session = { promise, finish, kind: 'locate' };
  set({ status: 'locating', progress: progress(null) });

  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const f = toFix(p);
      count += 1;
      if (!best || (f.acc ?? Infinity) <= (best.acc ?? Infinity)) best = f;
      set({ status: 'locating', progress: progress(f) });
      if (best.acc != null && best.acc <= target && Date.now() - t0 >= minMs) finish();
    },
    (e) => { if (e.code === 1) finish(new Error('denied')); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs },
  );
  timer = setTimeout(() => finish(), maxMs);
  ticker = setInterval(() => set({ progress: progress(state.progress?.last ?? null) }), 500);
  signal?.addEventListener('abort', onAbort);
  document.addEventListener('visibilitychange', onHide);
  if (signal?.aborted) onAbort();
  return promise;
}

/** Stop the GPS now and keep the best fix found so far. */
export function stopNow() {
  if (session) session.finish();
}

/** Allow another try after the person changed the location permission. */
export function retry() {
  if (state.status === 'denied') set({ status: 'idle' });
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Average positions for `ms` milliseconds while the person stands still, then switch off.
 * Weighted by 1/accuracy². Reported accuracy is the median of the fixes (fixes are
 * correlated, so dividing by √n would overstate the improvement).
 */
export function average(ms = 10000, onProgress, signal) {
  if (session) session.finish(abortError());
  const why = blocked();
  if (why) { set({ status: why }); return Promise.reject(new Error(why)); }

  const t0 = Date.now();
  const fixes = [];
  let watchId = null;
  let tick = null;
  let resolveP, rejectP;
  const promise = new Promise((res, rej) => { resolveP = res; rejectP = rej; });

  function finish(err) {
    if (!session || session.promise !== promise) return;
    session = null;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    clearInterval(tick);
    signal?.removeEventListener('abort', onAbort);
    document.removeEventListener('visibilitychange', onHide);
    if (err?.message === 'denied') { set({ status: 'denied', progress: null }); return rejectP(err); }
    set({ status: 'idle', progress: null });
    if (err) return rejectP(err);
    if (!fixes.length) return rejectP(new Error('timeout'));
    const result = combine(fixes);
    remember(result);
    resolveP(result);
  }
  const onAbort = () => finish(abortError());
  const onHide = () => { if (document.hidden) finish(abortError()); };

  session = { promise, finish, kind: 'average' };
  set({ status: 'averaging', progress: { n: 0, elapsed: 0, maxMs: ms } });
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      fixes.push(toFix(p));
      onProgress?.({ n: fixes.length, elapsed: Date.now() - t0, total: ms });
    },
    (e) => { if (e.code === 1) finish(new Error('denied')); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: ms + 5000 },
  );
  tick = setInterval(() => {
    const elapsed = Date.now() - t0;
    onProgress?.({ n: fixes.length, elapsed, total: ms });
    if (elapsed >= ms) finish();
  }, 250);
  signal?.addEventListener('abort', onAbort);
  document.addEventListener('visibilitychange', onHide);
  if (signal?.aborted) onAbort();
  return promise;
}

function combine(fixes) {
  let sw = 0, slat = 0, slon = 0;
  for (const f of fixes) {
    const w = 1 / Math.max(f.acc || 10, 1) ** 2;
    sw += w; slat += w * f.lat; slon += w * f.lon;
  }
  const lat = slat / sw;
  const lon = slon / sw;
  const withAlt = fixes.filter((f) => f.alt != null);
  let alt = null, altRaw = null, altAcc = null, altRef = null;
  if (withAlt.length) {
    let w2 = 0, sa = 0, sr = 0;
    for (const f of withAlt) {
      const w = 1 / Math.max(f.altAcc || 10, 1) ** 2;
      w2 += w; sa += w * f.alt; sr += w * f.altRaw;
    }
    alt = sa / w2;
    altRaw = sr / w2;
    altAcc = median(withAlt.map((f) => f.altAcc).filter((x) => x != null));
    altRef = withAlt[withAlt.length - 1].altRef;
  }
  const spread = Math.sqrt(fixes.reduce((s, f) => s + metersBetween(lat, lon, f.lat, f.lon) ** 2, 0) / fixes.length);
  return {
    lat, lon,
    acc: median(fixes.map((f) => f.acc).filter((x) => x != null)),
    alt, altRaw, altRef, altAcc,
    n: fixes.length,
    spread,
    method: 'average',
    time: Date.now(),
    received: Date.now(),
  };
}

export const GPS_ERRORS = {
  denied: 'ไม่ได้รับสิทธิ์ใช้ตำแหน่ง เปิดสิทธิ์ใน Settings ของเครื่องแล้วลองใหม่',
  timeout: 'ยังไม่ได้สัญญาณ GPS ลองออกไปที่โล่งแล้วกดอีกครั้ง',
  insecure: 'ต้องเปิด Lodestar ผ่าน https จึงจะใช้ GPS ได้',
  unsupported: 'เครื่องนี้ไม่มี GPS',
};

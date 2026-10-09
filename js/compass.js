// Compass heading from the phone's orientation sensors (magnetic north).
// Listens only while a screen subscribes and the app is visible.
//
// iPhone: needs a tap to grant permission each launch, then gives webkitCompassHeading.
// Android/Chrome: 'deviceorientationabsolute' gives alpha/beta/gamma relative to north.

import { norm360 } from './geomath.js';

const subs = new Set();
const hasDOE = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
export const needsPermission = () =>
  hasDOE && typeof DeviceOrientationEvent.requestPermission === 'function';

let permission = needsPermission() ? 'prompt' : 'granted';
let state = { status: hasDOE ? 'off' : 'unavailable', heading: null, accuracy: null };
let listening = false;
let evtName = null;
let sx = null, sy = null;
let watchdog = null;
let frame = 0;

function emit() {
  for (const fn of subs) {
    try { fn(state); } catch (err) { console.error(err); }
  }
}
function scheduleEmit() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; emit(); });
}

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return typeof window.orientation === 'number' ? window.orientation : 0;
}

/**
 * Heading of the phone from alpha/beta/gamma (W3C Z-X'-Y'' rotation).
 * Uses the direction of the top edge when the phone is held flat, and the direction the
 * back camera points when it is held upright — whichever is closer to horizontal.
 */
function headingFromEuler(alpha, beta, gamma) {
  const r = Math.PI / 180;
  const a = alpha * r, b = beta * r, g = gamma * r;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  // device +Y (top edge) in world coordinates (x = east, y = north)
  const yE = -sa * cb, yN = ca * cb;
  // device -Z (out of the back) in world coordinates
  const zE = -ca * sg - sa * sb * cg, zN = -sa * sg + ca * sb * cg;
  const useTop = Math.hypot(yE, yN) >= Math.hypot(zE, zN);
  const E = useTop ? yE : zE;
  const N = useTop ? yN : zN;
  return norm360(Math.atan2(E, N) / r);
}

function update(h, acc) {
  const deg = norm360(h + screenAngle());
  const rad = (deg * Math.PI) / 180;
  const x = Math.cos(rad), y = Math.sin(rad);
  if (sx === null) { sx = x; sy = y; }
  else { sx += 0.22 * (x - sx); sy += 0.22 * (y - sy); }
  state = {
    status: 'ok',
    heading: norm360((Math.atan2(sy, sx) * 180) / Math.PI),
    accuracy: acc,
  };
  clearTimeout(watchdog);
  scheduleEmit();
}

function onOrientation(e) {
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
    const acc = typeof e.webkitCompassAccuracy === 'number' && e.webkitCompassAccuracy >= 0 ? e.webkitCompassAccuracy : null;
    update(e.webkitCompassHeading, acc);
  } else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha != null) {
    update(headingFromEuler(e.alpha, e.beta ?? 0, e.gamma ?? 0), null);
  }
}

function start() {
  if (listening || !hasDOE || document.hidden || !subs.size) return;
  if (permission !== 'granted') {
    state = { ...state, status: permission === 'denied' ? 'denied' : 'needs-permission' };
    emit();
    return;
  }
  evtName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(evtName, onOrientation);
  listening = true;
  if (state.status !== 'ok') state = { ...state, status: 'waiting' };
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    if (state.status !== 'ok') { state = { ...state, status: 'unavailable' }; emit(); }
  }, 3000);
  emit();
}

function stop() {
  if (listening) window.removeEventListener(evtName, onOrientation);
  listening = false;
  clearTimeout(watchdog);
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  sx = sy = null;
  if (state.status === 'ok' || state.status === 'waiting') state = { ...state, status: 'off' };
}

document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

export const current = () => state;
/** 'granted' once the orientation sensors may be read (always on Android). */
export const permissionState = () => permission;

export function subscribe(fn) {
  subs.add(fn);
  start();
  fn(state);
  return () => {
    subs.delete(fn);
    if (!subs.size) stop();
  };
}

/** Must be called from a tap on iPhone. */
export async function requestPermission() {
  if (!needsPermission()) { permission = 'granted'; start(); return 'granted'; }
  try {
    permission = await DeviceOrientationEvent.requestPermission();
  } catch {
    permission = 'denied';
  }
  if (permission === 'granted') start();
  else { state = { ...state, status: 'denied' }; emit(); }
  return permission;
}

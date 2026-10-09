// Phone attitude from the orientation sensors — used to measure planes (strike/dip) with the phone
// laid on the rock, and the direction a photo was taken.
//
// Frames (W3C DeviceOrientation): the phone frame has x to the right, y along the top edge and
// z out of the screen. The earth frame has x east, y north, z up. alpha/beta/gamma are the
// Z-X'-Y'' rotations, so R = Rz(alpha)·Rx(beta)·Ry(gamma) turns phone vectors into earth vectors.
//
// Android/Chrome: 'deviceorientationabsolute' — alpha is measured from magnetic north.
// iPhone: alpha has an arbitrary zero. Its zero is found from webkitCompassHeading (the heading of
// the top edge) while the phone is held roughly flat, then kept while the phone tilts — the
// gyro keeps alpha steady — so steep planes still get a north reference.

import * as compass from './compass.js';
import { norm360 } from './geomath.js';

const D = Math.PI / 180;
const deg = (rad) => rad / D;

// ---------- math (pure, also used by tests) ----------

/** Rotation matrix (rows) from phone frame to earth frame (east, north, up). Angles in degrees. */
export function rotation(alpha, beta, gamma) {
  const a = alpha * D, b = beta * D, g = gamma * D;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return [
    [ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg],
    [sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg],
    [-cb * sg, sb, cb * cg],
  ];
}

export const apply = (R, v) => [
  R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
  R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
  R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
];

const unit = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
export const angleBetween = (u, v) => deg(Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))));

/** "Up" as seen in the phone frame — the third row of R. Does not depend on alpha. */
export function upInPhone(beta, gamma) {
  const b = beta * D, g = gamma * D;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

/**
 * Plane from its normal in the earth frame (either side). Right-hand rule: strike = dip direction − 90°.
 * Dip direction is where the upward normal leans; it means little when the plane is nearly flat.
 */
export function planeFromNormal(n) {
  let [E, N, U] = unit(n);
  if (U < 0) { E = -E; N = -N; U = -U; }
  const dip = deg(Math.atan2(Math.hypot(E, N), U));
  const dipdir = norm360(deg(Math.atan2(E, N)));
  return { dip, dipdir, strike: norm360(dipdir - 90) };
}

/**
 * Direction the phone is looking, for photos: the horizontal part of (top edge − screen normal).
 * Held flat it is where the top edge points; held upright it is where the back camera points.
 */
export function viewBearing(R) {
  const f = apply(R, [0, 1, -1]);
  const h = Math.hypot(f[0], f[1]);
  if (h < 0.25) return null;
  return norm360(deg(Math.atan2(f[0], f[1])));
}

/**
 * Where the back camera points: bearing (from north, clockwise), pitch (+ up / − down) and roll
 * (0° portrait upright, 90° when the phone is turned so its right edge points up).
 */
export function cameraPose(R) {
  const f = apply(R, [0, 0, -1]);
  const h = Math.hypot(f[0], f[1]);
  const bearing = h >= 0.3 ? norm360(deg(Math.atan2(f[0], f[1]))) : viewBearing(R);
  const pitch = deg(Math.asin(Math.max(-1, Math.min(1, f[2]))));
  const roll = deg(Math.atan2(R[2][0], R[2][1]));
  return { bearing, pitch, roll };
}

/** Rotation for a sample, referenced to true north when a declination is given (east positive). */
export const sampleRotation = (s, declination = 0) => rotation(s.alpha - declination, s.beta, s.gamma);

/** Contact-plane normal in the phone frame from two readings on a table, the phone turned 180° in between. */
export function calibrationFromPair(up1, up2) {
  const c = unit([up1[0] + up2[0], up1[1] + up2[1], up1[2] + up2[2]]);
  return { c, tilt: angleBetween(c, [0, 0, 1]), table: angleBetween(up1, up2) / 2 };
}

/**
 * Detects when the phone is held still: readings must stay within `tol` of the last moment's
 * average and within `anchorTol` of the first reading of the run, for `hold` ms.
 * Works on unit vectors (plane normals or the up direction).
 */
export class Steady {
  constructor({ tol = 1.0, anchorTol = 1.6, hold = 1500 } = {}) {
    Object.assign(this, { tol, anchorTol, hold });
    this.run = [];
  }
  reset() { this.run = []; }
  push(t, v) {
    const u = unit(v);
    const run = this.run;
    if (run.length) {
      const recent = run.filter((s) => t - s.t <= 400);
      const near = recent.length ? meanVec(recent.map((s) => s.v)) : run[run.length - 1].v;
      if (angleBetween(u, near) > this.tol || angleBetween(u, run[0].v) > this.anchorTol) run.length = 0;
    }
    run.push({ t, v: u });
    if (run.length > 400) run.splice(0, run.length - 400);
    return this.status(t);
  }
  status(t = performance.now()) {
    const run = this.run;
    if (!run.length) return { progress: 0, mean: null, spread: null, n: 0 };
    const mean = meanVec(run.map((s) => s.v));
    const spread = Math.max(...run.map((s) => angleBetween(s.v, mean)));
    return { progress: Math.min(1, (t - run[0].t) / this.hold), mean, spread, n: run.length };
  }
  /** Average of the last `ms` of readings — a steadier live value. */
  recentMean(ms = 300) {
    const run = this.run;
    if (!run.length) return null;
    const t = run[run.length - 1].t;
    return meanVec(run.filter((s) => t - s.t <= ms).map((s) => s.v));
  }
}

export function meanVec(list) {
  const s = [0, 0, 0];
  for (const v of list) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
  return unit(s);
}

// ---------- sensor stream ----------

const subs = new Set();
let listening = false;
let evtName = null;
let watchdog = null;
let state = { status: 'off', sample: null };
// iPhone north reference: running average of the offset as a unit vector
let offX = 0, offY = 0, offN = 0;

const hasDOE = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

function emit() {
  for (const fn of subs) {
    try { fn(state); } catch (err) { console.error(err); }
  }
}

function learnOffset(alphaRel, beta, gamma, heading) {
  // Only while the phone is roughly flat: then webkitCompassHeading is the heading of the top edge.
  if (Math.abs(beta) > 50 || Math.abs(gamma) > 50) return;
  const a = alphaRel * D, cb = Math.cos(beta * D);
  const azRel = deg(Math.atan2(-Math.sin(a) * cb, Math.cos(a) * cb));
  const d = (heading - azRel) * D;
  const k = offN < 15 ? 1 / (offN + 1) : 0.04;
  offX += k * (Math.cos(d) - offX);
  offY += k * (Math.sin(d) - offY);
  offN += 1;
}

function onEvent(e) {
  if (e.beta == null || e.gamma == null) return;
  const ios = typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading) && e.webkitCompassHeading >= 0;
  let alpha = e.alpha;
  let north = false;
  let accuracy = null;
  if (ios) {
    if (e.alpha != null) learnOffset(e.alpha, e.beta, e.gamma, e.webkitCompassHeading);
    if (offN > 0 && e.alpha != null) {
      alpha = norm360(e.alpha - deg(Math.atan2(offY, offX)));
      north = true;
    }
    accuracy = typeof e.webkitCompassAccuracy === 'number' && e.webkitCompassAccuracy >= 0 ? e.webkitCompassAccuracy : null;
  } else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha != null) {
    north = true;
  }
  state = {
    status: 'ok',
    // yaw: the raw alpha, only used for turns relative to an earlier reading (null when unknown)
    sample: { t: performance.now(), alpha: alpha ?? 0, yaw: e.alpha ?? null, beta: e.beta, gamma: e.gamma, north, accuracy, ios },
  };
  clearTimeout(watchdog);
  emit();
}

function start() {
  if (listening || !hasDOE || document.hidden || !subs.size) return;
  if (compass.permissionState() !== 'granted') {
    state = { status: compass.permissionState() === 'denied' ? 'denied' : 'needs-permission', sample: null };
    emit();
    return;
  }
  evtName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(evtName, onEvent);
  listening = true;
  if (state.status !== 'ok') { state = { status: 'waiting', sample: null }; emit(); }
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    if (state.status !== 'ok') { state = { status: 'unavailable', sample: null }; emit(); }
  }, 3000);
}

function stop() {
  if (listening) window.removeEventListener(evtName, onEvent);
  listening = false;
  clearTimeout(watchdog);
  if (state.status === 'ok' || state.status === 'waiting') state = { status: 'off', sample: null };
}

if (hasDOE) document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

/** Latest reading, or null. `maxAge` in ms. */
export function latest(maxAge = 1500) {
  const s = state.sample;
  return s && performance.now() - s.t <= maxAge ? s : null;
}

export function subscribe(fn) {
  subs.add(fn);
  if (!hasDOE) { state = { status: 'unavailable', sample: null }; fn(state); return () => subs.delete(fn); }
  start();
  fn(state);
  return () => {
    subs.delete(fn);
    if (!subs.size) stop();
  };
}

/** Ask for the sensors (iPhone needs a tap), then start listening. */
export async function requestPermission() {
  const res = await compass.requestPermission();
  if (res === 'granted') start();
  else { state = { status: 'denied', sample: null }; emit(); }
  return res;
}

export const needsPermission = () => compass.permissionState() !== 'granted';

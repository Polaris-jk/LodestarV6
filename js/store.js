// Projects, stations, photos and settings — the field notebook itself.

import * as db from './db.js';
import { uuid, pad } from './util.js';
import { hasMeasurement, norm360 } from './geomath.js';
import { readExif } from './exif.js';

export const APP_VERSION = '0.6.0';

const DEFAULTS = {
  schema: 2,
  projectId: null,
  collector: '',
  utmZone: 'auto', // 'auto' | '47' | '48' | …
  coordFormat: 'utm', // 'utm' | 'dd' | 'dms'
  declination: 0, // degrees, east positive
  theme: 'dark', // 'dark' | 'sun'
  gpsTarget: 5, // metres: stop the GPS once a fix is this good
  smartAutoSave: true, // save each new Smart Photo to the phone automatically (where the browser allows it)
  clinoCal: null, // { c: [x, y, z] contact-plane normal in the phone frame, tilt, at } from the zero calibration
  bannerDismissed: false,
  // defaults for new projects
  stationPrefix: 'ST',
  samplePrefix: 'GEO',
};

let settings = { ...DEFAULTS };
let project = null;

/** Stations created this session that the person has not touched yet. */
export const freshIds = new Set();

const cleanPrefix = (s) => String(s || '').trim().replace(/\s+/g, '').slice(0, 12);

function withDefaults(p) {
  if (!p) return p;
  return {
    ...p,
    stationPrefix: cleanPrefix(p.stationPrefix) || cleanPrefix(settings.stationPrefix) || 'ST',
    samplePrefix: cleanPrefix(p.samplePrefix) || cleanPrefix(settings.samplePrefix) || 'GEO',
  };
}

async function saveSettings() {
  await db.put('kv', { ...settings }, 'settings');
}

export async function init() {
  const saved = await db.get('kv', 'settings');
  settings = { ...DEFAULTS, ...(saved || {}) };
  if (saved && !(saved.schema >= 2)) {
    // v0.1 → v0.2: UTM becomes the main coordinate display
    settings.coordFormat = 'utm';
    settings.schema = 2;
  }
  if (settings.projectId) project = await db.get('projects', settings.projectId);
  if (!project) {
    const all = await db.getAll('projects');
    project = all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
  }
  if (!project) {
    project = { id: uuid(), name: 'My Project', createdAt: Date.now() };
  }
  if (!project.stationPrefix || !project.samplePrefix) {
    project = withDefaults(project);
    await db.put('projects', project);
  }
  settings.projectId = project.id;
  await saveSettings();
}

export const getSettings = () => settings;
export const getProject = () => project;

export async function updateSettings(patch) {
  Object.assign(settings, patch);
  await saveSettings();
}

/** UTM zone lock from settings, or undefined for automatic. */
export function zoneLock() {
  const z = parseInt(settings.utmZone, 10);
  return Number.isFinite(z) && z >= 1 && z <= 60 ? z : undefined;
}

// ---------- projects ----------

export async function listProjects() {
  const [projects, stations] = await Promise.all([db.getAll('projects'), db.getAll('stations')]);
  const stats = new Map();
  for (const s of stations) {
    const o = stats.get(s.projectId) || { stations: 0, samples: 0, photos: 0, last: 0 };
    o.stations += 1;
    o.samples += (s.samples || []).length;
    o.photos += (s.photoIds || []).length;
    o.last = Math.max(o.last, s.updatedAt || s.createdAt || 0);
    stats.set(s.projectId, o);
  }
  return projects
    .map((p) => ({ ...withDefaults(p), stats: stats.get(p.id) || { stations: 0, samples: 0, photos: 0, last: 0 } }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Name of another project already using this sample prefix, or null. */
export async function samplePrefixOwner(prefix, exceptId) {
  const k = cleanPrefix(prefix).toUpperCase();
  if (!k) return null;
  const all = (await db.getAll('projects')).map(withDefaults);
  const hit = all.find((p) => p.id !== exceptId && p.samplePrefix.toUpperCase() === k);
  return hit ? hit.name : null;
}

/** A sample prefix no other project uses: GEO, GEO2, GEO3 … */
export async function suggestSamplePrefix() {
  const used = new Set((await db.getAll('projects')).map((p) => withDefaults(p).samplePrefix.toUpperCase()));
  const base = cleanPrefix(settings.samplePrefix) || 'GEO';
  if (!used.has(base.toUpperCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`.toUpperCase())) return `${base}${i}`;
}

export async function createProject({ name, samplePrefix, stationPrefix }) {
  const now = Date.now();
  const p = {
    id: uuid(),
    name: String(name || '').trim() || 'New project',
    createdAt: now,
    updatedAt: now,
    stationPrefix: cleanPrefix(stationPrefix) || 'ST',
    samplePrefix: cleanPrefix(samplePrefix) || (await suggestSamplePrefix()),
  };
  await db.put('projects', p);
  await switchProject(p.id);
  return p;
}

export async function switchProject(id) {
  const p = await db.get('projects', id);
  if (!p) throw new Error('ไม่พบโปรเจกต์นี้');
  project = withDefaults(p);
  settings.projectId = id;
  freshIds.clear();
  await saveSettings();
}

export async function updateProject(patch, id = project.id) {
  const p = await db.get('projects', id);
  if (!p) throw new Error('ไม่พบโปรเจกต์นี้');
  const next = withDefaults({ ...p, ...patch, updatedAt: Date.now() });
  if (patch.name !== undefined) next.name = String(patch.name).trim() || p.name;
  await db.put('projects', next);
  if (id === project.id) project = next;
  return next;
}

/** Delete a project with all its stations and photos. Switches to another project if needed. */
export async function deleteProject(id) {
  const stations = await db.getAllByIndex('stations', 'projectId', id);
  const photoLists = await Promise.all(stations.map((s) => db.getAllByIndex('photos', 'stationId', s.id)));
  await db.transact(['projects', 'stations', 'photos', 'photoData'], (os) => {
    os('projects').delete(id);
    stations.forEach((s, i) => {
      os('stations').delete(s.id);
      for (const ph of photoLists[i]) {
        os('photos').delete(ph.id);
        os('photoData').delete(ph.id);
        os('photoData').delete(smartKey(ph.id));
      }
    });
  });
  if (id === project.id) {
    const rest = (await db.getAll('projects')).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (rest.length) await switchProject(rest[0].id);
    else await createProject({ name: 'My Project', samplePrefix: settings.samplePrefix, stationPrefix: settings.stationPrefix });
  }
}

// ---------- stations ----------

/** Bring stations saved by older versions up to date. */
function normalizeStation(st) {
  if (!st) return st;
  if (st.lithology === 'Other') st.lithology = String(st.lithologyOther || '').trim();
  st.measurements ||= [];
  st.samples ||= [];
  st.photoIds ||= [];
  return st;
}

export async function listStations(projectId = project.id) {
  const rows = await db.getAllByIndex('stations', 'projectId', projectId);
  return rows.map(normalizeStation).sort((a, b) => b.number - a.number);
}

export const getStation = async (id) => normalizeStation(await db.get('stations', id));

export async function saveStation(st) {
  st.updatedAt = Date.now();
  await db.put('stations', st);
  return st;
}

export function makeLocation(fix) {
  return {
    lat: fix.lat,
    lon: fix.lon,
    acc: fix.acc ?? null,
    alt: fix.alt ?? null,
    altRaw: fix.altRaw ?? null,
    altRef: fix.altRef ?? null,
    altAcc: fix.altAcc ?? null,
    method: fix.method || 'single',
    n: fix.n || 1,
    spread: fix.spread ?? null,
    time: fix.time || Date.now(),
  };
}

export async function createStation(fix) {
  const all = await listStations();
  const number = all.reduce((m, s) => Math.max(m, s.number || 0), 0) + 1;
  const now = Date.now();
  const st = {
    id: uuid(),
    projectId: project.id,
    number,
    code: `${project.stationPrefix}-${pad(number, 3)}`,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    location: fix ? makeLocation(fix) : null,
    lithology: '',
    weathering: '',
    color: '',
    measurements: [],
    samples: [],
    sampleSeq: 0,
    notes: '',
    photoIds: [],
    collector: settings.collector || '',
  };
  await db.put('stations', st);
  return st;
}

export function isEmptyStation(st) {
  return (
    !st.lithology?.trim() && !st.weathering && !st.color?.trim() && !st.notes?.trim() &&
    !(st.samples || []).length && !(st.photoIds || []).length &&
    !(st.measurements || []).some(hasMeasurement)
  );
}

export async function deleteStation(st) {
  const photos = await db.getAllByIndex('photos', 'stationId', st.id);
  await db.transact(['stations', 'photos', 'photoData'], (os) => {
    os('stations').delete(st.id);
    for (const p of photos) {
      os('photos').delete(p.id);
      os('photoData').delete(p.id);
      os('photoData').delete(smartKey(p.id));
    }
  });
}

// ---------- photos ----------
// Full images and small thumbnails are stored separately so lists stay fast.
// Images are stored as ArrayBuffers (the most reliable format across iOS/Android WebViews).

async function makeThumb(file, max = 420) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('อ่านไฟล์รูปไม่ได้'));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    return { buf: await blob.arrayBuffer(), w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Add a photo to a station. `extra.bearing` is the direction the phone faced when the camera button
 * was tapped (degrees from true north); a direction recorded by the camera itself (EXIF) wins.
 */
export async function addPhoto(st, file, extra = {}) {
  const [data, thumb] = await Promise.all([file.arrayBuffer(), makeThumb(file)]);
  const id = uuid();
  const exif = readExif(data);
  let bearing = null;
  let bearingSrc = null;
  if (exif.bearing != null) {
    // camera apps write true north ('T') or magnetic ('M'); GEO keeps true north
    bearing = exif.bearingRef === 'M' ? norm360(exif.bearing + (Number(settings.declination) || 0)) : exif.bearing;
    bearingSrc = 'exif';
  } else if (extra.bearing != null && Number.isFinite(extra.bearing)) {
    bearing = extra.bearing;
    bearingSrc = extra.bearingSrc || 'auto'; // 'camera' = in-app camera at the shutter, 'auto' = at the tap
  }
  const meta = {
    id,
    stationId: st.id,
    type: file.type || 'image/jpeg',
    name: file.name || '',
    size: file.size,
    width: thumb.w,
    height: thumb.h,
    thumb: thumb.buf,
    createdAt: Date.now(),
    taken: exif.taken, // camera's local time "YYYY-MM-DD HH:MM:SS", when the file has it
    takenOffset: exif.offset,
    bearing: bearing == null ? null : Math.round(norm360(bearing) * 10) / 10,
    bearingSrc,
    pitch: extra.pitch != null && Number.isFinite(extra.pitch) ? Math.round(extra.pitch) : null,
  };
  st.photoIds = [...(st.photoIds || []), id];
  st.updatedAt = Date.now();
  await db.transact(['photos', 'photoData', 'stations'], (os) => {
    os('photos').put(meta);
    os('photoData').put(data, id);
    os('stations').put(st);
  });
  return meta;
}

export async function listPhotos(st) {
  const rows = await db.getAllByIndex('photos', 'stationId', st.id);
  const order = new Map((st.photoIds || []).map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
}

export const getPhotoData = (id) => db.get('photoData', id);

// Smart Photos are kept in the app next to the original, under "<photo id>#smart".
function smartKey(id) { return `${id}#smart`; }
export const getSmartData = (id) => db.get('photoData', smartKey(id));
export async function putSmartData(id, buf, layout = null) {
  await db.put('photoData', buf, smartKey(id));
  return updatePhoto(id, { smartAt: Date.now(), smartLayout: layout }, { touch: false });
}

/** Change a photo's details (e.g. the direction it was taken). */
export async function updatePhoto(id, patch, { touch = true } = {}) {
  const meta = await db.get('photos', id);
  if (!meta) throw new Error('ไม่พบรูปนี้');
  const next = { ...meta, ...patch, ...(touch ? { updatedAt: Date.now() } : {}) };
  await db.put('photos', next);
  return next;
}

/** The project a station belongs to. */
export async function projectOf(st) {
  if (project && st.projectId === project.id) return project;
  return withDefaults(await db.get('projects', st.projectId)) || project;
}

export async function deletePhoto(st, id) {
  st.photoIds = (st.photoIds || []).filter((x) => x !== id);
  st.updatedAt = Date.now();
  await db.transact(['photos', 'photoData', 'stations'], (os) => {
    os('photos').delete(id);
    os('photoData').delete(id);
    os('photoData').delete(smartKey(id));
    os('stations').put(st);
  });
}

// ---------- storage ----------

/** Ask the browser not to clear GEO's data when the phone runs low on space. */
export async function ensurePersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return true;
  } catch {
    return false;
  }
}

export async function storageInfo() {
  const out = {};
  try {
    if (navigator.storage?.estimate) Object.assign(out, await navigator.storage.estimate());
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
  } catch { /* not supported */ }
  return out;
}

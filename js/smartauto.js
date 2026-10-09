// Smart Photos kept in the app and saved to the phone automatically.
//
// Each photo's Smart Photo is stored next to the original (it is redrawn whenever the station or
// the photo has changed since). When a station is saved, the Smart Photos of its new photos are
// also saved to the phone: Android/desktop browsers download them straight into the Downloads
// folder (shown in the gallery). iPhone browsers cannot save a file without a tap, so there they
// stay in the app, ready to save from the photo viewer or Export → Smart Photos.

import * as store from './store.js';
import { renderSmartPhoto, smartName, SMART_LAYOUT } from './smartphoto.js';
import { isIOS } from './util.js';

export const canAutoSave = () => !isIOS();

// kept copies drawn by an older version of the strip layout are drawn again
const fresh = (st, meta) => meta.smartAt && meta.smartLayout === SMART_LAYOUT
  && meta.smartAt >= (st.updatedAt || 0) && meta.smartAt >= (meta.updatedAt || 0);

/**
 * The Smart Photo for one photo: the kept copy when it is up to date, otherwise drawn and kept.
 * @returns {Promise<{file: File, meta: object}>}
 */
export async function smartFor(st, meta, index, total, project) {
  const name = smartName(st.code, index);
  if (fresh(st, meta)) {
    const kept = await store.getSmartData(meta.id);
    if (kept) return { file: new File([kept], name, { type: 'image/jpeg' }), meta };
  }
  const data = await store.getPhotoData(meta.id);
  if (!data) throw new Error('ไม่พบไฟล์รูปนี้');
  const out = await renderSmartPhoto({
    st, project: project || await store.projectOf(st), meta, data, index, total,
    zoneLock: store.zoneLock(), collector: store.getSettings().collector,
  });
  const buf = await out.blob.arrayBuffer();
  const next = await store.putSmartData(meta.id, buf, SMART_LAYOUT);
  return { file: new File([buf], name, { type: 'image/jpeg' }), meta: next };
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

let running = Promise.resolve();

/**
 * After a station is saved: bring its Smart Photos up to date in the app, and save the ones not yet
 * saved to the phone. Runs in the background, one station after another.
 * @returns {Promise<{kept: number, saved: number}>}
 */
export function finishStation(stationId) {
  running = running.then(async () => {
    const st = await store.getStation(stationId);
    if (!st) return { kept: 0, saved: 0 };
    const metas = await store.listPhotos(st);
    if (!metas.length) return { kept: 0, saved: 0 };
    const project = await store.projectOf(st);
    const auto = store.getSettings().smartAutoSave !== false && canAutoSave();
    let kept = 0, saved = 0;
    for (const [i, meta] of metas.entries()) {
      try {
        const { file } = await smartFor(st, meta, i, metas.length, project);
        kept += 1;
        if (auto && !meta.smartSavedAt) {
          download(file);
          await store.updatePhoto(meta.id, { smartSavedAt: Date.now() }, { touch: false });
          saved += 1;
          await new Promise((r) => setTimeout(r, 400)); // browsers drop downloads fired too quickly
        }
      } catch (err) {
        console.warn('Smart Photo', err);
      }
    }
    return { kept, saved };
  }).catch(() => ({ kept: 0, saved: 0 }));
  return running;
}

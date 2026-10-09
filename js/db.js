// Minimal promise wrapper around IndexedDB. Everything stays on the phone.

const DB_NAME = 'geo-field';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB is not available'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('stations')) db.createObjectStore('stations', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' }).createIndex('stationId', 'stationId');
      if (!db.objectStoreNames.contains('photoData')) db.createObjectStore('photoData');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t) => new Promise((res, rej) => {
  t.oncomplete = () => res();
  t.onerror = () => rej(t.error);
  t.onabort = () => rej(t.error || new Error('Transaction aborted'));
});

export async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function getAllByIndex(store, index, value) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).index(index).getAll(IDBKeyRange.only(value)));
}

export async function put(store, value, key) {
  const db = await openDB();
  const t = db.transaction(store, 'readwrite');
  if (key === undefined) t.objectStore(store).put(value);
  else t.objectStore(store).put(value, key);
  return done(t);
}

export async function del(store, key) {
  const db = await openDB();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).delete(key);
  return done(t);
}

/** Run several writes across stores atomically: fn(os) where os(name) returns an object store. */
export async function transact(stores, fn) {
  const db = await openDB();
  const t = db.transaction(stores, 'readwrite');
  fn((name) => t.objectStore(name));
  return done(t);
}

/**
 * db.js — IndexedDB wrapper for Timetable Generator
 * All CRUD operations + schema versioning
 */
const DB = (() => {
  const DB_NAME = 'TimetableGeneratorDB';
  const DB_VER  = 3;
  let _db = null;

  const STORES = {
    faculty:    { key:'id',           indexes:['name'] },
    subjects:   { key:'code',         indexes:['name','type'] },
    rooms:      { key:'id',           indexes:['type'] },
    classes:    { key:'id',           indexes:['section'] },
    settings:   { key:'key',          indexes:[] },
    timetable:  { key:'generationId', indexes:[] },
    genLog:     { key:'id',           indexes:['timestamp'] },
  };

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        Object.entries(STORES).forEach(([name, conf]) => {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: conf.key });
            conf.indexes.forEach(idx => store.createIndex(idx, idx, { unique: false }));
          }
        });
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async function tx(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const result = fn(store);
      if (result && typeof result.onsuccess !== 'undefined') {
        result.onsuccess = e => resolve(e.target.result);
        result.onerror   = e => reject(e.target.error);
      } else {
        transaction.oncomplete = () => resolve(result);
        transaction.onerror    = e  => reject(e.target.error);
      }
    });
  }

  async function getAll(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readonly');
      const req = t.objectStore(store).getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function getOne(store, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readonly');
      const req = t.objectStore(store).get(key);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function put(store, record) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const req = t.objectStore(store).put(record);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function del(store, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const req = t.objectStore(store).delete(key);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function clear(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const req = t.objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror   = e  => reject(e.target.error);
    });
  }

  async function count(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readonly');
      const req = t.objectStore(store).count();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ─── Settings helpers ─────────────────────────────────────────
  async function getSetting(key, defaultVal) {
    const rec = await getOne('settings', key);
    return rec ? rec.value : defaultVal;
  }
  async function setSetting(key, value) {
    return put('settings', { key, value });
  }

  // ─── Default settings seed ────────────────────────────────────
  async function seedDefaults() {
    const existing = await getOne('settings','workingDays');
    if (!existing) {
      await setSetting('workingDays', 5);
      await setSetting('periodsPerDay', 7);
      await setSetting('periodDuration', 50);
      await setSetting('breakAfter', 2);
      await setSetting('lunchAfter', 4);
      await setSetting('labConsecutive', 3);
    }
  }

  return { open, getAll, getOne, put, del, clear, count, getSetting, setSetting, seedDefaults };
})();

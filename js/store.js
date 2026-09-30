/*
 * Local storage: an append-only event log plus photo/media blobs in IndexedDB.
 * The current state is a projection of the log (Engine.project). Nothing here uses the network.
 */
(function (root) {
  'use strict';
  const E = root.Engine;
  const U = root.U;
  const DB_NAME = 'orbit';
  const MAX_IMPORT_BYTES = 400 * 1024 * 1024;

  let db = null;
  let volatile = false; // true when IndexedDB is unavailable and data lives only in memory
  let events = [];
  let state = E.project([]);
  const mem = { media: new Map(), meta: new Map(), seq: 0 };
  const listeners = new Set();
  let settings = null;

  const DEFAULT_SETTINGS = {
    liftUnit: 'lb', bodyUnit: 'kg', lenUnit: 'in', distUnit: 'auto', waterUnit: 'auto', blurPhotos: true, lockEnabled: false, lockMinutes: 2,
    reminder: 'weekly', checkinDay: 5, foodDiet: 'auto', encryptBackups: true, includeMediaInBackup: false, lastBackupAt: null,
    coach: { provider: 'anthropic', model: '', baseUrl: '', keyMode: 'device' },
    restTimer: true, logRpe: true, logWarmups: false, logNotes: true,
    activeGoal: 0, // active days per week that keep a streak going; 0 means "use the number of training days in the profile"
    onboardedAt: null,
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'seq', autoIncrement: true });
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB error'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }
  function run(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const st = t.objectStore(store);
      let result;
      const r = fn(st);
      if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    });
  }

  async function init() {
    try { db = await openDb(); } catch (e) { volatile = true; db = null; }
    if (!volatile) {
      events = (await run('events', 'readonly', (st) => st.getAll())) || [];
      const s = await run('meta', 'readonly', (st) => st.get('settings'));
      settings = Object.assign({}, DEFAULT_SETTINGS, s ? s.v : {});
      settings.coach = Object.assign({}, DEFAULT_SETTINGS.coach, (s && s.v && s.v.coach) || {});
    } else {
      settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    events.sort((a, b) => a.seq - b.seq);
    state = E.project(events);
    return { volatile };
  }
  function notify() { for (const fn of listeners) { try { fn(state); } catch (e) { /* listener errors must not break storage */ } } }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  async function append(type, data, src) {
    const ev = { ts: new Date().toISOString(), type, data, src: src || 'user' };
    if (volatile) { ev.seq = ++mem.seq; } else { ev.seq = await run('events', 'readwrite', (st) => st.add(ev)); }
    events.push(ev);
    state = E.project(events);
    notify();
    return ev;
  }
  async function voidEvent(seq) { return append('event_voided', { target: seq }); }
  function getState() { return state; }
  function getEvents() { return events; }
  function isVolatile() { return volatile; }

  // ---------- settings and meta ----------
  function getSettings() { return settings; }
  async function saveSettings(patch) {
    settings = Object.assign({}, settings, patch);
    if (patch && patch.coach) settings.coach = Object.assign({}, DEFAULT_SETTINGS.coach, patch.coach);
    await setMeta('settings', settings);
    return settings;
  }
  async function getMeta(k) {
    if (volatile) return mem.meta.get(k);
    const r = await run('meta', 'readonly', (st) => st.get(k));
    return r ? r.v : undefined;
  }
  async function setMeta(k, v) {
    if (volatile) { mem.meta.set(k, v); return; }
    await run('meta', 'readwrite', (st) => st.put({ k, v }));
  }
  async function delMeta(k) {
    if (volatile) { mem.meta.delete(k); return; }
    await run('meta', 'readwrite', (st) => st.delete(k));
  }

  // ---------- media (photos, later clips) ----------
  async function putMedia(id, blob, info) {
    const rec = Object.assign({ id, blob, type: blob.type, size: blob.size, ts: new Date().toISOString() }, info || {});
    if (volatile) { mem.media.set(id, rec); return rec; }
    await run('media', 'readwrite', (st) => st.put(rec));
    return rec;
  }
  async function getMedia(id) {
    if (volatile) return mem.media.get(id) || null;
    return (await run('media', 'readonly', (st) => st.get(id))) || null;
  }
  async function delMedia(id) {
    if (volatile) { mem.media.delete(id); return; }
    await run('media', 'readwrite', (st) => st.delete(id));
  }
  async function allMedia() {
    if (volatile) return Array.from(mem.media.values());
    return (await run('media', 'readonly', (st) => st.getAll())) || [];
  }

  // ---------- backup / restore ----------
  async function buildBackup(opts) {
    const o = opts || {};
    const payload = {
      orbit: 1, kind: 'backup', exportedAt: new Date().toISOString(),
      events: events.map((e) => ({ seq: e.seq, ts: e.ts, type: e.type, data: e.data, src: e.src })),
      settings: Object.assign({}, settings, { coach: Object.assign({}, settings.coach, { keyMode: 'session' }), lastBackupAt: null }),
      media: [],
    };
    // Library previews are tiny, so they always go in. Progress photos and library full-photo copies only when asked, because they make the file much larger.
    for (const m of await allMedia()) {
      if (m.kind !== 'thumb' && !o.media) continue;
      const buf = await m.blob.arrayBuffer();
      payload.media.push({ id: m.id, type: m.type, week: m.week, angle: m.angle, kind: m.kind === 'thumb' ? 'thumb' : m.kind === 'full' ? 'full' : undefined, ts: m.ts, b64: U.b64(buf) });
    }
    const text = JSON.stringify(payload);
    if (o.passphrase) return JSON.stringify(await root.Crypt.encryptText(text, o.passphrase));
    return text;
  }
  function safeParse(text) {
    if (text.length > MAX_IMPORT_BYTES) throw new Error('That file is too large to be an Regoal backup.');
    return JSON.parse(text);
  }
  // Returns {kind:'backup'|'profile'|'encrypted', ...}. Never applies anything by itself.
  async function readImport(text, passphrase) {
    let obj = safeParse(text);
    if (root.Crypt.isEnvelope(obj)) {
      if (!passphrase) return { kind: 'encrypted' };
      obj = safeParse(await root.Crypt.decryptText(obj, passphrase));
    }
    if (!obj || obj.orbit !== 1) throw new Error('This does not look like an Regoal file.');
    if (E.hasBadKeys(obj, 0)) throw new Error('This file contains unsafe keys and was not opened.');
    if (obj.kind === 'profile') {
      if (!obj.answers || typeof obj.answers !== 'object') throw new Error('Profile file is missing its answers.');
      return { kind: 'profile', answers: obj.answers };
    }
    if (obj.kind !== 'backup') throw new Error('Unknown Regoal file type.');
    const bad = E.validateEvents(obj.events);
    if (bad) throw new Error(bad);
    return { kind: 'backup', payload: obj };
  }
  async function applyBackup(payload) {
    const evs = payload.events.slice().sort((a, b) => a.seq - b.seq);
    for (const e of evs) if (!Number.isInteger(e.seq) || e.seq < 1) throw new Error('Bad event numbering.');
    if (!volatile) {
      await run('events', 'readwrite', (st) => st.clear());
      await run('media', 'readwrite', (st) => st.clear());
      await run('events', 'readwrite', (st) => { for (const e of evs) st.put(e); });
    } else { mem.media.clear(); mem.seq = evs.length ? evs[evs.length - 1].seq : 0; }
    events = evs;
    for (const m of payload.media || []) {
      const blob = new Blob([U.unb64(m.b64)], { type: /^image\/(jpeg|png|webp)$/.test(m.type) ? m.type : 'image/jpeg' });
      await putMedia(String(m.id).slice(0, 120), blob, m.kind === 'thumb' ? { kind: 'thumb' } : m.kind === 'full' ? { kind: 'full' } : { week: m.week, angle: m.angle });
    }
    if (payload.settings && typeof payload.settings === 'object') {
      const keep = { lastBackupAt: settings.lastBackupAt, lockEnabled: settings.lockEnabled };
      // Where this device keeps the AI key is a property of the device, not of the backup.
      keep.coach = Object.assign({}, DEFAULT_SETTINGS.coach, payload.settings.coach, { keyMode: settings.coach.keyMode });
      await saveSettings(Object.assign({}, DEFAULT_SETTINGS, payload.settings, keep));
    }
    state = E.project(events);
    notify();
  }

  async function eraseAll() {
    try { if (db) db.close(); } catch (e) { /* ignore */ }
    await new Promise((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* ignore */ }
    if (root.caches) { for (const k of await caches.keys()) await caches.delete(k); }
    if (navigator.serviceWorker) { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); }
  }
  async function storageInfo() {
    const out = { usage: null, quota: null, persisted: null };
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); out.usage = e.usage; out.quota = e.quota; } } catch (e) { /* ignore */ }
    try { if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted(); } catch (e) { /* ignore */ }
    return out;
  }
  async function requestPersist() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; } }

  root.Store = {
    init, subscribe, append, voidEvent, getState, getEvents, isVolatile, getSettings, saveSettings, getMeta, setMeta, delMeta,
    putMedia, getMedia, delMedia, allMedia, buildBackup, readImport, applyBackup, eraseAll, storageInfo, requestPersist, DEFAULT_SETTINGS,
  };
})(self);

/*
 * Only does anything inside the Android app (the Capacitor shell, see docs/ANDROID.md). In a normal browser or an
 * installed PWA this file changes nothing: isApp() is false and every other file behaves exactly as before.
 *
 * Why it exists: Android's WebView cannot save a downloaded blob and has no Web Share API, so the comparison image,
 * the time-lapse, the reel and backups would otherwise go nowhere. Here a file is written to the app's private cache
 * folder and handed to Android's own share sheet (Save to Files, Drive, Photos, WhatsApp...). Nothing is uploaded and
 * the copy in the cache is replaced by the next save.
 */
(function (root) {
  'use strict';
  const DIR = 'regoal-share';
  const CHUNK = 3 * 262144; // a multiple of 3 bytes, so each piece is valid base64 on its own; keeps a long video out of memory

  function plugins() {
    const c = root.Capacitor;
    if (!c || typeof c.isNativePlatform !== 'function' || !c.isNativePlatform()) return null;
    const p = c.Plugins || {};
    return p.Filesystem && p.Share ? p : null;
  }
  const isApp = () => !!plugins();
  const safeName = (n) => String(n || 'regoal-file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'regoal-file';
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // Resolves 'shared' or 'cancelled'; rejects if the file could not be written or the share sheet failed.
  async function shareFile(blob, name) {
    const p = plugins();
    if (!p) throw new Error('This only works inside the Android app.');
    const path = DIR + '/' + safeName(name);
    try { await p.Filesystem.rmdir({ path: DIR, directory: 'CACHE', recursive: true }); } catch (e) { /* nothing there yet */ }
    let uri = null;
    for (let at = 0; at < Math.max(1, blob.size); at += CHUNK) {
      const data = b64(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
      if (at === 0) uri = (await p.Filesystem.writeFile({ path, data, directory: 'CACHE', recursive: true })).uri;
      else await p.Filesystem.appendFile({ path, data, directory: 'CACHE' });
    }
    try {
      await p.Share.share({ title: name, files: [uri], dialogTitle: 'Save or share' });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(String((e && (e.message || e.name)) || e))) return 'cancelled';
      throw e;
    }
  }

  root.Native = { isApp, shareFile };
})(self);

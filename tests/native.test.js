'use strict';
// The Android app has no Web Share API and cannot save a downloaded blob, so Native writes the file to the app cache
// and hands it to Android's share sheet. In a browser it must do nothing at all.
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.self = globalThis;
require('../js/native.js');
const Native = globalThis.Native;

function fakeApp(shareImpl) {
  const calls = { writes: [], appends: [], rmdirs: [], shares: [] };
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      Filesystem: {
        rmdir: async (o) => { calls.rmdirs.push(o); },
        writeFile: async (o) => { calls.writes.push(o); return { uri: 'file:///cache/' + o.path }; },
        appendFile: async (o) => { calls.appends.push(o); },
      },
      Share: { share: async (o) => { calls.shares.push(o); if (shareImpl) return shareImpl(o); return {}; } },
    },
  };
  return calls;
}
test.afterEach(() => { delete globalThis.Capacitor; });

test('in a normal browser nothing is native and sharing is refused', async () => {
  assert.equal(Native.isApp(), false);
  await assert.rejects(Native.shareFile(new Blob(['x']), 'a.png'), /Android app/);
  globalThis.Capacitor = { isNativePlatform: () => false, Plugins: {} };
  assert.equal(Native.isApp(), false);
});

test('in the app a file is written to the cache under a safe name and passed to the share sheet', async () => {
  const calls = fakeApp();
  const r = await Native.shareFile(new Blob(['hello']), 'regoal compare/front?.png');
  assert.equal(r, 'shared');
  assert.equal(Native.isApp(), true);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].path, 'regoal-share/regoal_compare_front_.png');
  assert.equal(calls.writes[0].directory, 'CACHE');
  assert.equal(Buffer.from(calls.writes[0].data, 'base64').toString(), 'hello');
  assert.deepEqual(calls.shares[0].files, ['file:///cache/regoal-share/regoal_compare_front_.png']);
  assert.equal(calls.rmdirs[0].path, 'regoal-share', 'the previous share is cleared first so the cache never piles up');
});

test('a big file goes in pieces that rebuild the exact bytes', async () => {
  const calls = fakeApp();
  const bytes = new Uint8Array(3 * 262144 * 2 + 1000).map((_, i) => (i * 31) % 251);
  await Native.shareFile(new Blob([bytes]), 'reel.mp4');
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.appends.length, 2);
  const joined = Buffer.concat([calls.writes[0], ...calls.appends].map((c) => Buffer.from(c.data, 'base64')));
  assert.ok(joined.equals(Buffer.from(bytes)), 'every byte survives the chunking');
  assert.ok(calls.appends.every((a) => a.path === calls.writes[0].path));
});

test('closing the share sheet is a cancel, any other failure is an error', async () => {
  fakeApp(() => { throw new Error('Share canceled'); });
  assert.equal(await Native.shareFile(new Blob(['x']), 'a.png'), 'cancelled');
  fakeApp(() => { throw new Error('No app can share this'); });
  await assert.rejects(Native.shareFile(new Blob(['x']), 'a.png'), /No app can share/);
});

test('an empty file still writes one (empty) piece instead of nothing', async () => {
  const calls = fakeApp();
  await Native.shareFile(new Blob([]), 'empty.txt');
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].data, '');
});

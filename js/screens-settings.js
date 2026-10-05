/* Privacy, backup, restore, app lock, units, plan settings and erase. */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store, Crypt = root.Crypt;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};
  const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

  // ---------- getting a file out of the app ----------
  // One backup file with one fixed name, so a new backup replaces the old one wherever the browser lets it:
  // in a chosen folder (Chrome or Edge on a computer) the old file is replaced and any older Regoal backup files are deleted;
  // in the iPhone or iPad Files sheet, saving under the same name offers Replace. A browser cannot delete files any other way.
  const BACKUP_NAME = 'regoal-backup.regoalbackup';
  const OURS = /^(regoal|orbit)-.*\.(regoal|orbit)backup$/;
  const canPickFolder = () => typeof root.showDirectoryPicker === 'function' && root.isSecureContext;
  async function writeToFolder(dir, name, blob) {
    let perm = await dir.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await dir.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return null;
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(blob); await w.close(); // the new file is complete before anything old is removed
    let removed = 0;
    for await (const [n, entry] of dir.entries()) {
      if (entry.kind === 'file' && n !== name && OURS.test(n)) { try { await dir.removeEntry(n); removed++; } catch (e) { /* leave it */ } }
    }
    return { removed };
  }
  async function deliver(name, text) {
    const blob = new Blob([text], { type: 'application/octet-stream' });
    if (canPickFolder()) {
      let dir = null; try { dir = await Store.getMeta('backupDir'); } catch (e) { /* none */ }
      if (dir && dir.kind === 'directory') {
        try { const r = await writeToFolder(dir, name, blob); if (r) { deliver.removed = r.removed; return 'folder'; } } catch (e) { /* fall through to the normal save */ }
      }
    }
    if (root.Native && root.Native.isApp()) { // the Android app: no Web Share or blob download, so use Android's share sheet
      try { return await root.Native.shareFile(blob, name); } catch (e) { /* fall through to the browser ways below */ }
    }
    const file = new File([blob], name, { type: 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    if (root.showSaveFilePicker) {
      try {
        const fh = await root.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Regoal backup', accept: { 'application/octet-stream': ['.regoalbackup'] } }] });
        const w = await fh.createWritable(); await w.write(blob); await w.close();
        return 'saved';
      } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    return 'downloaded';
  }
  Screens._ = Object.assign(Screens._ || {}, { deliver });

  function backupSheet() {
    const set = Store.getSettings();
    let encrypt = set.encryptBackups && Crypt.hasCrypto(), media = !!set.includeMediaInBackup;
    const pass = UI.field({ label: 'Passphrase', type: 'password', hint: '8 or more characters. If you lose it the backup cannot be opened, by anyone.' });
    const pass2 = UI.field({ label: 'Repeat passphrase', type: 'password' });
    const passBox = h('div', { class: 'stack' }, pass, pass2);
    passBox.classList.toggle('hidden', !encrypt);
    const body = h('div', { class: 'stack' },
      UI.toggleRow('Encrypt with a passphrase', Crypt.hasCrypto() ? 'AES-256. Strongly recommended, since the file holds all your data.' : 'Needs a secure (https or localhost) page.', encrypt, (v) => { encrypt = v && Crypt.hasCrypto(); passBox.classList.toggle('hidden', !encrypt); }),
      passBox,
      UI.toggleRow('Include progress and library photos', 'Makes the file much larger', media, (v) => { media = v; }),
      h('div', { class: 'muted small' }, 'Your API key is never included.'));
    U.sheet('Back up', body, [{ label: 'Cancel' }, { label: 'Prepare file', kind: 'primary', run: () => {
      if (encrypt && (pass.input.value.length < 8 || pass.input.value !== pass2.input.value)) { U.toast('Passphrases must match and be 8 or more characters.', 'warn'); return false; }
      const pw = encrypt ? pass.input.value : null;
      (async () => {
        try {
          U.toast('Preparing...');
          const text = await Store.buildBackup({ media, passphrase: pw });
          await Store.saveSettings({ encryptBackups: encrypt, includeMediaInBackup: media });
          const name = BACKUP_NAME;
          const mb = (text.length / 1048576);
          U.sheet('Backup ready', h('div', { class: 'stack' }, h('div', { class: 'muted' }, name + ' · ' + (mb < 0.1 ? '<0.1' : U.num(mb, 1)) + ' MB' + (encrypt ? ' · encrypted' : ' · NOT encrypted')),
            h('div', { class: 'muted small' }, 'Next, save it on this device. It always uses the same file name, so choose Replace if your phone asks. ' + (encrypt ? '' : 'This file holds all your data in readable form. Keep it somewhere private.'))),
          [{ label: 'Close' }, { label: 'Save or share', kind: 'primary', keep: true, run: async (closeIt) => { const r = await deliver(name, text); if (r !== 'cancelled') { await Store.saveSettings({ lastBackupAt: new Date().toISOString() }); U.toast(r === 'folder' ? (deliver.removed ? 'Backed up. The old backup was replaced.' : 'Backed up to your backup folder.') : r === 'downloaded' ? 'Downloaded. Move it somewhere safe.' : 'Backed up.'); closeIt(); root.App.render(); } } }]);
        } catch (e) { U.toast(String(e.message || e), 'warn'); }
      })();
    } }]);
  }

  // ---------- getting a file in ----------
  function cleanProfile(a) {
    const bad = (m) => { throw new Error('Profile file: ' + m); };
    const rng = (x, lo, hi, what) => { const n = Number(x); if (!Number.isFinite(n) || n < lo || n > hi) bad(what + ' is out of range.'); return n; };
    const one = (x, list, what) => { if (!list.includes(x)) bad(what + ' is not recognised.'); return x; };
    const str = (x, n) => String(x == null ? '' : x).replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
    const out = {
      name: str(a.name, 40), sex: one(a.sex, ['male', 'female', 'other'], 'sex'), age: rng(a.age, 14, 90, 'age'), heightCm: rng(a.heightCm, 120, 230, 'height'), weightKg: rng(a.weightKg, 35, 250, 'weight'),
      bodyFatPct: a.bodyFatPct == null ? null : rng(a.bodyFatPct, 3, 60, 'body fat'),
      units: { body: one(a.units && a.units.body, ['kg', 'lb'], 'body unit'), length: one(a.units && a.units.length, ['cm', 'in'], 'length unit'), lift: one(a.units && a.units.lift, ['lb', 'kg'], 'lift unit') },
      measurements: {}, goal: one(a.goal, ['build', 'recomp', 'cut'], 'goal'),
      days: Array.from(new Set((Array.isArray(a.days) ? a.days : []).map((d) => Math.round(Number(d))))).filter((d) => d >= 0 && d <= 6),
      sessionMin: rng(a.sessionMin || 60, 20, 240, 'session length'), timeOfDay: one(a.timeOfDay || 'AM', ['AM', 'Noon', 'PM'], 'time of day'), diet: str(a.diet || 'Vegetarian', 20), creatine: !!a.creatine,
      currentKcal: a.currentKcal == null ? null : rng(a.currentKcal, 500, 10000, 'current calories'), currentProtein: a.currentProtein == null ? null : rng(a.currentProtein, 0, 600, 'current protein'),
      startLighter: !!a.startLighter, startDate: U.today(), lifts: [],
    };
    if (out.days.length < 2 || out.days.length > 6) bad('training days must be 2 to 6.');
    for (const [site] of E.MEAS_SITES) if (a.measurements && a.measurements[site] != null) out.measurements[site] = E.clean(rng(a.measurements[site], 10, 250, site));
    if (!out.measurements.waist) bad('waist is required.');
    const t = a.training || {};
    out.training = {
      experience: str(t.experience || '1-3 yrs', 20), split: one(t.split || 'auto', ['auto', 'ppl', 'ul', 'bodypart', 'fullbody'], 'split'), equipment: (Array.isArray(t.equipment) ? t.equipment : []).slice(0, 8).map((x) => str(x, 20)),
      dbStep: t.dbStep == null ? null : rng(t.dbStep, 0.5, 20, 'dumbbell step'), machineStep: t.machineStep == null ? null : rng(t.machineStep, 0.5, 40, 'machine step'),
      focus: (Array.isArray(t.focus) ? t.focus : []).slice(0, 3).map((x) => str(x, 20).toLowerCase()), injuries: (Array.isArray(t.injuries) ? t.injuries : ['Nothing']).slice(0, 6).map((x) => str(x, 20)),
      repStyle: one(t.repStyle || 'mixed', ['heavy', 'mixed', 'pump'], 'rep style'), sets: rng(t.sets || 3, 1, 8, 'sets'), rest: str(t.rest || '90 s', 10), deload: one(t.deload || 'planned', ['planned', 'feel', 'never'], 'deload'),
      logRpe: t.logRpe !== false, restTimer: t.restTimer !== false, warmups: !!t.warmups, notes: t.notes !== false,
    };
    for (const l of (Array.isArray(a.lifts) ? a.lifts : []).slice(0, 30)) {
      if (!l || !l.on) continue;
      const custom = /^c_[a-z0-9_]{1,40}$/.test(String(l.id));
      if (!custom && !E.CATALOG[l.id]) bad('unknown lift ' + str(l.id, 20) + '.');
      const item = { id: l.id, on: true, weight: l.weight == null ? undefined : rng(l.weight, 0, 2000, 'lift weight'), reps: l.reps == null ? null : rng(l.reps, 1, 100, 'lift reps') };
      if (custom) { item.name = str(l.name, 40); item.muscle = one(l.muscle, ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'], 'muscle'); item.equip = one(l.equip, ['db', 'machine', 'barbell', 'bw'], 'equipment'); item.cls = 'medium'; item.gain = 0.25; }
      out.lifts.push(item);
    }
    return out;
  }

  async function importFile(file) {
    try {
      if (file.size > 400 * 1024 * 1024) throw new Error('That file is too large to be an Regoal file.');
      const text = await file.text();
      let r = await Store.readImport(text);
      if (r.kind === 'encrypted') {
        const pass = UI.field({ label: 'Passphrase', type: 'password' });
        await new Promise((resolve) => {
          U.sheet('Encrypted backup', h('div', { class: 'stack' }, pass), [{ label: 'Cancel', run: () => resolve() }, { label: 'Open', kind: 'primary', run: () => {
            Store.readImport(text, pass.input.value).then((x) => { r = x; resolve(); }).catch((e) => { U.toast(e.message, 'warn'); r = null; resolve(); });
          } }]);
        });
        if (!r || r.kind === 'encrypted') return;
      }
      const st = Store.getState();
      if (r.kind === 'profile') {
        if (st.profile) throw new Error('This device already has a profile. Erase it first, or use a backup file instead.');
        const a = cleanProfile(r.answers);
        U.sheet('Start from this profile?', h('div', { class: 'stack' }, h('div', { class: 'muted' }, 'A profile file holds your answers, not your history. Regoal will build a fresh 26-week plan starting today.')), [{ label: 'Cancel' }, { label: 'Build my plan', kind: 'primary', run: () => { root.Onboard.finish(a).catch((e) => U.toast(e.message, 'warn')); } }]);
        return;
      }
      const p = r.payload;
      const counts = 'Contains ' + p.events.length + ' entries and ' + (p.media || []).length + ' photos (exported ' + String(p.exportedAt || '').slice(0, 10) + ').';
      U.sheet('Restore this backup?', h('div', { class: 'stack' }, h('div', { class: 'muted' }, counts), h('div', { class: st.profile ? 'warnbox' : 'muted small' }, st.profile ? 'This replaces everything currently on this device. Consider making a backup first.' : 'Your plan, logs and settings will be restored on this device.')), [{ label: 'Cancel' }, { label: 'Restore', kind: st.profile ? 'danger' : 'primary', run: () => {
        Store.applyBackup(p).then(() => { U.toast('Restored.'); root.App.go('#/today'); }).catch((e) => U.toast(e.message, 'warn'));
      } }]);
    } catch (e) { U.toast(String(e && e.message ? e.message : e).slice(0, 220), 'warn'); }
  }
  Screens.importFile = importFile;

  // ---------- app lock ----------
  function pinSheet() {
    if (!Crypt.hasCrypto()) return U.toast('Needs a secure (https or localhost) page.', 'warn');
    const a = UI.field({ label: 'New passcode (4 to 8 digits)', type: 'password', inputmode: 'numeric', maxlength: 8 });
    const b = UI.field({ label: 'Repeat passcode', type: 'password', inputmode: 'numeric', maxlength: 8 });
    U.sheet('Set a passcode', h('div', { class: 'stack' }, a, b, h('div', { class: 'muted small' }, 'This keeps casual snoopers out of the app. It is not encryption: someone with your unlocked device and browser tools could still read the stored data. Use a device passcode for that, and encrypted backups for copies.')), [{ label: 'Cancel' }, { label: 'Turn on', kind: 'primary', run: () => {
      if (!/^\d{4,8}$/.test(a.input.value) || a.input.value !== b.input.value) { U.toast('Use 4 to 8 digits and repeat them exactly.', 'warn'); return false; }
      (async () => { await Store.setMeta('pin', await Crypt.hashPin(a.input.value)); await Store.saveSettings({ lockEnabled: true }); U.toast('Passcode on.'); root.App.render(); })();
    } }]);
  }
  function pinOffSheet() {
    const a = UI.field({ label: 'Passcode', type: 'password', inputmode: 'numeric', maxlength: 8 });
    U.sheet('Turn off passcode', h('div', { class: 'stack' }, a), [{ label: 'Cancel' }, { label: 'Turn off', kind: 'danger', run: () => {
      (async () => {
        const rec = await Store.getMeta('pin');
        if (rec && !(await Crypt.verifyPin(a.input.value, rec))) return U.toast('That is not your passcode.', 'warn');
        await Store.delMeta('pin'); await Store.saveSettings({ lockEnabled: false }); U.toast('Passcode off.'); root.App.render();
      })();
    } }]);
  }

  function eraseSheet() {
    const t = UI.field({ label: 'Type ERASE to confirm', placeholder: 'ERASE' });
    U.sheet('Erase everything?', h('div', { class: 'stack' }, h('div', { class: 'muted' }, 'This deletes your plan, logs, photos, settings and any saved key from this device, and clears the offline copy of the app. It cannot be undone. Make a backup first if you might want anything back.'), t), [{ label: 'Cancel' }, { label: 'Erase', kind: 'danger', run: () => {
      if (t.input.value !== 'ERASE') { U.toast('Type ERASE exactly to continue.', 'warn'); return false; }
      (async () => { root.App.clearKey(); await Store.eraseAll(); location.hash = ''; location.reload(); })();
    } }]);
  }

  function fmtBytes(b) { if (b == null) return 'unknown'; return b < 1048576 ? Math.round(b / 1024) + ' KB' : U.num(b / 1048576, 1) + ' MB'; }

  // Chrome and Edge on a computer can remember a folder. Every backup then replaces the old file in it.
  function folderRow() {
    if (!canPickFolder()) return h('div', { class: 'muted small' }, 'This browser cannot delete old backups for you. Your backup always uses the same file name, so the Files sheet on iPhone offers Replace. In Chrome or Edge on a computer you can pick a folder and Regoal replaces the old file for you.');
    const box = h('div', { class: 'stack' });
    const draw = async () => {
      let dir = null; try { dir = await Store.getMeta('backupDir'); } catch (e) { /* none */ }
      U.clear(box);
      if (dir && dir.kind === 'directory') {
        U.put(box, h('div', { class: 'kv' }, h('span', null, 'Backup folder'), h('b', null, dir.name)),
          h('div', { class: 'muted small' }, 'Each backup replaces the old ' + BACKUP_NAME + ' here and removes any older Regoal backup files in this folder. Other files are never touched.'),
          h('div', { class: 'row' }, UI.btn('Change folder', { kind: 'quiet', block: false, onClick: pick }), UI.btn('Stop using it', { kind: 'quiet', block: false, onClick: async () => { await Store.delMeta('backupDir'); draw(); } })));
      } else {
        U.put(box, UI.btn('Choose a backup folder', { kind: 'quiet', icon: 'file', onClick: pick }), h('div', { class: 'muted small' }, 'Optional. Regoal then replaces the old backup in that folder each time, so only one stays.'));
      }
    };
    const pick = async () => {
      try { const d = await root.showDirectoryPicker({ mode: 'readwrite', id: 'regoal-backups' }); await Store.setMeta('backupDir', d); U.toast('Backups will go to ' + d.name + '.'); draw(); }
      catch (e) { if (!e || e.name !== 'AbortError') U.toast('Could not use that folder.', 'warn'); }
    };
    draw();
    return box;
  }

  Screens.settings = function () {
    const set = Store.getSettings(), st = Store.getState();
    const days = set.lastBackupAt ? E.daysBetween(set.lastBackupAt.slice(0, 10), U.today()) : null;
    const fileIn = h('input', { type: 'file', class: 'hidden', accept: '.regoalbackup,.orbitbackup,.json,application/json,application/octet-stream', 'aria-label': 'Choose a backup file', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); } });
    const info = h('div', { class: 'meter' }, h('div', { class: 'muted small' }, 'Checking storage...'));
    Store.storageInfo().then((si) => { U.clear(info); U.put(info, h('div', { class: 'kv' }, h('span', null, 'Used'), h('b', null, fmtBytes(si.usage) + (si.quota ? ' of ' + fmtBytes(si.quota) : ''))), h('div', { class: 'kv' }, h('span', null, 'Kept if the browser is low on space'), h('b', null, si.persisted == null ? 'unknown' : si.persisted ? 'Yes' : 'Not guaranteed'))); });
    const saveAnd = (patch) => Store.saveSettings(patch).then(() => root.App.render());
    return UI.page(UI.header('Privacy and backup', 'Your data, your device, your file.', { back: '#/today' }), UI.scroller(
      UI.card(h('div', { class: 'ct' }, 'Backup'),
        h('div', { class: days == null || days > 7 ? 'warnbox' : 'muted' }, set.lastBackupAt ? (days === 0 ? 'Last backup: today.' : 'Last backup ' + days + ' day' + (days === 1 ? '' : 's') + ' ago.') : 'No backup yet. Browsers can clear site data, especially Safari after a week of not opening the app. A backup file is your safety net.'),
        UI.btn('Back up now', { icon: 'download', onClick: backupSheet }),
        h('div', { class: 'muted small' }, 'Back up now saves one file on this device and nothing else: Regoal never uploads it anywhere. On iPhone the Save sheet appears, so choose Save to Files, then On My iPhone. On a computer it goes to the folder you choose above, or to Downloads.'),
        folderRow(),
        UI.btn('Restore from a file', { kind: 'quiet', icon: 'file', onClick: () => fileIn.click() }), fileIn),
      UI.card(h('div', { class: 'ct' }, 'App lock'),
        UI.toggleRow('Passcode', set.lockEnabled ? 'On. Locks after ' + set.lockMinutes + ' min away.' : 'Off', !!set.lockEnabled, (v) => { if (v) pinSheet(); else pinOffSheet(); setTimeout(() => root.App.render(), 0); }),
        set.lockEnabled ? UI.seg({ label: 'Lock after being away for', options: [{ value: 1, label: '1 min' }, { value: 2, label: '2 min' }, { value: 5, label: '5 min' }, { value: 15, label: '15 min' }], value: set.lockMinutes, onChange: (v) => { Store.saveSettings({ lockMinutes: Number(v) }); } }) : null,
        set.lockEnabled ? UI.btn('Lock now', { kind: 'quiet', icon: 'lock', onClick: () => root.App.showLock() }) : null),
      UI.card(h('div', { class: 'ct' }, 'Units'),
        UI.seg({ label: 'Body weight', options: ['kg', 'lb'], value: set.bodyUnit, onChange: (v) => saveAnd({ bodyUnit: v }) }),
        UI.seg({ label: 'Lifts', options: ['lb', 'kg'], value: set.liftUnit, onChange: (v) => saveAnd({ liftUnit: v }) }),
        UI.seg({ label: 'Measurements', options: ['in', 'cm'], value: set.lenUnit, onChange: (v) => saveAnd({ lenUnit: v }) }),
        UI.seg({ label: 'Distance', options: [{ value: 'auto', label: 'Auto' }, { value: 'km', label: 'km' }, { value: 'mi', label: 'mi' }], value: set.distUnit || 'auto', onChange: (v) => saveAnd({ distUnit: v }) }),
        UI.seg({ label: 'Water', options: [{ value: 'auto', label: 'Auto' }, { value: 'ml', label: 'ml' }, { value: 'oz', label: 'fl oz' }], value: set.waterUnit || 'auto', onChange: (v) => saveAnd({ waterUnit: v }) }),
        h('div', { class: 'muted small' }, 'Everything is stored in kg and cm, so switching never loses precision. Auto follows Measurements (or, for Water, Body weight). Swimming shows metres under km and yards under mi, switching to km or mi itself past about 3 km.')),
      UI.card(h('div', { class: 'ct' }, 'Logging'),
        UI.toggleRow('Effort per set (RPE)', null, !!set.logRpe, (v) => { Store.saveSettings({ logRpe: v }); }),
        UI.toggleRow('Rest timer', null, !!set.restTimer, (v) => { Store.saveSettings({ restTimer: v }); }),
        UI.toggleRow('Warm-up sets', null, !!set.logWarmups, (v) => { Store.saveSettings({ logWarmups: v }); }),
        UI.toggleRow('Notes on sets', null, !!set.logNotes, (v) => { Store.saveSettings({ logNotes: v }); }),
        UI.toggleRow('Blur photo thumbnails', null, !!set.blurPhotos, (v) => { Store.saveSettings({ blurPhotos: v }); })),
      UI.card(h('div', { class: 'ct' }, 'Plan and coach'),
        h('a', { class: 'listrow', href: '#/settings/plan' }, U.icon('chart', 20), h('div', { class: 'grow' }, h('b', null, 'Targets, goal and history')), U.icon('chev', 16)),
        h('a', { class: 'listrow', href: '#/coach/setup' }, U.icon('key', 20), h('div', { class: 'grow' }, h('b', null, 'Coach and API key')), U.icon('chev', 16))),
      UI.card(h('div', { class: 'ct' }, 'Storage'), info, h('div', { class: 'muted small' }, 'On iPhone, add Regoal to your Home Screen (Share, then Add to Home Screen). Safari can delete the data of sites you have not opened for about a week, and Home Screen apps are treated better.')),
      UI.card(h('div', { class: 'ct' }, 'What Regoal does and does not do'),
        h('div', { class: 'muted small' }, 'No account, no server, no analytics, no ads, no cookies. Data lives in this browser\'s storage. The only network calls are AI requests you trigger, straight to the provider you chose. Everything on screen is written as plain text, and a strict content policy blocks scripts from anywhere else.')),
      UI.card(h('div', { class: 'ct' }, 'Danger zone'), UI.btn('Erase everything on this device', { kind: 'danger', onClick: eraseSheet })),
      st.profile && st.profile.name ? null : null));
  };

  // ---------- plan settings ----------
  Screens.planSettings = function () {
    const st = Store.getState(), plan = st.plan, set = Store.getSettings();
    const kg = st.weights.length ? st.weights[st.weights.length - 1].kg : st.profile.weightKg;
    const editTargets = () => {
      const kc = UI.field({ label: 'Calories', unit: 'kcal', type: 'number', value: plan.kcal, flex: 1 });
      const pr = UI.field({ label: 'Protein', unit: 'g', type: 'number', value: plan.protein, flex: 1 });
      U.sheet('Edit daily targets', h('div', { class: 'stack' }, UI.row(kc, pr), h('div', { class: 'muted small' }, 'Changes are limited to 300 kcal at a time, and protein to 1.4 to 3.0 g per kg, so a typo cannot wreck your plan. Carbs follow automatically.')), [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', run: () => {
        const v = E.validateMacroChange(plan, kg, { kcal: numOrNull(kc.input.value), protein: numOrNull(pr.input.value) });
        if (!v.ok) { U.toast(v.errors[0], 'warn'); return false; }
        Store.append('plan_revised', { reason: 'Edited targets by hand', changes: v.value }, 'user').then(() => { U.toast('Updated.'); root.App.render(); });
      } }]);
    };
    const revs = st.revisions.slice().reverse().slice(0, 10);
    return UI.page(UI.header('Plan', 'Targets, goal and history', { back: '#/settings' }), UI.scroller(
      UI.card(h('div', { class: 'ct' }, 'Daily targets · ' + plan.goal),
        h('div', { class: 'kv' }, h('span', null, 'Calories'), h('b', null, U.withCommas(plan.kcal))), h('div', { class: 'kv' }, h('span', null, 'Protein'), h('b', null, plan.protein + ' g')),
        h('div', { class: 'kv' }, h('span', null, 'Carbs'), h('b', null, plan.carbs + ' g')), h('div', { class: 'kv' }, h('span', null, 'Fat'), h('b', null, plan.fat + ' g')),
        h('div', { class: 'kv' }, h('span', null, 'Estimated maintenance'), h('b', null, U.withCommas(plan.maintenance))),
        UI.btn('Edit targets', { kind: 'quiet', onClick: editTargets })),
      UI.card(h('div', { class: 'ct' }, 'Diet plan'), h('div', { class: 'muted small' }, 'A week of meals with gram portions that fit these targets, built on this device from your eating preferences.'), ...Screens.dietSummaryRows(), Screens.dietCardLinks()),
      UI.card(h('div', { class: 'ct' }, 'Plan length'), h('div', { class: 'muted small' }, 'Week ' + E.clamp(E.weekOf(plan.startDate, U.today()), 1, E.planWeeks(plan)) + ' of ' + E.planWeeks(plan) + ' (' + root.Goals.lengthText(E.planWeeks(plan)) + '). Make it longer or shorter any time; your history stays.'),
        UI.btn('Change length', { kind: 'quiet', onClick: Screens.planLengthSheet }), UI.btn('Goals', { kind: 'quiet', href: '#/goals' })),
      UI.card(h('div', { class: 'ct' }, 'Change goal'), h('div', { class: 'muted small' }, 'Regenerates calories, macros and measurement targets. Your logs stay.'),
        UI.row(...['build', 'recomp', 'cut'].map((g) => UI.btn(g[0].toUpperCase() + g.slice(1), { kind: g === plan.goal ? 'primary' : 'quiet', onClick: () => { if (g !== plan.goal) Screens.switchGoalSheet(g, 'Switched goal by hand', 'user'); } })))),
      UI.card(h('div', { class: 'ct' }, 'History'), ...(revs.length ? revs.map((r) => h('div', { class: 'kv' }, h('span', null, U.shortDate(r.ts.slice(0, 10)) + ' · ' + r.src), h('b', null, String(r.reason || 'Changed').slice(0, 60), ' ', h('button', { class: 'chip line', type: 'button', onclick: async () => { await Store.voidEvent(r.seq); root.App.render(); } }, 'Undo')))) : [h('div', { class: 'muted' }, 'No changes yet.')]))));
  };
})(self);

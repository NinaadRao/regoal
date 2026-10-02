/*
 * Photo trend (scrub or play through your check-ins, with the numbers of each day) and Compare (any two dates).
 * Photos are read from this device only; nothing here leaves it. The saving sheets live in screens-export.js.
 */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};

  const T = { angle: null, week: null, reveal: false, speed: 1, aligning: false };     // trend screen, kept while you move around
  const CMP = { angle: null, a: null, b: null, mode: 'slider', pos: 0.5, blend: 0.5, reveal: false, aligning: false, pick: 'a' };
  const SPEEDS = [1, 2, 0.5];
  let urls = [], gen = 0, timer = null;

  // One decimal everywhere on these screens, so columns line up: 82.0, -1.0, +0.7.
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const signed = (x) => { const v = Math.round(x * 10) / 10; return (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toFixed(1); };
  // Check-ins are labelled by their date, never by a week number. SLOT maps an internal check-in index to that date.
  const SLOT = {};
  const wk = (w) => (SLOT[w] ? U.shortDate(SLOT[w]) : '');
  function setSlots(st, set, cis) { for (const c of cis) SLOT[c.week] = c.date || E.checkinDate(st.plan.startDate, c.week, set.checkinDay); }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function revokeUrls() { for (const u of urls) URL.revokeObjectURL(u); urls = []; }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; }

  // The angle with the most photos, unless you already picked one.
  function trendAngle(st) {
    if (T.angle) return T.angle;
    let best = 'Front', n = 0;
    for (const a of E.ANGLES) { const c = st.photos.filter((p) => p.angle === a).length; if (c > n) { best = a; n = c; } }
    return best;
  }
  async function loadUrls(items, into, myGen) {
    for (const c of items) {
      const m = await Store.getMedia(c.photo.id);
      if (myGen !== gen) return false;
      if (m) { const u = URL.createObjectURL(m.blob); urls.push(u); into[c.week] = u; }
    }
    return true;
  }
  // Pointer drag along an element's width; calls onMove with the pointer event.
  function dragX(el, onMove) {
    let down = false;
    el.addEventListener('pointerdown', (e) => { if (e.button > 0) return; down = true; try { el.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } onMove(e); });
    el.addEventListener('pointermove', (e) => { if (down) onMove(e); });
    const up = () => { down = false; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  // ---------- manual photo alignment (drag to pan, wheel/pinch or +/- to zoom) ----------
  // Not all photos line up the same way, so Trend and Compare let you nudge one into place; the result
  // is saved per photo (debounced, so a drag doesn't spam the event log) and remembered next time.
  const alignTimers = Object.create(null);
  function commitAlign(id, a) {
    clearTimeout(alignTimers[id]);
    alignTimers[id] = setTimeout(() => { Store.append('photo_aligned', { id, dx: a.dx, dy: a.dy, scale: a.scale }); }, 500);
  }
  function applyAlign(img, a) { img.style.transform = 'translate(' + (a.dx * 100).toFixed(2) + '%, ' + (a.dy * 100).toFixed(2) + '%) scale(' + a.scale.toFixed(3) + ')'; }
  function zoomBy(a, mult) { a.scale = Math.round(clamp(a.scale * mult, 1, 4) * 1000) / 1000; }
  // Binds pan-drag and wheel/pinch-zoom to `img`. `draft` is an { id, dx, dy, scale } object the caller
  // owns and keeps current for whichever photo `img` is showing; `active()` gates the gesture so the
  // same wiring can sit inert until align mode is switched on, and stays out of the way of other drags
  // (like the compare slider's reveal handle) when it is off.
  function wireAlign(img, draft, active) {
    let down = false, sx = 0, sy = 0, startDx = 0, startDy = 0, w = 1, hh = 1;
    img.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || !active()) return;
      down = true; sx = e.clientX; sy = e.clientY; startDx = draft.dx; startDy = draft.dy;
      const r = img.getBoundingClientRect(); w = r.width || 1; hh = r.height || 1;
      try { img.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      e.preventDefault(); e.stopPropagation();
    });
    img.addEventListener('pointermove', (e) => {
      if (!down) return;
      draft.dx = clamp(startDx + (e.clientX - sx) / w, -1, 1);
      draft.dy = clamp(startDy + (e.clientY - sy) / hh, -1, 1);
      applyAlign(img, draft);
    });
    const end = () => { if (!down) return; down = false; commitAlign(draft.id, draft); };
    img.addEventListener('pointerup', end); img.addEventListener('pointercancel', end);
    // A drag still ends with a synthetic click on this element; swallow it so it can't also trigger
    // whatever the image's ancestor does on tap (Trend's stage toggles blur reveal on a plain click).
    img.addEventListener('click', (e) => { if (active()) { e.preventDefault(); e.stopPropagation(); } });
    img.addEventListener('wheel', (e) => {
      if (!active()) return;
      e.preventDefault();
      zoomBy(draft, 1 - e.deltaY * 0.0012);
      applyAlign(img, draft); commitAlign(draft.id, draft);
    }, { passive: false });
  }
  // A compact "- Reset +" row for the photo currently being aligned, plus the Align toggle itself.
  function alignRow(on, toggle, draft, after) {
    const zoom = (mult) => { zoomBy(draft, mult); after(); commitAlign(draft.id, draft); };
    const reset = () => { draft.dx = 0; draft.dy = 0; draft.scale = 1; after(); commitAlign(draft.id, draft); };
    return h('div', { class: 'row alignrow' },
      h('button', { type: 'button', class: 'chip line', onclick: toggle }, on ? 'Done aligning' : 'Align photo'),
      on ? h('button', { type: 'button', class: 'chip line', 'aria-label': 'Zoom out', onclick: () => zoom(1 / 1.15) }, '−') : null,
      on ? h('button', { type: 'button', class: 'chip line', onclick: reset }, 'Reset') : null,
      on ? h('button', { type: 'button', class: 'chip line', 'aria-label': 'Zoom in', onclick: () => zoom(1.15) }, '+') : null,
      on ? h('div', { class: 'muted small' }, 'Drag the photo to line it up. Scroll/pinch or use +/− to zoom.') : null);
  }
  function anglePills(onPick) {
    const box = UI.pills({ items: E.ANGLES, values: new Set([T.angle]), multi: false, onChange: (v) => onPick(Array.from(v)[0]) });
    box.classList.add('hscroll');
    return box;
  }

  // The number a stat card shows for a check-in, in the person's units.
  const KEYS = {
    weight: { label: 'Weight', of: (c) => (c.snap ? c.snap.weightKg : null), show: (v, set) => f1(U.kgToUnit(v, set.bodyUnit)), unit: (set) => set.bodyUnit, diff: (d, set) => U.kgToUnit(d, set.bodyUnit) },
  };
  for (const [site, label] of E.MEAS_SITES) KEYS[site] = { label, of: (c) => (c.snap ? c.snap.meas[site] : null), show: (v, set) => f1(U.cmToUnit(v, set.lenUnit)), unit: (set) => set.lenUnit, diff: (d, set) => U.cmToUnit(d, set.lenUnit) };

  // Rows of the before/after table, shared by the compare screen and the saved image.
  function compareRows(st, ca, cb, set) {
    const rows = [];
    for (const key of ['weight'].concat(E.MEAS_SITES.map((s) => s[0]))) {
      const K = KEYS[key], a = K.of(ca), b = K.of(cb);
      if (a == null && b == null) continue;
      const both = a != null && b != null, d = both ? b - a : null, u = K.unit(set);
      rows.push({
        name: K.label, a: a == null ? '—' : K.show(a, set) + ' ' + u, b: b == null ? '—' : K.show(b, set) + ' ' + u,
        change: both ? signed(K.diff(d, set)) + ' ' + u : '—', tone: both ? E.changeTone(d, E.goalDir(st.plan, key)) : '',
      });
    }
    return rows;
  }
  const numbersText = (snap, set) => {
    if (!snap) return '';
    const p = [];
    if (snap.weightKg != null) p.push(KEYS.weight.show(snap.weightKg, set) + ' ' + set.bodyUnit);
    if (snap.meas.waist != null) p.push(KEYS.waist.show(snap.meas.waist, set) + ' ' + set.lenUnit);
    return p.join(' · ');
  };

  // ---------- Photo trend ----------
  Screens.photoTrend = function () {
    revokeUrls(); stopTimer();
    const myGen = ++gen;
    const st = Store.getState(), set = Store.getSettings();
    if (!T.angle) T.angle = trendAngle(st);
    const angle = T.angle;
    const curWeek = E.clamp(E.weekOf(st.plan.startDate, U.today()), 1, E.planWeeks(st.plan));
    const cis = E.checkIns(st, angle, curWeek), have = cis.filter((c) => c.photo), n = cis.length;
    setSlots(st, set, cis);
    const pills = anglePills((a) => { T.angle = a; T.week = null; T.reveal = false; root.App.render(); });
    const back = { back: '#/photos' };

    if (!have.length) {
      return UI.page(UI.header('Photo trend', angle + ' · no photos yet', back), UI.scroller(pills,
        UI.card(h('div', { class: 'muted' }, 'You have no ' + angle + ' photos yet. Add one at a check-in and it shows up here.'), UI.btn('Open photo check-in', { href: '#/photos', kind: 'quiet' }))));
    }
    if (!have.find((c) => c.week === T.week)) T.week = have[have.length - 1].week;

    // stage
    const blurOn = !!set.blurPhotos;
    const img = h('img', { class: 'stage-img', alt: '' });
    const badge = h('span', { class: 'stage-badge' });
    const eye = h('span', { class: 'stage-eye' }, U.icon('eye', 30));
    const cap = h('span', { class: 'stage-cap' });
    const stage = h(blurOn ? 'button' : 'div', blurOn ? { type: 'button', class: 'stage', onclick: () => { T.reveal = !T.reveal; update(); } } : { class: 'stage' }, img, blurOn ? badge : null, blurOn ? eye : null, cap);

    // alignment: drag to pan, wheel/pinch or +/- to zoom — per photo, remembered next time
    const tDraft = { id: null, dx: 0, dy: 0, scale: 1 };
    wireAlign(img, tDraft, () => T.aligning);
    const alignBox = h('div', null);

    // numbers under the photo
    const third = ['chest', 'shoulders', 'bicepL', 'hips'].find((k) => have.some((c) => KEYS[k].of(c) != null)) || 'chest';
    const keys = ['weight', 'waist', third];
    const cards = keys.map((k) => ({ k, lab: h('span', { class: 'tl' }, KEYS[k].label), val: h('b', null), unit: h('small', null), delta: h('div', { class: 'td' }) }));
    const statRow = h('div', { class: 'tstats' }, cards.map((c) => h('div', { class: 'tstat' }, c.lab, h('div', { class: 'tv' }, c.val, c.unit), c.delta)));
    const note = h('div', { class: 'muted small' }, 'Change since ' + wk(have[0].week) + '. Green means toward your goal.');

    // scrubber
    const line = h('div', { class: 'scrub-line' }, h('div', { class: 'scrub-fill' }));
    const every = Math.max(1, Math.ceil(n / 5)); // about five date labels along the line, so they never overlap
    const showLabel = (i) => i === 0 || i === n - 1 || (i % every === 0 && n - 1 - i >= every);
    const dotEls = cis.map((c, i) => h('span', { class: 'sdot' + (c.photo ? ' has' : '') + (showLabel(i) ? '' : ' nolab') + (i === 0 ? ' first' : i === n - 1 ? ' last' : '') }, h('i', { class: 'd' }), h('b', { class: 'w' }, wk(c.week))));
    const scrub = h('div', { class: 'scrub', role: 'slider', tabindex: '0', 'aria-label': 'Check-in', 'aria-valuemin': '0', 'aria-valuemax': String(n - 1) }, line, ...dotEls);
    scrub.style.setProperty('--n', String(n)); if (n > 14) scrub.classList.add('dense');
    const idxOf = (w) => cis.findIndex((c) => c.week === w);
    const nearestHave = (i) => { let best = null; for (const c of have) { const j = idxOf(c.week); if (best == null || Math.abs(j - i) < Math.abs(idxOf(best.week) - i)) best = c; } return best; };
    dragX(scrub, (e) => {
      const r = scrub.getBoundingClientRect();
      const i = clamp(Math.floor(((e.clientX - r.left) / r.width) * n), 0, n - 1);
      const c = nearestHave(i); if (c && c.week !== T.week) { stop(); pick(c.week); }
    });
    scrub.addEventListener('keydown', (e) => {
      const k = e.key; if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return;
      e.preventDefault(); stop();
      const cur = have.findIndex((c) => c.week === T.week);
      const to = k === 'Home' ? 0 : k === 'End' ? have.length - 1 : clamp(cur + (k === 'ArrowLeft' || k === 'ArrowDown' ? -1 : 1), 0, have.length - 1);
      pick(have[to].week);
    });
    const playBtn = h('button', { type: 'button', class: 'playbtn', 'aria-label': 'Play through the check-ins', onclick: () => (timer ? stop() : play()) });
    const speedBtn = h('button', { type: 'button', class: 'chip line speedchip', onclick: () => { T.speed = SPEEDS[(SPEEDS.indexOf(T.speed) + 1) % SPEEDS.length]; if (timer) { stopTimer(); startTimer(); } update(); } });
    const player = UI.card(h('div', { class: 'playrow' }, playBtn, scrub), h('div', { class: 'target-top' }, h('div', { class: 'muted small' }, have.length > 1 ? 'Drag to scrub, or play through every check-in.' : 'Add this angle at another check-in to play through them.'), speedBtn));

    // thumbnails
    const thumbEls = cis.map((c) => {
      if (!c.photo) return h('a', { href: '#/photos', class: 'tthumb none', 'aria-label': 'Add ' + angle + ' photo for ' + wk(c.week), onclick: () => Screens._.gotoWeek(c.week) }, h('span', { class: 'tbox' }, U.icon('plus', 18)), h('span', { class: 'tw' }, wk(c.week)));
      const im = h('img', { alt: '' });
      return Object.assign(h('button', { type: 'button', class: 'tthumb', 'aria-label': 'Show ' + wk(c.week), onclick: () => { stop(); pick(c.week); } }, h('span', { class: 'tbox' + (blurOn ? ' blur' : '') }, im), h('span', { class: 'tw' }, wk(c.week))), { im });
    });
    const strip = h('div', { class: 'tstrip' }, thumbEls);
    const chartBox = h('div', null);
    const chartCard = UI.card(h('div', { class: 'ct' }, 'Waist at each check-in'), chartBox);

    const enough = have.length >= 2;
    const foot = h('div', { class: 'foot' },
      UI.btn('Download time-lapse', { icon: 'download', disabled: !enough, onClick: () => Screens._.videoSheet({ angle, items: have, index: Math.max(0, have.findIndex((c) => c.week === T.week)), numbersText, wkLabel: (c) => U.longDate(c.date) }) }),
      UI.btn('Compare two dates', { href: '#/photos/compare', kind: 'quiet' }),
      enough ? null : h('div', { class: 'muted small centered' }, 'Add this angle at two check-ins to download or compare.'));

    const urlByWeek = {};
    let loaded = false;

    function pick(w) { T.week = w; update(); }
    function syncPlay() {
      const on = !!timer;
      U.clear(playBtn); playBtn.appendChild(U.icon(on ? 'pause' : 'chev', 26)); playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play through the check-ins');
      speedBtn.textContent = 'Speed ' + T.speed + 'x';
      playBtn.disabled = have.length < 2; speedBtn.disabled = have.length < 2;
    }
    function stop() { stopTimer(); syncPlay(); }
    function startTimer() {
      timer = setInterval(() => {
        if (!stage.isConnected) return stopTimer();
        const i = have.findIndex((c) => c.week === T.week);
        if (i >= have.length - 1) return stop();
        pick(have[i + 1].week);
      }, 1300 / T.speed);
    }
    function play() {
      if (have.length < 2) return;
      if (T.week === have[have.length - 1].week) T.week = have[0].week;
      startTimer(); update();
    }
    function update() {
      const cur = cis.find((c) => c.week === T.week), ci = idxOf(T.week), url = urlByWeek[T.week];
      const hidden = blurOn && !T.reveal;
      if (url) { if (img.getAttribute('src') !== url) img.src = url; } else img.removeAttribute('src');
      img.alt = angle + ', ' + wk(cur.week);
      if (tDraft.id !== cur.photo.id) { Object.assign(tDraft, E.photoAlignFor(st, cur.photo.id)); applyAlign(img, tDraft); }
      img.style.touchAction = T.aligning && !hidden ? 'none' : '';
      U.clear(alignBox);
      if (!hidden) alignBox.appendChild(alignRow(T.aligning, () => { T.aligning = !T.aligning; update(); }, tDraft, () => applyAlign(img, tDraft)));
      else if (T.aligning) T.aligning = false;
      stage.classList.toggle('blur', hidden);
      badge.textContent = hidden ? 'Blurred · tap to reveal' : 'Tap to blur';
      eye.classList.toggle('hidden', !hidden);
      stage.setAttribute('aria-label', hidden ? 'Reveal photo' : 'Blur photo');
      cap.textContent = loaded && !url ? 'This photo is not on this device' : U.longDate(cur.date);
      // scrubber
      scrub.setAttribute('aria-valuenow', String(ci)); scrub.setAttribute('aria-valuetext', U.longDate(cur.date));
      line.firstChild.style.width = (n > 1 ? (ci / (n - 1)) * 100 : 0) + '%';
      cis.forEach((c, i) => { dotEls[i].classList.toggle('cur', i === ci); dotEls[i].classList.toggle('past', i < ci); });
      thumbEls.forEach((t, i) => { if (!cis[i].photo) return; t.classList.toggle('cur', i === ci); const u = urlByWeek[cis[i].week]; if (u && t.im.getAttribute('src') !== u) t.im.src = u; });
      // numbers
      for (const c of cards) {
        const K = KEYS[c.k], v = K.of(cur), first = have.find((x) => K.of(x) != null);
        c.val.textContent = v == null ? '—' : K.show(v, set); c.unit.textContent = v == null ? '' : ' ' + K.unit(set);
        c.delta.className = 'td'; c.delta.textContent = '';
        if (v != null && first && first.week !== cur.week) {
          const d = v - K.of(first), tone = E.changeTone(d, E.goalDir(st.plan, c.k));
          c.delta.textContent = signed(K.diff(d, set)) + ' ' + K.unit(set); if (tone) c.delta.classList.add(tone);
        } else if (v != null) c.delta.textContent = 'Starting point';
        else c.delta.textContent = 'Not logged near this date';
      }
      // waist chart
      const pts = have.filter((c) => KEYS.waist.of(c) != null).map((c) => ({ x: c.week, y: U.cmToUnit(KEYS.waist.of(c), set.lenUnit) }));
      const here = pts.filter((p) => p.x === cur.week);
      U.clear(chartBox);
      chartBox.appendChild(pts.length ? U.lineChart({ label: 'Waist at each check-in', xs: [1, Math.max(2, n)], series: [{ pts, color: U.PAL.cool }, { pts, color: U.PAL.cool, dots: true, line: false }, { pts: here, color: U.PAL.acc, dots: true, line: false, r: 5.5 }], xLabel: (x) => wk(x), fmtY: (y) => U.num(y, 1) })
        : h('div', { class: 'muted' }, 'Log your waist near a check-in and it appears here.'));
      syncPlay();
    }

    update();
    loadUrls(have, urlByWeek, myGen).then((ok) => { if (ok) { loaded = true; update(); } });

    return UI.page(UI.header('Photo trend', angle + ' · ' + have.length + ' of ' + n + ' weekly check-ins', back), UI.scroller(pills, stage, alignBox, statRow, note, player, strip, chartCard), foot);
  };

  // ---------- Compare two dates ----------
  Screens.photoCompare = function () {
    revokeUrls(); stopTimer();
    const myGen = ++gen;
    const st = Store.getState(), set = Store.getSettings();
    if (!T.angle) T.angle = trendAngle(st);
    const angle = T.angle, cis = E.checkIns(st, angle), have = cis.filter((c) => c.photo);
    setSlots(st, set, cis);
    const head = UI.header('Compare', angle + ' · pick any two check-ins', { back: '#/photos/trend' });
    if (have.length < 2) {
      return UI.page(head, UI.scroller(UI.card(h('div', { class: 'muted' }, 'Add ' + angle + ' photos at two check-ins to compare them.'), UI.btn('Open photo check-in', { href: '#/photos', kind: 'quiet' }))));
    }
    if (CMP.angle !== angle || !have.find((c) => c.week === CMP.a) || !have.find((c) => c.week === CMP.b)) { CMP.angle = angle; CMP.a = have[0].week; CMP.b = have[have.length - 1].week; CMP.reveal = false; }
    const byWeek = (w) => have.find((c) => c.week === w);
    const urlByWeek = {};
    const blurOn = !!set.blurPhotos;

    const selectFor = (which, label) => {
      const s = h('select', { class: 'inp', 'aria-label': label, onchange: () => { CMP[which] = Number(s.value); redraw(); } },
        ...have.map((c) => h('option', { value: String(c.week), selected: c.week === CMP[which] }, U.longDate(c.date))));
      return h('label', { class: 'field flex' }, h('span', { class: 'lab' }, label), h('span', { class: 'selbox' }, s));
    };
    const modeSeg = UI.seg({ options: [{ value: 'side', label: 'Side by side' }, { value: 'slider', label: 'Slider' }, { value: 'overlay', label: 'Overlay' }], value: CMP.mode, onChange: (v) => { CMP.mode = v; redraw(); } });
    const stageBox = h('div', { class: 'cmpwrap' });
    const help = h('div', { class: 'muted small' });
    const tableBox = h('div', null);
    const badge = h('button', { type: 'button', class: 'stage-badge cmpbadge', onclick: () => { CMP.reveal = !CMP.reveal; redraw(); } });
    const foot = h('div', { class: 'foot' });
    let loaded = false;

    const pill = (t, side) => h('span', { class: 'cmplabel ' + side }, t);
    const photo = (w, cls) => { const im = h('img', { class: cls || '', alt: angle + ', ' + wk(w) }); const u = urlByWeek[w]; if (u) im.src = u; return im; };

    // alignment: drag to pan, wheel/pinch or +/- to zoom — per photo, remembered next time. Live drafts are
    // kept here (not re-read from `st`, which is a stale snapshot) so a drag isn't undone by the next redraw.
    const liveDrafts = Object.create(null);
    const draftFor = (id) => liveDrafts[id] || (liveDrafts[id] = Object.assign({ id }, E.photoAlignFor(st, id)));
    function photoAligned(w, cls, pickKey) {
      const c = byWeek(w), im = photo(w, cls), draft = draftFor(c.photo.id);
      applyAlign(im, draft);
      const active = () => CMP.aligning && (pickKey == null || CMP.pick === pickKey);
      im.style.touchAction = active() ? 'none' : '';
      wireAlign(im, draft, active);
      return im;
    }
    const alignCtl = h('div', null);
    // AI auto-align: an opt-in suggestion only, shown live and editable, never written until accepted.
    // Regoal never sends progress photos to AI anywhere else — this is the one explicit exception, and
    // only for the two photos the person is actively comparing, only when they ask for it here.
    function autoAlignSheet(ca, cb) {
      const state = { busy: null, err: '', ai: null };
      const body = h('div', { class: 'stack' });
      let before = null, applied = false;
      function drawIntro() {
        if (!root.App.aiReady()) {
          U.put(U.clear(body), h('div', { class: 'muted' }, 'Auto-align asks your own AI provider to suggest a pan and zoom for the After photo. Add a key first, or just drag and zoom it by hand instead.'),
            UI.btn('Add your key', { onClick: () => { close(); root.Screens.keySheet(() => {}); } }));
          return;
        }
        const cfg = root.App.llmConfig();
        let host = ''; try { host = new URL(root.LLM.endpointOf(cfg)).host; } catch (e) { host = 'your provider'; }
        const errBox = state.err ? h('div', { class: 'warnbox', role: 'alert' }, state.err) : null;
        const go = h('button', { type: 'button', class: 'btn primary block' }, state.busy ? 'Stop' : 'Send these two photos');
        if (state.busy) go.insertBefore(h('span', { class: 'spin' }), go.firstChild);
        go.addEventListener('click', async () => {
          if (state.busy) { state.busy.abort(); return; }
          const ctl = new AbortController();
          state.busy = ctl; state.err = ''; drawIntro();
          try {
            const [ma, mb] = await Promise.all([Store.getMedia(ca.photo.id), Store.getMedia(cb.photo.id)]);
            if (!ma || !mb) throw new Error('One of these photos is not on this device.');
            const [ba, bb] = await Promise.all([root.Library.toB64(ma.blob), root.Library.toB64(mb.blob)]);
            const r = await root.PhotoAlignAI.suggest(cfg, { before: { mime: ma.type || 'image/jpeg', b64: ba }, after: { mime: mb.type || 'image/jpeg', b64: bb }, signal: ctl.signal });
            if (state.busy !== ctl) return;
            state.busy = null; state.ai = r; drawConfirm();
          } catch (e) {
            if (state.busy !== ctl) return;
            state.busy = null;
            state.err = e && e.name === 'AbortError' ? 'Stopped.' : String(e && e.message ? e.message : e).slice(0, 300);
            drawIntro();
          }
        });
        U.put(U.clear(body), h('div', { class: 'muted small' }, 'Regoal never sends progress photos to AI on its own. This sends just these two check-in photos, once, to ' + host + ' with your key, to suggest how to line up the After photo. Nothing is saved until you accept it.'),
          errBox, go);
      }
      function drawConfirm() {
        const v = state.ai.value, draft = draftFor(cb.photo.id);
        before = { dx: draft.dx, dy: draft.dy, scale: draft.scale };
        Object.assign(draft, { dx: v.dx, dy: v.dy, scale: v.scale });
        CMP.aligning = true; CMP.pick = 'b';
        redraw();
        const okBtn = h('button', { type: 'button', class: 'btn primary block' }, 'Use this');
        okBtn.addEventListener('click', () => { applied = true; commitAlign(draft.id, draft); close(); });
        const kids = [h('div', { class: 'muted small' }, 'Shown live on the After photo above. Drag or zoom it further if it is not quite right, then use it.')];
        if (v.assumptions.length) kids.push(h('ul', { class: 'assume' }, ...v.assumptions.map((a) => h('li', null, a))));
        kids.push(okBtn, UI.btn('Discard suggestion', { kind: 'quiet', onClick: () => { applied = true; Object.assign(draft, before); redraw(); close(); } }));
        U.put(U.clear(body), ...kids);
      }
      drawIntro();
      const close = U.sheet('Auto-align with AI', body, [{ label: 'Cancel', run: () => { if (!applied && before) { Object.assign(draftFor(cb.photo.id), before); redraw(); } if (state.busy) state.busy.abort(); } }]);
    }

    function alignPanel(ca, cb) {
      U.clear(alignCtl);
      alignCtl.appendChild(h('div', { class: 'row alignrow' }, h('button', { type: 'button', class: 'chip line', onclick: () => { CMP.aligning = !CMP.aligning; redraw(); } }, CMP.aligning ? 'Done aligning' : 'Align photos')));
      if (!CMP.aligning) return;
      alignCtl.appendChild(h('div', { class: 'row' }, UI.btn('Auto-align with AI', { kind: 'quiet', onClick: () => autoAlignSheet(ca, cb) })));
      if (CMP.mode === 'side') {
        const draftA = draftFor(ca.photo.id), draftB = draftFor(cb.photo.id);
        const zoomPair = (label, draft) => h('div', { class: 'row space' },
          h('span', { class: 'muted small' }, label),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'chip line', 'aria-label': 'Zoom out ' + label, onclick: () => { zoomBy(draft, 1 / 1.15); commitAlign(draft.id, draft); redraw(); } }, '−'),
            h('button', { type: 'button', class: 'chip line', 'aria-label': 'Zoom in ' + label, onclick: () => { zoomBy(draft, 1.15); commitAlign(draft.id, draft); redraw(); } }, '+')));
        alignCtl.appendChild(zoomPair('Before', draftA));
        alignCtl.appendChild(zoomPair('After', draftB));
        const resetBoth = () => {
          for (const c of [ca, cb]) { const d = draftFor(c.photo.id); d.dx = 0; d.dy = 0; d.scale = 1; commitAlign(d.id, d); }
          redraw();
        };
        alignCtl.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'chip line', onclick: resetBoth }, 'Reset both')));
        alignCtl.appendChild(h('div', { class: 'muted small' }, 'Drag either photo to line it up, or use the +/− above to zoom it. Send both to AI for a suggested fit.'));
      } else {
        const pickSeg = UI.seg({ options: [{ value: 'a', label: 'Before' }, { value: 'b', label: 'After' }], value: CMP.pick, onChange: (v) => { CMP.pick = v; redraw(); } });
        const picked = CMP.pick === 'a' ? ca : cb, draft = draftFor(picked.photo.id);
        const zoom = (mult) => { zoomBy(draft, mult); commitAlign(draft.id, draft); redraw(); };
        const reset = () => { draft.dx = 0; draft.dy = 0; draft.scale = 1; commitAlign(draft.id, draft); redraw(); };
        alignCtl.appendChild(h('div', { class: 'row' }, pickSeg));
        alignCtl.appendChild(h('div', { class: 'row' },
          h('button', { type: 'button', class: 'chip line', 'aria-label': 'Zoom out', onclick: () => zoom(1 / 1.15) }, '−'),
          h('button', { type: 'button', class: 'chip line', onclick: reset }, 'Reset'),
          h('button', { type: 'button', class: 'chip line', 'aria-label': 'Zoom in', onclick: () => zoom(1.15) }, '+')));
        alignCtl.appendChild(h('div', { class: 'muted small' }, 'Drag the ' + (CMP.pick === 'a' ? 'Before' : 'After') + ' photo to line it up, or use +/−.'));
      }
    }

    function redraw() {
      const ca = byWeek(CMP.a), cb = byWeek(CMP.b), hidden = blurOn && !CMP.reveal;
      U.clear(stageBox);
      const la = U.longDate(ca.date), lb = U.longDate(cb.date);
      if (CMP.mode === 'side') {
        stageBox.appendChild(h('div', { class: 'cmp-side' + (hidden ? ' blur' : '') }, h('div', { class: 'cmp-cell' }, photoAligned(ca.week, null, null), pill(wk(ca.week), 'l')), h('div', { class: 'cmp-cell' }, photoAligned(cb.week, null, null), pill(wk(cb.week), 'l'))));
        help.textContent = 'Same pose, same light. Look at the same spots on both.';
      } else if (CMP.mode === 'slider') {
        const clip = h('div', { class: 'cmp-clip' }, photoAligned(ca.week, null, 'a'));
        const handle = h('div', { class: 'cmp-handle', role: 'slider', tabindex: '0', 'aria-label': 'Compare position', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { class: 'knob2' }, U.icon('swap', 20)));
        const box = h('div', { class: 'cmp-slider' + (hidden ? ' blur' : ''), 'data-testid': 'cmp-slider' }, photoAligned(cb.week, null, 'b'), clip, handle, pill(la, 'l'), pill(lb, 'r'));
        const set2 = (p) => { CMP.pos = clamp(p, 0, 1); clip.style.clipPath = 'inset(0 ' + (100 - CMP.pos * 100) + '% 0 0)'; handle.style.left = CMP.pos * 100 + '%'; handle.setAttribute('aria-valuenow', String(Math.round(CMP.pos * 100))); };
        if (!CMP.aligning) dragX(box, (e) => { const r = box.getBoundingClientRect(); set2((e.clientX - r.left) / r.width); });
        handle.addEventListener('keydown', (e) => { const step = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0; if (!step) return; e.preventDefault(); set2(CMP.pos + step); });
        set2(CMP.pos);
        stageBox.appendChild(box);
        help.textContent = CMP.aligning ? 'Dragging the picked photo lines it up instead of moving the reveal line.' : 'Drag the handle across. Overlay blends the two so you can line up your pose.';
      } else {
        const over = photoAligned(cb.week, 'cmp-over', 'b');
        over.style.opacity = String(CMP.blend);
        const box = h('div', { class: 'cmp-slider' + (hidden ? ' blur' : '') }, photoAligned(ca.week, null, 'a'), over, pill(la, 'l'), pill(lb, 'r'));
        const range = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(CMP.blend * 100)), class: 'range', 'aria-label': 'Blend', oninput: () => { CMP.blend = Number(range.value) / 100; over.style.opacity = String(CMP.blend); } });
        stageBox.appendChild(box); stageBox.appendChild(h('div', { class: 'blendrow' }, h('span', { class: 'muted small' }, wk(ca.week)), range, h('span', { class: 'muted small' }, wk(cb.week))));
        help.textContent = CMP.aligning ? 'Dragging the picked photo lines it up. The blend slider still works either way.' : 'Slide to fade from the first check-in to the second. Line up head and feet.';
      }
      if (blurOn) { badge.textContent = hidden ? 'Blurred · tap to reveal' : 'Tap to blur'; stageBox.appendChild(badge); }
      if (loaded && (!urlByWeek[ca.week] || !urlByWeek[cb.week])) help.textContent = 'One of these photos is not on this device (it was left out of the backup you restored).';
      alignPanel(ca, cb);

      const rows = compareRows(st, ca, cb, set);
      U.clear(tableBox);
      tableBox.appendChild(UI.card(
        h('div', { class: 'cmptable' },
          h('div', { class: 'cmprow head' }, h('span', null, 'Measure'), h('span', null, wk(ca.week)), h('span', null, wk(cb.week)), h('span', null, 'Change')),
          ...(rows.length ? rows.map((r) => h('div', { class: 'cmprow' }, h('b', null, r.name), h('span', null, r.a), h('b', null, r.b), h('b', { class: r.tone || 'muted' }, r.change))) : [h('div', { class: 'muted' }, 'Log a weight or measurement near these dates to see the change here.')]))));
      const different = ca.week !== cb.week;
      U.clear(foot);
      U.put(foot, UI.btn('Download image', { icon: 'download', disabled: !different, onClick: () => Screens._.imageSheet({ angle, a: ca, b: cb, rows, mode: CMP.mode, pos: CMP.pos, blend: CMP.blend, aligns: { a: draftFor(ca.photo.id), b: draftFor(cb.photo.id) } }) }),
        different ? null : h('div', { class: 'muted small centered' }, 'Pick two different check-ins to download a comparison.'));
    }

    redraw();
    loadUrls(have, urlByWeek, myGen).then((ok) => { if (ok) { loaded = true; redraw(); } });

    return UI.page(head, UI.scroller(h('div', { class: 'row' }, selectFor('a', 'Before'), selectFor('b', 'After')), modeSeg, stageBox, alignCtl, help, tableBox,
      h('div', { class: 'muted small' }, 'Photos stay on this device.' + (blurOn ? ' Blur is on until you reveal them.' : ''))), foot);
  };

  // Leaving these screens frees the photo URLs and stops any playback.
  window.addEventListener('hashchange', () => { if (!/^#\/photos\/(trend|compare)$/.test(location.hash)) { stopTimer(); revokeUrls(); gen++; } });

  Screens._ = Object.assign(Screens._ || {}, { trendAngle, compareRows, numbersText });
})(self);

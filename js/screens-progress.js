/* Progress (weight, measurements, food adherence, lifts) and Photos (5 angles at check-in weeks). */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};
  const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const signed = (x, d) => (x >= 0 ? '+' : '') + U.num(x, d == null ? 1 : d);

  function logWeightSheet() {
    const set = Store.getSettings();
    const v = UI.field({ label: 'Weight', unit: set.bodyUnit, type: 'number' });
    const d = UI.field({ label: 'Date', type: 'date', value: U.today(), max: U.today() });
    U.sheet('Log weight', h('div', { class: 'stack' }, UI.row(v, d)), [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', run: () => {
      const kg = numOrNull(v.input.value) == null ? null : U.unitToKg(numOrNull(v.input.value), set.bodyUnit);
      const date = d.input.value;
      if (!(kg >= 30 && kg <= 300)) { U.toast('Enter a weight between 30 and 300 kg.', 'warn'); return false; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > U.today()) { U.toast('Pick a date that is not in the future.', 'warn'); return false; }
      Store.append('weight_logged', { date, kg: E.clean(kg) }).then(() => root.App.render());
    } }]);
  }

  function logMeasSheet() {
    const st = Store.getState(), set = Store.getSettings(), lu = set.lenUnit;
    const fields = {};
    const grid = h('div', { class: 'grid2' });
    for (const [site, label] of E.MEAS_SITES) {
      const last = E.latestMeas(st.meas, site);
      fields[site] = UI.field({ label, unit: lu, type: 'number', placeholder: last ? U.fmtLen(last.cm, lu) : '' });
      grid.appendChild(fields[site]);
    }
    U.sheet('Log measurements', h('div', { class: 'stack' }, h('div', { class: 'muted small' }, 'Same spot, relaxed, morning. Fill in only what you measured today.'), grid), [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', run: () => {
      const todo = [];
      for (const [site] of E.MEAS_SITES) {
        const v = numOrNull(fields[site].input.value);
        if (v == null) continue;
        const cm = U.unitToCm(v, lu);
        if (!(cm >= 10 && cm <= 250)) { U.toast('One of those looks off. Check the unit.', 'warn'); return false; }
        todo.push([site, E.clean(cm)]);
      }
      if (!todo.length) { U.toast('Nothing to save.'); return false; }
      (async () => { for (const [site, cm] of todo) await Store.append('measurement_logged', { date: U.today(), site, cm }); U.toast('Saved.'); root.App.render(); })();
    } }]);
  }

  Screens.progress = function () {
    const st = Store.getState(), plan = st.plan, set = Store.getSettings(), t = U.today();
    const cur = E.clamp(E.weekOf(plan.startDate, t), 1, E.planWeeks(plan));
    const cards = [];

    // Weight
    const avg = E.avgWeightSeries(st.weights, 7);
    const dayX = (d) => E.daysBetween(plan.startDate, d);
    const first = st.weights.length ? st.weights[0] : null, lastAvg = avg.length ? avg[avg.length - 1] : null;
    const xs = st.weights.map((w) => dayX(w.date));
    const wchart = st.weights.length > 1 ? U.lineChart({ label: 'Body weight', xs, series: [{ pts: st.weights.map((w) => ({ x: dayX(w.date), y: U.kgToUnit(w.kg, set.bodyUnit) })), color: U.PAL.ink2, dots: true, line: false, r: 2.5 }, { pts: avg.map((w) => ({ x: dayX(w.date), y: U.kgToUnit(w.kg, set.bodyUnit) })), color: U.PAL.acc }], xLabel: (x) => U.shortDate(E.addDays(plan.startDate, x)), fmtY: (y) => U.num(y, 1) }) : null;
    cards.push(UI.card(
      h('div', { class: 'target-top' }, h('div', { class: 'ct' }, 'Body weight'), h('button', { class: 'chip line', type: 'button', onclick: logWeightSheet }, '+ Log')),
      lastAvg ? h('div', null, h('span', { class: 'display big' }, U.fmtWeight(lastAvg.kg, set.bodyUnit)), h('span', { class: 'muted unitbig' }, ' ' + set.bodyUnit + ' (7-day avg)'), first ? h('div', { class: 'muted small' }, signed(U.kgToUnit(lastAvg.kg - first.kg, set.bodyUnit), 1) + ' ' + set.bodyUnit + ' since you started') : null) : h('div', { class: 'muted' }, 'No weigh-ins yet.'),
      wchart, wchart ? h('div', { class: 'muted small' }, 'Grey dots: each weigh-in. Green line: 7-day average.') : null));

    // Measurements
    const rows = [];
    for (const [site, label] of E.MEAS_SITES) {
      const tg = plan.measTargets[site], latest = E.latestMeas(st.meas, site);
      if (!tg && !latest) continue;
      const start = tg ? tg.start : latest.cm;
      const now = latest ? latest.cm : start;
      const d = U.cmToUnit(now - start, set.lenUnit);
      const goodDir = tg ? (tg.target - start) : 0;
      const good = Math.abs(d) < 0.05 ? '' : (goodDir >= 0 ? d > 0 : d < 0) ? 'good' : 'coral';
      rows.push(h('div', { class: 'kv' }, h('span', null, label), h('b', null, U.fmtLen(start, set.lenUnit) + ' to ', U.fmtLen(now, set.lenUnit), tg ? h('span', { class: 'muted' }, '  (goal ' + U.fmtLen(tg.target, set.lenUnit) + ')') : null, ' ', good ? U.chip(signed(d) + ' ' + set.lenUnit, good) : null)));
      const readings = st.meas.filter((m) => m.site === site).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      if (readings.length > 1) {
        const mxs = readings.map((m) => E.daysBetween(plan.startDate, m.date));
        const series = [{ pts: readings.map((m, i) => ({ x: mxs[i], y: U.cmToUnit(m.cm, set.lenUnit) })), color: U.PAL.ink2, dots: true, r: 2.5 }];
        if (tg) series.unshift({ pts: [{ x: mxs[0], y: U.cmToUnit(tg.target, set.lenUnit) }, { x: mxs[mxs.length - 1], y: U.cmToUnit(tg.target, set.lenUnit) }], color: U.PAL.acc, dash: '5 4', width: 2 });
        rows.push(U.lineChart({ label: label + ' over time', xs: mxs, series, xLabel: (x) => U.shortDate(E.addDays(plan.startDate, x)), fmtY: (y) => U.num(y, 1) }));
      }
    }
    cards.push(UI.card(h('div', { class: 'target-top' }, h('div', { class: 'ct' }, 'Measurements'), h('button', { class: 'chip line', type: 'button', onclick: logMeasSheet }, '+ Log')),
      ...(rows.length ? rows : [h('div', { class: 'muted' }, 'No measurements yet.')]), h('div', { class: 'muted small' }, 'Start, latest and six-month goal in ' + set.lenUnit + '. Measure every two weeks; the tape matters more than the mirror. A site with two or more readings gets a chart, with your six-month goal shown as a dashed line.')));

    // Food adherence, last 14 days
    const days = [];
    for (let i = 14; i >= 1; i--) { const d = E.addDays(t, -i); const tot = E.dayTotals(st, d); days.push({ d, x: 14 - i, tot }); }
    const logged = days.filter((x) => x.tot.n);
    if (logged.length) {
      const avgK = logged.reduce((a, x) => a + x.tot.kcal, 0) / logged.length, avgP = logged.reduce((a, x) => a + x.tot.protein, 0) / logged.length;
      const macroChart = (label, key, target, color) => U.lineChart({ label: label + ' per day against target', xs: days.map((x) => x.x), series: [{ pts: days.map((x) => ({ x: x.x, y: target })), color: U.PAL.acc, dash: '5 4', width: 2 }, { pts: logged.map((x) => ({ x: x.x, y: x.tot[key] })), color, dots: true, line: false }], xLabel: (x) => U.shortDate(E.addDays(t, x - 14)), fmtY: (y) => U.num(y, 0) });
      cards.push(UI.card(h('div', { class: 'ct' }, 'Food, last 14 days'), h('div', { class: 'muted small' }, 'Today is left out until it is finished.'),
        U.lineChart({ label: 'Calories per day against target', xs: days.map((x) => x.x), series: [{ pts: days.map((x) => ({ x: x.x, y: plan.kcal })), color: U.PAL.acc, dash: '5 4', width: 2 }, { pts: logged.map((x) => ({ x: x.x, y: x.tot.kcal })), color: U.PAL.cool, dots: true, line: false }], xLabel: (x) => U.shortDate(E.addDays(t, x - 14)), fmtY: (y) => U.num(y, 0) }),
        h('div', { class: 'statgrid' }, h('div', { class: 'stat' }, h('b', null, U.withCommas(avgK)), h('span', null, 'avg kcal')), h('div', { class: 'stat' }, h('b', null, Math.round(avgP) + ' g'), h('span', null, 'avg protein')), h('div', { class: 'stat' }, h('b', null, logged.length + '/14'), h('span', null, 'days logged'))),
        h('div', { class: 'muted small' }, 'Protein, carbs and fat against your plan’s targets, in grams.'),
        macroChart('Protein', 'protein', plan.protein, U.PAL.cool),
        macroChart('Carbs', 'carbs', plan.carbs, U.PAL.ink2),
        macroChart('Fat', 'fat', plan.fat, U.PAL.coral)));
    }

    // Lifts
    const liftRows = Object.values(plan.lifts).map((l) => {
      const all = st.sets.filter((x) => x.lift === l.id && !x.warmup);
      const tg = E.liftTarget(l, cur, E.targetOpts(plan));
      const best = all.reduce((m, x) => (l.bw ? Math.max(m, x.reps) : Math.max(m, x.kg || 0)), 0);
      const startT = E.liftTarget(l, 1, E.targetOpts(plan));
      const fmt = (kg, reps) => (l.bw ? reps + ' reps' : U.fmtLift(kg, set.liftUnit));
      return h('a', { class: 'kv', href: '#/lifts/' + l.id }, h('span', null, l.name), h('b', null, best ? 'best ' + fmt(l.bw ? null : best, best) : 'no sets yet', h('span', { class: 'muted' }, '  (wk 1: ' + fmt(startT.kg, startT.reps) + ', now: ' + fmt(tg.kg, tg.reps) + ')')));
    });
    if (liftRows.length) cards.push(UI.card(h('div', { class: 'ct' }, 'Lifts: best set so far'), ...liftRows));

    const ci = E.checkinStatus(st, set.checkinDay, U.today());
    cards.push(Screens.activityCard(st, set));

    const weeksDone = E.photoWeeks(plan).filter((w) => E.anglesTaken(st, w) >= E.ANGLES.length).length;
    const ciLine = ci.status === 'done' ? 'This week is done. Next: ' + U.longDate(E.checkinDate(plan.startDate, Math.min(E.planWeeks(plan), ci.week + 1), set.checkinDay)) : ci.status === 'upcoming' ? 'Next check-in: ' + U.longDate(ci.date) : 'This week: ' + ci.taken + ' of ' + ci.of + ' angles';
    cards.push(UI.card(h('div', { class: 'target-top' }, h('div', null, h('div', { class: 'ct' }, 'Progress photos'), h('div', { class: 'muted small' }, weeksDone + ' weekly check-in' + (weeksDone === 1 ? '' : 's') + ' complete · ' + ciLine)), UI.btn('Open', { href: '#/photos', block: false, kind: 'quiet' }))));

    cards.push(UI.card(h('div', { class: 'target-top' }, h('div', null, h('div', { class: 'ct' }, 'Workout photos and videos'), h('div', { class: 'muted small' }, (st.clips.length ? st.clips.length + ' saved' : 'None yet') + ' · kept where you took them, not copied')), UI.btn('Open', { href: '#/library', block: false, kind: 'quiet' }))));

    const hist = plan.history.slice(-5).reverse();
    if (hist.length) cards.push(UI.card(h('div', { class: 'ct' }, 'Plan changes'), ...hist.map((x) => h('div', { class: 'kv' }, h('span', null, U.shortDate(x.ts.slice(0, 10)) + ' · ' + x.src), h('b', null, String(x.reason || 'Changed').slice(0, 80))))));

    return UI.page(UI.header('Progress', 'Week ' + cur + ' of ' + E.planWeeks(plan)), UI.scroller(...cards));
  };

  // ---------- Photos ----------
  let urls = [];
  let selWeek = null;
  function revokeUrls() { for (const u of urls) URL.revokeObjectURL(u); urls = []; }

  async function toJpeg(file, max) {
    if (!/^image\//.test(file.type) && !/\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) throw new Error('Pick an image file.');
    if (file.size > 60 * 1024 * 1024) throw new Error('That image is too large.');
    let src, w, hh, cleanup = () => {};
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      src = bmp; w = bmp.width; hh = bmp.height; cleanup = () => bmp.close && bmp.close();
    } catch (e) {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('This browser cannot read that image. On iPhone, choose Most Compatible in Camera settings, or export it as JPEG.')); img.src = url; });
        src = img; w = img.naturalWidth; hh = img.naturalHeight;
      } finally { URL.revokeObjectURL(url); }
    }
    const k = Math.min(1, max / Math.max(w, hh));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(hh * k);
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    cleanup();
    // Re-encoding drops all metadata (GPS, device, time) from the original file.
    return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not process that image.'))), 'image/jpeg', 0.86));
  }

  async function fillImg(img, id, holder) {
    const m = await Store.getMedia(id);
    if (!m) { holder.classList.add('empty-slot'); img.remove(); holder.insertBefore(h('span', null, 'Not in this backup'), holder.firstChild); return; }
    const url = URL.createObjectURL(m.blob); urls.push(url); img.src = url;
  }

  Screens.photos = function () {
    revokeUrls();
    const st = Store.getState(), plan = st.plan, set = Store.getSettings(), t = U.today();
    const cur = E.clamp(E.weekOf(plan.startDate, t), 1, E.planWeeks(plan));
    if (selWeek == null || selWeek > cur) selWeek = cur;
    const chosen = selWeek;
    const ciName = (w) => U.shortDate(E.checkinDate(plan.startDate, w, set.checkinDay));
    // One check-in per week, named by its date. A list rather than a wall of pills: 26 weeks is a lot of buttons.
    const wkSel = h('select', { class: 'inp', 'aria-label': 'Check-in date', onchange: () => { selWeek = Number(wkSel.value); root.App.render(); } },
      ...E.photoWeeks(plan).filter((w) => w <= cur).reverse().map((w) => h('option', { value: String(w), selected: w === chosen }, U.longDate(E.checkinDate(plan.startDate, w, set.checkinDay)) + (w === cur ? ' (this week)' : ''))));
    const wkSeg = h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Check-in date'), h('span', { class: 'selbox' }, wkSel));
    const input = h('input', { type: 'file', accept: 'image/*', class: 'hidden', 'aria-label': 'Choose a photo' });
    let pendingAngle = null;
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0]; input.value = '';
      if (!f || !pendingAngle) return;
      const angle = pendingAngle;
      try {
        const blob = await toJpeg(f, 1600);
        const old = st.photos.find((p) => p.week === chosen && p.angle === angle);
        const id = 'p_' + chosen + '_' + Screens._.slug(angle) + '_' + Date.now().toString(36);
        await Store.putMedia(id, blob, { week: chosen, angle });
        if (old) { await Store.voidEvent(old.seq); await Store.delMedia(old.id); }
        await Store.append('photo_added', { date: U.today(), week: chosen, angle, id });
        U.toast(angle + ' saved on this device.'); root.App.render();
      } catch (e) { U.toast(String(e && e.message ? e.message : e), 'warn'); }
    });
    const pick = (angle) => { pendingAngle = angle; input.click(); };

    const slots = h('div', { class: 'photogrid' });
    for (const angle of E.ANGLES) {
      const p = st.photos.find((x) => x.week === chosen && x.angle === angle);
      if (!p) { slots.appendChild(h('button', { type: 'button', class: 'thumb empty-slot', onclick: () => pick(angle), 'aria-label': 'Add ' + angle + ' photo' }, h('div', null, U.icon('camera', 24), h('div', null, angle)))); continue; }
      const img = h('img', { alt: angle + ', ' + ciName(chosen) });
      const holder = h('button', { type: 'button', class: 'thumb' + (set.blurPhotos ? ' blur' : ''), 'aria-label': 'Open ' + angle + ' photo' }, img, h('div', { class: 'lbl' }, angle));
      holder.addEventListener('click', () => viewer(p));
      slots.appendChild(holder);
      fillImg(img, p.id, holder);
    }
    function viewer(p) {
      const img = h('img', { alt: p.angle, class: 'viewer-img' });
      const box = h('div', { class: 'stack' }, img, h('div', { class: 'muted small' }, p.angle + ' · ' + U.longDate(p.date)));
      fillImg(img, p.id, box);
      U.sheet('Photo', box, [{ label: 'Replace', kind: 'quiet', run: () => { setTimeout(() => pick(p.angle), 0); } }, { label: 'Delete', kind: 'danger', run: async () => { await Store.voidEvent(p.seq); await Store.delMedia(p.id); root.App.render(); } }, { label: 'Close', kind: 'primary' }]);
    }

    // Your trend: the first and latest check-in for the angle with the most photos, then the two screens that go further
    const tAngle = Screens._.trendAngle(st);
    const tHave = E.checkIns(st, tAngle, cur).filter((c) => c.photo);
    let pair = null;
    if (tHave.length >= 2) {
      const first = tHave[0], last = tHave[tHave.length - 1];
      const ia = h('img', { alt: tAngle + ', ' + U.shortDate(first.date) }), ib = h('img', { alt: tAngle + ', ' + U.shortDate(last.date) });
      const ta = h('div', { class: 'trendthumb' + (set.blurPhotos ? ' blur' : '') }, ia, h('span', { class: 'lbl' }, U.shortDate(first.date))), tb = h('div', { class: 'trendthumb' + (set.blurPhotos ? ' blur' : '') }, ib, h('span', { class: 'lbl' }, U.shortDate(last.date)));
      pair = h('div', { class: 'trendpair' }, ta, tb);
      fillImg(ia, first.photo.id, ta); fillImg(ib, last.photo.id, tb);
    }
    const trendCard = UI.card(
      h('div', { class: 'target-top' }, h('div', { class: 'ct' }, 'Your photo trend'), set.blurPhotos ? U.chip('Blurred', 'line') : null),
      pair || h('div', { class: 'muted' }, 'Add the same angle at two check-ins and you can scrub through your progress here.'),
      h('div', { class: 'muted small' }, 'Photos live only on this device and never go to the coach.'),
      h('div', { class: 'row' }, UI.btn('See trend', { href: '#/photos/trend', block: false }), UI.btn('Compare', { href: '#/photos/compare', kind: 'quiet', block: false })));

    return UI.page(UI.header('Photos', 'Stored on this device only.', { back: '#/progress' }), UI.scroller(
      wkSeg,
      UI.card(h('div', { class: 'target-top' }, h('div', { class: 'ct' }, U.longDate(E.checkinDate(plan.startDate, chosen, set.checkinDay))), h('span', { class: 'muted small' }, cur === chosen ? 'This week' : 'Earlier check-in')), slots, h('div', { class: 'muted small' }, 'Same spot, same light, same time of day, relaxed then flexed. Photos are compressed and stripped of location data when saved.'), input),
      trendCard,
      UI.toggleRow('Blur thumbnails', 'Hide photos on screen until you open one', !!set.blurPhotos, (v) => { Store.saveSettings({ blurPhotos: v }).then(() => root.App.render()); })));
  };
  Screens._ = Object.assign(Screens._ || {}, { toJpeg, gotoWeek: (w) => { selWeek = w; } });
})(self);

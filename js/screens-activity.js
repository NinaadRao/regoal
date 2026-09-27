/*
 * Activity: log any workout (swimming, football, tennis, hot yoga, strength and more), keep a streak,
 * and move the suggested session around. Everything here is manual. Calories are estimates.
 */
(function (root) {
  'use strict';
  const E = root.Engine, G = root.Goals, U = root.U, UI = root.UI, Store = root.Store;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};
  const { cap, numOrNull } = Screens._;

  let seqNo = 0;
  const newId = () => 'w_' + Date.now().toString(36) + (seqNo++).toString(36) + Math.random().toString(36).slice(2, 5);
  const goalFor = (st, set) => E.clamp(Math.round(set.activeGoal) || E.defaultActiveGoal(st.profile), 1, 7);
  const kc = (n) => '~' + U.withCommas(Math.round(n)) + ' kcal';
  const dur = (m) => (m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min');
  const dayLabel = (d) => U.DOW[E.weekdayOf(d)] + ' ' + U.shortDate(d);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const EFFORT_HINT = { easy: 'You could hold a conversation.', moderate: 'Breathing hard, but steady.', hard: 'Competitive or all-out.' };

  // Thumbnails for workout photos in History: object URLs made on render, revoked on the next one.
  let thumbUrls = [];
  const revokeThumbs = () => { for (const u of thumbUrls) URL.revokeObjectURL(u); thumbUrls = []; };
  function fillWorkoutThumb(img, id) {
    Store.getMedia(id).then((m) => { if (!m) return; const url = URL.createObjectURL(m.blob); thumbUrls.push(url); img.src = url; }).catch(() => {});
  }

  // ---------- small views ----------
  function dayStrip(sum) {
    const box = h('div', { class: 'dots', role: 'img', 'aria-label': 'The last 14 days. ' + sum.last14.filter((d) => d.active).length + ' active.' });
    for (const d of sum.last14) {
      const isToday = d.date === sum.last14[13].date;
      box.appendChild(h('div', { class: 'dcol' }, h('span', { class: 'dot' + (d.active ? ' on' : '') + (isToday ? ' now' : ''), title: dayLabel(d.date) + (d.active ? ': active' : '') }), h('small', null, U.DOW[E.weekdayOf(d.date)][0])));
    }
    return box;
  }
  function statBox(value, label, sub) {
    return h('div', { class: 'stat' }, h('div', { class: 'display big2' }, String(value)), h('div', { class: 'statl' }, label), sub ? h('div', { class: 'muted small' }, sub) : null);
  }
  function streakLine(sum) {
    if (sum.dayStreak >= 2) return sum.dayStreak + ' days in a row. Keep it going.';
    if (sum.weekStreak >= 1 && sum.thisWeek.days >= sum.goal) return 'You hit your goal this week.';
    if (sum.lastActive == null) return 'Log your first workout to start a streak.';
    if (sum.daysSince != null && sum.daysSince >= 3) return 'Last active ' + plural(sum.daysSince, 'day') + ' ago. Any session restarts it.';
    return 'A walk or a hot yoga class counts as much as the gym.';
  }
  // The compact card on Today and Progress.
  Screens.activityCard = function (st, set) {
    const t = U.today(), sum = E.activitySummary(st, t, goalFor(st, set));
    const todays = st.workouts.filter((w) => w.date === t);
    return UI.card(
      h('div', { class: 'target-top' }, h('div', { class: 'ct' }, 'Activity'), h('a', { class: 'chip line', href: '#/activity' }, 'Details')),
      h('div', { class: 'stats' }, statBox(sum.weekStreak, sum.weekStreak === 1 ? 'week streak' : 'week streak', 'goal ' + sum.goal + ' days'), statBox(sum.dayStreak, sum.dayStreak === 1 ? 'day streak' : 'day streak', 'best ' + sum.bestDayStreak), statBox(sum.thisWeek.days + '/' + sum.goal, 'active days', 'this week')),
      dayStrip(sum),
      h('div', { class: 'muted small' }, streakLine(sum) + (sum.thisWeek.kcal ? ' This week: ' + kc(sum.thisWeek.kcal) + ' active.' : '')),
      ...todays.map((w) => h('div', { class: 'kv' }, h('span', null, E.workoutName(w) + ' · ' + dur(w.mins) + (w.km ? ' · ' + G.fmtDist(w.km, G.distUnitFor(set), w.type) : '')), h('b', null, kc(w.kcal)))),
      UI.row(UI.btn('Log a workout', { block: true, onClick: () => workoutSheet() })));
  };

  // ---------- log or edit one workout ----------
  // o: { existing, type, date, session, mins }
  function workoutSheet(o) {
    o = o || {};
    const st = Store.getState(), plan = st.plan, set = Store.getSettings(), lu = set.liftUnit, t = U.today();
    const ex = o.existing || null;
    const linked = ex && ex.id ? st.sets.filter((x) => x.wo === ex.id) : [];
    let type = ex ? ex.type : o.type || 'strength';
    let effort = ex ? ex.effort : 'moderate';

    const typeSel = h('select', { class: 'inp', 'aria-label': 'Activity' }, ...Object.keys(E.ACTIVITIES).map((k) => h('option', { value: k }, E.ACTIVITIES[k].name)));
    typeSel.value = type;
    if (linked.length) typeSel.disabled = true;
    const dateF = UI.field({ label: 'Date', type: 'date', value: ex ? ex.date : o.date || t, max: t });
    if (linked.length) dateF.input.disabled = true;
    const labelF = UI.field({ label: 'What was it?', value: ex ? ex.label : '', maxlength: 40, placeholder: 'e.g. Kabaddi' });
    const minsF = UI.field({ label: 'How long', unit: 'min', type: 'number', inputmode: 'numeric', value: ex ? ex.mins : o.mins || '', flex: 1 });
    const kcalF = UI.field({ label: 'Calories burnt', unit: 'kcal', type: 'number', inputmode: 'numeric', value: ex && ex.manual ? ex.kcal : '', flex: 1 });
    // Distance, for sports Goals can measure. Kept in km; typed in the person's unit (metres or yards for swimming).
    // The Distance choice in Settings sets the default unit here; the toggle below lets just this entry use the other one.
    const du = G.distUnitFor(set), isSport = (tp) => Object.prototype.hasOwnProperty.call(G.SPORTS, tp);
    let duPick = du;
    const distU = () => G.distInput(type, duPick);
    const kmF = UI.field({ label: 'Distance (optional)', unit: distU(), type: 'number', value: ex && ex.km ? String(Math.round(G.fromKm(ex.km, G.distInput(ex.type, du)) * 100) / 100) : o.km ? String(o.km) : '', hint: 'Counts towards your running, cycling or swimming goals.' });
    const unitSeg = UI.seg({ label: 'Distance unit', options: [{ value: 'km', label: 'km' }, { value: 'mi', label: 'mi' }], value: duPick, onChange: (v) => {
      const oldU = distU(), cur = numOrNull(kmF.input.value);
      duPick = v;
      if (cur != null) kmF.input.value = String(Math.round(G.fromKm(G.toKm(cur, oldU), distU()) * 100) / 100);
      refresh();
    } });
    const paceLine = h('div', { class: 'muted small' });
    const noteF = UI.field({ label: 'Note (optional)', value: ex ? ex.note : '', maxlength: 200, hint: 'Stays on this device. The coach never sees it.' });

    // Photo (optional): a compressed copy is kept on this device, like a Library photo. Never uploaded anywhere.
    let photo = ex && ex.photo ? Object.assign({}, ex.photo) : null;
    let photoFile = null, removePhoto = false;
    const photoRow = h('div', { class: 'attachprev hidden' });
    const syncPhoto = () => {
      U.clear(photoRow);
      if (photoFile) {
        photoRow.appendChild(h('img', { src: URL.createObjectURL(photoFile), alt: 'Photo for this workout', class: 'attachthumb' + (set.blurPhotos ? ' blur' : '') }));
        photoRow.appendChild(h('div', { class: 'muted small grow' }, 'New photo attached.'));
        photoRow.appendChild(h('button', { type: 'button', class: 'iconbtn tiny', 'aria-label': 'Remove photo', onclick: () => { photoFile = null; removePhoto = !!photo; syncPhoto(); } }, U.icon('x', 16)));
        photoRow.classList.remove('hidden');
      } else if (photo && !removePhoto) {
        const img = h('img', { alt: 'Photo for this workout', class: 'attachthumb' + (set.blurPhotos ? ' blur' : '') });
        photoRow.appendChild(img);
        photoRow.appendChild(h('div', { class: 'muted small grow' }, 'Photo attached.'));
        photoRow.appendChild(h('button', { type: 'button', class: 'iconbtn tiny', 'aria-label': 'Remove photo', onclick: () => { removePhoto = true; syncPhoto(); } }, U.icon('x', 16)));
        photoRow.classList.remove('hidden');
        Store.getMedia(photo.thumb).then((m) => { if (m) img.src = URL.createObjectURL(m.blob); }).catch(() => {});
      } else {
        photoRow.classList.add('hidden');
      }
    };
    const photoInput = h('input', { type: 'file', accept: 'image/*', class: 'offscreen', 'aria-label': 'Choose a photo for this workout' });
    photoInput.addEventListener('change', () => {
      const file = photoInput.files && photoInput.files[0]; photoInput.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) return U.toast('Choose a photo.', 'warn');
      photoFile = file; removePhoto = false; syncPhoto();
    });
    const photoBtn = UI.btn('Attach a photo (optional)', { kind: 'quiet', icon: 'camera', onClick: () => photoInput.click() });
    const photoNote = h('div', { class: 'muted small' }, 'A compressed copy stays on this device, like your Library photos. It is never uploaded.');
    syncPhoto();
    const estLine = h('div', { class: 'muted small' });
    const effortHint = h('div', { class: 'muted small' }, EFFORT_HINT[effort]);
    const effortSeg = UI.seg({ label: 'How hard was it', options: [{ value: 'easy', label: 'Easy' }, { value: 'moderate', label: 'Moderate' }, { value: 'hard', label: 'Hard' }], value: effort, onChange: (v) => { effort = v; effortHint.textContent = EFFORT_HINT[v]; refresh(); } });

    // Strength: which workout, and the sets
    const sessSel = h('select', { class: 'inp', 'aria-label': 'Which workout' }, ...plan.workouts.map((w) => h('option', { value: w.name }, w.name)), h('option', { value: '' }, 'Something else'));
    const guess = ex ? ex.session : o.session != null ? o.session : ((E.sessionFor(plan, st.moves, dateF.input.value).session || {}).name || '');
    sessSel.value = plan.workouts.some((w) => w.name === guess) ? guess : '';
    const rowsBox = h('div', { class: 'exbuild' });
    let rows = [];
    const weekAt = () => E.clamp(E.weekOf(plan.startDate, dateF.input.value || t), 1, E.planWeeks(plan));
    const numInp = (label, ph, mode) => h('input', { class: 'inp sm', type: 'number', inputmode: mode || 'numeric', placeholder: ph == null ? '' : String(ph), 'aria-label': label });
    function addRow(spec) {
      if (rows.some((r) => r.id === spec.id)) return;
      const sets = numInp(spec.label + ' sets', spec.target ? spec.target.sets : ''), reps = numInp(spec.label + ' reps', spec.target ? spec.target.reps : '');
      const kg = spec.bw ? null : numInp(spec.label + ' load', spec.target && spec.target.kg != null ? U.fmtWeight(spec.target.kg, lu, 1) : '', 'decimal');
      const row = { id: spec.id, label: spec.label, tracked: !!spec.tracked, bw: !!spec.bw, target: spec.target, sets, reps, kg };
      const el = h('div', { class: 'exb' },
        h('div', { class: 'exbn' }, h('span', null, spec.label), spec.target ? h('small', { class: 'muted' }, 'Plan ' + spec.target.sets + ' x ' + spec.target.reps + (spec.target.kg == null ? '' : ' @ ' + U.fmtLift(spec.target.kg, lu))) : null,
          spec.extra ? h('button', { type: 'button', class: 'iconbtn tiny', 'aria-label': 'Remove ' + spec.label, onclick: () => { rows = rows.filter((r) => r !== row); el.remove(); } }, U.icon('x', 14)) : null),
        h('div', { class: 'exbi' }, sets, h('span', { class: 'x' }, 'x'), reps, ...(spec.bw ? [] : [h('span', { class: 'x' }, '@'), kg, h('span', { class: 'unit' }, lu)])));
      row.el = el; rows.push(row); rowsBox.appendChild(el);
    }
    const specFor = (exx) => {
      const lift = exx.lift ? plan.lifts[exx.lift] : null;
      if (lift) return { id: lift.id, label: exx.n, tracked: true, bw: !!lift.bw, target: E.liftTarget(lift, weekAt(), E.targetOpts(plan)) };
      const lo = parseInt(exx.range, 10);
      return { id: 'acc_' + E.slug(exx.n), label: exx.n, tracked: false, bw: false, target: { sets: exx.sets, reps: lo > 0 ? lo : '', kg: null } };
    };
    function buildRows() {
      U.clear(rowsBox); rows = [];
      const s = plan.workouts.find((w) => w.name === sessSel.value);
      if (s) for (const exx of s.ex) addRow(specFor(exx));
    }
    sessSel.addEventListener('change', buildRows);
    // Changing the date only re-reads the plan targets when nothing has been typed yet, so typed sets are never lost.
    dateF.input.addEventListener('change', () => { if (rows.every((r) => !r.sets.value && !r.reps.value && !(r.kg && r.kg.value))) buildRows(); refresh(); });
    const fillBtn = h('button', { type: 'button', class: 'btn quiet small', onclick: () => {
      for (const r of rows) if (r.target) { r.sets.value = r.target.sets || ''; r.reps.value = r.target.reps || ''; if (r.kg && r.target.kg != null) r.kg.value = U.fmtWeight(r.target.kg, lu, 1); }
    } }, 'Fill with the plan');
    // Add an exercise that is not in the list
    const known = [];
    for (const l of Object.values(plan.lifts)) known.push({ key: l.id, label: l.name, spec: () => ({ id: l.id, label: l.name, tracked: true, bw: !!l.bw, target: E.liftTarget(l, weekAt(), E.targetOpts(plan)), extra: true }) });
    for (const w of plan.workouts) for (const exx of w.ex) if (!exx.lift && !known.some((k) => k.label === exx.n)) known.push({ key: 'acc_' + E.slug(exx.n), label: exx.n, spec: () => Object.assign(specFor(exx), { extra: true }) });
    const addSel = h('select', { class: 'inp', 'aria-label': 'Add an exercise' }, h('option', { value: '' }, 'Add an exercise'), ...known.map((k) => h('option', { value: k.key }, k.label)), h('option', { value: '__own' }, 'Something else…'));
    const ownF = UI.field({ label: 'Exercise name', maxlength: 30 });
    ownF.classList.add('hidden');
    addSel.addEventListener('change', () => { ownF.classList.toggle('hidden', addSel.value !== '__own'); });
    const addBtn = h('button', { type: 'button', class: 'btn quiet small', onclick: () => {
      if (addSel.value === '__own') {
        const name = ownF.input.value.trim().replace(/\s+/g, ' ').slice(0, 30);
        if (!name) return U.toast('Type the exercise name.', 'warn');
        addRow({ id: 'acc_' + E.slug(name), label: name, tracked: false, bw: false, target: null, extra: true }); ownF.input.value = '';
      } else if (addSel.value) { const k = known.find((x) => x.key === addSel.value); if (k) addRow(k.spec()); }
      addSel.value = ''; ownF.classList.add('hidden');
    } }, 'Add');
    const already = st.sets.filter((x) => x.date === dateF.input.value && !x.warmup && !x.wo).length;
    const strengthBox = h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Which workout'), sessSel),
      linked.length
        ? h('div', { class: 'muted small' }, plural(linked.length, 'set') + ' are saved with this workout. Change them from the lift they belong to; deleting the workout removes them too.')
        : h('div', { class: 'stack' }, h('div', { class: 'row space' }, h('div', { class: 'lab' }, 'Sets, reps and load'), fillBtn), rowsBox, h('div', { class: 'row' }, h('div', { class: 'grow' }, addSel), addBtn), ownF,
          h('div', { class: 'muted small' }, 'Leave an exercise empty to skip it. ' + (already ? plural(already, 'set') + ' from Today are already logged for this day, so only add what is missing.' : 'Sets you log here count towards your lift targets.'))));
    if (!linked.length) buildRows();

    const body = h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Activity'), typeSel), labelF, dateF, strengthBox, UI.row(minsF, kcalF), kmF, unitSeg, paceLine, effortSeg, effortHint, estLine, noteF, photoBtn, photoInput, photoRow, photoNote);
    function refresh() {
      type = typeSel.value;
      labelF.classList.toggle('hidden', type !== 'other');
      strengthBox.classList.toggle('hidden', type !== 'strength');
      kmF.classList.toggle('hidden', !isSport(type));
      unitSeg.classList.toggle('hidden', !isSport(type));
      kmF.querySelector('.unit').textContent = distU();
      const kmv = numOrNull(kmF.input.value), mn = numOrNull(minsF.input.value);
      paceLine.textContent = isSport(type) && kmv > 0 && mn > 0 ? 'Pace ' + G.fmtPace(mn * 60 / G.toKm(kmv, distU()), type, duPick) : '';
      const mins = numOrNull(minsF.input.value), date = dateF.input.value || t;
      const est = mins > 0 ? E.estimateKcal(type, effort, mins, E.bodyKg(st, date)) : 0;
      kcalF.input.placeholder = est ? String(est) : '';
      estLine.textContent = est ? 'Estimated ' + kc(est) + ' above resting (' + E.ACTIVITIES[type].name.toLowerCase() + ', ' + effort + ', ' + Math.round(mins) + ' min). Type your watch\'s number to use that instead. Your calorie target already allows for training, so there is no need to eat these back.'
        : 'Add how long it lasted to see the estimate.';
    }
    typeSel.addEventListener('change', refresh); minsF.input.addEventListener('input', refresh); kmF.input.addEventListener('input', refresh); refresh();

    const actions = [{ label: 'Cancel' }];
    if (ex) actions.push({ label: linked.length ? 'Delete with sets' : 'Delete', kind: 'danger', run: async () => {
      for (const x of linked) await Store.voidEvent(x.seq);
      await Store.voidEvent(ex.seq);
      if (ex.photo) { await Store.delMedia(ex.photo.thumb).catch(() => {}); if (ex.photo.full) await Store.delMedia(ex.photo.full).catch(() => {}); }
      U.toast('Deleted.'); root.App.render();
    } });
    actions.push({ label: 'Save', kind: 'primary', run: () => {
      const date = dateF.input.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > t) { U.toast('Pick today or an earlier day.', 'warn'); return false; }
      const mins = Math.round(numOrNull(minsF.input.value) || 0);
      if (!(mins >= 1 && mins <= 600)) { U.toast('Add how long it lasted, from 1 to 600 minutes.', 'warn'); return false; }
      const kv = numOrNull(kcalF.input.value);
      if (kv != null && !(kv >= 0 && kv <= 5000)) { U.toast('Calories burnt should be between 0 and 5,000.', 'warn'); return false; }
      const manual = kv != null && kv > 0;
      const kcal = manual ? Math.round(kv) : E.estimateKcal(type, effort, mins, E.bodyKg(st, date));
      const id = ex && ex.id ? ex.id : newId();
      const raw = { id, date, type, mins, effort, kcal, manual, note: noteF.input.value };
      if (isSport(type)) {
        const kv2 = numOrNull(kmF.input.value);
        if (kv2 != null && !(kv2 >= 0 && G.toKm(kv2, distU()) <= 1000)) { U.toast('Distance looks wrong. Check the unit (' + distU() + ').', 'warn'); return false; }
        if (kv2 != null && kv2 > 0) raw.km = G.toKm(kv2, distU());
      }
      if (type === 'other') raw.label = labelF.input.value;
      if (type === 'strength') raw.session = sessSel.value;
      const chk = E.cleanWorkout(raw);
      if (!chk.ok) { U.toast(chk.errors[0], 'warn'); return false; }
      const setData = [];
      if (type === 'strength' && !linked.length) {
        const week = E.weekOf(plan.startDate, date);
        for (const r of rows) {
          const reps = Math.round(numOrNull(r.reps.value) || 0);
          if (!reps) continue;
          if (reps > 100) { U.toast('Reps for ' + r.label + ' look too high.', 'warn'); return false; }
          const n = r.sets.value.trim() === '' ? 1 : Math.round(numOrNull(r.sets.value) || 0);
          if (!(n >= 1 && n <= 12)) { U.toast('Sets for ' + r.label + ' should be between 1 and 12.', 'warn'); return false; }
          let kg = null;
          if (!r.bw) {
            const w = numOrNull(r.kg.value);
            if (r.tracked && !(w != null && w >= 0 && w <= 2000)) { U.toast('Add the load for ' + r.label + ', or clear its reps.', 'warn'); return false; }
            if (w != null) { if (!(w >= 0 && w <= 2000)) { U.toast('Load for ' + r.label + ' looks wrong.', 'warn'); return false; } kg = E.clean(U.unitToKg(w, lu)); if (kg > 700) { U.toast('Load for ' + r.label + ' looks too high. Check the unit.', 'warn'); return false; } }
          }
          for (let i = 0; i < n; i++) { const d = { date, week, lift: r.id, kg, reps, wo: id }; if (!r.tracked) d.name = r.label.slice(0, 60); setData.push(d); }
        }
      }
      (async () => {
        try {
          // The photo is compressed and stored (or removed) before the event is written, so the event never
          // points at a blob that failed to save. Stable ids (the workout's own id) mean a replaced photo just
          // overwrites the old blob, and an untouched one is carried forward without re-reading the file.
          if (photoFile) {
            const tid = 'wt_' + id, fid = 'wf_' + id;
            const [tf] = await root.Library.frames(photoFile, 1, root.Library.THUMB_SIDE);
            const [ff] = await root.Library.frames(photoFile, 1, root.Library.FULL_SIDE);
            await Store.putMedia(tid, tf.blob, { kind: 'thumb' });
            await Store.putMedia(fid, ff.blob, { kind: 'full' });
            chk.value.photo = { thumb: tid, full: fid };
          } else if (removePhoto && photo) {
            await Store.delMedia(photo.thumb).catch(() => {}); if (photo.full) await Store.delMedia(photo.full).catch(() => {});
          } else if (photo) {
            chk.value.photo = photo;
          }
          // The workout goes first and the old copy is voided last, so a failure part-way never loses what was there.
          await Store.append('workout_logged', chk.value);
          for (const d of setData) await Store.append('set_logged', d);
          if (ex) await Store.voidEvent(ex.seq);
          const sum = E.activitySummary(Store.getState(), t, goalFor(Store.getState(), set));
          U.toast('Logged ' + kc(chk.value.kcal) + (sum.dayStreak >= 2 ? ' · ' + sum.dayStreak + ' days in a row' : '') + '.');
        } catch (err) { U.toast('That could not be saved: ' + (err && err.message ? err.message : 'storage error') + '. Check it in History.', 'warn'); }
        root.App.render();
      })();
    } });
    U.sheet(ex ? 'Edit workout' : 'Log a workout', body, actions);
  }
  Screens.workoutSheet = workoutSheet;

  // ---------- move the suggested session ----------
  // The plan suggests a session per weekday. Life moves it: to another day, swapped, or dropped for the week.
  function rescheduleSheet(date) {
    const st = Store.getState(), plan = st.plan, t = U.today();
    const f = E.sessionFor(plan, st.moves, date);
    const wp = E.weekPlan(st, E.weekOf(plan.startDate, date), t);
    let close = () => {};
    const apply = async (events, msg) => {
      close();
      for (const m of events) await Store.append('session_moved', m);
      U.toast(msg); root.App.render();
    };
    const row = (title, sub, onclick) => h('button', { type: 'button', class: 'listrow', onclick }, h('div', { class: 'grow' }, h('b', null, title), sub ? h('span', { class: 'muted small' }, sub) : null), U.icon('chev', 16));
    const body = h('div', { class: 'stack' });
    if (f.session) {
      body.appendChild(h('div', { class: 'ct' }, 'Move ' + f.session.name + ' to another day'));
      const list = h('div', { class: 'list' });
      for (let i = 1; i <= 6; i++) {
        const d = E.addDays(date, i), there = E.sessionFor(plan, st.moves, d).session;
        list.appendChild(row(dayLabel(d), there ? there.name + ' is planned. They swap.' : 'Rest day', () => apply(E.moveSession(plan, st.moves, date, d), f.session.name + ' is now on ' + dayLabel(d) + (there ? ', and ' + there.name + ' is on ' + dayLabel(date) : '') + '.')));
      }
      body.appendChild(list);
    }
    const others = plan.workouts.filter((w) => !f.session || w.name !== f.session.name);
    if (others.length) {
      body.appendChild(h('div', { class: 'ct' }, f.session ? 'Or do a different session instead' : 'Train anyway'));
      const list = h('div', { class: 'list' }), week = E.weekOf(plan.startDate, date), idx = E.setIndex(st);
      for (const w of others) {
        const r = E.changeSession(st, date, w.name, t);
        const entry = wp.find((p) => p.name === w.name && p.date !== date);
        const parts = [];
        if (E.sessionDoneIn(st, w, week, idx)) parts.push('Done this week, so this is an extra one.');
        else if (entry) parts.push('Planned ' + dayLabel(entry.date) + ', and that day is cleared.');
        else parts.push('Not on this week\'s plan.');
        if (r.moved) parts.push(r.moved.name + ' moves to ' + dayLabel(r.moved.date) + '.');
        if (r.dropped) parts.push(r.dropped + ' comes off this week.');
        list.appendChild(row(w.name, parts.join(' '), () => apply(r.events, w.name + ' is today\'s session' + (r.moved ? ', and ' + r.moved.name + ' is on ' + dayLabel(r.moved.date) : '') + '.')));
      }
      body.appendChild(list);
    }
    if (f.session) {
      body.appendChild(h('div', { class: 'list' }, row('Skip it this week', f.session.name + ' comes off the plan. Your coach will not count it as missed.', () => apply([{ date, session: 'rest' }], 'Rest day.'))));
    }
    body.appendChild(h('div', { class: 'muted small' }, 'The plan is a suggestion. Lifts, calories and weekly targets do not depend on the weekday, so nothing else changes.'));
    close = U.sheet(f.session ? 'Change today\'s plan' : 'Train today?', body, [{ label: 'Close' }]);
  }
  Screens.rescheduleSheet = rescheduleSheet;

  // ---------- what a session actually involves (read-only: exercises and their targets for one week) ----------
  function targetTextFor(ex, plan, week, liftUnit) {
    const lift = ex.lift ? plan.lifts[ex.lift] : null;
    if (lift) {
      const tg = E.liftTarget(lift, week, E.targetOpts(plan));
      return tg.sets + ' x ' + tg.reps + (tg.kg == null ? ' reps' : ' @ ' + U.fmtLift(tg.kg, liftUnit));
    }
    return ex.sets + ' x ' + (ex.range || 'work sets');
  }
  function sessionPreviewSheet(session, week, plan, liftUnit) {
    const body = h('div', { class: 'stack' },
      h('div', { class: 'muted small' }, plural(session.ex.length, 'exercise') + '. Targets shown are for week ' + week + ' of the plan.'),
      ...session.ex.map((ex) => h('div', { class: 'exrow' },
        h('div', { class: 'exname' }, h('span', null, ex.n), h('span', { class: 'extarget' }, targetTextFor(ex, plan, week, liftUnit))),
        ex.flag ? h('div', { class: 'flag' }, ex.flag) : null)));
    U.sheet(session.name + ' day', body, [{ label: 'Close' }]);
  }
  Screens.sessionPreviewSheet = sessionPreviewSheet;

  // The next 7 days, whatever plan week they fall in, so "what's tomorrow" always has an answer, even
  // right at a plan-week boundary where the Activity screen's "This week" list would run out.
  function upcomingSheet(t) {
    const st = Store.getState(), plan = st.plan, liftUnit = Store.getSettings().liftUnit;
    const list = h('div', { class: 'list' });
    for (let i = 1; i <= 7; i++) {
      const d = E.addDays(t, i), f = E.sessionFor(plan, st.moves, d);
      if (f.session) {
        const week = E.weekOf(plan.startDate, d);
        list.appendChild(h('button', { type: 'button', class: 'listrow', onclick: () => sessionPreviewSheet(f.session, week, plan, liftUnit) },
          h('div', { class: 'grow' }, h('b', null, f.session.name), h('span', { class: 'muted small' }, dayLabel(d) + (f.moved ? ' · moved' : ''))),
          U.icon('chev', 16)));
      } else {
        list.appendChild(h('div', { class: 'kv' }, h('span', null, dayLabel(d)), h('b', { class: 'muted' }, 'Rest')));
      }
    }
    const body = h('div', { class: 'stack' }, h('div', { class: 'muted small' }, 'Tap a day to see its exercises. Moving a session later changes this too.'), list);
    U.sheet('Coming up', body, [{ label: 'Close' }]);
  }
  Screens.upcomingSheet = upcomingSheet;

  // ---------- the Activity screen ----------
  Screens.activity = function () {
    revokeThumbs();
    const st = Store.getState(), plan = st.plan, set = Store.getSettings(), t = U.today();
    const goal = goalFor(st, set), sum = E.activitySummary(st, t, goal);
    const cur = Math.max(1, E.weekOf(plan.startDate, t));
    const cards = [];

    cards.push(UI.card(
      h('div', { class: 'stats' }, statBox(sum.weekStreak, 'week streak', 'best ' + sum.bestWeekStreak), statBox(sum.dayStreak, 'day streak', 'best ' + sum.bestDayStreak), statBox(sum.thisWeek.days + '/' + goal, 'active days', 'this week')),
      dayStrip(sum),
      h('div', { class: 'muted small' }, streakLine(sum)),
      UI.btn('Log a workout', { onClick: () => workoutSheet() })));

    cards.push(UI.card(h('div', { class: 'ct' }, 'This week'),
      h('div', { class: 'kv' }, h('span', null, 'Active days'), h('b', null, sum.thisWeek.days + ' of ' + goal)),
      h('div', { class: 'kv' }, h('span', null, 'Time moving'), h('b', null, sum.thisWeek.mins ? dur(sum.thisWeek.mins) : 'Nothing logged')),
      h('div', { class: 'kv' }, h('span', null, 'Active calories'), h('b', null, sum.thisWeek.kcal ? kc(sum.thisWeek.kcal) : '0')),
      ...E.weekPlan(st, cur, t).map((p) => {
        const session = plan.workouts.find((w) => w.name === p.name);
        return h('button', { type: 'button', class: 'listrow', onclick: () => session && sessionPreviewSheet(session, cur, plan, set.liftUnit) },
          h('div', { class: 'grow' }, h('b', null, p.name), h('span', { class: 'muted small' }, dayLabel(p.date) + (p.moved ? ' · moved' : ''))),
          h('span', { class: p.status === 'done' ? 'st-done' : p.status === 'missed' ? 'st-missed' : '' }, p.status === 'done' ? 'Done' : p.status === 'missed' ? 'Not yet' : p.status === 'today' ? 'Today' : 'Coming up'),
          session ? U.icon('chev', 16) : null);
      }),
      h('div', { class: 'muted small' }, 'Tap a day to see its exercises. A session counts as done on whatever day you trained it, and "not yet" is not a failure.')));

    // Trend: active days per week against the goal, and active calories
    const weeks = E.activityWeeks(st, cur, t).slice(-12);
    if (weeks.some((w) => w.days)) {
      const xs = weeks.map((w) => w.week);
      const daysChart = U.lineChart({ label: 'Active days per week against your goal', xs, series: [{ pts: xs.map((x) => ({ x, y: goal })), color: U.PAL.acc, dash: '5 4', width: 2 }, { pts: weeks.map((w) => ({ x: w.week, y: w.days })), color: U.PAL.cool, dots: true }], xLabel: (x) => 'Wk ' + x, fmtY: (y) => U.num(y, 0) });
      const kcalChart = U.lineChart({ label: 'Active calories per week', xs, series: [{ pts: weeks.map((w) => ({ x: w.week, y: w.kcal })), color: U.PAL.coral, dots: true }], xLabel: (x) => 'Wk ' + x, fmtY: (y) => U.withCommas(Math.round(y)) });
      cards.push(UI.card(h('div', { class: 'ct' }, 'Trend'), h('div', { class: 'muted small' }, 'Active days a week. Dashed line: your goal of ' + goal + '.'), daysChart, h('div', { class: 'muted small' }, 'Active calories a week (estimates).'), kcalChart));
    }

    // Weekly log
    const wlog = E.activityWeeks(st, cur, t).slice(-8).reverse();
    cards.push(UI.card(h('div', { class: 'ct' }, 'Weekly log'), ...wlog.map((w) => {
      const [a, b] = E.weekRange(plan.startDate, w.week);
      return h('div', { class: 'wkrow' },
        h('div', { class: 'row space' }, h('b', null, 'Week ' + w.week + (w.week === cur ? ' · now' : '')), h('span', { class: w.days >= goal ? 'st-done' : 'muted' }, w.days + ' of ' + goal + ' days')),
        U.bar(goal ? (w.days / goal) * 100 : 0, w.days >= goal ? '' : 'cool'),
        h('div', { class: 'muted small' }, U.shortDate(a) + ' to ' + U.shortDate(b) + ' · ' + (w.mins ? dur(w.mins) + ' · ' + kc(w.kcal) : 'no time logged') + (w.planned ? ' · ' + w.done + ' of ' + w.planned + ' planned sessions' : '')));
    })));

    // What you do
    const mix = E.activityMix(st, E.addDays(t, -27), t);
    if (mix.length) {
      const top = Math.max(1, ...mix.map((m) => m.mins));
      cards.push(UI.card(h('div', { class: 'ct' }, 'Last 4 weeks'), ...mix.map((m) => h('div', { class: 'mixrow' },
        h('div', { class: 'row space' }, h('b', null, m.name), h('span', { class: 'muted small' }, plural(m.sessions, 'session') + (m.mins ? ' · ' + dur(m.mins) + ' · ' + kc(m.kcal) : ''))),
        U.bar((m.mins / top) * 100, 'cool')))));
    }

    // History: workouts, plus strength days where sets were logged without a time
    const strengthDates = new Set(st.workouts.filter((w) => w.type === 'strength').map((w) => w.date));
    const setOnly = [];
    for (const [d, ss] of E.setIndex(st)) if (!strengthDates.has(d) && d <= t) setOnly.push({ date: d, n: ss.length });
    const items = st.workouts.map((w) => ({ date: w.date, seq: w.seq, w })).concat(setOnly.map((x) => ({ date: x.date, seq: 0, only: x })));
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq));
    const hist = items.slice(0, 40).map((it) => {
      if (it.w) {
        const thumb = it.w.photo ? h('img', { alt: '', class: 'attachthumb' + (set.blurPhotos ? ' blur' : '') }) : null;
        if (thumb) fillWorkoutThumb(thumb, it.w.photo.thumb);
        return h('button', { type: 'button', class: 'listrow', 'aria-label': 'Edit ' + E.workoutName(it.w), onclick: () => workoutSheet({ existing: it.w }) },
          thumb,
          h('div', { class: 'grow' }, h('b', null, E.workoutName(it.w) + (it.w.session ? ' · ' + it.w.session : '')), h('span', { class: 'muted small' }, dayLabel(it.date) + ' · ' + dur(it.w.mins) + (it.w.km ? ' · ' + G.fmtDist(it.w.km, G.distUnitFor(Store.getSettings()), it.w.type) : '') + ' · ' + cap(it.w.effort) + ' · ' + kc(it.w.kcal) + (it.w.manual ? ' (yours)' : ''))),
          U.icon('chev', 16));
      }
      return h('button', { type: 'button', class: 'listrow', 'aria-label': 'Add the time for the strength session on ' + dayLabel(it.date), onclick: () => workoutSheet({ type: 'strength', date: it.date }) },
        h('div', { class: 'grow' }, h('b', null, 'Strength · ' + plural(it.only.n, 'set') + ' logged'), h('span', { class: 'muted small' }, dayLabel(it.date) + ' · tap to add the time and count the calories')), U.icon('chev', 16));
    });
    cards.push(UI.card(h('div', { class: 'ct' }, 'History'), h('div', { class: 'list' }, ...(hist.length ? hist : [UI.empty('No workouts yet. Anything that gets you moving counts: swimming, football, tennis, badminton, pickleball, hot yoga, strength and more.')]))));

    // The goal
    const goalSel = UI.seg({ label: 'Weekly goal: active days', options: ['2', '3', '4', '5', '6', '7'], value: String(goal), onChange: async (v) => { await Store.saveSettings({ activeGoal: Number(v) }); root.App.render(); } });
    cards.push(UI.card(goalSel, h('div', { class: 'muted small' }, 'A week counts towards your streak when you reach this many active days. Days count when you log any workout or any working set. Calories are estimated from activity type, time, effort and your weight (MET values from the Compendium of Physical Activities), so treat them as a guide.')));

    return UI.page(UI.header('Activity', 'Every session counts, not just the gym.', { back: '#/today' }), UI.scroller(...cards));
  };
})(self);

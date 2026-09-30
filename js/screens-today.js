/* Today (workout + set logging + rest timer), Lifts (week-by-week targets) and a single lift's detail. */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store, LiftAI = root.LiftAI;
  const { h, s } = U;
  const Screens = root.Screens = root.Screens || {};

  const slug = E.slug;
  const cap = (t) => t ? t[0].toUpperCase() + t.slice(1) : '';
  const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  Screens._ = Object.assign(Screens._ || {}, { slug, cap, numOrNull });

  // ---------- rest timer (lives outside the page so re-rendering does not reset it) ----------
  let timer = null; // { end, total, label }
  let tickId = null;
  function startTimer(sec, label) {
    timer = { end: Date.now() + sec * 1000, total: sec, label: label || '' };
    if (!tickId) tickId = setInterval(tick, 500);
    tick();
  }
  function stopTimer() { timer = null; if (tickId) { clearInterval(tickId); tickId = null; } tick(); }
  function fmtClock(ms) { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
  function tick() {
    const els = document.querySelectorAll('.timer-t');
    if (timer) {
      const left = timer.end - Date.now();
      if (left <= 0 && !timer.done) { timer.done = true; try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ } }
      if (left < -30000) { stopTimer(); if (root.App) root.App.render(); return; }
      for (const el of els) el.textContent = left > 0 ? fmtClock(left) : 'Go';
    }
  }
  function timerBar() {
    if (!timer) return null;
    return h('div', { class: 'timerbar', role: 'timer' }, U.icon('dumbbell', 20),
      h('div', { class: 'grow' }, h('div', { class: 'muted small' }, 'Rest' + (timer.label ? ' · ' + timer.label : '')), h('div', { class: 'timer-t' }, fmtClock(timer.end - Date.now()))),
      h('button', { class: 'btn quiet small', type: 'button', onclick: () => { timer.end += 30000; timer.done = false; tick(); } }, '+30 s'),
      h('button', { class: 'btn quiet small', type: 'button', onclick: () => { stopTimer(); root.App.render(); } }, 'Skip'));
  }

  // ---------- set logging ----------
  // opts: { liftId, label, bw, defaultKg, defaultReps, date, restSec, existing }
  function setSheet(opts) {
    const set = Store.getSettings(), lu = set.liftUnit, ex = opts.existing;
    const wInp = UI.field({ label: 'Weight', unit: lu, type: 'number', value: ex ? (ex.kg == null ? '' : U.fmtWeight(ex.kg, lu, 1)) : opts.defaultKg != null ? U.fmtWeight(opts.defaultKg, lu, 1) : '', flex: 1 });
    const rInp = UI.field({ label: 'Reps', type: 'number', inputmode: 'numeric', value: ex ? ex.reps : opts.defaultReps || '', flex: 1 });
    let rpe = ex && ex.rpe ? String(ex.rpe) : '', warm = !!(ex && ex.warmup);
    const note = UI.field({ label: 'Note (optional)', value: ex && ex.note ? ex.note : '', maxlength: 200, hint: 'Form cue, pain, gym was full.' });
    const body = h('div', { class: 'stack' },
      UI.row(...(opts.bw ? [rInp] : [wInp, rInp])),
      set.logRpe ? UI.seg({ label: 'Effort (RPE, optional)', options: [{ value: '', label: 'Skip' }, '6', '7', '8', '9', '10'], value: rpe, onChange: (v) => { rpe = v; } }) : null,
      set.logWarmups ? UI.toggleRow('Warm-up set', 'Not counted toward your targets', warm, (v) => { warm = v; }) : null,
      set.logNotes ? note : null);
    const actions = [{ label: 'Cancel' }];
    if (ex) actions.push({ label: 'Delete', kind: 'danger', run: async () => { await Store.voidEvent(ex.seq); root.App.render(); } });
    actions.push({ label: 'Save', kind: 'primary', run: () => {
      const reps = Math.round(numOrNull(rInp.input.value) || 0);
      const w = opts.bw ? null : numOrNull(wInp.input.value);
      if (!(reps >= 1 && reps <= 100)) { U.toast('Reps must be between 1 and 100.', 'warn'); return false; }
      const tracked = !!Store.getState().plan.lifts[opts.liftId];
      const noWeight = opts.bw || (!tracked && w == null); // accessories can be logged by reps alone
      if (!noWeight && !(w >= 0 && w <= 2000)) { U.toast('Enter the weight you used.', 'warn'); return false; }
      const kg = noWeight ? null : E.clean(U.unitToKg(w, lu));
      if (kg != null && kg > 700) { U.toast('That weight looks too high. Check the unit.', 'warn'); return false; }
      const plan = Store.getState().plan, date = ex ? ex.date : opts.date || U.today();
      const data = { date, week: E.weekOf(plan.startDate, date), lift: opts.liftId, kg, reps };
      if (ex && ex.wo) data.wo = ex.wo; // an edited set stays part of the workout it was logged with
      if (opts.label && !plan.lifts[opts.liftId]) data.name = String(opts.label).slice(0, 60);
      if (rpe) data.rpe = Number(rpe);
      if (warm) data.warmup = true;
      const nt = note.input.value.trim();
      if (nt) data.note = nt.slice(0, 200);
      (async () => {
        if (ex) await Store.voidEvent(ex.seq);
        await Store.append('set_logged', data);
        if (!ex && !warm && set.restTimer) startTimer(opts.restSec || 90, opts.label);
        root.App.render();
      })();
    } });
    U.sheet((ex ? 'Edit set · ' : 'Log set · ') + (opts.label || 'Lift'), body, actions);
  }

  function setChips(sets, opts, lu) {
    const box = h('div', { class: 'setchips' });
    for (const x of sets) {
      box.appendChild(h('button', { type: 'button', class: 'setchip done', 'aria-label': 'Edit logged set', onclick: () => setSheet(Object.assign({}, opts, { existing: x })) },
        (x.warmup ? 'W ' : '') + (x.kg == null ? '' : U.fmtWeight(x.kg, lu, 1) + ' x ') + x.reps));
    }
    box.appendChild(h('button', { type: 'button', class: 'setchip add', onclick: () => setSheet(opts) }, '+ Log set'));
    return box;
  }

  // ---------- weigh-in ----------
  function weighCard(st, set) {
    const t = U.today();
    const todays = st.weights.filter((w) => w.date === t);
    const last = st.weights.length ? st.weights[st.weights.length - 1] : null;
    const inp = UI.field({ label: todays.length ? 'Weigh again' : 'Morning weight', unit: set.bodyUnit, type: 'number', flex: 1, placeholder: last ? U.fmtWeight(last.kg, set.bodyUnit) : '' });
    return UI.card(
      h('div', { class: 'ct' }, 'Weigh-in'),
      todays.length ? h('div', { class: 'muted' }, 'Logged today: ' + todays.map((w) => U.fmtWeight(w.kg, set.bodyUnit) + ' ' + set.bodyUnit).join(', ')) : h('div', { class: 'muted small' }, 'Same time, same conditions. Regoal uses a 7-day average so one bad morning does not matter.'),
      UI.row(inp, UI.btn('Log', { block: false, onClick: async () => {
        const v = numOrNull(inp.input.value);
        const kg = v == null ? null : U.unitToKg(v, set.bodyUnit);
        if (!(kg >= 30 && kg <= 300)) return U.toast('Enter a weight between 30 and 300 kg.', 'warn');
        await Store.append('weight_logged', { date: t, kg: E.clean(kg) });
        U.toast('Logged.'); root.App.render();
      } })));
  }

  // ---------- an exercise beyond today's planned list ----------
  // Logged just for today: either a catalog lift (tracked or not) or a typed name. Never touches the plan.
  function addExtraSheet(t, excludeIds) {
    const CUSTOM_EXTRA = '__custom';
    const st = Store.getState(), plan = st.plan;
    const free = Object.keys(E.CATALOG).filter((id) => !excludeIds.has(id));
    const sel = h('select', { class: 'inp', 'aria-label': 'Exercise' });
    for (const m of E.LIFT_MUSCLES) {
      const ids = free.filter((id) => E.CATALOG[id].muscle === m);
      if (ids.length) sel.appendChild(h('optgroup', { label: cap(m) }, ...ids.map((id) => h('option', { value: id }, E.CATALOG[id].name + (plan.lifts[id] ? ' (tracked)' : '')))));
    }
    sel.appendChild(h('option', { value: CUSTOM_EXTRA }, 'Something else: type a name'));
    const nameF = UI.field({ label: 'Name', maxlength: 40, placeholder: 'e.g. Cable crossover' });
    const customBox = h('div', { class: 'stack hidden' }, nameF);
    const sync = () => customBox.classList.toggle('hidden', sel.value !== CUSTOM_EXTRA);
    sel.addEventListener('change', sync); sync();
    const body = h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Exercise'), sel), customBox,
      h('div', { class: 'muted small' }, 'Logged just for today. It does not change your ongoing plan.'));
    U.sheet('Add an exercise', body, [{ label: 'Cancel' }, { label: 'Next', kind: 'primary', run: () => {
      const custom = sel.value === CUSTOM_EXTRA;
      let id, label, bw;
      if (custom) {
        const name = nameF.input.value.trim().replace(/\s+/g, ' ');
        if (!name) { U.toast('Give it a name.', 'warn'); return false; }
        id = 'acc_' + slug(name); label = name.slice(0, 40); bw = false;
      } else {
        id = sel.value;
        const cat = E.CATALOG[id];
        label = plan.lifts[id] ? plan.lifts[id].name : cat.name;
        bw = plan.lifts[id] ? !!plan.lifts[id].bw : cat.equip === 'bw';
      }
      setSheet({ liftId: id, label, bw, date: t });
    } }]);
  }

  function switchGoalSheet(goal, reason, src) {
    const st = Store.getState(), plan = st.plan, kg = st.weights.length ? st.weights[st.weights.length - 1].kg : st.profile.weightKg;
    const t = E.targetsFor(goal, { sex: st.profile.sex, kg, cm: st.profile.heightCm, age: st.profile.age, days: (st.profile.days || []).length || 5 });
    const base = Object.fromEntries(Object.entries(plan.measTargets).map(([k, m]) => [k, m.start]));
    U.sheet('Switch to ' + goal + '?', h('div', { class: 'stack' },
      h('div', { class: 'kv' }, h('span', null, 'Calories'), h('b', null, U.withCommas(plan.kcal) + ' to ' + U.withCommas(t.kcal))),
      h('div', { class: 'kv' }, h('span', null, 'Protein'), h('b', null, plan.protein + ' g to ' + t.protein + ' g')),
      h('div', { class: 'kv' }, h('span', null, 'Carbs / fat'), h('b', null, t.carbs + ' g / ' + t.fat + ' g')),
      h('div', { class: 'muted small' }, 'Measurement targets are recalculated from your starting numbers. Your logs are untouched.')), [
      { label: 'Not now' },
      { label: 'Switch', kind: 'primary', run: async () => {
        await Store.append('plan_revised', { reason: reason || 'Switched goal to ' + goal, changes: { goal, kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, measTargets: E.measurementTargets(goal, base) } }, src || 'user');
        U.toast('Goal changed.'); root.App.render();
      } }]);
  }
  Screens.switchGoalSheet = switchGoalSheet;

  // ---------- Switch: swap a planned exercise for an alternative, right on Today ----------
  // ex: the planned entry (ex.n, ex.m muscle, ex.lift? tracked id, ex.sets, ex.range). origId: its id for today.
  // date, week: today's date and plan week, so the suggestion carries over sensible starting numbers. Nothing is
  // logged here; a picked candidate is saved as an 'exercise_switched' event for just this date, so the row shows
  // the new exercise instead and any sets logged from then on are logged under it. The original exercise's own
  // plan and progression are untouched, and no AI call happens unless "Ask AI" is tapped.
  function switchSheetToday(ex, origId, date, week) {
    const st = Store.getState(), plan = st.plan, set = Store.getSettings(), lu = set.liftUnit;
    const lift = ex.lift ? plan.lifts[ex.lift] : null;
    const tg = lift ? E.liftTarget(lift, week, E.targetOpts(plan)) : null;
    const lo = parseInt(ex.range, 10);
    const orig = { name: ex.n, muscle: ex.m, sets: tg ? tg.sets : (ex.sets || 3), reps: tg ? tg.reps : (lo > 0 ? lo : 10), kg: tg ? tg.kg : null, bw: !!(lift && lift.bw) };
    const state = { note: '', busy: null, err: '', ai: null };
    const body = h('div', { class: 'stack' });
    const apply = (cand) => {
      const chk = E.cleanExerciseSwitch({ date, from: origId, to: cand });
      if (!chk.ok) { U.toast(chk.errors[0], 'warn'); return; }
      Store.append('exercise_switched', chk.value).then(() => { U.toast('Switched to ' + cand.name + '.'); close(); root.App.render(); });
    };
    function drawRules() {
      const cands = E.substituteCandidates(orig);
      const kids = [h('div', { class: 'muted small' }, 'Same muscle group (' + cap(orig.muscle) + '), different equipment. Starting numbers carry over from ' + ex.n + ' — adjust once you feel it out.')];
      if (!cands.length) kids.push(h('div', { class: 'muted' }, 'No built-in alternative for this one yet. Try Ask AI below.'));
      for (const c of cands) {
        kids.push(h('button', { type: 'button', class: 'listrow', onclick: () => apply(c) },
          h('div', { class: 'grow' }, h('b', null, c.name), h('span', { class: 'muted small' }, c.sets + ' x ' + c.reps + (c.bw ? ' (bodyweight)' : c.kg != null ? ' @ ' + U.fmtLift(c.kg, lu) : ''))),
          U.icon('chev', 16)));
      }
      if (root.App.aiReady()) kids.push(UI.btn('Ask AI to suggest one instead', { kind: 'quiet', onClick: () => { state.err = ''; drawAiForm(); } }));
      else kids.push(h('div', { class: 'muted small' }, 'Add your own AI key in Coach settings and it can also reason about a starting weight, not just pick from this list.'));
      U.put(U.clear(body), ...kids);
    }
    function drawAiForm() {
      const cfg = root.App.llmConfig();
      let host = ''; try { host = new URL(root.LLM.endpointOf(cfg)).host; } catch (e) { host = 'your provider'; }
      const nf = UI.field({ label: 'What do you have instead? (optional)', value: state.note, maxlength: 120, placeholder: 'no cable machine, only dumbbells...', onInput: (v) => { state.note = v; } });
      const errBox = state.err ? h('div', { class: 'warnbox', role: 'alert' }, state.err) : null;
      const go = h('button', { type: 'button', class: 'btn primary block' }, state.busy ? 'Stop' : 'Ask AI');
      if (state.busy) go.insertBefore(h('span', { class: 'spin' }), go.firstChild);
      go.addEventListener('click', async () => {
        if (state.busy) { state.busy.abort(); return; }
        const ctl = new AbortController();
        state.busy = ctl; state.err = ''; drawAiForm();
        try {
          const r = await LiftAI.substitute(cfg, { name: ex.n, muscle: orig.muscle, sets: orig.sets, reps: orig.reps, kg: orig.kg, bw: orig.bw, note: state.note, signal: ctl.signal });
          if (state.busy !== ctl) return;
          state.busy = null; state.ai = r; drawAiConfirm();
        } catch (e) {
          if (state.busy !== ctl) return;
          state.busy = null;
          state.err = e && e.name === 'AbortError' ? 'Stopped.' : String(e && e.message ? e.message : e).slice(0, 300);
          drawAiForm();
        }
      });
      U.put(U.clear(body), nf, h('div', { class: 'muted small' }, 'Sends the exercise name, muscle group, current plan and this note (if any) to ' + host + ' with your key. Nothing changes until you confirm.'),
        errBox, go, UI.btn('Use a built-in alternative instead', { kind: 'quiet', onClick: drawRules }));
    }
    function drawAiConfirm() {
      const v = state.ai.value;
      const nameF = UI.field({ label: 'Exercise', value: v.name, maxlength: 60 });
      const setsF = UI.field({ label: 'Sets', type: 'number', value: v.sets, flex: 1 });
      const repsF = UI.field({ label: 'Reps', type: 'number', value: v.reps, flex: 1 });
      const kgF = UI.field({ label: 'Starting weight', unit: lu, type: 'number', value: v.kg == null ? '' : U.fmtWeight(v.kg, lu, 1), flex: 1 });
      kgF.classList.toggle('hidden', v.bw);
      const bwToggle = UI.toggleRow('Bodyweight', 'No added weight.', v.bw, (on) => { v.bw = on; kgF.classList.toggle('hidden', on); });
      const okBtn = h('button', { type: 'button', class: 'btn primary block' }, 'Use this');
      okBtn.addEventListener('click', () => {
        const bw = v.bw, kgVal = bw ? null : U.unitToKg(numOrNull(kgF.input.value) || 0, lu);
        const chk = E.normalizeLiftSwap({ name: nameF.input.value, equip: bw ? 'bw' : v.equip, bw, sets: numOrNull(setsF.input.value), reps: numOrNull(repsF.input.value), kg: bw ? null : kgVal });
        if (!chk.ok) return U.toast(chk.errors[0], 'warn');
        apply(chk.value);
      });
      const kids = [nameF, UI.row(setsF, repsF), bwToggle, kgF];
      if (v.assumptions.length) kids.push(h('ul', { class: 'assume' }, ...v.assumptions.map((a) => h('li', null, a))));
      kids.push(okBtn, h('div', { class: 'row' }, UI.btn('Ask again', { kind: 'quiet', onClick: drawAiForm }), UI.btn('Use a built-in alternative instead', { kind: 'quiet', onClick: drawRules })));
      U.put(U.clear(body), ...kids);
    }
    drawRules();
    const close = U.sheet('Switch ' + ex.n, body, [{ label: 'Cancel' }]);
  }

  // ---------- Today ----------
  Screens.today = function () {
    const st = Store.getState(), plan = st.plan, set = Store.getSettings();
    const t = U.today();
    const rawWeek = E.weekOf(plan.startDate, t);
    const week = E.clamp(rawWeek, 1, E.planWeeks(plan));
    const deload = plan.deloadWeeks.includes(week);
    const ci = rawWeek <= E.planWeeks(plan) ? E.checkinStatus(st, set.checkinDay, t) : null;
    const pct = Math.min(100, Math.max(0, ((E.daysBetween(plan.startDate, t) + 1) / (E.planWeeks(plan) * 7)) * 100));
    const C = 2 * Math.PI * 34;
    const ring = h('div', { class: 'ring', role: 'img', 'aria-label': 'Plan progress ' + Math.round(pct) + ' percent' },
      s('svg', { viewBox: '0 0 84 84' }, s('circle', { cx: 42, cy: 42, r: 34, fill: 'none', stroke: U.PAL.track, 'stroke-width': 8 }),
        s('circle', { cx: 42, cy: 42, r: 34, fill: 'none', stroke: U.PAL.acc, 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-dasharray': (C * pct / 100).toFixed(1) + ' ' + C.toFixed(1), transform: 'rotate(-90 42 42)' })),
      h('div', { class: 'mid' }, String(Math.round(pct)) + '%', h('small', null, 'of plan')));
    const cards = [];

    cards.push(UI.card(h('div', { class: 'todayhead' }, ring, h('div', { class: 'grow' },
      h('div', { class: 'display big2' }, 'Week ' + week + ' of ' + E.planWeeks(plan)),
      h('div', { class: 'muted' }, cap(plan.goal) + ' · ' + U.withCommas(plan.kcal) + ' kcal · ' + plan.protein + ' g protein'),
      h('div', { class: 'row' }, deload ? U.chip('Deload week: 2 easier sets', 'good') : null, ci ? U.chip(ci.status === 'done' ? 'Check-in done' : ci.status === 'due' ? 'Check-in today' : 'Check-in ' + U.DOW[set.checkinDay], ci.status === 'done' ? 'good' : 'acc') : null)))));

    if (rawWeek > E.planWeeks(plan)) cards.push(UI.cardX('good', h('div', { class: 'ct' }, 'You finished all ' + E.planWeeks(plan) + ' weeks'), h('div', { class: 'muted' }, 'Take your final photos and measurements, then compare against week 1 in Progress. Your logs stay here as long as you keep the app.'), UI.row(UI.btn('Extend the plan', { onClick: Screens.planLengthSheet }), UI.btn('See progress', { kind: 'quiet', href: '#/progress' }))));

    const cp = E.checkpoint(st, t);
    if (cp) cards.push(UI.cardX('acc', h('div', { class: 'ct' }, 'Checkpoint · week ' + cp.week), h('div', null, cp.text), UI.row(UI.btn('Review goal', { kind: 'primary', onClick: () => switchGoalSheet(cp.goal, cp.text, 'checkpoint') }))));

    // Monthly review: rules only, every number has a sentence behind it.
    const monthNo = Math.floor(week / 4);
    if (week >= 4 && (set.reviewSeen || 0) < monthNo) {
      const rev = E.reviewMonth(st, t);
      cards.push(UI.card(h('div', { class: 'ct' }, 'Monthly check-in'), h('div', null, rev.message),
        rev.perWeek != null ? h('div', { class: 'muted small' }, 'Weight trend: ' + (rev.perWeek >= 0 ? '+' : '') + U.fmtWeight(rev.perWeek, set.bodyUnit, 2) + ' ' + set.bodyUnit + ' per week' + (rev.waistDelta != null ? ' · waist ' + (rev.waistDelta >= 0 ? '+' : '') + U.fmtLen(rev.waistDelta, set.lenUnit, 1) + ' ' + set.lenUnit : '')) : null,
        UI.row(
          rev.proposal ? UI.btn('Apply ' + (rev.kcalDelta > 0 ? '+' : '') + rev.kcalDelta + ' kcal', { onClick: async () => { await Store.append('plan_revised', { reason: rev.message, changes: rev.proposal }, 'review'); await Store.saveSettings({ reviewSeen: monthNo }); root.App.render(); } }) : null,
          UI.btn(rev.proposal ? 'Keep as is' : 'Got it', { kind: 'quiet', onClick: async () => { await Store.saveSettings({ reviewSeen: monthNo }); root.App.render(); } }))));
    }

    // Gentle backup nudge: browsers can clear site data, and the file is the only safety net.
    if (set.reminder !== 'off') {
      const since = set.lastBackupAt ? E.daysBetween(set.lastBackupAt.slice(0, 10), t) : E.daysBetween(plan.startDate, t);
      if (since >= (set.reminder === 'monthly' ? 30 : 7)) cards.push(UI.cardX('good', h('div', { class: 'ct' }, 'Back up your data'), h('div', { class: 'muted' }, set.lastBackupAt ? 'Your last backup was ' + since + ' days ago.' : 'You have not made a backup yet.'), UI.btn('Back up now', { href: '#/settings' })));
    }
    if (ci && ci.missed.length) {
      const w = ci.missed[ci.missed.length - 1];
      cards.push(UI.cardX('coral', h('div', { class: 'ct' }, 'The check-in for ' + U.longDate(E.checkinDate(st.plan.startDate, w, set.checkinDay)) + ' is missing'), h('div', { class: 'muted' }, ci.missed.length > 1 ? ci.missed.length + ' weekly check-ins are not finished. Start with the latest.' : 'The weekly photo check-in is not finished. Add the photos you can now.'), UI.btn('Add those photos', { href: '#/photos', onClick: () => Screens._.gotoWeek(w) })));
    }
    if (ci && (ci.status === 'due' || ci.status === 'overdue')) {
      cards.push(UI.cardX(ci.status === 'overdue' ? 'coral' : 'acc', h('div', { class: 'ct' }, ci.status === 'overdue' ? 'Weekly check-in is overdue' : 'Weekly check-in today'),
        h('div', { class: 'muted' }, (ci.taken ? ci.taken + ' of ' + ci.of + ' angles saved. ' : '') + 'Five angles, same light, same spot. It takes two minutes and it is not optional. Change the day in Profile.'),
        UI.btn(ci.taken ? 'Finish the photos' : 'Take photos', { href: '#/photos', onClick: () => Screens._.gotoWeek(ci.week) })));
    }

    // Workout
    const f = E.sessionFor(plan, st.moves, t);
    const wo = f.session;
    const todaySets = st.sets.filter((x) => x.date === t);
    if (wo) {
      const list = h('div', null);
      let doneEx = 0;
      const usedIds = new Set();
      for (const ex of wo.ex) {
        const lift = ex.lift ? plan.lifts[ex.lift] : null;
        const origId = lift ? lift.id : 'acc_' + slug(ex.n);
        usedIds.add(origId);
        const sw = E.exSwitchFor(st, t, origId);
        const id = sw ? 'acc_' + slug(sw.to.name) : origId;
        if (sw) usedIds.add(id);
        const mine = todaySets.filter((x) => x.lift === id);
        const label = sw ? sw.to.name : ex.n;
        let targetTxt, defaultKg = null, defaultReps = null, bw = false;
        if (sw) {
          bw = sw.to.bw;
          targetTxt = sw.to.sets + ' x ' + sw.to.reps + (bw || sw.to.kg == null ? ' reps' : ' @ ' + U.fmtLift(sw.to.kg, set.liftUnit));
          defaultKg = sw.to.kg; defaultReps = sw.to.reps;
          const lastMine = mine.filter((x) => !x.warmup).slice(-1)[0];
          if (lastMine) defaultKg = lastMine.kg;
          if (mine.filter((x) => !x.warmup).length >= sw.to.sets) doneEx++;
        } else if (lift) {
          const tg = E.liftTarget(lift, week, E.targetOpts(plan));
          bw = !!lift.bw;
          targetTxt = tg.sets + ' x ' + tg.reps + (tg.kg == null ? ' reps' : ' @ ' + U.fmtLift(tg.kg, set.liftUnit));
          defaultKg = tg.kg; defaultReps = tg.reps;
          const lastMine = mine.filter((x) => !x.warmup).slice(-1)[0];
          if (lastMine) defaultKg = lastMine.kg;
          if (mine.filter((x) => !x.warmup).length >= tg.sets) doneEx++;
        } else {
          targetTxt = ex.sets + ' x ' + (ex.range || 'work sets');
          const lo = parseInt(ex.range, 10);
          if (lo > 0) defaultReps = lo;
          const lastMine = mine.slice(-1)[0];
          if (lastMine) defaultKg = lastMine.kg;
          if (mine.filter((x) => !x.warmup).length >= ex.sets) doneEx++;
        }
        const opts = { liftId: id, label, bw, defaultKg, defaultReps, restSec: ex.rest || 90 };
        const canSwitch = mine.length === 0; // decide before the first set; keeps the id stable once you've started
        list.appendChild(h('div', { class: 'exrow' },
          h('div', { class: 'exname' },
            h('div', { class: 'row' },
              h('span', null, label),
              canSwitch && ex.m ? h('button', { type: 'button', class: 'iconbtn tiny', 'aria-label': 'Switch ' + label + ' for an alternative', onclick: () => switchSheetToday(ex, origId, t, week) }, U.icon('swap', 14)) : null,
              sw && canSwitch ? h('button', { type: 'button', class: 'iconbtn tiny', 'aria-label': 'Switch back to ' + ex.n, onclick: () => { Store.voidEvent(sw.seq).then(() => root.App.render()); } }, U.icon('undo', 14)) : null),
            h('span', { class: 'extarget' }, targetTxt)),
          sw ? h('div', { class: 'muted small' }, 'Switched from ' + ex.n + '.') : null,
          ex.flag ? h('div', { class: 'flag' }, ex.flag) : null,
          setChips(mine, opts, set.liftUnit)));
      }
      // Extra exercises logged today beyond the planned list (e.g. an accessory the person felt like adding).
      const extraIds = Array.from(new Set(todaySets.filter((x) => !usedIds.has(x.lift)).map((x) => x.lift)));
      const extraList = extraIds.length ? h('div', null, ...extraIds.map((id) => {
        const mine = todaySets.filter((x) => x.lift === id);
        const lift = plan.lifts[id];
        const label = mine[0].name || (lift ? lift.name : id);
        const bw = lift ? !!lift.bw : false;
        return h('div', { class: 'exrow' },
          h('div', { class: 'exname' }, h('span', null, label), h('span', { class: 'extarget' }, 'Extra')),
          setChips(mine, { liftId: id, label, bw, date: t }, set.liftUnit));
      })) : null;
      const timeDone = st.workouts.some((w) => w.date === t && w.type === 'strength');
      cards.push(UI.card(
        h('div', { class: 'todayhead' }, h('div', { class: 'grow' }, h('div', { class: 'ct' }, wo.name + ' day'), h('div', { class: 'muted small' }, doneEx + ' of ' + wo.ex.length + ' exercises done · ' + (f.moved ? 'moved here' : 'suggested for today'))),
          h('button', { class: 'btn quiet small', type: 'button', onclick: () => Screens.rescheduleSheet(t) }, 'Change')),
        h('div', { class: 'row' }, U.chip(set.restTimer ? 'Rest timer on' : 'Timer off', 'line'), h('span', { class: 'muted small' }, 'Just a suggestion. Move it if your week changes.')),
        list,
        extraList,
        h('button', { class: 'linkbtn', type: 'button', onclick: () => addExtraSheet(t, usedIds) }, '+ Add an exercise'),
        todaySets.some((x) => !x.warmup) && !timeDone ? h('button', { class: 'linkbtn', type: 'button', onclick: () => Screens.workoutSheet({ type: 'strength', date: t, session: wo.name }) }, 'Add how long it took, to count the calories') : null,
        h('button', { class: 'linkbtn', type: 'button', onclick: () => Screens.upcomingSheet(t) }, 'See what\'s coming up')));
    } else {
      const nextIdx = [1, 2, 3, 4, 5, 6, 7].map((d) => E.sessionFor(plan, st.moves, E.addDays(t, d))).map((x) => x.session).find(Boolean);
      const restIds = Array.from(new Set(todaySets.map((x) => x.lift)));
      const restList = restIds.length ? h('div', null, ...restIds.map((id) => {
        const mine = todaySets.filter((x) => x.lift === id);
        const lift = plan.lifts[id];
        const label = mine[0].name || (lift ? lift.name : id);
        const bw = lift ? !!lift.bw : false;
        return h('div', { class: 'exrow' }, h('div', { class: 'exname' }, h('span', null, label)), setChips(mine, { liftId: id, label, bw, date: t }, set.liftUnit));
      })) : null;
      cards.push(UI.card(h('div', { class: 'ct' }, 'Rest day'), h('div', { class: 'muted' }, (f.planned ? f.planned.name + ' was moved off today. ' : '') + 'A light walk counts.'),
        restList,
        UI.row(UI.btn('Train anyway', { kind: 'quiet', onClick: () => Screens.rescheduleSheet(t) }), UI.btn('Lifts', { kind: 'quiet', href: '#/lifts' })),
        h('button', { class: 'linkbtn', type: 'button', onclick: () => addExtraSheet(t, new Set()) }, '+ Log an exercise anyway'),
        h('button', { class: 'linkbtn', type: 'button', onclick: () => Screens.upcomingSheet(t) }, nextIdx ? 'Next up: ' + nextIdx.name + '. See what\'s coming up' : 'See what\'s coming up')));
    }
    const gc = Screens.goalsTodayCard ? Screens.goalsTodayCard() : null;
    if (gc) cards.push(gc);
    cards.push(Screens.activityCard(st, set));

    // Food summary
    const tot = E.dayTotals(st, t);
    cards.push(UI.card(h('div', { class: 'target-top' }, h('div', { class: 'ct' }, 'Fuel today'), h('a', { class: 'chip line', href: '#/fuel' }, 'Log food')),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'display big' }, U.withCommas(tot.kcal), h('span', { class: 'muted unitbig' }, ' / ' + U.withCommas(plan.kcal) + ' kcal'))), h('div', { class: 'muted' }, tot.n ? Math.round(tot.protein) + ' / ' + plan.protein + ' g protein' : 'Nothing logged')),
      U.bar(plan.kcal ? (tot.kcal / plan.kcal) * 100 : 0, tot.kcal > plan.kcal * 1.1 ? 'coral' : '', true)));

    cards.push(Screens.waterCard(st, set));
    cards.push(weighCard(st, set));
    const tb = timerBar();
    if (tb) cards.push(tb);
    const left = Screens.volatile ? h('div', { class: 'warnbox' }, 'Storage is blocked in this browser mode. Nothing here will be kept.') : null;
    return UI.page(UI.header('Today', U.longDate(t), { right: h('div', { class: 'hdr-actions' }, h('a', { class: 'iconbtn', href: '#/profile', 'aria-label': 'Profile' }, U.icon('user', 20)), h('a', { class: 'iconbtn', href: '#/settings', 'aria-label': 'Privacy, backup and settings' }, U.icon('shield', 20))) }), UI.scroller(left, ...cards));
  };

  // ---------- Lifts ----------
  let viewWeek = null;
  function statusChip(st) { return h('span', { class: 'status-' + st }, st); }
  // The lifts of the plan by week, as the body of the strength goal on the Goals tab.
  Screens.liftsBody = function () {
    const state = Store.getState(), plan = state.plan, set = Store.getSettings(), t = U.today();
    const cur = E.clamp(E.weekOf(plan.startDate, t), 1, E.planWeeks(plan));
    const w = viewWeek == null ? cur : viewWeek;
    const rows = Object.values(plan.lifts).map((l) => {
      const ls = E.liftStatus(state, l.id, w, t);
      const tg = ls.target;
      return h('a', { class: 'liftcard', href: '#/lifts/' + l.id },
        h('div', { class: 'grow' }, h('b', null, l.name), h('span', { class: 'muted small' }, tg.sets + ' x ' + tg.reps + (tg.kg == null ? ' reps' : ' @ ' + U.fmtLift(tg.kg, set.liftUnit)) + (tg.deload ? ' · deload' : ''))),
        h('div', { class: 'small' }, w <= cur ? statusChip(ls.status) : h('span', { class: 'muted' }, 'Ahead')),
        U.icon('chev', 18));
    });
    const nav = h('div', { class: 'daynav' },
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Previous week', disabled: w <= 1, onclick: () => { viewWeek = w - 1; root.App.render(); } }, U.icon('back', 20)),
      h('div', { class: 'grow', style: { textAlign: 'center' } }, h('div', { class: 'd' }, 'Week ' + w), h('div', { class: 'muted small' }, U.shortDate(E.weekRange(plan.startDate, w)[0]) + ' to ' + U.shortDate(E.weekRange(plan.startDate, w)[1]) + (w === cur ? ' · this week' : ''))),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Next week', disabled: w >= E.planWeeks(plan), onclick: () => { viewWeek = w + 1; root.App.render(); } }, U.icon('chev', 20)));
    const hit = Object.values(plan.lifts).filter((l) => E.liftStatus(state, l.id, cur, t).status === 'Hit').length;
    return [
      nav,
      w !== cur ? h('button', { class: 'linkbtn', type: 'button', onclick: () => { viewWeek = null; root.App.render(); } }, 'Jump to this week') : null,
      UI.card(...(rows.length ? rows : [UI.empty('No tracked lifts yet. Add one below.')])),
      h('div', { class: 'muted small' }, hit + ' of ' + rows.length + ' lifts hit this week' + (plan.deloadWeeks.includes(w) ? '. Week ' + w + ' is a deload: 2 sets at last block\'s weight.' : '.')),
      UI.btn('Add a lift', { kind: 'quiet', icon: 'plus', onClick: addLiftSheet })];
  };
  Screens.lifts = function () { return Screens.goals('plan'); };

  // ---------- choosing a lift: one Regoal knows, or one you make up ----------
  const CUSTOM = '__custom';
  const EQUIP_LABEL = { db: 'Dumbbells', machine: 'Machine or cable', barbell: 'Barbell', bw: 'Bodyweight' };
  const CLS_LABEL = { heavy: 'Heavy compound (about 6 to 10 reps)', medium: 'Medium (about 8 to 12 reps)', high: 'High-rep isolation (about 12 to 16 reps)' };
  // The form body. o: { taken: Set of ids already tracked, unit, sessions?: [names] }. read() returns { error } or the choice.
  function liftForm(o) {
    const free = Object.keys(E.CATALOG).filter((id) => !o.taken.has(id));
    const sel = h('select', { class: 'inp', 'aria-label': 'Lift' });
    for (const m of E.LIFT_MUSCLES) {
      const ids = free.filter((id) => E.CATALOG[id].muscle === m);
      if (ids.length) sel.appendChild(h('optgroup', { label: cap(m) }, ...ids.map((id) => h('option', { value: id }, E.CATALOG[id].name))));
    }
    sel.appendChild(h('option', { value: CUSTOM }, 'Something else: your own lift'));
    const nameF = UI.field({ label: 'Name', maxlength: 40, placeholder: 'e.g. Trap bar deadlift' });
    const mus = h('select', { class: 'inp', 'aria-label': 'Muscle' }, ...E.LIFT_MUSCLES.map((m) => h('option', { value: m }, cap(m))));
    const eq = h('select', { class: 'inp', 'aria-label': 'Equipment' }, ...E.LIFT_EQUIP.map((x) => h('option', { value: x }, EQUIP_LABEL[x])));
    const cls = h('select', { class: 'inp', 'aria-label': 'Type of lift' }, ...E.LIFT_CLS.map((x) => h('option', { value: x }, CLS_LABEL[x])));
    cls.value = 'medium';
    const customBox = h('div', { class: 'stack hidden' }, nameF,
      h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Muscle'), mus), h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Equipment'), eq),
      h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Type'), cls));
    const w = UI.field({ label: 'Weight you can do for a solid set', unit: o.unit, type: 'number', flex: 1 });
    const r = UI.field({ label: 'Reps', type: 'number', inputmode: 'numeric', flex: 1 });
    const wRow = UI.row(w, r);
    let place = null;
    if (o.sessions) {
      place = h('select', { class: 'inp', 'aria-label': 'Goes on' }, h('option', { value: '' }, 'Best fit for the muscle'), ...o.sessions.map((n) => h('option', { value: n }, n)), h('option', { value: '-' }, 'None, just track it'));
    }
    const isBw = () => (sel.value === CUSTOM ? eq.value : E.CATALOG[sel.value].equip) === 'bw';
    const sync = () => { customBox.classList.toggle('hidden', sel.value !== CUSTOM); w.classList.toggle('hidden', isBw()); r.querySelector('.lab').textContent = isBw() ? 'Reps you can do' : 'Reps'; };
    sel.addEventListener('change', sync); eq.addEventListener('change', sync); sync();
    const body = h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Lift'), sel), customBox, wRow,
      place ? h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Goes on'), place) : null,
      h('div', { class: 'muted small' }, 'Regoal builds the same block progression for it, starting from where the plan is this week. For bodyweight lifts just enter reps.'));
    const read = () => {
      const reps = numOrNull(r.input.value), wt = numOrNull(w.input.value), custom = sel.value === CUSTOM;
      let spec = null;
      if (custom) {
        const name = nameF.input.value.trim().replace(/\s+/g, ' ');
        if (!name) return { error: 'Give the lift a name.' };
        spec = { name: name.slice(0, 40), muscle: mus.value, equip: eq.value, cls: cls.value };
        spec.gain = E.defaultGain(spec.cls, spec.equip);
      }
      if (isBw()) { if (!(reps > 0 && reps <= 100)) return { error: 'Add your reps.' }; }
      else if (!(wt > 0 && wt <= 2000)) return { error: 'Add a weight.' };
      return { catalogId: custom ? null : sel.value, custom: spec, weight: isBw() ? null : wt, reps: reps > 0 ? reps : null, place: place ? place.value : '' };
    };
    return { body, read };
  }
  Screens._.liftForm = liftForm;

  function addLiftSheet() {
    const st = Store.getState(), plan = st.plan, set = Store.getSettings(), prof = st.profile;
    const form = liftForm({ taken: new Set(Object.keys(plan.lifts)), unit: set.liftUnit, sessions: plan.workouts.map((x) => x.name) });
    U.sheet('Add a lift', form.body, [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', run: () => {
      const c = form.read();
      if (c.error) { U.toast(c.error, 'warn'); return false; }
      const id = c.custom ? E.newLiftId(plan, c.custom.name) : c.catalogId;
      const t = prof.training || {};
      const sameUnit = !(prof.units && prof.units.lift) || prof.units.lift === set.liftUnit; // steps were chosen in the profile's unit
      const input = Object.assign({ id, on: true, weight: c.weight, reps: c.reps }, c.custom || {});
      const built = E.buildLiftPlan([input], { dbStep: sameUnit ? t.dbStep : null, machineStep: sameUnit ? t.machineStep : null, sets: t.sets, repStyle: t.repStyle, lighter: false }, set.liftUnit); // the weight was typed in this unit
      const lift = built[id];
      if (!lift) { U.toast('Could not build that lift.', 'warn'); return false; }
      const wk = E.clamp(E.weekOf(plan.startDate, U.today()), 1, E.planWeeks(plan));
      if (!lift.bw && wk > 1) {
        const now = E.liftTarget(lift, wk, E.targetOpts(plan)).kg;
        if (now > 0) lift.adjust.push({ fromWeek: wk, factor: E.clean(lift.blockKg[0] / now) });
      }
      const changes = { addLifts: { [id]: lift } };
      if (c.place) changes.placeLifts = { [id]: c.place };
      Store.append('plan_revised', { reason: 'Added ' + lift.name, changes }, 'user').then(() => { U.toast(lift.name + ' added.'); root.App.render(); });
    } }]);
  }

  // ---------- one lift ----------
  Screens.liftDetail = function (id) {
    const state = Store.getState(), plan = state.plan, set = Store.getSettings(), t = U.today();
    const lift = E.hasLift(plan, id) ? plan.lifts[id] : null;
    if (!lift) return UI.page(UI.header('Lift', 'Not found', { back: '#/lifts' }), UI.scroller(UI.empty('That lift is not in your plan.')));
    const cur = E.clamp(E.weekOf(plan.startDate, t), 1, E.planWeeks(plan));
    const tgs = [], top = [];
    for (let w = 1; w <= E.planWeeks(plan); w++) {
      const ls = E.liftStatus(state, id, w, t);
      tgs.push({ x: w, y: ls.target.kg == null ? ls.target.reps : U.kgToUnit(ls.target.kg, set.liftUnit) });
      top.push({ x: w, y: ls.logged ? (lift.bw ? ls.topReps : ls.topKg == null ? null : U.kgToUnit(ls.topKg, set.liftUnit)) : null });
    }
    const chart = U.lineChart({ label: lift.name + ' target and logged top set by week', xs: tgs.map((p) => p.x), series: [{ pts: tgs, color: U.PAL.acc, dash: '5 4', width: 2 }, { pts: top, color: U.PAL.cool, dots: true, line: false }], xLabel: (x) => 'Wk ' + x, fmtY: (y) => U.num(y, 0) });
    const rows = [];
    for (let w = 1; w <= E.planWeeks(plan); w++) {
      const ls = E.liftStatus(state, id, w, t), tg = ls.target;
      const cls = w === cur ? ' cur' : '';
      rows.push(h('div', { class: 'kv' + cls },
        h('span', null, 'Wk ' + w + (tg.deload ? ' (deload)' : '') + (w === cur ? ' · now' : '')),
        h('b', null, tg.sets + ' x ' + tg.reps + (tg.kg == null ? '' : ' @ ' + U.fmtLift(tg.kg, set.liftUnit)) + (w <= cur ? '  ' : ''), w <= cur ? statusChip(ls.status) : null)));
    }
    const mine = state.sets.filter((x) => x.lift === id).slice(-12).reverse();
    const hist = mine.length ? mine.map((x) => h('button', { type: 'button', class: 'listrow', onclick: () => setSheet({ liftId: id, label: lift.name, bw: !!lift.bw, existing: x }) },
      h('div', { class: 'grow' }, h('b', null, (x.kg == null ? '' : U.fmtWeight(x.kg, set.liftUnit, 1) + ' ' + set.liftUnit + ' x ') + x.reps + (x.rpe ? ' @ RPE ' + x.rpe : '') + (x.warmup ? ' (warm-up)' : '')), h('span', { class: 'muted small' }, U.shortDate(x.date) + (x.note ? ' · ' + x.note : ''))), U.icon('chev', 16))) : [UI.empty('No sets logged yet.')];
    const adjust = () => {
      const pct = UI.field({ label: 'Change all weights by', unit: '%', type: 'number', value: '', hint: 'Between -10 and 10, e.g. -5 if it has been too heavy.' });
      const from = UI.field({ label: 'From week', type: 'number', inputmode: 'numeric', value: cur });
      U.sheet('Adjust ' + lift.name, h('div', { class: 'stack' }, UI.row(pct, from)), [{ label: 'Cancel' }, { label: 'Apply', kind: 'primary', run: () => {
        const v = E.validateLiftChange(plan, { lift: id, percent: numOrNull(pct.input.value), fromWeek: numOrNull(from.input.value) });
        if (!v.ok) { U.toast(v.errors[0], 'warn'); return false; }
        Store.append('plan_revised', { reason: 'Adjusted ' + lift.name + ' by ' + pct.input.value + '%', changes: { liftAdjust: v.value } }, 'user').then(() => { U.toast('Updated.'); root.App.render(); });
      } }]);
    };
    const stop = () => U.confirmSheet('Stop tracking ' + lift.name + '?', 'It leaves your Lifts list and the weekly targets. Every set you logged stays in your data and backups, and the exercise stays in its workout as a plain exercise you can still log. You can add it back any time.', 'Stop tracking', () => {
      Store.append('plan_revised', { reason: 'Stopped tracking ' + lift.name, changes: { removeLift: id } }, 'user').then(() => { U.toast('Stopped tracking ' + lift.name + '.'); root.App.go('#/lifts'); });
    });
    return UI.page(UI.header(lift.name, cap(lift.muscle) + (lift.bw ? ' · bodyweight' : ' · steps of ' + lift.step + ' ' + lift.unit), { back: '#/lifts' }), UI.scroller(
      UI.card(h('div', { class: 'ct' }, 'Target vs what you lifted'), chart, h('div', { class: 'muted small' }, 'Dashed: target. Dots: your top set each week.')),
      UI.card(h('div', { class: 'ct' }, 'Recent sets'), h('div', { class: 'list' }, ...hist)),
      lift.bw ? null : UI.btn('Adjust weights', { kind: 'quiet', onClick: adjust }),
      UI.btn('Stop tracking this lift', { kind: 'quiet', onClick: stop }),
      UI.card(h('div', { class: 'ct' }, 'All ' + E.planWeeks(plan) + ' weeks'), ...rows)));
  };

  root.Screens.setSheet = setSheet;
  root.Screens.startTimer = startTimer;
})(self);

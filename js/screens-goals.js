/*
 * Goals: the tab where everything a person is working towards lives. A switcher at the top shows All goals or one goal at a time.
 * The strength and muscle plan is always there; running, cycling, swimming and custom goals are added by the person, each with
 * its own length and target, and each can be edited, closed and renewed. Progress is worked out in goals.js from the log.
 * Everything on screen is built with text nodes, never HTML strings.
 */
(function (root) {
  'use strict';
  const E = root.Engine, G = root.Goals, U = root.U, UI = root.UI, Store = root.Store;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};

  const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
  const unitNow = () => G.distUnitFor(Store.getSettings());
  const TONE = { ahead: 'good', on: 'good', behind: 'coral', reached: 'acc', ended: 'line', nodata: 'line', notstarted: 'line', closed: 'line' };
  const chipFor = (p) => U.chip(p.label, TONE[p.status] || 'line');
  const barFor = (p) => U.bar(Math.round((p.pct || 0) * 100), p.status === 'behind' ? 'coral' : p.status === 'reached' ? '' : 'cool');
  const num = (x) => { const s = String(x == null ? '' : x).trim().replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
  const trim = (x, dp) => { const f = Math.pow(10, dp == null ? 2 : dp); return String(Math.round(x * f) / f); };
  const KIND_WORD = { build: 'Build week', cutback: 'Lighter week', taper: 'Taper week', goal: 'Goal week' };

  // ---------- how long: presets in months, or any number of weeks ----------
  // Returns an element with .get() and .set(). o: { weeks, min, onChange }
  function lengthPicker(o) {
    let weeks = o.weeks, custom = !E.PLAN_LENGTHS.some((x) => x[0] === weeks);
    const min = o.min || 1;
    const box = h('div', { class: 'pills', role: 'group', 'aria-label': 'How long' });
    const field = UI.field({ label: 'Weeks', type: 'number', inputmode: 'numeric', value: weeks, min, max: E.MAX_WEEKS, hint: min > 1 ? 'From ' + min + ' to ' + E.MAX_WEEKS + ' weeks.' : 'From 1 to ' + E.MAX_WEEKS + ' weeks.', onInput: (v) => { const n = Math.round(Number(v)); if (n >= min && n <= E.MAX_WEEKS) { weeks = n; if (!o.lazy) o.onChange(n); } } });
    field.input.addEventListener('change', () => { const n = Math.round(Number(field.input.value)); if (n >= min && n <= E.MAX_WEEKS) { weeks = n; if (o.lazy) o.onChange(n); } else field.input.value = String(weeks); });
    const draw = () => {
      box.textContent = '';
      for (const [w, label] of E.PLAN_LENGTHS) {
        if (w < min) continue;
        const on = !custom && w === weeks;
        box.appendChild(h('button', { type: 'button', class: 'pill' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: () => { custom = false; weeks = w; field.input.value = String(w); draw(); o.onChange(w); } }, label));
      }
      box.appendChild(h('button', { type: 'button', class: 'pill' + (custom ? ' on' : ''), 'aria-pressed': custom ? 'true' : 'false', onclick: () => { custom = true; draw(); field.input.focus(); } }, 'Custom'));
      field.classList.toggle('hidden', !custom);
    };
    draw();
    const wrap = h('div', { class: 'pillwrap' }, h('div', { class: 'lab' }, o.label || 'How long'), box, field);
    wrap.get = () => weeks;
    return wrap;
  }
  Screens.lengthPicker = lengthPicker;

  // ---------- the plan's own length ----------
  Screens.planLengthSheet = function () {
    const st = Store.getState(), plan = st.plan, t = U.today();
    const n = E.planWeeks(plan), cur = E.weekOf(plan.startDate, t);
    const min = Math.max(E.MIN_WEEKS, Math.min(cur, E.MAX_WEEKS));
    let weeks = n;
    const note = h('div', { class: 'muted small' });
    const sync = () => { note.textContent = weeks === n ? 'No change.' : weeks > n ? 'Adds ' + (weeks - n) + ' weeks. Lift targets keep climbing, with a lighter week every 7th week.' : 'Cuts the plan by ' + (n - weeks) + ' weeks. Every week you have done keeps its numbers.'; };
    const picker = lengthPicker({ weeks: n, min, label: 'Plan length', onChange: (w) => { weeks = w; sync(); } });
    sync();
    U.sheet('Change plan length', h('div', { class: 'stack' }, h('div', { class: 'muted' }, 'You are in week ' + Math.max(1, cur) + ' of ' + n + '. Your logs, photos and history stay exactly as they are.'), picker, note), [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', run: () => {
      if (weeks === n) return true;
      if (weeks < min) { U.toast('The plan cannot end before this week.', 'warn'); return false; }
      Store.append('plan_revised', { reason: 'Plan length changed from ' + n + ' to ' + weeks + ' weeks', changes: { weeks } }, 'user').then(() => { U.toast('Plan is now ' + weeks + ' weeks.'); root.App.render(); });
    } }]);
  };

  // ---------- add or edit a goal ----------
  const PACE_LABEL = { aim: { distance: 'A distance', pace: 'A pace', weekly: 'Weekly volume' } };
  const AIM_HELP = {
    distance: 'Cover a distance in one go, like a 10K, a half marathon or a 1 km swim. Progress is your longest session.',
    pace: 'Get faster over a set distance. Progress is your best pace over about 90% of it.',
    weekly: 'Build up how much you do in a week. Progress is your biggest week.',
  };
  function goalSheet(o) {
    const st = Store.getState(), t = U.today(), unit = unitNow();
    const ex = o && o.goal ? o.goal : null, d = ex || (o && o.draft) || null;
    const newId = ex ? ex.id : E.newGoalId();
    const dispDist = (km, sport) => (km == null ? '' : trim(G.fromKm(km, G.distInput(sport, unit)), 2));
    const dispPace = (sec, sport) => (sec > 0 ? G.fmtPace(sec, sport, unit).split(' ')[0] : '');
    const v = {
      kind: d ? d.kind : 'endurance', sport: (d && d.sport) || 'running', aim: (d && d.aim) || 'distance',
      title: d ? d.title : '', touched: !!d, weeks: d ? d.weeks : 13, start: d ? d.start : t, note: d ? d.note : '',
      target: '', paceKm: '', pace: '', from: '', pace0: '', unitTxt: d ? d.unit : '', cFrom: '', cTarget: '',
    };
    if (d && d.kind === 'endurance') {
      if (d.aim === 'pace') { v.pace = dispPace(d.target, d.sport); v.pace0 = dispPace(d.from, d.sport); v.paceKm = dispDist(d.paceKm, d.sport); }
      else { v.target = dispDist(d.target, d.sport); v.from = d.from == null ? '' : dispDist(d.from, d.sport); }
    } else if (d && d.kind === 'custom') { v.cFrom = trim(d.from, 3); v.cTarget = trim(d.target, 3); }

    const dyn = h('div', { class: 'stack' });
    const preview = h('div', { class: 'muted small goalprev' });
    const titleF = UI.field({ label: 'Name', maxlength: 40, value: v.title, placeholder: 'e.g. Half marathon in March', onInput: (x) => { v.title = x; v.touched = true; } });
    const distLabel = () => G.distInput(v.sport, unit);
    const raceName = (km) => { const r = G.SPORTS[v.sport].races.find((x) => Math.abs(x[1] - km) < 0.01); return r ? r[0] : null; };
    const autoTitle = () => {
      const sp = G.sportOf(v.sport).name;
      if (v.kind === 'custom') return v.unitTxt ? cap(v.unitTxt) + ' goal' : 'My goal';
      if (v.aim === 'pace') return sp + ' pace';
      if (v.aim === 'weekly') return sp + ' volume';
      const km = G.toKm(num(v.target), distLabel());
      return Number.isFinite(km) && km > 0 ? (raceName(km) ? raceName(km) : sp + ' ' + G.fmtDist(km, unit, v.sport)) : sp + ' distance';
    };
    const syncTitle = () => { if (!v.touched) titleF.input.value = autoTitle(); };
    // The goal as typed, ready for the whitelist.
    const read = () => {
      const raw = { id: newId, kind: v.kind, title: (v.title || '').trim() || autoTitle(), start: v.start, weeks: v.weeks, status: ex ? ex.status : 'active', closedOn: ex ? ex.closedOn : null, prev: d ? d.prev : null, note: v.note };
      if (v.kind === 'custom') { raw.unit = v.unitTxt; raw.from = num(v.cFrom); raw.target = num(v.cTarget); return raw; }
      raw.sport = v.sport; raw.aim = v.aim;
      const km = (x) => { const n = num(x); return n == null ? null : n === n ? G.toKm(n, distLabel()) : NaN; };
      if (v.aim === 'pace') { raw.paceKm = km(v.paceKm); raw.target = G.parsePace(v.pace, v.sport, unit); raw.from = v.pace0.trim() ? G.parsePace(v.pace0, v.sport, unit) : null; }
      else { raw.target = km(v.target); raw.from = km(v.from); }
      return raw;
    };
    const refresh = () => {
      syncTitle();
      preview.textContent = '';
      if (v.kind === 'custom') { preview.textContent = 'You type in a reading whenever you have one, and Regoal draws a straight line from where you are to the target over the time you set.'; return; }
      const raw = read(), chk = E.cleanGoal(raw);
      if (!chk.ok) { preview.textContent = 'Fill in the target to see the week-by-week plan.'; return; }
      const g = chk.value, from = G.baseline(st, g);
      if (!(from > 0)) return;
      const p = G.buildPath(g, from), sp = g.sport, first = p.weeks[0], last = p.weeks[p.weeks.length - 1];
      const line = g.aim === 'pace'
        ? 'Week 1 asks for ' + G.fmtPace(first.target, sp, unit) + ', the last week for ' + G.fmtPace(last.target, sp, unit) + '.'
        : g.aim === 'weekly'
          ? 'Starts near ' + G.fmtDist(first.target, unit, sp) + ' a week and climbs to ' + G.fmtDist(g.target, unit, sp) + ', with a lighter week after every third build week.'
          : 'Longest session starts near ' + G.fmtDist(first.target, unit, sp) + ' and builds to ' + G.fmtDist(p.peak, unit, sp) + (p.taper > 1 ? ', then a ' + p.taper + '-week taper' : '') + ' before the day. Lighter week after every third build week.';
      preview.appendChild(h('div', null, line));
      if (p.note) preview.appendChild(h('div', { class: 'warnbox' }, p.note));
    };
    const field = (label, key, extra) => UI.field(Object.assign({ label, value: v[key], onInput: (x) => { v[key] = x; refresh(); } }, extra || {}));

    const drawDyn = () => {
      dyn.textContent = '';
      if (v.kind === 'custom') {
        dyn.appendChild(field('Unit', 'unitTxt', { maxlength: 12, placeholder: 'e.g. reps, bpm, seconds, steps' }));
        dyn.appendChild(UI.row(field('Where you are today', 'cFrom', { type: 'number', flex: 1 }), field('Target', 'cTarget', { type: 'number', flex: 1 })));
        dyn.appendChild(h('div', { class: 'muted small' }, 'Works in either direction: pull-ups go up, resting heart rate goes down.'));
        return;
      }
      const sportSel = h('select', { class: 'inp', 'aria-label': 'Sport' }, ...Object.keys(G.SPORTS).map((k) => h('option', { value: k }, G.SPORTS[k].name)));
      sportSel.value = v.sport;
      sportSel.addEventListener('change', () => { v.sport = sportSel.value; v.target = ''; v.from = ''; v.paceKm = ''; v.pace = ''; v.pace0 = ''; drawDyn(); refresh(); });
      dyn.appendChild(h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Sport'), sportSel));
      dyn.appendChild(UI.seg({ label: 'What are you aiming for', options: Object.keys(PACE_LABEL.aim).map((k) => ({ value: k, label: PACE_LABEL.aim[k] })), value: v.aim, onChange: (x) => { v.aim = x; v.target = ''; v.from = ''; v.pace = ''; v.pace0 = ''; drawDyn(); refresh(); } }));
      dyn.appendChild(h('div', { class: 'muted small' }, AIM_HELP[v.aim]));
      const du = distLabel();
      if (v.aim === 'distance') {
        const tf = field('Target distance', 'target', { type: 'number', unit: du, id: 'gtarget' });
        const pills = h('div', { class: 'pills' }, ...G.SPORTS[v.sport].races.map(([name, km]) => h('button', { type: 'button', class: 'pill', onclick: () => { v.target = trim(G.fromKm(km, du), 2); tf.input.value = v.target; refresh(); } }, name)));
        dyn.appendChild(pills); dyn.appendChild(tf);
        dyn.appendChild(field('Your longest recent session', 'from', { type: 'number', unit: du, hint: 'Leave empty and Regoal uses your last 4 weeks of ' + G.sportOf(v.sport).name.toLowerCase() + ' workouts.' }));
      } else if (v.aim === 'weekly') {
        dyn.appendChild(field('Target a week', 'target', { type: 'number', unit: du }));
        dyn.appendChild(field('Your typical week today', 'from', { type: 'number', unit: du, hint: 'Leave empty and Regoal uses your last 4 weeks.' }));
      } else {
        dyn.appendChild(field('Over what distance', 'paceKm', { type: 'number', unit: du, placeholder: v.sport === 'swimming' ? '400' : '5' }));
        dyn.appendChild(UI.row(field('Target pace', 'pace', { flex: 1, placeholder: v.sport === 'cycling' ? '30' : '5:00' }), field('Your pace today', 'pace0', { flex: 1, placeholder: v.sport === 'cycling' ? '26' : '5:40' })));
        dyn.appendChild(h('div', { class: 'muted small' }, G.paceHint(v.sport, unit) + ' (' + G.paceInfo(v.sport, unit).label + ').'));
      }
    };
    const kindSeg = ex ? null : UI.seg({ label: 'What kind of goal', options: [{ value: 'endurance', label: 'Run, ride or swim' }, { value: 'custom', label: 'Something else' }], value: v.kind, onChange: (x) => { v.kind = x; if (x === 'custom' && !v.touched) titleF.input.value = ''; drawDyn(); refresh(); } });
    const picker = lengthPicker({ weeks: v.weeks, min: 1, label: 'How long is this cycle', onChange: (w) => { v.weeks = w; refresh(); } });
    const startF = UI.field({ label: 'Starts', type: 'date', value: v.start, onInput: (x) => { if (/^\d{4}-\d{2}-\d{2}$/.test(x)) { v.start = x; refresh(); } } });
    const noteF = UI.field({ label: 'Note (optional)', maxlength: 200, value: v.note, onInput: (x) => { v.note = x; }, hint: 'Stays on this device. The coach never sees it.' });
    drawDyn(); refresh();
    const body = h('div', { class: 'stack' }, kindSeg, titleF, dyn, picker, startF, preview, noteF);
    const actions = [{ label: 'Cancel' }];
    if (ex) actions.push({ label: 'Delete', kind: 'danger', run: (close) => { U.confirmSheet('Delete this goal?', 'This removes the goal and any readings you typed for it. Your workouts stay.', 'Delete', () => { close(); return deleteGoal(ex.id); }, true); }, keep: true });
    actions.push({ label: ex ? 'Save' : 'Set goal', kind: 'primary', run: () => {
      const chk = E.cleanGoal(read());
      if (!chk.ok) { U.toast(chk.errors[0], 'warn'); return false; }
      Store.append('goal_set', { goal: chk.value }, 'user').then(() => { U.toast(ex ? 'Goal updated.' : 'Goal set. Now go and do the first bit.'); root.App.go('#/goals/' + chk.value.id); root.App.render(); });
    } });
    U.sheet(ex ? 'Edit goal' : o && o.draft ? 'Next cycle' : 'Add a goal', body, actions);
  }
  Screens.goalSheet = goalSheet;

  async function deleteGoal(id) {
    for (const e of Store.getEvents()) {
      const d = e.data || {};
      if ((e.type === 'goal_set' && d.goal && d.goal.id === id) || (e.type === 'goal_entry' && d.goal === id)) { try { await Store.voidEvent(e.seq); } catch (x) { /* keep going */ } }
    }
    U.toast('Goal deleted.');
    root.App.go('#/goals'); root.App.render();
  }
  function closeGoal(g, closed) {
    const raw = Object.assign({}, g, { status: closed ? 'closed' : 'active', closedOn: closed ? U.today() : null });
    const chk = E.cleanGoal(raw);
    if (!chk.ok) return U.toast(chk.errors[0], 'warn');
    Store.append('goal_set', { goal: chk.value }, 'user').then(() => { U.toast(closed ? 'Goal closed. It stays in Past goals.' : 'Goal reopened.'); root.App.render(); });
  }
  function readingSheet(g) {
    const t = U.today();
    const val = UI.field({ label: 'Reading', type: 'number', unit: g.unit, flex: 1 });
    const date = UI.field({ label: 'Date', type: 'date', value: t, max: t, flex: 1 });
    const note = UI.field({ label: 'Note (optional)', maxlength: 100 });
    U.sheet('Log a reading: ' + g.title, h('div', { class: 'stack' }, UI.row(val, date), note), [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', run: () => {
      const chk = E.cleanGoalEntry({ goal: g.id, date: date.input.value, value: num(val.input.value), note: note.input.value });
      if (!chk.ok || chk.value.date > t) { U.toast(chk.ok ? 'Pick today or an earlier day.' : chk.errors[0], 'warn'); return false; }
      Store.append('goal_entry', chk.value, 'user').then(() => { U.toast('Saved.'); root.App.render(); });
    } }]);
  }

  // ---------- what a card or a week says ----------
  function weekLine(g, p) {
    const unit = unitNow(), w = p.thisWeek;
    if (!w) return '';
    const kind = KIND_WORD[w.kind] || 'This week';
    if (g.aim === 'pace') return kind + ': ' + G.fmtPace(w.target, g.sport, unit) + ' over ' + G.fmtDist(g.paceKm, unit, g.sport);
    if (g.aim === 'weekly') return kind + ': about ' + G.fmtDist(w.target, unit, g.sport) + ' this week';
    return kind + ': longest session ' + G.fmtDist(w.target, unit, g.sport);
  }
  function goalCard(p, state) {
    const unit = unitNow(), g = p.kind === 'strength' ? null : state.goals[p.id];
    const sub = g ? G.describe(g, unit) : p.sub;
    const foot = p.closed ? 'Closed' : p.over ? 'Ended ' + U.shortDate(p.endDate) : p.notStarted ? 'Starts ' + U.shortDate(g ? g.start : state.plan.startDate) : 'Week ' + p.cw + ' of ' + p.weeks + ' · ' + G.lengthText(p.weeks) + ' · ends ' + U.shortDate(p.endDate);
    const wl = g && g.kind === 'endurance' && !p.over && !p.closed && !p.notStarted ? weekLine(g, p) : p.kind === 'strength' && !p.over && p.lifts ? (p.trainedNow ? p.hitNow + ' of ' + p.trainedNow + ' lifts trained this week are on target' : 'Nothing trained yet this week') : '';
    return h('a', { class: 'gcard', href: '#/goals/' + p.id },
      h('div', { class: 'row space' }, h('b', { class: 'gt' }, p.title), chipFor(p)),
      h('div', { class: 'muted small' }, sub),
      barFor(p),
      h('div', { class: 'muted small' }, foot),
      wl ? h('div', { class: 'small' }, wl) : null);
  }

  // ---------- the switcher ----------
  function switcher(state, id) {
    const sel = h('select', { class: 'inp goalsel', 'aria-label': 'Goal' },
      h('option', { value: '' }, 'All goals'),
      h('option', { value: 'plan' }, 'Strength and muscle'),
      ...state.goalOrder.map((gid) => h('option', { value: gid }, state.goals[gid].title + (state.goals[gid].status === 'closed' ? ' (closed)' : ''))));
    sel.value = id || '';
    sel.addEventListener('change', () => root.App.go(sel.value ? '#/goals/' + sel.value : '#/goals'));
    return h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Show'), sel);
  }

  // ---------- the screen ----------
  Screens.goals = function (id) {
    const state = Store.getState(), t = U.today();
    if (id && id !== 'plan' && !state.goals[id]) id = null;
    const add = h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Add a goal', onclick: () => goalSheet({}) }, U.icon('plus', 20));
    const head = UI.header('Goals', 'Set it, track it, review it, go again.', { right: add });
    const sw = switcher(state, id);
    if (id === 'plan') return UI.page(head, UI.scroller(sw, ...strengthView(state, t)));
    if (id) return UI.page(head, UI.scroller(sw, ...goalView(state, state.goals[id], t)));
    return UI.page(head, UI.scroller(sw, ...overviewView(state, t)));
  };

  function overviewView(state, t) {
    const list = G.overview(state, t);
    const active = list.filter((p) => !p.closed), closed = list.filter((p) => p.closed);
    const kids = [];
    kids.push(...active.map((p) => UI.card(goalCard(p, state))));
    if (active.length === 1) kids.push(UI.card(h('div', { class: 'ct' }, 'Working towards more than one thing?'), h('div', { class: 'muted small' }, 'Add a goal for a race, a pace, how much you swim in a week, or any number you want to move, like pull-ups. Each has its own length and target, and you can change either any time.'), UI.btn('Add a goal', { icon: 'plus', onClick: () => goalSheet({}) })));
    else kids.push(UI.btn('Add a goal', { kind: 'quiet', icon: 'plus', onClick: () => goalSheet({}) }));
    if (closed.length) kids.push(UI.card(h('div', { class: 'ct' }, 'Past goals'), ...closed.map((p) => goalCard(p, state))));
    kids.push(h('div', { class: 'muted small' }, 'Regoal is a cycle: pick a goal, track it week by week, review it at the end, then set the next one. Paths and status are rules of thumb worked out from what you log, not a coach.'));
    return kids;
  }

  function strengthView(state, t) {
    const p = G.strengthProgress(state, t), plan = state.plan;
    const summary = UI.card(
      h('div', { class: 'row space' }, h('div', { class: 'ct' }, 'Strength and muscle'), chipFor(p)),
      h('div', { class: 'muted small' }, p.sub),
      barFor(p),
      h('div', { class: 'kv' }, h('span', null, 'This cycle'), h('b', null, p.over ? 'Ended ' + U.shortDate(p.endDate) : 'Week ' + p.cw + ' of ' + p.weeks + ' · ' + G.lengthText(p.weeks))),
      p.rate == null ? null : h('div', { class: 'kv' }, h('span', null, 'Lift weeks hit lately'), h('b', null, Math.round(p.rate * 100) + '%')),
      UI.row(UI.btn('Change length', { kind: 'quiet', block: false, onClick: Screens.planLengthSheet }), UI.btn('Goal and calories', { kind: 'quiet', block: false, href: '#/settings/plan' })));
    const kids = [];
    if (p.over) kids.push(UI.cardX('acc', h('div', { class: 'ct' }, 'This cycle is done'), h('div', { class: 'muted' }, 'You finished all ' + p.weeks + ' weeks. Take your final photos and measurements, then either make the plan longer and keep climbing, or compare against week 1 in Progress.'), UI.row(UI.btn('Extend the plan', { onClick: Screens.planLengthSheet }), UI.btn('See progress', { kind: 'quiet', href: '#/progress' }))));
    kids.push(summary, ...Screens.liftsBody());
    return kids;
  }

  function goalView(state, g, t) {
    const unit = unitNow(), p = G.progress(state, g, t), kids = [];
    const edit = () => goalSheet({ goal: g });
    // How the goal is going
    const status = [
      h('div', { class: 'row space' }, h('div', { class: 'ct' }, g.title), chipFor(p)),
      h('div', { class: 'muted small' }, G.describe(g, unit) + (g.note ? ' · ' + g.note : '')),
      barFor(p),
      h('div', { class: 'kv' }, h('span', null, 'This cycle'), h('b', null, p.notStarted ? 'Starts ' + U.shortDate(g.start) : p.over ? 'Ended ' + U.shortDate(p.endDate) : 'Week ' + p.cw + ' of ' + p.weeks + ' · ' + G.lengthText(p.weeks))),
      p.over || p.closed || p.notStarted ? null : h('div', { class: 'kv' }, h('span', null, 'Ends'), h('b', null, U.shortDate(p.endDate) + ' · ' + p.daysLeft + (p.daysLeft === 1 ? ' day' : ' days') + ' left')),
      h('div', { class: 'kv' }, h('span', null, 'Started at'), h('b', null, G.valueText(g, p.from, unit))),
      h('div', { class: 'kv' }, h('span', null, g.kind === 'custom' ? 'Latest' : 'Best so far'), h('b', null, p.hasData ? G.valueText(g, p.actual, unit) : 'Nothing logged yet')),
      h('div', { class: 'kv' }, h('span', null, 'Target'), h('b', null, G.valueText(g, g.target, unit))),
    ];
    // The end of a cycle: how it went, and the next one
    if (!p.closed && (p.over || p.reached)) {
      const rv = G.review(state, g, t, unit);
      kids.push(UI.cardX(p.reached ? 'good' : 'acc', h('div', { class: 'ct' }, p.reached ? 'Goal reached' : 'This cycle is done'), h('div', null, rv.message),
        h('div', { class: 'muted small' }, p.reached ? 'Set the next one a little higher, or keep going until the end date.' : 'Try the same target with more time, or pick something new.'),
        UI.btn('Start the next cycle', { onClick: () => goalSheet({ draft: rv.draft }) }),
        UI.row(UI.btn('Change length', { kind: 'quiet', onClick: edit }), UI.btn('Close this goal', { kind: 'quiet', onClick: () => closeGoal(g, true) }))));
    }
    kids.push(UI.card(...status));

    if (g.kind === 'endurance') {
      if (!p.over && !p.closed && !p.notStarted && p.thisWeek) {
        const done = p.thisWeekDone || { km: 0, long: 0, sessions: 0, pace: null };
        const got = g.aim === 'weekly' ? G.fmtDist(done.km, unit, g.sport) : g.aim === 'pace' ? (done.pace ? G.fmtPace(done.pace, g.sport, unit) : 'no test yet') : done.long ? G.fmtDist(done.long, unit, g.sport) : 'nothing yet';
        kids.push(UI.card(h('div', { class: 'ct' }, 'This week'), h('div', null, weekLine(g, p)),
          g.aim === 'distance' && p.thisWeek.weeklyKm ? h('div', { class: 'muted small' }, 'Around ' + G.fmtDist(p.thisWeek.weeklyKm, unit, g.sport) + ' in total, split over your sessions.') : null,
          h('div', { class: 'kv' }, h('span', null, g.aim === 'weekly' ? 'Done so far' : g.aim === 'pace' ? 'Best this week' : 'Longest so far'), h('b', null, got)),
          h('div', { class: 'kv' }, h('span', null, 'Sessions this week'), h('b', null, String(done.sessions))),
          p.next ? h('div', { class: 'muted small' }, 'Next week: ' + (g.aim === 'pace' ? G.fmtPace(p.next.target, g.sport, unit) : G.fmtDist(p.next.target, unit, g.sport)) + ' (' + (KIND_WORD[p.next.kind] || 'build week').toLowerCase() + ').') : null,
          UI.btn('Log ' + G.sportOf(g.sport).name.toLowerCase(), { icon: 'plus', onClick: () => Screens.workoutSheet({ type: g.sport, date: t }) })));
      } else if (!p.closed && !p.over) kids.push(UI.card(UI.btn('Log ' + G.sportOf(g.sport).name.toLowerCase(), { icon: 'plus', onClick: () => Screens.workoutSheet({ type: g.sport, date: t }) })));
      if (p.noDistance) kids.push(h('div', { class: 'warnbox' }, 'Some ' + G.sportOf(g.sport).name.toLowerCase() + ' sessions have no distance. Add it when you log them, or edit them in Activity, so they count towards this goal.'));
      if (p.path.note && !p.over) kids.push(h('div', { class: 'warnbox' }, p.path.note));
      kids.push(enduranceChart(g, p, unit), pathCard(g, p, unit));
    } else {
      if (!p.over && !p.closed) kids.push(UI.card(UI.btn('Log a reading', { icon: 'plus', onClick: () => readingSheet(g) })));
      kids.push(customChart(g, p), readingsCard(g, p));
    }
    kids.push(UI.row(UI.btn('Edit goal', { kind: 'quiet', icon: 'chev', onClick: edit }), p.closed ? UI.btn('Reopen', { kind: 'quiet', onClick: () => closeGoal(g, false) }) : UI.btn('Close goal', { kind: 'quiet', onClick: () => closeGoal(g, true) })));
    return kids;
  }

  // ---------- charts and lists ----------
  function enduranceChart(g, p, unit) {
    const pace = g.aim === 'pace';
    const conv = (x) => (pace ? x : G.fromKm(x, unit === 'mi' ? 'mi' : 'km'));
    const xs = p.path.weeks.map((w) => w.week);
    const planned = p.path.weeks.map((w) => ({ x: w.week, y: conv(w.target) }));
    const actual = p.weekly.map((w) => ({ x: w.week, y: pace ? w.pace : g.aim === 'weekly' ? (w.km > 0 ? conv(w.km) : null) : (w.long > 0 ? conv(w.long) : null) }));
    const chart = xs.length > 1 ? U.lineChart({ label: g.title + ' path and what you did, by week', xs, series: [{ pts: planned, color: U.PAL.acc, dash: '5 4', width: 2 }, { pts: actual, color: U.PAL.cool, dots: true }], xLabel: (x) => 'Wk ' + x, fmtY: (y) => (pace ? G.fmtPace(y, g.sport, unit).split(' ')[0] : U.num(y, y < 10 ? 1 : 0)) }) : h('div', { class: 'muted' }, 'A one-week goal has no chart.');
    return UI.card(h('div', { class: 'ct' }, 'Path and what you did'), chart, h('div', { class: 'muted small' }, 'Dashed: what each week asks for. Dots: your best each week.' + (pace ? ' Lower is faster.' : '')));
  }
  function pathCard(g, p, unit) {
    const rows = p.path.weeks.map((w) => {
      const [a] = G.weekBounds(g, w.week), done = p.weekly[w.week - 1];
      const target = g.aim === 'pace' ? G.fmtPace(w.target, g.sport, unit) : G.fmtDist(w.target, unit, g.sport) + (g.aim === 'weekly' ? '' : '');
      const did = done && w.week <= p.cw ? (g.aim === 'pace' ? (done.pace ? G.fmtPace(done.pace, g.sport, unit) : '') : g.aim === 'weekly' ? (done.km ? G.fmtDist(done.km, unit, g.sport) : '') : (done.long ? G.fmtDist(done.long, unit, g.sport) : '')) : '';
      return h('div', { class: 'kv' + (w.week === p.cw && !p.over ? ' cur' : '') }, h('span', null, 'Wk ' + w.week + ' · ' + U.shortDate(a) + (w.kind === 'build' ? '' : ' · ' + (KIND_WORD[w.kind] || '').toLowerCase())), h('b', null, target + (did ? ' → ' + did : '')));
    });
    return UI.card(h('div', { class: 'ct' }, 'Week by week'), ...rows, h('div', { class: 'muted small' }, g.aim === 'distance' ? 'Longest session for the week, then what you did.' : g.aim === 'weekly' ? 'Distance for the week, then what you did.' : 'Pace to aim for, then your best.'));
  }
  function customChart(g, p) {
    const total = g.weeks * 7;
    const xs = [0, total];
    const planned = [{ x: 0, y: g.from }, { x: total, y: g.target }];
    const actual = (p.entries || []).map((e) => ({ x: E.clamp(E.daysBetween(g.start, e.date), 0, total), y: e.value }));
    const chart = U.lineChart({ label: g.title + ' readings against the line', xs, series: [{ pts: planned, color: U.PAL.acc, dash: '5 4', width: 2 }, { pts: actual, color: U.PAL.cool, dots: true }], xLabel: (x) => U.shortDate(E.addDays(g.start, x)), fmtY: (y) => U.num(y, Math.abs(y) < 10 ? 1 : 0) });
    return UI.card(h('div', { class: 'ct' }, 'Readings against the line'), chart, h('div', { class: 'muted small' }, 'Dashed: a straight line from where you started to the target. Dots: what you logged.'));
  }
  function readingsCard(g, p) {
    const list = (p.entries || []).slice().reverse();
    return UI.card(h('div', { class: 'ct' }, 'Readings'), ...(list.length ? list.slice(0, 12).map((e) => h('div', { class: 'kv' }, h('span', null, U.shortDate(e.date) + (e.note ? ' · ' + e.note : '')), h('b', null, trim(e.value, 3) + (g.unit ? ' ' + g.unit : ''), ' ', h('button', { class: 'chip line', type: 'button', 'aria-label': 'Delete reading', onclick: async () => { await Store.voidEvent(e.seq); U.toast('Reading deleted.'); root.App.render(); } }, 'Delete')))) : [UI.empty('No readings yet.')]));
  }

  // ---------- a line on Today ----------
  // Other goals in one card: status and this week's ask. Nothing when the plan is the only goal.
  Screens.goalsTodayCard = function () {
    const state = Store.getState(), t = U.today(), unit = unitNow();
    const rows = [];
    for (const id of state.goalOrder) {
      const g = state.goals[id];
      if (!g || g.status === 'closed') continue;
      const p = G.progress(state, g, t);
      if (p.notStarted) continue;
      rows.push(h('a', { class: 'liftcard', href: '#/goals/' + id },
        h('div', { class: 'grow' }, h('b', null, g.title), h('span', { class: 'muted small' }, g.kind === 'endurance' && !p.over ? weekLine(g, p) : p.over ? 'Cycle over: review it' : G.describe(g, unit))),
        chipFor(p), U.icon('chev', 18)));
    }
    if (!rows.length) return null;
    return UI.card(h('div', { class: 'ct' }, 'Goals'), ...rows.slice(0, 3), h('a', { class: 'linkbtn', href: '#/goals' }, 'All goals'));
  };
})(self);

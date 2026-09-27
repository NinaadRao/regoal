/*
 * Goals: what a person is working towards, how far along they are, and what to do this week. Pure functions, no DOM, storage
 * or network: it runs in Node too.
 *
 * How it works, so it can be explained and checked:
 *  - A goal has its own start date and length (any number of weeks), so a person can chase several at once and change any of them.
 *  - Endurance goals (running, cycling, swimming, rowing, walking, hiking) are measured from ordinary workouts, so nothing is logged
 *    twice: the distance and time of a session are all it needs. There are three aims. "Distance" is the longest single session,
 *    for a race or a long-run target. "Pace" is the best pace over at least about 90 percent of a set distance. "Weekly" is the
 *    biggest week of distance. A custom goal is any number the person types in over and over.
 *  - The week-by-week path is plain rules. Distance and weekly targets climb in equal steps from where the person is to the peak,
 *    with a lighter week after every three build weeks (about 80 percent of the week before) and, for a distance goal, a taper before
 *    the day. Pace improves in equal steps. If a path would ask for more than about 15 percent extra in a week, it says so and
 *    suggests a length that would be gentler.
 *  - "Ahead", "on track" or "behind" compares what was done with what the path asks for by the start of this week. Nothing is stored
 *    about progress: it is worked out from the log every time, so it survives edits, restores and moved dates.
 *  - When the time is up, the goal shows how it went and offers a next cycle with the target moved up if it was reached, or the same
 *    target with more time if it was not. Nothing here is medical advice, and the paths are guidance, not a coach.
 */
(function (root) {
  'use strict';
  const E = root.Engine || (typeof require === 'function' ? require('./engine.js') : null);
  const clamp = E.clamp;

  // ---------- sports, units and formatting ----------
  const KM_PER_MI = 1.609344, YD_PER_KM = 1093.6133;
  const SPORTS = {
    running: { name: 'Running', pace: 'run', races: [['5K', 5], ['10K', 10], ['Half marathon', 21.0975], ['Marathon', 42.195]] },
    cycling: { name: 'Cycling', pace: 'speed', races: [['25 km', 25], ['50 km', 50], ['100 km', 100], ['160 km', 160]] },
    swimming: { name: 'Swimming', pace: 'swim', races: [['400 m', 0.4], ['1 km', 1], ['1.5 km', 1.5], ['3.8 km', 3.8]] },
    rowing: { name: 'Rowing', pace: 'row', races: [['2 km', 2], ['5 km', 5], ['10 km', 10], ['Half marathon', 21.0975]] },
    walking: { name: 'Walking', pace: 'run', races: [['5 km', 5], ['10 km', 10], ['20 km', 20]] },
    hiking: { name: 'Hiking', pace: 'run', races: [['10 km', 10], ['20 km', 20], ['30 km', 30]] },
  };
  const sportOf = (s) => (Object.prototype.hasOwnProperty.call(SPORTS, s) ? SPORTS[s] : SPORTS.running);
  // km or mi. An explicit choice in Settings wins; otherwise it follows the person's length unit (inches means miles),
  // same as it always has, so nobody who has not visited that setting sees a change.
  const distUnitFor = (set) => (set && (set.distUnit === 'km' || set.distUnit === 'mi') ? set.distUnit : (set && set.lenUnit === 'in' ? 'mi' : 'km'));
  // The unit a distance is typed in: swimming is in metres (or yards), the rest in km (or miles).
  function distInput(sport, unit) { return sport === 'swimming' ? (unit === 'mi' ? 'yd' : 'm') : (unit === 'mi' ? 'mi' : 'km'); }
  function toKm(v, u) { return u === 'm' ? v / 1000 : u === 'yd' ? v / YD_PER_KM : u === 'mi' ? v * KM_PER_MI : v; }
  function fromKm(km, u) { return u === 'm' ? km * 1000 : u === 'yd' ? km * YD_PER_KM : u === 'mi' ? km / KM_PER_MI : km; }
  const r1 = (x) => Math.round(x * 10) / 10;
  function trim(x, dp) { const f = Math.pow(10, dp); return String(Math.round(x * f) / f); }
  // "12.5 km", "1,500 m", "26.2 mi". Swimming shows metres or yards below about 3 km.
  function fmtDist(km, unit, sport) {
    if (km == null || !Number.isFinite(km)) return '';
    const u = sport === 'swimming' && km < 3 ? distInput('swimming', unit) : unit === 'mi' ? 'mi' : 'km';
    const v = fromKm(km, u);
    const shown = u === 'm' || u === 'yd' ? String(Math.round(v / 5) * 5).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : trim(v, v < 10 ? 2 : 1);
    return shown + ' ' + u;
  }
  const mmss = (sec) => { const s = Math.round(sec); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  // Pace is kept as seconds per km for every sport, and shown the way that sport is talked about.
  function paceInfo(sport, unit) {
    const kind = sportOf(sport).pace;
    if (kind === 'speed') return { label: unit === 'mi' ? 'mph' : 'km/h', speed: true, per: unit === 'mi' ? KM_PER_MI : 1 };
    if (kind === 'swim') return { label: unit === 'mi' ? 'per 100 yd' : 'per 100 m', f: unit === 'mi' ? 1 / YD_PER_KM * 100 : 0.1 };
    if (kind === 'row') return { label: 'per 500 m', f: 0.5 };
    return { label: unit === 'mi' ? 'per mi' : 'per km', f: unit === 'mi' ? KM_PER_MI : 1 };
  }
  function fmtPace(secPerKm, sport, unit) {
    if (!(secPerKm > 0)) return '';
    const p = paceInfo(sport, unit);
    return p.speed ? trim(3600 / secPerKm / p.per, 1) + ' ' + p.label : mmss(secPerKm * p.f) + ' ' + p.label;
  }
  // "5:30" (or 5.5 as speed for cycling) to seconds per km. NaN when it cannot be read.
  function parsePace(text, sport, unit) {
    const p = paceInfo(sport, unit), t = String(text == null ? '' : text).trim();
    if (!t) return NaN;
    if (p.speed) { const v = Number(t.replace(',', '.')); return v > 0 ? 3600 / (v * p.per) : NaN; }
    const m = /^(\d{1,3})[:.](\d{1,2})$/.exec(t);
    let sec;
    if (m) { if (Number(m[2]) > 59) return NaN; sec = Number(m[1]) * 60 + Number(m[2]); }
    else if (/^\d{1,4}$/.test(t)) sec = Number(t) * 60;       // "5" means 5:00
    else return NaN;
    return sec > 0 ? sec / p.f : NaN;
  }
  const paceHint = (sport, unit) => (sportOf(sport).pace === 'speed' ? 'Speed, e.g. 28' : 'Minutes and seconds, e.g. 5:30');

  // ---------- the week-by-week path ----------
  const stepFor = (T) => (T <= 5 ? 0.1 : 0.5);
  const roundStep = (x, step) => Math.round(Math.round(x / step) * step * 1000) / 1000;
  // How many build weeks a gentle climb needs to get from b to peak: about 10 percent a week, never less than minStep.
  function stepsNeeded(b, peak, minStep) { let v = Math.max(b, 0.1), n = 0; while (v < peak - 1e-9 && n < 200) { v += Math.max(0.1 * v, minStep); n++; } return Math.max(1, n); }
  const VOL_RATIO = 2.5;      // a weekly total is roughly this many times the longest session
  // Climb from b to peak in equal steps over `count` weeks, with a lighter week (0.8 of the week before) after every third build week.
  function ramp(count, b, peak, step, lastIsBuild) {
    const isCut = (i) => i % 4 === 0 && (lastIsBuild ? i < count : true);
    let jm = 0;
    for (let i = 1; i <= count; i++) if (!isCut(i)) jm++;
    jm = Math.max(1, jm);
    const out = [];
    let j = 0, lastBuild = b;
    for (let i = 1; i <= count; i++) {
      if (isCut(i)) out.push({ kind: 'cutback', target: clamp(roundStep(lastBuild * 0.8, step), step, 1e6) });
      else { j++; lastBuild = b + (peak - b) * (j / jm); out.push({ kind: 'build', target: clamp(roundStep(lastBuild, step), step, 1e6) }); }
    }
    return { weeks: out, firstStepPct: jm ? ((peak - b) / jm) / Math.max(b, 0.1) : 0, buildWeeks: jm };
  }
  // A goal to cover a distance (a race, or a long-run target): build, lighter weeks, taper, then the day itself.
  function distancePath(N, b, T, sport) {
    const step = stepFor(T);
    let taper = Math.min(T >= 30 ? 3 : T >= 15 ? 2 : 1, Math.floor(N / 4));
    taper = Math.max(1, taper);
    const peak = Math.max(b, T >= 30 ? Math.min(T * 0.76, 32) : T >= 15 ? T * 0.9 : T);
    const bw = N - taper;
    const r = ramp(bw, b, peak, step, true);
    const weeks = r.weeks.slice();
    const mult = taper === 3 ? [0.75, 0.6] : taper === 2 ? [0.65] : [];
    for (const m of mult) weeks.push({ kind: 'taper', target: clamp(roundStep(peak * m, step), step, 1e6) });
    weeks.push({ kind: 'goal', target: T });
    const needJ = stepsNeeded(b, peak, 0.5 * Math.min(1, T / 5));
    const suggestWeeks = Math.max(taper + 4, Math.ceil(needJ * 4 / 3) + taper);
    const ambitious = r.buildWeeks < needJ * 0.85 || (T >= 42 && N < 12 && b < 16);
    const note = ambitious
      ? 'That builds faster than the usual gentle climb of about 10% more a week' + (T >= 42 && N < 12 ? ', and most marathon plans run 12 to 20 weeks' : '') + '. About ' + suggestWeeks + ' weeks would be gentler.'
      : '';
    return { weeks: weeks.map((w, i) => Object.assign({ week: i + 1, weeklyKm: w.kind === 'goal' ? null : roundStep(w.target * VOL_RATIO, 1) }, w)), peak: roundStep(peak, step), taper, ambitious, suggestWeeks, note };
  }
  // A goal for weekly distance: the same climb, no taper, ending at the target.
  function volumePath(N, b, W) {
    const step = W <= 10 ? 0.5 : 1;
    const r = ramp(N, b, W, step, true);
    const weeks = r.weeks.map((w, i) => Object.assign({ week: i + 1 }, w));
    weeks[N - 1] = Object.assign({}, weeks[N - 1], { kind: 'goal', target: W });
    const needJ = stepsNeeded(b, W, Math.min(1, W / 20));
    const suggestWeeks = Math.max(4, Math.ceil(needJ * 4 / 3));
    const ambitious = r.buildWeeks < needJ * 0.85;
    return { weeks, peak: W, taper: 0, ambitious, suggestWeeks, note: ambitious ? 'That builds faster than the usual gentle climb of about 10% more a week. About ' + suggestWeeks + ' weeks would be gentler.' : '' };
  }
  // A goal to get faster over a set distance: pace improves in equal steps, and the last week is the test.
  function pacePath(N, p0, Pt) {
    const weeks = [];
    for (let i = 1; i <= N; i++) weeks.push({ week: i, kind: i === N ? 'goal' : 'build', target: i === N ? Pt : Math.round(p0 + (Pt - p0) * (i / N)) });
    const perWeek = Math.abs(Pt - p0) / p0 / N;
    const suggestWeeks = Math.max(4, Math.ceil(Math.abs(Pt - p0) / p0 / 0.01));
    const ambitious = perWeek > 0.015;
    return { weeks, peak: Pt, taper: 0, ambitious, suggestWeeks, note: ambitious ? 'That is about ' + (Math.round(perWeek * 1000) / 10) + '% faster every week. Gains slow down as you get fitter, so about ' + suggestWeeks + ' weeks would be gentler.' : '' };
  }
  // Where the person starts: what they typed, else what their own workouts before the start show, else a cautious guess.
  function baseline(state, goal) {
    if (goal.from != null) return goal.from;
    if (goal.kind !== 'endurance') return null;
    const before = state.workouts.filter((w) => w.type === goal.sport && w.date < goal.start && w.date >= E.addDays(goal.start, -28));
    if (goal.aim === 'distance') { const m = Math.max(0, ...before.map((w) => w.km)); return m > 0 ? m : Math.max(1, roundStep(goal.target * 0.25, stepFor(goal.target))); }
    if (goal.aim === 'weekly') { const sum = before.reduce((a, w) => a + w.km, 0); return sum > 0 ? roundStep(sum / 4, 0.5) : Math.max(2, roundStep(goal.target * 0.4, 0.5)); }
    const q = before.filter((w) => w.km >= 0.9 * goal.paceKm && w.mins > 0).map((w) => (w.mins * 60) / w.km);
    return q.length ? Math.min(...q) : null;
  }
  function buildPath(goal, from) {
    if (goal.aim === 'distance') return distancePath(goal.weeks, from, goal.target, goal.sport);
    if (goal.aim === 'weekly') return volumePath(goal.weeks, from, goal.target);
    return pacePath(goal.weeks, from, goal.target);
  }

  // ---------- measuring progress ----------
  function weekBounds(goal, week) { const a = E.addDays(goal.start, (week - 1) * 7); return [a, E.addDays(a, 6)]; }
  // What was done in each week of a goal, from the workouts of its sport.
  function enduranceWeeks(state, goal, upToWeek) {
    const out = [];
    const ws = state.workouts.filter((w) => w.type === goal.sport);
    for (let wk = 1; wk <= upToWeek; wk++) {
      const [a, b] = weekBounds(goal, wk);
      const list = ws.filter((w) => w.date >= a && w.date <= b);
      const withKm = list.filter((w) => w.km > 0);
      const paced = goal.aim === 'pace' ? withKm.filter((w) => w.km >= 0.9 * goal.paceKm && w.mins > 0).map((w) => (w.mins * 60) / w.km) : [];
      out.push({ week: wk, sessions: list.length, km: Math.round(withKm.reduce((s, w) => s + w.km, 0) * 100) / 100, long: withKm.length ? Math.max(...withKm.map((w) => w.km)) : 0, pace: paced.length ? Math.min(...paced) : null });
    }
    return out;
  }
  // How far along, against how far along the path says to be. delta and expected are measured in the direction of the goal.
  function judge(delta, expected, span) {
    const tol = span * 0.05;
    if (expected <= tol) return delta >= -2 * tol ? (delta > expected + span * 0.1 ? 'ahead' : 'on') : 'behind';
    const f = delta / expected;
    return f >= 1.2 ? 'ahead' : f >= 0.8 ? 'on' : 'behind';
  }
  const LABEL = { ahead: 'Ahead', on: 'On track', behind: 'Behind', reached: 'Reached', ended: 'Ended', nodata: 'No data yet', notstarted: 'Starts soon', closed: 'Closed' };

  // Everything the screens need about one goal. `today` is a date.
  function progress(state, goal, today) {
    const N = goal.weeks, dayNo = E.daysBetween(goal.start, today);
    const week = Math.floor(dayNo / 7) + 1;
    const cw = clamp(week, 1, N);
    const over = week > N, notStarted = dayNo < 0;
    const out = { id: goal.id, kind: goal.kind, title: goal.title, week, weeks: N, cw, over, notStarted, daysLeft: Math.max(0, N * 7 - dayNo - 1), endDate: E.addDays(goal.start, N * 7 - 1), timePct: clamp((dayNo + 1) / (N * 7), 0, 1), closed: goal.status === 'closed' };
    if (goal.kind === 'custom') return Object.assign(out, customProgress(state, goal, today, out));
    return Object.assign(out, enduranceProgress(state, goal, today, out));
  }
  function finish(o, goal, from, actual, expected, hasData) {
    const dir = Math.sign(goal.target - from) || 1, span = Math.abs(goal.target - from) || 1;
    const delta = (actual - from) * dir, expDelta = (expected - from) * dir;
    const reached = delta >= span - 1e-9;
    let status;
    if (goal.status === 'closed') status = 'closed';
    else if (reached) status = 'reached';
    else if (o.over) status = 'ended';
    else if (o.notStarted) status = 'notstarted';
    else if (!hasData) status = o.week >= 2 ? 'behind' : 'nodata';
    else status = judge(delta, Math.max(0, expDelta), span);
    return { from, target: goal.target, actual, expected, hasData, reached, status, label: LABEL[status], pct: clamp(delta / span, 0, 1) };
  }
  function enduranceProgress(state, goal, today, o) {
    let from = baseline(state, goal);
    if (!(from > 0)) from = goal.aim === 'pace' ? goal.target * 1.2 : 1;
    const path = buildPath(goal, from);
    const weeks = enduranceWeeks(state, goal, Math.max(1, Math.min(o.notStarted ? 0 : o.week, goal.weeks)));
    if (o.notStarted) weeks.length = 0;
    let actual = from, hasData = false;
    if (goal.aim === 'distance') { const m = Math.max(0, ...weeks.map((w) => w.long)); if (m > 0) { hasData = true; actual = Math.max(from, m); } }
    else if (goal.aim === 'weekly') { const m = Math.max(0, ...weeks.map((w) => w.km)); if (m > 0) { hasData = true; actual = Math.max(from, m); } }
    else { const ps = weeks.map((w) => w.pace).filter((x) => x != null); if (ps.length) { hasData = true; actual = Math.min(from, ...ps); } }
    // What the path asks for by the start of this week: the best it has asked for so far.
    let expected = from;
    for (const w of path.weeks) if (w.week < o.cw && w.kind !== 'taper') expected = goal.aim === 'pace' ? Math.min(expected, w.target) : Math.max(expected, w.target);
    if (o.over) expected = goal.target;
    const res = finish(o, goal, from, actual, expected, hasData);
    const thisWeek = !o.over && !o.notStarted ? path.weeks[o.cw - 1] : null;
    const cur = weeks[o.cw - 1] || null;
    return Object.assign(res, { sport: goal.sport, aim: goal.aim, path, weekly: weeks, thisWeek, thisWeekDone: cur, next: !o.over && o.cw < goal.weeks ? path.weeks[o.cw] : null, sessions: weeks.reduce((s, w) => s + w.sessions, 0), noDistance: weeks.some((w) => w.sessions > 0 && w.km === 0) });
  }
  function customProgress(state, goal, today, o) {
    const es = state.goalEntries.filter((e) => e.goal === goal.id && e.date >= goal.start && e.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    const hasData = es.length > 0, actual = hasData ? es[es.length - 1].value : goal.from;
    const dir = Math.sign(goal.target - goal.from) || 1;
    const best = hasData ? es.reduce((m, e) => (e.value * dir > m * dir ? e.value : m), es[0].value) : goal.from;
    const t = clamp((E.daysBetween(goal.start, today) + 1) / (goal.weeks * 7), 0, 1);
    const expected = goal.from + (goal.target - goal.from) * t;
    const res = finish(o, goal, goal.from, actual, expected, hasData);
    return Object.assign(res, { entries: es, best, unit: goal.unit, thisWeek: null });
  }

  // The plan itself is the strength and muscle goal: its length, its lifts and how often each week's lifts were hit.
  const PLAN_GOALS = { recomp: 'Recomp: lose fat and build muscle', build: 'Build muscle', cut: 'Lose fat, keep muscle' };
  function strengthProgress(state, today) {
    const plan = state.plan, N = E.planWeeks(plan), dayNo = E.daysBetween(plan.startDate, today);
    const week = Math.floor(dayNo / 7) + 1, cw = clamp(week, 1, N), over = week > N, notStarted = dayNo < 0;
    const ids = Object.keys(plan.lifts);
    let hits = 0, total = 0;
    const last = over ? N : cw - 1;
    for (let w = Math.max(1, last - 3); w <= last; w++) for (const id of ids) { const st = E.liftStatus(state, id, w, today); if (st.logged || st.status === 'Behind') { total++; if (st.status === 'Hit') hits++; } }
    const rate = total ? hits / total : null;
    let hitNow = 0;
    if (!over && !notStarted) for (const id of ids) if (E.liftStatus(state, id, cw, today).status === 'Hit') hitNow++;
    const status = over ? 'ended' : notStarted ? 'notstarted' : rate == null ? (cw >= 3 && ids.length ? 'behind' : 'nodata') : rate >= 0.85 ? 'ahead' : rate >= 0.6 ? 'on' : 'behind';
    const timePct = clamp((dayNo + 1) / (N * 7), 0, 1);
    return { id: 'plan', kind: 'strength', title: 'Strength and muscle', sub: PLAN_GOALS[plan.goal] || 'Train', week, weeks: N, cw, over, notStarted, timePct, pct: timePct, status, label: LABEL[status], rate, hitNow, lifts: ids.length, daysLeft: Math.max(0, N * 7 - dayNo - 1), endDate: E.addDays(plan.startDate, N * 7 - 1), reached: false };
  }

  // The plan and every goal, active ones first.
  function overview(state, today) {
    const list = [strengthProgress(state, today)];
    const active = [], closed = [];
    for (const id of state.goalOrder) { const g = state.goals[id]; if (g) (g.status === 'closed' ? closed : active).push(progress(state, g, today)); }
    return list.concat(active, closed);
  }

  // ---------- the end of a cycle ----------
  const LADDER = [5, 10, 21.0975, 42.195];
  // How a finished goal went, in one sentence, and what the next cycle could be (a draft to edit, never saved by itself).
  function review(state, goal, today, unit) {
    const p = progress(state, goal, today);
    const result = p.reached ? 'reached' : p.pct >= 0.6 ? 'close' : 'short';
    const fmt = (v) => valueText(goal, v, unit);
    let message;
    if (result === 'reached') message = 'You got there: ' + fmt(p.actual) + ' against a target of ' + fmt(goal.target) + '.';
    else if (p.hasData) message = 'You got ' + Math.round(p.pct * 100) + '% of the way: ' + fmt(p.actual) + ' against a target of ' + fmt(goal.target) + '.';
    else message = 'Nothing was logged for this goal in its time.';
    return { result, message, progress: p, draft: nextDraft(goal, p, today) };
  }
  function nextDraft(goal, p, today) {
    const d = Object.assign({}, goal, { id: null, start: today, prev: goal.id, status: 'active', closedOn: null, from: p.hasData ? clamp(p.actual, -1e7, 1e7) : goal.from });
    if (goal.kind === 'endurance') {
      if (goal.aim === 'distance') {
        if (p.reached) { const nx = LADDER.find((x) => x > goal.target * 1.05); d.target = nx || E.clamp(roundStep(goal.target * 1.25, stepFor(goal.target)), 0.1, 500); d.title = 'Next: ' + sportOf(goal.sport).name.toLowerCase() + ' ' + fmtDist(d.target, 'km', goal.sport); }
        else d.weeks = clamp(Math.ceil(goal.weeks * 1.25), 1, E.MAX_WEEKS);
      } else if (goal.aim === 'pace') {
        if (p.reached) d.target = Math.round(goal.target * 0.97);
        else d.weeks = clamp(Math.ceil(goal.weeks * 1.25), 1, E.MAX_WEEKS);
      } else if (p.reached) d.target = clamp(roundStep(goal.target * 1.15, goal.target <= 10 ? 0.5 : 1), 0.5, 2000);
      else d.weeks = clamp(Math.ceil(goal.weeks * 1.25), 1, E.MAX_WEEKS);
      if (p.hasData === false) d.from = goal.from;
      if (p.reached && goal.aim !== 'pace') d.weeks = clamp(Math.max(d.weeks, buildPath(d, d.from > 0 ? d.from : 1).suggestWeeks), 1, E.MAX_WEEKS);
    } else if (p.reached) d.target = E.clean(p.actual + (goal.target - goal.from) * 0.5);
    else d.weeks = clamp(Math.ceil(goal.weeks * 1.25), 1, E.MAX_WEEKS);
    if (d.kind === 'custom' && d.from === d.target) d.target = E.clean(d.target + (goal.target - goal.from) * 0.25);
    return d;
  }
  // A value in words for a goal: "21.1 km", "5:30 per km" or "12 reps".
  function valueText(goal, v, unit) {
    if (v == null) return '';
    if (goal.kind === 'custom') return trim(v, 2) + (goal.unit ? ' ' + goal.unit : '');
    if (goal.aim === 'pace') return fmtPace(v, goal.sport, unit || 'km');
    return fmtDist(v, unit || 'km', goal.sport) + (goal.aim === 'weekly' ? ' a week' : '');
  }
  // One line for the coach and for cards: what the goal is.
  function describe(goal, unit) {
    if (goal.kind === 'custom') return trim(goal.from, 2) + ' to ' + trim(goal.target, 2) + (goal.unit ? ' ' + goal.unit : '');
    const sp = sportOf(goal.sport).name.toLowerCase();
    if (goal.aim === 'pace') return sp + ' ' + fmtDist(goal.paceKm, unit || 'km', goal.sport) + ' at ' + fmtPace(goal.target, goal.sport, unit || 'km');
    if (goal.aim === 'weekly') return sp + ' ' + fmtDist(goal.target, unit || 'km', goal.sport) + ' a week';
    return sp + ' ' + fmtDist(goal.target, unit || 'km', goal.sport) + ' in one go';
  }
  // Months in words for the common lengths, weeks otherwise.
  function lengthText(weeks) {
    const m = E.PLAN_LENGTHS.find((x) => x[0] === weeks);
    return m ? m[1] : weeks + (weeks === 1 ? ' week' : ' weeks');
  }
  // A short summary of every goal for the coach. No notes are included.
  function digest(state, today, unit) {
    const rows = [];
    for (const p of overview(state, today)) {
      if (p.kind === 'strength') { rows.push({ goal: p.title + ' (' + p.sub + ')', week: p.week + ' of ' + p.weeks, status: p.label, liftsHitThisWeek: p.hitNow + ' of ' + p.lifts }); continue; }
      const g = state.goals[p.id];
      rows.push({ goal: g.title, aim: describe(g, unit), week: p.over ? 'over' : p.week + ' of ' + p.weeks, status: p.label, done: Math.round(p.pct * 100) + '%', now: valueText(g, p.actual, unit), thisWeek: p.thisWeek ? valueText(g, p.thisWeek.target, unit) : null });
    }
    return rows.slice(0, 12);
  }

  const Goals = {
    SPORTS, LADDER, KM_PER_MI, LABEL, PLAN_GOALS, sportOf, distUnitFor, distInput, toKm, fromKm, fmtDist, fmtPace, parsePace, paceHint, paceInfo, mmss,
    buildPath, baseline, progress, strengthProgress, overview, review, nextDraft, valueText, describe, lengthText, digest, enduranceWeeks, weekBounds, stepFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Goals;
  else root.Goals = Goals;
})(typeof self !== 'undefined' ? self : this);

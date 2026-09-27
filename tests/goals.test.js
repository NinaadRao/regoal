'use strict';
// Goals: plan length, the whitelist for goals and readings, week-by-week paths, progress against them and the end of a cycle.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const G = require('../js/goals.js');

const answers = (o) => Object.assign({
  sex: 'male', age: 30, heightCm: 180, weightKg: 80, units: { body: 'kg', length: 'in', lift: 'lb' },
  measurements: { waist: 86 }, goal: 'recomp', days: [1, 2, 3, 4, 5], startDate: '2026-01-05',
  training: { split: 'auto', equipment: ['Dumbbells', 'Machines'], dbStep: 2.5, machineStep: 5, focus: ['chest'], injuries: ['Nothing'], repStyle: 'mixed', sets: 3, deload: 'planned' },
  lifts: [{ id: 'flat_db_press', on: true, weight: 60, reps: 8 }, { id: 'lat_pulldown', on: true, weight: 120, reps: 10 }],
}, o || {});
let seq = 0;
const ev = (type, data) => ({ seq: ++seq, ts: '2026-01-05T08:00:00Z', src: 'user', type, data });
function world(extra, opts) {
  seq = 0;
  const plan = E.buildPlan(answers(opts));
  return E.project([ev('profile_created', { profile: { weightKg: 80, days: [1, 2, 3, 4, 5] }, plan })].concat(extra || []));
}
const mkGoal = (o) => Object.assign({ id: 'g_run001', kind: 'endurance', title: 'Half marathon', start: '2026-01-05', weeks: 20, sport: 'running', aim: 'distance', target: 21.0975, from: 8, paceKm: null, unit: '', status: 'active', closedOn: null, prev: null, note: '' }, o || {});
const setGoal = (o) => ev('goal_set', { goal: mkGoal(o) });
const run = (date, km, mins, extra) => ev('workout_logged', Object.assign({ id: 'w_' + date.replace(/-/g, '') + Math.round(km * 10), date, type: 'running', mins: mins || Math.round(km * 6), effort: 'moderate', kcal: 300, km }, extra || {}));

// ---------- plan length ----------
test('a plan can be any length: deloads, blocks and targets stretch, and 26 weeks is unchanged', () => {
  const p26 = E.buildPlan(answers()), p13 = E.buildPlan(answers({ weeks: 13 })), p52 = E.buildPlan(answers({ weeks: 52 })), p4 = E.buildPlan(answers({ weeks: 4 }));
  assert.equal(E.planWeeks(p26), 26);
  assert.deepEqual(p26.deloadWeeks, [7, 14, 21]);
  assert.deepEqual(p13.deloadWeeks, [7]);
  assert.deepEqual(p4.deloadWeeks, []);
  assert.deepEqual(p52.deloadWeeks, [7, 14, 21, 28, 35, 42, 49]);
  const lift = (p) => p.lifts.flat_db_press;
  const kgAt = (p, w) => E.liftTarget(lift(p), w, E.targetOpts(p)).kg;
  assert.equal(kgAt(p13, 1), kgAt(p26, 1), 'week 1 starts at the same weight whatever the length');
  assert.ok(kgAt(p13, 13) > kgAt(p13, 1), 'a short plan still climbs');
  assert.ok(kgAt(p52, 52) > kgAt(p52, 26), 'a long plan keeps climbing past week 26');
  assert.ok(kgAt(p52, 52) >= kgAt(p26, 26));
  assert.equal(E.blockOfWeek(1, 13), 0);
  assert.equal(E.blockOfWeek(13, 13), 4);
  assert.equal(E.blockOfWeek(52, 52), 4);
  assert.equal(E.blockOfWeek(10), E.blockOfWeek(10, 26), 'no length means the 26-week layout');
  for (const w of [1, 30, 52, 104]) { const t = E.liftTarget(lift(p52), w, E.targetOpts(p52)); assert.ok(t.kg > 0 && t.reps >= 4 && t.sets >= 1, 'week ' + w); }
});

test('plan length is clamped and checkpoints and body targets scale with it', () => {
  assert.equal(E.planWeeks({ weeks: 1 }), E.MIN_WEEKS);
  assert.equal(E.planWeeks({ weeks: 9999 }), E.MAX_WEEKS);
  assert.equal(E.planWeeks({}), 26);
  assert.equal(E.planWeeks({ weeks: 'x' }), 26);
  const w26 = E.measurementTargets('build', { waist: 80 }, 26).waist.target, w13 = E.measurementTargets('build', { waist: 80 }, 13).waist.target, w52 = E.measurementTargets('build', { waist: 80 }, 52).waist.target;
  assert.ok(w13 - 80 < w26 - 80 && w26 - 80 < w52 - 80);
  assert.equal(E.measurementTargets('build', { waist: 80 }).waist.target, w26);
});

test('changing a plan\'s length keeps its history and follows deload settings', () => {
  const st = world([ev('plan_revised', { reason: 'longer', changes: { weeks: 52 } })]);
  assert.equal(st.plan.weeks, 52);
  assert.deepEqual(st.plan.deloadWeeks, [7, 14, 21, 28, 35, 42, 49]);
  const st2 = world([ev('plan_revised', { reason: 'shorter', changes: { weeks: 13 } })]);
  assert.deepEqual(st2.plan.deloadWeeks, [7]);
  const off = world([ev('plan_revised', { reason: 'longer', changes: { weeks: 52 } })], { training: Object.assign({}, answers().training, { deload: 'none' }) });
  assert.deepEqual(off.plan.deloadWeeks, [], 'no deloads stays no deloads');
  const bad = world([ev('plan_revised', { reason: 'x', changes: { weeks: 'lots' } })]);
  assert.equal(bad.plan.weeks, 26);
  const huge = world([ev('plan_revised', { reason: 'x', changes: { weeks: 100000 } })]);
  assert.equal(huge.plan.weeks, E.MAX_WEEKS);
});

// ---------- the whitelist ----------
test('a goal is rebuilt from a whitelist and one bad field refuses it', () => {
  const ok = E.cleanGoal(mkGoal({ title: '  Half\u0000 marathon  ', extra: 'ignored', note: 'x'.repeat(500) }));
  assert.equal(ok.ok, true);
  assert.equal(ok.value.title, 'Half marathon');
  assert.equal(ok.value.note.length, 200);
  assert.equal(ok.value.extra, undefined);
  const bad = (o, msg) => assert.equal(E.cleanGoal(mkGoal(o)).ok, false, msg);
  bad({ id: 'nope' }, 'ids must look like g_xxx');
  bad({ id: 'g_' + 'a'.repeat(40) }, 'ids are limited in length');
  bad({ kind: 'sport' }, 'unknown kind');
  bad({ title: '   ' }, 'a goal needs a name');
  bad({ start: '2026-02-30' }, 'dates must exist');
  bad({ weeks: 0 }, 'at least a week');
  bad({ weeks: 500 }, 'no more than two years');
  bad({ sport: 'constructor' }, 'sports are checked as own names');
  bad({ aim: 'vibes' }, 'unknown aim');
  bad({ target: 9999 }, 'distance out of range');
  bad({ target: null }, 'a target is required');
  bad({ from: 30 }, 'a distance goal starts below its target');
  bad({ aim: 'pace', target: 300, from: 240, paceKm: 5 }, 'a pace goal starts slower than its target');
  bad({ aim: 'pace', target: 300, from: null, paceKm: 5 }, 'a pace goal needs a starting pace');
  bad({ aim: 'pace', target: 300, from: 360, paceKm: null }, 'a pace goal needs a distance');
  assert.equal(E.cleanGoal(mkGoal({ aim: 'pace', target: 300, from: 360, paceKm: 5 })).ok, true);
  assert.equal(E.cleanGoal(JSON.parse('{"id":"g_abc123","__proto__":{"x":1}}')).ok, false);
  assert.equal(E.cleanGoal(null).ok, false);
  assert.equal(E.cleanGoal([]).ok, false);
  const custom = (o) => E.cleanGoal(Object.assign({ id: 'g_pull01', kind: 'custom', title: 'Pull-ups', start: '2026-01-05', weeks: 12, unit: 'reps', from: 4, target: 12 }, o || {}));
  assert.equal(custom().ok, true);
  assert.equal(custom({ target: 4 }).ok, false, 'the target must differ from the start');
  assert.equal(custom({ target: null }).ok, false);
  assert.equal(custom({ from: 'abc' }).ok, false);
  assert.equal(custom({ target: 2, from: 60 }).ok, true, 'downwards works too');
  assert.equal(custom({ unit: 'r'.repeat(50) }).value.unit.length, 12);
});

test('goals and readings ride in the event log; later events replace, voiding restores, junk is skipped', () => {
  const st = world([setGoal({ title: 'First' }), setGoal({ title: 'Renamed' }), ev('goal_set', { goal: { id: 'bad' } }), ev('goal_entry', { goal: 'g_run001', date: '2026-01-06', value: 5 }), ev('goal_entry', { goal: 'g_run001', date: 'never', value: 5 }), ev('goal_entry', { goal: 'g_run001', date: '2026-01-07', value: 'x' })]);
  assert.equal(st.goalOrder.length, 1);
  assert.equal(st.goals.g_run001.title, 'Renamed');
  assert.equal(st.goalEntries.length, 1);
  const withVoid = world([setGoal({ title: 'First' }), setGoal({ title: 'Second' }), ev('event_voided', { target: 3 })]);
  assert.equal(withVoid.goals.g_run001.title, 'First', 'undoing an edit brings back the earlier version');
  assert.equal(E.validateEvents([ev('goal_set', { goal: mkGoal() }), ev('goal_entry', { goal: 'g_run001' })]), null);
  const many = [];
  for (let i = 0; i < E.MAX_GOALS + 5; i++) many.push(setGoal({ id: 'g_many' + String(i).padStart(3, '0') }));
  assert.equal(world(many).goalOrder.length, E.MAX_GOALS, 'the number of goals is capped');
  assert.equal(Object.getPrototypeOf(world([]).goals), null);
});

test('a workout can carry a distance, clamped and optional', () => {
  const w = (km) => E.cleanWorkout({ date: '2026-02-03', type: 'running', mins: 30, km });
  assert.equal(w(5.256).value.km, 5.26);
  assert.equal(w(undefined).value.km, 0);
  assert.equal(w('abc').value.km, 0);
  assert.equal(w(-4).value.km, 0);
  assert.equal(w(99999).value.km, 1000);
});

// ---------- units ----------
test('distance and pace read and print the way each sport talks about them', () => {
  assert.equal(G.fmtPace(330, 'running', 'km'), '5:30 per km');
  assert.equal(G.fmtPace(330, 'running', 'mi'), '8:51 per mi');
  assert.equal(G.fmtPace(1200, 'swimming', 'km'), '2:00 per 100 m');
  assert.equal(G.fmtPace(180, 'rowing', 'km'), '1:30 per 500 m');
  assert.equal(G.fmtPace(120, 'cycling', 'km'), '30 km/h');
  for (const [sport, unit, text] of [['running', 'km', '5:30'], ['running', 'mi', '8:30'], ['swimming', 'km', '1:45'], ['swimming', 'mi', '1:45'], ['rowing', 'km', '2:05'], ['cycling', 'km', '27.5'], ['cycling', 'mi', '18']]) {
    const sec = G.parsePace(text, sport, unit);
    assert.ok(sec > 0, sport + ' ' + text);
    assert.equal(G.fmtPace(sec, sport, unit).split(' ')[0], text, sport + ' ' + unit + ' round trip');
  }
  assert.ok(Number.isNaN(G.parsePace('fast', 'running', 'km')));
  assert.ok(Number.isNaN(G.parsePace('5:75', 'running', 'km')));
  assert.ok(Number.isNaN(G.parsePace('', 'running', 'km')));
  assert.ok(Number.isNaN(G.parsePace('0', 'cycling', 'km')));
  assert.equal(G.fmtDist(42.195, 'km', 'running'), '42.2 km');
  assert.equal(G.fmtDist(21.0975, 'mi', 'running'), '13.1 mi');
  assert.equal(G.fmtDist(1.5, 'km', 'swimming'), '1,500 m');
  assert.equal(G.fmtDist(0.4, 'mi', 'swimming'), '435 yd');
  assert.equal(G.fmtDist(3.8, 'km', 'swimming'), '3.8 km');
  assert.equal(G.distUnitFor({ lenUnit: 'in' }), 'mi');
  assert.equal(G.distUnitFor({ lenUnit: 'cm' }), 'km');
  // an explicit distance-unit choice overrides the length-unit fallback either way
  assert.equal(G.distUnitFor({ lenUnit: 'in', distUnit: 'km' }), 'km');
  assert.equal(G.distUnitFor({ lenUnit: 'cm', distUnit: 'mi' }), 'mi');
  assert.equal(G.distUnitFor({ lenUnit: 'in', distUnit: 'auto' }), 'mi');
  assert.equal(G.distUnitFor({ lenUnit: 'cm', distUnit: 'auto' }), 'km');
  assert.ok(Math.abs(G.toKm(G.fromKm(7.3, 'yd'), 'yd') - 7.3) < 1e-9);
});

// ---------- paths ----------
test('a distance path climbs in steps, eases off every fourth week, tapers, and ends on the day', () => {
  for (const [T, weeks, from] of [[42.195, 26, 10], [21.0975, 16, 8], [10, 12, 3], [5, 9, 1], [42.195, 52, 5]]) {
    const g = mkGoal({ target: T, weeks, from });
    const p = G.buildPath(g, from);
    assert.equal(p.weeks.length, weeks, 'one entry per week');
    assert.deepEqual(p.weeks.map((w) => w.week), Array.from({ length: weeks }, (_, i) => i + 1));
    const last = p.weeks[weeks - 1];
    assert.equal(last.kind, 'goal'); assert.equal(last.target, T);
    const peak = Math.max(...p.weeks.filter((w) => w.kind !== 'goal').map((w) => w.target));
    if (T >= 30) assert.ok(peak <= 32.5, 'a marathon plan never asks for more than about 32 km before the day: ' + peak);
    assert.ok(peak <= T + 0.01 && peak >= from, 'the peak sits between where you are and the target');
    p.weeks.forEach((w, i) => { if (w.kind === 'cutback') assert.ok(w.target < p.weeks[i - 1].target, 'a lighter week is lighter'); });
    const build = p.weeks.filter((w) => w.kind === 'build').map((w) => w.target);
    for (let i = 1; i < build.length; i++) assert.ok(build[i] >= build[i - 1] - 0.01, 'build weeks never go down');
    assert.ok(p.weeks.slice(0, weeks - p.taper).every((w) => w.kind === 'build' || w.kind === 'cutback'));
    assert.equal(p.taper, Math.max(1, Math.min(T >= 30 ? 3 : T >= 15 ? 2 : 1, Math.floor(weeks / 4))));
  }
  // a very short cycle still makes sense
  for (const weeks of [1, 2, 3]) { const p = G.buildPath(mkGoal({ weeks, target: 10, from: 5 }), 5); assert.equal(p.weeks.length, weeks); assert.equal(p.weeks[weeks - 1].target, 10); }
});

test('the path says when a cycle is too short and suggests a length that is gentler', () => {
  const rushed = G.buildPath(mkGoal({ target: 42.195, weeks: 8, from: 10 }), 10);
  assert.equal(rushed.ambitious, true);
  assert.match(rushed.note, /gentler/);
  assert.ok(rushed.suggestWeeks >= 16 && rushed.suggestWeeks <= 26, 'a marathon from 10 km wants roughly 4 to 6 months: ' + rushed.suggestWeeks);
  const fine = G.buildPath(mkGoal({ target: 42.195, weeks: 26, from: 10 }), 10);
  assert.equal(fine.ambitious, false);
  assert.equal(fine.note, '');
  assert.equal(G.buildPath(mkGoal({ target: 10, weeks: 4, from: 3 }), 3).ambitious, true);
  const fast = G.buildPath(mkGoal({ aim: 'pace', target: 240, from: 360, paceKm: 5, weeks: 6 }), 360);
  assert.equal(fast.ambitious, true);
  assert.equal(G.buildPath(mkGoal({ aim: 'pace', target: 330, from: 360, paceKm: 5, weeks: 12 }), 360).ambitious, false);
});

test('a pace path gets faster in equal steps and a weekly path reaches its target in the last week', () => {
  const p = G.buildPath(mkGoal({ aim: 'pace', target: 300, from: 360, paceKm: 5, weeks: 12 }), 360);
  assert.equal(p.weeks[0].target, 355);
  assert.equal(p.weeks[11].target, 300);
  for (let i = 1; i < 12; i++) assert.ok(p.weeks[i].target < p.weeks[i - 1].target);
  const v = G.buildPath(mkGoal({ aim: 'weekly', target: 40, from: 10, weeks: 16 }), 10);
  assert.equal(v.weeks.length, 16);
  assert.equal(v.weeks[15].target, 40);
  assert.equal(v.weeks[15].kind, 'goal');
  assert.ok(v.weeks.some((w) => w.kind === 'cutback'));
});

// ---------- progress ----------
test('before any session: no data in week one, behind after that, and a future goal has not started', () => {
  const st = world([setGoal({})]);
  const g = st.goals.g_run001;
  assert.equal(G.progress(st, g, '2026-01-07').status, 'nodata');
  assert.equal(G.progress(st, g, '2026-01-14').status, 'behind');
  assert.equal(G.progress(st, g, '2026-01-01').status, 'notstarted');
  assert.equal(G.progress(st, g, '2026-01-01').week, 0);
  assert.equal(G.progress(st, g, '2026-01-07').cw, 1);
});

test('a distance goal measures the longest session against what the path asked by the start of the week', () => {
  const g = mkGoal({ weeks: 20, from: 8 });
  const path = G.buildPath(g, 8);
  const askedBy = (w) => Math.max(8, ...path.weeks.filter((x) => x.week < w && x.kind !== 'taper').map((x) => x.target));
  // Week 6 (2026-02-09 to 02-15): on track means about what weeks 1 to 5 asked.
  const on = world([setGoal({}), run('2026-01-10', 8.5), run('2026-02-10', askedBy(6))]);
  assert.equal(G.progress(on, on.goals.g_run001, '2026-02-11').status, 'on');
  const behind = world([setGoal({}), run('2026-01-10', 8.5)]);
  assert.equal(G.progress(behind, behind.goals.g_run001, '2026-02-11').status, 'behind');
  const ahead = world([setGoal({}), run('2026-02-10', 17)]);
  const pa = G.progress(ahead, ahead.goals.g_run001, '2026-02-11');
  assert.equal(pa.status, 'ahead');
  assert.equal(pa.actual, 17);
  assert.ok(pa.pct > 0.6 && pa.pct < 0.8);
  // a longer session done as a different sport, or before the start, does not count
  const other = world([setGoal({}), run('2026-02-10', 20, 120, { type: 'cycling' }), run('2025-12-28', 20)]);
  assert.equal(G.progress(other, other.goals.g_run001, '2026-02-11').actual, 8);
  // sessions with no distance do not count, but they are noticed
  const nodist = world([setGoal({}), run('2026-02-10', 0, 60)]);
  const pn = G.progress(nodist, nodist.goals.g_run001, '2026-02-11');
  assert.equal(pn.hasData, false);
  assert.equal(pn.noDistance, true);
});

test('reaching the target ends it early; running out of time without it says so', () => {
  const won = world([setGoal({}), run('2026-02-20', 21.1)]);
  const pw = G.progress(won, won.goals.g_run001, '2026-02-21');
  assert.equal(pw.reached, true); assert.equal(pw.status, 'reached'); assert.equal(pw.pct, 1);
  const lost = world([setGoal({}), run('2026-03-01', 12)]);
  const pl = G.progress(lost, lost.goals.g_run001, '2026-06-01');
  assert.equal(pl.over, true); assert.equal(pl.status, 'ended'); assert.ok(pl.pct > 0 && pl.pct < 1);
  assert.equal(pl.thisWeek, null);
  const closed = world([setGoal({ status: 'closed', closedOn: '2026-03-01' })]);
  assert.equal(G.progress(closed, closed.goals.g_run001, '2026-03-02').status, 'closed');
});

test('a pace goal only counts sessions over about 90 percent of the distance', () => {
  const g = { aim: 'pace', target: 300, from: 360, paceKm: 5, weeks: 12 };
  const st = world([setGoal(g), run('2026-01-20', 3, 15), run('2026-01-21', 4.6, 25)]);
  const p = G.progress(st, st.goals.g_run001, '2026-01-22');
  assert.equal(p.hasData, true);
  assert.ok(Math.abs(p.actual - (25 * 60) / 4.6) < 0.01, 'the 3 km run is too short to count; the 4.6 km run is 326 s per km');
  const fast = world([setGoal(g), run('2026-01-21', 5, 24)]);
  const pf = G.progress(fast, fast.goals.g_run001, '2026-01-22');
  assert.equal(pf.reached, true, '24 minutes over 5 km is 4:48 per km');
});

test('a weekly goal uses the biggest week and a custom goal uses the latest reading, in either direction', () => {
  const st = world([setGoal({ aim: 'weekly', target: 40, from: 10, weeks: 16 }), run('2026-01-06', 10), run('2026-01-08', 12), run('2026-01-15', 9)]);
  const p = G.progress(st, st.goals.g_run001, '2026-01-16');
  assert.equal(p.actual, 22, 'week one held 10 + 12 km');
  const up = { id: 'g_pull01', kind: 'custom', title: 'Pull-ups', start: '2026-01-05', weeks: 12, unit: 'reps', from: 4, target: 12 };
  const s2 = world([ev('goal_set', { goal: up }), ev('goal_entry', { goal: 'g_pull01', date: '2026-01-20', value: 7 }), ev('goal_entry', { goal: 'g_pull01', date: '2026-02-10', value: 6 }), ev('goal_entry', { goal: 'g_other1', date: '2026-02-11', value: 99 })]);
  const p2 = G.progress(s2, s2.goals.g_pull01, '2026-02-12');
  assert.equal(p2.actual, 6, 'the latest reading, not the best');
  assert.equal(p2.best, 7);
  assert.equal(p2.entries.length, 2, 'readings for other goals are ignored');
  assert.equal(p2.status, 'behind');
  const down = { id: 'g_rhr001', kind: 'custom', title: 'Resting heart rate', start: '2026-01-05', weeks: 12, unit: 'bpm', from: 70, target: 60 };
  const s3 = world([ev('goal_set', { goal: down }), ev('goal_entry', { goal: 'g_rhr001', date: '2026-02-01', value: 62 })]);
  const p3 = G.progress(s3, s3.goals.g_rhr001, '2026-02-02');
  assert.ok(p3.pct > 0.7 && p3.pct < 0.9);
  assert.equal(p3.status, 'ahead');
  const s4 = world([ev('goal_set', { goal: down }), ev('goal_entry', { goal: 'g_rhr001', date: '2026-02-01', value: 58 })]);
  assert.equal(G.progress(s4, s4.goals.g_rhr001, '2026-02-02').reached, true, 'lower is better when the target is lower');
});

test('the strength goal is the plan: hit rate decides the status and the plan length is its length', () => {
  const st = world([]);
  const p0 = G.strengthProgress(st, '2026-01-07');
  assert.equal(p0.kind, 'strength'); assert.equal(p0.weeks, 26); assert.equal(p0.status, 'nodata');
  const late = G.strengthProgress(st, '2026-02-20');
  assert.equal(late.status, 'behind', 'weeks passed with nothing logged');
  const long = world([ev('plan_revised', { reason: 'longer', changes: { weeks: 52 } })]);
  assert.equal(G.strengthProgress(long, '2026-01-07').weeks, 52);
  assert.equal(G.strengthProgress(world([]), '2026-08-01').over, true);
  assert.equal(G.strengthProgress(world([]), '2026-08-01').status, 'ended');
});

test('the overview lists the plan first, active goals next and closed goals last', () => {
  const st = world([setGoal({ id: 'g_aaa001', status: 'closed', closedOn: '2026-02-01' }), setGoal({ id: 'g_bbb002', title: 'Swim', sport: 'swimming', target: 1.5, from: 0.5 })]);
  const list = G.overview(st, '2026-02-10');
  assert.deepEqual(list.map((p) => p.id), ['plan', 'g_bbb002', 'g_aaa001']);
});

// ---------- the end of a cycle ----------
test('a finished goal says how it went and offers a next cycle that is a draft, not a saved goal', () => {
  const won = world([setGoal({ target: 10, from: 5, weeks: 8 }), run('2026-02-10', 10.2)]);
  const rw = G.review(won, won.goals.g_run001, '2026-03-20', 'km');
  assert.equal(rw.result, 'reached');
  assert.match(rw.message, /got there/i);
  assert.equal(rw.draft.id, null);
  assert.equal(rw.draft.prev, 'g_run001');
  assert.ok(rw.draft.target > 10, 'the next distance is higher');
  assert.ok(Math.abs(rw.draft.target - 21.0975) < 0.01, 'a 10K leads to a half marathon');
  assert.equal(rw.draft.from, 10.2, 'the next cycle starts where this one got to');
  assert.equal(rw.draft.start, '2026-03-20');
  assert.ok(rw.draft.weeks >= 8);
  const missed = world([setGoal({ target: 21.0975, from: 8, weeks: 8 }), run('2026-02-10', 12)]);
  const rm = G.review(missed, missed.goals.g_run001, '2026-03-20', 'km');
  assert.notEqual(rm.result, 'reached');
  assert.equal(rm.draft.target, missed.goals.g_run001.target, 'the same target');
  assert.equal(rm.draft.weeks, 10, 'with a quarter more time');
  const empty = world([setGoal({ weeks: 4 })]);
  const re = G.review(empty, empty.goals.g_run001, '2026-03-01', 'km');
  assert.equal(re.result, 'short');
  assert.match(re.message, /nothing was logged/i);
  // a draft goes through the same whitelist once it has an id
  for (const r of [rw, rm, re]) assert.equal(E.cleanGoal(Object.assign({}, r.draft, { id: 'g_next001' })).ok, true);
  const cust = { id: 'g_pull01', kind: 'custom', title: 'Pull-ups', start: '2026-01-05', weeks: 4, unit: 'reps', from: 4, target: 12 };
  const cs = world([ev('goal_set', { goal: cust }), ev('goal_entry', { goal: 'g_pull01', date: '2026-01-20', value: 12 })]);
  const rc = G.review(cs, cs.goals.g_pull01, '2026-02-10', 'km');
  assert.equal(rc.result, 'reached');
  assert.ok(rc.draft.target > 12 && rc.draft.from === 12);
  assert.equal(E.cleanGoal(Object.assign({}, rc.draft, { id: 'g_next002' })).ok, true);
});

// ---------- what the coach sees ----------
test('the coach summary lists every goal, names no notes, and stays short', () => {
  const st = world([setGoal({ note: 'private note about my knee' }), run('2026-01-10', 9)]);
  const d = G.digest(st, '2026-01-12', 'km');
  assert.equal(d.length, 2);
  assert.match(d[0].goal, /Strength and muscle/);
  assert.match(d[1].aim, /running 21\.1 km in one go/);
  assert.equal(JSON.stringify(d).includes('knee'), false, 'notes never reach the coach');
  const many = [];
  for (let i = 0; i < 20; i++) many.push(setGoal({ id: 'g_many' + String(i).padStart(3, '0') }));
  assert.ok(G.digest(world(many), '2026-01-12', 'km').length <= 12);
});

test('body-target checkpoints move with the length of the plan', () => {
  const state = (weeks, extra) => { const s = world([ev('measurement_logged', { date: '2026-03-01', site: 'waist', cm: 80 })].concat(extra || []), { weeks }); return s; };
  const s13 = state(13), s26 = state(26);
  assert.equal(E.checkpoint(s26, '2026-02-20'), null, 'week 7 of 26: too early');
  const cp13 = E.checkpoint(s13, '2026-03-05');
  assert.ok(cp13 && cp13.week === 6, 'week 6 of 13 is the halfway checkpoint');
  const cp26 = E.checkpoint(s26, '2026-03-30');
  assert.ok(cp26 && cp26.week === 12);
});

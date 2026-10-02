'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');

// A fictional lifter. Expected tables below were computed independently of the engine.
const answers = (over) => Object.assign({
  sex: 'male', age: 30, heightCm: 180, weightKg: 80, units: { body: 'kg', length: 'in', lift: 'lb' },
  measurements: { waist: 86, chest: 100, shoulders: 112, hips: 100, bicepL: 35, bicepR: 35 },
  goal: 'recomp', days: [1, 2, 3, 4, 5], startDate: '2026-01-05',
  training: { split: 'auto', equipment: ['Dumbbells', 'Machines'], dbStep: 2.5, machineStep: 5, focus: ['chest'], injuries: ['Nothing'], repStyle: 'mixed', sets: 3, deload: 'planned' },
  lifts: [
    { id: 'flat_db_press', on: true, weight: 60, reps: 8 }, { id: 'incline_db_press', on: true, weight: 55, reps: 8 },
    { id: 'shoulder_press', on: true, weight: 35, reps: 10 }, { id: 'lat_pulldown', on: true, weight: 120, reps: 10 },
    { id: 'db_row', on: true, weight: 60, reps: 10 }, { id: 'curl', on: true, weight: 25, reps: 10 },
    { id: 'leg_press', on: true, weight: 270, reps: 8 }, { id: 'leg_curl', on: true, weight: 150, reps: 12 },
    { id: 'leg_ext', on: true, weight: 140, reps: 12 }, { id: 'bulgarian', on: true, weight: 40, reps: 10 },
    { id: 'pullups', on: true, reps: 4 },
  ],
}, over || {});

test('macro maths: 80 kg, 30 y, 180 cm, 5 days', () => {
  const who = { sex: 'male', kg: 80, cm: 180, age: 30, days: 5 };
  const t = E.targetsFor('recomp', who);
  assert.equal(t.kcal, 2950);
  assert.equal(t.protein, 190);
  assert.equal(t.fat, 105);
  assert.equal(t.carbs, 310);
  const b = E.targetsFor('build', who);
  assert.equal(b.kcal, 3150);
  assert.equal(b.carbs, 360);
  assert.equal(E.targetsFor('cut', who).kcal, 2650);
});

test('block weights reproduce the independently computed tables', () => {
  const plan = E.buildPlan(answers());
  const lb = (id) => plan.lifts[id].blockUnits;
  assert.deepEqual(lb('flat_db_press'), [60, 65, 72.5, 77.5, 85]);
  assert.deepEqual(lb('incline_db_press'), [55, 60, 65, 72.5, 77.5]);
  assert.deepEqual(lb('shoulder_press'), [35, 37.5, 40, 42.5, 45]);
  assert.deepEqual(lb('lat_pulldown'), [120, 130, 135, 145, 150]);
  assert.deepEqual(lb('db_row'), [60, 65, 72.5, 77.5, 85]);
  assert.deepEqual(lb('curl'), [25, 27.5, 30, 32.5, 35]);
  assert.deepEqual(lb('leg_press'), [270, 285, 305, 320, 340]);
  assert.deepEqual(lb('leg_curl'), [150, 160, 165, 175, 180]);
  assert.deepEqual(lb('leg_ext'), [140, 145, 155, 160, 170]);
  assert.deepEqual(lb('bulgarian'), [40, 45, 47.5, 52.5, 55]);
});

test('rep waves, deloads and pull-ups follow the table', () => {
  const plan = E.buildPlan(answers());
  const chest = plan.lifts.flat_db_press;
  const reps = (l, ws) => ws.map((w) => E.liftTarget(l, w, { deloadWeeks: plan.deloadWeeks }).reps);
  assert.deepEqual(reps(chest, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), [8, 9, 10, 6, 7, 8, 8, 9, 10, 6]);
  assert.deepEqual(reps(plan.lifts.shoulder_press, [1, 2, 3, 4]), [10, 11, 12, 8]);
  assert.deepEqual(reps(plan.lifts.leg_curl, [1, 2, 3, 4]), [12, 13, 14, 10]);
  // deload weeks: 2 sets at the previous block's weight
  const d7 = E.liftTarget(chest, 7, { deloadWeeks: plan.deloadWeeks });
  assert.equal(d7.sets, 2);
  assert.ok(Math.abs(d7.kg - 60 * E.KG_PER_LB) < 1e-4);
  const d14 = E.liftTarget(chest, 14, { deloadWeeks: plan.deloadWeeks });
  assert.ok(Math.abs(d14.kg - 65 * E.KG_PER_LB) < 1e-4);
  const d21 = E.liftTarget(chest, 21, { deloadWeeks: plan.deloadWeeks });
  assert.ok(Math.abs(d21.kg - 72.5 * E.KG_PER_LB) < 1e-4);
  // weeks 1..26 weight per block
  const w = (wk) => Math.round(E.liftTarget(chest, wk, { deloadWeeks: plan.deloadWeeks }).kg / E.KG_PER_LB * 10) / 10;
  assert.deepEqual([1, 3, 4, 9, 10, 15, 16, 20, 22, 26].map(w), [60, 60, 65, 65, 72.5, 72.5, 77.5, 77.5, 85, 85]);
  const pu = plan.lifts.pullups;
  assert.deepEqual([1, 4, 10, 16, 22].map((wk) => E.liftTarget(pu, wk).reps), [4, 5, 6, 7, 8]);
});

test('weights strictly increase even for tiny gains', () => {
  const bw = E.blockWeights(10, 0.05, 2.5);
  for (let i = 1; i < bw.length; i++) assert.ok(bw[i] > bw[i - 1]);
});

test('start me lighter lowers week-one weights', () => {
  const a = answers({ startLighter: true });
  const p = E.buildPlan(a);
  assert.ok(p.lifts.flat_db_press.blockUnits[0] < 60);
});

test('goal suggestion uses waist-to-height ratio', () => {
  assert.equal(E.recommendGoal(90, 170).goal, 'cut');
  assert.equal(E.recommendGoal(80, 175).goal, 'recomp');
  assert.equal(E.recommendGoal(74, 182).goal, 'build');
});

test('measurement targets use the inch offsets', () => {
  const t = E.measurementTargets('recomp', { waist: 80, shoulders: 100 });
  assert.ok(Math.abs(t.waist.target - (80 - 2.54)) < 1e-4);
  assert.ok(Math.abs(t.shoulders.target - (100 + 1.25 * 2.54)) < 1e-4);
});

test('five-day template places every tracked lift exactly once', () => {
  const plan = E.buildPlan(answers());
  const placed = {};
  plan.workouts.forEach((w) => w.ex.forEach((e) => { if (e.lift) placed[e.lift] = (placed[e.lift] || 0) + 1; }));
  for (const id of Object.keys(plan.lifts)) assert.equal(placed[id], 1, id);
  assert.equal(plan.workouts.length, 5);
  assert.equal(plan.workouts[0].name, 'Push');
});

test('other day counts and unticked lifts still make a valid plan', () => {
  for (const days of [[1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5, 6], [2, 4]]) {
    const a = answers({ days });
    a.lifts = a.lifts.slice(0, 5);
    const p = E.buildPlan(a);
    assert.equal(p.workouts.length, days.length);
    const placed = new Set();
    p.workouts.forEach((w) => w.ex.forEach((e) => e.lift && placed.add(e.lift)));
    for (const id of Object.keys(p.lifts)) assert.ok(placed.has(id), id);
  }
});

test('validators enforce bounds', () => {
  const plan = E.buildPlan(answers());
  assert.equal(E.validateMacroChange(plan, 80, { kcal: 3300 }).ok, false);
  assert.equal(E.validateMacroChange(plan, 80, { kcal: 3200 }).ok, true);
  assert.equal(E.validateMacroChange(plan, 80, { protein: 300 }).ok, false);
  assert.equal(E.validateLiftChange(plan, { lift: 'flat_db_press', percent: 15, fromWeek: 3 }).ok, false);
  const v = E.validateLiftChange(plan, { lift: 'flat_db_press', percent: -5, fromWeek: 3 });
  assert.equal(v.ok, true);
  assert.equal(v.value.factor, 0.95);
});

test('projection applies revisions and honours voids', () => {
  const a = answers();
  const plan = E.buildPlan(a);
  const ev = [
    { seq: 1, ts: 't', type: 'profile_created', data: { profile: { weightKg: 80 }, plan } },
    { seq: 2, ts: 't', type: 'plan_revised', data: { reason: 'test', changes: { kcal: 3100, protein: 190, carbs: 350, fat: 105 } }, src: 'coach' },
    { seq: 3, ts: 't', type: 'weight_logged', data: { date: '2026-01-06', kg: 80.1 } },
    { seq: 4, ts: 't', type: 'event_voided', data: { target: 2 } },
  ];
  const s = E.project(ev);
  assert.equal(s.plan.kcal, 2950);
  assert.equal(s.weights.length, 1);
  const s2 = E.project(ev.slice(0, 3));
  assert.equal(s2.plan.kcal, 3100);
  assert.equal(s2.plan.history.length, 1);
});

test('lift adjustments scale weights and round to the step', () => {
  const plan = E.buildPlan(answers());
  const l = plan.lifts.flat_db_press;
  l.adjust.push({ fromWeek: 4, factor: 0.95 });
  const kg = E.liftTarget(l, 4, { deloadWeeks: plan.deloadWeeks }).kg / E.KG_PER_LB;
  assert.equal(Math.round(kg * 10) / 10, 62.5);
});

test('lift status: hit, partial, behind, todo', () => {
  const plan = E.buildPlan(answers());
  const state = E.project([{ seq: 1, ts: 't', type: 'profile_created', data: { profile: { weightKg: 80 }, plan } }]);
  const kg = 60 * E.KG_PER_LB;
  const mk = (n, reps, date) => ({ seq: 10 + n, date, lift: 'flat_db_press', kg, reps });
  assert.equal(E.liftStatus(state, 'flat_db_press', 1, '2026-01-06').status, 'Todo');
  state.sets.push(mk(1, 8, '2026-01-06'));
  assert.equal(E.liftStatus(state, 'flat_db_press', 1, '2026-01-06').status, 'Partial');
  assert.equal(E.liftStatus(state, 'flat_db_press', 1, '2026-01-20').status, 'Behind');
  state.sets.push(mk(2, 8, '2026-01-06'), mk(3, 9, '2026-01-06'));
  assert.equal(E.liftStatus(state, 'flat_db_press', 1, '2026-01-06').status, 'Hit');
});

test('import validation rejects unsafe payloads', () => {
  assert.equal(E.validateEvents([{ type: 'weight_logged', ts: 'x', data: { date: '2026-01-01', kg: 80 } }]), null);
  assert.ok(E.validateEvents([{ type: 'nope', ts: 'x', data: {} }]));
  const bad = JSON.parse('{"type":"weight_logged","ts":"x","data":{"__proto__":{"x":1}}}');
  assert.ok(E.validateEvents([bad]));
});

test('weekOf boundaries', () => {
  assert.equal(E.weekOf('2026-01-05', '2026-01-05'), 1);
  assert.equal(E.weekOf('2026-01-05', '2026-01-11'), 1);
  assert.equal(E.weekOf('2026-01-05', '2026-01-12'), 2);
});

test('food entries: clamped, recalculated from ingredients, warned when macros disagree', () => {
  // A model that claims 900 kcal but whose ingredients add up to 400 gets corrected.
  const r = E.normalizeFood({ name: 'Bowl', kcal: 900, protein: 10, carbs: 10, fat: 10, items: [
    { name: 'Rice', qty: '1 cup', kcal: 200, protein: 4, carbs: 44, fat: 0 }, { name: 'Dal', qty: '1 katori', kcal: 200, protein: 12, carbs: 26, fat: 4 }] });
  assert.equal(r.ok, true);
  assert.equal(r.value.kcal, 400);
  assert.equal(r.value.protein, 16);
  assert.ok(r.warnings.length >= 1);
  // Macros that cannot produce the calories are flagged, not silently accepted.
  const w = E.normalizeFood({ name: 'Mystery', kcal: 800, protein: 5, carbs: 5, fat: 5 });
  assert.equal(w.ok, true);
  assert.ok(w.warnings.some((x) => /add up/.test(x)));
  // Calories are worked out from macros when left empty.
  assert.equal(E.normalizeFood({ name: 'Whey', protein: 25, carbs: 3, fat: 2 }).value.kcal, 130);
  // Hostile or broken input is refused.
  assert.equal(E.normalizeFood({ name: '', kcal: 100 }).ok, false);
  assert.equal(E.normalizeFood({ name: 'x', kcal: 99999 }).ok, false);
  assert.equal(E.normalizeFood(null).ok, false);
  assert.equal(E.normalizeFood(JSON.parse('{"name":"x","kcal":100,"__proto__":{"a":1}}')).ok, false);
  const long = E.normalizeFood({ name: 'A'.repeat(500) + '\u0000\n', kcal: 100, protein: -5 });
  assert.equal(long.value.name.length, 80);
  assert.equal(long.value.protein, 0);
});

test('loose JSON parsing and day totals', () => {
  assert.deepEqual(E.parseJsonLoose('Sure! ```json\n{"a":1}\n``` hope that helps'), { a: 1 });
  assert.throws(() => E.parseJsonLoose('no data here'));
  const state = { foods: [{ date: 'd1', kcal: 300, protein: 20, carbs: 30, fat: 8 }, { date: 'd1', kcal: 100, protein: 5, carbs: 10, fat: 2 }, { date: 'd2', kcal: 999 }] };
  assert.deepEqual(E.dayTotals(state, 'd1'), { kcal: 400, protein: 25, carbs: 40, fat: 10, n: 2 });
});

test('photo trend: numbers around a check-in date use a 3-day mean, then the closest weigh-in, and never reach far', () => {
  const st = { weights: [{ date: '2026-01-01', kg: 80 }, { date: '2026-01-03', kg: 79 }, { date: '2026-01-04', kg: 81 }, { date: '2026-01-20', kg: 78 }], meas: [], photos: [] };
  assert.equal(E.weightAround(st.weights, '2026-01-02'), 80);          // three weigh-ins within 3 days
  assert.equal(E.weightAround(st.weights, '2026-01-09'), 81);          // nothing within 3 days: closest within 7 (Jan 4 is 5 away)
  assert.equal(E.weightAround(st.weights, '2026-01-12'), null);        // Jan 4 is 8 days away and Jan 20 is 8 days away
  assert.equal(E.weightAround([], '2026-01-01'), null);
});

test('photo trend: measurements pick the closest entry within 10 days, earlier on a tie', () => {
  const meas = [{ date: '2026-01-01', site: 'waist', cm: 86 }, { date: '2026-01-15', site: 'waist', cm: 85 }, { date: '2026-01-08', site: 'chest', cm: 100 }];
  assert.equal(E.measAround(meas, 'waist', '2026-01-08'), 86);         // 7 days from both: the earlier one
  assert.equal(E.measAround(meas, 'waist', '2026-01-13'), 85);
  assert.equal(E.measAround(meas, 'waist', '2026-02-10'), null);       // too far
  assert.equal(E.measAround(meas, 'hips', '2026-01-08'), null);        // never measured
});

test('photo trend: one entry per check-in week with the numbers of that photo date', () => {
  const st = {
    weights: [{ date: '2026-01-02', kg: 82 }, { date: '2026-02-01', kg: 80.5 }], meas: [{ date: '2026-01-02', site: 'waist', cm: 86 }, { date: '2026-02-01', site: 'waist', cm: 84.4 }],
    photos: [{ week: 1, angle: 'Front', date: '2026-01-02', id: 'a' }, { week: 5, angle: 'Front', date: '2026-02-01', id: 'b' }, { week: 5, angle: 'Side', date: '2026-02-01', id: 'c' }],
  };
  const c = E.checkIns(st, 'Front');
  assert.deepEqual(c.map((x) => x.week), E.PHOTO_WEEKS);
  assert.deepEqual(c.filter((x) => x.photo).map((x) => x.week), [1, 5]);
  const wk5 = c.find((x) => x.week === 5);
  assert.equal(c[0].snap.weightKg, 82); assert.equal(wk5.snap.meas.waist, 84.4); assert.equal(wk5.snap.meas.chest, null);
  assert.equal(c.find((x) => x.week === 2).snap, null);
  assert.equal(E.checkIns(st, 'Side').filter((x) => x.photo).length, 1);
});

test('photo trend: green means toward the goal, and a plan that does not care shows no colour', () => {
  const plan = { goal: 'recomp', measTargets: { waist: { start: 86, target: 83.5 }, chest: { start: 100, target: 103 }, hips: { start: 95, target: 95 } } };
  assert.equal(E.goalDir(plan, 'waist'), -1); assert.equal(E.goalDir(plan, 'chest'), 1); assert.equal(E.goalDir(plan, 'hips'), 0); assert.equal(E.goalDir(plan, 'bicepL'), 0);
  assert.equal(E.goalDir(plan, 'weight'), 0); assert.equal(E.goalDir({ goal: 'cut' }, 'weight'), -1); assert.equal(E.goalDir({ goal: 'build' }, 'weight'), 1);
  assert.equal(E.changeTone(-1.5, -1), 'good'); assert.equal(E.changeTone(-1.5, 1), 'coral'); assert.equal(E.changeTone(0.01, 1), '');
  assert.equal(E.changeTone(2, 0), ''); assert.equal(E.changeTone(null, 1), '');
});

test('weekly check-in: falls on the chosen weekday of each plan week', () => {
  // The plan starts on Saturday 2026-09-19; Friday is 5.
  assert.equal(E.checkinDate('2026-09-19', 1, 5), '2026-09-25');
  assert.equal(E.checkinDate('2026-09-19', 2, 5), '2026-10-02');
  assert.equal(E.checkinDate('2026-09-19', 1, 6), '2026-09-19'); // same weekday as the start: that day
  assert.equal(E.checkinDate('2026-09-19', 1, 0), '2026-09-20');
  for (let w = 1; w <= E.WEEKS; w++) { const d = E.checkinDate('2026-09-19', w, 3); assert.equal(E.weekdayOf(d), 3); assert.equal(E.weekOf('2026-09-19', d), w); }
  assert.equal(E.PHOTO_WEEKS.length, E.WEEKS);
});

test('weekly check-in: status is upcoming, due, overdue or done, and earlier gaps are listed', () => {
  const plan = { startDate: '2026-09-19' };
  const shots = (week, n) => E.ANGLES.slice(0, n).map((angle) => ({ week, angle, date: '2026-09-25', id: week + angle }));
  let st = { plan, photos: [] };
  assert.equal(E.checkinStatus(st, 5, '2026-09-19').status, 'upcoming');
  assert.equal(E.checkinStatus(st, 5, '2026-09-25').status, 'due');
  // With a Wednesday check-in, Thursday and Friday of the same plan week are overdue.
  assert.equal(E.checkinStatus(st, 3, '2026-09-23').status, 'due');
  assert.equal(E.checkinStatus(st, 3, '2026-09-24').status, 'overdue');
  // With a Friday check-in the plan week ends that day, so the next day it is a missed week instead.
  assert.equal(E.checkinStatus(st, 5, '2026-09-26').status, 'upcoming'); assert.deepEqual(E.checkinStatus(st, 5, '2026-09-26').missed, [1]);
  st = { plan, photos: shots(1, 3) };
  const partial = E.checkinStatus(st, 5, '2026-09-25'); assert.equal(partial.taken, 3); assert.equal(partial.status, 'due');
  st = { plan, photos: shots(1, 5) };
  assert.equal(E.checkinStatus(st, 5, '2026-09-25').status, 'done');
  // Week 3 with nothing done for weeks 1 and 2 (both Fridays have passed)
  st = { plan, photos: [] };
  const s3 = E.checkinStatus(st, 5, '2026-10-06'); assert.equal(s3.week, 3); assert.deepEqual(s3.missed, [1, 2]);
  st = { plan, photos: shots(1, 5), weights: [], meas: [] };
  assert.deepEqual(E.checkinStatus(st, 5, '2026-10-06').missed, [2]);
  // Trend lists only the weeks so far when asked
  assert.deepEqual(E.checkIns(st, 'Front', 3).map((c) => c.week), [1, 2, 3]);
});

// ---------- library clips ----------
test('cleanClip: keeps a good entry, clamps every field, and refuses anything unsafe', () => {
  const good = { id: 'c_abc123', kind: 'video', date: '2026-09-01', tag: 'Personal best', lift: 'flat_db_press', note: 'Top set', name: 'IMG_0001.MOV', size: 52428800, mtime: 1780000000000, w: 1080, h: 1920, dur: 12.34, thumb: 't_c_abc123', linked: true, review: 'Squat: keep your chest up.' };
  const r = E.cleanClip(good);
  assert.equal(r.ok, true);
  assert.equal(r.value.dur, 12.3);
  assert.equal(r.value.tag, 'Personal best');
  assert.equal(r.value.linked, true);
  assert.equal(E.cleanClip(Object.assign({}, good, { tag: 'Sneaky' })).value.tag, 'Other', 'unknown tags fall back');
  assert.equal(E.cleanClip(Object.assign({}, good, { linked: 'yes' })).value.linked, false, 'linked is strictly true');
  assert.equal(E.cleanClip(Object.assign({}, good, { note: 'x'.repeat(999) })).value.note.length, 200);
  assert.equal(E.cleanClip(Object.assign({}, good, { review: 'y'.repeat(9999) })).value.review.length, 2500);
  assert.equal(E.cleanClip(Object.assign({}, good, { dur: 1e9, w: -5, size: 'big' })).value.dur, 36000);
  assert.equal(E.cleanClip(Object.assign({}, good, { thumb: '../../x' })).value.thumb, null, 'a preview id cannot be a path');
  for (const bad of [null, [], 'x', {}, Object.assign({}, good, { id: 'A B' }), Object.assign({}, good, { kind: 'audio' }), Object.assign({}, good, { date: 'yesterday' }), Object.assign({}, good, { id: '__proto__' })]) {
    assert.equal(E.cleanClip(bad).ok, false, JSON.stringify(bad));
  }
});

test('clips come back from the event log, and a replaced or voided entry disappears', () => {
  const c = { id: 'c_1', kind: 'photo', date: '2026-09-01', tag: 'Workout', name: 'a.jpg', size: 10 };
  const ev = [
    { seq: 1, type: 'clip_added', data: c },
    { seq: 2, type: 'clip_added', data: Object.assign({}, c, { note: 'edited' }) },
    { seq: 3, type: 'event_voided', data: { target: 1 } },
    { seq: 4, type: 'clip_added', data: { id: 'BAD ID', kind: 'photo', date: '2026-09-01' } },
  ];
  const s = E.project(ev);
  assert.equal(s.clips.length, 1);
  assert.equal(s.clips[0].note, 'edited');
});

// ---------- exercise substitution ("Switch") ----------
test('substituteCandidates: same muscle group, prefers different equipment, carries over sets/reps/weight', () => {
  const orig = { name: 'Single-arm cable pulldown', muscle: 'back', equip: 'machine', sets: 3, reps: 10, kg: 40, bw: false };
  const cands = E.substituteCandidates(orig);
  assert.ok(cands.length > 0);
  for (const c of cands) {
    assert.notEqual(c.name.toLowerCase(), orig.name.toLowerCase());
    assert.equal(c.sets, 3);
    assert.equal(c.reps, 10);
    if (c.bw) assert.equal(c.kg, null);
    else assert.equal(c.kg, 40);
  }
  // Machine alternatives (same equipment as the one being avoided) should sort after non-machine ones.
  const firstMachineIdx = cands.findIndex((c) => c.equip === 'machine');
  const firstOtherIdx = cands.findIndex((c) => c.equip !== 'machine');
  if (firstMachineIdx >= 0 && firstOtherIdx >= 0) assert.ok(firstOtherIdx < firstMachineIdx);
});

test('substituteCandidates: a bodyweight original never gets a suggested weight, and an unknown muscle gets nothing', () => {
  const cands = E.substituteCandidates({ name: 'Pull-ups', muscle: 'back', sets: 3, reps: 8, kg: null, bw: true });
  assert.ok(cands.length > 0);
  for (const c of cands) assert.equal(c.kg, null);
  assert.deepEqual(E.substituteCandidates({ name: 'Mystery move', muscle: null, sets: 3, reps: 10, kg: 20, bw: false }), []);
});

test('normalizeLiftSwap: clamps a good suggestion and refuses an unsafe or nameless one', () => {
  const r = E.normalizeLiftSwap({ name: 'One-arm dumbbell row', equip: 'db', sets: 3.6, reps: 10.2, kg: 22.5, assumptions: ['Roughly similar load per side'], confidence: 'medium' });
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'One-arm dumbbell row');
  assert.equal(r.value.sets, 4);
  assert.equal(r.value.reps, 10);
  assert.equal(r.value.kg, 22.5);
  assert.equal(r.value.bw, false);

  const bw = E.normalizeLiftSwap({ name: 'Inverted row', equip: 'bw', sets: 3, reps: 12, kg: 999 });
  assert.equal(bw.ok, true);
  assert.equal(bw.value.bw, true);
  assert.equal(bw.value.kg, null, 'bodyweight ignores any kg the model sent');

  assert.equal(E.normalizeLiftSwap({ name: '', sets: 3, reps: 10 }).ok, false);
  assert.equal(E.normalizeLiftSwap(null).ok, false);
  assert.equal(E.normalizeLiftSwap(JSON.parse('{"name":"x","__proto__":{"polluted":true}}')).ok, false);
  // Out-of-range numbers fall back to sane defaults rather than failing the whole suggestion.
  const clamped = E.normalizeLiftSwap({ name: 'Leg press', sets: 0, reps: 999, kg: 5000 });
  assert.equal(clamped.ok, true);
  assert.equal(clamped.value.sets, 3);
  assert.equal(clamped.value.reps, 10);
  assert.equal(clamped.value.kg, null, 'a weight over 700 kg is dropped rather than trusted');
});

test('cleanExerciseSwitch: rebuilds a switch from a whitelist, and refuses a bad date, id or exercise', () => {
  const good = E.cleanExerciseSwitch({ date: '2026-01-06', from: 'acc_single_arm_cable_pulldown', to: { name: 'One-arm dumbbell row', sets: 3, reps: 10 } });
  assert.equal(good.ok, true);
  assert.equal(good.value.date, '2026-01-06');
  assert.equal(good.value.from, 'acc_single_arm_cable_pulldown');
  assert.equal(good.value.to.name, 'One-arm dumbbell row');

  assert.equal(E.cleanExerciseSwitch({ date: 'not-a-date', from: 'x', to: { name: 'y' } }).ok, false);
  assert.equal(E.cleanExerciseSwitch({ date: '2026-01-06', from: 'Not An Id!', to: { name: 'y' } }).ok, false, 'the id must be a plain identifier');
  assert.equal(E.cleanExerciseSwitch({ date: '2026-01-06', from: 'x', to: { name: '' } }).ok, false, 'a nameless exercise is refused');
  assert.equal(E.cleanExerciseSwitch(null).ok, false);
  assert.equal(E.cleanExerciseSwitch(JSON.parse('{"date":"2026-01-06","from":"x","to":{"name":"y"},"__proto__":{"polluted":true}}')).ok, false);
});

test('exSwitchFor and project(): a switch applies only to its own date and id, and voiding it removes it', () => {
  const plan = E.buildPlan(answers());
  const events = [
    { seq: 1, ts: 't', type: 'profile_created', data: { profile: {}, plan } },
    { seq: 2, ts: 't', type: 'exercise_switched', data: { date: '2026-01-06', from: 'acc_x', to: { name: 'Push-up', sets: 3, reps: 15, bw: true } } },
  ];
  const st = E.project(events);
  assert.equal(E.exSwitchFor(st, '2026-01-06', 'acc_x').to.name, 'Push-up');
  assert.equal(E.exSwitchFor(st, '2026-01-07', 'acc_x'), null, 'a different date has no switch');
  assert.equal(E.exSwitchFor(st, '2026-01-06', 'acc_y'), null, 'a different exercise has no switch');
  const voided = E.project(events.concat([{ seq: 3, ts: 't', type: 'event_voided', data: { target: 2 } }]));
  assert.equal(E.exSwitchFor(voided, '2026-01-06', 'acc_x'), null, 'voiding the switch removes it');
});

test('cleanPhotoAlign: rebuilds a drag/zoom alignment from a whitelist, clamping out-of-range numbers and refusing a bad id', () => {
  const good = E.cleanPhotoAlign({ id: 'p_3_front_abc123', dx: 0.2, dy: -0.1, scale: 1.5 });
  assert.equal(good.ok, true);
  assert.equal(good.value.id, 'p_3_front_abc123');
  assert.equal(good.value.dx, 0.2);
  assert.equal(good.value.dy, -0.1);
  assert.equal(good.value.scale, 1.5);

  const clamped = E.cleanPhotoAlign({ id: 'p_3_front_abc123', dx: 9, dy: -9, scale: 99 });
  assert.equal(clamped.ok, true);
  assert.equal(clamped.value.dx, 1, 'dx is clamped to the [-1, 1] fraction range');
  assert.equal(clamped.value.dy, -1);
  assert.equal(clamped.value.scale, 4, 'scale is clamped to [1, 4]');

  const dflt = E.cleanPhotoAlign({ id: 'p_3_front_abc123' });
  assert.equal(dflt.ok, true);
  assert.equal(dflt.value.dx, 0, 'a missing number falls back to the neutral default');
  assert.equal(dflt.value.scale, 1);

  assert.equal(E.cleanPhotoAlign({ id: 'Not An Id!' }).ok, false, 'the id must be a plain media id');
  assert.equal(E.cleanPhotoAlign(null).ok, false);
  assert.equal(E.cleanPhotoAlign(JSON.parse('{"id":"p_3","__proto__":{"polluted":true}}')).ok, false);
});

test('photoAlignFor and project(): an alignment is keyed by photo id, defaults to neutral, and voiding removes it', () => {
  const plan = E.buildPlan(answers());
  const events = [
    { seq: 1, ts: 't', type: 'profile_created', data: { profile: {}, plan } },
    { seq: 2, ts: 't', type: 'photo_aligned', data: { id: 'p_1_front_a', dx: 0.1, dy: 0.2, scale: 2 } },
  ];
  const st = E.project(events);
  assert.equal(E.photoAlignFor(st, 'p_1_front_a').scale, 2);
  assert.deepEqual(E.photoAlignFor(st, 'p_9_front_z'), { id: 'p_9_front_z', dx: 0, dy: 0, scale: 1 }, 'an unsaved photo gets the neutral default');
  // A later save for the same photo overwrites, last-write-wins, rather than appending.
  const updated = E.project(events.concat([{ seq: 3, ts: 't', type: 'photo_aligned', data: { id: 'p_1_front_a', dx: 0, dy: 0, scale: 3 } }]));
  assert.equal(E.photoAlignFor(updated, 'p_1_front_a').scale, 3);
  const voided = E.project(events.concat([{ seq: 3, ts: 't', type: 'event_voided', data: { target: 2 } }]));
  assert.equal(E.photoAlignFor(voided, 'p_1_front_a').scale, 1, 'voiding the alignment restores the neutral default');
});

test('normalizePhotoAlign: clamps an AI-suggested pan/zoom, needs no id, and falls back on junk', () => {
  const good = E.normalizePhotoAlign({ dx: 0.3, dy: -0.2, scale: 2, assumptions: ['Shifted right to match framing.'], confidence: 'high' });
  assert.equal(good.ok, true);
  assert.equal(good.value.dx, 0.3);
  assert.equal(good.value.dy, -0.2);
  assert.equal(good.value.scale, 2);
  assert.equal(good.value.confidence, 'high');
  assert.equal(good.value.assumptions.length, 1);

  const clamped = E.normalizePhotoAlign({ dx: -9, dy: 9, scale: 100, confidence: 'nonsense' });
  assert.equal(clamped.ok, true);
  assert.equal(clamped.value.dx, -1);
  assert.equal(clamped.value.dy, 1);
  assert.equal(clamped.value.scale, 4);
  assert.equal(clamped.value.confidence, 'medium', 'an unrecognised confidence falls back to medium');

  const dflt = E.normalizePhotoAlign({});
  assert.equal(dflt.ok, true);
  assert.equal(dflt.value.dx, 0);
  assert.equal(dflt.value.scale, 1);
  assert.deepEqual(dflt.value.assumptions, []);

  assert.equal(E.normalizePhotoAlign(null).ok, false);
  assert.equal(E.normalizePhotoAlign(JSON.parse('{"dx":0,"__proto__":{"polluted":true}}')).ok, false);
});

// ---------- water: goal, logging and the pacing nudge ----------
test('waterGoalMl: body weight sets the baseline, and training minutes add a capped extra', () => {
  const plan = E.buildPlan(answers());
  const st = E.project([{ seq: 1, ts: 't', type: 'profile_created', data: { profile: { weightKg: 80 }, plan } }]);
  eqGoal(E.waterGoalMl(st, '2026-01-06'), 80 * 35);
  const withWorkout = Object.assign({}, st, { workouts: [{ date: '2026-01-06', mins: 45, type: 'strength' }] });
  eqGoal(E.waterGoalMl(withWorkout, '2026-01-06'), 80 * 35 + 45 * 12);
  const longWorkout = Object.assign({}, st, { workouts: [{ date: '2026-01-06', mins: 400, type: 'running' }] });
  eqGoal(E.waterGoalMl(longWorkout, '2026-01-06'), 80 * 35 + 1500, 'the activity extra is capped');
  function eqGoal(actual, expected, msg) { assert.ok(Math.abs(actual - Math.round(expected / 50) * 50) <= 1, (msg || 'goal') + ': got ' + actual); }
});

test('dayWaterMl and project(): only today\'s valid entries are counted, voided or malformed ones are dropped', () => {
  const ev = [
    { seq: 1, ts: 't', type: 'water_logged', data: { date: '2026-01-06', ml: 250 } },
    { seq: 2, ts: 't', type: 'water_logged', data: { date: '2026-01-06', ml: 350 } },
    { seq: 3, ts: 't', type: 'water_logged', data: { date: '2026-01-07', ml: 500 } }, // a different day
    { seq: 4, ts: 't', type: 'water_logged', data: { date: 'not-a-date', ml: 250 } }, // bad date, dropped
    { seq: 5, ts: 't', type: 'water_logged', data: { date: '2026-01-06', ml: 999999 } }, // absurd amount, dropped
    { seq: 6, ts: 't', type: 'event_voided', data: { target: 2 } },
  ];
  const s = E.project(ev);
  assert.equal(s.water.length, 2, JSON.stringify(s.water));
  assert.equal(E.dayWaterMl(s, '2026-01-06'), 250, 'the voided 350 ml entry does not count');
  assert.equal(E.dayWaterMl(s, '2026-01-07'), 500);
  assert.equal(E.dayWaterMl(s, '2026-01-08'), 0);
});

test('waterExpectedMl: zero before the waking window, the whole goal after, and half at the midpoint', () => {
  const goal = 3000;
  assert.equal(E.waterExpectedMl(goal, 6), 0);
  assert.equal(E.waterExpectedMl(goal, 22), goal);
  assert.equal(E.waterExpectedMl(goal, 23), goal, 'never goes past the goal');
  const mid = (E.WATER_WAKE_HOUR + E.WATER_SLEEP_HOUR) / 2;
  assert.equal(E.waterExpectedMl(goal, mid), Math.round(goal / 2));
});

test('volUnitFor and fmtVol/mlToUnit/unitToMl: auto follows body weight unit, an explicit choice wins, and formatting round-trips', () => {
  assert.equal(E.volUnitFor({ bodyUnit: 'kg' }), 'ml');
  assert.equal(E.volUnitFor({ bodyUnit: 'lb' }), 'oz');
  assert.equal(E.volUnitFor({ bodyUnit: 'lb', waterUnit: 'ml' }), 'ml', 'an explicit choice overrides the body-weight fallback');
  assert.equal(E.fmtVol(250, 'ml'), '250 ml');
  assert.equal(E.fmtVol(1500, 'ml'), '1.5 L');
  assert.equal(E.fmtVol(500, 'oz'), Math.round(500 / 29.5735) + ' fl oz');
  assert.ok(Math.abs(E.unitToMl(E.mlToUnit(2000, 'oz'), 'oz') - 2000) < 1);
});

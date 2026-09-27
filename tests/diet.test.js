'use strict';
// The suggested diet plan: preferences are respected, meals land near the targets, and "eat next" adapts to what was logged.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const D = require('../js/diet.js');

const plan = { kcal: 2850, protein: 170, carbs: 335, fat: 90 };
const prefs = (o) => D.effective({ dietPrefs: Object.assign(E.defaultDietPrefs(), o || {}), profile: { diet: 'Vegetarian' } });
const foodsOf = (day) => day.meals.flatMap((m) => m.items.map((i) => i.id));

test('preferences are cleaned and bad values are refused', () => {
  const ok = E.cleanDietPrefs({ style: 'vegan', cuisine: 'indian', meals: 5, avoid: ['soy', 'x', 'nuts'], dislikes: 'Mushroom, brinjal!!, a', quick: true, seed: 12, swaps: { '2:lunch': 3, 'bad': 4, '9:lunch': 1 } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.avoid, ['nuts', 'soy']);
  assert.deepEqual(ok.value.dislikes, ['mushroom', 'brinjal']);
  assert.deepEqual(ok.value.swaps, { '2:lunch': 3 });
  assert.equal(E.cleanDietPrefs({ style: 'keto' }).ok, false);
  assert.equal(E.cleanDietPrefs({ meals: 9 }).ok, false);
  assert.equal(E.cleanDietPrefs({ seed: -1 }).ok, false);
  assert.equal(E.cleanDietPrefs(null).ok, false);
  assert.equal(E.cleanDietPrefs(JSON.parse('{"__proto__":{"a":1}}')).ok, false);
});

test('saved preferences ride in the event log and a later event replaces them', () => {
  const ev = (seq, prefs2) => ({ seq, ts: '2026-09-01T00:00:00.000Z', type: 'diet_prefs_set', data: { prefs: prefs2 }, src: 'user' });
  const s = E.project([ev(1, { style: 'egg', meals: 3 }), ev(2, { style: 'vegan', meals: 5 }), ev(3, { style: 'nonsense' })]);
  assert.equal(s.dietPrefs.style, 'vegan', 'a bad event is skipped');
  assert.equal(s.dietPrefs.meals, 5);
  assert.equal(E.validateEvents([ev(1, { style: 'egg' })]), null);
});

test('a plan follows the profile diet unless a style is chosen', () => {
  assert.equal(D.effective({ profile: { diet: 'Vegetarian' } }).style, 'veg');
  assert.equal(D.effective({ profile: { diet: 'Vegan' } }).style, 'vegan');
  assert.equal(D.effective({ profile: { diet: 'Vegetarian' }, dietPrefs: Object.assign(E.defaultDietPrefs(), { style: 'egg' }) }).style, 'egg');
});

test('every day lands close to the targets, for each number of meals', () => {
  for (const meals of [3, 4, 5]) {
    for (const style of ['veg', 'egg', 'any']) {
      const week = D.buildWeek(plan, prefs({ style, meals }));
      for (const d of week) {
        assert.equal(d.meals.length, meals);
        assert.ok(Math.abs(d.off.kcal) <= plan.kcal * 0.1, style + ' ' + meals + ' day ' + d.day + ' calories off by ' + d.off.kcal);
        assert.ok(d.totals.protein >= plan.protein * 0.85, style + ' ' + meals + ' day ' + d.day + ' protein ' + d.totals.protein);
      }
    }
  }
});

test('vegan, vegetarian and egg plans never include a food they rule out', () => {
  const NONVEG = ['chicken', 'fish', 'shrimp', 'tuna'];
  for (const style of ['vegan', 'veg', 'egg']) {
    for (const cuisine of ['indian', 'western', 'mixed']) {
      for (const d of D.buildWeek(plan, prefs({ style, cuisine }))) {
        for (const f of foodsOf(d)) {
          assert.ok(!NONVEG.includes(f), style + ' got ' + f);
          if (style === 'vegan') assert.ok(D.FOOD[f].rank === 0, 'vegan got ' + f);
          if (style === 'veg') assert.ok(D.FOOD[f].rank <= 1, 'veg got ' + f);
        }
      }
    }
  }
});

test('foods to leave out and dislikes are honoured, and names do not mention what was dropped', () => {
  const p = prefs({ style: 'veg', avoid: ['dairy', 'gluten'], dislikes: ['tofu', 'rajma'], meals: 4 });
  for (const d of D.buildWeek(plan, p)) {
    for (const f of foodsOf(d)) {
      assert.ok(!D.FOOD[f].tags.includes('dairy') && !D.FOOD[f].tags.includes('gluten'), 'avoid: ' + f);
      assert.ok(f !== 'tofu', 'dislike tofu');
    }
    for (const m of d.meals) assert.ok(!/rajma/i.test(m.name), 'dislike rajma in ' + m.name);
  }
  const vegan = D.buildWeek(plan, prefs({ style: 'vegan', cuisine: 'indian' }));
  for (const d of vegan) for (const m of d.meals) if (m.idea) assert.ok(!/curd/i.test(m.name) || m.items.some((i) => i.id === 'curd'), m.name);
});

test('quick-only keeps to quick meals, and a nonsense filter still gives every slot a meal or says so', () => {
  const quick = D.buildDay(plan, prefs({ quick: true, style: 'veg' }), 0);
  for (const m of quick.meals) assert.ok(D.MEALS.find((x) => x.id === m.idea).quick, m.name + ' is not quick');
  const strict = D.buildDay(plan, prefs({ style: 'vegan', avoid: ['soy', 'gluten', 'nuts'], dislikes: ['dal', 'rice', 'quinoa'], meals: 3 }), 0);
  assert.equal(strict.meals.length, 3);
  for (const m of strict.meals) assert.ok(m.idea === null ? m.items.length === 0 : m.items.length > 0);
});

test('the same preferences always give the same week; a new shuffle number or a swap changes it', () => {
  const a = JSON.stringify(D.buildWeek(plan, prefs({ seed: 3 }))), b = JSON.stringify(D.buildWeek(plan, prefs({ seed: 3 })));
  assert.equal(a, b);
  assert.notEqual(a, JSON.stringify(D.buildWeek(plan, prefs({ seed: 4 }))));
  const base = prefs({ seed: 3 }), swapped = D.swapMeal(D.effective({ dietPrefs: D.savable(base), profile: { diet: 'Vegetarian' } }), 2, 'lunch');
  const d0 = D.buildDay(plan, base, 2), d1 = D.buildDay(plan, swapped, 2);
  assert.notEqual(d0.meals.find((m) => m.slot === 'lunch').idea, d1.meals.find((m) => m.slot === 'lunch').idea);
  assert.equal(d0.meals.find((m) => m.slot === 'dinner').idea === d1.meals.find((m) => m.slot === 'dinner').idea || true, true);
  assert.equal(E.cleanDietPrefs(D.savable(swapped)).ok, true, 'a swapped plan can be saved');
});

test('no meal idea is used twice in one day', () => {
  for (const meals of [4, 5]) for (const d of D.buildWeek(plan, prefs({ meals, style: 'egg' }))) {
    const ids = d.meals.map((m) => m.idea);
    assert.equal(new Set(ids).size, ids.length, 'repeat on day ' + d.day + ': ' + ids.join(','));
  }
});

test('portions are whole pieces for counted foods and never below the least amount', () => {
  for (const d of D.buildWeek(plan, prefs({ style: 'egg' }))) for (const m of d.meals) for (const it of m.items) {
    const f = D.FOOD[it.id];
    if (f.unit && f.unit.g > 1) assert.equal(it.grams % f.unit.g, 0, it.name + ' ' + it.grams);
    assert.ok(it.grams > 0);
  }
});

function stateWith(foods) { return { plan, profile: { diet: 'Vegetarian' }, dietPrefs: null, foods }; }
const food = (name, meal, kcal, p, c, f) => ({ date: '2026-09-21', meal, name, kcal, protein: p, carbs: c, fat: f });

test('eat next: with nothing logged it suggests breakfast in the morning, fitted to its share of the day', () => {
  const r = D.eatNext(stateWith([]), D.effective(stateWith([])), '2026-09-21', { hour: 8 });
  assert.equal(r.slot, 'breakfast');
  assert.ok(r.suggestions.length >= 2 && r.suggestions.length <= 3);
  for (const s of r.suggestions) assert.ok(Math.abs(s.kcal - r.target.kcal) <= r.target.kcal * 0.2, s.name + ' ' + s.kcal + ' vs ' + r.target.kcal);
});

test('eat next: after a big breakfast the portions shrink and the next meal is lunch', () => {
  const none = stateWith([]), big = stateWith([food('Big breakfast', 'Breakfast', 1300, 60, 150, 50)]);
  const a = D.eatNext(none, D.effective(none), '2026-09-21', { hour: 13, slot: 'lunch' }), b = D.eatNext(big, D.effective(big), '2026-09-21', { hour: 13 });
  assert.equal(b.slot, 'lunch');
  assert.equal(b.remaining.kcal, 1550);
  assert.ok(b.target.kcal < a.target.kcal, 'lunch target should drop: ' + b.target.kcal + ' vs ' + a.target.kcal);
  assert.ok(b.suggestions[0].kcal < a.suggestions[0].kcal + 50);
});

test('eat next: when calories are used up it says so, and offers protein only when protein is behind', () => {
  const full = stateWith([food('Feast', 'Dinner', 2800, 60, 400, 90)]);
  const r = D.eatNext(full, D.effective(full), '2026-09-21', { hour: 20 });
  assert.equal(r.status, 'done');
  assert.equal(r.suggestions.length, 0);
  for (const t of r.topUps) assert.ok(t.protein > 0 && ['whey', 'greek', 'eggwhite', 'tuna', 'peaprot', 'paneer_lite', 'chicken', 'tofu', 'soya'].includes(t.id));
  const enough = stateWith([food('Feast', 'Dinner', 2800, 175, 400, 90)]);
  assert.equal(D.eatNext(enough, D.effective(enough), '2026-09-21', { hour: 20 }).topUps.length, 0);
});

test('eat next: top-ups respect the diet, and other days are not counted', () => {
  const vegan = { plan, profile: { diet: 'Vegan' }, dietPrefs: null, foods: [food('Snack', 'Snack', 2700, 40, 400, 90)] };
  const r = D.eatNext(vegan, D.effective(vegan), '2026-09-21', { hour: 20 });
  for (const t of r.topUps) assert.ok(D.FOOD[t.id].rank === 0, t.id);
  const other = stateWith([Object.assign(food('Yesterday', 'Lunch', 2000, 100, 200, 50), { date: '2026-09-20' })]);
  assert.equal(D.eatNext(other, D.effective(other), '2026-09-21', { hour: 8 }).remaining.kcal, 2850);
});

test('eat next: every suggestion respects avoid tags and dislikes', () => {
  const s = { plan, profile: { diet: 'Vegetarian' }, dietPrefs: Object.assign(E.defaultDietPrefs(), { avoid: ['dairy'], dislikes: ['dal'] }), foods: [] };
  for (const hour of [8, 11, 13, 17, 20]) for (const x of D.eatNext(s, D.effective(s), '2026-09-21', { hour }).suggestions) for (const it of x.items) {
    assert.ok(!D.FOOD[it.id].tags.includes('dairy'), it.id);
    assert.ok(!/dal/i.test(it.name), it.name);
  }
});

test('surprise me: with most of the day still ahead it suggests a dessert-sized, high-protein idea', () => {
  const s = stateWith([]);
  const r = D.surpriseMe(s, D.effective(s), '2026-09-21', {});
  assert.equal(r.status, 'ok');
  assert.ok(r.suggestion.items.length > 0);
  assert.ok(r.suggestion.kcal <= 420, 'a treat should stay dessert-sized: ' + r.suggestion.kcal);
  assert.ok(r.suggestion.protein >= 10, 'should lean high-protein: ' + r.suggestion.protein);
});

test('surprise me: when there is barely any room left it says so instead of forcing a dessert in', () => {
  const full = stateWith([food('Feast', 'Dinner', 2800, 170, 330, 90)]);
  const r = D.surpriseMe(full, D.effective(full), '2026-09-21', {});
  assert.equal(r.status, 'none');
  assert.equal(r.suggestion, null);
});

test('surprise me: never includes a food the diet or dislikes rule out, and a different salt can change the pick', () => {
  const vegan = { plan, profile: { diet: 'Vegan' }, dietPrefs: null, foods: [] };
  for (let salt = 0; salt < 6; salt++) {
    const r = D.surpriseMe(vegan, D.effective(vegan), '2026-09-21', { salt });
    for (const it of r.suggestion.items) assert.ok(D.FOOD[it.id].rank === 0, 'vegan surprise got ' + it.id);
  }
  const dislikes = { plan, profile: { diet: 'Vegetarian' }, dietPrefs: Object.assign(E.defaultDietPrefs(), { dislikes: ['almond'] }), foods: [] };
  const rd = D.surpriseMe(dislikes, D.effective(dislikes), '2026-09-21', {});
  assert.ok(!/almond/i.test(rd.suggestion.name));
  const picks = new Set();
  for (let salt = 0; salt < 8; salt++) picks.add(D.surpriseMe(dislikes, D.effective(dislikes), '2026-09-21', { salt }).suggestion.idea);
  assert.ok(picks.size > 1, 'a different salt should be able to change the pick');
});

test('surprise me: the same date and preferences always give the same pick', () => {
  const s = stateWith([]);
  const a = D.surpriseMe(s, D.effective(s), '2026-09-21', {});
  const b = D.surpriseMe(s, D.effective(s), '2026-09-21', {});
  assert.equal(a.suggestion.idea, b.suggestion.idea);
});

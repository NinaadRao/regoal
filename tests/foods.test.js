'use strict';
// Checks the food database: the builder's diet tags and parsing, the app's loader and search, and the shipped data file itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Foods = require('../js/foods.js');

const DATA = path.join(__dirname, '..', 'data', 'foods.json');
const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const build = () => import('../scripts/build-foods.mjs');

test('diet tags: plants are veg, eggs are egg, meat, fish and gelatin are non-veg', async () => {
  const { classifyUsda } = await build();
  const veg = ['Lentils, raw', 'Cheese, cheddar', 'Tofu, raw, firm, prepared with calcium sulfate', 'Bread, chapati or roti, plain', 'Almonds', 'Bacon, meatless', 'Egg substitute, powder', 'Sausage, meatless', 'Beans, black turtle, mature seeds, raw', 'Squash, summer, scallop, raw', 'Nuts, coconut meat, raw', 'Pickle relish, hot dog', 'Rolls, hamburger or hotdog, plain', 'Cereals, QUAKER, Instant Oatmeal, DINOSAUR EGGS, Brown Sugar', 'Pasta, homemade, made without egg, cooked', 'Snacks, rice cakes, brown rice, buckwheat'];
  for (const n of veg) assert.equal(classifyUsda(n, ''), 0, n);
  const egg = ['Egg, whole, raw, fresh', 'Egg, duck, whole, fresh, raw', 'Cake, white, prepared from recipe with coconut frosting', 'Noodles, egg, cooked', 'Mayonnaise, regular', 'Custard, dry mix', 'Cookies, molasses'];
  for (const n of egg) assert.equal(classifyUsda(n, ''), 1, n);
  const meat = ['Beef, ground, 85% lean meat / 15% fat, raw', 'Pork, fresh, loin, raw', 'Chicken, broilers or fryers, breast, raw', 'Fish, salmon, Atlantic, farmed, raw', 'Shrimp, mixed species, raw', 'Gelatin desserts, dry mix', 'Gelatins, dry powder, unsweetened', 'Lard', 'Sauce, worcestershire', 'Soup, chicken mushroom, canned, prepared with equal volume water', 'Restaurant, Chinese, fried rice, with pork', 'Hamburger, single, regular patty', 'Salisbury steak with gravy, frozen'];
  for (const n of meat) assert.equal(classifyUsda(n, ''), 2, n);
  assert.equal(classifyUsda('Anything at all', 'Liha ja linnuliha'), 2, 'the meat category wins');
  assert.equal(classifyUsda('Whatever', 'Munad'), 1, 'the egg category is egg');
});

test('diet tags: restaurant food, canned soup and ready meals are "check the label"', async () => {
  const { classifyUsda } = await build();
  for (const n of ['PIZZA HUT 14" Cheese Pizza, Pan Crust', "WENDY'S, French Fries", 'Fast foods, breadstick, soft', 'Restaurant, Italian, spaghetti with marinara sauce', 'Gravy, dry', 'Soup, onion, canned, condensed', 'Macaroni and Cheese, canned entree']) assert.equal(classifyUsda(n, n.startsWith('Soup') ? 'Supid' : ''), 3, n);
  assert.equal(classifyUsda('SILK Blueberry soy yogurt', ''), 0, 'plant milks and tofu with a brand are fine');
});

test('IFCT groups decide their tag, so a mushroom called chicken mushroom stays veg', async () => {
  const { classifyIfct } = await build();
  assert.equal(classifyIfct('Mushrooms'), 0);
  assert.equal(classifyIfct('Milk and Milk Products'), 0);
  assert.equal(classifyIfct('Egg and Egg Products'), 1);
  for (const g of ['Poultry', 'Animal Meat', 'Marine Fish', 'Fresh Water Fish and Shellfish', 'Marine Shellfish', 'Marine Mollusks']) assert.equal(classifyIfct(g), 2, g);
});

test('CSV parser handles quotes, commas and newlines inside fields', async () => {
  const { parseCsv } = await build();
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\n1,2,3\r\n'), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('x,"line1\nline2"\n'), [['x', 'line1\nline2']]);
});

test('IFCT local names keep only English and Hindi', async () => {
  const { localNames } = await build();
  assert.equal(localNames('A. Moricha guti; E. Pearl millet; H. Ramdana; Kan. Danthu beeja; Tam. Thandu keerai'), 'pearl millet ramdana');
  assert.equal(localNames('A., Kash. Baajra; H. Bajra'), 'bajra');
});

test('builders skip rows that are unsourced, impossible, or baby food', async () => {
  const { buildFromUsda } = await build();
  const r = buildFromUsda([
    { name: 'Egg, whole', category: 'Munad', kcal_per_100g: 143, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5, fiber_g: 0, source: 'usda_sr_legacy' },
    { name: 'Curated dish', category: 'Eesti toidud', kcal_per_100g: 100, protein_g: 5, carbs_g: 10, fat_g: 3, source: null },
    { name: 'Impossible', category: 'x', kcal_per_100g: 5000, protein_g: 5, carbs_g: 10, fat_g: 3, source: 'usda_sr_legacy' },
    { name: 'Babyfood, apples', category: 'x', kcal_per_100g: 50, protein_g: 0, carbs_g: 12, fat_g: 0, source: 'usda_sr_legacy' },
    { name: 'No macros', category: 'x', kcal_per_100g: 50, source: 'usda_sr_legacy' },
  ]);
  assert.deepEqual(r.map((x) => x[0]), ['Egg, whole']);
  assert.equal(r[0][1], 1);
});

test('the loader rejects damaged data and skips bad rows instead of trusting them', () => {
  assert.throws(() => Foods.parseDb({ v: 2, foods: [] }));
  assert.throws(() => Foods.parseDb({ v: 1, foods: [['x']] }), /empty/);
  const good = Array.from({ length: 120 }, (_, i) => ['Food ' + i, 0, 100, 5, 10, 3, 1, 0, '']);
  const list = Foods.parseDb({ v: 1, foods: good.concat([['Bad kcal', 0, 99999, 1, 1, 1, 0, 0, ''], ['Bad diet', 9, 100, 1, 1, 1, 0, 0, ''], [123, 0, 1, 1, 1, 1, 0, 0, ''], ['Neg', 0, 100, -1, 1, 1, 0, 0, ''], null, 'text'])});
  assert.equal(list.length, 120);
});

test('the shipped food file loads completely and covers what a lifter eats', () => {
  const list = Foods.parseDb(raw);
  assert.equal(list.length, raw.foods.length, 'no row was rejected');
  assert.ok(list.length > 7000, 'thousands of foods: ' + list.length);
  const by = [0, 0, 0, 0]; for (const f of list) by[f.diet]++;
  assert.ok(by[0] > 3000 && by[1] > 200 && by[2] > 2000, 'vegetarian, egg and non-veg all present: ' + by);
  const find = (n) => list.find((f) => f.name === n);
  const egg = find('Egg, whole, raw, fresh'); assert.deepEqual([egg.kcal, egg.protein, egg.carbs, egg.fat], [143, 12.6, 0.7, 9.5]); // USDA reference values
  const lentil = find('Lentils, raw'); assert.deepEqual([lentil.kcal, lentil.protein, lentil.fat], [352, 24.6, 1.1]);
  assert.ok(list.every((f) => f.src === 0), 'the bundled list is USDA only; source 1 is reserved for a person\'s own list');
  assert.ok(raw.sources.length === 1 && raw.sources[0].id === 'usda');
  assert.equal(find('Butter oil, anhydrous').kcal, 876, 'fats carry their energy value');
  assert.ok(Foods.parseDb(raw).find((f) => f.name === 'Butter oil, anhydrous').alias.includes('ghee'), 'ghee finds butter oil');
});

test('no vegetarian-tagged food names meat, fish or gelatin, apart from the plant-based ones', () => {
  const meaty = /\b(beef|veal|pork|bacon|ham|lamb|chicken|turkey|duck|sausage|salami|pepperoni|fish|salmon|tuna|shrimp|prawn|crab|lobster|oyster|clam|squid|gelatin\w*|lard|tallow)\b/i;
  const plant = /(meatless|vegetarian|vegan|substitute|mushroom|analog|veggie|imitation|crabapple|oyster mushroom|vegetable oyster|hamburger (roll|bun)|hot ?dog (roll|bun)|rolls?, ham|fish-shaped|pickle relish|goldfish|fishing|sausage, meatless)/i;
  const bad = raw.foods.filter((f) => f[1] === 0 && meaty.test(f[0]) && !plant.test(f[0])).map((f) => f[0]);
  assert.deepEqual(bad, []);
});

test('search ranks the food you meant first', () => {
  Foods.useDb(Foods.parseDb(raw));
  const top = (q, opts) => Foods.search(q, Object.assign({ limit: 3 }, opts)).map((f) => f.name);
  assert.equal(top('almonds')[0], 'Almonds'); // the short home-style entry first
  assert.ok(top('almonds').includes('Nuts, almonds'));
  assert.ok(top('mutton', { limit: 10 }).some((n) => /^(Goat|Sheep|Lamb)/.test(n)), 'everyday Indian word finds goat and sheep');
  assert.ok(top('bhindi').some((n) => /okra|ladies finger/i.test(n)));
  assert.ok(top('atta').some((n) => /^Wheat flour, whole/.test(n)), 'atta finds whole wheat flour');
  assert.ok(top('moong dal').some((n) => /green gram|mung/i.test(n)));
  assert.equal(Foods.search('zzzzzz', { limit: 5 }).length, 0);
  assert.equal(Foods.search('', { limit: 5 }).length, 0);
});

test('the diet filters: Veg hides meat and egg, Veg + egg keeps egg, Non-veg shows only meat and fish', () => {
  Foods.useDb(Foods.parseDb(raw));
  const kinds = (q, diet) => new Set(Foods.search(q, { diet, limit: 200 }).map((f) => f.diet));
  assert.deepEqual([...kinds('egg', 'veg')].sort(), [0]);
  assert.deepEqual([...kinds('egg', 'egg')].sort(), [0, 1]);
  assert.deepEqual([...kinds('chicken', 'nonveg')].sort(), [2]);
  assert.equal(Foods.search('salmon', { diet: 'veg' }).length, 0);
  assert.ok(Foods.search('salmon', { diet: 'nonveg' }).length > 5);
  assert.ok(Foods.search('salmon', { diet: 'all' }).length > 5);
  assert.ok(Foods.search('pizza', { diet: 'all', limit: 100 }).some((f) => f.diet === 3), 'ready-made pizza is marked check the label');
  assert.equal(Foods.search('pizza', { diet: 'veg', limit: 100 }).filter((f) => f.diet === 3).length, 0, 'and hidden from Veg');
  assert.equal(Foods.dietFor('Vegetarian'), 'veg');
  assert.equal(Foods.dietFor('Eggetarian'), 'egg');
  assert.equal(Foods.dietFor('Anything'), 'all');
  assert.equal(Foods.dietFor(''), 'all');
});

test('amounts scale from per 100 g', () => {
  assert.deepEqual(Foods.scale({ kcal: 208, protein: 20.4, carbs: 0, fat: 13.4 }, 150), { kcal: 312, protein: 30.6, carbs: 0, fat: 20.1 });
  assert.deepEqual(Foods.scale({ kcal: 100, protein: 10, carbs: 10, fat: 1 }, 0), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
});

test('recents: carries an AI entry\'s ingredient breakdown forward, so reusing it does not lose it', () => {
  const ai = { items: [{ name: 'Rajma, cooked', qty: '1 cup', kcal: 225, protein: 15, carbs: 40, fat: 1 }], assumptions: ['One cup'], confidence: 'medium' };
  const foods = [
    { seq: 1, name: 'Plain rice', kcal: 200, protein: 4, carbs: 45, fat: 0, meal: 'Lunch' },
    { seq: 2, name: 'Rajma chawal', kcal: 430, protein: 19, carbs: 85, fat: 1, meal: 'Lunch', ai },
  ];
  const r = Foods.recents(foods, 6);
  const rajma = r.find((f) => f.name === 'Rajma chawal');
  assert.ok(rajma, 'the AI entry is in recents');
  assert.deepEqual(rajma.ai, ai, 'its ingredient breakdown comes along, unchanged');
  const plain = r.find((f) => f.name === 'Plain rice');
  assert.equal(plain.ai, null, 'an entry logged without AI has no breakdown to carry');
});

test('the loader fetches once and keeps the result', async () => {
  let calls = 0;
  const fetcher = () => { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }); };
  // a fresh module instance so earlier tests have not already loaded the list
  delete require.cache[require.resolve('../js/foods.js')];
  const F2 = require('../js/foods.js');
  assert.equal(F2.ready(), false);
  const a = await F2.load(fetcher), b = await F2.load(fetcher);
  assert.equal(calls, 1); assert.equal(a, b); assert.equal(F2.ready(), true);
  delete require.cache[require.resolve('../js/foods.js')];
  const F3 = require('../js/foods.js');
  await assert.rejects(() => F3.load(() => Promise.resolve({ ok: false })), /could not be loaded/);
  assert.equal(F3.ready(), false, 'a failure can be retried');
});

// ---------- the person's own list ----------
const CSV = fs.readFileSync(path.join(__dirname, '..', 'docs', 'food-import-example.csv'), 'utf8');

test('own list: the example CSV reads completely and diets map from words', () => {
  const r = Foods.parseImport(CSV, 'food-import-example.csv');
  assert.equal(r.rows.length, 6); assert.equal(r.skipped, 0); assert.equal(r.name, 'food-import-example');
  assert.deepEqual(r.rows.map((x) => x[1]), [0, 0, 0, 1, 2, 3]);
  assert.deepEqual(r.rows[0], ['Example millet flour', 0, 361, 11.5, 67.5, 5, 11.5, 'bajra']);
});

test('own list: JSON in both shapes, string or number values, and unknown diet means check the label', () => {
  const a = Foods.parseImport(JSON.stringify({ orbitFoods: 1, name: 'Mine', foods: [{ name: 'A', kcal: '100', protein: 5, carbs: 10, fat: 2, diet: 'Veg' }, { name: 'B', kcal: 50, protein: 1, carbs: 1, fat: 1, diet: 'vegan?', aliases: ['x', 'y'] }] }));
  assert.equal(a.name, 'Mine'); assert.deepEqual(a.rows.map((x) => x[1]), [0, 3]); assert.equal(a.rows[1][7], 'x y'); assert.equal(a.rows[0][6], 0, 'fibre defaults to 0');
  const b = Foods.parseImport('[{"name":"C","kcal":1,"protein":0,"carbs":0,"fat":0}]', 'c.json');
  assert.equal(b.name, 'c'); assert.equal(b.rows.length, 1);
});

test('own list: bad rows are skipped and counted, and useless files are refused with a reason', () => {
  const r = Foods.parseImport('name,kcal,protein,carbs,fat\nOk,100,5,5,5\n,100,5,5,5\nHuge,5000,5,5,5\nText,abc,1,1,1\nNeg,10,-1,1,1\n', 'x.csv');
  assert.equal(r.rows.length, 1); assert.equal(r.skipped, 4); assert.ok(r.why.length >= 3);
  assert.throws(() => Foods.parseImport('', 'x.csv'), /empty/);
  assert.throws(() => Foods.parseImport('name,kcal\nA,1\n', 'x.csv'), /Missing: protein/);
  assert.throws(() => Foods.parseImport('{"foods": 3}'), /No list of foods/);
  assert.throws(() => Foods.parseImport('[{"name":"x","kcal":9999,"protein":1,"carbs":1,"fat":1}]'), /No usable foods/);
  assert.throws(() => Foods.parseImport('x'.repeat(Foods.IMPORT_MAX_BYTES + 1)), /15 MB/);
});

test('own list: text is cleaned, so control characters and markup stay inert data', () => {
  const r = Foods.parseImport('[{"name":"  <img src=x onerror=alert(1)>\\u0000\\n Tea ","kcal":1,"protein":0,"carbs":0,"fat":0}]');
  assert.equal(r.rows[0][0], '<img src=x onerror=alert(1)> Tea'); // stored as text; the app only ever sets textContent
});

test('own list: useUser makes rows searchable as "My list", re-checks them, and can be cleared', () => {
  Foods.useDb(Foods.parseDb(raw));
  const r = Foods.parseImport(CSV, 'x.csv');
  assert.equal(Foods.useUser(r.rows.concat([['Broken', 9, 1, 1, 1, 1, 0, ''], ['Big', 0, 5000, 1, 1, 1, 0, ''], null, 'x']), 'My tables'), 6);
  assert.equal(Foods.userCount(), 6); assert.equal(Foods.userName(), 'My tables');
  const hit = Foods.search('bajra', { limit: 3 })[0];
  assert.equal(hit.name, 'Example millet flour'); assert.equal(hit.src, 1); assert.equal(hit.per100, true);
  assert.equal(Foods.SOURCE_LABEL[hit.src], 'My list');
  assert.equal(Foods.search('fish fillet', { diet: 'veg' }).filter((f) => f.src === 1).length, 0, 'the diet filter applies to the own list too');
  assert.equal(Foods.search('mystery snack', { diet: 'veg' }).length, 0, 'check-the-label foods hide from Veg');
  assert.equal(Foods.useUser([], ''), 0); assert.equal(Foods.userName(), '');
  assert.equal(Foods.search('bajra').filter((f) => f.src === 1).length, 0);
});

test('IFCT converter: writes an import file with word diets, and refuses to write inside the repository', async () => {
  const { toImport } = await import('../scripts/ifct-to-import.mjs');
  const { buildFromIfct } = await build();
  const hdr = 'name,grup,lang,enerc,protcnt,fatce,choavldf,fibtg';
  const pad = ',,';
  const csv = [hdr + pad, 'Test flour,Cereals and Millets,"H. Testata",1500,10,2,70,8' + pad, 'Test fish,Marine Fish,,400,20,3,0,0' + pad, 'Test egg,Egg and Egg Products,,600,12,10,1,0' + pad].join('\n');
  const rows = buildFromIfct(csv);
  const j = toImport(rows, 'Fictional');
  assert.equal(j.orbitFoods, 1); assert.deepEqual(j.foods.map((f) => f.diet), ['veg', 'nonveg', 'egg']);
  const back = Foods.parseImport(JSON.stringify(j), 'x.json');
  assert.equal(back.rows.length, 3); assert.equal(back.skipped, 0);
  const { spawnSync } = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'orbit-ifct-'));
  const inp = path.join(tmp, 'index.csv'); fs.writeFileSync(inp, csv);
  const script = path.join(__dirname, '..', 'scripts', 'ifct-to-import.mjs');
  const bad = spawnSync('node', [script, inp, '--out', path.join(__dirname, '..', 'leak.orbitfoods.json')], { encoding: 'utf8' });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /Refusing to write inside/); assert.equal(fs.existsSync(path.join(__dirname, '..', 'leak.orbitfoods.json')), false);
  const good = spawnSync('node', [script, inp, '--out', path.join(tmp, 'ifct.orbitfoods.json')], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr); assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'ifct.orbitfoods.json'), 'utf8')).foods.length, 3);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the bundled data holds no rows from the IFCT tables', () => {
  assert.ok(!/IFCT|Indian Food Composition|National Institute of Nutrition/i.test(JSON.stringify(raw.sources)));
  assert.ok(raw.foods.every((f) => f[7] === 0));
});

/*
 * Food search: a full offline database, an optional list the person loads themselves, and a short list of typical home-style dishes.
 *
 * The database is data/foods.json (about 7,200 foods per 100 g from USDA SR Legacy, public domain; see data/SOURCES.md).
 * It loads the first time Fuel is opened and is kept for offline use by the service worker.
 * The person's own list is a JSON or CSV file they choose (parseImport). It is kept on the device only, never bundled or uploaded,
 * so data with its own terms (for example the Indian Food Composition Tables) never has to be shipped with the app.
 * The short list below is different: typical values for plain, home-style dishes that a database does not measure cooked
 * (a katori of dal, a phulka, an idli). Those numbers are approximate and labelled so.
 *
 * diet: 0 vegetarian, 1 egg, 2 meat, poultry, fish or gelatin, 3 unclear ingredients (restaurant, canned soup, ready meal).
 */
(function (root) {
  'use strict';

  // [name, serving, kcal, protein, carbs, fat, aliases]
  const RAW = [
    ['Paneer, full fat', '100 g', 290, 18, 3, 23, 'cottage cheese indian'],
    ['Paneer, high protein', '50 g', 95, 12.5, 1.5, 4.5, 'low fat paneer'],
    ['Whey protein', '1 scoop (30 g)', 120, 25, 3, 1.5, 'protein powder shake'],
    ['Greek yogurt, plain', '170 g', 100, 17, 6, 0.7, 'yoghurt yogurt'],
    ['Curd / dahi', '200 g', 130, 8, 9, 6, 'yogurt indian'],
    ['Milk, 2%', '240 ml', 122, 8, 12, 5, 'doodh'],
    ['Milk tea (chai) with sugar', '1 cup', 90, 3, 12, 3, 'chai tea'],
    ['Tofu, extra firm', '100 g', 145, 16, 3, 8, 'soy'],
    ['Soya chunks, dry', '30 g', 100, 15, 10, 0.5, 'nutrela soy chunks'],
    ['Chana, cooked', '1 cup (165 g)', 270, 14.5, 45, 4, 'chickpeas chole'],
    ['Rajma, cooked', '1 cup (177 g)', 225, 15, 40, 1, 'kidney beans'],
    ['Dal, cooked', '1 katori (150 g)', 150, 8, 22, 3, 'lentils toor moong masoor'],
    ['Sprouts, moong', '100 g', 30, 3, 6, 0.2, 'mung sprouts'],
    ['Sattu', '30 g', 105, 6, 18, 1, 'roasted gram flour'],
    ['Roti / chapati', '1 (40 g)', 120, 3.5, 20, 3, 'phulka wheat'],
    ['Rice, cooked', '1 cup (160 g)', 205, 4.3, 45, 0.4, 'white rice chawal'],
    ['Brown rice, cooked', '1 cup (195 g)', 215, 5, 45, 1.8, ''],
    ['Oats, dry', '40 g', 150, 5, 27, 2.5, 'oatmeal porridge'],
    ['Poha, cooked', '1 plate (200 g)', 270, 5, 45, 8, 'flattened rice'],
    ['Idli', '1 piece', 58, 2, 12, 0.4, 'south indian'],
    ['Dosa, plain', '1 medium', 130, 3, 25, 2, 'south indian'],
    ['Bread, whole wheat', '1 slice', 80, 4, 14, 1, 'toast'],
    ['Potato, boiled', '150 g', 130, 3, 30, 0.2, 'aloo'],
    ['Mixed vegetable sabzi', '1 katori (150 g)', 100, 2.5, 10, 5.5, 'curry veg'],
    ['Egg', '1 large', 72, 6, 0.4, 5, 'boiled omelette'],
    ['Cheese slice', '20 g', 70, 4, 0.5, 6, ''],
    ['Peanut butter', '32 g (2 tbsp)', 190, 8, 6, 16, ''],
    ['Almonds', '28 g', 165, 6, 6, 14, 'badam nuts'],
    ['Mixed nuts', '30 g', 175, 5, 6, 15, ''],
    ['Chia seeds', '10 g', 49, 1.7, 4.2, 3.1, ''],
    ['Banana', '1 medium', 105, 1.3, 27, 0.4, ''],
    ['Apple', '1 medium', 95, 0.5, 25, 0.3, ''],
    ['Ghee', '1 tsp (5 g)', 45, 0, 0, 5, 'clarified butter'],
    ['Olive oil', '1 tbsp', 119, 0, 0, 13.5, 'oil'],
  ];

  const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const CATALOG = RAW.map((r, i) => ({ id: 'c' + i, name: r[0], serving: r[1], kcal: r[2], protein: r[3], carbs: r[4], fat: r[5], alias: r[6] || '', diet: r[0] === 'Egg' ? 1 : 0, approx: true, hayWords: words(r[0] + ' ' + (r[6] || '')) }));

  function tokens(q) { return String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }

  // ---------- the database ----------
  const DB = { list: null, promise: null, user: [], userName: '' };
  const SOURCE_LABEL = ['USDA', 'My list'];
  const isNum = (x, hi) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= hi;

  // Reads data/foods.json. Anything malformed is skipped, so a damaged file can never put odd values into the log.
  function parseDb(json) {
    if (!json || json.v !== 1 || !Array.isArray(json.foods)) throw new Error('The food list is not in the expected format.');
    const out = [];
    for (let i = 0; i < json.foods.length; i++) {
      const a = json.foods[i];
      if (!Array.isArray(a) || typeof a[0] !== 'string' || !a[0] || a[0].length > 160) continue;
      const diet = a[1], src = a[7];
      if (![0, 1, 2, 3].includes(diet) || src !== 0) continue;
      if (!isNum(a[2], 900) || !isNum(a[3], 100) || !isNum(a[4], 100) || !isNum(a[5], 100) || !isNum(a[6], 100)) continue;
      const alias = typeof a[8] === 'string' ? a[8].slice(0, 120) : '';
      out.push({ id: 'd' + i, name: a[0], serving: '100 g', kcal: a[2], protein: a[3], carbs: a[4], fat: a[5], fibre: a[6], diet, src, alias, per100: true, hayWords: words(a[0] + ' ' + alias) });
    }
    if (out.length < 100) throw new Error('The food list is empty.');
    return out;
  }
  function useDb(list) { DB.list = list; DB.promise = Promise.resolve(list); return list; }

  // ---------- the person's own list ----------
  // A file the person chooses: JSON ({"orbitFoods":1,"name":"...","foods":[{name,kcal,protein,carbs,fat,fibre?,diet?,aliases?}]} or just the array)
  // or CSV with a header row (name,kcal,protein,carbs,fat,fibre,diet,aliases; the last three are optional). All values are per 100 g.
  // diet is veg, egg, nonveg or check; anything else, or nothing, means "check the label". Every row is checked; bad rows are skipped and counted.
  const IMPORT_MAX_BYTES = 15 * 1024 * 1024, IMPORT_MAX_ROWS = 30000;
  const DIET_WORDS = { veg: 0, vegetarian: 0, egg: 1, eggetarian: 1, nonveg: 2, 'non-veg': 2, 'non veg': 2, meat: 2, check: 3 };
  const tidy = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const numOf = (x) => { if (x == null || x === '') return null; const n = typeof x === 'number' ? x : Number(String(x).trim()); return Number.isFinite(n) ? n : null; };
  function csvRows(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  // Returns { name, rows: [[name, diet, kcal, protein, carbs, fat, fibre, alias]], total, skipped, why }. Throws a readable Error when nothing usable is found.
  function parseImport(text, fileName) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('That file is empty.');
    if (text.length > IMPORT_MAX_BYTES) throw new Error('That file is over 15 MB. Split it or remove columns you do not need.');
    const t = text.replace(/^\uFEFF/, '');
    let items = [], name = '';
    if (/^\s*[\[{]/.test(t)) {
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error('That file looks like JSON but could not be read.'); }
      const arr = Array.isArray(j) ? j : j && Array.isArray(j.foods) ? j.foods : null;
      if (!arr) throw new Error('No list of foods found. Expected {"foods": [...]} or a plain list.');
      if (j && !Array.isArray(j)) name = tidy(j.name, 60);
      items = arr;
    } else {
      const rows = csvRows(t);
      const head = (rows[0] || []).map((c) => tidy(c, 40).toLowerCase());
      const col = (k) => head.indexOf(k);
      for (const k of ['name', 'kcal', 'protein', 'carbs', 'fat']) if (col(k) < 0) throw new Error('The first row must name the columns: name, kcal, protein, carbs, fat (then optionally fibre, diet, aliases). Missing: ' + k + '.');
      for (const r of rows.slice(1)) items.push({ name: r[col('name')], kcal: r[col('kcal')], protein: r[col('protein')], carbs: r[col('carbs')], fat: r[col('fat')], fibre: col('fibre') >= 0 ? r[col('fibre')] : null, diet: col('diet') >= 0 ? r[col('diet')] : null, aliases: col('aliases') >= 0 ? r[col('aliases')] : null });
    }
    if (!name) name = tidy(String(fileName || '').replace(/\.[a-z0-9]{1,5}$/i, ''), 60) || 'My list';
    const out = [], why = new Set(); let skipped = 0;
    const total = items.length;
    for (const it of items) {
      if (out.length >= IMPORT_MAX_ROWS) { skipped++; why.add('only the first ' + IMPORT_MAX_ROWS.toLocaleString('en-US') + ' foods are kept'); continue; }
      if (!it || typeof it !== 'object') { skipped++; why.add('a row was not an entry'); continue; }
      const nm = tidy(it.name, 160);
      const kcal = numOf(it.kcal), p = numOf(it.protein), c = numOf(it.carbs), f = numOf(it.fat), fib = it.fibre == null || it.fibre === '' ? 0 : numOf(it.fibre);
      if (!nm) { skipped++; why.add('a food had no name'); continue; }
      if (kcal == null || p == null || c == null || f == null || fib == null) { skipped++; why.add('some rows had a missing or non-numeric value'); continue; }
      if (!isNum(kcal, 900) || !isNum(p, 100) || !isNum(c, 100) || !isNum(f, 100) || !isNum(fib, 100)) { skipped++; why.add('some values were outside what 100 g can hold'); continue; }
      const dw = tidy(it.diet, 20).toLowerCase(), diet = Object.prototype.hasOwnProperty.call(DIET_WORDS, dw) ? DIET_WORDS[dw] : 3;
      const al = Array.isArray(it.aliases) ? it.aliases.map((x) => tidy(x, 40)).join(' ') : tidy(it.aliases, 120);
      out.push([nm, diet, Math.round(kcal), Math.round(p * 10) / 10, Math.round(c * 10) / 10, Math.round(f * 10) / 10, Math.round(fib * 10) / 10, al.slice(0, 120)]);
    }
    if (!out.length) throw new Error('No usable foods found' + (why.size ? ' (' + Array.from(why).slice(0, 2).join('; ') + ')' : '') + '. Values are per 100 g: kcal up to 900, the rest up to 100.');
    return { name, rows: out, total, skipped, why: Array.from(why) };
  }
  // Makes the parsed rows searchable. Rows are checked again, so what is read back from storage is never trusted either.
  function useUser(rows, name) {
    const list = [];
    for (let i = 0; Array.isArray(rows) && i < rows.length && list.length < IMPORT_MAX_ROWS; i++) {
      const a = rows[i];
      if (!Array.isArray(a) || typeof a[0] !== 'string' || !a[0] || a[0].length > 160 || ![0, 1, 2, 3].includes(a[1])) continue;
      if (!isNum(a[2], 900) || !isNum(a[3], 100) || !isNum(a[4], 100) || !isNum(a[5], 100) || !isNum(a[6], 100)) continue;
      const alias = typeof a[7] === 'string' ? a[7].slice(0, 120) : '';
      list.push({ id: 'u' + i, name: a[0], serving: '100 g', kcal: a[2], protein: a[3], carbs: a[4], fat: a[5], fibre: a[6], diet: a[1], src: 1, alias, per100: true, hayWords: words(a[0] + ' ' + alias) });
    }
    DB.user = list; DB.userName = list.length ? tidy(name, 60) : '';
    return list.length;
  }
  const userCount = () => DB.user.length;
  const userName = () => DB.userName;
  function load(fetcher) {
    if (DB.list) return Promise.resolve(DB.list);
    if (DB.promise) return DB.promise;
    const f = fetcher || (typeof fetch === 'function' ? fetch.bind(root) : null);
    if (!f) return Promise.reject(new Error('This browser cannot load the food list.'));
    DB.promise = f('data/foods.json', { credentials: 'omit' })
      .then((r) => { if (!r.ok) throw new Error('The food list could not be loaded.'); return r.json(); })
      .then((j) => { DB.list = parseDb(j); return DB.list; })
      .catch((e) => { DB.promise = null; throw e; });
    return DB.promise;
  }
  const ready = () => !!DB.list;
  const count = () => (DB.list ? DB.list.length : 0) + DB.user.length + CATALOG.length;

  // 'all', 'veg' (vegetarian only), 'egg' (vegetarian and egg), 'nonveg' (meat, poultry and fish only)
  const DIETS = ['all', 'veg', 'egg', 'nonveg'];
  function dietOk(filter, diet) {
    if (filter === 'veg') return diet === 0;
    if (filter === 'egg') return diet === 0 || diet === 1;
    if (filter === 'nonveg') return diet === 2;
    return true;
  }
  const DIET_LABEL = ['Veg', 'Egg', 'Non-veg', 'Check label'];
  const DIET_TONE = ['good', 'acc', 'coral', 'line'];
  // The filter to start with, from the diet chosen in setup.
  function dietFor(profileDiet) {
    const d = String(profileDiet || '').toLowerCase();
    if (/egg/.test(d)) return 'egg';
    if (/vegan|vegetarian|veg\b/.test(d)) return 'veg';
    return 'all';
  }

  // Lower is better. Every word typed must appear somewhere in the name or its aliases.
  // Whole words in the first part of the name ("Nuts, almonds") beat words buried at the end of a long brand name.
  function score(f, t) {
    const segs = f.name.split(',').map(words);
    let total = 0;
    for (const w of t) {
      if (!f.hayWords.some((x) => x.startsWith(w))) return null;
      let best = 9;
      for (let i = 0; i < segs.length && best > 0; i++) {
        const base = i === 0 ? 0 : i === 1 ? 0.5 : 1.5 + i * 0.3;
        for (const x of segs[i]) { if (x === w) best = Math.min(best, base); else if (x.startsWith(w)) best = Math.min(best, base + 0.7); }
      }
      if (best === 9) best = f.alias && words(f.alias).some((x) => x === w) ? 2 : f.alias && words(f.alias).some((x) => x.startsWith(w)) ? 2.5 : 4;
      total += best;
    }
    return total + f.name.length / 60 + (f.src === 1 ? -0.4 : 0) + (f.approx ? -0.6 : 0) + (f.diet === 3 ? 1.5 : 0);
  }
  function search(q, opts) {
    const o = opts || {}, t = tokens(q), diet = o.diet || 'all';
    if (!t.length) return [];
    const out = [];
    for (const pool of [CATALOG, DB.user, DB.list || []]) {
      for (const f of pool) {
        if (!dietOk(diet, f.diet)) continue;
        const s = score(f, t);
        if (s != null) out.push({ f, s });
      }
    }
    out.sort((a, b) => a.s - b.s || a.f.name.length - b.f.name.length || a.f.name.localeCompare(b.f.name));
    const total = out.length;
    const list = out.slice(0, o.limit || 8).map((x) => x.f);
    list.total = total;
    return list;
  }
  // Macros for an amount of a per-100 g food.
  function scale(f, grams) {
    const k = grams / 100, r1 = (x) => Math.round(x * 10) / 10;
    return { kcal: Math.round(f.kcal * k), protein: r1(f.protein * k), carbs: r1(f.carbs * k), fat: r1(f.fat * k) };
  }

  // Foods the person has logged before, most recent first, deduplicated by name (so their own dishes are one tap away).
  function recents(foods, limit) {
    const seen = new Set(), out = [];
    for (let i = foods.length - 1; i >= 0 && out.length < (limit || 8); i--) {
      const f = foods[i];
      const k = String(f.name || '').toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ id: 'r' + f.seq, name: f.name, serving: f.serving || 'as logged', kcal: f.kcal, protein: f.protein || 0, carbs: f.carbs || 0, fat: f.fat || 0, recent: true, meal: f.meal, diet: 0, ai: f.ai || null });
    }
    return out;
  }
  function searchRecents(foods, q, limit) {
    const t = tokens(q);
    return recents(foods, 200).filter((f) => t.every((w) => f.name.toLowerCase().includes(w))).slice(0, limit || 5);
  }

  const api = { CATALOG, search, recents, searchRecents, load, ready, count, parseDb, useDb, parseImport, useUser, userCount, userName, IMPORT_MAX_BYTES, scale, dietOk, dietFor, DIETS, DIET_LABEL, DIET_TONE, SOURCE_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Foods = api;
})(typeof self !== 'undefined' ? self : this);

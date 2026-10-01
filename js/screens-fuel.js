/*
 * Fuel: the calorie and macro log.
 * Four ways in: find a food, describe it to the AI, type raw ingredients, or enter the numbers by hand.
 * The AI paths only ever fill in a confirmation card. Nothing is stored until the person taps "Looks right".
 */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store, Foods = root.Foods;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};
  const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

  let viewDate = null;

  function guessMeal() {
    const hr = new Date().getHours();
    return hr < 10 ? 'Breakfast' : hr < 12 ? 'Snack' : hr < 15 ? 'Lunch' : hr < 18 ? 'Snack' : 'Dinner';
  }
  function macroLine(f) { return 'P ' + U.num(f.protein || 0, 0) + ' · C ' + U.num(f.carbs || 0, 0) + ' · F ' + U.num(f.fat || 0, 0); }

  // ---------- writing an entry ----------
  // n is a normalized food (Engine.normalizeFood value). extra carries source and AI evidence.
  async function saveFood(date, meal, n, extra) {
    const data = Object.assign({ date, meal: E.MEALS.includes(meal) ? meal : 'Snack', name: n.name, kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat }, extra || {});
    return Store.append('food_logged', data);
  }

  // ---------- the person's own food list ----------
  // Kept in this browser only (meta store), never in backups and never in the repository. See Foods.parseImport for the file format.
  let userLoaded = null;
  function loadUserList() {
    if (!userLoaded) {
      userLoaded = Store.getMeta('userFoods').then((rec) => { if (rec && rec.v === 1) Foods.useUser(rec.rows, rec.name); }).catch(() => { /* none stored */ });
    }
    return userLoaded;
  }
  // Reads a chosen file, shows what was found, and only stores it after "Use this list".
  async function readListFile(file, onDone) {
    if (!file) return;
    if (file.size > Foods.IMPORT_MAX_BYTES) return U.toast('That file is over 15 MB.', 'warn');
    let r;
    try { r = Foods.parseImport(await file.text(), file.name); } catch (e) { return U.toast(String(e && e.message ? e.message : e).slice(0, 240), 'warn'); }
    const names = r.rows.slice(0, 4).map((x) => x[0]).join(', ');
    const body = h('div', { class: 'stack' },
      h('div', { class: 'ct' }, r.name),
      h('div', null, U.withCommas(r.rows.length) + ' foods can be used' + (r.skipped ? ', ' + U.withCommas(r.skipped) + ' skipped' : '') + '.'),
      r.skipped ? h('div', { class: 'muted small' }, 'Skipped because ' + r.why.join('; ') + '.') : null,
      h('div', { class: 'muted small' }, 'For example: ' + names + (r.rows.length > 4 ? ', ...' : '')),
      h('div', { class: 'muted small' }, 'Foods with no diet marked show "check the label". The list is kept on this device only. It is not put in backups and never uploaded, so choose the file again on a new phone.'));
    U.sheet('Use this food list?', body, [{ label: 'Cancel', kind: 'quiet' }, { label: 'Use this list', kind: 'primary', run: () => {
      (async () => {
        try {
          await Store.setMeta('userFoods', { v: 1, name: r.name, at: new Date().toISOString(), rows: r.rows });
          Foods.useUser(r.rows, r.name); userLoaded = Promise.resolve();
          U.toast('Added ' + U.withCommas(Foods.userCount()) + ' foods to Find.'); onDone();
        } catch (e) { U.toast('Could not save the list on this device.', 'warn'); }
      })();
    } }]);
  }
  function removeListSheet(onDone) {
    U.confirmSheet('Remove your food list?', 'It is deleted from this device. Foods you already logged from it stay in your log.', 'Remove', async () => {
      try { await Store.delMeta('userFoods'); } catch (e) { /* ignore */ }
      Foods.useUser([], ''); onDone();
    }, true);
  }

  // ---------- Fuel screen ----------
  Screens.fuel = function () {
    const st = Store.getState(), plan = st.plan, t = U.today();
    const date = viewDate && viewDate <= t ? viewDate : t;
    const tot = E.dayTotals(st, date);
    const nav = h('div', { class: 'daynav' },
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Previous day', onclick: () => { viewDate = E.addDays(date, -1); root.App.render(); } }, U.icon('back', 20)),
      h('div', { class: 'grow', style: { textAlign: 'center' } }, h('div', { class: 'd' }, date === t ? 'Today' : U.longDate(date)), h('div', { class: 'muted small' }, U.longDate(date))),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Next day', disabled: date >= t, onclick: () => { viewDate = E.addDays(date, 1); root.App.render(); } }, U.icon('chev', 20)));
    const remaining = plan.kcal - tot.kcal;
    const activeToday = st.workouts.filter((w) => w.date === date).reduce((n, w) => n + w.kcal, 0);
    const macroBar = (label, val, target, kind) => h('div', { class: 'stack' }, h('div', { class: 'kv' }, h('span', null, label), h('b', null, Math.round(val) + ' / ' + target + ' g')), U.bar(target ? (val / target) * 100 : 0, kind));
    const summary = UI.card(
      h('div', { class: 'target-top' }, h('div', null, h('div', { class: 'display big' }, U.withCommas(tot.kcal), h('span', { class: 'muted unitbig' }, ' / ' + U.withCommas(plan.kcal) + ' kcal')), h('div', { class: 'muted small' }, remaining >= 0 ? U.withCommas(remaining) + ' left' : U.withCommas(-remaining) + ' over')), U.chip(E.dayTotals(st, date).n + ' logged', 'line')),
      U.bar(plan.kcal ? (tot.kcal / plan.kcal) * 100 : 0, tot.kcal > plan.kcal * 1.1 ? 'coral' : '', true),
      macroBar('Protein', tot.protein, plan.protein, 'coral'), macroBar('Carbs', tot.carbs, plan.carbs, ''), macroBar('Fat', tot.fat, plan.fat, 'cool'),
      activeToday ? h('a', { class: 'kv', href: '#/activity' }, h('span', null, 'Active today'), h('b', null, '~' + U.withCommas(activeToday) + ' kcal')) : null,
      activeToday ? h('div', { class: 'muted small' }, 'Your target already allows for training, so there is no need to eat this back.') : null);

    const day = st.foods.filter((f) => f.date === date);
    const sections = [];
    for (const meal of E.MEALS) {
      const items = day.filter((f) => (E.MEALS.includes(f.meal) ? f.meal : 'Snack') === meal);
      if (!items.length) continue;
      const sub = items.reduce((tt, f) => tt + (f.kcal || 0), 0);
      sections.push(UI.card(
        h('div', { class: 'mealhead' }, h('div', { class: 'ct' }, meal), h('span', { class: 'muted small' }, U.withCommas(sub) + ' kcal')),
        ...items.map((f) => h('button', { type: 'button', class: 'listrow foodrow', 'aria-label': 'Edit ' + f.name, onclick: () => editSheet(f) },
          h('div', { class: 'fn' }, h('b', null, f.name), h('span', { class: 'muted small' }, macroLine(f) + (f.serving ? ' · ' + f.serving : ''))),
          f.ai ? U.chip(f.ai.edited ? 'AI, edited' : 'AI est.', 'acc') : null,
          h('div', { class: 'kc' }, String(f.kcal))))));
    }
    const hint = !root.App.aiReady() ? h('div', { class: 'muted small' }, 'Tip: add your own AI key in Coach settings and you can just describe a meal or list raw ingredients. You will always see the numbers before anything is saved.') : null;
    return UI.page(UI.header('Fuel', 'Log what you ate. Approximate is fine, consistent is better.'),
      UI.scroller(nav, summary, UI.btn('Add food', { icon: 'plus', onClick: () => openAdd(date) }), date === t ? Screens.eatNextCard() : null,
        ...(sections.length ? sections : [UI.empty(date === t ? 'Nothing logged yet today.' : 'Nothing logged this day.')]), date === t ? Screens.surpriseCard() : null, hint));
  };

  // ---------- edit an existing entry ----------
  // Raw calories/macros are only ever typed at the AI-confirm or Manual-log step (drawConfirm/drawManual).
  // Once something is logged, editing it changes the portion size instead, and macros scale from the
  // per-unit basis that was captured at log time (grams for a database food, "x servings" otherwise).
  function portionOf(f) {
    if (f.portion && f.portion.base) return f.portion;
    // Entries logged before this feature existed have no stored basis: treat what was logged as "1x".
    return { unit: 'x', amount: 1, label: f.serving || 'as logged', base: { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat } };
  }
  function scalePortion(base, unit, amount) {
    return unit === 'g' ? Foods.scale(base, amount) : { kcal: Math.round(base.kcal * amount), protein: Math.round(base.protein * amount * 10) / 10, carbs: Math.round(base.carbs * amount * 10) / 10, fat: Math.round(base.fat * amount * 10) / 10 };
  }
  function editSheet(f) {
    const name = UI.field({ label: 'Name', value: f.name, maxlength: 80 });
    const portion = portionOf(f);
    const isGrams = portion.unit === 'g';
    let amount = String(portion.amount);
    let meal = E.MEALS.includes(f.meal) ? f.meal : 'Snack';
    const live = h('div', { class: 'kv' });
    const updLive = () => { const n = Math.max(0, numOrNull(amount) || 0); const m = scalePortion(portion.base, portion.unit, n); U.clear(live); U.put(live, h('span', null, m.kcal + ' kcal'), h('b', null, macroLine(m))); };
    const amtField = UI.field({ label: isGrams ? 'Amount' : 'Portion (x ' + portion.label + ')', unit: isGrams ? 'g' : 'x', type: 'number', value: amount, flex: 1, onInput: (v) => { amount = v; updLive(); } });
    const quick = isGrams
      ? h('div', { class: 'pills' }, ...[50, 100, 150, 200, 250].map((g) => h('button', { type: 'button', class: 'pill', onclick: () => { amount = String(g); amtField.input.value = amount; updLive(); } }, g + ' g')))
      : h('div', { class: 'pills' }, ...[0.5, 1, 1.5, 2].map((x) => h('button', { type: 'button', class: 'pill', onclick: () => { amount = String(x); amtField.input.value = amount; updLive(); } }, x + 'x')));
    updLive();
    const aiItems = f.ai && f.ai.items && f.ai.items.length
      ? h('div', { class: 'stack' },
          h('div', { class: 'lab' }, 'How it was worked out'),
          h('div', null, ...f.ai.items.map((it) => h('div', { class: 'itemrow' }, h('span', null, it.name), h('b', null, it.kcal + ' kcal'), h('small', null, (it.qty ? it.qty + ' · ' : '') + macroLine(it))))),
          h('div', { class: 'muted small' }, 'From the original estimate. It does not rescale if you change the portion above.'))
      : null;
    const body = h('div', { class: 'stack' }, name, amtField, quick, live,
      h('div', { class: 'muted small' }, isGrams ? 'Weigh the amount you actually had; calories and macros scale from it.' : 'Ate more or less than logged? Adjust the portion; calories and macros scale from it.'),
      UI.pills({ label: 'Meal', items: E.MEALS, values: new Set([meal]), multi: false, onChange: (v) => { meal = Array.from(v)[0]; } }),
      aiItems,
      f.ai && f.ai.assumptions && f.ai.assumptions.length ? h('ul', { class: 'assume' }, ...f.ai.assumptions.map((a) => h('li', null, a))) : null);
    U.sheet('Edit food', body, [{ label: 'Delete', kind: 'danger', run: async () => { await Store.voidEvent(f.seq); root.App.render(); } }, { label: 'Save', kind: 'primary', run: () => {
      const amt = numOrNull(amount);
      const max = isGrams ? 3000 : 20;
      if (!(amt > 0 && amt <= max)) { U.toast(isGrams ? 'Enter an amount between 1 and 3,000 g.' : 'Portion must be between 0 and 20.', 'warn'); return false; }
      const m = scalePortion(portion.base, portion.unit, amt);
      const n = E.normalizeFood({ name: name.input.value, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat });
      if (!n.ok) { U.toast(n.errors[0], 'warn'); return false; }
      const extra = {};
      extra.serving = isGrams ? (Math.round(amt * 10) / 10 + ' g') : (amt === 1 ? portion.label : U.num(amt, 2) + ' x ' + portion.label);
      if (f.source) extra.source = f.source;
      if (f.ai) extra.ai = Object.assign({}, f.ai, { edited: true });
      extra.portion = { unit: portion.unit, amount: amt, label: portion.label, base: portion.base };
      (async () => { await Store.voidEvent(f.seq); await saveFood(f.date, meal, n.value, extra); root.App.render(); })();
    } }]);
  }

  // ---------- add food ----------
  function openAdd(date, prefill) {
    const pre = prefill || {};
    let tab = pre.tab || 'find', meal = pre.meal || guessMeal(), pick = null, close = null;
    let aiText = pre.text || '', servings = '1', mFields = { name: pre.name || '', kcal: '', protein: '', carbs: '', fat: '' };
    let est = null, busy = null, err = '';
    // A photo of the food or its label, picked for the AI estimate: { b64, mime, url }. Never saved with the log entry.
    let aiImage = null;
    const clearAiImage = () => { if (aiImage) URL.revokeObjectURL(aiImage.url); aiImage = null; };
    const body = h('div', { class: 'stack' });
    const finish = (msg) => { clearAiImage(); if (close) close(); U.toast(msg || 'Logged.'); root.App.render(); };

    const mealPills = () => UI.pills({ label: 'Meal', items: E.MEALS, values: new Set([meal]), multi: false, onChange: (v) => { meal = Array.from(v)[0]; } });
    const tabBar = () => {
      const bar = h('div', { class: 'tabs2', role: 'tablist' });
      for (const [id, label] of [['find', 'Find'], ['ai', 'Describe'], ['ingr', 'Ingredients'], ['manual', 'Manual']]) {
        bar.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': tab === id ? 'true' : 'false', class: tab === id ? 'on' : '', onclick: () => { if (busy) return; tab = id; est = null; pick = null; err = ''; clearAiImage(); draw(); } }, label));
      }
      return bar;
    };

    // ----- Find -----
    const DIET_ITEMS = [['all', 'All'], ['veg', 'Veg'], ['egg', 'Veg + egg'], ['nonveg', 'Non-veg']];
    const dietChip = (f) => (f.recent ? null : U.chip(Foods.DIET_LABEL[f.diet], Foods.DIET_TONE[f.diet]));
    const srcNote = (f) => (f.recent ? 'from your log' : f.approx ? 'approximate' : f.src === 1 ? (Foods.userName() || Foods.SOURCE_LABEL[1]) : Foods.SOURCE_LABEL[f.src]);
    function drawFind() {
      const st = Store.getState(), foods = st.foods, set = Store.getSettings();
      let diet = Foods.DIETS.includes(set.foodDiet) ? set.foodDiet : Foods.dietFor(st.profile && st.profile.diet);
      let shown = 12, failed = false;
      const results = h('div', { class: 'results' });
      const more = h('div', { class: 'stack' });
      const status = h('div', { class: 'muted small' });
      const q = UI.field({ label: 'Search foods', value: pre.text || '', placeholder: 'paneer, moong dal, chicken breast...', maxlength: 60 });
      const dietPills = UI.pills({ label: 'Show', items: DIET_ITEMS.map((x) => x[1]), values: new Set([DIET_ITEMS.find((x) => x[0] === diet)[1]]), multi: false, onChange: (v) => {
        const label = Array.from(v)[0]; diet = DIET_ITEMS.find((x) => x[1] === label)[0]; shown = 12; Store.saveSettings({ foodDiet: diet }); showResults();
      } });
      const showResults = () => {
        U.clear(results); U.clear(more);
        status.textContent = failed ? 'The full food list could not load, so only the short list is searched.' : !Foods.ready() ? 'Loading the full food list...' : '';
        const text = q.input.value.trim();
        let list, total = 0;
        if (!text) list = Foods.recents(foods, 6).concat(Foods.CATALOG.filter((f) => Foods.dietOk(diet, f.diet)).slice(0, 8));
        else { const r = Foods.search(text, { diet, limit: shown }); total = r.total; list = Foods.searchRecents(foods, text, 4).concat(r); }
        const seen = new Set();
        list = list.filter((f) => { const k = f.name.toLowerCase() + f.serving; if (seen.has(k)) return false; seen.add(k); return true; });
        for (const f of list) results.appendChild(h('button', { type: 'button', class: 'result', onclick: () => { pick = f; draw(); } },
          h('div', { class: 'rl' }, h('b', null, f.name), h('small', null, f.serving + ' · ' + macroLine(f) + ' · ' + srcNote(f))), h('div', { class: 'rr' }, dietChip(f), h('b', null, String(Math.round(f.kcal))))));
        if (text && !list.length && Foods.ready()) results.appendChild(h('div', { class: 'empty' }, diet === 'all' ? 'Not in the list. Tell Regoal what is in it, or type the numbers.' : 'Nothing matches with this filter. Try All, or describe it below.'));
        results.classList.toggle('hidden', !list.length && !text);
        if (text && total > shown) more.appendChild(UI.btn('Show more (' + (total - shown) + ' more)', { kind: 'quiet', onClick: () => { shown += 20; showResults(); } }));
        notListed.classList.toggle('hidden', !text);
      };
      const notListed = h('div', { class: 'stack' },
        h('div', { class: 'muted small' }, 'Not listed? Type the raw ingredients (like "200 g paneer, 1 tbsp oil, 2 rotis") and get an estimate, or enter the macros yourself.'),
        h('div', { class: 'row' }, UI.btn('Type ingredients', { kind: 'quiet', onClick: () => { aiText = q.input.value.trim(); tab = 'ingr'; draw(); } }), UI.btn('Enter macros', { kind: 'quiet', onClick: () => { mFields.name = q.input.value.trim().slice(0, 80); tab = 'manual'; draw(); } })));
      const credit = h('div', { class: 'muted small' }, 'Per 100 g unless a serving is shown. Food data: USDA FoodData Central (public domain), arranged by TempoLife (CC-BY-4.0). The Veg, Egg and Non-veg tags come from each food\'s group and name, so read the label if it matters. "Approximate" entries are typical home-style values.');
      const myList = h('div', { class: 'stack' });
      const listFile = h('input', { type: 'file', class: 'hidden', accept: '.json,.csv,text/csv,application/json,text/plain', 'aria-label': 'Food list file' });
      listFile.addEventListener('change', () => { const file = listFile.files && listFile.files[0]; listFile.value = ''; readListFile(file, () => afterListChange()); });
      const pickListFile = () => listFile.click();
      const drawMyList = () => {
        U.clear(myList);
        const n = Foods.userCount();
        if (n) U.put(myList, h('div', { class: 'kv' }, h('span', null, 'My list: ' + Foods.userName()), h('b', null, U.withCommas(n) + ' foods')),
          h('div', { class: 'row' }, UI.btn('Replace', { kind: 'quiet', onClick: () => pickListFile() }), UI.btn('Remove', { kind: 'quiet', onClick: () => removeListSheet(afterListChange) })));
        else U.put(myList, h('div', { class: 'muted small' }, 'Want more Indian foods or your own tables? Add a list from a file. IFCT 2017 (the Indian Food Composition Tables) works well for this; the README explains how to get it. The list stays on this device.'),
          UI.btn('Add my own food list', { kind: 'quiet', icon: 'file', onClick: () => pickListFile() }));
      };
      const afterListChange = () => { drawMyList(); showResults(); };
      q.input.addEventListener('input', () => { shown = 12; showResults(); });
      U.put(body, q, dietPills, status, results, more, notListed, listFile, myList, credit);
      drawMyList(); showResults();
      if (!Foods.userCount()) loadUserList().then(() => { if (document.body.contains(body)) afterListChange(); });
      if (!Foods.ready()) Foods.load().then(() => { if (document.body.contains(body)) showResults(); }).catch(() => { failed = true; if (document.body.contains(body)) showResults(); });
    }
    function drawPick() {
      const f = pick;
      if (f.per100) return drawPickGrams(f);
      const sv = UI.field({ label: 'Servings of ' + f.serving, type: 'number', value: '1', flex: 1 });
      const live = h('div', { class: 'kv' });
      const upd = () => { const n = Math.max(0, numOrNull(sv.input.value) || 0); U.clear(live); U.put(live, h('span', null, U.num(n * f.kcal, 0) + ' kcal'), h('b', null, macroLine({ protein: n * f.protein, carbs: n * f.carbs, fat: n * f.fat }))); };
      sv.input.addEventListener('input', upd); upd();
      U.put(body, h('div', { class: 'ct' }, f.name), h('div', { class: 'muted small' }, 'Values are typical and approximate. If yours is different, use Manual.'), sv, live,
        h('div', { class: 'row' }, UI.btn('Back', { kind: 'quiet', onClick: () => { pick = null; draw(); } }), UI.btn('Log it', { onClick: async () => {
          const n = numOrNull(sv.input.value);
          if (!(n > 0 && n <= 20)) return U.toast('Servings must be between 0 and 20.', 'warn');
          const r = E.normalizeFood({ name: f.name, kcal: f.kcal * n, protein: f.protein * n, carbs: f.carbs * n, fat: f.fat * n });
          if (!r.ok) return U.toast(r.errors[0], 'warn');
          await saveFood(date, meal, r.value, Object.assign({ serving: n === 1 ? f.serving : U.num(n, 2) + ' x ' + f.serving, source: f.recent ? 'recent' : 'catalog', portion: { unit: 'x', amount: n, label: f.serving, base: { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat } } }, f.ai ? { ai: f.ai } : {}));
          finish();
        } })));
    }
    // A database food: the amount is in grams, since the numbers are per 100 g.
    function drawPickGrams(f) {
      let grams = '100';
      const live = h('div', { class: 'kv' });
      const upd = () => { const n = Math.max(0, numOrNull(grams) || 0); const m = Foods.scale(f, n); U.clear(live); U.put(live, h('span', null, m.kcal + ' kcal'), h('b', null, macroLine(m))); };
      const gf = UI.field({ label: 'Amount', unit: 'g', type: 'number', value: '100', onInput: (v) => { grams = v; upd(); } });
      const quick = h('div', { class: 'pills' }, ...[50, 100, 150, 200, 250].map((g) => h('button', { type: 'button', class: 'pill', onclick: () => { grams = String(g); gf.input.value = grams; upd(); } }, g + ' g')));
      upd();
      const notes = [];
      if (f.diet === 3) notes.push('The ingredients of this food are not clear, so check the label if you avoid meat or egg.');
      if (f.src === 1) notes.push('From your own list. Check that the amount matches how it was measured (raw or cooked).');
      U.put(body, h('div', { class: 'ct' }, f.name), h('div', { class: 'row' }, dietChip(f), U.chip(srcNote(f), 'line')), h('div', { class: 'muted small' }, 'Numbers are per 100 g. Weigh cooked food against a cooked entry and raw against a raw one.'), ...notes.map((n) => h('div', { class: 'muted small' }, n)), gf, quick, live,
        h('div', { class: 'row' }, UI.btn('Back', { kind: 'quiet', onClick: () => { pick = null; draw(); } }), UI.btn('Log it', { onClick: async () => {
          const n = numOrNull(grams);
          if (!(n > 0 && n <= 3000)) return U.toast('Enter an amount between 1 and 3,000 g.', 'warn');
          const m = Foods.scale(f, n);
          const r = E.normalizeFood({ name: f.name, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat });
          if (!r.ok) return U.toast(r.errors[0], 'warn');
          await saveFood(date, meal, r.value, { serving: Math.round(n * 10) / 10 + ' g', source: f.src === 1 ? 'mylist' : 'usda', portion: { unit: 'g', amount: n, base: { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat } } });
          finish();
        } })));
    }

    // ----- AI (describe) and raw ingredients -----
    function drawAI(mode) {
      if (!root.App.aiReady()) {
        const cfg = root.App.llmConfig();
        U.put(body, UI.card(h('div', { class: 'ct' }, 'Bring your own AI'), h('div', { class: 'muted' }, 'This uses your own key with the provider you choose. The key stays on this device and the text you type goes only to that provider. No key? Manual entry works fine.'),
          UI.btn('Add your key', { onClick: () => root.Screens.keySheet(() => draw()) }),
          UI.btn('Coach settings', { kind: 'quiet', href: '#/coach/setup', onClick: () => { if (close) close(); } }),
          UI.btn('Enter macros myself', { kind: 'quiet', onClick: () => { tab = 'manual'; draw(); } })));
        void cfg;
        return;
      }
      const cfg = root.App.llmConfig();
      let host = '';
      try { host = new URL(root.LLM.endpointOf(cfg)).host; } catch (e) { host = 'your provider'; }
      const ta = h('textarea', { class: 'inp', maxlength: 1200, 'aria-label': mode === 'ingr' ? 'Raw ingredients' : 'What you ate', placeholder: mode === 'ingr' ? '200 g paneer\n1 tbsp oil\n1 onion, 2 tomatoes\nspices' : 'Two rotis with rajma and a bowl of curd, or attach a photo below', value: aiText, oninput: () => { aiText = ta.value; } });
      const sv = UI.field({ label: 'Makes how many equal servings?', type: 'number', inputmode: 'numeric', value: servings, hint: 'Cooked a pot for 4? Enter 4 and log one share.', onInput: (v) => { servings = v; } });
      const note = h('div', { class: 'muted small' });
      const errBox = err ? h('div', { class: 'warnbox', role: 'alert' }, err) : null;
      const attachRow = h('div', { class: 'attachprev hidden' });
      const syncAttach = () => {
        U.clear(attachRow);
        const has = !!aiImage;
        attachRow.classList.toggle('hidden', !has);
        if (has) {
          attachRow.appendChild(h('img', { src: aiImage.url, alt: 'Photo of the food', class: 'attachthumb' }));
          attachRow.appendChild(h('div', { class: 'muted small grow' }, 'Photo attached.'));
          attachRow.appendChild(h('button', { type: 'button', class: 'iconbtn tiny', 'aria-label': 'Remove photo', onclick: () => { clearAiImage(); syncAttach(); } }, U.icon('x', 16)));
        }
        note.textContent = (has ? 'Sends this text and photo ' : 'Sends only this text ') + 'to ' + host + ' with your key. Nothing is saved until you check the numbers.';
      };
      // No "capture" attribute: that forces the camera straight open on some browsers. Leaving it off lets the
      // person choose the camera or their photo library, whichever the browser's own picker offers.
      const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'offscreen', 'aria-label': 'Take or choose a photo of the food' });
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0]; fileInput.value = '';
        if (!file) return;
        if (!/^image\//.test(file.type)) return U.toast('Choose a photo.', 'warn');
        U.toast('Reading photo...');
        try {
          const [fr] = await root.Library.frames(file, 1, 1024);
          clearAiImage();
          aiImage = { b64: await root.Library.toB64(fr.blob), mime: 'image/jpeg', url: URL.createObjectURL(fr.blob) };
          syncAttach();
        } catch (e) { U.toast(String(e && e.message ? e.message : e).slice(0, 200), 'warn'); }
      });
      const photoBtn = UI.btn(aiImage ? 'Retake photo' : 'Attach a photo', { kind: 'quiet', icon: 'camera', onClick: () => fileInput.click() });
      const ctl = new AbortController();
      const go = h('button', { type: 'button', class: 'btn primary block' }, 'Estimate nutrition');
      go.addEventListener('click', async () => {
        if (busy) { ctl.abort(); return; }
        if (!aiText.trim() && !aiImage) { U.toast('Type what you had, or attach a photo, first.', 'warn'); return; }
        busy = ctl; err = ''; go.textContent = 'Stop';
        go.insertBefore(h('span', { class: 'spin' }), go.firstChild);
        const sN = mode === 'ingr' ? Math.max(1, Math.min(20, Math.round(numOrNull(servings) || 1))) : 1;
        try {
          const r = await root.FoodAI.estimate(cfg, { mode: mode === 'ingr' ? 'ingredients' : 'describe', text: aiText, servings: sN, image: aiImage, signal: ctl.signal });
          busy = null;
          if (!document.body.contains(body)) return;
          est = { r, mode, sN, input: aiText.trim().slice(0, 300), hadImage: !!aiImage };
        } catch (e) {
          busy = null;
          if (!document.body.contains(body)) return;
          err = e && e.name === 'AbortError' ? 'Stopped.' : String(e && e.message ? e.message : e).slice(0, 300);
        }
        draw();
      });
      syncAttach();
      U.put(body, ta, mode === 'ingr' ? sv : null, photoBtn, attachRow, fileInput, note, errBox, go, err ? UI.btn('Enter macros myself', { kind: 'quiet', onClick: () => { mFields.name = aiText.split('\n')[0].slice(0, 80); tab = 'manual'; err = ''; draw(); } }) : null);
    }

    // The confirmation card. Everything is editable and nothing is stored before "Looks right".
    function drawConfirm() {
      const v = est.r.value;
      const name = UI.field({ label: 'Name', value: v.name, maxlength: 80 });
      const kc = UI.field({ label: 'Calories', unit: 'kcal', type: 'number', value: v.kcal, flex: 1 });
      const p = UI.field({ label: 'Protein', unit: 'g', type: 'number', value: v.protein, flex: 1 });
      const c = UI.field({ label: 'Carbs', unit: 'g', type: 'number', value: v.carbs, flex: 1 });
      const fa = UI.field({ label: 'Fat', unit: 'g', type: 'number', value: v.fat, flex: 1 });
      const live = h('div', { class: 'muted small' });
      let ack = false;
      const warn = h('div', { class: 'warnbox hidden', role: 'alert' });
      const okBtn = h('button', { type: 'button', class: 'btn primary block' }, 'Looks right, log it');
      const cur = () => ({ name: name.input.value, kcal: numOrNull(kc.input.value), protein: numOrNull(p.input.value), carbs: numOrNull(c.input.value), fat: numOrNull(fa.input.value) });
      const refresh = () => { const x = cur(); live.textContent = 'Macros add up to about ' + Math.round(E.macroKcal(x.protein, x.carbs, x.fat)) + ' kcal.'; ack = false; warn.classList.add('hidden'); okBtn.textContent = 'Looks right, log it'; };
      for (const f of [kc, p, c, fa, name]) f.input.addEventListener('input', refresh);
      refresh();
      okBtn.addEventListener('click', async () => {
        const x = cur();
        const n = E.normalizeFood(x);
        if (!n.ok) return U.toast(n.errors[0], 'warn');
        if (n.warnings.length && !ack) { ack = true; warn.textContent = n.warnings[0]; warn.classList.remove('hidden'); okBtn.textContent = 'Log anyway'; return; }
        const edited = ['kcal', 'protein', 'carbs', 'fat'].some((k) => n.value[k] !== v[k]) || n.value.name !== v.name;
        await saveFood(date, meal, n.value, { source: est.mode === 'ingr' ? 'ingredients' : 'ai', ai: { items: v.items, assumptions: v.assumptions, confidence: v.confidence, edited, input: est.input }, portion: { unit: 'x', amount: 1, label: 'as logged', base: { kcal: n.value.kcal, protein: n.value.protein, carbs: n.value.carbs, fat: n.value.fat } } });
        finish('Logged. Estimates can be edited any time from Fuel.');
      });
      const items = v.items.length ? h('div', null, h('div', { class: 'lab' }, 'How it was worked out'), ...v.items.map((it) => h('div', { class: 'itemrow' }, h('span', null, it.name), h('b', null, it.kcal + ' kcal'), h('small', null, (it.qty ? it.qty + ' · ' : '') + macroLine(it))))) : null;
      U.put(body, 
        h('div', { class: 'est' },
          h('div', { class: 'est-top' }, h('div', { class: 'ct' }, 'Check these numbers'), U.chip(v.confidence + ' confidence', v.confidence === 'high' ? 'good' : v.confidence === 'low' ? 'coral' : 'cool')),
          h('div', { class: 'muted small' }, 'This is an AI estimate from ' + (est.hadImage ? (est.input ? 'your photo and text' : 'your photo') : 'what you typed') + (est.sN > 1 ? ' (one of ' + est.sN + ' servings)' : '') + '. Fix anything that looks off, then confirm.'),
          name, UI.row(kc), UI.row(p, c, fa), live,
          items,
          v.assumptions.length ? h('ul', { class: 'assume' }, ...v.assumptions.map((a) => h('li', null, a))) : null,
          est.r.warnings.length ? h('div', { class: 'warnbox' }, est.r.warnings[0]) : null,
          warn, okBtn,
          h('div', { class: 'row' }, UI.btn('Estimate again', { kind: 'quiet', onClick: () => { est = null; draw(); } }), UI.btn('Cancel', { kind: 'quiet', onClick: () => close && close() }))));
    }

    // ----- Manual -----
    function drawManual() {
      const name = UI.field({ label: 'What was it?', value: mFields.name, maxlength: 80, placeholder: 'Homemade dal, 1 bowl', onInput: (v) => { mFields.name = v; } });
      const kc = UI.field({ label: 'Calories', unit: 'kcal', type: 'number', value: mFields.kcal, flex: 1, onInput: (v) => { mFields.kcal = v; upd(); } });
      const p = UI.field({ label: 'Protein', unit: 'g', type: 'number', value: mFields.protein, flex: 1, onInput: (v) => { mFields.protein = v; upd(); } });
      const c = UI.field({ label: 'Carbs', unit: 'g', type: 'number', value: mFields.carbs, flex: 1, onInput: (v) => { mFields.carbs = v; upd(); } });
      const fa = UI.field({ label: 'Fat', unit: 'g', type: 'number', value: mFields.fat, flex: 1, onInput: (v) => { mFields.fat = v; upd(); } });
      const live = h('div', { class: 'muted small' });
      const warn = h('div', { class: 'warnbox hidden', role: 'alert' });
      let ack = false;
      const okBtn = h('button', { type: 'button', class: 'btn primary block' }, 'Log it');
      function upd() { const k = E.macroKcal(numOrNull(mFields.protein), numOrNull(mFields.carbs), numOrNull(mFields.fat)); live.textContent = k ? 'Macros add up to about ' + Math.round(k) + ' kcal. Leave calories empty to use that.' : 'Leave calories empty to work them out from the macros.'; ack = false; warn.classList.add('hidden'); okBtn.textContent = 'Log it'; }
      upd();
      okBtn.addEventListener('click', async () => {
        const n = E.normalizeFood({ name: mFields.name, kcal: numOrNull(mFields.kcal), protein: numOrNull(mFields.protein), carbs: numOrNull(mFields.carbs), fat: numOrNull(mFields.fat) });
        if (!n.ok) return U.toast(n.errors[0], 'warn');
        if (n.warnings.length && !ack) { ack = true; warn.textContent = n.warnings[0]; warn.classList.remove('hidden'); okBtn.textContent = 'Log anyway'; return; }
        await saveFood(date, meal, n.value, { source: 'manual', portion: { unit: 'x', amount: 1, label: 'as logged', base: { kcal: n.value.kcal, protein: n.value.protein, carbs: n.value.carbs, fat: n.value.fat } } });
        finish();
      });
      U.put(body, name, UI.row(kc), UI.row(p, c, fa), live, warn, okBtn);
    }

    function draw() {
      U.clear(body);
      U.put(body, tabBar());
      if (!(tab === 'find' && pick)) U.put(body, mealPills());
      if (est) drawConfirm();
      else if (tab === 'find') { if (pick) drawPick(); else drawFind(); }
      else if (tab === 'ai' || tab === 'ingr') drawAI(tab);
      else drawManual();
    }
    draw();
    close = U.sheet('Add food · ' + (date === U.today() ? 'today' : U.shortDate(date)), body, [{ label: 'Close', kind: 'quiet' }]);
  }

  Screens.openAddFood = openAdd;
})(self);

/*
 * Suggested diet plan and "what should I eat next". Pure functions, no DOM, storage or network: it runs in Node too.
 *
 * How it works, so it can be explained and checked:
 *  - A small table of everyday foods (per 100 g, from standard composition tables, rounded) and a set of meal ideas built from them.
 *    Every meal idea lists its foods with a starting amount and the least and most that still makes sense.
 *  - A day's calories and macros (from the plan) are shared between the meals (3, 4 or 5 a day). For each meal the amounts are
 *    nudged, one step at a time, until the meal lands close to its share. If protein is still short, a protein food that suits the
 *    person's diet (whey, Greek yogurt, egg whites, plant protein...) is added and the meal is fitted again.
 *  - Preferences (eating style, cuisine, foods to avoid, dislikes, meals a day, quick meals only) filter the meal ideas first.
 *  - The week rotates through the ideas that are left, in a pattern set by a shuffle number, so the same person always gets the
 *    same plan until they change something.
 *  - "Eat next" does the same fit for the next meal, but against what is left of today's targets after what was already logged.
 * Nothing here is medical advice. Amounts are estimates from tables, and cooked foods are weighed as cooked.
 */
(function (root) {
  'use strict';
  const E = root.Engine || (typeof require === 'function' ? require('./engine.js') : null);

  // ---------- foods ----------
  // [name, kcal, protein, carbs, fat] per 100 g, tags (things a person may avoid), diet rank, unit.
  // Rank: 0 vegan, 1 vegetarian (dairy), 2 egg, 3 fish, 4 meat. unit: [singular, plural, grams] for foods counted in pieces.
  const F = {
    paneer: ['Paneer', 290, 18, 3, 23, ['dairy'], 1],
    paneer_lite: ['Low-fat paneer', 190, 25, 3, 9, ['dairy'], 1],
    tofu: ['Tofu', 145, 16, 3, 8, ['soy'], 0],
    soya: ['Soya chunks (dry)', 340, 52, 33, 0.5, ['soy'], 0],
    greek: ['Greek yogurt', 59, 10, 3.6, 0.4, ['dairy'], 1],
    curd: ['Curd (dahi)', 65, 4, 4.5, 3, ['dairy'], 1],
    milk: ['Milk', 51, 3.4, 5, 2.1, ['dairy'], 1, ['ml', 'ml', 1]],
    soymilk: ['Soy milk', 33, 2.9, 1.7, 1.6, ['soy'], 0, ['ml', 'ml', 1]],
    whey: ['Whey protein', 400, 83, 10, 5, ['dairy'], 1, ['scoop', 'scoops', 30]],
    peaprot: ['Plant protein powder', 380, 75, 10, 6, [], 0, ['scoop', 'scoops', 30]],
    egg: ['Egg', 144, 12, 0.8, 10, ['eggs'], 2, ['egg', 'eggs', 50]],
    eggwhite: ['Egg whites', 52, 11, 0.7, 0.2, ['eggs'], 2, ['white', 'whites', 33]],
    chana: ['Chana (cooked)', 164, 8.9, 27, 2.6, [], 0],
    rajma: ['Rajma (cooked)', 127, 8.7, 22.8, 0.5, [], 0],
    dal: ['Dal (cooked)', 100, 5.3, 14.7, 2, [], 0],
    sprouts: ['Sprouts', 30, 3, 6, 0.2, [], 0],
    sattu: ['Sattu', 350, 20, 60, 3, [], 0],
    peanuts: ['Roasted peanuts', 585, 24, 21, 49, ['nuts'], 0],
    chicken: ['Chicken breast (cooked)', 165, 31, 0, 3.6, [], 4],
    fish: ['White fish (cooked)', 128, 26, 0, 2.7, [], 3],
    shrimp: ['Prawns (cooked)', 99, 24, 0.2, 0.3, [], 3],
    tuna: ['Tuna (canned in water)', 116, 26, 0, 0.8, [], 3],
    roti: ['Roti', 300, 8.8, 50, 7.5, ['gluten'], 0, ['roti', 'rotis', 40]],
    rice: ['Rice (cooked)', 128, 2.7, 28, 0.3, [], 0],
    poha: ['Poha (cooked)', 135, 2.5, 22.5, 4, [], 0],
    idli: ['Idli', 145, 5, 30, 1, [], 0, ['idli', 'idlis', 40]],
    dosa: ['Dosa', 163, 3.8, 31, 2.5, [], 0, ['dosa', 'dosas', 80]],
    oats: ['Oats (dry)', 375, 12.5, 67, 6.3, ['gluten'], 0],
    bread: ['Whole wheat bread', 250, 12, 43, 3.5, ['gluten'], 0, ['slice', 'slices', 32]],
    wrap: ['Whole wheat wrap', 300, 9, 50, 7, ['gluten'], 0, ['wrap', 'wraps', 45]],
    pasta: ['Whole wheat pasta (cooked)', 124, 5.3, 26.5, 0.5, ['gluten'], 0],
    potato: ['Potato (boiled)', 87, 2, 20, 0.1, [], 0],
    sweetpotato: ['Sweet potato (boiled)', 80, 1.5, 18.5, 0.1, [], 0],
    quinoa: ['Quinoa (cooked)', 120, 4.4, 21, 1.9, [], 0],
    banana: ['Banana', 89, 1.1, 23, 0.3, [], 0, ['banana', 'bananas', 118]],
    apple: ['Apple', 52, 0.3, 14, 0.2, [], 0, ['apple', 'apples', 180]],
    orange: ['Orange', 47, 0.9, 12, 0.1, [], 0, ['orange', 'oranges', 130]],
    berries: ['Berries', 57, 0.7, 14, 0.3, [], 0],
    papaya: ['Papaya', 43, 0.5, 11, 0.3, [], 0],
    dates: ['Dates', 282, 2.5, 75, 0.4, [], 0, ['date', 'dates', 8]],
    almonds: ['Almonds', 590, 21, 21, 50, ['nuts'], 0],
    pbutter: ['Peanut butter', 594, 25, 19, 50, ['nuts'], 0],
    chia: ['Chia seeds', 486, 17, 42, 31, [], 0],
    ghee: ['Ghee', 900, 0, 0, 100, ['dairy'], 1, ['tsp', 'tsp', 5]],
    oil: ['Cooking oil', 884, 0, 0, 100, [], 0, ['tsp', 'tsp', 5]],
    avocado: ['Avocado', 160, 2, 9, 15, [], 0],
    sabzi: ['Mixed vegetable sabzi', 67, 1.7, 6.7, 3.7, [], 0],
    salad: ['Salad (cucumber, tomato, onion)', 20, 1, 4, 0.2, [], 0],
    palak: ['Spinach or greens (cooked)', 45, 3, 4, 2, [], 0],
    broccoli: ['Broccoli or beans (cooked)', 35, 2.4, 7, 0.4, [], 0],
    cocoa: ['Cocoa powder (unsweetened)', 228, 19.6, 57.9, 13.7, [], 0],
    honey: ['Honey', 304, 0.3, 82.4, 0, [], 0],
    darkchoc: ['Dark chocolate (70%)', 546, 7.8, 46, 31, [], 0],
  };
  const FOOD = {};
  for (const id of Object.keys(F)) {
    const a = F[id];
    FOOD[id] = { id, name: a[0], kcal: a[1], protein: a[2], carbs: a[3], fat: a[4], tags: a[5], rank: a[6], unit: a[7] ? { one: a[7][0], many: a[7][1], g: a[7][2] } : null };
  }

  // ---------- meal ideas ----------
  // M(id, name, slot(s), cuisine, quick, items). items: [food, grams, least, most]. Amounts for counted foods are whole pieces.
  const MEALS = [];
  const M = (id, name, slots, cuisine, quick, items) => {
    const list = items.map((it) => {
      const f = FOOD[it[0]];
      if (!f) throw new Error('Unknown food ' + it[0]);
      const step = f.unit ? f.unit.g : it[1] >= 100 ? 10 : 5;
      return { f: it[0], g: it[1], min: it[2], max: it[3], step };
    });
    // Only the foods a meal cannot do without decide whether it suits someone. Optional sides (min 0) are dropped for them instead.
    const tags = new Set();
    let rank = 0;
    for (const it of list) { if (it.min <= 0) continue; for (const t of FOOD[it.f].tags) tags.add(t); rank = Math.max(rank, FOOD[it.f].rank); }
    MEALS.push({ id, name, slots: [].concat(slots), cuisine, quick, items: list, tags: Array.from(tags), rank });
  };

  // breakfast
  M('b_paneer_bhurji', 'Paneer bhurji with roti', 'breakfast', 'indian', true, [['paneer', 100, 50, 200], ['roti', 80, 40, 160], ['salad', 80, 50, 150], ['oil', 5, 0, 15]]);
  M('b_poha', 'Vegetable poha with peanuts and curd', 'breakfast', 'indian', true, [['poha', 200, 120, 350], ['peanuts', 15, 0, 30], ['curd', 100, 0, 250]]);
  M('b_idli', 'Idli with sambar', 'breakfast', 'indian', false, [['idli', 160, 80, 320], ['dal', 150, 100, 300], ['curd', 0, 0, 150]]);
  M('b_dosa', 'Dosa with potato masala and sambar', 'breakfast', 'indian', false, [['dosa', 160, 80, 320], ['potato', 100, 50, 200], ['dal', 120, 60, 250], ['oil', 5, 0, 10]]);
  M('b_egg_bhurji', 'Egg bhurji with roti', 'breakfast', 'indian', true, [['egg', 150, 100, 300], ['roti', 80, 40, 160], ['salad', 80, 50, 150], ['oil', 5, 0, 10]]);
  M('b_sattu', 'Sattu shake with banana and dates', 'breakfast', 'indian', true, [['sattu', 40, 20, 80], ['banana', 118, 0, 236], ['dates', 16, 0, 40], ['soymilk', 200, 0, 400]]);
  M('b_oats_milk', 'Oats with milk, banana and almonds', 'breakfast', 'western', true, [['oats', 60, 40, 100], ['milk', 250, 150, 400], ['banana', 118, 0, 236], ['almonds', 15, 5, 30]]);
  M('b_oats_soy', 'Oats with soy milk, banana and peanut butter', 'breakfast', 'western', true, [['oats', 60, 40, 100], ['soymilk', 250, 150, 400], ['banana', 118, 0, 236], ['pbutter', 20, 10, 40]]);
  M('b_greek_bowl', 'Greek yogurt bowl with berries, oats and chia', 'breakfast', 'western', true, [['greek', 200, 120, 400], ['berries', 100, 50, 200], ['oats', 30, 20, 60], ['chia', 10, 5, 20]]);
  M('b_eggs_toast', 'Scrambled eggs on toast with avocado', 'breakfast', 'western', true, [['egg', 150, 100, 300], ['bread', 64, 32, 160], ['avocado', 50, 0, 100], ['oil', 5, 0, 10]]);
  M('b_tofu_toast', 'Tofu scramble on toast', 'breakfast', 'western', true, [['tofu', 150, 100, 300], ['bread', 64, 32, 160], ['avocado', 50, 0, 100], ['palak', 60, 0, 120]]);
  M('b_pb_toast', 'Peanut butter banana toast with milk', 'breakfast', 'western', true, [['bread', 64, 32, 160], ['pbutter', 30, 15, 50], ['banana', 118, 0, 236], ['milk', 250, 150, 400]]);
  M('b_whey_oats', 'Protein oats with berries', 'breakfast', 'western', true, [['oats', 60, 40, 100], ['whey', 30, 0, 90], ['milk', 250, 150, 400], ['berries', 80, 0, 160]]);
  M('b_eggwhite', 'Egg-white omelette with toast and vegetables', 'breakfast', 'western', true, [['eggwhite', 165, 99, 330], ['egg', 50, 0, 100], ['bread', 64, 32, 160], ['sabzi', 80, 50, 150]]);
  M('b_chicken_wrap', 'Egg and chicken breakfast wrap', 'breakfast', 'western', true, [['egg', 100, 50, 200], ['chicken', 100, 50, 200], ['wrap', 90, 45, 180], ['salad', 60, 30, 120]]);

  // lunch and dinner
  M('l_dal_rice', 'Dal, rice and sabzi with curd', ['lunch', 'dinner'], 'indian', false, [['dal', 250, 150, 400], ['rice', 160, 80, 330], ['sabzi', 150, 100, 250], ['curd', 100, 0, 250], ['ghee', 5, 0, 15]]);
  M('l_rajma', 'Rajma chawal with salad', ['lunch', 'dinner'], 'indian', false, [['rajma', 250, 150, 400], ['rice', 160, 80, 330], ['salad', 100, 50, 200], ['curd', 100, 0, 250]]);
  M('l_chole', 'Chole with roti and salad', ['lunch', 'dinner'], 'indian', false, [['chana', 250, 150, 400], ['roti', 80, 40, 200], ['salad', 100, 50, 200], ['curd', 100, 0, 250]]);
  M('l_paneer_curry', 'Paneer curry with roti and sabzi', ['lunch', 'dinner'], 'indian', false, [['paneer', 120, 60, 220], ['roti', 120, 80, 240], ['sabzi', 150, 100, 250], ['salad', 80, 50, 150], ['oil', 5, 0, 15]]);
  M('l_soya_pulao', 'Soya chunk pulao with curd', ['lunch', 'dinner'], 'indian', false, [['soya', 40, 25, 80], ['rice', 200, 100, 350], ['sabzi', 150, 100, 250], ['curd', 100, 0, 250], ['oil', 5, 0, 15]]);
  M('l_egg_curry', 'Egg curry with rice', ['lunch', 'dinner'], 'indian', false, [['egg', 200, 100, 350], ['rice', 160, 80, 330], ['sabzi', 100, 60, 200], ['salad', 80, 50, 150], ['oil', 5, 0, 15]]);
  M('l_chicken_curry', 'Chicken curry with roti and salad', ['lunch', 'dinner'], 'indian', false, [['chicken', 180, 100, 320], ['roti', 80, 40, 200], ['sabzi', 100, 60, 200], ['salad', 80, 50, 150], ['oil', 5, 0, 15]]);
  M('l_fish_curry', 'Fish curry with rice', ['lunch', 'dinner'], 'indian', false, [['fish', 180, 100, 320], ['rice', 180, 100, 330], ['sabzi', 100, 60, 200], ['salad', 80, 50, 150], ['oil', 5, 0, 15]]);
  M('l_tofu_rice', 'Tofu and broccoli stir-fry with rice', ['lunch', 'dinner'], 'any', true, [['tofu', 180, 100, 320], ['rice', 200, 100, 350], ['broccoli', 150, 80, 250], ['oil', 5, 0, 15]]);
  M('l_quinoa_bowl', 'Quinoa chickpea bowl with avocado', ['lunch', 'dinner'], 'western', true, [['quinoa', 180, 100, 320], ['chana', 150, 100, 280], ['salad', 100, 50, 200], ['avocado', 50, 0, 100], ['oil', 5, 0, 10]]);
  M('l_pasta_paneer', 'Whole wheat pasta with paneer and broccoli', ['lunch', 'dinner'], 'western', true, [['pasta', 220, 120, 350], ['paneer', 100, 50, 200], ['broccoli', 120, 60, 220], ['oil', 5, 0, 10]]);
  M('l_paneer_wrap', 'Paneer wrap with salad and curd', ['lunch', 'dinner'], 'western', true, [['wrap', 90, 45, 225], ['paneer', 100, 50, 200], ['salad', 100, 50, 200], ['curd', 50, 0, 200]]);
  M('l_chicken_rice', 'Grilled chicken, rice and greens', ['lunch', 'dinner'], 'western', true, [['chicken', 180, 100, 320], ['rice', 180, 100, 350], ['broccoli', 150, 80, 250], ['oil', 5, 0, 15]]);
  M('l_tuna_bowl', 'Tuna quinoa bowl', ['lunch', 'dinner'], 'western', true, [['tuna', 120, 80, 220], ['quinoa', 180, 100, 320], ['salad', 100, 50, 200], ['avocado', 50, 0, 100], ['oil', 5, 0, 10]]);
  M('d_palak_paneer', 'Palak paneer with roti', 'dinner', 'indian', false, [['paneer', 100, 50, 200], ['palak', 200, 120, 320], ['roti', 120, 80, 240], ['salad', 80, 50, 150], ['oil', 5, 0, 15]]);
  M('d_khichdi', 'Dal khichdi with curd', 'dinner', 'indian', false, [['rice', 120, 80, 250], ['dal', 200, 120, 320], ['sabzi', 100, 60, 200], ['curd', 100, 0, 250], ['ghee', 5, 0, 15]]);
  M('d_dal_roti', 'Moong dal, roti and sabzi', 'dinner', 'indian', false, [['dal', 250, 150, 400], ['roti', 120, 80, 240], ['sabzi', 150, 100, 250], ['salad', 60, 30, 150]]);
  M('d_tofu_bhurji', 'Tofu bhurji with roti', 'dinner', 'indian', false, [['tofu', 150, 100, 300], ['roti', 120, 80, 240], ['sabzi', 120, 60, 220], ['oil', 5, 0, 15]]);
  M('d_paneer_tikka', 'Paneer tikka with roti and salad', 'dinner', 'indian', true, [['paneer', 120, 60, 220], ['roti', 80, 40, 200], ['salad', 150, 80, 250], ['oil', 5, 0, 10]]);
  M('d_soya_curry', 'Soya chunk curry with rice', 'dinner', 'indian', false, [['soya', 40, 25, 80], ['rice', 160, 80, 330], ['sabzi', 100, 60, 200], ['oil', 5, 0, 15]]);
  M('d_egg_roti', 'Egg curry with roti', 'dinner', 'indian', false, [['egg', 150, 100, 300], ['roti', 120, 80, 240], ['sabzi', 100, 60, 200], ['salad', 60, 30, 150], ['oil', 5, 0, 15]]);
  M('d_chicken_rice', 'Chicken curry with rice', 'dinner', 'indian', false, [['chicken', 180, 100, 320], ['rice', 160, 80, 330], ['sabzi', 100, 60, 200], ['salad', 60, 30, 150], ['oil', 5, 0, 15]]);
  M('d_prawn_roti', 'Prawn masala with roti', 'dinner', 'indian', false, [['shrimp', 150, 100, 280], ['roti', 120, 80, 240], ['sabzi', 100, 60, 200], ['salad', 60, 30, 150], ['oil', 5, 0, 15]]);
  M('d_tofu_quinoa', 'Stir-fried tofu and vegetables with quinoa', 'dinner', 'western', true, [['tofu', 150, 100, 300], ['quinoa', 150, 80, 300], ['broccoli', 150, 80, 250], ['oil', 5, 0, 15]]);
  M('d_lentil_sweet', 'Lentils with sweet potato and salad', 'dinner', 'western', false, [['dal', 250, 150, 400], ['sweetpotato', 200, 100, 320], ['salad', 100, 50, 200], ['avocado', 40, 0, 80]]);
  M('d_omelette', 'Vegetable omelette with toast and salad', 'dinner', 'western', true, [['egg', 150, 100, 300], ['bread', 64, 32, 160], ['salad', 100, 50, 200], ['sabzi', 100, 60, 200], ['oil', 5, 0, 10]]);
  M('d_chicken_sweet', 'Grilled chicken with sweet potato and greens', 'dinner', 'western', true, [['chicken', 180, 100, 320], ['sweetpotato', 200, 100, 320], ['broccoli', 150, 80, 250], ['oil', 5, 0, 15]]);
  M('d_fish_potato', 'Baked fish with potatoes and salad', 'dinner', 'western', true, [['fish', 180, 100, 320], ['potato', 200, 100, 350], ['broccoli', 100, 60, 200], ['oil', 5, 0, 15]]);

  // snacks
  M('s_greek_almond', 'Greek yogurt with almonds and berries', 'snack', 'western', true, [['greek', 170, 100, 340], ['almonds', 15, 0, 30], ['berries', 50, 0, 120]]);
  M('s_chana_fruit', 'Chana and an apple', 'snack', 'indian', true, [['chana', 100, 50, 200], ['apple', 180, 0, 360]]);
  M('s_sprouts', 'Sprouts chaat', 'snack', 'indian', true, [['sprouts', 150, 100, 250], ['salad', 80, 0, 160], ['chana', 50, 0, 120]]);
  M('s_whey_shake', 'Whey shake with banana', 'snack', 'western', true, [['whey', 30, 30, 90], ['milk', 250, 150, 400], ['banana', 118, 0, 236]]);
  M('s_plant_shake', 'Plant protein shake with banana', 'snack', 'western', true, [['peaprot', 30, 30, 90], ['soymilk', 250, 150, 400], ['banana', 118, 0, 236]]);
  M('s_paneer_fruit', 'Paneer cubes with fruit', 'snack', 'indian', true, [['paneer', 60, 40, 150], ['apple', 180, 0, 360]]);
  M('s_pb_toast', 'Peanut butter on toast', 'snack', 'western', true, [['bread', 32, 32, 96], ['pbutter', 20, 10, 40]]);
  M('s_eggs_fruit', 'Boiled eggs with an orange', 'snack', 'any', true, [['egg', 100, 50, 200], ['orange', 130, 0, 260], ['almonds', 10, 0, 20]]);
  M('s_sattu_dates', 'Sattu drink with dates', 'snack', 'indian', true, [['sattu', 40, 20, 80], ['dates', 16, 0, 48]]);
  M('s_curd_papaya', 'Curd with papaya and chia', 'snack', 'indian', true, [['curd', 200, 100, 350], ['papaya', 100, 50, 200], ['chia', 10, 0, 20]]);
  M('s_chicken_bites', 'Chicken tikka bites with curd', 'snack', 'indian', true, [['chicken', 100, 60, 200], ['salad', 80, 0, 160], ['curd', 50, 0, 150]]);
  M('s_peanut_banana', 'Roasted peanuts and a banana', 'snack', 'any', true, [['peanuts', 25, 15, 50], ['banana', 118, 0, 236]]);
  M('s_soya_chaat', 'Soya chunk chaat', 'snack', 'indian', true, [['soya', 25, 15, 50], ['salad', 100, 50, 200], ['oil', 0, 0, 10]]);
  M('s_tuna_toast', 'Tuna on toast', 'snack', 'western', true, [['tuna', 80, 50, 160], ['bread', 32, 32, 96], ['salad', 60, 0, 120]]);

  // desserts ("surprise me"): not part of the daily meal slots, only offered on request.
  M('x_choc_greek', 'Chocolate Greek yogurt with berries', 'dessert', 'western', true, [['greek', 200, 150, 400], ['cocoa', 8, 5, 15], ['honey', 10, 0, 20], ['berries', 60, 0, 150]]);
  M('x_choc_pudding', 'Chocolate protein pudding', 'dessert', 'western', true, [['whey', 30, 30, 60], ['milk', 150, 100, 300], ['chia', 15, 10, 30], ['cocoa', 5, 0, 10]]);
  M('x_vegan_pudding', 'Vegan chocolate protein pudding', 'dessert', 'western', true, [['peaprot', 30, 30, 60], ['soymilk', 150, 100, 300], ['chia', 15, 10, 30], ['cocoa', 5, 0, 10]]);
  M('x_paneer_honey', 'Sweet paneer bites with honey and almonds', 'dessert', 'indian', true, [['paneer_lite', 100, 60, 200], ['honey', 12, 0, 24], ['almonds', 10, 0, 20]]);
  M('x_pb_banana_bites', 'Peanut butter banana protein bites', 'dessert', 'western', true, [['banana', 118, 59, 236], ['oats', 20, 10, 40], ['pbutter', 16, 10, 32]]);
  M('x_darkchoc_almond', 'Dark chocolate almond clusters', 'dessert', 'any', true, [['darkchoc', 20, 10, 40], ['almonds', 15, 10, 30], ['chia', 8, 0, 16]]);
  M('x_curd_dates', 'Sweetened curd with dates and almonds', 'dessert', 'indian', true, [['curd', 200, 150, 350], ['dates', 16, 8, 32], ['almonds', 10, 0, 20]]);
  M('x_chia_pudding', 'Berry chia pudding with milk', 'dessert', 'western', true, [['chia', 25, 20, 50], ['milk', 150, 100, 300], ['berries', 60, 0, 150], ['honey', 8, 0, 16]]);
  M('x_date_energy_balls', 'Date and peanut energy balls', 'dessert', 'indian', true, [['dates', 40, 24, 80], ['peanuts', 20, 10, 40], ['oats', 15, 0, 30]]);
  M('x_sattu_ladoo', 'Sattu and honey ladoo', 'dessert', 'indian', true, [['sattu', 30, 20, 60], ['honey', 12, 6, 24], ['ghee', 3, 0, 10]]);
  M('x_peaprot_bites', 'Vegan protein energy bites', 'dessert', 'western', true, [['peaprot', 20, 15, 40], ['oats', 30, 20, 60], ['pbutter', 15, 10, 30], ['dates', 16, 0, 32]]);

  // ---------- slots ----------
  // Share of the day for each meal, by how many meals a day.
  const SLOT_SHARE = {
    3: { breakfast: 0.28, lunch: 0.37, dinner: 0.35 },
    4: { breakfast: 0.25, lunch: 0.33, evening: 0.12, dinner: 0.30 },
    5: { breakfast: 0.22, morning: 0.10, lunch: 0.30, evening: 0.10, dinner: 0.28 },
  };
  const SLOT_INFO = {
    breakfast: { label: 'Breakfast', meal: 'Breakfast', kind: 'breakfast', until: 11 },
    morning: { label: 'Mid-morning snack', meal: 'Snack', kind: 'snack', until: 12.5 },
    lunch: { label: 'Lunch', meal: 'Lunch', kind: 'lunch', until: 16 },
    evening: { label: 'Evening snack', meal: 'Snack', kind: 'snack', until: 18.5 },
    dinner: { label: 'Dinner', meal: 'Dinner', kind: 'dinner', until: 30 },
    dessert: { label: 'Dessert', meal: 'Snack', kind: 'dessert', until: 30 },
  };
  const slotIds = (meals) => Object.keys(SLOT_SHARE[meals] || SLOT_SHARE[4]);

  // ---------- preferences ----------
  // The preferences to use: what is saved, filled in from the profile where the style says "follow the profile".
  function effective(state) {
    const saved = (state && state.dietPrefs) || E.defaultDietPrefs();
    const p = Object.assign({}, E.defaultDietPrefs(), saved);
    p.styleSet = p.style;
    p.style = p.style || E.styleFromProfile(state && state.profile && state.profile.diet);
    return p;
  }
  const RANK_OF_STYLE = { vegan: 0, veg: 1, egg: 2, pesc: 3, any: 4 };
  const foodAllowed = (f, prefs) => FOOD[f].rank <= RANK_OF_STYLE[prefs.style] && !FOOD[f].tags.some((t) => prefs.avoid.includes(t));
  const disliked = (name, prefs) => { const n = name.toLowerCase(); return prefs.dislikes.some((d) => n.includes(d)); };
  function allowed(meal, prefs, opts) {
    const o = opts || {};
    if (meal.rank > RANK_OF_STYLE[prefs.style]) return false;
    if (meal.tags.some((t) => prefs.avoid.includes(t))) return false;
    if (prefs.cuisine === 'indian' && meal.cuisine === 'western') return false;
    if (prefs.cuisine === 'western' && meal.cuisine === 'indian') return false;
    if (!o.relax && prefs.quick && !meal.quick) return false;
    if (!o.relax && (disliked(meal.name, prefs) || meal.items.some((it) => it.min > 0 && disliked(FOOD[it.f].name, prefs)))) return false;
    return true;
  }
  // The meal ideas that fit the preferences for a kind of meal. If the filters leave nothing, the softer ones are dropped first.
  function pool(kind, prefs) {
    const of = (meal) => meal.slots.includes(kind) || (kind === 'snack' && meal.slots.includes('snack'));
    let list = MEALS.filter((m) => of(m) && allowed(m, prefs));
    if (!list.length) list = MEALS.filter((m) => of(m) && allowed(m, prefs, { relax: true }));
    return list;
  }

  // ---------- fitting a meal to a target ----------
  const mac = (fid, g) => { const f = FOOD[fid], k = g / 100; return { kcal: f.kcal * k, protein: f.protein * k, carbs: f.carbs * k, fat: f.fat * k }; };
  function sum(items) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    for (const it of items) { const m = mac(it.f, it.g); t.kcal += m.kcal; t.protein += m.protein; t.carbs += m.carbs; t.fat += m.fat; }
    return t;
  }
  // How far a meal is from its share: each nutrient is judged against what a person would notice.
  function cost(t, target) {
    const e = (a, b, tol) => ((a - b) / tol) * ((a - b) / tol);
    // Falling short on protein matters more than going a little over it.
    return e(t.kcal, target.kcal, 50) + e(t.protein, target.protein, t.protein > target.protein ? 12 : 4) + e(t.carbs, target.carbs, 8) + e(t.fat, target.fat, 3);
  }
  // Nudges amounts one step at a time (never outside their least and most) while it gets closer to the target.
  function fitItems(items, target) {
    const cur = items.map((it) => Object.assign({}, it));
    let best = cost(sum(cur), target);
    for (let iter = 0; iter < 240; iter++) {
      let move = null;
      for (let i = 0; i < cur.length; i++) {
        for (const d of [-2, -1, 1, 2]) {
          const g = E.clamp(cur[i].g + d * cur[i].step, cur[i].min, cur[i].max);
          if (g === cur[i].g) continue;
          const old = cur[i].g; cur[i].g = g;
          const c = cost(sum(cur), target);
          cur[i].g = old;
          if (c < best - 1e-9 && (!move || c < move.c)) move = { i, g, c };
        }
      }
      if (!move) break;
      cur[move.i].g = move.g; best = move.c;
    }
    return { items: cur, cost: best };
  }
  // A protein food for the person's diet, in the order most people would reach for it.
  const BOOSTERS = ['whey', 'greek', 'paneer_lite', 'eggwhite', 'tuna', 'chicken', 'peaprot', 'tofu', 'soya'];
  function booster(prefs, skipIds) {
    for (const id of BOOSTERS) {
      if (skipIds && skipIds.includes(id)) continue;
      if (foodAllowed(id, prefs) && !disliked(FOOD[id].name, prefs)) return id;
    }
    return null;
  }
  function fitMeal(meal, target, prefs, used) {
    // Optional sides that clash with the preferences (curd for a vegan, say) are left out.
    const base = meal.items.filter((it) => it.max > 0 && (it.min > 0 || (foodAllowed(it.f, prefs) && !disliked(FOOD[it.f].name, prefs)))).map((it) => ({ f: it.f, g: E.clamp(it.g, it.min, it.max), min: it.min, max: it.max, step: it.step }));
    let r = fitItems(base, target), added = null;
    const gap = target.protein - sum(r.items).protein;
    if (gap > Math.max(6, target.protein * 0.12)) {
      const have = r.items.map((x) => x.f).concat(used || []);
      const b = booster(prefs, have) || booster(prefs, r.items.map((x) => x.f));
      if (b) {
        const fb = FOOD[b], step = fb.unit ? fb.unit.g : 10;
        const withB = r.items.concat([{ f: b, g: step, min: 0, max: fb.unit ? fb.unit.g * 3 : 250, step }]);
        const r2 = fitItems(withB, target);
        if (r2.cost < r.cost) { r = r2; if (r2.items.some((x) => x.f === b && x.g > 0)) added = b; }
      }
    }
    return { items: r.items.filter((it) => it.g > 0), cost: r.cost, added };
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  function describe(fid, g) {
    const f = FOOD[fid];
    if (f.unit && f.unit.g > 1) { const n = Math.round(g / f.unit.g); return n + ' ' + (n === 1 ? f.unit.one : f.unit.many) + (f.unit.one === 'tsp' ? '' : ' (' + Math.round(g) + ' g)'); }
    if (f.unit && f.unit.one === 'ml') return Math.round(g) + ' ml';
    return Math.round(g) + ' g';
  }
  // A meal's name without the optional sides that were left out (no "with curd" on a vegan plate).
  const NAME_WORDS = { curd: 'curd', peanuts: 'peanuts', almonds: 'almonds', avocado: 'avocado' };
  function nameOf(meal, fitted) {
    let n = meal.name;
    for (const it of meal.items) {
      const w = NAME_WORDS[it.f];
      if (w && !fitted.items.some((x) => x.f === it.f && x.g > 0)) n = n.replace(new RegExp('(,| with| and) ' + w, 'i'), '');
    }
    return n;
  }
  function shape(meal, fitted, slotId, extra) {
    const items = fitted.items.map((it) => {
      const m = mac(it.f, it.g);
      return { id: it.f, name: FOOD[it.f].name, grams: Math.round(it.g), label: describe(it.f, it.g), kcal: Math.round(m.kcal), protein: r1(m.protein), carbs: r1(m.carbs), fat: r1(m.fat) };
    });
    const t = items.reduce((a, x) => ({ kcal: a.kcal + x.kcal, protein: a.protein + x.protein, carbs: a.carbs + x.carbs, fat: a.fat + x.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    return Object.assign({ slot: slotId, label: SLOT_INFO[slotId].label, meal: SLOT_INFO[slotId].meal, idea: meal.id, name: nameOf(meal, fitted), items, kcal: t.kcal, protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) }, extra || {});
  }

  // ---------- the weekly plan ----------
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  function pick(list, prefs, slotId, day, salt) {
    const n = list.length;
    if (!n) return null;
    const strides = [];
    for (let s = 1; s < Math.max(2, n); s++) if (gcd(s, n) === 1) strides.push(s);
    const start = hash('start' + prefs.seed + slotId) % n;
    const stride = strides.length ? strides[hash('stride' + prefs.seed + slotId) % strides.length] : 1;
    return list[(start + stride * day + (prefs.swaps[day + ':' + slotId] || 0) + (salt || 0)) % n];
  }
  function targetsOf(plan) { return { kcal: plan.kcal, protein: plan.protein, carbs: plan.carbs, fat: plan.fat }; }
  // One day: every meal, fitted, and how close the whole day lands to the plan's targets.
  function buildDay(plan, prefs, day) {
    const ids = slotIds(prefs.meals), share = SLOT_SHARE[prefs.meals] || SLOT_SHARE[4], tg = targetsOf(plan);
    const meals = [], used = [], ideasToday = new Set(), soFar = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    for (const id of ids) {
      const list = pool(SLOT_INFO[id].kind, prefs);
      let idea = null;
      for (let salt = 0; salt < Math.max(1, list.length); salt++) {
        idea = pick(list, prefs, id, day, salt);
        if (!idea || !ideasToday.has(idea.id) || list.length < 2) break;
      }
      if (!idea) { meals.push({ slot: id, label: SLOT_INFO[id].label, meal: SLOT_INFO[id].meal, idea: null, name: 'No meal idea fits these preferences', items: [], kcal: 0, protein: 0, carbs: 0, fat: 0 }); continue; }
      ideasToday.add(idea.id);
      // Each meal aims at its share of what is still missing from the day, so a meal that could not reach its share is made up by the next.
      const restShare = ids.slice(ids.indexOf(id)).reduce((a, x) => a + share[x], 0), k = share[id] / restShare;
      const t = { kcal: Math.max(0, (tg.kcal - soFar.kcal) * k), protein: Math.max(0, (tg.protein - soFar.protein) * k), carbs: Math.max(0, (tg.carbs - soFar.carbs) * k), fat: Math.max(0, (tg.fat - soFar.fat) * k) };
      const fit = fitMeal(idea, t, prefs, used);
      if (fit.added) used.push(fit.added);
      const m = shape(idea, fit, id);
      soFar.kcal += m.kcal; soFar.protein += m.protein; soFar.carbs += m.carbs; soFar.fat += m.fat;
      meals.push(m);
    }
    const totals = meals.reduce((a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    totals.protein = r1(totals.protein); totals.carbs = r1(totals.carbs); totals.fat = r1(totals.fat);
    return { day, meals, totals, targets: tg, off: { kcal: totals.kcal - tg.kcal, protein: r1(totals.protein - tg.protein), carbs: r1(totals.carbs - tg.carbs), fat: r1(totals.fat - tg.fat) } };
  }
  function buildWeek(plan, prefs) { const out = []; for (let d = 0; d < 7; d++) out.push(buildDay(plan, prefs, d)); return out; }
  // Swaps one meal for the next idea in its list, by bumping its swap count. Returns the new preferences to save.
  function swapMeal(prefs, day, slotId) {
    const key = day + ':' + slotId, swaps = Object.assign({}, prefs.swaps);
    swaps[key] = ((swaps[key] || 0) % 59) + 1;
    return Object.assign({}, prefs, { swaps });
  }
  // What to store: the style is null while it follows the profile.
  const savable = (prefs) => ({ style: prefs.styleSet === undefined ? prefs.style : prefs.styleSet, cuisine: prefs.cuisine, meals: prefs.meals, avoid: prefs.avoid, dislikes: prefs.dislikes, quick: prefs.quick, seed: prefs.seed, swaps: prefs.swaps });

  // ---------- what to eat next ----------
  function dayTotals(state, date) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, n: 0 };
    for (const f of state.foods) if (f.date === date) { t.kcal += f.kcal || 0; t.protein += f.protein || 0; t.carbs += f.carbs || 0; t.fat += f.fat || 0; t.n++; }
    return t;
  }
  // Which planned meals already have something logged today. Snacks fill the first free snack slot.
  function eatenSlots(state, date, ids) {
    const eaten = new Set(), by = {};
    for (const f of state.foods) if (f.date === date) by[f.meal] = (by[f.meal] || 0) + 1;
    for (const id of ids) {
      const info = SLOT_INFO[id];
      if (info.meal !== 'Snack' && by[info.meal]) eaten.add(id);
    }
    let snacks = (by.Snack || 0) + (by['Pre-workout'] || 0) + (by['Post-workout'] || 0);
    for (const id of ids) if (SLOT_INFO[id].meal === 'Snack' && snacks > 0) { eaten.add(id); snacks = 0; }
    return eaten;
  }
  // The next meal to plan for, by the clock, among the ones not yet logged.
  function nextSlot(ids, eaten, hour) {
    const open = ids.filter((id) => !eaten.has(id));
    if (!open.length) return null;
    for (const id of open) if (hour < SLOT_INFO[id].until) return id;
    return open[open.length - 1];
  }
  // Foods that close a protein gap without many calories, for when little room is left.
  function topUps(rem, prefs) {
    const out = [];
    if (rem.protein < 8) return out;
    for (const id of ['greek', 'eggwhite', 'tuna', 'whey', 'peaprot', 'paneer_lite', 'chicken', 'tofu', 'soya']) {
      if (out.length >= 2) break;
      if (!foodAllowed(id, prefs) || disliked(FOOD[id].name, prefs)) continue;
      const f = FOOD[id], perG = f.protein / 100;
      let g = Math.min(rem.protein / perG, 300);
      if (f.unit && f.unit.g > 1) g = Math.max(f.unit.g, Math.round(g / f.unit.g) * f.unit.g); else g = Math.max(20, Math.round(g / 10) * 10);
      const m = mac(id, g);
      if (m.kcal > Math.max(rem.kcal, 0) + 60) continue;
      out.push({ id, name: f.name, grams: Math.round(g), label: describe(id, g), kcal: Math.round(m.kcal), protein: r1(m.protein), carbs: r1(m.carbs), fat: r1(m.fat) });
    }
    return out;
  }
  function eatNext(state, prefs, date, opts) {
    const o = opts || {}, plan = state.plan, tg = targetsOf(plan), ids = slotIds(prefs.meals), share = SLOT_SHARE[prefs.meals] || SLOT_SHARE[4];
    const tot = dayTotals(state, date), eaten = eatenSlots(state, date, ids);
    const rem = { kcal: tg.kcal - tot.kcal, protein: r1(tg.protein - tot.protein), carbs: r1(tg.carbs - tot.carbs), fat: r1(tg.fat - tot.fat) };
    const hour = o.hour == null ? 12 : o.hour;
    const slot = o.slot && ids.includes(o.slot) ? o.slot : nextSlot(ids, eaten, hour);
    const out = { date, remaining: rem, eaten: Array.from(eaten), slots: ids.map((id) => ({ id, label: SLOT_INFO[id].label, eaten: eaten.has(id) })), slot, suggestions: [], topUps: [], status: 'ok' };
    if (rem.kcal < 120) { out.status = 'done'; out.topUps = topUps(rem, prefs); return out; }
    if (!slot) { out.status = 'open'; return out; }
    // This meal gets its share of what is left, among the meals still to come today.
    const later = ids.filter((id) => !eaten.has(id) && ids.indexOf(id) >= ids.indexOf(slot));
    const denom = later.reduce((a, id) => a + share[id], 0) || 1, k = share[slot] / denom;
    const target = { kcal: Math.max(rem.kcal * k, 0), protein: Math.max(rem.protein * k, 0), carbs: Math.max(rem.carbs * k, 0), fat: Math.max(rem.fat * k, 0) };
    out.target = { kcal: Math.round(target.kcal), protein: r1(target.protein), carbs: r1(target.carbs), fat: r1(target.fat) };
    const logged = state.foods.filter((f) => f.date === date).map((f) => String(f.name || '').toLowerCase());
    const list = pool(SLOT_INFO[slot].kind, prefs);
    // The idea the week's plan has for this slot today, so it can be tagged and nudged up the list.
    const dayIdx = (E.weekdayOf(date) + 6) % 7, pm = buildDay(plan, prefs, dayIdx).meals.find((m) => m.slot === slot), plannedIdea = pm && pm.idea ? { id: pm.idea } : null;
    const scored = list.map((idea) => {
      const fitted = fitMeal(idea, target, prefs);
      const main = FOOD[idea.items[0].f].name.toLowerCase().split(/[ (,]/)[0];
      const repeat = logged.some((n) => n.includes(main)) ? 4 : 0;
      return { idea, fitted, score: fitted.cost + repeat + (plannedIdea && idea.id === plannedIdea.id ? -2 : 0) };
    }).sort((a, b) => a.score - b.score || (a.idea.id < b.idea.id ? -1 : 1));
    const seenMain = new Set();
    for (const s of scored) {
      const key = s.idea.items[0].f;
      if (seenMain.has(key)) continue;
      seenMain.add(key);
      out.suggestions.push(shape(s.idea, s.fitted, slot, { fromPlan: !!(plannedIdea && s.idea.id === plannedIdea.id) }));
      if (out.suggestions.length >= 3) break;
    }
    // A protein top-up when protein is the part that is behind.
    if (rem.protein > 12 && rem.protein * 4 > rem.kcal * 0.45) out.topUps = topUps(rem, prefs);
    return out;
  }

  // ---------- surprise me (a treat) ----------
  // A healthy, high-protein dessert idea sized to what is left of today's calories. Not part of the meal plan or its
  // slots (a "dessert" idea is only ever offered here, on request), and it is not tied to the time of day.
  function surpriseMe(state, prefs, date, opts) {
    const o = opts || {}, plan = state.plan, tg = targetsOf(plan);
    const tot = dayTotals(state, date);
    const rem = { kcal: tg.kcal - tot.kcal, protein: r1(tg.protein - tot.protein), carbs: r1(tg.carbs - tot.carbs), fat: r1(tg.fat - tot.fat) };
    const out = { date, remaining: rem, suggestion: null, status: 'ok' };
    if (rem.kcal < 60) { out.status = 'none'; return out; }
    // A treat should not eat the whole day's remaining room, and it aims to be high in protein rather than just whatever fits.
    const cap = Math.min(rem.kcal, 320);
    const target = { kcal: cap, protein: cap * 0.2 / 4, carbs: cap * 0.5 / 4, fat: cap * 0.3 / 9 };
    const list = pool('dessert', prefs);
    if (!list.length) { out.status = 'none'; return out; }
    const scored = list.map((idea) => ({ idea, fitted: fitMeal(idea, target, prefs) }))
      .sort((a, b) => a.fitted.cost - b.fitted.cost || (a.idea.id < b.idea.id ? -1 : 1));
    // Picked from among the closest few fits, not always the single best, so asking again can actually surprise.
    const top = scored.slice(0, Math.min(3, scored.length));
    const idx = hash('surprise' + prefs.seed + date + (o.salt || 0)) % top.length;
    out.suggestion = shape(top[idx].idea, top[idx].fitted, 'dessert', {});
    return out;
  }

  const Diet = { FOOD, MEALS, SLOT_INFO, SLOT_SHARE, slotIds, effective, pool, allowed, fitMeal, buildDay, buildWeek, swapMeal, savable, eatNext, surpriseMe, topUps, eatenSlots, nextSlot, dayTotals, describe, mac };
  if (typeof module !== 'undefined' && module.exports) module.exports = Diet;
  else root.Diet = Diet;
})(typeof self !== 'undefined' ? self : this);

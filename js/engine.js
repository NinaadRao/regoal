/*
 * Regoal plan engine. Pure functions only: no DOM, no storage, no network.
 * Works as a classic <script> in the browser (window.Engine) and under Node (module.exports).
 */
(function (root) {
  'use strict';

  const KG_PER_LB = 0.45359237;
  const CM_PER_IN = 2.54;
  const WEEKS = 26;                       // the default length of a plan; a plan can be 4 to 104 weeks (plan.weeks)
  const MIN_WEEKS = 4, MAX_WEEKS = 104;
  const PLAN_LENGTHS = [[4, '1 month'], [9, '2 months'], [13, '3 months'], [26, '6 months'], [39, '9 months'], [52, '12 months']];
  // Every week is a photo check-in week. The weekday it falls on is a setting (Friday by default).
  const PHOTO_WEEKS = Array.from({ length: WEEKS }, (_, i) => i + 1);
  const DELOAD_WEEKS = [7, 14, 21];
  const ANGLES = ['Front', 'Side', 'Back', 'Front flexed', 'Back flexed'];
  // Reps per week for the "heavy" group. Medium is +2, high-rep is +4.
  const HEAVY_WAVE = [8, 9, 10, 6, 7, 8, 8, 9, 10, 6, 7, 8, 9, 8, 10, 6, 7, 8, 9, 10, 8, 6, 7, 8, 9, 10];
  const REP_OFFSET = { heavy: 0, medium: 2, high: 4 };
  const REP_STYLE_SHIFT = { heavy: -2, mixed: 0, pump: 2 };

  // ---------- small helpers ----------
  const clean = (n) => Math.round(n * 1000) / 1000;
  const roundTo = (x, step) => clean(Math.round(x / step) * step);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lbToKg = (lb) => lb * KG_PER_LB;
  const kgToLb = (kg) => kg / KG_PER_LB;
  const inToCm = (i) => i * CM_PER_IN;
  const cmToIn = (c) => c / CM_PER_IN;

  function pad2(n) { return String(n).padStart(2, '0'); }
  // A real calendar date in YYYY-MM-DD form (2026-02-30 and 2026-09-31 are not).
  function validISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(parseISO(s)) === s; }
  function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); }
  function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  function weekOf(startDate, dateStr) { return Math.floor(daysBetween(startDate, dateStr) / 7) + 1; }
  function weekRange(startDate, week) { const s = addDays(startDate, (week - 1) * 7); return [s, addDays(s, 6)]; }
  function weekdayOf(dateStr) { return parseISO(dateStr).getDay(); }

  // ---------- nutrition ----------
  function bmr(sex, kg, cm, age) {
    const base = 10 * kg + 6.25 * cm - 5 * age;
    if (sex === 'male') return base + 5;
    if (sex === 'female') return base - 161;
    return base - 78; // midpoint for "other"
  }
  function maintenance(sex, kg, cm, age, days) {
    return roundTo(bmr(sex, kg, cm, age) * (1.4 + 0.05 * days), 50);
  }
  const GOAL_KCAL_DELTA = { build: 200, recomp: 0, cut: -300 };
  function targetsFor(goal, p) {
    const m = maintenance(p.sex, p.kg, p.cm, p.age, p.days);
    const kcal = m + (GOAL_KCAL_DELTA[goal] || 0);
    const protein = roundTo(2.4 * p.kg, 5);
    const fat = roundTo(1.3 * p.kg, 5);
    const carbs = Math.max(0, roundTo((kcal - 4 * protein - 9 * fat) / 4, 5));
    return { maintenance: m, kcal, protein, carbs, fat };
  }
  // Suggestion only; the user always picks.
  function recommendGoal(waistCm, heightCm, bodyFatPct) {
    const ratio = clean(waistCm / heightCm);
    let goal = ratio >= 0.5 ? 'cut' : ratio >= 0.45 ? 'recomp' : 'build';
    if (bodyFatPct) {
      if (bodyFatPct >= 25) goal = 'cut';
      else if (bodyFatPct >= 20 && goal === 'build') goal = 'recomp';
    }
    return { goal, ratio: Math.round(ratio * 100) / 100 };
  }

  // ---------- measurement targets (offsets in inches, stored as cm) ----------
  const MEAS_OFFSETS_IN = {
    recomp: { shoulders: 1.25, chest: 1.25, bicep: 0.6, forearm: 0.3, waist: -1.0, hips: -0.4 },
    build: { shoulders: 1.5, chest: 1.5, bicep: 0.75, forearm: 0.4, waist: 0.5, hips: 0.5 },
    cut: { shoulders: 0.5, chest: 0.5, bicep: 0.2, forearm: 0.1, waist: -2.0, hips: -1.0 },
  };
  const MEAS_SITES = [
    ['waist', 'Waist'], ['chest', 'Chest'], ['shoulders', 'Shoulders'], ['hips', 'Hips'],
    ['bicepL', 'Bicep L'], ['bicepR', 'Bicep R'], ['forearmL', 'Forearm L'], ['forearmR', 'Forearm R'],
  ];
  function siteKey(site) { return site.replace(/[LR]$/, ''); }
  // Targets are sized for a 6-month plan and scaled to the plan's length (never below a quarter or above double).
  function measurementTargets(goal, meas, weeks) {
    const out = {}, k = clamp((weeks || WEEKS) / WEEKS, 0.25, 2);
    const off = MEAS_OFFSETS_IN[goal] || MEAS_OFFSETS_IN.recomp;
    for (const [site] of MEAS_SITES) {
      if (meas && typeof meas[site] === 'number' && meas[site] > 0) {
        out[site] = { start: meas[site], target: clean(meas[site] + inToCm((off[siteKey(site)] || 0) * k)) };
      }
    }
    return out;
  }

  // ---------- lift catalog and progression ----------
  const CATALOG = {
    flat_db_press: { name: 'Flat DB press', muscle: 'chest', equip: 'db', cls: 'heavy', gain: 0.40, def: [50, 8] },
    incline_db_press: { name: 'Incline DB press', muscle: 'chest', equip: 'db', cls: 'heavy', gain: 0.40, def: [45, 8] },
    shoulder_press: { name: 'Seated DB shoulder press', short: 'Shoulder press', muscle: 'shoulders', equip: 'db', cls: 'medium', gain: 0.25, def: [35, 10] },
    lat_pulldown: { name: 'Lat pulldown', muscle: 'back', equip: 'machine', cls: 'medium', gain: 0.27, def: [130, 10] },
    db_row: { name: 'DB row', muscle: 'back', equip: 'db', cls: 'medium', gain: 0.40, def: [50, 10] },
    curl: { name: 'Strict DB curl', muscle: 'arms', equip: 'db', cls: 'medium', gain: 0.33, def: [30, 10] },
    leg_press: { name: 'Leg press', muscle: 'legs', equip: 'machine', cls: 'heavy', gain: 0.25, def: [270, 8] },
    leg_curl: { name: 'Leg curl', muscle: 'legs', equip: 'machine', cls: 'high', gain: 0.21, def: [150, 12] },
    leg_ext: { name: 'Leg extension', muscle: 'legs', equip: 'machine', cls: 'high', gain: 0.21, def: [150, 12] },
    bulgarian: { name: 'Bulgarian split squat', muscle: 'legs', equip: 'db', cls: 'medium', gain: 0.40, def: [40, 10] },
    pullups: { name: 'Pull-ups', muscle: 'back', equip: 'bw', cls: 'medium', gain: 0, def: [null, 4] },
    barbell_squat: { name: 'Barbell squat', muscle: 'legs', equip: 'barbell', cls: 'heavy', gain: 0.30, def: [95, 8] },
    barbell_bench: { name: 'Barbell bench press', muscle: 'chest', equip: 'barbell', cls: 'heavy', gain: 0.30, def: [95, 8] },
    // More lifts to track after setup. Anything else can be added as a custom lift.
    deadlift: { name: 'Deadlift', muscle: 'back', equip: 'barbell', cls: 'heavy', gain: 0.30, def: [135, 5] },
    rdl: { name: 'Romanian deadlift', muscle: 'legs', equip: 'barbell', cls: 'heavy', gain: 0.30, def: [95, 8] },
    overhead_press: { name: 'Barbell overhead press', short: 'Overhead press', muscle: 'shoulders', equip: 'barbell', cls: 'heavy', gain: 0.25, def: [65, 8] },
    incline_barbell: { name: 'Incline barbell press', muscle: 'chest', equip: 'barbell', cls: 'heavy', gain: 0.30, def: [75, 8] },
    barbell_row: { name: 'Barbell row', muscle: 'back', equip: 'barbell', cls: 'medium', gain: 0.30, def: [95, 8] },
    hip_thrust: { name: 'Hip thrust', muscle: 'legs', equip: 'barbell', cls: 'heavy', gain: 0.30, def: [135, 8] },
    hack_squat: { name: 'Hack squat', muscle: 'legs', equip: 'machine', cls: 'heavy', gain: 0.25, def: [180, 8] },
    machine_press: { name: 'Machine chest press', muscle: 'chest', equip: 'machine', cls: 'medium', gain: 0.27, def: [110, 10] },
    cable_row: { name: 'Seated cable row', muscle: 'back', equip: 'machine', cls: 'medium', gain: 0.27, def: [110, 10] },
    chest_row: { name: 'Chest-supported row', muscle: 'back', equip: 'machine', cls: 'medium', gain: 0.27, def: [90, 10] },
    dips: { name: 'Dips', muscle: 'chest', equip: 'bw', cls: 'medium', gain: 0, def: [null, 6] },
    chinups: { name: 'Chin-ups', muscle: 'back', equip: 'bw', cls: 'medium', gain: 0, def: [null, 5] },
    hammer_curl: { name: 'Hammer curl', muscle: 'arms', equip: 'db', cls: 'medium', gain: 0.33, def: [30, 10] },
    ez_curl: { name: 'EZ-bar curl', muscle: 'arms', equip: 'barbell', cls: 'medium', gain: 0.30, def: [55, 10] },
    preacher_curl: { name: 'Preacher curl', muscle: 'arms', equip: 'machine', cls: 'medium', gain: 0.27, def: [50, 10] },
    pushdown: { name: 'Triceps pushdown', muscle: 'arms', equip: 'machine', cls: 'medium', gain: 0.27, def: [50, 10] },
    oh_tri: { name: 'Overhead triceps extension', muscle: 'arms', equip: 'db', cls: 'medium', gain: 0.30, def: [40, 10] },
    lateral_raise: { name: 'Lateral raise', muscle: 'shoulders', equip: 'db', cls: 'high', gain: 0.20, def: [15, 15] },
    rear_delt: { name: 'Rear-delt fly', muscle: 'shoulders', equip: 'machine', cls: 'high', gain: 0.20, def: [50, 15] },
    face_pull: { name: 'Face pull', muscle: 'shoulders', equip: 'machine', cls: 'high', gain: 0.20, def: [50, 15] },
    db_shrug: { name: 'DB shrug', muscle: 'shoulders', equip: 'db', cls: 'medium', gain: 0.30, def: [60, 12] },
    cable_fly: { name: 'Cable fly', muscle: 'chest', equip: 'machine', cls: 'high', gain: 0.25, def: [30, 12] },
    goblet_squat: { name: 'Goblet squat', muscle: 'legs', equip: 'db', cls: 'medium', gain: 0.35, def: [50, 10] },
    lunge: { name: 'Walking lunge', muscle: 'legs', equip: 'db', cls: 'medium', gain: 0.35, def: [30, 10] },
    calf_raise: { name: 'Calf raise', muscle: 'legs', equip: 'machine', cls: 'high', gain: 0.20, def: [180, 15] },
    cable_crunch: { name: 'Cable crunch', muscle: 'core', equip: 'machine', cls: 'high', gain: 0.25, def: [80, 12] },
  };
  const LIFT_MUSCLES = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];
  const LIFT_EQUIP = ['db', 'machine', 'barbell', 'bw'];
  const LIFT_CLS = ['heavy', 'medium', 'high'];
  // How much a lift is expected to grow over the plan, by type, when the person adds their own lift.
  function defaultGain(cls, equip) { return equip === 'bw' ? 0 : cls === 'heavy' ? (equip === 'barbell' ? 0.30 : 0.25) : cls === 'high' ? 0.20 : 0.27; }
  const DEFAULT_LIFT_ORDER = ['flat_db_press', 'incline_db_press', 'shoulder_press', 'lat_pulldown', 'db_row', 'curl', 'leg_press', 'leg_curl', 'leg_ext', 'bulgarian', 'pullups', 'barbell_squat'];

  // ---------- exercise substitution ("Switch") ----------
  // A short list of common exercises for each muscle group that are not in CATALOG (no weight progression tracked),
  // used so "Switch" has something to suggest even for template accessories like "Single-arm cable pulldown".
  const ACCESSORY_POOL = [
    { n: 'Push-up', m: 'chest', equip: 'bw' }, { n: 'Incline push-up', m: 'chest', equip: 'bw' },
    { n: 'Resistance band chest press', m: 'chest', equip: 'band' }, { n: 'Dumbbell floor press', m: 'chest', equip: 'db' },
    { n: 'Inverted row', m: 'back', equip: 'bw' }, { n: 'One-arm dumbbell row', m: 'back', equip: 'db' },
    { n: 'Resistance band pulldown', m: 'back', equip: 'band' }, { n: 'Straight-arm pulldown', m: 'back', equip: 'machine' },
    { n: 'Pike push-up', m: 'shoulders', equip: 'bw' }, { n: 'Band lateral raise', m: 'shoulders', equip: 'band' },
    { n: 'Dumbbell Arnold press', m: 'shoulders', equip: 'db' },
    { n: 'Band curl', m: 'arms', equip: 'band' }, { n: 'Diamond push-up', m: 'arms', equip: 'bw' },
    { n: 'Chair dip', m: 'arms', equip: 'bw' }, { n: 'Resistance band pushdown', m: 'arms', equip: 'band' },
    { n: 'Bodyweight squat', m: 'legs', equip: 'bw' }, { n: 'Walking lunge', m: 'legs', equip: 'db' },
    { n: 'Step-up', m: 'legs', equip: 'db' }, { n: 'Wall sit', m: 'legs', equip: 'bw' },
    { n: 'Plank', m: 'core', equip: 'bw' }, { n: 'Bicycle crunch', m: 'core', equip: 'bw' }, { n: 'Band pallof press', m: 'core', equip: 'band' },
  ];
  const EQUIP_LIST = ['db', 'machine', 'barbell', 'bw', 'band', 'other'];
  const EQUIP_HINT = [[/dumbbell|\bdb\b/i, 'db'], [/barbell/i, 'barbell'], [/cable|machine|pulldown|leg press|pec deck|smith/i, 'machine'], [/push-?up|pull-?up|chin-?up|\bdip\b|plank|bodyweight|\bbw\b|hang/i, 'bw']];
  function guessEquip(name) { for (const [re, eq] of EQUIP_HINT) if (re.test(name)) return eq; return null; }
  // Rules-based alternatives for one exercise: same muscle group, other exercises from the lift catalog plus
  // ACCESSORY_POOL, with a different piece of equipment listed first. No network, works offline.
  // orig: { name, muscle, equip (optional), sets, reps, kg (kg or null), bw }
  function substituteCandidates(orig) {
    const wantMuscle = orig && orig.muscle, origSlug = slug((orig && orig.name) || ''), origEquip = (orig && orig.equip) || guessEquip((orig && orig.name) || '');
    if (!wantMuscle) return [];
    const seen = new Set([origSlug]);
    const pool = [];
    for (const c of Object.values(CATALOG)) {
      if (c.muscle !== wantMuscle) continue;
      const s = slug(c.name);
      if (seen.has(s)) continue;
      seen.add(s); pool.push({ name: c.name, equip: c.equip });
    }
    for (const a of ACCESSORY_POOL) {
      if (a.m !== wantMuscle) continue;
      const s = slug(a.n);
      if (seen.has(s)) continue;
      seen.add(s); pool.push({ name: a.n, equip: a.equip });
    }
    pool.sort((a, b) => (a.equip === origEquip ? 1 : 0) - (b.equip === origEquip ? 1 : 0));
    const sets = orig.sets > 0 ? Math.round(orig.sets) : 3, reps = orig.reps > 0 ? Math.round(orig.reps) : 10;
    return pool.slice(0, 6).map((c) => ({ name: c.name, equip: c.equip, bw: c.equip === 'bw', sets, reps, kg: c.equip === 'bw' || orig.bw ? null : (orig.kg == null ? null : orig.kg) }));
  }
  // Turns a person's edit or a model's reply into a safe exercise substitution, or explains why not.
  function normalizeLiftSwap(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['That is not an exercise suggestion.'] };
    if (hasBadKeys(raw, 0)) return { ok: false, errors: ['Unsafe keys were found.'] };
    const name = cleanStr(raw.name, 60);
    if (!name) return { ok: false, errors: ['Give the exercise a name.'] };
    const equip = EQUIP_LIST.includes(raw.equip) ? raw.equip : (guessEquip(name) || 'other');
    const bw = raw.bw === true || equip === 'bw';
    let sets = Math.round(Number(raw.sets));
    if (!Number.isFinite(sets) || sets < 1 || sets > 12) sets = 3;
    let reps = Math.round(Number(raw.reps));
    if (!Number.isFinite(reps) || reps < 1 || reps > 100) reps = 10;
    let kg = null;
    if (!bw) { const n = Number(raw.kg); if (Number.isFinite(n) && n >= 0 && n <= 700) kg = clean(n); }
    const assumptions = Array.isArray(raw.assumptions) ? raw.assumptions.slice(0, 6).map((x) => cleanStr(x, 160)).filter(Boolean) : [];
    const confidence = ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium';
    return { ok: true, value: { name, equip, bw, sets, reps, kg, assumptions, confidence } };
  }

  // The block (0 to 4) a week falls in. Blocks are laid out for a 26-week plan; other lengths are stretched or squeezed to fit.
  function blockOfWeek(w, weeks) {
    const n = weeks && weeks !== WEEKS ? Math.ceil((w - 1) * WEEKS / weeks) + 1 : w;
    return n <= 3 ? 0 : n <= 9 ? 1 : n <= 15 ? 2 : n <= 21 ? 3 : 4;
  }
  // How many weeks a plan runs, whatever a backup or an old plan says.
  function planWeeks(plan) { const n = Math.round(Number(plan && plan.weeks)); return Number.isFinite(n) ? clamp(n, MIN_WEEKS, MAX_WEEKS) : WEEKS; }
  // A lighter week every 7th week that still falls inside the plan.
  function deloadWeeksFor(n) { const out = []; for (let w = 7; w <= n; w += 7) out.push(w); return out; }
  function photoWeeks(plan) { return Array.from({ length: planWeeks(plan) }, (_, i) => i + 1); }
  // What liftTarget needs to know about a plan.
  function targetOpts(plan) { return { deloadWeeks: plan.deloadWeeks, weeks: planWeeks(plan) }; }

  // Five block weights, strictly increasing by at least one step.
  function blockWeights(start, gain, step) {
    const out = [start];
    for (let b = 1; b <= 4; b++) {
      let w = roundTo(start * (1 + (gain * b) / 4), step);
      if (w <= out[b - 1]) w = clean(out[b - 1] + step);
      out.push(w);
    }
    return out;
  }
  // Working weight for week 1 from a set the user did (Epley, aiming at week-1 reps).
  function e1rm(w, r) { return r <= 1 ? w : w * (1 + r / 30); }
  function startWeight(w, reps, cls, step, opts) {
    const o = opts || {};
    const shift = REP_STYLE_SHIFT[o.repStyle || 'mixed'] || 0;
    const targetReps = Math.max(4, HEAVY_WAVE[0] + REP_OFFSET[cls] + shift);
    let start = e1rm(w, reps || targetReps) / (1 + targetReps / 30);
    if (o.lighter) start *= 0.9;
    return Math.max(step, roundTo(start, step));
  }

  const DEFAULT_STEPS = { lb: { db: 2.5, machine: 5, barbell: 5 }, kg: { db: 1, machine: 2.5, barbell: 2.5 } };

  // Build the tracked-lift plan. Weights are stored in kg; progression runs in the user's unit.
  function buildLiftPlan(inputLifts, prefs, unit) {
    const u = unit === 'kg' ? 'kg' : 'lb';
    const factor = u === 'lb' ? KG_PER_LB : 1;
    const steps = Object.assign({}, DEFAULT_STEPS[u]);
    if (prefs && prefs.dbStep) steps.db = prefs.dbStep;
    if (prefs && prefs.machineStep) steps.machine = prefs.machineStep;
    const sets = prefs && prefs.sets ? prefs.sets : 3;
    const repStyle = (prefs && prefs.repStyle) || 'mixed';
    const out = {};
    for (const l of inputLifts || []) {
      if (!l || !l.on) continue;
      const cat = CATALOG[l.id] || {};
      const id = l.id;
      const equip = l.equip || cat.equip || 'machine';
      const cls = l.cls || cat.cls || 'medium';
      const gain = l.gain != null ? l.gain : cat.gain != null ? cat.gain : 0.25;
      const step = steps[equip] || steps.machine;
      const item = {
        id, name: l.name || cat.name || id, short: cat.short || l.name || cat.name || id,
        muscle: l.muscle || cat.muscle || 'other', equip, cls, gain, sets, repStyle, unit: u, adjust: [],
      };
      if (equip === 'bw') {
        item.bw = true;
        item.startReps = Math.max(1, Math.round(l.reps || 4));
      } else {
        if (!(l.weight > 0)) continue;
        const start = startWeight(l.weight, l.reps, cls, step, { repStyle, lighter: prefs && prefs.lighter });
        item.step = step;
        item.blockUnits = blockWeights(start, gain, step);
        item.blockKg = item.blockUnits.map((x) => Math.round(x * factor * 1e5) / 1e5);
      }
      out[id] = item;
    }
    return out;
  }

  // Prescription for one lift in one week.
  function liftTarget(lift, week, opts) {
    const o = opts || {};
    const deloadWeeks = o.deloadWeeks || DELOAD_WEEKS;
    const w = clamp(week, 1, o.weeks || MAX_WEEKS);
    const b = blockOfWeek(w, o.weeks);
    const deload = deloadWeeks.includes(w);
    const baseSets = lift.sets || 3;
    const sets = deload ? Math.max(1, baseSets - 1) : baseSets;
    const shift = REP_STYLE_SHIFT[lift.repStyle || 'mixed'] || 0;
    let reps = HEAVY_WAVE[(w - 1) % HEAVY_WAVE.length] + (REP_OFFSET[lift.cls] || 0) + shift;
    reps = Math.max(4, reps);
    if (lift.bw) {
      return { id: lift.id, name: lift.name, week: w, sets, reps: lift.startReps + b, kg: null, deload, block: b };
    }
    let kg = lift.blockKg[deload ? Math.max(0, b - 1) : b];
    for (const a of lift.adjust || []) {
      if (w >= a.fromWeek) {
        const stepKg = lift.step * (lift.unit === 'lb' ? KG_PER_LB : 1);
        kg = Math.round(Math.round((kg * a.factor) / stepKg) * stepKg * 1e5) / 1e5;
      }
    }
    return { id: lift.id, name: lift.name, week: w, sets, reps, kg, deload, block: b };
  }

  // ---------- workout templates ----------
  // Each exercise: n name, lift = tracked id (optional), sets, range (rep range for accessories), rest secs, m muscle, s stress tags
  const E = (n, sets, range, rest, m, extra) => Object.assign({ n, sets, range, rest, m }, extra || {});
  const T = (lift, sets, rest, m) => ({ lift, n: CATALOG[lift].name, sets, range: '', rest, m });

  const TEMPLATES = {
    chest5: [
      { name: 'Push', focus: ['chest', 'shoulders', 'arms'], ex: [
        T('incline_db_press', 4, 150, 'chest'), E('Flat DB or machine press', 3, '8-12', 120, 'chest'), E('Cable fly', 3, '12-15', 90, 'chest'),
        T('shoulder_press', 3, 120, 'shoulders'), E('Lateral raise', 4, '12-20', 75, 'shoulders'), E('Overhead triceps extension', 3, '10-15', 90, 'arms'), E('Rope pushdown', 2, '12-15', 60, 'arms')] },
      { name: 'Pull', focus: ['back', 'arms'], ex: [
        T('lat_pulldown', 4, 120, 'back'), T('db_row', 3, 120, 'back'), E('Single-arm cable pulldown', 3, '10-12', 90, 'back'), E('Face pull or rear-delt fly', 3, '15-20', 60, 'shoulders'),
        T('curl', 3, 90, 'arms'), E('Hammer curl', 3, '10-12', 60, 'arms')] },
      { name: 'Legs', focus: ['legs'], ex: [
        T('leg_press', 4, 180, 'legs'), E('Romanian deadlift', 3, '8-10', 150, 'legs'), T('leg_ext', 3, 90, 'legs'), T('leg_curl', 3, 90, 'legs'),
        E('Calf raise', 4, '10-15', 60, 'legs'), E('Cable lateral raise', 3, '15-20', 60, 'shoulders')] },
      { name: 'Upper', focus: ['chest', 'back', 'shoulders', 'arms'], ex: [
        T('pullups', 3, 120, 'back'), T('flat_db_press', 3, 150, 'chest'), E('Seated cable row', 3, '10-12', 90, 'back'), E('Incline machine press or pec deck', 3, '12-15', 90, 'chest'),
        E('Cable lateral raise', 4, '15-20', 60, 'shoulders'), E('EZ-bar curl', 3, '10-12', 90, 'arms'), E('Triceps pushdown', 3, '10-12', 60, 'arms')] },
      { name: 'Lower', focus: ['legs', 'core'], ex: [
        E('Hack squat or leg press', 3, '8-12', 150, 'legs'), T('bulgarian', 3, 120, 'legs'), E('Lying leg curl', 3, '10-12', 90, 'legs'), E('Calf raise', 3, '12-15', 60, 'legs'),
        E('Hanging leg raise or cable crunch', 3, '10-15', 60, 'core')] },
    ],
    ul4: [
      { name: 'Upper A', focus: ['chest', 'back', 'shoulders', 'arms'], ex: [
        T('flat_db_press', 4, 150, 'chest'), T('lat_pulldown', 3, 120, 'back'), T('shoulder_press', 3, 120, 'shoulders'), T('db_row', 3, 120, 'back'), E('Cable fly', 3, '12-15', 90, 'chest'), T('curl', 3, 90, 'arms'), E('Triceps pushdown', 3, '10-12', 60, 'arms')] },
      { name: 'Lower A', focus: ['legs', 'core'], ex: [
        T('leg_press', 4, 180, 'legs'), E('Romanian deadlift', 3, '8-10', 150, 'legs'), T('leg_curl', 3, 90, 'legs'), E('Calf raise', 4, '10-15', 60, 'legs'), E('Hanging leg raise or cable crunch', 3, '10-15', 60, 'core')] },
      { name: 'Upper B', focus: ['chest', 'back', 'shoulders', 'arms'], ex: [
        T('incline_db_press', 4, 150, 'chest'), T('pullups', 3, 120, 'back'), E('Seated cable row', 3, '10-12', 90, 'back'), E('Lateral raise', 4, '12-20', 60, 'shoulders'), E('Hammer curl', 3, '10-12', 60, 'arms'), E('Overhead triceps extension', 3, '10-15', 60, 'arms')] },
      { name: 'Lower B', focus: ['legs'], ex: [
        E('Hack squat or leg press', 3, '8-12', 150, 'legs'), T('bulgarian', 3, 120, 'legs'), T('leg_ext', 3, 90, 'legs'), E('Lying leg curl', 3, '10-12', 90, 'legs'), E('Calf raise', 3, '12-15', 60, 'legs')] },
    ],
    ppl6: null, // filled below from chest5 halves
    fb3: [
      { name: 'Full body A', focus: ['chest', 'back', 'legs'], ex: [
        T('flat_db_press', 3, 150, 'chest'), T('lat_pulldown', 3, 120, 'back'), T('leg_press', 3, 150, 'legs'), T('shoulder_press', 3, 120, 'shoulders'), T('curl', 2, 90, 'arms'), E('Triceps pushdown', 2, '10-12', 60, 'arms')] },
      { name: 'Full body B', focus: ['chest', 'back', 'legs'], ex: [
        T('incline_db_press', 3, 150, 'chest'), T('db_row', 3, 120, 'back'), T('bulgarian', 3, 120, 'legs'), T('leg_curl', 3, 90, 'legs'), E('Lateral raise', 3, '12-20', 60, 'shoulders'), E('Calf raise', 3, '12-15', 60, 'legs')] },
      { name: 'Full body C', focus: ['chest', 'back', 'legs'], ex: [
        T('pullups', 3, 120, 'back'), E('Flat DB or machine press', 3, '8-12', 120, 'chest'), T('leg_ext', 3, 90, 'legs'), E('Seated cable row', 3, '10-12', 90, 'back'), E('Hammer curl', 2, '10-12', 60, 'arms'), E('Hanging leg raise or cable crunch', 3, '10-15', 60, 'core')] },
    ],
  };
  TEMPLATES.ppl6 = [
    TEMPLATES.chest5[0], TEMPLATES.chest5[1], TEMPLATES.chest5[2],
    Object.assign({}, TEMPLATES.chest5[0], { name: 'Push B', ex: [
      T('flat_db_press', 4, 150, 'chest'), E('Incline machine press or pec deck', 3, '10-12', 90, 'chest'), E('Seated DB shoulder press', 3, '8-12', 120, 'shoulders'), E('Lateral raise', 4, '15-20', 60, 'shoulders'), E('Triceps pushdown', 3, '10-12', 60, 'arms'), E('Overhead triceps extension', 3, '10-15', 60, 'arms')] }),
    Object.assign({}, TEMPLATES.chest5[1], { name: 'Pull B', ex: [
      T('pullups', 3, 120, 'back'), E('Seated cable row', 3, '10-12', 90, 'back'), E('Chest-supported row', 3, '8-12', 120, 'back'), E('Face pull or rear-delt fly', 3, '15-20', 60, 'shoulders'), E('Incline DB curl', 3, '10-12', 90, 'arms'), E('EZ-bar curl', 3, '10-12', 60, 'arms')] }),
    Object.assign({}, TEMPLATES.chest5[4], { name: 'Legs B', ex: [
      E('Hack squat or leg press', 3, '8-12', 150, 'legs'), T('bulgarian', 3, 120, 'legs'), E('Lying leg curl', 3, '10-12', 90, 'legs'), E('Calf raise', 4, '12-15', 60, 'legs'), E('Hanging leg raise or cable crunch', 3, '10-15', 60, 'core')] }),
  ];

  const FOREARM = {
    Pull: [E('Reverse EZ-bar curl', 3, '10-12', 75, 'forearms'), E('Wrist curl (palms up)', 3, '12-20', 60, 'forearms')],
    Upper: [E('Wrist curl (palms up)', 3, '12-20', 60, 'forearms'), E('Reverse wrist extension (palms down)', 3, '15-20', 60, 'forearms')],
    Lower: [E("Farmer's carry, heavy dumbbells", 3, '30-40 sec', 90, 'forearms'), E('Dead hang from a bar', 2, 'near failure', 60, 'forearms')],
  };
  const INJURY_KEYWORDS = {
    Shoulder: ['press', 'raise', 'fly', 'dip'],
    Elbow: ['curl', 'extension', 'pushdown', 'press'],
    Wrist: ['curl', 'press', 'carry', 'wrist'],
    'Lower back': ['deadlift', 'squat', 'row'],
    Knee: ['squat', 'leg press', 'extension', 'lunge'],
  };

  function pickTemplate(days, split) {
    const n = days.length;
    if (n >= 6) return 'ppl6';
    if (n === 5) return 'chest5';
    if (n === 4) return 'ul4';
    if (split === 'ppl' && n === 3) return 'chest5';
    return 'fb3';
  }
  function ordered(days) { const order = [1, 2, 3, 4, 5, 6, 0]; return days.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)); }

  function buildWorkouts(answers, trackedLifts) {
    const t = answers.training || {};
    const days = ordered(answers.days && answers.days.length ? answers.days : [1, 2, 3, 4, 5]);
    const key = pickTemplate(days, t.split);
    const tpl = TEMPLATES[key];
    const focus = t.focus || [];
    const injuries = (t.injuries || []).filter((x) => x !== 'Nothing');
    const workouts = [];
    for (let i = 0; i < days.length; i++) {
      const src = tpl[i % tpl.length];
      const ex = src.ex.map((e) => {
        const o = Object.assign({}, e);
        if (o.lift && !trackedLifts[o.lift]) { o.lift = null; o.range = o.range || (CATALOG[e.lift].cls === 'heavy' ? '6-10' : CATALOG[e.lift].cls === 'high' ? '12-15' : '8-12'); }
        const lower = o.n.toLowerCase();
        const flags = [];
        for (const inj of injuries) if ((INJURY_KEYWORDS[inj] || []).some((k) => lower.includes(k))) flags.push(inj);
        if (flags.length) o.flag = 'Work around your ' + flags.join(' and ').toLowerCase() + ': lighter, pain-free range.';
        return o;
      });
      if (focus.includes('forearms') && FOREARM[src.name.replace(/ [AB]$/, '')]) for (const f of FOREARM[src.name.replace(/ [AB]$/, '')]) ex.push(Object.assign({ forearm: true }, f));
      if (focus.includes('shoulders') && src.focus.includes('shoulders') && !ex.some((e) => /lateral/i.test(e.n))) ex.push(E('Lateral raise', 3, '12-20', 60, 'shoulders'));
      if (focus.includes('core') && !ex.some((e) => e.m === 'core')) ex.push(E('Cable crunch', 3, '10-15', 60, 'core'));
      workouts.push({ name: src.name, weekday: days[i], focus: src.focus, ex });
    }
    // Any tracked lift the template did not place goes on the best-matching day.
    const placed = new Set();
    workouts.forEach((w) => w.ex.forEach((e) => e.lift && placed.add(e.lift)));
    for (const id of Object.keys(trackedLifts)) {
      if (placed.has(id)) continue;
      const lf = trackedLifts[id];
      let day = workouts.find((w) => w.focus.includes(lf.muscle)) || workouts[workouts.length - 1];
      day.ex.unshift({ lift: id, n: lf.name, sets: lf.sets || 3, range: '', rest: 150, m: lf.muscle });
    }
    return { template: key, workouts };
  }

  // ---------- plan assembly ----------
  function buildPlan(a) {
    const days = a.days && a.days.length ? a.days : [1, 2, 3, 4, 5];
    const goal = a.goal || recommendGoal(a.measurements && a.measurements.waist ? a.measurements.waist : a.heightCm * 0.45, a.heightCm, a.bodyFatPct).goal;
    const targets = targetsFor(goal, { sex: a.sex, kg: a.weightKg, cm: a.heightCm, age: a.age, days: days.length });
    const t = a.training || {};
    const lifts = buildLiftPlan(a.lifts, {
      dbStep: t.dbStep, machineStep: t.machineStep, sets: t.sets, repStyle: t.repStyle, lighter: a.startLighter,
    }, a.units && a.units.lift);
    const wk = buildWorkouts(a, lifts);
    const weeks = clamp(Math.round(Number(a.weeks)) || WEEKS, MIN_WEEKS, MAX_WEEKS);
    const deloadOn = t.deload === 'planned' || t.deload == null;
    return {
      v: 1, startDate: a.startDate, weeks, goal,
      kcal: targets.kcal, protein: targets.protein, carbs: targets.carbs, fat: targets.fat, maintenance: targets.maintenance,
      measTargets: measurementTargets(goal, a.measurements, weeks),
      baseline: { weightKg: a.weightKg, waistCm: a.measurements && a.measurements.waist ? a.measurements.waist : null },
      deloadOn, deloadWeeks: deloadOn ? deloadWeeksFor(weeks) : [],
      lifts, template: wk.template, workouts: wk.workouts, history: [],
    };
  }

  function weeklyTargets(plan, week) {
    return Object.values(plan.lifts).map((l) => liftTarget(l, week, targetOpts(plan)));
  }

  // ---------- bounds used to validate any change (user, checkpoint or coach) ----------
  const LIMITS = { maxKcalStep: 300, minKcal: 1500, maxKcal: 5000, minProteinPerKg: 1.4, maxProteinPerKg: 3.0, maxLiftPct: 10 };
  function validateMacroChange(plan, weightKg, ch) {
    const errs = [];
    const kcal = ch.kcal != null ? Number(ch.kcal) : plan.kcal;
    const protein = ch.protein != null ? Number(ch.protein) : plan.protein;
    if (!Number.isFinite(kcal) || !Number.isFinite(protein)) errs.push('Numbers only.');
    else {
      if (Math.abs(kcal - plan.kcal) > LIMITS.maxKcalStep) errs.push('Calories can change by at most ' + LIMITS.maxKcalStep + ' per step.');
      if (kcal < LIMITS.minKcal || kcal > LIMITS.maxKcal) errs.push('Calories must stay between ' + LIMITS.minKcal + ' and ' + LIMITS.maxKcal + '.');
      const pk = protein / weightKg;
      if (pk < LIMITS.minProteinPerKg || pk > LIMITS.maxProteinPerKg) errs.push('Protein must be ' + LIMITS.minProteinPerKg + ' to ' + LIMITS.maxProteinPerKg + ' g per kg.');
    }
    if (errs.length) return { ok: false, errors: errs };
    const fat = ch.fat != null ? Number(ch.fat) : plan.fat;
    const carbs = ch.carbs != null ? Number(ch.carbs) : Math.max(0, roundTo((kcal - 4 * protein - 9 * fat) / 4, 5));
    return { ok: true, value: { kcal: roundTo(kcal, 5), protein: roundTo(protein, 1), carbs, fat } };
  }
  function validateLiftChange(plan, ch) {
    const l = Object.prototype.hasOwnProperty.call(plan.lifts, ch.lift) ? plan.lifts[ch.lift] : null;
    if (!l) return { ok: false, errors: ['Unknown lift.'] };
    const pct = Number(ch.percent);
    if (!Number.isFinite(pct) || Math.abs(pct) > LIMITS.maxLiftPct || pct === 0) return { ok: false, errors: ['Lift changes are limited to 10 percent at a time.'] };
    const from = clamp(Math.round(Number(ch.fromWeek) || 1), 1, planWeeks(plan));
    return { ok: true, value: { lift: ch.lift, fromWeek: from, factor: clean(1 + pct / 100) } };
  }

  // ---------- library clips (a reference to a photo or video that stays where it was taken) ----------
  const CLIP_TAGS = ['Form check', 'Workout', 'Personal best', 'Other'];
  // Turns anything read from storage, a backup or a form into a safe library entry, or says why not. Every field is clamped.
  function cleanClip(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['That is not a library entry.'] };
    const id = String(raw.id || '');
    if (!/^[a-z0-9][a-z0-9_]{0,59}$/.test(id)) return { ok: false, errors: ['Bad id.'] };
    const kind = raw.kind === 'video' ? 'video' : raw.kind === 'photo' ? 'photo' : null;
    if (!kind) return { ok: false, errors: ['Unknown kind.'] };
    const date = String(raw.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, errors: ['Bad date.'] };
    const numIn = (x, lo, hi) => { const n = Number(x); return Number.isFinite(n) ? clamp(n, lo, hi) : 0; };
    const thumb = /^[a-z0-9][a-z0-9_]{0,69}$/.test(String(raw.thumb || '')) ? String(raw.thumb) : null;
    const full = /^[a-z0-9][a-z0-9_]{0,69}$/.test(String(raw.full || '')) ? String(raw.full) : null;
    const lift = /^[a-z0-9][a-z0-9_]{0,39}$/.test(String(raw.lift || '')) ? String(raw.lift) : null;
    return { ok: true, value: {
      id, kind, date, thumb, full, lift,
      tag: CLIP_TAGS.includes(raw.tag) ? raw.tag : 'Other',
      note: cleanStr(raw.note, 200), name: cleanStr(raw.name, 80), review: String(raw.review == null ? '' : raw.review).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, 2500),
      size: Math.round(numIn(raw.size, 0, 1e12)), mtime: Math.round(numIn(raw.mtime, 0, 4e12)), w: Math.round(numIn(raw.w, 0, 20000)), h: Math.round(numIn(raw.h, 0, 20000)), dur: Math.round(numIn(raw.dur, 0, 36000) * 10) / 10,
      linked: raw.linked === true,
    } };
  }

  // Turns a lift read from a revision into a safe plan entry, or null. Every field is checked and clamped.
  function cleanLift(raw, id) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const equip = LIFT_EQUIP.includes(raw.equip) ? raw.equip : null;
    const name = cleanStr(raw.name, 60);
    if (!equip || !name) return null;
    const out = {
      id, name, short: cleanStr(raw.short || name, 40), muscle: LIFT_MUSCLES.includes(raw.muscle) ? raw.muscle : 'other', equip,
      cls: LIFT_CLS.includes(raw.cls) ? raw.cls : 'medium', gain: clamp(Number(raw.gain) || 0, 0, 1), sets: clamp(Math.round(Number(raw.sets) || 3), 1, 8),
      repStyle: ['heavy', 'mixed', 'pump'].includes(raw.repStyle) ? raw.repStyle : 'mixed', unit: raw.unit === 'kg' ? 'kg' : 'lb', adjust: [],
    };
    if (equip === 'bw') { out.bw = true; out.startReps = clamp(Math.round(Number(raw.startReps) || 4), 1, 60); }
    else {
      const five = (x, hi) => (Array.isArray(x) && x.length === 5 && x.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= hi) ? x.slice() : null);
      const kg = five(raw.blockKg, 700), units = five(raw.blockUnits, 2000), step = Number(raw.step);
      if (!kg || !units || !(step > 0 && step <= 50)) return null;
      out.step = step; out.blockKg = kg; out.blockUnits = units;
    }
    if (Array.isArray(raw.adjust)) for (const a of raw.adjust.slice(0, 30)) if (a && Number.isFinite(a.fromWeek) && Number.isFinite(a.factor) && a.factor >= 0.25 && a.factor <= 4) out.adjust.push({ fromWeek: clamp(Math.round(a.fromWeek), 1, MAX_WEEKS), factor: clean(a.factor) });
    return out;
  }

  // ---------- goals: things to work towards, each with its own start, length and target ----------
  // An endurance goal is measured from ordinary workouts (distance and time), so nothing is logged twice. A custom goal is a number
  // the person types in over and over (pull-ups, resting heart rate, a 100 m swim time in seconds). Whatever is read back from
  // storage, a backup or a form is rebuilt from a whitelist, and one bad field refuses the whole goal.
  const ENDURANCE_SPORTS = ['running', 'cycling', 'swimming', 'rowing', 'walking', 'hiking'];
  const GOAL_AIMS = ['distance', 'pace', 'weekly'];
  const MAX_GOALS = 24;
  const GOAL_ID = /^g_[a-z0-9]{3,24}$/;
  const isGoalId = (x) => typeof x === 'string' && GOAL_ID.test(x);
  function newGoalId() { return 'g_' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 6); }
  // Ranges per measure: distance in km, pace in seconds per km, weekly volume in km.
  const GOAL_RANGE = { distance: [0.1, 500], pace: [60, 2400], weekly: [0.5, 2000] };
  function cleanGoal(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || hasBadKeys(raw, 0)) return { ok: false, errors: ['That is not a goal.'] };
    const errors = [];
    const id = String(raw.id || '');
    if (!isGoalId(id)) errors.push('Bad goal id.');
    const kind = raw.kind === 'endurance' || raw.kind === 'custom' ? raw.kind : null;
    if (!kind) errors.push('Pick a kind of goal.');
    const title = cleanStr(raw.title, 40);
    if (!title) errors.push('Give the goal a name.');
    const start = String(raw.start || '');
    if (!validISO(start)) errors.push('Pick a start date.');
    const weeks = Math.round(Number(raw.weeks));
    if (!(weeks >= 1 && weeks <= MAX_WEEKS)) errors.push('Length should be from 1 to ' + MAX_WEEKS + ' weeks.');
    const num = (x) => (x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : NaN);
    const out = {
      id, kind, title, start, weeks, status: raw.status === 'closed' ? 'closed' : 'active',
      closedOn: validISO(String(raw.closedOn || '')) ? String(raw.closedOn) : null,
      prev: isGoalId(raw.prev) ? raw.prev : null, note: cleanStr(raw.note, 200),
      sport: null, aim: null, paceKm: null, unit: '', from: null, target: null,
    };
    const from = num(raw.from), target = num(raw.target);
    if (kind === 'endurance') {
      if (!ENDURANCE_SPORTS.includes(raw.sport)) errors.push('Pick a sport.'); else out.sport = raw.sport;
      if (!GOAL_AIMS.includes(raw.aim)) errors.push('Pick what to aim for.'); else out.aim = raw.aim;
      const r = GOAL_RANGE[out.aim];
      if (r) {
        if (!(target >= r[0] && target <= r[1])) errors.push('The target is outside what makes sense for this goal.'); else out.target = clean(target);
        if (from !== null && !(from >= r[0] && from <= r[1])) errors.push('The starting point is outside what makes sense for this goal.'); else if (from !== null) out.from = clean(from);
      }
      if (out.from !== null && out.target !== null) {
        if (out.aim === 'pace' ? out.from <= out.target : out.from >= out.target) errors.push(out.aim === 'pace' ? 'Your pace today should be slower than the target.' : 'Your starting point should be below the target.');
      }
      if (out.aim === 'pace') {
        const pk = num(raw.paceKm);
        if (!(pk >= 0.1 && pk <= 100)) errors.push('Say over what distance the pace should hold.'); else out.paceKm = clean(pk);
        if (out.from === null && from === null) errors.push('Add your pace today so progress has a starting point.');
      }
    } else if (kind === 'custom') {
      out.unit = cleanStr(raw.unit, 12);
      if (target === null || !(Math.abs(target) <= 1e7)) errors.push('Add a target number.'); else out.target = clean(target);
      if (from === null || !(Math.abs(from) <= 1e7)) errors.push('Add where you are today.'); else out.from = clean(from);
      if (out.from !== null && out.target !== null && out.from === out.target) errors.push('The target should differ from where you are today.');
    }
    if (errors.length) return { ok: false, errors };
    return { ok: true, value: out };
  }
  function cleanGoalEntry(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['That is not a reading.'] };
    const date = String(raw.date || ''), value = Number(raw.value);
    if (!isGoalId(raw.goal)) return { ok: false, errors: ['Bad goal.'] };
    if (!validISO(date)) return { ok: false, errors: ['Bad date.'] };
    if (raw.value === null || raw.value === '' || !(Math.abs(value) <= 1e7)) return { ok: false, errors: ['Add a number.'] };
    return { ok: true, value: { goal: raw.goal, date, value: clean(value), note: cleanStr(raw.note, 100) } };
  }

  // ---------- state projection from the event log ----------
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function project(events) {
    const voided = new Set();
    for (const e of events) if (e.type === 'event_voided') voided.add(e.data.target);
    const s = { profile: null, plan: null, weights: [], meas: [], foods: [], sets: [], photos: [], clips: [], workouts: [], water: [], moves: Object.create(null), revisions: [], dietPrefs: null, goals: Object.create(null), goalOrder: [], goalEntries: [] };
    for (const e of events) {
      if (voided.has(e.seq) || e.type === 'event_voided') continue;
      const d = e.data || {};
      try {
      switch (e.type) {
        case 'profile_created': s.profile = clone(d.profile); s.plan = clone(d.plan); break;
        case 'profile_edited': { if (s.profile) { const r = cleanProfileEdit(d && d.fields); if (r.ok) Object.assign(s.profile, r.value); } break; }
        case 'goal_set': { const r = cleanGoal(d && d.goal); if (r.ok && (s.goals[r.value.id] || s.goalOrder.length < MAX_GOALS)) { if (!s.goals[r.value.id]) s.goalOrder.push(r.value.id); s.goals[r.value.id] = r.value; } break; }
        case 'goal_entry': { const r = cleanGoalEntry(d); if (r.ok) s.goalEntries.push(Object.assign({ seq: e.seq }, r.value)); break; }
        case 'diet_prefs_set': { const r = cleanDietPrefs(d && d.prefs); if (r.ok) s.dietPrefs = r.value; break; }
        case 'plan_revised': if (s.plan) applyRevision(s.plan, d, e); s.revisions.push({ seq: e.seq, ts: e.ts, src: e.src, reason: d.reason, changes: d.changes }); break;
        case 'weight_logged': s.weights.push({ seq: e.seq, date: d.date, kg: d.kg }); break;
        case 'water_logged': { const date = String(d.date || ''), ml = Number(d.ml); if (validISO(date) && Number.isFinite(ml) && ml > 0 && ml <= 3000) s.water.push({ seq: e.seq, date, ml: clean(ml) }); break; }
        case 'measurement_logged': s.meas.push({ seq: e.seq, date: d.date, site: d.site, cm: d.cm }); break;
        case 'food_logged': s.foods.push(Object.assign({ seq: e.seq }, d)); break;
        case 'set_logged': s.sets.push(Object.assign({ seq: e.seq }, d)); break;
        case 'photo_added': s.photos.push({ seq: e.seq, date: d.date, week: d.week, angle: d.angle, id: d.id }); break;
        case 'clip_added': { const c = cleanClip(d); if (c.ok) s.clips.push(Object.assign({ seq: e.seq }, c.value)); break; }
        case 'workout_logged': { const w = cleanWorkout(d); if (w.ok) s.workouts.push(Object.assign({ seq: e.seq }, w.value)); break; }
        case 'session_moved': {
          const date = String(d.date || ''), name = cleanStr(d.session, 40);
          if (validISO(date) && name) s.moves[date] = name;
          break;
        }
        default: break;
      }
      } catch (err) { /* one unusable event must never stop the app from opening; it is skipped */ }
    }
    s.weights.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    return s;
  }
  function applyRevision(plan, d, e) {
    const c = d.changes || {};
    const before = {};
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'goal']) if (c[k] != null) { before[k] = plan[k]; plan[k] = c[k]; }
    const has = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(plan.lifts, id);
    if (c.liftAdjust && has(c.liftAdjust.lift) && Number.isFinite(c.liftAdjust.factor) && c.liftAdjust.factor >= 0.25 && c.liftAdjust.factor <= 4 && Number.isFinite(c.liftAdjust.fromWeek)) {
      plan.lifts[c.liftAdjust.lift].adjust.push({ fromWeek: clamp(Math.round(c.liftAdjust.fromWeek), 1, planWeeks(plan)), factor: c.liftAdjust.factor });
    }
    if (c.measTargets) plan.measTargets = c.measTargets;
    // A plan can be made longer or shorter after it starts. Deload weeks follow the new length; every week already done keeps its targets.
    if (c.weeks != null && Number.isFinite(Number(c.weeks))) {
      plan.weeks = clamp(Math.round(Number(c.weeks)), MIN_WEEKS, MAX_WEEKS);
      if (typeof plan.deloadOn !== 'boolean') plan.deloadOn = Array.isArray(plan.deloadWeeks) && plan.deloadWeeks.length > 0;
      plan.deloadWeeks = plan.deloadOn ? deloadWeeksFor(plan.weeks) : [];
    }
    // A lift added after onboarding goes on the day that trains that muscle, or on the session the person chose.
    // Whatever arrives here (a person's form, a coach proposal, a backup file) is rebuilt from a whitelist first.
    if (c.addLifts && typeof c.addLifts === 'object') {
      for (const id of Object.keys(c.addLifts)) {
        if (!/^[a-z0-9_]{1,40}$/.test(id) || BAD_KEYS.includes(id) || has(id)) continue;
        const l = cleanLift(c.addLifts[id], id);
        if (!l) continue;
        plan.lifts[id] = l;
        const want = c.placeLifts && typeof c.placeLifts === 'object' && typeof c.placeLifts[id] === 'string' ? c.placeLifts[id] : null;
        // The plan may already list this exercise as a plain one (an accessory), maybe in more than one session.
        // Those are upgraded in place, never listed twice. "None" takes them out of every session.
        const sn = slug(l.name);
        let found = 0;
        for (const w of plan.workouts) {
          for (let i = w.ex.length - 1; i >= 0; i--) {
            const x = w.ex[i];
            if (x.lift || slug(x.n) !== sn) continue;
            found++;
            if (want === '-') { w.ex.splice(i, 1); continue; }
            x.lift = id; x.n = l.name; x.m = l.muscle; x.range = '';
          }
        }
        if (want === '-') continue; // tracked, but not part of any session
        const named = want ? plan.workouts.find((w) => w.name === want) : null;
        if (found && (!named || named.ex.some((x) => x.lift === id))) continue;
        const day = named || plan.workouts.find((w) => w.focus.includes(l.muscle)) || plan.workouts[plan.workouts.length - 1];
        if (!day) continue;
        const entry = { lift: id, n: l.name, sets: l.sets || 3, range: '', rest: l.cls === 'heavy' ? 150 : 90, m: l.muscle };
        if (want || l.cls === 'heavy') day.ex.unshift(entry); else day.ex.push(entry);
      }
    }
    // Stop tracking a lift: its logged sets stay, and it becomes an ordinary exercise in the session.
    if (has(c.removeLift)) {
      const gone = c.removeLift;
      delete plan.lifts[gone];
      // `was` remembers the old id, so sets logged while it was tracked still count towards that session being done.
      for (const w of plan.workouts) for (const ex of w.ex) if (ex.lift === gone) { ex.lift = null; ex.was = gone; ex.range = ex.range || '8-12'; }
    }
    plan.history.push({ seq: e.seq, ts: e.ts, src: e.src || 'user', reason: d.reason || '', before, changes: c });
  }

  // ---------- derived numbers ----------
  function avgWeightSeries(weights, window) {
    const w = window || 7;
    return weights.map((p, i) => {
      const sl = weights.slice(Math.max(0, i - w + 1), i + 1);
      return { date: p.date, kg: sl.reduce((t, x) => t + x.kg, 0) / sl.length };
    });
  }
  function latestMeas(meas, site) {
    let best = null;
    for (const m of meas) if (m.site === site && (!best || m.date >= best.date)) best = m;
    return best;
  }
  // ---------- photo trend: the numbers that belong to a photo ----------
  // Weight around a date: the mean of the weigh-ins within 3 days either side, else the closest one within 7 days.
  function weightAround(weights, date) {
    const near = weights.filter((w) => Math.abs(daysBetween(date, w.date)) <= 3);
    if (near.length) return near.reduce((t, w) => t + w.kg, 0) / near.length;
    let best = null, bestGap = 8;
    for (const w of weights) { const g = Math.abs(daysBetween(date, w.date)); if (g < bestGap || (g === bestGap && best && w.date < best.date)) { best = w; bestGap = g; } }
    return best && bestGap <= 7 ? best.kg : null;
  }
  // A measurement around a date: the closest entry within 10 days; on a tie the earlier one.
  function measAround(meas, site, date) {
    let best = null, bestGap = 11;
    for (const m of meas) {
      if (m.site !== site) continue;
      const g = Math.abs(daysBetween(date, m.date));
      if (g < bestGap || (g === bestGap && best && m.date < best.date)) { best = m; bestGap = g; }
    }
    return best && bestGap <= 10 ? best.cm : null;
  }
  function snapshotAt(state, date) {
    const out = { weightKg: weightAround(state.weights, date), meas: {} };
    for (const [site] of MEAS_SITES) out.meas[site] = measAround(state.meas, site, date);
    return out;
  }
  // The date of a week's check-in: the first day in that plan week that falls on the chosen weekday.
  function checkinDate(startDate, week, weekday) {
    const s = addDays(startDate, (week - 1) * 7);
    return addDays(s, (weekday - weekdayOf(s) + 7) % 7);
  }
  function anglesTaken(state, week) {
    return new Set(state.photos.filter((p) => p.week === week).map((p) => p.angle)).size;
  }
  // Where this week's check-in stands. 'done' needs every angle; earlier weeks left unfinished are listed in `missed`.
  function checkinStatus(state, weekday, today) {
    const start = state.plan.startDate;
    const week = clamp(weekOf(start, today), 1, planWeeks(state.plan));
    const date = checkinDate(start, week, weekday);
    const taken = anglesTaken(state, week);
    const status = taken >= ANGLES.length ? 'done' : today > date ? 'overdue' : today === date ? 'due' : 'upcoming';
    const missed = [];
    for (let w = 1; w < week; w++) if (anglesTaken(state, w) < ANGLES.length && checkinDate(start, w, weekday) < today) missed.push(w);
    return { week, date, taken, of: ANGLES.length, status, missed };
  }
  // One entry per check-in week for an angle (up to `upTo` when given), with the photo (if any) and the numbers around its date.
  function checkIns(state, angle, upTo) {
    return photoWeeks(state.plan).filter((w) => upTo == null || w <= upTo).map((week) => {
      const photo = state.photos.find((p) => p.week === week && p.angle === angle) || null;
      return { week, photo, date: photo ? photo.date : null, snap: photo ? snapshotAt(state, photo.date) : null };
    });
  }
  // +1 when going up is the goal, -1 when going down is, 0 when the plan does not care.
  function goalDir(plan, key) {
    if (key === 'weight') return plan.goal === 'build' ? 1 : plan.goal === 'cut' ? -1 : 0;
    const tg = plan.measTargets && plan.measTargets[key];
    return tg ? Math.sign(clean(tg.target - tg.start)) : 0;
  }
  function changeTone(delta, dir, eps) {
    if (delta == null || !dir || Math.abs(delta) < (eps == null ? 0.05 : eps)) return '';
    return (delta > 0) === (dir > 0) ? 'good' : 'coral';
  }
  function setsForWeek(state, week) {
    const [a, b] = weekRange(state.plan.startDate, week);
    return state.sets.filter((x) => x.date >= a && x.date <= b && !x.warmup);
  }
  // Hit / Partial / Behind / Todo for one lift in one week.
  function liftStatus(state, liftId, week, today) {
    const lift = state.plan.lifts[liftId];
    const tg = liftTarget(lift, week, targetOpts(state.plan));
    const sets = setsForWeek(state, week).filter((x) => x.lift === liftId);
    const tol = tg.kg ? tg.kg * 0.02 : 0;
    const good = sets.filter((x) => x.reps >= tg.reps && (tg.kg == null || x.kg >= tg.kg - tol));
    const [, end] = weekRange(state.plan.startDate, week);
    const over = today > end;
    let status = 'Todo';
    if (good.length >= tg.sets) status = 'Hit';
    else if (sets.length) status = over ? 'Behind' : 'Partial';
    else if (over) status = 'Behind';
    const top = sets.reduce((m, x) => (x.kg != null && x.kg > m ? x.kg : m), 0);
    const topReps = sets.reduce((m, x) => (x.reps > m ? x.reps : m), 0);
    return { status, target: tg, logged: sets.length, good: good.length, topKg: top || null, topReps };
  }

  // Rules-based monthly review (every 4 weeks). Never a black box: each branch is one sentence.
  function reviewMonth(state, today) {
    const plan = state.plan;
    const week = clamp(weekOf(plan.startDate, today), 1, planWeeks(plan));
    const since = addDays(today, -28);
    const ws = avgWeightSeries(state.weights, 7);
    const inWin = ws.filter((p) => p.date >= since);
    let perWeek = null;
    if (inWin.length >= 2) perWeek = ((inWin[inWin.length - 1].kg - inWin[0].kg) / Math.max(1, daysBetween(inWin[0].date, inWin[inWin.length - 1].date))) * 7;
    const waistNow = latestMeas(state.meas, 'waist');
    const waistThen = state.meas.filter((m) => m.site === 'waist' && m.date <= since).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || { cm: plan.baseline.waistCm };
    const waistDelta = waistNow && waistThen && waistThen.cm ? waistNow.cm - waistThen.cm : null;
    // Lift trend: share of tracked-lift weeks hit in the last 4 completed weeks, and stall length.
    const ids = Object.keys(plan.lifts);
    let hitNow = 0, hitPrev = 0, cnt = 0;
    for (let w = Math.max(1, week - 4); w < week; w++) {
      for (const id of ids) {
        const st = liftStatus(state, id, w, today);
        if (st.logged || st.status === 'Behind') { cnt++; if (st.status === 'Hit') { if (w >= week - 2) hitNow++; else hitPrev++; } }
      }
    }
    const liftsRising = cnt ? hitNow >= hitPrev : null;
    const stalled = cnt >= 6 && hitNow + hitPrev === 0;
    const g = plan.goal;
    const out = { week, perWeek, waistDelta, action: 'hold', kcalDelta: 0, message: '', flags: [] };
    if (perWeek == null && waistDelta == null) { out.message = 'Not enough logs yet. Weigh in most mornings and measure your waist every week or two.'; return out; }
    const wk = perWeek == null ? 0 : perWeek;
    if (g === 'recomp') {
      if (wk < -0.5 || (liftsRising === false && wk < -0.2)) { out.action = 'add'; out.kcalDelta = 175; out.message = 'Weight is dropping faster than a recomp should, or lifts are slipping. Add about 175 kcal.'; }
      else if (stalled && Math.abs(wk) < 0.2) { out.action = 'add'; out.kcalDelta = 125; out.message = 'Lifts have stalled with flat weight. Add about 125 kcal and check your sleep.'; out.flags.push('sleep'); }
      else if ((waistDelta == null || waistDelta >= -0.1) && wk >= 0.5 * 0.25) { out.action = 'cut'; out.kcalDelta = -175; out.message = 'Waist is not shrinking and weight is creeping up. Trim about 175 kcal.'; }
      else if (waistDelta != null && waistDelta <= -0.6 && waistDelta >= -1.4 && wk > -0.3 && wk < 0.4) { out.message = 'Waist is down and weight is flat to slightly up. That is the recomp working. Hold calories.'; }
      else out.message = 'Signals are mixed. Hold calories and check again next month.';
    } else if (g === 'build') {
      if (wk > 0.5) { out.action = 'cut'; out.kcalDelta = -150; out.message = 'Gaining faster than about 0.5 kg a week. Trim about 150 kcal to keep it lean.'; }
      else if (wk < 0.1) { out.action = 'add'; out.kcalDelta = 150; out.message = 'Weight is flat while building. Add about 150 kcal.'; }
      else out.message = 'Gaining at a steady pace. Hold calories.';
    } else {
      if (wk > -0.15) { out.action = 'cut'; out.kcalDelta = -150; out.message = 'Weight loss has slowed below about 0.15 kg a week. Trim about 150 kcal or add steps.'; }
      else if (wk < -0.8) { out.action = 'add'; out.kcalDelta = 150; out.message = 'Losing faster than 0.8 kg a week. Add about 150 kcal to protect muscle.'; }
      else out.message = 'Fat loss is on pace. Hold calories.';
    }
    if (out.kcalDelta) {
      const v = validateMacroChange(plan, state.profile ? state.profile.weightKg : plan.baseline.weightKg, { kcal: plan.kcal + out.kcalDelta });
      out.proposal = v.ok ? v.value : null;
    }
    return out;
  }

  // Goal checkpoints at fixed weeks.
  function checkpoint(state, today) {
    const plan = state.plan;
    const week = weekOf(plan.startDate, today);
    const waistNow = latestMeas(state.meas, 'waist');
    const base = plan.baseline.waistCm;
    if (!waistNow || !base) return null;
    const dIn = cmToIn(waistNow.cm - base);
    // The checkpoint weeks are set for a 26-week plan and move with the plan's length.
    const k = planWeeks(plan) / WEEKS, at = (w) => Math.max(2, Math.round(w * k)), lim = (x) => x * clamp(k, 0.5, 1.5);
    if (plan.goal === 'recomp' && week >= at(12) && dIn <= -0.5 * clamp(k, 0.5, 1)) return { week: at(12), text: 'Checkpoint: waist is down ' + Math.abs(dIn).toFixed(1) + ' in. You can move to a lean bulk (+200 kcal).', goal: 'build' };
    if (plan.goal === 'build' && week >= at(20) && dIn >= lim(2)) return { week: at(20), text: 'Checkpoint: waist is up ' + dIn.toFixed(1) + ' in. Consider a 4 to 6 week mini-cut (-300 kcal).', goal: 'cut' };
    if (plan.goal === 'cut' && week >= at(10)) return { week: at(10), text: 'Checkpoint at week ' + at(10) + ': consider switching to recomp at maintenance.', goal: 'recomp' };
    return null;
  }

  // ---------- backup / import validation ----------
  const EVENT_TYPES = ['profile_created', 'plan_revised', 'weight_logged', 'measurement_logged', 'food_logged', 'set_logged', 'photo_added', 'clip_added', 'workout_logged', 'session_moved', 'profile_edited', 'diet_prefs_set', 'goal_set', 'goal_entry', 'water_logged', 'event_voided'];
  const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
  function hasBadKeys(o, depth) {
    if (o === null || typeof o !== 'object') return false;
    if (depth > 40) return true;
    if (Array.isArray(o)) return o.some((x) => hasBadKeys(x, depth + 1));
    for (const k of Object.keys(o)) { if (BAD_KEYS.includes(k)) return true; if (hasBadKeys(o[k], depth + 1)) return true; }
    return false;
  }
  // The basics a person can change after onboarding. Only the fields present are checked and kept; anything else is dropped,
  // and one bad field refuses the whole edit, so a half-valid file never changes the profile.
  const PROFILE_DIETS = ['Vegetarian', 'Vegan', 'Eggetarian', 'Pescatarian', 'Everything'];
  function cleanProfileEdit(f) {
    if (!f || typeof f !== 'object' || Array.isArray(f) || hasBadKeys(f, 0)) return { ok: false, errors: ['That is not a profile change.'] };
    const out = {}, errors = [], has = (k) => Object.prototype.hasOwnProperty.call(f, k);
    if (has('name')) { if (typeof f.name !== 'string') errors.push('Name should be text.'); else out.name = f.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40); }
    if (has('sex')) { if (['male', 'female', 'other'].includes(f.sex)) out.sex = f.sex; else errors.push('Pick a sex from the list.'); }
    if (has('age')) { const n = Number(f.age); if (Number.isFinite(n) && n >= 14 && n <= 90) out.age = Math.round(n); else errors.push('Enter an age between 14 and 90.'); }
    if (has('heightCm')) { const n = Number(f.heightCm); if (Number.isFinite(n) && n >= 120 && n <= 230) out.heightCm = clean(n); else errors.push('Enter a height between 120 and 230 cm (3 ft 11 in to 7 ft 6 in).'); }
    if (has('bodyFatPct')) {
      if (f.bodyFatPct === null || f.bodyFatPct === '') out.bodyFatPct = null;
      else { const n = Number(f.bodyFatPct); if (Number.isFinite(n) && n >= 3 && n <= 60) out.bodyFatPct = Math.round(n * 10) / 10; else errors.push('Body fat should be between 3 and 60 percent, or empty.'); }
    }
    if (has('diet')) { if (PROFILE_DIETS.includes(f.diet)) out.diet = f.diet; else errors.push('Pick a diet style from the list.'); }
    if (errors.length) return { ok: false, errors };
    return { ok: true, value: out };
  }
  // Eating preferences for the suggested diet plan. Like every other event, whatever is read back is rebuilt from a whitelist.
  // style null means "follow the diet chosen in the profile".
  const DIET_STYLES = ['vegan', 'veg', 'egg', 'pesc', 'any'];
  const DIET_CUISINES = ['indian', 'western', 'mixed'];
  const DIET_AVOID = ['dairy', 'eggs', 'nuts', 'gluten', 'soy'];
  const DIET_SLOTS = ['breakfast', 'morning', 'lunch', 'evening', 'dinner'];
  function styleFromProfile(d) {
    const t = String(d || '').toLowerCase();
    return /vegan/.test(t) ? 'vegan' : /egg/.test(t) ? 'egg' : /pesc/.test(t) ? 'pesc' : /veg/.test(t) ? 'veg' : 'any';
  }
  function defaultDietPrefs() { return { style: null, cuisine: 'mixed', meals: 4, avoid: [], dislikes: [], quick: false, seed: 0, swaps: {} }; }
  function cleanDietPrefs(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || hasBadKeys(raw, 0)) return { ok: false, errors: ['That is not a set of eating preferences.'] };
    const out = defaultDietPrefs(), errors = [], has = (k) => Object.prototype.hasOwnProperty.call(raw, k);
    if (has('style')) { if (raw.style === null || DIET_STYLES.includes(raw.style)) out.style = raw.style; else errors.push('Pick an eating style from the list.'); }
    if (has('cuisine')) { if (DIET_CUISINES.includes(raw.cuisine)) out.cuisine = raw.cuisine; else errors.push('Pick a cuisine from the list.'); }
    if (has('meals')) { const n = Number(raw.meals); if (n === 3 || n === 4 || n === 5) out.meals = n; else errors.push('Meals a day should be 3, 4 or 5.'); }
    if (has('avoid')) { if (Array.isArray(raw.avoid)) out.avoid = DIET_AVOID.filter((x) => raw.avoid.includes(x)); else errors.push('Foods to avoid should be a list.'); }
    if (has('dislikes')) {
      const list = Array.isArray(raw.dislikes) ? raw.dislikes : String(raw.dislikes == null ? '' : raw.dislikes).split(',');
      const seen = new Set();
      for (const x of list.slice(0, 20)) {
        const w = String(x == null ? '' : x).toLowerCase().replace(/[^a-z\- ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20);
        if (w.length >= 2 && !seen.has(w) && seen.size < 8) { seen.add(w); }
      }
      out.dislikes = Array.from(seen);
    }
    if (has('quick')) out.quick = raw.quick === true;
    if (has('seed')) { const n = Number(raw.seed); if (Number.isInteger(n) && n >= 0 && n <= 9999) out.seed = n; else errors.push('Bad shuffle number.'); }
    if (has('swaps') && raw.swaps && typeof raw.swaps === 'object' && !Array.isArray(raw.swaps)) {
      let n = 0;
      for (const k of Object.keys(raw.swaps)) {
        const m = /^([0-6]):([a-z]+)$/.exec(k), v = Number(raw.swaps[k]);
        if (m && DIET_SLOTS.includes(m[2]) && Number.isInteger(v) && v >= 1 && v <= 60 && n < 80) { out.swaps[k] = v; n++; }
      }
    }
    if (errors.length) return { ok: false, errors };
    return { ok: true, value: out };
  }
  function validateEvents(events, max) {
    if (!Array.isArray(events)) return 'Events must be a list.';
    if (events.length > (max || 200000)) return 'Too many events.';
    for (const e of events) {
      if (!e || typeof e !== 'object') return 'Bad event.';
      if (!EVENT_TYPES.includes(e.type)) return 'Unknown event type.';
      if (typeof e.ts !== 'string' || e.ts.length > 40) return 'Bad timestamp.';
      if (e.data == null || typeof e.data !== 'object') return 'Bad event data.';
    }
    if (hasBadKeys(events, 0)) return 'Unsafe keys found.';
    return null;
  }

  // ---------- food logging ----------
  const MEALS = ['Breakfast', 'Pre-workout', 'Post-workout', 'Lunch', 'Snack', 'Dinner'];
  const FOOD_MAX_KCAL = 3000;
  function macroKcal(p, c, f) { return 4 * (p || 0) + 4 * (c || 0) + 9 * (f || 0); }
  function num0(x, max) { const n = Number(x); return Number.isFinite(n) ? clamp(Math.round(n), 0, max) : 0; }
  function cleanStr(x, n) { return String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }

  // Turns anything a person typed or a model returned into a safe food entry, or explains why not.
  // Never trusts the input: every field is clamped and every string is length-limited.
  function normalizeFood(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['That is not a food entry.'] };
    if (hasBadKeys(raw, 0)) return { ok: false, errors: ['Unsafe keys were found.'] };
    const warnings = [];
    const items = [];
    if (Array.isArray(raw.items)) {
      for (const it of raw.items.slice(0, 25)) {
        if (!it || typeof it !== 'object') continue;
        const name = cleanStr(it.name, 60);
        if (!name) continue;
        items.push({ name, qty: cleanStr(it.qty, 40), kcal: num0(it.kcal, FOOD_MAX_KCAL), protein: num0(it.protein, 400), carbs: num0(it.carbs, 800), fat: num0(it.fat, 400) });
      }
    }
    let kcal = num0(raw.kcal, FOOD_MAX_KCAL), protein = num0(raw.protein, 400), carbs = num0(raw.carbs, 800), fat = num0(raw.fat, 400);
    const sum = (k) => items.reduce((t, x) => t + x[k], 0);
    if (items.length) {
      // The line items are the evidence, so totals follow them.
      const sk = sum('kcal'), sp = sum('protein'), sc = sum('carbs'), sf = sum('fat');
      if (!kcal || Math.abs(sk - kcal) > Math.max(30, 0.05 * kcal)) { if (kcal) warnings.push('The total did not match the ingredients, so it was recalculated from them.'); kcal = sk; protein = sp; carbs = sc; fat = sf; }
    }
    const name = cleanStr(raw.name, 80) || (items.length ? items.map((x) => x.name).slice(0, 3).join(', ') : '');
    if (!name) return { ok: false, errors: ['Give the food a name.'] };
    if (kcal > FOOD_MAX_KCAL || Number(raw.kcal) > FOOD_MAX_KCAL) return { ok: false, errors: ['That is over ' + FOOD_MAX_KCAL + ' kcal for one entry. Split it up.'] };
    if (!kcal && (protein || carbs || fat)) kcal = Math.round(macroKcal(protein, carbs, fat));
    if (!kcal) return { ok: false, errors: ['Add the calories, or the macros so they can be worked out.'] };
    const mk = macroKcal(protein, carbs, fat);
    if (mk > 0 && Math.abs(mk - kcal) > Math.max(60, 0.25 * kcal)) warnings.push('Calories (' + kcal + ') and macros (about ' + Math.round(mk) + ' kcal) do not add up. Worth a second look.');
    const conf = ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium';
    const assumptions = Array.isArray(raw.assumptions) ? raw.assumptions.slice(0, 8).map((x) => cleanStr(x, 160)).filter(Boolean) : [];
    return { ok: true, value: { name, kcal, protein, carbs, fat, items, assumptions, confidence: conf }, warnings };
  }
  // Models sometimes wrap JSON in prose or code fences. Pull out the first object, nothing more.
  function parseJsonLoose(text) {
    const t = String(text || '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('The reply did not contain any data.');
    return JSON.parse(t.slice(a, b + 1));
  }
  function dayTotals(state, date) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, n: 0 };
    for (const f of state.foods) if (f.date === date) { t.kcal += f.kcal || 0; t.protein += f.protein || 0; t.carbs += f.carbs || 0; t.fat += f.fat || 0; t.n++; }
    return t;
  }

  // ---------- activity: workouts, streaks, calories burnt ----------
  // MET values are [easy, moderate, hard], rounded from the Compendium of Physical Activities (2024 adult edition).
  // Pickleball has no official value, so its numbers sit between badminton and doubles tennis. All of this is an estimate.
  const ACTIVITIES = {
    strength: { name: 'Strength training', met: [3.5, 5, 6] },
    swimming: { name: 'Swimming', met: [5.8, 7, 9.8] },
    football: { name: 'Football', met: [7, 8.5, 10] },
    tennis: { name: 'Tennis', met: [6, 7.3, 8] },
    badminton: { name: 'Badminton', met: [4.5, 5.5, 7] },
    pickleball: { name: 'Pickleball', met: [3.5, 4.5, 6] },
    hot_yoga: { name: 'Hot yoga', met: [2.5, 3, 4] },
    yoga: { name: 'Yoga', met: [2, 2.5, 4] },
    running: { name: 'Running', met: [7, 9.8, 11.5] },
    cycling: { name: 'Cycling', met: [4, 6.8, 10] },
    walking: { name: 'Walking', met: [2.8, 3.5, 5] },
    hiking: { name: 'Hiking', met: [4.5, 6, 7.8] },
    hiit: { name: 'HIIT or circuits', met: [6, 8, 10] },
    cricket: { name: 'Cricket', met: [3.5, 4.8, 6] },
    basketball: { name: 'Basketball', met: [4.5, 6.5, 8] },
    table_tennis: { name: 'Table tennis', met: [3, 4, 5] },
    squash: { name: 'Squash', met: [7.3, 9, 12] },
    rowing: { name: 'Rowing', met: [4.8, 7, 8.5] },
    climbing: { name: 'Climbing', met: [5, 7.5, 8.5] },
    boxing: { name: 'Boxing or martial arts', met: [5, 7.8, 10.3] },
    dance: { name: 'Dance', met: [3.5, 5, 7] },
    stretching: { name: 'Stretching or mobility', met: [2, 2.3, 2.8] },
    other: { name: 'Other activity', met: [3, 5, 7] },
  };
  const EFFORTS = ['easy', 'moderate', 'hard'];
  const isActivity = (t) => typeof t === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITIES, t);
  function metFor(type, effort) {
    const a = isActivity(type) ? ACTIVITIES[type] : ACTIVITIES.other, i = EFFORTS.indexOf(effort);
    return a.met[i < 0 ? 1 : i];
  }
  // Active calories: what the session burnt above sitting still, (MET - 1) x kg x hours.
  function estimateKcal(type, effort, mins, kg) {
    const m = clamp(Number(mins) || 0, 0, 600), w = clamp(Number(kg) || 70, 30, 300);
    return Math.round(Math.max(0, metFor(type, effort) - 1) * w * m / 60);
  }
  const hasLift = (plan, id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(plan.lifts, id);
  function slug(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'x'; }
  // An id for a lift the person makes up: c_<name>_<n>, unique in this plan, always safe to store and to import.
  function newLiftId(plan, name) {
    const base = 'c_' + slug(name);
    for (let n = 1; n < 1000; n++) { const id = base + '_' + n; if (!Object.prototype.hasOwnProperty.call(plan.lifts, id)) return id; }
    return base + '_' + Date.now().toString(36).slice(-4);
  }
  const exId = (ex) => ex.lift || 'acc_' + slug(ex.n);

  // Turns a workout read from the log (or a coach proposal, or a backup) into a safe entry, or refuses it.
  function cleanWorkout(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['That is not a workout.'] };
    const date = String(raw.date || '');
    if (!validISO(date)) return { ok: false, errors: ['Bad date.'] };
    const mins = Math.round(Number(raw.mins));
    if (!(mins >= 1)) return { ok: false, errors: ['Add how long it lasted.'] };
    const kcal = clamp(Math.round(Number(raw.kcal) || 0), 0, 5000);
    // An optional photo: two ids pointing at compressed copies kept in the media store, never the raw file.
    const mediaId = (x) => /^[a-z0-9][a-z0-9_]{0,69}$/.test(String(x || '')) ? String(x) : null;
    const photo = raw.photo && typeof raw.photo === 'object' && mediaId(raw.photo.thumb) ? { thumb: mediaId(raw.photo.thumb), full: mediaId(raw.photo.full) } : null;
    return { ok: true, value: {
      id: /^w_[a-z0-9]{3,24}$/.test(String(raw.id || '')) ? String(raw.id) : '',
      date, type: isActivity(raw.type) ? raw.type : 'other', label: cleanStr(raw.label, 40),
      mins: clamp(mins, 1, 600), effort: EFFORTS.includes(raw.effort) ? raw.effort : 'moderate',
      kcal, manual: raw.manual === true && kcal > 0, session: cleanStr(raw.session, 40), note: cleanStr(raw.note, 200),
      km: Number.isFinite(Number(raw.km)) ? Math.round(clamp(Number(raw.km), 0, 1000) * 100) / 100 : 0,
      photo,
    } };
  }
  const workoutName = (w) => w.label || (isActivity(w.type) ? ACTIVITIES[w.type] : ACTIVITIES.other).name;
  // Body weight to use for a date: the weigh-ins around it, else the latest one before it, else the starting weight.
  function bodyKg(state, date) {
    const near = weightAround(state.weights, date);
    if (near) return near;
    let last = null;
    for (const w of state.weights) if (w.date <= date) last = w;
    return last ? last.kg : (state.profile && state.profile.weightKg) || 70;
  }
  function defaultActiveGoal(profile) { const n = profile && Array.isArray(profile.days) ? profile.days.length : 0; return clamp(n || 4, 1, 7); }

  // ---------- water: a daily goal from body weight and activity, and an in-app pacing nudge ----------
  // No push notifications (there is no server to send them from): this only tells you, while the app is open,
  // whether you are behind a simple even pace across the day.
  const ML_PER_OZ = 29.5735;
  const WATER_ML_PER_KG = 35; // a common everyday guideline, not medical advice
  const WATER_ML_PER_ACTIVE_MIN = 12; // extra allowance for sweat lost training, roughly 700 ml an hour
  const WATER_EXTRA_CAP_ML = 1500;
  const WATER_WAKE_HOUR = 7, WATER_SLEEP_HOUR = 22; // the window the pace nudge is spread across
  const volUnitFor = (set) => (set && (set.waterUnit === 'ml' || set.waterUnit === 'oz') ? set.waterUnit : (set && set.bodyUnit === 'lb' ? 'oz' : 'ml'));
  const mlToUnit = (ml, unit) => (unit === 'oz' ? ml / ML_PER_OZ : ml);
  const unitToMl = (v, unit) => (unit === 'oz' ? v * ML_PER_OZ : v);
  function fmtVol(ml, unit) {
    if (unit === 'oz') return Math.round(mlToUnit(ml, 'oz')) + ' fl oz';
    return ml >= 1000 ? Math.round(ml / 100) / 10 + ' L' : Math.round(ml) + ' ml';
  }
  // Baseline from body weight, plus a capped extra for today's training minutes, rounded to a clean number.
  function waterGoalMl(state, date) {
    const kg = bodyKg(state, date);
    const mins = (state.workouts || []).filter((w) => w.date === date).reduce((t, w) => t + (w.mins || 0), 0);
    const extra = Math.min(WATER_EXTRA_CAP_ML, mins * WATER_ML_PER_ACTIVE_MIN);
    return Math.round((kg * WATER_ML_PER_KG + extra) / 50) * 50;
  }
  function dayWaterMl(state, date) { return (state.water || []).filter((w) => w.date === date).reduce((t, w) => t + (w.ml || 0), 0); }
  // How much of the goal "should" be drunk by this hour, on a simple even pace across the waking hours.
  function waterExpectedMl(goalMl, hour) {
    const frac = clamp((hour - WATER_WAKE_HOUR) / (WATER_SLEEP_HOUR - WATER_WAKE_HOUR), 0, 1);
    return Math.round(goalMl * frac);
  }

  // ----- the suggested session for a day. The plan says a weekday; the person can move it. -----
  // Returns { session, planned, moved }: what is on for that date, what the plan had, and whether they differ.
  function sessionFor(plan, moves, date) {
    const planned = plan.workouts.find((x) => x.weekday === weekdayOf(date)) || null;
    const mv = moves && moves[date];
    let session = planned;
    if (mv === 'rest') session = null;
    else if (mv) session = plan.workouts.find((x) => x.name === mv) || planned;
    return { session, planned, moved: (session ? session.name : null) !== (planned ? planned.name : null) };
  }
  // Moving a session to another day. If that day already has one, the two swap. Returns the session_moved payloads to write.
  function moveSession(plan, moves, fromDate, toDate) {
    if (fromDate === toDate) return [];
    const a = sessionFor(plan, moves, fromDate).session;
    if (!a) return [];
    const b = sessionFor(plan, moves, toDate).session;
    return [{ date: toDate, session: a.name }, { date: fromDate, session: b ? b.name : 'rest' }];
  }
  // Do session `name` on `date` instead of whatever is planned there. Returns { events, moved, dropped }.
  // If `name` is still to do on another day of that plan week, that day is cleared (or takes the displaced session, if it is
  // later). The displaced session gets the next free day that week, or comes off the week: it is never counted as missed.
  function changeSession(state, date, name, today) {
    const plan = state.plan, target = plan.workouts.find((w) => w.name === name);
    const none = { events: [], moved: null, dropped: null };
    if (!target) return none;
    const cur = sessionFor(plan, state.moves, date).session;
    if (cur && cur.name === name) return none;
    const week = weekOf(plan.startDate, date), idx = setIndex(state), b = weekRange(plan.startDate, week)[1], a = weekRange(plan.startDate, week)[0];
    const out = new Map([[date, name]]);
    let from = null;
    if (!sessionDoneIn(state, target, week, idx)) {
      for (let d = a; d <= b && !from; d = addDays(d, 1)) if (d !== date) { const s = sessionFor(plan, state.moves, d).session; if (s && s.name === name) from = d; }
    }
    if (from) out.set(from, 'rest');
    let moved = null, dropped = null;
    if (cur && !sessionDoneIn(state, cur, week, idx)) {
      let home = from && from > date ? from : null;
      for (let d = addDays(date, 1); d <= b && !home; d = addDays(d, 1)) if (!out.has(d) && !sessionFor(plan, state.moves, d).session) home = d;
      if (home) { out.set(home, cur.name); moved = { name: cur.name, date: home }; } else dropped = cur.name;
    }
    return { events: Array.from(out, ([d, n]) => ({ date: d, session: n })), moved, dropped };
  }
  // Move a named session to `to`: swap with what is there, or, if it is not on the coming plan, add it on that day.
  function relocateSession(state, name, to, today) {
    const plan = state.plan, idx = setIndex(state);
    let from = null;
    const toWeek = weekOf(plan.startDate, to);
    // only a session still to do in the same plan week is swapped: moving it across weeks would quietly empty another week
    for (let i = 0; i <= 13 && !from; i++) { const d = addDays(today, i), wk = weekOf(plan.startDate, d), s = sessionFor(plan, state.moves, d).session; if (wk === toWeek && s && s.name === name && !sessionDoneIn(state, s, wk, idx)) from = d; }
    if (from === to) return { events: [], from, displaced: null, dropped: null };
    if (from) { const there = sessionFor(plan, state.moves, to).session; return { events: moveSession(plan, state.moves, from, to), from, displaced: there ? there.name : null, dropped: null }; }
    const r = changeSession(state, to, name, today);
    return { events: r.events, from: null, displaced: r.moved ? r.moved.name : null, dropped: r.dropped };
  }
  // Working sets grouped by day.
  function setIndex(state) {
    const m = new Map();
    for (const x of state.sets) if (!x.warmup && typeof x.date === 'string') { const a = m.get(x.date); if (a) a.push(x); else m.set(x.date, [x]); }
    return m;
  }
  // A session counts as done in a plan week when a strength workout was logged for it, or when on one day
  // at least half of its exercises got working sets. It does not matter which weekday that was.
  function sessionDoneIn(state, session, week, idx) {
    const [a, b] = weekRange(state.plan.startDate, week);
    if (state.workouts.some((w) => w.type === 'strength' && w.session === session.name && w.date >= a && w.date <= b)) return true;
    if (!session.ex.length) return false;
    for (let d = a; d <= b; d = addDays(d, 1)) {
      const ss = idx.get(d);
      if (!ss || ss.length < 2) continue;
      const have = new Set(ss.map((x) => x.lift));
      // an exercise also counts when its sets were logged before it became a tracked lift
      if (session.ex.filter((ex) => have.has(exId(ex)) || have.has('acc_' + slug(ex.n)) || (ex.was && have.has(ex.was))).length / session.ex.length >= 0.5) return true;
    }
    return false;
  }
  // The sessions on for one plan week, after moves, with where each stands.
  function weekPlan(state, week, today, idx) {
    const ix = idx || setIndex(state), [a, b] = weekRange(state.plan.startDate, week), out = [];
    for (let d = a; d <= b; d = addDays(d, 1)) {
      const f = sessionFor(state.plan, state.moves, d);
      if (!f.session) continue;
      const done = sessionDoneIn(state, f.session, week, ix);
      out.push({ date: d, name: f.session.name, moved: f.moved, done, status: done ? 'done' : d < today ? 'missed' : d === today ? 'today' : 'upcoming' });
    }
    return out;
  }

  // ----- when was the person active -----
  function dayIndex(state) {
    const m = new Map();
    const get = (d) => { let o = m.get(d); if (!o) { o = { date: d, mins: 0, kcal: 0, workouts: 0, sets: 0, kinds: [] }; m.set(d, o); } return o; };
    for (const w of state.workouts) { const o = get(w.date); o.mins += w.mins; o.kcal += w.kcal; o.workouts++; if (!o.kinds.includes(w.type)) o.kinds.push(w.type); }
    for (const x of state.sets) if (!x.warmup && typeof x.date === 'string') { const o = get(x.date); o.sets++; if (!o.kinds.includes('strength')) o.kinds.push('strength'); }
    return m;
  }
  function dayStreaks(days, today) {
    let cur = 0, d = days.has(today) ? today : addDays(today, -1);
    while (days.has(d)) { cur++; d = addDays(d, -1); }
    let best = 0, run = 0, prev = null;
    for (const k of Array.from(days.keys()).filter((x) => x <= today).sort()) { run = prev && daysBetween(prev, k) === 1 ? run + 1 : 1; if (run > best) best = run; prev = k; }
    return { cur, best };
  }
  // Weeks in a row (plan weeks) with at least `goal` active days. The week in progress never breaks a streak; it only adds to it once the goal is met.
  function weekStreaks(days, start, today, goal) {
    const wi = (d) => Math.floor(daysBetween(start, d) / 7);
    const per = new Map();
    for (const k of days.keys()) if (k <= today) per.set(wi(k), (per.get(wi(k)) || 0) + 1);
    const cw = wi(today);
    let cur = 0, w = (per.get(cw) || 0) >= goal ? cw : cw - 1;
    while ((per.get(w) || 0) >= goal) { cur++; w--; }
    let best = 0, run = 0, prev = null;
    for (const k of Array.from(per.keys()).filter((x) => per.get(x) >= goal).sort((a, b) => a - b)) { run = prev != null && k === prev + 1 ? run + 1 : 1; if (run > best) best = run; prev = k; }
    return { cur, best, thisWeekDays: per.get(cw) || 0 };
  }
  function activitySummary(state, today, goal) {
    const days = dayIndex(state), g = clamp(Math.round(goal) || 4, 1, 7), start = state.plan.startDate;
    const ds = dayStreaks(days, today), ws = weekStreaks(days, start, today, g);
    const week = weekOf(start, today), [a, b] = weekRange(start, week);
    const tw = { week, days: 0, goal: g, mins: 0, kcal: 0, workouts: 0 };
    for (const [k, o] of days) if (k >= a && k <= b && k <= today) { tw.days++; tw.mins += o.mins; tw.kcal += o.kcal; tw.workouts += o.workouts; }
    const last14 = [];
    for (let i = 13; i >= 0; i--) { const d = addDays(today, -i), o = days.get(d); last14.push({ date: d, active: !!o, kinds: o ? o.kinds.slice() : [] }); }
    const past = Array.from(days.keys()).filter((k) => k <= today).sort();
    const lastActive = past.length ? past[past.length - 1] : null;
    const totals = { days: past.length, workouts: 0, mins: 0, kcal: 0 };
    for (const k of past) { const o = days.get(k); totals.workouts += o.workouts; totals.mins += o.mins; totals.kcal += o.kcal; }
    return { goal: g, dayStreak: ds.cur, bestDayStreak: ds.best, weekStreak: ws.cur, bestWeekStreak: ws.best, thisWeek: tw, last14, totals, lastActive, daysSince: lastActive ? daysBetween(lastActive, today) : null };
  }
  // One row per plan week up to `upTo`: active days, time, calories, and how many of the week's sessions got done.
  function activityWeeks(state, upTo, today) {
    const days = dayIndex(state), idx = setIndex(state), start = state.plan.startDate, out = [];
    for (let w = 1; w <= upTo; w++) {
      const [a, b] = weekRange(start, w);
      const r = { week: w, days: 0, workouts: 0, mins: 0, kcal: 0, sets: 0, planned: 0, done: 0 };
      for (let d = a; d <= b; d = addDays(d, 1)) { const o = days.get(d); if (o) { r.days++; r.workouts += o.workouts; r.mins += o.mins; r.kcal += o.kcal; r.sets += o.sets; } }
      for (const p of weekPlan(state, w, today, idx)) { r.planned++; if (p.done) r.done++; }
      out.push(r);
    }
    return out;
  }
  // What the person did since a date, by activity. A strength day with sets but no time logged still counts as a session.
  function activityMix(state, since, today) {
    const map = new Map();
    const add = (type, label, mins, kcal) => {
      const key = type === 'other' && label ? 'other:' + label.toLowerCase() : type;
      let o = map.get(key);
      if (!o) { o = { type, name: type === 'other' && label ? label : ACTIVITIES[type].name, sessions: 0, mins: 0, kcal: 0 }; map.set(key, o); }
      o.sessions++; o.mins += mins; o.kcal += kcal;
    };
    const strengthDays = new Set();
    for (const w of state.workouts) if (w.date >= since && w.date <= today) { add(w.type, w.label && w.type === 'other' ? w.label : '', w.mins, w.kcal); if (w.type === 'strength') strengthDays.add(w.date); }
    for (const [d] of setIndex(state)) if (d >= since && d <= today && !strengthDays.has(d)) add('strength', '', 0, 0);
    return Array.from(map.values()).sort((a, b) => b.mins - a.mins || b.sessions - a.sessions);
  }
  // The compact, note-free summary the coach sees.
  function activityDigest(state, today, goal) {
    const sum = activitySummary(state, today, goal), week = weekOf(state.plan.startDate, today), since = addDays(today, -27);
    const wks = activityWeeks(state, Math.max(1, week), today).slice(-4);
    const recent = state.workouts.filter((w) => w.date <= today).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq)).slice(0, 10)
      .map((w) => ({ date: w.date, activity: workoutName(w), mins: w.mins, kcal: w.kcal, effort: w.effort, session: w.session || undefined }));
    const moves = Object.keys(state.moves).filter((d) => d >= addDays(today, -14) && d <= addDays(today, 7)).sort().map((d) => ({ date: d, session: state.moves[d] }));
    return {
      goalActiveDaysPerWeek: sum.goal, dayStreak: sum.dayStreak, weekStreak: sum.weekStreak, bestWeekStreak: sum.bestWeekStreak, daysSinceLastActive: sum.daysSince,
      thisWeek: { activeDays: sum.thisWeek.days, mins: sum.thisWeek.mins, activeKcal: sum.thisWeek.kcal, sessions: weekPlan(state, week, today).map((p) => ({ session: p.name, date: p.date, status: p.status, movedFromPlan: p.moved })) },
      last4Weeks: wks.map((r) => ({ week: r.week, activeDays: r.days, mins: r.mins, activeKcal: r.kcal, plannedSessions: r.planned, doneSessions: r.done })),
      mix28d: activityMix(state, since, today).map((m) => ({ activity: m.name, sessions: m.sessions, mins: m.mins, activeKcal: m.kcal })),
      recent, sessionMoves: moves,
    };
  }

  const Engine = {
    MEALS, macroKcal, normalizeFood, parseJsonLoose, dayTotals,
    ENDURANCE_SPORTS, GOAL_AIMS, GOAL_RANGE, MAX_GOALS, isGoalId, newGoalId, cleanGoal, cleanGoalEntry,
    KG_PER_LB, CM_PER_IN, WEEKS, MIN_WEEKS, MAX_WEEKS, PLAN_LENGTHS, planWeeks, deloadWeeksFor, photoWeeks, targetOpts, PHOTO_WEEKS, checkinDate, checkinStatus, anglesTaken, CLIP_TAGS, cleanClip, DELOAD_WEEKS, ANGLES, HEAVY_WAVE, CATALOG, DEFAULT_LIFT_ORDER, MEAS_SITES, LIMITS, TEMPLATES, DEFAULT_STEPS,
    clean, roundTo, clamp, lbToKg, kgToLb, inToCm, cmToIn, isoDate, parseISO, addDays, daysBetween, weekOf, weekRange, weekdayOf,
    bmr, maintenance, targetsFor, recommendGoal, measurementTargets, blockOfWeek, blockWeights, e1rm, startWeight, buildLiftPlan, liftTarget,
    buildWorkouts, buildPlan, weeklyTargets, validateMacroChange, validateLiftChange, project, avgWeightSeries, latestMeas, setsForWeek,
    weightAround, measAround, snapshotAt, checkIns, goalDir, changeTone,
    liftStatus, reviewMonth, checkpoint, validateEvents, hasBadKeys, EVENT_TYPES, cleanProfileEdit, PROFILE_DIETS, DIET_STYLES, DIET_CUISINES, DIET_AVOID, DIET_SLOTS, styleFromProfile, defaultDietPrefs, cleanDietPrefs,
    LIFT_MUSCLES, LIFT_EQUIP, LIFT_CLS, defaultGain, cleanLift, newLiftId, slug, exId, substituteCandidates, normalizeLiftSwap, EQUIP_LIST,
    validISO, hasLift, changeSession, relocateSession, ACTIVITIES, EFFORTS, metFor, estimateKcal, cleanWorkout, workoutName, bodyKg, defaultActiveGoal, sessionFor, moveSession, setIndex, sessionDoneIn, weekPlan,
    volUnitFor, mlToUnit, unitToMl, fmtVol, waterGoalMl, dayWaterMl, waterExpectedMl, WATER_WAKE_HOUR, WATER_SLEEP_HOUR,
    dayIndex, dayStreaks, weekStreaks, activitySummary, activityWeeks, activityMix, activityDigest,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof self !== 'undefined' ? self : this);

/*
 * Water: a simple daily hydration log on Today. The goal comes from your body weight plus today's training
 * minutes (Engine.waterGoalMl); the only "reminder" is an in-app note when you are behind a simple even pace
 * for the time of day, shown while you have the app open. There is no server here, so there is no way to send
 * a real push notification once the app is closed - this never tries to.
 */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};
  const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

  const QUICK_ML = [150, 250, 350, 500];

  function logWater(ml) { return Store.append('water_logged', { date: U.today(), ml: E.clean(ml) }); }

  function customSheet() {
    const unit = E.volUnitFor(Store.getSettings());
    const f = UI.field({ label: 'Amount', unit, type: 'number', flex: 1 });
    U.sheet('Log water', h('div', { class: 'stack' }, f), [{ label: 'Cancel' }, { label: 'Log', kind: 'primary', run: () => {
      const v = numOrNull(f.input.value);
      const ml = v == null ? null : E.unitToMl(v, unit);
      if (!(ml > 0 && ml <= 3000)) { U.toast('Enter an amount up to ' + E.fmtVol(3000, unit) + '.', 'warn'); return false; }
      logWater(ml).then(() => { U.toast('Logged.'); root.App.render(); });
    } }]);
  }

  Screens.waterCard = function (st, set) {
    const t = U.today();
    const unit = E.volUnitFor(set);
    const goal = E.waterGoalMl(st, t);
    const logged = E.dayWaterMl(st, t);
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const expected = E.waterExpectedMl(goal, hour);
    const behind = Math.max(0, expected - logged);
    const entries = (st.water || []).filter((w) => w.date === t).slice().reverse();
    const kids = [
      h('div', { class: 'target-top' }, h('div', { class: 'ct' }, 'Water'), h('span', { class: 'muted small' }, 'Goal ' + E.fmtVol(goal, unit))),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'display big' }, E.fmtVol(logged, unit))), h('div', { class: 'muted' }, (goal ? Math.round((logged / goal) * 100) : 0) + '%')),
      U.bar(goal ? (logged / goal) * 100 : 0, logged >= goal ? 'good' : '', true),
    ];
    if (logged >= goal) {
      kids.push(h('div', { class: 'muted small' }, 'Goal reached for today.'));
    } else if (hour >= E.WATER_WAKE_HOUR && hour <= E.WATER_SLEEP_HOUR && behind >= 150) {
      kids.push(h('div', { class: 'muted small' }, 'About ' + E.fmtVol(behind, unit) + ' behind an even pace for this time of day. A glass now keeps you on track.'));
    } else if (hour < E.WATER_WAKE_HOUR || hour > E.WATER_SLEEP_HOUR) {
      kids.push(h('div', { class: 'muted small' }, 'Outside the ' + E.WATER_WAKE_HOUR + ':00 to ' + E.WATER_SLEEP_HOUR + ':00 pacing window, so no nudge right now.'));
    }
    kids.push(h('div', { class: 'pills' }, ...QUICK_ML.map((ml) => h('button', { type: 'button', class: 'pill', onclick: () => { logWater(ml).then(() => root.App.render()); } }, '+' + E.fmtVol(ml, unit)))));
    kids.push(UI.row(UI.btn('Log a custom amount', { kind: 'quiet', onClick: customSheet })));
    if (entries.length) {
      kids.push(h('div', { class: 'lab' }, 'Today'));
      for (const w of entries) kids.push(h('div', { class: 'kv' }, h('span', null, E.fmtVol(w.ml, unit)),
        h('button', { type: 'button', class: 'iconbtn tiny', 'aria-label': 'Remove this entry', onclick: () => { Store.voidEvent(w.seq).then(() => root.App.render()); } }, U.icon('x', 14))));
    }
    kids.push(h('div', { class: 'muted small' }, 'A guideline from your weight and today\'s training, not medical advice. The pacing note only shows while you have Regoal open; nothing is sent as a real notification.'));
    return UI.card(...kids);
  };
})(self);

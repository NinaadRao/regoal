/*
 * Tiny DOM and formatting helpers. All text goes through textContent / text nodes.
 * There is deliberately no innerHTML anywhere in this app (Trusted Types is enforced by the CSP).
 */
(function (root) {
  'use strict';
  const E = root.Engine;
  const SVGNS = 'http://www.w3.org/2000/svg';
  // The one place the app's colors live for SVG and canvas (CSS has the same values in :root of css/app.css).
  const PAL = { ink: '#E9F2EC', ink2: '#93A99C', chalk: '#090D0B', paper: '#111813', line: '#22302A', track: '#22302A', acc: '#3DDC84', accBg: '#0F2A1B', cool: '#5CB8FF', coral: '#FF7A5C' };

  function append(el, kids) {
    for (const k of kids) {
      if (k == null || k === false || k === true) continue;
      if (Array.isArray(k)) append(el, k);
      else if (k instanceof Node) el.appendChild(k);
      else el.appendChild(document.createTextNode(String(k)));
    }
  }
  function applyProps(el, props, isSvg) {
    for (const key of Object.keys(props || {})) {
      const v = props[key];
      if (v == null || v === false) continue;
      if (key === 'class') el.setAttribute('class', v);
      else if (key === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v);
      else if (key === 'text') el.textContent = v;
      else if (isSvg || key.startsWith('aria-') || key.startsWith('data-') || key === 'role' || key === 'for' || key === 'accept' || key === 'capture' || key === 'list' || key === 'inputmode' || key === 'autocomplete') el.setAttribute(key, v === true ? '' : v);
      else if (key in el) el[key] = v;
      else el.setAttribute(key, v === true ? '' : v);
    }
  }
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    applyProps(el, props, false);
    append(el, kids);
    return el;
  }
  function s(tag, props, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    applyProps(el, props, true);
    append(el, kids);
    return el;
  }
  // Like el.append, but skips null/false (native append would print the word "null").
  function put(el, ...kids) { append(el, kids); return el; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  // ---------- formatting ----------
  function num(x, d) {
    if (x == null || Number.isNaN(x)) return '';
    const p = Math.pow(10, d == null ? 1 : d);
    const r = Math.round(x * p) / p;
    return String(r);
  }
  function withCommas(x) { return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function kgToUnit(kg, unit) { return unit === 'lb' ? kg / E.KG_PER_LB : kg; }
  function unitToKg(v, unit) { return unit === 'lb' ? v * E.KG_PER_LB : v; }
  function fmtWeight(kg, unit, d) { return kg == null ? '' : num(kgToUnit(kg, unit), d == null ? 1 : d); }
  function fmtLift(kg, unit) { return kg == null ? 'BW' : num(kgToUnit(kg, unit), 1) + ' ' + unit; }
  function cmToUnit(cm, unit) { return unit === 'in' ? cm / E.CM_PER_IN : cm; }
  function unitToCm(v, unit) { return unit === 'in' ? v * E.CM_PER_IN : v; }
  function fmtLen(cm, unit, d) { return cm == null ? '' : num(cmToUnit(cm, unit), d == null ? 1 : d); }
  function today() { return E.isoDate(new Date()); }
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function longDate(iso) { const d = E.parseISO(iso); return DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function shortDate(iso) { const d = E.parseISO(iso); return MON[d.getMonth()] + ' ' + d.getDate(); }
  function b64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function unb64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------- toast and sheets ----------
  let toastTimer = null;
  function toast(msg, kind) {
    const box = document.getElementById('toast');
    if (!box) return;
    clear(box);
    box.appendChild(h('div', { class: 'toast ' + (kind || ''), role: 'status' }, msg));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => clear(box), 3600);
  }
  // opts.onClose runs once, however the sheet is closed (button, backdrop tap or Escape).
  function sheet(title, body, actions, opts) {
    const host = document.getElementById('sheets');
    let closed = false;
    const close = () => {
      if (wrap.parentNode) host.removeChild(wrap);
      document.removeEventListener('keydown', onKey);
      if (prev && prev.focus) prev.focus();
      if (!closed) { closed = true; if (opts && opts.onClose) opts.onClose(); }
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const prev = document.activeElement;
    const bar = h('div', { class: 'sheet-actions' });
    for (const a of actions || []) {
      bar.appendChild(h('button', { class: 'btn ' + (a.kind || 'quiet'), type: 'button', onclick: () => { const r = a.run ? a.run(close) : null; if (r !== false && !a.keep) close(); } }, a.label));
    }
    const wrap = h('div', { class: 'overlay', onclick: (e) => { if (e.target === wrap) close(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-title' }, title), h('button', { class: 'iconbtn sheet-x', type: 'button', 'aria-label': 'Dismiss this window', onclick: close }, icon('x', 20))), body, (actions || []).length ? bar : null));
    host.appendChild(wrap);
    document.addEventListener('keydown', onKey);
    const first = wrap.querySelector('input,select,textarea,button:not(.sheet-x)');
    if (first) first.focus();
    return close;
  }
  function confirmSheet(title, text, okLabel, onOk, danger) {
    return sheet(title, h('p', { class: 'muted' }, text), [
      { label: 'Cancel', kind: 'quiet' },
      { label: okLabel, kind: danger ? 'danger' : 'primary', run: () => onOk() },
    ]);
  }

  // ---------- small components ----------
  function chip(text, kind) { return h('span', { class: 'chip ' + (kind || 'line') }, text); }
  function bar(pct, kind, tall) {
    const fill = h('div', { class: 'bar-fill ' + (kind || '') });
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    return h('div', { class: 'bar' + (tall ? ' tall' : ''), role: 'progressbar', 'aria-valuenow': String(Math.round(pct)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  }
  function icon(name, size) {
    const paths = {
      home: 'M3 10.5 12 3l9 7.5V21H3z M9 21v-6h6v6',
      dumbbell: 'M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11',
      fork: 'M6 3v8M9 3v8M6 7h3M7.5 11v10M17 3c-2 2-3 5-3 8h3v10',
      chart: 'M3 3v18h18 M7 15l4-4 3 3 5-6',
      chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z',
      camera: 'M4 8h3l2-3h6l2 3h3v11H4z M12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
      lock: 'M5 11h14v10H5z M8 11V8a4 4 0 0 1 8 0v3',
      key: 'M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M11 12l9-9 M16 7l3 3',
      shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
      user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 21a8 8 0 0 1 16 0',
      check: 'M5 12l5 5 9-10',
      plus: 'M12 5v14M5 12h14',
      chev: 'M9 6l6 6-6 6',
      back: 'M15 6l-6 6 6 6',
      send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
      file: 'M6 3h9l4 4v14H6z M14 3v5h5',
      download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
      eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
      x: 'M6 6l12 12M18 6L6 18',
      trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
      undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
      pause: 'M8 5v14M16 5v14',
      swap: 'M9 7l-5 5 5 5 M15 7l5 5-5 5',
      target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 12h.01',
      flame: 'M12 3c.6 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2.2-4.2.1 1.6.8 2.6 1.8 2.9C10.6 8.7 10.8 5.6 12 3z',
      film: 'M4 5h16v14H4z M8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
    };
    const sz = size || 22;
    return s('svg', { width: sz, height: sz, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ic' }, s('path', { d: paths[name] || '' }));
  }
  function logoSvg(size) {
    // ring with a planet on it: the arc is progress, the planet is you today
    const rx = 20, ry = 9.5;
    const t = 2 * Math.PI * 0.62; // approx planet position along the ring
    const px = 24 + rx * Math.cos(t), py = 24 + ry * Math.sin(t);
    return s('svg', { width: size || 40, height: size || 40, viewBox: '0 0 48 48', 'aria-hidden': 'true' },
      s('g', { transform: 'rotate(-28 24 24)' },
        s('ellipse', { cx: 24, cy: 24, rx, ry, fill: 'none', stroke: PAL.ink, 'stroke-opacity': '0.28', 'stroke-width': 3.4 }),
        s('ellipse', { cx: 24, cy: 24, rx, ry, fill: 'none', stroke: PAL.acc, 'stroke-width': 3.4, 'stroke-linecap': 'round', pathLength: 100, 'stroke-dasharray': '68 32' }),
        s('circle', { cx: px.toFixed(2), cy: py.toFixed(2), r: 4.7, fill: PAL.acc, stroke: PAL.paper, 'stroke-width': 2 })),
      s('circle', { cx: 24, cy: 24, r: 4.6, fill: PAL.ink }));
  }

  // Line chart with a target line (dashed), a series (solid) and dots.
  function lineChart(opts) {
    const W = 320, H = 130, L = 34, R = 10, T = 10, B = 22;
    const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', 'aria-label': opts.label || 'chart', class: 'chart' });
    const xs = opts.xs, all = [];
    for (const ser of opts.series) for (const p of ser.pts) if (p.y != null) all.push(p.y);
    if (!all.length) { svg.appendChild(s('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: PAL.ink2, 'font-size': 12 }, 'No data yet')); return svg; }
    let lo = Math.min(...all), hi = Math.max(...all);
    if (opts.band) { lo = Math.min(lo, opts.band[0]); hi = Math.max(hi, opts.band[1]); }
    const padv = (hi - lo) * 0.15 || 1;
    lo -= padv; hi += padv;
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const px = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
    const py = (y) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);
    svg.appendChild(s('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: PAL.line }));
    svg.appendChild(s('line', { x1: L, y1: T, x2: L, y2: H - B, stroke: PAL.line }));
    if (opts.band) svg.appendChild(s('rect', { x: L, y: py(opts.band[1]), width: W - L - R, height: Math.max(2, py(opts.band[0]) - py(opts.band[1])), fill: PAL.accBg }));
    svg.appendChild(s('text', { x: 2, y: T + 8, fill: PAL.ink2, 'font-size': 10 }, opts.fmtY ? opts.fmtY(hi) : num(hi)));
    svg.appendChild(s('text', { x: 2, y: H - B, fill: PAL.ink2, 'font-size': 10 }, opts.fmtY ? opts.fmtY(lo) : num(lo)));
    svg.appendChild(s('text', { x: L, y: H - 6, fill: PAL.ink2, 'font-size': 10 }, opts.xLabel ? opts.xLabel(x0) : String(x0)));
    svg.appendChild(s('text', { x: W - R, y: H - 6, fill: PAL.ink2, 'font-size': 10, 'text-anchor': 'end' }, opts.xLabel ? opts.xLabel(x1) : String(x1)));
    for (const ser of opts.series) {
      const pts = ser.pts.filter((p) => p.y != null);
      if (!pts.length) continue;
      if (ser.line !== false) svg.appendChild(s('polyline', { points: pts.map((p) => px(p.x).toFixed(1) + ',' + py(p.y).toFixed(1)).join(' '), fill: 'none', stroke: ser.color, 'stroke-width': ser.width || 2.5, 'stroke-dasharray': ser.dash || '', 'stroke-linejoin': 'round' }));
      if (ser.dots) for (const p of pts) svg.appendChild(s('circle', { cx: px(p.x).toFixed(1), cy: py(p.y).toFixed(1), r: ser.r || 3.5, fill: ser.color }));
    }
    return svg;
  }

  // The app's name and mark, and its tagline: one place, used on the welcome screen and on Profile.
  const TAGLINE = ['Track the change.', 'Not the vibes.'];
  function brandMark() { return h('div', { class: 'brand' }, h('div', { class: 'app-icon' }, logoSvg(36)), h('div', { class: 'display wordmark' }, 'REGOAL')); }

  root.U = { TAGLINE, brandMark, h, s, put, clear, num, withCommas, kgToUnit, unitToKg, fmtWeight, fmtLift, cmToUnit, unitToCm, fmtLen, today, longDate, shortDate, b64, unb64, toast, sheet, confirmSheet, chip, bar, icon, logoSvg, lineChart, PAL, DOW, MON };
})(self);

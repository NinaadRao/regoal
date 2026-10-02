/*
 * The two "download" sheets: a time-lapse video of your check-ins and a comparison image.
 * Files are built on this device (js/mediaexport.js), shown back to you, and only leave Regoal when you tap
 * Save or share. The privacy note in each sheet is deliberate: the saved file is unblurred and not encrypted.
 */
(function (root) {
  'use strict';
  const U = root.U, UI = root.UI, Store = root.Store, MediaOut = root.MediaOut, E = root.Engine;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const slug = (t) => Screens._.slug(t).replace(/_/g, '-');

  function privacyNote() {
    return h('div', { class: 'warnbox privacy', role: 'note' }, U.icon('shield', 20),
      h('div', null, h('b', null, 'The saved file shows your photos unblurred'), ' and is not encrypted. It leaves Regoal only when you pick where it goes. Camera and location data are already removed.'));
  }
  const closeLink = (close) => h('button', { type: 'button', class: 'linkbtn', onclick: () => close() }, 'Cancel');

  // Shown once a file exists. Sharing needs a fresh tap, which is why this is a second step and not automatic.
  function resultView(box, o) {
    const url = URL.createObjectURL(o.blob); o.track(url);
    const media = o.kind === 'video'
      ? h('video', { src: url, controls: true, playsinline: true, muted: true, loop: true, class: 'resmedia', 'aria-label': 'Preview of your time-lapse' })
      : h('img', { src: url, alt: 'Preview of your comparison', class: 'resmedia' });
    const blurOn = !!Store.getSettings().blurPhotos;
    let hidden = blurOn;
    const holder = h('div', { class: 'resbox' + (hidden ? ' blur' : '') }, media);
    const peek = blurOn ? h('button', { type: 'button', class: 'chip line peekbtn', onclick: () => { hidden = !hidden; holder.classList.toggle('blur', hidden); peek.textContent = hidden ? 'Show preview' : 'Blur preview'; } }, 'Show preview') : null;
    const canShare = MediaOut.canShare(o.blob, o.name);
    const save = () => MediaOut.saveAs(o.blob, o.name);
    const shareOrSave = async () => { try { await MediaOut.share(o.blob, o.name); } catch (e) { if (!e || e.name !== 'AbortError') save(); } };
    U.clear(box);
    U.put(box,
      h('div', { class: 'target-top' }, h('div', { class: 'ct' }, o.kind === 'video' ? 'Your video is ready' : 'Your image is ready'), U.chip((o.blob.size / 1e6).toFixed(1) + ' MB · ' + o.ext.toUpperCase(), 'line')),
      holder, peek,
      h('div', { class: 'muted small' }, 'It is not saved anywhere yet. Choose ' + (canShare ? 'Save or share, then Save to Photos or Files.' : 'Download to keep it.')),
      UI.btn(canShare ? 'Save or share' : 'Download file', { icon: 'download', onClick: canShare ? shareOrSave : save }),
      canShare ? UI.btn('Download file', { kind: 'quiet', onClick: save }) : null,
      h('div', { class: 'linkrow' }, h('button', { type: 'button', class: 'linkbtn', onclick: o.again }, 'Change options'), h('button', { type: 'button', class: 'linkbtn', onclick: () => o.close() }, 'Done')));
  }

  Screens._ = Object.assign(Screens._ || {}, { resultView, privacyNote, closeLink });

  // ---------- time-lapse ----------
  // o: { angle, items: check-ins with a photo, index, numbersText, wkLabel }
  Screens._.videoSheet = async function (o) {
    const set = Store.getSettings(), st = Store.getState();
    const frames = [];
    for (const c of o.items) { const m = await Store.getMedia(c.photo.id); if (m) frames.push({ blob: m.blob, title: o.wkLabel(c), numbers: o.numbersText(c.snap, set), align: E.photoAlignFor(st, c.photo.id) }); }
    if (frames.length < 2) { U.toast('Those photos are not on this device, so there is nothing to make a video from.', 'warn'); return; }
    const idx = clamp(o.index, 0, frames.length - 1);
    const opt = { shape: 'story', secondsPer: 1, labels: true, numbers: true };
    const supported = !!MediaOut.pickVideoMime();
    const box = h('div', { class: 'stack' });
    const urls = [];
    let ctl = null, tok = 0, closeSheet = null;
    closeSheet = U.sheet('Download time-lapse', box, [], { onClose: () => { if (ctl) ctl.abort(); urls.forEach((u) => URL.revokeObjectURL(u)); tok++; } });

    function options() {
      U.clear(box);
      const prev = h('div', { class: 'exprev' + (set.blurPhotos ? ' blur' : ''), 'aria-hidden': 'true' });
      const refresh = async () => {
        const mine = ++tok;
        try { const cv = await MediaOut.stillFrame({ frames, shape: opt.shape, labels: opt.labels, numbers: opt.numbers }, idx, 0.22); if (mine === tok) { U.clear(prev); prev.appendChild(cv); } } catch (e) { /* the preview is a bonus */ }
      };
      const size = h('div', { class: 'muted small centered' });
      const say = () => { size.textContent = 'Made on this device, about ' + MediaOut.videoSizeMB(frames.length, opt.secondsPer) + ' MB. Nothing is uploaded. Then choose Save to Photos, Files or share.'; };
      const shape = UI.seg({ label: 'Shape', options: [{ value: 'story', label: 'Story' }, { value: 'square', label: 'Square' }, { value: 'original', label: 'Original' }], value: opt.shape, onChange: (v) => { opt.shape = v; refresh(); } });
      const speed = UI.seg({ label: 'Time per photo', options: [{ value: 1.5, label: '1.5 s' }, { value: 1, label: '1 s' }, { value: 0.5, label: '0.5 s' }], value: opt.secondsPer, onChange: (v) => { opt.secondsPer = v; say(); } });
      U.put(box,
        h('div', { class: 'target-top' }, h('span', { class: 'chip line' }, o.angle + ' · ' + frames.length + ' photos'), set.blurPhotos ? h('span', { class: 'muted small' }, 'Preview is blurred') : null),
        h('div', { class: 'expgrid' }, prev, h('div', { class: 'stack' }, shape, speed)),
        UI.toggleRow('Date', 'Shown on each frame', opt.labels, (v) => { opt.labels = v; refresh(); }),
        UI.toggleRow('Weight and waist', 'Shown on each frame', opt.numbers, (v) => { opt.numbers = v; refresh(); }),
        privacyNote(),
        supported ? null : h('div', { class: 'warnbox', role: 'alert' }, 'This browser cannot save video as MP4. Open Regoal in Safari or Chrome, or save a comparison image instead.'),
        UI.btn('Create video', { icon: 'download', disabled: !supported, onClick: create }),
        size, closeLink(closeSheet));
      say(); refresh();
    }

    async function create() {
      ctl = new AbortController();
      const my = ctl;
      const fill = h('div', { class: 'bar-fill' }), bar = h('div', { class: 'bar tall', role: 'progressbar', 'aria-label': 'Progress' }, fill);
      const status = h('div', { class: 'muted small centered', role: 'status' }, 'Preparing…');
      U.clear(box);
      U.put(box, h('div', { class: 'ct' }, 'Creating your video'), bar, status, h('div', { class: 'muted small centered' }, 'Keep Regoal open on this screen until it finishes. It records in real time.'), UI.btn('Cancel', { kind: 'quiet', onClick: () => my.abort() }));
      try {
        const out = await MediaOut.renderTimelapse({ frames, shape: opt.shape, secondsPer: opt.secondsPer, labels: opt.labels, numbers: opt.numbers, signal: my.signal, onProgress: (p, t) => { fill.style.width = Math.round(p * 100) + '%'; status.textContent = t; } });
        if (my.signal.aborted) return;
        resultView(box, { kind: 'video', blob: out.blob, ext: out.ext, name: 'regoal-timelapse-' + slug(o.angle) + '-' + U.today() + '.' + out.ext, track: (u) => urls.push(u), close: closeSheet, again: options });
      } catch (e) {
        if (my.signal.aborted) { options(); return; }
        options(); U.toast(String(e && e.message ? e.message : e), 'warn');
      }
    }
    options();
  };

  // ---------- comparison image ----------
  // o: { angle, a, b (check-ins with a photo), rows, mode, pos, blend, aligns?: {a, b} (live drafts from Compare) }
  Screens._.imageSheet = async function (o) {
    const set = Store.getSettings();
    const ma = await Store.getMedia(o.a.photo.id), mb = await Store.getMedia(o.b.photo.id);
    if (!ma || !mb) { U.toast('One of those photos is not on this device.', 'warn'); return; }
    const opt = { layout: 'side', format: 'jpeg', labels: true, table: o.rows.length > 0 };
    const aligns = o.aligns || {};
    const A = { blob: ma.blob, label: U.longDate(o.a.date), align: aligns.a || E.photoAlignFor(Store.getState(), o.a.photo.id) };
    const B = { blob: mb.blob, label: U.longDate(o.b.date), align: aligns.b || E.photoAlignFor(Store.getState(), o.b.photo.id) };
    // TEMP DEBUG: tracking down a report that the download doesn't reflect the live-screen alignment. Remove once found.
    const dbg = (x) => 'dx ' + x.dx.toFixed(2) + ' dy ' + x.dy.toFixed(2) + ' scale ' + x.scale.toFixed(2);
    const liveNow = Array.from(document.querySelectorAll('.cmp-side img, .cmp-slider img, .cmp-over')).map((el) => el.style.transform || '(none)').join(' | ');
    U.toast('EXPORT A: ' + dbg(A.align) + ' B: ' + dbg(B.align) + ' aligns? ' + (!!o.aligns) + ' LIVE: ' + liveNow, 'warn');
    const build = (scale) => MediaOut.composeComparison({ a: A, b: B, layout: opt.layout, format: scale ? 'jpeg' : opt.format, labels: opt.labels, rows: opt.table ? o.rows : null, head: [U.shortDate(o.a.date), U.shortDate(o.b.date)], pos: o.pos, blend: o.blend, scale });
    const box = h('div', { class: 'stack' });
    const urls = [];
    let tok = 0, prevUrl = null, closeSheet = null;
    closeSheet = U.sheet('Download comparison', box, [], { onClose: () => { tok++; urls.forEach((u) => URL.revokeObjectURL(u)); if (prevUrl) URL.revokeObjectURL(prevUrl); } });

    function options() {
      U.clear(box);
      const prev = h('div', { class: 'exprev wide' + (set.blurPhotos ? ' blur' : ''), 'aria-hidden': 'true' });
      const refresh = async () => {
        const mine = ++tok;
        try {
          const blob = await build(0.3);
          if (mine !== tok) return;
          if (prevUrl) URL.revokeObjectURL(prevUrl);
          prevUrl = URL.createObjectURL(blob);
          U.clear(prev); prev.appendChild(h('img', { src: prevUrl, alt: '' }));
        } catch (e) { /* the preview is a bonus */ }
      };
      const layout = UI.seg({ label: 'Layout', options: [{ value: 'side', label: 'Side by side' }, { value: 'slider', label: 'Slider view' }, { value: 'overlay', label: 'Overlay' }], value: opt.layout, onChange: (v) => { opt.layout = v; refresh(); } });
      const type = UI.seg({ label: 'File type', options: [{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }], value: opt.format, onChange: (v) => { opt.format = v; } });
      U.put(box,
        h('div', { class: 'target-top' }, h('span', { class: 'chip line' }, o.angle + ' · ' + U.shortDate(o.a.date) + ' vs ' + U.shortDate(o.b.date)), set.blurPhotos ? h('span', { class: 'muted small' }, 'Preview is blurred') : null),
        prev, layout, type,
        UI.toggleRow('Date labels', 'Shown on the image', opt.labels, (v) => { opt.labels = v; refresh(); }),
        o.rows.length ? UI.toggleRow('Measurements table', 'Added under the photos', opt.table, (v) => { opt.table = v; refresh(); }) : null,
        privacyNote(),
        UI.btn('Save image', { icon: 'download', onClick: save }),
        h('div', { class: 'muted small centered' }, 'Then choose Save to Photos, Files or share.'), closeLink(closeSheet));
      refresh();
    }

    async function save() {
      tok++;
      U.clear(box); U.put(box, h('div', { class: 'ct' }, 'Building your image'), h('div', { class: 'muted small', role: 'status' }, 'Drawing it on this device…'));
      try {
        const blob = await build(0);
        const ext = opt.format === 'png' ? 'png' : 'jpg';
        resultView(box, { kind: 'image', blob, ext, name: 'regoal-compare-' + slug(o.angle) + '-' + o.a.date + '-to-' + o.b.date + '.' + ext, track: (u) => urls.push(u), close: closeSheet, again: options });
      } catch (e) { options(); U.toast(String(e && e.message ? e.message : e), 'warn'); }
    }
    options();
  };
})(self);

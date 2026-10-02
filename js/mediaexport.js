/*
 * Builds the two files you can save from the photo screens: a comparison image and a time-lapse video.
 * Everything is drawn on a canvas on this device. Nothing is uploaded, and because the pixels are redrawn the
 * files carry no camera, time or location data. The saved files show the photos unblurred and are not encrypted.
 */
(function (root) {
  'use strict';
  const { h } = root.U;
  const P = root.U.PAL;
  const C = { ink: P.ink, ink2: P.ink2, chalk: P.chalk, paper: P.paper, line: P.line, acc: P.acc, good: P.acc, coral: P.coral };
  const FONT = '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
  const DISPLAY = '"Big Shoulders Display", "Arial Narrow", sans-serif';
  const TONE = { good: C.good, coral: C.coral };
  const VIDEO_BPS = 4000000;

  async function fontsReady() {
    try { await Promise.all([document.fonts.load('500 20px "DM Sans"'), document.fonts.load('700 20px "DM Sans"'), document.fonts.load('800 20px "Big Shoulders Display"')]); } catch (e) { /* system fonts are fine */ }
  }
  async function decode(blob) {
    try { return await createImageBitmap(blob); } catch (e) {
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not read one of the photos.')); img.src = url; });
        return img;
      } finally { URL.revokeObjectURL(url); }
    }
  }
  const dims = (im) => ({ w: im.videoWidth || im.width || im.naturalWidth, h: im.videoHeight || im.height || im.naturalHeight });
  const release = (im) => { if (im && im.close) im.close(); };
  const canvasOf = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; };
  const toBlob = (cv, mime, q) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not build the file.'))), mime, q));

  function rr(ctx, x, y, w, hh, r) {
    r = Math.min(r, w / 2, hh / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // Fill a box with the photo, cropping the overflow evenly (the same framing the compare screen shows).
  // align: an optional saved { dx, dy, scale } (see Engine.photoAlignFor) — the same manual or AI-suggested
  // pan/zoom the live preview applies with a CSS transform, reproduced here in source-pixel terms so a
  // downloaded image or time-lapse matches what was actually lined up on screen, not just an auto-centred crop.
  // The crop rectangle is pinned so it never falls outside the source photo: a pan saved close to the
  // allowed edge (especially with little or no zoom) would otherwise land fully off the image and draw
  // nothing at all, leaving that one photo blank in a download or time-lapse frame.
  function cover(ctx, im, x, y, w, hh, alpha, align) {
    const d = dims(im), k = Math.max(w / d.w, hh / d.h), sw = w / k, sh = hh / k;
    const a = align || { dx: 0, dy: 0, scale: 1 }, scale = a.scale || 1;
    const cw = Math.min(sw / scale, d.w), ch = Math.min(sh / scale, d.h);
    const cx = Math.min(Math.max(d.w / 2 + a.dx * cw, cw / 2), d.w - cw / 2);
    const cy = Math.min(Math.max(d.h / 2 + a.dy * ch, ch / 2), d.h - ch / 2);
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.rect(x, y, w, hh); ctx.clip();
    ctx.drawImage(im, cx - cw / 2, cy - ch / 2, cw, ch, x, y, w, hh);
    ctx.restore();
  }
  function pill(ctx, text, x, y, px, align) {
    ctx.save();
    ctx.font = '700 ' + px + 'px ' + FONT;
    const pad = px * 0.65, w = ctx.measureText(text).width + pad * 2, hh = px * 1.9, x0 = align === 'right' ? x - w : x;
    ctx.fillStyle = 'rgba(9,13,11,0.8)'; rr(ctx, x0, y, w, hh, hh / 2); ctx.fill();
    ctx.fillStyle = C.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, x0 + pad, y + hh / 2 + px * 0.04);
    ctx.restore();
    return { w, h: hh };
  }

  // ---------- comparison image ----------
  // o: { a, b: {blob, label, align?: {dx,dy,scale}}, layout: 'side'|'slider'|'overlay', format: 'jpeg'|'png', labels,
  //      rows: [{name, a, b, change, tone}]|null, head: [labelA, labelB], pos (0..1, slider), blend (0..1, overlay), scale }
  async function composeComparison(o) {
    await fontsReady();
    const A = await decode(o.a.blob), B = await decode(o.b.blob);
    try {
      const k = o.scale || 1, single = o.layout !== 'side';
      const cw = Math.round((single ? 1080 : 900) * k), ch = Math.round(cw * 4 / 3), gap = single ? 0 : Math.max(2, Math.round(8 * k));
      const W = single ? cw : cw * 2 + gap;
      const rows = o.rows && o.rows.length ? o.rows : null;
      const rowH = Math.round(W * 0.066), tableH = rows ? rowH * (rows.length + 1) + Math.round(W * 0.05) : 0;
      const cv = canvasOf(W, ch + tableH), ctx = cv.getContext('2d');
      ctx.fillStyle = C.chalk; ctx.fillRect(0, 0, cv.width, cv.height);
      const pos = Math.max(0, Math.min(1, o.pos == null ? 0.5 : o.pos)), blend = Math.max(0, Math.min(1, o.blend == null ? 0.5 : o.blend));
      const alignA = o.a.align, alignB = o.b.align;
      if (o.layout === 'side') { cover(ctx, A, 0, 0, cw, ch, null, alignA); cover(ctx, B, cw + gap, 0, cw, ch, null, alignB); }
      else if (o.layout === 'slider') {
        cover(ctx, B, 0, 0, cw, ch, null, alignB);
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pos * cw, ch); ctx.clip(); cover(ctx, A, 0, 0, cw, ch, null, alignA); ctx.restore();
        const x = pos * cw, lw = Math.max(2, 6 * k), r = 30 * k;
        ctx.fillStyle = C.acc; ctx.fillRect(x - lw / 2, 0, lw, ch);
        ctx.beginPath(); ctx.arc(x, ch / 2, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = C.chalk; ctx.lineWidth = Math.max(2, 5 * k); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(x - 6 * k, ch / 2 - 10 * k); ctx.lineTo(x - 16 * k, ch / 2); ctx.lineTo(x - 6 * k, ch / 2 + 10 * k); ctx.moveTo(x + 6 * k, ch / 2 - 10 * k); ctx.lineTo(x + 16 * k, ch / 2); ctx.lineTo(x + 6 * k, ch / 2 + 10 * k); ctx.stroke();
      } else { cover(ctx, A, 0, 0, cw, ch, null, alignA); cover(ctx, B, 0, 0, cw, ch, blend, alignB); }
      if (o.labels) {
        const px = Math.round(W * (single ? 0.03 : 0.024)), m = Math.round(W * 0.02), ph = px * 1.9;
        if (o.layout === 'side') { pill(ctx, o.a.label, m, ch - m - ph, px, 'left'); pill(ctx, o.b.label, cw + gap + m, ch - m - ph, px, 'left'); }
        else { pill(ctx, o.a.label, m, ch - m - ph, px, 'left'); pill(ctx, o.b.label, W - m, ch - m - ph, px, 'right'); }
      }
      if (rows) {
        const pad = Math.round(W * 0.04), px = Math.round(rowH * 0.44), y0 = ch + Math.round(W * 0.025);
        const colA = W * 0.6, colB = W * 0.79, colC = W - pad;
        ctx.textBaseline = 'middle';
        const put = (t, x, y, font, color, align) => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(t, x, y); };
        put('Measure', pad, y0 + rowH / 2, '500 ' + Math.round(px * 0.9) + 'px ' + FONT, C.ink2, 'left');
        put((o.head && o.head[0]) || '', colA, y0 + rowH / 2, '500 ' + Math.round(px * 0.9) + 'px ' + FONT, C.ink2, 'right');
        put((o.head && o.head[1]) || '', colB, y0 + rowH / 2, '500 ' + Math.round(px * 0.9) + 'px ' + FONT, C.ink2, 'right');
        put('Change', colC, y0 + rowH / 2, '500 ' + Math.round(px * 0.9) + 'px ' + FONT, C.ink2, 'right');
        rows.forEach((r, i) => {
          const y = y0 + rowH * (i + 1);
          ctx.fillStyle = C.line; ctx.fillRect(pad, y, W - pad * 2, Math.max(1, Math.round(k)));
          put(r.name, pad, y + rowH / 2, '700 ' + px + 'px ' + FONT, C.ink, 'left');
          put(r.a, colA, y + rowH / 2, '500 ' + px + 'px ' + FONT, C.ink2, 'right');
          put(r.b, colB, y + rowH / 2, '700 ' + px + 'px ' + FONT, C.ink, 'right');
          put(r.change, colC, y + rowH / 2, '700 ' + px + 'px ' + FONT, TONE[r.tone] || C.ink2, 'right');
        });
      }
      return await (o.format === 'png' ? toBlob(cv, 'image/png') : toBlob(cv, 'image/jpeg', 0.9));
    } finally { release(A); release(B); }
  }

  // ---------- time-lapse video ----------
  // Videos are always MP4 (H.264), which every phone, Photos, Instagram and laptop player accepts.
  // A browser that can only record WebM gets no video option and is pointed to the image export instead.
  function pickVideoMime() {
    if (!root.MediaRecorder || !root.HTMLCanvasElement || !HTMLCanvasElement.prototype.captureStream) return null;
    for (const m of ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* try the next one */ }
    }
    return null;
  }
  function geometry(shape, d) {
    if (shape === 'story') return { W: 1080, H: 1920, cell: { x: 0, y: 240, w: 1080, h: 1440 }, bars: true };
    if (shape === 'square') return { W: 1080, H: 1080, cell: { x: 135, y: 0, w: 810, h: 1080 }, bars: false };
    let hh = Math.round(1080 * d.h / d.w); hh = Math.max(720, Math.min(1920, hh)); hh -= hh % 2;
    return { W: 1080, H: hh, cell: { x: 0, y: 0, w: 1080, h: hh }, bars: false };
  }
  // One frame. st: { prev, next, t (0..1 fade to next), labels, numbers }; prev/next: { im, title, numbers, align }
  function drawFrame(ctx, g, st) {
    ctx.fillStyle = C.chalk; ctx.fillRect(0, 0, g.W, g.H);
    const c = g.cell;
    cover(ctx, st.prev.im, c.x, c.y, c.w, c.h, null, st.prev.align);
    if (st.next && st.t > 0) cover(ctx, st.next.im, c.x, c.y, c.w, c.h, st.t, st.next.align);
    const cur = st.next && st.t >= 0.5 ? st.next : st.prev;
    ctx.textBaseline = 'middle';
    if (g.bars) {
      if (st.labels && cur.title) { ctx.font = '800 96px ' + DISPLAY; ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText(cur.title, g.W / 2, c.y / 2); }
      if (st.numbers && cur.numbers) { const by = c.y + c.h + (g.H - c.y - c.h) / 2; ctx.font = '500 50px ' + FONT; ctx.fillStyle = C.ink2; ctx.textAlign = 'center'; ctx.fillText(cur.numbers, g.W / 2, by); }
    } else {
      if (st.numbers && cur.numbers) {
        const gh = c.h * 0.2, grad = ctx.createLinearGradient(0, c.y + c.h - gh, 0, c.y + c.h);
        grad.addColorStop(0, 'rgba(9,13,11,0)'); grad.addColorStop(1, 'rgba(9,13,11,0.85)');
        ctx.fillStyle = grad; ctx.fillRect(c.x, c.y + c.h - gh, c.w, gh);
        ctx.font = '700 44px ' + FONT; ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.fillText(cur.numbers, c.x + 36, c.y + c.h - 52);
      }
      if (st.labels && cur.title) pill(ctx, cur.title, c.x + 32, c.y + 32, 40, 'left');
    }
  }
  // A still of one frame, drawn small, for the preview in the export sheet. Returns a canvas element.
  async function stillFrame(o, index, scale) {
    await fontsReady();
    const f = o.frames[index], im = await decode(f.blob);
    try {
      const g = geometry(o.shape, dims(im)), k = scale || 0.3, cv = canvasOf(g.W * k, g.H * k), ctx = cv.getContext('2d');
      ctx.setTransform(k, 0, 0, k, 0, 0);
      drawFrame(ctx, g, { prev: { im, title: f.title, numbers: f.numbers, align: f.align }, next: null, t: 0, labels: o.labels, numbers: o.numbers });
      return cv;
    } finally { release(im); }
  }
  function videoSeconds(n, secondsPer) { return n * secondsPer + 0.4; }
  function videoSizeMB(n, secondsPer) { return Math.max(1, Math.round(videoSeconds(n, secondsPer) * VIDEO_BPS / 8 / 1e6)); }

  // o: { frames: [{blob, title, numbers, align?: {dx,dy,scale}}], shape: 'story'|'square'|'original', secondsPer, labels, numbers, onProgress(0..1, text), signal }
  async function renderTimelapse(o) {
    const mime = pickVideoMime();
    if (!mime) throw new Error('This browser cannot save video as MP4. Open Regoal in Safari or Chrome, or save a comparison image instead.');
    if (!o.frames || o.frames.length < 2) throw new Error('A time-lapse needs photos from at least two check-ins.');
    await fontsReady();
    const say = (p, t) => { if (o.onProgress) o.onProgress(p, t); };
    const aborted = () => o.signal && o.signal.aborted;
    const cancel = () => new DOMException('Cancelled', 'AbortError');
    const ims = [];
    try {
      for (let i = 0; i < o.frames.length; i++) { say(0, 'Preparing photo ' + (i + 1) + ' of ' + o.frames.length); ims.push(await decode(o.frames[i].blob)); if (aborted()) throw cancel(); }
      const g = geometry(o.shape, dims(ims[0])), cv = canvasOf(g.W, g.H), ctx = cv.getContext('2d');
      const n = ims.length, D = o.secondsPer * 1000, F = Math.min(250, D * 0.3), total = videoSeconds(n, o.secondsPer) * 1000;
      const fr = ims.map((im, i) => ({ im, title: o.frames[i].title, numbers: o.frames[i].numbers, align: o.frames[i].align }));
      const draw = (t) => {
        const i = Math.min(n - 1, Math.floor(t / D)), local = t - i * D;
        const fade = i < n - 1 && local > D - F ? (local - (D - F)) / F : 0;
        drawFrame(ctx, g, { prev: fr[i], next: fade > 0 ? fr[i + 1] : null, t: fade, labels: o.labels, numbers: o.numbers });
      };
      draw(0);
      const stream = cv.captureStream(30), track = stream.getVideoTracks()[0];
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res, rej) => { rec.onstop = res; rec.onerror = (e) => rej((e && e.error) || new Error('Recording failed.')); });
      const stopTracks = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* already stopped */ } };
      rec.start(250);
      const t0 = performance.now();
      await new Promise((res) => {
        const tick = () => {
          if (aborted()) return res();
          const t = performance.now() - t0;
          draw(Math.min(t, total - 1));
          if (track && track.requestFrame) track.requestFrame();
          say(Math.min(1, t / total), 'Recording ' + (Math.min(n, Math.floor(t / D) + 1)) + ' of ' + n);
          if (t >= total) return res();
          setTimeout(tick, 33);
        };
        tick();
      });
      if (aborted()) { try { rec.stop(); } catch (e) { /* not started */ } stopTracks(); throw cancel(); }
      rec.stop(); await stopped; stopTracks();
      const blob = new Blob(chunks, { type: 'video/mp4' });
      if (!blob.size) throw new Error('The browser produced an empty video. Try a different shape or speed.');
      return { blob, mime: 'video/mp4', ext: 'mp4' };
    } finally { ims.forEach(release); }
  }

  // ---------- handing a file to the person ----------
  const fileOf = (blob, name) => new File([blob], name, { type: blob.type });
  function canShare(blob, name) { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [fileOf(blob, name)] })); } catch (e) { return false; } }
  function share(blob, name) { return navigator.share({ files: [fileOf(blob, name)] }); }
  function saveAs(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, class: 'hidden' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  root.MediaOut = { composeComparison, renderTimelapse, stillFrame, pickVideoMime, videoSizeMB, videoSeconds, canShare, share, saveAs, _: { C, FONT, DISPLAY, VIDEO_BPS, fontsReady, decode, dims, release, canvasOf, cover, pill, rr } };
})(self);

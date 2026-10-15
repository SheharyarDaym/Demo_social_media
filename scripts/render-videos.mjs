#!/usr/bin/env node
// Renders the bundled sample videos + posters for the Lifeguard-Pro.org Social Media Studio prototype.
//
//   node scripts/render-videos.mjs            # render + verify
//   node scripts/render-videos.mjs --verify   # only verify existing files
//
// How it works (no ffmpeg needed): headless Chromium (via Playwright) draws a deterministic motion graphic
// onto a <canvas>, records it in real time with canvas.captureStream(30) + MediaRecorder (WebM VP9/VP8),
// and hands the bytes back to Node. MediaRecorder WebM files carry no Duration, so browsers report
// duration = Infinity; we patch the EBML Segment/Info element with a Duration computed from the last frame
// timestamp in the clusters. Posters are PNG screenshots of the canvas at a fully composed frame.

import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'assets', 'video');
const DURATION_S = 8;
const POSTER_T = 6.0;

const VIDEOS = [
  { key: 'portrait', file: 'portrait-sample.webm', poster: 'portrait-poster.png', w: 540, h: 960, scale: 0.5, bps: 1_400_000, headline: 'Plan your next training step' },
  { key: 'landscape', file: 'landscape-sample.webm', poster: 'landscape-poster.png', w: 1280, h: 720, scale: 1, bps: 1_600_000, headline: 'A new learning goal with Lifeguard-Pro.org' },
];

// ---------------------------------------------------------------------------------------------------------
// In-page animation (runs in Chromium). Design units: portrait 1080x1920 (scaled 0.5), landscape 1280x720.
// ---------------------------------------------------------------------------------------------------------
const PAGE_SCRIPT = String.raw`
const C = { navy:'#062D5D', navy2:'#0A477F', red:'#E50914', sky:'#73C7F5', ws:'#EDF3FA', t1:'#0E7FA6', t2:'#1BA5C9', t3:'#43C6DB', t4:'#8FE3EE' };
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const clamp = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = (x) => 1 - Math.pow(1 - x, 3);
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Precomputed caustic cells
function makeCells(W, H, cell, seed) {
  const r = rng(seed), cells = [];
  for (let x = -cell; x < W + cell * 2; x += cell)
    for (let y = -cell; y < H + cell * 2; y += cell) {
      const k = 5 + Math.floor(r() * 2), v = [];
      for (let q = 0; q < k; q++) v.push({ a: (q / k) * Math.PI * 2 + (r() - 0.5) * 0.7, r: 0.8 + r() * 0.3, ph: r() * 6.28 });
      cells.push({ x: x + (r() - 0.5) * cell * 0.3, y: y + (r() - 0.5) * cell * 0.3, v, ph: r() * 6.28 });
    }
  return cells;
}
function caustics(ctx, cells, cell, t, alpha, lw, drift) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
  ctx.lineWidth = lw; ctx.lineJoin = 'round';
  ctx.beginPath();
  const dx = (t * drift) % cell, dy = (t * drift * 0.6) % cell;
  for (const c of cells) {
    const cx = c.x + dx + Math.sin(t * 0.9 + c.ph) * cell * 0.06, cy = c.y + dy + Math.cos(t * 0.8 + c.ph) * cell * 0.06;
    const pts = c.v.map((v) => { const rr = cell * 0.5 * v.r * (1 + 0.1 * Math.sin(t * 1.7 + v.ph)); return [cx + Math.cos(v.a) * rr, cy + Math.sin(v.a) * rr]; });
    const k = pts.length;
    for (let q = 0; q < k; q++) {
      const p = pts[q], pr = pts[(q + k - 1) % k], nx = pts[(q + 1) % k];
      const a0 = [p[0] + (pr[0] - p[0]) * 0.3, p[1] + (pr[1] - p[1]) * 0.3], a1 = [p[0] + (nx[0] - p[0]) * 0.3, p[1] + (nx[1] - p[1]) * 0.3];
      if (q === 0) ctx.moveTo(a0[0], a0[1]); else ctx.lineTo(a0[0], a0[1]);
      ctx.quadraticCurveTo(p[0], p[1], a1[0], a1[1]);
    }
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function water(ctx, x, y, w, h, t, o) {
  ctx.save();
  rrect(ctx, x, y, w, h, o.rx || 0); ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w * 0.5, y + h);
  g.addColorStop(0, C.t4); g.addColorStop(0.45, C.t3); g.addColorStop(1, C.t2);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  // lane stripes on the pool floor
  ctx.fillStyle = 'rgba(10,71,127,0.24)';
  const n = o.lanes, horiz = o.horizontal;
  for (let i = 0; i < n; i++) {
    if (!horiz) { const lw = w / n, cx = x + lw * (i + 0.5), sw = lw * 0.085; ctx.fillRect(cx - sw / 2, y + 60, sw, h - 120); ctx.fillRect(cx - lw * 0.17, y + 60, lw * 0.34, sw); ctx.fillRect(cx - lw * 0.17, y + h - 60 - sw, lw * 0.34, sw); }
    else { const lh = h / n, cy = y + lh * (i + 0.5), sw = lh * 0.085; ctx.fillRect(x + 50, cy - sw / 2, w - 100, sw); ctx.fillRect(x + 50, cy - lh * 0.17, sw, lh * 0.34); ctx.fillRect(x + w - 50 - sw, cy - lh * 0.17, sw, lh * 0.34); }
  }
  caustics(ctx, o.cellsA, o.cell, t, 0.3, o.cell * 0.06, 14);
  caustics(ctx, o.cellsB, o.cell * 1.7, t * 0.7, 0.14, o.cell * 0.07, -10);
  const v = ctx.createLinearGradient(x, y, x, y + h);
  v.addColorStop(0, 'rgba(255,255,255,0.18)'); v.addColorStop(0.4, 'rgba(255,255,255,0)'); v.addColorStop(1, 'rgba(6,45,93,0.14)');
  ctx.fillStyle = v; ctx.fillRect(x, y, w, h);
  ctx.restore();
}
function rope(ctx, x1, y1, x2, y2, w, prog) {
  const L = Math.hypot(x2 - x1, y2 - y1); if (prog <= 0) return;
  const ex = x1 + (x2 - x1) * prog, ey = y1 + (y2 - y1) * prog;
  ctx.save(); ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(6,45,93,0.16)'; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1 + 3, y1 + 7); ctx.lineTo(ex + 3, ey + 7); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = C.red; ctx.setLineDash([w * 1.25, w * 1.25]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.restore();
}
function ring(ctx, cx, cy, R, rot, alpha) {
  const r = R * 0.56, m = (R + r) / 2, t = R - r;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy);
  ctx.shadowColor = 'rgba(6,45,93,0.35)'; ctx.shadowBlur = R * 0.18; ctx.shadowOffsetY = R * 0.12;
  ctx.lineWidth = t; ctx.strokeStyle = C.red; ctx.beginPath(); ctx.arc(0, 0, m, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.rotate(rot);
  ctx.strokeStyle = '#fff';
  for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; ctx.beginPath(); ctx.arc(0, 0, m, a - 0.235, a + 0.235); ctx.stroke(); }
  ctx.lineWidth = t * 0.14; ctx.strokeStyle = 'rgba(6,45,93,0.16)'; ctx.beginPath(); ctx.arc(0, 0, r + t * 0.07, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = t * 0.13; ctx.beginPath(); ctx.arc(0, 0, m + t * 0.12, 3.4, 4.4); ctx.stroke();
  // grab line
  ctx.lineWidth = R * 0.05; ctx.strokeStyle = 'rgba(6,45,93,0.3)';
  const loop = () => { ctx.beginPath(); for (let k = 0; k < 4; k++) { const a1 = (k * Math.PI) / 2, a2 = a1 + Math.PI / 2, am = a1 + Math.PI / 4; ctx.moveTo(Math.cos(a1) * R * 0.97, Math.sin(a1) * R * 0.97); ctx.quadraticCurveTo(Math.cos(am) * R * 1.2, Math.sin(am) * R * 1.2, Math.cos(a2) * R * 0.97, Math.sin(a2) * R * 0.97); } ctx.stroke(); };
  loop(); ctx.lineWidth = R * 0.03; ctx.strokeStyle = '#fff'; loop();
  ctx.restore();
}
function ripples(ctx, cx, cy, t, t0, maxR, sy) {
  if (t < t0) return;
  ctx.save(); ctx.lineWidth = 4;
  for (let k = 0; k < 4; k++) {
    const ph = (((t - t0) / 3.2) + k / 4) % 1;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.6 * (1 - ph) * seg(t, t0, t0 + 0.8)).toFixed(3) + ')';
    ctx.beginPath(); ctx.ellipse(cx, cy, maxR * (0.35 + ph * 0.65), maxR * (0.35 + ph * 0.65) * sy, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}
function wordmark(ctx, x, y, size, color, alpha) {
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = C.red; rrect(ctx, x, y, size * 0.2, size * 1.05, size * 0.1); ctx.fill();
  ctx.fillStyle = color; ctx.font = '700 ' + size + 'px ' + FONT; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Lifeguard-Pro.org', x + size * 0.62, y + size * 0.86);
  ctx.restore();
}
function wrapWords(ctx, text, size, maxW) {
  ctx.font = '800 ' + size + 'px ' + FONT;
  const words = text.split(' '), lines = [[]];
  for (const w of words) { const cur = lines[lines.length - 1]; const test = [...cur, w].join(' '); if (cur.length && ctx.measureText(test).width > maxW) lines.push([w]); else cur.push(w); }
  return lines;
}
// Words rise + fade in, staggered.
function headline(ctx, lines, x, y, size, lh, t, start, color, accentLine) {
  ctx.save(); ctx.font = '800 ' + size + 'px ' + FONT; ctx.textBaseline = 'alphabetic';
  let i = 0;
  lines.forEach((ws, li) => {
    let cx = x;
    const by = y + size * 0.8 + li * size * lh;
    ws.forEach((w) => {
      const p = ease(seg(t, start + i * 0.11, start + i * 0.11 + 0.55));
      ctx.save();
      ctx.beginPath(); ctx.rect(cx - 10, by - size * 1.05, ctx.measureText(w).width + 30, size * 1.35); ctx.clip();
      ctx.globalAlpha = p; ctx.fillStyle = li === accentLine ? C.sky : color;
      ctx.fillText(w, cx, by + (1 - p) * size * 0.9);
      ctx.restore();
      cx += ctx.measureText(w + ' ').width; i++;
    });
  });
  ctx.restore();
}
function chip(ctx, x, y, text, size, t, t0) {
  const p = ease(seg(t, t0, t0 + 0.6)); if (p <= 0) return;
  ctx.save(); ctx.globalAlpha = p; ctx.font = '700 ' + size + 'px ' + FONT;
  const w = ctx.measureText(text).width + size * 3.8, h = size * 2.3, yy = y + (1 - p) * 40;
  ctx.shadowColor = 'rgba(6,45,93,0.3)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
  ctx.fillStyle = C.red; rrect(ctx, x, yy, w, h, h / 2); ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + size * 1.1, yy + h / 2 + 1);
  // arrow
  const ax = x + w - size * 1.3, ay = yy + h / 2; ctx.strokeStyle = '#fff'; ctx.lineWidth = size * 0.14; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(ax - size * 0.45, ay); ctx.lineTo(ax + size * 0.35, ay); ctx.moveTo(ax, ay - size * 0.35); ctx.lineTo(ax + size * 0.35, ay); ctx.lineTo(ax, ay + size * 0.35); ctx.stroke();
  ctx.restore();
}
function kickerTxt(ctx, x, y, text, size, color, alpha) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = C.red; ctx.fillRect(x, y + size * 0.36, size * 1.6, size * 0.24);
  ctx.font = '700 ' + size + 'px ' + FONT; ctx.fillStyle = color; ctx.letterSpacing = (size * 0.16) + 'px';
  ctx.fillText(text.toUpperCase(), x + size * 2.2, y + size * 0.86); ctx.restore();
}

// ----- compositions -----
function setupPortrait(headlineText) {
  const W = 1080, H = 1920, cell = 96;
  const cellsA = makeCells(W, H, cell, 7), cellsB = makeCells(W, H, cell * 1.7, 11);
  return (ctx, t) => {
    ctx.fillStyle = C.ws; ctx.fillRect(0, 0, W, H);
    water(ctx, 0, 0, W, H, t, { lanes: 5, cell, cellsA, cellsB });
    const lw = W / 5;
    for (let i = 1; i < 5; i++) rope(ctx, lw * i, 640, lw * i, H, 16, easeIO(seg(t, 0.15 + i * 0.08, 1.4 + i * 0.08)));
    // ring + ripples
    const rp = ease(seg(t, 0.9, 1.7));
    const ry = 1240 + Math.sin(t * 1.9) * 12 - (1 - rp) * 90;
    ripples(ctx, 540, 1250 + 30, t, 1.2, 420, 0.42);
    ring(ctx, 540, ry, 200 * (0.7 + 0.3 * rp), t * 0.22, rp);
    // navy band slides down
    const bp = ease(seg(t, 0, 0.7));
    ctx.save(); ctx.translate(0, -(1 - bp) * 760);
    ctx.fillStyle = C.navy; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, 700); ctx.lineTo(0, 780); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.red; ctx.beginPath(); ctx.moveTo(0, 770); ctx.lineTo(W, 690); ctx.lineTo(W, 700); ctx.lineTo(0, 780); ctx.closePath(); ctx.fill();
    ctx.restore();
    wordmark(ctx, 86, 262, 36, '#fff', seg(t, 0.35, 0.9));
    kickerTxt(ctx, 86, 360, 'Training goals', 28, C.sky, seg(t, 0.5, 1.0));
    const lines = wrapWords(ctx, headlineText, 118, 900);
    headline(ctx, lines, 86, 420, 118, 1.04, t, 0.7, '#fff', lines.length - 1);
    // underline grows under the last line
    const up = easeIO(seg(t, 2.4, 3.2));
    if (up > 0) { ctx.fillStyle = C.red; ctx.fillRect(86, 420 + 118 * 1.04 * (lines.length - 1) + 118 * 1.0, 260 * up, 10); }
    chip(ctx, 86, 1480, 'Explore training options', 40, t, 3.6);
    // gentle fade-out/in loop edge
    const fo = seg(t, 7.6, 8.0); if (fo > 0) { ctx.fillStyle = 'rgba(6,45,93,' + (fo * 0.35) + ')'; ctx.fillRect(0, 0, W, H); }
  };
}
function setupLandscape(headlineText) {
  const W = 1280, H = 720, cell = 76;
  const cellsA = makeCells(W, H, cell, 3), cellsB = makeCells(W, H, cell * 1.7, 5);
  return (ctx, t) => {
    ctx.fillStyle = C.ws; ctx.fillRect(0, 0, W, H);
    water(ctx, 0, 0, W, H, t, { lanes: 4, horizontal: true, cell, cellsA, cellsB });
    const lh = H / 4;
    for (let i = 1; i < 4; i++) rope(ctx, W, lh * i, 480, lh * i, 13, easeIO(seg(t, 0.2 + i * 0.1, 1.5 + i * 0.1)));
    const rp = ease(seg(t, 1.0, 1.8));
    const cx = 930 + Math.sin(t * 0.7) * 14, cy = 360 + Math.sin(t * 1.9) * 9 - (1 - rp) * 60;
    ripples(ctx, 930, 382, t, 1.3, 300, 0.42);
    ring(ctx, cx, cy, 128 * (0.7 + 0.3 * rp), t * 0.25, rp);
    // navy panel slides in from the left
    const bp = ease(seg(t, 0, 0.7));
    ctx.save(); ctx.translate(-(1 - bp) * 700, 0);
    ctx.fillStyle = C.navy; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(660, 0); ctx.lineTo(580, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.red; ctx.beginPath(); ctx.moveTo(660, 0); ctx.lineTo(670, 0); ctx.lineTo(590, H); ctx.lineTo(580, H); ctx.closePath(); ctx.fill();
    ctx.restore();
    wordmark(ctx, 72, 66, 26, '#fff', seg(t, 0.35, 0.9));
    kickerTxt(ctx, 72, 170, 'Training goals', 20, C.sky, seg(t, 0.5, 1.0));
    const lines = wrapWords(ctx, headlineText, 62, 470);
    headline(ctx, lines, 72, 214, 62, 1.08, t, 0.7, '#fff', lines.length - 1);
    const up = easeIO(seg(t, 2.6, 3.4));
    const ly = 214 + 62 * 1.08 * (lines.length - 1) + 62 * 1.02;
    if (up > 0) { ctx.fillStyle = C.red; ctx.fillRect(72, ly, 200 * up, 7); }
    chip(ctx, 72, 556, 'Explore training options', 24, t, 3.6);
    const fo = seg(t, 7.6, 8.0); if (fo > 0) { ctx.fillStyle = 'rgba(6,45,93,' + (fo * 0.35) + ')'; ctx.fillRect(0, 0, W, H); }
  };
}

window.__setup = (key, headlineText, scale) => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const draw = key === 'portrait' ? setupPortrait(headlineText) : setupLandscape(headlineText);
  window.__draw = (t) => { ctx.setTransform(scale, 0, 0, scale, 0, 0); draw(ctx, t); };
};

window.__record = async (dur, bps) => {
  const canvas = document.getElementById('c');
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  window.__draw(0);
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(250);
  const t0 = performance.now();
  let frames = 0;
  await new Promise((res) => {
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      window.__draw(Math.min(t, dur)); frames++;
      if (t < dur) requestAnimationFrame(loop); else res();
    };
    requestAnimationFrame(loop);
  });
  const ms = performance.now() - t0;
  rec.stop(); await stopped;
  const blob = new Blob(chunks, { type: mime });
  const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
  return { b64, mime, ms, frames };
};
`;

// ---------------------------------------------------------------------------------------------------------
// WebM (EBML) duration patch
// ---------------------------------------------------------------------------------------------------------
const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, SeekHead: 0x114d9b74, Cues: 0x1c53bb6b, Tracks: 0x1654ae6b };
const TOP_LEVEL = new Set([ID.Cluster, ID.Cues, ID.Tracks, ID.Info, ID.SeekHead, 0x1254c367 /* Tags */, 0x1941a469 /* Attachments */, 0x1043a770 /* Chapters */]);

function readId(b, p) {
  const f = b[p];
  let len = 1;
  for (let m = 0x80; len <= 4 && !(f & m); m >>= 1) len++;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
  return { id, len };
}
function readSize(b, p) {
  const f = b[p];
  let len = 1, m = 0x80;
  while (len <= 8 && !(f & m)) { len++; m >>= 1; }
  let v = f & (m - 1);
  for (let i = 1; i < len; i++) v = v * 256 + b[p + i];
  return { len, value: v, unknown: v === 2 ** (7 * len) - 1 };
}
function readEl(b, p) {
  const { id, len: il } = readId(b, p);
  const s = readSize(b, p + il);
  const start = p + il + s.len;
  return { id, start, size: s.unknown ? null : s.value, headerLen: il + s.len, pos: p, sizeLen: s.len };
}
const readUint = (b, p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; };

// Walk clusters to find the last frame timestamp (handles unknown-size "live" clusters).
function lastTimestamp(b, segStart, segEnd) {
  let p = segStart, maxTs = 0, clusterTc = 0, frames = 0;
  const visitBlock = (q) => {
    const tn = readSize(b, q);
    const rel = (b[q + tn.len] << 8) | b[q + tn.len + 1];
    const signed = rel & 0x8000 ? rel - 0x10000 : rel;
    maxTs = Math.max(maxTs, clusterTc + signed);
    frames++;
  };
  while (p < segEnd) {
    const e = readEl(b, p);
    if (e.id === ID.Cluster) {
      let q = e.start;
      const end = e.size == null ? segEnd : e.start + e.size;
      while (q < end) {
        const c = readEl(b, q);
        if (e.size == null && TOP_LEVEL.has(c.id)) break;
        if (c.id === ID.Timecode) clusterTc = readUint(b, c.start, c.size);
        else if (c.id === ID.SimpleBlock) visitBlock(c.start);
        else if (c.id === ID.BlockGroup) {
          let r = c.start;
          while (r < c.start + c.size) { const bb = readEl(b, r); if (bb.id === ID.Block) visitBlock(bb.start); r = bb.start + bb.size; }
        }
        if (c.size == null) break;
        q = c.start + c.size;
      }
      p = q;
    } else {
      if (e.size == null) break;
      p = e.start + e.size;
    }
  }
  return { maxTs, frames };
}

function patchDuration(buf, fallbackMs) {
  const b = Buffer.from(buf);
  const ebml = readEl(b, 0);
  if (ebml.id !== ID.EBML) throw new Error('Not an EBML file');
  const seg = readEl(b, ebml.start + ebml.size);
  if (seg.id !== ID.Segment) throw new Error('Segment not found');
  const segEnd = seg.size == null ? b.length : seg.start + seg.size;
  let p = seg.start, info = null;
  while (p < segEnd) {
    const e = readEl(b, p);
    if (e.id === ID.SeekHead) console.warn('  note: SeekHead present; offsets after Info will shift');
    if (e.id === ID.Info) { info = e; break; }
    if (e.size == null) break;
    p = e.start + e.size;
  }
  if (!info) throw new Error('Info element not found');
  // collect Info children, drop any existing Duration
  let q = info.start, scale = 1_000_000;
  const kids = [];
  while (q < info.start + info.size) {
    const c = readEl(b, q);
    if (c.id === ID.TimecodeScale) scale = readUint(b, c.start, c.size);
    if (c.id !== ID.Duration) kids.push(b.subarray(c.pos, c.start + c.size));
    q = c.start + c.size;
  }
  const { maxTs, frames } = lastTimestamp(b, info.start + info.size, segEnd);
  const frameMs = 1000 / 30;
  const durMs = maxTs > 0 ? maxTs * (scale / 1e6) + frameMs : fallbackMs;
  const durEl = Buffer.alloc(11);
  durEl[0] = 0x44; durEl[1] = 0x89; durEl[2] = 0x88; // id + size(8)
  durEl.writeDoubleBE((durMs * 1e6) / scale, 3);
  const body = Buffer.concat([...kids, durEl]);
  const head = Buffer.alloc(4 + 8);
  head.writeUInt32BE(ID.Info, 0);
  head[4] = 0x01; // 8-byte size vint
  head.writeUIntBE(body.length, 6, 6);
  head[5] = 0;
  const newInfo = Buffer.concat([head, body]);
  const delta = newInfo.length - (info.start + info.size - info.pos);
  const out = Buffer.concat([b.subarray(0, info.pos), newInfo, b.subarray(info.start + info.size)]);
  if (seg.size != null) {
    // re-encode known segment size in place (same width)
    const v = seg.size + delta, n = seg.sizeLen, sp = seg.pos + readId(b, seg.pos).len;
    let x = v;
    for (let i = n - 1; i >= 1; i--) { out[sp + i] = x & 0xff; x = Math.floor(x / 256); }
    out[sp] = (0x80 >> (n - 1)) | x;
  }
  return { out, durMs, frames };
}

// ---------------------------------------------------------------------------------------------------------
// Render + verify
// ---------------------------------------------------------------------------------------------------------
async function render(browser) {
  mkdirSync(OUT, { recursive: true });
  for (const v of VIDEOS) {
    const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#000"><canvas id="c" width="${v.w}" height="${v.h}" style="display:block"></canvas><script>${PAGE_SCRIPT}</script></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(([k, h, s]) => window.__setup(k, h, s), [v.key, v.headline, v.scale]);
    console.log(`Recording ${v.file} (${v.w}x${v.h}, ${DURATION_S}s real time)...`);
    const res = await page.evaluate(([d, bps]) => window.__record(d, bps), [DURATION_S, v.bps]);
    const raw = Buffer.from(res.b64, 'base64');
    const { out, durMs, frames } = patchDuration(raw, res.ms);
    writeFileSync(join(OUT, v.file), out);
    console.log(`  ${res.mime}, drew ${res.frames} canvas frames, ${frames} encoded frames, duration ${(durMs / 1000).toFixed(2)}s, ${(out.length / 1024).toFixed(0)} KB`);
    // poster: fully composed frame
    await page.evaluate((t) => window.__draw(t), POSTER_T);
    await page.locator('#c').screenshot({ path: join(OUT, v.poster) });
    console.log(`  poster ${v.poster}`);
    await page.close();
  }
}

async function verify(browser) {
  let ok = true;
  for (const v of VIDEOS) {
    const file = join(OUT, v.file);
    const size = statSync(file).size;
    const page = await browser.newPage();
    await page.goto(pathToFileURL(OUT + '/').href); // a file:// origin so the local video can load
    const r = await page.evaluate(async (src) => {
      const vid = document.createElement('video');
      vid.muted = true; vid.playsInline = true; vid.preload = 'auto'; vid.src = src;
      document.body.appendChild(vid);
      await new Promise((res, rej) => { vid.onloadedmetadata = res; vid.onerror = () => rej(new Error('video error ' + (vid.error && vid.error.message))); });
      const meta = { duration: vid.duration, w: vid.videoWidth, h: vid.videoHeight };
      await vid.play();
      const t1 = vid.currentTime;
      await new Promise((r) => setTimeout(r, 1200));
      const t2 = vid.currentTime;
      vid.pause();
      vid.currentTime = 6.5;
      await new Promise((r) => (vid.onseeked = r));
      return { ...meta, advanced: t2 - t1, seekedTo: vid.currentTime };
    }, pathToFileURL(file).href);
    const pass = Number.isFinite(r.duration) && r.duration > 5 && r.w === v.w && r.h === v.h && r.advanced > 0.5 && size < 2.2 * 1024 * 1024;
    ok = ok && pass;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${v.file}: ${r.w}x${r.h}, duration ${r.duration.toFixed(3)}s, played +${r.advanced.toFixed(2)}s in 1.2s, seek->${r.seekedTo.toFixed(2)}s, ${(size / 1024).toFixed(0)} KB`);
    const png = readFileSync(join(OUT, v.poster));
    const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20);
    console.log(`     ${v.poster}: ${pw}x${ph}, ${(png.length / 1024).toFixed(0)} KB`);
    await page.close();
  }
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  if (!process.argv.includes('--verify')) await render(browser);
  await verify(browser);
} finally {
  await browser.close();
}

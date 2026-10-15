#!/usr/bin/env node
// Generates the bundled social graphics for the Lifeguard-Pro.org Social Media Studio prototype.
//
//   node scripts/generate-assets.mjs
//
// Writes 12 original compositions x 3 formats to public/assets/posts/{id}-{portrait|square|story}.svg.
// Everything is drawn from geometric primitives: no external references, fonts, images or dependencies.
// Each format is re-laid-out from shared layer functions (not stretched), and every essential text block
// is checked against the format's safe area at generation time.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'assets', 'posts');

// ---------------------------------------------------------------------------------------------------------
// Palette, type, formats
// ---------------------------------------------------------------------------------------------------------
const C = {
  navy: '#062D5D', navy2: '#0A477F', navy3: '#0E5E96', red: '#E50914', redDark: '#B0060E',
  sky: '#73C7F5', ws: '#EDF3FA', white: '#FFFFFF', border: '#CCDBED', text: '#17324F', muted: '#60758E',
  t1: '#0E7FA6', t2: '#1BA5C9', t3: '#43C6DB', t4: '#8FE3EE', t5: '#C9F3F7', deck: '#F3F7FB', grout: '#D5E2EF',
};
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SKIN = ['#E7B48E', '#C58A60', '#8C5A3C', '#F0CBA8', '#A8714B'];

const FORMATS = {
  portrait: { name: 'portrait', W: 1080, H: 1350, safe: { l: 86, r: 994, t: 108, b: 1242 } },
  square: { name: 'square', W: 1080, H: 1080, safe: { l: 86, r: 994, t: 86, b: 994 } },
  story: { name: 'story', W: 1080, H: 1920, safe: { l: 86, r: 994, t: 250, b: 1580 } },
};

// ---------------------------------------------------------------------------------------------------------
// Tiny SVG toolkit
// ---------------------------------------------------------------------------------------------------------
const f = (n) => +(+n).toFixed(1);
const KEEP_CAMEL = new Set(['gradientUnits', 'gradientTransform', 'patternUnits', 'patternTransform', 'stdDeviation', 'viewBox']);
const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${KEEP_CAMEL.has(k) ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${typeof v === 'number' ? f(v) : v}"`)
    .join(' ');
const el = (tag, o = {}, inner) => (inner == null ? `<${tag} ${attrs(o)}/>` : `<${tag} ${attrs(o)}>${inner}</${tag}>`);
const rect = (x, y, width, height, o = {}) => el('rect', { x, y, width, height, ...o });
const circle = (cx, cy, r, o = {}) => el('circle', { cx, cy, r, ...o });
const ellipse = (cx, cy, rx, ry, o = {}) => el('ellipse', { cx, cy, rx, ry, ...o });
const path = (d, o = {}) => el('path', { d, ...o });
const g = (o, inner) => el('g', o, inner);
const P = (s, ...v) => s.reduce((a, str, i) => a + str + (i < v.length ? (typeof v[i] === 'number' ? f(v[i]) : v[i]) : ''), '');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tr = (x, y, rot = 0, s = 1) => `translate(${f(x)} ${f(y)})${rot ? ` rotate(${f(rot)})` : ''}${s !== 1 ? ` scale(${f(s)})` : ''}`;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;

// ---------------------------------------------------------------------------------------------------------
// Text measurement / fitting (conservative estimate of a bold system sans-serif)
// ---------------------------------------------------------------------------------------------------------
function charW(ch) {
  if (ch === ' ') return 0.27;
  if ("ijl|!.,:;'".includes(ch)) return 0.29;
  if ('ftrI-'.includes(ch)) return 0.41;
  if ('mwMW'.includes(ch)) return 0.93;
  if (ch === '?') return 0.57;
  if (ch >= 'A' && ch <= 'Z') return 0.72;
  if (ch >= '0' && ch <= '9') return 0.63;
  return 0.61;
}
const measure = (s, size, ls = 0) => [...s].reduce((a, ch) => a + charW(ch), 0) * size + ls * s.length;

// Split words into the fewest lines that fit, choosing the most balanced break points.
function balanced(words, size, maxW) {
  const n = words.length;
  const wOf = (a, b) => measure(words.slice(a, b).join(' '), size);
  for (let k = 1; k <= n; k++) {
    let best = null;
    const rec = (start, left, acc) => {
      if (left === 1) {
        if (wOf(start, n) > maxW) return;
        const lines = [...acc, [start, n]];
        const ws = lines.map(([a, b]) => wOf(a, b));
        // minimise the longest line; mild penalty for a very short last line
        const score = Math.max(...ws) + (ws.length > 1 && ws[ws.length - 1] < 0.45 * Math.max(...ws) ? maxW * 0.3 : 0);
        if (!best || score < best.score) best = { score, lines };
        return;
      }
      for (let e = start + 1; e <= n - left + 1; e++) {
        if (wOf(start, e) > maxW) break;
        rec(e, left - 1, [...acc, [start, e]]);
      }
    };
    rec(0, k, []);
    if (best) return best.lines.map(([a, b]) => words.slice(a, b).join(' '));
  }
  return null;
}

function fitHL(text, w, { max = 100, min = 40, maxLines = 4, lh = 1.04, maxH = Infinity } = {}) {
  const segs = text.split('\n');
  for (let s = max; s >= min; s -= 2) {
    const lines = [];
    let ok = true;
    segs.forEach((seg, si) => {
      const ls = balanced(seg.split(' '), s, w);
      if (!ls) ok = false;
      else ls.forEach((t) => lines.push({ t, seg: si }));
    });
    if (!ok || lines.length > maxLines) continue;
    const h = 0.76 * s + (lines.length - 1) * s * lh + 0.22 * s;
    if (h > maxH) continue;
    return { size: s, lines, lh, h, w: Math.max(...lines.map((l) => measure(l.t, s))) };
  }
  throw new Error(`Headline does not fit: "${text}" in ${w}px`);
}

// ---------------------------------------------------------------------------------------------------------
// Render context (defs, ids, safe-area registry)
// ---------------------------------------------------------------------------------------------------------
function makeCtx(id, fmt) {
  const pre = id.split('-')[0][0] + id.split('-')[1] + fmt.name[0];
  const defs = new Map();
  const c = {
    id, fmt, name: fmt.name, W: fmt.W, H: fmt.H, S: fmt.safe, texts: [], n: 0,
    rand: rng(hash(id + fmt.name)),
    uid: (k) => `${pre}${k}`,
    def(key, build) {
      const did = c.uid(key);
      if (!defs.has(did)) defs.set(did, build(did));
      return `url(#${did})`;
    },
    defsMarkup: () => [...defs.values()].join(''),
    reg(x, y, w, h, what) { c.texts.push({ x, y, w, h, what }); },
    pick: (o) => o[fmt.name],
  };
  return c;
}

// ---------------------------------------------------------------------------------------------------------
// Shared definitions
// ---------------------------------------------------------------------------------------------------------
const linGrad = (c, key, stops, [x1, y1, x2, y2] = [0, 0, 0, 1]) =>
  c.def(key, (id) =>
    el('linearGradient', { id, x1, y1, x2, y2 }, stops.map(([o, col, op]) => el('stop', { offset: o, stopColor: col, stopOpacity: op })).join('')),
  );
const radGrad = (c, key, stops, cx = 0.5, cy = 0.5, r = 0.5) =>
  c.def(key, (id) => el('radialGradient', { id, cx, cy, r }, stops.map(([o, col, op]) => el('stop', { offset: o, stopColor: col, stopOpacity: op })).join('')));

const waterGrad = (c) => linGrad(c, 'wg', [[0, C.t4], [0.45, C.t3], [1, C.t2]], [0, 0, 0.6, 1]);
const deepWater = (c) => linGrad(c, 'dw', [[0, C.t3], [0.5, C.t2], [1, C.t1]], [0, 0, 0.4, 1]);

const shadow = (c, key = 'sh', dy = 14, blur = 16, op = 0.22) =>
  c.def(key, (id) =>
    el('filter', { id, x: '-30%', y: '-30%', width: '160%', height: '170%' },
      el('feDropShadow', { dx: 0, dy, stdDeviation: blur, floodColor: C.navy, floodOpacity: op })),
  );

// Caustic light network as a seamless pattern tile (blobs stay inside their own cell).
function caustic(c, key, { cell = 84, n = 4, op = 0.3, sw, rot = 0, scale = 1, sx = 1 } = {}) {
  return c.def('ca' + key, (id) => {
    const r = rng(hash(id + key));
    const T = cell * n;
    let d = '';
    const R = Math.round;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const cx = (i + 0.5) * cell + (r() - 0.5) * cell * 0.3;
        const cy = (j + 0.5) * cell + (r() - 0.5) * cell * 0.3;
        const k = 5 + Math.floor(r() * 2);
        const pts = [];
        for (let q = 0; q < k; q++) {
          const a = (q / k) * Math.PI * 2 + (r() - 0.5) * 0.7;
          const rad = cell * 0.5 * (0.8 + r() * 0.3);
          pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
        }
        // rounded polygon: straight-ish edges, softened corners (reads as a caustic web, not bubbles)
        const lerpP = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        const shape = (ox, oy) => {
          let s0 = '';
          for (let q = 0; q < k; q++) {
            const prev = pts[(q + k - 1) % k], p = pts[q], next = pts[(q + 1) % k];
            const a0 = lerpP(p, prev, 0.3), a1 = lerpP(p, next, 0.3);
            s0 += `${q ? 'L' : 'M'}${R(a0[0] + ox)} ${R(a0[1] + oy)}Q${R(p[0] + ox)} ${R(p[1] + oy)} ${R(a1[0] + ox)} ${R(a1[1] + oy)}`;
          }
          return s0 + 'Z';
        };
        const ext = cell * 0.7;
        for (const dx of [-T, 0, T])
          for (const dy of [-T, 0, T]) {
            const x = cx + dx, y = cy + dy;
            if (x + ext < 0 || x - ext > T || y + ext < 0 || y - ext > T) continue;
            d += shape(x, y);
          }
      }
    return el('pattern', { id, width: T, height: T, patternUnits: 'userSpaceOnUse', patternTransform: `rotate(${rot}) scale(${scale} ${f(scale * sx)})` },
      path(d, { fill: 'none', stroke: '#fff', strokeOpacity: op, strokeWidth: sw || cell * 0.06, strokeLinejoin: 'round' }));
  });
}

const tiles = (c, { size = 72, fill = C.deck, line = C.grout, sw = 3, key = 'tl' } = {}) =>
  c.def(key, (id) =>
    el('pattern', { id, width: size, height: size, patternUnits: 'userSpaceOnUse' },
      rect(0, 0, size, size, { fill }) + path(`M0 0H${size}M0 0V${size}`, { stroke: line, strokeWidth: sw })),
  );

const dots = (c, { gap = 36, r = 2.4, col = C.sky, op = 0.25, key = 'dt' } = {}) =>
  c.def(key, (id) => el('pattern', { id, width: gap, height: gap, patternUnits: 'userSpaceOnUse' }, circle(gap / 2, gap / 2, r, { fill: col, fillOpacity: op })));

const gridPat = (c, { gap = 60, col = '#D3E2F0', sw = 2, key = 'gp' } = {}) =>
  c.def(key, (id) => el('pattern', { id, width: gap, height: gap, patternUnits: 'userSpaceOnUse' }, path(`M${gap} 0H0V${gap}`, { fill: 'none', stroke: col, strokeWidth: sw })));

function clip(c, shapeMarkup) {
  const k = 'cp' + c.n++;
  return c.def(k, (id) => el('clipPath', { id }, shapeMarkup));
}

// ---------------------------------------------------------------------------------------------------------
// Typography layers
// ---------------------------------------------------------------------------------------------------------
function drawHL(c, fit, x, y, { color = C.navy, colors, align = 'start', weight = 800 } = {}) {
  const { size, lines, lh } = fit;
  const tsp = lines
    .map((l, i) => `<tspan x="${f(x)}"${i ? ` dy="${f(size * lh)}"` : ''}${colors && colors[l.seg] ? ` fill="${colors[l.seg]}"` : ''}>${esc(l.t)}</tspan>`)
    .join('');
  const x0 = align === 'middle' ? x - fit.w / 2 : align === 'end' ? x - fit.w : x;
  c.reg(x0, y, fit.w, fit.h, 'headline');
  return `<text y="${f(y + size * 0.76)}" font-family="${FONT}" font-weight="${weight}" font-size="${size}" letter-spacing="${f(-size * 0.012)}" fill="${color}"${align !== 'start' ? ` text-anchor="${align}"` : ''}>${tsp}</text>`;
}

// Small uppercase label with a short red rule. Returns markup; occupies `size` px of height from y.
function kicker(c, x, y, text, { color = C.navy2, size = 24, bar = C.red, align = 'start' } = {}) {
  const ls = size * 0.16;
  const tw = measure(text.toUpperCase(), size, ls);
  const barW = size * 1.6, gap = size * 0.6;
  const total = barW + gap + tw;
  const x0 = align === 'middle' ? x - total / 2 : x;
  c.reg(x0, y, total, size, 'kicker');
  return rect(x0, y + size * 0.36, barW, size * 0.24, { fill: bar, rx: size * 0.12 }) +
    `<text x="${f(x0 + barW + gap)}" y="${f(y + size * 0.86)}" font-family="${FONT}" font-weight="700" font-size="${size}" letter-spacing="${f(ls)}" fill="${color}">${esc(text.toUpperCase())}</text>`;
}

// The consistent text wordmark: red bar + "Lifeguard-Pro.org". (Deliberately not a round emblem/seal.)
function wordmark(c, x, top, { size = 32, color = C.navy } = {}) {
  const tw = measure('Lifeguard-Pro.org', size) * 0.97;
  const bw = size * 0.2;
  c.reg(x, top, bw + size * 0.45 + tw, size * 1.05, 'wordmark');
  return g({ 'aria-label': 'Lifeguard-Pro.org' },
    rect(x, top, bw, size * 1.05, { fill: C.red, rx: bw / 2 }) +
    `<text x="${f(x + bw + size * 0.42)}" y="${f(top + size * 0.86)}" font-family="${FONT}" font-weight="700" font-size="${size}" letter-spacing="${f(-size * 0.01)}" fill="${color}">Lifeguard-Pro.org</text>`);
}
const wmTop = (c, color = C.navy) => wordmark(c, c.S.l, c.S.t, { size: c.name === 'square' ? 30 : 32, color });

// ---------------------------------------------------------------------------------------------------------
// Illustration layers
// ---------------------------------------------------------------------------------------------------------
function rope(x1, y1, x2, y2, { w = 14, color = C.red, alt = '#fff' } = {}) {
  const d = P`M${x1} ${y1}L${x2} ${y2}`;
  return path(d, { stroke: C.navy, strokeOpacity: 0.16, strokeWidth: w, transform: 'translate(3 7)' }) +
    path(d, { stroke: alt, strokeWidth: w }) +
    path(d, { stroke: color, strokeWidth: w, strokeDasharray: `${f(w * 1.25)} ${f(w * 1.25)}` });
}

// Overhead pool with lane stripes, caustics, lane ropes and coping. Lanes run vertically.
function poolTop(c, x, y, w, h, { lanes = 5, rx = 26, coping = 20, ropes = true, stripes = true, ropeW = 14, cell = 84, causticOp = 0.3 } = {}) {
  const lw = w / lanes;
  let inner = rect(x, y, w, h, { fill: waterGrad(c) });
  if (stripes)
    for (let i = 0; i < lanes; i++) {
      const cx = x + lw * (i + 0.5), sw = Math.max(8, lw * 0.085), m = Math.min(lw * 0.5, h * 0.12);
      const d = P`M${cx - sw / 2} ${y + m}h${sw}v${h - 2 * m}h${-sw}z` +
        P`M${cx - lw * 0.17} ${y + m}h${lw * 0.34}v${sw}h${-lw * 0.34}z` +
        P`M${cx - lw * 0.17} ${y + h - m - sw}h${lw * 0.34}v${sw}h${-lw * 0.34}z`;
      inner += path(d, { fill: C.navy2, fillOpacity: 0.26 });
    }
  inner += rect(x, y, w, h, { fill: caustic(c, 'a', { cell, op: causticOp }) });
  inner += rect(x, y, w, h, { fill: caustic(c, 'b', { cell: cell * 1.6, op: causticOp * 0.55, rot: 17 }) });
  inner += rect(x, y, w, h, { fill: linGrad(c, 'pv', [[0, '#fff', 0.22], [0.35, '#fff', 0], [1, C.navy, 0.12]]) });
  if (ropes) for (let i = 1; i < lanes; i++) inner += rope(x + lw * i, y - 4, x + lw * i, y + h + 4, { w: ropeW });
  const cp = clip(c, rect(x, y, w, h, { rx }));
  return rect(x - coping, y - coping, w + 2 * coping, h + 2 * coping, { rx: rx + coping, fill: '#F8FBFE', stroke: '#C5D8EA', strokeWidth: 3 }) +
    g({ clipPath: cp }, inner) +
    rect(x, y, w, h, { rx, fill: 'none', stroke: C.navy2, strokeOpacity: 0.22, strokeWidth: 6 });
}

function startBlock(cx, y, num) {
  return rect(cx - 46, y - 72, 92, 72, { rx: 10, fill: C.navy }) +
    rect(cx - 38, y - 64, 76, 34, { rx: 6, fill: C.navy2 }) +
    `<text x="${f(cx)}" y="${f(y - 10)}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="22" fill="#fff">${num}</text>`;
}

function ringBuoy(cx, cy, R, { rot = 0, sy = 1, ropeCol = '#fff', filter } = {}) {
  const r = R * 0.56, m = (R + r) / 2, t = R - r, L = 2 * Math.PI * m;
  let o = circle(0, 0, m, { fill: 'none', stroke: C.red, strokeWidth: t });
  o += circle(0, 0, m, { fill: 'none', stroke: '#fff', strokeWidth: t, strokeDasharray: `${f(L * 0.075)} ${f(L * 0.175)}`, transform: 'rotate(-14)' });
  o += circle(0, 0, r + t * 0.07, { fill: 'none', stroke: C.navy, strokeOpacity: 0.16, strokeWidth: t * 0.14 });
  o += circle(0, 0, m + t * 0.12, { fill: 'none', stroke: '#fff', strokeOpacity: 0.32, strokeWidth: t * 0.13, strokeDasharray: `${f(L * 0.16)} ${f(L)}`, transform: 'rotate(195)' });
  let rp = '';
  const pt = (a, rad) => [Math.cos((a * Math.PI) / 180) * rad, Math.sin((a * Math.PI) / 180) * rad];
  for (let k = 0; k < 4; k++) {
    const a1 = 90 * k, a2 = 90 * (k + 1), am = a1 + 45;
    const [x1, y1] = pt(a1, R * 0.97), [qx, qy] = pt(am, R * 1.2), [x2, y2] = pt(a2, R * 0.97);
    rp += P`M${x1} ${y1}Q${qx} ${qy} ${x2} ${y2}`;
  }
  o += path(rp, { fill: 'none', stroke: C.navy, strokeOpacity: 0.3, strokeWidth: R * 0.05 });
  o += path(rp, { fill: 'none', stroke: ropeCol, strokeWidth: R * 0.03, strokeLinecap: 'round' });
  return g({ transform: `${tr(cx, cy, rot)}${sy !== 1 ? ` scale(1 ${sy})` : ''}`, filter }, o);
}

function rescueTube(cx, cy, L, { rot = 0, filter, strap = true } = {}) {
  const h = L * 0.19;
  let o = '';
  if (strap) {
    o += path(P`M${-L / 2} 0C${-L / 2 - h * 1.6} ${h * 0.2} ${-L / 2 - h * 1.2} ${h * 2.4} ${-L / 2 + h * 0.6} ${h * 1.9}S${-L / 2 + h * 2.4} ${h * 2.6} ${-L / 2 + h * 3.6} ${h * 1.5}`,
      { fill: 'none', stroke: C.navy, strokeWidth: h * 0.12, strokeLinecap: 'round' });
    o += rect(L / 2 - h * 0.2, -h * 0.12, L * 0.17, h * 0.24, { fill: C.navy, rx: 4 });
    o += circle(L / 2 + L * 0.17, 0, h * 0.2, { fill: 'none', stroke: '#9FB3C8', strokeWidth: h * 0.09 });
  }
  o += rect(-L / 2, -h / 2, L, h, { rx: h / 2, fill: C.red });
  o += rect(-L / 2 + h * 0.4, -h / 2 + h * 0.15, L - h * 0.8, h * 0.17, { rx: h * 0.085, fill: '#fff', fillOpacity: 0.28 });
  o += path(P`M${-L / 2 + h * 0.95} ${-h / 2}v${h}M${L / 2 - h * 0.95} ${-h / 2}v${h}`, { stroke: C.redDark, strokeWidth: h * 0.07 });
  o += rect(-L / 2, h * 0.18, L, h * 0.32, { rx: h * 0.16, fill: C.navy, fillOpacity: 0.1 });
  return g({ transform: tr(cx, cy, rot), filter }, o);
}

function whistle(cx, cy, s, { rot = 0, col = C.red, slot = C.navy, lanyard = C.navy, filter } = {}) {
  let o = '';
  if (lanyard) o += path('M-30 -28C-80 -70 -150 -20 -120 30S-40 90 -90 140', { fill: 'none', stroke: lanyard, strokeWidth: 6, strokeLinecap: 'round' });
  o += circle(-30, -28, 12, { fill: 'none', stroke: col, strokeWidth: 7 });
  o += circle(0, 0, 42, { fill: col });
  o += rect(-4, -42, 104, 36, { rx: 9, fill: col });
  o += rect(92, -45, 16, 42, { rx: 6, fill: slot, fillOpacity: 0.85 });
  o += rect(28, -42, 24, 10, { rx: 3, fill: slot });
  o += path('M-26 -18A30 30 0 0 1 4 -32', { fill: 'none', stroke: '#fff', strokeOpacity: 0.45, strokeWidth: 7, strokeLinecap: 'round' });
  return g({ transform: tr(cx, cy, rot, s), filter }, o);
}

function backpack(cx, cy, s, { col = C.navy2, dark = C.navy, light = C.navy3, accent = C.red, filter } = {}) {
  let o = path('M-34 -96Q-34 -132 0 -132Q34 -132 34 -96', { fill: 'none', stroke: dark, strokeWidth: 12 });
  o += rect(-96, -56, 18, 120, { rx: 9, fill: dark }) + rect(78, -56, 18, 120, { rx: 9, fill: dark });
  o += rect(-82, -100, 164, 206, { rx: 46, fill: col });
  o += path('M-82 -28V-56Q-82 -100 -38 -100H38Q82 -100 82 -56V-28Q0 -6 -82 -28Z', { fill: light });
  o += rect(-82, -30, 164, 10, { fill: accent });
  o += rect(-54, 14, 108, 72, { rx: 20, fill: dark, fillOpacity: 0.55 });
  o += path('M-38 34H38', { stroke: light, strokeWidth: 5, strokeLinecap: 'round' });
  o += rect(26, 30, 10, 22, { rx: 4, fill: accent });
  return g({ transform: tr(cx, cy, 0, s), filter }, o);
}

function stopwatch(cx, cy, r, { filter, rot = 0 } = {}) {
  let o = rect(-r * 0.13, -r * 1.34, r * 0.26, r * 0.18, { rx: 4, fill: C.navy }) + rect(-r * 0.08, -r * 1.2, r * 0.16, r * 0.24, { fill: C.navy });
  o += g({ transform: 'rotate(42)' }, rect(-r * 0.08, -r * 1.2, r * 0.16, r * 0.24, { fill: C.navy2 }));
  o += circle(0, 0, r, { fill: C.navy }) + circle(0, 0, r * 0.82, { fill: '#fff' });
  let ticks = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, r1 = r * (i % 3 === 0 ? 0.6 : 0.68), r2 = r * 0.74;
    ticks += P`M${Math.sin(a) * r1} ${-Math.cos(a) * r1}L${Math.sin(a) * r2} ${-Math.cos(a) * r2}`;
  }
  o += path(ticks, { stroke: C.navy2, strokeWidth: r * 0.045, strokeLinecap: 'round' });
  o += path(P`M0 0L${r * 0.4} ${-r * 0.42}`, { stroke: C.red, strokeWidth: r * 0.07, strokeLinecap: 'round' });
  o += path(P`M0 0L${-r * 0.3} ${r * 0.12}`, { stroke: C.navy, strokeWidth: r * 0.07, strokeLinecap: 'round' });
  o += circle(0, 0, r * 0.08, { fill: C.navy });
  return g({ transform: tr(cx, cy, rot), filter }, o);
}

function clipboard(cx, cy, w, h, { rot = 0, filter, checks = 3, rows = 4 } = {}) {
  let o = rect(-w / 2, -h / 2, w, h, { rx: w * 0.07, fill: C.navy2 });
  o += rect(-w / 2 + w * 0.08, -h / 2 + h * 0.1, w * 0.84, h * 0.84, { rx: w * 0.03, fill: '#fff' });
  o += rect(-w * 0.2, -h / 2 - h * 0.03, w * 0.4, h * 0.1, { rx: w * 0.04, fill: '#9FB3C8' });
  const top = -h / 2 + h * 0.24, step = (h * 0.66) / rows;
  for (let i = 0; i < rows; i++) {
    const yy = top + i * step, bx = -w / 2 + w * 0.16, bs = Math.min(step * 0.5, w * 0.1);
    o += rect(bx, yy, bs, bs, { rx: bs * 0.2, fill: 'none', stroke: C.navy2, strokeWidth: Math.max(2, bs * 0.12) });
    if (i < checks) o += path(P`M${bx + bs * 0.2} ${yy + bs * 0.5}l${bs * 0.25} ${bs * 0.28}l${bs * 0.45} ${-bs * 0.6}`, { fill: 'none', stroke: C.red, strokeWidth: Math.max(2.5, bs * 0.16), strokeLinecap: 'round', strokeLinejoin: 'round' });
    o += rect(bx + bs * 1.6, yy + bs * 0.3, w * (i % 2 ? 0.4 : 0.52), bs * 0.4, { rx: bs * 0.2, fill: '#CBDAEA' });
  }
  return g({ transform: tr(cx, cy, rot), filter }, o);
}

// Abstract faceless adult, standing. (cx, base) = feet centre; h = height.
function person(cx, base, h, { shirt = C.navy2, legs = C.navy, skin = SKIN[0], hair = C.navy } = {}) {
  const top = base - h, r = h * 0.078, hy = top + r, sy = top + h * 0.2, sw = h * 0.28, tb = top + h * 0.57, rr = sw * 0.34;
  const lw = h * 0.092, gap = h * 0.014;
  // legs + swim shorts (lifeguard-style), feet as small rounded blocks
  let o = rect(cx - lw - gap, tb - 10, lw, base - tb + 4, { rx: lw * 0.45, fill: skin });
  o += rect(cx + gap, tb - 10, lw, base - tb + 4, { rx: lw * 0.45, fill: skin });
  o += rect(cx - lw - gap - h * 0.01, base - h * 0.03, lw + h * 0.02, h * 0.03, { rx: h * 0.012, fill: C.navy });
  o += rect(cx + gap - h * 0.01, base - h * 0.03, lw + h * 0.02, h * 0.03, { rx: h * 0.012, fill: C.navy });
  o += path(P`M${cx - sw / 2 + h * 0.01} ${tb - 12}H${cx + sw / 2 - h * 0.01}V${tb + h * 0.17}H${cx + gap * 0.5}V${tb + h * 0.06}H${cx - gap * 0.5}V${tb + h * 0.17}H${cx - sw / 2 + h * 0.01}Z`, { fill: legs });
  o += rect(cx - h * 0.03, hy + r * 0.6, h * 0.06, sy - hy, { fill: skin });
  o += path(P`M${cx - sw / 2} ${tb}V${sy + rr}Q${cx - sw / 2} ${sy} ${cx - sw / 2 + rr} ${sy}H${cx + sw / 2 - rr}Q${cx + sw / 2} ${sy} ${cx + sw / 2} ${sy + rr}V${tb}Z`, { fill: shirt });
  o += rect(cx - sw / 2 - h * 0.012, sy + rr * 0.6, h * 0.065, h * 0.33, { rx: h * 0.032, fill: shirt });
  o += rect(cx + sw / 2 - h * 0.053, sy + rr * 0.6, h * 0.065, h * 0.33, { rx: h * 0.032, fill: shirt });
  o += path(P`M${cx - sw / 2 + h * 0.05} ${sy + rr * 0.6}v${h * 0.3}`, { stroke: '#000', strokeOpacity: 0.12, strokeWidth: 3 });
  o += path(P`M${cx + sw / 2 - h * 0.05} ${sy + rr * 0.6}v${h * 0.3}`, { stroke: '#000', strokeOpacity: 0.12, strokeWidth: 3 });
  o += circle(cx, hy, r, { fill: skin });
  o += path(P`M${cx - r} ${hy}A${r} ${r} 0 0 1 ${cx + r} ${hy}Q${cx} ${hy - r * 0.35} ${cx - r} ${hy}Z`, { fill: hair });
  return o;
}

// Head-and-shoulders bust (faceless).
function bust(cx, base, s, { shirt = C.navy2, skin = SKIN[0], hair = C.navy } = {}) {
  const r = s * 0.22, hy = base - s * 0.5 - s * 0.04 - r;
  let o = path(P`M${cx - s / 2} ${base}V${base - s * 0.16}Q${cx - s / 2} ${base - s * 0.5} ${cx} ${base - s * 0.5}Q${cx + s / 2} ${base - s * 0.5} ${cx + s / 2} ${base - s * 0.16}V${base}Z`, { fill: shirt });
  o += circle(cx, hy, r, { fill: skin });
  o += path(P`M${cx - r} ${hy}A${r} ${r} 0 0 1 ${cx + r} ${hy}Q${cx} ${hy - r * 0.4} ${cx - r} ${hy}Z`, { fill: hair });
  return o;
}

// Person seen from directly above, facing direction `rot` (0 = facing down/+y).
function personTop(cx, cy, s, rot, { shirt = C.sky, hair = C.navy } = {}) {
  return g({ transform: tr(cx, cy, rot) },
    ellipse(0, 0, s * 0.5, s * 0.25, { fill: shirt }) +
    ellipse(-s * 0.36, s * 0.16, s * 0.1, s * 0.16, { fill: shirt }) + ellipse(s * 0.36, s * 0.16, s * 0.1, s * 0.16, { fill: shirt }) +
    circle(0, s * 0.03, s * 0.19, { fill: hair }));
}

const QMARK = 'M-38 -50C-38 -98 38 -98 38 -52C38 -20 0 -18 0 18';
function qmark(cx, cy, s, col, { sw = 26 } = {}) {
  return g({ transform: tr(cx, cy, 0, s) },
    path(QMARK, { fill: 'none', stroke: col, strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round' }) + circle(0, 62, sw * 0.62, { fill: col }));
}

function questionCard(cx, cy, w, h, rot, { bg = '#fff', fg = C.navy, bar = '#CBDAEA', filter } = {}) {
  let o = rect(-w / 2, -h / 2, w, h, { rx: w * 0.09, fill: bg });
  o += qmark(0, -h * 0.12, w / 330, fg);
  o += rect(-w * 0.32, h * 0.26, w * 0.64, h * 0.035, { rx: h * 0.018, fill: bar });
  o += rect(-w * 0.22, h * 0.33, w * 0.44, h * 0.035, { rx: h * 0.018, fill: bar });
  return g({ transform: tr(cx, cy, rot), filter }, o);
}

function pin(cx, cy, s, num, { col = C.navy, filter } = {}) {
  return g({ transform: tr(cx, cy, 0, s), filter },
    path('M0 0C-8 -16 -32 -34 -32 -60A32 32 0 1 1 32 -60C32 -34 8 -16 0 0Z', { fill: col }) +
    circle(0, -60, 21, { fill: '#fff' }) +
    `<text x="0" y="-51" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="25" fill="${col}">${num}</text>`);
}

function waveBand(W, y, amp, period, phase) {
  let d = P`M-20 ${y}`;
  for (let x = -20; x < W + period; x += period) {
    d += P`C${x + period * 0.25} ${y - amp + phase} ${x + period * 0.25} ${y - amp} ${x + period * 0.5} ${y}S${x + period * 0.75} ${y + amp} ${x + period} ${y}`;
  }
  return d;
}

function panelBox(c, x, y, w, h, { fill = '#fff', rx = 28, filter } = {}) {
  return rect(x, y, w, h, { rx, fill, filter });
}

// ---------------------------------------------------------------------------------------------------------
// The 12 compositions
// ---------------------------------------------------------------------------------------------------------

// pool-01: overhead turquoise pool, lane geometry, white information panel
function pool01(c, d) {
  const { W, H, S } = c;
  const deckH = c.pick({ portrait: 260, square: 236, story: 430 });
  let o = rect(0, 0, W, H, { fill: tiles(c) });
  o += poolTop(c, -40, deckH, W + 80, H - deckH + 60, { lanes: 6, rx: 0 });
  const lw = (W + 80) / 6;
  for (let i = 0; i < 6; i++) o += startBlock(-40 + lw * (i + 0.5), deckH - 26, i + 1);
  o += wmTop(c);
  const sq = c.name === 'square';
  const pad = sq ? 46 : 58, pw = sq ? 660 : S.r - S.l, tw = pw - 2 * pad;
  const fit = fitHL(d.headline, tw, { max: c.pick({ portrait: 104, square: 80, story: 108 }), maxLines: 2 });
  const ph = pad + 24 + 34 + fit.h + 40 + 14 + pad;
  const px = S.l, py = S.b - ph;
  o += panelBox(c, px, py, pw, ph, { filter: shadow(c, 'sh', 18, 22, 0.28) });
  o += rect(px, py + pad, 8, ph - 2 * pad, { fill: C.red });
  o += kicker(c, px + pad, py + pad, d.kicker);
  o += drawHL(c, fit, px + pad, py + pad + 24 + 34);
  const sy = py + ph - pad - 14;
  [56, 56, 56, 110].forEach((w, i, arr) => {
    const x = px + pad + arr.slice(0, i).reduce((a, b) => a + b + 12, 0);
    o += rect(x, sy, w, 14, { rx: 7, fill: i === 3 ? C.red : i === 2 ? C.sky : C.navy2, fillOpacity: i < 2 ? 0.35 : 1 });
  });
  return o;
}

// pool-02: poolside perspective, navy wall blocks, restrained red accent
function pool02(c, d) {
  const { W, H, S } = c;
  const hz = c.pick({ portrait: 780, square: 600, story: 1130 });
  const deckY = c.pick({ portrait: 1200, square: 960, story: 1700 });
  let o = rect(0, 0, W, hz, { fill: linGrad(c, 'wall', [[0, C.navy], [1, C.navy2]]) });
  // facility panels
  const py0 = hz - c.pick({ portrait: 230, square: 160, story: 330 });
  const cols = 7, gap = 14, cw = (W + 40 - gap * (cols - 1)) / cols;
  for (let i = 0; i < cols; i++) {
    const x = -20 + i * (cw + gap), tall = i % 3 === 1 ? 50 : 0;
    o += rect(x, py0 - tall, cw, hz - 46 - py0 + tall, { fill: linGrad(c, 'win', [[0, C.sky, 0.32], [1, C.sky, 0.04]]) });
    o += rect(x, py0 - tall, cw, 4, { fill: C.sky, fillOpacity: 0.55 });
  }
  o += rect(0, hz - 46, W, 46, { fill: '#DCE7F2' });
  o += rect(0, hz - 52, W, 6, { fill: C.red });
  // perspective pool
  const fl = W * 0.14, fr = W * 0.86, nl = -W * 0.55, nr = W * 1.55, lanes = 6;
  const water = P`M${fl} ${hz}L${fr} ${hz}L${nr} ${deckY}L${nl} ${deckY}Z`;
  const lerp = (a, b, t) => a + (b - a) * t;
  let wi = path(water, { fill: linGrad(c, 'pw', [[0, C.t4], [0.5, C.t3], [1, C.t2]]) });
  for (let i = 0; i < lanes; i++) {
    const t = (i + 0.5) / lanes, xf = lerp(fl, fr, t), xn = lerp(nl, nr, t);
    wi += path(P`M${xf - 3} ${hz + 20}L${xf + 3} ${hz + 20}L${xn + 26} ${deckY}L${xn - 26} ${deckY}Z`, { fill: C.navy2, fillOpacity: 0.2 });
  }
  wi += path(water, { fill: caustic(c, 'p', { cell: 70, op: 0.3, sx: 0.45 }) });
  // light streaks
  const r = c.rand;
  for (let k = 0; k < 16; k++) {
    const t = Math.pow(r(), 1.4), y = lerp(hz + 12, deckY - 20, t), ww = lerp(30, 220, t);
    wi += rect(r() * W - ww / 2, y, ww, lerp(2, 7, t), { rx: 3, fill: '#fff', fillOpacity: 0.35 + r() * 0.3 });
  }
  // lane ropes with perspective floats
  for (let i = 1; i < lanes; i++) {
    const t = i / lanes, xf = lerp(fl, fr, t), xn = lerp(nl, nr, t);
    const N = 22;
    let red = '', white = '';
    for (let k = 0; k < N; k++) {
      const u0 = Math.pow(k / N, 1.9), u1 = Math.pow((k + 1) / N, 1.9);
      const seg = P`M${lerp(xf, xn, u0)} ${lerp(hz, deckY, u0)}L${lerp(xf, xn, u1)} ${lerp(hz, deckY, u1)}`;
      if (k % 2) red += seg; else white += seg;
    }
    const wdt = 12;
    wi += path(white, { stroke: '#fff', strokeWidth: wdt }) + path(red, { stroke: i === 3 ? C.red : C.navy2, strokeWidth: wdt });
  }
  o += g({ clipPath: clip(c, path(water)) }, wi);
  // far-end starting blocks
  for (let i = 0; i < lanes; i++) {
    const x = lerp(fl, fr, (i + 0.5) / lanes);
    o += rect(x - 22, hz - 40, 44, 26, { rx: 4, fill: C.navy }) + rect(x - 18, hz - 44, 36, 8, { rx: 3, fill: '#fff' });
  }
  // foreground deck
  o += rect(0, deckY, W, H - deckY, { fill: '#EEF4FA' });
  let tl = '';
  for (let i = -10; i <= 20; i++) tl += P`M${W / 2 + i * 70} ${deckY}L${W / 2 + i * 150} ${H}`;
  for (let y = deckY + 30, s = 30; y < H; s *= 1.35, y += s) tl += P`M0 ${y}H${W}`;
  o += path(tl, { stroke: '#D2DFEC', strokeWidth: 3 });
  o += rect(0, deckY - 4, W, 26, { fill: '#fff' }) + rect(0, deckY + 22, W, 4, { fill: '#C5D8EA' });
  // text on wall
  o += wmTop(c, '#fff');
  const ky = S.t + c.pick({ portrait: 96, square: 84, story: 110 });
  o += kicker(c, S.l, ky, d.kicker, { color: C.sky });
  const fit = fitHL(d.headline, S.r - S.l, { max: c.pick({ portrait: 100, square: 84, story: 112 }), maxLines: 3, maxH: py0 - 70 - ky - 50 });
  o += drawHL(c, fit, S.l, ky + 58, { color: '#fff' });
  return o;
}

// pool-03: abstract water + crisp geometric training motif (ascending blocks, option routes)
function pool03(c, d) {
  const { W, H, S } = c;
  let o = rect(0, 0, W, H, { fill: linGrad(c, 'bg', [[0, C.navy], [0.6, C.navy2], [1, C.navy3]]) });
  o += rect(0, 0, W, H, { fill: dots(c, { op: 0.22 }) });
  o += circle(W * 0.85, H * 0.18, 340, { fill: radGrad(c, 'glow', [[0, C.sky, 0.28], [1, C.sky, 0]]) });
  const L = c.pick({
    portrait: { wy: 1010, bx: 360, bw: 104, sh: 66, base: 1060, sx: 150, sy: 900, lift: 180 },
    square: { wy: 850, bx: 450, bw: 94, sh: 54, base: 890, sx: 150, sy: 760, lift: 90 },
    story: { wy: 1480, bx: 300, bw: 122, sh: 88, base: 1530, sx: 160, sy: 1280, lift: 240 },
  });
  // ascending staircase (isometric), deep treads; top step in red
  const dx = L.bw * 0.5, dy = L.bw * 0.36;
  const tops = [];
  const NS = 5;
  for (let i = 0; i < NS; i++) {
    const x = L.bx + i * L.bw, top = L.base - (i + 1) * L.sh - 40, last = i === NS - 1;
    tops.push([x + L.bw / 2 + dx / 2, top - dy / 2]);
    o += path(P`M${x} ${top}l${dx} ${-dy}h${L.bw}l${-dx} ${dy}z`, { fill: last ? C.red : '#E6F6FD' });
    o += path(P`M${x + L.bw} ${top}l${dx} ${-dy}V${L.base}h${-dx}z`, { fill: '#8FCFF2' });
    o += rect(x, top, L.bw, L.base - top, { fill: '#fff' });
    o += path(P`M${x} ${top}h${L.bw}`, { stroke: last ? C.red : C.sky, strokeWidth: 5 });
  }
  // flag on the top step
  {
    const [fx, fy] = tops[NS - 1], fh = L.sh * 1.9;
    o += path(P`M${fx} ${fy}V${fy - fh}`, { stroke: '#fff', strokeWidth: 6, strokeLinecap: 'round' });
    o += path(P`M${fx + 3} ${fy - fh}h${fh * 0.55}l${-fh * 0.14} ${fh * 0.17}l${fh * 0.14} ${fh * 0.17}h${-fh * 0.55}z`, { fill: C.red });
  }
  // option routes from a start point
  const [sx, sy] = [L.sx, L.sy];
  let routes = '';
  [0, 2, 4].forEach((k) => {
    const [tx, ty] = tops[k];
    routes += P`M${sx} ${sy}C${sx + 30} ${Math.min(sy, ty) - L.lift + k * 20} ${tx - 90} ${ty - L.lift * 0.8} ${tx} ${ty - 12}`;
  });
  o += path(routes, { fill: 'none', stroke: '#fff', strokeOpacity: 0.85, strokeWidth: 6, strokeDasharray: '2 18', strokeLinecap: 'round' });
  o += circle(sx, sy, 20, { fill: C.navy, stroke: '#fff', strokeWidth: 6 }) + circle(sx, sy, 40, { fill: 'none', stroke: '#fff', strokeOpacity: 0.3, strokeWidth: 3 });
  // layered abstract water
  const tones = [[C.t4, 0.55], [C.t3, 0.8], [C.t2, 1], [C.t1, 1]];
  tones.forEach(([col, op], i) => {
    const y = L.wy + i * c.pick({ portrait: 70, square: 58, story: 90 });
    const dW = waveBand(W, y, 18 + i * 5, 260 + i * 60, i * 6);
    o += path(dW + P`L${W + 40} ${H + 20}L-20 ${H + 20}Z`, { fill: col, fillOpacity: op });
    o += path(dW, { fill: 'none', stroke: '#fff', strokeOpacity: 0.45 - i * 0.08, strokeWidth: 4 });
  });
  o += rect(0, L.wy + 60, W, H, { fill: caustic(c, 'w', { cell: 90, op: 0.18, sx: 0.5 }), clipPath: clip(c, rect(0, L.wy + 80, W, H)) });
  o += wmTop(c, '#fff');
  const ky = S.t + c.pick({ portrait: 100, square: 84, story: 120 });
  o += kicker(c, S.l, ky, d.kicker, { color: C.sky });
  const fit = fitHL(d.headline, c.pick({ portrait: 860, square: 900, story: 860 }), { max: c.pick({ portrait: 104, square: 86, story: 116 }), maxLines: 3 });
  o += drawHL(c, fit, S.l, ky + 58, { color: '#fff' });
  return o;
}

// gear-01: red rescue tube + ring buoy on deck tiles, pool corner, navy headline block
function gear01(c, d) {
  const { W, H, S } = c;
  let o = rect(0, 0, W, H, { fill: tiles(c, { size: 90 }) });
  const L = c.pick({
    portrait: { pool: [620, 1050], tube: [600, 840, 600, -28], ring: [270, 770, 150], wh: [300, 1170, 1.0, 14], pw: 1080 },
    square: { pool: [740, 820], tube: [470, 770, 520, -14], ring: [860, 270, 130], wh: [210, 960, 0.85, 8], pw: 690 },
    story: { pool: [600, 1560], tube: [620, 1150, 660, -28], ring: [290, 1010, 175], wh: [300, 1450, 1.15, 14], pw: 1080 },
  });
  const [px, py] = L.pool;
  o += poolTop(c, px, py, W - px + 200, H - py + 200, { lanes: 2, rx: 70, coping: 26 });
  // ladder rails at pool edge
  o += path(P`M${px + 80} ${py - 46}v70M${px + 150} ${py - 46}v70`, { stroke: '#B8C9DA', strokeWidth: 14, strokeLinecap: 'round' });
  const sh = shadow(c, 'sh', 16, 12, 0.3);
  o += rescueTube(L.tube[0], L.tube[1], L.tube[2], { rot: L.tube[3], filter: sh });
  o += ringBuoy(L.ring[0], L.ring[1], L.ring[2], { rot: 12, filter: sh, ropeCol: '#F3F6F9' });
  o += whistle(L.wh[0], L.wh[1], L.wh[2], { rot: L.wh[3], filter: sh });
  // navy headline block anchored to the top-left corner
  const sq = c.name === 'square';
  const tw = sq ? L.pw - S.l - 50 : S.r - S.l;
  const ky = S.t + 96;
  const fit = fitHL(d.headline, tw, { max: c.pick({ portrait: 96, square: 78, story: 108 }), maxLines: c.pick({ portrait: 3, square: 4, story: 3 }) });
  const bh = ky + 58 + fit.h + c.pick({ portrait: 56, square: 50, story: 70 });
  const pw = L.pw;
  o += path(P`M0 0H${pw}V${bh - (sq ? 60 : 0)}${sq ? P`Q${pw} ${bh} ${pw - 60} ${bh}` : ''}H0Z`, { fill: C.navy });
  o += rect(0, bh - 10, sq ? pw - 60 : pw, 10, { fill: C.red });
  o += wmTop(c, '#fff');
  o += kicker(c, S.l, ky, d.kicker, { color: C.sky });
  o += drawHL(c, fit, S.l, ky + 58, { color: '#fff' });
  return o;
}

// gear-02: bag, whistle and ring silhouettes on clean navy
function gear02(c, d) {
  const { W, H, S } = c;
  let o = rect(0, 0, W, H, { fill: C.navy });
  o += rect(0, 0, W, H, { fill: radGrad(c, 'gl', [[0, C.navy3, 0.9], [1, C.navy3, 0]], 0.85, 0.15, 0.7) });
  o += rect(0, 0, W, H, { fill: gridPat(c, { gap: 90, col: C.sky, sw: 1.5 }), opacity: 0.09 });
  o += wmTop(c, '#fff');
  const ky = S.t + c.pick({ portrait: 100, square: 84, story: 120 });
  o += kicker(c, S.l, ky, d.kicker, { color: C.sky });
  const fit = fitHL(d.headline.replace('. ', '.\n'), S.r - S.l, { max: c.pick({ portrait: 104, square: 84, story: 112 }), maxLines: 4 });
  o += drawHL(c, fit, S.l, ky + 58, { color: '#fff', colors: ['#fff', C.sky] });
  const tile = (x, y, w, h, icon, label) => {
    const s = Math.min(w, h);
    let t = rect(x, y, w, h, { rx: 30, fill: linGrad(c, 'tg', [[0, C.navy2], [1, '#08386B']]), stroke: C.sky, strokeOpacity: 0.3, strokeWidth: 2 });
    t += rect(x + 30, y + 32, 44, 9, { rx: 4.5, fill: C.red });
    t += icon(x + w / 2, y + h * 0.53, s / 272);
    t += `<text x="${f(x + 30)}" y="${f(y + h - 30)}" font-family="${FONT}" font-weight="700" font-size="22" letter-spacing="2" fill="${C.sky}">${label}</text>`;
    return t;
  };
  const icons = [
    [(x, y, k) => ringBuoy(x, y, 92 * k, { rot: 8, ropeCol: '#fff' }), '01'],
    [(x, y, k) => backpack(x, y + 6 * k, 0.8 * k, { col: '#fff', dark: '#B9DDF5', light: C.sky, accent: C.red }), '02'],
    [(x, y, k) => whistle(x - 28 * k, y + 22 * k, 1.15 * k, { rot: -18, col: C.red, slot: C.navy, lanyard: null }), '03'],
  ];
  const lay = c.pick({
    portrait: [[86, 640, 540, 540], [652, 640, 342, 257], [652, 923, 342, 257]],
    square: [[86, 650, 290, 290], [395, 650, 290, 290], [704, 650, 290, 290]],
    story: [[86, 850, 908, 400], [86, 1280, 439, 300], [555, 1280, 439, 300]],
  });
  lay.forEach(([x, y, w, h], i) => (o += tile(x, y, w, h, icons[i][0], icons[i][1])));
  return o;
}

// gear-03: equipment arranged as a graphic still life
function gear03(c, d) {
  const { W, H, S } = c;
  let o = rect(0, 0, W, H, { fill: C.ws });
  const L = c.pick({
    portrait: { shelf: 840, k: 1, ox: 0, ty: 940, arch: [170, 230, 740] },
    square: { shelf: 690, k: 0.82, ox: 40, ty: 770, arch: [200, 170, 640] },
    story: { shelf: 1170, k: 1.08, ox: -20, ty: 1260, arch: [140, 480, 800] },
  });
  const [ax, ay, aw] = L.arch;
  o += path(P`M${ax} ${L.shelf}V${ay + aw / 2}A${aw / 2} ${aw / 2} 0 0 1 ${ax + aw} ${ay + aw / 2}V${L.shelf}Z`, { fill: linGrad(c, 'ar', [[0, '#D3EDFB'], [1, '#B6E0F7']]) });
  o += rect(0, L.shelf, W, 34, { fill: C.navy2 }) + rect(0, L.shelf + 34, W, 10, { fill: C.navy, fillOpacity: 0.25 });
  const k = L.k, sh = shadow(c, 'sh', 10, 10, 0.25);
  const ox = L.ox + (W - W * k) / 2;
  const at = (x) => ox + x * k;
  let art = '';
  // standing rescue tube (leaning)
  art += rescueTube(at(270), L.shelf - 250 * k, 500 * k, { rot: 84, strap: false, filter: sh });
  // upright ring buoy
  art += ringBuoy(at(520), L.shelf - 175 * k, 175 * k, { rot: 20, filter: sh, ropeCol: '#fff' });
  // towel stack
  const tx = at(700), tw = 210 * k, th = 46 * k;
  ['#fff', C.sky, C.navy2].forEach((col, i) => {
    const y = L.shelf - (i + 1) * th;
    art += rect(tx, y, tw, th - 4, { rx: th * 0.45, fill: col, filter: i === 0 ? sh : undefined });
    if (i === 0) art += rect(tx + tw * 0.2, y + th * 0.36, tw * 0.6, th * 0.16, { rx: 4, fill: C.red });
  });
  art += stopwatch(tx + tw / 2, L.shelf - 3 * th - 82 * k, 70 * k, { filter: sh, rot: -8 });
  art += whistle(at(150), L.shelf - 30 * k, 0.62 * k, { rot: -6, lanyard: null, filter: sh });
  o += art;
  // text below the shelf
  o += wmTop(c);
  o += kicker(c, S.l, L.ty, d.kicker);
  const fit = fitHL(d.headline, S.r - S.l, { max: c.pick({ portrait: 116, square: 90, story: 150 }), maxLines: 2, maxH: S.b - L.ty - 58 });
  o += drawHL(c, fit, S.l, L.ty + 58);
  return o;
}

// team-01: abstract adult team silhouettes in front of the pool, with notes
function team01(c, d) {
  const { W, H, S } = c;
  const L = c.pick({
    portrait: { pool: [680, 1010], base: 1310, ph: 480, xs: [170, 350, 540, 730, 910], notes: [600, 590] },
    square: { pool: [520, 820], base: 1050, ph: 400, xs: [380, 530, 680, 830, 980], notes: [130, 640] },
    story: { pool: [900, 1330], base: 1800, ph: 640, xs: [150, 345, 540, 735, 930], notes: [560, 830] },
  });
  let o = rect(0, 0, W, H, { fill: linGrad(c, 'bg', [[0, '#fff'], [1, C.ws]]) });
  const [p0, p1] = L.pool;
  // side-view pool band
  o += rect(0, p0, W, p1 - p0, { fill: waterGrad(c) });
  o += rect(0, p0, W, p1 - p0, { fill: caustic(c, 'a', { cell: 80, op: 0.28, sx: 0.5 }) });
  for (let i = 1; i <= 3; i++) {
    const y = p0 + ((p1 - p0) * i) / 4;
    o += rope(-10, y, W + 10, y, { w: 10 + i * 3 });
  }
  o += rect(0, p0 - 18, W, 18, { fill: '#fff' }) + rect(0, p1, W, H - p1, { fill: tiles(c, { size: 80 }) }) + rect(0, p1, W, 16, { fill: '#F8FBFE' }) + rect(0, p1 + 16, W, 3, { fill: '#C5D8EA' });
  // notes cards
  const [nx, ny] = L.notes, sh = shadow(c, 'sh', 10, 12, 0.18);
  const note = (x, y, rot, col, lines) =>
    g({ transform: tr(x, y, rot), filter: sh },
      rect(-90, -60, 180, 120, { rx: 14, fill: col }) +
      lines.map((w, i) => rect(-64, -30 + i * 26, w, 10, { rx: 5, fill: col === '#fff' ? '#C9D8E8' : '#fff', fillOpacity: 0.85 })).join(''));
  o += note(nx, ny, -6, '#fff', [128, 96, 110]) + note(nx + 170, ny - 30, 5, C.sky, [120, 80, 100]) + note(nx + 330, ny + 4, -3, '#fff', [90, 124, 70]);
  o += rect(nx - 14, ny - 70, 28, 14, { rx: 4, fill: C.red, transform: `rotate(-6 ${nx} ${ny})` });
  // team
  const shirts = [C.navy2, C.red, C.t2, C.navy, C.sky];
  const hs = [0.92, 1, 0.95, 1.03, 0.9];
  L.xs.forEach((x, i) => (o += person(x, L.base, L.ph * hs[i], { shirt: shirts[i], skin: SKIN[i], legs: [C.red, C.navy, C.red, C.navy2, C.red][i], hair: i === 2 ? '#3B2A20' : C.navy })));
  o += clipboard(L.xs[2] + L.ph * 0.13, L.base - L.ph * 0.95 * 0.55, L.ph * 0.2, L.ph * 0.27, { rot: -8, rows: 3, checks: 2 });
  o += wmTop(c);
  const ky = S.t + c.pick({ portrait: 100, square: 84, story: 120 });
  o += kicker(c, S.l, ky, d.kicker);
  const fit = fitHL(d.headline, c.pick({ portrait: 880, square: 900, story: 880 }), { max: c.pick({ portrait: 108, square: 86, story: 118 }), maxLines: c.pick({ portrait: 3, square: 2, story: 3 }) });
  o += drawHL(c, fit, S.l, ky + 58);
  return o;
}

// team-02: stacked learning cards with an understated team illustration
function team02(c, d) {
  const { W, H, S } = c;
  let o = rect(0, 0, W, H, { fill: linGrad(c, 'bg', [[0, C.ws], [1, '#D3EAF9']], [0, 0, 1, 1]) });
  o += path(P`M${W * 0.45} ${H}L${W} ${H * 0.35}V${H * 0.62}L${W * 0.72} ${H}Z`, { fill: '#fff', fillOpacity: 0.5 });
  o += path(P`M0 ${H * 0.7}L${W * 0.28} ${H * 0.4}V${H * 0.55}L0 ${H * 0.88}Z`, { fill: '#fff', fillOpacity: 0.35 });
  const L = c.pick({
    portrait: { cx: 560, cy: 965, k: 0.93 },
    square: { cx: 800, cy: 610, k: 0.6 },
    story: { cx: 540, cy: 1300, k: 1.2 },
  });
  const sh = shadow(c, 'sh', 18, 20, 0.2);
  const cw = 640, ch = 560;
  let st = '';
  st += g({ transform: 'rotate(-8) translate(-40 -50)' }, rect(-cw / 2, -ch / 2, cw, ch, { rx: 32, fill: C.navy2, filter: sh }));
  st += g({ transform: 'rotate(5) translate(30 -24)' }, rect(-cw / 2, -ch / 2, cw, ch, { rx: 32, fill: C.sky, filter: sh }));
  let fc = rect(-cw / 2, -ch / 2, cw, ch, { rx: 32, fill: '#fff', filter: sh });
  // team strip
  fc += path(P`M${-cw / 2} ${-ch / 2 + 32}Q${-cw / 2} ${-ch / 2} ${-cw / 2 + 32} ${-ch / 2}H${cw / 2 - 32}Q${cw / 2} ${-ch / 2} ${cw / 2} ${-ch / 2 + 32}V${-ch / 2 + 190}H${-cw / 2}Z`, { fill: '#E3F3FC' });
  fc += g({ clipPath: clip(c, rect(-cw / 2, -ch / 2, cw, 190, { rx: 32 })) },
    bust(-150, -ch / 2 + 192, 150, { shirt: C.navy2, skin: SKIN[1] }) + bust(150, -ch / 2 + 192, 150, { shirt: C.t2, skin: SKIN[3], hair: '#5B3B28' }) + bust(0, -ch / 2 + 192, 170, { shirt: C.red, skin: SKIN[2] }));
  // modules list
  const rows = [[true, 300], [true, 240], [false, 280]];
  rows.forEach(([done, w], i) => {
    const y = -ch / 2 + 240 + i * 74;
    fc += rect(-cw / 2 + 48, y, 40, 40, { rx: 10, fill: done ? C.navy2 : '#fff', stroke: C.navy2, strokeWidth: 4 });
    if (done) fc += path(P`M${-cw / 2 + 57} ${y + 21}l9 9l16 -18`, { fill: 'none', stroke: '#fff', strokeWidth: 6, strokeLinecap: 'round', strokeLinejoin: 'round' });
    fc += rect(-cw / 2 + 112, y + 6, w, 14, { rx: 7, fill: C.navy, fillOpacity: 0.75 }) + rect(-cw / 2 + 112, y + 28, w * 0.6, 9, { rx: 4.5, fill: '#C3D4E6' });
  });
  fc += rect(-cw / 2 + 48, ch / 2 - 64, cw - 96, 18, { rx: 9, fill: '#E1EAF4' }) + rect(-cw / 2 + 48, ch / 2 - 64, (cw - 96) * 0.62, 18, { rx: 9, fill: C.red });
  st += fc;
  o += g({ transform: tr(L.cx, L.cy, 0, L.k) }, st);
  o += wmTop(c);
  const sq = c.name === 'square';
  const ky = S.t + c.pick({ portrait: 100, square: 120, story: 120 });
  o += kicker(c, S.l, ky, d.kicker);
  const fit = fitHL(d.headline, sq ? 440 : c.pick({ portrait: 900, story: 860 }), { max: c.pick({ portrait: 100, square: 76, story: 116 }), maxLines: sq ? 5 : 3 });
  o += drawHL(c, fit, S.l, ky + 58);
  return o;
}

// team-03: collaborative planning table from above (no names)
function team03(c, d) {
  const { W, H, S } = c;
  let o = rect(0, 0, W, H, { fill: linGrad(c, 'bg', [[0, C.navy], [1, C.navy2]]) });
  o += rect(0, 0, W, H, { fill: gridPat(c, { gap: 120, col: C.sky, sw: 1.5 }), opacity: 0.08 });
  const L = c.pick({
    portrait: { cx: 540, cy: 920, k: 1.0, rot: 0 },
    square: { cx: 640, cy: 720, k: 0.68, rot: 0 },
    story: { cx: 540, cy: 1270, k: 1.24, rot: 90 },
  });
  const sh = shadow(c, 'sh', 16, 18, 0.35);
  const tw = 640, th = 400;
  let t = '';
  const shirts = [C.sky, C.red, '#fff', C.t3, C.sky, '#fff'];
  const hair = ['#2B1D14', C.navy, '#6B4A33', '#1C2A3A', '#8C5A3C', '#3B2A20'];
  const seats = [[-170, -th / 2 - 70, 0], [170, -th / 2 - 70, 0], [-170, th / 2 + 70, 180], [170, th / 2 + 70, 180], [-tw / 2 - 70, 0, -90], [tw / 2 + 70, 0, 90]];
  seats.forEach(([x, y, r], i) => (t += personTop(x, y, 150, r, { shirt: shirts[i], hair: hair[i] })));
  t += rect(-tw / 2, -th / 2, tw, th, { rx: 56, fill: '#F4F8FC', filter: sh });
  // planning sheet with pool plan
  t += g({ transform: 'rotate(-4)' },
    rect(-210, -130, 300, 220, { rx: 12, fill: '#fff', stroke: '#D5E2EF', strokeWidth: 3 }) +
    rect(-186, -104, 252, 130, { rx: 10, fill: C.t3 }) +
    path('M-186 -61.7H66M-186 -18.3H66', { stroke: '#fff', strokeWidth: 5, strokeDasharray: '10 8' }) +
    rect(-186, 44, 160, 12, { rx: 6, fill: '#C9D8E8' }) + rect(-186, 64, 110, 12, { rx: 6, fill: '#C9D8E8' }) +
    circle(30, 54, 16, { fill: C.red }));
  t += g({ transform: 'translate(170 -80) rotate(7)' }, rect(-56, -56, 112, 112, { rx: 8, fill: C.sky }) + rect(-36, -24, 72, 9, { rx: 4.5, fill: '#fff' }) + rect(-36, -4, 52, 9, { rx: 4.5, fill: '#fff' }));
  t += g({ transform: 'translate(190 70) rotate(-6)' }, rect(-56, -56, 112, 112, { rx: 8, fill: C.red }) + rect(-36, -24, 72, 9, { rx: 4.5, fill: '#fff' }) + rect(-36, -4, 40, 9, { rx: 4.5, fill: '#fff' }));
  t += g({ transform: 'translate(20 120) rotate(3)' }, rect(-70, -40, 140, 70, { rx: 8, fill: C.navy2 }) + rect(-58, -28, 116, 46, { rx: 4, fill: '#2A6DA8' }));
  t += path('M-250 110l70 -24', { stroke: C.navy, strokeWidth: 9, strokeLinecap: 'round' });
  o += g({ transform: tr(L.cx, L.cy, L.rot, L.k) }, t);
  o += wmTop(c, '#fff');
  const ky = S.t + c.pick({ portrait: 100, square: 84, story: 120 });
  o += kicker(c, S.l, ky, d.kicker, { color: C.sky });
  const fit = fitHL(d.headline.replace('. ', '.\n'), S.r - S.l, { max: c.pick({ portrait: 100, square: 80, story: 104 }), maxLines: 2 });
  o += drawHL(c, fit, S.l, ky + 58, { color: '#fff', colors: ['#fff', C.sky] });
  return o;
}

// questions-01: pool texture plus three question cards
function questions01(c, d) {
  const { W, H, S } = c;
  let o = rect(0, 0, W, H, { fill: waterGrad(c) });
  o += rect(0, 0, W, H, { fill: caustic(c, 'a', { cell: 90, op: 0.32 }) }) + rect(0, 0, W, H, { fill: caustic(c, 'b', { cell: 150, op: 0.16, rot: 23 }) });
  o += rope(-10, c.pick({ portrait: 1180, square: 1010, story: 1700 }), W + 10, c.pick({ portrait: 1180, square: 1010, story: 1700 }), { w: 18 });
  const sq = c.name === 'square';
  const L = c.pick({
    portrait: { band: 610, cx: 540, cy: 900, k: 1, rip: 1120 },
    square: { band: 0, cx: 770, cy: 560, k: 0.6, rip: 780 },
    story: { band: 820, cx: 540, cy: 1250, k: 1.06, rip: 1520 },
  });
  // ripples beneath the cards
  let rp = '';
  for (let i = 0; i < 4; i++) rp += ellipse(L.cx, L.rip, (220 + i * 90) * L.k, (40 + i * 18) * L.k, { fill: 'none', stroke: '#fff', strokeOpacity: 0.5 - i * 0.1, strokeWidth: 4 });
  o += rp;
  const shd = shadow(c, 'sh', 22, 22, 0.3);
  let cards = '';
  cards += questionCard(-250, 30, 300, 400, -13, { filter: shd });
  cards += questionCard(250, 30, 300, 400, 13, { filter: shd });
  cards += questionCard(0, 0, 320, 420, 0, { bg: C.red, fg: '#fff', bar: '#FF8A90', filter: shd });
  o += g({ transform: tr(L.cx, L.cy, 0, L.k) }, cards);
  // navy text band
  if (sq) o += path(P`M0 0H560L500 ${H}H0Z`, { fill: C.navy, fillOpacity: 0.96 });
  else o += path(P`M0 0H${W}V${L.band - 70}L0 ${L.band}Z`, { fill: C.navy, fillOpacity: 0.96 });
  o += wmTop(c, '#fff');
  const ky = S.t + c.pick({ portrait: 100, square: 110, story: 120 });
  o += kicker(c, S.l, ky, d.kicker, { color: C.sky });
  const fit = fitHL(d.headline, sq ? 380 : S.r - S.l, { max: c.pick({ portrait: 96, square: 72, story: 104 }), maxLines: sq ? 6 : 3 });
  o += drawHL(c, fit, S.l, ky + 58, { color: '#fff' });
  return o;
}

// questions-02: navy editorial layout with a red question-mark motif
function questions02(c, d) {
  const { W, H, S } = c;
  let o = rect(0, 0, W, H, { fill: C.navy });
  o += rect(0, 0, W, H, { fill: radGrad(c, 'gl', [[0, C.navy2, 1], [1, C.navy2, 0]], 0.75, 0.4, 0.6) });
  let rules = '';
  [S.l, W / 2, S.r].forEach((x) => (rules += P`M${x} ${S.t + 70}V${H}`));
  o += path(rules, { stroke: C.sky, strokeOpacity: 0.12, strokeWidth: 2 });
  o += rect(S.l, S.t + 62, S.r - S.l, 2, { fill: C.sky, fillOpacity: 0.5 });
  const L = c.pick({
    portrait: { qx: 760, qy: 470, qs: 3.3, topics: S.t + 110 },
    square: { qx: 790, qy: 380, qs: 2.6, topics: S.t + 104 },
    story: { qx: 720, qy: 640, qs: 3.9, topics: S.t + 120 },
  });
  // ripples where the dot lands
  const dy = L.qy + 62 * L.qs;
  for (let i = 0; i < 4; i++) o += ellipse(L.qx, dy + 16 * L.qs, (40 + i * 36) * L.qs, (9 + i * 8) * L.qs, { fill: 'none', stroke: C.sky, strokeOpacity: 0.45 - i * 0.09, strokeWidth: 3 });
  o += qmark(L.qx + 10, L.qy + 14, L.qs, '#000', { sw: 26 }).replace('<g ', '<g opacity=".25" ');
  o += qmark(L.qx, L.qy, L.qs, C.red);
  // topics list
  ['Course options', 'Preparation', 'Next steps'].forEach((t, i) => {
    const y = L.topics + i * 54;
    o += rect(S.l, y + 10, 18, 18, { rx: 4, fill: i === 0 ? C.red : 'none', stroke: C.sky, strokeWidth: i === 0 ? 0 : 3 });
    o += `<text x="${f(S.l + 36)}" y="${f(y + 27)}" font-family="${FONT}" font-weight="700" font-size="28" fill="${C.sky}">${t}</text>`;
    c.reg(S.l, y, 260, 34, 'topic');
  });
  o += wmTop(c, '#fff');
  const fit = fitHL(d.headline, c.pick({ portrait: 900, square: 860, story: 900 }), { max: c.pick({ portrait: 116, square: 88, story: 124 }), maxLines: 3 });
  const hy = S.b - fit.h;
  o += kicker(c, S.l, hy - 58, d.kicker, { color: C.sky });
  o += drawHL(c, fit, S.l, hy, { color: '#fff' });
  return o;
}

// questions-03: route markers leading toward a pool illustration
function questions03(c, d) {
  const { W, H, S } = c;
  let o = rect(0, 0, W, H, { fill: C.ws }) + rect(0, 0, W, H, { fill: gridPat(c, { gap: 60 }) });
  const r = c.rand;
  for (let i = 0; i < 5; i++) o += ellipse(r() * W, r() * H, 160 + r() * 160, 90 + r() * 100, { fill: '#DCEEFA', fillOpacity: 0.7, transform: `rotate(${f(r() * 60 - 30)} ${f(W / 2)} ${f(H / 2)})` });
  const L = c.pick({
    portrait: { pool: [560, 300, 420, 290], route: [[150, 960], [330, 830], [240, 660], [450, 560], [600, 650]], ty: 1010 },
    square: { pool: [640, 220, 320, 220], route: [[140, 650], [300, 570], [230, 430], [430, 350], [610, 470]], ty: 760 },
    story: { pool: [250, 1200, 580, 360], route: [[160, 860], [420, 810], [800, 920], [600, 1070], [470, 1170]], ty: 370 },
  });
  const [qx, qy, qw, qh] = L.pool;
  const pts = L.route;
  let d0 = P`M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    d0 += P`C${x0 + (x1 - x0) * 0.1} ${y0 + (y1 - y0) * 0.6 - 40} ${x1 - (x1 - x0) * 0.1} ${y1 - (y1 - y0) * 0.6 + 40} ${x1} ${y1}`;
  }
  o += path(d0, { fill: 'none', stroke: '#fff', strokeWidth: 22, strokeLinecap: 'round' });
  o += path(d0, { fill: 'none', stroke: C.navy2, strokeWidth: 8, strokeDasharray: '2 20', strokeLinecap: 'round' });
  o += poolTop(c, qx, qy, qw, qh, { lanes: 4, rx: 18, coping: 18, ropeW: 9, cell: 60 });
  const sh = shadow(c, 'sh', 8, 8, 0.28);
  o += circle(pts[0][0], pts[0][1], 26, { fill: C.sky, fillOpacity: 0.35 }) + circle(pts[0][0], pts[0][1], 13, { fill: C.navy2, stroke: '#fff', strokeWidth: 5 });
  [1, 2, 3].forEach((i) => (o += pin(pts[i][0], pts[i][1], 1.25, i, { col: i === 3 ? C.navy : C.navy2, filter: sh })));
  // destination flag at the pool
  const fx = pts[4][0], fy = pts[4][1];
  o += path(P`M${fx} ${fy}V${fy - 120}`, { stroke: C.navy, strokeWidth: 8, strokeLinecap: 'round' });
  o += path(P`M${fx + 4} ${fy - 120}h86l-20 30l20 30h-86z`, { fill: C.red, filter: sh });
  o += wmTop(c);
  o += kicker(c, S.l, L.ty, d.kicker);
  const fit = fitHL(d.headline, c.pick({ portrait: 900, square: 900, story: 880 }), { max: c.pick({ portrait: 120, square: 100, story: 128 }), maxLines: 2, maxH: (c.name === 'story' ? 760 : S.b) - L.ty - 58 });
  o += drawHL(c, fit, S.l, L.ty + 58);
  return o;
}

// ---------------------------------------------------------------------------------------------------------
// Catalogue + output
// ---------------------------------------------------------------------------------------------------------
export const DESIGNS = [
  { id: 'pool-01', kicker: 'Training awareness', headline: 'Make your next step count', render: pool01 },
  { id: 'pool-02', kicker: 'Training awareness', headline: 'Build confidence through training', render: pool02 },
  { id: 'pool-03', kicker: 'Training awareness', headline: 'Explore your training options', render: pool03 },
  { id: 'gear-01', kicker: 'Preparedness', headline: 'Preparation starts before poolside', render: gear01 },
  { id: 'gear-02', kicker: 'Preparedness', headline: 'Ready to learn. Ready to prepare.', render: gear02 },
  { id: 'gear-03', kicker: 'Preparedness', headline: 'Take time to prepare', render: gear03 },
  { id: 'team-01', kicker: 'Team development', headline: 'Strong teams keep learning', render: team01 },
  { id: 'team-02', kicker: 'Team development', headline: 'Make room for team development', render: team02 },
  { id: 'team-03', kicker: 'Team development', headline: 'Learn together. Prepare together.', render: team03 },
  { id: 'questions-01', kicker: 'Course questions', headline: 'Your next step starts with a question', render: questions01 },
  { id: 'questions-02', kicker: 'Course questions', headline: 'What would you like to know?', render: questions02 },
  { id: 'questions-03', kicker: 'Course questions', headline: 'Find the right next step', render: questions03 },
];

function renderSvg(design, fmt) {
  const c = makeCtx(design.id, fmt);
  const body = design.render(c, design);
  const problems = c.texts
    .filter((t) => t.x < fmt.safe.l - 1 || t.y < fmt.safe.t - 1 || t.x + t.w > fmt.safe.r + 1 || t.y + t.h > fmt.safe.b + 1)
    .map((t) => `${t.what} @(${f(t.x)},${f(t.y)} ${f(t.w)}x${f(t.h)})`);
  const title = `${design.headline} - Lifeguard-Pro.org illustration`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt.W} ${fmt.H}" width="${fmt.W}" height="${fmt.H}" role="img" aria-label="${esc(title)}">` +
    `<title>${esc(title)}</title><defs>${c.defsMarkup()}</defs>${body}</svg>\n`;
  return { svg, problems };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  let total = 0, warn = 0;
  for (const d of DESIGNS)
    for (const fmt of Object.values(FORMATS)) {
      const { svg, problems } = renderSvg(d, fmt);
      const file = join(OUT, `${d.id}-${fmt.name}.svg`);
      writeFileSync(file, svg);
      total++;
      const kb = (Buffer.byteLength(svg) / 1024).toFixed(1);
      const flag = problems.length ? `  SAFE-AREA: ${problems.join('; ')}` : '';
      if (problems.length || Buffer.byteLength(svg) > 40 * 1024) warn++;
      console.log(`${d.id}-${fmt.name}.svg  ${kb} KB${flag}`);
    }
  console.log(`\nWrote ${total} SVGs to ${OUT}${warn ? ` (${warn} with warnings)` : ''}`);
  if (warn) process.exitCode = 1;
}

main();

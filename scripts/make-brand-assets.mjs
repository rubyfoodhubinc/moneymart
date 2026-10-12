#!/usr/bin/env node
/**
 * MoneyMart — brand asset generator.
 *
 * Produces every raster asset the three clients need (iOS icon, Android adaptive
 * icon + monochrome layer, Expo splash, web favicons and PWA icons) from a single
 * vector description of the mark.
 *
 * The artwork is CODE, not committed binaries: it is reproducible, reviewable in
 * a diff, and re-renders at any size if the brand palette in @moneymart/tokens
 * changes. Everything is drawn with a small software rasteriser — shapes are
 * sampled on a 4x supersampled grid and box-filtered down, which supplies both
 * anti-aliasing and correct colour blending at the edges. PNG is encoded with
 * zlib from Node's standard library, so there is no image dependency to install.
 *
 * Usage: node scripts/make-brand-assets.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── Brand palette (mirrors packages/tokens/src/index.ts) ──────────────── */
const NAVY = [0x0d, 0x1b, 0x2a];
const NAVY_DEEP = [0x07, 0x0f, 0x18];
const GOLD = [0xf5, 0xa6, 0x23];
const GOLD_LIGHT = [0xff, 0xd8, 0x8a];
const GOLD_DARK = [0xd9, 0x8a, 0x0f];
const GREEN = [0x00, 0xd4, 0xa1];
const WHITE = [0xff, 0xff, 0xff];

/* ── PNG encoding ──────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Encode straight (non-premultiplied) RGBA bytes as a PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy
      ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Tiny geometry helpers on the supersampled grid ────────────────────── */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Distance from point to a line segment, in output pixels. */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp01(((px - x1) * dx + (py - y1) * dy) / lengthSquared);
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/*
 * The mark, described on a 1024x1024 design canvas so every output size is the
 * same artwork at a different resolution. The "MM" ligature sits inside the
 * upper band; the market line and its rising indicator occupy the lower band,
 * which is also inside the Android adaptive-icon safe zone.
 */
const DESIGN = 1024;

/** Rounded square used for the app icon (iOS applies the final mask itself). */
const ICON_RADIUS = 224;

/**
 * The MM ligature: two rounded lowercase arches whose left stems align with the
 * "m" of the MoneyMart wordmark.
 *
 * Each arch is two vertical stems plus a semicircular shoulder. Both arches share
 * the same radius and stroke weight so the pair reads as one drawn mark rather
 * than two glyphs placed side by side. Coordinates are on the 1024 design canvas.
 */
const STROKE = 84;
const STEM = STROKE / 2; // 42 — distance from the centreline to the outer edge

const ARCH = {
  radius: 140, // shoulder radius; equals the arch half-width
  top: 300, // y of the stem tops where they meet the shoulder
  baseline: 660, // y where the stems terminate
};

/** First arch — the "m". */
const ARCH_LEFT = { left: 176, right: 476 };
/** Second arch — the second "m", offset so both share the same rhythm. */
const ARCH_RIGHT = { left: 548, right: 848 };

/**
 * Strokes for one arch. The shoulder is sampled as an arc so it can share the
 * same distance-to-stroke rasteriser as the straight sections.
 */
function archStrokes(arch) {
  const { left, right } = arch;
  const centreX = (left + right) / 2;
  const shoulderY = ARCH.top;
  const strokes = [
    // left stem
    [left, shoulderY, left, ARCH.baseline],
    // right stem
    [right, shoulderY, right, ARCH.baseline],
  ];
  // Shoulder: a semicircle from the left stem, over the top, down to the right.
  const steps = 28;
  for (let i = 0; i < steps; i += 1) {
    const a0 = Math.PI * (i / steps);
    const a1 = Math.PI * ((i + 1) / steps);
    strokes.push([
      centreX - ARCH.radius * Math.cos(a0),
      shoulderY - ARCH.radius * Math.sin(a0),
      centreX - ARCH.radius * Math.cos(a1),
      shoulderY - ARCH.radius * Math.sin(a1),
    ]);
  }
  return strokes;
}

const MM = [...archStrokes(ARCH_LEFT), ...archStrokes(ARCH_RIGHT)];

/** Market line beneath the ligature — the auction price climb. */
const CHART = [
  [148, 800, 300, 800],
  [300, 800, 396, 722],
  [396, 722, 516, 856],
  [516, 856, 616, 808],
  [616, 808, 720, 760],
  [720, 760, 876, 760],
];

/** Terminal node — the "price closed here" indicator. */
const CHART_NODE = { x: 876, y: 760, r: 26 };

function renderIcon(size, options = {}) {
  const { background = 'card', padding = 0, monochrome = false } = options;
  const SS = 4; // supersampling factor
  const big = size * SS;
  const scale = (big - padding * 2 * SS) / DESIGN;
  const offset = padding * SS;

  // Accumulate onto the supersampled grid in premultiplied form.
  const acc = new Float32Array(big * big * 4);
  const radius = (ICON_RADIUS / DESIGN) * (DESIGN * scale);
  const cornerRadius = background === 'card' ? radius : 0;

  const toOutput = (x) => offset + x * scale;

  for (let sy = 0; sy < big; sy += 1) {
    for (let sx = 0; sx < big; sx += 1) {
      // Convert this supersample to design-canvas coordinates.
      const dx = (sx - offset) / scale;
      const dy = (sy - offset) / scale;

      let colour = [0, 0, 0];
      let alpha = 0;

      /* Background: rounded card, vertical navy gradient. */
      if (background === 'card') {
        const inset = 0;
        const r = ICON_RADIUS;
        const cx = Math.min(Math.max(dx, inset + r), DESIGN - inset - r);
        const cy = Math.min(Math.max(dy, inset + r), DESIGN - inset - r);
        const inRounded =
          dx >= inset && dx <= DESIGN - inset && dy >= inset && dy <= DESIGN - inset &&
          Math.hypot(dx - cx, dy - cy) <= r + 0.5;

        if (inRounded || cornerRadius === 0) {
          if (inRounded) {
            const t = clamp01(dy / DESIGN);
            colour = mix(NAVY, NAVY_DEEP, t * 0.85);
            alpha = 1;
          }
        }

        /* Subtle gold glow in the upper-left, like the product surfaces. */
        if (inRounded) {
          const glow = clamp01(1 - Math.hypot(dx - DESIGN * 0.28, dy - DESIGN * 0.18) / (DESIGN * 0.86));
          colour = mix(colour, GOLD, glow * glow * 0.1);
        }
      }

      if (monochrome) {
        // Monochrome layer: geometry only, on transparency, coloured white.
        colour = WHITE;
        alpha = 0;
      }

      /* MM ligature. */
      const strokeHalf = STROKE / 2;
      let markCoverage = 0;
      for (const [x1, y1, x2, y2] of MM) {
        const distance = distanceToSegment(dx, dy, x1, y1, x2, y2);
        if (distance <= strokeHalf) markCoverage = Math.max(markCoverage, 1);
      }

      if (markCoverage > 0) {
        const t = clamp01((dx + dy) / (DESIGN * 1.7));
        const goldColour = monochrome ? WHITE : mix(mix(GOLD_LIGHT, GOLD, clamp01(t * 1.6)), GOLD_DARK, clamp01((t - 0.55) / 0.45));
        colour = mix(colour, goldColour, markCoverage);
        alpha = Math.max(alpha, markCoverage);
      }

      /* Market line. */
      let chartCoverage = 0;
      for (const [x1, y1, x2, y2] of CHART) {
        const distance = distanceToSegment(dx, dy, x1, y1, x2, y2);
        if (distance <= 26) chartCoverage = Math.max(chartCoverage, 1);
      }
      const nodeDistance = Math.hypot(dx - CHART_NODE.x, dy - CHART_NODE.y);
      if (nodeDistance <= CHART_NODE.r) chartCoverage = Math.max(chartCoverage, 1);

      if (chartCoverage > 0) {
        colour = mix(colour, monochrome ? WHITE : GREEN, chartCoverage);
        alpha = Math.max(alpha, chartCoverage);
      }

      const index = (sy * big + sx) * 4;
      acc[index] = colour[0] * alpha;
      acc[index + 1] = colour[1] * alpha;
      acc[index + 2] = colour[2] * alpha;
      acc[index + 3] = alpha;
    }
  }

  /* Box-filter the supersampled grid down to the target resolution. */
  const out = Buffer.alloc(size * size * 4);
  const samples = SS * SS;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const index = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          r += acc[index];
          g += acc[index + 1];
          b += acc[index + 2];
          a += acc[index + 3];
        }
      }
      r /= samples;
      g /= samples;
      b /= samples;
      a /= samples;

      const index = (y * size + x) * 4;
      if (a > 0.0001) {
        out[index] = Math.round(Math.min(255, r / a));
        out[index + 1] = Math.round(Math.min(255, g / a));
        out[index + 2] = Math.round(Math.min(255, b / a));
      }
      out[index + 3] = Math.round(Math.min(255, a * 255));
    }
  }

  return encodePng(size, size, out);
}

/**
 * Splash artwork: a solid navy field with the mark centred at 30% of the width,
 * sized for the tallest common device aspect and scaled with `resizeMode:
 * contain`, so it composes correctly on every screen.
 */
function renderSplash() {
  const width = 1284;
  const height = 2778;
  const markSize = 420;
  const SS = 2;
  const bigW = width * SS;
  const bigH = height * SS;

  const acc = new Float32Array(bigW * bigH * 4);
  const scale = (markSize * SS) / DESIGN;
  const originX = (bigW - markSize * SS) / 2;
  const originY = (bigH - markSize * SS) / 2;
  const r = ICON_RADIUS;

  for (let sy = 0; sy < bigH; sy += 1) {
    for (let sx = 0; sx < bigW; sx += 1) {
      const t = clamp01(sy / bigH);
      let colour = mix(NAVY, NAVY_DEEP, t);

      const dx = (sx - originX) / scale;
      const dy = (sy - originY) / scale;

      if (dx >= 0 && dx <= DESIGN && dy >= 0 && dy <= DESIGN) {
        const cx = Math.min(Math.max(dx, r), DESIGN - r);
        const cy = Math.min(Math.max(dy, r), DESIGN - r);
        if (Math.hypot(dx - cx, dy - cy) <= r) {
          colour = mix(colour, mix(NAVY, NAVY_DEEP, 0.5), 1);
          for (const [x1, y1, x2, y2] of MM) {
            if (distanceToSegment(dx, dy, x1, y1, x2, y2) <= STROKE / 2) {
              const g = clamp01((dx + dy) / (DESIGN * 1.7));
              colour = mix(mix(GOLD_LIGHT, GOLD, 1), GOLD_DARK, clamp01((g - 0.55) / 0.45));
              break;
            }
          }
          let onChart = false;
          for (const [x1, y1, x2, y2] of CHART) {
            if (distanceToSegment(dx, dy, x1, y1, x2, y2) <= 26) onChart = true;
          }
          if (Math.hypot(dx - CHART_NODE.x, dy - CHART_NODE.y) <= CHART_NODE.r) onChart = true;
          if (onChart) colour = GREEN;
        }
      }

      const index = (sy * bigW + sx) * 4;
      acc[index] = colour[0];
      acc[index + 1] = colour[1];
      acc[index + 2] = colour[2];
      acc[index + 3] = 255;
    }
  }

  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const index = ((y * SS + sy) * bigW + (x * SS + sx)) * 4;
          r += acc[index];
          g += acc[index + 1];
          b += acc[index + 2];
        }
      }
      const index = (y * width + x) * 4;
      out[index] = Math.round(r / (SS * SS));
      out[index + 1] = Math.round(g / (SS * SS));
      out[index + 2] = Math.round(b / (SS * SS));
      out[index + 3] = 255;
    }
  }

  return encodePng(width, height, out);
}

/* ── Emit ──────────────────────────────────────────────────────────────── */

const outputs = [];

function write(relativePath, buffer) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  outputs.push(`${relativePath}  (${Math.round(buffer.length / 1024)} KB)`);
}

console.log('\n  MoneyMart — generating brand assets\n');

// App icon: full-bleed rounded card. iOS applies its own superellipse mask.
write('apps/mobile/assets/icon.png', renderIcon(1024, { background: 'card' }));

// Android adaptive foreground: mark only, inset to survive the 66% safe zone.
write('apps/mobile/assets/adaptive-icon.png', renderIcon(1024, { background: 'transparent', padding: 210 }));

// Android monochrome layer for themed icons (Android 13+).
write('apps/mobile/assets/monochrome-icon.png', renderIcon(1024, { background: 'transparent', padding: 210, monochrome: true }));

// Expo splash.
write('apps/mobile/assets/splash.png', renderSplash());

// Web assets, so the browser tab and home-screen install match the app.
write('apps/web/public/icon-192.png', renderIcon(192, { background: 'card' }));
write('apps/web/public/icon-512.png', renderIcon(512, { background: 'card' }));
write('apps/web/public/apple-touch-icon.png', renderIcon(180, { background: 'card' }));

// TV launcher icon for Samsung Tizen / LG webOS store submissions.
write('apps/tv/public/icon-512.png', renderIcon(512, { background: 'card' }));

console.log(outputs.map((line) => `  ✔ ${line}`).join('\n'));
console.log(`\n  ${outputs.length} assets generated.\n`);

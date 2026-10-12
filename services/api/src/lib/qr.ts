/**
 * MoneyMart TV — QR encoder (ISO/IEC 18004, byte mode, level M).
 *
 * Self-contained so the TV surface renders a scannable code with no network
 * round-trip and no client dependency. Supports versions 1–10.
 *
 * Correctness is verified against an independent decoder (jsQR) by
 * scripts/verify-tv.mjs — every payload the TV can produce is round-tripped.
 */

/* ── GF(256) arithmetic ────────────────────────────────────────────────── */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

let seed = 1;
for (let i = 0; i < 255; i += 1) {
  EXP[i] = seed;
  LOG[seed] = i;
  seed <<= 1;
  if (seed & 0x100) seed ^= 0x11d;
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/**
 * Reed–Solomon generator polynomial of the given degree.
 *
 * Each step multiplies the running polynomial by (x − α^i) over GF(256). In
 * characteristic 2 the sign is a no-op, so the constant term picks up the α^i
 * factor while the x term carries the existing coefficient unchanged. Swapping
 * those two produces a polynomial with its coefficients reversed — a mistake
 * that still yields plausible-looking bytes, so it is asserted against a known
 * vector in scripts/verify-tv.mjs.
 */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]!;
      next[j + 1] ^= gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], degree: number): number[] {
  const generator = rsGenerator(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < degree; i += 1) {
      remainder[i] ^= gfMul(generator[i + 1]!, factor);
    }
  }
  return remainder;
}

/* ── Version specification (level M only) ──────────────────────────────── */

interface VersionSpec {
  /** Total codewords in the symbol. */
  total: number;
  /** EC codewords per block. */
  ec: number;
  /** Block sizes: [count, dataCodewords] groups. */
  groups: [number, number][];
  /** Alignment pattern centres. */
  align: number[];
}

const SPECS: Record<number, VersionSpec> = {
  1: { total: 26, ec: 10, groups: [[1, 16]], align: [] },
  2: { total: 44, ec: 16, groups: [[1, 28]], align: [6, 18] },
  3: { total: 70, ec: 26, groups: [[1, 44]], align: [6, 22] },
  4: { total: 100, ec: 18, groups: [[2, 32]], align: [6, 26] },
  5: { total: 134, ec: 24, groups: [[2, 43]], align: [6, 30] },
  6: { total: 172, ec: 16, groups: [[4, 27]], align: [6, 34] },
  7: { total: 196, ec: 18, groups: [[4, 31]], align: [6, 22, 38] },
  8: { total: 242, ec: 22, groups: [[2, 38], [2, 39]], align: [6, 24, 42] },
  9: { total: 292, ec: 22, groups: [[3, 36], [2, 37]], align: [6, 26, 46] },
  10: { total: 346, ec: 26, groups: [[4, 43], [1, 44]], align: [6, 28, 50] },
};

function dataCodewords(spec: VersionSpec): number {
  return spec.groups.reduce((sum, [count, size]) => sum + count * size, 0);
}

function capacityBytes(version: number): number {
  const spec = SPECS[version]!;
  const headerBits = 4 + (version <= 9 ? 8 : 16);
  return Math.floor((dataCodewords(spec) * 8 - headerBits) / 8);
}

function sideLength(version: number): number {
  return version * 4 + 17;
}

/* ── Bit buffer ────────────────────────────────────────────────────────── */

function toBitArray(bytes: Uint8Array | number[], version: number): number[] {
  const spec = SPECS[version]!;
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };

  put(0b0100, 4); // byte mode
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) put(byte, 8);

  const capacity = dataCodewords(spec) * 8;
  put(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | (bits[i + bit] ?? 0);
    codewords.push(value);
  }

  const padding = [0xec, 0x11];
  let index = 0;
  const target = dataCodewords(spec);
  while (codewords.length < target) {
    codewords.push(padding[index % 2]!);
    index += 1;
  }
  return codewords;
}

/* ── Block interleaving ────────────────────────────────────────────────── */

function interleave(codewords: number[], spec: VersionSpec): number[] {
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;

  for (const [count, size] of spec.groups) {
    for (let i = 0; i < count; i += 1) {
      const data = codewords.slice(offset, offset + size);
      offset += size;
      blocks.push({ data, ec: rsRemainder(data, spec.ec) });
    }
  }

  const result: number[] = [];
  const maxData = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.data.length) result.push(block.data[i]!);
  }
  for (let i = 0; i < spec.ec; i += 1) {
    for (const block of blocks) result.push(block.ec[i]!);
  }
  return result;
}

/* ── Matrix construction ───────────────────────────────────────────────── */

type Cell = boolean | null;
type Grid = Cell[][];

function emptyGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Array<Cell>(size).fill(null));
}

/** Finder pattern + light separator. Separators are always light. */
function drawFinder(grid: Grid, row: number, col: number): void {
  const size = grid.length;
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const y = row + dy;
      const x = col + dx;
      if (y < 0 || x < 0 || y >= size || x >= size) continue;

      const separator = dy === -1 || dx === -1 || dy === 7 || dx === 7;
      const border = dy === 0 || dy === 6 || dx === 0 || dx === 6;
      const core = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;

      grid[y]![x] = !separator && (border || core);
    }
  }
}

/** Alignment patterns, skipping the three that would collide with finders. */
function drawAlignment(grid: Grid, centres: number[]): void {
  const size = grid.length;
  for (const cy of centres) {
    for (const cx of centres) {
      const nearFinder =
        (cy <= 8 && cx <= 8) ||
        (cy <= 8 && cx >= size - 9) ||
        (cy >= size - 9 && cx <= 8);
      if (nearFinder) continue;

      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const border = Math.abs(dy) === 2 || Math.abs(dx) === 2;
          const centre = dy === 0 && dx === 0;
          grid[cy + dy]![cx + dx] = border || centre;
        }
      }
    }
  }
}

function drawTiming(grid: Grid): void {
  const size = grid.length;
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    if (grid[6]![i] === null) grid[6]![i] = dark;
    if (grid[i]![6] === null) grid[i]![6] = dark;
  }
}

/** Reserve the format-information modules and the dark module. */
function reserveFormat(grid: Grid): void {
  const size = grid.length;
  for (let i = 0; i <= 8; i += 1) {
    if (grid[8]![i] === null) grid[8]![i] = false;
    if (grid[i]![8] === null) grid[i]![8] = false;
  }
  for (let i = size - 8; i < size; i += 1) {
    if (grid[8]![i] === null) grid[8]![i] = false;
    if (grid[i]![8] === null) grid[i]![8] = false;
  }
  grid[size - 8]![8] = true;
}

/** Reserve version-information blocks for versions ≥ 7. */
function reserveVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  const size = grid.length;
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      if (grid[size - 11 + j]![i] === null) grid[size - 11 + j]![i] = false;
      if (grid[i]![size - 11 + j] === null) grid[i]![size - 11 + j] = false;
    }
  }
}

/** Two-module-wide zig-zag from the bottom-right, skipping the timing column. */
function drawData(grid: Grid, codewords: number[]): void {
  const size = grid.length;
  const bits: number[] = [];
  for (const codeword of codewords) {
    for (let bit = 7; bit >= 0; bit -= 1) bits.push((codeword >>> bit) & 1);
  }

  let index = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
        const col = right - columnOffset;
        if (grid[row]![col] !== null) continue;
        grid[row]![col] = index < bits.length ? bits[index] === 1 : false;
        index += 1;
      }
    }
    upward = !upward;
  }
}

/* ── Masking and format information ────────────────────────────────────── */

function maskCondition(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/** Format bits: 2-bit EC level (M = 00) + 3-bit mask, BCH(15,5), XOR 0x5412. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let remainder = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((remainder >>> i) & 1) remainder ^= 0b10100110111 << (i - 10);
  }
  return (((data << 10) | remainder) ^ 0b101010000010010) & 0x7fff;
}

/**
 * Write the 15 format-information bits (ISO/IEC 18004 §8.9).
 *
 * Two copies are placed, and the bit order differs between them: copy 1 runs
 * MSB→LSB down column 8 then across row 8 from the right, while copy 2 runs
 * LSB→MSB along row 8 then up column 8. Getting this mapping wrong produces a
 * symbol that looks well-formed but makes decoders read the wrong mask, so the
 * positions are listed explicitly rather than derived.
 */
function drawFormat(grid: Grid, mask: number): void {
  const size = grid.length;
  const bits = formatBits(mask);
  const bit = (index: number) => ((bits >>> index) & 1) === 1;

  // Copy 1 — bit 14 down to bit 0.
  const copy1: [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  copy1.forEach(([row, col], index) => {
    grid[row]![col] = bit(14 - index);
  });

  // Copy 2 — bit 0 up to bit 14.
  const copy2: [number, number][] = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  copy2.forEach(([row, col], index) => {
    grid[row]![col] = bit(index);
  });

  // The dark module is always set.
  grid[size - 8]![8] = true;
}

/** Version bits: 6-bit version + BCH(18,6), for versions ≥ 7. */
function drawVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  const size = grid.length;

  let remainder = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((remainder >>> i) & 1) remainder ^= 0b1111100100101 << (i - 12);
  }
  const bits = (version << 12) | remainder;

  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >>> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = i % 3;
    grid[size - 11 + col]![row] = dark;
    grid[row]![size - 11 + col] = dark;
  }
}

/* ── Mask selection ────────────────────────────────────────────────────── */

function penalty(grid: Grid): number {
  const size = grid.length;
  const at = (r: number, c: number) => Boolean(grid[r]![c]);
  let score = 0;

  // Rule 1 — runs of five or more.
  for (let i = 0; i < size; i += 1) {
    let runRow = 1;
    let runCol = 1;
    for (let j = 1; j < size; j += 1) {
      if (at(i, j) === at(i, j - 1)) {
        runRow += 1;
        if (runRow === 5) score += 3;
        else if (runRow > 5) score += 1;
      } else runRow = 1;

      if (at(j, i) === at(j - 1, i)) {
        runCol += 1;
        if (runCol === 5) score += 3;
        else if (runCol > 5) score += 1;
      } else runCol = 1;
    }
  }

  // Rule 2 — 2x2 blocks of one colour.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = at(row, col);
      if (value === at(row, col + 1) && value === at(row + 1, col) && value === at(row + 1, col + 1)) score += 3;
    }
  }

  // Rule 3 — finder-like 1:1:3:1:1 patterns with four light modules on one side.
  const pattern = [true, false, true, true, true, false, true];
  const matches = (get: (index: number) => boolean, start: number) => {
    for (let k = 0; k < 7; k += 1) if (get(start + k) !== pattern[k]) return false;
    const before = [start - 4, start - 3, start - 2, start - 1];
    const after = [start + 7, start + 8, start + 9, start + 10];
    const clearBefore = before.every((index) => index < 0 || !get(index));
    const clearAfter = after.every((index) => index >= size || !get(index));
    return clearBefore || clearAfter;
  };
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= size - 7; j += 1) {
      if (matches((index) => at(i, index), j)) score += 40;
      if (matches((index) => at(index, i), j)) score += 40;
    }
  }

  // Rule 4 — deviation from a 50% dark ratio.
  let dark = 0;
  for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) if (at(row, col)) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* ── Public API ────────────────────────────────────────────────────────── */

export interface QrResult {
  version: number;
  size: number;
  matrix: boolean[][];
  mask: number;
}

export function encodeQr(text: string): QrResult {
  const bytes = new TextEncoder().encode(text);

  let version = 0;
  for (let candidate = 1; candidate <= 10; candidate += 1) {
    if (bytes.length <= capacityBytes(candidate)) {
      version = candidate;
      break;
    }
  }
  if (!version) throw new Error(`qr_capacity_exceeded:${bytes.length} bytes`);

  const spec = SPECS[version]!;
  const size = sideLength(version);
  const codewords = interleave(toBitArray(bytes, version), spec);

  /* Build the base symbol (function patterns only, data left null). */
  const base = emptyGrid(size);
  drawFinder(base, 0, 0);
  drawFinder(base, 0, size - 7);
  drawFinder(base, size - 7, 0);
  drawAlignment(base, spec.align);
  drawTiming(base);
  reserveFormat(base);
  reserveVersion(base, version);
  drawData(base, codewords);

  /* Remember which modules are structural so masking never touches them. */
  const structural = base.map((row) => row.map((cell) => cell !== null));
  // drawData fills every remaining null, so recompute structural from geometry.
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      structural[row]![col] = isStructural(size, spec.align, version, row, col);
    }
  }

  /* Try all eight masks and keep the lowest-penalty result. */
  let best: { matrix: Grid; mask: number; score: number } | null = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate: Grid = base.map((row) => row.slice());
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (structural[row]![col]) continue;
        if (maskCondition(mask, row, col)) candidate[row]![col] = !candidate[row]![col];
      }
    }
    drawFormat(candidate, mask);
    drawVersion(candidate, version);
    const score = penalty(candidate);
    if (!best || score < best.score) best = { matrix: candidate, mask, score };
  }

  return {
    version,
    size,
    mask: best!.mask,
    matrix: best!.matrix.map((row) => row.map((cell) => Boolean(cell))),
  };
}

/** Is this module part of a function pattern (finders, timing, alignment, format)? */
function isStructural(size: number, align: number[], version: number, row: number, col: number): boolean {
  // Finder patterns and their separators: 9x9 blocks in three corners.
  if (row <= 8 && col <= 8) return true;
  if (row <= 8 && col >= size - 8) return true;
  if (row >= size - 8 && col <= 8) return true;

  // Timing patterns.
  if (row === 6 || col === 6) return true;

  // Alignment patterns.
  for (const cy of align) {
    for (const cx of align) {
      const nearFinder =
        (cy <= 8 && cx <= 8) || (cy <= 8 && cx >= size - 9) || (cy >= size - 9 && cx <= 8);
      if (nearFinder) continue;
      if (Math.abs(row - cy) <= 2 && Math.abs(col - cx) <= 2) return true;
    }
  }

  // Version information blocks.
  if (version >= 7) {
    if (row < 6 && col >= size - 11 && col <= size - 9) return true;
    if (col < 6 && row >= size - 11 && row <= size - 9) return true;
  }

  return false;
}

/** Render a payload as a scannable SVG data URI. */
export function qrToSvgDataUri(text: string, options: { scale?: number; margin?: number; dark?: string } = {}): string {
  const { scale = 8, margin = 4, dark = '#0D1B2A' } = options;
  const { matrix, size } = encodeQr(text);
  const dimension = (size + margin * 2) * scale;

  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!matrix[row]![col]) continue;
      path += `M${(col + margin) * scale} ${(row + margin) * scale}h${scale}v${scale}h-${scale}z`;
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges">` +
    `<rect width="${dimension}" height="${dimension}" fill="#FFFFFF"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export const qr = { encodeQr, qrToSvgDataUri };
export default qr;

/**
 * Pure, zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, ECC Level L,
 * Versions 1..=10) ported directly from `core/src/sync/qr.rs`.
 *
 * Used at build time by `/download/` to emit a crisp, deterministic, scannable
 * inline SVG QR code pointing directly to the tagged Android APK release URL.
 */

const ECC_CODEWORDS_PER_BLOCK_L = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
const NUM_ECC_BLOCKS_L = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];

function numRawDataModules(version: number): number {
  const size = version * 4 + 17;
  let result = size * size;
  result -= 8 * 8 * 3; // 3 finder patterns + separators
  result -= 15 * 2 + 1; // format info + dark module
  result -= (size - 16) * 2; // timing patterns
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (numAlign * numAlign - 3) * 25;
    result += (numAlign - 2) * 5 * 2;
    if (version >= 7) {
      result -= 6 * 3 * 2;
    }
  }
  return result;
}

function dataCodewordCapacity(version: number): number {
  const totalCodewords = Math.floor(numRawDataModules(version) / 8);
  const ecTotal = ECC_CODEWORDS_PER_BLOCK_L[version] * NUM_ECC_BLOCKS_L[version];
  return totalCodewords - ecTotal;
}

function byteCapacity(version: number): number {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewordCapacity(version) * 8 - (4 + countBits)) / 8);
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const denom = numAlign * 2 - 2;
  const step = Math.ceil((size - 13) / denom) * 2;
  const result = new Array<number>(numAlign).fill(0);
  result[0] = 6;
  let pos = size - 7;
  for (let i = numAlign - 1; i >= 1; i--) {
    result[i] = pos;
    pos -= step;
  }
  return result;
}

function rsMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >> 7) * 0x11d);
    z ^= ((y >> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const degree = divisor.length;
  const result = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < degree; i++) {
      result[i] ^= rsMultiply(divisor[i], factor);
    }
  }
  return result;
}

function encodeDataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacityCodewords = dataCodewordCapacity(version);
  const capacityBits = capacityCodewords * 8;
  const bits: number[] = [];

  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const termLen = Math.min(4, capacityBits - bits.length);
  pushBits(0, termLen);
  pushBits(0, (8 - (bits.length % 8)) % 8);

  let pad = 0xec;
  while (bits.length < capacityBits) {
    pushBits(pad, 8);
    pad ^= 0xec ^ 0x11;
  }

  const data = new Array<number>(capacityCodewords).fill(0);
  for (let i = 0; i < bits.length; i++) {
    data[i >> 3] |= bits[i] << (7 - (i & 7));
  }
  return data;
}

function addEccAndInterleave(data: number[], version: number): number[] {
  const numBlocks = NUM_ECC_BLOCKS_L[version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK_L[version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const div = rsDivisor(blockEccLen);
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i >= numShortBlocks ? 1 : 0);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    blocks.push([...dat, ...rsRemainder(dat, div)]);
  }

  const out: number[] = [];
  const maxDataLen = shortBlockLen - blockEccLen + 1;
  for (let i = 0; i < maxDataLen; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i === shortBlockLen - blockEccLen && j < numShortBlocks) continue;
      out.push(blocks[j][i]);
    }
  }
  for (let i = 0; i < blockEccLen; i++) {
    for (let j = 0; j < blocks.length; j++) {
      const offset = (j < numShortBlocks ? shortBlockLen - blockEccLen : maxDataLen) + i;
      out.push(blocks[j][offset]);
    }
  }
  return out;
}

function getBit(x: number, i: number): boolean {
  return ((x >> i) & 1) !== 0;
}

function drawFunctionPatterns(
  version: number,
  size: number,
  modules: boolean[],
  isFunc: boolean[],
) {
  const setFn = (x: number, y: number, dark: boolean) => {
    const idx = y * size + x;
    modules[idx] = dark;
    isFunc[idx] = true;
  };

  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  const align = alignmentPositions(version);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === align.length - 1) ||
        (i === align.length - 1 && j === 0)
      ) {
        continue;
      }
      const cx = align[i];
      const cy = align[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFn(8, i, false);
      setFn(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFn(size - 1 - i, 8, false);
    setFn(8, size - 1 - i, false);
  }
  setFn(8, size - 8, true);

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }
}

function drawFormatBits(mask: number, size: number, modules: boolean[], isFunc: boolean[]) {
  const setFn = (x: number, y: number, dark: boolean) => {
    const idx = y * size + x;
    modules[idx] = dark;
    isFunc[idx] = true;
  };
  const data = (0b01 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) setFn(8, i, getBit(bits, i));
  setFn(8, 7, getBit(bits, 6));
  setFn(8, 8, getBit(bits, 7));
  setFn(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(bits, i));

  for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(bits, i));
  setFn(8, size - 8, true);
}

function drawCodewords(codewords: number[], size: number, modules: boolean[], isFunc: boolean[]) {
  let i = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const idx = y * size + x;
        if (!isFunc[idx] && i < totalBits) {
          modules[idx] = getBit(codewords[i >> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function applyMask(mask: number, size: number, modules: boolean[], isFunc: boolean[]) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (isFunc[idx]) continue;
      let inv = false;
      if (mask === 0) inv = (x + y) % 2 === 0;
      else if (mask === 1) inv = y % 2 === 0;
      else if (mask === 2) inv = x % 3 === 0;
      else if (mask === 3) inv = (x + y) % 3 === 0;
      else if (mask === 4) inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      else if (mask === 5) inv = ((x * y) % 2) + ((x * y) % 3) === 0;
      else if (mask === 6) inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      else if (mask === 7) inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      if (inv) modules[idx] = !modules[idx];
    }
  }
}

export interface QrMatrixResult {
  version: number;
  size: number;
  modules: boolean[];
}

export function encodeQrMatrix(text: string): QrMatrixResult {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (bytes.length <= byteCapacity(v)) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new Error(`QR payload length ${bytes.length} exceeds supported capacity`);
  }

  const size = version * 4 + 17;
  const data = encodeDataCodewords(bytes, version);
  const allCodewords = addEccAndInterleave(data, version);

  const baseModules = new Array<boolean>(size * size).fill(false);
  const isFunc = new Array<boolean>(size * size).fill(false);
  drawFunctionPatterns(version, size, baseModules, isFunc);
  drawCodewords(allCodewords, size, baseModules, isFunc);

  // Pick mask 0..7 with lowest run/balance penalty
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestModules = baseModules;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = baseModules.slice();
    applyMask(mask, size, candidate, isFunc);
    drawFormatBits(mask, size, candidate, isFunc);

    let score = 0;
    let darkCount = 0;
    for (let y = 0; y < size; y++) {
      let runLen = 1;
      for (let x = 0; x < size; x++) {
        const cur = candidate[y * size + x];
        if (cur) darkCount++;
        if (x > 0 && cur === candidate[y * size + x - 1]) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runLen = 1;
        }
      }
    }
    const pctDiff = Math.abs(Math.round((darkCount * 100) / (size * size)) - 50);
    score += Math.floor(pctDiff / 5) * 10;

    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestModules = candidate;
    }
  }
  void bestMask;
  return { version, size, modules: bestModules };
}

/**
 * Emits a compact, crisp SVG path + viewBox for the QR matrix with a 4-module quiet zone.
 */
export function buildQrSvgData(text: string): { viewBox: string; pathD: string; size: number } {
  const { size, modules } = encodeQrMatrix(text);
  const quiet = 3;
  const total = size + quiet * 2;
  const segments: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y * size + x]) {
        segments.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
      }
    }
  }
  return {
    viewBox: `0 0 ${total} ${total}`,
    pathD: segments.join(""),
    size: total,
  };
}

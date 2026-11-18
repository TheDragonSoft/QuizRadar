/**
 * Standards-compliant ISO/IEC 18004 QR Code encoder (Byte mode, ECC Level L, Versions 1..40).
 *
 * Pure TypeScript, zero external dependencies, deterministic output.
 * Encodes arbitrary UTF-8 strings (up to 2,953 bytes at Version 40-L) into a boolean
 * module matrix suitable for crisp SVG or Canvas rendering.
 */

export const MAX_QR_BYTE_CAPACITY = 2953;

export interface QrMatrix {
  version: number;
  size: number;
  modules: boolean[][];
}

// Total error-correction codewords per block for Versions 1..40 at ECC Level L (ISO/IEC 18004 Table 9)
const ECC_CODEWORDS_PER_BLOCK_L: readonly number[] = [
  0, // 0-index placeholder
  7,
  10,
  15,
  20,
  26,
  18,
  20,
  24,
  30,
  18,
  20,
  24,
  26,
  30,
  22,
  24,
  28,
  30,
  28,
  28,
  28,
  28,
  30,
  30,
  26,
  28,
  30,
  30,
  30,
  30,
  30,
  30,
  30,
  30,
  30,
  30,
  30,
  30,
  30,
  30,
];

// Total number of Reed-Solomon blocks for Versions 1..40 at ECC Level L (ISO/IEC 18004 Table 9)
const NUM_ERROR_CORRECTION_BLOCKS_L: readonly number[] = [
  0, // 0-index placeholder
  1,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  4,
  4,
  4,
  4,
  4,
  6,
  6,
  6,
  6,
  7,
  8,
  8,
  9,
  9,
  10,
  12,
  12,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  19,
  20,
  21,
  22,
  24,
  25,
];

function getNumRawDataModules(version: number): number {
  const size = version * 4 + 17;
  let result = size * size;
  // Subtract 3 finder patterns + separators (8x8 each)
  result -= 8 * 8 * 3;
  // Subtract format information and dark module (31 modules)
  result -= 15 * 2 + 1;
  // Subtract timing patterns (excluding finder separators)
  result -= (size - 16) * 2;
  // Subtract alignment patterns
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (numAlign * numAlign - 3) * 25;
    // Add back overlap between timing patterns and alignment patterns
    result += (numAlign - 2) * 5 * 2;
    // Subtract version information blocks (2 blocks of 3x6)
    if (version >= 7) {
      result -= 6 * 3 * 2;
    }
  }
  return result;
}

export function getDataCodewordCapacity(version: number): number {
  const totalCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const ecTotal = ECC_CODEWORDS_PER_BLOCK_L[version] * NUM_ERROR_CORRECTION_BLOCKS_L[version];
  return totalCodewords - ecTotal;
}

export function getByteCapacity(version: number): number {
  const dataCodewords = getDataCodewordCapacity(version);
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewords * 8 - 4 - countBits) / 8);
}

function getAlignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32 ? 26 : Math.ceil((size - 13) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

// GF(256) multiplication with primitive polynomial 0x11D
function reedSolomonMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomonComputeDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonComputeRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[divisor.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= reedSolomonMultiply(divisor[i], factor);
    }
  }
  return result;
}

function encodeDataCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const capacityCodewords = getDataCodewordCapacity(version);
  const capacityBits = capacityCodewords * 8;
  const bits: number[] = [];

  const appendBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode indicator (0100)
  appendBits(0b0100, 4);
  // Character count indicator (8 bits for v1..9, 16 bits for v10..40)
  appendBits(bytes.length, version <= 9 ? 8 : 16);
  // Payload bytes
  for (const b of bytes) {
    appendBits(b, 8);
  }
  // Terminator (up to 4 zero bits)
  appendBits(0, Math.min(4, capacityBits - bits.length));
  // Pad to byte boundary
  appendBits(0, (8 - (bits.length % 8)) % 8);
  // Pad bytes (0xEC, 0x11 alternating)
  for (let padByte = 0xec; bits.length < capacityBits; padByte ^= 0xec ^ 0x11) {
    appendBits(padByte, 8);
  }

  const data = new Uint8Array(capacityCodewords);
  for (let i = 0; i < bits.length; i++) {
    data[i >>> 3] |= bits[i] << (7 - (i & 7));
  }
  return data;
}

function addEccAndInterleave(data: Uint8Array, version: number): Uint8Array {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS_L[version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK_L[version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: Uint8Array[] = [];
  const rsDiv = reedSolomonComputeDivisor(blockEccLen);
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.subarray(k, k + datLen);
    k += datLen;
    const ecc = reedSolomonComputeRemainder(dat, rsDiv);
    const block = new Uint8Array(datLen + blockEccLen);
    block.set(dat, 0);
    block.set(ecc, datLen);
    blocks.push(block);
  }

  const result = new Uint8Array(rawCodewords);
  let outIdx = 0;
  const maxDataLen = shortBlockLen - blockEccLen + 1;
  for (let i = 0; i < maxDataLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i === shortBlockLen - blockEccLen && j < numShortBlocks) {
        continue;
      }
      result[outIdx++] = blocks[j][i];
    }
  }
  for (let i = 0; i < blockEccLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      const eccOffset = (j < numShortBlocks ? shortBlockLen - blockEccLen : maxDataLen) + i;
      result[outIdx++] = blocks[j][eccOffset];
    }
  }
  return result;
}

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

function drawFunctionPatterns(
  version: number,
  size: number,
  modules: boolean[][],
  isFunction: boolean[][],
): void {
  const setFunctionModule = (x: number, y: number, isDark: boolean) => {
    modules[y][x] = isDark;
    isFunction[y][x] = true;
  };

  // Timing patterns
  for (let i = 0; i < size; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // 3 Finder patterns + separators
  const drawFinderPattern = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
          setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };
  drawFinderPattern(3, 3);
  drawFinderPattern(size - 4, 3);
  drawFinderPattern(3, size - 4);

  // Alignment patterns
  const alignPatPos = getAlignmentPatternPositions(version);
  const numAlign = alignPatPos.length;
  for (let i = 0; i < numAlign; i++) {
    for (let j = 0; j < numAlign; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === numAlign - 1) ||
        (i === numAlign - 1 && j === 0)
      ) {
        continue;
      }
      const cx = alignPatPos[i];
      const cy = alignPatPos[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunctionModule(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve format info areas & dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunctionModule(8, i, false);
      setFunctionModule(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunctionModule(size - 1 - i, 8, false);
    setFunctionModule(8, size - 1 - i, false);
  }
  setFunctionModule(8, size - 8, true); // Dark module

  // Draw version info (for version >= 7)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(a, b, bit);
      setFunctionModule(b, a, bit);
    }
  }
}

function drawFormatBits(
  mask: number,
  size: number,
  modules: boolean[][],
  isFunction: boolean[][],
): void {
  // ECC Level L format indicator = 01 (binary 1)
  const data = (0b01 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;

  const setFunctionModule = (x: number, y: number, isDark: boolean) => {
    modules[y][x] = isDark;
    isFunction[y][x] = true;
  };

  // First copy
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, getBit(bits, i));
  setFunctionModule(8, 7, getBit(bits, 6));
  setFunctionModule(8, 8, getBit(bits, 7));
  setFunctionModule(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, getBit(bits, i));

  // Second copy
  for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, getBit(bits, i));
  setFunctionModule(8, size - 8, true); // Dark module always true
}

function drawCodewords(
  codewords: Uint8Array,
  size: number,
  modules: boolean[][],
  isFunction: boolean[][],
): void {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < codewords.length * 8) {
          modules[y][x] = getBit(codewords[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function applyMask(
  mask: number,
  size: number,
  modules: boolean[][],
  isFunction: boolean[][],
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFunction[y][x]) continue;
      let invert = false;
      switch (mask) {
        case 0:
          invert = (x + y) % 2 === 0;
          break;
        case 1:
          invert = y % 2 === 0;
          break;
        case 2:
          invert = x % 3 === 0;
          break;
        case 3:
          invert = (x + y) % 3 === 0;
          break;
        case 4:
          invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
          break;
        case 5:
          invert = ((x * y) % 2) + ((x * y) % 3) === 0;
          break;
        case 6:
          invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
          break;
        case 7:
          invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
          break;
      }
      if (invert) {
        modules[y][x] = !modules[y][x];
      }
    }
  }
}

function getPenaltyScore(size: number, modules: boolean[][]): number {
  let result = 0;

  // Adjacent modules in row/col having same color
  for (let y = 0; y < size; y++) {
    let runColor = false;
    let runX = 0;
    for (let x = 0; x < size; x++) {
      if (x === 0 || modules[y][x] !== runColor) {
        runColor = modules[y][x];
        runX = 1;
      } else {
        runX++;
        if (runX === 5) result += 3;
        else if (runX > 5) result += 1;
      }
    }
  }
  for (let x = 0; x < size; x++) {
    let runColor = false;
    let runY = 0;
    for (let y = 0; y < size; y++) {
      if (y === 0 || modules[y][x] !== runColor) {
        runColor = modules[y][x];
        runY = 1;
      } else {
        runY++;
        if (runY === 5) result += 3;
        else if (runY > 5) result += 1;
      }
    }
  }

  // 2x2 blocks of same color
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y][x];
      if (
        color === modules[y][x + 1] &&
        color === modules[y + 1][x] &&
        color === modules[y + 1][x + 1]
      ) {
        result += 3;
      }
    }
  }

  // Finder-like pattern in rows and columns (00001011101 or 10111010000)
  for (let y = 0; y < size; y++) {
    let bits = 0;
    for (let x = 0; x < size; x++) {
      bits = ((bits << 1) & 0x7ff) | (modules[y][x] ? 1 : 0);
      if (x >= 10 && (bits === 0x05d || bits === 0x5d0)) {
        result += 40;
      }
    }
  }
  for (let x = 0; x < size; x++) {
    let bits = 0;
    for (let y = 0; y < size; y++) {
      bits = ((bits << 1) & 0x7ff) | (modules[y][x] ? 1 : 0);
      if (y >= 10 && (bits === 0x05d || bits === 0x5d0)) {
        result += 40;
      }
    }
  }

  // Balance of dark and light modules
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) dark++;
    }
  }
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += Math.max(0, k) * 10;

  return result;
}

export function encodeQrMatrix(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_QR_BYTE_CAPACITY) {
    throw new Error(
      `QR payload length (${bytes.length} bytes) exceeds maximum QR version 40-L capacity (${MAX_QR_BYTE_CAPACITY} bytes).`,
    );
  }

  let version = 1;
  while (version <= 40 && getByteCapacity(version) < bytes.length) {
    version++;
  }
  if (version > 40) {
    throw new Error(`Unable to fit ${bytes.length} bytes in QR Versions 1..40.`);
  }

  const size = version * 4 + 17;
  const dataCodewords = encodeDataCodewords(bytes, version);
  const allCodewords = addEccAndInterleave(dataCodewords, version);

  const modules: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false),
  );

  drawFunctionPatterns(version, size, modules, isFunction);
  drawCodewords(allCodewords, size, modules, isFunction);

  let bestMask = 0;
  let minPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask, size, modules, isFunction);
    drawFormatBits(mask, size, modules, isFunction);
    const penalty = getPenaltyScore(size, modules);
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMask = mask;
    }
    applyMask(mask, size, modules, isFunction); // revert mask
  }

  applyMask(bestMask, size, modules, isFunction);
  drawFormatBits(bestMask, size, modules, isFunction);

  return { version, size, modules };
}

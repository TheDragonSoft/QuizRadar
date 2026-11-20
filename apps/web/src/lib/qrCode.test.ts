import { describe, it, expect } from "vitest";
import {
  MAX_QR_BYTE_CAPACITY,
  encodeQrMatrix,
  getByteCapacity,
  getDataCodewordCapacity,
  unpackFlatQrMatrix,
  type QrMatrix,
} from "./qrCode";
import { decodeQrFromRgba } from "./qrDecoder";
import { getWasmEngine } from "../pwadapters/wasmBridge";

/** Renders a QrMatrix with a 4-module quiet zone into an RGBA pixel buffer for real jsQR decoding. */
function renderMatrixToRgba(
  matrix: QrMatrix,
  scale = 4,
): { data: Uint8ClampedArray; width: number; height: number } {
  const quiet = 4;
  const totalModules = matrix.size + quiet * 2;
  const width = totalModules * scale;
  const height = width;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);

  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.modules[y][x]) continue;
      const startX = (x + quiet) * scale;
      const startY = (y + quiet) * scale;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const offset = ((startY + dy) * width + (startX + dx)) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 255;
        }
      }
    }
  }
  return { data, width, height };
}

describe("ISO/IEC 18004 QR Code encoder & cross-tier decode verification", () => {
  it("computes standard capacities for Version 1-L and Version 40-L", () => {
    expect(getDataCodewordCapacity(1)).toBe(19);
    expect(getByteCapacity(1)).toBe(17);
    expect(getDataCodewordCapacity(40)).toBe(2956);
    expect(getByteCapacity(40)).toBe(MAX_QR_BYTE_CAPACITY);
  });

  it("encodes a short quizradar://pair URI into a valid matrix with finder and timing patterns", () => {
    const uri = "quizradar://pair?d=eJyrVkrLz1eyUkpKLFKqBQAdegZ1";
    const qr = encodeQrMatrix(uri);

    expect(qr.version).toBeGreaterThanOrEqual(3);
    expect(qr.size).toBe(qr.version * 4 + 17);
    expect(qr.modules.length).toBe(qr.size);
    expect(qr.modules[0].length).toBe(qr.size);

    expect(qr.modules[0][0]).toBe(true);
    expect(qr.modules[0][6]).toBe(true);
    expect(qr.modules[6][0]).toBe(true);
    expect(qr.modules[6][6]).toBe(true);
    expect(qr.modules[3][3]).toBe(true);
    expect(qr.modules[7][7]).toBe(false);
    expect(qr.modules[qr.size - 8][8]).toBe(true);
  });

  it("decodes generated QR matrices end-to-end with jsQR across short, LAN, and dense multi-block versions", () => {
    const vectors = [
      "HELLO WORLD",
      "quizradar://pair?d=eJyrVkrLz1eyUkpKLFKqBQAdegZ1",
      "quizradar://lan?h=192.168.1.42&p=51823&t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&fp=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&v=1",
      `quizradar://pair?d=${"AbCdEf0123456789-_".repeat(32)}`, // >570 bytes -> multi-block Version 15+
    ];

    for (const payload of vectors) {
      const qr = encodeQrMatrix(payload);
      const { data, width, height } = renderMatrixToRgba(qr, 4);
      const decoded = decodeQrFromRgba(data, width, height);
      expect(decoded).toBe(payload);
    }
  });

  it("matches Rust core WASM QR matrix output bit-for-bit and decodes cleanly with jsQR", async () => {
    const wasm = await getWasmEngine();
    const lanUri =
      "quizradar://lan?h=192.168.1.42&p=51823&t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&fp=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&v=1";
    const rustMatrix = unpackFlatQrMatrix(JSON.parse(wasm.encode_qr_matrix(lanUri)));
    const tsMatrix = encodeQrMatrix(lanUri);

    expect(rustMatrix).toEqual(tsMatrix);
    const { data, width, height } = renderMatrixToRgba(rustMatrix, 4);
    expect(decodeQrFromRgba(data, width, height)).toBe(lanUri);
  });

  it("rejects payloads exceeding Version 40-L capacity (2,953 bytes)", () => {
    const huge = "x".repeat(MAX_QR_BYTE_CAPACITY + 1);
    expect(() => encodeQrMatrix(huge)).toThrow(/exceeds maximum QR version 40-L capacity/);
  });
});

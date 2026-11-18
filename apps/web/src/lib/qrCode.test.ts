import { describe, it, expect } from "vitest";
import {
  MAX_QR_BYTE_CAPACITY,
  encodeQrMatrix,
  getByteCapacity,
  getDataCodewordCapacity,
} from "./qrCode";

describe("ISO/IEC 18004 QR Code encoder (qrCode.ts)", () => {
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

    // Top-left 7x7 finder outer ring corners must be dark, separator at (7,0..7) must be light
    expect(qr.modules[0][0]).toBe(true);
    expect(qr.modules[0][6]).toBe(true);
    expect(qr.modules[6][0]).toBe(true);
    expect(qr.modules[6][6]).toBe(true);
    expect(qr.modules[3][3]).toBe(true);
    expect(qr.modules[7][7]).toBe(false);

    // Dark module at (8, size - 8) must always be dark
    expect(qr.modules[qr.size - 8][8]).toBe(true);
  });

  it("rejects payloads exceeding Version 40-L capacity (2,953 bytes)", () => {
    const huge = "x".repeat(MAX_QR_BYTE_CAPACITY + 1);
    expect(() => encodeQrMatrix(huge)).toThrow(/exceeds maximum QR version 40-L capacity/);
  });
});

/**
 * Serverless Peer Sync codec (`quizradar://pair?d=<base64url-deflate-raw>`).
 *
 * Encodes and decodes data-only `BackupPayload` JSON without any server,
 * HTTP listener, or secret/token fields. Wire-compatible with Android's
 * `PairSyncCodec.kt` (`Deflater(BEST_COMPRESSION, nowrap=true)` / `Inflater(true)`).
 */

import { MAX_QR_BYTE_CAPACITY } from "./qrCode";

export const PAIR_SYNC_PREFIX = "quizradar://pair?d=";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(b64url: string): Uint8Array {
  const padded =
    b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function runTransformStream(
  stream: CompressionStream | DecompressionStream,
  input: Uint8Array,
): Promise<Uint8Array> {
  const readPromise = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  const writePromise = (async () => {
    await writer.write(input as unknown as BufferSource);
    await writer.close();
  })();
  // Attach no-op handlers so neither promise triggers an unhandled rejection
  // if the peer rejects slightly before Promise.all observes it.
  readPromise.catch(() => {});
  writePromise.catch(() => {});
  const [buf] = await Promise.all([readPromise, writePromise]);
  return new Uint8Array(buf);
}

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("CompressionStream is not supported in this browser environment.");
  }
  return runTransformStream(new CompressionStream("deflate-raw"), input);
}

async function inflateRaw(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not supported in this browser environment.");
  }
  return runTransformStream(new DecompressionStream("deflate-raw"), input);
}

export async function encodePairSyncLink(payloadJson: string): Promise<string> {
  const rawBytes = new TextEncoder().encode(payloadJson);
  const compressed = await deflateRaw(rawBytes);
  return `${PAIR_SYNC_PREFIX}${toBase64Url(compressed)}`;
}

/**
 * Strips verbose source text (`raw_text`, long `snippet` / `notes` > 160 chars)
 * from assessments so large exam radars fit within QR Version 40-L (2,953 bytes)
 * while preserving all courses, slots, assessment dates, topics, and grades.
 */
export function compactPairSyncPayload(payloadJson: string): string {
  const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
  if (Array.isArray(parsed.assessments)) {
    parsed.assessments = parsed.assessments.map((item) => {
      if (!item || typeof item !== "object") return item;
      const copy = { ...(item as Record<string, unknown>) };
      delete copy.raw_text;
      if (typeof copy.snippet === "string" && copy.snippet.length > 160) {
        copy.snippet = `${copy.snippet.slice(0, 157)}...`;
      }
      if (typeof copy.notes === "string" && copy.notes.length > 160) {
        copy.notes = `${copy.notes.slice(0, 157)}...`;
      }
      return copy;
    });
  }
  return JSON.stringify(parsed);
}

export async function encodePairSyncQrPayload(payloadJson: string): Promise<{
  link: string;
  compacted: boolean;
  fitsQr: boolean;
}> {
  const fullLink = await encodePairSyncLink(payloadJson);
  if (new TextEncoder().encode(fullLink).length <= MAX_QR_BYTE_CAPACITY) {
    return { link: fullLink, compacted: false, fitsQr: true };
  }
  const compactJson = compactPairSyncPayload(payloadJson);
  const compactLink = await encodePairSyncLink(compactJson);
  const fitsQr = new TextEncoder().encode(compactLink).length <= MAX_QR_BYTE_CAPACITY;
  return { link: compactLink, compacted: true, fitsQr };
}

export function extractPairPayloadParam(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error("Paste a quizradar://pair?d=... sync link first.");
  }

  if (trimmed.startsWith("quizradar://") || trimmed.startsWith("com.quizradar.app://")) {
    const queryIdx = trimmed.indexOf("?");
    if (queryIdx === -1) {
      throw new Error("Invalid sync link: missing ?d= payload.");
    }
    const params = new URLSearchParams(trimmed.slice(queryIdx + 1));
    const d = params.get("d");
    if (!d) {
      throw new Error("Invalid sync link: missing ?d= payload.");
    }
    return d.trim();
  }

  // Allow pasting raw base64url token if user copied only the parameter
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error("Unrecognized sync link format. Expected quizradar://pair?d=...");
}

export async function decodePairSyncLink(rawInput: string): Promise<string> {
  const token = extractPairPayloadParam(rawInput);
  let compressed: Uint8Array;
  try {
    compressed = fromBase64Url(token);
  } catch {
    throw new Error("Corrupted sync link (invalid base64url encoding).");
  }

  let decompressed: Uint8Array;
  try {
    decompressed = await inflateRaw(compressed);
  } catch {
    throw new Error("Corrupted sync link (failed to decompress payload).");
  }

  const json = new TextDecoder().decode(decompressed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Sync link payload is not valid JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { assessments?: unknown }).assessments) ||
    typeof (parsed as { schedule?: unknown }).schedule !== "object"
  ) {
    throw new Error("Sync link is not a valid QuizRadar sync payload.");
  }

  return json;
}

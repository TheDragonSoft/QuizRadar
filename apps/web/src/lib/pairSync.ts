/**
 * Serverless Peer Sync codec (`quizradar://pair?d=<base64url-deflate-raw>`).
 *
 * Encodes and decodes data-only `BackupPayload` JSON without any server,
 * HTTP listener, or secret/token fields. Wire-compatible with Android's
 * `PairSyncCodec.kt` (`Deflater(BEST_COMPRESSION, nowrap=true)` / `Inflater(true)`).
 */

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

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("CompressionStream is not supported in this browser environment.");
  }
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  await writer.write(input as unknown as BufferSource);
  await writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

async function inflateRaw(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not supported in this browser environment.");
  }
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  await writer.write(input as unknown as BufferSource);
  await writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buf);
}

export async function encodePairSyncLink(payloadJson: string): Promise<string> {
  const rawBytes = new TextEncoder().encode(payloadJson);
  const compressed = await deflateRaw(rawBytes);
  return `${PAIR_SYNC_PREFIX}${toBase64Url(compressed)}`;
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

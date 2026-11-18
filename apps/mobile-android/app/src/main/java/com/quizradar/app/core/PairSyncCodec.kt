package com.quizradar.app.core

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.zip.Deflater
import java.util.zip.Inflater

/**
 * Serverless Peer Sync codec (`quizradar://pair?d=<base64url-deflate-raw>`).
 *
 * Wire-compatible with Web/Desktop `pairSync.ts` (`CompressionStream("deflate-raw")`).
 * Carries only `BackupPayload` JSON (structurally token-free).
 */
object PairSyncCodec {
    const val PREFIX = "quizradar://pair?d="

    fun encode(payloadJson: String): String {
        val raw = payloadJson.toByteArray(StandardCharsets.UTF_8)
        val deflater = Deflater(Deflater.BEST_COMPRESSION, true)
        deflater.setInput(raw)
        deflater.finish()
        val out = ByteArrayOutputStream(raw.size)
        val buffer = ByteArray(4096)
        while (!deflater.finished()) {
            val count = deflater.deflate(buffer)
            if (count == 0) break
            out.write(buffer, 0, count)
        }
        deflater.end()
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(out.toByteArray())
        return "$PREFIX$encoded"
    }

    /**
     * Strips verbose `raw_text` fields and truncates long `snippet` / `notes` values
     * in `payloadJson` when the full compressed `quizradar://pair?d=...` link exceeds
     * `maxLinkBytes` (ISO/IEC 18004 QR Version 40-L capacity = 2,953 bytes).
     *
     * Returns `(compactedOrOriginalJson, wasCompacted)`.
     */
    fun compactPayloadIfNeeded(
        payloadJson: String,
        maxLinkBytes: Int = QrCodeEncoder.MAX_QR_BYTE_CAPACITY,
    ): Pair<String, Boolean> {
        val fullLink = encode(payloadJson)
        if (fullLink.toByteArray(StandardCharsets.UTF_8).size <= maxLinkBytes) {
            return Pair(payloadJson, false)
        }
        val withoutRaw = removeJsonStringField(payloadJson, "raw_text")
        val compacted = truncateJsonStringFields(withoutRaw, setOf("snippet", "notes"), 161)
        return Pair(compacted, true)
    }

    /** End offset (exclusive) of the JSON string beginning at `openingQuote`. */
    private fun jsonStringEnd(
        json: String,
        openingQuote: Int,
    ): Int {
        var cursor = openingQuote + 1
        while (cursor < json.length) {
            when (json[cursor]) {
                '\\' -> cursor += 2
                '"' -> return cursor + 1
                else -> cursor += 1
            }
        }
        return -1
    }

    private fun jsonStringFieldEnd(
        json: String,
        keyStart: Int,
        key: String,
    ): Int? {
        val keyEnd = keyStart + "\"$key\"".length
        var cursor = keyEnd
        while (cursor < json.length && json[cursor].isWhitespace()) cursor += 1
        if (cursor >= json.length || json[cursor] != ':') return null
        cursor += 1
        while (cursor < json.length && json[cursor].isWhitespace()) cursor += 1
        if (cursor >= json.length || json[cursor] != '"') return null
        val end = jsonStringEnd(json, cursor)
        return if (end == -1) null else end
    }

    private fun removeTrailingComma(builder: StringBuilder) {
        var last = builder.length - 1
        while (last >= 0 && builder[last].isWhitespace()) last -= 1
        if (last >= 0 && builder[last] == ',') builder.setLength(last)
    }

    private fun removeJsonStringField(
        json: String,
        key: String,
    ): String {
        val fieldKey = "\"$key\""
        val out = StringBuilder(json.length)
        var cursor = 0
        while (cursor < json.length) {
            if (json[cursor] != '"') {
                out.append(json[cursor])
                cursor += 1
                continue
            }
            val stringEnd = jsonStringEnd(json, cursor)
            if (stringEnd == -1) {
                out.append(json, cursor, json.length)
                break
            }
            if (!json.startsWith(fieldKey, cursor)) {
                out.append(json, cursor, stringEnd)
                cursor = stringEnd
                continue
            }
            val valueEnd = jsonStringFieldEnd(json, cursor, key)
            if (valueEnd == null) {
                out.append(json, cursor, stringEnd)
                cursor = stringEnd
                continue
            }
            var afterValue = valueEnd
            while (afterValue < json.length && json[afterValue].isWhitespace()) afterValue += 1
            if (afterValue < json.length && json[afterValue] == ',') {
                cursor = afterValue + 1
            } else {
                removeTrailingComma(out)
                cursor = valueEnd
            }
        }
        return out.toString()
    }

    private fun truncateJsonStringFields(
        json: String,
        keys: Set<String>,
        maxUnits: Int,
    ): String {
        val out = StringBuilder(json.length)
        var cursor = 0
        while (cursor < json.length) {
            if (json[cursor] != '"') {
                out.append(json[cursor])
                cursor += 1
                continue
            }
            val stringEnd = jsonStringEnd(json, cursor)
            if (stringEnd == -1) {
                out.append(json, cursor, json.length)
                break
            }
            val matchedKey = keys.firstOrNull { key -> json.startsWith("\"$key\"", cursor) }
            val valueEnd = matchedKey?.let { jsonStringFieldEnd(json, cursor, it) }
            if (matchedKey == null || valueEnd == null) {
                out.append(json, cursor, stringEnd)
                cursor = stringEnd
                continue
            }
            val rawValue = json.substring(cursor + 1, valueEnd - 1)
            if (regexUnitCount(rawValue) <= maxUnits) {
                out.append(json, cursor, stringEnd)
                cursor = stringEnd
                continue
            }
            val safePrefix = rawValue.take(157).trimEnd('\\')
            out.append("\"$matchedKey\":\"$safePrefix...\"")
            cursor = valueEnd
        }
        return out.toString()
    }

    private fun regexUnitCount(value: String): Int {
        var count = 0
        var cursor = 0
        while (cursor < value.length) {
            count += 1
            cursor += if (value[cursor] == '\\') 2 else 1
        }
        return count
    }

    fun extractParam(rawInput: String): String {
        val trimmed = rawInput.trim()
        require(trimmed.isNotEmpty()) { "Paste a quizradar://pair?d=... sync link first." }
        if (trimmed.startsWith("quizradar://") || trimmed.startsWith("com.quizradar.app://")) {
            val qIdx = trimmed.indexOf('?')
            require(qIdx != -1) { "Invalid sync link: missing ?d= payload." }
            val query = trimmed.substring(qIdx + 1)
            val param =
                query.split('&')
                    .firstOrNull { it.startsWith("d=") }
                    ?.substringAfter("d=")
                    ?.trim()
            require(!param.isNullOrEmpty()) { "Invalid sync link: missing ?d= payload." }
            return param
        }
        require(trimmed.matches(Regex("^[A-Za-z0-9_-]+$"))) {
            "Unrecognized sync link format. Expected quizradar://pair?d=..."
        }
        return trimmed
    }

    fun decode(rawInput: String): String {
        val token = extractParam(rawInput)
        val compressed = Base64.getUrlDecoder().decode(token)
        val inflater = Inflater(true)
        inflater.setInput(compressed)
        val out = ByteArrayOutputStream(compressed.size * 2)
        val buffer = ByteArray(4096)
        try {
            while (!inflater.finished()) {
                val count = inflater.inflate(buffer)
                if (count == 0) {
                    if (inflater.needsInput() || inflater.needsDictionary()) break
                } else {
                    out.write(buffer, 0, count)
                }
            }
        } finally {
            inflater.end()
        }
        val json = out.toString(StandardCharsets.UTF_8.name())
        require(json.contains("\"assessments\"") && json.contains("\"schedule\"")) {
            "Sync link is not a valid QuizRadar sync payload."
        }
        return json
    }
}

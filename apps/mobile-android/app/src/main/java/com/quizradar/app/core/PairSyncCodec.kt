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

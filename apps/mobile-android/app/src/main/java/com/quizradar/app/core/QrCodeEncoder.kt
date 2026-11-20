package com.quizradar.app.core

/**
 * Thin Android facade over Rust `core::sync::qr::encode_qr_matrix` (UniFFI).
 *
 * All ISO/IEC 18004 QR encoding (Byte mode, ECC Level L, Versions 1..=40)
 * lives once in pure Rust `core/src/sync/qr.rs`.
 */
object QrCodeEncoder {
    const val MAX_QR_BYTE_CAPACITY = 2953

    data class QrMatrix(
        val version: Int,
        val size: Int,
        val modules: Array<BooleanArray>,
    ) {
        fun get(
            x: Int,
            y: Int,
        ): Boolean = modules[y][x]
    }

    private val ECC_CODEWORDS_PER_BLOCK_L =
        intArrayOf(
            0,
            7, 10, 15, 20, 26, 18, 20, 24, 30, 18,
            20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
            28, 28, 30, 30, 26, 28, 30, 30, 30, 30,
            30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
        )

    private val NUM_ERROR_CORRECTION_BLOCKS_L =
        intArrayOf(
            0,
            1, 1, 1, 1, 1, 2, 2, 2, 2, 4,
            4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
            8, 9, 9, 10, 12, 12, 12, 13, 14, 15,
            16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
        )

    fun getNumRawDataModules(version: Int): Int {
        val size = version * 4 + 17
        var result = size * size
        result -= 8 * 8 * 3
        result -= 15 * 2 + 1
        result -= (size - 16) * 2
        if (version >= 2) {
            val numAlign = version / 7 + 2
            result -= (numAlign * numAlign - 3) * 25
            result += (numAlign - 2) * 5 * 2
            if (version >= 7) {
                result -= 6 * 3 * 2
            }
        }
        return result
    }

    fun getDataCodewordCapacity(version: Int): Int {
        val totalCodewords = getNumRawDataModules(version) / 8
        val ecTotal = ECC_CODEWORDS_PER_BLOCK_L[version] * NUM_ERROR_CORRECTION_BLOCKS_L[version]
        return totalCodewords - ecTotal
    }

    fun getByteCapacity(version: Int): Int {
        val dataCodewords = getDataCodewordCapacity(version)
        val countBits = if (version <= 9) 8 else 16
        return (dataCodewords * 8 - 4 - countBits) / 8
    }

    fun encode(text: String): QrMatrix {
        val rawJson =
            try {
                encodeQrMatrix(text)
            } catch (e: QuizRadarFfiException) {
                throw IllegalArgumentException(e.message ?: "QR encoding failed", e)
            }
        val version = extractIntField(rawJson, "version")
        val size = extractIntField(rawJson, "size")
        val flat = extractStringField(rawJson, "modules")
        require(flat.length == size * size) {
            "Malformed QR matrix from Rust core: expected ${size * size} modules, got ${flat.length}."
        }
        val modules =
            Array(size) { y ->
                BooleanArray(size) { x -> flat[y * size + x] == '1' }
            }
        return QrMatrix(version = version, size = size, modules = modules)
    }

    private fun extractIntField(
        json: String,
        key: String,
    ): Int {
        val match =
            Regex(""""$key"\s*:\s*(\d+)""").find(json)
                ?: throw IllegalStateException("Missing integer field '$key' in QR JSON.")
        return match.groupValues[1].toInt()
    }

    private fun extractStringField(
        json: String,
        key: String,
    ): String {
        val prefix = "\"$key\":\""
        val start = json.indexOf(prefix)
        require(start >= 0) { "Missing string field '$key' in QR JSON." }
        val valueStart = start + prefix.length
        val end = json.indexOf('"', valueStart)
        require(end >= valueStart) { "Unterminated string field '$key' in QR JSON." }
        return json.substring(valueStart, end)
    }
}

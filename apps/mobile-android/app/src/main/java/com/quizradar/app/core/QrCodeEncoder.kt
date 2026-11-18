package com.quizradar.app.core

import java.nio.charset.StandardCharsets
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * Standards-compliant ISO/IEC 18004 QR Code encoder (Byte mode, ECC Level L, Versions 1..40).
 *
 * Pure Kotlin, zero external dependencies, deterministic output matching Web/Desktop `qrCode.ts`.
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

    private fun getAlignmentPatternPositions(version: Int): IntArray {
        if (version == 1) return IntArray(0)
        val numAlign = version / 7 + 2
        val size = version * 4 + 17
        val step =
            if (version == 32) {
                26
            } else {
                ceil((size - 13).toDouble() / (numAlign * 2 - 2)).toInt() * 2
            }
        val result = IntArray(numAlign)
        result[0] = 6
        var pos = size - 7
        for (i in numAlign - 1 downTo 1) {
            result[i] = pos
            pos -= step
        }
        return result
    }

    private fun reedSolomonMultiply(
        x: Int,
        y: Int,
    ): Int {
        var z = 0
        for (i in 7 downTo 0) {
            z = (z shl 1) xor ((z ushr 7) * 0x11d)
            z = z xor (((y ushr i) and 1) * x)
        }
        return z
    }

    private fun reedSolomonComputeDivisor(degree: Int): IntArray {
        val result = IntArray(degree)
        result[degree - 1] = 1
        var root = 1
        for (i in 0 until degree) {
            for (j in 0 until degree) {
                result[j] = reedSolomonMultiply(result[j], root)
                if (j + 1 < degree) {
                    result[j] = result[j] xor result[j + 1]
                }
            }
            root = reedSolomonMultiply(root, 0x02)
        }
        return result
    }

    private fun reedSolomonComputeRemainder(
        data: IntArray,
        divisor: IntArray,
    ): IntArray {
        val result = IntArray(divisor.size)
        for (b in data) {
            val factor = b xor result[0]
            System.arraycopy(result, 1, result, 0, divisor.size - 1)
            result[divisor.size - 1] = 0
            for (i in divisor.indices) {
                result[i] = result[i] xor reedSolomonMultiply(divisor[i], factor)
            }
        }
        return result
    }

    private fun encodeDataCodewords(
        bytes: ByteArray,
        version: Int,
    ): IntArray {
        val capacityCodewords = getDataCodewordCapacity(version)
        val capacityBits = capacityCodewords * 8
        val bits = ArrayList<Int>(capacityBits)

        fun appendBits(
            value: Int,
            len: Int,
        ) {
            for (i in len - 1 downTo 0) {
                bits.add((value ushr i) and 1)
            }
        }

        appendBits(0b0100, 4)
        appendBits(bytes.size, if (version <= 9) 8 else 16)
        for (b in bytes) {
            appendBits(b.toInt() and 0xff, 8)
        }
        appendBits(0, min(4, capacityBits - bits.size))
        appendBits(0, (8 - (bits.size % 8)) % 8)
        var padByte = 0xec
        while (bits.size < capacityBits) {
            appendBits(padByte, 8)
            padByte = padByte xor (0xec xor 0x11)
        }

        val data = IntArray(capacityCodewords)
        for (i in bits.indices) {
            data[i ushr 3] = data[i ushr 3] or (bits[i] shl (7 - (i and 7)))
        }
        return data
    }

    private fun addEccAndInterleave(
        data: IntArray,
        version: Int,
    ): IntArray {
        val numBlocks = NUM_ERROR_CORRECTION_BLOCKS_L[version]
        val blockEccLen = ECC_CODEWORDS_PER_BLOCK_L[version]
        val rawCodewords = getNumRawDataModules(version) / 8
        val numShortBlocks = numBlocks - (rawCodewords % numBlocks)
        val shortBlockLen = rawCodewords / numBlocks

        val blocks = ArrayList<IntArray>(numBlocks)
        val rsDiv = reedSolomonComputeDivisor(blockEccLen)
        var k = 0
        for (i in 0 until numBlocks) {
            val datLen = shortBlockLen - blockEccLen + if (i < numShortBlocks) 0 else 1
            val dat = data.copyOfRange(k, k + datLen)
            k += datLen
            val ecc = reedSolomonComputeRemainder(dat, rsDiv)
            val block = IntArray(datLen + blockEccLen)
            System.arraycopy(dat, 0, block, 0, datLen)
            System.arraycopy(ecc, 0, block, datLen, blockEccLen)
            blocks.add(block)
        }

        val result = IntArray(rawCodewords)
        var outIdx = 0
        val maxDataLen = shortBlockLen - blockEccLen + 1
        for (i in 0 until maxDataLen) {
            for (j in 0 until numBlocks) {
                if (i == shortBlockLen - blockEccLen && j < numShortBlocks) {
                    continue
                }
                result[outIdx++] = blocks[j][i]
            }
        }
        for (i in 0 until blockEccLen) {
            for (j in 0 until numBlocks) {
                val eccOffset = (if (j < numShortBlocks) shortBlockLen - blockEccLen else maxDataLen) + i
                result[outIdx++] = blocks[j][eccOffset]
            }
        }
        return result
    }

    private fun getBit(
        x: Int,
        i: Int,
    ): Boolean = ((x ushr i) and 1) != 0

    private fun drawFunctionPatterns(
        version: Int,
        size: Int,
        modules: Array<BooleanArray>,
        isFunction: Array<BooleanArray>,
    ) {
        fun setFunctionModule(
            x: Int,
            y: Int,
            isDark: Boolean,
        ) {
            modules[y][x] = isDark
            isFunction[y][x] = true
        }

        for (i in 0 until size) {
            setFunctionModule(6, i, i % 2 == 0)
            setFunctionModule(i, 6, i % 2 == 0)
        }

        fun drawFinderPattern(
            cx: Int,
            cy: Int,
        ) {
            for (dy in -4..4) {
                for (dx in -4..4) {
                    val dist = max(abs(dx), abs(dy))
                    val xx = cx + dx
                    val yy = cy + dy
                    if (xx in 0 until size && yy in 0 until size) {
                        setFunctionModule(xx, yy, dist != 2 && dist != 4)
                    }
                }
            }
        }
        drawFinderPattern(3, 3)
        drawFinderPattern(size - 4, 3)
        drawFinderPattern(3, size - 4)

        val alignPatPos = getAlignmentPatternPositions(version)
        val numAlign = alignPatPos.size
        for (i in 0 until numAlign) {
            for (j in 0 until numAlign) {
                if (
                    (i == 0 && j == 0) ||
                    (i == 0 && j == numAlign - 1) ||
                    (i == numAlign - 1 && j == 0)
                ) {
                    continue
                }
                val cx = alignPatPos[i]
                val cy = alignPatPos[j]
                for (dy in -2..2) {
                    for (dx in -2..2) {
                        setFunctionModule(cx + dx, cy + dy, max(abs(dx), abs(dy)) != 1)
                    }
                }
            }
        }

        for (i in 0..8) {
            if (i != 6) {
                setFunctionModule(8, i, false)
                setFunctionModule(i, 8, false)
            }
        }
        for (i in 0 until 8) {
            setFunctionModule(size - 1 - i, 8, false)
            setFunctionModule(8, size - 1 - i, false)
        }
        setFunctionModule(8, size - 8, true)

        if (version >= 7) {
            var rem = version
            for (i in 0 until 12) {
                rem = (rem shl 1) xor ((rem ushr 11) * 0x1f25)
            }
            val bits = (version shl 12) or rem
            for (i in 0 until 18) {
                val bit = getBit(bits, i)
                val a = size - 11 + (i % 3)
                val b = i / 3
                setFunctionModule(a, b, bit)
                setFunctionModule(b, a, bit)
            }
        }
    }

    private fun drawFormatBits(
        mask: Int,
        size: Int,
        modules: Array<BooleanArray>,
        isFunction: Array<BooleanArray>,
    ) {
        val data = (0b01 shl 3) or mask
        var rem = data
        for (i in 0 until 10) {
            rem = (rem shl 1) xor ((rem ushr 9) * 0x537)
        }
        val bits = ((data shl 10) or rem) xor 0x5412

        fun setFunctionModule(
            x: Int,
            y: Int,
            isDark: Boolean,
        ) {
            modules[y][x] = isDark
            isFunction[y][x] = true
        }

        for (i in 0..5) setFunctionModule(8, i, getBit(bits, i))
        setFunctionModule(8, 7, getBit(bits, 6))
        setFunctionModule(8, 8, getBit(bits, 7))
        setFunctionModule(7, 8, getBit(bits, 8))
        for (i in 9 until 15) setFunctionModule(14 - i, 8, getBit(bits, i))

        for (i in 0 until 8) setFunctionModule(size - 1 - i, 8, getBit(bits, i))
        for (i in 8 until 15) setFunctionModule(8, size - 15 + i, getBit(bits, i))
        setFunctionModule(8, size - 8, true)
    }

    private fun drawCodewords(
        codewords: IntArray,
        size: Int,
        modules: Array<BooleanArray>,
        isFunction: Array<BooleanArray>,
    ) {
        var i = 0
        var right = size - 1
        while (right >= 1) {
            if (right == 6) right = 5
            for (vert in 0 until size) {
                for (j in 0 until 2) {
                    val x = right - j
                    val upward = ((right + 1) and 2) == 0
                    val y = if (upward) size - 1 - vert else vert
                    if (!isFunction[y][x] && i < codewords.size * 8) {
                        modules[y][x] = getBit(codewords[i ushr 3], 7 - (i and 7))
                        i++
                    }
                }
            }
            right -= 2
        }
    }

    private fun applyMask(
        mask: Int,
        size: Int,
        modules: Array<BooleanArray>,
        isFunction: Array<BooleanArray>,
    ) {
        for (y in 0 until size) {
            for (x in 0 until size) {
                if (isFunction[y][x]) continue
                val invert =
                    when (mask) {
                        0 -> (x + y) % 2 == 0
                        1 -> y % 2 == 0
                        2 -> x % 3 == 0
                        3 -> (x + y) % 3 == 0
                        4 -> (x / 3 + y / 2) % 2 == 0
                        5 -> ((x * y) % 2) + ((x * y) % 3) == 0
                        6 -> (((x * y) % 2) + ((x * y) % 3)) % 2 == 0
                        7 -> (((x + y) % 2) + ((x * y) % 3)) % 2 == 0
                        else -> false
                    }
                if (invert) {
                    modules[y][x] = !modules[y][x]
                }
            }
        }
    }

    private fun getPenaltyScore(
        size: Int,
        modules: Array<BooleanArray>,
    ): Int {
        var result = 0

        for (y in 0 until size) {
            var runColor = false
            var runX = 0
            for (x in 0 until size) {
                if (x == 0 || modules[y][x] != runColor) {
                    runColor = modules[y][x]
                    runX = 1
                } else {
                    runX++
                    if (runX == 5) {
                        result += 3
                    } else if (runX > 5) {
                        result += 1
                    }
                }
            }
        }

        for (x in 0 until size) {
            var runColor = false
            var runY = 0
            for (y in 0 until size) {
                if (y == 0 || modules[y][x] != runColor) {
                    runColor = modules[y][x]
                    runY = 1
                } else {
                    runY++
                    if (runY == 5) {
                        result += 3
                    } else if (runY > 5) {
                        result += 1
                    }
                }
            }
        }

        for (y in 0 until size - 1) {
            for (x in 0 until size - 1) {
                val color = modules[y][x]
                if (
                    color == modules[y][x + 1] &&
                    color == modules[y + 1][x] &&
                    color == modules[y + 1][x + 1]
                ) {
                    result += 3
                }
            }
        }

        for (y in 0 until size) {
            var bits = 0
            for (x in 0 until size) {
                bits = ((bits shl 1) and 0x7ff) or if (modules[y][x]) 1 else 0
                if (x >= 10 && (bits == 0x05d || bits == 0x5d0)) {
                    result += 40
                }
            }
        }

        for (x in 0 until size) {
            var bits = 0
            for (y in 0 until size) {
                bits = ((bits shl 1) and 0x7ff) or if (modules[y][x]) 1 else 0
                if (y >= 10 && (bits == 0x05d || bits == 0x5d0)) {
                    result += 40
                }
            }
        }

        var dark = 0
        for (y in 0 until size) {
            for (x in 0 until size) {
                if (modules[y][x]) dark++
            }
        }
        val total = size * size
        val k = ceil(abs(dark * 20 - total * 10).toDouble() / total).toInt() - 1
        result += max(0, k) * 10

        return result
    }

    fun encode(text: String): QrMatrix {
        val bytes = text.toByteArray(StandardCharsets.UTF_8)
        require(bytes.size <= MAX_QR_BYTE_CAPACITY) {
            "QR payload length (${bytes.size} bytes) exceeds maximum QR version 40-L capacity ($MAX_QR_BYTE_CAPACITY bytes)."
        }

        var version = 1
        while (version <= 40 && getByteCapacity(version) < bytes.size) {
            version++
        }
        require(version <= 40) { "Unable to fit ${bytes.size} bytes in QR Versions 1..40." }

        val size = version * 4 + 17
        val dataCodewords = encodeDataCodewords(bytes, version)
        val allCodewords = addEccAndInterleave(dataCodewords, version)

        val modules = Array(size) { BooleanArray(size) }
        val isFunction = Array(size) { BooleanArray(size) }

        drawFunctionPatterns(version, size, modules, isFunction)
        drawCodewords(allCodewords, size, modules, isFunction)

        var bestMask = 0
        var minPenalty = Int.MAX_VALUE
        for (mask in 0 until 8) {
            applyMask(mask, size, modules, isFunction)
            drawFormatBits(mask, size, modules, isFunction)
            val penalty = getPenaltyScore(size, modules)
            if (penalty < minPenalty) {
                minPenalty = penalty
                bestMask = mask
            }
            applyMask(mask, size, modules, isFunction)
        }

        applyMask(bestMask, size, modules, isFunction)
        drawFormatBits(bestMask, size, modules, isFunction)

        return QrMatrix(version = version, size = size, modules = modules)
    }
}

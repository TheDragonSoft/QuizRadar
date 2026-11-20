package com.quizradar.app.feedback

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.exp
import kotlin.math.sqrt

/** Requires three distinct acceleration peaks, not one hard movement or a noisy sensor. */
internal class ShakeMotionEvaluator(
    private val peakThreshold: Float = 10.5f,
    private val requiredPeaks: Int = 3,
    private val peakWindowMs: Long = 1_200L,
    private val minimumPeakGapMs: Long = 180L,
    private val cooldownMs: Long = 2_500L,
    private val removeGravity: Boolean = true,
) {
    private var gravityX = 0f
    private var gravityY = 0f
    private var gravityZ = 0f
    private var initialized = false
    private var lastSampleAtMs = Long.MIN_VALUE
    private val recentPeakTimestampsMs = ArrayDeque<Long>()
    private var lastPeakAtMs = Long.MIN_VALUE
    private var lastTriggerAtMs = Long.MIN_VALUE

    fun reset() {
        initialized = false
        lastSampleAtMs = Long.MIN_VALUE
        recentPeakTimestampsMs.clear()
        lastPeakAtMs = Long.MIN_VALUE
        lastTriggerAtMs = Long.MIN_VALUE
    }

    fun onSample(
        x: Float,
        y: Float,
        z: Float,
        timestampMs: Long,
    ): Boolean {
        if (timestampMs < 0L || (lastSampleAtMs != Long.MIN_VALUE && timestampMs < lastSampleAtMs)) {
            reset()
            return false
        }
        val magnitude =
            if (!removeGravity) {
                lastSampleAtMs = timestampMs
                sqrt(x * x + y * y + z * z)
            } else {
                if (!initialized) {
                    gravityX = x
                    gravityY = y
                    gravityZ = z
                    lastSampleAtMs = timestampMs
                    initialized = true
                    return false
                }
                // Time-constant low-pass gravity estimate so 50 Hz emulators and 200-400 Hz phones behave consistently.
                val dtMs = (timestampMs - lastSampleAtMs).coerceIn(1L, 1_000L)
                lastSampleAtMs = timestampMs
                val alpha = exp(-dtMs.toDouble() / GRAVITY_TIME_CONSTANT_MS).toFloat()
                gravityX = alpha * gravityX + (1f - alpha) * x
                gravityY = alpha * gravityY + (1f - alpha) * y
                gravityZ = alpha * gravityZ + (1f - alpha) * z
                val linearX = x - gravityX
                val linearY = y - gravityY
                val linearZ = z - gravityZ
                sqrt(linearX * linearX + linearY * linearY + linearZ * linearZ)
            }
        if (magnitude < peakThreshold) return false
        if (lastTriggerAtMs != Long.MIN_VALUE && timestampMs - lastTriggerAtMs < cooldownMs) return false
        if (lastPeakAtMs != Long.MIN_VALUE && timestampMs - lastPeakAtMs < minimumPeakGapMs) return false

        while (recentPeakTimestampsMs.isNotEmpty() && timestampMs - recentPeakTimestampsMs.first() > peakWindowMs) {
            recentPeakTimestampsMs.removeFirst()
        }
        recentPeakTimestampsMs.addLast(timestampMs)
        lastPeakAtMs = timestampMs
        if (recentPeakTimestampsMs.size < requiredPeaks) return false

        recentPeakTimestampsMs.clear()
        lastTriggerAtMs = timestampMs
        return true
    }

    private companion object {
        const val GRAVITY_TIME_CONSTANT_MS = 800.0
    }
}

internal class ShakeDetector(
    context: Context,
    private val onShake: () -> Unit,
) : SensorEventListener {
    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val linearAccelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
    private val accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private var activeSensorType: Int? = null
    private var evaluator = ShakeMotionEvaluator(removeGravity = true)
    private var registered = false

    fun start(): Boolean {
        if (registered) return true
        val manager = sensorManager ?: return false
        // Prefer hardware-fused linear acceleration (gravity already removed) and fall back to raw accelerometer.
        val preferredSensor = linearAccelerometer ?: accelerometer ?: return false
        val usesLinear = preferredSensor.type == Sensor.TYPE_LINEAR_ACCELERATION
        evaluator = ShakeMotionEvaluator(removeGravity = !usesLinear)
        if (manager.registerListener(this, preferredSensor, SensorManager.SENSOR_DELAY_GAME)) {
            activeSensorType = preferredSensor.type
            registered = true
            return true
        }
        if (usesLinear && accelerometer != null) {
            evaluator = ShakeMotionEvaluator(removeGravity = true)
            if (manager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME)) {
                activeSensorType = Sensor.TYPE_ACCELEROMETER
                registered = true
                return true
            }
        }
        activeSensorType = null
        return false
    }

    fun stop() {
        if (registered) sensorManager?.unregisterListener(this)
        registered = false
        activeSensorType = null
        evaluator.reset()
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != activeSensorType || event.values.size < 3) return
        if (evaluator.onSample(event.values[0], event.values[1], event.values[2], event.timestamp / 1_000_000L)) {
            onShake()
        }
    }

    override fun onAccuracyChanged(
        sensor: Sensor?,
        accuracy: Int,
    ) = Unit
}

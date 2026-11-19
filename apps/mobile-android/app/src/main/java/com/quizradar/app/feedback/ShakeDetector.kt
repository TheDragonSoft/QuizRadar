package com.quizradar.app.feedback

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.sqrt

/** Requires three distinct acceleration peaks, not one hard movement or a noisy sensor. */
internal class ShakeMotionEvaluator(
    private val peakThreshold: Float = 10.5f,
    private val requiredPeaks: Int = 3,
    private val peakWindowMs: Long = 1_200L,
    private val minimumPeakGapMs: Long = 180L,
    private val cooldownMs: Long = 2_500L,
) {
    private var gravityX = 0f
    private var gravityY = 0f
    private var gravityZ = 0f
    private var initialized = false
    private var peakCount = 0
    private var firstPeakAtMs = 0L
    private var lastPeakAtMs = Long.MIN_VALUE
    private var lastTriggerAtMs = Long.MIN_VALUE

    fun reset() {
        initialized = false
        peakCount = 0
        firstPeakAtMs = 0L
        lastPeakAtMs = Long.MIN_VALUE
        lastTriggerAtMs = Long.MIN_VALUE
    }

    fun onSample(
        x: Float,
        y: Float,
        z: Float,
        timestampMs: Long,
    ): Boolean {
        if (!initialized) {
            gravityX = x
            gravityY = y
            gravityZ = z
            initialized = true
            return false
        }
        if (timestampMs < 0L || (lastPeakAtMs != Long.MIN_VALUE && timestampMs < lastPeakAtMs)) {
            reset()
            return false
        }

        // A low-pass gravity estimate leaves the phone's linear acceleration.
        gravityX = GRAVITY_ALPHA * gravityX + (1f - GRAVITY_ALPHA) * x
        gravityY = GRAVITY_ALPHA * gravityY + (1f - GRAVITY_ALPHA) * y
        gravityZ = GRAVITY_ALPHA * gravityZ + (1f - GRAVITY_ALPHA) * z
        val linearX = x - gravityX
        val linearY = y - gravityY
        val linearZ = z - gravityZ
        val magnitude = sqrt(linearX * linearX + linearY * linearY + linearZ * linearZ)
        if (magnitude < peakThreshold) return false
        if (lastTriggerAtMs != Long.MIN_VALUE && timestampMs - lastTriggerAtMs < cooldownMs) return false
        if (lastPeakAtMs != Long.MIN_VALUE && timestampMs - lastPeakAtMs < minimumPeakGapMs) return false

        if (peakCount == 0 || timestampMs - firstPeakAtMs > peakWindowMs) {
            peakCount = 0
            firstPeakAtMs = timestampMs
        }
        peakCount += 1
        lastPeakAtMs = timestampMs
        if (peakCount < requiredPeaks) return false

        peakCount = 0
        lastTriggerAtMs = timestampMs
        return true
    }

    private companion object {
        const val GRAVITY_ALPHA = 0.8f
    }
}

internal class ShakeDetector(
    context: Context,
    private val onShake: () -> Unit,
) : SensorEventListener {
    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val evaluator = ShakeMotionEvaluator()
    private var registered = false

    fun start(): Boolean {
        if (registered) return true
        val sensor = accelerometer ?: return false
        registered = sensorManager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME)
        return registered
    }

    fun stop() {
        if (registered) sensorManager.unregisterListener(this)
        registered = false
        evaluator.reset()
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER || event.values.size < 3) return
        if (evaluator.onSample(event.values[0], event.values[1], event.values[2], event.timestamp / 1_000_000L)) {
            onShake()
        }
    }

    override fun onAccuracyChanged(
        sensor: Sensor?,
        accuracy: Int,
    ) = Unit
}

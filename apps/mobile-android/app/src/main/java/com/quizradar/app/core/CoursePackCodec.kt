package com.quizradar.app.core

/**
 * Thin Android facade over Rust `core::sync::course_pack` (UniFFI).
 *
 * All wire encoding (`#course=` HTTPS links and `quizradar://course?d=` deep
 * links), privacy scrubbing (excluding grades, completed topics, private URLs),
 * and QR generation live once in pure Rust `core/src/sync/course_pack.rs`.
 */
object CoursePackCodec {
    const val WEB_BASE_URL = "https://thedragonsoft.github.io/QuizRadar/app/"

    fun encode(
        courseId: String,
        scheduleJson: String,
        assessmentsJson: String,
        webBaseUrl: String? = WEB_BASE_URL,
    ): String =
        try {
            encodeCoursePack(courseId, scheduleJson, assessmentsJson, webBaseUrl)
        } catch (e: QuizRadarFfiException) {
            throw IllegalArgumentException(e.message ?: "Course Pack encoding failed", e)
        }

    fun decode(rawInput: String): String =
        try {
            decodeCoursePackLink(rawInput)
        } catch (e: QuizRadarFfiException) {
            throw IllegalArgumentException(e.message ?: "Invalid Course Pack link", e)
        }

    fun toDomain(
        packJson: String,
        refDateIso: String,
    ): String =
        try {
            coursePackToDomainJson(packJson, refDateIso)
        } catch (e: QuizRadarFfiException) {
            throw IllegalArgumentException(e.message ?: "Invalid Course Pack payload", e)
        }
}

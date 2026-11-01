package com.quizradar.app.ui

/**
 * The academic-rhythm presets the onboarding wizard collects (`01` §4.1:
 * Medicine / Business / Sciences).
 *
 * The ids are the SAME ones the web and desktop tiers persist (`med` / `eng` /
 * `biz`), so one `academic_track` value means one thing on every shell - a
 * backup exported from one device carries a preset the other device can read.
 */
val ACADEMIC_TRACKS: List<Pair<String, String>> =
    listOf(
        "med" to "Medicine & Health Sciences",
        "eng" to "Engineering & Sciences",
        "biz" to "Business & Humanities",
    )

/**
 * The label of the saved preset, or an honest line when nothing is saved (or
 * when the saved value names a preset that no longer exists).
 */
fun academicTrackLabel(savedTrack: String?): String {
    if (savedTrack.isNullOrBlank()) return "Not set"
    val known = ACADEMIC_TRACKS.firstOrNull { it.first == savedTrack }
    return known?.second ?: "$savedTrack (not one of the current presets)"
}

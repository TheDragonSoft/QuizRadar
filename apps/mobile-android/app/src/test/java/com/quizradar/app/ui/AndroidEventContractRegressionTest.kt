package com.quizradar.app.ui

import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.CustomEventModel
import com.quizradar.app.model.QuizRadarJsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

/**
 * Regression coverage for the custom-event wire contract (audit A01) and the
 * AI provenance fields (audit A13).
 *
 * The core serializes `CustomCalendarEvent.date` as `date_iso`
 * (`core/src/types.rs:723`) and has NO `date` alias — a payload carrying
 * `date` is an UNDATED event for the core. These tests fail if either side
 * of the shell reverts to the legacy `date` key, or if the provenance fields
 * are dropped at the Android boundary again.
 */
@RunWith(RobolectricTestRunner::class)
class AndroidEventContractRegressionTest {
    private val refDate = LocalDate.parse("2026-11-10")
    private val eventDate = LocalDate.parse("2026-11-15")

    /** The same Main-swap idiom [QuizRadarViewModelTest] uses for viewModelScope work. */
    @OptIn(ExperimentalCoroutinesApi::class)
    private val testDispatcher = StandardTestDispatcher()

    @OptIn(ExperimentalCoroutinesApi::class)
    @Before
    fun setUpMain() {
        Dispatchers.setMain(testDispatcher)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @After
    fun tearDownMain() {
        Dispatchers.resetMain()
    }

    /** A01 read side: only `date_iso` is read; a `date` key yields an undated event. */
    @Test
    fun parseCustomEvent_reads_canonical_date_iso_key_only() {
        val canonical =
            JSONObject()
                .put("id", "evt-1")
                .put("title", "Class Quiz 1")
                .put("date_iso", eventDate.toString())

        val parsed = QuizRadarJsonParser.parseCustomEvent(canonical)

        assertEquals(eventDate, parsed.dateIso)

        // The legacy key the shell used to write: the core itself stores this
        // as None, so the shell must not show a date the core never kept.
        val legacyKey =
            JSONObject()
                .put("id", "evt-1")
                .put("title", "Class Quiz 1")
                .put("date", eventDate.toString())

        assertNull(
            "A `date` payload must stay undated (no core alias)",
            QuizRadarJsonParser.parseCustomEvent(legacyKey).dateIso,
        )
    }

    /** A01 write side: a `date_iso` payload roundtrips a REAL core event with its date. */
    @Test
    fun custom_event_with_date_iso_roundtrips_real_core() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
            val eventJson =
                """
                {
                    "id": "evt-roundtrip",
                    "title": "Class Quiz 1",
                    "event_type": "Custom",
                    "date_iso": "$eventDate",
                    "start_time": "10:00",
                    "end_time": "11:00",
                    "room": "",
                    "notes": "",
                    "color": "#db2777"
                }
                """.trimIndent()

            engine.upsertCustomEvent(eventJson, refDate)
            val snapshot = QuizRadarJsonParser.parseAppSnapshot(engine.getState(refDate))

            val stored = snapshot.customEvents.firstOrNull { it.id == "evt-roundtrip" }
            assertTrue("Custom event must survive the core roundtrip", stored != null)
            assertEquals(eventDate, stored!!.dateIso)
        }

    /**
     * A01 write side, end to end: the REAL [QuizRadarViewModel.addCustomEvent]
     * serialization must use `date_iso`. This exercises the ViewModel's own
     * JSONObject write (not a hand-written payload): a revert to the legacy
     * `date` key makes the core store the event UNDATED and fails here.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun viewmodel_addCustomEvent_serializes_the_canonical_date_iso_key() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel =
                QuizRadarViewModel(engine, clockDate = { refDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertTrue("UI state must be Ready", viewModel.uiState.value is UiState.Ready)

            var saved = false
            viewModel.addCustomEvent(
                CustomEventModel(
                    id = "evt-viewmodel",
                    title = "Class Quiz 1",
                    eventType = "Custom",
                    dateIso = eventDate,
                    startTime = "10:00",
                    endTime = "11:00",
                ),
            ) { saved = it }
            advanceUntilIdle()

            assertTrue("the ViewModel must report the save as successful", saved)

            val snapshot = QuizRadarJsonParser.parseAppSnapshot(engine.getState(refDate))
            val stored = snapshot.customEvents.firstOrNull { it.id == "evt-viewmodel" }
            assertTrue("the ViewModel-saved event must reach the core", stored != null)
            assertEquals(
                "the ViewModel write must use `date_iso` - a legacy `date` key would leave the core event undated",
                eventDate,
                stored!!.dateIso,
            )
        }

    /**
     * A01 negative: writing the legacy `date` key makes the REAL core store
     * the event as undated — the silent data loss the write-side fix removed.
     */
    @Test
    fun legacy_date_write_key_makes_real_core_store_undated_event() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
            val eventJson =
                """
                {
                    "id": "evt-typo",
                    "title": "Class Quiz 1",
                    "event_type": "Custom",
                    "date": "$eventDate",
                    "start_time": "10:00",
                    "end_time": "11:00"
                }
                """.trimIndent()

            engine.upsertCustomEvent(eventJson, refDate)
            val snapshot = QuizRadarJsonParser.parseAppSnapshot(engine.getState(refDate))

            val stored = snapshot.customEvents.firstOrNull { it.id == "evt-typo" }
            assertTrue("Event must exist even when undated", stored != null)
            assertNull("Core has no `date` alias — the event must be undated", stored!!.dateIso)
        }

    /** A13: provenance fields are retained (not stripped at the Android boundary). */
    @Test
    fun assessment_provenance_fields_are_retained() {
        val assessment =
            JSONObject()
                .put("id", "asg-1")
                .put("title", "Class Quiz 1")
                .put("ai_inference_note", "Date inferred from announcement wording")
                .put("ai_study_plan", "Two focused sessions before the quiz")
                .put("estimated_study_hours", 4.5)

        val parsed = QuizRadarJsonParser.parseAssessment(assessment)

        assertEquals("Date inferred from announcement wording", parsed.aiInferenceNote)
        assertEquals("Two focused sessions before the quiz", parsed.aiStudyPlan)
        assertEquals(4.5f, parsed.estimatedStudyHours!!, 0f)
    }

    /** A13: fully user-created items omit provenance — the defaults stay null. */
    @Test
    fun assessment_without_provenance_defaults_to_null() {
        val assessment =
            JSONObject()
                .put("id", "asg-2")
                .put("title", "Final Exam")

        val parsed = QuizRadarJsonParser.parseAssessment(assessment)

        assertNull(parsed.aiInferenceNote)
        assertNull(parsed.aiStudyPlan)
        assertNull(parsed.estimatedStudyHours)
    }
}

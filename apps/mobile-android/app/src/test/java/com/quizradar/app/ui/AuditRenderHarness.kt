package com.quizradar.app.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import com.quizradar.app.core.MemoryTokenStore
import com.quizradar.app.core.QuizRadarCore
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.model.SyncReportModel
import com.quizradar.app.model.SyncSourceReportModel
import com.quizradar.app.ui.components.AccountSheet
import com.quizradar.app.ui.components.AddActionMenuSheet
import com.quizradar.app.ui.components.AmoledStarrySky
import com.quizradar.app.ui.components.HelpSheet
import com.quizradar.app.ui.components.ManualAssessmentSheet
import com.quizradar.app.ui.components.SearchSheet
import com.quizradar.app.ui.detail.AssessmentDetailSheet
import com.quizradar.app.ui.detail.CourseEditorSheet
import com.quizradar.app.ui.detail.CreateEventSheet
import com.quizradar.app.ui.screens.SettingsScreen
import com.quizradar.app.ui.share.SharedEventDraft
import com.quizradar.app.ui.theme.QuizRadarTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import java.io.File
import java.io.FileOutputStream
import java.time.LocalDate

/**
 * Deviceless Robolectric + Compose UI render harness for visual UX auditing.
 *
 * Renders screens across QuizRadar Android's three implemented themes
 * (solar = light, obsidian = default dark, amoled = pure black + starfield)
 * and states (empty, error/loading, populated-fixture) into
 * `audit-capture/android-rendered/`.
 *
 * Notes:
 * - Every populated capture uses explicit fixture data and carries `fixture`
 *   in its filename (Honesty Doctrine, AGENTS.md §3.1).
 * - Web themes `aurora` and `editorial` do not exist on Android
 *   (`QuizRadarTheme.kt`), nor do they ship in the current `apps/web` theme list.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class AuditRenderHarness {
    @get:Rule
    val composeTestRule = createComposeRule()

    private val refDate: LocalDate = LocalDate.of(2026, 11, 2)

    private data class ThemeSpec(
        val id: String,
        val dark: Boolean,
        val amoled: Boolean,
        val modePref: String,
        val darkPref: String,
    )

    private val themes =
        listOf(
            ThemeSpec("solar", dark = false, amoled = false, modePref = "light", darkPref = "obsidian"),
            ThemeSpec("obsidian", dark = true, amoled = false, modePref = "dark", darkPref = "obsidian"),
            ThemeSpec("amoled", dark = true, amoled = true, modePref = "dark", darkPref = "amoled"),
        )

    private val outputDir: File by lazy {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").canonicalFile
        while (dir != null && !File(dir, "tooling/version.json").exists()) {
            dir = dir.parentFile
        }
        val repoRoot = dir ?: File(System.getProperty("user.dir") ?: ".").resolve("../../..").canonicalFile
        File(repoRoot, "audit-capture/android-rendered").apply { mkdirs() }
    }

    private class HangingLoadCore(
        delegate: QuizRadarCore,
    ) : QuizRadarCore by delegate {
        override suspend fun getState(refDate: LocalDate): String = CompletableDeferred<String>().await()
    }

    private class FailingLoadCore(
        delegate: QuizRadarCore,
    ) : QuizRadarCore by delegate {
        override suspend fun getState(refDate: LocalDate): String =
            throw IllegalStateException("SQLite disk image is malformed (audit error state)")
    }

    private fun createEmptyEngine(onboardingCompleted: Boolean = true): QuizRadarEngine {
        val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
        runBlocking {
            engine.setConfigBool("onboarding_completed", onboardingCompleted)
        }
        return engine
    }

    private fun createPopulatedEngine(onboardingCompleted: Boolean = true): QuizRadarEngine {
        val tokens =
            MemoryTokenStore().apply {
                setGoogleRefreshToken("fixture-google-refresh-token")
                setMicrosoftRefreshToken("fixture-microsoft-refresh-token")
            }
        val engine =
            QuizRadarEngine.createInMemory(
                tokenProvider = tokens,
                coreDispatcher = Dispatchers.Unconfined,
            )
        runBlocking {
            engine.setConfigBool("onboarding_completed", onboardingCompleted)
            engine.setConfigString("user_name", "Nadia Mansour")
            engine.setConfigString("user_email", "nadia.mansour@university.edu")
            engine.setConfigString("last_gmail_sync", "Nov 2 · 08:15")
            engine.setConfigString("academic_track", "eng")

            engine.upsertCourse(
                """{ "id": "CS301", "name": "Algorithms & Complexity", "color": "#2563eb", "credits": 3.0, "max_absences": 4 }""",
                """
                [
                    {
                        "id": "slot-cs301-mon",
                        "day": "Mon",
                        "course_id": "CS301",
                        "course_name": "Algorithms & Complexity",
                        "type": "Lecture",
                        "start_time": "09:00",
                        "end_time": "10:30",
                        "display_time": "09:00–10:30",
                        "room": "Hall 302",
                        "instructor": "Dr. Kareem Adel",
                        "group": "A"
                    },
                    {
                        "id": "slot-cs301-wed",
                        "day": "Wed",
                        "course_id": "CS301",
                        "course_name": "Algorithms & Complexity",
                        "type": "Lab",
                        "start_time": "11:00",
                        "end_time": "12:30",
                        "display_time": "11:00–12:30",
                        "room": null,
                        "instructor": "Eng. Salma Nabil",
                        "group": "Lab-2"
                    }
                ]
                """.trimIndent(),
                refDate,
            )

            engine.upsertCourse(
                """{ "id": "MATH204", "name": "Linear Algebra II", "color": "#7c3aed", "credits": 3.0 }""",
                """
                [
                    {
                        "id": "slot-math204-tue",
                        "day": "Tue",
                        "course_id": "MATH204",
                        "course_name": "Linear Algebra II",
                        "type": "Lecture",
                        "start_time": "11:00",
                        "end_time": "12:30",
                        "display_time": "11:00–12:30",
                        "room": "Auditorium B",
                        "instructor": "Prof. Hany Farid",
                        "week_parity": "week_a"
                    },
                    {
                        "id": "slot-math204-thu",
                        "day": "Thu",
                        "course_id": "MATH204",
                        "course_name": "Linear Algebra II",
                        "type": "Tutorial",
                        "start_time": "14:00",
                        "end_time": "15:30",
                        "display_time": "14:00–15:30",
                        "room": "Bldg 4 · 108"
                    }
                ]
                """.trimIndent(),
                refDate,
            )

            engine.upsertCourse(
                """{ "id": "PHYS102", "name": "Electromagnetism", "color": "#059669" }""",
                """
                [
                    {
                        "id": "slot-phys102-mon",
                        "day": "Mon",
                        "course_id": "PHYS102",
                        "course_name": "Electromagnetism",
                        "type": "Lecture",
                        "start_time": "14:00",
                        "end_time": "15:30",
                        "display_time": "14:00–15:30",
                        "room": "Science 101"
                    }
                ]
                """.trimIndent(),
                refDate,
            )

            engine.replaceAssessments(
                """
                [
                    {
                        "id": "assign-phys102",
                        "title": "Problem Set 4: Maxwell Equations",
                        "course_id": "PHYS102",
                        "course_name": "Electromagnetism",
                        "assessment_type": "Assignment",
                        "date_iso": "2026-11-02",
                        "start_time": "17:00",
                        "end_time": "18:00",
                        "display_time": "Mon, Nov 2 · 17:00–18:00",
                        "room": null,
                        "instructor": "Dr. Tarek Hassan",
                        "topics": ["Gauss Law", "Ampere Law", "Faraday Induction"],
                        "warnings": [],
                        "source": "Classroom",
                        "ai_inference_note": "No date in the announcement — matched course due window"
                    },
                    {
                        "id": "quiz-cs301",
                        "title": "Class Quiz 1: Graph & DP",
                        "course_id": "CS301",
                        "course_name": "Algorithms & Complexity",
                        "assessment_type": "Class Quiz",
                        "date_iso": "2026-11-03",
                        "start_time": "10:00",
                        "end_time": "11:00",
                        "display_time": "Tue, Nov 3 · 10:00–11:00",
                        "room": null,
                        "instructor": "Dr. Kareem Adel",
                        "topics": ["BFS & DFS", "Dynamic Programming", "Greedy Proofs"],
                        "warnings": ["Closed book — no formula sheet"],
                        "source": "Gmail",
                        "ai_inference_note": "Estimated (local heuristic): resolved 'next Tuesday' against CS301 slot",
                        "conflict_warning": "Clashes with MATH204 morning prep"
                    },
                    {
                        "id": "midterm-math204",
                        "title": "Midterm Exam",
                        "course_id": "MATH204",
                        "course_name": "Linear Algebra II",
                        "assessment_type": "Midterm Exam",
                        "date_iso": "2026-11-05",
                        "start_time": "14:00",
                        "end_time": "16:00",
                        "display_time": "Thu, Nov 5 · 14:00–16:00",
                        "room": "Auditorium B",
                        "instructor": "Prof. Hany Farid",
                        "topics": ["Eigenvalues", "Singular Value Decomposition", "Orthogonality"],
                        "warnings": ["Bring student ID"],
                        "source": "Teams",
                        "ai_inference_note": "Parsed from announcement"
                    }
                ]
                """.trimIndent(),
                refDate,
            )

            engine.upsertCustomEvent(
                """
                {
                    "id": "evt-study-1",
                    "title": "DP Problem Drill",
                    "course_id": "CS301",
                    "event_type": "Study Block",
                    "date_iso": "2026-11-02",
                    "start_time": "11:30",
                    "end_time": "12:30",
                    "room": null,
                    "notes": "Focus on knapsack & DAG shortest paths",
                    "color": "#db2777"
                }
                """.trimIndent(),
                refDate,
            )

            engine.updateGrade(
                assessmentId = "midterm-math204",
                achieved = 42.0,
                max = 50.0,
                weightage = 30.0,
                clearAchieved = false,
                clearMax = false,
                clearWeightage = false,
                refDate = refDate,
            )

            engine.toggleTopic(
                topicKey = com.quizradar.app.core.topicKey("quiz-cs301", "BFS & DFS"),
                done = true,
                refDate = refDate,
            )

            engine.recordAttendance("slot-cs301-mon", "CS301", refDate, "absent", refDate)

            engine.upsertFlashcard(
                """
                {
                    "id": "fc-1",
                    "course_id": "CS301",
                    "assessment_id": "quiz-cs301",
                    "topic": "Graph Algorithms",
                    "front": "What is Dijkstra's time complexity with a binary heap?",
                    "back": "O((V + E) log V)",
                    "box_level": 2,
                    "next_review_iso": "2026-11-04"
                }
                """.trimIndent(),
            )
            engine.upsertFlashcard(
                """
                {
                    "id": "fc-2",
                    "course_id": "MATH204",
                    "assessment_id": "midterm-math204",
                    "topic": "Spectral Theory",
                    "front": "What characterizes a real symmetric matrix's eigenvectors?",
                    "back": "All eigenvalues are real and eigenvectors for distinct eigenvalues are orthogonal.",
                    "box_level": 1,
                    "next_review_iso": "2026-11-03"
                }
                """.trimIndent(),
            )

            engine.saveQuizAttempt(
                attemptJson =
                    """
                    {
                        "id": "att-1",
                        "assessment_id": "quiz-cs301",
                        "course_id": "CS301",
                        "timestamp": "2026-11-01T18:15:00Z",
                        "score": 2,
                        "total_questions": 4,
                        "passed": false
                    }
                    """.trimIndent(),
                mistakesJson =
                    """
                    [
                        {
                            "id": "mis-1",
                            "attempt_id": "att-1",
                            "assessment_id": "quiz-cs301",
                            "course_id": "CS301",
                            "question_id": "q-1",
                            "question_text": "Which shortest-path algorithm handles negative edge weights?",
                            "options": ["Dijkstra", "Bellman-Ford", "Prim", "Kruskal"],
                            "selected_index": 0,
                            "correct_index": 1,
                            "explanation": "Dijkstra assumes non-negative edge weights; Bellman-Ford relaxes all edges |V|-1 times.",
                            "timestamp": "2026-11-01T18:15:00Z",
                            "resolved": false
                        },
                        {
                            "id": "mis-2",
                            "attempt_id": "att-1",
                            "assessment_id": "quiz-cs301",
                            "course_id": "CS301",
                            "question_id": "q-2",
                            "question_text": "When does greedy choice property hold?",
                            "options": ["Optimal solution contains greedy first choice", "Only on trees"],
                            "selected_index": 1,
                            "correct_index": 0,
                            "explanation": "A globally optimal solution can be arrived at by making a locally optimal choice.",
                            "timestamp": "2026-11-01T18:16:00Z",
                            "resolved": true
                        }
                    ]
                    """.trimIndent(),
                refDate = refDate,
            )

            engine.logStudySession(
                """
                {
                    "id": "sess-1",
                    "course_id": "CS301",
                    "topic": "Dynamic Programming",
                    "duration_minutes": 45,
                    "timestamp": "2026-11-02T10:30:00Z",
                    "date_iso": "2026-11-02"
                }
                """.trimIndent(),
                refDate,
            )
            engine.logStudySession(
                """
                {
                    "id": "sess-2",
                    "course_id": "MATH204",
                    "topic": "Eigenvalues",
                    "duration_minutes": 30,
                    "timestamp": "2026-11-01T16:00:00Z",
                    "date_iso": "2026-11-01"
                }
                """.trimIndent(),
                refDate,
            )

            engine.saveFeed(
                """
                {
                    "id": "feed-lms-1",
                    "name": "University LMS Calendar",
                    "url": "https://lms.university.edu/calendar/export.ics",
                    "enabled": true
                }
                """.trimIndent(),
                refDate,
            )
        }
        return engine
    }

    private fun newViewModel(
        core: QuizRadarCore,
        themeSpec: ThemeSpec = themes[1],
    ): QuizRadarViewModel {
        // Theme prefs go through the STORE before the VM's first load, so
        // loadState's config read (QuizRadarViewModel.kt:766) seeds the flows
        // with the audit theme instead of racing a post-construction setter.
        if (core is QuizRadarEngine) {
            runBlocking {
                core.setConfigString("theme_mode", themeSpec.modePref)
                core.setConfigString("preferred_dark_theme", themeSpec.darkPref)
            }
        }
        val vm =
            QuizRadarViewModel(
                core = core,
                coreDispatcher = Dispatchers.Main.immediate,
                clockDate = { refDate },
            )
        return vm
    }

    private fun injectFailedScanReport(viewModel: QuizRadarViewModel) {
        val field = QuizRadarViewModel::class.java.getDeclaredField("_lastScanReport")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val flow = field.get(viewModel) as MutableStateFlow<SyncReportModel?>
        flow.value =
            SyncReportModel(
                success = false,
                totalNew = 0,
                totalUpdated = 0,
                notes = listOf("Gmail OAuth token expired — reconnect Google to resume scanning."),
                perSource =
                    listOf(
                        SyncSourceReportModel(
                            name = "Gmail",
                            status = "failed",
                            detail = "OAuth token expired (HTTP 401)",
                            found = 0,
                        ),
                    ),
            )
    }

    /** Bounded wait for the async first load, then the snapshot. */
    private fun awaitReady(viewModel: QuizRadarViewModel): AppSnapshotModel {
        composeTestRule.waitUntil(timeoutMillis = 15_000) {
            viewModel.uiState.value is UiState.Ready
        }
        return (viewModel.uiState.value as UiState.Ready).snapshot
    }

    @Composable
    private fun AuditThemeWrapper(
        themeSpec: ThemeSpec,
        content: @Composable () -> Unit,
    ) {
        QuizRadarTheme(darkTheme = themeSpec.dark, isAmoled = themeSpec.amoled) {
            Box(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .background(if (themeSpec.amoled) Color.Black else MaterialTheme.colorScheme.background),
            ) {
                if (themeSpec.amoled) {
                    AmoledStarrySky(modifier = Modifier.fillMaxSize())
                }
                content()
            }
        }
    }

    private fun advanceAndCapture(
        name: String,
        advanceMs: Long = 1_500L,
    ) {
        ShadowLooper.idleMainLooper()
        val steps = (advanceMs / 32L).coerceIn(4L, 64L).toInt()
        repeat(steps) {
            composeTestRule.mainClock.advanceTimeBy(32L)
            ShadowLooper.idleMainLooper()
        }

        @Suppress("UNCHECKED_CAST")
        val activity = (composeTestRule as AndroidComposeTestRule<*, *>).activity
        val decor = activity.window.decorView
        val baseWidth = if (decor.width > 0) decor.width else 411
        val baseHeight = if (decor.height > 0) decor.height else 891
        val finalBitmap = Bitmap.createBitmap(baseWidth, baseHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(finalBitmap)
        decor.draw(canvas)

        val rootViews =
            composeTestRule
                .onAllNodes(isRoot())
                .fetchSemanticsNodes(atLeastOneRootRequired = false)
                .mapNotNull { node -> (node.root as? ViewRootForTest)?.view?.rootView }
                .distinct()
        val scrimPaint = Paint().apply { color = android.graphics.Color.argb(115, 0, 0, 0) }
        for (rootView in rootViews) {
            if (rootView !== decor) {
                if (rootView.width <= 0 || rootView.height <= 0) {
                    rootView.measure(
                        View.MeasureSpec.makeMeasureSpec(baseWidth, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(baseHeight, View.MeasureSpec.AT_MOST),
                    )
                    rootView.layout(0, 0, rootView.measuredWidth, rootView.measuredHeight)
                }
                canvas.drawRect(0f, 0f, baseWidth.toFloat(), baseHeight.toFloat(), scrimPaint)
                val top =
                    if (rootView.height < baseHeight) {
                        (baseHeight - rootView.height).toFloat()
                    } else {
                        0f
                    }
                val left = ((baseWidth - rootView.width) / 2f).coerceAtLeast(0f)
                canvas.save()
                canvas.translate(left, top)
                rootView.draw(canvas)
                canvas.restore()
            }
        }

        val outFile = File(outputDir, "$name.png")
        outFile.parentFile?.mkdirs()
        FileOutputStream(outFile).use { stream ->
            assertTrue("PNG compression failed for $name", finalBitmap.compress(Bitmap.CompressFormat.PNG, 100, stream))
        }
        println("AuditRenderHarness: wrote ${outFile.absolutePath} (${outFile.length()} bytes, roots=${rootViews.size})")
    }

    @Test
    fun renderPrimaryScreensAcrossThemesAndStates() {
        composeTestRule.mainClock.autoAdvance = false
        var scene by mutableStateOf<Pair<String, @Composable () -> Unit>>("init" to {})
        composeTestRule.setContent {
            val (sceneKey, content) = scene
            key(sceneKey) {
                content()
            }
        }

        for (theme in themes) {
            // 1. Loading & Error at Root Shell
            val loadingVm = newViewModel(HangingLoadCore(createEmptyEngine()), theme)
            scene = "app_loading_${theme.id}" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = loadingVm) }
            }
            advanceAndCapture("app_loading_${theme.id}")

            val errorVm = newViewModel(FailingLoadCore(createEmptyEngine()), theme)
            scene = "app_error_${theme.id}" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = errorVm) }
            }
            advanceAndCapture("app_error_${theme.id}")

            // 2. Empty state across every primary destination
            val emptyVm = newViewModel(createEmptyEngine(onboardingCompleted = true), theme)
            emptyVm.selectTab("Dashboard")
            scene = "dashboard_${theme.id}_empty" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = emptyVm) }
            }
            advanceAndCapture("dashboard_${theme.id}_empty")

            val scanErrEmptyVm = newViewModel(createEmptyEngine(onboardingCompleted = true), theme)
            injectFailedScanReport(scanErrEmptyVm)
            scanErrEmptyVm.selectTab("Dashboard")
            scene = "dashboard_${theme.id}_error" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = scanErrEmptyVm) }
            }
            advanceAndCapture("dashboard_${theme.id}_error")

            emptyVm.selectTab("Tasks")
            scene = "tasks_${theme.id}_empty" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = emptyVm) }
            }
            advanceAndCapture("tasks_${theme.id}_empty")

            scanErrEmptyVm.selectTab("Tasks")
            scene = "tasks_${theme.id}_error" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = scanErrEmptyVm) }
            }
            advanceAndCapture("tasks_${theme.id}_error")

            emptyVm.selectTab("Calendar")
            scene = "calendar_3day_${theme.id}_empty" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = emptyVm) }
            }
            advanceAndCapture("calendar_3day_${theme.id}_empty")

            composeTestRule.onAllNodesWithText("Week").onFirst().performClick()
            advanceAndCapture("calendar_week_${theme.id}_empty")

            composeTestRule.onAllNodesWithText("Day").onFirst().performClick()
            advanceAndCapture("calendar_day_agenda_${theme.id}_empty")

            emptyVm.selectTab("Grades")
            scene = "grades_${theme.id}_empty" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = emptyVm) }
            }
            advanceAndCapture("grades_${theme.id}_empty")

            emptyVm.selectTab("Focus")
            scene = "focus_session_${theme.id}_empty" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = emptyVm) }
            }
            advanceAndCapture("focus_session_${theme.id}_empty")

            composeTestRule.onAllNodesWithText("History").onFirst().performClick()
            advanceAndCapture("focus_history_${theme.id}_empty")

            composeTestRule.onAllNodesWithText("Review").onFirst().performClick()
            advanceAndCapture("focus_review_${theme.id}_empty")

            val emptyReady = awaitReady(emptyVm)
            scene = "settings_${theme.id}_empty" to {
                AuditThemeWrapper(theme) {
                    SettingsScreen(snapshot = emptyReady, viewModel = emptyVm, onNavigateBack = {})
                }
            }
            advanceAndCapture("settings_${theme.id}_empty")

            // 3. Populated Fixture state across every primary destination
            val popVm = newViewModel(createPopulatedEngine(onboardingCompleted = true), theme)
            popVm.selectTab("Dashboard")
            scene = "dashboard_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = popVm) }
            }
            advanceAndCapture("dashboard_${theme.id}_populated-fixture")

            // Capture below-the-fold Dashboard once in obsidian for visual scroll inspection
            if (theme.id == "obsidian") {
                composeTestRule.onRoot().performTouchInput { swipeUp() }
                advanceAndCapture("dashboard_obsidian_scrolled-fixture")
            }

            popVm.selectTab("Tasks")
            scene = "tasks_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = popVm) }
            }
            advanceAndCapture("tasks_${theme.id}_populated-fixture")

            popVm.selectTab("Calendar")
            scene = "calendar_3day_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = popVm) }
            }
            advanceAndCapture("calendar_3day_${theme.id}_populated-fixture")

            composeTestRule.onAllNodesWithText("Week").onFirst().performClick()
            advanceAndCapture("calendar_week_${theme.id}_populated-fixture")

            composeTestRule.onAllNodesWithText("Day").onFirst().performClick()
            advanceAndCapture("calendar_day_agenda_${theme.id}_populated-fixture")

            popVm.selectTab("Grades")
            scene = "grades_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = popVm) }
            }
            advanceAndCapture("grades_${theme.id}_populated-fixture")

            popVm.selectTab("Focus")
            scene = "focus_session_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = popVm) }
            }
            advanceAndCapture("focus_session_${theme.id}_populated-fixture")

            composeTestRule.onAllNodesWithText("History").onFirst().performClick()
            advanceAndCapture("focus_history_${theme.id}_populated-fixture")

            composeTestRule.onAllNodesWithText("Review").onFirst().performClick()
            advanceAndCapture("focus_review_${theme.id}_populated-fixture")

            if (theme.id == "obsidian") {
                composeTestRule.onRoot().performTouchInput { swipeUp() }
                advanceAndCapture("focus_review_cards_obsidian_populated-fixture")
            }

            // Focus Review with an active practice quiz & error state
            val quizVm = newViewModel(createPopulatedEngine(onboardingCompleted = true), theme)
            quizVm.openPracticeQuiz("quiz-cs301")
            quizVm.selectTab("Focus")
            scene = "focus_review_quiz_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = quizVm) }
            }
            advanceAndCapture("focus_review_quiz_${theme.id}_populated-fixture")

            val quizErrVm = newViewModel(createPopulatedEngine(onboardingCompleted = true), theme)
            quizErrVm.openPracticeQuiz("nonexistent-id")
            quizErrVm.selectTab("Focus")
            scene = "focus_review_${theme.id}_error" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = quizErrVm) }
            }
            advanceAndCapture("focus_review_${theme.id}_error")

            val popReady = awaitReady(popVm)
            scene = "settings_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) {
                    SettingsScreen(snapshot = popReady, viewModel = popVm, onNavigateBack = {})
                }
            }
            advanceAndCapture("settings_${theme.id}_populated-fixture")

            if (theme.id == "obsidian") {
                composeTestRule.onRoot().performTouchInput { swipeUp() }
                advanceAndCapture("settings_obsidian_scrolled-mid-fixture")
                composeTestRule.onRoot().performTouchInput { swipeUp() }
                advanceAndCapture("settings_obsidian_scrolled-bottom-fixture")
            }
        }
    }

    @Test
    fun renderOnboardingWizardMatrix() {
        composeTestRule.mainClock.autoAdvance = false
        var scene by mutableStateOf<Pair<String, @Composable () -> Unit>>("init" to {})
        composeTestRule.setContent {
            val (sceneKey, content) = scene
            key(sceneKey) {
                content()
            }
        }

        for (theme in themes) {
            val emptyObVm = newViewModel(createEmptyEngine(onboardingCompleted = false), theme)
            for (step in 1..6) {
                emptyObVm.setOnboardingStep(step)
                scene = "onboarding_step${step}_${theme.id}_empty" to {
                    AuditThemeWrapper(theme) { AppScaffold(viewModel = emptyObVm) }
                }
                advanceAndCapture("onboarding_step${step}_${theme.id}_empty")
            }

            // Populated step 4 & step 6 (courses added & ready)
            val popObVm = newViewModel(createPopulatedEngine(onboardingCompleted = false), theme)
            popObVm.setOnboardingStep(4)
            scene = "onboarding_step4_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = popObVm) }
            }
            advanceAndCapture("onboarding_step4_${theme.id}_populated-fixture")

            popObVm.setOnboardingStep(6)
            scene = "onboarding_step6_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = popObVm) }
            }
            advanceAndCapture("onboarding_step6_${theme.id}_populated-fixture")

            // Step 3 timetable import error state
            val errObVm = newViewModel(createEmptyEngine(onboardingCompleted = false), theme)
            errObVm.setOnboardingStep(3)
            errObVm.importTimetableFromImage(ByteArray(0), "image/png")
            scene = "onboarding_step3_${theme.id}_error" to {
                AuditThemeWrapper(theme) { AppScaffold(viewModel = errObVm) }
            }
            advanceAndCapture("onboarding_step3_${theme.id}_error")
        }
    }

    /** Expanded window (>= 600dp): navigation rail + open navigation drawer. */
    @Test
    @Config(sdk = [35], qualifiers = "w600dp-h1000dp-xxhdpi")
    fun renderExpandedWidthLayout() {
        composeTestRule.mainClock.autoAdvance = false
        var scene by mutableStateOf<Pair<String, @Composable () -> Unit>>("init" to {})
        composeTestRule.setContent {
            val (sceneKey, content) = scene
            key(sceneKey) {
                content()
            }
        }

        val obsidian = themes[1]
        val popVm = newViewModel(createPopulatedEngine(onboardingCompleted = true), obsidian)
        awaitReady(popVm)
        scene = "dashboard_expanded_${obsidian.id}_populated-fixture" to {
            AuditThemeWrapper(obsidian) { AppScaffold(viewModel = popVm) }
        }
        advanceAndCapture("dashboard_expanded_${obsidian.id}_populated-fixture", 2_000L)

        // Open the drawer from the rail header's brand button.
        composeTestRule.onNodeWithContentDescription("Open navigation menu").performClick()
        advanceAndCapture("drawer_expanded_${obsidian.id}_populated-fixture", 2_000L)
        advanceAndCapture("drawer_expanded_${obsidian.id}_populated-fixture-2", 2_000L)
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Test
    fun renderSheetsAndNavigationBugProof() {
        composeTestRule.mainClock.autoAdvance = false
        var scene by mutableStateOf<Pair<String, @Composable () -> Unit>>("init" to {})
        composeTestRule.setContent {
            val (sceneKey, content) = scene
            key(sceneKey) {
                content()
            }
        }

        val obsidian = themes[1]
        val solar = themes[0]
        val popVm = newViewModel(createPopulatedEngine(onboardingCompleted = true), obsidian)
        val snapshot: AppSnapshotModel = awaitReady(popVm)

        // Proof of P0 blank-screen navigation bug: click "Grade Center" button on TasksScreen
        popVm.selectTab("Tasks")
        scene = "bug_before_grade_center_click-fixture" to {
            AuditThemeWrapper(obsidian) { AppScaffold(viewModel = popVm) }
        }
        advanceAndCapture("tasks_before_grade_center_click_obsidian_populated-fixture")
        composeTestRule.onNodeWithText("Grade Center").performClick()
        advanceAndCapture("bug_tasks_grade_center_blank_obsidian_populated-fixture")

        // Sheets (rendered over obsidian and solar where helpful)
        for (theme in listOf(obsidian, solar)) {
            val detailAssessment = snapshot.assessments.first { it.id == "quiz-cs301" }
            scene = "sheet_assessment_detail_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) {
                    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
                    AssessmentDetailSheet(
                        assessment = detailAssessment,
                        allAssessments = snapshot.assessments,
                        completedTopicsMap = snapshot.completedTopics,
                        sheetState = sheetState,
                        onDismiss = {},
                        onToggleTopic = { _, _ -> },
                        onSaveGrade = { _, _, _ -> GradeSaveResult.Saved },
                        onExportIcs = { "" },
                        onOpenPractice = {},
                        onOpenPomodoro = {},
                    )
                }
            }
            advanceAndCapture("sheet_assessment_detail_${theme.id}_populated-fixture", 2_000L)

            val editCourse = snapshot.schedule.courses.first()
            val editSlots = snapshot.schedule.slots.filter { it.courseId == editCourse.id }
            scene = "sheet_course_editor_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) {
                    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
                    CourseEditorSheet(
                        course = editCourse,
                        initialSlots = editSlots,
                        sheetState = sheetState,
                        onDismiss = {},
                        onSave = { _, _ -> },
                        onDelete = {},
                    )
                }
            }
            advanceAndCapture("sheet_course_editor_${theme.id}_populated-fixture", 2_000L)

            scene = "sheet_manual_assessment_${theme.id}_empty" to {
                AuditThemeWrapper(theme) {
                    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
                    ManualAssessmentSheet(
                        courses = snapshot.schedule.courses,
                        sheetState = sheetState,
                        onDismiss = {},
                        onSave = { _, _ -> },
                    )
                }
            }
            advanceAndCapture("sheet_manual_assessment_${theme.id}_empty", 2_000L)

            scene = "sheet_create_event_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) {
                    CreateEventSheet(
                        draft =
                            SharedEventDraft(
                                title = "Algorithm Proof Practice",
                                notes = "Review Bellman-Ford & Floyd-Warshall",
                                courseId = "CS301",
                                dateIso = refDate,
                                startTime = "16:00",
                                endTime = "17:30",
                            ),
                        onSave = {},
                        onDismiss = {},
                        courses = snapshot.schedule.courses,
                    )
                }
            }
            advanceAndCapture("sheet_create_event_${theme.id}_populated-fixture", 2_000L)

            scene = "sheet_account_${theme.id}_populated-fixture" to {
                AuditThemeWrapper(theme) {
                    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
                    AccountSheet(
                        isGoogleConnected = true,
                        isMicrosoftConnected = false,
                        sheetState = sheetState,
                        onDismiss = {},
                        onStartGoogleLogin = {},
                        onDisconnectGoogle = {},
                        onStartMicrosoftLogin = {},
                        onDisconnectMicrosoft = {},
                        onOpenSettings = {},
                        onOpenHelp = {},
                        userName = "Alex Morgan",
                        userEmail = "alex.morgan@uni.edu",
                    )
                }
            }
            advanceAndCapture("sheet_account_${theme.id}_populated-fixture", 2_000L)

            scene = "sheet_help_${theme.id}_empty" to {
                AuditThemeWrapper(theme) {
                    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
                    HelpSheet(sheetState = sheetState, onDismiss = {})
                }
            }
            advanceAndCapture("sheet_help_${theme.id}_empty", 2_000L)

            scene = "sheet_add_menu_${theme.id}_empty" to {
                AuditThemeWrapper(theme) {
                    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
                    AddActionMenuSheet(
                        sheetState = sheetState,
                        onDismiss = {},
                        onNewAssessment = {},
                        onNewCustomEvent = {},
                        onNewCourse = {},
                        onImportBackup = {},
                    )
                }
            }
            advanceAndCapture("sheet_add_menu_${theme.id}_empty", 2_000L)
        }

        // SearchSheet calls focusRequester.requestFocus() inside LaunchedEffect(Unit) outside
        // ModalBottomSheet (SearchSheet.kt:77-79) before the dialog mounts OutlinedTextField.
        // Run last so a FocusRequester IllegalStateException is recorded cleanly without blocking other sheets.
        try {
            scene = "sheet_search_${obsidian.id}_populated-fixture" to {
                AuditThemeWrapper(obsidian) {
                    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
                    SearchSheet(
                        snapshot = snapshot,
                        sheetState = sheetState,
                        onDismiss = {},
                        onSelectAssessment = {},
                    )
                }
            }
            advanceAndCapture("sheet_search_${obsidian.id}_populated-fixture", 2_000L)
        } catch (t: IllegalStateException) {
            println("AuditRenderHarness: SearchSheet not renderable devicelessly (${t.message})")
        }
    }
}

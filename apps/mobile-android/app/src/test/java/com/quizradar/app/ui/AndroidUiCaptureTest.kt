package com.quizradar.app.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.ui.theme.QuizRadarTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream
import java.time.LocalDate

/**
 * Renders the PRODUCTION Compose screens on the JVM (Robolectric native
 * graphics — no emulator, no app install) and writes each as a PNG into
 * `apps/web/.ladle-static/android-ui/`, where the web workbench's
 * `Phone (Android app)/` section displays them at phone width.
 *
 * Run: `.\gradlew.bat testDebugUnitTest --tests "*AndroidUiCaptureTest*"`
 * The images are machine-local and gitignored (AGENTS §3.8) — the workbench
 * stories show a regeneration note when they are missing.
 *
 * Two deliberate deviations from the usual compose-test flow, both forced by
 * the dashboard's infinite animations (hero starfield twinkle):
 * - `waitForIdle()` is never called — it can never settle while an infinite
 *   animation runs; data readiness is awaited via bounded `waitUntil`s on
 *   visible text instead.
 * - The PNG is produced by drawing the window decor onto a canvas — the
 *   compose-test `captureToImage()` needs a choreographer redraw handshake
 *   that does not complete under Robolectric.
 *
 * Seeding uses the REAL Rust core (`QuizRadarEngine.createInMemory` → JNA
 * host cdylib, wired by `buildHostRustCore` + `tasks.withType<Test>` in
 * `app/build.gradle.kts`) with dates relative to today so the captures stay
 * evergreen — same honesty contract as the web workbench fixtures.
 */
@OptIn(ExperimentalMaterial3Api::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w390dp-h844dp")
class AndroidUiCaptureTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    private val outputDir =
        File(System.getProperty("user.dir")).resolve("../../web/public/android-ui").normalize()

    private fun seededEngine(): QuizRadarEngine {
        val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
        val today = LocalDate.now()
        runBlocking {
            engine.upsertCourse(
                """{ "id": "CSE241", "name": "Digital Design", "color": "#1a73e8" }""",
                "[]",
                today,
            )
            engine.upsertCourse(
                """{ "id": "GSE211", "name": "Discrete Mathematics", "color": "#a142f4" }""",
                "[]",
                today,
            )
            engine.replaceAssessments(
                """
                [
                    {
                        "id": "quiz-1",
                        "title": "Quiz 1",
                        "course_id": "CSE241",
                        "assessment_type": "Class Quiz",
                        "date_iso": "${today.plusDays(2)}",
                        "topics": ["Boolean Algebra", "Karnaugh Maps"],
                        "warnings": ["Bring a scientific calculator"],
                        "source": "Gmail"
                    },
                    {
                        "id": "midterm-1",
                        "title": "Midterm Exam",
                        "course_id": "CSE241",
                        "assessment_type": "Midterm Exam",
                        "date_iso": "${today.plusDays(7)}",
                        "topics": ["Number Systems", "State Machines"],
                        "warnings": [],
                        "source": "Teams"
                    },
                    {
                        "id": "final-1",
                        "title": "Final Exam",
                        "course_id": "GSE211",
                        "assessment_type": "Final Exam",
                        "date_iso": "${today.plusDays(21)}",
                        "topics": ["Graph Theory", "Trees"],
                        "warnings": [],
                        "source": "Moodle"
                    }
                ]
                """.trimIndent(),
                today,
            )
        }
        return engine
    }

    private fun newViewModel(engine: QuizRadarEngine): QuizRadarViewModel =
        QuizRadarViewModel(engine, coreDispatcher = Dispatchers.Main.immediate)

    /** Bounded wait for visible text — never `waitForIdle`, which infinite
     *  animations starve forever. */
    private fun waitForText(
        text: String,
        timeoutMs: Long = 8_000,
    ) {
        composeTestRule.waitUntil(timeoutMillis = timeoutMs) {
            composeTestRule.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    /** Draws the composed window onto a bitmap — no choreographer handshake. */
    private fun capturePng(name: String) {
        @Suppress("UNCHECKED_CAST")
        val activity =
            (composeTestRule as AndroidComposeTestRule<*, *>).activity
        val decor = activity.window.decorView
        val width = if (decor.width > 0) decor.width else 390
        val height = if (decor.height > 0) decor.height else 844
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        decor.draw(Canvas(bitmap))
        val out = outputDir.resolve("$name.png")
        out.parentFile.mkdirs()
        FileOutputStream(out).use { stream ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
        }
        println("AndroidUiCapture: wrote ${out.absolutePath}")
    }

    private fun renderApp(viewModel: QuizRadarViewModel) {
        composeTestRule.setContent {
            QuizRadarTheme { AppScaffold(viewModel = viewModel) }
        }
    }

    @Test
    @Config(qualifiers = "w390dp-h844dp-night")
    fun capture_dashboard_dark() {
        val viewModel = newViewModel(seededEngine())
        renderApp(viewModel)
        waitForText("Quiz 1")
        capturePng("dashboard-dark")
    }

    @Test
    fun capture_dashboard_light() {
        val viewModel = newViewModel(seededEngine())
        renderApp(viewModel)
        waitForText("Quiz 1")
        capturePng("dashboard-light")
    }

    @Test
    @Config(qualifiers = "w390dp-h844dp-night")
    fun capture_tasks_dark() {
        val viewModel = newViewModel(seededEngine())
        renderApp(viewModel)
        waitForText("Quiz 1")
        viewModel.selectTab("Tasks")
        waitForText("Daily Study Roadmap")
        capturePng("tasks-dark")
    }

    @Test
    @Config(qualifiers = "w390dp-h844dp-night")
    fun capture_calendar_dark() {
        val viewModel = newViewModel(seededEngine())
        renderApp(viewModel)
        waitForText("Quiz 1")
        viewModel.selectTab("Calendar")
        waitForText("Today")
        capturePng("calendar-dark")
    }

    @Test
    @Config(qualifiers = "w390dp-h844dp-night")
    fun capture_grades_dark() {
        val viewModel = newViewModel(seededEngine())
        renderApp(viewModel)
        waitForText("Quiz 1")
        viewModel.selectTab("Grades")
        waitForText("Grade Center")
        capturePng("grades-dark")
    }

    @Test
    @Config(qualifiers = "w390dp-h844dp-night")
    fun capture_focus_dark() {
        val viewModel = newViewModel(seededEngine())
        renderApp(viewModel)
        waitForText("Quiz 1")
        viewModel.selectTab("Focus")
        waitForText("Focus 25m")
        capturePng("focus-dark")
    }

    @Test
    @Config(qualifiers = "w390dp-h844dp-night")
    fun capture_settings_dark() {
        val engine = seededEngine()
        val viewModel = newViewModel(engine)
        viewModel.loadState()
        composeTestRule.setContent {
            QuizRadarTheme {
                val state = viewModel.uiState.value
                if (state is UiState.Ready) {
                    com.quizradar.app.ui.screens.SettingsScreen(
                        snapshot = state.snapshot,
                        viewModel = viewModel,
                        onNavigateBack = {},
                    )
                }
            }
        }
        waitForText("Settings")
        capturePng("settings-dark")
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Test
    @Config(qualifiers = "w390dp-h844dp-night")
    fun capture_course_aliases_dark() {
        val sampleCourse =
            com.quizradar.app.model.CourseModel(
                id = "CSE241",
                name = "Digital Design",
                color = "#1a73e8",
                aliases = listOf("CS241", "COMP 241"),
            )
        composeTestRule.setContent {
            QuizRadarTheme {
                val sheetState =
                    androidx.compose.material3.rememberModalBottomSheetState(
                        skipPartiallyExpanded = true,
                    )
                com.quizradar.app.ui.detail.CourseEditorSheet(
                    course = sampleCourse,
                    initialSlots = emptyList(),
                    sheetState = sheetState,
                    onDismiss = {},
                    onSave = { _, _ -> },
                )
            }
        }
        waitForText("Additional Course Codes / Aliases")
        capturePng("course-aliases-dark")
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Test
    @Config(qualifiers = "w390dp-h844dp-night")
    fun capture_assessment_reassign_dark() {
        val sampleAssessment =
            com.quizradar.app.model.AssessmentModel(
                id = "quiz-alias",
                title = "Class Quiz 2",
                courseId = "CS241",
                courseName = null,
                assessmentType = "Class Quiz",
                dateIso = LocalDate.now().plusDays(3),
                dayName = "Friday",
                startTime = "10:00",
                endTime = "10:45",
                displayTime = "10:00–10:45",
                room = "Lab 3",
                group = null,
                instructor = "Dr. Hassan",
                isUpcoming = true,
                daysUntil = 3,
                urgencyLevel = "high",
                priorityScore = 85,
                topics = listOf("Inheritance", "Polymorphism"),
                warnings = emptyList(),
                source = "email",
            )
        val courses =
            listOf(
                com.quizradar.app.model.CourseModel(
                    id = "CSE241",
                    name = "Digital Design",
                    color = "#1a73e8",
                    aliases = listOf("CS241"),
                ),
                com.quizradar.app.model.CourseModel(
                    id = "GSE211",
                    name = "Discrete Mathematics",
                    color = "#a142f4",
                ),
            )
        composeTestRule.setContent {
            QuizRadarTheme {
                val sheetState =
                    androidx.compose.material3.rememberModalBottomSheetState(
                        skipPartiallyExpanded = true,
                    )
                com.quizradar.app.ui.detail.AssessmentDetailSheet(
                    assessment = sampleAssessment,
                    allAssessments = listOf(sampleAssessment),
                    completedTopicsMap = emptyMap(),
                    sheetState = sheetState,
                    onDismiss = {},
                    onToggleTopic = { _, _ -> },
                    onSaveGrade = { _, _, _ -> GradeSaveResult.Saved },
                    onExportIcs = { "" },
                    onOpenPractice = {},
                    onOpenPomodoro = {},
                    courses = courses,
                    onReassignCourse = { _, _ -> },
                )
            }
        }
        waitForText("Assign to Course")
        capturePng("assessment-reassign-dark")
    }

    @Test
    @Config(qualifiers = "w390dp-h844dp-night")
    fun capture_peer_sync_dark() {
        val engine = seededEngine()
        val viewModel = newViewModel(engine)
        viewModel.loadState()
        composeTestRule.setContent {
            QuizRadarTheme {
                val state = viewModel.uiState.value
                if (state is UiState.Ready) {
                    com.quizradar.app.ui.screens.SettingsScreen(
                        snapshot = state.snapshot,
                        viewModel = viewModel,
                        onNavigateBack = {},
                    )
                }
            }
        }
        waitForText("Show Pairing QR Code")
        composeTestRule.onNodeWithText("Show Pairing QR Code").performScrollTo()
        capturePng("peer-sync-dark")
        composeTestRule.onNodeWithText("Show Pairing QR Code").performClick()
        waitForText("Scan with another phone's camera", timeoutMs = 10_000)
        composeTestRule.onNodeWithText("Scan with another phone's camera", substring = true).performScrollTo()
        capturePng("peer-qr-dark")
    }
}

package com.quizradar.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.ACADEMIC_TRACKS
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.TimetableImportState
import com.quizradar.app.ui.components.OAuthClientIdFields
import com.quizradar.app.ui.components.QuizRadarLogo
import com.quizradar.app.ui.components.TimetableImportErrorDialog
import com.quizradar.app.ui.components.TimetableImportPreviewDialog
import com.quizradar.app.ui.components.TimetableImportWorkingDialog
import com.quizradar.app.ui.detail.CourseEditorSheet
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.readScaledImage
import com.quizradar.app.ui.theme.ChipLeadingCheck
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.quietChipColors
import com.quizradar.app.ui.theme.quietTextFieldColors
import com.quizradar.app.ui.theme.tonalPill
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// The three presets the spec names (`01` §4.1: Medicine / Business / Sciences)
// live in one shared list (`com.quizradar.app.ui.ACADEMIC_TRACKS`) so the
// wizard, the Settings card and the web tier agree on the stored ids.
private val STUDY_TRACKS = ACADEMIC_TRACKS

/** The wizard's six steps, in the order the audit (A07/A14) demands. */
private const val ONBOARDING_STEP_COUNT = 6

// The verbatim free-tier disclosure (`05` §5.1) — this exact copy ships in
// the onboarding AI-consent card, unchanged. Rewording it would soften the
// "Google may use that content to improve its products" truth.
private const val AI_FREE_TIER_DISCLOSURE =
    "Your email announcements and timetable images are sent to Google's Gemini API " +
        "when AI is used. On Google's free tier, Google may use that content to " +
        "improve its products."

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun OnboardingWizardScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    onComplete: () -> Unit,
    onStartGoogleLogin: () -> Unit = {},
    onStartMicrosoftLogin: () -> Unit = {},
    onImportBackup: () -> Unit = {},
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val currentStep by viewModel.onboardingStep.collectAsState()
    // The persisted study-track preset (`01` §4.1) — the wizard shows what
    // was saved and writes the answer straight through.
    val savedTrack by viewModel.academicTrack.collectAsState()
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val isAmoled = isDark && MaterialTheme.colorScheme.background == Color.Black

    var isAddCourseOpen by rememberSaveable { mutableStateOf(false) }
    val addCourseSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val timetableImportState by viewModel.timetableImportState.collectAsState()
    // A07: the import gate is the AI-enabled (consent) preference — read as
    // state so the step-3 buttons flip the moment the checkbox turns it.
    val aiEnabled by viewModel.geminiEnabled.collectAsState()
    val imageImportScope = rememberCoroutineScope()
    val timetableImageLauncher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.PickVisualMedia(),
        ) { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            imageImportScope.launch {
                val image =
                    try {
                        withContext(Dispatchers.IO) { readScaledImage(context, uri) }
                    } catch (e: Exception) {
                        viewModel.showToast("Could not read the image: ${e.message}")
                        null
                    }
                if (image == null || image.bytes.isEmpty()) {
                    viewModel.showToast("That image could not be read - pick another one.")
                } else {
                    viewModel.importTimetableFromImage(image.bytes, image.mime)
                }
            }
        }
    // PDF timetables come through the generic document picker —
    // `PickVisualMedia` only covers image/video/audio. The bytes flow through
    // the same import state machine (Working -> Preview -> apply) so the
    // preview-before-commit rule holds for PDFs exactly as for screenshots.
    val timetablePdfLauncher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.GetContent(),
        ) { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            imageImportScope.launch {
                val bytes =
                    try {
                        withContext(Dispatchers.IO) {
                            context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        }
                    } catch (e: Exception) {
                        viewModel.showToast("Could not read the PDF: ${e.message}")
                        null
                    }
                if (bytes == null || bytes.isEmpty()) {
                    viewModel.showToast("That PDF could not be read - pick another file.")
                } else {
                    viewModel.importTimetableFromImage(bytes, "application/pdf")
                }
            }
        }

    val syllabusDocsLauncher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.OpenMultipleDocuments(),
        ) { uris ->
            if (uris.isEmpty()) return@rememberLauncherForActivityResult
            imageImportScope.launch {
                val readResult =
                    withContext(Dispatchers.IO) {
                        com.quizradar.app.ui.SyllabusDocumentReader.readFromUris(context, uris)
                    }
                if (readResult.errors.isNotEmpty()) {
                    viewModel.showToast(readResult.errors.first())
                }
                if (readResult.documents.isNotEmpty()) {
                    viewModel.importSyllabiFromDocuments(readResult.documents)
                }
            }
        }

    val notificationPermissionLauncher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.RequestPermission(),
        ) { isGranted ->
            if (isGranted) {
                viewModel.showToast("Notification permission granted")
            } else {
                viewModel.showToast("Reminders require notification permission")
            }
        }

    val hasNotificationPermission =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

    // Reduced motion (`Settings.Global.ANIMATOR_DURATION_SCALE == 0`) turns
    // the step crossfade into an instant swap — the wizard must never animate
    // for a user whose device says don't.
    val animateSteps =
        remember {
            Settings.Global.getFloat(
                context.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f,
            ) > 0f
        }

    // Back navigates one step back. On the FIRST step there is nowhere to go
    // back to: the old code silently completed the wizard, which dropped the
    // user into an app that had just been marked "set up" without a single
    // answer given. Back must never do that.
    BackHandler(enabled = currentStep > 1) {
        viewModel.setOnboardingStep(currentStep - 1)
    }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                text = "QuizRadar Setup",
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                text = "Step $currentStep of $ONBOARDING_STEP_COUNT",
                                style =
                                    MaterialTheme.typography.labelMedium.copy(
                                        fontFeatureSettings = "tnum",
                                    ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    },
                    navigationIcon = {
                        if (currentStep > 1) {
                            IconButton(onClick = { viewModel.setOnboardingStep(currentStep - 1) }) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = "Previous step",
                                )
                            }
                        }
                    },
                    // Manual setup stays first-class: Skip is visible from
                    // step 1 and completes the wizard honestly (nothing was
                    // configured, and the checklist will say so).
                    actions = {
                        if (currentStep < ONBOARDING_STEP_COUNT) {
                            TextButton(
                                onClick = {
                                    viewModel.completeOnboarding()
                                    onComplete()
                                },
                                colors =
                                    ButtonDefaults.textButtonColors(
                                        contentColor = MaterialTheme.colorScheme.onSurface,
                                    ),
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            ) {
                                Text("Skip", style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    },
                    colors =
                        TopAppBarDefaults.topAppBarColors(
                            containerColor =
                                if (isAmoled) {
                                    Color.Black.copy(alpha = 0.85f)
                                } else {
                                    MaterialTheme.colorScheme.surface
                                },
                            titleContentColor = MaterialTheme.colorScheme.onSurface,
                        ),
                )
                LinearProgressIndicator(
                    progress = { currentStep / ONBOARDING_STEP_COUNT.toFloat() },
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                    gapSize = 0.dp,
                    drawStopIndicator = {},
                )
            }
        },
        containerColor = if (isAmoled) Color.Transparent else MaterialTheme.colorScheme.background,
        modifier = modifier.fillMaxSize(),
    ) { innerPadding ->
        Box(
            modifier =
                Modifier
                    .padding(innerPadding)
                    .consumeWindowInsets(innerPadding)
                    .fillMaxSize(),
        ) {
            AnimatedContent(
                targetState = currentStep,
                transitionSpec = {
                    if (animateSteps) {
                        fadeIn(animationSpec = tween(220)) togetherWith fadeOut(animationSpec = tween(180))
                    } else {
                        fadeIn(animationSpec = snap()) togetherWith fadeOut(animationSpec = snap())
                    }
                },
                label = "onboarding_step_crossfade",
            ) { step ->
                val stepScrollState = rememberScrollState()
                Column(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .imePadding()
                            .verticalScroll(stepScrollState)
                            .padding(horizontal = 20.dp, vertical = 16.dp),
                ) {
                    when (step) {
                        1 ->
                            Step1Welcome(
                                onGetStarted = { viewModel.setOnboardingStep(2) },
                                onRestoreBackup = onImportBackup,
                            )

                        2 ->
                            Step2AiConsent(viewModel = viewModel)

                        3 -> {
                            val importError =
                                (timetableImportState as? TimetableImportState.Failed)?.message
                            Step3Timetable(
                                snapshot = snapshot,
                                savedTrack = savedTrack,
                                onTrackSelected = { viewModel.setAcademicTrack(it) },
                                aiEnabled = aiEnabled,
                                importErrorMessage = importError,
                                onDismissImportError = { viewModel.dismissTimetableImport() },
                                onEnableAi = { viewModel.setOnboardingStep(2) },
                                onImportTimetablePhoto = {
                                    timetableImageLauncher.launch(
                                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                                    )
                                },
                                onImportTimetablePdf = { timetablePdfLauncher.launch("application/pdf") },
                                onImportSyllabiDocs = {
                                    syllabusDocsLauncher.launch(arrayOf("application/pdf", "image/*"))
                                },
                                onImportCoursePackLink = { viewModel.openPasteCoursePackDialog() },
                                onAddCourse = { isAddCourseOpen = true },
                                onGoToSources = { viewModel.setOnboardingStep(4) },
                                onNext = { viewModel.setOnboardingStep(4) },
                            )
                        }

                        4 ->
                            Step4Sources(
                                viewModel = viewModel,
                                onStartGoogleLogin = onStartGoogleLogin,
                                onStartMicrosoftLogin = onStartMicrosoftLogin,
                                onNext = { viewModel.setOnboardingStep(5) },
                            )

                        5 ->
                            Step5Theme(
                                viewModel = viewModel,
                                onNext = { viewModel.setOnboardingStep(6) },
                            )

                        6 ->
                            Step6Reminders(
                                viewModel = viewModel,
                                hasNotificationPermission = hasNotificationPermission,
                                onRequestPermission = {
                                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                    }
                                },
                                onFinish = {
                                    viewModel.completeOnboarding()
                                    onComplete()
                                },
                            )
                    }
                }
            }

            if (isAddCourseOpen) {
                CourseEditorSheet(
                    course = null,
                    initialSlots = emptyList(),
                    sheetState = addCourseSheetState,
                    onDismiss = { isAddCourseOpen = false },
                    onSave = { newCourse, slots ->
                        viewModel.upsertCourse(newCourse, slots)
                        isAddCourseOpen = false
                    },
                )
            }

            when (val importState = timetableImportState) {
                is TimetableImportState.Working -> TimetableImportWorkingDialog()
                is TimetableImportState.Preview ->
                    TimetableImportPreviewDialog(
                        extracted = importState.extracted,
                        onApply = { viewModel.applyImportedTimetable(importState.extracted) },
                        onDismiss = { viewModel.dismissTimetableImport() },
                    )
                // The failed import is reported INLINE on the timetable step
                // (with Connect-source / manual-entry fallbacks, A14) so the
                // user never leaves the wizard to recover. Off that step the
                // shared error dialog keeps the failure loud.
                is TimetableImportState.Failed ->
                    if (currentStep != 3) {
                        TimetableImportErrorDialog(
                            message = importState.message,
                            onDismiss = { viewModel.dismissTimetableImport() },
                        )
                    }
                else -> {}
            }
        }
    }
}

// =============================================================================
// STEP 1: WELCOME & PRIVACY
// =============================================================================
@Composable
private fun Step1Welcome(
    onGetStarted: () -> Unit,
    onRestoreBackup: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
    ) {
        Spacer(modifier = Modifier.height(16.dp))

        QuizRadarLogo(size = 64.dp)

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "Welcome to QuizRadar",
            style = MaterialTheme.typography.titleLarge,
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "Never miss another university quiz, lab, or exam date.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Value proposition card
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.quietCardColors(),
            border = CardDefaults.quietCardBorder(),
            elevation = CardDefaults.quietCardElevation(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "How QuizRadar Works",
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text =
                        "Professors announce exams with fuzzy text: \"Quiz 1 next Tuesday during class\". " +
                            "QuizRadar cross-references your weekly class schedule with course announcements to automatically " +
                            "pin exact dates, times, and study roadmaps.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // On-device privacy guarantee — a tonal container beside the card above.
        Surface(
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Shield,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(24.dp),
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(
                        text = "Private & Stored on This Device",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text =
                            "Your account tokens stay in Keystore-backed encrypted storage, and your timetable " +
                                "and grades stay in private app storage on this phone — no central servers, no telemetry, no analytics.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        Button(
            onClick = onGetStarted,
            modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
            colors = ButtonDefaults.filledPill(),
            contentPadding = PillButtonContentPadding,
        ) {
            Text("Get Started", style = MaterialTheme.typography.labelLarge)
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(16.dp))
        }

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedButton(
            onClick = onRestoreBackup,
            modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
            contentPadding = PillButtonContentPadding,
        ) {
            Icon(Icons.Outlined.UploadFile, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text("Restore from Backup", style = MaterialTheme.typography.labelLarge)
        }
    }
}

// =============================================================================
// STEP 2: AI KEY + EXPLICIT CONSENT (before any timetable import — A07)
// =============================================================================
@Composable
private fun Step2AiConsent(
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    val storedKey by viewModel.geminiApiKey.collectAsState()
    val storedAiEnabled by viewModel.geminiEnabled.collectAsState()
    var keyInput by rememberSaveable(storedKey) { mutableStateOf(storedKey) }
    var consentChecked by rememberSaveable(storedAiEnabled) { mutableStateOf(storedAiEnabled) }
    var isKeyVisible by rememberSaveable { mutableStateOf(false) }

    // The AI-enabled preference is the CONSENT, not key presence: typing a
    // key alone used to flip the preference on (A07 failure).
    val enableAi = { checked: Boolean, key: String ->
        viewModel.setGeminiEnabled(checked && key.isNotBlank())
    }

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "AI Features (Optional)",
            style = MaterialTheme.typography.titleLarge,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text =
                "QuizRadar works fully offline without this step. AI adds practice quizzes and " +
                    "timetable photo/PDF import — and it sends content to Google's Gemini API when used.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(16.dp))

        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.quietCardColors(),
            border = CardDefaults.quietCardBorder(),
            elevation = CardDefaults.quietCardElevation(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Gemini API Key (Personal Key)",
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text =
                        "Bring your own key from Google AI Studio — it is stored in this phone's " +
                            "Keystore-backed encrypted storage and never enters a log or a backup.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = keyInput,
                    onValueChange = {
                        keyInput = it
                        viewModel.saveGeminiApiKey(it, announce = false)
                        enableAi(consentChecked, it)
                    },
                    label = { Text("Gemini API Key") },
                    singleLine = true,
                    visualTransformation = if (isKeyVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    trailingIcon = {
                        IconButton(onClick = { isKeyVisible = !isKeyVisible }) {
                            Icon(
                                imageVector = if (isKeyVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                contentDescription = if (isKeyVisible) "Hide key" else "Show key",
                            )
                        }
                    },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .onFocusChanged { focusState ->
                                if (!focusState.isFocused) {
                                    if (keyInput.isNotBlank()) {
                                        viewModel.saveGeminiApiKey(keyInput)
                                    } else {
                                        viewModel.saveGeminiApiKey(keyInput, announce = false)
                                    }
                                }
                            },
                )

                Spacer(modifier = Modifier.height(12.dp))

                // VERBATIM free-tier disclosure (`05` §5.1) — enable-time copy.
                Text(
                    text = AI_FREE_TIER_DISCLOSURE,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Turn off to stay fully local.",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = PillButtonMinHeight)
                            .toggleable(
                                value = consentChecked,
                                role = Role.Checkbox,
                                onValueChange = { checked ->
                                    consentChecked = checked
                                    enableAi(checked, keyInput)
                                },
                            ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = consentChecked, onCheckedChange = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        "I understand and want to enable AI features with my Gemini API key",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                if (consentChecked && keyInput.isBlank()) {
                    Text(
                        "Paste your API key above to finish enabling AI.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        Button(
            onClick = { viewModel.setOnboardingStep(3) },
            modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
            colors = ButtonDefaults.filledPill(),
            contentPadding = PillButtonContentPadding,
        ) {
            Text(
                text = if (storedAiEnabled) "Continue with AI Enabled" else "Continue Without AI",
                style = MaterialTheme.typography.labelLarge,
            )
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(16.dp))
        }
    }
}

// =============================================================================
// STEP 3: TIMETABLE & COURSES (import requires the AI-consent step; A14/A07)
// =============================================================================
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Step3Timetable(
    snapshot: AppSnapshotModel,
    savedTrack: String?,
    onTrackSelected: (String) -> Unit,
    aiEnabled: Boolean,
    importErrorMessage: String?,
    onDismissImportError: () -> Unit,
    onEnableAi: () -> Unit,
    onImportTimetablePhoto: () -> Unit,
    onImportTimetablePdf: () -> Unit,
    onImportSyllabiDocs: () -> Unit,
    onImportCoursePackLink: () -> Unit,
    onAddCourse: () -> Unit,
    onGoToSources: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // The persisted preset wins; the chips write straight through to the
    // store, so the answer survives the wizard (`01` §4.1). With no saved
    // answer NO chip is highlighted — a pre-selected default would look like
    // a choice the user never made.
    var selectedTrack by rememberSaveable(savedTrack) {
        mutableStateOf(savedTrack)
    }
    // A value saved by an older build (or a restored backup) may name a preset
    // that no longer exists - say so instead of silently highlighting nothing.
    val knownTrack = STUDY_TRACKS.any { it.first == selectedTrack }

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "Your Courses & Timetable",
            style = MaterialTheme.typography.titleLarge,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Add your enrolled courses so QuizRadar knows your recurring class times.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Academic rhythm preset chips
        Text(
            text = "Academic Rhythm Preset",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(modifier = Modifier.height(8.dp))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            STUDY_TRACKS.forEach { (id, label) ->
                FilterChip(
                    selected = selectedTrack == id,
                    onClick = {
                        selectedTrack = id
                        onTrackSelected(id)
                    },
                    // Selection is never colour-only: the picked chip carries
                    // the leading check (design system §4).
                    leadingIcon = { if (selectedTrack == id) ChipLeadingCheck() },
                    colors = FilterChipDefaults.quietChipColors(),
                    label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                )
            }
        }
        if (!knownTrack) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text =
                    if (selectedTrack == null) {
                        "Not set — pick the field that matches your programme (optional)."
                    } else {
                        "Saved preset \"$selectedTrack\" is not one of the current options — " +
                            "pick one to replace it."
                    },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Enrolled courses card
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.quietCardColors(),
            border = CardDefaults.quietCardBorder(),
            elevation = CardDefaults.quietCardElevation(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Enrolled Courses (${snapshot.schedule.courses.size})",
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(modifier = Modifier.height(12.dp))
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    FilledTonalButton(
                        onClick = onImportTimetablePhoto,
                        enabled = aiEnabled,
                        colors = ButtonDefaults.tonalPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.weight(1f).defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text("Import Photo", style = MaterialTheme.typography.labelLarge)
                    }
                    FilledTonalButton(
                        onClick = onImportTimetablePdf,
                        enabled = aiEnabled,
                        colors = ButtonDefaults.tonalPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.weight(1f).defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text("Import PDF", style = MaterialTheme.typography.labelLarge)
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))
                FilledTonalButton(
                    onClick = onImportSyllabiDocs,
                    enabled = aiEnabled,
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Icon(Icons.Outlined.UploadFile, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Import Multiple Syllabi (PDF / Photos)", style = MaterialTheme.typography.labelLarge)
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    TextButton(
                        onClick = onAddCourse,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Add Course", style = MaterialTheme.typography.labelLarge)
                    }
                    TextButton(
                        onClick = onImportCoursePackLink,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Classmate link?", style = MaterialTheme.typography.labelLarge)
                    }
                }

                if (!aiEnabled) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Surface(
                        shape = MaterialTheme.shapes.medium,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                text =
                                    "Photo and PDF import need AI features, which are turned off " +
                                        "(step 2). Enable them there, or tap Add Course above.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            TextButton(
                                onClick = onEnableAi,
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            ) {
                                Text("Go to AI step", style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    }
                }

                if (snapshot.schedule.courses.isEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Surface(
                        shape = MaterialTheme.shapes.medium,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.School,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(24.dp),
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Column {
                                Text(
                                    text = "No courses added yet",
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "Add at least one course with class hours to resolve exam dates.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                } else {
                    snapshot.schedule.courses.forEachIndexed { index, course ->
                        val slotCount =
                            snapshot.schedule.slots.count {
                                it.courseId.equals(course.id, ignoreCase = true)
                            }
                        if (index > 0) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                        Row(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .defaultMinSize(minHeight = 56.dp)
                                    .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier =
                                    Modifier
                                        .size(12.dp)
                                        .clip(CircleShape)
                                        .background(courseSwatch(course.id, course.color)),
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Column {
                                Text(
                                    text = "${course.id} · ${course.name}",
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                Text(
                                    text = "$slotCount ${if (slotCount == 1) "weekly class slot" else "weekly class slots"}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }

        // Inline failed import recovery stays inside the wizard (A14).
        importErrorMessage?.let { message ->
            Spacer(modifier = Modifier.height(16.dp))
            Surface(
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.errorContainer,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Outlined.Warning,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Timetable import failed",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    val errorButtonColors =
                        ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        TextButton(
                            onClick = onAddCourse,
                            colors = errorButtonColors,
                            modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                        ) {
                            Text("Add course manually", style = MaterialTheme.typography.labelLarge)
                        }
                        TextButton(
                            onClick = onGoToSources,
                            colors = errorButtonColors,
                            modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                        ) {
                            Text("Connect sources instead", style = MaterialTheme.typography.labelLarge)
                        }
                        TextButton(
                            onClick = onDismissImportError,
                            colors = errorButtonColors,
                            modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                        ) {
                            Text("Dismiss", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            }
        }

        if (aiEnabled && snapshot.schedule.courses.isEmpty()) {
            Spacer(modifier = Modifier.height(16.dp))
            Surface(
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
                    Icon(
                        imageVector = Icons.Outlined.AutoAwesome,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Extracted timetables always show a preview before saving.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        Button(
            onClick = onNext,
            modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
            colors = ButtonDefaults.filledPill(),
            contentPadding = PillButtonContentPadding,
        ) {
            Text(
                text = if (snapshot.schedule.courses.isEmpty()) "Continue Without Courses" else "Continue to Sources",
                style = MaterialTheme.typography.labelLarge,
            )
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(16.dp))
        }
    }
}

// =============================================================================
// STEP 4: CONNECT SOURCES (SKIPPABLE — AI key lives on step 2 now)
// =============================================================================
@Composable
private fun Step4Sources(
    viewModel: QuizRadarViewModel,
    onStartGoogleLogin: () -> Unit,
    onStartMicrosoftLogin: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isGoogleConnected by viewModel.googleConnected.collectAsState()
    val isMicrosoftConnected by viewModel.microsoftConnected.collectAsState()
    val googleClientId by viewModel.googleClientId.collectAsState()
    val teamsClientId by viewModel.teamsClientId.collectAsState()
    val hasCustomClientIds = googleClientId.isNotBlank() || teamsClientId.isNotBlank()
    var customIdsExpanded by rememberSaveable { mutableStateOf(false) }
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "Connect Announcement Sources",
            style = MaterialTheme.typography.titleLarge,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text =
                "Sign in and QuizRadar scans Gmail, Classroom, and Teams announcements on this device " +
                    "to pin quiz and exam dates to your timetable. Tokens never leave your phone, and this step is optional.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Google Card (primary connection action first)
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.quietCardColors(),
            border = CardDefaults.quietCardBorder(),
            elevation = CardDefaults.quietCardElevation(),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable(enabled = !isGoogleConnected) { onStartGoogleLogin() },
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier.weight(1f).padding(end = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Email,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(24.dp),
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column {
                        Text(
                            text = "Google Workspace",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            text = "Gmail & Classroom (read-only) — scanned on this device",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (isGoogleConnected) {
                    Surface(
                        shape = MaterialTheme.shapes.small,
                        color = StatusColors.successContainer(isDark),
                    ) {
                        Text(
                            text = "Connected",
                            style = MaterialTheme.typography.labelMedium,
                            color = StatusColors.onSuccessContainer(isDark),
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                        )
                    }
                } else {
                    FilledTonalButton(
                        onClick = onStartGoogleLogin,
                        colors = ButtonDefaults.tonalPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text("Connect", style = MaterialTheme.typography.labelLarge)
                        Spacer(modifier = Modifier.width(8.dp))
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowForward,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Microsoft Card
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.quietCardColors(),
            border = CardDefaults.quietCardBorder(),
            elevation = CardDefaults.quietCardElevation(),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable(enabled = !isMicrosoftConnected) { onStartMicrosoftLogin() },
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier.weight(1f).padding(end = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Groups,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(24.dp),
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column {
                        Text(
                            text = "Microsoft Teams",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            text = "Channel announcements (read-only) — scanned on this device",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (isMicrosoftConnected) {
                    Surface(
                        shape = MaterialTheme.shapes.small,
                        color = StatusColors.successContainer(isDark),
                    ) {
                        Text(
                            text = "Connected",
                            style = MaterialTheme.typography.labelMedium,
                            color = StatusColors.onSuccessContainer(isDark),
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                        )
                    }
                } else {
                    FilledTonalButton(
                        onClick = onStartMicrosoftLogin,
                        colors = ButtonDefaults.tonalPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text("Connect", style = MaterialTheme.typography.labelLarge)
                        Spacer(modifier = Modifier.width(8.dp))
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowForward,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Collapsible advanced client-ID editor BELOW primary source cards
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.quietCardColors(),
            border = CardDefaults.quietCardBorder(),
            elevation = CardDefaults.quietCardElevation(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = PillButtonMinHeight)
                            .clickable { customIdsExpanded = !customIdsExpanded }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Custom sign-in client IDs (advanced)",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text =
                                if (hasCustomClientIds) {
                                    "Custom OAuth ID saved"
                                } else {
                                    "Optional — only needed if your university requires one"
                                },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Icon(
                        imageVector =
                            if (customIdsExpanded) {
                                Icons.Outlined.ExpandLess
                            } else {
                                Icons.Outlined.ExpandMore
                            },
                        contentDescription =
                            if (customIdsExpanded) {
                                "Collapse custom client IDs"
                            } else {
                                "Expand custom client IDs"
                            },
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                AnimatedVisibility(visible = customIdsExpanded) {
                    Column(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    ) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Spacer(modifier = Modifier.height(12.dp))
                        OAuthClientIdFields(
                            viewModel = viewModel,
                            microsoftConnected = isMicrosoftConnected,
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        Button(
            onClick = onNext,
            modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
            colors = ButtonDefaults.filledPill(),
            contentPadding = PillButtonContentPadding,
        ) {
            Text("Continue to Theme", style = MaterialTheme.typography.labelLarge)
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(16.dp))
        }
    }
}

// =============================================================================
// STEP 5: THEME (mode + preferred dark scheme — matching Settings names)
// =============================================================================
private data class ThemePreviewOption(
    val mode: String,
    val darkTheme: String?,
    val label: String,
    val description: String,
    val swatchBg: Color,
    val swatchAccent: Color,
)

@Composable
private fun Step5Theme(
    viewModel: QuizRadarViewModel,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val themeMode by viewModel.themeMode.collectAsState()
    val preferredDarkTheme by viewModel.preferredDarkTheme.collectAsState()
    val themeOptions =
        listOf(
            ThemePreviewOption(
                mode = "system",
                darkTheme = null,
                label = "System default",
                description = "Follows your device's light or dark setting",
                swatchBg = Color(0xFF475569),
                swatchAccent = Color(0xFF93C5FD),
            ),
            ThemePreviewOption(
                mode = "light",
                darkTheme = null,
                label = "Solar Dawn (Light)",
                description = "Clean warm daylight surfaces",
                swatchBg = Color(0xFFF8FAFC),
                swatchAccent = Color(0xFF1D4ED8),
            ),
            ThemePreviewOption(
                mode = "dark",
                darkTheme = "obsidian",
                label = "Obsidian Cosmic (Dark)",
                description = "Deep slate canvas for night study",
                swatchBg = Color(0xFF0F172A),
                swatchAccent = Color(0xFF60A5FA),
            ),
            ThemePreviewOption(
                mode = "dark",
                darkTheme = "amoled",
                label = "AMOLED Pure Black",
                description = "True black OLED canvas with subtle stars",
                swatchBg = Color(0xFF000000),
                swatchAccent = Color(0xFF38BDF8),
            ),
        )

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "Appearance",
            style = MaterialTheme.typography.titleLarge,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Pick how QuizRadar looks. You can change this any time in Settings.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(16.dp))

        Column(
            modifier = Modifier.fillMaxWidth().selectableGroup(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            themeOptions.forEach { option ->
                val isSelected =
                    if (option.darkTheme == null) {
                        themeMode == option.mode
                    } else {
                        themeMode == option.mode && preferredDarkTheme == option.darkTheme
                    }
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color =
                        if (isSelected) {
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)
                        } else {
                            MaterialTheme.colorScheme.surface
                        },
                    border =
                        BorderStroke(
                            width = if (isSelected) 1.5.dp else 1.dp,
                            color =
                                if (isSelected) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.outlineVariant
                                },
                        ),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = 60.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .selectable(
                                selected = isSelected,
                                role = Role.RadioButton,
                                onClick = {
                                    viewModel.setThemeMode(option.mode)
                                    option.darkTheme?.let { viewModel.setPreferredDarkTheme(it) }
                                },
                            ),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier =
                                Modifier
                                    .size(28.dp)
                                    .clip(CircleShape)
                                    .background(option.swatchBg)
                                    .border(1.5.dp, option.swatchAccent, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(
                                modifier =
                                    Modifier
                                        .size(10.dp)
                                        .clip(CircleShape)
                                        .background(option.swatchAccent),
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = option.label,
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = option.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (isSelected) {
                            Spacer(modifier = Modifier.width(8.dp))
                            Icon(
                                imageVector = Icons.Outlined.CheckCircle,
                                contentDescription = "Selected",
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        Button(
            onClick = onNext,
            modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
            colors = ButtonDefaults.filledPill(),
            contentPadding = PillButtonContentPadding,
        ) {
            Text("Continue to Reminders", style = MaterialTheme.typography.labelLarge)
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(16.dp))
        }
    }
}

// =============================================================================
// STEP 6: REMINDERS & FINISH
// =============================================================================
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Step6Reminders(
    viewModel: QuizRadarViewModel,
    hasNotificationPermission: Boolean,
    onRequestPermission: () -> Unit,
    onFinish: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val notifyExam24h by viewModel.notifyExam24h.collectAsState()
    val notifyExamSameDay by viewModel.notifyExamSameDay.collectAsState()
    val notifyMorningDigest by viewModel.notifyMorningDigest.collectAsState()
    val notifyMorningTime by viewModel.notifyMorningTime.collectAsState()
    var showDigestTimePicker by rememberSaveable { mutableStateOf(false) }
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "Exam Reminders",
            style = MaterialTheme.typography.titleLarge,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Never miss a deadline. Choose when QuizRadar alerts you before quizzes and exams.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Permission primer + toggles card
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.quietCardColors(),
            border = CardDefaults.quietCardBorder(),
            elevation = CardDefaults.quietCardElevation(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = PillButtonMinHeight),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Notifications,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(24.dp),
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Notification Permission",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            text =
                                if (hasNotificationPermission) {
                                    "Notifications are enabled on this device"
                                } else {
                                    "Allow Android notifications so exam reminders can appear"
                                },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    if (hasNotificationPermission) {
                        Icon(
                            imageVector = Icons.Outlined.CheckCircle,
                            contentDescription = "Permission granted",
                            tint = StatusColors.success(isDark),
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }

                if (!hasNotificationPermission) {
                    Spacer(modifier = Modifier.height(8.dp))
                    FilledTonalButton(
                        onClick = onRequestPermission,
                        colors = ButtonDefaults.tonalPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text("Enable notifications", style = MaterialTheme.typography.labelLarge)
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Spacer(modifier = Modifier.height(12.dp))

                ReminderToggleRow(
                    title = "24-Hour Heads Up",
                    subtitle = "Notify the day before an upcoming exam",
                    checked = notifyExam24h,
                    onCheckedChange = { viewModel.setNotifyExam24h(it) },
                )

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 8.dp))

                ReminderToggleRow(
                    title = "Morning of Exam",
                    subtitle = "Notify on the morning of each exam",
                    checked = notifyExamSameDay,
                    onCheckedChange = { viewModel.setNotifyExamSameDay(it) },
                )

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 8.dp))

                ReminderToggleRow(
                    title = "Daily Morning Digest",
                    subtitle = "Overview of your day's classes at $notifyMorningTime",
                    checked = notifyMorningDigest,
                    onCheckedChange = { viewModel.setNotifyMorningDigest(it) },
                )

                if (notifyMorningDigest) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                        horizontalArrangement = Arrangement.Start,
                    ) {
                        OutlinedButton(
                            onClick = { showDigestTimePicker = true },
                            modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Timer,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Digest time: $notifyMorningTime",
                                style =
                                    MaterialTheme.typography.labelLarge.copy(
                                        fontFeatureSettings = "tnum",
                                    ),
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        Button(
            onClick = onFinish,
            modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
            colors = ButtonDefaults.filledPill(),
            contentPadding = PillButtonContentPadding,
        ) {
            Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text("Finish Setup & Enter QuizRadar", style = MaterialTheme.typography.labelLarge)
        }
    }

    if (showDigestTimePicker) {
        val timeParts = notifyMorningTime.split(":")
        val timePickerState =
            rememberTimePickerState(
                initialHour = timeParts.getOrNull(0)?.toIntOrNull()?.coerceIn(0, 23) ?: 8,
                initialMinute = timeParts.getOrNull(1)?.toIntOrNull()?.coerceIn(0, 59) ?: 0,
                is24Hour = true,
            )
        AlertDialog(
            onDismissRequest = { showDigestTimePicker = false },
            title = { Text("Digest time") },
            text = { TimePicker(state = timePickerState) },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.setNotifyMorningTime(
                            String.format(
                                java.util.Locale.US,
                                "%02d:%02d",
                                timePickerState.hour,
                                timePickerState.minute,
                            ),
                        )
                        showDigestTimePicker = false
                    },
                    colors = ButtonDefaults.filledPill(),
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Text("Save", style = MaterialTheme.typography.labelLarge)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showDigestTimePicker = false },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Cancel", style = MaterialTheme.typography.labelLarge)
                }
            },
        )
    }
}

@Composable
private fun ReminderToggleRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = PillButtonMinHeight)
                .toggleable(
                    value = checked,
                    role = Role.Switch,
                    onValueChange = onCheckedChange,
                ),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(
                subtitle,
                style =
                    MaterialTheme.typography.bodySmall.copy(
                        // The digest time is data - tabular figures keep it from
                        // shifting as the digits change.
                        fontFeatureSettings = "tnum",
                    ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(checked = checked, onCheckedChange = null)
    }
}

/** The course's own colour, resolved through the canonical CoursePalette. */
private fun courseSwatch(
    courseId: String,
    hex: String?,
): Color = CoursePalette.get(courseId, hex).color

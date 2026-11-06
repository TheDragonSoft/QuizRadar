package com.quizradar.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.ACADEMIC_TRACKS
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.TimetableImportState
import com.quizradar.app.ui.components.OAuthClientIdFields
import com.quizradar.app.ui.components.TimetableImportErrorDialog
import com.quizradar.app.ui.components.TimetableImportPreviewDialog
import com.quizradar.app.ui.components.TimetableImportWorkingDialog
import com.quizradar.app.ui.detail.CourseEditorSheet
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.readScaledImage
import com.quizradar.app.ui.theme.StatusColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// The three presets the spec names (`01` §4.1: Medicine / Business / Sciences)
// live in one shared list (`com.quizradar.app.ui.ACADEMIC_TRACKS`) so the
// wizard, the Settings card and the web tier agree on the stored ids.
private val STUDY_TRACKS = ACADEMIC_TRACKS

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OnboardingWizardScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    onComplete: () -> Unit,
    onStartGoogleLogin: () -> Unit = {},
    onStartMicrosoftLogin: () -> Unit = {},
    onImportBackup: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val currentStep by viewModel.onboardingStep.collectAsState()
    // The persisted study-track preset (`01` §4.1) — the wizard shows what
    // was saved and writes the answer straight through.
    val savedTrack by viewModel.academicTrack.collectAsState()
    val scrollState = rememberScrollState()

    var isAddCourseOpen by rememberSaveable { mutableStateOf(false) }
    val addCourseSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val timetableImportState by viewModel.timetableImportState.collectAsState()
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

    // Back navigates one step back. On the FIRST step there is nowhere to go
    // back to: the old code silently completed the wizard, which dropped the
    // user into an app that had just been marked "set up" without a single
    // answer given. Back must never do that.
    BackHandler(enabled = currentStep > 1) {
        viewModel.setOnboardingStep(currentStep - 1)
    }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                text = "QuizRadar Setup",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                text = "Step $currentStep of 4",
                                style = MaterialTheme.typography.bodySmall,
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
                    actions = {
                        TextButton(
                            onClick = {
                                viewModel.completeOnboarding()
                                onComplete()
                            },
                        ) {
                            Text("Skip", fontWeight = FontWeight.SemiBold)
                        }
                    },
                    colors =
                        TopAppBarDefaults.topAppBarColors(
                            containerColor = MaterialTheme.colorScheme.surface,
                            titleContentColor = MaterialTheme.colorScheme.onSurface,
                        ),
                )
                LinearProgressIndicator(
                    progress = { currentStep / 4f },
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
        modifier = modifier.fillMaxSize(),
    ) { innerPadding ->
        Box(
            modifier =
                Modifier
                    .padding(innerPadding)
                    .fillMaxSize(),
        ) {
            AnimatedContent(
                targetState = currentStep,
                transitionSpec = {
                    fadeIn(animationSpec = tween(220)) togetherWith fadeOut(animationSpec = tween(180))
                },
                label = "onboarding_step_crossfade",
            ) { step ->
                Column(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .verticalScroll(scrollState)
                            .padding(horizontal = 20.dp, vertical = 16.dp),
                ) {
                    when (step) {
                        1 ->
                            Step1Welcome(
                                onGetStarted = { viewModel.setOnboardingStep(2) },
                                onRestoreBackup = onImportBackup,
                            )

                        2 ->
                            Step2Timetable(
                                snapshot = snapshot,
                                savedTrack = savedTrack,
                                onTrackSelected = { viewModel.setAcademicTrack(it) },
                                onImportTimetablePhoto = {
                                    timetableImageLauncher.launch(
                                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                                    )
                                },
                                onAddCourse = { isAddCourseOpen = true },
                                onNext = { viewModel.setOnboardingStep(3) },
                            )

                        3 ->
                            Step3Sources(
                                viewModel = viewModel,
                                onStartGoogleLogin = onStartGoogleLogin,
                                onStartMicrosoftLogin = onStartMicrosoftLogin,
                                onNext = { viewModel.setOnboardingStep(4) },
                            )

                        4 ->
                            Step4Reminders(
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
                is TimetableImportState.Failed ->
                    TimetableImportErrorDialog(
                        message = importState.message,
                        onDismiss = { viewModel.dismissTimetableImport() },
                    )
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
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(24.dp))

        Box(
            modifier =
                Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Outlined.AutoAwesome,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(38.dp),
            )
        }

        Spacer(modifier = Modifier.height(18.dp))

        Text(
            text = "Welcome to QuizRadar",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "Never miss another university quiz, lab, or exam date.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(28.dp))

        // Value proposition card
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(18.dp)) {
                Text(
                    text = "How QuizRadar Works",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text =
                        "Professors announce exams with fuzzy text: \"Quiz 1 next Tuesday during class\". " +
                            "QuizRadar cross-references your weekly class schedule with course announcements to automatically " +
                            "pin exact dates, times, and study roadmaps.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    lineHeight = 20.sp,
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Zero-server privacy guarantee
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier.padding(14.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Shield,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(22.dp),
                )
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Text(
                        text = "100% Local-First & Zero-Server",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text =
                            "Your account tokens are kept in Keystore-backed encrypted storage, and your timetable " +
                                "and grades stay in this app's private storage on this device. " +
                                "Zero external servers, zero telemetry, zero analytics.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(36.dp))

        Button(
            onClick = onGetStarted,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Text("Get Started", fontWeight = FontWeight.Bold)
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(18.dp))
        }

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedButton(
            onClick = onRestoreBackup,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Icon(Icons.Outlined.UploadFile, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text("I Have a Backup File (Restore)")
        }
    }
}

// =============================================================================
// STEP 2: TIMETABLE & COURSES
// =============================================================================
@Composable
private fun Step2Timetable(
    snapshot: AppSnapshotModel,
    savedTrack: String?,
    onTrackSelected: (String) -> Unit,
    onImportTimetablePhoto: () -> Unit,
    onAddCourse: () -> Unit,
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
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "Add your enrolled courses so the engine knows your recurring class times.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(18.dp))

        // Study track chips
        Text(
            text = "Study Track / Field",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
        Spacer(modifier = Modifier.height(8.dp))
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            items(STUDY_TRACKS) { (id, label) ->
                FilterChip(
                    selected = selectedTrack == id,
                    onClick = {
                        selectedTrack = id
                        onTrackSelected(id)
                    },
                    label = { Text(label, fontSize = 12.sp) },
                )
            }
        }
        if (!knownTrack) {
            Text(
                text =
                    if (selectedTrack == null) {
                        "Not set - pick the field that matches your programme (optional)."
                    } else {
                        "Saved preset \"$selectedTrack\" is not one of the current options - " +
                            "pick one to replace it."
                    },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        // Enrolled courses card
        Card(
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Enrolled Courses (${snapshot.schedule.courses.size})",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedButton(
                            onClick = onImportTimetablePhoto,
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Import Photo", fontSize = 12.sp)
                        }
                        TextButton(onClick = onAddCourse) {
                            Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Add Course")
                        }
                    }
                }

                if (snapshot.schedule.courses.isEmpty()) {
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.School,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(32.dp),
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "No courses added yet",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = "Add at least one course with class hours to resolve exam dates.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                } else {
                    snapshot.schedule.courses.forEach { course ->
                        val slotCount = snapshot.schedule.slots.count { it.courseId == course.id }
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                val colorInt =
                                    try {
                                        android.graphics.Color.parseColor(course.color ?: "#1a73e8")
                                    } catch (_: Exception) {
                                        0xFF1A73E8.toInt()
                                    }
                                Box(
                                    modifier =
                                        Modifier
                                            .size(12.dp)
                                            .clip(CircleShape)
                                            .background(Color(colorInt)),
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Column {
                                    Text(
                                        text = "${course.id} · ${course.name}",
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Bold,
                                    )
                                    Text(
                                        text = "$slotCount weekly class slot(s)",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Timetable photo note
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Outlined.AutoAwesome,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text =
                        "Timetable image import works on this phone: open Settings -> Courses & " +
                            "Timetable -> AI Course Import and pick a screenshot. You can also add " +
                            "your courses and weekly class slots manually here.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        Button(
            onClick = onNext,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Text(if (snapshot.schedule.courses.isEmpty()) "Continue Without Courses" else "Continue to Sources")
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(18.dp))
        }
    }
}

// =============================================================================
// STEP 3: CONNECT SOURCES (SKIPPABLE)
// =============================================================================
@Composable
private fun Step3Sources(
    viewModel: QuizRadarViewModel,
    onStartGoogleLogin: () -> Unit,
    onStartMicrosoftLogin: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isGoogleConnected = viewModel.isGoogleConnected()
    val isMicrosoftConnected = viewModel.isMicrosoftConnected()
    val geminiApiKey by viewModel.geminiApiKey.collectAsState()
    var keyInput by remember(geminiApiKey) { mutableStateOf(geminiApiKey) }
    var isKeyVisible by rememberSaveable { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "Connect Announcement Sources",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text =
                "Sign in and QuizRadar scans Gmail, Classroom and Teams announcements ON THIS DEVICE " +
                    "and pins quiz and exam dates to your timetable. Tokens never leave your phone. " +
                    "Google sign-in ships ready (a built-in client id); Microsoft needs your own " +
                    "Azure app id - paste it below (it saves automatically). Fully skippable.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // The client-id editors live HERE, where the user hits the refusal -
        // sending them to Settings -> Sources mid-wizard was a detour long
        // enough that the id was often typed somewhere and never saved. The
        // shared component auto-saves as the user types.
        Spacer(modifier = Modifier.height(12.dp))
        OAuthClientIdFields(viewModel = viewModel)

        Spacer(modifier = Modifier.height(20.dp))

        // Google Card
        Card(
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable { if (!isGoogleConnected) onStartGoogleLogin() },
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
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
                        Spacer(modifier = Modifier.width(10.dp))
                        Column {
                            Text("Google Workspace", fontWeight = FontWeight.Bold)
                            Text(
                                "Gmail & Classroom (read-only) - scanned on this device once connected",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (isGoogleConnected) {
                        // The "Connected" chip was a light mint pill in
                        // every theme - a light-mode chip punched into the
                        // dark screen. The token carries both variants.
                        val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = StatusColors.successContainer(isDark),
                        ) {
                            Text(
                                text = "Connected",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = StatusColors.onSuccessContainer(isDark),
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            )
                        }
                    } else {
                        Button(
                            onClick = onStartGoogleLogin,
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text("Connect →", fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Microsoft Card
        Card(
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable { if (!isMicrosoftConnected) onStartMicrosoftLogin() },
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
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
                        Spacer(modifier = Modifier.width(10.dp))
                        Column {
                            Text("Microsoft Teams", fontWeight = FontWeight.Bold)
                            Text(
                                "Channel announcements (read-only) - scanned on this device once connected",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (isMicrosoftConnected) {
                        val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = StatusColors.successContainer(isDark),
                        ) {
                            Text(
                                text = "Connected",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = StatusColors.onSuccessContainer(isDark),
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            )
                        }
                    } else {
                        Button(
                            onClick = onStartMicrosoftLogin,
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text("Connect →", fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Optional Gemini Key
        Card(
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Gemini AI API Key (Optional)", fontWeight = FontWeight.Bold)
                Text(
                    "Used for practice quizzes and timetable vision parsing",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedTextField(
                    value = keyInput,
                    onValueChange = {
                        keyInput = it
                        // The key is persisted (debounced, off the main
                        // thread) but NOT announced per keystroke: a 30
                        // character key used to queue 30 Keystore writes and
                        // 30 "key saved" toasts, each interrupting a screen
                        // reader. The confirmation comes when the field
                        // loses focus.
                        viewModel.saveGeminiApiKey(it, announce = false)
                        viewModel.setGeminiEnabled(it.isNotBlank())
                    },
                    label = { Text("API Key (BYOK)") },
                    singleLine = true,
                    visualTransformation = if (isKeyVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
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
                            // One confirmation, when the user is done with
                            // the field - not one per letter. Never announce a removal
                            // toast if the user simply unfocused an empty field.
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
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Free-tier terms: Queries are sent directly from this phone to Google's API with your key.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        Button(
            onClick = onNext,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Text("Continue to Reminders")
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(18.dp))
        }
    }
}

// =============================================================================
// STEP 4: REMINDERS & FINISH
// =============================================================================
@Composable
private fun Step4Reminders(
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

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "Exam Reminders",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "Never miss a deadline. Configure notification heads-up before upcoming assessments.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(20.dp))

        // Permission primer card
        Card(
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        modifier = Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Notifications,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(24.dp),
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Column {
                            Text("Notification Permission", fontWeight = FontWeight.Bold)
                            Text(
                                if (hasNotificationPermission) {
                                    "Notifications are enabled"
                                } else {
                                    "Required to deliver reminders"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    if (hasNotificationPermission) {
                        Icon(
                            imageVector = Icons.Outlined.CheckCircle,
                            contentDescription = "Permission granted",
                            tint =
                                StatusColors.success(
                                    MaterialTheme.colorScheme.background.luminance() < 0.5f,
                                ),
                            modifier = Modifier.size(24.dp),
                        )
                    } else {
                        Button(
                            onClick = onRequestPermission,
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text("Enable", fontSize = 12.sp)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Spacer(modifier = Modifier.height(12.dp))

                // T-24h Switch
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("24-Hour Heads Up", fontWeight = FontWeight.SemiBold)
                        Text(
                            "Notify the day before an upcoming exam",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = notifyExam24h,
                        onCheckedChange = { viewModel.setNotifyExam24h(it) },
                    )
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 8.dp))

                // Same-Day Switch
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Morning of Exam", fontWeight = FontWeight.SemiBold)
                        Text(
                            "Notify on the morning of each exam",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = notifyExamSameDay,
                        onCheckedChange = { viewModel.setNotifyExamSameDay(it) },
                    )
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 8.dp))

                // Morning Digest Switch
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Daily Morning Digest", fontWeight = FontWeight.SemiBold)
                        Text(
                            "Overview of day's classes at $notifyMorningTime",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = notifyMorningDigest,
                        onCheckedChange = { viewModel.setNotifyMorningDigest(it) },
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        Button(
            onClick = onFinish,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text("Finish Setup & Enter QuizRadar", fontWeight = FontWeight.Bold)
        }
    }
}

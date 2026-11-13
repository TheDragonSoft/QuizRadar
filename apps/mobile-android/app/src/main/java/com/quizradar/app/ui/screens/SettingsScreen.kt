package com.quizradar.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.quizradar.app.core.BackgroundScanWorker
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.model.CourseModel
import com.quizradar.app.model.ScheduleSlotModel
import com.quizradar.app.notifications.NotificationHelper
import com.quizradar.app.ui.ACADEMIC_TRACKS
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.TimetableImportState
import com.quizradar.app.ui.academicTrackLabel
import com.quizradar.app.ui.components.OAuthClientIdFields
import com.quizradar.app.ui.components.TimetableImportErrorDialog
import com.quizradar.app.ui.components.TimetableImportPreviewDialog
import com.quizradar.app.ui.components.TimetableImportWorkingDialog
import com.quizradar.app.ui.detail.CourseEditorSheet
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.readScaledImage
import com.quizradar.app.ui.theme.ChipLeadingCheck
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.destructivePill
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
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    onNavigateBack: () -> Unit,
    onStartGoogleLogin: () -> Unit = {},
    onStartMicrosoftLogin: () -> Unit = {},
    onReRunOnboarding: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scrollState = rememberScrollState()
    // Status greens need a theme-aware variant: the old #047857 measured
    // 3.21:1 on the dark background, below the 4.5:1 body text needs.
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f

    // ViewModel StateFlows
    val userName by viewModel.userName.collectAsState()
    val userEmail by viewModel.userEmail.collectAsState()
    val geminiApiKey by viewModel.geminiApiKey.collectAsState()
    val geminiEnabled by viewModel.geminiEnabled.collectAsState()
    // The core version is a native call: it is read once off the main
    // thread and published here, so this screen never makes one while it
    // composes.
    val coreVersion by viewModel.coreVersion.collectAsState()
    val gmailEnabled by viewModel.gmailEnabled.collectAsState()
    val classroomEnabled by viewModel.classroomEnabled.collectAsState()
    val teamsEnabled by viewModel.teamsEnabled.collectAsState()
    val notifyExam24h by viewModel.notifyExam24h.collectAsState()
    val notifyExamSameDay by viewModel.notifyExamSameDay.collectAsState()
    val notifyMorningDigest by viewModel.notifyMorningDigest.collectAsState()
    val notifyMorningTime by viewModel.notifyMorningTime.collectAsState()
    val autoSyncGcal by viewModel.autoSyncGcal.collectAsState()
    val themeMode by viewModel.themeMode.collectAsState()
    val preferredDarkTheme by viewModel.preferredDarkTheme.collectAsState()
    // The AMOLED treatment follows the RESOLVED dark scheme, not a mode
    // string: the pure-black scheme is active in Dark mode and in System
    // mode with a dark system whenever the preferred dark theme is AMOLED.
    val isAmoledDark =
        preferredDarkTheme == "amoled" &&
            (themeMode == "dark" || (themeMode == "system" && isSystemInDarkTheme()))
    // One light theme ships, so "the light theme in use" is exactly this
    // resolved condition - the Appearance card mirrors it instead of a
    // constant selection the state never held.
    val isLightSchemeActive = themeMode == "light" || (themeMode == "system" && !isSystemInDarkTheme())
    val academicTrack by viewModel.academicTrack.collectAsState()
    val timetableImportState by viewModel.timetableImportState.collectAsState()
    val backgroundScanEnabled by viewModel.backgroundScanEnabled.collectAsState()

    // Dialog & Sheet States
    var showEditProfileDialog by rememberSaveable { mutableStateOf(false) }
    var showDisconnectGoogleDialog by rememberSaveable { mutableStateOf(false) }
    var showDisconnectMicrosoftDialog by rememberSaveable { mutableStateOf(false) }
    var showAddFeedDialog by rememberSaveable { mutableStateOf(false) }
    var feedPendingDeleteUrl by rememberSaveable { mutableStateOf<String?>(null) }
    var showResetConfirmDialog by rememberSaveable { mutableStateOf(false) }
    var resetInputText by rememberSaveable { mutableStateOf("") }
    // Digest time picker (M3 TimePicker in a dialog) - the "at $time" copy
    // used to display a value nothing could ever change.
    var showDigestTimePicker by rememberSaveable { mutableStateOf(false) }
    var isAdvancedOAuthExpanded by rememberSaveable { mutableStateOf(false) }

    // Course Editor Sheet State
    var editingCourse by remember { mutableStateOf<CourseModel?>(null) }
    var editingCourseSlots by remember { mutableStateOf<List<ScheduleSlotModel>>(emptyList()) }
    var isCourseSheetOpen by rememberSaveable { mutableStateOf(false) }
    val courseSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // AI validation state
    var isAiValidating by remember { mutableStateOf(false) }
    var aiValidationStatus by remember { mutableStateOf<String?>(null) }
    var keyInputValue by remember(geminiApiKey) { mutableStateOf(geminiApiKey) }
    var isKeyVisible by rememberSaveable { mutableStateOf(false) }

    // SAF Launchers
    val exportBackupLauncher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.CreateDocument("application/json"),
        ) { uri ->
            if (uri != null) {
                viewModel.exportBackup { jsonContent ->
                    try {
                        context.contentResolver.openOutputStream(uri)?.use { stream ->
                            stream.write(jsonContent.toByteArray())
                        }
                        viewModel.showToast("Backup exported successfully")
                    } catch (e: Exception) {
                        viewModel.showToast("Export failed: ${e.message}")
                    }
                }
            }
        }

    val importBackupLauncher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.GetContent(),
        ) { uri ->
            if (uri != null) {
                try {
                    val content =
                        context.contentResolver
                            .openInputStream(uri)
                            ?.bufferedReader()
                            ?.use { it.readText() }
                    if (!content.isNullOrBlank()) {
                        viewModel.importBackup(content)
                    }
                } catch (e: Exception) {
                    viewModel.showToast("Import failed: ${e.message}")
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
                viewModel.showToast("Notification permission denied")
            }
        }

    // AI timetable-image import (`01` §4.1): the user picks a screenshot,
    // Gemini reads it and the preview shows what was found BEFORE anything is
    // saved. The photo-picker contract needs no storage permission.
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

    val hasNotificationPermission =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Text(
                            text = "Settings",
                            style = MaterialTheme.typography.titleLarge,
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Navigate back",
                            )
                        }
                    },
                    colors =
                        TopAppBarDefaults.topAppBarColors(
                            // AMOLED needs the pure-black token role, not a raw
                            // Color.Black literal: surfaceContainerLowest IS
                            // black in the AMOLED scheme (QuizRadarTheme.kt).
                            containerColor =
                                if (isAmoledDark) {
                                    MaterialTheme.colorScheme.surfaceContainerLowest
                                } else {
                                    MaterialTheme.colorScheme.surface
                                },
                            titleContentColor = MaterialTheme.colorScheme.onSurface,
                        ),
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        },
        containerColor = if (isAmoledDark) Color.Transparent else MaterialTheme.colorScheme.background,
        modifier = modifier.fillMaxSize(),
    ) { innerPadding ->
        Column(
            modifier =
                Modifier
                    .padding(innerPadding)
                    .verticalScroll(scrollState)
                    // Text fields (API key, feed dialog) must never end up
                    // under the keyboard - the whole settings body rides up.
                    .imePadding()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
        ) {
            // =========================================================================
            // 1. ACCOUNT & CONNECTIONS
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.AccountCircle,
                title = "Account & Connections",
            )

            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = userName.ifBlank { "Student Profile" },
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                text = userEmail.ifBlank { "No email configured (local-only profile)" },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(
                            onClick = { showEditProfileDialog = true },
                            modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                        ) {
                            Text("Edit Profile")
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))
                    Surface(
                        shape = MaterialTheme.shapes.extraSmall,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Info,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Zero-server mode: auth tokens & schedule data never leave this device.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    // Academic Rhythm Preset — the answer the onboarding wizard
                    // collects (`01` §4.1). It is shown here so the user can see
                    // (and change) what was saved, exactly like the web tier's
                    // Settings -> Account card.
                    Text(
                        text = "Academic Rhythm Preset",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text =
                            academicTrackLabel(academicTrack) +
                                " - it tunes how announcements are read as quiz, exam, or tutorial.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        items(ACADEMIC_TRACKS) { (id, label) ->
                            val isTrackSelected = academicTrack == id
                            FilterChip(
                                selected = isTrackSelected,
                                onClick = { viewModel.setAcademicTrack(id) },
                                // 48dp touch target: FilterChip defaults to 32dp,
                                // below the minimum a thumb reliably hits.
                                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                colors = FilterChipDefaults.quietChipColors(),
                                label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                                // Selection is never colour-only.
                                leadingIcon = { if (isTrackSelected) ChipLeadingCheck() },
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    // Google Account Card
                    val isGoogleConnected = viewModel.isGoogleConnected()
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = "Google Account",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                StatusPill(connected = isGoogleConnected)
                            }
                            Text(
                                text = "Gmail (read-only) · Google Classroom (read-only)",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (isGoogleConnected) {
                            Button(
                                onClick = { showDisconnectGoogleDialog = true },
                                colors = ButtonDefaults.tonalPill(),
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                                contentPadding = PillButtonContentPadding,
                            ) {
                                Text("Disconnect")
                            }
                        } else {
                            Button(
                                onClick = onStartGoogleLogin,
                                colors = ButtonDefaults.filledPill(),
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                                contentPadding = PillButtonContentPadding,
                            ) {
                                Text("Sign In")
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    // Microsoft Account Card
                    val isMicrosoftConnected = viewModel.isMicrosoftConnected()
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = "Microsoft Account",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                StatusPill(connected = isMicrosoftConnected)
                            }
                            Text(
                                text = "Microsoft Teams announcements (read-only)",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (isMicrosoftConnected) {
                            Button(
                                onClick = { showDisconnectMicrosoftDialog = true },
                                colors = ButtonDefaults.tonalPill(),
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                                contentPadding = PillButtonContentPadding,
                            ) {
                                Text("Disconnect")
                            }
                        } else {
                            Button(
                                onClick = onStartMicrosoftLogin,
                                colors = ButtonDefaults.filledPill(),
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                                contentPadding = PillButtonContentPadding,
                            ) {
                                Text("Sign In")
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // =========================================================================
            // 2. COURSES & TIMETABLE
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.School,
                title = "Courses & Timetable",
            )

            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = tabular("Enrolled Courses ", "(${snapshot.schedule.courses.size})"),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        IconButton(
                            onClick = {
                                editingCourse = null
                                editingCourseSlots = emptyList()
                                isCourseSheetOpen = true
                            },
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Add,
                                contentDescription = "Add course",
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }

                    if (snapshot.schedule.courses.isEmpty()) {
                        Text(
                            text = "No courses enrolled. Add your courses and weekly timetable slots so QuizRadar can resolve exam dates.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    } else {
                        snapshot.schedule.courses.forEach { course ->
                            val courseSlots = snapshot.schedule.slots.filter { it.courseId == course.id }
                            Surface(
                                shape = MaterialTheme.shapes.extraSmall,
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 4.dp)
                                        .clickable {
                                            editingCourse = course
                                            editingCourseSlots = courseSlots
                                            isCourseSheetOpen = true
                                        },
                            ) {
                                Row(
                                    modifier = Modifier.padding(12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        // The dot colour is USER DATA (the saved
                                        // course colour string), parsed here. Only
                                        // the missing/invalid fallback is a theme
                                        // role - never a hardcoded brand hex.
                                        val courseColor =
                                            try {
                                                Color(android.graphics.Color.parseColor(course.color))
                                            } catch (_: Exception) {
                                                MaterialTheme.colorScheme.primary
                                            }
                                        Box(
                                            modifier =
                                                Modifier
                                                    .size(12.dp)
                                                    .clip(CircleShape)
                                                    .background(courseColor),
                                        )
                                        Spacer(modifier = Modifier.width(12.dp))
                                        Column {
                                            Text(
                                                text = "${course.id} · ${course.name}",
                                                style = MaterialTheme.typography.bodyMedium,
                                                fontWeight = FontWeight.SemiBold,
                                            )
                                            Text(
                                                // Count and noun agree, like the
                                                // onboarding import preview:
                                                // "1 weekly slot" / "N weekly slots".
                                                text = if (courseSlots.size == 1) "1 weekly slot" else "${courseSlots.size} weekly slots",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                    Text(
                                        text = "Edit",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))
                    Button(
                        onClick = onReRunOnboarding,
                        colors = ButtonDefaults.tonalPill(),
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PillButtonContentPadding,
                    ) {
                        Text("Re-run Timetable Onboarding")
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    // AI course import (`01` §4.1): the Android app reads a
                    // timetable screenshot with Gemini, exactly like the
                    // desktop shell and the web companion do.
                    Text(
                        text = "AI Course Import",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text =
                            "Pick a timetable screenshot. Gemini reads it on your phone and you " +
                                "review the courses and class slots before anything is saved. " +
                                "Needs AI turned on and a saved Gemini API key (AI section below).",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    // A07: the image-extraction path must check the AI-enabled
                    // preference AND key presence, not just key presence - the
                    // blocker is stated inline, not in a toast after the tap.
                    val aiImportReady = geminiEnabled && geminiApiKey.isNotBlank()
                    Button(
                        onClick = {
                            timetableImageLauncher.launch(
                                androidx.activity.result.PickVisualMediaRequest(
                                    ActivityResultContracts.PickVisualMedia.ImageOnly,
                                ),
                            )
                        },
                        enabled = aiImportReady,
                        colors = ButtonDefaults.tonalPill(),
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PillButtonContentPadding,
                    ) {
                        Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Import Timetable from Image (AI)")
                    }
                    if (!aiImportReady) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text =
                                "Timetable image import is unavailable: " +
                                    if (!geminiEnabled) {
                                        "AI features are turned off. Enable them in the AI section below."
                                    } else {
                                        "No Gemini API key is saved. Add and save one in the AI section below."
                                    },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // =========================================================================
            // 3. SOURCES
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.RssFeed,
                title = "Sources",
            )

            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    // Gmail toggle
                    SourceToggleRow(
                        name = "Gmail Scanning",
                        desc = "Scans course announcement emails",
                        icon = Icons.Outlined.Email,
                        enabled = gmailEnabled,
                        onToggle = { viewModel.setSourceEnabled("gmail", it) },
                    )

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                    // Classroom toggle
                    SourceToggleRow(
                        name = "Google Classroom",
                        desc = "Scans coursework and assignments",
                        icon = Icons.Outlined.School,
                        enabled = classroomEnabled,
                        onToggle = { viewModel.setSourceEnabled("classroom", it) },
                    )

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                    // Teams toggle
                    SourceToggleRow(
                        name = "Microsoft Teams",
                        desc = "Scans channel posts and quizzes",
                        icon = Icons.Outlined.Groups,
                        enabled = teamsEnabled,
                        onToggle = { viewModel.setSourceEnabled("teams", it) },
                    )

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                    // Moodle REST (Desktop only honesty)
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .defaultMinSize(minHeight = 56.dp)
                                .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = "Moodle REST",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Surface(
                                    shape = MaterialTheme.shapes.small,
                                    color = MaterialTheme.colorScheme.secondaryContainer,
                                ) {
                                    Text(
                                        text = "Desktop only",
                                        style = MaterialTheme.typography.labelSmall,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    )
                                }
                            }
                            Text(
                                text = "Direct token scraping and local web session sync are supported in the desktop client.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    // Calendar Feeds (.ics)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text(
                                text = tabular("Calendar Feeds ", "(${snapshot.feeds.size}/10)"),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = "Subscribed HTTPS iCalendar (.ics) URLs",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(onClick = { showAddFeedDialog = true }) {
                            Icon(
                                imageVector = Icons.Outlined.Add,
                                contentDescription = "Add feed",
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }

                    if (snapshot.feeds.isEmpty()) {
                        Text(
                            text = "No .ics feeds configured. Tap + to subscribe to university academic calendar feeds.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    } else {
                        snapshot.feeds.forEach { feed ->
                            Surface(
                                shape = MaterialTheme.shapes.extraSmall,
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 4.dp),
                            ) {
                                Row(
                                    modifier = Modifier.padding(12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = feed.label,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                        Text(
                                            feed.url,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 1,
                                        )
                                    }
                                    IconButton(
                                        // A02: removal is a real delete of THIS
                                        // feed, confirmed first, and never
                                        // touches unrelated preferences.
                                        onClick = { feedPendingDeleteUrl = feed.url },
                                    ) {
                                        Icon(
                                            imageVector = Icons.Outlined.Delete,
                                            contentDescription = "Remove feed",
                                            tint = MaterialTheme.colorScheme.error,
                                            modifier = Modifier.size(20.dp),
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    // The REAL Google Calendar push (Settings action). Visible
                    // only when a Google account is signed in - the button
                    // would otherwise only ever produce an honest "skipped".
                    if (viewModel.isGoogleConnected()) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "Google Calendar push",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    "Push every dated upcoming assessment to your primary calendar",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Button(
                                onClick = { viewModel.pushGcalNow() },
                                colors = ButtonDefaults.tonalPill(),
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                                contentPadding = PillButtonContentPadding,
                            ) {
                                Text("Push now")
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Spacer(modifier = Modifier.height(12.dp))
                    }

                    // Background periodic scan: explicit opt-in, default OFF.
                    // The worker re-checks this toggle from the store at run
                    // time and posts no notifications on its own.
                    SettingsSwitchRow(
                        name = "Background scan (every 6 hours)",
                        desc =
                            "Scan your connected sources periodically, even when the app is closed. " +
                                "Off by default; a scan that finds nothing never notifies you.",
                        checked = backgroundScanEnabled,
                        onCheckedChange = { enabled ->
                            viewModel.setBackgroundScanEnabled(enabled)
                            BackgroundScanWorker.reschedule(context, enabled)
                        },
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // =========================================================================
            // 4. AI (GEMINI BYOK)
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.AutoAwesome,
                title = "AI (Gemini BYOK)",
            )

            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Enable Gemini AI features",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = "Generates practice quizzes, study plans, and topic reasoning",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = geminiEnabled,
                            onCheckedChange = { viewModel.setGeminiEnabled(it) },
                        )
                    }

                    // The key field and the enable toggle are deliberately
                    // separate: turning the toggle on without a saved key is
                    // not an error, but the screen must say so honestly.
                    if (geminiEnabled && geminiApiKey.isBlank()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "AI features are on, but no Gemini API key is saved - paste and save one below to use them.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    OutlinedTextField(
                        value = keyInputValue,
                        onValueChange = { keyInputValue = it },
                        label = { Text("Gemini API Key (BYOK)") },
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
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = { viewModel.saveGeminiApiKey(keyInputValue) },
                            colors = ButtonDefaults.filledPill(),
                            contentPadding = PillButtonContentPadding,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Save Key")
                        }

                        Button(
                            onClick = {
                                isAiValidating = true
                                aiValidationStatus = null
                                viewModel.validateGeminiKey(keyInputValue) { success, msg ->
                                    isAiValidating = false
                                    aiValidationStatus = msg
                                }
                            },
                            enabled = !isAiValidating && keyInputValue.isNotBlank(),
                            colors = ButtonDefaults.tonalPill(),
                            contentPadding = PillButtonContentPadding,
                            modifier = Modifier.weight(1f),
                        ) {
                            if (isAiValidating) {
                                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                            } else {
                                Text("Validate Key")
                            }
                        }
                    }

                    aiValidationStatus?.let { status ->
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = status,
                            style = MaterialTheme.typography.bodySmall,
                            color =
                                if (status.contains("valid", ignoreCase = true)) {
                                    StatusColors.success(isDark)
                                } else {
                                    MaterialTheme.colorScheme.error
                                },
                            fontWeight = FontWeight.Medium,
                        )
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Enable-time disclosure - VERBATIM copy per
                    // docs/rebuild/05-ai-features-plan.md §5 item 1. Do not
                    // paraphrase: this exact sentence is the consent record.
                    Surface(
                        shape = MaterialTheme.shapes.extraSmall,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                text = "Before you enable AI:",
                                style = MaterialTheme.typography.labelMedium,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text =
                                    "Your email announcements and timetable images are sent to Google's Gemini API when AI is used. " +
                                        "On Google's free tier, Google may use that content to improve its products. " +
                                        "Turn off to stay fully local.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // =========================================================================
            // 5. NOTIFICATIONS
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.Notifications,
                title = "Notifications",
            )

            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    if (!hasNotificationPermission) {
                        Surface(
                            shape = MaterialTheme.shapes.extraSmall,
                            color = MaterialTheme.colorScheme.errorContainer,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "Permission required",
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onErrorContainer,
                                    )
                                    Text(
                                        text = "Grant notification permission to receive exam alerts",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onErrorContainer,
                                    )
                                }
                                Button(
                                    onClick = {
                                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                        }
                                    },
                                    colors = ButtonDefaults.filledPill(),
                                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                                    contentPadding = PillButtonContentPadding,
                                ) {
                                    Text("Grant")
                                }
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                    }

                    // 24h Reminder Switch
                    SettingsSwitchRow(
                        name = "Exam Reminder (T-24h)",
                        desc = "Notify the day before each upcoming exam",
                        checked = notifyExam24h,
                        onCheckedChange = { viewModel.setNotifyExam24h(it) },
                    )

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                    // Same-Day Reminder Switch
                    SettingsSwitchRow(
                        name = "Same-Day Exam Alert",
                        desc = "Notify on the morning of an exam",
                        checked = notifyExamSameDay,
                        onCheckedChange = { viewModel.setNotifyExamSameDay(it) },
                    )

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                    // Morning Digest Switch & Time. The time is now SETTABLE:
                    // the row used to display "at 08:00" while nothing could
                    // ever change the value.
                    SettingsSwitchRow(
                        name = "Daily Morning Digest",
                        desc = "Daily summary of classes and assessments at $notifyMorningTime",
                        checked = notifyMorningDigest,
                        onCheckedChange = { viewModel.setNotifyMorningDigest(it) },
                    )

                    TextButton(
                        onClick = { showDigestTimePicker = true },
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text(text = tabular("Set digest time ", "($notifyMorningTime)"))
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    Button(
                        onClick = { NotificationHelper.sendTestNotification(context) },
                        colors = ButtonDefaults.tonalPill(),
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PillButtonContentPadding,
                    ) {
                        Text("Send Test Notification")
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // =========================================================================
            // 6. CALENDAR
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.CalendarMonth,
                title = "Calendar",
            )

            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    // The auto-push toggle is REAL: after a scan that discovered
                    // or updated items (and with Google signed in), the shell
                    // pushes them and reports the push outcome in the scan
                    // summary. The former "Sync Weekly Classes" row was removed
                    // entirely - no feature backed it, and a switch that does
                    // nothing is banned.
                    SettingsSwitchRow(
                        name = "Auto-push to Google Calendar",
                        desc =
                            "After a scan with new or updated items, push them to your primary Google Calendar " +
                                "(off by default)",
                        checked = autoSyncGcal,
                        onCheckedChange = { viewModel.setAutoSyncGcal(it) },
                    )

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                    Text(
                        text =
                            "A one-off push is available in Sources -> Google Calendar push. " +
                                "Scope refusals surface as errors - nothing is marked as synced.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // =========================================================================
            // 7. APPEARANCE
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.Palette,
                title = "Appearance",
            )

            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Appearance Mode",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(modifier = Modifier.height(12.dp))

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        // Mode chips set ONLY the mode: which dark scheme renders
                        // is the separate "Preferred Dark Theme" preference below,
                        // so switching modes can never drop an AMOLED choice.
                        listOf("system" to "System", "light" to "Light", "dark" to "Dark").forEach { (key, label) ->
                            val isChipSelected = themeMode == key
                            FilterChip(
                                selected = isChipSelected,
                                onClick = { viewModel.setThemeMode(key) },
                                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                colors = FilterChipDefaults.quietChipColors(),
                                label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                                // Selection is never colour-only.
                                leadingIcon = { if (isChipSelected) ChipLeadingCheck() },
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    Text(
                        text = "Preferred Light Theme",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Active in Light mode and during daytime",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    // QuizRadar ships exactly one light theme, so there is no
                    // light preference to persist or switch: the chip mirrors
                    // the resolved state (is the light scheme in use right
                    // now?) instead of a constant "selected" the state never
                    // held. Tapping it intentionally does nothing.
                    FilterChip(
                        selected = isLightSchemeActive,
                        onClick = {},
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        colors = FilterChipDefaults.quietChipColors(),
                        label = {
                            Text("Solar Dawn (only light theme)", style = MaterialTheme.typography.labelMedium)
                        },
                        // Selection is never colour-only.
                        leadingIcon = { if (isLightSchemeActive) ChipLeadingCheck() },
                    )

                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    Text(
                        text = "Preferred Dark Theme",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Active in Dark mode and during nighttime",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    // Dark-scheme chips set ONLY the dark preference; the
                    // selection derives from preferredDarkTheme alone, so it
                    // survives any Appearance Mode switch.
                    FilterChip(
                        selected = preferredDarkTheme == "obsidian",
                        onClick = { viewModel.setPreferredDarkTheme("obsidian") },
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        colors = FilterChipDefaults.quietChipColors(),
                        label = {
                            Text("Obsidian Cosmic (Default)", style = MaterialTheme.typography.labelMedium)
                        },
                        // Selection is never colour-only.
                        leadingIcon = { if (preferredDarkTheme == "obsidian") ChipLeadingCheck() },
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    FilterChip(
                        selected = preferredDarkTheme == "amoled",
                        onClick = { viewModel.setPreferredDarkTheme("amoled") },
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        colors = FilterChipDefaults.quietChipColors(),
                        label = {
                            Text("AMOLED Pure Black & Starlight", style = MaterialTheme.typography.labelMedium)
                        },
                        // Selection is never colour-only.
                        leadingIcon = { if (preferredDarkTheme == "amoled") ChipLeadingCheck() },
                    )

                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Reduced motion follows system accessibility settings.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // =========================================================================
            // 8. DATA MANAGEMENT
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.Storage,
                title = "Data Management",
            )

            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Backups are stored locally (spec §8 [M]). Credentials and OAuth tokens are never included in backups.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Button(
                            onClick = {
                                exportBackupLauncher.launch("quizradar-backup-${LocalDate.now()}.json")
                            },
                            colors = ButtonDefaults.tonalPill(),
                            contentPadding = PillButtonContentPadding,
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Export Backup")
                        }

                        Button(
                            onClick = {
                                importBackupLauncher.launch("application/json")
                            },
                            colors = ButtonDefaults.tonalPill(),
                            contentPadding = PillButtonContentPadding,
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Outlined.UploadFile, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Import Backup")
                        }
                    }

                    // Google Drive backup (data-only, app-data folder, explicit
                    // user action - never a background sync). The payload is
                    // built by the Rust core and structurally cannot carry
                    // tokens. "No backup found" is the honest empty state.
                    if (viewModel.isGoogleConnected()) {
                        Spacer(modifier = Modifier.height(16.dp))
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text =
                                "Google Drive backup: a data-only copy in your Drive app-data folder. " +
                                    "Tokens and credentials are never included.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Button(
                                onClick = { viewModel.pushDriveBackupNow() },
                                colors = ButtonDefaults.tonalPill(),
                                contentPadding = PillButtonContentPadding,
                                modifier = Modifier.weight(1f),
                            ) {
                                Icon(Icons.Outlined.UploadFile, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Back up to Drive")
                            }

                            Button(
                                onClick = { viewModel.restoreDriveBackupNow() },
                                colors = ButtonDefaults.tonalPill(),
                                contentPadding = PillButtonContentPadding,
                                modifier = Modifier.weight(1f),
                            ) {
                                Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Restore from Drive")
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    Button(
                        onClick = {
                            resetInputText = ""
                            showResetConfirmDialog = true
                        },
                        colors = ButtonDefaults.destructivePill(),
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PillButtonContentPadding,
                    ) {
                        Icon(Icons.Outlined.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Reset All Data")
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // =========================================================================
            // 9. ABOUT
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.Info,
                title = "About",
            )

            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = if (coreVersion.isBlank()) "QuizRadar" else "QuizRadar v$coreVersion",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = "Local-first quiz and exam radar",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text =
                            "QuizRadar runs zero external servers. All course matching, parsing, and exam radar derivation " +
                                "occur entirely on this device via the native Rust core.",
                        style = MaterialTheme.typography.bodySmall,
                    )

                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Licensed under Apache 2.0 / MIT. Zero telemetry, zero analytics.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // =========================================================================
            // 10. ADVANCED (FOLDED ACCORDION)
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.Settings,
                title = "Advanced",
            )

            Card(
                onClick = { isAdvancedOAuthExpanded = !isAdvancedOAuthExpanded },
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Custom OAuth Client IDs",
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text =
                                    if (isAdvancedOAuthExpanded) {
                                        "Tap to collapse custom client ID overrides"
                                    } else {
                                        "Tap to expand custom Google & Microsoft client ID overrides"
                                    },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Icon(
                            imageVector = if (isAdvancedOAuthExpanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                            contentDescription = if (isAdvancedOAuthExpanded) "Collapse" else "Expand",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    if (isAdvancedOAuthExpanded) {
                        Spacer(modifier = Modifier.height(16.dp))
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Spacer(modifier = Modifier.height(12.dp))
                        OAuthClientIdFields(viewModel = viewModel)
                    }
                }
            }

            // P3-8: the Anonymous Diagnostics preference is gone entirely.
            // AnalyticsManager is a no-op and QuizRadar ships zero telemetry
            // (AGENTS.md §9) - a switch that controls nothing must not exist.

            Spacer(modifier = Modifier.height(32.dp))
        }
    }

    // =========================================================================
    // DIALOGS & SHEETS
    // =========================================================================

    // Edit Profile Dialog
    if (showEditProfileDialog) {
        var draftName by rememberSaveable { mutableStateOf(userName) }
        var draftEmail by rememberSaveable { mutableStateOf(userEmail) }

        AlertDialog(
            onDismissRequest = { showEditProfileDialog = false },
            title = { Text("Edit Student Profile") },
            text = {
                Column {
                    OutlinedTextField(
                        value = draftName,
                        onValueChange = { draftName = it },
                        label = { Text("Student Name") },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = draftEmail,
                        onValueChange = { draftEmail = it },
                        label = { Text("Student Email") },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.saveUserProfile(draftName, draftEmail)
                        showEditProfileDialog = false
                    },
                    colors = ButtonDefaults.filledPill(),
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showEditProfileDialog = false },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Cancel")
                }
            },
        )
    }

    // Disconnect Google Dialog
    if (showDisconnectGoogleDialog) {
        AlertDialog(
            onDismissRequest = { showDisconnectGoogleDialog = false },
            title = { Text("Disconnect Google Account?") },
            text = {
                Text(
                    text =
                        "This will wipe all Google OAuth tokens from this device's Keystore-backed " +
                            "encrypted token store. " +
                            "Your courses and saved assessments will not be deleted.",
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.disconnectGoogle()
                        showDisconnectGoogleDialog = false
                    },
                    colors = ButtonDefaults.destructivePill(),
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Text("Disconnect")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showDisconnectGoogleDialog = false },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Cancel")
                }
            },
        )
    }

    // Disconnect Microsoft Dialog
    if (showDisconnectMicrosoftDialog) {
        AlertDialog(
            onDismissRequest = { showDisconnectMicrosoftDialog = false },
            title = { Text("Disconnect Microsoft Account?") },
            text = {
                Text(
                    "This will wipe Microsoft OAuth tokens from this device's Keystore-backed encrypted token " +
                        "store. Your saved schedule data will remain.",
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.disconnectMicrosoft()
                        showDisconnectMicrosoftDialog = false
                    },
                    colors = ButtonDefaults.destructivePill(),
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Text("Disconnect")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showDisconnectMicrosoftDialog = false },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Cancel")
                }
            },
        )
    }

    // Add Feed Dialog: every rejection reason the ViewModel would otherwise
    // only toast is validated inline BEFORE the call, and the dialog closes
    // only on the confirmed success callback (never on a failed save).
    if (showAddFeedDialog) {
        var feedUrl by rememberSaveable { mutableStateOf("") }
        var feedLabel by rememberSaveable { mutableStateOf("") }

        val trimmedUrl = feedUrl.trim()
        val feedUrlError =
            when {
                trimmedUrl.isEmpty() -> null
                !trimmedUrl.startsWith("https://", ignoreCase = true) ->
                    "Only HTTPS URLs are supported - university calendar feeds start with https://"
                snapshot.feeds.any { it.url.equals(trimmedUrl, ignoreCase = true) } ->
                    "You already subscribe to this feed URL"
                snapshot.feeds.size >= 10 ->
                    "Remove a feed first - QuizRadar keeps at most 10 calendar feeds"
                else -> null
            }

        AlertDialog(
            onDismissRequest = { showAddFeedDialog = false },
            title = { Text("Add Calendar Feed (.ics)") },
            text = {
                Column {
                    OutlinedTextField(
                        value = feedUrl,
                        onValueChange = { feedUrl = it },
                        label = { Text("Feed URL (https:// only)") },
                        singleLine = true,
                        isError = feedUrlError != null,
                        supportingText = {
                            feedUrlError?.let {
                                Text(it, color = MaterialTheme.colorScheme.error)
                            }
                        },
                        colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = feedLabel,
                        onValueChange = { feedLabel = it },
                        label = { Text("Label (e.g. University Calendar)") },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.addIcsFeed(feedUrl, feedLabel) {
                            showAddFeedDialog = false
                        }
                    },
                    enabled = trimmedUrl.isNotEmpty() && feedUrlError == null,
                    colors = ButtonDefaults.filledPill(),
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Text("Add Feed")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showAddFeedDialog = false },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Cancel")
                }
            },
        )
    }

    // Feed removal confirm: the delete itself is the ViewModel's real core
    // feed-delete (A02); the refreshed feed list is the outcome the user
    // sees, with the ViewModel reporting a failure loudly if the write fails.
    feedPendingDeleteUrl?.let { pendingUrl ->
        val pendingFeed =
            snapshot.feeds.firstOrNull { it.url.equals(pendingUrl, ignoreCase = true) }
        AlertDialog(
            onDismissRequest = { feedPendingDeleteUrl = null },
            title = { Text("Remove feed?") },
            text = {
                Text(
                    text =
                        "Removes \"${pendingFeed?.label ?: pendingUrl}\". QuizRadar stops fetching " +
                            "this calendar. Your other feeds and preferences are not changed.",
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.removeIcsFeed(pendingUrl)
                        feedPendingDeleteUrl = null
                    },
                    colors = ButtonDefaults.destructivePill(),
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Text("Remove")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { feedPendingDeleteUrl = null },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Cancel")
                }
            },
        )
    }

    // Digest time picker dialog: the M3 TimePicker, 24h (the persisted value
    // is a 24h "HH:mm" string and the reminder worker parses it as such).
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
                            String.format(java.util.Locale.US, "%02d:%02d", timePickerState.hour, timePickerState.minute),
                        )
                        showDigestTimePicker = false
                    },
                    colors = ButtonDefaults.filledPill(),
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showDigestTimePicker = false },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Cancel")
                }
            },
        )
    }

    // Reset All Data Confirm Dialog
    if (showResetConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showResetConfirmDialog = false },
            icon = {
                Icon(
                    imageVector = Icons.Outlined.Warning,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                )
            },
            title = { Text("Reset All Data?") },
            text = {
                Column {
                    Text(
                        text =
                            "This will permanently delete all courses, timetable slots, assessments, grades, custom events, " +
                                "and wipe all OAuth credentials from this device.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = resetInputText,
                        onValueChange = { resetInputText = it },
                        label = { Text("Type DELETE to confirm") },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.resetAllData {
                            showResetConfirmDialog = false
                        }
                    },
                    enabled = resetInputText.trim() == "DELETE",
                    colors = ButtonDefaults.destructivePill(),
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Text("Confirm Reset")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showResetConfirmDialog = false },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Cancel")
                }
            },
        )
    }

    // AI timetable import: the running / preview / failure states.
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

    // Course Editor Sheet
    if (isCourseSheetOpen) {
        CourseEditorSheet(
            course = editingCourse,
            initialSlots = editingCourseSlots,
            sheetState = courseSheetState,
            onDismiss = { isCourseSheetOpen = false },
            onSave = { updatedCourse, updatedSlots ->
                viewModel.upsertCourse(updatedCourse, updatedSlots)
                isCourseSheetOpen = false
            },
            onDelete = { courseCode ->
                viewModel.deleteCourse(courseCode)
                isCourseSheetOpen = false
            },
        )
    }
}

@Composable
private fun SettingsSectionHeader(
    icon: ImageVector,
    title: String,
    modifier: Modifier = Modifier,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier.padding(vertical = 8.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp),
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Composable
private fun StatusPill(
    connected: Boolean,
    modifier: Modifier = Modifier,
) {
    // The pill used to be a light mint chip with a 3.0:1 green in EVERY
    // theme - a light-mode pill punched into the dark screen, and below the
    // 4.5:1 that 11sp text needs. The token now has a dark variant.
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    Surface(
        // Both inline badges ("Connected", "Desktop only") share the theme's
        // small pill slot - badges are small controls, not cards.
        shape = MaterialTheme.shapes.small,
        color =
            if (connected) {
                StatusColors.successContainer(isDark)
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
        modifier = modifier,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier =
                    Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(
                            if (connected) {
                                StatusColors.onSuccessContainer(isDark)
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        ),
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = if (connected) "Connected" else "Not connected",
                style = MaterialTheme.typography.labelSmall,
                color =
                    if (connected) {
                        StatusColors.onSuccessContainer(isDark)
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
            )
        }
    }
}

@Composable
private fun SourceToggleRow(
    name: String,
    desc: String,
    icon: ImageVector,
    enabled: Boolean,
    onToggle: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 56.dp)
                .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(24.dp),
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column {
                Text(
                    name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    desc,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Switch(
            checked = enabled,
            onCheckedChange = onToggle,
        )
    }
}

/*
 * The settings switch row the whole screen shares (notifications, calendar,
 * background scan): title + support text on the left, the switch on the
 * right, on the same 56dp row grid as SourceToggleRow.
 */
@Composable
private fun SettingsSwitchRow(
    name: String,
    desc: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 56.dp)
                .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                desc,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
        )
    }
}

/*
 * Counts and times are data (docs/ANDROID-DESIGN-SYSTEM.md §2): [counted]
 * renders in tabular figures so digits keep a fixed width next to the label.
 */
private fun tabular(
    prefix: String,
    counted: String,
): AnnotatedString =
    buildAnnotatedString {
        append(prefix)
        withStyle(SpanStyle(fontFeatureSettings = "tnum")) { append(counted) }
    }

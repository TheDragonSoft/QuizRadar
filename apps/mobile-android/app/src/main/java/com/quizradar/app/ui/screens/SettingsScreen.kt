package com.quizradar.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    val theme by viewModel.theme.collectAsState()
    val academicTrack by viewModel.academicTrack.collectAsState()
    val timetableImportState by viewModel.timetableImportState.collectAsState()
    val googleClientId by viewModel.googleClientId.collectAsState()
    val teamsClientId by viewModel.teamsClientId.collectAsState()
    val backgroundScanEnabled by viewModel.backgroundScanEnabled.collectAsState()

    // Dialog & Sheet States
    var showEditProfileDialog by rememberSaveable { mutableStateOf(false) }
    var showDisconnectGoogleDialog by rememberSaveable { mutableStateOf(false) }
    var showDisconnectMicrosoftDialog by rememberSaveable { mutableStateOf(false) }
    var showAddFeedDialog by rememberSaveable { mutableStateOf(false) }
    var showResetConfirmDialog by rememberSaveable { mutableStateOf(false) }
    var resetInputText by rememberSaveable { mutableStateOf("") }
    // Digest time picker (M3 TimePicker in a dialog) - the "at $time" copy
    // used to display a value nothing could ever change.
    var showDigestTimePicker by rememberSaveable { mutableStateOf(false) }
    // BYO OAuth client ids (Settings -> Sources). The drafts re-key when the
    // persisted value changes, like the Gemini key field.
    var googleClientIdInput by remember(googleClientId) { mutableStateOf(googleClientId) }
    var teamsClientIdInput by remember(teamsClientId) { mutableStateOf(teamsClientId) }

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
                            fontWeight = FontWeight.Bold,
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
                            containerColor = MaterialTheme.colorScheme.surface,
                            titleContentColor = MaterialTheme.colorScheme.onSurface,
                        ),
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
        modifier = modifier.fillMaxSize(),
    ) { innerPadding ->
        Column(
            modifier =
                Modifier
                    .padding(innerPadding)
                    .verticalScroll(scrollState)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            // =========================================================================
            // 1. ACCOUNT & CONNECTIONS
            // =========================================================================
            SettingsSectionHeader(
                icon = Icons.Outlined.AccountCircle,
                title = "Account & Connections",
            )

            Card(
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = userName.ifBlank { "Student Profile" },
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                text = userEmail.ifBlank { "No email configured (local-only profile)" },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = { showEditProfileDialog = true }) {
                            Text("Edit Profile")
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier.padding(10.dp),
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

                    Spacer(modifier = Modifier.height(14.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    // Academic Rhythm Preset — the answer the onboarding wizard
                    // collects (`01` §4.1). It is shown here so the user can see
                    // (and change) what was saved, exactly like the web tier's
                    // Settings -> Account card.
                    Text(
                        text = "Academic Rhythm Preset",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text =
                            academicTrackLabel(academicTrack) +
                                " - it tunes how announcements are read as quiz, exam, or tutorial.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        items(ACADEMIC_TRACKS) { (id, label) ->
                            FilterChip(
                                selected = academicTrack == id,
                                onClick = { viewModel.setAcademicTrack(id) },
                                label = { Text(label, fontSize = 12.sp) },
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))
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
                            OutlinedButton(
                                onClick = { showDisconnectGoogleDialog = true },
                                shape = RoundedCornerShape(8.dp),
                            ) {
                                Text("Disconnect", fontSize = 12.sp)
                            }
                        } else {
                            Button(
                                onClick = onStartGoogleLogin,
                                shape = RoundedCornerShape(8.dp),
                            ) {
                                Text("Sign In", fontSize = 12.sp)
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
                            OutlinedButton(
                                onClick = { showDisconnectMicrosoftDialog = true },
                                shape = RoundedCornerShape(8.dp),
                            ) {
                                Text("Disconnect", fontSize = 12.sp)
                            }
                        } else {
                            Button(
                                onClick = onStartMicrosoftLogin,
                                shape = RoundedCornerShape(8.dp),
                            ) {
                                Text("Sign In", fontSize = 12.sp)
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
                shape = RoundedCornerShape(12.dp),
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
                                shape = RoundedCornerShape(8.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
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
                                                text = "${courseSlots.size} weekly slot(s)",
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

                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedButton(
                        onClick = onReRunOnboarding,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text("Re-run Timetable Onboarding")
                    }

                    Spacer(modifier = Modifier.height(14.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    // AI course import (`01` §4.1): the Android app reads a
                    // timetable screenshot with Gemini, exactly like the
                    // desktop shell and the web companion do.
                    Text(
                        text = "AI Course Import",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text =
                            "Pick a timetable screenshot. Gemini reads it on your phone and you " +
                                "review the courses and class slots before anything is saved. " +
                                "Needs a Gemini API key (see the AI section below).",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = {
                            timetableImageLauncher.launch(
                                androidx.activity.result.PickVisualMediaRequest(
                                    ActivityResultContracts.PickVisualMedia.ImageOnly,
                                ),
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Import Timetable from Image (AI)", fontSize = 12.sp)
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
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
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
                    ListItem(
                        headlineContent = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Moodle REST", fontWeight = FontWeight.SemiBold)
                                Spacer(modifier = Modifier.width(8.dp))
                                Surface(
                                    shape = RoundedCornerShape(4.dp),
                                    color = MaterialTheme.colorScheme.secondaryContainer,
                                ) {
                                    Text(
                                        text = "Desktop only",
                                        style = MaterialTheme.typography.labelSmall,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                    )
                                }
                            }
                        },
                        supportingContent = {
                            Text(
                                text = "Direct token scraping and local web session sync are supported in the desktop client.",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    )

                    Spacer(modifier = Modifier.height(8.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(8.dp))

                    // Calendar Feeds (.ics)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text(
                                text = "Calendar Feeds (${snapshot.feeds.size}/10)",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Bold,
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
                            modifier = Modifier.padding(vertical = 6.dp),
                        )
                    } else {
                        snapshot.feeds.forEach { feed ->
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 4.dp),
                            ) {
                                Row(
                                    modifier = Modifier.padding(10.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(feed.label, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                        Text(
                                            feed.url,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 1,
                                        )
                                    }
                                    IconButton(
                                        onClick = { viewModel.removeIcsFeed(feed.url) },
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

                    Spacer(modifier = Modifier.height(14.dp))
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
                                Text("Google Calendar push", fontWeight = FontWeight.SemiBold)
                                Text(
                                    "Push every dated upcoming assessment to your primary calendar",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            OutlinedButton(
                                onClick = { viewModel.pushGcalNow() },
                                shape = RoundedCornerShape(8.dp),
                            ) {
                                Text("Push now", fontSize = 12.sp)
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Spacer(modifier = Modifier.height(12.dp))
                    }

                    // Background periodic scan: explicit opt-in, default OFF.
                    // The worker re-checks this toggle from the store at run
                    // time and posts no notifications on its own.
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Background scan (every 6 hours)", fontWeight = FontWeight.SemiBold)
                            Text(
                                "Scan your connected sources periodically, even when the app is closed. " +
                                    "Off by default; a scan that finds nothing never notifies you.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = backgroundScanEnabled,
                            onCheckedChange = { enabled ->
                                viewModel.setBackgroundScanEnabled(enabled)
                                BackgroundScanWorker.reschedule(context, enabled)
                            },
                        )
                    }

                    Spacer(modifier = Modifier.height(14.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(12.dp))

                    // BYO OAuth client ids. The open-source build ships
                    // placeholders: Google sign-in needs the user's own
                    // "Android" OAuth client registered for THIS package name
                    // and their signing SHA-1; Microsoft needs an Azure app
                    // with the custom-scheme redirect. Honest, actionable copy
                    // instead of a sign-in button that can only fail.
                    Text(
                        text = "OAuth client IDs (bring your own)",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text =
                            "Google: create an \"Android\" OAuth client for package com.quizradar.app with your " +
                                "signing SHA-1. Microsoft: register an Azure app with the redirect " +
                                "com.quizradar.app://oauth/microsoft. Sign-in is refused until an ID is set here.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = googleClientIdInput,
                        onValueChange = { googleClientIdInput = it },
                        label = { Text("Google client ID") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = teamsClientIdInput,
                        onValueChange = { teamsClientIdInput = it },
                        label = { Text("Microsoft (Azure) client ID") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = {
                            viewModel.setGoogleClientId(googleClientIdInput)
                            viewModel.setTeamsClientId(teamsClientIdInput)
                            viewModel.showToast("OAuth client IDs saved")
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text("Save Client IDs")
                    }
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
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Enable Gemini AI features",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Bold,
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

                    Spacer(modifier = Modifier.height(12.dp))

                    OutlinedTextField(
                        value = keyInputValue,
                        onValueChange = { keyInputValue = it },
                        label = { Text("Gemini API Key (BYOK)") },
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
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = { viewModel.saveGeminiApiKey(keyInputValue) },
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Save Key")
                        }

                        OutlinedButton(
                            onClick = {
                                isAiValidating = true
                                aiValidationStatus = null
                                viewModel.validateGeminiKey(keyInputValue) { success, msg ->
                                    isAiValidating = false
                                    aiValidationStatus = msg
                                }
                            },
                            enabled = !isAiValidating && keyInputValue.isNotBlank(),
                            shape = RoundedCornerShape(8.dp),
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

                    Spacer(modifier = Modifier.height(14.dp))

                    // Free-tier disclosure copy per 05 §5.1
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(
                                text = "Google Gemini Free-Tier Data Terms:",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text =
                                    "When using a free-tier Gemini API key, Google may use your prompts and responses to train models. " +
                                        "Your queries are sent directly from this phone to Google's API using your own key. " +
                                        "QuizRadar has no servers and sees none of your data.",
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
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    if (!hasNotificationPermission) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                modifier = Modifier.padding(10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "Permission required",
                                        fontWeight = FontWeight.Bold,
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                    Text(
                                        text = "Grant notification permission to receive exam alerts",
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                }
                                Button(
                                    onClick = {
                                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                        }
                                    },
                                    shape = RoundedCornerShape(8.dp),
                                ) {
                                    Text("Grant", fontSize = 12.sp)
                                }
                            }
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                    }

                    // 24h Reminder Switch
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Exam Reminder (T-24h)", fontWeight = FontWeight.SemiBold)
                            Text(
                                "Notify the day before each upcoming exam",
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

                    // Same-Day Reminder Switch
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Same-Day Exam Alert", fontWeight = FontWeight.SemiBold)
                            Text(
                                "Notify on the morning of an exam",
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

                    // Morning Digest Switch & Time. The time is now SETTABLE:
                    // the row used to display "at 08:00" while nothing could
                    // ever change the value.
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Daily Morning Digest", fontWeight = FontWeight.SemiBold)
                            Text(
                                "Daily summary of classes and assessments at $notifyMorningTime",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = notifyMorningDigest,
                            onCheckedChange = { viewModel.setNotifyMorningDigest(it) },
                        )
                    }

                    TextButton(
                        onClick = { showDigestTimePicker = true },
                        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                    ) {
                        Text("Set digest time ($notifyMorningTime)")
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    OutlinedButton(
                        onClick = { NotificationHelper.sendTestNotification(context) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
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
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    // The auto-push toggle is REAL: after a scan that discovered
                    // or updated items (and with Google signed in), the shell
                    // pushes them and reports the push outcome in the scan
                    // summary. The former "Sync Weekly Classes" row was removed
                    // entirely - no feature backed it, and a switch that does
                    // nothing is banned.
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Auto-push to Google Calendar", fontWeight = FontWeight.SemiBold)
                            Text(
                                "After a scan with new or updated items, push them to your primary Google Calendar (off by default)",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = autoSyncGcal,
                            onCheckedChange = { viewModel.setAutoSyncGcal(it) },
                        )
                    }

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 8.dp))

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
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Text("Theme", fontWeight = FontWeight.SemiBold)
                    Spacer(modifier = Modifier.height(8.dp))

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        listOf("system" to "System", "light" to "Light", "dark" to "Dark").forEach { (key, label) ->
                            FilterChip(
                                selected = theme == key,
                                onClick = { viewModel.setTheme(key) },
                                label = { Text(label) },
                                leadingIcon = {
                                    if (theme == key) {
                                        Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                                    }
                                },
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))
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
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Text(
                        text = "Backups are stored locally (spec §8 [M]). Credentials and OAuth tokens are never included in backups.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        OutlinedButton(
                            onClick = {
                                exportBackupLauncher.launch("quizradar-backup-${LocalDate.now()}.json")
                            },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Export Backup", fontSize = 12.sp)
                        }

                        OutlinedButton(
                            onClick = {
                                importBackupLauncher.launch("application/json")
                            },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Icon(Icons.Outlined.UploadFile, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Import Backup", fontSize = 12.sp)
                        }
                    }

                    // Google Drive backup (data-only, app-data folder, explicit
                    // user action - never a background sync). The payload is
                    // built by the Rust core and structurally cannot carry
                    // tokens. "No backup found" is the honest empty state.
                    if (viewModel.isGoogleConnected()) {
                        Spacer(modifier = Modifier.height(14.dp))
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text =
                                "Google Drive backup: a data-only copy in your Drive app-data folder. " +
                                    "Tokens and credentials are never included.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            OutlinedButton(
                                onClick = { viewModel.pushDriveBackupNow() },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(8.dp),
                            ) {
                                Icon(Icons.Outlined.UploadFile, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Back up to Drive", fontSize = 12.sp)
                            }

                            OutlinedButton(
                                onClick = { viewModel.restoreDriveBackupNow() },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(8.dp),
                            ) {
                                Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Restore from Drive", fontSize = 12.sp)
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
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Icon(Icons.Outlined.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
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
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Text(
                        text = if (coreVersion.isBlank()) "QuizRadar" else "QuizRadar v$coreVersion",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "Local-first quiz and exam radar",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text =
                            "QuizRadar runs zero external servers. All course matching, parsing, and exam radar derivation " +
                                "occur entirely on this device via the native Rust core.",
                        style = MaterialTheme.typography.bodySmall,
                    )

                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = "Licensed under Apache 2.0 / MIT. Zero telemetry, zero analytics.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

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
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = draftEmail,
                        onValueChange = { draftEmail = it },
                        label = { Text("Student Email") },
                        singleLine = true,
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
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { showEditProfileDialog = false }) {
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
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) {
                    Text("Disconnect")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDisconnectGoogleDialog = false }) {
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
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) {
                    Text("Disconnect")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDisconnectMicrosoftDialog = false }) {
                    Text("Cancel")
                }
            },
        )
    }

    // Add Feed Dialog
    if (showAddFeedDialog) {
        var feedUrl by rememberSaveable { mutableStateOf("") }
        var feedLabel by rememberSaveable { mutableStateOf("") }

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
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = feedLabel,
                        onValueChange = { feedLabel = it },
                        label = { Text("Label (e.g. University Calendar)") },
                        singleLine = true,
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
                    enabled = feedUrl.startsWith("https://", ignoreCase = true),
                ) {
                    Text("Add Feed")
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddFeedDialog = false }) {
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
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDigestTimePicker = false }) {
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
                    Text(
                        "Type DELETE to confirm:",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    OutlinedTextField(
                        value = resetInputText,
                        onValueChange = { resetInputText = it },
                        singleLine = true,
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
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) {
                    Text("Confirm Reset")
                }
            },
            dismissButton = {
                TextButton(onClick = { showResetConfirmDialog = false }) {
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
            fontWeight = FontWeight.Bold,
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
        shape = RoundedCornerShape(12.dp),
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
                                Color(0xFF9CA3AF)
                            },
                        ),
            )
            Spacer(modifier = Modifier.width(5.dp))
            Text(
                text = if (connected) "Connected" else "Not connected",
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
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
        modifier = modifier.fillMaxWidth(),
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
                Text(name, fontWeight = FontWeight.SemiBold)
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

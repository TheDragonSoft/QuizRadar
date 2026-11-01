package com.quizradar.app.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SpaceDashboard
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.ui.components.AccountSheet
import com.quizradar.app.ui.components.AddActionMenuSheet
import com.quizradar.app.ui.components.SearchSheet
import com.quizradar.app.ui.detail.AssessmentDetailSheet
import com.quizradar.app.ui.detail.CourseEditorSheet
import com.quizradar.app.ui.detail.CreateEventSheet
import com.quizradar.app.ui.screens.CalendarScreen
import com.quizradar.app.ui.screens.DashboardScreen
import com.quizradar.app.ui.screens.FocusScreen
import com.quizradar.app.ui.screens.OnboardingWizardScreen
import com.quizradar.app.ui.screens.SettingsScreen
import com.quizradar.app.ui.screens.TasksScreen
import com.quizradar.app.ui.share.SharedEventDraft
import java.time.LocalDate

private data class Tab(val label: String, val icon: ImageVector)

private val TABS =
    listOf(
        Tab("Dashboard", Icons.Outlined.SpaceDashboard),
        Tab("Tasks", Icons.Outlined.Checklist),
        Tab("Calendar", Icons.Outlined.CalendarMonth),
        Tab("Focus", Icons.Outlined.Timer),
    )

@OptIn(ExperimentalMaterial3Api::class)
@Composable
@Suppress("standard:function-naming")
fun AppScaffold(
    viewModel: QuizRadarViewModel,
    onStartGoogleLogin: () -> Unit = {},
    onStartMicrosoftLogin: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
) {
    val selectedTab by viewModel.selectedTab.collectAsState()
    val uiState by viewModel.uiState.collectAsState()
    val activeDetailId by viewModel.activeDetailAssessmentId.collectAsState()
    val activeDraft by viewModel.activeCreateEventDraft.collectAsState()
    val toastMessage by viewModel.toastMessage.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    var isSearchOpen by rememberSaveable { mutableStateOf(false) }
    var isAccountOpen by rememberSaveable { mutableStateOf(false) }
    var isAddMenuOpen by rememberSaveable { mutableStateOf(false) }
    var isSettingsOpen by rememberSaveable { mutableStateOf(false) }
    var isNewCourseOpen by rememberSaveable { mutableStateOf(false) }

    val searchSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val accountSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val addMenuSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val detailSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val newCourseSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val backupPickerLauncher =
        rememberLauncherForActivityResult(contract = ActivityResultContracts.GetContent()) { uri ->
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
                    viewModel.showToast("Failed to read backup file: ${e.message}")
                }
            }
        }

    // Show FIRST, clear AFTER: clearToast() nulls the keyed state, which
    // restarts this LaunchedEffect and cancels the suspended showSnackbar —
    // the old order made every toast disappear after a single frame.
    LaunchedEffect(toastMessage) {
        val msg = toastMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(msg)
        viewModel.clearToast()
    }

    // Predictive back handler: dismiss layers in strict reverse order before exiting
    BackHandler(
        enabled =
            isSettingsOpen ||
                isNewCourseOpen ||
                isSearchOpen ||
                isAccountOpen ||
                isAddMenuOpen ||
                activeDraft != null ||
                activeDetailId != null ||
                selectedTab != "Dashboard",
    ) {
        when {
            isSettingsOpen -> isSettingsOpen = false
            isNewCourseOpen -> isNewCourseOpen = false
            isSearchOpen -> isSearchOpen = false
            isAccountOpen -> isAccountOpen = false
            isAddMenuOpen -> isAddMenuOpen = false
            activeDraft != null -> viewModel.dismissCreateEventDraft()
            activeDetailId != null -> viewModel.closeAssessmentDetail()
            selectedTab != "Dashboard" -> viewModel.selectTab("Dashboard")
        }
    }

    val isOnboardingCompleted by viewModel.onboardingCompleted.collectAsState()

    if (!isOnboardingCompleted) {
        when (val state = uiState) {
            is UiState.Ready -> {
                OnboardingWizardScreen(
                    snapshot = state.snapshot,
                    viewModel = viewModel,
                    onComplete = {
                        viewModel.completeOnboarding()
                    },
                    onStartGoogleLogin = onStartGoogleLogin,
                    onStartMicrosoftLogin = onStartMicrosoftLogin,
                    onImportBackup = {
                        backupPickerLauncher.launch("application/json")
                    },
                )
                return
            }
            else -> {}
        }
    }

    if (isSettingsOpen) {
        when (val state = uiState) {
            is UiState.Ready -> {
                SettingsScreen(
                    snapshot = state.snapshot,
                    viewModel = viewModel,
                    onNavigateBack = { isSettingsOpen = false },
                    onStartGoogleLogin = onStartGoogleLogin,
                    onStartMicrosoftLogin = onStartMicrosoftLogin,
                    onReRunOnboarding = {
                        isSettingsOpen = false
                        viewModel.reRunOnboarding()
                    },
                )
                return
            }
            else -> {}
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        topBar = {
            Column {
                TopAppBar(
                    colors =
                        TopAppBarDefaults.topAppBarColors(
                            containerColor = MaterialTheme.colorScheme.surface,
                            titleContentColor = MaterialTheme.colorScheme.onSurface,
                        ),
                    title = {
                        Text(
                            text = selectedTab,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    },
                    actions = {
                        // Refresh Button with active progress indicator. The
                        // Android shell reads the on-device store; it does not
                        // poll Gmail or Teams, so the copy must not claim a
                        // scan it never performs (AGENTS §3 honesty).
                        IconButton(
                            onClick = {
                                viewModel.refreshState()
                                viewModel.showToast("Refreshing on-device data...")
                            },
                            enabled = !isRefreshing,
                            modifier = Modifier.size(48.dp),
                        ) {
                            if (isRefreshing) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            } else {
                                Icon(
                                    imageVector = Icons.Outlined.Sync,
                                    contentDescription = "Refresh on-device data",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }

                        // Search Button
                        IconButton(
                            onClick = { isSearchOpen = true },
                            modifier = Modifier.size(48.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Search,
                                contentDescription = "Search assessments and topics",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        // Profile / Avatar Button
                        val hasAccounts = viewModel.isGoogleConnected() || viewModel.isMicrosoftConnected()
                        IconButton(
                            onClick = { isAccountOpen = true },
                            modifier = Modifier.size(48.dp),
                        ) {
                            Box(contentAlignment = Alignment.TopEnd) {
                                Box(
                                    modifier =
                                        Modifier
                                            .size(32.dp)
                                            .clip(CircleShape)
                                            .background(MaterialTheme.colorScheme.primaryContainer),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(
                                        imageVector = Icons.Outlined.Person,
                                        contentDescription = "Account and sources",
                                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                        modifier = Modifier.size(20.dp),
                                    )
                                }
                                if (hasAccounts) {
                                    Box(
                                        modifier =
                                            Modifier
                                                .size(9.dp)
                                                .clip(CircleShape)
                                                .background(Color(0xFF047857)),
                                    )
                                }
                            }
                        }
                    },
                )
                HorizontalDivider(
                    thickness = 1.dp,
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
            }
        },
        floatingActionButton = {
            if (selectedTab == "Dashboard" || selectedTab == "Calendar") {
                FloatingActionButton(
                    onClick = { isAddMenuOpen = true },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Add,
                        contentDescription = "Add event or assessment",
                    )
                }
            }
        },
        bottomBar = {
            Column {
                HorizontalDivider(
                    thickness = 1.dp,
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp,
                ) {
                    TABS.forEach { tab ->
                        NavigationBarItem(
                            selected = selectedTab == tab.label,
                            onClick = { viewModel.selectTab(tab.label) },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = {
                                Text(
                                    text = tab.label,
                                    fontSize = 11.sp,
                                    fontWeight =
                                        if (selectedTab == tab.label) {
                                            FontWeight.Bold
                                        } else {
                                            FontWeight.Medium
                                        },
                                )
                            },
                            colors =
                                NavigationBarItemDefaults.colors(
                                    selectedIconColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                    selectedTextColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                    indicatorColor = MaterialTheme.colorScheme.secondaryContainer,
                                    unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                    unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                ),
                        )
                    }
                }
            }
        },
    ) { innerPadding ->
        Box(
            modifier =
                Modifier
                    .padding(innerPadding)
                    .fillMaxSize(),
        ) {
            when (val state = uiState) {
                is UiState.Loading -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }

                is UiState.Error -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            text = "Error: ${state.message}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }

                is UiState.Ready -> {
                    AnimatedContent(
                        targetState = selectedTab,
                        transitionSpec = {
                            fadeIn(animationSpec = tween(180)) togetherWith
                                fadeOut(animationSpec = tween(150))
                        },
                        label = "tab_crossfade",
                    ) { currentTab ->
                        when (currentTab) {
                            "Dashboard" ->
                                DashboardScreen(
                                    snapshot = state.snapshot,
                                    viewModel = viewModel,
                                    onViewCalendar = { viewModel.selectTab("Calendar") },
                                    onOpenAccount = { isAccountOpen = true },
                                    onAddCourse = { isNewCourseOpen = true },
                                    onImportBackup = { backupPickerLauncher.launch("application/json") },
                                    onAddEvent = { isAddMenuOpen = true },
                                )

                            "Tasks" ->
                                TasksScreen(
                                    snapshot = state.snapshot,
                                    viewModel = viewModel,
                                )

                            "Calendar" ->
                                CalendarScreen(
                                    snapshot = state.snapshot,
                                    viewModel = viewModel,
                                )

                            "Focus" ->
                                FocusScreen(
                                    snapshot = state.snapshot,
                                    viewModel = viewModel,
                                )
                        }
                    }

                    // Search Sheet
                    if (isSearchOpen) {
                        SearchSheet(
                            snapshot = state.snapshot,
                            sheetState = searchSheetState,
                            onDismiss = { isSearchOpen = false },
                            onSelectAssessment = { id ->
                                viewModel.openAssessmentDetail(id)
                            },
                        )
                    }

                    // Account & Connections Sheet
                    if (isAccountOpen) {
                        AccountSheet(
                            isGoogleConnected = viewModel.isGoogleConnected(),
                            isMicrosoftConnected = viewModel.isMicrosoftConnected(),
                            sheetState = accountSheetState,
                            onDismiss = { isAccountOpen = false },
                            onStartGoogleLogin = onStartGoogleLogin,
                            onDisconnectGoogle = { viewModel.disconnectGoogle() },
                            onStartMicrosoftLogin = onStartMicrosoftLogin,
                            onDisconnectMicrosoft = { viewModel.disconnectMicrosoft() },
                            onImportBackup = { backupPickerLauncher.launch("application/json") },
                            onOpenSettings = {
                                isAccountOpen = false
                                isSettingsOpen = true
                                onOpenSettings()
                            },
                        )
                    }

                    // Add Menu Sheet (triggered by Floating Action Button)
                    if (isAddMenuOpen) {
                        AddActionMenuSheet(
                            sheetState = addMenuSheetState,
                            onDismiss = { isAddMenuOpen = false },
                            onNewCustomEvent = {
                                viewModel.openCreateEventDraft(
                                    SharedEventDraft(
                                        title = "",
                                        courseId = null,
                                        dateIso = LocalDate.now(),
                                        notes = "",
                                    ),
                                )
                            },
                            onNewCourse = {
                                isNewCourseOpen = true
                            },
                            onImportBackup = { backupPickerLauncher.launch("application/json") },
                        )
                    }

                    // New Course Sheet (from Add Menu)
                    if (isNewCourseOpen) {
                        CourseEditorSheet(
                            course = null,
                            initialSlots = emptyList(),
                            sheetState = newCourseSheetState,
                            onDismiss = { isNewCourseOpen = false },
                            onSave = { newCourse, slots ->
                                viewModel.upsertCourse(newCourse, slots)
                                isNewCourseOpen = false
                            },
                        )
                    }

                    // Active Assessment Detail Sheet
                    val selectedAssessment =
                        activeDetailId?.let { id ->
                            state.snapshot.assessments.find { it.id == id }
                        }

                    if (selectedAssessment != null) {
                        AssessmentDetailSheet(
                            assessment = selectedAssessment,
                            allAssessments = state.snapshot.assessments,
                            completedTopicsMap = state.snapshot.completedTopics,
                            sheetState = detailSheetState,
                            onDismiss = { viewModel.closeAssessmentDetail() },
                            onToggleTopic = { key, done -> viewModel.toggleTopic(key, done) },
                            onSaveGrade = { achieved, max, weight ->
                                viewModel.saveGrade(selectedAssessment.id, achieved, max, weight)
                            },
                            onExportIcs = {
                                viewModel.exportIcs(selectedAssessment.id)
                            },
                            onOpenPractice = {
                                viewModel.closeAssessmentDetail()
                                viewModel.openPracticeQuiz(selectedAssessment.id)
                                viewModel.selectTab("Focus")
                            },
                            onOpenPomodoro = { topicTitle ->
                                viewModel.closeAssessmentDetail()
                                viewModel.openPomodoro(selectedAssessment.id, topicTitle)
                                viewModel.selectTab("Focus")
                            },
                        )
                    }

                    // Create/Edit Event Sheet (from draft)
                    if (activeDraft != null) {
                        CreateEventSheet(
                            draft = activeDraft,
                            onSave = { event ->
                                viewModel.addCustomEvent(event)
                                viewModel.dismissCreateEventDraft()
                            },
                            onDismiss = { viewModel.dismissCreateEventDraft() },
                        )
                    }
                }
            }
        }
    }
}

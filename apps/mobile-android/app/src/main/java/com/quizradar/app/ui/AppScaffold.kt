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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.ui.components.AccountSheet
import com.quizradar.app.ui.components.AddActionMenuSheet
import com.quizradar.app.ui.components.HelpSheet
import com.quizradar.app.ui.components.QuizRadarLogo
import com.quizradar.app.ui.components.SearchSheet
import com.quizradar.app.ui.detail.AssessmentDetailSheet
import com.quizradar.app.ui.detail.CourseEditorSheet
import com.quizradar.app.ui.detail.CreateEventSheet
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.screens.CalendarScreen
import com.quizradar.app.ui.screens.DashboardScreen
import com.quizradar.app.ui.screens.FocusScreen
import com.quizradar.app.ui.screens.OnboardingWizardScreen
import com.quizradar.app.ui.screens.SettingsScreen
import com.quizradar.app.ui.screens.TasksScreen
import com.quizradar.app.ui.share.SharedEventDraft
import com.quizradar.app.ui.theme.StatusColors
import kotlinx.coroutines.launch
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
    val isScanning by viewModel.isScanning.collectAsState()
    val theme by viewModel.theme.collectAsState(initial = "system")
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    // The app's own mark in the top-left corner opens the navigation drawer.
    // `ModalNavigationDrawer` keeps the edge-swipe gesture enabled, so the
    // drawer can be pulled in from the left edge as well as opened by tap.
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val statusBarPadding = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    // Material adaptive guidance: bottom navigation on compact widths (< 600dp),
    // a navigation rail on expanded. In multi-window the activity configuration
    // already reflects the window, so no window-size-class artifact is needed.
    val isExpanded = LocalConfiguration.current.screenWidthDp >= 600

    var isSearchOpen by rememberSaveable { mutableStateOf(false) }
    var isAccountOpen by rememberSaveable { mutableStateOf(false) }
    var isHelpOpen by rememberSaveable { mutableStateOf(false) }
    var isAddMenuOpen by rememberSaveable { mutableStateOf(false) }
    var isSettingsOpen by rememberSaveable { mutableStateOf(false) }
    var isNewCourseOpen by rememberSaveable { mutableStateOf(false) }

    val searchSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val accountSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val helpSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
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
            (isExpanded && drawerState.isOpen) ||
                isSettingsOpen ||
                isNewCourseOpen ||
                isSearchOpen ||
                isAccountOpen ||
                isHelpOpen ||
                isAddMenuOpen ||
                activeDraft != null ||
                activeDetailId != null ||
                selectedTab != "Dashboard",
    ) {
        when {
            isExpanded && drawerState.isOpen -> scope.launch { drawerState.close() }
            isSettingsOpen -> isSettingsOpen = false
            isNewCourseOpen -> isNewCourseOpen = false
            isSearchOpen -> isSearchOpen = false
            isAccountOpen -> isAccountOpen = false
            isHelpOpen -> isHelpOpen = false
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

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = isExpanded,
        drawerContent = {
            ModalDrawerSheet(
                drawerContainerColor = MaterialTheme.colorScheme.surface,
                // A closed drawer sits off-screen but stays in the semantics
                // tree. Without this, a screen reader walks into invisible
                // menu items (and announces every destination twice), and a
                // test cannot tell the drawer apart from the bottom bar.
                modifier =
                    Modifier.semantics {
                        if (!drawerState.isOpen) invisibleToUser()
                    },
            ) {
                Column(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp)
                            .padding(top = statusBarPadding)
                            .padding(bottom = 24.dp),
                ) {
                    // Brand row
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        QuizRadarLogo(modifier = Modifier.size(28.dp))
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = "QuizRadar",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(8.dp))
                    TABS.forEach { tab ->
                        NavigationDrawerItem(
                            label = { Text(tab.label) },
                            selected = selectedTab == tab.label,
                            onClick = {
                                viewModel.selectTab(tab.label)
                                scope.launch { drawerState.close() }
                            },
                            icon = { Icon(tab.icon, contentDescription = null) },
                            modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(modifier = Modifier.height(8.dp))
                    NavigationDrawerItem(
                        label = { Text("Account & sources") },
                        selected = false,
                        onClick = {
                            scope.launch {
                                drawerState.close()
                                isAccountOpen = true
                            }
                        },
                        icon = { Icon(Icons.Outlined.AccountCircle, contentDescription = null) },
                        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                    )
                    NavigationDrawerItem(
                        label = { Text("Settings") },
                        selected = false,
                        onClick = {
                            scope.launch {
                                drawerState.close()
                                isSettingsOpen = true
                            }
                        },
                        icon = { Icon(Icons.Outlined.Settings, contentDescription = null) },
                        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                    )
                }
            }
        },
    ) {
        Row(modifier = Modifier.fillMaxSize()) {
            if (isExpanded) {
                // Expanded window (>= 600dp): primary destinations move from the
                // bottom bar to a navigation rail, and the brand mark heads it.
                NavigationRail(
                    containerColor = MaterialTheme.colorScheme.surface,
                    modifier =
                        Modifier
                            .padding(top = statusBarPadding)
                            .navigationBarsPadding(),
                ) {
                    Spacer(modifier = Modifier.height(8.dp))
                    IconButton(
                        onClick = { scope.launch { drawerState.open() } },
                        modifier =
                            Modifier
                                .size(48.dp)
                                .semantics { contentDescription = "Open navigation menu" },
                    ) {
                        QuizRadarLogo(modifier = Modifier.size(26.dp))
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    TABS.forEach { tab ->
                        NavigationRailItem(
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
                            // Distinct tag from the bottom bar so a test can tell
                            // the rail apart from the (hidden) bottom nav.
                            modifier = Modifier.testTag("rail-nav-${tab.label}"),
                            colors =
                                NavigationRailItemDefaults.colors(
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
                            navigationIcon = {
                                // On expanded widths the mark sits in the rail header,
                                // so the top bar does not show it twice.
                                if (!isExpanded) {
                                    // Brand mark heads the top bar on compact phones.
                                    // Drawer is reserved for expanded screens (>=600dp);
                                    // the bottom nav exclusively owns the 4 primary tabs.
                                    Box(
                                        modifier =
                                            Modifier
                                                .size(48.dp)
                                                .semantics { contentDescription = "QuizRadar" },
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        QuizRadarLogo(
                                            modifier = Modifier.size(26.dp),
                                        )
                                    }
                                }
                            },
                            title = {
                                Text(
                                    text = selectedTab,
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                            },
                            actions = {
                                // Sync button = the REAL scan (Gmail/Teams/
                                // Classroom/feeds on this device, via the Rust
                                // core). It no-ops honestly when no source is
                                // configured, and shows live progress while the
                                // core reports its per-source pulses.
                                IconButton(
                                    onClick = { viewModel.runScan() },
                                    enabled = !isRefreshing && !isScanning,
                                    modifier = Modifier.size(48.dp),
                                ) {
                                    if (isRefreshing || isScanning) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(20.dp),
                                            strokeWidth = 2.dp,
                                            color = MaterialTheme.colorScheme.primary,
                                        )
                                    } else {
                                        Icon(
                                            imageVector = Icons.Outlined.Sync,
                                            contentDescription = "Scan announcement sources now",
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
                                    modifier =
                                        Modifier
                                            .size(48.dp)
                                            // The green dot is the only sign that an
                                            // account is connected. A screen reader
                                            // must hear it too - state by colour
                                            // alone is invisible to one.
                                            .semantics {
                                                stateDescription =
                                                    if (hasAccounts) "Connected" else "Not connected"
                                            },
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
                                                        .background(
                                                            StatusColors.success(
                                                                MaterialTheme.colorScheme.background.luminance() < 0.5f,
                                                            ),
                                                        ),
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
                    if (!isExpanded) {
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
                                        // The drawer carries the SAME destination
                                        // labels, so a test that looks the tab up by
                                        // text can no longer tell the bottom bar from
                                        // the (off-screen) drawer sheet. The tag makes
                                        // the two unambiguous.
                                        modifier = Modifier.testTag("bottom-nav-${tab.label}"),
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
                    }
                },
            ) { innerPadding ->
                Box(
                    modifier =
                        Modifier
                            .padding(innerPadding)
                            .fillMaxSize()
                            .then(
                                if (theme == "amoled") {
                                    Modifier.drawBehind {
                                        val stars =
                                            listOf(
                                                Offset(size.width * 0.08f, size.height * 0.06f) to 1.8f,
                                                Offset(size.width * 0.22f, size.height * 0.18f) to 1.2f,
                                                Offset(size.width * 0.88f, size.height * 0.12f) to 2.2f,
                                                Offset(size.width * 0.72f, size.height * 0.28f) to 1.4f,
                                                Offset(size.width * 0.15f, size.height * 0.38f) to 1.6f,
                                                Offset(size.width * 0.92f, size.height * 0.44f) to 1.2f,
                                                Offset(size.width * 0.35f, size.height * 0.52f) to 2.0f,
                                                Offset(size.width * 0.78f, size.height * 0.62f) to 1.4f,
                                                Offset(size.width * 0.12f, size.height * 0.72f) to 2.4f,
                                                Offset(size.width * 0.60f, size.height * 0.82f) to 1.5f,
                                                Offset(size.width * 0.85f, size.height * 0.90f) to 2.0f,
                                                Offset(size.width * 0.30f, size.height * 0.94f) to 1.2f,
                                            )
                                        stars.forEach { (pos, radius) ->
                                            drawCircle(
                                                color = Color.White.copy(alpha = 0.85f),
                                                radius = radius,
                                                center = pos,
                                            )
                                            drawCircle(
                                                color = Color(0xFF93C5FD).copy(alpha = 0.35f),
                                                radius = radius * 2.5f,
                                                center = pos,
                                            )
                                        }
                                    }
                                } else {
                                    Modifier
                                },
                            ),
                    // On expanded widths the content column is centered and capped
                    // at a readable max width instead of stretching edge to edge.
                    contentAlignment = Alignment.TopCenter,
                ) {
                    Box(
                        modifier =
                            if (isExpanded) {
                                Modifier
                                    .widthIn(max = 840.dp)
                                    .fillMaxWidth()
                                    .padding(horizontal = 24.dp)
                            } else {
                                Modifier.fillMaxSize()
                            },
                    ) {
                        when (val state = uiState) {
                            is UiState.Loading -> {
                                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator()
                                }
                            }

                            is UiState.Error -> {
                                // The bare error text used to dead-end: no way
                                // forward but killing the app. A Retry re-runs
                                // the load (the failure may have been a cold
                                // native-core start or a transient IO error).
                                Box(
                                    modifier = Modifier.fillMaxSize(),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text(
                                            text = "Error: ${state.message}",
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.error,
                                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                            modifier = Modifier.padding(horizontal = 24.dp),
                                        )
                                        Spacer(modifier = Modifier.height(16.dp))
                                        Button(
                                            onClick = { viewModel.loadState() },
                                            shape = RoundedCornerShape(10.dp),
                                        ) {
                                            Text("Retry")
                                        }
                                    }
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
                                                onOpenSettings = { isSettingsOpen = true },
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
                                        onOpenSettings = {
                                            isAccountOpen = false
                                            isSettingsOpen = true
                                            onOpenSettings()
                                        },
                                        onOpenHelp = {
                                            isAccountOpen = false
                                            isHelpOpen = true
                                        },
                                    )
                                }

                                // Help & FAQ Sheet
                                if (isHelpOpen) {
                                    HelpSheet(
                                        sheetState = helpSheetState,
                                        onDismiss = { isHelpOpen = false },
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

                                // Create/Edit Event Sheet (from draft). The
                                // sheet closes only when the save REALLY
                                // succeeded: addCustomEvent clears the draft on
                                // success (which removes the sheet) and keeps
                                // it open on failure with a toast saying why -
                                // the user's text is never thrown away.
                                if (activeDraft != null) {
                                    CreateEventSheet(
                                        draft = activeDraft,
                                        onSave = { event ->
                                            viewModel.addCustomEvent(event)
                                        },
                                        onDismiss = { viewModel.dismissCreateEventDraft() },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

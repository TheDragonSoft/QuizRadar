package com.quizradar.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.quizradar.app.analytics.AnalyticsManager
import com.quizradar.app.auth.OAuthManager
import com.quizradar.app.auth.OAuthRedirectResult
import com.quizradar.app.auth.OAuthTransactionStore
import com.quizradar.app.core.BackgroundScanWorker
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.glance.QuizRadarWidget
import com.quizradar.app.glance.TodayScheduleWidget
import com.quizradar.app.glance.WidgetUpdateWorker
import com.quizradar.app.notifications.ExamReminderWorker
import com.quizradar.app.notifications.NotificationHelper
import com.quizradar.app.ui.AppScaffold
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.components.AmoledStarrySky
import com.quizradar.app.ui.share.ShareIngestParser
import com.quizradar.app.ui.theme.QuizRadarTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var engine: QuizRadarEngine
    private lateinit var viewModel: QuizRadarViewModel
    private lateinit var oauthManager: OAuthManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AnalyticsManager.init(this)
        enableEdgeToEdge()
        engine = QuizRadarEngine.create(this)
        // The pending PKCE transaction persists encrypted (never in
        // saveable UI state), so a callback returning through an Activity
        // recreation or process death still validates (audit A04).
        oauthManager = OAuthManager(transactionStore = OAuthTransactionStore(this))
        viewModel =
            ViewModelProvider(
                this,
                QuizRadarViewModel.provideFactory(
                    core = engine,
                    onStateMutated = {
                        lifecycleScope.launch(Dispatchers.IO) {
                            try {
                                QuizRadarWidget.refreshFromEngine(applicationContext, engine)
                            } catch (_: Exception) {
                            }
                        }
                    },
                    // Platform cleanup for "Reset All" (audit A05): invoked by
                    // the ViewModel only AFTER the transactional wipe + reload
                    // succeeded. Notification cancel (fast, main thread) then
                    // the rest off-thread: the pending OAuth transaction is
                    // dropped, the background scan is rescheduled from the
                    // now-emptied config and BOTH widgets are re-rendered
                    // from the emptied store.
                    onDataReset = {
                        NotificationHelper.cancelAllOwnedNotifications(applicationContext)
                        oauthManager.clearPendingState()
                        lifecycleScope.launch(Dispatchers.IO) {
                            try {
                                BackgroundScanWorker.rescheduleFromConfig(applicationContext, engine)
                            } catch (_: Exception) {
                            }
                            try {
                                QuizRadarWidget.refreshFromEngine(applicationContext, engine)
                                TodayScheduleWidget.refreshFromEngine(applicationContext, engine)
                            } catch (_: Exception) {
                            }
                        }
                    },
                ),
            )[QuizRadarViewModel::class.java]

        // Initialize background tasks and notification channels
        NotificationHelper.createNotificationChannels(this)
        WidgetUpdateWorker.schedule(this)
        ExamReminderWorker.schedule(this)
        // The background scan is an explicit opt-in (default OFF): the toggle
        // is read from the store (a native call - off the main thread) and the
        // periodic job is only enqueued when it is actually enabled.
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                BackgroundScanWorker.rescheduleFromConfig(applicationContext, engine)
            } catch (_: Exception) {
            }
        }

        // The user's own OAuth client ids (Settings -> Sources) flow into the
        // manager as they load: a BYO id wins, a blank (or legacy placeholder)
        // one falls back to the shipped Google client id via the one central
        // resolver shared with the silent-refresh path (audit A03). Microsoft
        // keeps its honest placeholder - it still needs the user's own Azure
        // app id.
        lifecycleScope.launch {
            viewModel.googleClientId.collect {
                oauthManager.googleClientId = OAuthManager.resolveGoogleClientId(it)
            }
        }
        lifecycleScope.launch {
            viewModel.teamsClientId.collect { oauthManager.microsoftClientId = it }
        }

        handleIncomingIntent(intent)

        setContent {
            // The persisted appearance mode and the preferred dark scheme are
            // two orthogonal preferences: the mode decides whether a dark
            // scheme renders at all, and only then does the dark preference
            // pick Obsidian vs AMOLED. (AMOLED used to be encoded as a mode,
            // so any mode switch silently dropped it and System mode could
            // never reach the pure-black scheme at all.)
            val themeMode by viewModel.themeMode.collectAsState(initial = "system")
            val preferredDarkTheme by viewModel.preferredDarkTheme.collectAsState(initial = "obsidian")
            val dark = themeMode == "dark" || (themeMode == "system" && isSystemInDarkTheme())
            val isAmoled = dark && preferredDarkTheme == "amoled"
            QuizRadarTheme(
                darkTheme = dark,
                isAmoled = isAmoled,
            ) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .background(if (isAmoled) Color.Black else MaterialTheme.colorScheme.background),
                ) {
                    if (isAmoled) {
                        AmoledStarrySky(modifier = Modifier.fillMaxSize())
                    }
                    AppScaffold(
                        viewModel = viewModel,
                        onStartGoogleLogin = {
                            if (!oauthManager.isGoogleClientConfigured()) {
                                // Only reachable on builds whose saved id is a
                                // legacy placeholder: say what to do instead of
                                // opening a tab that dies on "client id not
                                // found".
                                viewModel.showToast(
                                    "This build has no usable Google client id - add one " +
                                        "in Settings -> Sources (an Android client for package " +
                                        "com.quizradar.app with your signing SHA-1).",
                                )
                            } else {
                                oauthManager.startGoogleLogin(this@MainActivity, engine)
                            }
                        },
                        onStartMicrosoftLogin = {
                            if (!oauthManager.isMicrosoftClientConfigured()) {
                                viewModel.showToast(
                                    "Microsoft sign-in needs your own Azure app id - add it in " +
                                        "Settings -> Sources (register the com.quizradar.app://" +
                                        "oauth/microsoft redirect).",
                                )
                            } else {
                                oauthManager.startMicrosoftLogin(this@MainActivity, engine)
                            }
                        },
                        onOpenSettings = {},
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Midnight rollover while backgrounded: due dates/countdowns must
        // recompute against the new day, not the stale snapshot.
        viewModel.onAppResumed()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return

        // 1. Share-Sheet Ingest: ACTION_SEND text/plain
        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
            val text = intent.getStringExtra(Intent.EXTRA_TEXT)
            val draft = ShareIngestParser.parse(subject, text)
            viewModel.openCreateEventDraft(draft)
            return
        }

        // 2. Custom-scheme PKCE OAuth or Pairing deep link
        val data = intent.data
        if (data != null && data.scheme == "com.quizradar.app") {
            // The redirect handler exchanges the code over the network and
            // writes the tokens into the Keystore-backed store - neither
            // belongs on the main thread.
            lifecycleScope.launch(Dispatchers.IO) {
                when (val res = oauthManager.handleRedirect(data, engine)) {
                    is OAuthRedirectResult.Success -> {
                        viewModel.showToast(
                            "Signed in with ${res.provider.replaceFirstChar { it.uppercase() }}",
                        )
                        viewModel.refreshState()
                        QuizRadarWidget.refreshFromEngine(this@MainActivity, engine)
                    }

                    is OAuthRedirectResult.Cancelled -> {
                        viewModel.showToast("Sign-in cancelled: ${res.message}")
                    }

                    is OAuthRedirectResult.Pairing -> {
                        viewModel.showToast("Desktop LAN pairing is disabled. Use Backup Export / Import.")
                    }

                    is OAuthRedirectResult.Error -> {
                        viewModel.showToast("OAuth error: ${res.error}")
                    }
                }
            }
            // Consume the redirect: `setIntent` keeps this URI on the activity,
            // and re-running `handleIncomingIntent` on recreation re-plays an
            // already-completed exchange into a false "state mismatch" toast.
            intent.data = null
            intent.action = null
            return
        }

        // 3. App Shortcuts & Deep Links (quizradar://action/...)
        if (data != null && data.scheme == "quizradar" && data.host == "action") {
            when (data.path) {
                "/add_event" -> {
                    viewModel.openCreateEventDraft(
                        ShareIngestParser.parse(null, null),
                    )
                }

                "/focus" -> {
                    viewModel.selectTab("Focus")
                }

                "/calendar" -> {
                    viewModel.selectTab("Calendar")
                }

                "/tasks" -> {
                    viewModel.selectTab("Tasks")
                }

                "/dashboard" -> {
                    viewModel.selectTab("Dashboard")
                }
            }
            val targetAssessmentId = data.getQueryParameter("id")
            if (!targetAssessmentId.isNullOrBlank()) {
                viewModel.openAssessmentDetail(targetAssessmentId)
            }
            return
        }

        // 4. Notification click with assessment payload
        val assessmentId = intent.getStringExtra("EXTRA_ASSESSMENT_ID")
        if (!assessmentId.isNullOrBlank()) {
            viewModel.openAssessmentDetail(assessmentId)
        }

        // 5. Glance Widget interaction
        if (intent.getBooleanExtra("EXTRA_FROM_WIDGET", false)) {
            AnalyticsManager.trackWidgetInteraction("launch_from_widget")
            intent.removeExtra("EXTRA_FROM_WIDGET")
        }
    }
}

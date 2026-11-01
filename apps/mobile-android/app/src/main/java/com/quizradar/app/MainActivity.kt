package com.quizradar.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.quizradar.app.auth.OAuthManager
import com.quizradar.app.auth.OAuthRedirectResult
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.glance.QuizRadarWidget
import com.quizradar.app.glance.WidgetUpdateWorker
import com.quizradar.app.notifications.ExamReminderWorker
import com.quizradar.app.notifications.NotificationHelper
import com.quizradar.app.ui.AppScaffold
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.share.ShareIngestParser
import com.quizradar.app.ui.theme.QuizRadarTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var engine: QuizRadarEngine
    private lateinit var viewModel: QuizRadarViewModel
    private val oauthManager = OAuthManager()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        engine = QuizRadarEngine.create(this)
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
                ),
            )[QuizRadarViewModel::class.java]

        // Initialize background tasks and notification channels
        NotificationHelper.createNotificationChannels(this)
        WidgetUpdateWorker.schedule(this)
        ExamReminderWorker.schedule(this)

        handleIncomingIntent(intent)

        setContent {
            // The Settings theme picker (System/Light/Dark) only takes effect
            // when the persisted mode reaches the theme — it used to be read
            // and written but never applied.
            val themeMode by viewModel.theme.collectAsState(initial = "system")
            QuizRadarTheme(
                darkTheme =
                    when (themeMode) {
                        "dark" -> true
                        "light" -> false
                        else -> isSystemInDarkTheme()
                    },
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    AppScaffold(
                        viewModel = viewModel,
                        onStartGoogleLogin = {
                            if (!oauthManager.isGoogleClientConfigured()) {
                                // The open-source build ships a placeholder Google
                                // client id: the provider would only say "client id
                                // not found". Say so instead of opening a dead tab.
                                viewModel.showToast(
                                    "Google sign-in is not configured in this build yet " +
                                        "(placeholder client id). Use backup import, or build " +
                                        "with a registered Android OAuth client.",
                                )
                            } else {
                                oauthManager.startGoogleLogin(this@MainActivity, engine)
                            }
                        },
                        onStartMicrosoftLogin = {
                            if (!oauthManager.isMicrosoftClientConfigured()) {
                                viewModel.showToast(
                                    "Microsoft sign-in is not configured in this build yet " +
                                        "(placeholder client id). Use backup import, or build " +
                                        "with a registered Azure app id.",
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
    }
}

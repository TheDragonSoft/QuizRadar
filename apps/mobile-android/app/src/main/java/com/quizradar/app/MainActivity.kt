package com.quizradar.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var engine: QuizRadarEngine
    private lateinit var viewModel: QuizRadarViewModel
    private val oauthManager = OAuthManager()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        engine = QuizRadarEngine.create(this)
        viewModel =
            ViewModelProvider(
                this,
                QuizRadarViewModel.provideFactory(engine),
            )[QuizRadarViewModel::class.java]

        // Initialize background tasks and notification channels
        NotificationHelper.createNotificationChannels(this)
        WidgetUpdateWorker.schedule(this)
        ExamReminderWorker.schedule(this)

        handleIncomingIntent(intent)

        setContent {
            QuizRadarTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    AppScaffold(viewModel = viewModel)
                }
            }
        }
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
            lifecycleScope.launch {
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
                        viewModel.showToast("Pairing link received: ${res.url ?: "ready"}")
                    }

                    is OAuthRedirectResult.Error -> {
                        viewModel.showToast("OAuth error: ${res.error}")
                    }
                }
            }
        }
    }
}

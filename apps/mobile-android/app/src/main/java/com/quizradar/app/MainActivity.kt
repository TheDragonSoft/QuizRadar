package com.quizradar.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelProvider
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.ui.AppScaffold
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.theme.QuizRadarTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val engine = QuizRadarEngine.create(this)
        val viewModel =
            ViewModelProvider(
                this,
                QuizRadarViewModel.provideFactory(engine),
            )[QuizRadarViewModel::class.java]

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
}

package com.quizradar.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.SpaceDashboard
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/**
 * Placeholder 3-tab scaffold (Dashboard/Tasks/Calendar + the Focus entry,
 * docs/rebuild/01-product-spec.md §5). Real Compose UI parity lands in
 * phase 13 — no data is simulated here.
 */
private data class Tab(val label: String, val icon: ImageVector)

private val TABS =
    listOf(
        Tab("Dashboard", Icons.Outlined.SpaceDashboard),
        Tab("Tasks", Icons.Outlined.Checklist),
        Tab("Calendar", Icons.Outlined.CalendarMonth),
        Tab("Focus", Icons.Outlined.Timer),
    )

@Composable
@Suppress("standard:function-naming")
fun AppScaffold() {
    var selected by rememberSaveable { mutableStateOf(TABS.first().label) }

    Scaffold(
        bottomBar = {
            NavigationBar {
                TABS.forEach { tab ->
                    NavigationBarItem(
                        selected = selected == tab.label,
                        onClick = { selected = tab.label },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { innerPadding ->
        Column(
            modifier =
                Modifier
                    .padding(innerPadding)
                    .fillMaxSize()
                    .padding(horizontal = 16.dp, vertical = 24.dp),
        ) {
            Text(text = selected, style = MaterialTheme.typography.titleLarge)
            Text(
                text =
                    if (selected == "Focus") {
                        "Pomodoro focus mode ships in phase 13 (01 §4.7)."
                    } else {
                        "Placeholder scaffold — Compose UI parity lands in phase 13. No data is simulated."
                    },
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

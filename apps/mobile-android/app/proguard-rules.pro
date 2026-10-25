# ProGuard / R8 rules for QuizRadar Android Release build

# JNA runtime and structures
-keepclassmembers class * extends com.sun.jna.Structure {
    public <fields>;
}
-keep class com.sun.jna.** { *; }
-dontwarn com.sun.jna.**

# UniFFI generated bindings for quizradar-core
-keep class com.quizradar.app.core.** { *; }
-dontwarn com.quizradar.app.core.**

# AndroidX WorkManager workers
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.ListenableWorker { *; }
-keep class * extends androidx.work.CoroutineWorker { *; }

# AndroidX Glance widgets and receivers
-keep class * extends androidx.glance.appwidget.GlanceAppWidget { *; }
-keep class * extends androidx.glance.appwidget.GlanceAppWidgetReceiver { *; }

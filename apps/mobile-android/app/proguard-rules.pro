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

# Tink (pulled in by androidx.security-crypto) references compile-only
# annotations that are not on the runtime classpath. They are never touched at
# runtime, so R8 only needs to be told not to warn about them.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
-dontwarn javax.annotation.Nullable
-dontwarn javax.annotation.concurrent.GuardedBy

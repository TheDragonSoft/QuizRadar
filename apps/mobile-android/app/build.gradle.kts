plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jlleitschuh.gradle.ktlint")
}

ktlint {
    filter {
        exclude("**/quizradar_core.kt")
        exclude("**/generated/**")
    }
}

android {
    namespace = "com.quizradar.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.quizradar.app"
        minSdk = 26
        targetSdk = 35
        // STAMPED by tooling/generate-version.mjs from tooling/version.json — do not edit.
        versionCode = 50000
        versionName = "5.0.0-alpha.1"
    }

    buildTypes {
        release {
            // Real keystore signing lands in phase 15 (prompts/p15-release-ci.md).
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    @Suppress("UnstableApiUsage", "DEPRECATION")
    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }
}

tasks.withType<Test> {
    systemProperty("jna.library.path", file("${rootProject.projectDir}/../../target/debug").absolutePath)
}

tasks.register<Exec>("uniffiGenerate") {
    group = "build"
    description = "Generates Kotlin bindings from quizradar-core cdylib using uniffi-bindgen"
    workingDir = rootProject.projectDir.resolve("../..")
    val osName = System.getProperty("os.name").lowercase()
    val cdylibPath =
        when {
            osName.contains("win") -> "target/debug/quizradar_core.dll"
            osName.contains("mac") -> "target/debug/libquizradar_core.dylib"
            else -> "target/debug/libquizradar_core.so"
        }
    commandLine(
        "cargo", "run", "-p", "quizradar-core", "--bin", "uniffi-bindgen", "--features", "cli", "--",
        "generate",
        "--library", cdylibPath,
        "--language", "kotlin",
        "--config", "core/bindings/uniffi.toml",
        "--out-dir", "apps/mobile-android/app/src/main/java",
    )
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.01.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // UniFFI runtime (JNA) + Coroutines
    implementation("net.java.dev.jna:jna:5.14.0@aar")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Secure token storage (EncryptedSharedPreferences)
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:5.14.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

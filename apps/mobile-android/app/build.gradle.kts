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
        versionName = "5.0.0"

        // The Kotlin shell alone could run on 32-bit ABIs (JNA ships dispatchers
        // for armeabi-v7a, x86, ...), but the Rust core is only cross-built for
        // arm64-v8a and x86_64. Without this filter the APK would advertise
        // 32-bit support and then crash on those devices with an
        // UnsatisfiedLinkError the moment the core is called.
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    packaging {
        jniLibs {
            // `tooling/build-android-libs.mjs` already strips the Rust core;
            // keeping the symbols stops AGP from running a second, redundant
            // strip pass (and warning when it cannot find a matching NDK).
            keepDebugSymbols += "**/libquizradar_core.so"
        }
    }

    signingConfigs {
        create("release") {
            val keystorePath =
                System.getenv("KEYSTORE_FILE")
                    ?: (project.findProperty("KEYSTORE_FILE") as? String)
            val storePassword =
                System.getenv("KEYSTORE_PASSWORD")
                    ?: (project.findProperty("KEYSTORE_PASSWORD") as? String)
            val keyAlias =
                System.getenv("KEY_ALIAS")
                    ?: (project.findProperty("KEY_ALIAS") as? String)
            val keyPassword =
                System.getenv("KEY_PASSWORD")
                    ?: (project.findProperty("KEY_PASSWORD") as? String)

            if (!keystorePath.isNullOrBlank() && file(keystorePath).exists()) {
                storeFile = file(keystorePath)
                this.storePassword = storePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            }
        }
    }

    buildTypes {
        debug {
            // The debug build used to ship the *unshrunk*
            // `material-icons-extended` dex (62 MB): ART dexoptimised it for
            // ~30 s on the first run, the app took 14 s to show its first
            // frame, and the system could raise an ANR on the widget worker
            // while the main thread was still loading classes.
            //
            // R8 with `-dontobfuscate` shrinks the dex to the size of the
            // release build while keeping every class and method name (and
            // the source line numbers), so the debugger, the stack traces and
            // the crash reports stay exactly as readable as before.
            isMinifyEnabled = true
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android.txt"),
                "proguard-rules.pro",
                "proguard-rules-debug.pro",
            )
        }
        release {
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null && releaseSigning.storeFile!!.exists()) {
                signingConfig = releaseSigning
            }
            // R8 removes the thousands of unused `material-icons-extended`
            // classes. Without it the shipped app carries a ~44 MB dex and the
            // first frame took ~30 s on a mid-range device (the system showed
            // "app isn't responding"). With it the icon dex shrinks to the few
            // dozen icons the app actually draws.
            isMinifyEnabled = true
            isShrinkResources = true
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

    lint {
        checkReleaseBuilds = false
        abortOnError = false
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

/**
 * Cross-compiles the Rust core for the Android ABIs the app ships and stages
 * the libraries where the plugin packages them from
 * (`src/main/jniLibs/<abi>/libquizradar_core.so`).
 *
 * This task MUST run before the jniLibs are merged: the app is a Kotlin shell
 * around the Rust core (UniFFI), so an APK without `libquizradar_core.so`
 * cannot even start. It used to exist but was never wired into the packaging,
 * which meant CI and the release workflow produced APKs with no native core.
 */
tasks.register<Exec>("buildAndroidRustLibs") {
    group = "build"
    description = "Cross-compiles quizradar-core for arm64-v8a + x86_64 and stages the .so files"
    workingDir = rootProject.projectDir.resolve("../..")
    commandLine("node", "tooling/build-android-libs.mjs")
    doLast {
        // A staged library for only one ABI would ship an app that crashes on
        // every other device - fail the build instead of shipping that.
        val required = listOf("arm64-v8a", "x86_64")
        val missing =
            required.filter { abi ->
                !projectDir.resolve("src/main/jniLibs/$abi/libquizradar_core.so").exists()
            }
        if (missing.isNotEmpty()) {
            throw GradleException(
                "The native core is missing for: ${missing.joinToString(", ")}. " +
                    "Run `node tooling/build-android-libs.mjs` and check the NDK setup.",
            )
        }
    }
}

// Every packaging path (debug APK, release APK, release AAB) picks the
// libraries up through the jniLibs merge, so hooking the native build there
// covers all of them.
tasks.matching { it.name.endsWith("JniLibFolders") }.configureEach {
    dependsOn("buildAndroidRustLibs")
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

    // Chrome Custom Tabs for PKCE OAuth
    implementation("androidx.browser:browser:1.8.0")

    // Glance AppWidget 2x1
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("androidx.glance:glance-material3:1.1.1")

    // WorkManager (Widget periodic updates & exam reminders)
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:5.14.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.work:work-testing:2.10.0")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.love.love_stars"
    compileSdk = flutter.compileSdkVersion
    // 本项目没有原生 C/C++ 代码，不声明 ndkVersion。
    // 一旦写了这一行，AGP 就会强制下载 NDK 28.2（约 2GB），构建会卡在下载上。
    // 之前需要 NDK 是因为 shared_preferences_android 2.5.x 依赖 jni 包，
    // 已在 pubspec.yaml 里用 dependency_overrides 锁回 2.4.28（纯 Java 实现）。
    // ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.love.love_stars"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    // AGP 8.x 自带的 Lint 在这个项目上会崩（JavaDocParser.parseDataItem 抛
    // NoSuchMethodError，是 AGP/Kotlin 版本不匹配的已知问题），
    // 而 Flutter 的 release 构建默认会跑 lintVitalRelease，直接把构建打断。
    // 我们的代码正确性由 `flutter analyze` 保证，这里关掉 release 的 lint。
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

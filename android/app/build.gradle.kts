plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.donsik.badatoeic"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.donsik.badatoeic"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "1.0.1"

        // 딥 블루 로딩 오버레이 / 재시도 화면에 쓸 색을 한 곳에서 관리
        resValue("string", "app_url", "https://bada-toeic.onrender.com")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "DebugProbesKt.bin")
    }
}

dependencies {
    // 외부 라이브러리 없이 플랫폼 WebView API 만 사용합니다(빌드 실패 요인 최소화).
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.24")
}

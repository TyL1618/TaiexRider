plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.tylapp.taiexrider"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.tylapp.taiexrider"
        minSdk = 24
        targetSdk = 36
        versionCode = 14
        versionName = "1.14"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            optimization {
                enable = false
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation(libs.appcompat)
    implementation(libs.material)
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.1")
    // Digital Goods API / Play Billing 橋接（鑽石購買+永久去廣告 IAP 用），
    // 版本號已查證 dl.google.com/dl/android/maven2 官方 Maven repo 確認為目前最新穩定版
    implementation("com.google.androidbrowserhelper:billing:1.1.0")
    testImplementation(libs.junit)
    androidTestImplementation(libs.espresso.core)
    androidTestImplementation(libs.ext.junit)
}
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
        versionCode = 15
        versionName = "1.15"

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
    // AdMob 獎勵廣告 SDK。TWA 沒有官方 postMessage 橋接可用（androidbrowserhelper 的
    // LauncherActivity 不暴露 CustomTabsSession，見 AdBridgeService.kt 檔頭說明），
    // 改用本機 loopback HTTP server 讓網頁觸發，這支負責實際載入/顯示廣告。
    implementation("com.google.android.gms:play-services-ads:25.4.0")
    // 本機 loopback HTTP server（AdBridgeService.kt 用），版本號已查證
    // repo1.maven.org 官方 Maven Central 確認為目前最新穩定版
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    testImplementation(libs.junit)
    androidTestImplementation(libs.espresso.core)
    androidTestImplementation(libs.ext.junit)
}
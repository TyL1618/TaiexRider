package com.tylapp.taiexrider

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.androidbrowserhelper.trusted.LauncherActivity

class MainActivity : LauncherActivity() {

    companion object {
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // ⚠️ 真機實測發現：Android 13+ 顯示任何通知（含前景服務的常駐通知）都需要
        // 使用者額外同意 POST_NOTIFICATIONS 這個執行時權限——沒要過這個權限，
        // 前景服務本身仍會拿到優先權（廣告功能不受影響），但系統會靜默不顯示
        // 通知，玩家/Play Console 審查都看不到「TaiexRider・廣告服務待命中」。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST_CODE,
            )
        }
        // 啟動 AdMob 獎勵廣告的本機橋接 server（見 AdBridgeService.kt 檔頭說明）。
        // 這支 Activity 啟動 TWA 成功後很快就會 finish()，但前景服務不會跟著死，
        // 之後網頁靠 fetch(127.0.0.1) 呼叫它都還在（普通 startService 實測會被
        // 系統背景省電機制提早停掉，見 AdBridgeService.kt 的 startAsForeground()）。
        ContextCompat.startForegroundService(this, Intent(this, AdBridgeService::class.java))
        hideSystemUI()
    }

    // 視窗重新取得焦點時（如彈窗關閉後）重設 immersive，避免系統列跑回來
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUI()
    }

    private fun hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // API 30+：新版 API
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.systemBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            // API 24–29：舊版 flags（deprecated 但仍有效）
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            )
        }
    }
}

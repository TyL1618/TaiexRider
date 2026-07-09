package com.tylapp.taiexrider

import android.Manifest
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

    private fun needsNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED

    // ⚠️ 真機實測發現最根本的一層坑：LauncherActivity.onCreate() 本身就會（在
    // super.onCreate() 呼叫當下）自動立刻啟動 TWA 瀏覽器畫面，跟我們稍後才發出的
    // 通知權限對話框搶 Activity 焦點——瀏覽器畫面幾乎立刻蓋上來，把還沒來得及讓
    // 使用者互動的權限對話框直接蓋掉（症狀：對話框閃現不到一秒就消失）。
    // LauncherActivity 原本就提供這個擴充點處理「啟動前要先做非同步任務」的情境：
    // 回傳 false 延後自動啟動，改由我們自己在權限確定後呼叫 launchTwa()。
    override fun shouldLaunchImmediately(): Boolean = !needsNotificationPermission()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Android 13+ 顯示任何通知（含前景服務的通知）都需要使用者額外同意
        // POST_NOTIFICATIONS 這個執行時權限——沒要過這個權限，前景服務本身仍會
        // 拿到優先權（廣告功能不受影響），但系統會靜默不顯示通知。
        // vc17 起 AdBridgeService 改由 AdActivity 在看廣告時才啟動（不再常駐），
        // 這裡只負責在自然的開機時機把權限問完，之後看廣告時權限狀態已經確定。
        if (needsNotificationPermission()) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST_CODE,
            )
        }
        hideSystemUI()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE) {
            // shouldLaunchImmediately() 剛才回傳了 false，TWA 還沒真的啟動，
            // 現在權限已經有結果了（允許或拒絕都行），換我們手動把延後的啟動補上。
            launchTwa()
        }
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

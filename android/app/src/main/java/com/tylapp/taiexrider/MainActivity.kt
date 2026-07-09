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
        // ⚠️ 真機實測發現兩層坑：
        // 1) Android 13+ 顯示任何通知（含前景服務的常駐通知）都需要使用者額外同意
        //    POST_NOTIFICATIONS 這個執行時權限——沒要過這個權限，前景服務本身仍會
        //    拿到優先權（廣告功能不受影響），但系統會靜默不顯示通知。
        // 2) 一開始把「請求權限」跟「啟動服務」寫在同一段同步執行——權限對話框跳出來
        //    需要使用者互動時間，但 startForegroundService() 幾乎立刻執行，服務的
        //    startForeground() 第一次呼叫時權限根本還沒生效，通知被系統靜默壓下，
        //    且 Service.onCreate() 只會跑一次，之後就算使用者按了允許，同一個服務
        //    實例的生命週期裡也不會補顯示。修法：權限已經有才立刻啟動服務；權限
        //    還沒決定，改成請求完、等 onRequestPermissionsResult 回呼後才啟動，
        //    確保 startForeground() 執行的當下權限狀態已經確定。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST_CODE,
            )
        } else {
            startAdBridgeService()
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
            // 不管使用者允許或拒絕都要啟動——廣告橋接本身不需要通知權限就能運作，
            // 只是拒絕的話通知不會顯示，這裡只是確保啟動時機在權限狀態確定之後。
            startAdBridgeService()
        }
    }

    // 啟動 AdMob 獎勵廣告的本機橋接 server（見 AdBridgeService.kt 檔頭說明）。
    // 這支 Activity 啟動 TWA 成功後很快就會 finish()，但前景服務不會跟著死，
    // 之後網頁靠 fetch(127.0.0.1) 呼叫它都還在（普通 startService 實測會被
    // 系統背景省電機制提早停掉，見 AdBridgeService.kt 的 startAsForeground()）。
    private fun startAdBridgeService() {
        ContextCompat.startForegroundService(this, Intent(this, AdBridgeService::class.java))
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

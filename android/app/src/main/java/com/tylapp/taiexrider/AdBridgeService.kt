package com.tylapp.taiexrider

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject

// ============================================================
// TWA 內的 AdMob 獎勵廣告橋接——為什麼不能用官方 PostMessage for TWA
// ============================================================
// Chrome 官方文件（developer.chrome.com/docs/android/post-message-twa）教的做法，
// 範例程式碼的 MainActivity 完全不繼承 androidbrowserhelper 的 LauncherActivity，
// 而是自己手刻 CustomTabsClient 綁定 + 建立 session + 啟動 TWA，因為 postMessage
// 需要「啟動 TWA 那個 CustomTabsSession」的直接參照才能呼叫 requestPostMessageChannel()。
//
// 我們的 MainActivity 繼承 LauncherActivity（要留著 splash/shortcuts/預測性返回這些
// 既有功能），它內部的 TwaLauncher 把這個 session 存成 private 欄位、完全沒有 getter，
// 而且 LauncherActivity 啟動 TWA 成功後一定會呼叫 finish()（設計上是「trampoline」，
// 不會留在背景），代表就算硬挖到 session，我們的 Activity 當下也已經不在了。
// GitHub issue #472（github.com/GoogleChrome/android-browser-helper/issues/472）
// 是另一個開發者用 Bubblewrap 生成的專案（跟我們結構一樣）踩到一模一樣的牆，
// 2026-07 查證時仍是 open、無解，結論是「除非改函式庫原始碼，沒有乾淨做法」。
//
// 改用完全不碰 TWA session 的「本機 loopback HTTP server」：
// 網頁 JS 直接 fetch('http://127.0.0.1:PORT/...')（loopback 對 HTTPS 頁面不算
// mixed content，瀏覽器允許）。這個 Service 由 MainActivity.onCreate() 啟動
// （見該檔），啟動後獨立於 LauncherActivity 存活。
//
// ⚠️ 追加踩雷（真機實測）：這支 Service 原本收到請求後直接
// context.startActivity(AdActivity) 顯示廣告，結果被 Android 的 Background
// Activity Launch 限制擋下（logcat: BAL_BLOCK, result code=102）——即使是前景
// 服務也不在官方文件列出的豁免條件內，只有「由目前可見的前景 App 發起」才會放行。
// 改成：AdActivity 由網頁端用使用者手勢導轉自訂 URL scheme 啟動（Chrome 是前景
// App，發起者是它，不是我們的 Service，因此不受 BAL 限制），這支 Service 降級
// 成單純的「結果暫存區查詢站」（/ad/reset 清空、/ad/result 給目前狀態），
// 網頁端用短間隔輪詢取得結果，不再需要 Service 主動開啟任何畫面。
// ============================================================
class AdBridgeService : Service() {

    companion object {
        // ⚠️ 需與 src/lib/ads.ts 的 AD_BRIDGE_PORT 常數保持一致
        const val PORT = 47591
        private const val TAG = "AdBridgeService"
        private const val NOTIF_CHANNEL_ID = "ad_bridge"
        private const val NOTIF_ID = 1
    }

    private var server: LoopbackServer? = null

    // ⚠️ 真機實測發現：MainActivity 啟動 TWA 成功後很快 finish()，App 對系統來說
    // 變成「背景無互動」，三星 One UI 在幾分鐘內就把普通 Service 判定 app idle 停掉
    // （logcat: "Stopping service due to app idle"）——server 死掉後，遊戲點「看廣告」
    // 只會卡在逾時。改成前景服務（常駐通知）避免被背景省電機制提早殺掉。
    private fun startAsForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIF_CHANNEL_ID, "廣告服務", NotificationManager.IMPORTANCE_LOW,
            )
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
        // NotificationCompat（而非 android.app.Notification.Builder(ctx, channelId)）：
        // 後者帶 channelId 的建構子是 API26+ 才有，minSdk=24 會編不過/崩潰。
        val notification = NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setContentTitle("TaiexRider")
            .setContentText("廣告服務待命中")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    override fun onCreate() {
        super.onCreate()
        startAsForeground()
        if (server != null) return
        server = LoopbackServer().also {
            try {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                Log.i(TAG, "AdBridge server started on 127.0.0.1:$PORT")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start AdBridge server", e)
                server = null
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        server?.stop()
        server = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private inner class LoopbackServer : NanoHTTPD("127.0.0.1", PORT) {
        override fun serve(session: IHTTPSession): Response {
            val json = when (session.uri) {
                "/ad/reset" -> {
                    AdBridge.reset()
                    JSONObject().put("ok", true)
                }
                "/ad/result" -> {
                    JSONObject()
                        .put("done", AdBridge.isDone())
                        .put("granted", AdBridge.isGranted())
                }
                else -> return newFixedLengthResponse(
                    Response.Status.NOT_FOUND, "text/plain", "not found",
                )
            }
            return newFixedLengthResponse(Response.Status.OK, "application/json", json.toString())
        }
    }
}

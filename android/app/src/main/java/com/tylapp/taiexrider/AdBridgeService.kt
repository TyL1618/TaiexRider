package com.tylapp.taiexrider

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
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
// mixed content，瀏覽器允許）。vc17 起這個 Service 只由 AdActivity 在看廣告時啟動
// （不再由 MainActivity 常駐啟動），一輪結束後自動關閉，見 class 註解。
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
// ⚠️ vc17 起改成「只在看廣告時才短暫存活」：不再由 MainActivity 常駐啟動，唯一啟動點
// 是 AdActivity（使用者按下看廣告的當下）。啟動後 IDLE_TIMEOUT_MS 內沒完成就自動關閉
// （保底，避免流程卡住讓通知永遠留著）；廣告結果出來（done 第一次變 true）後留
// LINGER_AFTER_DONE_MS 給網頁端輪詢抓走結果，然後自動關閉。前景服務通知（Android
// 系統強制要求，無法隱藏）只會在「點看廣告 → 廣告播完後幾秒」這段期間短暫出現。
class AdBridgeService : Service() {

    companion object {
        // ⚠️ 需與 src/lib/ads.ts 的 AD_BRIDGE_PORT 常數保持一致
        const val PORT = 47591
        private const val TAG = "AdBridgeService"
        private const val NOTIF_CHANNEL_ID = "ad_bridge"
        private const val NOTIF_ID = 1

        // 保底逾時：涵蓋「廣告載入 + 一支 15~30s 影片 + 網頁端 60s 輪詢逾時」的最壞情況
        // 還有餘裕；超過就視為這一輪流程已經死掉，自動關閉服務讓通知消失。
        private const val IDLE_TIMEOUT_MS = 120_000L
        // done=true 之後留給網頁端輪詢抓結果的時間（輪詢間隔 500ms + visibilitychange
        // 喚醒，廣告一關閉分頁恢復可見就會立刻來抓，8 秒非常寬裕）。
        private const val LINGER_AFTER_DONE_MS = 8_000L
    }

    private var server: LoopbackServer? = null
    private val handler = Handler(Looper.getMainLooper())
    // done=true 後只安排一次短延遲關閉（輪詢會重複讀 /ad/result，不能每次都重新排程）
    @Volatile private var lingerArmed = false

    private val stopRunnable = Runnable {
        Log.i(TAG, "auto-stopping (round finished or idle timeout)")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // 重新排程自動關閉。serve() 在 NanoHTTPD 的背景執行緒呼叫，Handler post 本身是
    // thread-safe 的，不需要額外鎖。
    private fun scheduleStop(delayMs: Long) {
        handler.removeCallbacks(stopRunnable)
        handler.postDelayed(stopRunnable, delayMs)
    }

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
        // 每次啟動（= AdActivity 開始新一輪看廣告）重置狀態、重新排保底逾時。
        lingerArmed = false
        scheduleStop(IDLE_TIMEOUT_MS)
        // 不用 START_STICKY：這個服務只服務「當下這一輪看廣告」，被系統殺掉後
        // 自動復活反而會讓通知在沒人看廣告時冒出來。下一輪 AdActivity 會重新啟動它。
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(stopRunnable)
        server?.stop()
        server = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private inner class LoopbackServer : NanoHTTPD("127.0.0.1", PORT) {
        override fun serve(session: IHTTPSession): Response {
            val json = when (session.uri) {
                "/ad/reset" -> {
                    // 新一輪看廣告開始：清狀態 + 重排保底逾時。（服務剛被 AdActivity 啟動的
                    // 情況下 onStartCommand 也會做同樣的事，這裡涵蓋「上一輪還沒自動關閉、
                    // 使用者又立刻點下一次」的重用路徑。）
                    AdBridge.reset()
                    lingerArmed = false
                    scheduleStop(IDLE_TIMEOUT_MS)
                    JSONObject().put("ok", true)
                }
                "/ad/result" -> {
                    val done = AdBridge.isDone()
                    val granted = AdBridge.isGranted()
                    if (done && !lingerArmed) {
                        // 結果已出，留短暫時間給網頁端輪詢抓走，然後自動關閉服務
                        lingerArmed = true
                        Log.i(TAG, "result ready (granted=$granted), stopping in ${LINGER_AFTER_DONE_MS}ms")
                        scheduleStop(LINGER_AFTER_DONE_MS)
                    }
                    JSONObject().put("done", done).put("granted", granted)
                }
                else -> {
                    Log.w(TAG, "404 for ${session.uri}")
                    return newFixedLengthResponse(
                        Response.Status.NOT_FOUND, "text/plain", "not found",
                    )
                }
            }
            // ⚠️ 真機實測抓到的關鍵坑：網頁來源是 https://taiexrider.pages.dev，
            // 這支 server 是 http://127.0.0.1:47591——scheme/host/port 都不同，
            // 屬於跨來源請求。沒有這個標頭，瀏覽器會照樣把請求送出去、這裡也照樣
            // 印出正確的 log（这就是為什麼 log 一直顯示 done=true 卻始終沒發獎勵的
            // 真因），但會擋住網頁 JS 讀取回應內容，fetch 在網頁端直接失敗，
            // 只能不斷重試到逾時、永遠拿不到真正結果。
            return newFixedLengthResponse(Response.Status.OK, "application/json", json.toString())
                .apply { addHeader("Access-Control-Allow-Origin", "*") }
        }
    }
}

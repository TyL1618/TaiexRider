package com.tylapp.taiexrider

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback

// 由 Chrome（使用者在網頁上點按鈕、透過 <a href="taiexrider-ad://show?..."> 導轉）
// 觸發啟動——啟動來源是可見的前景 App（Chrome），不是我們自己背景的 Service，
// 才不會被 Android 的 Background Activity Launch 限制擋下（見 AdBridge.kt 檔頭
// 說明：AdBridgeService 直接 startActivity 曾被系統回應 BAL_BLOCK/result code=102）。
// 沒有自己的 UI（Manifest 設透明主題），使用者體感是「原生廣告蓋出來」，
// 跟現有 Google Play 付款彈窗蓋出來再消失的體驗類似。
//
// ⚠️ 上架前必須把 testAdUnitId 換成真實廣告單元 ID（見 CLAUDE.md 廣告雙軌架構段落）：
//    revive_reward: ca-app-pub-8981745966447649/1679422480
//    coin_reward:   ca-app-pub-8981745966447649/2170377077
// 目前用 Google 官方測試單元 ID，不受 AdMob 帳戶審核/廣告單元啟用狀態影響，
// 用意是先把「網頁→原生→顯示廣告→回報結果」整條橋接跑通。
// 繼承 Activity（不是 AppCompatActivity）：這支畫面沒有工具列/Fragment，不需要
// 任何 AppCompat 功能——⚠️ 真機實測踩過雷，AppCompatActivity 配非 AppCompat 主題
// （這裡用的 Theme.Translucent.NoTitleBar）會直接拋 IllegalStateException 崩潰
// （logcat 看到的現象是 AdActivity 啟動瞬間就被系統判定當機）。
class AdActivity : Activity() {

    companion object {
        private const val TEST_REWARDED_AD_UNIT_ID = "ca-app-pub-3940256099942544/5224354917"
        private const val TAG = "AdActivity"
    }

    private var rewardEarned = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setBackgroundDrawable(ColorDrawable(Color.BLACK))
        // vc17 起這裡是 AdBridgeService 的唯一啟動點（服務只在看廣告這一輪存活，
        // 結束後自動關閉，見 AdBridgeService 的 class 註解）。這個位置天生涵蓋了
        // 真機實測踩過的坑：載入廣告影片吃記憶體時，系統可能把整個 App 行程砍掉重開、
        // 新行程直接從這支 Activity 冷啟動、從未經過 MainActivity——由這裡啟動就保證
        // 「廣告在哪個行程播，哪個行程就有 server 在聽」。重複啟動是安全的（已在跑
        // 只會多收一個 onStartCommand，重排逾時，不會重複建立 server）。
        ContextCompat.startForegroundService(this, Intent(this, AdBridgeService::class.java))
        AdBridge.reset()
        // 目前兩種類型都還是用同一個 Google 測試單元 ID，上架前分流成真實單元時
        // 在這裡依 adType（"coin" / "revive"）換成對應的真實 ID 即可。
        val adType = intent?.data?.getQueryParameter("type") ?: "coin"
        loadAndShow(adType)
    }

    // Log 原則（vc17 清理後留下的都是長期可觀測性，別再砍）：错誤路徑一律 Log.e；
    // 正常路徑只留一行「廣告關閉 + 是否拿到獎勵」——這是排查「看完沒發獎勵」類問題時
    // 唯一需要的定罪證據（見 CLAUDE.md 2026-07-09 八層坑，當時就是靠這行找到 CORS 真因）。
    private fun loadAndShow(adType: String) {
        RewardedAd.load(
            this,
            TEST_REWARDED_AD_UNIT_ID,
            AdRequest.Builder().build(),
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(ad: RewardedAd) {
                    ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                        override fun onAdDismissedFullScreenContent() {
                            Log.i(TAG, "ad dismissed, type=$adType rewardEarned=$rewardEarned")
                            AdBridge.complete(rewardEarned)
                            finish()
                        }

                        override fun onAdFailedToShowFullScreenContent(error: AdError) {
                            Log.e(TAG, "onAdFailedToShowFullScreenContent: ${error.message}")
                            AdBridge.complete(false)
                            finish()
                        }
                    }
                    ad.show(this@AdActivity) {
                        rewardEarned = true
                    }
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    Log.e(TAG, "onAdFailedToLoad: ${error.message} code=${error.code}")
                    AdBridge.complete(false)
                    finish()
                }
            },
        )
    }
}

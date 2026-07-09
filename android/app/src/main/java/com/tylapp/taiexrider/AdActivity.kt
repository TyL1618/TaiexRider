package com.tylapp.taiexrider

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
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
class AdActivity : AppCompatActivity() {

    companion object {
        private const val TEST_REWARDED_AD_UNIT_ID = "ca-app-pub-3940256099942544/5224354917"
    }

    private var rewardEarned = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setBackgroundDrawable(ColorDrawable(Color.BLACK))
        AdBridge.reset()
        // 目前兩種類型都還是用同一個 Google 測試單元 ID，上架前分流成真實單元時
        // 在這裡依 adType（"coin" / "revive"）換成對應的真實 ID 即可。
        val adType = intent?.data?.getQueryParameter("type") ?: "coin"
        loadAndShow(adType)
    }

    private fun loadAndShow(adType: String) {
        RewardedAd.load(
            this,
            TEST_REWARDED_AD_UNIT_ID,
            AdRequest.Builder().build(),
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(ad: RewardedAd) {
                    ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                        override fun onAdDismissedFullScreenContent() {
                            AdBridge.complete(rewardEarned)
                            finish()
                        }

                        override fun onAdFailedToShowFullScreenContent(error: AdError) {
                            AdBridge.complete(false)
                            finish()
                        }
                    }
                    ad.show(this@AdActivity) { rewardEarned = true }
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    AdBridge.complete(false)
                    finish()
                }
            },
        )
    }
}

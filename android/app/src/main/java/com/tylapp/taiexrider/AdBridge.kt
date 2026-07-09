package com.tylapp.taiexrider

import android.content.Context
import android.content.Intent
import java.util.concurrent.atomic.AtomicReference

// AdBridgeService（處理 HTTP 請求的背景執行緒）跟 AdActivity（實際顯示廣告的 UI）
// 同屬一個 process，用一個簡單的靜態回呼傳結果就夠，不需要真的跨 process IPC。
object AdBridge {
    private val pendingCallback = AtomicReference<((Boolean) -> Unit)?>(null)

    fun requestRewardedAd(context: Context, adType: String, callback: (Boolean) -> Unit) {
        // 同一時間只服務一個請求：新請求進來若還有舊的沒回應，直接判失敗，
        // 避免 AdActivity 疊多層或回呼對象錯亂。
        pendingCallback.getAndSet(callback)?.invoke(false)
        val intent = Intent(context, AdActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
            putExtra(AdActivity.EXTRA_AD_TYPE, adType)
        }
        context.startActivity(intent)
    }

    fun completeWithResult(granted: Boolean) {
        pendingCallback.getAndSet(null)?.invoke(granted)
    }
}

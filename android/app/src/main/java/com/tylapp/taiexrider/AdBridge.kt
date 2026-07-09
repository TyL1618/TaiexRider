package com.tylapp.taiexrider

// 真機實測發現：AdBridgeService 直接 context.startActivity(AdActivity) 會被 Android
// 的 Background Activity Launch 限制擋下（logcat: BAL_BLOCK, result code=102）——
// 前景服務並不在官方文件列出的豁免條件內，只有「由目前可見的前景 App 發起」才算數。
// 所以 AdActivity 改成由 Chrome 使用者手勢觸發的自訂 URL scheme 導轉來啟動
// （見 AndroidManifest.xml 的 intent-filter + src/lib/ads.ts 的 <a> 導轉），
// 這個物件降級成單純的「結果暫存區」：AdActivity 顯示完廣告後把結果寫進來，
// AdBridgeService 的 HTTP endpoint 被動讀出來回應網頁端的輪詢，不再需要開啟任何畫面。
object AdBridge {
    @Volatile private var done = false
    @Volatile private var granted = false

    fun reset() {
        done = false
        granted = false
    }

    fun complete(result: Boolean) {
        granted = result
        done = true
    }

    fun isDone(): Boolean = done

    fun isGranted(): Boolean = granted
}

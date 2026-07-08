package com.tylapp.taiexrider

import com.google.androidbrowserhelper.playbilling.digitalgoods.DigitalGoodsRequestHandler

// androidbrowserhelper 的預設 DelegationService 不會自動接上 Play Billing 的
// Digital Goods 處理器，必須自己繼承並在 onCreate() 註冊，否則 Chrome 端呼叫
// getDetails()/listPurchases() 一律失敗（clientAppUnavailable / Unable to
// execute getDetails.），與 AndroidManifest.xml 的 intent-filter 需一併設定。
class DelegationService : com.google.androidbrowserhelper.trusted.DelegationService() {
    override fun onCreate() {
        super.onCreate()
        registerExtraCommandHandler(DigitalGoodsRequestHandler(applicationContext))
    }
}

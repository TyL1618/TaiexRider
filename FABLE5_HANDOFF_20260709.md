# Fable 5 交接任務清單（2026-07-09）

> 開工前務必先讀 [CLAUDE.md](CLAUDE.md) 開發守則第 1~4 條（沒說動工不動 code、動 code 必同步
> 文件+push、跨機器一律 `git pull` 起手）。這份清單是使用者跟 Sonnet 討論後拍板的三項檢查/
> 整理任務，彼此獨立、沒有依賴順序，但按下方順序做即可。使用者說這次「有餘裕」，不用趕，
> 一項做完（typecheck/build 過、必要時 push）再進下一項。

## 為什麼是這三項（背景脈絡）

7/9 這天密集打通了 AdMob 廣告橋接（8 層坑）+ Play Billing IAP（6 層坑），兩者都是在真機除錯
壓力下邊測邊改出來的，且都直接碰觸「真錢」與「原生橋接穩定性」——這正是最需要有人用新鮮
視角回頭檢查的地方。同時 CLAUDE.md 已經累積成一份幾十段「追加/再追加/三度追加⋯」的除錯
流水帳，違反專案自己訂的文件慣例（DEVDOC.md 才該放架構/規格）。

---

## 🥇 優先順序 1：IAP / 金流二次稽核

**背景**：2026-07-09 稽核過一輪並修掉兩個真錢缺口（`consume`/`acknowledge` 失敗仍回報成功
會導致鑽石已發+又被退款；付款成功但發放中途失敗會讓錢卡住，靠 `reconcilePurchases()` 補
對帳）。這輪稽核是原始實作者自己做的，容易有盲點，需要一個沒有參與過原始實作、帶著懷疑
心態的人重新審一次。

**要看的檔案**：
- [supabase/functions/verify-iap-purchase](supabase/functions/verify-iap-purchase)（Edge Function，驗證邏輯+發放邏輯）
- [src/lib/billing.ts](src/lib/billing.ts)（`runPurchaseFlow()`／`reconcilePurchases()`）
- [src/screens/Garage.tsx](src/screens/Garage.tsx)（購買 UI 呼叫端、`reconciled` 本地標記）
- `iap_purchases` 表的 schema 與相關 migration（`supabase/migration_2026070*.sql` 系列，
  搜尋 `grant_iap_diamonds`/`grant_remove_ads`/`iap_purchases`）

**請重點檢查（非窮舉，鼓勵自己找更多）**：
1. **重複購買/重放攻擊**：同一個 `purchaseToken` 能不能被送兩次拿到兩次獎勵？防重放鍵
   是否真的涵蓋所有路徑（含 `reconcilePurchases()` 這條補發路徑）？
2. **退款情境**：Google 退款後，`ads_removed`/鑽石有沒有被收回的機制？如果沒有，這是
   已知風險還是需要新增處理？
3. **`reconcilePurchases()` 的競速情境**：如果使用者在對帳進行中又手動觸發一次購買，或
   同時開兩個分頁/裝置，會不會重複發放或漏發？
4. **金額/商品 ID 對應**：Edge Function 驗證的商品 ID 白名單跟前端顯示的價格是否完全
   對應，有沒有可能前端顯示 A 商品、後端誤判成 B 商品發錯數量？
5. **未登入/session 過期時的行為**：已知有雙層防護擋訪客購買，但 session 在購買流程
   *進行中*過期（不是購買前）會發生什麼？
6. **Edge Function 例外處理**：所有 `catch` 區塊是否都正確回報失敗（不是靜默吞掉又
   回 `ok:true`）？7/9 抓到的那個 bug 模式（`.catch(()=>{})` 靜默吞錯但仍回報成功）
   有沒有在其他地方重演？

**交付物**：一份簡短的稽核報告（可以直接寫在這份文件底下或另開段落），列出：發現的問題
（如果有）、風險等級、建議修法。**不確定是否為真的問題可以先列出來問使用者，不要自己
猜測後直接改動金流邏輯**——這塊改錯代價高，任何要改的地方先跟使用者確認過再動手。

---

## 🥈 優先順序 2：原生 Android 廣告橋接程式碼清理 + vc17 生命週期改善

**背景**：`AdBridgeService`/`AdActivity` 這包是 7/9 當天在真機除錯壓力下疊了 8 層
workaround 才打通的（BAL 繞過、行程被系統砍掉重啟的保護、CORS 標頭、foreground service
逾時邏輯等）。這種在時間壓力下邊測邊改出來的 code，容易留下：診斷用的 log 沒清、重複
呼叫、寫死的逾時數字沒有註解說明為什麼是這個值。CLAUDE.md 裡本來就排了 vc17 要做「服務
只在看廣告時才短暫存活」，可以順便一起做掉。

**要看的檔案**：
- [android/app/src/main/java/com/tylapp/taiexrider/AdBridgeService.kt](android/app/src/main/java/com/tylapp/taiexrider/AdBridgeService.kt)
- [android/app/src/main/java/com/tylapp/taiexrider/AdActivity.kt](android/app/src/main/java/com/tylapp/taiexrider/AdActivity.kt)
- [android/app/src/main/java/com/tylapp/taiexrider/AdBridge.kt](android/app/src/main/java/com/tylapp/taiexrider/AdBridge.kt)
- [android/app/src/main/java/com/tylapp/taiexrider/MainActivity.kt](android/app/src/main/java/com/tylapp/taiexrider/MainActivity.kt)
- [src/lib/ads.ts](src/lib/ads.ts)（網頁端輪詢/喚醒邏輯）

**清理項目**：
1. **移除/收斂診斷用 log**：8 層坑排查過程中加的 `console.log`/Logcat log，判斷哪些是
   長期該留的可觀測性（例如 billing 那邊保留的三處 `console.error` 是刻意留的，見
   CLAUDE.md），哪些只是排查當下的臨時垃圾，該砍就砍。
2. **vc17 待辦（CLAUDE.md 已有完整設計，照著做）**：
   - `MainActivity.kt` 移除啟動 `AdBridgeService` 的呼叫（保留通知權限請求邏輯不動）
   - `AdActivity.kt` 的 `startForegroundService()` 呼叫變成唯一啟動點
   - `AdBridgeService.kt` 加自動關閉邏輯：`/ad/reset` 進來時用 `Handler.postDelayed`
     設保底逾時（例如 120 秒）；`/ad/result` 偵測到 `done` 第一次變 `true` 時，取消
     保底逾時、改成短延遲（例如 8 秒）後 `stopForeground()` + `stopSelf()`
   - versionCode +1（照專案慣例）
3. **確認沒有資源洩漏**：Service/Activity 的生命週期方法（`onDestroy`）是否確實釋放了
   所有註冊的 receiver/callback，避免行程重啟保護機制疊加出洩漏。
4. **把最終架構寫進 DEVDOC.md**（跟優先順序 3 呼應）：現在這套架構的全貌散落在 CLAUDE.md
   十幾段「追加」文字裡，應該有一份完整、線性、不含除錯過程的架構說明放進 DEVDOC.md
   §9.4c（已有雛形，確認內容是否需要更新反映 vc17 改動）。

**⚠️ 這塊改完需要真機驗證**（Android Studio 重新建置 signed build，測試看廣告拿金幣/
復活/雙倍金幣三條路徑），純程式碼審查不夠，記得在文件裡標注「待真機測試」。

---

## 🥉 優先順序 3：CLAUDE.md → DEVDOC.md 文件整理

**背景**：CLAUDE.md 現在是幾十段依日期堆疊的除錯流水帳（「追加」「再追加」「三度追加」⋯），
這違反專案自己在 CLAUDE.md 開頭訂的慣例：「README.md 給外人看／DEVDOC.md 給自己接手者看
架構」。內容太多，換機器接手或以後要評估架構變動（例如換 Capacitor）時，翻找成本很高。

**做法**：
1. 通讀 CLAUDE.md「目前進度」整節，把**已解決、有長期參考價值的架構決策/踩雷教訓**（例如
   AdMob 8 層坑的最終架構結論、IAP 完整鏈路、金幣/鑽石經濟系統設計、反作弊 Phase A 的
   驗證過程）整理進 [DEVDOC.md](DEVDOC.md) 對應章節（照現有章節結構，例如 §9.4c 廣告、
   §9.x IAP，沒有對應章節就新增）。
2. CLAUDE.md 只保留：
   - 開發守則（不動，第 1~4 條）
   - 「目前進度」精簡成**真正還沒完成的待辦** + 最近一週左右的活躍脈絡
   - 已完結的日期段落整段搬去 DEVDOC.md 或直接濃縮成一行「已解決，見 DEVDOC §X」的
     索引，不要整段複製，避免兩處重複維護
3. **「踩雷筆記」章節保留在 CLAUDE.md 不用搬**——那些是速查用的短條目，性質上更像
   CLAUDE.md 該有的東西，不是 DEVDOC 的架構文件。
4. History.md 的角色不變（更早期的歷史交接紀錄），不用跟這次整理混在一起。

**⚠️ 這是純文件整理工作，不要順手改動任何程式碼邏輯**——如果整理過程中發現文件跟實際
code 對不上（例如某個「已完成」其實程式碼裡沒看到對應邏輯），記錄下來回報使用者確認，
不要自己動手改 code 或改文件內容去「配合」哪一邊。

---

## 附加（有餘裕才做，非必要）：PNA 風險的優雅降級

**背景**：Sonnet 跟使用者討論時指出，Chrome 正在推行的 Private Network Access（PNA）政策
未來有機會讓 `AdBridgeService` 的 loopback fetch（`taiexrider.pages.dev` 這個公開網頁對
`127.0.0.1` 發請求）被瀏覽器擋下，屆時廣告橋接會整條失效（但**不影響** IAP 購買，因為
IAP 走的是 `DelegationService` 機制，沒有 loopback fetch）。

**建議**：`src/lib/ads.ts` 的 `requestRewardedAd()` 目前失敗時的行為（fetch 失敗會怎麼
回報給呼叫端）確認一下是否已經足夠優雅（呼叫端會不會卡住 UI、還是能正常顯示「暫時無法
看廣告」之類的訊息並讓遊戲繼續）。如果現在的失敗處理已經夠優雅，這項可以直接跳過不用做
任何改動，只要在這份文件補一行「已確認優雅降級，不需額外處理」即可。

---

## 📋 優先順序 1 交付物：IAP 金流二次稽核報告（2026-07-09，Fable 5）

> 稽核範圍：`supabase/functions/verify-iap-purchase/index.ts`、`src/lib/billing.ts`、
> `src/screens/Garage.tsx`、`migration_20260706c/20260706d/20260709b.sql`。
> 依交接指示**只審不改**，所有建議修法都先列出來等使用者拍板。

### 🔴 發現 1（高風險，建議修，等使用者確認）：Edge Function 沒有比對 Google 回應的 productId

**問題**：`verifyPurchase()` 只檢查 `purchaseState === 0`，完全沒有比對 Google 回應裡的
`productId` 欄位跟前端聲稱的 `sku_id` 是否一致。Google Play Developer API 的
`purchases.products.get` 端點，URL 裡的 productId 是否會被拿來跟 token 驗證比對，
官方文件**沒有保證**（社群長期回報它可能不驗證、只憑 token 回傳購買資料）——如果不驗證，
攻擊路徑是：

1. 攻擊者真的花 NT$31 買最便宜的 `diamonds_100`，拿到合法的 purchase_token（rooted 裝置
   可以從自己手機取得，或讀 app 的 localStorage `tr_iap_reconciled`）。
2. 用自己的 Supabase JWT（登入自己帳號就有）直接 curl 呼叫 Edge Function，但 `sku_id`
   改填 `diamonds_1200`（或 `remove_ads_forever`）。
3. 若 Google 端點不驗證 URL 的 productId，`purchaseState` 仍是 0 → 驗證通過 → 發 1200
   鑽石（NT$280 的商品）或永久去廣告（NT$72），實付 NT$31。

**風險等級**：高（直接真錢損失倍率 ~9x，且防重放擋不住——這是「一個 token 換錯商品」，
不是「一個 token 用兩次」）。前置條件是攻擊者要拿得到自己的 purchase_token（rooted 裝置
或抓包），封測期名單內風險低，但正式上架後值得堵上。

**建議修法（3 行，等確認後動工）**：`verifyPurchase()` 回傳值加讀 `productId` 欄位，
主流程加一個檢查：`if (purchase.productId && purchase.productId !== sku_id) → 拒絕`
（`productId` 官方文件註明 "May not be present"，所以只在有回傳時比對）。順便可以把
`orderId` 一起存進 `iap_purchases` 留稽核線索（選配）。

### 🟠 發現 2（已知風險，需要決策）：退款後沒有任何收回機制

Google 退款（使用者跟 Google 客服要求退款、刷卡爭議）後，已發的鑽石/`ads_removed`
**不會被收回**——專案完全沒有接 Voided Purchases API 或 Real-time Developer Notifications。
攻擊型玩法：買鑽石 → 立刻花掉 → 跟 Google 要求退款 → 鑽石已消費、錢拿回去。
**建議**：封測期接受此風險（量小、名單內）；正式上架後如果發現退款率異常，再加一支
每日排程呼叫 [Voided Purchases API](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases)
比對 `iap_purchases` 收回對應獎勵。不建議現在做（工程量 vs 封測期風險不成比例）。

### 🟡 發現 3（小）：Google 端暫時性錯誤會被誤標成「purchase not valid」

`verifyPurchase()` 對任何非 2xx（包含 Google 端 5xx/網路抖動）一律回 `null`，主流程
回 400「purchase not valid」。實際上這筆購買可能完全有效，只是驗證那一刻 Google 抖了一下。
後果不嚴重（`reconcilePurchases()` 下次進車庫會重試補發），但玩家當下看到的錯誤訊息
是誤導的。**建議**（選配）：把 Google 5xx 跟「真的查無此購買（404/400）」分開回報，
前者回 502「verify pending」讓訊息誠實一點。

### 🟡 發現 4（小，理論競速）：exists-then-insert 在並發下會讓其中一邊收到 500

`grant_iap_diamonds`/`grant_remove_ads` 的防重放是「先 `exists` 查再 `insert`」。兩個
請求同時進來（例如手動購買跟 `reconcilePurchases()` 撞在一起、或兩台裝置同時對帳），
兩邊都會通過 exists 檢查，然後其中一邊 insert 撞 primary key 直接拋例外 → Edge Function
回 500。**不會重複發放**（PK 是最後防線，這點設計是對的），且失敗那邊下次對帳會走
replay 分支自我修復，所以只是體驗小瑕疵。**建議**（選配）：改成
`insert ... on conflict (purchase_token) do nothing` 然後檢查影響列數，天生冪等、
並發下也不會拋例外。

### 🟡 發現 5（極小，邊角）：replay 分支假設玩家錢包一定存在

兩支 grant RPC 的 replay 分支直接 `select ... from player_wallet where player_id = p_player_id`
——如果 token 已被記錄、但**目前這個** player 還沒有錢包列（例如同裝置換帳號後對同一筆
token 對帳），會回 0 列 → Edge Function 判定 `no data` 回 500 → 前端每次進車庫都重試、
永遠失敗。機率極低（要同裝置換帳號＋新帳號從沒開過錢包），修法是把
`insert into player_wallet ... on conflict do nothing` 移到 replay 檢查之前。

### 📝 觀察（不是 bug，記錄供知悉）

- **孤兒交易歸屬**：付款當下 session 掉了、之後換另一個帳號登入同裝置進車庫，對帳會把
  鑽石發給**當下登入的帳號**（不是付款時的帳號）。同一個人兩個帳號的情境下可能「發錯戶」。
  技術上可用 `obfuscatedExternalAccountId` 綁定，但工程量不小，封測期不值得。
- **`tr_ads_removed` localStorage 可偽造**：改本地旗標可以跳過看廣告（白拿每日 2 次廣告
  金幣＝伺服器上限內的 80 金幣，並免看復活/雙倍廣告）。損失僅止於該作弊者自己的廣告
  曝光收益，金幣經濟有伺服器端 cap 擋著，屬可接受風險（跟 SECURITY_REVIEW 既有結論一致）。
- **`wallet_earn('ad')` 本來就沒驗證「真的看了廣告」**：已登入玩家可直接 curl RPC 拿
  每日上限內的廣告金幣。既有已知風險（反作弊 Phase A 的 cap 就是為此），非本次新發現。

### ✅ 確認沒問題的部分（下次稽核可跳過）

- 防重放 PK 涵蓋購買＋對帳兩條路徑，並發下也不可能重複發放（發現 4 只是體驗問題）。
- `consume`/`acknowledge` 失敗不再靜默吞掉（7/9 修的缺口 1 修得正確：bool 回傳、
  `alreadyConsumed`/`alreadyAcknowledged` 視為冪等成功、真失敗回 502 不回報成功）。
- 全案掃過一遍**沒有**其他 `.catch(()=>{})` 靜默吞錯又回報成功的模式重演。
- 未登入雙層防護：`runPurchaseFlow()` 在 PaymentRequest **之前**查 session（關鍵層）＋
  Garage UI 訪客不顯示購買區塊。付款中途 session 過期 → `submitPurchaseToken` 回 null →
  孤兒交易 → 對帳補發，鏈路完整。
- SKU/金額三處對照（billing.ts `DIAMOND_PACKS` ↔ Edge Function 白名單 ↔ RPC case）完全
  一致；顯示價格走 Google `getDetails()` 動態查詢，不存在前後端寫死價格不同步問題。
- 兩支 grant RPC 皆 `security definer` + revoke 到只剩 service_role；`iap_purchases`
  RLS 開啟且 revoke all，前端碰不到。
- `migration_20260709b` 的 42702 修復正確（`player_wallet.diamonds` 前綴消歧義）；
  `grant_remove_ads` 確認結構上無同款 bug（UPDATE 右值是字面量 `true`，無歧義可言）。

---

## 完成後

- 每項做完記得 `git add -A && git commit && git push`（優先順序 2 的 android/ 部分例外，
  push 不會自動生效，要提醒使用者手動走 Android Studio 流程）
- 在 CLAUDE.md「目前進度」補一段完成紀錄
- 這份檔案可以在整個清單做完後標記完結，仿照 [FABLE5_HANDOFF.md](FABLE5_HANDOFF.md) 的
  慣例在檔案開頭加一段「狀態盤點」摘要

# TaiexRider 歷史交接紀錄（History）

> 本檔保存 [CLAUDE.md](CLAUDE.md) 搬出的全部「🔖 交接」歷史區塊與早期 Phase 進度紀錄，**依時間新到舊排列、內容原封不動**，供查閱舊決策脈絡。
> 現況規則（開發守則／部署架構／每日地圖資料管線／踩雷筆記）一律以 CLAUDE.md 為準，本檔僅供考古。
> 2026-07-15：另外併入四份已完結的一次性交接單/批次清單/意見彙整（原獨立檔案，內容原封不動搬入，
> 只加下面這行封存標記），為根目錄瘦身，見 CLAUDE.md 當天記錄。

---

## 📦 已封存文件：FABLE5_HANDOFF_20260709.md（2026-07-09 交接單，執行完畢）

# Fable 5 交接任務清單（2026-07-09）

> ## ✅ 狀態盤點（2026-07-09 晚，Fable 5 執行完畢）
> - **🥇 IAP 二次稽核**：✅ 完成，報告在本檔底部。最重要發現＝Edge Function 未比對
>   `productId`（買便宜包冒充貴包漏洞）＋退款無收回機制，**依指示未改任何金流 code，
>   等使用者拍板**。
> - **🥈 廣告橋接清理 + vc17**：✅ 程式碼完成（服務只在看廣告時存活、log 收斂、
>   versionCode 17、DEVDOC §9.4b/c 更新、已同步本機 AS 專案），**⚠️ 待真機測試**
>   （三條廣告路徑 + 通知短暫出現行為）。
> - **🥉 文件整理**：✅ 完成。CLAUDE.md 1369 行 → ~230 行（守則/速查/待辦/已完結索引/
>   踩雷筆記），除錯流水帳結論整併進 DEVDOC §2.5/2.7/2.8/3.1b/9.4b/9.4c/10/12。
> - **附加 PNA 降級**：✅ 完成——不只確認，順手把「完全連不上 loopback 卡滿 60 秒」
>   改成 15 秒提早放棄（不發獎勵不扣次數，遊戲照常）。
> - 過程中未動任何金流邏輯；文件整理未改任何程式碼行為。

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

---

## 📦 已封存文件：NEXT_BATCH_PLAN.md（2026-07-04 晚盤點，多批分次完成，貫穿至 7/9）

# 7/6（禮拜一）起分批處理清單（2026-07-04 晚盤點）

> 使用者 2026-07-04 19:37 要求：把所有還沒做的事（資安 + 遊戲內容）記住並分批次分組，
> 7/6 起一批一批處理（不分優先順序，依「該一起做/該一起測」邏輯分批）。
> 7/6 可能換公司電腦開工——**這份清單是唯一事實來源**，開工先讀這份，讀完再讀 CLAUDE.md「目前進度」。

---

## 批次 1 — 錢包收尾（2026-07-06 上午確認：兩份 migration 皆已在 Supabase 跑過）

- [x] Supabase SQL Editor 已跑 **`supabase/migration_20260705.sql`**（`player_wallet` 等三表 + 六個 RPC）
      **與 `supabase/migration_20260706.sql`**（`player_achievements`/`player_streak` + 改造版 RPC）。
      **2026-07-06 用公司電腦的 anon key 直接打 Supabase REST API 驗證**：所有表/RPC 皆回應
      `42501 permission denied`（= 存在但只開放 `authenticated` 角色呼叫，設計如此）而非
      `PGRST202 找不到函式`，證實兩份 migration 都已生效，不是只有 commit 沒有真的執行。
- [x] **真機驗證已完成**（2026-07-06，使用者確認正常）：買車扣款、完賽/摔車/任務/廣告進帳、
      清 localStorage 後擁有清單保留、每日排名賽第 6 次挑戰被伺服器擋下，皆 OK。批次 1 全部完成。
- [x] **修登出沒清快取的 bug + 帳號污染三合一修復** 已完成（2026-07-06，migration_20260706.sql）。
      背景：2026-07-05 晚發現不只是「登出沒清快取」，而是暱稱（`taiex_player_name`）、
      Q 系列成就（`tr_achv_market`）、streak（`tr_daily_streak`）三個裝置共用 key
      都不分帳號也不清，且 Garage.tsx 的自動解鎖邏輯會把「裝置上另一個帳號留下的假進度」
      誤寫進「目前登入帳號」的伺服器擁有清單（已發生於 tommyisboy08@gmail.com 測試帳號，
      使用者已手動 SQL 清除）。修法三塊一次做：
      ① 暱稱改 DB 權威：新增 `get_player_name()` RPC，登入時 `auth.ts initNicknameFromGoogle()`
         優先拉伺服器 `user_profiles.player_name` 蓋掉本地，伺服器沒有才 fallback 舊邏輯。
      ② 錢包/成就/streak 登出全部歸零：`auth.ts signOut()` 呼叫 `resetPlayerName()` +
         `garage.ts resetWalletCache()`（內含金幣/鑽石/擁有清單/裝備車皮 + achievements/streak）。
      ③ 成就/streak 徹底搬 DB（不只是清快取，是把權威來源換掉）：新增
         `player_achievements`/`player_streak` 表，完賽時 `record_market_finish()` RPC 伺服器
         自己重算當期 TAIEX 漲跌（不信任前端傳的 mood）累加 bull/bear finish；進每日排名賽時
         `consume_attempt()` RPC 順便更新 streak；**`wallet_unlock_achievement()` 改成伺服器自行
         驗證門檻**（v1 只信任客戶端宣稱「達標了」就給，這正是 tommyisboy08 誤解鎖的根本路徑，
         v2 這支 RPC 現在會自己查 player_achievements/player_streak 是否真的達標，不管客戶端
         傳什麼都無法騙到）；`wallet_dev_grant()` 一併灌好開發者測試帳號的成就/streak，取代
         舊版前端 `devSetProgress()`/`devForceStreak()` 純本地寫死。
      typecheck 過，preview 驗證訪客路徑（首頁/車庫/每日挑戰頁）無回歸、零 console error。
      **⚠️ 已登入路徑（暱稱同步/成就解鎖/streak/開發者帳號灌值）preview 無法測（需真實
      Google OAuth），需使用者真機/桌機用兩個帳號交叉驗證：A 帳號改暱稱→登出→B 帳號登入
      暱稱應顯示 B 自己的、不會看到 A 的殘留；A/B 互換都不會看到對方的 Q 車款解鎖進度。**
      **✅ migration_20260706.sql 已確認跑過**（見上方批次 1 開頭 2026-07-06 驗證結果）。
      **這裡指的一次性清零 SQL（僅金幣/鑽石/車庫/成就，因 tommyisboy08 污染事件而起）是否已跑
      仍未確認**——待確認是否已執行過，或直接等批次 8 正式上架當天的全面清零一次做掉即可
      （批次 8 範圍更大，含排行榜+經典成績，2026-07-06 使用者已補充確認）。

## 批次 2 — 其他資安收尾（2026-07-06 盤點：可 code 處理的項目已確認完成）

- [x] `taiexrider-release.jks` 雲端備份——**使用者已連續確認一週完成，本清單先前重複列成待辦是
      文件沒同步更新，2026-07-06 更正**。之後不再列入待辦。
- [x] `daily_scores`/`classic_records`/`daily_map`/`keep_alive` 的 RLS SELECT policy 補
      `to anon, authenticated`——**查證後發現這件事其實早在 `migration_20260702.sql`
      就已經做過**（policy 改名 `read scores`/`read classic`/`read daily_map`/`read keepalive`，
      四張表 policy 皆含 `to anon, authenticated`），而該份 migration 已於 2026-07-02 確認執行過
      （2026-07-06 用 REST API 打 `events`/`user_profiles` 驗證存在）。本清單這一項是舊的
      SECURITY_REVIEW.md 建議與後續 migration 重複記錄，2026-07-06 確認後結案，不需要新 migration。
- [x] Play Console 上架前目視確認：手機截圖用新版地形（v0.12.x）重截、資料安全性表單補
      「App 互動資料（匿名遊玩統計）」聲明（見 [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md)）。
      **使用者已處理完成（2026-07-07 確認）**。
- [ ] dev 依賴 esbuild/vite 2 個已知漏洞升級（需 vite@8 breaking change，只影響本機
      `npm run dev`，非上架風險，**已決定排正式上架後**，本批次不動）。
- [ ] `daily_death_heatmap` RPC 效能：**已決定等正式上架玩家量上來再評估**，本批次不動
      （目前沒有效能問題可測，貿然加 materialized view 是過度工程）。

## 批次 3 — 反作弊 Phase B/C（工程量大，建議正式上架後）

- [ ] Phase B：DB 端同帳號提交頻率離群偵測。
- [ ] Phase C：完整操作事件序列驗證 + Ghost 回放（跟留存規劃的 Ghost 回放一起設計，見
      [ANTICHEAT_DESIGN.md](ANTICHEAT_DESIGN.md) 第四層）。

## 批次 4 — 車庫/商業化

- [x] **鑽石購買頁骨架 + Google Play Billing 串接** 已完成程式碼（2026-07-06，v0.12.31，
      使用者確認「網頁版不開放購買」，只做 Android TWA）。設計：前端走 **Digital Goods API**
      （TWA 專用的網頁層 Billing 介面）觸發 `PaymentRequest`（`https://play.google.com/billing`
      付款方式）→ 拿到 `purchase_token` → 呼叫新的 **Supabase Edge Function**
      `verify-iap-purchase`（`supabase/functions/verify-iap-purchase/index.ts`，這個專案第一次
      用 Edge Function，之前都是純 Postgres RPC）→ 用服務帳號向 **Google Play Developer API**
      驗證這筆付款是真的 → 驗證通過才用 service role 呼叫 `grant_iap_diamonds()` RPC 發鑽石
      （`supabase/migration_20260706c.sql`：新增 `iap_purchases` 表防重放 + RPC 只給
      service_role 呼叫，前端無法直接騙鑽石）。前端 `src/lib/billing.ts` + `Garage.tsx`
      新增「💰 購買鑽石」區塊（`isBillingAvailable()` 偵測不到就整塊不顯示，網頁版/一般瀏覽器
      看不到，也不影響任何現有功能）。SKU 暫定：`diamonds_100`(100 鑽)／`diamonds_350`
      (350 鑽)／`diamonds_1200`(1200 鑽)，實際定價由 Play Console 決定。

  **⚠️ 這是純程式碼骨架，離「真的能購買」還差好幾個外部手動設定，且缺一項就完全不會啟用
  （對現有封測玩家零影響，因為偵測不到就不顯示按鈕）：**
  1. [x] **Supabase SQL Editor 跑 `migration_20260706c.sql`**（`iap_purchases` 表 + RPC）
     ——2026-07-06 使用者確認已跑，REST API 驗證兩者皆存在（回 42501 permission denied）。
  2. [x] **Google Play Console 建立商品 ✅ 2026-07-06 全部完成**：路徑是「透過 Google Play
     營利 → 產品 → **單次產品**」（介面改版過，不是文件原本寫的「應用程式內產品」這個
     名稱）。四個 SKU 皆已建立、設好購買選項（`<sku>-default`）、批次定價（Set prices
     工具設 TWD 基準價，全球 173 個國家/地區自動換算）、上傳 Claude 生成的圖示（512×512
     PNG，四張視覺不同：鑽石小/中/大包 + 去廣告盾牌），狀態皆顯示「有效」：
     - `diamonds_100`（消耗型）→ NT$30
     - `diamonds_350`（消耗型）→ NT$90
     - `diamonds_1200`（消耗型）→ NT$270
     - `remove_ads_forever`（非消耗型/受管理商品）→ NT$69
     **Play Console 端設定至此全部完工**（剩下的真機測試見下方第 6 點）。
     **✅ 前置阻礙已全部解除**：
     - 商家帳戶（Payments profile）稅務資訊✅已核准（未登記稅籍個人）；付款方式（電匯至
       合作金庫帳戶 ••••7662，戶名 TSAI,YUN-LUNG）✅ **2026-07-06 已收到 Google Payments
       通知「您的銀行帳戶已通過驗證」**，審查完成。
     - Android 原生 Billing 橋接（見下面第 5 點）✅ 已完成，vc11 AAB ✅ 已上傳並審核通過上線。
     - **理論上「單次產品」頁面現在應該已解鎖**，待使用者回去確認並實際建立四個 SKU
       （見上方定價表）——這是批次 4 剩下唯一還沒打勾的步驟。
  3. [x] **Google Cloud 服務帳號 + Play Console 授權，皆已完成**：✅ 已啟用 Google Play
     Android Developer API；已建立服務帳號並下載 JSON 金鑰，帳號 email：
     **`taiexrider-iap-verify-237@tokyo-dispatch-426713-t8.iam.gserviceaccount.com`**
     （另有一個重複建立、從未生過金鑰的 `taiexrider-iap-verify@...`（無 -237 後綴）——
     **仍待使用者手動去 Google Cloud 清理掉**，避免之後搞混，不影響功能）。
     ✅ **2026-07-06 已在 Play Console「使用者和權限」建立「IAP 驗證服務帳號」權限群組**
     （應用程式存取權：查看應用程式資訊(唯讀) + 查看財務資料 + 管理訂單和訂閱項目，
     範圍限定 TAIEX RIDER），並邀請這個服務帳號 email 加入群組，狀態顯示「有效」——
     Google API 403 的權限問題已解決。
  4. [x] **部署 Edge Function 已完成**（2026-07-06，Claude 直接操作）：JSON 金鑰內容取出
     `client_email`/`private_key` 寫進**專案資料夾外**的暫存檔（scratchpad，非 repo），
     用使用者提供的 Supabase 個人存取權杖（用完即建議撤銷）跑
     `supabase link --project-ref cjnwwtrpveejhbwalncy` → `supabase secrets set --env-file`
     → `supabase functions deploy verify-iap-purchase`，皆成功。已用 curl 打實際部署好的
     function URL 驗證：未帶真實使用者 session 時正確回 `{"ok":false,"error":"not authenticated"}`，
     代表程式碼邏輯真的在雲端跑，不是空殼。暫存 secrets 檔已刪除，**JSON 金鑰原始檔仍在使用者
     `Downloads` 資料夾，建議之後自行移到 repo 以外的安全位置保管或刪除**。
  5. **🔴 最容易漏掉的一步——Android 原生專案本身要改**：Digital Goods API 光靠網頁端程式碼
     不會生效，TWA 的 Android 專案要加 androidbrowserhelper 的 Play Billing 橋接（依賴 +
     manifest 設定），這是原生層改動，套用「android/ push 無效」規則——要在 Android Studio
     加好、**versionCode +1**、重新 Generate Signed Bundle、上傳 Play Console 新版本才會生效。
     **在這之前，就算前 4 步都做完，現有封測 APK 一樣偵測不到 Digital Goods API，購買區塊
     不會出現，完全不影響目前的封測**。
     **⚠️ 2026-07-06 發現：這一步的順序比預期更早卡關**——使用者實際點進 Play Console
     「透過 Google Play 營利 → 產品 → 單次產品」（這就是我們要建鑽石 SKU 的地方，路徑跟
     文件內原本寫的「應用程式內產品」不同，介面改版過），畫面直接顯示「應用程式目前沒有
     一次性產品，如要新增一次性產品，請為 APK 新增 BILLING 權限」——**代表 Play Console
     連「建立商品目錄」這一步都會擋，不是只擋「實際購買流程」**。所以正確順序是：
     Android 原生加 `com.android.vending.BILLING` 權限 + Billing 橋接 → 上傳新 AAB →
     Google 處理過新版本後 → 才能建立單次產品（步驟 2 要排在這之後，不是原本以為的
     可以先做）。
     **✅ 2026-07-06 已在 repo 的 `android/` 資料夾內完成兩處程式碼改動**（Claude 直接查證
     [dl.google.com/dl/android/maven2](https://dl.google.com/dl/android/maven2) 官方 Maven repo
     確認版本號，不是用猜的）：
     - `android/app/build.gradle.kts` 新增 `implementation("com.google.androidbrowserhelper:billing:1.1.0")`
       （查證這是目前 Google 官方發布的最新穩定版）。
     - `android/app/src/main/AndroidManifest.xml` 新增 `<uses-permission android:name="com.android.vending.BILLING" />`。
     **✅ 2026-07-06 全部完成**：Claude 直接把改動同步進使用者的 Android Studio 專案
     （`C:\Users\tyl16\AndroidStudioProjects\TaiexRider`）並實際跑 `./gradlew :app:processDebugManifest`
     + `./gradlew :app:assembleDebug` 驗證——merged manifest 確認 billing 函式庫**自動合併**
     了自己需要的所有元件（Billing Library 7.1.1、`ProxyBillingActivity`/`ProxyBillingActivityV2`、
     Android 11+ 套件可見性 `<queries>`），完全沒有手動額外宣告的必要，`assembleDebug`
     `BUILD SUCCESSFUL`。versionCode 10→11／versionName "1.10"→"1.11"（repo `android/` 與
     AS 專案已同步）。使用者已 Generate Signed Bundle 上傳封閉測試軌道，**2026-07-06
     確認 AAB 審核通過，vc11 已正式上線**。
  6. 全部完成後才建議真機測試一次完整購買流程（測試卡付款，Play Console 有測試身分機制）。

  **✅ 2026-07-09 這個狀態已結束**：AdMob 獎勵廣告原生橋接已完成並真機驗證通過（見
  CLAUDE.md「2026-07-09」系列段落 + DEVDOC.md §9.4c），遊戲現在有真廣告了，
  `remove_ads_forever` 買了確實有實際效益（跳過復活/雙倍金幣/車庫拿金幣的廣告觸點）。
  這條記錄保留當歷史脈絡，不再是「已知暫時狀態」。

- [x] **永久去除廣告 IAP 骨架** 已完成（2026-07-06，v0.12.32）。使用者要求範圍：復活、
      每日拿金幣、每日排名賽後 3 次挑戰，「任何會出現廣告的地方」購買後全部跳過。
      設計：非消耗型商品（買一次終身有效），跟鑽石消耗型不同，Google 端要呼叫
      `:acknowledge` 而不是 `:consume`（`consume` 會讓非消耗型商品變成可重複購買）。
      - `supabase/migration_20260706d.sql`：`player_wallet` 加 `ads_removed` 欄位，新增
        `grant_remove_ads()` RPC（只給 service_role），`wallet_get()` 一併回傳。
      - `verify-iap-purchase` Edge Function 依 SKU 類型分流（鑽石→consume，去廣告→acknowledge）。
      - `src/lib/billing.ts` 新增 `REMOVE_ADS_SKU`("remove_ads_forever") + `purchaseRemoveAds()`，
        `fetchPackPrices()` 改通用化（可查任意 SKU 清單，不只鑽石）。
      - `garage.ts` 新增 `getAdsRemoved()`/`markAdsRemoved()`，`syncWalletFromServer()`/
        `resetWalletCache()` 一併處理。
      - 三個廣告觸點依 `ads_removed` 調整：`GameCanvas.tsx` 復活按鈕（已購買時標籤從
        「看廣告復活」變「復活」，本來就沒有真的擋廣告，只改文字）＋ 結算畫面/`Garage.tsx`
        的「看廣告拿金幣」按鈕（已購買時整個隱藏，不是變免費，因為整組「看廣告拿獎勵」
        機制的存在前提就是有廣告）＋ `DailyChallenge.tsx` 第 3~5 次挑戰（已購買時 `showAd`
        永遠 false，一律顯示「開始挑戰」不顯示「看廣告開始」，5 次額度不變）。
      - `Garage.tsx` 版面同時調整：「💰 購買鑽石」搬到頁面最底部（原本夾在成就車款跟
        鑽石車款中間）、新增「🚫 永久去除廣告」區塊接在購買鑽石後面、「🎯 任務解鎖車款」
        改名「🎯 成就車款」。
      **✅ `migration_20260706d.sql` 已跑**；Play Console 的 `remove_ads_forever` SKU
      也已跟其他三個鑽石 SKU 一起建立完成（見上面鑽石購買那條）。preview 驗證：訪客路徑零 console error，手動模擬
      `localStorage.tr_ads_removed=1` 確認「看廣告拿金幣」按鈕正確隱藏。

- [x] P3~P5 三台鑽石車款生圖 + 登記進 `wallet_spend_skin` 白名單，已完成上線（2026-07-07，
      見 CLAUDE.md 待辦第 2 項）。**這份清單先前沒同步勾掉，2026-07-09 核對 `garage.ts`
      `BIKE_SKINS` 與 `migration_20260707b/c.sql` 白名單後確認 5 台鑽石車款皆已完整上線，補勾**。
- [x] 廣告真實串接（AdMob Rewarded）已完成（2026-07-09），取代原本直接發幣的 stub。
      詳見 CLAUDE.md「2026-07-09」系列段落 + DEVDOC.md §9.4c。AdSense（網頁 Interstitial）
      仍暫緩，見 CLAUDE.md 廣告雙軌架構段落。

## 批次 5 — 留存規劃第二批（2026-07-06 動工，四項全數完成，見 [RETENTION_PLAN.md](RETENTION_PLAN.md)）

- [x] **狂暴盤日事件** 已完成（v0.12.29 已推，`supabase/migration_20260706b.sql`）。門檻取
      2.5%（用 TAIEX 近 2 年 482 交易日實測資料校準：2% 出現機率 14.9%／約每週一次太常見，
      2.5% 出現機率 10.0%／約兩週一次，使用者拍板）。首頁公告「⚡ 狂暴盤：今日任務獎勵 ×2」，
      伺服器端 `wallet_earn('quest')`/`claim_weekly_quest()` 各自呼叫共用的
      `taiex_change_pct()` 重算當期漲跌決定是否加倍，不信任前端。
      **⚠️ 真機驗證：待實際遇到一次 |漲跌|≥2.5% 的交易日才能驗證**（2026-07-06 當天盤勢
      未達門檻，門檻設計上約兩週才會出現一次，無法立即測試，非 bug）。
- [x] **股票圖鑑** 已完成（v0.12.29 已推）+ **✅ 2026-07-06 真機驗證正常**：換裝置登入
      收集清單有正確保留（伺服器端 `player_collection` 生效）。`player_collection` 表（每人
      一列存已收集代號陣列，天生封頂在股票池總數 ~1090，不隨玩家數爆炸，永久不清除）+
      `collect_stock()` RPC，`wallet_get()` 一併帶回收集清單（沿用既有同步呼叫點）。
      App.tsx 完賽/摔車時依 `track.kind==='stock'` 收集（長征模式一次收 5 支）。規則確認：
      跟哪天盤勢無關，同一支重複玩不重複計。**車庫頁原本顯示的「📖 圖鑑 N / 總數 支已收集」
      小字，2026-07-07 晚間已移除**（跟首頁圖鑑按鈕功能重複，且分母概念跟首頁不同容易讓
      玩家困惑，見下方批次 5b 之後、CLAUDE.md 當天的記錄）。
- [x] **週任務** 已完成（v0.12.29 已推）。`player_weekly_quest` 表（每人每週一列，仿
      `wallet_earn_log` 保留最近 8 週即清除）+ `record_weekly_run()`/`claim_weekly_quest()`/
      `get_weekly_quest()` RPC，任務池仿每日任務放大成週尺度（翻轉 30 圈／完美 10 次／
      單局 2000 分／10 場遊戲／撐 25 秒，3 選其一 seeded），每日排名賽頁面新增「🗓️ 本週任務」
      卡片（跟每日任務並列不衝突）。**✅ 2026-07-06 真機驗證正常運作**。
- [x] **經典模式前三名** 已完成（v0.12.29 已推）+ **✅ 2026-07-06 真機驗證運作正確**，取代
      原本的「Top N + 百分位排名」規劃——使用者 2026-07-06 拍板簡化：不算百分位、不需要存
      全部玩家成績，只留每關前 3 名，同玩家用更新覆蓋不佔位。`classic_records` 主鍵改
      `(level_id, player_id)`，`submit_classic_record()` 提交後裁剪到前 3 名，表大小恆定＝
      關卡數 × 3（目前 12 關＝36 列上限），不隨玩家數增長。`ClassicSelect.tsx` 卡片顯示 🥇🥈🥉。
      ~~經典模式週榜~~：**使用者 2026-07-07 決定取消**，更完整的賽季式競爭感留給批次 6 的週聯賽分組。
- [x] ~~歷史紀念日彩蛋~~：**使用者 2026-07-06 決定不做**——效益不大，且慶祝日期（如金融
      海嘯週年）沒辦法涵蓋全年，不再列入待辦。

## 批次 5b — 股票圖鑑升級成完整彈窗（2026-07-06/07 討論後動工，v0.12.30 已推）

批次 5 的圖鑑原本只在車庫頁顯示一行「N / 總數」文字，使用者討論後決定升級成完整瀏覽視窗：

- [x] 首頁新增「📖 圖鑑」按鈕，跟「收藏車庫」同一行並排（省垂直空間）。
- [x] 點開彈窗（`src/components/Encyclopedia.tsx`）：兩欄卡片網格、依代號排序（↑↓可切換）、
      篩選未收集/已收集/全部三種檢視，已收集卡片打星星（⭐）標記。
- [x] **絕版制拍板**：圖鑑分母不隨「目前上市中股票數」即時增減（那樣下市會讓總數莫名變少，
      體感很怪），改成「只要出現過就永久留在圖鑑裡，下市股票標記絕版但不會消失，分母只增不減」
      （類似寶可夢圖鑑思路）。
- [x] 新增 `stock_registry` 永久登記表（`supabase/migration_20260707.sql`）：`stock_code` 為主鍵，
      記錄 `first_seen`/`last_seen`/`delisted`。任何人可讀（不需登入即可瀏覽圖鑑）。
- [x] `scripts/fetchDailyMap.ts` 新增 `upsertStockRegistry()`：腳本本來就會每天抓 TWSE 官方
      上市清單來決定要抓哪些股票的盤中資料，這次順手把同一份清單 upsert 進登記表（不用另外
      重複打一次 TWSE API）。同時呼叫 `mark_delisted_stocks()` RPC，用同一份清單比對出誰下市了
      ——**含安全防呆**：若當次抓到的清單長度 <500（代表 TWSE 抓取失敗/不完整），RPC 會直接
      不執行標記，避免把全部股票誤判成下市。
- [x] `collection.ts` 新增 `fetchStockRegistry()`：公開讀取（不需登入），走原生 fetch 直接打
      PostgREST（同 `dailyMap.ts` 慣例，不透過 supabase-js 避免已登入時角色跑掉）。

**✅ `migration_20260707.sql` 已跑（2026-07-07 使用者確認）**——用 anon key 直接打 REST API
驗證：`stock_registry` 表可讀（回傳 `[]`，0 筆，`Content-Range: */0`）、`mark_delisted_stocks`
RPC 存在（回 `42501 permission denied` 而非「找不到函式」，符合預期——這支只給 service_role
呼叫）。**還要等下一次 `fetchDailyMap.ts` 排程執行過一次**（每天台灣 16:00），登記表才會真正
填入股票資料，圖鑑才會顯示清單（目前仍是空的，這是正常過渡狀態，不是壞掉）。preview 已驗證
訪客路徑（開圖鑑/排序/篩選）零 console error，已登入路徑（星星標記是否對應到真的收集清單）
待使用者真機驗證。

**migration_20260706b.sql 已跑**（圖鑑換裝置/經典前三名皆已真機驗證運作正常，代表伺服器端
schema 已生效）。**剩餘待驗證**：狂暴盤加倍（等實際遇到 ≥2.5% 交易日）；週任務已於
2026-07-06 真機驗證正常。

## 批次 6 — 留存規劃第三批（長期，工程量大）

- [ ] 週聯賽分組（30 人小組升降級，等 DAU 有規模才有意義）——**使用者確認這是之後想要的
      「更完整聯賽系統」**，取代已取消的經典週榜/好友邀請比較。
- [ ] Ghost 鬼影賽跑（跟反作弊 Phase C 一起做）。
- [x] ~~排行榜 emoji 反應~~：**使用者 2026-07-09 決定取消**，用不到，不再規劃。
- [x] ~~好友邀請比較~~：**使用者 2026-07-07 決定取消**，不再規劃。
- [ ] 月更節奏公告。~~週五馬拉松~~：**使用者 2026-07-07 認為概念了無新意，決定取消**。

## 批次 7 — 明確延後但要記住的項目

- [x] ~~Web Push 通知~~：**使用者 2026-07-07 決定取消**——判斷「想玩的玩家會自己來玩」，
      推播通知對自己而言效果有限（收到遊戲推播也不太會點進去），且需另外申請 Firebase/FCM
      專案、工程量不小，投報率不划算，不再規劃。
- [ ] 殼版本更新提示（設計見 DEVDOC §9.5b，方案 A 成本不高）。**使用者 2026-07-07 更新決定**：
      不特地為此單獨重包一次 AAB，**改成「下次不管什麼原因需要重包 AAB 時，順便把這個一起做掉」**
      ——例如之後 P3~P5 鑽石車款若不需要動 android/（車皮是純網頁內容，git push 自動部署，
      不用重包），就不會觸發；但如果之後又有原生層改動（例如廣告 AdMob SDK 串接，通常需要動
      android/），屆時記得把殼版本更新提示一起包進同一次重包。
- [ ] 網頁版偷玩對策（`taiexrider.pages.dev` 公開網址技術上封不掉，MVP 不值得做，已接受現實）。
- [x] **ETF 代號納入每日地圖** 已完成（2026-07-06，`scripts/fetchDailyMap.ts`）。實際拉
      TWSE STOCK_DAY_ALL 真實資料驗證，發現範圍比原本預期的「00981A 這類」大很多：
      1368 支上市證券裡有 278 支（~20%）不是純 4 位數字——ETF 代號有 4/5/6 位數
      （0050/00878/006208），槓桿反向 ETF 有 K/L/R/T/U 字母尾，多幣別計價 ETF 有
      A~I 字母尾，舊版 `/^\d{4}$/` 把這 278 支全部濾掉了，不只是漏了 A 尾。改成
      `/^\d{4,6}[A-Z]?$/`，驗證後 1368 支只剩 1 支例外（特別股代號「2887Z1」，數字+
      字母+數字的罕見格式，不特別處理）。**下次 16:00 排程執行後生效**，屆時每日地圖/
      自選賽道/隨機拉霸/股票圖鑑的股票池會一次多出這 278 支。

## 批次 8 — 正式上架當天才動手

- [x] **清空 SQL 已寫好備用**（2026-07-09）：[supabase/prelaunch_cleanup.sql](supabase/prelaunch_cleanup.sql)。
      範圍＝`daily_scores`/`classic_records`/`events`/`daily_diamond_settlement`/
      `classic_diamond_settlement` 五表；`daily_map`/`stock_registry`（遊戲資料）、
      `player_wallet`（金幣鑽石）、`user_profiles`（帳號）、`iap_purchases`（金流憑證）
      明確不動；`wallet_earn_log`/`wallet_daily_attempts`/`player_weekly_quest` 本來就有
      滾動清理排程不需手動清；`player_achievements`/`player_streak`/`player_collection`
      這次使用者沒點名要清，維持不動。詳見 CLAUDE.md 待辦第 9 項。
- [ ] **執行清空 SQL**——**尚未執行**，由使用者自行決定時機（上架前/上架當天皆可），
      不會自動觸發（2026-07-04 使用者交代，2026-07-09 補充：SQL 已準備好，隨時可跑，
      不用等到正式上架審核通過那天才臨時弄）。

---

## 已明確決定不做的（避免誤判成漏做）

- BETA #4 前翻/煞車鈕操控——2026-07-04 使用者已決定取消，見 [BETA_FEEDBACK.md](BETA_FEEDBACK.md) #4。

---

## 📦 已封存文件：FABLE5_HANDOFF.md（2026-07-02 交接單，全部完成並上線）

# Fable 5 交接任務清單（2026-07-02）

> **2026-07-04 狀態盤點**：本檔清單裡 debug（#1/#2）、監控、內容改善（BETA #1/#3）、原生體驗、拉霸音效、OG/分享、留存規劃（含車庫系統）、android/ 三項、上架前置檢查、ASO 文案**全部已完成並上線**（進度細節見 [CLAUDE.md](CLAUDE.md)「目前進度」）。**唯一還沒動工的是「反作弊」**（見下方章節）——這是目前分派給 Fable 5 的唯一剩餘項目，資安漏洞檢查章節的初版報告已交（見 [SECURITY_REVIEW.md](SECURITY_REVIEW.md)），待辦彙整仍有 2 項使用者動作待確認。

> 這禮拜由 Fable 5 主責處理 TaiexRider。開工前務必先讀 [CLAUDE.md](CLAUDE.md) 開發守則第 1~4 條（沒說動工不動 code、動 code 必同步文件+push、跨機器一律 `git pull` 起手）與「目前進度」封測倒數狀態。
>
> 本檔是這次交接的完整任務briefing，整合了：Sonnet 這次討論給的建議 + 使用者本人的具體意見。執行時按「優先順序」段落排序，不要整個禮拜卡在單一項目上。

---

## ⏱️ 時間安排

沒有嚴格時間上限——使用者中午離開約 1 小時，但回來後 session 可以繼續做，不用為了趕在 1 小時內做完而硬砍範圍或求快。按下方「建議優先順序」由上到下依序處理即可，一項做完（typecheck/build 過、必要時 push）再進下一項，不要為了塞更多項目同時開好幾個半成品。

真的要注意時間的只有一件事：**如果做到一半使用者還沒回來、需要真人配合測試或做決策的項目卡住了**（例如 Debug #1 需要重現「應觸發卻沒觸發」的案例、原生體驗中需碰 `android/` 的項目做完想確認真機效果），先把能獨立完成的部分做完、清楚記錄卡在哪裡等使用者回來，不要空等。

---

## 🐛 Debug

### 1. 完美落地判定有時不觸發（使用者實測回報，優先）

**現象**：雙輪明顯同時著地（不管平面還是斜坡），有時候完全沒觸發完美落地特效與加分。

**相關程式碼**：`src/game/GameCanvas.tsx` 的 `step()` 函式，約 496-563 行。

- 落地判定：`groundedNow && !wasGrounded`（528 行）——**單一 physics step 邊緣觸發**，只判斷「這一步」與「上一步」的差異。
- 完美落地條件（540-545 行）：`realAir`（滯空時間 > `minAirSec=0.3s`）＋ `Math.abs(airRotation) > Math.PI * 1.7` ＋ `levelOk`（車身角度與坡面夾角 < `perfectLevelRad=0.55` rad ≈ 31°）。
- 離地瞬間（558-560 行）：把角速度歸零，消除爬坡貼坡帶上來的殘留旋轉。
- 著地瞬間（556 行）：`airRotation` 歸零，準備累積下一輪空中旋轉。

**懷疑根因（未證實，交接給 Fable 5 驗證，不要照抄修）**：
落地瞬間輪子有微幅彈跳（`restitution=0.05`），可能導致 `rearContacts`/`frontContacts` 在相鄰 1~2 個 physics step 內出現「著地→短暫離地→再著地」。第一次接觸就會觸發一次「落地事件」，把 `airRotation` 歸零；緊接著的短暫離地又會觸發 558-560 行的角速度歸零；等到真正穩定著地、再次判定為「落地」時，`airRotation` 已經被前一次假觸發清空，導致真正該計分的這次落地量測到的旋轉量趨近 0，永遠過不了 1.7π 門檻——即使玩家視覺上「明顯完成翻轉且雙輪同時落地」。

**建議驗證方式**：在 `step()` 加 debug log（每次 grounded/airborne 狀態切換 + 當下 `airRotation`/`rearContacts`/`frontContacts` 逐步印出），重現幾次「應該觸發卻沒觸發」的案例，確認是否真的是「連續多次 grounded↔airborne 切換」造成，而不是其他原因（例如 `levelOk` 角度算法本身有誤差）。

**建議修法方向（驗證後再定）**：落地判定改成需要連續 N 個 step 都維持 grounded 才算「真正落地」（debounce/hysteresis），取代單 frame 邊緣觸發；或著地瞬間的微幅彈跳不清零 `airRotation`，只有離地超過一定時間/高度才視為新一輪起跳。

---

### 2. 摩托車偶發卡進地形夾縫（低頻但玩家規模大會常態發生）

**現況**：[History.md](History.md) 記錄 v0.3.7 / v0.4.1 / v0.4.2 都嘗試過根治這類 bug（梯形底部重疊、chassis 改 `collisionFilter mask:0` 只讓輪子碰地），每次都寫「已根治」，但實際仍偶發。目前現象：卡住後放開手指會被彈出來（非死局），但一人玩十次遇到一次，一萬人玩就會常態發生，影響體驗評價。

**使用者明確要求**：不要再依賴人工或測試者「剛好玩到」才發現觸發條件，太慢。希望做**自動化模擬測試**主動找出觸發條件。

**建議做法**：
- 現有 `GameCanvas.tsx` 內 `import.meta.env.DEV` 下已有 `window.__test` 手動步進鉤子（step/press/release/reset/state）——可以此為基礎，另外寫一支**headless 批次模擬腳本**（不經瀏覽器 canvas，直接跑 Matter.js engine + 既有地形建構邏輯 `terrain.ts` / `buildTerrainBodies`）。
- 對大量隨機股價種子 × 大量隨機輸入序列（按住/放開的 pattern）跑數千～數萬次模擬，每次記錄是否出現「雙輪離地 + 速度趨近 0 且持續超過閾值秒數」事件（即現有 `stuckMidAir` 判定邏輯，`GameCanvas.tsx` 586 行），並記下發生當下的地形局部幾何（相鄰頂點座標、坡度變化量、轉折角）與車速。
- 目標：整理出一份「容易卡住的地形特徵」清單（例如：坡度變化量超過某閾值、連續同向多段轉折），才能對症下藥，而不是每次都是憑感覺的一次性補丁。
- 也可以順便量化「發生機率」（模擬次數 / 卡住次數），驗證修復後是否真的降到可接受範圍，而不是「感覺好像比較少了」的主觀判斷。

---

## 📊 監控 / 資料回饋迴路（目前完全空白，需從零設計）

**現況**：整個專案沒有任何 analytics 或 crash reporting。上線後完全不知道玩家在哪流失、哪個模式沒人玩、平均存活時間多長、卡地形 bug 實際發生頻率——現在完全只能靠少數測試者的主觀回饋，太慢也不全面。

**需求**：設計一套輕量事件追蹤，至少涵蓋：
- 開局（哪個模式：每日排名賽/隨機拉霸/自選賽道/經典模式/長征）
- 死亡原因與位置（`tippedOver` / `stuckMidAir` / `topHit`，可直接沿用現有死亡判定分支順便打點）
- 完賽（分數、用時、翻轉次數、完美落地次數）
- 各模式選擇分佈
- 次日留存（可搭配現有 `playerId` / Supabase 帳號體系概略估算）

**限制**：bundle 大小已是已知痛點（Matter.js 偏大導致首 paint 慢，詳見 History.md 中 TWA splash 空窗那段）。避免引入笨重的第三方 analytics SDK。優先評估：Supabase 直接開一張 `events` table + 一支輕量 fire-and-forget 上報函式；或 Cloudflare 自帶 Web Analytics 作為零成本 baseline（頁面級，不夠細但先求有）。

這是「早該做」的基礎建設——上線前先有雛形，上線後才有數據決定下一步該優化什麼，而不是繼續只靠 12 個測試者的主觀回饋猜。

---

## 🔒 反作弊（現況：純前端可偽造分數，尚無防範）

**現況**：History.md 記錄「純前端可偽造分數，經典模式是永久榜風險較大，使用者決定先上、被刷再處理，RPC 只做範圍驗證」。每日排名賽 `submit_daily_score`、經典模式 `submit_classic_record` 兩支 RPC 皆同樣風險。

**限制條件**：專案沒有獨立後端伺服器，只有 Supabase（Postgres + RPC）+ 純前端靜態頁，任何防範機制都只能在這個架構內做。

**需求**：設計比「範圍驗證」更完善的防作弊機制，方向供評估（非定案）：
- RPC 端做「合理性檢查」：分數/時間/翻轉次數之間的比例是否符合物理可能性（例如時間太短但分數太高直接拒絕）。
- 加入速率限制（同一帳號短時間內大量提交視為異常）。
- 統計離群值偵測：定期掃描分數紀錄，標記明顯偏離同賽道/同模式其他玩家分布的分數，供人工複查或自動降權（不刪除，但不擠上榜首）。
- 評估是否收集簡化版「操作事件時間序列雜湊」隨分數一併送出，RPC 做基本一致性比對（非完整 replay，成本太高不必做到那麼細）。

不影響上架申請本身，但這禮拜有餘裕，值得先把設計定案，之後找時間實作。

---

## 🔐 資安漏洞檢查（全面性，不預先限定範圍）

這次不要只挑幾個點檢查，**針對整個專案（前端 + Supabase 後端 RLS/RPC + GitHub Actions/CI 密鑰處理 + Android/TWA 相關設定）獨立做一次完整的資安漏洞評估**，找出任何潛在風險，不要被下面這段「已知現況」框住範圍——那只是這次討論中順便查到、還沒排進實作的東西，不代表已經窮盡。

**已查過、目前確認乾淨的部分（供參考，避免重工，但仍建議自行複查一次而不是照單全收）**：
- 環境變數處理：`VITE_SUPABASE_ANON_KEY` 是設計上公開的沒問題；真正敏感的 `SUPABASE_SERVICE_ROLE_KEY` 只存在 GitHub Actions secrets，只被 `scripts/fetchDailyMap.ts`（CI 端腳本）使用，從未進前端 bundle。
- RLS：`supabase/schema.sql` 所有表都開了 row level security，寫入路徑全部收斂到 `security definer` RPC（`submit_daily_score`／`submit_classic_record`），沒有表直接開放 anon/authenticated 寫入。
- 身份無法偽造：`player_id` 由伺服器端 `auth.uid()` 決定，未登入呼叫會被靜默拒絕。
- 前端零 `dangerouslySetInnerHTML`，暱稱顯示走 React 預設轉義，沒發現 XSS 注入路徑。

**已知但還沒排進實作的具體缺口**：
- `submit_daily_score`／`submit_classic_record` 目前只做各欄位獨立的範圍驗證（例如分數 0~50000），沒有驗證分數/時間/翻轉次數彼此之間是否物理上合理（見上方「反作弊」段落）。
- 兩支 RPC 都沒有速率限制，已登入帳號可以短時間內狂打。
- Android 簽署 keystore（`taiexrider-release.jks`）目前只在特定電腦上，遺失就無法再用同一身分更新 app——這是金鑰管理風險而非程式碼漏洞，但影響範圍極大，值得一併確認備份狀態。
- 相依套件（`matter-js`、`@supabase/supabase-js`、`idb` 等）沒跑過 `npm audit` 之類的已知漏洞掃描。

除了上面這些，請重新完整評估一次，涵蓋但不限於：前端有沒有任何地方信任了不該信任的使用者輸入、Supabase RLS policy 有沒有遺漏的邊界情況、GitHub Actions workflow 本身有沒有 secret 洩漏風險（例如 log 裡印出敏感值）、TWA/assetlinks 設定有沒有被冒用網域的風險。找到問題直接記錄清楚（哪個檔案、什麼情境會被利用），嚴重的當場評估要不要順手修，不確定該不該動的先記錄下來等使用者決定。

---

## 🎮 內容改善 / 新點子 / 創意

已有真人測試者回饋，完整分類與優先級在 [BETA_FEEDBACK.md](BETA_FEEDBACK.md)。這禮拜建議從高優先項目開始：

| 優先 | 項目 |
|------|------|
| 高 | #3 每日排名賽地圖選取邏輯（漲跌停股地形太單調） |
| 高 | #1 依股票波動率動態調整地形高度（解決「正規化過度、太平緩」） |
| 中 | #4 前翻操控（煞車鈕） |
| 中 | #2 多車型 sprite |
| 低 | #6 IAP 購買系統（需 Phase 4 後端） |

**創意/新點子**：開放發揮，沒有既定方向的部分可以自由提案新模式、新機制、新的每日/每週挑戰形式等——唯一限制是不能破壞現有排行榜公平性、不能動搖已上線功能的穩定度（封測期間求穩優先）。

---

## 🎯 遊戲模式與長期留存設計規劃（使用者強調：這是需要認真分析思考的一塊，不是隨手加功能）

**使用者觀察到的核心問題**：現有 5 種模式（每日排名賽／隨機拉霸／自選賽道／經典模式／長征）裡，**只有每日排名賽有讓人「每天都想回來玩」的動力**，其餘模式試過一輪之後就沒有繼續玩下去的理由。經典模式雖然有紀錄保持者機制，但使用者擔心**內容固化 + 容易被單一玩家永久霸榜**，導致其他人覺得「反正打不贏就不玩了」。

**先分析「為什麼每日排名賽有效、其他模式沒有」，再談怎麼修**，不要跳過診斷直接開藥方：

### 為什麼每日排名賽留得住人
1. **內容每天真的不一樣**（跟當日真實大盤/個股連動）——玩家有「今天特別扯」「今天特別平淡」這種新鮮感，不是重複同一份內容。
2. **競爭會重置**——排行榜是「今天」這一期，昨天輸給誰、贏過誰都翻頁，每個人每天都拿到一次全新的起跑線，不需要跟一個可能永遠打不贏的歷史最高分競爭。
3. **有稀缺性**——每日 5 次上限（`challengeAttempts.ts`）製造「今天的機會用完了，明天再來」的懸念，而不是可以無限重試到滿意為止。

### 為什麼其他模式留不住人（診斷）
- **自選賽道／長征**：內容雖然多（~1000 支股票、每日長征組合），但**沒有跟其他玩家比較的機制**，也沒有「重複回訪」的理由——玩家探索過幾條賽道後，新鮮感消失就沒有誘因回來，屬於「內容量大但缺乏社交/競爭鉤子」的問題。
- **隨機拉霸**：拉霸本身的隨機開獎有短期新鮮感（有點像賭博的變動獎勵機制），但選到的賽道跟自選賽道一樣沒有比較機制，開完獎之後跟自選賽道是同一個問題。
- **經典模式（使用者具體點名的問題）**：固定地形 = 適合永久排行榜這個設計方向本身沒錯，但目前「單一保持者」（v0.11.0 只留分數最高一人，見 History.md）的設計，代表**只要有一個人拿到接近極限的分數，這個關卡對所有後來者就等於「宣告死亡」**——沒有重置機制、沒有分層目標，打不贏就沒有繼續嘗試的理由，長期只會讓少數高手霸榜、多數人碰過一次就不再回來。這跟每日排名賽「每天重置」正好是相反的設計。

### 使用者要求覆蓋兩種心態：競爭比較心態 + 看戲吃瓜心態

**競爭比較心態（好勝/比較驅動）方向**：
- **經典模式改成排行榜而非單一保持者**：從「只留 #1」改成 Top N（跟每日排名賽同一套 UI 邏輯即可重用），並加上**百分位回饋**（例如「超越了 78% 玩家」），讓打不進前幾名的人依然有「我進步了」的正回饋，而不是只有「贏」或「輸」兩種結果。
- **經典模式加週期性重置的子榜**：例如「本週最佳」跟永久紀錄並存，永久榜留給真正的高手朝聖，週榜給一般玩家一個「這週有機會」的短期目標，緩解霸榜帶來的無力感。
- **自己跟自己比**：不管哪個模式，都可以強化「個人最佳」的呈現（例如結算畫面明顯標出「打破你的個人紀錄！」），這是最低成本的競爭感來源，不需要看別人分數就有進步的感覺，對不想跟陌生人比較的玩家也有效。
- **好友/熟人向比較**（成本較高，可放長期規劃）：全球排行榜對大部分人來說「反正打不贏前幾名」動力有限，但「贏過認識的人」黏著度通常高很多——可以評估分享成績連結時順便標記「邀請朋友來比」的機制，不用馬上做，先列入規劃視野。

**看戲吃瓜心態（旁觀/娛樂驅動，使用者特別點名要覆蓋這塊）**：
- **死亡精華/名場面**：目前撞車已經有完整的爆炸特效與鏡頭震動，可以評估錄製或至少截取死亡瞬間畫面，做成「今日最扯死法」這種側榜——分數以外的第二條賽道，讓「玩得不好但摔得很好笑」的人也有舞台，而不是只有頂尖分數的人被看見。這跟前面「曝光度/分享」段落提到的「跟當日真實盤勢連動的哏」是同一個方向，可以合併思考。
- **Ghost/回放對戰**：如果經典模式或每日排名賽能記錄頂尖分數的操作序列（不需要完整 replay 引擎，簡化成關鍵事件時間序列也可以），讓其他玩家「觀戰」或「跟保持者的鬼影賽跑」，把一個冷冰冰的數字變成可以看、可以追的內容——這同時也呼應前面反作弊段落提過的「操作事件時間序列」構想，兩邊可以共用同一套資料設計，一份工投兩用。
- **輕量社交回饋**（不需要留言系統這種重工程）：排行榜條目加一個極簡的 emoji 反應功能，讓不想競爭但想互動的人也有參與方式。

**非競爭型的長期投入鉤子（第三個方向，使用者沒明講但邏輯上該補齊）**：
不是所有玩家都吃競爭或吃瓜，有些人單純需要「持續玩下去會累積什麼」的理由：
- **每日/連續登入的輕量獎勵**（連續 N 天給造型解鎖之類，呼應 BETA_FEEDBACK #2 車型多樣化），直接針對使用者說的「一般模式試過就不玩」——給一個跟「今天有沒有玩」掛鉤但不需要跟別人比較的理由。
- **終身累積成就**（總翻轉次數、總里程、造訪過幾支股票賽道），這類數字型成就對完成主義型玩家特別有效，且跨所有模式都能累積，等於把「探索型」的自選賽道/長征也綁進留存機制裡，而不是讓它們獨立於整套留存設計之外。

**這段是規劃方向，不是實作規格**——具體要做哪幾項、優先順序如何，留給使用者看過方向後決定；Fable 5 可以在這個框架內繼續發想延伸，但不要自己直接動手實作大改（尤其經典模式排行榜改版牽動 schema/RPC，屬於前面「反作弊」等級的變更，需要使用者確認方向才動）。

---

## 📱 原生體驗優化（讓玩家感覺不到這是 PWA/TWA）

目標：讓遊戲盡量像原生 Android app，不要露出「這其實是網頁包出來的」痕跡。已查過現況：assetlinks 驗證、全螢幕沉浸式、TWA splash 背景色+淡出、`user-select:none`/`touch-action:none`、`safe-area-inset` 都已到位。以下是具體缺口，**每項都要標明是否需要碰 `android/` 原生專案**——這點很關鍵：

> ⚠️ **部署差異提醒**：這個專案是 PWA 包 TWA，`src/`、`index.html`、`public/` 底下的改動 push 到 main 就會透過 GitHub Actions 自動部署到 `taiexrider.pages.dev`，TWA 跑的就是這個網址，**改完立刻生效，不需要使用者做任何事**。但 `android/` 資料夾內的原生專案改動（AndroidManifest.xml、themes.xml、drawable 資源等）**push 不會有任何效果**——這些改動要生效，使用者必須手動在 Android Studio 重新 build signed AAB、`versionCode +1`、上傳到 Play Console，這是本專案過去每次動 `android/` 都會發生的固定流程（見 History.md 多次記錄）。**標記 ❌ 的項目做完 code 後，一定要在交接紀錄裡明確提醒使用者「這項需要重新包 AAB 才會生效」，不要讓使用者以為 push 完就結束了。**

1. ✅ **震動回饋（`navigator.vibrate`）—— 純 PWA 端，push 即生效**
   目前全專案沒有任何震動呼叫。加在：撞車瞬間（短促強震）、完美落地（一組節奏感的雙震）、按鈕點擊（極短單震）。可以放進 `src/game/audio.ts` 旁邊或新建 `haptics.ts`，跟現有 `playCrash()`/`playPerfectLanding()` 等呼叫點綁在一起（`GameCanvas.tsx` 內對應位置）。注意部分瀏覽器/裝置不支援 `navigator.vibrate`，要做 feature detection，不能讓不支援的裝置噴錯誤。

2. ✅ **`overscroll-behavior: none` —— 純 PWA 端，push 即生效**
   全站 CSS 目前完全沒有這個屬性。選單頁面（賽道清單、排行榜）過度捲動時會出現瀏覽器原生的橡皮筋回彈/下拉刷新手勢，是最容易穿幫的地方。建議加在 `src/index.css` 的 `html, body` 全域規則。

3. ✅ **Matter.js 延遲載入，改善冷啟動 —— 純 PWA 端，push 即生效**
   目前 bundle 偏大、首次繪製慢（已知痛點，History.md 有記錄）。評估把 `matter-js` 改成動態 `import()`，只在進入遊戲畫面（`GameCanvas` mount）才載入，首頁/選單畫面能更快進入可互動狀態，不用等整包物理引擎載完。**做完務必跑一次 `npm run build` 確認 bundle 有正確拆分、typecheck 過、且遊戲本身不受影響（有真的測試進出遊戲畫面）。**

4. ❌ **App 捷徑（長按主畫面圖示跳快速選單）—— 需確認是否要碰 `android/`**
   原生 app 常見的長按圖示快速選單（例如「每日排名賽」「隨機拉霸」）。先查證這個專案的 TWA 建置方式（`androidbrowserhelper`，非 Bubblewrap）是否能直接讀取 PWA `manifest.webmanifest` 的 `shortcuts` 欄位動態生效，還是需要在 `android/` 內另外設定並重新包 AAB 才會出現。**這項如果查證起來會花超過 10-15 分鐘，直接跳過、留給下次 session，不要卡在查證上耗掉寶貴的 1 小時。**

5. ❌ **Splash 加品牌 icon（目前只有純色背景）—— 需要碰 `android/`，需要重新包 AAB**
   現有 `SPLASH_SCREEN_BACKGROUND_COLOR`/`SPLASH_SCREEN_FADE_OUT_DURATION` 已設定（`android/app/src/main/AndroidManifest.xml`），但沒有 `SPLASH_SCREEN_ICON_DRAWABLE` 之類的品牌圖資源。這項一定要重新包 AAB 才生效，且需要一張適合的 icon/logo 圖片素材（目前有沒有現成的裁切好的版本要先確認，沒有的話這項也先跳過）。

6. ❌ **Android 13+ 預測性返回手勢支援（`enableOnBackInvokedCallback`）—— 需要碰 `android/`，需要重新包 AAB**
   `AndroidManifest.xml` 的 `<application>` 標籤加 `android:enableOnBackInvokedCallback="true"`，並確認 `targetSdkVersion` ≥ 33。加了之後系統手勢會有預覽動畫，但要注意這跟現有自訂返回鍵確認彈窗（popstate 攔截邏輯）會不會互相打架，**這項改動後強烈建議真機測試，不要只憑 typecheck 過就當作完成**。

**次要／有餘力再做**：Web Push 通知（每日挑戰提醒）——網頁結構上做得到但一般網站少做，能進一步強化「這是 app」的錯覺，也對留存有幫助，工程量較大，排在最後面。

---

## 🎰 拉霸機轉動音效（新增，使用者具體要求）

**需求**：`src/screens/RandomSlot.tsx` 的拉霸機轉動時目前完全靜音，使用者要求加上「咖咖咖」的機械滾輪音效，**越接近真實吃角子老虎機越好**。

**現況程式碼**：`spin()` 函式（`RandomSlot.tsx` 55 行起）用 `requestAnimationFrame` 驅動捲軸位移，`targetIndex`/`D`/`v` 算出總位移與初速，有明確的加速/減速兩階段（`T1`、`T2`，先等速捲動再減速停到 `winner`）、`ITEM_H` 是每個項目的高度。

**建議做法**：
- 沿用專案既有的音效模式——`src/game/audio.ts` 全部是 Web Audio API **純程式合成**，沒有外部音檔（`playFlip`/`playCrash`/`playFinish` 皆是範例），這個「咖」聲也建議用程式合成（短促的方波/噪音 click，接近機械棘輪聲），不要另外引入音檔資源增加 bundle 大小。
- 在 `spin()` 的 rAF 迴圈裡，每當捲動位移跨過一個 `ITEM_H` 整數倍（即「換下一格」的瞬間）就觸發一次 tick 音效，而不是固定時間間隔——這樣音效節奏會自然跟著現有的 T1（等速）快、T2（減速）慢的曲線走，聽起來才會像真的老虎機「唰唰唰...咖...咖.....咖」逐漸變慢停下，而不是機械式等間隔的嗶嗶聲。
- 最後停止時（`winner` 落定瞬間）可以加一個比 tick 更明顯的「哐」收尾音效，強化「停止」的手感。
- 記得接進現有音量控制系統（`getVolume()`/`setVolume()`），不要獨立於現有音量開關之外。

---

## 📣 曝光度 / 觸及率技術準備

**現況**：`index.html` 只有 `<title>TaiexRider</title>`，完全沒有 `<meta description>`、Open Graph、Twitter Card 標籤；程式碼裡也沒有任何分享功能（`navigator.share` 未使用過）。這兩項是實打實的技術缺口，直接影響上架後的觸及率。

- **SEO/社群分享預覽**：補上 `og:title` / `og:description` / `og:image` + Twitter Card + 一張分享用的預覽圖。現在如果有人把 `taiexrider.pages.dev` 貼到 Facebook/LINE/Threads，會是空白預覽，點擊率天生就低。
- **App 內分享成績**：完賽/死亡結算畫面加「分享成績」按鈕（`navigator.share`，桌機/不支援的瀏覽器 fallback 成複製文字或連結）。文案建議做成跟當日真實股市連動的哏（例如「今天大盤這樣震盪，我在 TaiexRider 摔了 N 次」），比單純「分享分數」更容易被轉發——這也是這款遊戲相較一般小遊戲的天然優勢（跟當天真實盤勢綁定，內容每天都不一樣）。
- **ASO 文案草稿**：Play Store 標題、簡短說明、完整說明的關鍵字優化文案，先起草 2~3 個版本供使用者挑選定案。

**範圍提醒**：以上是技術/內容準備工作，交給 Fable 5 沒問題。但實際到 PTT 股板／Dcard 理財版／Facebook 投資社團等社群發文、互動、抓盤勢時機發文——這是需要使用者本人身分與臨場判斷的事，AI 生成貼文在這類社群容易被認出、效果反而差，**不在本次交接範圍內**，使用者要自己持續做。

---

## 📱 上架前置檢查（時間敏感，7/8 倒數一到就要能馬上申請）

確認 Store Listing 所有項目（主題圖、截圖、內容分級問卷、隱私權政策連結）仍然有效，不要卡在行政流程上而拖到 7/8 之後才申請正式版。

---

## 📄 文件重整（交給 Fable 5 執行）

**目標結構**：
- `DEVDOC.md`：維持現狀，純架構/模組/資料結構文件，不動。
- `History.md`（新檔案）：把 `CLAUDE.md` 目前所有「🔖 交接（日期 ...）」歷史記錄區塊整段搬過去，依時間新到舊排列，內容原封不動搬遷（不用摘要精簡，保留完整脈絡，未來查舊決策時還用得到）。
- `CLAUDE.md`：搬完歷史記錄後只留：開發守則、技術棧速查、部署架構、每日地圖資料管線（這段雖然寫法像記錄，但內容是「現況必守規則」而非純歷史，要留在 CLAUDE.md）、目前進度（封測倒數狀態）、待辦（含本檔任務 + BETA_FEEDBACK 待辦）、踩雷筆記（時區/物理/測試，同樣是「現況規則」留下）。開頭補一行連結指到 `History.md`，供需要查舊決策脈絡時查閱。

這樣往後 CLAUDE.md 一眼就能看到「現在要幹嘛」，不用往下滑幾百行找重點。

---

## 建議優先順序

1. Debug #2（卡地形，先做重現＋量化，不急著下手改）
2. Debug #1（完美落地判定，先加 log 驗證假說；重現案例需要真人配合的部分可能要等使用者回來）
3. 資安漏洞檢查（全面性，時間點放前面是因為越早發現嚴重問題、影響範圍越可控）
4. 監控/資料回饋迴路（雛形即可，上線前要有）
5. 內容改善高優先兩項（BETA_FEEDBACK #3 #1）
6. 原生體驗優化中「純 PWA 端」3 項（震動/overscroll/延遲載入）+ 拉霸機音效
7. 曝光度技術準備（OG tags + 分享成績按鈕，上架時就該就緒，別等上架後才補）
8. 反作弊設計（先定案，實作可以晚一點）
9. 遊戲模式與長期留存設計規劃（產出方向文件/提案即可，不用直接大改 schema）
10. 原生體驗優化中「需碰 android/」3 項（App 捷徑/splash icon/預測性返回）——集中一次做，做完提醒使用者要重新包 AAB
11. 文件重整（隨時可穿插做，不佔額外整塊時間）
12. 上架前置檢查（順手確認，不用整塊時間）
13. ASO 文案草稿（跟上架前置檢查一起順手做）

新點子/創意沒有時間壓力，隨時可以穿插發想，不佔用上面順序。全部做完才是目標，不用刻意分批留給「下次」。

---

## 📦 已封存文件：BETA_FEEDBACK.md（2026-06-23，v0.11.x 封測意見彙整，全部處理完成）

# TaiexRider 封測意見彙整

> 版本：v0.11.x　封測期：2026-06
> 來源：首批封閉測試用戶（Android TWA）

---

## 原始意見（逐條）

| # | 意見原文 | 分類 |
|---|---------|------|
| 1 | 正規化太嚴重導致賽道不夠刺激，過於平緩 | 遊戲性 / 地形 |
| 2 | 希望車子的造型種類多一些 | 內容 / 自訂 |
| 3 | 每日排行榜地圖的選取邏輯？遇到漲停板/跌停板賽道會極短且單一無趣不崎嶇 | 遊戲性 / 地圖選取 |
| 4 | 希望不只有後翻，也能新增煞車鈕前翻滾 | 操控 / 技巧多樣性 |
| 5 | 整體運行流暢，但玩久容易單一無趣 | 遊戲性 / 長期留存 |
| 6 | 可增加購買系統，包括車子造型甚至車子特殊功能 | 商業模式 / 變現 |

---

## 分類分析

### 🎮 遊戲性與地形（#1 #3 #5）

**#1 正規化過度 → 賽道平緩**
- ✅ **已解決（v0.12.3）**：地形高度加「全日振幅」驅動分量（`ampRefPct=3.5%`，`src/game/constants.ts`），盤中賽道不再全壓在 `heightMin`；TAIEX 平緩盤不受影響。**⚠️ 地形變高手感已於 2026-07-03 真機驗證確認 OK**（見 CLAUDE.md）。

**#3 每日排行榜地圖選取邏輯**
- ✅ **已解決（選取公式 2026-06-23 上線，失格條件 v0.12.3 補上）**：選取標準已改「振幅×折返」複雜度公式（非純坡度總和）；另對當日資料點 <50 的股票（一字板等）難度打 1 折排除單調賽道。

**#5 玩久單一無趣**
- 現況：核心操控只有「單指後翻」一種技巧，長期重複感強。
- 關聯 #4（前翻）、#2/#6（車型/功能多樣性），見下方。

---

### 🏍️ 操控多樣性（#4）

**#4 增加前翻（煞車鈕）—— ❌ 2026-07-04 使用者決定不做，取消**
- 技術可行性：高（現有 `airSpinMax` / `airSpinAccel` 體系，反向套用即可；需新增第二個觸控區域）。
- 設計考量：
  - 前翻與後翻需要不同的計分、動畫方向。
  - 雙鍵操控增加學習曲線，需 UI 提示（前翻區 / 後翻區）。
  - 可先做成「選配」或「解鎖後功能」，不影響新手體驗。

---

### 🎨 車型與自訂（#2 #6）

**#2 車子造型多樣化**
- ✅ **已解決（2026-07-03，v0.12.16~24）**：升級成完整車庫收集系統（設計見 [GARAGE_DESIGN.md](GARAGE_DESIGN.md)），車皮與物理完全分離。B（基本款 2 台）+ Q（任務解鎖款 3 台）共 5 台已上線可裝備；P（付費款 5 台）待生圖+接 Billing。

**#6 購買系統（車型 + 特殊功能）**
- 這是商業模式建議，與原規劃（Phase IAP）方向一致，**車型 cosmetic 部分已定案分級**（2026-07-03 拍板）：
  - B（免費）／Q（成就解鎖，非金幣）已上線；P（付費款）＝真錢 IAP，非金幣購買，待 Google Play Billing 串接
  - 車子特殊功能（例：更快的翻滾加速、特殊得分倍率）→ **未規劃**，需平衡設計避免 Pay-to-Win 破壞排行榜公平性，目前車皮系統刻意維持「純外觀不影響手感」
  - 金幣（軟通貨）目前只用於車庫看廣告獎勵/未來收藏內容，不對應任何車皮購買

---

## 優先級建議（供後續規劃參考）

| 優先 | 項目 | 工時估計 | 備註 |
|------|------|---------|------|
| ~~高~~ | ~~#3 改善每日地圖選取邏輯~~ | — | ✅ 已完成（2026-06-23 選取公式 + v0.12.3 失格條件） |
| ~~高~~ | ~~#1 動態地形高度~~ | — | ✅ 已完成（v0.12.3，真機驗證 OK） |
| ~~中~~ | ~~#4 增加前翻操控~~ | — | ❌ 2026-07-04 使用者決定不做，取消 |
| ~~中~~ | ~~#2 多車型 sprite~~ | — | ✅ 已完成（v0.12.16~24，車庫系統 5 台上線） |
| 低 | #6 IAP 購買系統 | 大（後端 + Google Play Billing） | Phase 4+ 規劃，需後端 |
| 低 | #5 長期留存（系統性） | 大 | 依賴上方多項改善合力解決 |

---

## 可用於回答官方問題的標準說法

**Q：你們如何處理用戶反饋？**
A：透過封閉測試階段蒐集用戶意見，涵蓋遊戲性、操控、內容多樣性與商業模式等面向。反饋已分類並整合進開發路線圖，依影響範圍與實作成本排定優先順序。

**Q：用戶對遊戲的主要正面評價？**
A：整體運行流暢（#5 前半段）；核心操控（單指翻滾）直覺易上手。

**Q：用戶提出哪些改善方向？**
A：① 地形刺激度不足 ② 操控技巧多樣性 ③ 每日地圖選取邏輯 ④ 車型與外觀自訂 ⑤ 長期留存與變現系統。

---

*最後更新：2026-06-23*

---

### 🔖 交接（2026-06-23 v0.12.0 — 懸空計時 + 每日 5 次挑戰上限 + 死後原地復活）

**開工第一件事：`git pull`。**

> typecheck 通過，push 完成。**未真機試玩。**
>
> **#1 懸空公平計時（Suspended Start）**：每局（含復活後）車輛靜止懸空地面上方 `HOVER_HEIGHT=67px`（三個物理體 setStatic），HUD 計時凍結，畫面顯示脈動提示「碰觸即開始」。第一次 pointerdown 解除 static + 計時啟動。確保排行榜計時不受生成→落地動畫影響。
>   - ⚠️ 死亡條件（`tippedOver`、`stuckMidAir`）均加 `!waitingToStart` guard，避免靜態物體在懸空期被誤判死亡觸發爆炸。
>   - 檔案：`GameCanvas.tsx`（spawnY、setStatic、waitingToStart 旗標、計時守衛、死亡守衛）；`GameCanvas.css`（`.start-prompt` + `@keyframes startPulse`）。
>
> **#2 每日排名賽每日 5 次上限**：`src/lib/challengeAttempts.ts`，MAX 5 / FREE 2，localStorage key `tr_daily_att_{sessionDate}`。前 2 次按鈕「開始挑戰 (N/5)」、後 3 次「看廣告開始 (N/5)」（琥珀色鏤空），第 6 次「今日已達上限」（disabled）。進入遊戲才計次（非按下按鈕時）。`DailyChallenge.tsx` 在 `resolveSessionDate` 解析完後重新讀次數（連假 session key 對齊）。
>
> **#3 死後原地復活**：`GameCanvas` prop `revivalEnabled={isDailyRun}`（僅排名賽啟用）。死亡後出現「看廣告復活」琥珀色按鈕（`.overlay-btn.ad-btn`，每局限一次，`revivalUsed` state），點擊後 `doRevive()`：讀死亡 X 座標 → `terrainYAt` 算地形 → setPosition 三個 body 到死亡位置上方 HOVER_HEIGHT + setVelocity(0) + setStatic → 重進懸空等待。**分數、計時、翻轉紀錄全保留**（不呼叫 `doReset()`）。實作用獨立 `reviveSignal` ref，frame loop 偵測觸發（與 resetSignal 平行）。
>   - `gameKeyRef.current++` 於每次 `handleStartTrack`，GameCanvas `key={gameKeyRef.current}` 確保新局重建（`revivalUsed` 重置）。
>
> **#4 廣告雙軌偵測骨架（⚠️ 目前不顯示任何廣告）**：`src/lib/ads.ts`，TWA 偵測用 display-mode（`referrer` 在此 TWA 不可靠）。`isAndroid() && isStandaloneDisplay()` → "twa"，否則 "web"。不快取（TWA/Chrome 同機共用 localStorage 會誤判）。`ADSENSE_PUB_ID = ""`（Phase 1，不影響 Play 審查）。真機已確認：手機 TWA→App，瀏覽器→網頁。
>
> **🟠 廣告第二階段（正式上架後）**：
> - 填入真實 `ADSENSE_PUB_ID`（`ca-pub-8981745966447649`）→ 網頁版 AdSense 生效
> - 復活按鈕：先播廣告 → 廣告結束才 `requestRevive()`（目前直接復活）
> - Android 原生層串 AdMob Rewarded（TWA intent bridge）

---

### 🔖 交接（2026-06-20 v0.11.0 — 經典紀錄保持者 + 返回離開/ID限長/長征預覽）

**開工第一件事：`git pull`。**

> 一次做 4 項使用者優化（#1~#4）。typecheck + build 通過。**未真機試玩。**
>
> - **#1 經典模式紀錄保持者**：每個經典關卡固定地形 → 適合永久排行榜。**只留單一保持者**（分數高優先、同分時間短覆蓋），登入才算。
>   - **⚠️ Supabase 待手動執行**：`supabase/schema.sql` 新增 `classic_records` 表 + RPC `submit_classic_record`。**要進 Supabase SQL Editor 跑該段 `create table … / create or replace function …`**，否則提交無效。
>   - 前端：`src/lib/classicRecords.ts`（fetch 全部保持者 Map + submit RPC）；`classics.ts` 的 `classicToTrack` 帶 `classicId`；`TrackData` 加 `classicId?`；`App.tsx` `handleGameOver` 加經典分支（`trackRef.current.classicId` + 登入 → submit）；`ClassicSelect` 顯示每關保持者 + 未登入顯示 Google 登入。
>   - **作弊**：純前端可偽造分數，經典是永久榜風險較大，使用者決定「先上，被刷再處理」。RPC 只做範圍驗證。
> - **#2 返回離開改「再按一次返回鍵」**：移除「確定離開」按鈕（靠 `window.close()`，TWA 封鎖）。新流程：首頁返回 → 跳視窗（標題 `.leave-title` 加大加亮）「再按一次返回鍵即可離開」+ 只留「留下繼續玩」；視窗開著時**再按返回** → `App.tsx` popstate 的 `confirmLeaveRef` 分支耗盡 history（`history.go(-length)`）讓 TWA finish。`doLeave` 函式已移除。**需真機測 TWA 退出。**
> - **#3 暱稱限長**：`playerId.ts` 新增 `nameWidth`/`clampNameWidth`（全形=2、半形=1，上限 `NAME_MAX_WIDTH=12`）。`setPlayerName` 與 Home 暱稱 onChange 都套用；排行榜 `.rk-user`、經典 `.classic-record` 加 `nowrap+ellipsis` 防舊長名撐版。
> - **#4 長征 5 股預覽**：`longTrack.ts` 加 `fetchLongPreview()`（同 seeded picks，回每股 code/name/prices，fetchStockDailyMap 快取共用）；`TrackSelect` 長征 tab 按鈕下列 5 張 Sparkline（純呈現），超出由 `.select-screen` 捲動。
>
> **🟠 #5 待辦（提醒：下次有 Android Studio 環境時做）— 開啟 splash / 啟動閃網址列**：
> ⚠️ **更正**：使用者實測「閃一下瀏覽器網址列」**在 Play 封測安裝的正式 TWA 上也會發生**（不是 PWA 假象）。根因＝TWA 啟動空窗：系統圖示 splash →（交棒）→ Chrome Custom Tab 載入網頁，中間若沒被遮住，就看到 Custom Tab 的網址列，直到 ① Digital Asset Links 驗證完成 ② 網頁首次 paint（本專案 bundle 含 Matter.js 偏大、首 paint 慢，空窗更長）。修法：
> - **A（主解，需 AAB）**：Android 專案設 androidbrowserhelper splash — `SPLASH_SCREEN_BACKGROUND_COLOR=#05080f` + splash 圖 + fade 時間，splash 從啟動蓋到網頁 paint，把網址列空窗整個遮掉；另 Android 12+ `themes.xml` `windowSplashScreenBackground` 也設 `#05080f`。圖示本身系統強制，只能美化不能消。
> - **B（輔助，純前端）✅ 已做（v0.11.1）**：`index.html` 內嵌深色 + 霓虹標題 inline splash（`#boot-splash`，inline `<style>`，第一 byte 即 paint，bg `#05080f`）；`main.tsx` 雙 rAF + 1.5s 後備計時器淡出移除（`.hide` → opacity 0.35s → remove）。縮短白屏/載入空窗。**A 仍待做才能徹底蓋掉網址列。**
> - **C**：assetlinks 已用 Play 簽署金鑰修好；若僅「首次安裝後第一啟」閃屬 DAL 一次性驗證可接受，**每次**都閃才是 A 的空窗問題。
> - 最佳＝A+B 一起；要徹底消「網址列」核心仍是 A。

---

### 🔖 交接（2026-06-20 v0.10.1 — 長征 HUD 不蓋分數 + 文案微調）

**開工第一件事：`git pull`。**

> - **長征股號蓋住中央分數**：長征模式 HUD 頂線原本 `長征 + 5 股號(・串接)` 過長，換行後第 3、4 個股號落到 `.score-center`（top:8% 正中）橫帶 → 重疊。修法：`TrackSelect` 的 `handlePickLong` 把 5 股號從 `name` 移到 `subtitle`（`labels.join("\n")`），HUD 頂線只留「長征 5 股串接」；`.hud-sub` 加 `white-space: pre-line` 讓股號垂直堆疊在左欄、不碰中央分數。結算畫面 `.overlay-track-sub`（white-space normal）則把 `\n` 當空白自動換行。
> - **文案**：全站「前日盤勢／前日盤中」統一改「**前次盤勢／前次盤中**」（連假/休市顯示的不一定是前一日）。涵蓋 `DailyChallenge`、`TrackSelect`（tab 標籤 + track-desc + intraday desc）、`Home` 遊戲說明、`RandomSlot`（result desc + pool hint）。歷史 changelog 字串保留原樣。
> - typecheck 通過。

---

### 🔖 交接（2026-06-20 v0.10.0 — 新增第四模式「經典模式」）

**開工第一件事：`git pull`。**

> **新增經典模式**：歷史著名股市盤勢做成永久趣味關卡（靜態、不更新）。
> - **資料**：`scripts/fetchClassics.ts`（一次性）從 Yahoo 歷史**日線**（`period1/period2`、`interval=1d`）抓取 + 降採樣到 ~140 點，metadata（事件名/期間/說明）在腳本內手動策展，輸出靜態 `src/data/classics.json`（12 條）。⚠️ **跑完 commit JSON 就不用再動**；要新增事件改腳本候選清單再跑一次。**台股 1990 萬點崩盤抓不到**（Yahoo `^TWII` 日線只回溯到 ~1997），其餘台股/美股/日股 12 條全有。
> - **關卡（12）**：台股 2000網路泡沫・2008海嘯・2020 COVID深V・2022空頭・319槍擊・2024最大單日跌點；美股 1987黑色星期一・2000那斯達克・2008海嘯・2020 COVID・GME軋空；日股 1989泡沫頂。（GME 因股票分割，價格被還原成 ~$87 而非 $483，但地形形狀完整。）
> - **程式**：`src/data/classics.ts`（型別 + `classicToTrack()`，HUD subtitle = 期間・標的，mode 用 `monthly` 保留走勢圖切換）；`src/screens/ClassicSelect.tsx`(+css)（卡片含 Sparkline 預覽 + 事件說明）；`Home.tsx` 加第 4 顆按鈕（紫色 `.classic`）+ `Screen` 加 `"classic"`；`App.tsx` 加路由 + 傳 `subtitle`；`GameCanvas.tsx` 加 `subtitle?` prop → HUD（`.hud-sub`）與結算畫面（`.overlay-track-sub`）顯示期間/標的。
> - typecheck + build 通過（preview 隱藏分頁無法截圖驗證，console 無 error）。**未真機試玩**，下次真人玩確認 12 條地形手感 OK、HUD 文字不過長。

---

### 🔖 交接（2026-06-20 v0.9.4 — 連假掉回靜態盤 + 排行榜跨連假同榜修正）

**開工第一件事：`git pull`。**

> **核心原則（使用者定調）**：「**一律讀最後一次抓到的盤**」。休市/連假/颱風/過年不分長度，永遠顯示最後一個有開的交易日盤勢，且只在**凌晨 00:00** 換圖。機制 = `map_date = sessionDate+1`（內建午夜生效）＋讀取端 `max(map_date ≤ 今天)`。
>
> **本次修的 bug（連假第二天觸發）**：週四(6/18)是最後交易日，週五六日連假。週五正常顯示週四盤；**週六**卻掉回最原始的靜態 24 支測試盤、排行榜也跑掉、日期標籤也錯。
> - **根因**：`map_date = sessionDate+1` 只覆蓋 session 後一天；app 舊讀取邏輯只試「今天/明天」(`[dailyKey, nextDay]`)。週六日曆日 6/20 的視窗 `[6/20,6/21]` 完全錯過存在 `map_date=6/19` 的週四盤 → 查無 → fallback 靜態盤。排行榜同理：challenge key 用日曆日，週六換到空的 6/20 榜。
> - **修法一覽（本 session 全部 push 完成，唯 RPC 待手動跑）**：
>   1. **地圖讀取**：新增 `resolveSessionDate()`（`dailyMap.ts`）= daily_map 中 `map_date ≤ **今天**` 的 **max**（上界用「今天」非 nextDay，靠 `map_date=sessionDate+1` 內建午夜換圖；連假則 lte+desc 往回沿用最近一期）。三個 fetcher 改用它精準比對（不再 `[today,nextDay]` 迴圈）。
>   2. **排行榜同榜**：讀取/重整（`DailyChallenge`）、submit 清快取（`leaderboard.ts`）、App 預熱（`App.tsx`）全部改用 session key（= `max(map_date)`）。
>   3. **⚠️ RPC 待手動執行**：`supabase/schema.sql` 的 `submit_daily_score` 改 `v_today := coalesce((select max(map_date) from daily_map where map_date ≤ 台灣今天), 台灣日曆日)`。**push 不會更新 RPC，要進 Supabase SQL Editor 跑 `create or replace function submit_daily_score`** 才生效，否則寫入端仍用舊日曆日 → 連假成績仍掛錯 key。
>   4. **長連假不自刪**（`fetchDailyMap.ts`）：清理 cutoff 從「now − 7 天」改「剛寫入的 mapDate − 7 天」。否則過年/長颱風假 > 7 天時 cutoff 追過凍住的 map_date，剛 upsert 又被刪 → 掉回靜態盤。
>   5. **日期標籤錯位**：排名賽標題（`DailyChallenge`）、自選賽道圖池日期（`TrackSelect`）原本算「今天 − 1」，連假時 ≠ 實際盤勢日（週六 6/20−1=6/19，但盤是 6/18）。新增 `resolveSessionDisplayDate()`（= `resolveSessionDate − 1` = 實際交易日），兩處改用它。
>   6. **長征 HUD 重疊**：長征 `name` = 5 個股號串接過長，遊玩中橫向蓋住右上暫停/返回鈕。`.hud-corner` 加 `max-width` + `word-break` 自動換行（`GameCanvas.css`）。
> - typecheck 通過、版本 v0.9.4。詳見上方「每日地圖資料管線」段「app 讀取（連假安全 + 午夜換圖）」「排行榜對齊」「資料量不爆」。

---

### 🔖 交接（2026-06-19 — 連假回家：上架推進 + 一連串 UTC/時區 bug 修正）

**開工第一件事：`git pull`。**

> **本次完成（2026-06-19 深夜）**：
> - **Google Play 上架推進**：商店資訊 11 項全填完（類別＝賽車遊戲、廣告選「無」、目標年齡 18+、資料安全性＝收集名稱+使用者ID/OAuth、刪除帳號網址＝privacy 頁、聯絡 email）。AAB（version 5 / versionCode 5，公司已上傳含 TWA 全螢幕修正）有效，**不需重打包**（TWA 跑線上網頁，前端改動 push 即生效）。
> - **⚠️ 卡關：封閉測試門檻**。新開發者帳號要 **12 名測試者 + 連續測試 14 天**才能申請正式版。目前 1/12（自己帳號/家人不算，需真人 Android 用測試連結安裝、別退出）。連結＝封閉測試→「透過 Android 裝置加入測試」。14 天計時從第一人安裝起算，越早湊滿越好。
> - **Supabase migration 已執行**：`migration_user_profiles.sql`（改名同步排行榜生效）。
> - **遊戲內設定**：「音量（待實作）」→ 真音量滑桿（與首頁共用 localStorage key）；引擎聲音量調大（著地 0.11→0.32）。
> - **TWA 返回鍵/確認離開**：`leavingRef` 旗標讓 `doLeave` 後 popstate 不再重開視窗、history 自然耗盡 finish()。
> - **🐛 一連串 UTC/本地時區錯位 bug（同一類根因，已記入下方踩雷筆記）**：
>   - **daily_map 日期錯位**：`fetchDailyMap.ts` 原用「執行當下 +1」算 map_date，GitHub 排程延遲跨午夜就錯位+跳號（6/17 盤被存成 6/19）。改為**錨定 Yahoo 回傳的實際交易日 sessionDate**，map_date=sessionDate+1。TAIEX 也從 TWSE `MI_5MINS_INDEX`（runner 不穩）改 Yahoo `^TWII`。cron 21:05→16:00 TW。詳見「每日地圖資料管線」段。
>   - **排行榜成績錯位（同類）**：RPC `submit_daily_score` 原用 `current_date`（UTC），台灣午夜後成績被存到前一天 `challenge_date`，跟 app 讀的本地 `dailyKey()` 對不上 → 看似沒上榜（實際 204 成功有寫）。改 `(now() at time zone 'Asia/Taipei')::date`。前端 `leaderboard.ts` 提交後清快取也從 `toISOString()`(UTC) 改 `dailyKey()`。**schema 改完要手動在 Supabase SQL Editor 跑 `create or replace function`，push 不會自動更新 RPC。**

---

### 🔖 交接（2026-06-18 — TWA 全螢幕確認修復 + 準備正式上架）

**開工第一件事：`git pull`。**

> **今日全部完成項目**：
>
> **✅ TWA 問題全修**
> - **assetlinks.json**：改為 Google Play 簽署金鑰 SHA-256 → TWA 驗證通過，全螢幕無網址列。
> - **全螢幕 immersive（已確認手機生效）**：
>   - themes.xml：`DarkActionBar` → `NoActionBar` + windowFullscreen + 透明系統列
>   - AndroidManifest.xml：`DISPLAY_MODE=sticky-immersive`（⚠️ 正確值是 `sticky-immersive`，不是 `immersive-sticky`，字串顛倒 androidbrowserhelper 直接 fallback 到 DefaultMode）
>   - `MainActivity.kt`：新增自訂 Activity 繼承 LauncherActivity，`onCreate`/`onWindowFocusChanged` 直接設 `SYSTEM_UI_FLAG_IMMERSIVE_STICKY`（API<30）或 `WindowInsetsController`（API 30+）雙層保險。
> - **返回鍵 race condition**：`confirmLeaveRef.current` 在 `setConfirmLeave` 前同步更新，避免快速連按穿透。
> - **確認離開無效**：`window.close()` 在 TWA 被封鎖，改加 `history.go(-(length+5))` 耗盡 history。
>
> **✅ v0.9.3 功能**
> - 音量控制滑桿（master gain node，存 localStorage）
> - 首頁三按鈕文案更新，移除測試標記
> - 隱私權政策頁面（`taiexrider.pages.dev/privacy`）
> - ManageDataLauncherActivity 補宣告（修 2.7.1 閃退）
>
> **⚠️ 待家裡電腦完成（連假）**：
>
> **Android 最後一包 AAB（連假第一件事）**
> 1. 把 repo `android/` 內以下三個檔案複製到 Android Studio 專案：
>    - `app/src/main/java/com/tylapp/taiexrider/MainActivity.kt`（新建）
>    - `app/src/main/AndroidManifest.xml`（覆蓋）
>    - `app/src/main/res/values/themes.xml` + `values-night/themes.xml`（覆蓋）
> 2. `versionCode +1`，Generate Signed Bundle，上傳 Play Console
>
> **Play Store 商店資訊（還差）**
> - [ ] 主題圖片 1024×500（已用 Grok 生成，待上傳）
> - [ ] 手機截圖至少 2 張（開遊戲截圖上傳）
> - [ ] 內容分級問卷（Play Console → 政策 → 應用程式內容 → 內容分級）
> - [ ] 隱私權政策網址填入（`https://taiexrider.pages.dev/privacy`）
> - [ ] 類別選擇（遊戲 → 動作）
>
> **Supabase 待執行**
> - [x] `scripts/migration_user_profiles.sql` 已執行（2026-06-18，改名同步排行榜生效）
>
> **全部完成後**：Play Console 從「內部測試」升到「正式發布」→ 送審（通常 1-3 天）
>
> **Android Studio 同步提醒**：每次改 `android/` 後要手動複製到 `C:\Users\tyl16\AndroidStudioProjects\TaiexRider\`，`versionCode +1`，重新 Generate Signed Bundle 再上傳。
>
> **Google Play 現況**：
> - 帳號：Harold_Yun（tyl161803@gmail.com）
> - App：TAIEX RIDER（com.tylapp.taiexrider），內部測試軌道
> - Keystore：`C:\Users\tyl16\Documents\taiexrider-release.jks`（alias: taiexrider）⚠️ 僅在公司電腦，回家前複製到雲端硬碟
> - Google Play 簽署金鑰 SHA-256：`DB:F0:8B:8F:BA:71:10:51:92:DD:8F:83:B8:4D:92:91:85:34:B0:3E:5B:9B:2A:CA:92:E6:9E:9E:22:9F:57:DA`

---

### 🔖 交接（2026-06-18 v0.9.2 — PWA 自動更新 + 返回鍵三修 + 圖池日期/遊戲說明）

**開工第一件事：`git pull`。**

> **v0.9.2 本次完成（三個 PWA/TWA 體驗修正）**：
> - **#1 自動更新（不再需手動清快取）**：
>   - `vite.config.ts`：`registerType` 改 `"prompt"` + `injectRegister: null`；workbox 移除 `skipWaiting`/`clientsClaim`（prompt 模式需等待中的 SW 才能觸發 onNeedRefresh；skipWaiting 改由訊息觸發）。
>   - 新增 `src/pwa.ts`：用 `virtual:pwa-register` 手動註冊，每 60s `registration.update()` 主動檢查；偵測新版時 → 非遊玩中立即 `updateSW(true)`（skipWaiting + 自動 reload），**遊玩中先 defer**，待 `setPlaying(false)` 回首頁再套用。
>   - `main.tsx` import `./pwa`；`App.tsx` 進賽道 `setPlaying(true)`、離開 `setPlaying(false)`。
>   - 參考自家 SecureChat 的 controllerchange→reload 自動更新模式（virtual:pwa-register 內建處理）。
> - **#2 「確定離開」關不掉 App**：`App.tsx` `doLeave` 改 `window.close()`（正式 TWA/APK 才會結束 Activity；「加到主畫面」的安裝版 PWA 因瀏覽器限制可能無效＝測試環境正常現象，上架 TWA 不受影響）。移除原本永不重設的 `leavingRef`（會導致按確定離開後返回鍵失效→再按穿透關閉的 bug）。
> - **#3 子頁連按兩次返回直接關遊戲（race）+ 確認視窗返回鍵錯亂**：根因＝單一 listener + 純 state 切頁無真實 history 深度，且確認視窗開著時沒攔返回鍵。修法：① `handleNav` 進子頁 `pushState` 一層真 entry、`goHome` 改 `history.back()`；② popstate 只在「首頁→離開」邊界補推哨兵，「子頁→首頁」不補推；③ **確認視窗開著時按返回＝取消視窗並補推哨兵**（`confirmLeaveRef` 同步 state），不落到 E0 邊界被原生返回穿透。效果：模式連按兩次＝回首頁→跳確認；視窗開著按返回只會取消，要離開只能按「確定離開」。
> - **圖池日期顯示**：`TrackSelect.tsx` 前日盤勢/每日長征 tab 顯示對應股市日期（dailyKey 的前一天，格式 `m/d 走勢`）。
> - **遊戲說明**：`Home.tsx` 設定 modal 加「遊戲說明」按鈕（操作/計分/圖池更新規則/四種模式）。
>
> **⚠️ 待真機驗證**：三項都需 Android/TWA 真機測（preview 隱藏分頁無法測 popstate 與 SW 更新）。重點測：①部署後手機是否自動更新加快；②首頁確定離開能否關 App；③從三模式快速連按兩次返回是否會跳確認而非直接關閉。

---

### 🔖 交接（2026-06-18 — Phase 7 TWA 完成，等 Google Play 身分驗證）

**開工第一件事：`git pull`。**

> **今日進度（Phase 7 完成）**：
> - **Android TWA 專案**：手動在 Android Studio 建立（不用 Bubblewrap / PWABuilder），放在 `android/` 子資料夾，已進 repo。
>   - 使用 `androidbrowserhelper:2.7.1`，`LauncherActivity` 指向 `https://taiexrider.pages.dev`
>   - package ID：`com.tylapp.taiexrider`
> - **Keystore 已建立**：`C:\Users\tyl16\Documents\taiexrider-release.jks`（alias: `taiexrider`）
>   - ⚠️ **keystore 只在公司電腦**，回家要先把這個檔案複製到家裡電腦同路徑，否則無法 build release
>   - SHA-256：`83:FD:B6:0E:B0:B3:92:52:A4:34:0B:74:04:44:D2:5F:7F:30:07:62:43:8A:1E:01:4C:45:D1:E2:38:14:1B:4C`
> - **assetlinks.json**：`public/.well-known/assetlinks.json` 已部署，fingerprint 已是最新 keystore 的值
> - **Signed AAB**：已產出，位於 `C:\Users\tyl16\AndroidStudioProjects\TaiexRider\app\release\app-release.aab`
> - **Google Play 開發者帳號**：Harold_Yun（tyl161803@gmail.com），$25 已繳，身分驗證文件已送出等審核
>
> **🟠 等 Google 身分驗證通過（email 通知）後繼續**：
> 1. 進 Play Console → 建立應用程式
> 2. 上傳 `app-release.aab`
> 3. 填寫 store listing（說明、截圖、分類等）
> 4. 發布到正式軌道
>
> **⚠️ 注意事項**：
> - Node 24 兩台電腦都是，**不要用 Bubblewrap**（相容性問題）
> - PWABuilder 網頁版（pwabuilder.com）今天整天 queue 卡死，未來再試也可能不穩定，優先用手動 Android Studio 方案
> - JDK 查 fingerprint 要用 JDK 17（`C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot\bin\keytool.exe`），JDK 25 的 keytool 有 bug

### 🔖 交接（2026-06-17 v0.9.1 — 改名同步排行榜 + 每日長征 + v0.9.0 UI 大改）

**開工第一件事：`git pull`。**

> **v0.9.1 本次完成**：
> - **#1 改名同步排行榜（Method A）**：
>   - `scripts/migration_user_profiles.sql` — 需在 Supabase Dashboard SQL Editor 執行一次。建立 `user_profiles` table（RLS: 公開讀 / 只能 upsert 自己）及 `daily_scores_ranked` VIEW（COALESCE 取 user_profiles 最新暱稱覆蓋原快照名）。
>   - `src/lib/leaderboard.ts`：排行榜查詢改用 `daily_scores_ranked`（一字之差，其餘不變）。
>   - `src/lib/auth.ts`：新增 `updateProfileName(name)`，upsert 到 `user_profiles`。
>   - `src/screens/Home.tsx`：`handleSaveName` 呼叫 `updateProfileName`（fire-and-forget，不擋 UI）。
>   - **效果**：在設定視窗改暱稱後，過去所有成績在排行榜上立刻顯示新名稱。
>   - **⚠️ 待執行**：`scripts/migration_user_profiles.sql` 尚未在 Supabase 執行，目前改名仍無效。需進 Supabase Dashboard → SQL Editor → 貼上腳本 → Run。
> - **#9 每日長征**：
>   - `src/lib/longTrack.ts`：`fetchLongTrack(date)` — seeded LCG 從 `fetchDailyMapList` 全市場 pool 中選 5 支，各自 `fetchStockDailyMap` 取盤中走勢，正規化為開盤比值（開盤=1.0）後線性過渡串接（12pt connector），promise 快取同一天只打一次。
>   - `src/data/tracks.ts`：`TrackData.mode` 加 `"long"` union。
>   - `src/TrackSelect.tsx`：近月日線 tab 改為「每日長征」tab；搜尋/排序 toolbar 只在前日盤勢顯示；長征點擊後載入 → `onPick({ mode: "long", ... })`。
>   - `src/game/GameCanvas.tsx`：加 `hideMinimap?: boolean` prop；長征模式結算不顯示「走勢圖 →」切換（路線由多股組成，無單一走勢圖）。
>   - `src/App.tsx`：`hideMinimap={track.mode === "long"}` 傳入 GameCanvas。
>   - 自選賽道月線精選 24 支資料仍保留在 `tracks.ts`（RandomSlot 隨機 fallback 仍在用）。

> **v0.9.0 上次完成**：
> - 設定視窗大改版：暱稱確認鈕（字串有改才亮起）、登出移至底部加二次確認、版本號與更新日誌同排。
> - Phase 5 PWA 離線快取：每日地圖 StaleWhileRevalidate 24h，排行榜 NetworkFirst 5s timeout。
> - 夜景城市天際線背景（視差 0.12x，seeded 建築群無縫循環）。
> - HUD 左上顯示難度星等（★☆）。
> - 爆炸粒子強化：42 顆 + 雙速度層 + 品紅/紫色系。
> - 自選賽道排序按鈕加 ↑↓ 方向切換。
> - 排行榜時間顯示到毫秒（3 位小數）避免撞秒。

> **v0.8.0 本次完成**：
> - **Phase 6 音效（`src/game/audio.ts`）**：Web Audio API 純程式合成，不需外部音檔。5 個音效函式：`playFlip`（後空翻，sine 上揚）、`playPerfectLanding`（C5→E5→G5 琶音）、`playCrash`（白噪音爆炸聲）、`playFinish`（C4→E4→G4→C5 凱旋琶音）、引擎持續音（`startEngine/updateEngine/stopEngine`，鋸齒波動態調頻）。全部接入 `GameCanvas.tsx`。
> - **Android 返回鍵 race condition 根治**：History listener 集中至 `App.tsx` 單一 `useEffect([], [])`，消除子頁面 ↔ 首頁切換期間的 listener 空窗期。子頁的 `pushState/popstate` 全部移除（`DailyChallenge`、`RandomSlot`、`TrackSelect`、`Home`）。
> - **桌機 PWA 關視窗確認**：`beforeunload` listener 同在 App.tsx 單一 effect 中，關視窗時跳瀏覽器原生「離開網站？」確認框。
> - **排行榜重整鈕**：DailyChallenge 右上角 ↻ 按鈕，`invalidateDailyTop` 清快取後重抓。
> - **山峰頂點卡車 bug 修正**：`buildTerrainBodies` 偵測峰頂（左右鄰點都比當前頂點低），峰頂端點不加 `topExtra`，消除小突起牆。

> **v0.7.2 上次完成**：
> - **自選賽道 串 Supabase**：清單從 `daily_map` 動態讀取（~1000 支），前日盤中走勢 tab 不再侷限內建 24 支；無限捲動（每次多顯示 30 筆，`IntersectionObserver` sentinel）。
> - **隨機拉霸 串 Supabase**：pool 從 `fetchDailyMapList` 取得，每次轉動 30 格（29 隨機 + 1 得獎），不再只抽 24 支。
> - **nextDay UTC fix**：`nextDay()` 改用 `Date.UTC()` 純整數運算，修正 UTC+8 時區下 +1 天算出同一天的 bug（導致自選/隨機一直讀到空資料 fallback 24 支）。
> - **首頁返回鍵 fix**：`doLeave` 從 `history.go(-2)` 改 `go(-1)`，修正確定離開後仍留在頁面 + 返回鍵永久失效。
> - **Service Worker skipWaiting**：`vite.config.ts` 加 `skipWaiting: true` + `clientsClaim: true`，新版部署後重整一次即生效，不需關所有分頁。

> **v0.7.1 上次完成**：
> - **Google One Tap 登入**：`signInWithGoogle()` 改用 One Tap（hashedNonce = SHA-256 hex → GSI；rawNonce base64 → Supabase）；GSI 封鎖時 fallback redirect。首次登入自動帶入 Google 顯示名稱。
> - **DailyChallenge 排名賽頁**：未登入顯示 Google 登入按鈕；已登入顯示「以 [暱稱] 參賽」；⚙ 可改暱稱或登出。
> - **OAuth redirect 返回誤彈修正**：`Home.tsx` popstate 加 `isOAuthReturn` 偵測，壓制 OAuth 返回後第一次 popstate。
> - **每日地圖全台股**：GitHub Actions 每日 21:05（台灣時間）抓全台上市股（~1000 支）存 `daily_map`，難度最高者為當日排名賽地圖。
> - **排行榜快取**：Promise 快取零等待；提交成績後自動清除當日快取。

> **🟠 下一步選項**：
> - Phase 5：PWA 離線快取（Service Worker + IndexedDB）
> - Phase 6 視覺打磨（音效已完成 v0.8.0）：粒子特效優化、霓虹光暈、難度分級 UI
> - Phase 7：TWA 包裝 + Google Play 上架
> - 未來：ETF 含字母代號（00981A 等）納入每日地圖（filter 從 `/^\d{4}$/` 改 `/^\d{4}[A-Z]?$/` 即可）

---

### 🔖 交接（2026-06-16 v0.4.2 — 填滿地形 + discussion 14 點處理）

**開工第一件事：`git pull`。**

> **真機試玩回饋（已修，v0.4.1 + v0.4.2）**：使用者真機確認「整體非常像 Rider、流暢、K 棒風格 OK、返回邏輯正確」。修掉的 bug：
> - **卡 K 棒縫隙（高處落下偶發）**＝Matter.js internal-edge 卡頓。**兩段式修法**：
>   - **v0.4.1**：梯形**底部兩角各外擴 `overlap=segmentWidth`**（上窄下寬），相鄰梯形接縫正下方重疊成實心聯集 → 消除外露垂直內部邊。node 實測峰/谷 union 頂面與折線誤差=0，手感視覺不變。（大幅降低但仍極低機率殘留）
>   - **v0.4.2（root fix）**：`bike.ts` chassis 改 `collisionFilter:{ group, mask:0 }` → **車身完全不碰地、只由雙輪碰地**（Hill Climb 標準）。少了會在接縫頂點被夾的 chassis 碰撞體即根治。填滿地形無縫，故車身不碰地不會穿落。**注意**：`chassisContacts` 現恆 0（不影響著地判定，用前後輪）。
> - **首頁標題與排行榜/設定鈕重疊** → `.select-screen` padding-top 3.8rem；**遊戲內暫停鈕與返回鈕重疊** → `.pause-btn` top 3.4rem。
> - #7 決策：只做 robots.txt 不索引＋不宣傳網址；認 Play 包 Token 留到最後期。#8 資安僅記錄，以後處理。

> **本次大改（v0.4.0）**：依使用者整理的 `discussion.md`（14 點）一次處理。核心＝**地形碰撞體從「旋轉矩形沿法線偏移」改為「實心填滿梯形」**（使用者提案，視覺 A = K 棒柱）。

**v0.4.0 已完成（對應 discussion 編號）：**
- **#2/#4/#12 地形填滿（根治隱形牆／卡轉折）**：`buildTerrainBodies` 改成每段一個 `Bodies.fromVertices` 凸梯形——上緣=折線、兩側垂直、下緣拉到 `maxY+800`。相鄰梯形共用垂直邊 → 零縫、零凸角、頂面=折線本身。已用 node 實測 `fromVertices(Vertices.centre,...)` 世界頂點與輸入完全吻合（單一凸 part）。舊「矩形法線偏移」造成的頂點翹角＝隱形牆，已消除。**注意**：`buildTerrainBodies(track)` 不再吃 thickness 參數。
- **視覺 A**：`drawTrack` 每段填成 K 棒柱（漲紅/跌綠/平青，頂部實往下淡出）＝所見即所撞。若覺得醜可改 B（只留頂線）/C（漸層），fill 顏色在 `constants.ts` COLOR.fillUp/Down/Flat*。
- **#3 線段顏色**：`terrain.ts` 改用**最終頂點 y 方向**上色（dy<0=紅/dy>0=綠/平=青），不再用原始 price（夾平後會與視覺坡向不符）。
- **#1 死亡門檻**：新增 `RULES.crashTipCos=0`，crashZone 只在車身**翻過 90°**（cos<0）才啟動，與 `uprightCosThreshold`(0.55，後空翻計分用)分離。爬陡坡前傾不再被戳死。
- **#5 分數不倒退**：新增 `maxDistScore`，行進分只增不減（向後滑不扣回）。
- **#9 完賽顯示**：新增 `totalFlips`/`perfectLandings`，結算畫面顯示「翻轉 N 圈・完美落地 N 次」。
- **#11 首頁設定鈕**：右上版本號 → ⚙ 設定 modal（音量待實作＋版本＋更新日誌入口）。
- **#13 暫停＋返回確認**：遊戲右上「返回主選單」下方加暫停/繼續鈕（彈窗/暫停時凍結物理＋計時）；遊玩中按返回→確認彈窗；**裝置返回鍵**（popstate）：遊戲中→確認離開賽道、首頁→確認離開 App（leavingRef + `history.go(-2)`）。
- **#14 排行榜佔位**：首頁左上 🏆 排行榜鈕 → 「敬請期待」modal。

> **⚠️ 待真機驗證**：#13 裝置返回鍵（popstate 攔截）桌機 build/typecheck 過，但 **Android/TWA 實體返回鍵需真機測**。preview 隱藏分頁 rAF 暫停，無法驗證遊玩；用 `window.__test` 手動步進或真人可見分頁玩。
> **🟠 仍待討論（見對話末）**：#7 網頁版偷玩、#8 資安、#10 每日挑戰+廣告+IAP → 已記錄於「未來規劃」。另 chassis `mask=0`（只讓輪子碰地）為填滿方案的**備援保險**，本次未做（先看填滿是否已足夠）。

---

### 🔖 交接（2026-06-16 凌晨 v0.3.7）

**開工第一件事：`git pull`。**

> **⚠️ 圖片注意**：`public/bike.png`（610×409 去背霓虹重機）已在 repo，貼圖生效。
> 對位微調參數：`BIKE.spriteW / spriteOffsetX / spriteOffsetY`（在 `src/game/constants.ts`）。

> **⚙️ 驅動模型（重要）**：使用者確認 **Rider 是「街機定速」**—— 地面速 = 空中速 = 固定 N，不需要 boost。
> 故移除整個 launchBoost / groundedStreak 系統；低重力 0.3 取代 boost 給予充足空中翻轉時間。

**目前驅動 / 手感（定速引擎 + 兩輪取坡）：**
- **驅動（坡面切線鎖速）⭐ 核心模型**：著地按住 → 取「後輪→前輪連線方向（坡面切線，tx 永遠 > 0 = 恆朝前）」的速度分量，ease 到 `cruiseSpeed=5.76`（`groundLockEase=0.7`）。任何坡角同速；過坡頂保留垂直速度 → 自然飛出去。無 boost，地面速 = 空中速。
- **法線速度歸零（吸地消彈跳）**：著地時每步把「垂直坡面朝外」的速度分量歸零（法線=(ty,-tx)，只移除 vn>0 的離坡分量）。消除 Matter.js 碰撞微彈。
- **低重力**：`engine.gravity.y = 0.5`（飛行時間長，翻轉窗口寬）。
- **離地歸零殘留角速度**：消除爬坡貼坡帶上來的「莫名往後翻」。
- **空中操控**：按住＝後空翻（`airSpinMax=0.192`、`airSpinAccel=0.024`）；放開＝線性制動 (`airSpinBrakeAccel=0.06`, ~4步停) 再微微前壓（`airNoseForwardAccel=0.0006`、`airNoseForwardMax=0.008`）。
- **前壓配重**：前輪 `frontWheelDensity=0.0030` > 後輪 `0.0012`。
- **落地/對齊**：著地角速度朝坡面切線修正（`groundAlignGain=0.3`，夾 `groundedAvMax=0.15`）；`restitution=0.05`。
- **chassis 改圓形（`Bodies.circle(r=10)`）**：圓形碰撞體接觸力永遠過圓心 → 不產生旋轉力矩 → 不被坡頂稜角頂抖、不自動翻正；`friction=0, restitution=0`；已取消 `mask:0`（原修法造成 chassis 穿地 → constraint 把輪子也帶進縫隙穿落）。
- **地形**：`segmentWidth=80`、`heightRange=420`、`refPct=0.022`；折線維持原汁原味。
- **V 谷平底**：h1×h2 > segW² 的谷底插入 80px 平段。
- **地形碰撞體（零縫隙⭐新）**：矩形（法線偏移貼線）＋每個頂點加圓形（`Bodies.circle(r=13)`）填縫。圓心在頂點正下方 13px、圓頂與地形面齊平，數學上完全填滿任何角度的接縫，無台階。三角形方案（Bodies.fromVertices）已廢棄，因三角頂點附近極細（<1px），速度 6.9px/step 直接隧穿。
- **完美落地**：`airRotation > 1.7π` + 真實跳躍 + 坡面夾角 < `perfectLevelRad=0.55`(≈31°)。坡面角改用 `slopeAt(track, chassis.x)` 取代兩輪插值（更穩定）。計分 = `Math.max(1, flips) × 100`（依圈數，最少 100）。
- **結算迷你圖**：以 `prices[0]`（開盤價）為基準：高於開盤=紅、低於開盤=綠、等於=青；含虛線基準線。
- **結算畫面**：`.overlay-result`（透明讓出中段折線圖區域）；進結算 HUD 全隱藏；完賽車體凍住。
- **死亡判定（⭐車頂碰地即死）**：`BIKE.crashZone`（5 個局部座標點，前擾流→風鏡→油箱→座椅前/後緣）每 step 轉為世界座標，任一點 `worldY > terrainYAt(track, worldX)` → 判死（`crashUpsideDownSec=0.1s` 緩衝消除單幀誤判）。刻意不延伸到尾殼，避免陡坡朝上時屁股誤觸前一段地形。另保留 `stuckMidAir`（雙輪離地 + 速度<0.5）處理卡谷等邊緣情況。
- **`slopeAt` / `terrainYAt` 修正**：改二分搜尋，修正 V 谷插入後 x 不均勻時 `floor(x/segW)` 索引錯誤的既有 bug。
- `public/bike.png` 已就位（610×409 去背），貼圖生效。

**死亡特效（v0.3.4~0.3.5）：**
- 翻車觸發後 0.1s：車身位置爆出 28 顆粒子（琥珀/青/白），速度 1.5-5.5px/step，重力 0.1，1.5s 動畫
- 同時：白色全屏閃光（×0.72/幀）+ 鏡頭震動 8px（×0.82/幀，暫時偏移不汙染 camX/camY）
- `dying=true` 期間：HUD 全隱，鏡頭凍在爆炸現場；1.5s 後進結算
- crashZone 加 `!upright` 前提：正立不觸發，消除山峰刺穿誤判

**結算畫面切換（v0.3.6）：**
- 預設顯示賽道全覽（不疊走勢圖）
- 點擊中段大區域 → 瞬間切換走勢圖（黑底純折線）；再點切回
- 小膠囊 badge 顯示「走勢圖 →」/「← 賽道」提示

**地形碰撞修正（v0.3.7）：**
- 移除頂點填縫圓（`Bodies.circle` at vertices）→ 消除轉折點隱形牆彈射
- 矩形兩端各 +3px（`segLen+6`）重疊取代圓填縫，無凸角、無彈射

**否決狀態更新**：允許「放開＝緩緩前壓」這一種空中自動微旋；其餘不要。

---

#### 🟡 仍待辦

1. **手感 tune**（依試玩回饋調整 `src/game/constants.ts` 的 DRIVE/BIKE/TRACK）
2. （選配）Grok 建議的折線尖角 Catmull-Rom 平滑（本次未做，避免尖角卡輪）
3. ~~**Phase 3（三模式 UI）**~~ ✅ v0.5.0 完成（每日排名賽／隨機拉霸／自選）
4. 更多股票預抓（v0.4.3 已補到 24 支：原 14 + 長榮/陽明/萬海/台達電/日月光/中信金/富邦金/台塑/瑞昱/00878；可再補。指令 `node scripts/fetchTwse.ts monthly <code> 3` + `intraday <code>`，再接進 `tracks.ts`）
5. **v0.4.0 待真人試玩確認**：填滿地形是否徹底消除卡頓／隱形牆；若 chassis 仍偶卡谷底，啟用備援 chassis `mask=0`（只輪子碰地）。
6. **discussion #13 真機測**：Android/TWA 實體返回鍵的 popstate 確認流程。

---

#### 已完成（Phase 2 至今）
- 抓資料腳本 `scripts/fetchTwse.ts`（`stock` 個股日線 / `taiex` 大盤每5秒降採樣，`node scripts/fetchTwse.ts ...` 直跑）。
- 4 條真實樣本 JSON（`src/data/sample-*.json`）＋ `tracks.ts` 清單 ＋ `TrackSelect` 選賽道畫面 ＋ `GameCanvas` 改吃 `prices/label/onExit` prop、可換賽道。
- 大盤 `MI_5MINS_INDEX` 格式已實測（每5秒 ~3241 點、欄位1=加權指數；見 DEVDOC 3.1）。

#### 還沒做 / 待續（讓明天的你/Claude 一目了然）
- 上面第 1~4 項回饋（第 5 項已修完）。
- Phase 2 收尾：每日大盤挑戰模式串接、更多代號/自由搜尋。
- in-app 即時抓取 → 需 **Phase 4** 後端（CORS）；現用打包樣本。
- Phase 3（三模式 UI）、Phase 5（離線快取）、Phase 6（視覺音效+難度分級）、Phase 7（TWA 上架）見 DEVDOC 第 8 節。

#### 測試提醒
preview 是隱藏分頁、`requestAnimationFrame` 被瀏覽器暫停 → 主迴圈不會跑（看起來像車不動）。用 `GameCanvas.tsx` 內 `import.meta.env.DEV` 的 `window.__test`（step/press/release/reset/state）手動步進驗證；真人用可見分頁玩一切正常。

---

- **Phase 0 ✅ 完成**（2026-06-14）：Vite+React+TS+PWA 骨架可跑，neon 標題畫面，`tsc -b` 零錯誤，首次 push 完成。
- **Phase 1 🟡 prototype 完成、待真人試玩調手感**（2026-06-14）：
  - 假資料 → 霓虹賽道地形（`terrain.ts`，正規化+斜率夾平）。
  - Matter.js 機車（`bike.ts`，車身+雙輪+軸約束）。
  - 單指操控：著地按住=前進力驅動、空中按住=後翻、放開=滑行/停轉（`GameCanvas.tsx`）。
  - 鏡頭跟隨、後空翻計分、摔車偵測、HUD、結束 overlay、R 重來。
  - 已驗證：可前進、空中可後翻、著地保持正立、無 console error。**手感數值（`constants.ts` 的 DRIVE/BIKE）待真人玩過再 tune**。
- **Phase 2 🟡 進行中**（2026-06-15）：
  - `scripts/fetchTwse.ts`：Node 24 直跑(.ts)，抓 TWSE `STOCK_DAY` 個股日線（後端/腳本抓無 CORS）。已驗證可抓真實資料。
  - 預抓 2330 近 3 個月 → `src/data/sample-2330.json`（50 個交易日，收盤 1810~2425，最大單日 +6.56%/-2.96%）。
  - `src/data/currentTrack.ts` 載入樣本 → 接進 `GameCanvas`（取代假資料）。
  - 已用 __test 驗證：可騎完整條真實 2330 賽道、得分 600、有完美落地。
  - **大盤 `MI_5MINS_INDEX` 格式已實測**：每5秒、一天 ~3241 列、欄位1=發行量加權股價指數；腳本降採樣到 110 點。
  - 預抓 4 條樣本：TAIEX(大盤,平緩) / 2330 / 0050 / 2454(投機飆股,狂野)。**資料性格**：個股越投機點間波動越大(2454 平均4.7%、天天漲跌停)；大盤盤中反而最平(0.12%)。
  - **賽道選擇畫面**(`TrackSelect`)：可選 4 條真實賽道進遊戲、可換賽道。已驗證選單↔遊戲往返正常。使用者選**保留原汁原味**(不放大地形)。
  - 待辦：更多代號/自由搜尋、每日大盤挑戰串接、in-app 即時抓取(Phase 4 後端解 CORS)、個股長度(現 3 個月)。
- 後續 Phase 2~7 見 [DEVDOC.md](DEVDOC.md) 第 8 節 Roadmap。

---

### Phase 1 v2 調整（2026-06-14，依真人回饋）
- 速度 ×1.2；機車→**敞篷跑車**(露頭/小輪/寬輪距低重心)；假資料加**漲停/跌停級跳台**(真實滯空~1.6s)；分數移到**螢幕正中上方**；後空翻/完美落地有 toast。
- **完美落地**：真實跳躍後車身接近水平著地(`perfectLevelRad`≈28°，越小越嚴格)＝+200，**雙輪冒 cyan 擴散光環+火花特效**。註：陡跳台+單鍵控制使「完全水平」很難，故門檻設28°；已驗證可觸發(實測落地5°~-21°)。
- 手感終值：`airSpinMax`=0.12、`airSpinDelaySteps`=4(≈0.07s)。
- 已用 __test 手動步進驗證：前進/真實滯空/後空翻計分(2圈350)/重置 皆正常。車體外觀與手感需真人可見分頁試玩。
- **後翻敏感度修正**（依回饋）：加「騰空寬限」(`airSpinDelaySteps`)＝離地連續超過 ~0.08s 才開始後翻，小坡微彈跳不再亂翻（越小越靈敏）；後翻轉速調soft(`airSpinMax` 0.22→0.10，約 0.9 圈/秒)。後翻旋轉速與車速為**獨立參數**(旋轉=`airSpinMax/Accel`，車速=`accel/maxSpeed`)。已驗證平緩跑道穩定前進不亂翻、真實跳台仍可後翻。

### 待 Phase 2 實測確認
- `MI_5MINS_INDEX` 實際回傳欄位格式與解析度（5 分 vs 5 秒）。
- 個股賽道資料長度（固定近 3 個月，或讓玩家選 1/3 個月）。

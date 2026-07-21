// 每日提醒（本地通知）——只在 Capacitor 原生殼生效，網頁/PWA 一律 no-op。
//
// 為什麼用「本地通知」不用 Web Push：每日賽道台灣午夜換圖，提醒內容固定、時間固定，
// 裝置自己排程就夠了——不需要推播伺服器、訂閱 token 管理、也沒有後端要維護
// （@capacitor/local-notifications 純裝置端排程，開機重啟外掛會自動重排）。
//
// 權限 UX：不在冷啟動就跳系統權限框（未建立價值前先要權限是手遊大忌，Android 13+
// 的 POST_NOTIFICATIONS 拒絕兩次後永久鎖死只能去系統設定開）。改在「第一局玩完」
// 這個已投入的時點才請求，且只問一次（ASKED_KEY），拒絕就永遠不再煩。
// 之後每次 App 啟動 ensureDailyReminder() 只在「已授權」時默默重排程（排程 id 固定，
// schedule 同 id 是覆蓋不是疊加，重複呼叫安全），權限被使用者事後從系統設定關掉
// 也不會再跳框。
//
// ⚠️ Android 12+ 精準鬧鐘（SCHEDULE_EXACT_ALARM）限制：外掛在拿不到精準鬧鐘權限時
// 自動退回非精準排程（系統可能延遲幾分鐘送達）——對「每日提醒」完全無感，不要為了
// 精準到秒去要 USE_EXACT_ALARM（Play 政策只允許鬧鐘/行事曆類 App 用，遊戲用會被拒）。

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const ASKED_KEY = "tr_notif_asked"; // 已經跳過一次系統權限框（不分帳號：權限是裝置級的）
const REMINDER_ID = 9001;           // 固定 id：重複 schedule 會覆蓋同 id 的舊排程

// 通知頻道（Android 8+ 強制）：不指定的話外掛套內建預設頻道，使用者去「設定→App→
// 通知」看到的是看不懂的英文預設分類名。自建一個有中文名的頻道，讓使用者能一眼看懂
// 這是什麼通知、能獨立開關。channelId 要跟 schedule 時帶的一致，否則各走各的頻道。
const CHANNEL_ID = "daily_reminder";

// 每天 8:00：台灣午夜已換圖，早上發送讓玩家一整天都還有機會上榜，
// 避免傍晚才提醒導致只剩幾小時可玩（2026-07-15 由 20:00 改到早上）。
const REMINDER_HOUR = 8;

// 建立/更新中文命名的通知頻道。冪等：同 id 重複呼叫是更新不是新增。
// 只在 Android 有效（iOS 沒有頻道概念，外掛在 iOS 是 no-op）。importance 3 = 預設
// （會出現在狀態列但不會強制彈出橫幅/聲音打擾），對「每日提醒」剛好。
async function ensureChannel(): Promise<void> {
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: "每日賽道提醒",
      description: "每天早上提醒你今日賽道已更新",
      importance: 3,
    });
  } catch (err) {
    console.warn("[notif] 建立通知頻道失敗", err);
  }
}

async function scheduleDaily(): Promise<void> {
  try {
    await ensureChannel();
    // 先取消再排，確保任何舊版排程（未來若改時間/文案）不殘留
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
    await LocalNotifications.schedule({
      notifications: [{
        id: REMINDER_ID,
        title: "TAIEX RIDER",
        body: "今日賽道已更新，上榜機會別錯過 🏍️",
        schedule: { on: { hour: REMINDER_HOUR, minute: 0 }, allowWhileIdle: true },
        // 指定自建的中文頻道（見 CHANNEL_ID / ensureChannel），不指定會落到外掛預設頻道。
        channelId: CHANNEL_ID,
        // Android 5.0+ 狀態列小圖示規定必須是白色去背剪影，不能是彩色 App icon
        // （不指定的話外掛回退用彩色 icon，系統無法轉剪影會顯示系統預設的「i」符號）。
        // 剪影圖檔見 android/app/src/main/res/drawable-*dpi/ic_stat_notify.png。
        smallIcon: "ic_stat_notify",
        iconColor: "#ffb300",
      }],
    });
  } catch (err) {
    console.warn("[notif] 每日提醒排程失敗", err);
  }
}

// App 啟動時呼叫：已授權才（重新）排程，絕不跳權限框。
export async function ensureDailyReminder(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display === "granted") await scheduleDaily();
  } catch (err) {
    console.warn("[notif] ensureDailyReminder 失敗", err);
  }
}

// 通知點擊 deep link：使用者點開每日提醒通知時呼叫 callback（App.tsx 用來導向
// 每日排名賽畫面，不自動開局）。只過濾我們自己排的那則提醒（REMINDER_ID），
// 避免以後加了其他種類通知會誤觸發不相關的導航。回傳取消訂閱函式。
export function onDailyReminderTapped(callback: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle: { remove: () => void } | undefined;
  let cancelled = false;
  LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    if (action.notification.id === REMINDER_ID) callback();
  }).then((h) => { if (cancelled) h.remove(); else handle = h; });
  return () => { cancelled = true; handle?.remove(); };
}

// 第一局玩完時呼叫：還沒問過權限就問一次（系統框），同意就排程；拒絕記下來不再問。
export async function maybeAskDailyReminder(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display === "granted") { await scheduleDaily(); return; }
    if (display === "denied") return; // 系統層已拒絕：requestPermissions 也不會再跳框，別打擾
    try { if (localStorage.getItem(ASKED_KEY) === "1") return; } catch { /* 靜默 */ }
    try { localStorage.setItem(ASKED_KEY, "1"); } catch { /* 靜默 */ }
    const res = await LocalNotifications.requestPermissions();
    if (res.display === "granted") await scheduleDaily();
  } catch (err) {
    console.warn("[notif] maybeAskDailyReminder 失敗", err);
  }
}

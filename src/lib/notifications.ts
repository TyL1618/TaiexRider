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

// 每天 20:00：晚間休閒時段，且當日賽道（前一交易日盤勢）整天都有效，
// 不用等午夜換圖，任何時間點進來都玩得到。
const REMINDER_HOUR = 20;

async function scheduleDaily(): Promise<void> {
  try {
    // 先取消再排，確保任何舊版排程（未來若改時間/文案）不殘留
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
    await LocalNotifications.schedule({
      notifications: [{
        id: REMINDER_ID,
        title: "TAIEX RIDER",
        body: "今日賽道已更新，上榜機會別錯過 🏍️",
        schedule: { on: { hour: REMINDER_HOUR, minute: 0 }, allowWhileIdle: true },
        // smallIcon 不指定：讓外掛用預設（App icon），避免指到不存在的資源名
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

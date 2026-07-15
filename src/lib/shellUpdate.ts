// 殼版本更新提示（Capacitor 原生殼限定）——見 supabase/migration_20260715b.sql。
//
// 網頁/PWA 版本來就靠 pwa.ts 的 Service Worker 自動偵測新版並 reload，不需要這層；
// 原生殼的版本只能靠玩家自己去 Play 商店手動更新，這裡補一個非強制的提示條：
// 讀本機 versionCode（@capacitor/app）跟 Supabase app_config.latest_android_versioncode
// 比對，落後就提示，不擋遊戲。關掉提示會記住這個版號，下次有更新的版號才會再跳。

import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DISMISS_KEY = "tr_update_dismissed_v";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.tylapp.taiexrider";

export interface ShellUpdateInfo {
  latest: number;
}

// App.tsx 啟動時呼叫一次。網頁版/未設定 Supabase/查詢失敗一律靜默回 null，
// 不能因為這個非必要功能影響任何人的正常開局。
export async function checkShellUpdate(): Promise<ShellUpdateInfo | null> {
  if (!Capacitor.isNativePlatform() || !URL || !KEY) return null;
  try {
    const [{ build }, rows] = await Promise.all([
      CapApp.getInfo(),
      fetch(`${URL}/rest/v1/app_config?key=eq.latest_android_versioncode&select=value`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      }).then((r) => (r.ok ? r.json() : null)) as Promise<{ value: string }[] | null>,
    ]);
    const latest = parseInt(rows?.[0]?.value ?? "", 10);
    const current = parseInt(build, 10);
    if (!Number.isFinite(latest) || !Number.isFinite(current) || latest <= current) return null;
    try {
      if (localStorage.getItem(DISMISS_KEY) === String(latest)) return null; // 這個版號已關過
    } catch { /* 靜默 */ }
    return { latest };
  } catch {
    return null;
  }
}

export function dismissShellUpdate(latest: number): void {
  try { localStorage.setItem(DISMISS_KEY, String(latest)); } catch { /* 靜默 */ }
}

// Capacitor 內建支援 window.open(url, "_system") 開系統瀏覽器/外部處理器，
// 不需要額外裝 @capacitor/browser。
export function openPlayStore(): void {
  window.open(PLAY_STORE_URL, "_system");
}

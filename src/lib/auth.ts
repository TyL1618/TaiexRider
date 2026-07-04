import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { NAME_KEY, resetPlayerName } from "./playerId";
import { resetWalletCache } from "./garage";

export type { User };

const GOOGLE_CLIENT_ID = "899150298731-tj4fjbobqcmc14d0ne66jdfebtfi24vm.apps.googleusercontent.com";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            nonce?: string;
            callback: (r: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          prompt: (listener?: (n: {
            isNotDisplayed: () => boolean;
            isSkippedMoment: () => boolean;
          }) => void) => void;
          cancel: () => void;
        };
      };
    };
  }
}

async function generateNonce(): Promise<[string, string]> {
  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const rawNonce = btoa(String.fromCharCode(...rawBytes));
  const encoded = new TextEncoder().encode(rawNonce);
  const hashBuf = await crypto.subtle.digest("SHA-256", encoded);
  // Google GSI 與 Supabase 都期待 hex 格式的 SHA-256 hash（不是 base64）
  const hashedNonce = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return [rawNonce, hashedNonce]; // [傳給 Supabase, 傳給 GSI]
}

function waitForGSI(maxMs = 3000): Promise<boolean> {
  if (window.google?.accounts?.id) return Promise.resolve(true);
  return new Promise((resolve) => {
    let elapsed = 0;
    const iv = setInterval(() => {
      if (window.google?.accounts?.id) { clearInterval(iv); resolve(true); return; }
      elapsed += 200;
      if (elapsed >= maxMs) { clearInterval(iv); resolve(false); }
    }, 200);
  });
}

async function doRedirect(): Promise<void> {
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
}

// 先嘗試 One Tap（不跳頁、體驗最順）；
// GSI 未載入或被瀏覽器封鎖時自動 fallback 到 redirect。
export async function signInWithGoogle(): Promise<void> {
  const gsiReady = await waitForGSI();
  if (!gsiReady) return doRedirect();

  const [rawNonce, hashedNonce] = await generateNonce();
  window.google!.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    nonce: hashedNonce,         // GSI 收 SHA-256 hash（base64）
    cancel_on_tap_outside: true,
    callback: async ({ credential }) => {
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: credential,
        nonce: rawNonce,        // Supabase 收原始 nonce
      });
      if (error) { console.error("[auth] signInWithIdToken failed:", error.message); doRedirect(); }
    },
  });
  window.google!.accounts.id.prompt((n) => {
    if (n.isNotDisplayed() || n.isSkippedMoment()) doRedirect();
  });
}

// 登出：清掉所有帳號相關的本地快取（暱稱/金幣/鑽石/擁有清單/裝備車皮/成就/streak），
// 回到訪客預設值。背景：2026-07-05 發現這些 key 全是裝置共用、不分帳號，登出後
// 完全沒清過，導致同裝置換登另一個 Google 帳號時會讀到上一個帳號的殘留資料
// （見 NEXT_BATCH_PLAN.md 批次 1、CLAUDE.md 待辦 1b）。
export async function signOut(): Promise<void> {
  window.google?.accounts?.id?.cancel();
  await supabase.auth.signOut();
  resetPlayerName();
  resetWalletCache(); // 內含金幣/鑽石/擁有清單/裝備車皮 + 成就/streak 快取歸零
}

// 將暱稱同步到 user_profiles，讓舊成績排行榜也顯示新名稱
// 長度硬上限 32：DB 端另有 CHECK constraint（migration_hardening），
// 這裡先擋一層避免正常路徑就被 DB 拒絕。
export async function updateProfileName(name: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase.from("user_profiles").upsert(
    { player_id: session.user.id, player_name: name.slice(0, 32) },
    { onConflict: "player_id" },
  );
}

export async function getUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// 登入時同步暱稱：優先用伺服器 user_profiles.player_name（這個帳號自己設過的暱稱，
// 一律以它為準蓋掉本地任何殘留值——這是修復「同裝置切換帳號暱稱互相污染」的關鍵）。
// 伺服器還沒有暱稱（這個帳號第一次登入、從沒設過）才 fallback 舊邏輯：本地是空的
// 或還是預設 Rider#### 格式時，改用 Google 顯示名稱。
export async function initNicknameFromGoogle(user: User): Promise<void> {
  const { data, error } = await supabase.rpc("get_player_name");
  if (!error && data) {
    try { localStorage.setItem(NAME_KEY, String(data).slice(0, 32)); } catch { /* 靜默 */ }
    return;
  }
  const current = localStorage.getItem(NAME_KEY);
  if (!current || /^Rider\d{4}$/.test(current)) {
    const name = (user.user_metadata?.name as string) ?? "";
    if (name) { try { localStorage.setItem(NAME_KEY, name.trim().slice(0, 16)); } catch { /* 靜默 */ } }
  }
}

export function onAuthStateChange(cb: (user: User | null) => void): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null;
    if (user) initNicknameFromGoogle(user);
    cb(user);
  });
  return () => subscription.unsubscribe();
}

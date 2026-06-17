import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

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

export async function signOut(): Promise<void> {
  window.google?.accounts?.id?.cancel();
  await supabase.auth.signOut();
}

export async function getUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// 首次 Google 登入時，若暱稱還是預設 Rider#### 格式，自動改成 Google 顯示名稱
export function initNicknameFromGoogle(user: User): void {
  const current = localStorage.getItem("taiex_player_name");
  if (!current || /^Rider\d{4}$/.test(current)) {
    const name = (user.user_metadata?.name as string) ?? "";
    if (name) localStorage.setItem("taiex_player_name", name.trim().slice(0, 16));
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

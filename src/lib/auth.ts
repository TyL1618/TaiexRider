import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type { User };

const GOOGLE_CLIENT_ID = "899150298731-tj4fjbobqcmc14d0ne66jdfebtfi24vm.apps.googleusercontent.com";

// GSI 型別宣告（Google Identity Services）
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
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

// 初始化 One Tap：App 確認未登入後呼叫。
// 若 GSI 還在載入中，輪詢最多 4 秒等待。
export function initOneTap(): void {
  const setup = () => {
    window.google!.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      cancel_on_tap_outside: false,
      callback: async ({ credential }) => {
        // One Tap 拿到 Google ID Token → 交給 Supabase 換 session
        await supabase.auth.signInWithIdToken({ provider: "google", token: credential });
        // 後續由 onAuthStateChange 更新 App 的 user state
      },
    });
    window.google!.accounts.id.prompt((n) => {
      // 瀏覽器封鎖 One Tap（隱私設定、或已被使用者關閉過）時自動忽略，
      // 使用者仍可點設定裡的「Google 登入」按鈕走 redirect 流程。
      if (n.isNotDisplayed() || n.isSkippedMoment()) return;
    });
  };

  if (window.google?.accounts?.id) {
    setup();
    return;
  }
  // GSI 尚未載入（async defer），輪詢等待
  let tries = 0;
  const poll = setInterval(() => {
    if (window.google?.accounts?.id) { clearInterval(poll); setup(); }
    if (++tries > 20) clearInterval(poll); // 最多等 4 秒
  }, 200);
}

// 按鈕觸發登入：先嘗試 One Tap prompt，若瀏覽器不支援則降級 redirect
export async function signInWithGoogle(): Promise<void> {
  if (window.google?.accounts?.id) {
    window.google.accounts.id.prompt((n) => {
      if (n.isNotDisplayed() || n.isSkippedMoment()) {
        // One Tap 無法顯示，降級到 redirect 流程
        supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin },
        });
      }
    });
  } else {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }
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

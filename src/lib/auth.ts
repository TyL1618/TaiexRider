import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type { User };

export async function signInWithGoogle(): Promise<void> {
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
}

export async function signOut(): Promise<void> {
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

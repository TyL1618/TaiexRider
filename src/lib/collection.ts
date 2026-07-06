// 股票圖鑑（RETENTION_PLAN.md「股票圖鑑」，2026-07-06 使用者點頭 schema 後動工）。
// 收集規則：騎過某股票（自選/長征模式）就算「收集」，跟哪一天的盤勢無關——
// 今天玩 0050、改天再玩 0050 都算同一支，圖鑑存的是「代號集合」不是「代號×日期」。
// 每人一列存已收集代號陣列，天生封頂在股票池總數（~1090 支），不會隨玩家數爆炸，永久保留不清除。
//
// 已登入：collect_stock() RPC 為權威（migration_20260706b.sql），wallet_get() 一併帶回
// collection 欄位（沿用 garage.ts 既有同步呼叫點，不需要新增一個同步時機）。
// 未登入：純本地 localStorage（無法跨裝置保留，接受，跟 achievements/streak 同一類取捨）。

import { supabase } from "./supabase";

const KEY = "tr_collection";

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function save(codes: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(codes)); } catch { /* 靜默 */ }
}

async function getUid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user.id ?? null;
}

export function getCollectedCodes(): string[] {
  return load();
}

export function getCollectedCount(): number {
  return load().length;
}

// 已登入時由 garage.ts syncWalletFromServer() 呼叫，覆寫本地顯示快取（跟
// achievements/streak 同款模式：伺服器永遠是最新真相）。
export function writeCollectionCache(codes: string[]): void {
  save(codes);
}

// 登出時呼叫：清空本地快取，避免下一個登入的帳號看到上一個帳號的收集殘影。
export function resetCollectionCache(): void {
  save([]);
}

// 收集一支股票代號：已收集過就不重複加。已登入時呼叫伺服器 RPC 為權威；
// 未登入純本地（樂觀更新，反正沒有跨裝置一致性問題）。
export async function collectStock(code: string): Promise<void> {
  const uid = await getUid();
  if (uid) {
    const { data, error } = await supabase.rpc("collect_stock", { p_code: code });
    if (!error && data && data[0]) {
      writeCollectionCache((data[0] as { codes: string[] }).codes);
      return;
    }
    // RPC 失敗（尚未跑 migration/網路問題）：退回本地寫入，下次登入同步時會被伺服器覆寫
  }
  const codes = load();
  if (!codes.includes(code)) {
    codes.push(code);
    save(codes);
  }
}

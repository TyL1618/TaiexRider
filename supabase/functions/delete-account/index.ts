// 帳號刪除（Google Play 上架合規：使用者必須能在 App 內自行觸發刪除帳號）。
//
// 流程：前端設定頁「刪除帳號」→ 雙重確認 → 帶使用者 JWT 呼叫這支 → 這裡驗明身份後
// 用 service role 刪光該玩家在所有資料表的列 → 最後刪掉 Supabase Auth 使用者本體。
// 前端收到 ok 後做本地 signOut 清快取。
//
// 設計原則：
//   - 身份只信 JWT（auth.getUser()），不收任何「要刪誰」的參數——只能刪自己。
//   - iap_purchases **刻意保留**：真錢交易紀錄基於金流稽核/爭議處理需要留存
//     （Google Play 資料刪除政策明文允許為法律/詐欺防制目的保留交易紀錄），
//     且該表只剩 purchase_token 對 uid 的對應，auth 使用者刪除後 uid 已無法
//     連回任何個人身份（email 等都在 auth.users，已刪）。
//   - 逐表刪除任何一張失敗就中止並回 500（不刪 auth 使用者）——寧可留下可重試的
//     完整帳號，也不要造出「auth 沒了但資料還在、永遠沒人能再觸發刪除」的孤兒資料。
//   - 表清單要跟 schema 同步：新增含 player_id 的表時記得回來補（見下方 TABLES）。
//
// ── 部署指令（push 不會自動部署）──
//   npx supabase functions deploy delete-account --project-ref cjnwwtrpveejhbwalncy

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 所有存有玩家資料的表（欄位名都是 player_id）。iap_purchases 刻意不在清單（見檔頭）。
const TABLES = [
  "daily_scores",
  "classic_records",
  "events",
  "user_profiles",
  "player_wallet",
  "wallet_earn_log",
  "wallet_daily_attempts",
  "player_achievements",
  "player_streak",
  "player_collection",
  "player_weekly_quest",
  "daily_diamond_settlement",
  "classic_diamond_settlement",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 身份只信 JWT：只能刪自己
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: "not authenticated" }),
        { status: 401, headers: CORS_HEADERS });
    }
    const uid = user.id;

    const adminClient = createClient(supabaseUrl, serviceKey);

    // 逐表刪除；任何一張失敗就中止（不刪 auth 使用者，讓使用者可重試）
    for (const table of TABLES) {
      const { error } = await adminClient.from(table).delete().eq("player_id", uid);
      if (error) {
        console.error(`[delete-account] 刪 ${table} 失敗（uid=${uid}）：`, JSON.stringify(error));
        return new Response(JSON.stringify({ ok: false, error: `delete ${table} failed` }),
          { status: 500, headers: CORS_HEADERS });
      }
    }

    // 最後刪 auth 使用者本體（email 等個資都在這，刪掉後 iap_purchases 的 uid 連不回任何人）
    const { error: delErr } = await adminClient.auth.admin.deleteUser(uid);
    if (delErr) {
      console.error(`[delete-account] 刪 auth 使用者失敗（uid=${uid}）：`, JSON.stringify(delErr));
      return new Response(JSON.stringify({ ok: false, error: "delete auth user failed" }),
        { status: 500, headers: CORS_HEADERS });
    }

    console.info(`[delete-account] 完成：uid=${uid}`);
    return new Response(JSON.stringify({ ok: true }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[delete-account] 未預期例外：", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: CORS_HEADERS });
  }
});

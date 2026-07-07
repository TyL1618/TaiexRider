// 每天台灣時間 00:00 由 GitHub Actions 觸發（跟 fetchDailyMap.ts 的 16:00 排程分開，
// 這支只管「結算」不管抓資料）。呼叫兩支 service_role 專用 RPC：
//   1. settle_daily_diamonds()：排行榜前一期（連假安全，見 migration_20260708c.sql）
//      參與+名次鑽石結算。
//   2. settle_classic_weekly()：經典模式每關前三名的週鑽石結算+週重置（見
//      migration_20260708d.sql）。RPC 內部自己判斷是否跨週，沒跨週就是無害的 no-op。
// 兩支都用「RPC 尚未建立回 404 視為正常跳過」的容錯風格，跟 fetchDailyMap.ts 一致，
// 方便分批部署 migration 不會讓這支排程失敗。
// 環境變數：SUPABASE_URL, SUPABASE_SERVICE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

async function callRpc(name: string): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: "{}",
    });
    console.log(res.ok ? `${name} 結算完成` : `${name} 呼叫失敗（狀態 ${res.status}，RPC 可能尚未建立，無妨）`);
  } catch (e) {
    console.error(`${name} 呼叫發生例外：`, e);
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  await callRpc("settle_daily_diamonds");
  await callRpc("settle_classic_weekly");
}

main();

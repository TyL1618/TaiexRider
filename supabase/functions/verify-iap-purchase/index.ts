// IAP 購買驗證（Google Play Billing，僅 Android TWA 呼叫，網頁版不開放購買）。
// 支援兩種商品類型：
//   - 消耗型（鑽石包）：可重複購買，驗證後呼叫 grant_iap_diamonds()，並向 Google
//     呼叫 :consume 讓玩家能再次購買同一個 SKU。
//   - 非消耗型（永久去除廣告）：買一次終身有效，驗證後呼叫 grant_remove_ads()，
//     並向 Google 呼叫 :acknowledge（**不能呼叫 consume**，consume 會讓這個「一次性」
//     商品變成可以重複購買，跟消耗型商品搞混）。
//
// 流程：前端走 Digital Goods API 完成付款拿到 purchase_token → 呼叫這支 Edge Function
// （帶使用者的 Supabase JWT + sku_id + purchase_token）→ 這裡向 Google Play Developer API
// 驗證這筆付款是真的、還沒被處理過 → 驗證通過才用 service role 呼叫對應的 grant RPC →
// 依商品類型呼叫 Google 的 consume 或 acknowledge。
//
// 不能讓前端直接呼叫 grant_iap_diamonds()/grant_remove_ads()：那樣任何人偽造一個假
// purchase_token 就能騙鑽石/騙去廣告權，驗證這一步是整個安全設計的核心，不可省略。
//
// ── 部署前需要設定的 Supabase secrets（supabase secrets set 指令，見 NEXT_BATCH_PLAN.md）──
//   GOOGLE_SERVICE_ACCOUNT_EMAIL      服務帳號 email（Google Cloud 建立）
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY 服務帳號私鑰（PEM 格式，換行符號用 \n 轉義）
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 由 Supabase Edge Functions
// 執行環境自動注入，不需要手動設定。
//
// ── 部署指令 ──
//   npx supabase login
//   npx supabase link --project-ref <你的 project ref>
//   npx supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL=... GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=...
//   npx supabase functions deploy verify-iap-purchase

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PACKAGE_NAME = "com.tylapp.taiexrider"; // android/app/build.gradle.kts applicationId

// SKU 分類：消耗型（鑽石）vs 非消耗型（永久去廣告）。兩邊都要跟
// src/lib/billing.ts / supabase/migration_20260706c.sql,20260706d.sql 同步。
const DIAMOND_SKUS = new Set(["diamonds_100", "diamonds_350", "diamonds_1200"]);
const REMOVE_ADS_SKU = "remove_ads_forever";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// 服務帳號 JWT bearer flow 換取 Android Publisher API 用的 access token
async function getGoogleAccessToken(): Promise<string> {
  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")!;
  const privateKeyPem = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")!.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64url(new Uint8Array(sig))}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google token exchange failed: ${JSON.stringify(j)}`);
  return j.access_token as string;
}

interface GooglePurchase {
  purchaseState: number;    // 0 = purchased
  consumptionState: number; // 0 = yet to be consumed
}

async function verifyPurchase(productId: string, token: string, accessToken: string): Promise<GooglePurchase | null> {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products/${productId}/tokens/${token}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return null;
  return await r.json() as GooglePurchase;
}

async function consumePurchase(productId: string, token: string, accessToken: string): Promise<void> {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products/${productId}/tokens/${token}:consume`;
  await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {});
}

// 非消耗型商品（去廣告）用 acknowledge，不能用 consume——consume 會讓這個「買一次終身有效」
// 的商品變成可以重複購買，跟消耗型商品的語意搞混。
async function acknowledgePurchase(productId: string, token: string, accessToken: string): Promise<void> {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products/${productId}/tokens/${token}:acknowledge`;
  await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const { sku_id, purchase_token } = await req.json();
    if (!sku_id || !purchase_token) {
      return new Response(JSON.stringify({ ok: false, error: "missing params" }),
        { status: 400, headers: CORS_HEADERS });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 用前端傳來的 JWT 驗證身份，決定要幫哪個玩家發鑽石
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: "not authenticated" }),
        { status: 401, headers: CORS_HEADERS });
    }

    if (!DIAMOND_SKUS.has(sku_id) && sku_id !== REMOVE_ADS_SKU) {
      return new Response(JSON.stringify({ ok: false, error: "unknown sku" }),
        { status: 400, headers: CORS_HEADERS });
    }

    // 跟 Google Play 驗證這筆付款是真的、狀態正確
    const accessToken = await getGoogleAccessToken();
    const purchase = await verifyPurchase(sku_id, purchase_token, accessToken);
    if (!purchase || purchase.purchaseState !== 0) {
      return new Response(JSON.stringify({ ok: false, error: "purchase not valid" }),
        { status: 400, headers: CORS_HEADERS });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    if (DIAMOND_SKUS.has(sku_id)) {
      // 消耗型：驗證通過才用 service role 呼叫資料庫發鑽石
      // （RPC 內有 SKU 白名單 + purchase_token 防重放，這裡不需要再檢查一次）
      const { data, error } = await adminClient.rpc("grant_iap_diamonds", {
        p_player_id: user.id,
        p_sku_id: sku_id,
        p_purchase_token: purchase_token,
      });
      if (error || !data || !data[0]?.ok) {
        return new Response(JSON.stringify({ ok: false, error: "grant failed" }),
          { status: 400, headers: CORS_HEADERS });
      }
      // 消耗型商品，消費後玩家才能再次購買同一個 SKU
      if (purchase.consumptionState === 0) {
        await consumePurchase(sku_id, purchase_token, accessToken);
      }
      return new Response(JSON.stringify({ ok: true, diamonds: data[0].diamonds }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // 非消耗型（永久去廣告）
    const { data, error } = await adminClient.rpc("grant_remove_ads", {
      p_player_id: user.id,
      p_purchase_token: purchase_token,
    });
    if (error || !data || !data[0]?.ok) {
      return new Response(JSON.stringify({ ok: false, error: "grant failed" }),
        { status: 400, headers: CORS_HEADERS });
    }
    // 非消耗型商品用 acknowledge，不能用 consume（見上方函式註解）
    await acknowledgePurchase(sku_id, purchase_token, accessToken);
    return new Response(JSON.stringify({ ok: true, adsRemoved: data[0].ads_removed }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: CORS_HEADERS });
  }
});

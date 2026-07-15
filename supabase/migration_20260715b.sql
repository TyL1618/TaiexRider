-- ============================================================================
-- 2026-07-15b：殼版本更新提示 — app_config 表
--
-- ── 為什麼 ─────────────────────────────────────────────────────────────────
-- Capacitor 原生殼（Android App）跟 PWA 網頁版不同：網頁版有 Service Worker 自動
-- 偵測新版並提示（見 src/pwa.ts），但原生殼的版本只能靠玩家自己去 Play 商店手動
-- 檢查，沒有任何機制提醒「有新版可以更新」。這份新增一張極簡的 key-value 設定表，
-- 前端拿本機 versionCode（@capacitor/app 的 App.getInfo().build）跟這裡存的
-- `latest_android_versioncode` 比對，落後就顯示一個可關閉的提示條（不擋遊戲），
-- 見 src/lib/shellUpdate.ts。
--
-- 舊版（TWA 時代）DEVDOC §9.5b 的設計是靠 AndroidManifest.xml 的 DEFAULT_URL 查詢
-- 參數傳殼版本——那個機制只在「殼只是開一個網址」的 TWA 架構下成立，2026-07-10
-- 換成 Capacitor（網頁內容打包進 APK）後已經失效，這份用 App.getInfo() 直接讀原生
-- 版本號取代，不需要查詢參數這種土法煉鋼。
--
-- ── 使用方式（之後每次正式發布新版 AAB 都要記得）───────────────────────────────
-- 打包上傳 Play Console **審核通過、正式對玩家生效那天**，才執行：
--   update public.app_config set value = '<新的 versionCode>', updated_at = now()
--    where key = 'latest_android_versioncode';
-- 不要在剛上傳、還在審核中就改——那樣會提示玩家更新到一個他們還下載不到的版本。
--
-- 執行方式：Supabase Dashboard → SQL Editor 貼上整份執行一次。
-- ============================================================================

create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

drop policy if exists "public read app_config" on public.app_config;
create policy "public read app_config" on public.app_config
  for select using (true);
-- 刻意不開放 anon/authenticated 的 insert/update/delete：這張表只由開發者在
-- SQL Editor 手動維護，前端只讀不寫，沒有任何寫入 RPC。

insert into public.app_config (key, value)
values ('latest_android_versioncode', '30')
on conflict (key) do nothing;

-- 驗收：
-- 1. anon key 打 `GET /rest/v1/app_config?key=eq.latest_android_versioncode&select=value`
--    應回傳 `[{"value":"30"}]`。
-- 2. 真機（vc30）打開 App 不應看到更新提示（本機版號＝latest，相等不算落後）。
-- 3. 手動把 value 改成比真機版號大的數字，重開 App 應看到提示條；點「前往商店」應
--    開啟 Play 商店該 App 頁面；點關閉後同一版號不應再跳（localStorage 記過）。

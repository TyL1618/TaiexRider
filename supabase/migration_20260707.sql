-- ============================================================================
-- 2026-07-07：股票圖鑑登記表（絕版制）
-- 使用者討論後拍板：圖鑑分母不隨「目前上市中股票數」即時增減（那樣下市股票消失
-- 會讓總數莫名變少，體感很怪），改用「絕版制」——只要出現過就永久留在圖鑑裡，
-- 下市股票標記為絕版但不會消失，分母只會增加不會減少（類似寶可夢圖鑑思路）。
-- 由 scripts/fetchDailyMap.ts 每日 upsert 維護（該腳本本來就會抓當日官方上市清單，
-- 順手寫入即可，不需要另外重複打一次 TWSE API）。
-- 在 Supabase SQL Editor 執行一次即可。
-- ============================================================================

create table if not exists public.stock_registry (
  stock_code text primary key,
  stock_name text not null default '',
  first_seen date not null default current_date,
  last_seen  date not null default current_date,
  delisted   boolean not null default false
);
alter table public.stock_registry enable row level security;

-- 任何人（含未登入）可讀，圖鑑功能不需要登入才能瀏覽
drop policy if exists "read stock_registry" on public.stock_registry;
create policy "read stock_registry" on public.stock_registry
  for select to anon, authenticated using (true);
grant select on public.stock_registry to anon, authenticated;

-- 不開放前端直接寫入，只由 fetchDailyMap.ts 帶 service key 寫（service_role 天生繞過權限）
revoke insert, update, delete on public.stock_registry from anon, authenticated;

-- 依「今日官方上市清單」更新絕版狀態：清單裡沒有的舊代號標記絕版，
-- 若絕版代號後來又重新出現在清單中則復活（delisted 改回 false）。
-- 安全防呆：p_active_codes 長度異常過短（< 500，代表當次 TWSE 抓取失敗/不完整）
-- 就直接不執行，避免把全部股票誤判成下市。
create or replace function public.mark_delisted_stocks(p_active_codes text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if array_length(p_active_codes, 1) is null or array_length(p_active_codes, 1) < 500 then
    return;
  end if;

  update public.stock_registry
     set delisted = true
   where delisted = false
     and stock_code <> all(p_active_codes);

  update public.stock_registry
     set delisted = false
   where delisted = true
     and stock_code = any(p_active_codes);
end;
$$;
-- 只給 service_role 呼叫（腳本用 service key），不開放前端
revoke execute on function public.mark_delisted_stocks(text[]) from public, anon, authenticated;

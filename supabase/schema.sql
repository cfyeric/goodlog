-- 好記：Supabase 資料表與權限
-- 用法：Supabase 後台 → SQL Editor → New query → 貼上整段 → Run。重複執行也不會出錯。
--
-- 資料格式跟 claude.ai 版完全相同，只是換個地方放：
--   ledger_settings.data    = claude.ai 的 data/users/<uid>/settings
--   ledger_months.items     = claude.ai 的 data/users/<uid>/settings/months/<YYYY-MM> 裡的 items
-- rev 是版本號：每次寫入加 1，用來偵測「別台裝置剛好也在寫」，避免互相覆蓋。

create table if not exists public.ledger_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  rev bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.ledger_months (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ym text not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  rev bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, ym)
);

-- 每次修改自動更新時間
create or replace function public.goodlog_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists touch on public.ledger_settings;
create trigger touch before update on public.ledger_settings for each row execute function public.goodlog_touch();
drop trigger if exists touch on public.ledger_months;
create trigger touch before update on public.ledger_months for each row execute function public.goodlog_touch();

-- 每個人只能讀寫自己的帳本（Row Level Security）
alter table public.ledger_settings enable row level security;
alter table public.ledger_months enable row level security;

drop policy if exists "只能存取自己的設定" on public.ledger_settings;
create policy "只能存取自己的設定" on public.ledger_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "只能存取自己的記錄" on public.ledger_months;
create policy "只能存取自己的記錄" on public.ledger_months
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 只開放給登入的使用者；沒登入（anon）完全碰不到
revoke all on public.ledger_settings, public.ledger_months from anon;
grant select, insert, update, delete on public.ledger_settings, public.ledger_months to authenticated;

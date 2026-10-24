-- =====================================================================
-- 營區站哨排班系統 — Supabase Schema
-- 在 Supabase Dashboard → SQL Editor 貼上整份執行即可。
--
-- 設計重點：
--   1. 「當月上班天數」與「當月已站哨節數」不存成會被重複 +1 的計數欄位，
--      而是由 attendance（出勤紀錄）與 duty_assignments（哨表）即時統計。
--      → 同一天重複按「生成哨表」或重新儲存，數字都不會被灌水（冪等）。
--   2. 班次以 shift_index 0~11 表示，每班 2 小時：
--        0=00-02  1=02-04  2=04-06  3=06-08  4=08-10  5=10-12
--        6=12-14  7=14-16  8=16-18  9=18-20 10=20-22 11=22-24
--      灰色時段（屎缺）= 0, 1, 2, 6
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- 資格列舉 ----------
do $$ begin
  -- leader = 哨長（可兼任槍兵）；guard = 僅能擔任槍兵；both 為舊版值，已不使用
  create type qualification as enum ('leader', 'guard', 'both');
exception when duplicate_object then null; end $$;

do $$ begin
  create type duty_role as enum ('leader', 'guard');               -- 哨長位 / 槍兵位
exception when duplicate_object then null; end $$;

-- ---------- 人員名冊 ----------
create table if not exists members (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  qualification qualification not null default 'leader',
  active        boolean not null default true,   -- 停用（退伍/調離）但保留歷史紀錄
  note          text,
  created_at    timestamptz not null default now()
);

-- ---------- 出勤紀錄（每人每天至多一筆）----------
-- work_date = 該份哨表的勤務日期；勾選「可動用」即寫入一筆。
create table if not exists attendance (
  member_id  uuid not null references members(id) on delete cascade,
  work_date  date not null,
  created_at timestamptz not null default now(),
  primary key (member_id, work_date)
);
create index if not exists attendance_date_idx on attendance (work_date);

-- ---------- 哨表 ----------
create table if not exists duty_assignments (
  id          bigint generated always as identity primary key,
  duty_date   date not null,
  shift_index smallint not null check (shift_index between 0 and 11),
  role        duty_role not null,
  member_id   uuid not null references members(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (duty_date, shift_index, role),        -- 每班每個位置只有一人
  unique (duty_date, shift_index, member_id)    -- 同一人同班不可兼任哨長+槍兵
);
create index if not exists duty_member_date_idx on duty_assignments (member_id, duty_date);

-- =====================================================================
-- RPC：當月統計
--   p_month        : 該月任一天
--   p_exclude_date : 排除某天的站哨節數（重新產生同一天哨表時，不要把舊哨表算進公平值）
-- =====================================================================
create or replace function member_month_stats(p_month date, p_exclude_date date default null)
returns table (member_id uuid, work_days int, shift_count int)
language sql stable
as $$
  with bounds as (
    select date_trunc('month', p_month)::date as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date as m_end
  )
  select m.id,
         (select count(*) from attendance a, bounds b
           where a.member_id = m.id and a.work_date >= b.m_start and a.work_date < b.m_end)::int,
         (select count(*) from duty_assignments d, bounds b
           where d.member_id = m.id and d.duty_date >= b.m_start and d.duty_date < b.m_end
             and (p_exclude_date is null or d.duty_date <> p_exclude_date))::int
  from members m;
$$;

-- =====================================================================
-- RPC：設定某天的出勤名單（Wizard Step 3「上班天數 +1」）
-- 以「覆寫」方式處理：該日出勤 = 本次勾選的人。重複執行結果一致。
-- =====================================================================
create or replace function set_attendance(p_date date, p_member_ids uuid[])
returns void
language plpgsql
as $$
begin
  delete from attendance where work_date = p_date and not (member_id = any(p_member_ids));
  insert into attendance (member_id, work_date)
  select unnest(p_member_ids), p_date
  on conflict do nothing;
end;
$$;

-- =====================================================================
-- RPC：儲存整天哨表（Wizard Step 5）— 單一交易，先刪後寫
-- p_assignments 格式：[{"shift_index":0,"role":"leader","member_id":"uuid"}, ...]
-- 「已站哨節數」由 duty_assignments 統計，因此寫入即等於更新。
-- =====================================================================
create or replace function save_duty_roster(p_date date, p_assignments jsonb)
returns int
language plpgsql
as $$
declare
  n int;
begin
  delete from duty_assignments where duty_date = p_date;
  insert into duty_assignments (duty_date, shift_index, role, member_id)
  select p_date,
         (x->>'shift_index')::smallint,
         (x->>'role')::duty_role,
         (x->>'member_id')::uuid
  from jsonb_array_elements(p_assignments) as x
  where x->>'member_id' is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- =====================================================================
-- Row Level Security：只有登入的帳號可讀寫（帳號在 Dashboard → Authentication 建立）
-- =====================================================================
alter table members          enable row level security;
alter table attendance       enable row level security;
alter table duty_assignments enable row level security;

drop policy if exists "auth all" on members;
drop policy if exists "auth all" on attendance;
drop policy if exists "auth all" on duty_assignments;
create policy "auth all" on members          for all to authenticated using (true) with check (true);
create policy "auth all" on attendance       for all to authenticated using (true) with check (true);
create policy "auth all" on duty_assignments for all to authenticated using (true) with check (true);

-- 明確授權：只給登入者（建立專案時不勾「Automatically expose new tables」也能正常運作）
revoke all on members, attendance, duty_assignments from anon;
grant select, insert, update, delete on members, attendance, duty_assignments to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 函式皆為 security invoker，本身就受上方 RLS 約束；這裡再限制只有登入者能呼叫。
revoke execute on function member_month_stats(date, date) from public, anon;
revoke execute on function set_attendance(date, uuid[])   from public, anon;
revoke execute on function save_duty_roster(date, jsonb)  from public, anon;
grant  execute on function member_month_stats(date, date) to authenticated;
grant  execute on function set_attendance(date, uuid[])   to authenticated;
grant  execute on function save_duty_roster(date, jsonb)  to authenticated;

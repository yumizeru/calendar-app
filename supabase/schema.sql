-- =====================================================================
-- ひびログ データベース設定
-- Supabase ダッシュボード → SQL Editor に全文を貼り付けて「Run」を1回押す。
-- 何度実行しても壊れないように書いてあります。
-- =====================================================================

-- ---------- 1. ユーザーごとのデータ（予定・習慣・記録をまとめて保存） ----------
create table if not exists public.user_data (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_data enable row level security;
grant select, insert, update on public.user_data to authenticated;

drop policy if exists "user_data select own" on public.user_data;
drop policy if exists "user_data insert own" on public.user_data;
drop policy if exists "user_data update own" on public.user_data;
create policy "user_data select own" on public.user_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_data insert own" on public.user_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_data update own" on public.user_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- 2. リマインダー（通知を送る予定時刻の一覧） ----------
create table if not exists public.reminders (
  id       bigint generated always as identity primary key,
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id text not null,
  fire_at  timestamptz not null,
  title    text not null,
  body     text not null default '',
  sent_at  timestamptz
);
create index if not exists reminders_due on public.reminders (fire_at) where sent_at is null;
alter table public.reminders enable row level security;
grant select on public.reminders to authenticated;

drop policy if exists "reminders select own" on public.reminders;
create policy "reminders select own" on public.reminders
  for select to authenticated using ((select auth.uid()) = user_id);

-- アプリから「これから先のリマインダー一覧」を丸ごと差し替える
create or replace function public.replace_reminders(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from reminders where user_id = uid and sent_at is null;
  delete from reminders where user_id = uid and sent_at < now() - interval '7 days';

  insert into reminders (user_id, event_id, fire_at, title, body)
  select uid,
         left(x->>'event_id', 64),
         (x->>'fire_at')::timestamptz,
         left(coalesce(x->>'title', ''), 100),
         left(coalesce(x->>'body', ''), 200)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x
  where (x->>'fire_at')::timestamptz > now() - interval '2 minutes'
    and not exists (               -- 送信済みのものは二重に送らない
      select 1 from reminders r
      where r.user_id = uid
        and r.event_id = x->>'event_id'
        and r.fire_at = (x->>'fire_at')::timestamptz
        and r.sent_at is not null)
  limit 500;
end;
$$;
revoke all on function public.replace_reminders(jsonb) from public, anon;
grant execute on function public.replace_reminders(jsonb) to authenticated;

-- ---------- 3. プッシュ通知の宛先（端末ごと） ----------
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists "push select own" on public.push_subscriptions;
drop policy if exists "push insert own" on public.push_subscriptions;
drop policy if exists "push update own" on public.push_subscriptions;
drop policy if exists "push delete own" on public.push_subscriptions;
create policy "push select own" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "push insert own" on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "push update own" on public.push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "push delete own" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------- 4. ウィジェット用の合言葉（ログインできないウィジェットが読むため） ----------
create table if not exists public.widget_tokens (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  token      text not null unique
             default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table public.widget_tokens enable row level security;
grant select, insert, delete on public.widget_tokens to authenticated;

drop policy if exists "widget select own" on public.widget_tokens;
drop policy if exists "widget insert own" on public.widget_tokens;
drop policy if exists "widget delete own" on public.widget_tokens;
create policy "widget select own" on public.widget_tokens
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "widget insert own" on public.widget_tokens
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "widget delete own" on public.widget_tokens
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 合言葉を知っている場合だけ、その人のデータを返す
create or replace function public.get_widget_data(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select d.data
  from widget_tokens w
  join user_data d using (user_id)
  where length(p_token) >= 32 and w.token = p_token;
$$;
revoke all on function public.get_widget_data(text) from public;
grant execute on function public.get_widget_data(text) to anon, authenticated;

-- ---------- 5. サーバー処理（Edge Function）用の権限 ----------
grant select, insert, update, delete on public.user_data, public.reminders,
  public.push_subscriptions, public.widget_tokens to service_role;

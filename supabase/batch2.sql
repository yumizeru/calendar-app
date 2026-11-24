-- =====================================================================
-- ひびログ 第2弾：自動バックアップ・共有の変更通知
--  DROP などの「消す命令」は使わない（何度実行しても大丈夫な書き方）
-- =====================================================================

-- ---------- 1. バックアップ（週1回の自動＋手動） ----------
create table if not exists public.user_backups (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null,
  kind       text not null default 'auto' check (kind in ('auto', 'manual')),
  created_at timestamptz not null default now()
);
create index if not exists user_backups_user on public.user_backups (user_id, created_at desc);
alter table public.user_backups enable row level security;
grant select, insert on public.user_backups to authenticated;
grant select, insert, update, delete on public.user_backups to service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_backups' and policyname = 'backups select own') then
    create policy "backups select own" on public.user_backups for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_backups' and policyname = 'backups insert own') then
    create policy "backups insert own" on public.user_backups for insert to authenticated with check ((select auth.uid()) = user_id and kind = 'manual');
  end if;
end $$;

-- 週1回（日本時間の月曜 4:00 ＝ 日曜 19:00 UTC）、全員のデータを保存する。古いものはサーバー処理が片付ける
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'hibilog-weekly-backup') then
    perform cron.schedule('hibilog-weekly-backup', '0 19 * * 0',
      $job$ insert into public.user_backups (user_id, data, kind) select user_id, data, 'auto' from public.user_data $job$);
  end if;
end $$;

-- ---------- 2. 共有カレンダーの変更通知 ----------
-- メンバーごとに「通知を受け取るか」
alter table public.shared_members add column if not exists notify boolean not null default true;

-- 送る通知の順番待ち（サーバー処理だけが読む）
create table if not exists public.notify_queue (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  tag        text not null,
  title      text not null,
  body       text not null default '',
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists notify_queue_pending on public.notify_queue (created_at) where sent_at is null;
alter table public.notify_queue enable row level security;
grant select, insert, update, delete on public.notify_queue to service_role;

-- 共有の予定が追加・変更・削除されたら、変えた人以外のメンバーに通知を積む
create or replace function public.queue_shared_event_notice()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cal     shared_calendars;
  actor   uuid := auth.uid();
  who     text;
  ev      jsonb;
  ev_id   text;
  verb    text;
  when_tx text;
begin
  if tg_op = 'DELETE' then ev := old.data; ev_id := old.id; select * into cal from shared_calendars where id = old.calendar_id;
  else ev := new.data; ev_id := new.id; select * into cal from shared_calendars where id = new.calendar_id; end if;
  if cal.id is null then return null; end if;
  verb := case tg_op when 'INSERT' then '追加' when 'UPDATE' then '変更' else '削除' end;
  select coalesce(nullif(display_name, ''), 'メンバー') into who from shared_members where calendar_id = cal.id and user_id = actor;
  when_tx := coalesce(to_char(to_date(ev->>'date', 'YYYY-MM-DD'), 'FMMM/FMDD'), '') ||
             case when coalesce(ev->>'time', '') <> '' then ' ' || (ev->>'time') else '' end;

  -- 同じ予定のまだ送っていない通知があれば、まとめて1つにする（続けて直したときに何回も鳴らない）
  update notify_queue q
     set title = cal.name || 'の予定が' || verb || 'されました',
         body = coalesce(who, 'メンバー') || '：' || coalesce(ev->>'title', '') || '（' || when_tx || '）',
         created_at = now()
   where q.sent_at is null and q.tag = 'shared:' || ev_id
     and q.user_id in (select m.user_id from shared_members m where m.calendar_id = cal.id and m.user_id is distinct from actor and m.notify);

  insert into notify_queue (user_id, tag, title, body)
  select m.user_id, 'shared:' || ev_id,
         cal.name || 'の予定が' || verb || 'されました',
         coalesce(who, 'メンバー') || '：' || coalesce(ev->>'title', '') || '（' || when_tx || '）'
    from shared_members m
   where m.calendar_id = cal.id and m.user_id is distinct from actor and m.notify
     and not exists (select 1 from notify_queue q where q.sent_at is null and q.tag = 'shared:' || ev_id and q.user_id = m.user_id);
  return null;
end;
$$;
revoke all on function public.queue_shared_event_notice() from public, anon, authenticated;

create or replace trigger shared_events_notice
  after insert or update or delete on public.shared_events
  for each row execute function public.queue_shared_event_notice();

-- 確認用
select 'user_backups' as t, count(*) from public.user_backups
union all select 'notify_queue', count(*) from public.notify_queue
union all select 'cron', count(*) from cron.job where jobname = 'hibilog-weekly-backup';

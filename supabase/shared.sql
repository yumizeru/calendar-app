-- =====================================================================
-- ひびログ 共有カレンダー
--  ・メンバーだけが、そのカレンダーと予定を読み書きできる
--  ・参加は招待コードでのみ（専用の関数経由）
-- =====================================================================

create table if not exists public.shared_calendars (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 30),
  color       text not null default '#ec4899',
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  created_at  timestamptz not null default now()
);

create table if not exists public.shared_members (
  calendar_id  uuid not null references public.shared_calendars(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 20),
  joined_at    timestamptz not null default now(),
  primary key (calendar_id, user_id)
);
create index if not exists shared_members_user on public.shared_members (user_id);

create table if not exists public.shared_events (
  id          text primary key check (char_length(id) between 1 and 64),
  calendar_id uuid not null references public.shared_calendars(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists shared_events_cal on public.shared_events (calendar_id);

-- 自分がそのカレンダーのメンバーか（RLS の判定用）
create or replace function public.is_calendar_member(p_cal uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from shared_members where calendar_id = p_cal and user_id = auth.uid());
$$;
revoke all on function public.is_calendar_member(uuid) from public, anon;
grant execute on function public.is_calendar_member(uuid) to authenticated;

-- 予定を書いた人と時刻は、サーバーで必ず正しく入れる
create or replace function public.shared_events_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists shared_events_stamp on public.shared_events;
create trigger shared_events_stamp before insert or update on public.shared_events
  for each row execute function public.shared_events_stamp();

alter table public.shared_calendars enable row level security;
alter table public.shared_members   enable row level security;
alter table public.shared_events    enable row level security;

grant select, update, delete on public.shared_calendars to authenticated;
grant select, update, delete on public.shared_members   to authenticated;
grant select, insert, update, delete on public.shared_events to authenticated;
grant select, insert, update, delete on public.shared_calendars, public.shared_members, public.shared_events to service_role;

drop policy if exists "cal select member" on public.shared_calendars;
drop policy if exists "cal update owner"  on public.shared_calendars;
drop policy if exists "cal delete owner"  on public.shared_calendars;
create policy "cal select member" on public.shared_calendars for select to authenticated
  using (public.is_calendar_member(id));
create policy "cal update owner" on public.shared_calendars for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "cal delete owner" on public.shared_calendars for delete to authenticated
  using (owner = (select auth.uid()));

drop policy if exists "mem select member"  on public.shared_members;
drop policy if exists "mem update self"    on public.shared_members;
drop policy if exists "mem delete self or owner" on public.shared_members;
create policy "mem select member" on public.shared_members for select to authenticated
  using (public.is_calendar_member(calendar_id));
create policy "mem update self" on public.shared_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "mem delete self or owner" on public.shared_members for delete to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from public.shared_calendars c where c.id = calendar_id and c.owner = (select auth.uid())));

drop policy if exists "ev select member" on public.shared_events;
drop policy if exists "ev insert member" on public.shared_events;
drop policy if exists "ev update member" on public.shared_events;
drop policy if exists "ev delete member" on public.shared_events;
create policy "ev select member" on public.shared_events for select to authenticated
  using (public.is_calendar_member(calendar_id));
create policy "ev insert member" on public.shared_events for insert to authenticated
  with check (public.is_calendar_member(calendar_id));
create policy "ev update member" on public.shared_events for update to authenticated
  using (public.is_calendar_member(calendar_id)) with check (public.is_calendar_member(calendar_id));
create policy "ev delete member" on public.shared_events for delete to authenticated
  using (public.is_calendar_member(calendar_id));

-- 作成：カレンダーを作り、自分をメンバーにする
create or replace function public.create_shared_calendar(p_name text, p_color text, p_display_name text)
returns public.shared_calendars language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c shared_calendars;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if (select count(*) from shared_calendars where owner = uid) >= 10 then
    raise exception 'too many calendars';
  end if;
  insert into shared_calendars (name, color, owner)
  values (left(trim(p_name), 30), coalesce(nullif(trim(p_color), ''), '#ec4899'), uid)
  returning * into c;
  insert into shared_members (calendar_id, user_id, display_name)
  values (c.id, uid, left(coalesce(trim(p_display_name), ''), 20));
  return c;
end;
$$;

-- 参加：招待コードでメンバーになる
create or replace function public.join_shared_calendar(p_code text, p_display_name text)
returns public.shared_calendars language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c shared_calendars;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into c from shared_calendars where invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  if not found then raise exception 'invalid invite code'; end if;
  if (select count(*) from shared_members where calendar_id = c.id) >= 20
     and not exists (select 1 from shared_members where calendar_id = c.id and user_id = uid) then
    raise exception 'calendar is full';
  end if;
  insert into shared_members (calendar_id, user_id, display_name)
  values (c.id, uid, left(coalesce(trim(p_display_name), ''), 20))
  on conflict (calendar_id, user_id) do update set display_name = excluded.display_name;
  return c;
end;
$$;

-- 招待コードの作り直し（作った人だけ）
create or replace function public.rotate_invite_code(p_cal uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  update shared_calendars
     set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
   where id = p_cal and owner = auth.uid()
  returning invite_code into code;
  if code is null then raise exception 'not allowed'; end if;
  return code;
end;
$$;

revoke all on function public.create_shared_calendar(text, text, text) from public, anon;
revoke all on function public.join_shared_calendar(text, text) from public, anon;
revoke all on function public.rotate_invite_code(uuid) from public, anon;
grant execute on function public.create_shared_calendar(text, text, text) to authenticated;
grant execute on function public.join_shared_calendar(text, text) to authenticated;
grant execute on function public.rotate_invite_code(uuid) to authenticated;

-- ウィジェット用：自分のデータに、参加している共有カレンダーの予定を足して返す
create or replace function public.get_widget_data(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select d.data || jsonb_build_object(
    'shared_calendars', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color))
      from shared_calendars c join shared_members m on m.calendar_id = c.id
      where m.user_id = w.user_id), '[]'::jsonb),
    'shared_events', coalesce((
      select jsonb_agg(e.data || jsonb_build_object('id', e.id, 'calendarId', e.calendar_id))
      from shared_events e join shared_members m on m.calendar_id = e.calendar_id
      where m.user_id = w.user_id), '[]'::jsonb))
  from widget_tokens w
  join user_data d using (user_id)
  where length(p_token) >= 32 and w.token = p_token;
$$;
revoke all on function public.get_widget_data(text) from public;
grant execute on function public.get_widget_data(text) to anon, authenticated;

-- 毎朝のまとめ通知：その日に送ったかどうか（二重送信を防ぐ）
-- 消す命令（DROP）は使わない。何回流しても同じ結果になる
create table if not exists public.morning_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.morning_sent enable row level security;
-- アプリからは読み書きしない（サーバーの関数だけが使う）
grant select, insert, delete on public.morning_sent to service_role;

// ひびログ：リマインダー通知を送る Edge Function
//  - 1分ごとに cron から呼ばれ、時刻が来たリマインダーをプッシュ通知で送る
//  - ログイン中のアプリから { "test": true } で呼ぶと、その人にテスト通知を送る
//
// 必要な Secrets: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / CRON_SECRET
// （SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で用意する）
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const APP_URL = 'https://yumizeru.github.io/calendar-app/';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Sub = { endpoint: string; p256dh: string; auth: string; user_id: string };
type Payload = { title: string; body: string; tag?: string; url?: string };

async function sendTo(subs: Sub[], payload: Payload) {
  let ok = 0;
  const errors: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: 'high' },
      );
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // 404/410 = その端末の通知登録はもう無効 → 削除
      if (code === 404 || code === 410) {
        await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
      errors.push(`${code ?? ''} ${(e as Error).message ?? e}`.trim());
    }
  }));
  return { ok, errors };
}

async function subsFor(userIds: string[]) {
  if (!userIds.length) return [] as Sub[];
  const { data, error } = await db
    .from('push_subscriptions').select('endpoint,p256dh,auth,user_id').in('user_id', userIds);
  if (error) throw error;
  return (data ?? []) as Sub[];
}

// cron から：時刻が来たリマインダーを送る
async function runDue() {
  const now = Date.now();
  // 30秒先までを「時刻が来た」とみなす。10分以上前に逃したものは送らずに片付ける
  const until = new Date(now + 30_000).toISOString();
  const tooOld = new Date(now - 10 * 60_000).toISOString();

  await db.from('reminders').update({ sent_at: new Date().toISOString() })
    .is('sent_at', null).lt('fire_at', tooOld);

  // 先に「送信済み」にしてから送る（二重送信を防ぐ）
  const { data: due, error } = await db.from('reminders')
    .update({ sent_at: new Date().toISOString() })
    .is('sent_at', null).lte('fire_at', until)
    .select('id,user_id,event_id,title,body');
  if (error) throw error;
  if (!due?.length) return { due: 0, sent: 0 };

  const subs = await subsFor([...new Set(due.map((r) => r.user_id))]);
  let sent = 0;
  const errors: string[] = [];
  for (const r of due) {
    const mine = subs.filter((s) => s.user_id === r.user_id);
    const res = await sendTo(mine, { title: `🔔 ${r.title}`, body: r.body, tag: r.event_id, url: APP_URL });
    sent += res.ok;
    errors.push(...res.errors);
  }
  return { due: due.length, sent, errors: errors.slice(0, 5) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !CRON_SECRET) {
    return json({ error: 'Secrets（VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / CRON_SECRET）が未設定です' }, 500);
  }
  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC, VAPID_PRIVATE);

  try {
    // 1) cron からの呼び出し
    if (req.headers.get('x-cron-secret') === CRON_SECRET) {
      return json(await runDue());
    }

    // 2) ログイン中のアプリからのテスト通知
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (token) {
      const { data: { user } } = await db.auth.getUser(token);
      if (user) {
        const body = await req.json().catch(() => ({}));
        if (body?.test) {
          const subs = await subsFor([user.id]);
          if (!subs.length) return json({ ok: 0, error: 'この人の通知登録がありません' }, 404);
          const res = await sendTo(subs, { title: '🔔 ひびログ', body: 'テスト通知です。リマインダーはこのように届きます。', url: APP_URL });
          return json(res);
        }
        return json({ error: 'bad request' }, 400);
      }
    }
    return json({ error: 'unauthorized' }, 401);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

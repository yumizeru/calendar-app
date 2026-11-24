// ひびログ：リマインダー通知を送る Edge Function
//  - 1分ごとに cron から呼ばれ、時刻が来たリマインダーをプッシュ通知で送る
//  - ログイン中のアプリから { "test": true } で呼ぶと、その人にテスト通知を送る
//
// 必要な Secrets: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / CRON_SECRET
// （SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で用意する）
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';
// アプリと同じ予定の計算（core.js のコピー。tools/build_fn_core.py で作る）
import Core from './core.js';

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
  const queued = await runQueue();
  const morning = await runMorning(now).catch((e) => { console.error('morning', e); return -1; });
  await pruneBackups(now);
  if (!due?.length) return { due: 0, sent: 0, queued, morning };

  const userIds = [...new Set(due.map((r) => r.user_id))];
  const subs = await subsFor(userIds);

  // 習慣の通知は、送る直前に最新の記録を見て「もう達成済み」なら送らない
  const dataByUser = new Map<string, UserData>();
  if (due.some((r) => r.event_id.startsWith('habit:'))) {
    const { data: rows } = await db.from('user_data').select('user_id,data').in('user_id', userIds);
    for (const row of rows ?? []) dataByUser.set(row.user_id, row.data as UserData);
  }

  let sent = 0, skipped = 0;
  const errors: string[] = [];
  for (const r of due) {
    let title = r.title, body = r.body;
    if (r.event_id.startsWith('habit:')) {
      const status = habitStatus(dataByUser.get(r.user_id), r.event_id);
      if (!status || status.done) { skipped++; continue; }
      title = r.title;
      if (status.weekly) body = status.weekly;
    }
    const mine = subs.filter((s) => s.user_id === r.user_id);
    const res = await sendTo(mine, { title, body, tag: r.event_id, url: APP_URL });
    sent += res.ok;
    errors.push(...res.errors);
  }
  return { due: due.length, sent, skipped, queued, morning, errors: errors.slice(0, 5) };
}

// 共有カレンダーの変更通知（データベースが notify_queue に積んだもの）を送る
async function runQueue() {
  // 積まれてから20秒以上たったものだけ送る（続けて直したときに、まとめてから1回で送るため）
  const ready = new Date(Date.now() - 20_000).toISOString();
  const { data: rows, error } = await db.from('notify_queue')
    .update({ sent_at: new Date().toISOString() })
    .is('sent_at', null).lte('created_at', ready)
    .select('id,user_id,tag,title,body');
  if (error) throw error;
  if (!rows?.length) return 0;
  const subs = await subsFor([...new Set(rows.map((r) => r.user_id))]);
  let sent = 0;
  for (const r of rows) {
    const res = await sendTo(subs.filter((s) => s.user_id === r.user_id), { title: r.title, body: r.body, tag: r.tag, url: APP_URL });
    sent += res.ok;
  }
  return sent;
}

// 古いものの片付け（1時間に1回）：自動バックアップは各自の新しい8件だけ残す。送った通知は7日で消す
async function pruneBackups(now: number) {
  if (new Date(now).getUTCMinutes() !== 7) return;
  await db.from('notify_queue').delete().not('sent_at', 'is', null).lt('sent_at', new Date(now - 7 * 86400_000).toISOString());
  await db.from('morning_sent').delete().lt('day', new Date(now - 7 * 86400_000).toISOString().slice(0, 10));
  const { data } = await db.from('user_backups').select('id,user_id').eq('kind', 'auto').order('created_at', { ascending: false });
  const seen = new Map<string, number>();
  const old: number[] = [];
  for (const b of data ?? []) {
    const n = (seen.get(b.user_id) ?? 0) + 1;
    seen.set(b.user_id, n);
    if (n > 8) old.push(b.id);
  }
  // 手動バックアップは新しい5件だけ残す
  const { data: manual } = await db.from('user_backups').select('id,user_id').eq('kind', 'manual').order('created_at', { ascending: false });
  const seenM = new Map<string, number>();
  for (const b of manual ?? []) {
    const n = (seenM.get(b.user_id) ?? 0) + 1;
    seenM.set(b.user_id, n);
    if (n > 5) old.push(b.id);
  }
  if (old.length) await db.from('user_backups').delete().in('id', old);
}

/* ---------- 毎朝のまとめ ----------
 * user_data.data.morning = { on, time: 'HH:MM', tz, wx: { lat, lon, name } | null }
 * その人の時間帯で time〜time+30分のあいだに1回だけ送る（morning_sent で二重送信を防ぐ）
 */
type Morning = { on?: boolean; time?: string; tz?: string; wx?: { lat: number; lon: number; name?: string } | null };
type Feed = { id: string; url: string; name?: string; deleted?: boolean };
type Todo = { id: string; title?: string; due?: string; done?: boolean; deleted?: boolean };
type FullData = UserData & {
  events?: Record<string, unknown>[]; todos?: Todo[]; feeds?: Feed[]; morning?: Morning;
};

function localNow(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
function safeTz(tz?: string) {
  try { if (tz) { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } } catch { /* 下へ */ }
  return 'Asia/Tokyo';
}

const ICS_HOSTS = [/(^|\.)icloud\.com$/i, /^calendar\.google\.com$/i, /^outlook\.(live|office365|office)\.com$/i, /^(www\.)?google\.com$/i];
async function fetchFeed(raw: string) {
  const u = new URL(String(raw).trim().replace(/^webcals?:\/\//i, 'https://'));
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:' || !ICS_HOSTS.some((re) => re.test(u.hostname))) return '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    let url = u.toString();
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (loc) {
        const next = new URL(loc, url);
        if (next.protocol !== 'https:' || !ICS_HOSTS.some((re) => re.test(next.hostname))) return '';
        url = next.toString();
        continue;
      }
      return res.ok ? await res.text() : '';
    }
    return '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

const WX = (code: number) =>
  code === 0 ? '晴れ' : code <= 2 ? '晴れ時々くもり' : code === 3 ? 'くもり' : code === 45 || code === 48 ? '霧'
  : code >= 51 && code <= 57 ? '小雨' : (code >= 61 && code <= 67) || (code >= 80 && code <= 82) ? '雨'
  : (code >= 71 && code <= 77) || code === 85 || code === 86 ? '雪' : code >= 95 ? '雷雨' : 'くもり';

async function weatherLine(m: Morning, tz: string) {
  if (!m.wx || m.wx.lat == null) return '';
  try {
    const q = new URLSearchParams({
      latitude: String(m.wx.lat), longitude: String(m.wx.lon), timezone: tz, forecast_days: '1',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    });
    const res = await fetch('https://api.open-meteo.com/v1/forecast?' + q, { signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    const d = j.daily;
    if (!d) return '';
    const pop = d.precipitation_probability_max?.[0];
    return `${WX(Number(d.weather_code[0]))} ${Math.round(d.temperature_2m_max[0])}°/${Math.round(d.temperature_2m_min[0])}°` +
      (pop != null ? ` 降水${pop}%` : '');
  } catch {
    return '';
  }
}

async function buildMorning(userId: string, d: FullData, today: string, tz: string) {
  const m = d.morning ?? {};
  // 自分の予定
  let events: Record<string, unknown>[] = (d.events ?? []).filter((e) => !e.deleted);
  // 共有カレンダーの予定
  const { data: mem } = await db.from('shared_members').select('calendar_id').eq('user_id', userId);
  const calIds = (mem ?? []).map((x) => x.calendar_id);
  if (calIds.length) {
    const { data: sh } = await db.from('shared_events').select('id,data').in('calendar_id', calIds);
    events = events.concat((sh ?? []).map((r) => ({ ...(r.data as Record<string, unknown>), id: r.id })));
  }
  // ほかのカレンダー（iPhone・Google）
  const feeds = (d.feeds ?? []).filter((f) => !f.deleted && f.url).slice(0, 5);
  const texts = await Promise.all(feeds.map((f) => fetchFeed(f.url)));
  texts.forEach((t, i) => {
    if (t) events = events.concat(Core.parseIcs(t, { from: today, to: today, tz, feedId: feeds[i].id }));
  });
  const occ = Core.onDay(events, today);
  const names = occ.map((o: { ev: { title: string; time?: string } }) => {
    const tl = Core.timeLabel(o);
    return `${tl === '終日' ? '' : tl + ' '}${o.ev.title}${Core.kindSuffix(o.ev, (o as unknown as { start: string }).start) || ''}`;
  });
  const evLine = names.length
    ? `予定：${names.slice(0, 3).join('、')}${names.length > 3 ? `（ほか${names.length - 3}件）` : ''}`
    : '予定：なし';

  const open = (d.todos ?? []).filter((t) => !t.deleted && !t.done);
  const dueToday = open.filter((t) => t.due === today).length;
  const overdue = open.filter((t) => t.due && t.due < today).length;
  const habits = (d.habits ?? []).filter((h) => !h.deleted && Core.isDue(h, today)).length;
  const extra: string[] = [];
  if (dueToday || overdue) extra.push(`やること：今日まで${dueToday + overdue}件${overdue ? `（期限切れ${overdue}）` : ''}`);
  if (habits) extra.push(`習慣：${habits}つ`);

  const wx = await weatherLine(m, tz);
  const [, mo, da] = today.split('-').map(Number);
  const wd = '日月火水木金土'[new Date(Date.UTC(+today.slice(0, 4), mo - 1, da)).getUTCDay()];
  return {
    title: `おはようございます（${mo}/${da} ${wd}）`,
    body: [wx, evLine, extra.join('・')].filter(Boolean).join('\n'),
    tag: `morning-${today}`,
    url: APP_URL,
  };
}

async function runMorning(now: number) {
  const { data: rows, error } = await db.from('user_data').select('user_id,data').eq('data->morning->>on', 'true');
  if (error) throw error;
  let sent = 0;
  for (const row of rows ?? []) {
    const d = row.data as FullData;
    const m = d.morning ?? {};
    const tz = safeTz(m.tz);
    const { date: today, min } = localNow(now, tz);
    const [hh, mm] = String(m.time || '07:00').split(':').map(Number);
    const target = hh * 60 + mm;
    if (!(min >= target && min <= target + 30)) continue;
    const subs = await subsFor([row.user_id]);
    if (!subs.length) continue;
    // 先に「送った」と記録（すでにあれば、今日はもう送っている）
    const { error: dup } = await db.from('morning_sent').insert({ user_id: row.user_id, day: today });
    if (dup) continue;
    const payload = await buildMorning(row.user_id, d, today, tz);
    const res = await sendTo(subs, payload);
    sent += res.ok;
  }
  return sent;
}

/* ---------- 習慣の達成判定（アプリの core.js と同じ考え方） ---------- */
type Mark = { on?: boolean; v?: number | null };
type Habit = {
  id: string; deleted?: boolean;
  freq?: { type?: string; days?: number[]; times?: number };
  target?: { value?: number } | null;
};
type UserData = { habits?: Habit[]; marks?: Record<string, Mark> };

function addDaysStr(s: string, n: number) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function weekday(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function habitStatus(data: UserData | undefined, eventId: string) {
  // eventId = "habit:<habitId>@<YYYY-MM-DD>"
  const m = eventId.match(/^habit:(.+)@(\d{4}-\d{2}-\d{2})$/);
  if (!data || !m) return null;
  const [, hid, date] = m;
  const h = (data.habits ?? []).find((x) => x.id === hid);
  if (!h || h.deleted) return { done: true }; // 消した習慣は送らない
  const marks = data.marks ?? {};
  const target = Number(h.target?.value) || 0;
  const doneOn = (s: string) => {
    const mk = marks[`${s}|${hid}`];
    if (!mk) return false;
    return target > 0 ? (Number(mk.v) || 0) >= target : !!mk.on;
  };
  if (doneOn(date)) return { done: true };
  if (h.freq?.type === 'weekdays' && !(h.freq.days ?? []).includes(weekday(date))) return { done: true };
  if (h.freq?.type === 'weekly') {
    const need = Math.max(1, Number(h.freq.times) || 1);
    const ws = addDaysStr(date, -weekday(date));
    let n = 0;
    for (let i = 0; i < 7; i++) if (doneOn(addDaysStr(ws, i))) n++;
    if (n >= need) return { done: true };
    return { done: false, weekly: `今週 ${n}/${need}回` };
  }
  return { done: false };
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
      const body = await req.json().catch(() => ({}));
      if (body?.previewMorning) {
        const { data: row } = await db.from('user_data').select('data').eq('user_id', body.previewMorning).single();
        const d = (row?.data ?? {}) as FullData;
        const tz = safeTz(d.morning?.tz);
        return json(await buildMorning(body.previewMorning, d, localNow(Date.now(), tz).date, tz));
      }
      return json(await runDue());
    }

    // 2) ログイン中のアプリからのテスト通知
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (token) {
      const { data: { user } } = await db.auth.getUser(token);
      if (user) {
        const body = await req.json().catch(() => ({}));
        if (body?.test === 'morning') {
          const subs = await subsFor([user.id]);
          if (!subs.length) return json({ ok: 0, error: 'この人の通知登録がありません' }, 404);
          const { data: row } = await db.from('user_data').select('data').eq('user_id', user.id).single();
          const d = (row?.data ?? {}) as FullData;
          const tz = safeTz(d.morning?.tz);
          const payload = await buildMorning(user.id, d, localNow(Date.now(), tz).date, tz);
          return json({ ...(await sendTo(subs, payload)), payload });
        }
        if (body?.test) {
          const subs = await subsFor([user.id]);
          if (!subs.length) return json({ ok: 0, error: 'この人の通知登録がありません' }, 404);
          const res = await sendTo(subs, { title: 'ひびログ', body: 'テスト通知です。リマインダーはこのように届きます。', url: APP_URL });
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

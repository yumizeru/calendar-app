// ひびログ：ほかのカレンダー（iPhone・Google など）の ICS を取ってくる Edge Function
//  - ブラウザからは直接取れない（相手のサイトが許可していない）ので、ここで中継する
//  - ログインしている人だけ使える（verify_jwt）
//  - 決まったサイトのカレンダーだけ取る（なんでも取れる中継にしないため）
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// 取ってよいサイト
const ALLOWED = [
  /(^|\.)icloud\.com$/i,
  /^calendar\.google\.com$/i,
  /^outlook\.(live|office365|office)\.com$/i,
  /^(www\.)?google\.com$/i,
];
const MAX = 3 * 1024 * 1024;

export function normalizeUrl(raw: string) {
  let s = String(raw || '').trim();
  s = s.replace(/^webcals?:\/\//i, 'https://');
  const u = new URL(s);
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') throw new Error('bad-url');
  if (!ALLOWED.some((re) => re.test(u.hostname))) throw new Error('not-allowed');
  return u.toString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let url: string;
  try {
    const body = await req.json();
    url = normalizeUrl(body.url);
  } catch (e) {
    return json({ error: (e as Error).message === 'not-allowed' ? 'not-allowed' : 'bad-url' }, 400);
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    // 転送先も「取ってよいサイト」か確かめながら、3回までたどる
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(url, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': 'hibilog-calendar/1.0' } });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      url = normalizeUrl(new URL(loc, url).toString());
      res = null;
    }
    clearTimeout(timer);
    if (!res) return json({ error: 'too-many-redirects' }, 502);
    if (!res.ok) return json({ error: `http-${res.status}` }, 502);
    const text = await res.text();
    if (text.length > MAX) return json({ error: 'too-large' }, 413);
    if (!/BEGIN:VCALENDAR/.test(text)) return json({ error: 'not-ics' }, 422);
    return json({ ics: text });
  } catch (e) {
    return json({ error: (e as Error).name === 'AbortError' ? 'timeout' : 'fetch-failed' }, 502);
  }
});

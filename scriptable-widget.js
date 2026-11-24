// ===== ひびログ ウィジェット本体（Scriptable 用） =====
// アプリの「設定」→「ウィジェット」でコピーすると、先頭に CONFIG が自動で付きます。
// 対応サイズ：ホーム画面（小・中・大）、ロック画面（長方形・1行・丸）

const fm = FileManager.local();
const CONFIG_CACHE = fm.joinPath(fm.documentsDirectory(), 'hibilog-config.json');

// 設定（合言葉など）を探す。読み込み役から渡されなかった場合は、
// Scriptable に貼ったスクリプト本体のファイルを読んで「const CONFIG = {…};」を取り出す
function findConfig() {
  const ok = c => c && c.url && c.key && c.token;
  try { if (typeof CONFIG !== 'undefined' && ok(CONFIG)) return CONFIG; } catch (e) {}
  try { if (typeof globalThis !== 'undefined' && ok(globalThis.HIBILOG_CONFIG)) return globalThis.HIBILOG_CONFIG; } catch (e) {}
  const fromText = t => {
    const m = t && t.match(/const CONFIG = (\{[^\n]*\});/);
    if (!m) return null;
    try { const c = JSON.parse(m[1]); return ok(c) ? c : null; } catch (e) { return null; }
  };
  const paths = [];
  try { if (typeof module !== 'undefined' && module.filename) paths.push(module.filename); } catch (e) {}
  for (const make of [() => FileManager.iCloud(), () => FileManager.local()]) {
    try { const f = make(); paths.push(f.joinPath(f.documentsDirectory(), Script.name() + '.js')); } catch (e) {}
  }
  for (const p of paths) {
    for (const make of [() => FileManager.iCloud(), () => FileManager.local()]) {
      try {
        const f = make();
        if (!f.fileExists(p)) continue;
        const c = fromText(f.readString(p));
        if (c) { try { fm.writeString(CONFIG_CACHE, JSON.stringify(c)); } catch (e) {} return c; }
      } catch (e) {}
    }
  }
  try { if (fm.fileExists(CONFIG_CACHE)) { const c = JSON.parse(fm.readString(CONFIG_CACHE)); if (ok(c)) return c; } } catch (e) {}
  return null;
}
const C = findConfig();
if (C) { try { fm.writeString(CONFIG_CACHE, JSON.stringify(C)); } catch (e) {} }
const CACHE = fm.joinPath(fm.documentsDirectory(), 'hibilog-widget-cache.json');
const WX_CACHE = fm.joinPath(fm.documentsDirectory(), 'hibilog-widget-weather.json');
const FEED_CACHE = fm.joinPath(fm.documentsDirectory(), 'hibilog-widget-feeds.json');
const readJson = (p, d) => { try { return fm.fileExists(p) ? JSON.parse(fm.readString(p)) : d; } catch (e) { return d; } };
const writeJson = (p, v) => { try { fm.writeString(p, JSON.stringify(v)); } catch (e) {} };

/* ---------- 色 ---------- */
// 色は「明るいとき・暗いとき」の組で持つ（半透明の色を作るため、元の色も残す）
let HEX = {
  bg: ['#ffffff', '#1d2028'], card: ['#f2f4f8', '#262a34'], text: ['#1c1f27', '#e8eaf0'],
  muted: ['#6b7280', '#9aa1ae'], accent: ['#4f7cff', '#6d93ff'], red: ['#e5484d', '#ff6b6f'],
};
let FIXED = false; // テーマが「自動」でなければ、明るい・暗いを切り替えない
const col = (k, alpha) => {
  const [l, d] = HEX[k];
  const a = alpha == null ? 1 : alpha;
  return FIXED ? new Color(l, a) : Color.dynamic(new Color(l, a), new Color(d, a));
};

// アプリで選んだテーマの色にする（なければ標準の色のまま）
function useAppearance(a) {
  if (!a) return;
  const pick = (k, l, d) => { if (l && d) HEX[k] = [l, d]; };
  if (a.auto && a.light && a.dark) {
    for (const k of ['bg', 'text', 'muted', 'accent']) pick(k, a.light[k], a.dark[k]);
    pick('card', a.light.card || null, a.dark.card || null);
  } else if (a.bg) {
    FIXED = true;
    for (const k of ['bg', 'text', 'muted', 'accent']) if (a[k]) HEX[k] = [a[k], a[k]];
    if (a.card) HEX.card = [a.card, a.card];
  }
}

/* ---------- 日付 ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = d => `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;

/* ---------- 祝日（アプリと同じ計算） ---------- */
function holidaysOf(y) {
  const h = {};
  const key = (m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const add = (m, d, n) => { h[key(m, d)] = n; };
  const nthMon = (m, n) => 1 + ((8 - new Date(y, m - 1, 1).getDay()) % 7) + (n - 1) * 7;
  const shun = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  const shu = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  add(1, 1, '元日'); add(1, nthMon(1, 2), '成人の日'); add(2, 11, '建国記念の日');
  if (y >= 2020) add(2, 23, '天皇誕生日');
  add(3, shun, '春分の日'); add(4, 29, '昭和の日'); add(5, 3, '憲法記念日'); add(5, 4, 'みどりの日'); add(5, 5, 'こどもの日');
  if (y === 2020) { add(7, 23, '海の日'); add(7, 24, 'スポーツの日'); add(8, 10, '山の日'); }
  else if (y === 2021) { add(7, 22, '海の日'); add(7, 23, 'スポーツの日'); add(8, 8, '山の日'); }
  else { add(7, nthMon(7, 3), '海の日'); add(8, 11, '山の日'); add(10, nthMon(10, 2), 'スポーツの日'); }
  add(9, nthMon(9, 3), '敬老の日'); add(9, shu, '秋分の日'); add(11, 3, '文化の日'); add(11, 23, '勤労感謝の日');
  const base = { ...h };
  const has = d => !!base[ymd(d)];
  for (let d = new Date(y, 0, 2); d.getFullYear() === y; d.setDate(d.getDate() + 1)) {
    if (base[ymd(d)] || d.getDay() === 0) continue;
    if (has(addDays(d, -1)) && has(addDays(d, 1))) h[ymd(d)] = '国民の休日';
  }
  for (const k of Object.keys(base)) {
    const d = parseYmd(k);
    if (d.getDay() !== 0) continue;
    let s = addDays(d, 1);
    while (h[ymd(s)]) s = addDays(s, 1);
    if (s.getFullYear() === y) h[ymd(s)] = '振替休日';
  }
  return h;
}
const HOL = {};
const holiday = s => { const y = Number(s.slice(0, 4)); if (!HOL[y]) HOL[y] = holidaysOf(y); return HOL[y][s] || null; };

/* ---------- データ ---------- */
async function loadData() {
  try {
    const req = new Request(`${C.url}/rest/v1/rpc/get_widget_data`);
    req.method = 'POST';
    req.headers = { apikey: C.key, 'Content-Type': 'application/json' };
    req.body = JSON.stringify({ p_token: C.token });
    req.timeoutInterval = 15;
    const data = await req.loadJSON();
    if (req.response.statusCode !== 200) throw new Error('HTTP ' + req.response.statusCode);
    writeJson(CACHE, { at: Date.now(), data });
    return { data, stale: false };
  } catch (e) {
    const c = readJson(CACHE, null);
    if (c) return { data: c.data, stale: true, at: c.at };
    throw e;
  }
}

/* ---------- 天気（アプリで天気予報をオンにしている場所。1時間ごとに取り直す） ---------- */
const WX_SYMBOL = code =>
  code === 0 ? 'sun.max.fill' : code <= 2 ? 'cloud.sun.fill' : code === 3 ? 'cloud.fill'
  : code === 45 || code === 48 ? 'cloud.fog.fill' : code >= 51 && code <= 57 ? 'cloud.drizzle.fill'
  : (code >= 61 && code <= 67) || (code >= 80 && code <= 82) ? 'cloud.rain.fill'
  : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'cloud.snow.fill' : code >= 95 ? 'cloud.bolt.rain.fill' : 'cloud.fill';
const WX_NAME = code =>
  code === 0 ? '晴れ' : code <= 2 ? '晴れ時々くもり' : code === 3 ? 'くもり' : code === 45 || code === 48 ? '霧'
  : code >= 51 && code <= 57 ? '小雨' : (code >= 61 && code <= 67) || (code >= 80 && code <= 82) ? '雨'
  : (code >= 71 && code <= 77) || code === 85 || code === 86 ? '雪' : code >= 95 ? '雷雨' : 'くもり';

async function loadWeather(data) {
  const p = data.wxPlace && !data.wxPlace.off && data.wxPlace.lat != null ? data.wxPlace
    : data.morning && data.morning.wx && data.morning.wx.lat != null ? data.morning.wx : null;
  if (!p) return null;
  const key = `${p.lat},${p.lon}`;
  const c = readJson(WX_CACHE, null);
  if (c && c.key === key && Date.now() - c.at < 3600 * 1000) return c.days;
  try {
    const q = `latitude=${p.lat}&longitude=${p.lon}&timezone=auto&forecast_days=8` +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max';
    const r = new Request('https://api.open-meteo.com/v1/forecast?' + q);
    r.timeoutInterval = 8;
    const j = await r.loadJSON();
    const d = j.daily;
    const days = {};
    d.time.forEach((t, i) => {
      days[t] = { code: d.weather_code[i], max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]), pop: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null };
    });
    writeJson(WX_CACHE, { key, at: Date.now(), days });
    return days;
  } catch (e) {
    return c && c.key === key ? c.days : null;
  }
}

/* ---------- アプリと同じ計算（core.js）を読み込む。取れなければ前回の保存分 ---------- */
let CoreLib = null;
async function loadCore() {
  const P = fm.joinPath(fm.documentsDirectory(), 'hibilog-core.js');
  let src = null;
  try {
    const r = new Request(C.appUrl + 'core.js?t=' + Date.now());
    r.timeoutInterval = 10;
    const t = await r.loadString();
    if (r.response.statusCode === 200 && t.includes('const Core')) { src = t; fm.writeString(P, t); }
  } catch (e) {}
  if (!src && fm.fileExists(P)) src = fm.readString(P);
  if (!src) return null;
  try { return new Function(src.replace(/if \(typeof module[^\n]*/, '') + '\nreturn Core;')(); } catch (e) { return null; }
}

/* ---------- iPhone・Google のカレンダー（アプリで登録したもの。30分ごとに取り直す） ---------- */
async function loadFeeds(data, from, to) {
  const feeds = (data.feeds || []).filter(f => !f.deleted && f.url).slice(0, 5);
  if (!feeds.length || !CoreLib || !CoreLib.parseIcs) return [];
  const cache = readJson(FEED_CACHE, {});
  const out = [];
  await Promise.all(feeds.map(async f => {
    let text = null;
    const c = cache[f.id];
    if (c && c.url === f.url && Date.now() - c.at < 30 * 60 * 1000) text = c.text;
    if (!text) {
      try {
        const r = new Request(f.url.trim().replace(/^webcals?:\/\//i, 'https://'));
        r.timeoutInterval = 8;
        const t = await r.loadString();
        if (/BEGIN:VCALENDAR/.test(t)) { text = t; cache[f.id] = { url: f.url, at: Date.now(), text: t }; }
      } catch (e) {}
      if (!text && c && c.url === f.url) text = c.text;
    }
    if (!text) return;
    try {
      for (const e of CoreLib.parseIcs(text, { from, to, feedId: f.id })) out.push({ ...e, feedColor: f.color });
    } catch (e) {}
  }));
  for (const id of Object.keys(cache)) if (!feeds.some(f => f.id === id)) delete cache[id];
  writeJson(FEED_CACHE, cache);
  return out;
}

/* ---------- 繰り返し・複数日の予定を1回ずつに（core.js が読めないときの簡易版） ---------- */
const addDaysStr = (s, n) => ymd(addDays(parseYmd(s), n));
const diffDays = (a, b) => {
  const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};
function matches(ev, s) {
  if (s < ev.date) return false;
  const r = ev.repeat;
  if (r.until && s > r.until) return false;
  const iv = Math.max(1, Number(r.interval) || 1);
  const st = parseYmd(ev.date), d = parseYmd(s);
  if (r.freq === 'daily') return diffDays(ev.date, s) % iv === 0;
  if (r.freq === 'weekly') {
    const days = r.byWeekday && r.byWeekday.length ? r.byWeekday : [st.getDay()];
    if (!days.includes(d.getDay())) return false;
    return Math.floor(diffDays(ymd(addDays(st, -st.getDay())), ymd(addDays(d, -d.getDay()))) / 7) % iv === 0;
  }
  if (r.freq === 'monthly') return d.getDate() === st.getDate() && ((d.getFullYear() - st.getFullYear()) * 12 + d.getMonth() - st.getMonth()) % iv === 0;
  if (r.freq === 'yearly') return d.getMonth() === st.getMonth() && d.getDate() === st.getDate() && (d.getFullYear() - st.getFullYear()) % iv === 0;
  return s === ev.date;
}
function expandSimple(events, from, to) {
  const out = [];
  for (const ev of events) {
    const dur = ev.endDate && ev.endDate > ev.date ? diffDays(ev.date, ev.endDate) : 0;
    if (!ev.repeat) {
      const end = addDaysStr(ev.date, dur);
      if (ev.date <= to && end >= from) out.push({ ev, start: ev.date, end });
      continue;
    }
    const ex = new Set(ev.exdates || []);
    let s = ev.date > addDaysStr(from, -dur) ? ev.date : addDaysStr(from, -dur);
    for (let g = 0; s <= to && g < 400; g++, s = addDaysStr(s, 1)) {
      if (!ex.has(s) && matches(ev, s)) out.push({ ev, start: s, end: addDaysStr(s, dur) });
    }
  }
  return out;
}
const expand = (events, from, to) => (CoreLib ? CoreLib.expand(events, from, to) : expandSimple(events, from, to));
function timeOf(o, day) {
  const ev = o.ev;
  if (o.end > o.start) {
    if (day === o.start) return ev.time ? `${ev.time}〜` : '終日〜';
    if (day === o.end) return ev.endTime ? `〜${ev.endTime}` : '〜終日';
    return '終日';
  }
  return ev.time ? ev.time : '終日';
}

/* ---------- 習慣 ---------- */
function habitItems(habits, marks, today) {
  const K = CoreLib;
  const on = (d, id) => !!(marks[`${d}|${id}`] || {}).on;
  if (!K) {
    return habits.map(h => {
      let d = new Date(), n = 0;
      if (!on(ymd(d), h.id)) d = addDays(d, -1);
      while (on(ymd(d), h.id)) { n++; d = addDays(d, -1); }
      return { name: h.name, sub: '', color: h.color || '#4f7cff', done: on(today, h.id), streak: n, unit: '日' };
    });
  }
  return habits.filter(h => K.isDue(h, today)).map(h => {
    const st = K.streak(h, marks, today);
    const num = K.isNumeric(h);
    const v = num ? K.valueOn(h, marks, today) : null;
    const weekly = K.freqOf(h).type === 'weekly';
    return {
      name: h.name,
      sub: num ? `${K.fmtNum(v || 0)}/${K.fmtNum(h.target.value)}${h.target.unit || ''}`
        : weekly ? `今週${K.weekCount(h, marks, today)}/${K.weekNeed(h)}` : '',
      color: h.color || '#4f7cff',
      done: K.doneOn(h, marks, today) || (weekly && K.weekCount(h, marks, today) >= K.weekNeed(h)),
      streak: st.n, unit: st.unit,
    };
  });
}

function view(data, feedEvents, weather) {
  const today = ymd(new Date());
  // 自分の予定 ＋ 共有カレンダー ＋ iPhone・Google のカレンダー
  const events = (data.events || []).concat(data.shared_events || []).filter(e => !e.deleted && e.date && e.title).concat(feedEvents);
  const cats = {};
  for (const c of data.categories || []) if (!c.deleted) cats[c.id] = c.color;
  const calColors = {};
  for (const c of data.shared_calendars || []) calColors[c.id] = c.color;
  const habits = (data.habits || []).filter(h => !h.deleted && h.name);
  const marks = data.marks || {};
  const suffix = (ev, s) => (CoreLib && CoreLib.kindSuffix ? CoreLib.kindSuffix(ev, s) : '');
  const toItem = (o, day) => ({
    date: day, start: o.start, title: o.ev.title + suffix(o.ev, o.start), time: timeOf(o, day),
    allDay: !o.ev.time || day !== o.start,
    sort: (o.ev.time && day === o.start ? o.ev.time : '00:00') + o.ev.title,
    color: o.ev.feedColor || (o.ev.calendarId && calColors[o.ev.calendarId]) || cats[o.ev.categoryId] || null,
    kind: o.ev.kind || '',
  });
  const end = ymd(addDays(new Date(), 13));
  const all = expand(events, today, end);
  const byDay = {};
  for (const o of all) {
    for (let s = o.start < today ? today : o.start; s <= o.end && s <= end; s = addDaysStr(s, 1)) {
      (byDay[s] = byDay[s] || []).push(toItem(o, s));
    }
  }
  for (const k of Object.keys(byDay)) byDay[k].sort((a, b) => a.sort.localeCompare(b.sort));
  const tomorrow = ymd(addDays(new Date(), 1));
  const weekEnd = ymd(addDays(new Date(), 7));
  const upcoming = [];
  // 明日からの7日間（何日も続く予定は始まる日だけ）
  for (let s = tomorrow; s <= weekEnd; s = addDaysStr(s, 1)) for (const e of byDay[s] || []) if (e.start === s) upcoming.push(e);
  // 今日までが期限の、まだ終わっていないToDo（重要なもの→期限が早いもの順）
  const todos = (data.todos || [])
    .filter(t => !t.deleted && !t.done && t.title && t.due && t.due <= today)
    .sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) || a.due.localeCompare(b.due))
    .map(t => ({ title: t.title, star: !!t.star, overdue: t.due < today }));
  const openTodos = (data.todos || []).filter(t => !t.deleted && !t.done && t.title).length;
  const mood = data.diary && data.diary[today] ? data.diary[today].mood : 0;
  return {
    today, byDay, todayEvents: byDay[today] || [], upcoming, todos, openTodos, mood,
    habits: habitItems(habits, marks, today),
    weather: weather ? weather[today] : null, weatherDays: weather || {},
  };
}

/* ---------- 描画の部品 ---------- */
function text(stack, s, size, color, weight) {
  const t = stack.addText(String(s));
  t.font = weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semi' ? Font.semiboldSystemFont(size)
    : weight === 'round' ? Font.boldRoundedSystemFont(size) : Font.systemFont(size);
  t.textColor = color || col('text');
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.8;
  return t;
}
function symbol(stack, name, size, color) {
  const s = SFSymbol.named(name);
  if (!s) return null;
  s.applyFont(Font.semiboldSystemFont(size));
  const img = stack.addImage(s.image);
  img.imageSize = new Size(size * 1.15, size * 1.15);
  img.tintColor = color || col('text');
  return img;
}
// 色の帯（予定の頭に付ける）
function bar(stack, color, h) {
  const b = stack.addStack();
  b.size = new Size(4, h);
  b.cornerRadius = 2;
  b.backgroundColor = color ? new Color(color) : col('accent');
}
// 進み具合のバー
function progress(stack, ratio, width, color) {
  const outer = stack.addStack();
  outer.size = new Size(width, 7);
  outer.cornerRadius = 3.5;
  outer.backgroundColor = col('muted', 0.25);
  const r = Math.max(0, Math.min(1, ratio));
  if (r > 0) {
    const inner = outer.addStack();
    inner.size = new Size(Math.max(7, width * r), 7);
    inner.cornerRadius = 3.5;
    inner.backgroundColor = color || col('accent');
  }
  outer.addSpacer();
}
function card(stack) {
  const c = stack.addStack();
  c.layoutVertically();
  c.backgroundColor = col('card');
  c.cornerRadius = 12;
  c.setPadding(8, 10, 8, 10);
  return c;
}
function heading(stack, s, size) {
  text(stack, s, size || 11, col('muted'), 'bold');
}

// 日付（大きく）と曜日・祝日
function dateBlock(stack, size, withHoliday) {
  const d = new Date();
  const s = ymd(d);
  const hol = holiday(s);
  const red = d.getDay() === 0 || hol;
  const row = stack.addStack();
  row.bottomAlignContent();
  text(row, `${d.getMonth() + 1}/${d.getDate()}`, size, red ? col('red') : col('text'), 'round');
  row.addSpacer(4);
  const wd = row.addStack();
  wd.layoutVertically();
  text(wd, `${WD[d.getDay()]}曜日`, size * 0.5, red ? col('red') : col('muted'), 'bold');
  wd.addSpacer(size * 0.12);
  if (withHoliday && hol) { stack.addSpacer(1); text(stack, hol, size * 0.45, col('red'), 'semi'); }
}
// 天気（アイコン・気温・降水確率）
function weatherBlock(stack, w, size, compact) {
  if (!w) return;
  const row = stack.addStack();
  row.centerAlignContent();
  symbol(row, WX_SYMBOL(w.code), size * 1.2, null);
  row.addSpacer(5);
  const col2 = row.addStack();
  col2.layoutVertically();
  const t = col2.addStack();
  t.bottomAlignContent();
  text(t, `${w.max}°`, size, col('red'), 'bold');
  text(t, ` / ${w.min}°`, size * 0.8, col('accent'), 'semi');
  if (!compact) text(col2, `${WX_NAME(w.code)}${w.pop != null ? ` 降水${w.pop}%` : ''}`, size * 0.62, col('muted'), 'semi');
  else if (w.pop != null) text(col2, `降水${w.pop}%`, size * 0.62, col('muted'), 'semi');
}

// 近い日は「明日」「あさって」、それ以外は 11/28(土)
function dayLabel(s) {
  if (s === ymd(addDays(new Date(), 1))) return '明日';
  if (s === ymd(addDays(new Date(), 2))) return 'あさって';
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}
function eventRow(stack, e, size, withDate) {
  const row = stack.addStack();
  row.centerAlignContent();
  bar(row, e.color, size * 1.35);
  row.addSpacer(6);
  const when = (withDate ? dayLabel(e.date) + ' ' : '') + e.time;
  const tw = row.addStack();
  tw.size = new Size(withDate ? size * 5.6 : size * 3.3, 0);
  text(tw, when, size * 0.82, e.color ? new Color(e.color) : col('accent'), 'bold');
  tw.addSpacer();
  row.addSpacer(2);
  if (e.kind === 'birthday') { symbol(row, 'gift.fill', size * 0.8, col('red')); row.addSpacer(3); }
  else if (e.kind === 'anniv') { symbol(row, 'heart.fill', size * 0.8, col('red')); row.addSpacer(3); }
  text(row, e.title, size, col('text'), 'semi');
  row.addSpacer();
}
function eventList(stack, list, max, size, withDate, emptyMsg) {
  if (!list.length) { text(stack, emptyMsg, size * 0.9, col('muted'), 'semi'); return; }
  list.slice(0, max).forEach((e, i) => { if (i) stack.addSpacer(size * 0.35); eventRow(stack, e, size, withDate); });
  if (list.length > max) { stack.addSpacer(3); text(stack, `ほか${list.length - max}件`, size * 0.78, col('muted'), 'semi'); }
}
function habitRow(stack, h, size) {
  const row = stack.addStack();
  row.centerAlignContent();
  symbol(row, h.done ? 'checkmark.circle.fill' : 'circle', size, new Color(h.color));
  row.addSpacer(5);
  text(row, h.name, size, h.done ? col('muted') : col('text'), 'semi');
  if (h.sub) { row.addSpacer(4); text(row, h.sub, size * 0.78, col('muted'), 'semi'); }
  row.addSpacer();
  if (h.streak > 1) {
    symbol(row, 'flame.fill', size * 0.72, new Color('#ff8a3d'));
    row.addSpacer(1);
    text(row, `${h.streak}`, size * 0.8, col('muted'), 'bold');
  }
}
function habitBlock(stack, v, max, size, width) {
  const done = v.habits.filter(h => h.done).length;
  const top = stack.addStack();
  top.centerAlignContent();
  heading(top, '今日の習慣', size * 0.78);
  top.addSpacer();
  text(top, `${done}/${v.habits.length}`, size * 0.85, done === v.habits.length ? col('accent') : col('text'), 'bold');
  stack.addSpacer(4);
  progress(stack, v.habits.length ? done / v.habits.length : 0, width, null);
  stack.addSpacer(size * 0.5);
  v.habits.slice(0, max).forEach((h, i) => { if (i) stack.addSpacer(size * 0.3); habitRow(stack, h, size); });
  if (v.habits.length > max) { stack.addSpacer(2); text(stack, `ほか${v.habits.length - max}つ`, size * 0.78, col('muted'), 'semi'); }
}
function todoRows(stack, v, max, size) {
  v.todos.slice(0, max).forEach((t, i) => {
    if (i) stack.addSpacer(size * 0.3);
    const row = stack.addStack();
    row.centerAlignContent();
    symbol(row, t.star ? 'star.fill' : 'square', size * 0.9, t.overdue ? col('red') : t.star ? new Color('#f5b301') : col('muted'));
    row.addSpacer(5);
    text(row, t.title, size, t.overdue ? col('red') : col('text'), 'semi');
    row.addSpacer();
  });
  if (v.todos.length > max) { stack.addSpacer(2); text(stack, `ほか${v.todos.length - max}件`, size * 0.78, col('muted'), 'semi'); }
}
// 1週間の帯（曜日・日付・予定の点・天気）
function weekStrip(stack, v, size) {
  const row = stack.addStack();
  for (let i = 0; i < 7; i++) {
    const d = addDays(new Date(), i);
    const s = ymd(d);
    const hol = holiday(s);
    const red = d.getDay() === 0 || hol, blue = d.getDay() === 6 && !hol;
    const c = row.addStack();
    c.layoutVertically();
    c.centerAlignContent();
    c.setPadding(4, 0, 4, 0);
    c.cornerRadius = 10;
    if (i === 0) c.backgroundColor = col('accent', 0.16);
    const line = (fn) => { const r = c.addStack(); r.addSpacer(); fn(r); r.addSpacer(); };
    line(r => text(r, WD[d.getDay()], size * 0.72, red ? col('red') : blue ? col('accent') : col('muted'), 'bold'));
    line(r => text(r, String(d.getDate()), size, i === 0 ? col('accent') : red ? col('red') : col('text'), 'round'));
    const w = v.weatherDays[s];
    if (w) { c.addSpacer(1); line(r => symbol(r, WX_SYMBOL(w.code), size * 0.62, col('muted'))); }
    c.addSpacer(2);
    line(r => {
      const evs = v.byDay[s] || [];
      if (!evs.length) { const e = r.addStack(); e.size = new Size(5, 5); return; }
      evs.slice(0, 3).forEach((e, k) => {
        if (k) r.addSpacer(2);
        const dot = r.addStack();
        dot.size = new Size(5, 5);
        dot.cornerRadius = 2.5;
        dot.backgroundColor = e.color ? new Color(e.color) : col('accent');
      });
    });
    if (i < 6) row.addSpacer();
  }
}

/* ---------- サイズごとの組み立て ---------- */
function build(v, stale) {
  const fam = config.widgetFamily || 'medium';
  const w = new ListWidget();
  w.backgroundColor = col('bg');

  const nowHM = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  const nextToday = v.todayEvents.find(e => !e.allDay && e.time >= nowHM) || null;
  const next = nextToday || v.todayEvents.find(e => e.allDay) || v.upcoming[0] || null;
  const doneN = v.habits.filter(h => h.done).length;
  const nextLabel = e => `${e.date === v.today ? '' : dayLabel(e.date) + ' '}${e.time === '終日' ? '' : e.time + ' '}${e.title}`;

  if (fam === 'accessoryInline') {
    w.addText(next ? nextLabel(next) : v.habits.length ? `習慣 ${doneN}/${v.habits.length}` : '予定なし');
    return w;
  }
  if (fam === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const c = w.addStack(); c.layoutVertically();
    const a = c.addStack(); a.addSpacer(); text(a, v.habits.length ? `${doneN}/${v.habits.length}` : `${v.todayEvents.length}`, 16, null, 'round'); a.addSpacer();
    const b = c.addStack(); b.addSpacer(); text(b, v.habits.length ? '習慣' : '予定', 10, null, 'semi'); b.addSpacer();
    return w;
  }
  if (fam === 'accessoryRectangular') {
    w.addAccessoryWidgetBackground = true;
    const top = w.addStack(); top.centerAlignContent();
    const d = new Date();
    text(top, `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`, 13, null, 'bold');
    if (v.weather) { top.addSpacer(4); symbol(top, WX_SYMBOL(v.weather.code), 11, null); text(top, ` ${v.weather.max}°`, 12, null, 'semi'); }
    text(w, next ? nextLabel(next) : '予定なし', 13, null, 'semi');
    const parts = [];
    if (v.habits.length) parts.push(`習慣 ${doneN}/${v.habits.length}`);
    if (v.todos.length) parts.push(`ToDo ${v.todos.length}`);
    if (parts.length) text(w, parts.join('  '), 11);
    return w;
  }

  if (fam === 'small') {
    w.setPadding(14, 14, 12, 14);
    const top = w.addStack();
    top.topAlignContent();
    const l = top.addStack(); l.layoutVertically();
    const d = new Date();
    const hol = holiday(v.today);
    const red = d.getDay() === 0 || hol;
    text(l, hol || `${WD[d.getDay()]}曜日`, 12, red ? col('red') : col('muted'), 'bold');
    text(l, `${d.getMonth() + 1}/${d.getDate()}`, 28, red ? col('red') : col('text'), 'round');
    top.addSpacer();
    if (v.weather) {
      const r = top.addStack(); r.layoutVertically();
      const a = r.addStack(); a.addSpacer(); symbol(a, WX_SYMBOL(v.weather.code), 20, null);
      r.addSpacer(2);
      const b = r.addStack(); b.addSpacer(); text(b, `${v.weather.max}°`, 14, col('red'), 'bold');
    }
    w.addSpacer(8);
    if (next) {
      const rest = v.todayEvents.length - (next.date === v.today ? 1 : 0);
      heading(w, (next.date === v.today ? (nextToday ? 'つぎの予定' : '今日') : dayLabel(next.date)) +
        (rest > 0 ? `（今日ほか${rest}件）` : ''), 10);
      w.addSpacer(2);
      const r = w.addStack(); r.centerAlignContent();
      bar(r, next.color, 34);
      r.addSpacer(6);
      const c = r.addStack(); c.layoutVertically();
      text(c, next.time, 13, next.color ? new Color(next.color) : col('accent'), 'bold');
      const t = text(c, next.title, 15, col('text'), 'bold');
      t.lineLimit = 2;
    } else {
      text(w, '予定はありません', 14, col('muted'), 'semi');
    }
    w.addSpacer();
    if (v.habits.length) {
      const r = w.addStack(); r.centerAlignContent();
      text(r, '習慣', 11, col('muted'), 'bold'); r.addSpacer();
      text(r, `${doneN}/${v.habits.length}`, 12, doneN === v.habits.length ? col('accent') : col('text'), 'bold');
      if (v.todos.length) { r.addSpacer(6); symbol(r, 'square', 10, v.todos.some(t => t.overdue) ? col('red') : col('muted')); text(r, ` ${v.todos.length}`, 12, null, 'bold'); }
      w.addSpacer(4);
      progress(w, doneN / v.habits.length, 142, null);
    } else if (v.todos.length) {
      text(w, `ToDo ${v.todos.length}件`, 12, v.todos.some(t => t.overdue) ? col('red') : col('text'), 'bold');
    }
  } else if (fam === 'large' || fam === 'extraLarge') {
    w.setPadding(16, 16, 14, 16);
    const top = w.addStack(); top.centerAlignContent();
    const l = top.addStack(); l.layoutVertically();
    dateBlock(l, 30, true);
    top.addSpacer();
    weatherBlock(top, v.weather, 17, false);
    w.addSpacer(10);
    weekStrip(w, v, 15);
    w.addSpacer(12);
    const side = v.habits.length || v.todos.length;
    const body = w.addStack();
    body.topAlignContent();
    const left = body.addStack(); left.layoutVertically();
    heading(left, '今日の予定', 12); left.addSpacer(5);
    const many = v.upcoming.length > 0;
    eventList(left, v.todayEvents, side ? (many ? 3 : 6) : (many ? 4 : 7), 14, false, '今日の予定はありません');
    if (many) {
      left.addSpacer(10);
      heading(left, 'これから', 12); left.addSpacer(5);
      eventList(left, v.upcoming, v.todayEvents.length ? (side ? 3 : 4) : 7, 13, true, '');
    }
    left.addSpacer();
    if (side) {
      body.addSpacer(10);
      const right = card(body);
      right.size = new Size(118, 0);
      if (v.habits.length) habitBlock(right, v, v.todos.length ? 3 : 6, 12, 98);
      if (v.habits.length && v.todos.length) right.addSpacer(10);
      if (v.todos.length) {
        heading(right, `やること ${v.todos.length}件`, 10); right.addSpacer(4);
        todoRows(right, v, v.habits.length ? 2 : 6, 12);
      }
      right.addSpacer();
    }
  } else {
    // 中サイズ：左に今日（日付・予定）、右に天気・習慣
    w.setPadding(14, 14, 12, 14);
    const row = w.addStack();
    const left = row.addStack(); left.layoutVertically();
    const hl = left.addStack(); hl.bottomAlignContent();
    dateBlock(hl, 24, false);
    const hol = holiday(v.today);
    if (hol) { hl.addSpacer(6); text(hl, hol, 11, col('red'), 'semi'); }
    left.addSpacer(8);
    if (v.todayEvents.length) eventList(left, v.todayEvents, v.todos.length ? 3 : 4, 14, false, '');
    else {
      text(left, '今日の予定はありません', 13, col('muted'), 'semi');
      if (v.upcoming.length) { left.addSpacer(5); eventList(left, v.upcoming, 2, 13, true, ''); }
    }
    if (v.todos.length) {
      left.addSpacer(6);
      const r = left.addStack(); r.centerAlignContent();
      symbol(r, 'square', 11, v.todos.some(t => t.overdue) ? col('red') : col('muted'));
      r.addSpacer(4);
      text(r, `${v.todos[0].title}${v.todos.length > 1 ? ` ほか${v.todos.length - 1}件` : ''}`, 12, v.todos[0].overdue ? col('red') : col('text'), 'semi');
    }
    left.addSpacer();
    row.addSpacer(10);
    if (v.habits.length || v.weather) {
      const right = card(row);
      right.size = new Size(128, 0);
      if (v.weather) { weatherBlock(right, v.weather, 14, true); right.addSpacer(8); }
      if (v.habits.length) habitBlock(right, v, v.weather ? 2 : 4, 12, 108);
      right.addSpacer();
    }
  }
  if (stale) { w.addSpacer(2); const t = text(w, 'オフライン表示', 9, col('muted')); t.rightAlignText(); }
  return w;
}

function message(msg) {
  const w = new ListWidget();
  w.backgroundColor = col('bg');
  w.setPadding(14, 14, 14, 14);
  text(w, 'ひびログ', 15, null, 'bold');
  w.addSpacer(6);
  const t = w.addText(msg);
  t.font = Font.systemFont(13);
  t.textColor = col('muted');
  return w;
}

/* ---------- 実行 ---------- */
let widget;
if (!C) {
  widget = message('アプリの「設定」→「ウィジェット」からスクリプトをコピーし直してください。');
} else {
  try {
    const r = await loadData();
    CoreLib = await loadCore();
    if (r.data) {
      useAppearance(r.data.appearance);
      const today = ymd(new Date());
      const [feedEvents, weather] = await Promise.all([
        loadFeeds(r.data, today, ymd(addDays(new Date(), 13))).catch(() => []),
        loadWeather(r.data).catch(() => null),
      ]);
      widget = build(view(r.data, feedEvents, weather), r.stale);
    } else {
      widget = message('合言葉が無効です。アプリの「設定」からスクリプトをコピーし直してください。');
    }
  } catch (e) {
    widget = message('読み込めませんでした。ネット接続を確認してください。');
  }
  widget.url = C.appUrl;
}
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(widget);
} else {
  // アプリの中で実行したときは、大きさを選んで見られるようにする
  const fam = (args && args.widgetParameter) || 'medium';
  if (fam === 'small') await widget.presentSmall();
  else if (fam === 'large') await widget.presentLarge();
  else await widget.presentMedium();
}
Script.complete();

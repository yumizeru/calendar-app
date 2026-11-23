// ===== ひびログ ウィジェット本体（Scriptable 用） =====
// アプリの「設定」→「ウィジェット」でコピーすると、先頭に CONFIG が自動で付きます。
// 対応サイズ：ホーム画面（小・中・大）、ロック画面（長方形・1行）

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

/* ---------- 色 ---------- */
const dyn = (l, d) => Color.dynamic(new Color(l), new Color(d));
const COL = {
  bg: dyn('#ffffff', '#1d2028'),
  text: dyn('#1c1f27', '#e8eaf0'),
  muted: dyn('#6b7280', '#9aa1ae'),
  accent: dyn('#4f7cff', '#6d93ff'),
  red: dyn('#e5484d', '#ff6b6f'),
};

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
const holiday = s => holidaysOf(Number(s.slice(0, 4)))[s] || null;

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
    fm.writeString(CACHE, JSON.stringify({ at: Date.now(), data }));
    return { data, stale: false };
  } catch (e) {
    if (fm.fileExists(CACHE)) {
      const c = JSON.parse(fm.readString(CACHE));
      return { data: c.data, stale: true, at: c.at };
    }
    throw e;
  }
}

/* ---------- 繰り返し・複数日の予定を1回ずつに展開（アプリの core.js と同じ考え方） ---------- */
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
function expand(events, from, to) {
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
function timeOf(o, day) {
  const ev = o.ev;
  if (o.end > o.start) {
    if (day === o.start) return ev.time ? `${ev.time}〜` : '終日〜';
    if (day === o.end) return ev.endTime ? `〜${ev.endTime}` : '〜終日';
    return '終日';
  }
  return ev.time ? ev.time : '終日';
}

/* ---------- アプリと同じ計算（core.js）を読み込む。取れなければ前回の保存分、それもなければ簡易版 ---------- */
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

function habitItems(habits, marks, today, on, legacyStreak) {
  const K = CoreLib;
  if (!K) return habits.map(h => ({ name: h.name, color: h.color || '#4f7cff', done: on(today, h.id), streak: legacyStreak(h.id), unit: '日' }));
  return habits.filter(h => K.isDue(h, today)).map(h => {
    const st = K.streak(h, marks, today);
    const num = K.isNumeric(h);
    const v = num ? K.valueOn(h, marks, today) : null;
    const weekly = K.freqOf(h).type === 'weekly' ? ` ${K.weekCount(h, marks, today)}/${K.weekNeed(h)}` : '';
    return {
      name: h.name + (num ? ` ${K.fmtNum(v || 0)}/${K.fmtNum(h.target.value)}${h.target.unit || ''}` : '') + weekly,
      color: h.color || '#4f7cff',
      done: K.doneOn(h, marks, today) || (weekly && K.weekCount(h, marks, today) >= K.weekNeed(h)),
      streak: st.n, unit: st.unit,
    };
  });
}

function view(data) {
  const today = ymd(new Date());
  const events = (data.events || []).filter(e => !e.deleted && e.date && e.title);
  const cats = {};
  for (const c of data.categories || []) if (!c.deleted) cats[c.id] = c.color;
  const habits = (data.habits || []).filter(h => !h.deleted && h.name);
  const marks = data.marks || {};
  const on = (d, id) => !!(marks[`${d}|${id}`] || {}).on;
  const streak = id => {
    let d = new Date();
    if (!on(ymd(d), id)) d = addDays(d, -1);
    let n = 0;
    while (on(ymd(d), id)) { n++; d = addDays(d, -1); }
    return n;
  };
  const toItem = (o, day) => ({
    date: day, title: o.ev.title, time: timeOf(o, day),
    sort: (o.ev.time && day === o.start ? o.ev.time : '00:00') + o.ev.title,
    color: cats[o.ev.categoryId] || null,
  });
  const weekEnd = ymd(addDays(new Date(), 7));
  const tomorrow = ymd(addDays(new Date(), 1));
  const all = expand(events, today, weekEnd);
  const todayEvents = all.filter(o => o.start <= today && o.end >= today).map(o => toItem(o, today))
    .sort((a, b) => a.sort.localeCompare(b.sort));
  const upcoming = all.filter(o => o.start >= tomorrow).map(o => toItem(o, o.start))
    .sort((a, b) => (a.date + a.sort).localeCompare(b.date + b.sort));
  // 今日までが期限の、まだ終わっていないToDo（重要なもの→期限が早いもの順）
  const todos = (data.todos || [])
    .filter(t => !t.deleted && !t.done && t.title && t.due && t.due <= today)
    .sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) || a.due.localeCompare(b.due))
    .map(t => ({ title: (t.star ? '★' : '') + t.title, overdue: t.due < today }));
  return {
    today, todayEvents, upcoming, todos,
    habits: habitItems(habits, marks, today, on, streak),
  };
}

/* ---------- 描画 ---------- */
function text(stack, s, size, color, bold) {
  const t = stack.addText(s);
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || COL.text;
  t.lineLimit = 1;
  return t;
}
function header(stack, size) {
  const d = new Date();
  const row = stack.addStack();
  row.centerAlignContent();
  const hol = holiday(ymd(d));
  const red = d.getDay() === 0 || hol;
  text(row, `${d.getMonth() + 1}/${d.getDate()}`, size, red ? COL.red : COL.text, true);
  row.addSpacer(4);
  text(row, `(${WD[d.getDay()]})`, size * 0.7, red ? COL.red : COL.muted, true);
  if (hol) { row.addSpacer(6); text(row, hol, size * 0.55, COL.red); }
}
function eventLine(stack, e, size, withDate) {
  const row = stack.addStack();
  row.centerAlignContent();
  const when = (withDate ? md(parseYmd(e.date)) + ' ' : '') + e.time;
  text(row, when, size * 0.85, e.color ? new Color(e.color) : COL.accent, true);
  row.addSpacer(5);
  text(row, e.title, size);
}
function habitLine(stack, h, size) {
  const row = stack.addStack();
  row.centerAlignContent();
  text(row, h.done ? '●' : '○', size, new Color(h.color), true);
  row.addSpacer(5);
  text(row, h.name, size, h.done ? COL.muted : COL.text);
  if (h.streak > 0) { row.addSpacer(4); text(row, `${h.streak}${h.unit || '日'}`, size * 0.8, COL.muted); }
}
function events(stack, list, max, size, withDate, emptyMsg) {
  if (!list.length) { text(stack, emptyMsg, size, COL.muted); return; }
  list.slice(0, max).forEach((e, i) => { if (i) stack.addSpacer(3); eventLine(stack, e, size, withDate); });
  if (list.length > max) { stack.addSpacer(2); text(stack, `ほか${list.length - max}件`, size * 0.8, COL.muted); }
}
function habitSummary(v) {
  const done = v.habits.filter(h => h.done).length;
  const parts = [];
  if (v.habits.length) parts.push(`習慣 ${done}/${v.habits.length}`);
  if (v.todos && v.todos.length) parts.push(`ToDo ${v.todos.length}`);
  return parts.join('  ');
}
function todoLines(stack, v, max, size) {
  v.todos.slice(0, max).forEach((t, i) => {
    if (i) stack.addSpacer(2);
    const row = stack.addStack();
    row.centerAlignContent();
    text(row, '☐', size, t.overdue ? COL.red : COL.muted, true);
    row.addSpacer(5);
    text(row, t.title, size, t.overdue ? COL.red : COL.text);
  });
  if (v.todos.length > max) { stack.addSpacer(2); text(stack, `ほか${v.todos.length - max}件`, size * 0.8, COL.muted); }
}

function build(v, stale) {
  const fam = config.widgetFamily || 'medium';
  const w = new ListWidget();
  w.backgroundColor = COL.bg;

  const nowHM = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  const next = v.todayEvents.find(e => !e.time || e.time >= nowHM) || v.upcoming[0];
  if (fam === 'accessoryInline') {
    w.addText(next ? `${next.date === v.today ? '' : md(parseYmd(next.date)) + ' '}${next.time || '終日'} ${next.title}` : habitSummary(v) || '予定なし');
    return w;
  }
  if (fam === 'accessoryRectangular') {
    w.addAccessoryWidgetBackground = true;
    text(w, '📅 ひびログ', 11, null, true);
    if (next) text(w, `${next.date === v.today ? '' : md(parseYmd(next.date)) + ' '}${next.time || '終日'} ${next.title}`, 12);
    else text(w, '予定なし', 12);
    const hs = habitSummary(v);
    if (hs) text(w, hs, 11);
    return w;
  }

  if (fam === 'small') {
    w.setPadding(12, 12, 12, 12);
    header(w, 20);
    w.addSpacer(6);
    events(w, v.todayEvents, 3, 12, false, '今日の予定なし');
    w.addSpacer();
    const hs = habitSummary(v);
    if (hs) text(w, hs, 11, COL.muted, true);
  } else if (fam === 'large') {
    w.setPadding(14, 14, 14, 14);
    header(w, 24);
    w.addSpacer(8);
    text(w, '今日', 11, COL.muted, true); w.addSpacer(3);
    events(w, v.todayEvents, 5, 13, false, '予定なし');
    w.addSpacer(8);
    text(w, 'これから（7日間）', 11, COL.muted, true); w.addSpacer(3);
    events(w, v.upcoming, 5, 13, true, '予定なし');
    if (v.todos.length) {
      w.addSpacer(8);
      text(w, 'ToDo（今日まで）', 11, COL.muted, true); w.addSpacer(3);
      todoLines(w, v, 3, 13);
    }
    if (v.habits.length) {
      w.addSpacer(8);
      text(w, '今日の習慣', 11, COL.muted, true); w.addSpacer(3);
      v.habits.slice(0, v.todos.length ? 4 : 6).forEach((h, i) => { if (i) w.addSpacer(2); habitLine(w, h, 13); });
    }
    w.addSpacer();
  } else {
    w.setPadding(12, 14, 12, 14);
    const row = w.addStack();
    const left = row.addStack(); left.layoutVertically();
    header(left, 20);
    left.addSpacer(6);
    if (v.todayEvents.length) events(left, v.todayEvents, 3, 12, false, '');
    else { text(left, '今日の予定なし', 12, COL.muted); left.addSpacer(4); events(left, v.upcoming, v.todos.length ? 1 : 2, 11, true, ''); }
    if (v.todos.length) { left.addSpacer(4); todoLines(left, v, v.todayEvents.length >= 2 ? 1 : 2, 11); }
    left.addSpacer();
    row.addSpacer();
    if (v.habits.length) {
      const right = row.addStack(); right.layoutVertically();
      text(right, habitSummary(v), 11, COL.muted, true);
      right.addSpacer(4);
      v.habits.slice(0, 5).forEach((h, i) => { if (i) right.addSpacer(2); habitLine(right, h, 12); });
      right.addSpacer();
    }
  }
  if (stale) { const t = text(w, 'オフライン表示', 9, COL.muted); t.rightAlignText(); }
  return w;
}

function message(msg) {
  const w = new ListWidget();
  w.backgroundColor = COL.bg;
  w.setPadding(12, 12, 12, 12);
  text(w, 'ひびログ', 13, null, true);
  w.addSpacer(4);
  const t = w.addText(msg);
  t.font = Font.systemFont(11);
  t.textColor = COL.muted;
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
    widget = r.data ? build(view(r.data), r.stale) : message('合言葉が無効です。アプリの「設定」からスクリプトをコピーし直してください。');
  } catch (e) {
    widget = message('読み込めませんでした。ネット接続を確認してください。');
  }
  widget.url = C.appUrl;
}
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();

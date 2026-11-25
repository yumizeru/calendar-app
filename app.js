'use strict';

// HTML に書いたアイコンの目印（<i data-icon="...">）を本物のアイコンにする
hydrateIcons();

/* =====================================================================
 * データ
 *  events     : 予定（形は core.js の説明を参照）
 *  categories : [{ id, name, color, updatedAt, deleted? }]
 *  habits     : 習慣（形は core.js の説明を参照）
 *  todos      : [{ id, title, due, memo, star, done, doneAt, updatedAt, deleted? }]  due は 'YYYY-MM-DD' か ''
 *  marks      : { "YYYY-MM-DD|habitId": { on: bool, t: 更新時刻 } }
 * 削除したものも deleted:true で残す（別の端末と同期するときに「消した」ことを伝えるため）
 * ===================================================================== */
const STORE_KEY = 'hibilog:v1';
const DEFAULT_CATEGORIES = [
  { id: 'cat-work', name: '仕事', color: '#4f7cff', updatedAt: 0 },
  { id: 'cat-private', name: 'プライベート', color: '#22c55e', updatedAt: 0 },
  { id: 'cat-errand', name: '用事・通院', color: '#f59e0b', updatedAt: 0 },
];
const emptyData = () => ({ version: 5, events: [], categories: DEFAULT_CATEGORIES.map(c => ({ ...c })), habits: [], marks: {}, todos: [], templates: [], diary: {}, feeds: [] });

function normalize(d) {
  const out = emptyData();
  if (!d || typeof d !== 'object') return out;
  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  out.events = (Array.isArray(d.events) ? d.events : [])
    .filter(e => e && e.id && (e.deleted || (e.date && e.title)))
    .map(e => ({ ...e, updatedAt: num(e.updatedAt) }));
  if (Array.isArray(d.categories)) {
    const got = d.categories.filter(c => c && c.id && (c.deleted || c.name)).map(c => ({ ...c, updatedAt: num(c.updatedAt) }));
    // 初期カテゴリは、相手側になくても残す（同期で消えないように）
    const ids = new Set(got.map(c => c.id));
    out.categories = [...got, ...DEFAULT_CATEGORIES.filter(c => !ids.has(c.id)).map(c => ({ ...c }))];
  }
  out.habits = (Array.isArray(d.habits) ? d.habits : [])
    .filter(h => h && h.id && (h.deleted || h.name))
    .map(h => ({ ...h, updatedAt: num(h.updatedAt) }));
  out.todos = (Array.isArray(d.todos) ? d.todos : [])
    .filter(x => x && x.id && (x.deleted || x.title))
    .map(x => ({ ...x, updatedAt: num(x.updatedAt) }));
  // 予定のテンプレ：[{ id, title, time, endTime, categoryId, remind, updatedAt, deleted? }]
  out.templates = (Array.isArray(d.templates) ? d.templates : [])
    .filter(x => x && x.id && (x.deleted || x.title))
    .map(x => ({ ...x, updatedAt: num(x.updatedAt) }));
  // ウィジェットの色（テーマ）。どの端末で変えても、最後に変えたものを使う
  if (d.appearance && typeof d.appearance === 'object') out.appearance = { ...d.appearance, t: num(d.appearance.t) };
  // ほかのカレンダー（iPhone・Google）のURL：[{ id, name, url, color, updatedAt, deleted? }]
  out.feeds = (Array.isArray(d.feeds) ? d.feeds : [])
    .filter(x => x && x.id && (x.deleted || x.url))
    .map(x => ({ ...x, updatedAt: num(x.updatedAt) }));
  // 毎朝のまとめ通知：{ on, time: 'HH:MM', tz, wx: { lat, lon, name } | null, t }
  if (d.morning && typeof d.morning === 'object') out.morning = { ...d.morning, t: num(d.morning.t) };
  // 天気の場所（ウィジェットが天気を出すため）：{ lat, lon, name, t } か { off: true, t }
  if (d.wxPlace && typeof d.wxPlace === 'object') out.wxPlace = { ...d.wxPlace, t: num(d.wxPlace.t) };
  // ウィジェットだけの色：{ preset: 'same'（アプリと同じ）| おすすめのid, t }
  if (d.widgetTheme && typeof d.widgetTheme === 'object') out.widgetTheme = { preset: String(d.widgetTheme.preset || 'same'), t: num(d.widgetTheme.t) };
  // ひとこと日記：{ "YYYY-MM-DD": { mood: 1〜5 か 0, text, t } }
  if (d.diary && typeof d.diary === 'object') {
    for (const [k, v] of Object.entries(d.diary)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v === 'object') {
        out.diary[k] = { mood: Math.max(0, Math.min(5, Number(v.mood) || 0)), text: String(v.text || '').slice(0, 300), t: num(v.t) };
      }
    }
  }
  if (d.marks && typeof d.marks === 'object') {
    for (const [k, v] of Object.entries(d.marks)) {
      if (v && typeof v === 'object') {
        const mk = { on: !!v.on, t: num(v.t) };
        if (v.v != null && isFinite(Number(v.v))) mk.v = Number(v.v); // 数値の記録
        out.marks[k] = mk;
      }
    }
  }
  // 旧形式（version 1）の checks: { date: [habitId] } を変換
  if (d.checks && typeof d.checks === 'object') {
    for (const [date, ids] of Object.entries(d.checks)) {
      if (Array.isArray(ids)) for (const hid of ids) {
        const k = `${date}|${hid}`;
        if (!out.marks[k]) out.marks[k] = { on: true, t: 0 };
      }
    }
  }
  return out;
}

// 2つのデータを合わせる：同じものは更新時刻が新しい方を採用
function mergeData(a, b) {
  a = normalize(a); b = normalize(b);
  const byId = (x, y) => {
    const m = new Map();
    for (const it of [...x, ...y]) {
      const cur = m.get(it.id);
      if (!cur || it.updatedAt > cur.updatedAt) m.set(it.id, it);
    }
    return [...m.values()];
  };
  const marks = { ...a.marks };
  for (const [k, v] of Object.entries(b.marks)) {
    if (!marks[k] || v.t > marks[k].t) marks[k] = v;
  }
  const diary = { ...a.diary };
  for (const [k, v] of Object.entries(b.diary)) {
    if (!diary[k] || v.t > diary[k].t) diary[k] = v;
  }
  return {
    version: 5,
    events: byId(a.events, b.events),
    categories: byId(a.categories, b.categories),
    habits: byId(a.habits, b.habits),
    marks,
    todos: byId(a.todos, b.todos),
    templates: byId(a.templates, b.templates),
    diary,
    appearance: !a.appearance ? b.appearance : !b.appearance ? a.appearance : (b.appearance.t > a.appearance.t ? b.appearance : a.appearance),
    feeds: byId(a.feeds, b.feeds),
    morning: !a.morning ? b.morning : !b.morning ? a.morning : (b.morning.t > a.morning.t ? b.morning : a.morning),
    wxPlace: !a.wxPlace ? b.wxPlace : !b.wxPlace ? a.wxPlace : (b.wxPlace.t > a.wxPlace.t ? b.wxPlace : a.wxPlace),
    widgetTheme: !a.widgetTheme ? b.widgetTheme : !b.widgetTheme ? a.widgetTheme : (b.widgetTheme.t > a.widgetTheme.t ? b.widgetTheme : a.widgetTheme),
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyData();
  } catch {
    return emptyData();
  }
}
let data = load();
const listeners = [];
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    toast('保存できませんでした（ストレージがいっぱいか、プライベートモードの可能性があります）');
  }
  listeners.forEach(fn => { try { fn(); } catch {} });
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const activeHabits = () => data.habits.filter(h => !h.deleted);
const activeCategories = () => data.categories.filter(c => !c.deleted);
const NO_CAT_COLOR = '#8b93a7';
const catOf = ev => data.categories.find(c => c.id === ev.categoryId && !c.deleted) || null;
// 共有カレンダー（shared.js）は後から読み込まれるので、使う時点で有無を確かめる
const hasShared = () => typeof Shared !== 'undefined';
const sharedCal = ev => (ev.calendarId && hasShared() ? Shared.calendarById(ev.calendarId) : null);
const hasFeeds = () => typeof Feeds !== 'undefined';
const colorOf = ev => {
  if (ev.feedId) { const f = hasFeeds() ? Feeds.byId(ev.feedId) : null; return f ? f.color : NO_CAT_COLOR; }
  const sc = sharedCal(ev); return sc ? sc.color : ((catOf(ev) || {}).color || NO_CAT_COLOR);
};
// 自分の予定 ＋ 参加している共有カレンダーの予定
// ＋ ほかのカレンダー（iPhone・Google。見るだけ）
const allEvents = () => {
  let list = hasShared() ? data.events.concat(Shared.events()) : data.events;
  if (hasFeeds()) list = list.concat(Feeds.events());
  return list;
};

/* ========== 日付ユーティリティ ========== */
const { pad, ymd, parseYmd, addDays, addDaysStr, diffDays, WD } = Core;
const todayStr = () => ymd(new Date());
const mdw = s => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };

/* ========== 状態 ========== */
let viewMonth = new Date(); viewMonth.setDate(1);
let selected = todayStr();
let currentView = 'calendar';
let calMode = 'month';
try { calMode = localStorage.getItem('hibilog:calMode') || 'month'; } catch {}
let editing = null; // { id, occStart, recurring }

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ========== 習慣の記録 ========== */
const habitById = id => data.habits.find(h => h.id === id && !h.deleted);
const isDoneOn = (h, s) => Core.doneOn(h, data.marks, s);
function toggleCheck(date, hid) {
  const h = habitById(hid);
  const before = h ? Core.streak(h, data.marks, todayStr()).n : 0;
  const m = Core.markOf(data.marks, date, hid);
  data.marks[`${date}|${hid}`] = { on: !(m && m.on), t: Date.now() };
  save();
  if (h) celebrate(h, before);
}
function setValue(date, h, v) {
  const num = v === '' || v == null ? null : Number(v);
  if (num != null && !isFinite(num)) return;
  const before = Core.streak(h, data.marks, todayStr()).n;
  data.marks[`${date}|${h.id}`] = { on: num != null && num >= Number(h.target.value), v: num, t: Date.now() };
  save();
  celebrate(h, before);
}
// 連続記録がバッジの区切り（3・7・14・30…）に届いたら、お祝いを出す
function celebrate(h, before) {
  const st = Core.streak(h, data.marks, todayStr());
  if (st.n > before && Core.BADGE_STEPS.includes(st.n)) {
    setTimeout(() => toast(`「${h.name}」${st.n}${st.unit}連続！バッジを手に入れました`), 50);
  }
}
// 習慣カードのバッジ欄：手に入れたバッジと、次のバッジまでの残り
function badgeHtml(h) {
  const today = todayStr();
  const best = Core.bestStreak(h, data.marks, today);
  const cur = Core.streak(h, data.marks, today);
  const got = Core.BADGE_STEPS.filter(n => n <= best.n);
  // 次は「まだ持っていないバッジ」。今の連続からの残り日数を出す
  const next = Core.BADGE_STEPS.find(n => n > Math.max(best.n, cur.n));
  const chips = got.map(n => `<span class="badge${n === got[got.length - 1] ? ' top' : ''}" title="${n}${best.unit}連続">${icon(n >= 100 ? 'trophy' : n >= 30 ? 'medal' : 'award')}${n}${best.unit}</span>`).join('');
  const nextText = next ? `次のバッジ（${next}${cur.unit}）まで あと${next - cur.n}${cur.unit}` : 'すべてのバッジを手に入れました';
  return `<div class="badges">${chips || `<span class="muted small">まだバッジはありません</span>`}<span class="badge-next">${nextText}</span></div>`;
}
// 数値の習慣は入力欄、チェックの習慣は切り替え
function recordHabit(h, date) {
  if (Core.isNumeric(h)) {
    const cur = Core.valueOn(h, data.marks, date);
    const v = prompt(`${h.name}（${mdw(date)}）\n記録する数値（目標 ${Core.fmtNum(h.target.value)}${h.target.unit || ''}）。空欄で記録を消します`, cur == null ? '' : String(cur));
    if (v === null) return;
    setValue(date, h, v.trim());
  } else {
    toggleCheck(date, h.id);
  }
}
function monthRate(h, month) {
  const y = month.getFullYear(), m = month.getMonth();
  const from = `${y}-${pad(m + 1)}-01`;
  const last = ymd(new Date(y, m + 1, 0));
  const today = todayStr();
  return Core.rate(h, data.marks, from, last < today ? last : today);
}

/* ========== 予定の行（日パネル・週・リストで共通） ========== */
function eventRow(o) {
  const ev = o.ev;
  const bell = ev.remind != null && ev.remind !== '' ? ` <span class="bell" title="リマインダー">${icon('bell')}</span>` : '';
  const rep = ev.repeat ? ` <span class="rep" title="繰り返し">${icon('repeat')}</span>` : '';
  const sc = sharedCal(ev);
  const shared = sc ? ` <span class="shared-tag">${icon('users')}${esc(sc.name)}</span>` : '';
  return `<li data-id="${esc(ev.id)}" data-occ="${esc(o.start)}" style="--c:${esc(colorOf(ev))}">
    <span class="cbar"></span>
    <span class="time">${esc(Core.timeLabel(o))}</span>
    <span class="title">${kindIcon(ev)}${esc(ev.title + Core.kindSuffix(ev, o.start))}${rep}${bell}${shared}${ev.memo ? `<span class="memo">${esc(ev.memo)}</span>` : ''}</span>
  </li>`;
}
const dayOccurrences = day => Core.onDay(allEvents(), day);
// 天気（weather.js）。オフのときや予報がない日は何も出さない
const wx = (kind, s) => (typeof Weather !== 'undefined' ? Weather[kind](s) : '');
// 誕生日はケーキ、記念日はハートのマーク
const kindIcon = ev => (ev.kind === 'birthday' ? `<span class="kind-ico">${icon('cake')}</span>` : ev.kind === 'anniv' ? `<span class="kind-ico">${icon('heart')}</span>` : '');
const evTitle = o => o.ev.title + Core.kindSuffix(o.ev, o.start);

/* ========== 描画：月 ========== */
function renderMonth() {
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
  $('#monthTitle').textContent = `${y}年${m + 1}月`;

  const first = new Date(y, m, 1);
  const start = addDays(first, -first.getDay());
  const from = ymd(start), to = ymd(addDays(start, 41));
  const byDay = {};
  for (const o of Core.expand(allEvents(), from, to)) {
    for (let s = o.start < from ? from : o.start; s <= o.end && s <= to; s = addDaysStr(s, 1)) {
      (byDay[s] = byDay[s] || []).push(o);
    }
  }
  const today = todayStr();
  const habits = activeHabits();
  const todoCount = {};
  for (const t of activeTodos()) if (t.due && !t.done) todoCount[t.due] = (todoCount[t.due] || 0) + 1;

  const style = prefs.monthStyle;
  $('#weekdayHead').hidden = style === 'column';
  $('#grid').hidden = style === 'column';
  $('#monthCol').hidden = style !== 'column';
  if (style === 'column') { renderMonthColumn(y, m, byDay, todoCount, today, habits); return; }
  const big = Number(prefs.font) > 1; // 「大きい」「とても大きい」

  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const s = ymd(d);
    if (i === 35 && d.getMonth() !== m) break; // 6行目が丸ごと翌月なら省く
    const cls = ['cell'];
    if (d.getMonth() !== m) cls.push('other');
    if (d.getDay() === 0) cls.push('sun');
    if (d.getDay() === 6) cls.push('sat');
    const hol = JPHolidays.get(s);
    if (hol) cls.push('holiday');
    if (s === today) cls.push('today');
    if (s === selected) cls.push('selected');
    const evs = (byDay[s] || []).slice().sort((a, b) => ((a.ev.time || '') + a.ev.title).localeCompare((b.ev.time || '') + b.ev.title));
    let evDots, hDots, hl;
    if (big && style !== 'titles') {
      // 大きい文字：小さな点や祝日名は読めないので出さず、件数だけを大きめに出す（詳しくは下の日パネルで）
      evDots = (evs.length ? `<span class="ecount" style="--c:${esc(colorOf(evs[0].ev))}">${evs.length}件</span>` : '') +
        (todoCount[s] ? `<span class="tcount">${icon('square')}${todoCount[s]}</span>` : '');
      hDots = '';
      hl = '';
    } else {
      // 「予定名」スタイルは色付きの帯にタイトルを出す。「シンプル」は色の点だけ
      const maxChips = big ? 2 : 3;
      evDots = style === 'titles'
        ? evs.slice(0, maxChips).map(o => `<span class="echip" style="--c:${esc(colorOf(o.ev))}">${esc(evTitle(o))}</span>`).join('') +
          (evs.length > maxChips ? `<span class="more">+${evs.length - maxChips}</span>` : '') +
          (todoCount[s] ? `<span class="tchip">${icon('square')}${todoCount[s]}</span>` : '')
        : evs.slice(0, 4).map(o => `<span class="edot" style="background:${esc(colorOf(o.ev))}"></span>`).join('') +
          (evs.length > 4 ? `<span class="more">+${evs.length - 4}</span>` : '') +
          (todoCount[s] ? `<span class="tdot" title="ToDo ${todoCount[s]}件"></span>` : '');
      hDots = big ? '' : habits.filter(h => isDoneOn(h, s))
        .map(h => `<span class="dot" style="background:${esc(h.color)}"></span>`).join('');
      hl = hol && !big ? `<span class="hol-name">${esc(hol)}</span>` : '';
    }
    html += `<button class="${cls.join(' ')}" data-date="${s}" aria-label="${d.getMonth() + 1}月${d.getDate()}日${hol ? ' ' + esc(hol) : ''}${evs.length ? ` 予定${evs.length}件` : ''}">
      ${wx('mini', s)}<span class="num">${d.getDate()}</span>${hl}<span class="edots">${evDots}</span><span class="dots">${hDots}</span></button>`;
  }
  $('#grid').innerHTML = html;
}

// 「1列」スタイル：その月の日付を縦に並べ、予定を文字で大きく出す
function renderMonthColumn(y, m, byDay, todoCount, today, habits) {
  const last = new Date(y, m + 1, 0).getDate();
  let html = '';
  for (let i = 1; i <= last; i++) {
    const s = `${y}-${pad(m + 1)}-${pad(i)}`;
    const d = parseYmd(s);
    const hol = JPHolidays.get(s);
    const cls = ['mrow'];
    if (d.getDay() === 0 || hol) cls.push('red'); else if (d.getDay() === 6) cls.push('blue');
    if (s === today) cls.push('today');
    if (s === selected) cls.push('selected');
    if (s !== today && s !== selected && !(byDay[s] || []).length && !todoCount[s] && !hol && !habits.some(h => isDoneOn(h, s)) && !(diaryOf(s) || {}).mood) cls.push('blank');
    const evs = (byDay[s] || []).map(o => ({ ...o, day: s }))
      .sort((a, b) => ((a.start < s ? '' : (a.ev.time || '')) + a.ev.title).localeCompare((b.start < s ? '' : (b.ev.time || '')) + b.ev.title));
    const lines = evs.slice(0, 4).map(o => `<span class="mline" style="--c:${esc(colorOf(o.ev))}"><i></i><span class="t">${esc(Core.timeLabel(o))}</span><span class="tt">${esc(evTitle(o))}</span></span>`).join('') +
      (evs.length > 4 ? `<span class="mline more-line">ほか${evs.length - 4}件</span>` : '');
    const hDots = habits.filter(h => isDoneOn(h, s)).map(h => `<span class="dot" style="background:${esc(h.color)}"></span>`).join('');
    const extra = (todoCount[s] ? `<span class="mtag">${icon('square')}ToDo ${todoCount[s]}</span>` : '') + (hDots ? `<span class="mdots">${hDots}</span>` : '');
    html += `<button class="${cls.join(' ')}" data-date="${s}" aria-label="${m + 1}月${i}日${hol ? ' ' + esc(hol) : ''}${evs.length ? ` 予定${evs.length}件` : ''}">
      <span class="mdate"><b>${i}</b><small>${WD[d.getDay()]}</small>${(() => { const m = moodOf((diaryOf(s) || {}).mood); return m ? `<span class="mmood" style="color:${m.color}" title="${m.name}">${icon(m.icon)}</span>` : ''; })()}</span>
      <span class="mbody">${wx('short', s)}${hol ? `<span class="hol-badge">${esc(hol)}</span>` : ''}${lines}${extra ? `<span class="mextra">${extra}</span>` : ''}</span>
    </button>`;
  }
  $('#monthCol').innerHTML = html;
  // 月を開いたとき・今日に戻ったときだけ、選んでいる日（ふつうは今日）まで自動で移動
  if (scrollColPending) {
    scrollColPending = false;
    const row = $('#monthCol .mrow.selected') || $('#monthCol .mrow.today');
    if (row && row.dataset.date !== `${y}-${pad(m + 1)}-01`) {
      requestAnimationFrame(() => row.scrollIntoView({ block: 'center' }));
    } else {
      window.scrollTo(0, 0);
    }
  }
}
let scrollColPending = true;

/* ========== 見やすさの設定（この端末だけ） ========== */
const PREFS_KEY = 'hibilog:prefs';
const prefs = { monthStyle: 'dots', font: '1', contrast: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch {}
const MONTH_HINTS = {
  dots: '予定を色の点で表示します。ひと目で月全体を見たいときに。',
  titles: '予定の名前を日付のマスに表示します（長い名前は途中まで）。',
  column: '1か月の日付を縦に1列で並べ、予定を大きな文字で表示します。',
};
function applyPrefs() {
  document.documentElement.style.setProperty('--fs', prefs.font);
  document.documentElement.dataset.fs = prefs.font;
  document.body.classList.toggle('hc', !!prefs.contrast);
  document.body.dataset.monthStyle = prefs.monthStyle;
  document.querySelectorAll('#prefMonthStyle .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.v === prefs.monthStyle));
  document.querySelectorAll('#prefFont .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.v === String(prefs.font)));
  $('#prefContrast').checked = !!prefs.contrast;
  $('#prefMonthHint').textContent = prefs.monthStyle === 'dots' && Number(prefs.font) > 1
    ? '日付と予定の件数を大きく表示します（予定の中身は日付をタップすると下に出ます）。'
    : (MONTH_HINTS[prefs.monthStyle] || '');
  // 大きい文字を選んでいて、まだ「1列」でなければ、1列をすすめる説明を出す
  $('#prefFontTip').hidden = !(Number(prefs.font) > 1 && prefs.monthStyle !== 'column');
  if (typeof Updater !== 'undefined') updateSettingsSummary();
}
/* ========== ウィジェットの色をテーマに合わせる ========== */
// テーマを変えたら、その色を同期データに入れる（ウィジェットが読む）
function syncAppearance() {
  if (typeof Theme === 'undefined') return;
  const c = Theme.widgetColors(data.widgetTheme);
  const { t, ...cur } = data.appearance || {};
  if (JSON.stringify(cur) === JSON.stringify(c)) return;
  data.appearance = { ...c, t: Date.now() };
  save();
}

// ウィジェットだけ別の色にする（'same' ならアプリと同じ）
function setWidgetTheme(id) {
  data.widgetTheme = { preset: id, t: Date.now() };
  save();
  syncAppearance();
  if (typeof Theme !== 'undefined') Theme.renderWidgetPicker();
  toast('ウィジェットの色を変えました。次にウィジェットが新しくなるときに変わります');
}

/* ========== 設定：開いている項目の「閉じる」ボタン ========== */
const openSettingsSections = () => [...document.querySelectorAll('#view-settings details.acc[open]')];
// 項目を開いているときは、左上に×、タイトルにその項目の名前を出す
function syncSettingsHeader() {
  if (currentView !== 'settings') { $('#closeSection').hidden = true; return; }
  const open = openSettingsSections();
  $('#closeSection').hidden = !open.length;
  $('#monthTitle').textContent = open.length === 1 ? open[0].querySelector('.acc-text b').textContent : '設定';
}
function closeSettingsSections() {
  const open = openSettingsSections();
  if (!open.length) return;
  const first = open[0];
  open.forEach(d => { d.open = false; });
  syncSettingsHeader();
  // 閉じた項目が見える位置まで戻る
  const top = first.getBoundingClientRect().top + window.scrollY - $('.topbar').offsetHeight - 8;
  window.scrollTo({ top: Math.max(0, top) });
}
$('#closeSection').addEventListener('click', closeSettingsSections);
// 項目を開け閉めしたら、ボタンとタイトルを合わせる（ほかの項目を開いたら前の項目は閉じる）
document.querySelectorAll('#view-settings details.acc').forEach(d => d.addEventListener('toggle', () => {
  if (d.open && !(typeof Tour !== 'undefined' && Tour.active)) {
    openSettingsSections().forEach(x => { if (x !== d) x.open = false; });
  }
  syncSettingsHeader();
}));

// 設定の各項目を閉じたときに右に出す「今の状態」
function updateSettingsSummary() {
  const fontName = { '1': '標準', '1.18': '大きい', '1.36': 'とても大きい' }[String(prefs.font)] || '標準';
  const styleName = { dots: 'シンプル', titles: '予定名', column: '1列' }[prefs.monthStyle] || 'シンプル';
  $('#sumView').textContent = `文字：${fontName} ・ 月表示：${styleName}${prefs.contrast ? ' ・ くっきり' : ''}`;
  $('#sumCat').textContent = `${activeCategories().length}個`;
  if (typeof Theme !== 'undefined') $('#sumTheme').textContent = Theme.label();
  if (typeof Weather !== 'undefined') $('#sumWeather').textContent = Weather.summary();
  $('#sumAbout').textContent = `バージョン ${Updater.version}`;
  const loggedIn = typeof Cloud !== 'undefined' && !!Cloud.session;
  $('#widgetLoginNote').hidden = loggedIn;
}

function setPref(k, v) {
  if (k === 'monthStyle' && v === 'column') scrollColPending = true;
  prefs[k] = v;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
  applyPrefs();
  render();
}

/* ========== 描画：週 ========== */
function weekStartOf(s) { const d = parseYmd(s); return ymd(addDays(d, -d.getDay())); }
function renderWeek() {
  const ws = weekStartOf(selected);
  const we = addDaysStr(ws, 6);
  const a = parseYmd(ws), b = parseYmd(we);
  $('#monthTitle').textContent = `${a.getMonth() + 1}/${a.getDate()} 〜 ${b.getMonth() + 1}/${b.getDate()}`;
  const today = todayStr();
  let html = '';
  for (let i = 0; i < 7; i++) {
    const s = addDaysStr(ws, i);
    const d = parseYmd(s);
    const hol = JPHolidays.get(s);
    const red = d.getDay() === 0 || hol;
    const occ = dayOccurrences(s);
    const tds = activeTodos().filter(t => t.due === s).sort(todoSort);
    html += `<div class="ag-day${s === selected ? ' selected' : ''}${s === today ? ' is-today' : ''}" data-date="${s}">
      <div class="ag-head${red ? ' red' : d.getDay() === 6 ? ' blue' : ''}"><b>${d.getDate()}</b> ${WD[d.getDay()]}${hol ? ` <span class="hol-badge">${esc(hol)}</span>` : ''}${wx('short', s)}<button class="ag-add" data-add="${s}" aria-label="${d.getMonth() + 1}月${d.getDate()}日に予定を追加">＋</button></div>
      <ul class="event-list">${occ.length ? occ.map(o => eventRow({ ...o, day: s })).join('') : (tds.length ? '' : '<li class="empty">予定なし</li>')}</ul>
      ${tds.length ? `<ul class="todo-list compact">${tds.map(t => todoRow(t, { hideDue: true })).join('')}</ul>` : ''}
    </div>`;
  }
  $('#weekView').innerHTML = html;
}

/* ========== 描画：リスト（今日から60日） ========== */
function renderList() {
  $('#monthTitle').textContent = 'これからの予定';
  const from = todayStr(), to = addDaysStr(from, 59);
  const occ = Core.expand(allEvents(), from, to);
  const byDay = {};
  for (const o of occ) {
    const s = o.start < from ? from : o.start; // 複数日の予定は始まりの日（または今日）に1回だけ出す
    (byDay[s] = byDay[s] || []).push({ ...o, day: s });
  }
  // 期限つきの未完了ToDoも並べる（期限切れは今日の欄へ）
  const todoByDay = {};
  for (const t of activeTodos()) {
    if (t.done || !t.due || t.due > to) continue;
    const s = t.due < from ? from : t.due;
    (todoByDay[s] = todoByDay[s] || []).push(t);
  }
  const days = [...new Set([...Object.keys(byDay), ...Object.keys(todoByDay)])].sort();
  let html = `<div class="ag-toolbar"><span class="muted small">今日から60日間</span><button class="btn primary" data-add="${from}">＋ 予定</button></div>`;
  if (!days.length) html += '<p class="empty">これからの予定はありません</p>';
  for (const s of days) {
    const d = parseYmd(s);
    const hol = JPHolidays.get(s);
    const list = (byDay[s] || []).sort((x, y) => ((x.ev.time || '') + x.ev.title).localeCompare((y.ev.time || '') + y.ev.title));
    const tds = (todoByDay[s] || []).sort(todoSort);
    html += `<div class="ag-day" data-date="${s}">
      <div class="ag-head${d.getDay() === 0 || hol ? ' red' : d.getDay() === 6 ? ' blue' : ''}"><b>${d.getMonth() + 1}/${d.getDate()}</b> ${WD[d.getDay()]}${s === from ? ' <span class="today-badge">今日</span>' : ''}${hol ? ` <span class="hol-badge">${esc(hol)}</span>` : ''}${wx('short', s)}</div>
      ${list.length ? `<ul class="event-list">${list.map(o => eventRow(o)).join('')}</ul>` : ''}
      ${tds.length ? `<ul class="todo-list compact">${tds.map(t => todoRow(t, { hideDue: t.due === s })).join('')}</ul>` : ''}
    </div>`;
  }
  $('#listView').innerHTML = html;
}

/* ========== 描画：選んだ日のパネル ========== */
function renderDay() {
  const d = parseYmd(selected);
  const hol = JPHolidays.get(selected);
  $('#dayTitle').innerHTML = `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）` +
    (hol ? ` <span class="hol-badge">${esc(hol)}</span>` : '');
  $('#dayWeather').innerHTML = wx('line', selected);
  const occ = dayOccurrences(selected);
  $('#eventList').innerHTML = occ.length
    ? occ.map(o => eventRow(o)).join('')
    : '<li class="empty" style="cursor:default">予定はありません</li>';

  const todos = todosForDay(selected);
  $('#dayTodosWrap').hidden = !todos.length;
  $('#dayTodos').innerHTML = todos.map(t => todoRow(t, { hideDue: t.due === selected })).join('');

  const habits = activeHabits();
  $('#habitChecks').innerHTML = habits.length
    ? habits.map(h => habitDayRow(h, selected)).join('')
    : '<li class="empty">「習慣」タブから習慣を追加できます</li>';
  renderDiary();
}

/* ========== ひとこと日記・気分 ========== */
const MOODS = [
  { v: 1, icon: 'frown',   name: 'つらい',   color: '#6366f1' },
  { v: 2, icon: 'annoyed', name: 'いまいち', color: '#0ea5e9' },
  { v: 3, icon: 'meh',     name: 'ふつう',   color: '#94a3b8' },
  { v: 4, icon: 'smile',   name: 'いい',     color: '#22c55e' },
  { v: 5, icon: 'laugh',   name: 'さいこう', color: '#f59e0b' },
];
const moodOf = v => MOODS.find(m => m.v === v) || null;
const diaryOf = s => (data.diary && data.diary[s]) || null;
function renderDiary() {
  const dy = diaryOf(selected);
  $('#moodRow').innerHTML = MOODS.map(m => `<button type="button" class="mood${dy && dy.mood === m.v ? ' on' : ''}" data-mood="${m.v}" style="--mc:${m.color}" aria-pressed="${dy && dy.mood === m.v ? 'true' : 'false'}">${icon(m.icon)}<span>${m.name}</span></button>`).join('');
  if (document.activeElement !== $('#diaryText')) $('#diaryText').value = dy ? dy.text : '';
}
function setDiary(patch) {
  data.diary = data.diary || {};
  const cur = data.diary[selected] || { mood: 0, text: '' };
  const next = { ...cur, ...patch, t: Date.now() };
  if (!next.mood && !next.text) next.text = ''; // 空でも「消した」ことを同期で伝えるため残す
  data.diary[selected] = next;
  save();
}
$('#moodRow').addEventListener('click', e => {
  const b = e.target.closest('[data-mood]');
  if (!b) return;
  const v = Number(b.dataset.mood);
  const cur = diaryOf(selected);
  setDiary({ mood: cur && cur.mood === v ? 0 : v }); // 同じ気分をもう一度押すと取り消し
  renderDiary();
  if (currentView === 'calendar' && prefs.monthStyle === 'column') renderMonth();
});
let diaryTimer = null;
$('#diaryText').addEventListener('input', () => {
  clearTimeout(diaryTimer);
  diaryTimer = setTimeout(() => setDiary({ text: $('#diaryText').value.trim().slice(0, 300) }), 600);
});
$('#diaryText').addEventListener('blur', () => {
  clearTimeout(diaryTimer);
  const v = $('#diaryText').value.trim().slice(0, 300);
  const cur = diaryOf(selected);
  if ((cur ? cur.text : '') !== v) setDiary({ text: v });
});

// 日パネルの習慣1行
function habitDayRow(h, s) {
  const due = Core.isDue(h, s);
  const done = isDoneOn(h, s);
  const weekly = Core.freqOf(h).type === 'weekly'
    ? `<span class="hint-chip">今週 ${Core.weekCount(h, data.marks, s)}/${Core.weekNeed(h)}回</span>` : '';
  const rest = due ? '' : '<span class="hint-chip">お休みの日</span>';
  if (Core.isNumeric(h)) {
    const v = Core.valueOn(h, data.marks, s);
    return `<li class="${due ? '' : 'not-due'}"><div class="num-row">
      <span class="dot big" style="background:${esc(h.color)}"></span>
      <span class="hname">${esc(h.name)}${weekly}${rest}</span>
      <input class="num-input${done ? ' done' : ''}" type="number" inputmode="decimal" step="any" min="0" data-num="${esc(h.id)}" value="${v == null ? '' : esc(v)}" placeholder="0" style="--c:${esc(h.color)}" aria-label="${esc(h.name)}の記録">
      <span class="unit">/ ${esc(Core.fmtNum(h.target.value))}${esc(h.target.unit || '')}</span>
    </div></li>`;
  }
  return `<li class="${due ? '' : 'not-due'}"><label>
    <input type="checkbox" class="check" data-hid="${esc(h.id)}" style="--c:${esc(h.color)}" ${done ? 'checked' : ''}>
    <span class="hname">${esc(h.name)}${weekly}${rest}</span></label></li>`;
}

function renderCalendar() {
  document.querySelectorAll('.seg-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === calMode));
  $('#monthView').hidden = calMode !== 'month';
  $('#weekView').hidden = calMode !== 'week';
  $('#listView').hidden = calMode !== 'list';
  $('#dayPanel').hidden = calMode === 'list';
  if (calMode === 'month') renderMonth();
  else if (calMode === 'week') renderWeek();
  else renderList();
  if (calMode !== 'list') renderDay();
}

/* ========== 描画：習慣 ========== */
function renderHabits() {
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
  $('#monthTitle').textContent = `${y}年${m + 1}月`;
  const today = todayStr();
  const week = Array.from({ length: 7 }, (_, i) => addDaysStr(today, i - 6));
  const habits = activeHabits();

  $('#habitList').innerHTML = habits.length
    ? habits.map(h => {
        const r = monthRate(h, viewMonth);
        const st = Core.streak(h, data.marks, today);
        const num = Core.isNumeric(h);
        const cells = week.map(s => {
          const d = parseYmd(s);
          const v = num ? Core.valueOn(h, data.marks, s) : null;
          const cls = [isDoneOn(h, s) ? 'on' : '', Core.isDue(h, s) ? '' : 'rest', v != null && !isDoneOn(h, s) ? 'part' : ''].join(' ');
          return `<button class="${cls}" data-hid="${esc(h.id)}" data-date="${s}" style="--c:${esc(h.color)}" aria-label="${d.getMonth() + 1}月${d.getDate()}日">
            ${WD[d.getDay()]}<b>${num && v != null ? esc(Core.fmtNum(v)) : d.getDate()}</b></button>`;
        }).join('');
        const tags = [Core.freqLabel(h)];
        if (num) tags.push(`目標 ${Core.fmtNum(h.target.value)}${h.target.unit || ''}`);
        if (h.remindAt) tags.push(`通知 ${h.remindAt}`);
        const weekly = Core.freqOf(h).type === 'weekly';
        const open = openHabitStats.has(h.id);
        return `<li>
          <div class="habit-top">
            <span class="dot" style="background:${esc(h.color)};width:12px;height:12px"></span>
            <span class="name">${esc(h.name)}<span class="tags">${tags.map(esc).join(' ・ ')}</span></span>
            <button class="btn small" data-edit="${esc(h.id)}">編集</button>
          </div>
          <div class="habit-stats">
            <div><b>${st.n}${st.unit}</b>連続</div>
            <div><b>${r.pct}%</b>${m + 1}月の達成率</div>
            ${weekly
              ? `<div><b>${Core.weekCount(h, data.marks, today)}/${Core.weekNeed(h)}</b>今週の回数</div>`
              : `<div><b>${r.done}/${r.total}</b>日</div>`}
          </div>
          ${badgeHtml(h)}
          <div class="week">${cells}</div>
          <button class="stats-toggle" data-stats="${esc(h.id)}">${open ? '振り返りを閉じる ▴' : '振り返り（1年・月ごと） ▾'}</button>
          ${open ? habitStatsHtml(h) : ''}
        </li>`;
      }).join('')
    : '<li class="empty">まだ習慣がありません。「＋ 習慣を追加」から作ってください。</li>';
}

const openHabitStats = new Set();
// 振り返り：1年分のヒートマップと、12か月の達成率
function habitStatsHtml(h) {
  const today = todayStr();
  const end = addDaysStr(Core.weekStart(today), 6);          // 今週の土曜まで
  const start = addDaysStr(Core.weekStart(today), -52 * 7);  // 53週ぶん
  let cells = '';
  const monthLabels = [];
  for (let w = 0; w < 53; w++) {
    const ws = addDaysStr(start, w * 7);
    const d = parseYmd(ws);
    if (d.getDate() <= 7) monthLabels.push(`<span style="grid-column:${w + 1}">${d.getMonth() + 1}月</span>`);
    for (let i = 0; i < 7; i++) {
      const s = addDaysStr(ws, i);
      if (s > today) { cells += '<i class="hm future"></i>'; continue; }
      const lv = Core.level(h, data.marks, s);
      cells += `<i class="hm l${lv < 0 ? 'x' : lv}" title="${s}"></i>`;
    }
  }
  const bars = [];
  const now = parseYmd(today);
  for (let k = 11; k >= 0; k--) {
    const r = monthRate(h, new Date(now.getFullYear(), now.getMonth() - k, 1));
    const mm = new Date(now.getFullYear(), now.getMonth() - k, 1).getMonth() + 1;
    bars.push(`<div class="bar" title="${mm}月 ${r.pct}%"><span class="pct">${r.total ? r.pct : ''}</span><i style="height:${r.pct}%"></i><span class="mon">${mm}</span></div>`);
  }
  const y = Core.rate(h, data.marks, addDaysStr(today, -364), today);
  return `<div class="hstats" style="--c:${esc(h.color)}">
    <div class="hstats-head">この1年：達成率 <b>${y.pct}%</b>（${y.done}/${y.total}）</div>
    <div class="hm-wrap"><div class="hm-months">${monthLabels.join('')}</div><div class="hm-grid">${cells}</div></div>
    <div class="hm-legend">少 <i class="hm l0"></i><i class="hm l1"></i><i class="hm l2"></i><i class="hm l3"></i><i class="hm l4"></i> 多</div>
    <div class="hstats-head">月ごとの達成率（%）</div>
    <div class="bars">${bars.join('')}</div>
  </div>`;
}

/* ========== 描画：カテゴリ（設定） ========== */
function renderCategories() {
  const cats = activeCategories();
  $('#catList').innerHTML = cats.map(c => `<li>
    <input type="color" value="${esc(c.color)}" data-cat-color="${esc(c.id)}" aria-label="${esc(c.name)}の色">
    <span class="name">${esc(c.name)}</span>
    <button class="btn small" data-cat-rename="${esc(c.id)}">名前変更</button>
    <button class="btn small danger" data-cat-del="${esc(c.id)}">削除</button>
  </li>`).join('') || '<li class="empty">カテゴリがありません</li>';
}

function render() {
  if (currentView === 'calendar') renderCalendar();
  else if (currentView === 'habits') renderHabits();
  else if (currentView === 'todos') renderTodos();
  else { renderCategories(); updateSettingsSummary(); if (typeof Theme !== 'undefined') Theme.renderWidgetPicker(); }
  syncSettingsHeader();
  updateTodoBadge();
  const showNav = currentView === 'habits' || (currentView === 'calendar' && calMode !== 'list');
  $('#prevMonth').style.visibility = showNav ? '' : 'hidden';
  $('#nextMonth').style.visibility = showNav ? '' : 'hidden';
}

/* ========== トースト ========== */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ========== 「この予定だけ／すべて」を選ぶ ========== */
function askScope(title) {
  return new Promise(resolve => {
    const d = $('#scopeDialog');
    $('#scopeTitle').textContent = title;
    const done = v => { d.close(); d.removeEventListener('click', onClick); resolve(v); };
    const onClick = e => {
      const b = e.target.closest('[data-scope]');
      if (b) done(b.dataset.scope);
      else if (e.target === d) done('cancel');
    };
    d.addEventListener('click', onClick);
    d.addEventListener('cancel', () => done('cancel'), { once: true });
    d.showModal();
  });
}

/* ========== 予定ダイアログ ========== */
const dlg = $('#eventDialog');
function fillCategorySelect(value) {
  $('#evCategory').innerHTML = '<option value="">なし</option>' +
    activeCategories().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('#evCategory').value = value && activeCategories().some(c => c.id === value) ? value : '';
}
function setWeekdayChips(days) {
  document.querySelectorAll('#evWeekdays button').forEach(b => b.classList.toggle('on', days.includes(Number(b.dataset.wd))));
}
const chosenWeekdays = () => [...document.querySelectorAll('#evWeekdays button.on')].map(b => Number(b.dataset.wd));
function syncDialogUi() {
  const kind = $('#evKind').value;
  $('#evKindHint').hidden = !kind;
  if (kind) { $('#evAllDay').checked = true; $('#evRepeat').value = 'yearly'; }
  $('#evAllDay').disabled = !!kind;
  $('#evRepeat').disabled = !!kind;
  const allDay = $('#evAllDay').checked;
  document.querySelectorAll('#eventForm .time-field').forEach(el => { el.hidden = allDay; });
  const r = $('#evRepeat').value;
  $('#repeatOpts').hidden = !r;
  $('#evWeekdays').hidden = !(r === 'weekly' || r === 'biweekly');
}

// 予定がどこにあるか：'' = 自分の予定、それ以外 = 共有カレンダーの id
const findEvent = id => data.events.find(x => x.id === id && !x.deleted) || (hasShared() ? Shared.find(id) : null);

function fillCalendarSelect(value) {
  const cals = hasShared() && Cloud.session ? Shared.calendars() : [];
  $('#evCalRow').hidden = !cals.length;
  $('#evCal').innerHTML = '<option value="">自分だけ</option>' +
    cals.map(c => `<option value="${esc(c.id)}">共有：${esc(c.name)}</option>`).join('');
  $('#evCal').value = value && cals.some(c => c.id === value) ? value : '';
  syncCalUi();
}
// 共有カレンダーの予定は、カレンダーの色で表示するのでカテゴリは使わない
function syncCalUi() { $('#evCategoryRow').hidden = !!$('#evCal').value; }

function openEvent(id, occStart, newDate) {
  if (id && String(id).startsWith('feed:') && hasFeeds()) { Feeds.show(id); return; }
  const ev = id ? findEvent(id) : null;
  editing = ev ? { id: ev.id, occStart: occStart || ev.date, recurring: !!ev.repeat, store: ev.calendarId || '' } : null;
  fillCalendarSelect(ev ? (ev.calendarId || '') : '');
  const info = $('#evSharedInfo');
  info.hidden = !(ev && ev.calendarId);
  if (ev && ev.calendarId) {
    const who = Shared.memberName(ev.calendarId, ev.updatedBy);
    const when = ev.sharedUpdatedAt ? new Date(ev.sharedUpdatedAt) : null;
    info.innerHTML = icon('users') + esc(`共有の予定${who ? ` ・ 最後に変更：${who}` : ''}${when ? `（${when.getMonth() + 1}/${when.getDate()} ${pad(when.getHours())}:${pad(when.getMinutes())}）` : ''}`);
  }
  const start = ev ? (occStart || ev.date) : (newDate || selected);
  const dur = ev ? Core.duration(ev) : 0;
  $('#eventDialogTitle').textContent = ev ? '予定を編集' : '予定を追加';
  $('#evTitle').value = ev ? ev.title : '';
  $('#evAllDay').checked = ev ? !ev.time : false;
  $('#evDate').value = start;
  $('#evTime').value = ev ? (ev.time || '') : '';
  $('#evEndDate').value = ev && dur ? addDaysStr(start, dur) : '';
  $('#evEndTime').value = ev ? (ev.endTime || '') : '';
  fillCategorySelect(ev ? ev.categoryId : '');
  const r = ev && ev.repeat;
  $('#evRepeat').value = !r ? '' : (r.freq === 'weekly' && Number(r.interval) === 2 ? 'biweekly' : r.freq);
  setWeekdayChips(r && r.byWeekday && r.byWeekday.length ? r.byWeekday : [parseYmd(start).getDay()]);
  $('#evUntil').value = r && r.until ? r.until : '';
  $('#evMemo').value = ev ? (ev.memo || '') : '';
  $('#evRemind').value = ev && ev.remind != null ? String(ev.remind) : '';
  $('#evDelete').hidden = !ev;
  $('#evKind').value = ev && ev.kind ? ev.kind : '';
  renderTemplateRow(!ev);
  resetQuick(!ev);
  syncDialogUi();
  dlg.showModal();
  setTimeout(() => { if (!ev) $('#evQuick').focus(); }, 50);
}

function readForm() {
  const allDay = $('#evAllDay').checked;
  const date = $('#evDate').value;
  let endDate = $('#evEndDate').value;
  const time = allDay ? '' : $('#evTime').value;
  const endTime = allDay ? '' : $('#evEndTime').value;
  if (endDate && endDate <= date) endDate = '';
  const rv = $('#evRepeat').value;
  let repeat = null;
  if (rv) {
    repeat = { freq: rv === 'biweekly' ? 'weekly' : rv, interval: rv === 'biweekly' ? 2 : 1 };
    if (repeat.freq === 'weekly') repeat.byWeekday = chosenWeekdays().length ? chosenWeekdays() : [parseYmd(date).getDay()];
    if ($('#evUntil').value) repeat.until = $('#evUntil').value;
  }
  const kind = $('#evKind').value || '';
  if (kind) repeat = { freq: 'yearly', interval: 1 }; // 誕生日・記念日は毎年
  return {
    title: $('#evTitle').value.trim(),
    date, time: kind ? '' : time, endDate: kind ? '' : endDate, endTime: kind ? '' : endTime,
    kind,
    categoryId: $('#evCategory').value || '',
    repeat,
    memo: $('#evMemo').value.trim(),
    // 何分前に通知するか（null なら通知なし）。終日の予定は当日 9:00 を基準にする
    remind: $('#evRemind').value === '' ? null : Number($('#evRemind').value),
  };
}

function validate(f) {
  if (!f.title || !f.date) return 'タイトルと開始日を入れてください';
  const sameDay = !f.endDate || f.endDate === f.date;
  if (sameDay && f.time && f.endTime && f.endTime <= f.time) return '終了時刻は開始時刻より後にしてください';
  if (!f.time && f.endTime) return '終了時刻だけを入れることはできません';
  if (f.repeat && f.repeat.until && f.repeat.until < f.date) return '繰り返しの終わりは開始日より後にしてください';
  return null;
}

$('#eventForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = readForm();
  const err = validate(f);
  if (err) { toast(err); return; }
  const now = Date.now();
  const wasEditing = !!editing;
  const target = $('#evCal').value || '';
  if (target) f.categoryId = '';

  // 変更をためておき、最後に「自分の予定」と「共有カレンダー」へまとめて反映する
  const tx = newTx();

  if (!editing) {
    tx.put({ id: uid(), ...f, exdates: [], updatedAt: now }, target);
  } else {
    const src = editing.store;
    const cur = { ...findEvent(editing.id) };
    let scope = 'all';
    if (editing.recurring) {
      scope = await askScope('繰り返しの予定を変更します');
      if (scope === 'cancel') return;
    }
    if (scope === 'one') {
      // この回だけ：元の繰り返しからこの日を外し、別の予定として切り離す
      tx.put({ ...cur, exdates: [...new Set([...(cur.exdates || []), editing.occStart])], updatedAt: now }, src);
      tx.put({ id: uid(), ...f, repeat: null, exdates: [], parentId: cur.id, origDate: editing.occStart, updatedAt: now }, target);
    } else {
      let next;
      if (editing.recurring && f.repeat) {
        // すべて：開いた回でずらした日数ぶん、繰り返し全体をずらす
        const shift = diffDays(editing.occStart, f.date);
        const dur = f.endDate ? diffDays(f.date, f.endDate) : 0;
        const newStart = addDaysStr(cur.date, shift);
        next = { ...cur, ...f, date: newStart, endDate: dur ? addDaysStr(newStart, dur) : '',
          exdates: (cur.exdates || []).map(x => addDaysStr(x, shift)), updatedAt: now };
        if (f.repeat.until && f.repeat.until < newStart) next.repeat = { ...f.repeat, until: undefined };
      } else {
        next = { ...cur, ...f, exdates: f.repeat ? (cur.exdates || []) : [], updatedAt: now };
      }
      if (src !== target) tx.drop(cur, src); // カレンダーを移した
      tx.put(next, target);
    }
  }
  if (!(await tx.commit())) return;
  selected = f.date;
  const d = parseYmd(f.date);
  viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  dlg.close();
  render();
  toast(wasEditing ? '予定を更新しました' : (target ? '共有カレンダーに追加しました' : '予定を追加しました'));
});

$('#evDelete').addEventListener('click', async () => {
  if (!editing) return;
  const src = editing.store;
  const cur = { ...findEvent(editing.id) };
  const now = Date.now();
  const tx = newTx();
  if (editing.recurring) {
    const scope = await askScope('繰り返しの予定を削除します');
    if (scope === 'cancel') return;
    if (scope === 'one') {
      tx.put({ ...cur, exdates: [...new Set([...(cur.exdates || []), editing.occStart])], updatedAt: now }, src);
    } else {
      // 繰り返し本体と、そこから切り離した回もまとめて消す
      tx.drop(cur, src);
      for (const x of allEvents()) if (x.parentId === cur.id && !x.deleted) tx.drop(x, x.calendarId || '');
    }
  } else {
    if (!confirm(src ? 'この予定を削除しますか？（共有している全員から消えます）' : 'この予定を削除しますか？')) return;
    tx.drop(cur, src);
  }
  if (!(await tx.commit())) return;
  dlg.close();
  render();
  toast('予定を削除しました');
});

// 自分の予定（data.events）と共有カレンダーへの変更をまとめて行う
function newTx() {
  let personal = false;
  const changed = [], removed = [];
  return {
    put(ev, store) {
      if (!store) {
        const { calendarId, updatedBy, sharedUpdatedAt, ...clean } = ev;
        const i = data.events.findIndex(x => x.id === clean.id);
        if (i >= 0) data.events[i] = clean; else data.events.push(clean);
        personal = true;
      } else {
        changed.push({ ...ev, calendarId: store });
      }
    },
    drop(ev, store) {
      if (!store) {
        data.events = data.events.map(x => x.id === ev.id ? { id: x.id, deleted: true, updatedAt: Date.now() } : x);
        personal = true;
      } else {
        removed.push(ev.id);
      }
    },
    async commit() {
      if (changed.length || removed.length) {
        if (!Cloud.session) { toast('共有カレンダーを使うにはログインが必要です'); return false; }
        try {
          // 同じ予定を消してから入れ直す場合（共有→共有の移動）に備えて、入れるものは消す対象から外す
          const keep = new Set(changed.map(x => x.id));
          await Shared.commit(changed, removed.filter(id => !keep.has(id)));
        } catch (e) {
          console.warn(e);
          toast('共有カレンダーに保存できませんでした（ネット接続を確認してください）');
          if (personal) data = load(); // 自分の予定側の途中の変更も取り消す
          Shared.refresh();
          return false;
        }
      }
      if (personal) save();
      return true;
    },
  };
}
$('#evCal').addEventListener('change', syncCalUi);
$('#evKind').addEventListener('change', syncDialogUi);

/* ========== 予定のテンプレ（よく使う予定をワンタップで） ========== */
const activeTemplates = () => (data.templates || []).filter(t => !t.deleted);
// 新しい予定を作るときだけ、上にテンプレを並べる
function renderTemplateRow(isNew) {
  const list = activeTemplates();
  const row = $('#tplRow');
  row.hidden = !isNew || !list.length;
  row.innerHTML = `<span class="tpl-label">${icon('bookmark')}テンプレ</span>` + list.map(t =>
    `<span class="tpl-chip"><button type="button" data-tpl="${esc(t.id)}">${esc(t.title)}${t.time ? ` <small>${esc(t.time)}</small>` : ''}</button>` +
    `<button type="button" class="tpl-del" data-tpl-del="${esc(t.id)}" aria-label="${esc(t.title)}のテンプレを消す">${icon('x')}</button></span>`).join('');
  $('#evSaveTpl').hidden = !!$('#evKind').value;
}
$('#tplRow').addEventListener('click', e => {
  const del = e.target.closest('[data-tpl-del]');
  if (del) {
    const t = activeTemplates().find(x => x.id === del.dataset.tplDel);
    if (t && confirm(`テンプレ「${t.title}」を消しますか？`)) {
      data.templates = data.templates.map(x => x.id === t.id ? { id: t.id, deleted: true, updatedAt: Date.now() } : x);
      save(); renderTemplateRow(true);
    }
    return;
  }
  const b = e.target.closest('[data-tpl]');
  const t = b && activeTemplates().find(x => x.id === b.dataset.tpl);
  if (!t) return;
  // 日付はそのまま、ほかの中身をテンプレで埋める
  $('#evTitle').value = t.title;
  $('#evAllDay').checked = !t.time;
  $('#evTime').value = t.time || '';
  $('#evEndTime').value = t.endTime || '';
  fillCategorySelect(t.categoryId || '');
  $('#evRemind').value = t.remind != null ? String(t.remind) : '';
  $('#evMemo').value = t.memo || '';
  syncDialogUi();
  toast(`「${t.title}」を入れました`);
});
$('#evSaveTpl').addEventListener('click', () => {
  const title = $('#evTitle').value.trim();
  if (!title) { toast('先にタイトルを入れてください'); return; }
  const allDay = $('#evAllDay').checked;
  const tpl = {
    title, time: allDay ? '' : $('#evTime').value, endTime: allDay ? '' : $('#evEndTime').value,
    categoryId: $('#evCategory').value || '', memo: $('#evMemo').value.trim(),
    remind: $('#evRemind').value === '' ? null : Number($('#evRemind').value),
  };
  data.templates = data.templates || [];
  const same = activeTemplates().find(x => x.title === title);
  if (same) Object.assign(same, tpl, { updatedAt: Date.now() });
  else data.templates.push({ id: uid(), ...tpl, updatedAt: Date.now() });
  save();
  renderTemplateRow(!editing);
  toast(same ? `テンプレ「${title}」を上書きしました` : `テンプレ「${title}」を保存しました。次からワンタップで入れられます`);
});
/* ---------- ひと言で入力（quickadd.js で読み取って、下の欄に入れる） ---------- */
let quickBase = null; // 開いたときの日付など（ひと言を消したら元に戻すため）
function resetQuick(isNew) {
  $('#quickRow').hidden = !isNew;
  $('#evQuick').value = '';
  $('#evQuickFound').textContent = '日付・時刻・くり返しを読み取って、下に自動で入れます';
  $('#evQuickFound').classList.remove('on');
  quickBase = isNew ? { date: $('#evDate').value, remind: $('#evRemind').value } : null;
}
function applyQuick() {
  if (!quickBase) return;
  const text = $('#evQuick').value;
  const r = QuickAdd.parse(text, new Date());
  $('#evTitle').value = r.title;
  $('#evDate').value = r.date || quickBase.date;
  $('#evAllDay').checked = false;
  $('#evTime').value = r.time || '';
  $('#evEndTime').value = r.endTime || '';
  $('#evEndDate').value = '';
  const rp = r.repeat;
  $('#evRepeat').value = rp ? rp.rv : '';
  setWeekdayChips(rp && rp.days.length ? rp.days : [parseYmd($('#evDate').value).getDay()]);
  $('#evRemind').value = r.remind != null ? String(r.remind) : quickBase.remind;
  syncDialogUi();
  const f = $('#evQuickFound');
  if (!text.trim()) { resetQuick(true); return; }
  const parts = [...r.found, r.title ? `「${r.title}」` : 'タイトルなし'];
  f.textContent = '読み取り：' + parts.join('・');
  f.classList.add('on');
}
$('#evQuick').addEventListener('input', applyQuick);
$('#evQuick').addEventListener('keydown', e => {
  // Enter で保存されないように（キーボードを閉じるだけ）
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});
$('#evCancel').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener('close', () => { editing = null; });
$('#evAllDay').addEventListener('change', syncDialogUi);
$('#evRepeat').addEventListener('change', () => {
  if (!chosenWeekdays().length) setWeekdayChips([parseYmd($('#evDate').value || selected).getDay()]);
  syncDialogUi();
});
$('#evWeekdays').addEventListener('click', e => {
  const b = e.target.closest('button[data-wd]');
  if (b) b.classList.toggle('on');
});
$('#evDate').addEventListener('change', () => {
  // 終了日が開始日より前になったら合わせる
  if ($('#evEndDate').value && $('#evEndDate').value < $('#evDate').value) $('#evEndDate').value = '';
});

/* ========== 操作 ========== */
function move(delta) {
  if (currentView === 'calendar' && calMode === 'week') {
    selected = addDaysStr(selected, delta * 7);
    const d = parseYmd(selected);
    viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  } else {
    viewMonth.setMonth(viewMonth.getMonth() + delta);
  }
  scrollColPending = true;
  render();
}
$('#prevMonth').addEventListener('click', () => move(-1));
$('#nextMonth').addEventListener('click', () => move(1));
$('#monthTitle').addEventListener('click', () => {
  if (currentView === 'settings') return;
  viewMonth = new Date(); viewMonth.setDate(1);
  selected = todayStr();
  scrollColPending = true;
  render();
});

document.querySelectorAll('.seg-btn[data-mode]').forEach(b => b.addEventListener('click', () => {
  calMode = b.dataset.mode;
  try { localStorage.setItem('hibilog:calMode', calMode); } catch {}
  render();
}));
document.querySelectorAll('#prefMonthStyle .seg-btn').forEach(b => b.addEventListener('click', () => setPref('monthStyle', b.dataset.v)));
document.querySelectorAll('#prefFont .seg-btn').forEach(b => b.addEventListener('click', () => setPref('font', b.dataset.v)));
$('#prefContrast').addEventListener('change', e => setPref('contrast', e.target.checked));
$('#prefUseColumn').addEventListener('click', () => { setPref('monthStyle', 'column'); toast('「1列」表示にしました'); });

// 「1列」の日付をタップ：その日を選び、下の詳細へ移動
$('#monthCol').addEventListener('click', e => {
  const r = e.target.closest('.mrow');
  if (!r) return;
  selected = r.dataset.date;
  renderCalendar();
  $('#dayPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// スワイプで月・週を移動
let touchX = null;
for (const el of [$('#grid'), $('#weekView'), $('#monthCol')]) {
  el.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1);
  });
}

$('#grid').addEventListener('click', e => {
  const c = e.target.closest('.cell');
  if (!c) return;
  selected = c.dataset.date;
  const d = parseYmd(selected);
  if (d.getMonth() !== viewMonth.getMonth()) viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  renderCalendar();
});
// 予定の行・日付・＋ボタン（日パネル・週・リスト共通）
for (const el of [$('#eventList'), $('#weekView'), $('#listView')]) {
  el.addEventListener('click', e => {
    if (el !== $('#eventList') && onTodoClick(e)) return;
    const add = e.target.closest('[data-add]');
    if (add) { openEvent(null, null, add.dataset.add); return; }
    const li = e.target.closest('li[data-id]');
    if (li) { openEvent(li.dataset.id, li.dataset.occ); return; }
    const day = e.target.closest('.ag-day');
    if (day && calMode === 'week') { selected = day.dataset.date; renderCalendar(); }
  });
}
$('#addEvent').addEventListener('click', () => openEvent());
$('#habitChecks').addEventListener('change', e => {
  const hid = e.target.dataset.hid;
  if (hid) { toggleCheck(selected, hid); renderCalendar(); return; }
  const nid = e.target.dataset.num;
  const h = nid && habitById(nid);
  if (h) { setValue(selected, h, e.target.value.trim()); renderCalendar(); }
});

$('#habitList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.edit) { openHabit(b.dataset.edit); return; }
  if (b.dataset.stats) {
    const id = b.dataset.stats;
    if (openHabitStats.has(id)) openHabitStats.delete(id); else openHabitStats.add(id);
    renderHabits();
    return;
  }
  if (b.dataset.hid && b.dataset.date) {
    const h = habitById(b.dataset.hid);
    if (h) { recordHabit(h, b.dataset.date); renderHabits(); }
  }
});

/* ========== 習慣ダイアログ ========== */
const hdlg = $('#habitDialog');
let editingHabit = null;
const hChosenDays = () => [...document.querySelectorAll('#hDays button.on')].map(b => Number(b.dataset.wd));
function syncHabitUi() {
  const f = $('#hFreq').value;
  $('#hDays').hidden = f !== 'weekdays';
  $('#hTimesRow').hidden = f !== 'weekly';
  $('#hTargetRow').hidden = $('#hKind').value !== 'number';
}
function openHabit(id) {
  const h = id ? habitById(id) : null;
  editingHabit = h ? h.id : null;
  const f = Core.freqOf(h);
  $('#habitDialogTitle').textContent = h ? '習慣を編集' : '習慣を追加';
  $('#hName').value = h ? h.name : '';
  $('#hColor').value = h ? h.color : '#4f7cff';
  $('#hFreq').value = f.type;
  const days = f.type === 'weekdays' && f.days ? f.days : [1, 2, 3, 4, 5];
  document.querySelectorAll('#hDays button').forEach(b => b.classList.toggle('on', days.includes(Number(b.dataset.wd))));
  $('#hTimes').value = String(f.times || 3);
  $('#hKind').value = Core.isNumeric(h) ? 'number' : 'check';
  $('#hTarget').value = Core.isNumeric(h) ? h.target.value : '';
  $('#hUnit').value = Core.isNumeric(h) ? (h.target.unit || '') : '';
  $('#hRemind').value = h && h.remindAt ? h.remindAt : '';
  $('#hDelete').hidden = !h;
  syncHabitUi();
  hdlg.showModal();
  setTimeout(() => { if (!h) $('#hName').focus(); }, 50);
}
$('#addHabit').addEventListener('click', () => openHabit());
$('#hFreq').addEventListener('change', syncHabitUi);
$('#hKind').addEventListener('change', syncHabitUi);
$('#hDays').addEventListener('click', e => { const b = e.target.closest('button[data-wd]'); if (b) b.classList.toggle('on'); });
$('#hCancel').addEventListener('click', () => hdlg.close());
hdlg.addEventListener('click', e => { if (e.target === hdlg) hdlg.close(); });
$('#habitEditForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#hName').value.trim();
  if (!name) { toast('名前を入れてください'); return; }
  const type = $('#hFreq').value;
  const freq = { type };
  if (type === 'weekdays') {
    freq.days = hChosenDays();
    if (!freq.days.length) { toast('曜日を1つ以上選んでください'); return; }
  }
  if (type === 'weekly') freq.times = Number($('#hTimes').value) || 1;
  let target = null;
  if ($('#hKind').value === 'number') {
    const v = Number($('#hTarget').value);
    if (!(v > 0)) { toast('1日の目標を数字で入れてください（例：2）'); return; }
    target = { value: v, unit: $('#hUnit').value.trim().slice(0, 8) };
  }
  const fields = { name: name.slice(0, 30), color: $('#hColor').value, freq, target, remindAt: $('#hRemind').value || '', updatedAt: Date.now() };
  if (editingHabit) Object.assign(habitById(editingHabit), fields);
  else data.habits.push({ id: uid(), createdAt: todayStr(), ...fields });
  save();
  const was = !!editingHabit;
  hdlg.close();
  render();
  toast(was ? '習慣を更新しました' : '習慣を追加しました');
});
$('#hDelete').addEventListener('click', () => {
  const h = editingHabit && habitById(editingHabit);
  if (!h || !confirm(`「${h.name}」とその記録を削除しますか？`)) return;
  data.habits = data.habits.map(x => x.id === h.id ? { id: h.id, deleted: true, updatedAt: Date.now() } : x);
  save();
  hdlg.close();
  render();
  toast('習慣を削除しました');
});

/* ========== ToDo ========== */
const activeTodos = () => data.todos.filter(t => !t.deleted);
const todoById = id => data.todos.find(t => t.id === id && !t.deleted);
let showDoneTodos = false;
let editingTodo = null;

function dueLabel(due) {
  const today = todayStr();
  if (!due) return '';
  if (due === today) return '今日';
  if (due === addDaysStr(today, 1)) return '明日';
  if (due === addDaysStr(today, -1)) return '昨日';
  return mdw(due);
}
function todoRow(t, { hideDue = false } = {}) {
  const overdue = !t.done && t.due && t.due < todayStr();
  return `<li class="todo${t.done ? ' done' : ''}" data-todo="${esc(t.id)}">
    <input type="checkbox" class="check" data-todo-check="${esc(t.id)}" ${t.done ? 'checked' : ''} aria-label="${esc(t.title)}を完了">
    <span class="ttitle">${t.star ? `<span class="star">${icon('star')}</span>` : ''}${esc(t.title)}${t.memo ? `<span class="memo">${esc(t.memo)}</span>` : ''}</span>
    ${t.due && !hideDue ? `<span class="tdue${overdue ? ' overdue' : ''}">${esc(dueLabel(t.due))}</span>` : ''}
  </li>`;
}
const todoSort = (a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) ||
  (a.due || '9999').localeCompare(b.due || '9999') || (a.createdAt || 0) - (b.createdAt || 0);
// その日の画面に出すToDo（今日なら期限切れも含める）
function todosForDay(s) {
  const today = todayStr();
  return activeTodos().filter(t => t.due && (t.due === s || (s === today && !t.done && t.due < today))).sort(todoSort);
}

function renderTodos() {
  $('#monthTitle').textContent = 'ToDo';
  const today = todayStr();
  const all = activeTodos();
  const open = all.filter(t => !t.done).sort(todoSort);
  const groups = [
    ['期限切れ', open.filter(t => t.due && t.due < today), 'overdue'],
    ['今日', open.filter(t => t.due === today), ''],
    ['これから', open.filter(t => t.due && t.due > today), ''],
    ['期限なし', open.filter(t => !t.due), ''],
  ];
  let html = '';
  for (const [name, list, cls] of groups) {
    if (!list.length) continue;
    html += `<div class="card todo-group ${cls}"><h3>${name}<span class="count">${list.length}</span></h3>
      <ul class="todo-list">${list.map(t => todoRow(t, { hideDue: name === '今日' })).join('')}</ul></div>`;
  }
  if (!open.length) html += `<p class="empty center">${icon('sparkles', 'big')}<br>やることはありません<br>上の欄から追加できます</p>`;
  const done = all.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  if (done.length) {
    html += `<div class="card todo-group donegrp"><h3>
      <button class="link-btn" id="toggleDone">${showDoneTodos ? '▾' : '▸'} 完了 <span class="count">${done.length}</span></button>
      ${showDoneTodos ? '<button class="btn small" id="clearDone">完了したものを削除</button>' : ''}</h3>
      ${showDoneTodos ? `<ul class="todo-list">${done.map(t => todoRow(t)).join('')}</ul>` : ''}</div>`;
  }
  $('#todoGroups').innerHTML = html;
}
function updateTodoBadge() {
  const today = todayStr();
  const n = activeTodos().filter(t => !t.done && t.due && t.due <= today).length;
  const b = $('#todoBadge');
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : String(n);
}
function toggleTodo(id) {
  const t = todoById(id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  t.updatedAt = Date.now();
  save();
  if (t.done) toast(`「${t.title}」完了！`);
}

$('#todoQuick').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#todoQuickTitle').value.trim();
  if (!title) return;
  const now = Date.now();
  data.todos.push({ id: uid(), title: title.slice(0, 80), due: $('#todoQuickDue').value || '', memo: '', star: false, done: false, createdAt: now, updatedAt: now });
  save();
  $('#todoQuickTitle').value = '';
  render();
  $('#todoQuickTitle').focus(); // 続けて入力できるように
});

const tdlg = $('#todoDialog');
function openTodo(id) {
  const t = todoById(id);
  if (!t) return;
  editingTodo = t.id;
  $('#tTitle').value = t.title;
  $('#tDue').value = t.due || '';
  $('#tStar').checked = !!t.star;
  $('#tMemo').value = t.memo || '';
  tdlg.showModal();
}
$('#todoEditForm').addEventListener('submit', e => {
  e.preventDefault();
  const t = todoById(editingTodo);
  const title = $('#tTitle').value.trim();
  if (!t || !title) return;
  Object.assign(t, { title: title.slice(0, 80), due: $('#tDue').value || '', star: $('#tStar').checked, memo: $('#tMemo').value.trim(), updatedAt: Date.now() });
  save();
  tdlg.close();
  render();
  toast('ToDoを更新しました');
});
$('#tDelete').addEventListener('click', () => {
  const t = todoById(editingTodo);
  if (!t || !confirm(`「${t.title}」を削除しますか？`)) return;
  data.todos = data.todos.map(x => x.id === t.id ? { id: t.id, deleted: true, updatedAt: Date.now() } : x);
  save();
  tdlg.close();
  render();
  toast('ToDoを削除しました');
});
$('#tCancel').addEventListener('click', () => tdlg.close());
tdlg.addEventListener('click', e => { if (e.target === tdlg) tdlg.close(); });

// ToDoの行：チェックで完了、それ以外をタップで編集（ToDoタブ・日パネル・週・リスト共通）
function onTodoClick(e) {
  const chk = e.target.closest('[data-todo-check]');
  if (chk) { toggleTodo(chk.dataset.todoCheck); render(); return true; }
  const row = e.target.closest('li[data-todo]');
  if (row) { openTodo(row.dataset.todo); return true; }
  return false;
}
$('#todoGroups').addEventListener('click', e => {
  if (e.target.closest('#toggleDone')) { showDoneTodos = !showDoneTodos; renderTodos(); return; }
  if (e.target.closest('#clearDone')) {
    const done = activeTodos().filter(t => t.done);
    if (!confirm(`完了したToDo ${done.length}件を削除しますか？`)) return;
    const now = Date.now();
    const ids = new Set(done.map(t => t.id));
    data.todos = data.todos.map(x => ids.has(x.id) ? { id: x.id, deleted: true, updatedAt: now } : x);
    save(); render();
    return;
  }
  onTodoClick(e);
});
$('#dayTodos').addEventListener('click', onTodoClick);

/* ========== カテゴリの操作 ========== */
$('#catForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#catName').value.trim();
  if (!name) return;
  data.categories.push({ id: uid(), name: name.slice(0, 20), color: $('#catColor').value, updatedAt: Date.now() });
  save();
  $('#catName').value = '';
  renderCategories();
  toast('カテゴリを追加しました');
});
$('#catList').addEventListener('change', e => {
  const id = e.target.dataset.catColor;
  if (!id) return;
  const c = data.categories.find(x => x.id === id);
  c.color = e.target.value; c.updatedAt = Date.now();
  save();
});
$('#catList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const id = b.dataset.catRename || b.dataset.catDel;
  const c = data.categories.find(x => x.id === id);
  if (!c) return;
  if (b.dataset.catRename) {
    const name = prompt('新しい名前', c.name);
    if (name && name.trim()) { c.name = name.trim().slice(0, 20); c.updatedAt = Date.now(); save(); renderCategories(); }
  } else if (confirm(`カテゴリ「${c.name}」を削除しますか？（予定は消えず、カテゴリなしになります）`)) {
    data.categories = data.categories.map(x => x.id === id ? { id, deleted: true, updatedAt: Date.now() } : x);
    save(); renderCategories();
  }
});

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  currentView = t.dataset.view;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${currentView}`; });
  render();
  window.scrollTo(0, 0);
}));

/* ========== バックアップ ========== */
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hibilog-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('バックアップを書き出しました');
});
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const parsed = normalize(JSON.parse(await f.text()));
    const n = parsed.events.filter(x => !x.deleted).length, m = parsed.habits.filter(x => !x.deleted).length;
    if (!confirm(`予定 ${n}件・習慣 ${m}件を今のデータに統合します。よろしいですか？`)) return;
    // バックアップの項目は「今」更新したものとして扱い、確実に反映させる
    const now = Date.now();
    parsed.events.forEach(x => { if (!x.deleted) x.updatedAt = now; });
    parsed.habits.forEach(x => { if (!x.deleted) x.updatedAt = now; });
    for (const v of Object.values(parsed.marks)) if (v.on) v.t = now;
    data = mergeData(data, parsed); save(); render();
    toast('読み込みました');
  } catch {
    toast('読み込めませんでした（ファイル形式を確認してください）');
  }
});
$('#resetBtn').addEventListener('click', () => {
  if (!confirm('すべてのデータを削除します。同期している他の端末からも消えます。元に戻せません。よろしいですか？')) return;
  const now = Date.now();
  data.events = data.events.map(x => ({ id: x.id, deleted: true, updatedAt: now }));
  data.habits = data.habits.map(x => ({ id: x.id, deleted: true, updatedAt: now }));
  data.todos = data.todos.map(x => ({ id: x.id, deleted: true, updatedAt: now }));
  for (const k of Object.keys(data.marks)) data.marks[k] = { on: false, t: now };
  save(); render();
  toast('すべて削除しました');
});

/* ========== 他のファイル（sync.js など）から使う窓口 ========== */
window.App = {
  get data() { return data; },
  replaceData(d) {
    data = normalize(d);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
    if (!dlg.open && !$('#scopeDialog').open && !hdlg.open && !tdlg.open) render();
  },
  mergeData,
  normalize,
  onChange(fn) { listeners.push(fn); },
  // データを変えて保存する（ほかのファイルから使う）
  update(fn) { fn(data); save(); },
  toast,
  render,
};

/* =====================================================================
 * 自動更新
 *  ホーム画面のアプリは閉じても裏で生きていることが多く、古い版のまま動き続ける。
 *  そこで、開いたとき・前面に戻ったときに version.json を確認し、
 *  新しい版があればキャッシュを消して読み込み直す。
 * ===================================================================== */
const Updater = (() => {
  const meta = document.querySelector('meta[name="app-version"]');
  const LOADED = meta ? meta.content : '0';
  const FLAG = 'hibilog:updatedAt';
  let reg = null;
  let busy = false;

  const s = (fn) => { try { return fn(); } catch { return null; } };
  async function latest() {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return String((await r.json()).version);
  }

  async function apply() {
    busy = true;
    s(() => sessionStorage.setItem(FLAG, String(Date.now())));
    try { if (reg) await reg.update(); } catch {}
    try { await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch {}
    location.reload();
  }

  async function check(manual) {
    if (busy || location.protocol === 'file:') return;
    try {
      const v = await latest();
      if (v === LOADED) { if (manual) toast('最新版です'); return; }
      // 公開直後は配信サーバーの反映待ちで古い版が返ることがある。直前に更新したばかりなら繰り返さない
      const last = Number(s(() => sessionStorage.getItem(FLAG))) || 0;
      if (!manual && Date.now() - last < 5 * 60 * 1000) return;
      if ((dlg.open || $('#scopeDialog').open || $('#habitDialog').open || $('#todoDialog').open) && !manual) return; // 編集中は待つ
      toast('新しいバージョンに更新しています…');
      setTimeout(apply, 700);
    } catch {
      if (manual) toast('確認できませんでした（オフラインかもしれません）');
    }
  }

  function start() {
    $('#appVersion').textContent = LOADED;
    $('#checkUpdate').addEventListener('click', () => check(true));
    const last = Number(s(() => sessionStorage.getItem(FLAG))) || 0;
    if (Date.now() - last < 30 * 1000) {
      setTimeout(() => toast(`バージョン ${LOADED} に更新しました`), 400);
    }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then(r => { reg = r; })
        .catch(() => {});
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (reg) reg.update().catch(() => {});
      check(false);
    });
    window.addEventListener('pageshow', e => { if (e.persisted) check(false); });
    check(false);
  }
  return { start, check, get version() { return LOADED; } };
})();

/* ========== 起動 ========== */
applyPrefs();
render();
if (!data.appearance) syncAppearance();
// 日付が変わったら「今日」表示を更新
document.addEventListener('visibilitychange', () => { if (!document.hidden && !dlg.open) render(); });
Updater.start();

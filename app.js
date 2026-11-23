'use strict';

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
const emptyData = () => ({ version: 4, events: [], categories: DEFAULT_CATEGORIES.map(c => ({ ...c })), habits: [], marks: {}, todos: [] });

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
  return {
    version: 4,
    events: byId(a.events, b.events),
    categories: byId(a.categories, b.categories),
    habits: byId(a.habits, b.habits),
    marks,
    todos: byId(a.todos, b.todos),
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
const colorOf = ev => { const sc = sharedCal(ev); return sc ? sc.color : ((catOf(ev) || {}).color || NO_CAT_COLOR); };
// 自分の予定 ＋ 参加している共有カレンダーの予定
const allEvents = () => (hasShared() ? data.events.concat(Shared.events()) : data.events);

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
  const m = Core.markOf(data.marks, date, hid);
  data.marks[`${date}|${hid}`] = { on: !(m && m.on), t: Date.now() };
  save();
}
function setValue(date, h, v) {
  const num = v === '' || v == null ? null : Number(v);
  if (num != null && !isFinite(num)) return;
  data.marks[`${date}|${h.id}`] = { on: num != null && num >= Number(h.target.value), v: num, t: Date.now() };
  save();
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
  const bell = ev.remind != null && ev.remind !== '' ? ' <span class="bell" title="リマインダー">🔔</span>' : '';
  const rep = ev.repeat ? ' <span class="rep" title="繰り返し">🔁</span>' : '';
  const sc = sharedCal(ev);
  const shared = sc ? ` <span class="shared-tag">👥 ${esc(sc.name)}</span>` : '';
  return `<li data-id="${esc(ev.id)}" data-occ="${esc(o.start)}" style="--c:${esc(colorOf(ev))}">
    <span class="cbar"></span>
    <span class="time">${esc(Core.timeLabel(o))}</span>
    <span class="title">${esc(ev.title)}${rep}${bell}${shared}${ev.memo ? `<span class="memo">${esc(ev.memo)}</span>` : ''}</span>
  </li>`;
}
const dayOccurrences = day => Core.onDay(allEvents(), day);

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
    const evs = byDay[s] || [];
    const evDots = evs.slice(0, 4).map(o => `<span class="edot" style="background:${esc(colorOf(o.ev))}"></span>`).join('') +
      (evs.length > 4 ? `<span class="more">+${evs.length - 4}</span>` : '') +
      (todoCount[s] ? `<span class="tdot" title="ToDo ${todoCount[s]}件"></span>` : '');
    const hDots = habits.filter(h => isDoneOn(h, s))
      .map(h => `<span class="dot" style="background:${esc(h.color)}"></span>`).join('');
    const hl = hol ? `<span class="hol-name">${esc(hol)}</span>` : '';
    html += `<button class="${cls.join(' ')}" data-date="${s}" aria-label="${d.getMonth() + 1}月${d.getDate()}日${hol ? ' ' + esc(hol) : ''}${evs.length ? ` 予定${evs.length}件` : ''}">
      <span class="num">${d.getDate()}</span>${hl}<span class="edots">${evDots}</span><span class="dots">${hDots}</span></button>`;
  }
  $('#grid').innerHTML = html;
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
      <div class="ag-head${red ? ' red' : d.getDay() === 6 ? ' blue' : ''}"><b>${d.getDate()}</b> ${WD[d.getDay()]}${hol ? ` <span class="hol-badge">${esc(hol)}</span>` : ''}<button class="ag-add" data-add="${s}" aria-label="${d.getMonth() + 1}月${d.getDate()}日に予定を追加">＋</button></div>
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
      <div class="ag-head${d.getDay() === 0 || hol ? ' red' : d.getDay() === 6 ? ' blue' : ''}"><b>${d.getMonth() + 1}/${d.getDate()}</b> ${WD[d.getDay()]}${s === from ? ' <span class="today-badge">今日</span>' : ''}${hol ? ` <span class="hol-badge">${esc(hol)}</span>` : ''}</div>
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
}

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
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === calMode));
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
        if (h.remindAt) tags.push(`🔔 ${h.remindAt}`);
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
  else { $('#monthTitle').textContent = '設定'; renderCategories(); }
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
    cals.map(c => `<option value="${esc(c.id)}">👥 ${esc(c.name)}</option>`).join('');
  $('#evCal').value = value && cals.some(c => c.id === value) ? value : '';
  syncCalUi();
}
// 共有カレンダーの予定は、カレンダーの色で表示するのでカテゴリは使わない
function syncCalUi() { $('#evCategoryRow').hidden = !!$('#evCal').value; }

function openEvent(id, occStart, newDate) {
  const ev = id ? findEvent(id) : null;
  editing = ev ? { id: ev.id, occStart: occStart || ev.date, recurring: !!ev.repeat, store: ev.calendarId || '' } : null;
  fillCalendarSelect(ev ? (ev.calendarId || '') : '');
  const info = $('#evSharedInfo');
  info.hidden = !(ev && ev.calendarId);
  if (ev && ev.calendarId) {
    const who = Shared.memberName(ev.calendarId, ev.updatedBy);
    const when = ev.sharedUpdatedAt ? new Date(ev.sharedUpdatedAt) : null;
    info.textContent = `👥 共有の予定${who ? ` ・ 最後に変更：${who}` : ''}${when ? `（${when.getMonth() + 1}/${when.getDate()} ${pad(when.getHours())}:${pad(when.getMinutes())}）` : ''}`;
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
  syncDialogUi();
  dlg.showModal();
  setTimeout(() => { if (!ev) $('#evTitle').focus(); }, 50);
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
  return {
    title: $('#evTitle').value.trim(),
    date, time, endDate, endTime,
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
  render();
}
$('#prevMonth').addEventListener('click', () => move(-1));
$('#nextMonth').addEventListener('click', () => move(1));
$('#monthTitle').addEventListener('click', () => {
  if (currentView === 'settings') return;
  viewMonth = new Date(); viewMonth.setDate(1);
  selected = todayStr();
  render();
});

document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
  calMode = b.dataset.mode;
  try { localStorage.setItem('hibilog:calMode', calMode); } catch {}
  render();
}));

// スワイプで月・週を移動
let touchX = null;
for (const el of [$('#grid'), $('#weekView')]) {
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
    <span class="ttitle">${t.star ? '<span class="star">★</span>' : ''}${esc(t.title)}${t.memo ? `<span class="memo">${esc(t.memo)}</span>` : ''}</span>
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
  if (!open.length) html += '<p class="empty center">やることはありません 🎉<br>上の欄から追加できます</p>';
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
render();
// 日付が変わったら「今日」表示を更新
document.addEventListener('visibilitychange', () => { if (!document.hidden && !dlg.open) render(); });
Updater.start();

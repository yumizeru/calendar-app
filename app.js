'use strict';

/* =====================================================================
 * データ
 *  events     : 予定（形は core.js の説明を参照）
 *  categories : [{ id, name, color, updatedAt, deleted? }]
 *  habits     : [{ id, name, color, createdAt, updatedAt, deleted? }]
 *  marks      : { "YYYY-MM-DD|habitId": { on: bool, t: 更新時刻 } }
 * 削除したものも deleted:true で残す（別の端末と同期するときに「消した」ことを伝えるため）
 * ===================================================================== */
const STORE_KEY = 'hibilog:v1';
const DEFAULT_CATEGORIES = [
  { id: 'cat-work', name: '仕事', color: '#4f7cff', updatedAt: 0 },
  { id: 'cat-private', name: 'プライベート', color: '#22c55e', updatedAt: 0 },
  { id: 'cat-errand', name: '用事・通院', color: '#f59e0b', updatedAt: 0 },
];
const emptyData = () => ({ version: 3, events: [], categories: DEFAULT_CATEGORIES.map(c => ({ ...c })), habits: [], marks: {} });

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
  if (d.marks && typeof d.marks === 'object') {
    for (const [k, v] of Object.entries(d.marks)) {
      if (v && typeof v === 'object') out.marks[k] = { on: !!v.on, t: num(v.t) };
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
    version: 3,
    events: byId(a.events, b.events),
    categories: byId(a.categories, b.categories),
    habits: byId(a.habits, b.habits),
    marks,
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
const colorOf = ev => (catOf(ev) || {}).color || NO_CAT_COLOR;

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

/* ========== 習慣の計算 ========== */
const isChecked = (date, hid) => !!(data.marks[`${date}|${hid}`] || {}).on;
function toggleCheck(date, hid) {
  data.marks[`${date}|${hid}`] = { on: !isChecked(date, hid), t: Date.now() };
  save();
}
function streak(hid) {
  // 今日が未チェックなら昨日から数える（今日はまだこれから、という扱い）
  let d = new Date();
  if (!isChecked(ymd(d), hid)) d = addDays(d, -1);
  let n = 0;
  while (isChecked(ymd(d), hid)) { n++; d = addDays(d, -1); }
  return n;
}
function monthRate(hid, month) {
  const y = month.getFullYear(), m = month.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  const isCur = y === today.getFullYear() && m === today.getMonth();
  const days = isCur ? today.getDate() : last;
  let done = 0;
  for (let i = 1; i <= days; i++) if (isChecked(`${y}-${pad(m + 1)}-${pad(i)}`, hid)) done++;
  return { done, days, pct: days ? Math.round(done / days * 100) : 0 };
}

/* ========== 予定の行（日パネル・週・リストで共通） ========== */
function eventRow(o) {
  const ev = o.ev;
  const bell = ev.remind != null && ev.remind !== '' ? ' <span class="bell" title="リマインダー">🔔</span>' : '';
  const rep = ev.repeat ? ' <span class="rep" title="繰り返し">🔁</span>' : '';
  return `<li data-id="${esc(ev.id)}" data-occ="${esc(o.start)}" style="--c:${esc(colorOf(ev))}">
    <span class="cbar"></span>
    <span class="time">${esc(Core.timeLabel(o))}</span>
    <span class="title">${esc(ev.title)}${rep}${bell}${ev.memo ? `<span class="memo">${esc(ev.memo)}</span>` : ''}</span>
  </li>`;
}
const dayOccurrences = day => Core.onDay(data.events, day);

/* ========== 描画：月 ========== */
function renderMonth() {
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
  $('#monthTitle').textContent = `${y}年${m + 1}月`;

  const first = new Date(y, m, 1);
  const start = addDays(first, -first.getDay());
  const from = ymd(start), to = ymd(addDays(start, 41));
  const byDay = {};
  for (const o of Core.expand(data.events, from, to)) {
    for (let s = o.start < from ? from : o.start; s <= o.end && s <= to; s = addDaysStr(s, 1)) {
      (byDay[s] = byDay[s] || []).push(o);
    }
  }
  const today = todayStr();
  const habits = activeHabits();

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
      (evs.length > 4 ? `<span class="more">+${evs.length - 4}</span>` : '');
    const hDots = habits.filter(h => isChecked(s, h.id))
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
    html += `<div class="ag-day${s === selected ? ' selected' : ''}${s === today ? ' is-today' : ''}" data-date="${s}">
      <div class="ag-head${red ? ' red' : d.getDay() === 6 ? ' blue' : ''}"><b>${d.getDate()}</b> ${WD[d.getDay()]}${hol ? ` <span class="hol-badge">${esc(hol)}</span>` : ''}<button class="ag-add" data-add="${s}" aria-label="${d.getMonth() + 1}月${d.getDate()}日に予定を追加">＋</button></div>
      <ul class="event-list">${occ.length ? occ.map(o => eventRow({ ...o, day: s })).join('') : '<li class="empty">予定なし</li>'}</ul>
    </div>`;
  }
  $('#weekView').innerHTML = html;
}

/* ========== 描画：リスト（今日から60日） ========== */
function renderList() {
  $('#monthTitle').textContent = 'これからの予定';
  const from = todayStr(), to = addDaysStr(from, 59);
  const occ = Core.expand(data.events, from, to);
  const byDay = {};
  for (const o of occ) {
    const s = o.start < from ? from : o.start; // 複数日の予定は始まりの日（または今日）に1回だけ出す
    (byDay[s] = byDay[s] || []).push({ ...o, day: s });
  }
  const days = Object.keys(byDay).sort();
  let html = `<div class="ag-toolbar"><span class="muted small">今日から60日間</span><button class="btn primary" data-add="${from}">＋ 予定</button></div>`;
  if (!days.length) html += '<p class="empty">これからの予定はありません</p>';
  for (const s of days) {
    const d = parseYmd(s);
    const hol = JPHolidays.get(s);
    const list = byDay[s].sort((x, y) => ((x.ev.time || '') + x.ev.title).localeCompare((y.ev.time || '') + y.ev.title));
    html += `<div class="ag-day" data-date="${s}">
      <div class="ag-head${d.getDay() === 0 || hol ? ' red' : d.getDay() === 6 ? ' blue' : ''}"><b>${d.getMonth() + 1}/${d.getDate()}</b> ${WD[d.getDay()]}${s === from ? ' <span class="today-badge">今日</span>' : ''}${hol ? ` <span class="hol-badge">${esc(hol)}</span>` : ''}</div>
      <ul class="event-list">${list.map(o => eventRow(o)).join('')}</ul>
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

  const habits = activeHabits();
  $('#habitChecks').innerHTML = habits.length
    ? habits.map(h => `<li><label>
        <input type="checkbox" class="check" data-hid="${esc(h.id)}" style="--c:${esc(h.color)}" ${isChecked(selected, h.id) ? 'checked' : ''}>
        <span>${esc(h.name)}</span></label></li>`).join('')
    : '<li class="empty">「習慣」タブから習慣を追加できます</li>';
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
  const today = new Date();
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const habits = activeHabits();

  $('#habitList').innerHTML = habits.length
    ? habits.map(h => {
        const r = monthRate(h.id, viewMonth);
        const cells = week.map(d => {
          const s = ymd(d);
          return `<button class="${isChecked(s, h.id) ? 'on' : ''}" data-hid="${esc(h.id)}" data-date="${s}" style="--c:${esc(h.color)}" aria-label="${d.getMonth() + 1}月${d.getDate()}日">
            ${WD[d.getDay()]}<b>${d.getDate()}</b></button>`;
        }).join('');
        return `<li>
          <div class="habit-top">
            <span class="dot" style="background:${esc(h.color)};width:12px;height:12px"></span>
            <span class="name">${esc(h.name)}</span>
            <button class="btn small" data-rename="${esc(h.id)}">名前変更</button>
            <button class="btn small danger" data-del="${esc(h.id)}">削除</button>
          </div>
          <div class="habit-stats">
            <div><b>${streak(h.id)}日</b>連続</div>
            <div><b>${r.pct}%</b>${m + 1}月の達成率</div>
            <div><b>${r.done}/${r.days}</b>日</div>
          </div>
          <div class="week">${cells}</div>
        </li>`;
      }).join('')
    : '<li class="empty">まだ習慣がありません。上のフォームから追加してください。</li>';
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
  else { $('#monthTitle').textContent = '設定'; renderCategories(); }
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

function openEvent(id, occStart, newDate) {
  const ev = id ? data.events.find(x => x.id === id && !x.deleted) : null;
  editing = ev ? { id: ev.id, occStart: occStart || ev.date, recurring: !!ev.repeat } : null;
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

  if (!editing) {
    data.events.push({ id: uid(), ...f, exdates: [], updatedAt: now });
  } else {
    const cur = data.events.find(x => x.id === editing.id);
    let scope = 'all';
    if (editing.recurring) {
      scope = await askScope('繰り返しの予定を変更します');
      if (scope === 'cancel') return;
    }
    if (scope === 'one') {
      // この回だけ：元の繰り返しからこの日を外し、別の予定として切り離す
      cur.exdates = [...new Set([...(cur.exdates || []), editing.occStart])];
      cur.updatedAt = now;
      data.events.push({ id: uid(), ...f, repeat: null, exdates: [], parentId: cur.id, origDate: editing.occStart, updatedAt: now });
    } else if (editing.recurring && f.repeat) {
      // すべて：開いた回でずらした日数ぶん、繰り返し全体をずらす
      const shift = diffDays(editing.occStart, f.date);
      const dur = f.endDate ? diffDays(f.date, f.endDate) : 0;
      const newStart = addDaysStr(cur.date, shift);
      Object.assign(cur, f, {
        date: newStart,
        endDate: dur ? addDaysStr(newStart, dur) : '',
        exdates: (cur.exdates || []).map(x => addDaysStr(x, shift)),
        updatedAt: now,
      });
      if (f.repeat.until && f.repeat.until < newStart) delete cur.repeat.until;
    } else {
      Object.assign(cur, f, { exdates: f.repeat ? (cur.exdates || []) : [], updatedAt: now });
    }
  }
  save();
  selected = f.date;
  const d = parseYmd(f.date);
  viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  dlg.close();
  render();
  toast(wasEditing ? '予定を更新しました' : '予定を追加しました');
});

$('#evDelete').addEventListener('click', async () => {
  if (!editing) return;
  const cur = data.events.find(x => x.id === editing.id);
  const now = Date.now();
  if (editing.recurring) {
    const scope = await askScope('繰り返しの予定を削除します');
    if (scope === 'cancel') return;
    if (scope === 'one') {
      cur.exdates = [...new Set([...(cur.exdates || []), editing.occStart])];
      cur.updatedAt = now;
    } else {
      data.events = data.events.map(x => (x.id === cur.id || x.parentId === cur.id) ? { id: x.id, deleted: true, updatedAt: now } : x);
    }
  } else {
    if (!confirm('この予定を削除しますか？')) return;
    data.events = data.events.map(x => x.id === cur.id ? { id: x.id, deleted: true, updatedAt: now } : x);
  }
  save();
  dlg.close();
  render();
  toast('予定を削除しました');
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
  if (hid) { toggleCheck(selected, hid); renderCalendar(); }
});

$('#habitForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#habitName').value.trim();
  if (!name) return;
  data.habits.push({ id: uid(), name, color: $('#habitColor').value, createdAt: todayStr(), updatedAt: Date.now() });
  save();
  $('#habitName').value = '';
  renderHabits();
  toast('習慣を追加しました');
});
$('#habitList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.del) {
    const h = data.habits.find(x => x.id === b.dataset.del);
    if (!h || !confirm(`「${h.name}」とその記録を削除しますか？`)) return;
    data.habits = data.habits.map(x => x.id === h.id ? { id: h.id, deleted: true, updatedAt: Date.now() } : x);
    save(); renderHabits(); toast('習慣を削除しました');
  } else if (b.dataset.rename) {
    const h = data.habits.find(x => x.id === b.dataset.rename);
    const name = h && prompt('新しい名前', h.name);
    if (name && name.trim()) { h.name = name.trim().slice(0, 30); h.updatedAt = Date.now(); save(); renderHabits(); }
  } else if (b.dataset.hid && b.dataset.date) {
    toggleCheck(b.dataset.date, b.dataset.hid);
    renderHabits();
  }
});

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
    if (!dlg.open && !$('#scopeDialog').open) render();
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
      if ((dlg.open || $('#scopeDialog').open) && !manual) return; // 予定の編集中は待つ
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

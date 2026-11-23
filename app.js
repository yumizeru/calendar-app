'use strict';

/* =====================================================================
 * データ
 *  events : [{ id, title, date, time, memo, remind, updatedAt, deleted? }]
 *  habits : [{ id, name, color, createdAt, updatedAt, deleted? }]
 *  marks  : { "YYYY-MM-DD|habitId": { on: bool, t: 更新時刻 } }
 * 削除したものも deleted:true で残す（別の端末と同期するときに「消した」ことを伝えるため）
 * ===================================================================== */
const STORE_KEY = 'hibilog:v1';
const emptyData = () => ({ version: 2, events: [], habits: [], marks: {} });

function normalize(d) {
  const out = emptyData();
  if (!d || typeof d !== 'object') return out;
  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  out.events = (Array.isArray(d.events) ? d.events : [])
    .filter(e => e && e.id && (e.deleted || (e.date && e.title)))
    .map(e => ({ ...e, updatedAt: num(e.updatedAt) }));
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
  return { version: 2, events: byId(a.events, b.events), habits: byId(a.habits, b.habits), marks };
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
const activeEvents = () => data.events.filter(e => !e.deleted);
const activeHabits = () => data.habits.filter(h => !h.deleted);

/* ========== 日付ユーティリティ ========== */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const todayStr = () => ymd(new Date());

/* ========== 状態 ========== */
let viewMonth = new Date(); viewMonth.setDate(1);
let selected = todayStr();
let currentView = 'calendar';
let editingId = null;

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

/* ========== 描画：カレンダー ========== */
function renderCalendar() {
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
  $('#monthTitle').textContent = `${y}年${m + 1}月`;

  const first = new Date(y, m, 1);
  const start = addDays(first, -first.getDay());
  const today = todayStr();
  const evCount = {};
  for (const e of activeEvents()) evCount[e.date] = (evCount[e.date] || 0) + 1;
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
    const dots = habits.filter(h => isChecked(s, h.id))
      .map(h => `<span class="dot" style="background:${esc(h.color)}"></span>`).join('');
    const ec = evCount[s] ? `<span class="ev-count">● ${evCount[s]}</span>` : '';
    const hl = hol ? `<span class="hol-name">${esc(hol)}</span>` : '';
    html += `<button class="${cls.join(' ')}" data-date="${s}" aria-label="${d.getMonth() + 1}月${d.getDate()}日${hol ? ' ' + esc(hol) : ''}">
      <span class="num">${d.getDate()}</span>${hl}${ec}<span class="dots">${dots}</span></button>`;
  }
  $('#grid').innerHTML = html;
  renderDay();
}

function renderDay() {
  const d = parseYmd(selected);
  const hol = JPHolidays.get(selected);
  $('#dayTitle').innerHTML = `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）` +
    (hol ? ` <span class="hol-badge">${esc(hol)}</span>` : '');

  const evs = activeEvents().filter(e => e.date === selected)
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  $('#eventList').innerHTML = evs.length
    ? evs.map(e => `<li data-id="${esc(e.id)}">
        <span class="time">${e.time ? esc(e.time) : '終日'}</span>
        <span class="title">${esc(e.title)}${e.remind != null && e.remind !== '' ? ' <span class="bell" title="リマインダー">🔔</span>' : ''}${e.memo ? `<span class="memo">${esc(e.memo)}</span>` : ''}</span>
      </li>`).join('')
    : '<li class="empty" style="cursor:default">予定はありません</li>';

  const habits = activeHabits();
  $('#habitChecks').innerHTML = habits.length
    ? habits.map(h => `<li><label>
        <input type="checkbox" class="check" data-hid="${esc(h.id)}" style="--c:${esc(h.color)}" ${isChecked(selected, h.id) ? 'checked' : ''}>
        <span>${esc(h.name)}</span></label></li>`).join('')
    : '<li class="empty">「習慣」タブから習慣を追加できます</li>';
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

function render() {
  if (currentView === 'calendar') renderCalendar();
  else if (currentView === 'habits') renderHabits();
  else $('#monthTitle').textContent = '設定';
  const showNav = currentView !== 'settings';
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

/* ========== 予定ダイアログ ========== */
const dlg = $('#eventDialog');
function openEvent(id) {
  editingId = id || null;
  const e = id ? data.events.find(x => x.id === id && !x.deleted) : null;
  $('#eventDialogTitle').textContent = e ? '予定を編集' : '予定を追加';
  $('#evTitle').value = e ? e.title : '';
  $('#evDate').value = e ? e.date : selected;
  $('#evTime').value = e ? (e.time || '') : '';
  $('#evMemo').value = e ? (e.memo || '') : '';
  $('#evRemind').value = e && e.remind != null ? String(e.remind) : '';
  $('#evDelete').hidden = !e;
  dlg.showModal();
  setTimeout(() => $('#evTitle').focus(), 50);
}
$('#eventForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const wasEditing = !!editingId;
  const item = {
    id: editingId || uid(),
    title: $('#evTitle').value.trim(),
    date: $('#evDate').value,
    time: $('#evTime').value,
    memo: $('#evMemo').value.trim(),
    // 何分前に通知するか（null なら通知なし）。終日の予定は当日 9:00 を基準にする
    remind: $('#evRemind').value === '' ? null : Number($('#evRemind').value),
    updatedAt: Date.now(),
  };
  if (!item.title || !item.date) return;
  if (wasEditing) data.events = data.events.map(x => x.id === editingId ? item : x);
  else data.events.push(item);
  save();
  selected = item.date;
  const d = parseYmd(item.date);
  viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  dlg.close();
  render();
  toast(wasEditing ? '予定を更新しました' : '予定を追加しました');
});
$('#evCancel').addEventListener('click', () => dlg.close());
$('#evDelete').addEventListener('click', () => {
  if (!editingId || !confirm('この予定を削除しますか？')) return;
  data.events = data.events.map(x => x.id === editingId ? { id: x.id, deleted: true, updatedAt: Date.now() } : x);
  save();
  dlg.close();
  render();
  toast('予定を削除しました');
});
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

/* ========== 操作 ========== */
$('#prevMonth').addEventListener('click', () => { viewMonth.setMonth(viewMonth.getMonth() - 1); render(); });
$('#nextMonth').addEventListener('click', () => { viewMonth.setMonth(viewMonth.getMonth() + 1); render(); });
$('#monthTitle').addEventListener('click', () => {
  if (currentView === 'settings') return;
  viewMonth = new Date(); viewMonth.setDate(1);
  selected = todayStr();
  render();
});

// スワイプで月移動
let touchX = null;
$('#grid').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('#grid').addEventListener('touchend', e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) { viewMonth.setMonth(viewMonth.getMonth() + (dx < 0 ? 1 : -1)); render(); }
});

$('#grid').addEventListener('click', e => {
  const c = e.target.closest('.cell');
  if (!c) return;
  selected = c.dataset.date;
  const d = parseYmd(selected);
  if (d.getMonth() !== viewMonth.getMonth()) viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  renderCalendar();
});
$('#addEvent').addEventListener('click', () => openEvent());
$('#eventList').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]');
  if (li) openEvent(li.dataset.id);
});
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

/* ========== 他のファイル（sync.js）から使う窓口 ========== */
window.App = {
  get data() { return data; },
  replaceData(d) {
    data = normalize(d);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
    if (!dlg.open) render();
  },
  mergeData,
  normalize,
  onChange(fn) { listeners.push(fn); },
  toast,
  render,
};

/* ========== 起動 ========== */
render();
// 日付が変わったら「今日」表示を更新
document.addEventListener('visibilitychange', () => { if (!document.hidden && !dlg.open) render(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

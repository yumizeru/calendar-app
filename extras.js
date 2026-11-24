'use strict';
/* =====================================================================
 * さがす（予定・ToDo・日記の検索）と、月のまとめ
 *  app.js の data・allEvents・openEvent などを使う
 * ===================================================================== */

/* ---------- さがす ---------- */
const Search = (() => {
  const $ = s => document.querySelector(s);
  const dlg = $('#searchDialog');
  let timer = null;

  const norm = s => String(s || '').toLowerCase().normalize('NFKC');
  const mdLabel = s => { const d = parseYmd(s); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };

  // 繰り返しの予定は「今日以降で一番近い回」、なければ「一番最近の回」を出す
  function occurrenceFor(ev) {
    const today = todayStr();
    if (!ev.repeat) return ev.date;
    const next = Core.expand([ev], today, addDaysStr(today, 800)).sort((a, b) => a.start.localeCompare(b.start))[0];
    if (next) return next.start;
    const past = Core.expand([ev], addDaysStr(today, -800), today).sort((a, b) => b.start.localeCompare(a.start))[0];
    return past ? past.start : ev.date;
  }

  function run(q) {
    const box = $('#searchResults');
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) { box.innerHTML = '<p class="muted">予定・ToDo・日記の言葉を入れてください。</p>'; return; }
    const hit = text => { const t = norm(text); return words.every(w => t.includes(w)); };
    const today = todayStr();

    const evs = allEvents().filter(e => !e.deleted && !e.parentId && hit(`${e.title} ${e.memo || ''}`))
      .map(e => ({ e, when: occurrenceFor(e) }))
      .sort((a, b) => (a.when >= today) === (b.when >= today) ? (a.when >= today ? a.when.localeCompare(b.when) : b.when.localeCompare(a.when)) : (a.when >= today ? -1 : 1))
      .slice(0, 60);
    // 切り離した回（この予定だけ変更）も出す
    const detached = allEvents().filter(e => !e.deleted && e.parentId && hit(`${e.title} ${e.memo || ''}`)).map(e => ({ e, when: e.date }));
    const allEv = [...evs, ...detached].slice(0, 80);
    const todos = activeTodos().filter(t => hit(`${t.title} ${t.memo || ''}`)).slice(0, 40);
    const diaries = Object.entries(data.diary || {}).filter(([, v]) => v.text && hit(v.text)).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 40);

    let html = '';
    if (allEv.length) {
      html += `<h4 class="acc-sub">予定（${allEv.length}件）</h4><ul class="search-list">` + allEv.map(({ e, when }) =>
        `<li><button data-ev="${esc(e.id)}" data-occ="${when}"><span class="sdot" style="background:${esc(colorOf(e))}"></span>
          <span class="stext"><b>${esc(e.title + Core.kindSuffix(e, when))}</b><small>${mdLabel(when)}${e.time ? ' ' + esc(e.time) : ''}${e.repeat ? ' ・ 繰り返し' : ''}${e.calendarId ? ' ・ 共有' : ''}</small></span></button></li>`).join('') + '</ul>';
    }
    if (todos.length) {
      html += `<h4 class="acc-sub">ToDo（${todos.length}件）</h4><ul class="search-list">` + todos.map(t =>
        `<li><button data-todo="${esc(t.id)}">${icon(t.done ? 'square-check' : 'square')}
          <span class="stext"><b>${esc(t.title)}</b><small>${t.due ? '期限 ' + mdLabel(t.due) : '期限なし'}${t.done ? ' ・ 完了' : ''}</small></span></button></li>`).join('') + '</ul>';
    }
    if (diaries.length) {
      html += `<h4 class="acc-sub">日記（${diaries.length}件）</h4><ul class="search-list">` + diaries.map(([d, v]) =>
        `<li><button data-day="${d}">${icon('notebook-pen')}<span class="stext"><b>${esc(v.text.slice(0, 40))}</b><small>${mdLabel(d)}</small></span></button></li>`).join('') + '</ul>';
    }
    box.innerHTML = html || '<p class="muted">見つかりませんでした。</p>';
  }

  function goTo(s) {
    selected = s;
    const d = parseYmd(s);
    viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    const t = document.querySelector('.tab[data-view="calendar"]');
    if (!t.classList.contains('active')) t.click();
    render();
  }

  $('#openSearch').addEventListener('click', () => {
    dlg.showModal();
    $('#searchInput').value = '';
    run('');
    setTimeout(() => $('#searchInput').focus(), 50);
  });
  $('#searchClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  $('#searchInput').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => run(e.target.value), 150); });
  $('#searchResults').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    dlg.close();
    if (b.dataset.ev) { goTo(b.dataset.occ); openEvent(b.dataset.ev, b.dataset.occ); }
    else if (b.dataset.todo) { openTodo(b.dataset.todo); }
    else if (b.dataset.day) { goTo(b.dataset.day); document.querySelector('#diaryText').scrollIntoView({ block: 'center' }); }
  });
  return { run };
})();

/* ---------- 月のまとめ ---------- */
const Report = (() => {
  const $ = s => document.querySelector(s);
  const dlg = $('#reportDialog');
  let month = null;

  function render() {
    const y = month.getFullYear(), m = month.getMonth();
    const from = `${y}-${pad(m + 1)}-01`;
    const last = ymd(new Date(y, m + 1, 0));
    const today = todayStr();
    const to = last < today ? last : today;
    $('#reportTitle').textContent = `${y}年${m + 1}月のまとめ`;

    // 予定：その月に入っている回の数、いちばん予定が多かった日
    const occ = Core.expand(allEvents(), from, last);
    const perDay = {};
    for (const o of occ) for (let s = o.start < from ? from : o.start; s <= o.end && s <= last; s = addDaysStr(s, 1)) perDay[s] = (perDay[s] || 0) + 1;
    const busiest = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0];
    const shared = occ.filter(o => o.ev.calendarId).length;

    // ToDo：その月に完了した数・まだ残っている期限切れ
    const fromMs = new Date(y, m, 1).getTime(), toMs = new Date(y, m + 1, 1).getTime();
    const doneTodos = activeTodos().filter(t => t.done && t.doneAt >= fromMs && t.doneAt < toMs).length;
    const overdue = activeTodos().filter(t => !t.done && t.due && t.due < today).length;

    // 習慣：それぞれの達成率
    const habits = activeHabits();
    const habitRows = habits.map(h => ({ h, r: Core.rate(h, data.marks, from, to) }))
      .filter(x => x.r.total > 0);
    const avg = habitRows.length ? Math.round(habitRows.reduce((a, x) => a + x.r.pct, 0) / habitRows.length) : null;

    // 気分：5段階の数と平均
    const moods = [0, 0, 0, 0, 0];
    let diaryDays = 0;
    for (const [d, v] of Object.entries(data.diary || {})) {
      if (d < from || d > last) continue;
      if (v.mood) moods[v.mood - 1]++;
      if (v.mood || v.text) diaryDays++;
    }
    const moodCount = moods.reduce((a, b) => a + b, 0);
    const moodAvg = moodCount ? (moods.reduce((a, n, i) => a + n * (i + 1), 0) / moodCount) : null;
    const maxMood = Math.max(1, ...moods);

    const stat = (label, value, sub = '') => `<div class="rstat"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    let html = `<div class="rstats">
      ${stat('予定', `${occ.length}件`, shared ? `うち共有 ${shared}件` : '')}
      ${stat('ToDo完了', `${doneTodos}件`, overdue ? `期限切れ ${overdue}件` : '')}
      ${stat('習慣の平均', avg == null ? '—' : `${avg}%`)}
      ${stat('日記', `${diaryDays}日`)}
    </div>`;
    if (busiest) {
      const d = parseYmd(busiest[0]);
      html += `<p class="muted">いちばん予定が多かった日：${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）${busiest[1]}件</p>`;
    }
    html += '<h4 class="acc-sub">習慣の達成率</h4>';
    html += habitRows.length ? '<ul class="rbars">' + habitRows.map(({ h, r }) =>
      `<li><span class="rname"><span class="dot" style="background:${esc(h.color)}"></span>${esc(h.name)}</span>
        <span class="rbar"><i style="width:${r.pct}%;background:${esc(h.color)}"></i></span><span class="rpct">${r.pct}%</span></li>`).join('') + '</ul>'
      : '<p class="muted">この月の習慣の記録はありません。</p>';
    html += '<h4 class="acc-sub">気分</h4>';
    html += moodCount ? `<div class="rmoods">` + MOODS.map((md, i) =>
      `<div class="rmood" style="--mc:${md.color}"><span class="rmood-bar"><i style="height:${Math.round(moods[i] / maxMood * 100)}%"></i></span>${icon(md.icon)}<small>${moods[i]}日</small></div>`).join('') +
      `</div><p class="muted">気分の平均：${moodAvg.toFixed(1)}（${moodOf(Math.round(moodAvg)).name}）</p>`
      : '<p class="muted">この月の気分の記録はありません。カレンダーの日付をタップして、下の「ひとこと日記」で記録できます。</p>';
    $('#reportBody').innerHTML = html;
  }

  function open() {
    month = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    render();
    dlg.showModal();
  }
  $('#openReport').addEventListener('click', open);
  $('#reportClose').addEventListener('click', () => dlg.close());
  $('#reportPrev').addEventListener('click', () => { month.setMonth(month.getMonth() - 1); render(); });
  $('#reportNext').addEventListener('click', () => { month.setMonth(month.getMonth() + 1); render(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  return { open };
})();

/* ---------- クラウドのバックアップ（週1回の自動・手動） ---------- */
const Backup = (() => {
  const $ = s => document.querySelector(s);
  const fmt = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const client = () => (typeof Cloud !== 'undefined' ? Cloud.client : null);
  const loggedIn = () => typeof Cloud !== 'undefined' && !!Cloud.session;

  async function list() {
    const box = $('#bkList');
    box.innerHTML = '<li class="muted small">読み込んでいます…</li>';
    const { data: rows, error } = await client().from('user_backups').select('id,kind,created_at').order('created_at', { ascending: false }).limit(15);
    if (error) { box.innerHTML = '<li class="muted small">読み込めませんでした（ネット接続を確認してください）</li>'; return; }
    box.innerHTML = rows.length ? rows.map(r => `<li><span>${fmt(r.created_at)}<small>　${r.kind === 'auto' ? '自動' : '手動'}</small></span>
      <button class="btn small" data-restore="${r.id}">この時点に戻す</button></li>`).join('')
      : '<li class="muted small">まだバックアップはありません。「今すぐ保存する」で作れます</li>';
  }

  async function saveNow(btn) {
    btn.disabled = true;
    try {
      if (typeof Cloud !== 'undefined') await Cloud.sync(); // 最新の状態をそろえてから保存
      const { error } = await client().from('user_backups').insert({ data: data, kind: 'manual' });
      if (error) throw error;
      App.toast('クラウドに保存しました');
      await list();
    } catch (e) {
      console.warn(e);
      App.toast('保存できませんでした（ネット接続を確認してください）');
    } finally { btn.disabled = false; }
  }

  // 戻す：バックアップの中身を「いま」変更したことにして、ほかの端末にも行き渡らせる
  async function restore(id) {
    const { data: row, error } = await client().from('user_backups').select('data,created_at').eq('id', id).single();
    if (error || !row) { App.toast('読み込めませんでした'); return; }
    if (!confirm(`${fmt(row.created_at)} の状態に戻します。今のデータは、その時点の内容に置きかわります（同期している端末すべて）。よろしいですか？`)) return;
    const now = Date.now();
    const b = App.normalize(row.data);
    const cur = App.normalize(data);
    const touch = list => list.map(x => ({ ...x, updatedAt: now }));
    const tomb = (curList, backList) => {
      const ids = new Set(backList.map(x => x.id));
      return curList.filter(x => !ids.has(x.id)).map(x => ({ id: x.id, deleted: true, updatedAt: now }));
    };
    const restored = {
      ...b,
      events: [...touch(b.events), ...tomb(cur.events, b.events)],
      categories: [...touch(b.categories), ...tomb(cur.categories, b.categories)],
      habits: [...touch(b.habits), ...tomb(cur.habits, b.habits)],
      todos: [...touch(b.todos), ...tomb(cur.todos, b.todos)],
      templates: [...touch(b.templates), ...tomb(cur.templates, b.templates)],
      marks: {}, diary: {},
      appearance: cur.appearance,
    };
    for (const k of new Set([...Object.keys(cur.marks), ...Object.keys(b.marks)])) restored.marks[k] = { ...(b.marks[k] || { on: false }), t: now };
    for (const k of new Set([...Object.keys(cur.diary), ...Object.keys(b.diary)])) restored.diary[k] = { ...(b.diary[k] || { mood: 0, text: '' }), t: now };
    App.replaceData(restored);
    if (typeof Cloud !== 'undefined') Cloud.schedule(100);
    App.toast('バックアップの時点に戻しました');
  }

  function render() {
    const on = loggedIn();
    $('#bkBox').hidden = !on;
    $('#bkLogin').hidden = on;
  }

  $('#bkNow').addEventListener('click', e => saveNow(e.currentTarget));
  $('#bkList').addEventListener('click', e => { const b = e.target.closest('[data-restore]'); if (b) restore(Number(b.dataset.restore)); });
  // 「データの管理」を開いたときに一覧を読み込む
  $('#dataCard').addEventListener('toggle', () => { render(); if ($('#dataCard').open && loggedIn()) list(); });
  document.addEventListener('hibilog:auth', render);
  render();
  return { list, restore };
})();

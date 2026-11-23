'use strict';
/* =====================================================================
 * 共有カレンダー
 *  ・自分の予定（user_data）とは別のテーブルに置き、メンバー全員で読み書きする
 *  ・画面では自分の予定と混ぜて表示する（色は共有カレンダーの色）
 *  ・変更はすぐサーバーへ送る（オフラインのときは変更できない）
 * ===================================================================== */
const Shared = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const APP_URL = new URL('./', location.href).href;
  const NAME_KEY = 'hibilog:displayName';
  let state = { calendars: [], members: [], events: [] };
  let userId = null;
  let refreshing = null;

  const cacheKey = () => `hibilog:shared:${userId}`;
  function loadCache() {
    try { state = JSON.parse(localStorage.getItem(cacheKey())) || state; } catch {}
    if (!Array.isArray(state.events)) state = { calendars: [], members: [], events: [] };
  }
  function persist() { try { localStorage.setItem(cacheKey(), JSON.stringify(state)); } catch {} }

  const client = () => Cloud.client;
  const me = () => (Cloud.session ? Cloud.session.user.id : null);

  /* ---------- 読み込み ---------- */
  async function refresh() {
    if (!Cloud.session || !client()) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const [c, m, e] = await Promise.all([
          client().from('shared_calendars').select('id,name,color,owner,invite_code').order('created_at'),
          client().from('shared_members').select('calendar_id,user_id,display_name'),
          client().from('shared_events').select('id,calendar_id,data,updated_at,updated_by'),
        ]);
        if (c.error || m.error || e.error) throw (c.error || m.error || e.error);
        state = { calendars: c.data, members: m.data, events: e.data };
        persist();
        App.render();
        renderCard();
      } catch (err) {
        console.warn('shared refresh failed', err);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /* ---------- 画面から使う情報 ---------- */
  const calendars = () => state.calendars;
  const calendarById = id => state.calendars.find(c => c.id === id) || null;
  const memberName = (calId, uid) => {
    const m = state.members.find(x => x.calendar_id === calId && x.user_id === uid);
    return m ? (m.display_name || '名前なし') : '';
  };
  // 予定の形にそろえて返す（calendarId 付き）
  function events() {
    return state.events
      .filter(r => calendarById(r.calendar_id))
      .map(r => ({ ...r.data, id: r.id, calendarId: r.calendar_id, updatedBy: r.updated_by, sharedUpdatedAt: r.updated_at }));
  }
  const find = id => events().find(e => e.id === id) || null;

  /* ---------- 書き込み ---------- */
  const strip = ev => {
    const { id, calendarId, updatedBy, sharedUpdatedAt, ...rest } = ev;
    return rest;
  };
  // changed: 予定（calendarId 付き）の配列、removed: 消す予定の id の配列
  async function commit(changed, removed) {
    if (!navigator.onLine) throw new Error('offline');
    if (changed.length) {
      const rows = changed.map(ev => ({ id: ev.id, calendar_id: ev.calendarId, data: strip(ev) }));
      const { data, error } = await client().from('shared_events').upsert(rows).select('id,calendar_id,data,updated_at,updated_by');
      if (error) throw error;
      const ids = new Set(data.map(r => r.id));
      state.events = [...state.events.filter(r => !ids.has(r.id)), ...data];
    }
    if (removed.length) {
      const { error } = await client().from('shared_events').delete().in('id', removed);
      if (error) throw error;
      const ids = new Set(removed);
      state.events = state.events.filter(r => !ids.has(r.id));
    }
    persist();
    if (typeof Cloud !== 'undefined') Cloud.schedule(500); // 通知の予定を作り直す
  }

  function displayName() {
    try {
      const v = localStorage.getItem(NAME_KEY);
      if (v) return v;
    } catch {}
    const email = Cloud.session && Cloud.session.user.email || '';
    return email.split('@')[0].slice(0, 20);
  }

  async function create(name, color) {
    const { data, error } = await client().rpc('create_shared_calendar', { p_name: name, p_color: color, p_display_name: displayName() });
    if (error) throw error;
    await refresh();
    return data;
  }
  async function join(code) {
    const { data, error } = await client().rpc('join_shared_calendar', { p_code: code, p_display_name: displayName() });
    if (error) throw error;
    await refresh();
    return data;
  }
  async function leave(calId) {
    const { error } = await client().from('shared_members').delete().eq('calendar_id', calId).eq('user_id', me());
    if (error) throw error;
    await refresh();
  }
  async function removeCalendar(calId) {
    const { error } = await client().from('shared_calendars').delete().eq('id', calId);
    if (error) throw error;
    await refresh();
  }
  async function rotate(calId) {
    const { error } = await client().rpc('rotate_invite_code', { p_cal: calId });
    if (error) throw error;
    await refresh();
  }
  async function setDisplayName(name) {
    try { localStorage.setItem(NAME_KEY, name); } catch {}
    if (!Cloud.session || !state.calendars.length) return;
    const { error } = await client().from('shared_members').update({ display_name: name.slice(0, 20) }).eq('user_id', me());
    if (error) throw error;
    await refresh();
  }

  function inviteText(c) {
    return `ひびログの共有カレンダー「${c.name}」に招待します。\n` +
      `1. ${APP_URL} を開き、「設定」でログイン（はじめての人は新規登録）\n` +
      `2. 「設定」→「家族と共有」→「招待コードで参加」に次のコードを入力\n${c.invite_code}`;
  }
  async function shareInvite(c) {
    const text = inviteText(c);
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); App.toast('招待の文章をコピーしました'); }
    catch { prompt('この文章を相手に送ってください', text); }
  }

  /* ---------- 設定画面のカード ---------- */
  function friendly(err) {
    const m = String((err && err.message) || err || '');
    if (/invalid invite code/.test(m)) return '招待コードが見つかりません。もう一度確認してください。';
    if (/calendar is full/.test(m)) return 'このカレンダーは満員です（20人まで）。';
    if (/too many calendars/.test(m)) return '作れる共有カレンダーは10個までです。';
    if (/offline|fetch|network/i.test(m)) return 'ネットにつながっていないようです。';
    return 'エラー：' + m;
  }
  function renderCard() {
    const card = $('#sharedCard');
    if (!card) return;
    card.hidden = !Cloud.session;
    if (!Cloud.session) return;
    if (document.activeElement !== $('#shName')) $('#shName').value = displayName();
    $('#sumShared').textContent = state.calendars.length
      ? state.calendars.map(c => c.name).join('・') + `（${state.calendars.length}個）`
      : 'まだありません（作る・参加する）';
    const myId = me();
    $('#sharedList').innerHTML = state.calendars.length ? state.calendars.map(c => {
      const names = state.members.filter(m => m.calendar_id === c.id).map(m => m.display_name || '名前なし');
      const owner = c.owner === myId;
      return `<li>
        <div class="sh-top"><span class="dot big" style="background:${esc(c.color)}"></span>
          <span class="name">${esc(c.name)}<span class="tags">${names.map(esc).join('・')}（${names.length}人）${owner ? ' ・ 作成者' : ''}</span></span></div>
        <div class="row">
          <button class="btn small primary" data-sh-invite="${esc(c.id)}">招待する</button>
          ${owner ? `<button class="btn small" data-sh-rotate="${esc(c.id)}">コードを作り直す</button>
                     <button class="btn small danger" data-sh-delete="${esc(c.id)}">削除</button>`
                  : `<button class="btn small danger" data-sh-leave="${esc(c.id)}">退出</button>`}
        </div>
        <p class="muted small">招待コード：<b class="code">${esc(c.invite_code)}</b></p>
      </li>`;
    }).join('') : '<li class="empty">まだ共有カレンダーはありません</li>';
  }

  async function busy(btn, fn, okMsg) {
    if (btn) btn.disabled = true;
    try { await fn(); if (okMsg) App.toast(okMsg); }
    catch (e) { console.warn(e); App.toast(friendly(e)); }
    finally { if (btn) btn.disabled = false; renderCard(); }
  }

  function wire() {
    $('#shCreate').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#shCalName').value.trim();
      if (!name) return;
      busy(e.submitter, async () => { await create(name, $('#shCalColor').value); $('#shCalName').value = ''; }, `「${name}」を作りました。「招待する」から相手に送れます`);
    });
    $('#shJoin').addEventListener('submit', e => {
      e.preventDefault();
      const code = $('#shCode').value.trim();
      if (!code) return;
      busy(e.submitter, async () => { const c = await join(code); $('#shCode').value = ''; App.toast(`「${c.name}」に参加しました`); });
    });
    $('#shName').addEventListener('change', e => {
      const v = e.target.value.trim().slice(0, 20);
      if (!v) return;
      busy(null, () => setDisplayName(v), '表示名を変更しました');
    });
    $('#sharedList').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const id = b.dataset.shInvite || b.dataset.shRotate || b.dataset.shDelete || b.dataset.shLeave;
      const c = calendarById(id);
      if (!c) return;
      if (b.dataset.shInvite) shareInvite(c);
      else if (b.dataset.shRotate) {
        if (confirm('招待コードを作り直します。前のコードは使えなくなります（参加済みの人はそのまま）。よろしいですか？')) busy(b, () => rotate(id), '新しい招待コードにしました');
      } else if (b.dataset.shDelete) {
        if (confirm(`「${c.name}」を削除します。全員から、このカレンダーと予定が消えます。元に戻せません。よろしいですか？`)) busy(b, () => removeCalendar(id), '削除しました');
      } else if (b.dataset.shLeave) {
        if (confirm(`「${c.name}」から退出しますか？（予定は見えなくなります）`)) busy(b, () => leave(id), '退出しました');
      }
    });

    document.addEventListener('hibilog:auth', () => {
      const id = me();
      if (id !== userId) {
        userId = id;
        state = { calendars: [], members: [], events: [] };
        if (id) loadCache();
        App.render();
      }
      renderCard();
      if (id) refresh();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    // 開いている間は1分ごとに、ほかの人の変更を取りにいく
    setInterval(() => { if (!document.hidden) refresh(); }, 60 * 1000);
  }
  wire();

  return { refresh, calendars, calendarById, memberName, events, find, commit, renderCard, get myId() { return me(); } };
})();

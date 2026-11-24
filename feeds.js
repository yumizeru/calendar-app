'use strict';
/* =====================================================================
 * ほかのカレンダーを表示（iPhone の iCloud・Google・Outlook）
 *  ・カレンダーの「公開URL／非公開URL」を登録すると、その予定を見るだけ表示する
 *  ・URL は同期データ（data.feeds）に入るので、ほかの端末でも同じものが出る
 *  ・予定そのものは端末ごとに取ってきて保存（30分ごとに新しくする）
 *  ・取ってくるのは Supabase の fetch-ics（ブラウザから直接は取れないため）
 * ===================================================================== */
const Feeds = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CACHE_KEY = 'hibilog:feedCache';
  const TTL = 30 * 60 * 1000;
  const COLORS = ['#8e6cf0', '#e0748b', '#2f9e8f', '#d08a2c', '#4f7cff', '#6b8e23'];
  let cache = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } })();
  const persist = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {} };
  const loading = new Set();

  const list = () => (App.data.feeds || []).filter(f => !f.deleted);
  const byId = id => list().find(f => f.id === id) || null;

  // 画面に出す予定（登録されているカレンダーの分だけ）
  function events() {
    const out = [];
    for (const f of list()) {
      const c = cache[f.id];
      if (c && c.url === f.url && Array.isArray(c.events)) for (const e of c.events) out.push(e);
    }
    return out;
  }

  const range = () => {
    const t = new Date();
    return { from: Core.addDaysStr(Core.ymd(t), -60), to: Core.addDaysStr(Core.ymd(t), 400) };
  };

  // サーバー経由で ICS を取ってくる
  async function fetchIcs(url) {
    if (!Cloud.client || !Cloud.session) throw new Error('login');
    if (!navigator.onLine) throw new Error('offline');
    const { data, error } = await Cloud.client.functions.invoke('fetch-ics', { body: { url } });
    if (error) {
      let code = '';
      try { code = (await error.context.json()).error || ''; } catch {}
      throw new Error(code || error.message || 'fetch-failed');
    }
    if (!data || !data.ics) throw new Error((data && data.error) || 'not-ics');
    return data.ics;
  }

  async function load(f, force) {
    const c = cache[f.id];
    if (!force && c && c.url === f.url && Date.now() - c.at < TTL) return;
    if (loading.has(f.id)) return;
    loading.add(f.id);
    try {
      const ics = await fetchIcs(f.url);
      const evs = Core.parseIcs(ics, { ...range(), feedId: f.id });
      cache[f.id] = { url: f.url, at: Date.now(), events: evs, error: '' };
    } catch (e) {
      // 前に取れた分は残しておく
      cache[f.id] = { ...(c && c.url === f.url ? c : { url: f.url, events: [] }), at: Date.now(), error: String(e.message || e) };
      throw e;
    } finally {
      loading.delete(f.id);
      persist();
    }
  }

  async function refresh(force) {
    if (!Cloud.session) return;
    const feeds = list();
    if (!feeds.length) return;
    await Promise.all(feeds.map(f => load(f, force).catch(err => console.warn('feed', f.name, err))));
    // 消したカレンダーの保存分は片付ける
    for (const id of Object.keys(cache)) if (!byId(id)) delete cache[id];
    persist();
    App.render();
    renderCard();
  }

  function friendly(err) {
    const m = String((err && err.message) || err || '');
    if (m === 'login') return '先に「アカウントと同期」でログインしてください。';
    if (m === 'offline' || /network|Failed to fetch/i.test(m)) return 'ネットにつながっていないようです。';
    if (m === 'not-allowed') return 'このURLは使えません。iPhone（iCloud）・Google・Outlook のカレンダーのURLを貼り付けてください。';
    if (m === 'bad-url') return 'URLの形が正しくないようです。コピーし直して貼り付けてください。';
    if (/^http-40[134]$/.test(m)) return 'カレンダーが見つかりませんでした。URLが正しいか、公開（共有）がオンになっているか確かめてください。';
    if (m === 'not-ics') return 'カレンダーのURLではないようです。説明の手順で出てくるURLを貼り付けてください。';
    if (m === 'too-large') return 'カレンダーが大きすぎて読み込めませんでした。';
    if (m === 'timeout') return '時間がかかりすぎました。少したってからもう一度お試しください。';
    return 'カレンダーを読み込めませんでした（' + m + '）';
  }

  /* ---------- 予定を開いたとき（見るだけ） ---------- */
  function show(id) {
    const e = events().find(x => x.id === id);
    if (!e) return;
    const f = byId(e.feedId);
    const d = Core.parseYmd(e.date);
    const when = `${d.getMonth() + 1}月${d.getDate()}日（${Core.WD[d.getDay()]}）` +
      (e.endDate ? `〜${Number(e.endDate.slice(5, 7))}月${Number(e.endDate.slice(8))}日` : '') +
      (e.time ? `　${e.time}${e.endTime ? '〜' + e.endTime : ''}` : '　終日');
    $('#feedEvTitle').textContent = e.title;
    $('#feedEvWhen').textContent = when;
    $('#feedEvPlace').textContent = e.memo ? '場所：' + e.memo : '';
    $('#feedEvPlace').hidden = !e.memo;
    $('#feedEvFrom').innerHTML = `<span class="dot" style="background:${esc(f ? f.color : '#888')}"></span>${esc(f ? f.name : 'ほかのカレンダー')}`;
    $('#feedEvDialog').showModal();
  }

  /* ---------- 設定画面 ---------- */
  function ago(ms) {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return 'たった今';
    if (min < 60) return `${min}分前`;
    return `${Math.round(min / 60)}時間前`;
  }
  function renderCard() {
    const card = $('#feedCard');
    if (!card) return;
    const signed = !!Cloud.session;
    $('#feedLoginNote').hidden = signed;
    $('#feedAdd').hidden = !signed;
    const feeds = list();
    $('#sumFeed').textContent = !signed ? 'ログインすると使えます'
      : feeds.length ? feeds.map(f => f.name).join('・') : 'iPhone・Googleの予定を表示（タップして設定）';
    $('#feedList').innerHTML = feeds.map(f => {
      const c = cache[f.id];
      const st = !c ? '読み込み中…'
        : c.error ? `<span class="error">${esc(friendly(new Error(c.error)))}</span>`
        : `予定${c.events.length}件 ・ 更新：${ago(c.at)}`;
      return `<li>
        <span class="dot big" style="background:${esc(f.color)}"></span>
        <span class="name">${esc(f.name)}<small class="muted">${st}</small></span>
        <button class="btn small danger" data-feed-del="${esc(f.id)}">外す</button>
      </li>`;
    }).join('');
    if (!$('#feedColor').dataset.touched) $('#feedColor').value = COLORS[feeds.length % COLORS.length];
  }

  function wire() {
    $('#feedAdd').addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#feedName').value.trim().slice(0, 20);
      const url = $('#feedUrl').value.trim();
      if (!name || !url) return;
      if (list().some(f => f.url === url)) { App.toast('このカレンダーはもう追加されています'); return; }
      const btn = e.submitter;
      if (btn) btn.disabled = true;
      App.toast('カレンダーを読み込んでいます…');
      const f = { id: 'f' + Date.now().toString(36), name, url, color: $('#feedColor').value, updatedAt: Date.now() };
      try {
        // 先に読めるか試してから登録する
        const ics = await fetchIcs(url);
        const evs = Core.parseIcs(ics, { ...range(), feedId: f.id });
        cache[f.id] = { url, at: Date.now(), events: evs, error: '' };
        persist();
        App.update(d => { d.feeds = (d.feeds || []).concat(f); });
        $('#feedName').value = ''; $('#feedUrl').value = '';
        delete $('#feedColor').dataset.touched;
        App.render();
        App.toast(`「${name}」を追加しました（予定${evs.length}件）`);
      } catch (err) {
        console.warn(err);
        App.toast(friendly(err));
      } finally {
        if (btn) btn.disabled = false;
        renderCard();
      }
    });
    $('#feedColor').addEventListener('input', e => { e.target.dataset.touched = '1'; });
    $('#feedList').addEventListener('click', e => {
      const b = e.target.closest('[data-feed-del]');
      if (!b) return;
      const f = byId(b.dataset.feedDel);
      if (!f || !confirm(`「${f.name}」を外しますか？（元のカレンダーの予定は消えません）`)) return;
      App.update(d => { d.feeds = d.feeds.map(x => (x.id === f.id ? { id: f.id, deleted: true, updatedAt: Date.now() } : x)); });
      delete cache[f.id];
      persist();
      App.render();
      renderCard();
      App.toast(`「${f.name}」を外しました`);
    });
    $('#feedRefresh').addEventListener('click', async e => {
      e.currentTarget.disabled = true;
      await refresh(true);
      e.currentTarget.disabled = false;
      App.toast('ほかのカレンダーを新しくしました');
    });
    $('#feedEvClose').addEventListener('click', () => $('#feedEvDialog').close());
    $('#feedEvDialog').addEventListener('click', e => { if (e.target.id === 'feedEvDialog') e.target.close(); });
    document.addEventListener('hibilog:auth', () => { renderCard(); refresh(false); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
    // ほかの端末で追加したカレンダーが同期で届いたとき
    App.onChange(() => { renderCard(); if (list().some(f => !cache[f.id] || cache[f.id].url !== f.url)) refresh(false); });
    renderCard();
    // app.js の最初の表示はこのファイルより先なので、保存してある予定を出すために描き直す
    // （Feeds ができあがってから呼ぶため、少しだけ後にする）
    if (list().length) setTimeout(() => App.render(), 0);
    setTimeout(() => refresh(false), 800);
  }
  wire();

  return { events, byId, list, refresh, show, renderCard };
})();

'use strict';
/* =====================================================================
 * クラウド同期（Supabase）
 *  - メールアドレスとパスワードでログイン
 *  - 端末のデータとクラウドのデータを合わせて、両方を同じ状態にする
 *  - リマインダーの予定時刻をクラウドに登録する（通知はサーバーから送る）
 * ===================================================================== */
const Cloud = (() => {
  // 公開用の設定（publishable キーはアプリに埋め込む前提のキー）
  const SUPABASE_URL = 'https://qfhtjrubmjuvabcmpzjn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_zc86u4BRcsmfWfaKZGRsNw_cod3V7Xp';
  const LAST_SYNC_KEY = 'hibilog:lastSync';

  const $ = s => document.querySelector(s);
  let client = null;
  let session = null;
  let syncing = false;
  let again = false;
  let timer = null;

  if (window.supabase && window.supabase.createClient) {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'hibilog-auth' },
    });
  }

  /* ---------- 画面 ---------- */
  function fmtTime(ts) {
    if (!ts) return 'まだ同期していません';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `最終同期：${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function setStatus(msg, isError) {
    const el = $('#syncStatus');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }
  function renderAccount() {
    const out = $('#cloudOut'), inn = $('#cloudIn');
    if (!client) {
      out.hidden = false; inn.hidden = true;
      $('#cloudUnavailable').hidden = false;
      $('#loginForm').hidden = true;
      return;
    }
    $('#cloudUnavailable').hidden = true;
    if (session) {
      out.hidden = true; inn.hidden = false;
      $('#accountEmail').textContent = session.user.email || '';
      let last = 0;
      try { last = Number(localStorage.getItem(LAST_SYNC_KEY)) || 0; } catch {}
      setStatus(fmtTime(last));
    } else {
      out.hidden = false; inn.hidden = true;
      $('#loginForm').hidden = false;
    }
    document.body.classList.toggle('signed-in', !!session);
    document.dispatchEvent(new CustomEvent('hibilog:auth'));
  }

  /* ---------- ログイン ---------- */
  async function signUp(email, password) {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    // 「Confirm email」がオンのままだと session が返らない
    if (!data.session) throw new Error('needs-confirmation');
    session = data.session;
  }
  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    session = data.session;
  }
  async function signOut() {
    // この端末への通知も止める（ログアウト後に他人の予定が届かないように）
    if (window.Push) await window.Push.disable().catch(() => {});
    await client.auth.signOut().catch(() => {});
    session = null;
    try { localStorage.removeItem(LAST_SYNC_KEY); } catch {}
  }

  function friendlyError(err) {
    const m = String((err && (err.message || err.error_description)) || err || '');
    if (m === 'needs-confirmation' || /email not confirmed/i.test(m)) return 'メール確認が必要な設定になっています（Supabaseの「Confirm email」をオフにしてください）。';
    if (/invalid login credentials/i.test(m)) return 'メールアドレスかパスワードが違います。';
    if (/already registered|already exists/i.test(m)) return 'このメールアドレスは登録済みです。「ログイン」を押してください。';
    if (/password/i.test(m) && /(least|short|weak|characters)/i.test(m)) return 'パスワードが短すぎるか簡単すぎます。8文字以上で、英字と数字を混ぜてください。';
    if (/invalid.*email|email.*invalid/i.test(m)) return 'メールアドレスの形式が正しくありません。';
    if (/rate limit|too many|security purposes/i.test(m)) return '試行回数が多すぎます。しばらく待ってからもう一度お試しください。';
    if (/fetch|network|failed/i.test(m)) return 'ネットにつながっていないようです。';
    return 'エラー：' + m;
  }

  /* ---------- リマインダー ---------- */
  function buildReminders(d) {
    const now = Date.now();
    const limit = now + 60 * 24 * 3600 * 1000; // 60日先まで
    const from = Core.ymd(new Date(now - 86400000));
    const to = Core.ymd(new Date(limit + 86400000));
    const items = [];
    // 繰り返しの予定も1回ずつに展開してから通知時刻を計算する
    for (const o of Core.expand(d.events, from, to)) {
      const e = o.ev;
      if (e.remind == null || e.remind === '' || o.start < from) continue;
      const [y, m, day] = o.start.split('-').map(Number);
      const [hh, mm] = (e.time || '09:00').split(':').map(Number);
      const base = new Date(y, m - 1, day, hh, mm).getTime();
      const fire = base - Number(e.remind) * 60000;
      if (fire < now - 60000 || fire > limit) continue;
      const when = e.time ? (e.endTime ? `${e.time}–${e.endTime}` : e.time) : '終日';
      const lead = Number(e.remind) === 0 ? '' : Number(e.remind) === 1440 ? '明日 ' : `${e.remind >= 60 ? e.remind / 60 + '時間' : e.remind + '分'}後 `;
      items.push({
        event_id: o.key,
        fire_at: new Date(fire).toISOString(),
        title: e.title,
        body: `${lead}${when}${e.memo ? '・' + e.memo.slice(0, 60) : ''}`,
      });
    }
    // 習慣：14日先まで毎日の通知を登録。「もう達成していたら送らない」はサーバー側で確認する
    const today = Core.ymd(new Date(now));
    for (const h of d.habits || []) {
      if (h.deleted || !h.remindAt) continue;
      const [hh, mm] = h.remindAt.split(':').map(Number);
      for (let i = 0; i < 14; i++) {
        const s = Core.addDaysStr(today, i);
        if (!Core.isDue(h, s)) continue;
        if (Core.doneOn(h, d.marks, s)) continue;
        const [y, m, day] = s.split('-').map(Number);
        const fire = new Date(y, m - 1, day, hh, mm).getTime();
        if (fire < now - 60000) continue;
        let body = 'まだ記録がありません';
        if (Core.isNumeric(h)) body = `今日の目標 ${Core.fmtNum(h.target.value)}${h.target.unit || ''}`;
        if (Core.freqOf(h).type === 'weekly') body = `今週 ${Core.weekCount(h, d.marks, s)}/${Core.weekNeed(h)}回`;
        items.push({ event_id: `habit:${h.id}@${s}`, fire_at: new Date(fire).toISOString(), title: `✅ ${h.name}`, body });
      }
    }
    items.sort((a, b) => a.fire_at.localeCompare(b.fire_at));
    return items.slice(0, 500);
  }

  /* ---------- 同期 ---------- */
  async function sync() {
    if (!client || !session) return;
    if (!navigator.onLine) { setStatus('オフラインです（つながったら自動で同期します）'); return; }
    if (syncing) { again = true; return; }
    syncing = true;
    setStatus('同期中…');
    try {
      const userId = session.user.id;
      const { data: row, error: e1 } = await client
        .from('user_data').select('data').eq('user_id', userId).maybeSingle();
      if (e1) throw e1;

      const merged = App.mergeData(App.data, row ? row.data : null);
      App.replaceData(merged);

      const { error: e2 } = await client
        .from('user_data')
        .upsert({ user_id: userId, data: merged, updated_at: new Date().toISOString() });
      if (e2) throw e2;

      const { error: e3 } = await client.rpc('replace_reminders', { p_items: buildReminders(merged) });
      if (e3) throw e3;

      const now = Date.now();
      try { localStorage.setItem(LAST_SYNC_KEY, String(now)); } catch {}
      setStatus(fmtTime(now));
    } catch (err) {
      console.warn('sync failed', err);
      if (err && /JWT|session|401|403/i.test(String(err.message || err.code || ''))) {
        setStatus('ログインの有効期限が切れました。もう一度ログインしてください。', true);
      } else {
        setStatus('同期できませんでした：' + friendlyError(err), true);
      }
    } finally {
      syncing = false;
      if (again) { again = false; schedule(300); }
    }
  }
  function schedule(ms = 1500) {
    if (!session) return;
    clearTimeout(timer);
    timer = setTimeout(sync, ms);
  }

  /* ---------- 起動 ---------- */
  async function init() {
    renderAccount();
    if (!client) return;

    const { data } = await client.auth.getSession();
    session = data.session;
    renderAccount();
    client.auth.onAuthStateChange((_event, s) => {
      const was = !!session;
      session = s;
      renderAccount();
      if (!was && s) schedule(100);
    });

    App.onChange(() => schedule());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(200); });
    window.addEventListener('online', () => schedule(200));
    if (session) schedule(100);

    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const mode = (e.submitter && e.submitter.dataset.mode) || 'login';
      const email = $('#loginEmail').value.trim();
      const password = $('#loginPassword').value;
      if (!email || !password) return;
      if (mode === 'signup' && !confirm(`${email} で新しく登録します。パスワードはメモしましたか？`)) return;
      const btns = document.querySelectorAll('#loginForm button');
      btns.forEach(b => { b.disabled = true; });
      try {
        if (mode === 'signup') await signUp(email, password);
        else await signIn(email, password);
        $('#loginPassword').value = '';
        renderAccount();
        App.toast(mode === 'signup' ? '登録しました。同期を始めます。' : 'ログインしました。同期を始めます。');
        schedule(100);
      } catch (err) {
        App.toast(friendlyError(err));
      } finally {
        btns.forEach(b => { b.disabled = false; });
      }
    });
    $('#syncNow').addEventListener('click', () => sync());
    $('#logoutBtn').addEventListener('click', async () => {
      if (!confirm('ログアウトしますか？（この端末のデータは残ります）')) return;
      await signOut();
      renderAccount();
      App.toast('ログアウトしました');
    });
  }

  init();
  return {
    get client() { return client; },
    get session() { return session; },
    sync, schedule, buildReminders,
  };
})();

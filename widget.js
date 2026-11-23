'use strict';
/* =====================================================================
 * ウィジェット設定（Scriptable 用スクリプトを作ってコピーする）
 *  ウィジェットはログインできないので、本人専用の「合言葉」で読み取る
 * ===================================================================== */
const WidgetSetup = (() => {
  const SUPABASE_URL = 'https://qfhtjrubmjuvabcmpzjn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_zc86u4BRcsmfWfaKZGRsNw_cod3V7Xp';
  const APP_URL = new URL('./', location.href).href;
  const $ = s => document.querySelector(s);
  let script = '';
  let loadingFor = null;

  async function getToken(create) {
    const uid = Cloud.session.user.id;
    const { data, error } = await Cloud.client.from('widget_tokens').select('token').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    if (data) return data.token;
    if (!create) return null;
    const { data: row, error: e2 } = await Cloud.client.from('widget_tokens').insert({ user_id: uid }).select('token').single();
    if (e2) throw e2;
    return row.token;
  }

  async function build(token) {
    const res = await fetch('scriptable-widget.js', { cache: 'no-cache' });
    if (!res.ok) throw new Error('scriptable-widget.js を読み込めませんでした');
    const body = await res.text();
    const cfg = { url: SUPABASE_URL, key: SUPABASE_KEY, token, appUrl: APP_URL };
    return '// Variables used by Scriptable.\n// icon-color: blue; icon-glyph: calendar-alt;\n' +
      `// ひびログ ウィジェット（この合言葉は他人に見せないでください）\nconst CONFIG = ${JSON.stringify(cfg)};\n\n` + body;
  }

  async function prepare() {
    const s = Cloud.session;
    if (!s || loadingFor === s.user.id) return;
    loadingFor = s.user.id;
    script = '';
    setStatus('準備中…');
    try {
      script = await build(await getToken(true));
      $('#widgetScript').value = script;
      setStatus('準備できました。「スクリプトをコピー」を押してください。');
    } catch (e) {
      console.warn(e);
      loadingFor = null;
      setStatus('準備できませんでした（ネット接続を確認して、設定タブを開き直してください）');
    }
  }

  function setStatus(msg) { $('#widgetStatus').textContent = msg; }

  async function copy() {
    if (!script) { App.toast('まだ準備中です。少し待ってください。'); return; }
    try {
      await navigator.clipboard.writeText(script);
      App.toast('コピーしました。Scriptableに貼り付けてください。');
    } catch {
      // コピーできない環境では、全選択した状態のテキスト欄を見せる
      const ta = $('#widgetScript');
      ta.hidden = false;
      ta.focus();
      ta.select();
      App.toast('自動でコピーできませんでした。表示された文字をすべてコピーしてください。');
    }
  }

  async function regenerate() {
    if (!confirm('合言葉を作り直します。今あるウィジェットは表示されなくなるので、スクリプトを貼り直す必要があります。よろしいですか？')) return;
    try {
      const { error } = await Cloud.client.from('widget_tokens').delete().eq('user_id', Cloud.session.user.id);
      if (error) throw error;
      loadingFor = null;
      $('#widgetScript').hidden = true;
      await prepare();
      App.toast('合言葉を作り直しました');
    } catch (e) {
      App.toast('作り直せませんでした：' + (e.message || e));
    }
  }

  function render() {
    const card = $('#widgetCard');
    card.hidden = !Cloud.session;
    if (!Cloud.session) { loadingFor = null; script = ''; return; }
    if (!$('#view-settings').hidden) prepare();
  }

  $('#widgetCopy').addEventListener('click', copy);
  $('#widgetRegen').addEventListener('click', regenerate);
  document.addEventListener('hibilog:auth', render);
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', render));
  render();
  return { render };
})();

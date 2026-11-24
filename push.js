'use strict';
/* =====================================================================
 * リマインダー通知（Web Push）
 *  iPhone では「ホーム画面に追加」したアプリから開いたときだけ使える（iOS 16.4 以降）
 * ===================================================================== */
const Push = (() => {
  // 公開鍵（秘密鍵は Supabase の Secrets にだけ置く）
  const VAPID_PUBLIC_KEY = 'BNuj41XuWEOdgdSSxiAKPa_yUB1rdVUB8IrBkpsm3MnFnEq8xO8433PiQ68YFoSLxubzgRPxoWMJx6h7eZnljRU';
  const FUNCTION_URL = 'https://qfhtjrubmjuvabcmpzjn.supabase.co/functions/v1/send-reminders';
  const $ = s => document.querySelector(s);

  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  const b64uToBytes = s => {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
    return Uint8Array.from(b, c => c.charCodeAt(0));
  };

  async function currentSub() {
    if (!supported) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function saveSub(sub) {
    const j = sub.toJSON();
    const { error } = await Cloud.client.from('push_subscriptions').upsert({
      endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    });
    if (error) throw error;
  }

  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('denied');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(VAPID_PUBLIC_KEY) });
    }
    await saveSub(sub);
  }

  async function disable() {
    const sub = await currentSub();
    if (!sub) return;
    if (Cloud.session) await Cloud.client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe().catch(() => {});
  }

  async function test() {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Cloud.session.access_token}` },
      body: JSON.stringify({ test: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || (body.errors && body.errors[0]) || `HTTP ${res.status}`);
  }

  async function render() {
    const card = $('#pushCard');
    if (!card) return;
    card.hidden = !Cloud.session;
    if (!Cloud.session) return;
    const status = $('#pushStatus');
    // 閉じているときに出す状態（ボタンの出し方から決める）
    const show = (on, off, testBtn) => {
      $('#pushEnable').hidden = !on; $('#pushDisable').hidden = !off; $('#pushTest').hidden = !testBtn;
      const sum = $('#sumPush');
      if (sum) sum.textContent = off ? 'この端末でオン' : on ? 'オフ（タップしてオンにする）' : '使えません（くわしくはタップ）';
    };
    if (!supported || (isIOS && !standalone)) {
      status.textContent = isIOS
        ? '通知を使うには、Safariの共有ボタン →「ホーム画面に追加」で追加したアプリから開いてください（iOS 16.4以降）。'
        : 'このブラウザは通知に対応していません。';
      show(false, false, false);
      return;
    }
    if (Notification.permission === 'denied') {
      status.textContent = isIOS
        ? '通知がブロックされています。iPhoneの「設定」→「通知」→「ひびログ」で許可してください。'
        : '通知がブロックされています。ブラウザのサイト設定で、このページの通知を許可してください。';
      show(false, false, false);
      return;
    }
    const sub = await currentSub().catch(() => null);
    if (sub && Notification.permission === 'granted') {
      status.textContent = 'この端末で通知オン。リマインダーを設定した予定や習慣の時刻にお知らせします。';
      show(false, true, true);
      saveSub(sub).catch(() => {}); // 念のため登録を最新にしておく
    } else {
      status.textContent = '通知はオフです。';
      show(true, false, false);
    }
  }

  function friendly(err) {
    const m = String((err && err.message) || err);
    if (m === 'denied') return '通知が許可されませんでした。';
    if (/登録がありません/.test(m)) return 'この端末の通知登録が見つかりません。一度オフにしてから、もう一度オンにしてください。';
    if (/fetch|network/i.test(m)) return 'ネットにつながっていないようです。';
    return 'エラー：' + m;
  }

  function wire() {
    const busy = async (btn, fn, okMsg) => {
      btn.disabled = true;
      try { await fn(); if (okMsg) App.toast(okMsg); }
      catch (e) { console.warn(e); App.toast(friendly(e)); }
      finally { btn.disabled = false; render(); }
    };
    $('#pushEnable').addEventListener('click', e => busy(e.currentTarget, enable, '通知をオンにしました'));
    $('#pushDisable').addEventListener('click', e => busy(e.currentTarget, disable, '通知をオフにしました'));
    $('#pushTest').addEventListener('click', e => busy(e.currentTarget, test, 'テスト通知を送りました'));
    document.addEventListener('hibilog:auth', render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    render();
  }
  wire();

  return { render, disable, get supported() { return supported; } };
})();

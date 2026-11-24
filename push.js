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

  async function test(kind) {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Cloud.session.access_token}` },
      body: JSON.stringify({ test: kind === 'morning' ? 'morning' : true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || (body.errors && body.errors[0]) || `HTTP ${res.status}`);
  }

  /* ---------- 毎朝のまとめ（サーバーが決まった時刻に送る） ---------- */
  let pushOn = false;
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'; } catch { return 'Asia/Tokyo'; } };
  const wxPlace = () => (typeof Weather !== 'undefined' ? Weather.place : null);
  const morning = () => App.data.morning || { on: false, time: '07:00' };
  function setMorning(p) {
    const { t, ...cur } = morning();
    const next = { on: false, time: '07:00', ...cur, ...p, tz: tz(), wx: wxPlace() };
    App.update(d => { d.morning = { ...next, t: Date.now() }; });
    renderMorning();
  }
  // 天気の場所や時間帯が変わったら合わせる
  function syncMorning() {
    const m = App.data.morning;
    if (m && m.on && (JSON.stringify(m.wx || null) !== JSON.stringify(wxPlace()) || m.tz !== tz())) setMorning({});
  }
  function renderMorning() {
    const sel = $('#mnTime');
    if (!sel.options.length) {
      for (let h = 5; h <= 10; h++) for (const mm of ['00', '30']) {
        const v = `${String(h).padStart(2, '0')}:${mm}`;
        sel.add(new Option(`${h}:${mm}`, v));
      }
    }
    const m = morning();
    $('#mnOn').checked = !!m.on;
    $('#mnTimeRow').hidden = !m.on;
    $('#mnTest').hidden = !(m.on && pushOn);
    sel.value = m.time || '07:00';
    const w = wxPlace();
    $('#mnNote').textContent = !m.on ? '' :
      `毎朝${Number(sel.value.slice(0, 2))}:${sel.value.slice(3)}ごろに届きます。` +
      (w ? `天気は「${w.name || '設定した場所'}」です。` : '天気も入れるには「天気予報」をオンにしてください。') +
      (pushOn ? '' : 'この端末で受け取るには、上の「通知をオンにする」を押してください。');
  }

  async function render() {
    const card = $('#pushCard');
    if (!card) return;
    card.hidden = !Cloud.session;
    if (!Cloud.session) return;
    pushOn = false;
    renderMorning();
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
      pushOn = true;
      renderMorning();
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
    $('#pushTest').addEventListener('click', e => busy(e.currentTarget, () => test(), 'テスト通知を送りました'));
    $('#mnTest').addEventListener('click', e => busy(e.currentTarget, () => test('morning'), '今日のまとめを送りました'));
    $('#mnOn').addEventListener('change', e => {
      setMorning({ on: e.target.checked });
      App.toast(e.target.checked ? `毎朝${$('#mnTime').value}ごろに、今日のまとめを届けます` : '毎朝のまとめをやめました');
    });
    $('#mnTime').addEventListener('change', e => {
      setMorning({ time: e.target.value });
      App.toast(`毎朝${e.target.value}ごろに届けます`);
    });
    document.addEventListener('hibilog:weather', () => { syncMorning(); renderMorning(); });
    syncMorning();
    document.addEventListener('hibilog:auth', render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    render();
  }
  wire();

  return { render, disable, get supported() { return supported; } };
})();

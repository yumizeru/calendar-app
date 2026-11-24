'use strict';
/* =====================================================================
 * 天気予報（Open-Meteo：無料・登録不要）
 *  ・設定でオンにしたときだけ使う。場所は「現在地」か「都市名でさがす」
 *  ・送るのは小数2けたに丸めた緯度・経度だけ（約1km単位）
 *  ・16日先まで。2時間ごとに取り直し、それまではこの端末に保存した分を使う
 * ===================================================================== */
const Weather = (() => {
  const PREF_KEY = 'hibilog:weather';
  const CACHE_KEY = 'hibilog:weatherCache';
  const TTL = 2 * 3600 * 1000;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  let pref = load(PREF_KEY, { on: false });
  let cache = load(CACHE_KEY, null);
  let loading = false;

  // 天気コード（WMO）→ アイコンと名前
  function kind(code) {
    if (code === 0) return { icon: 'sun', name: '晴れ' };
    if (code <= 2) return { icon: 'cloud-sun', name: '晴れ時々くもり' };
    if (code === 3) return { icon: 'cloud', name: 'くもり' };
    if (code === 45 || code === 48) return { icon: 'cloud-fog', name: '霧' };
    if (code >= 51 && code <= 57) return { icon: 'cloud-drizzle', name: '小雨' };
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: 'cloud-rain', name: '雨' };
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'cloud-snow', name: '雪' };
    if (code >= 95) return { icon: 'cloud-lightning', name: '雷雨' };
    return { icon: 'cloud', name: 'くもり' };
  }

  const keyOf = p => `${p.lat},${p.lon}`;
  function get(date) {
    if (!pref.on || !cache || cache.key !== keyOf(pref)) return null;
    return cache.days[date] || null;
  }

  async function refresh(force) {
    if (!pref.on || pref.lat == null || loading) return;
    if (!force && cache && cache.key === keyOf(pref) && Date.now() - cache.at < TTL) return;
    if (!navigator.onLine) return;
    loading = true;
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
        latitude: pref.lat, longitude: pref.lon,
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        timezone: 'auto', forecast_days: '16',
      });
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const d = j.daily;
      const days = {};
      d.time.forEach((t, i) => {
        days[t] = { code: d.weather_code[i], max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]), pop: d.precipitation_probability_max[i] };
      });
      cache = { key: keyOf(pref), at: Date.now(), days };
      store(CACHE_KEY, cache);
      if (typeof App !== 'undefined') App.render();
    } catch (e) {
      console.warn('weather failed', e);
    } finally {
      loading = false;
    }
  }

  /* ---------- 画面に出す部品 ---------- */
  // カレンダーのマスに出す小さなアイコン
  function mini(date) {
    const w = get(date);
    if (!w) return '';
    const k = kind(w.code);
    return `<span class="wx-mini" title="${k.name} ${w.max}°/${w.min}°">${icon(k.icon)}</span>`;
  }
  // 週・リスト・1列に出す「アイコン＋気温」
  function short(date) {
    const w = get(date);
    if (!w) return '';
    const k = kind(w.code);
    return `<span class="wx-short" title="${k.name}">${icon(k.icon)}<span class="hi">${w.max}°</span><span class="lo">${w.min}°</span></span>`;
  }
  // 日付をタップした下に出す1行
  function line(date) {
    const w = get(date);
    if (!w) return '';
    const k = kind(w.code);
    return `<div class="wx-line">${icon(k.icon)}<b>${k.name}</b><span class="hi">${w.max}°</span>/<span class="lo">${w.min}°</span>${w.pop != null ? `<span class="pop">降水${w.pop}%</span>` : ''}<span class="place">${esc(pref.name || '')}</span></div>`;
  }

  /* ---------- 設定 ---------- */
  // ウィジェットでも天気を出せるように、場所を同期データ（data.wxPlace）に入れる
  function syncPlace() {
    if (typeof App === 'undefined' || !App.update) return;
    const want = pref.on && pref.lat != null ? { lat: pref.lat, lon: pref.lon, name: pref.name || '' } : { off: true };
    const { t, ...cur } = App.data.wxPlace || {};
    if (JSON.stringify(cur) === JSON.stringify(want)) return;
    App.update(d => { d.wxPlace = { ...want, t: Date.now() }; });
  }
  function setPref(p) {
    pref = { ...pref, ...p };
    store(PREF_KEY, pref);
    document.dispatchEvent(new CustomEvent('hibilog:weather'));
    syncPlace();
    renderSettings();
    if (typeof App !== 'undefined') App.render();
    refresh(true);
  }
  function summary() {
    if (!pref.on) return 'オフ';
    return pref.name ? `オン ・ ${pref.name}` : 'オン（場所を選んでください）';
  }
  function renderSettings() {
    const sw = $('#wxOn');
    if (!sw) return;
    sw.checked = !!pref.on;
    $('#wxBody').hidden = !pref.on;
    $('#wxPlace').textContent = pref.name ? `いまの場所：${pref.name}` : 'まだ場所が選ばれていません';
    const sum = $('#sumWeather');
    if (sum) sum.textContent = summary();
  }
  const round = v => Math.round(v * 100) / 100;

  function wire() {
    if (!$('#wxOn')) return;
    $('#wxOn').addEventListener('change', e => setPref({ on: e.target.checked }));
    $('#wxHere').addEventListener('click', () => {
      if (!navigator.geolocation) { App.toast('この端末では現在地を使えません。都市名でさがしてください'); return; }
      App.toast('現在地を確認しています…');
      navigator.geolocation.getCurrentPosition(
        p => setPref({ lat: round(p.coords.latitude), lon: round(p.coords.longitude), name: '現在地' }),
        () => App.toast('現在地を使えませんでした。都市名でさがしてください'),
        { timeout: 10000, maximumAge: 3600000 });
    });
    $('#wxSearch').addEventListener('submit', async e => {
      e.preventDefault();
      const q = $('#wxCity').value.trim();
      if (!q) return;
      const box = $('#wxResults');
      box.innerHTML = '<li class="muted small">さがしています…</li>';
      try {
        const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: '6', language: 'ja' }));
        const j = await r.json();
        const list = j.results || [];
        box.innerHTML = list.length ? list.map(x => `<li><button type="button" data-lat="${round(x.latitude)}" data-lon="${round(x.longitude)}" data-name="${esc(x.name)}">
          ${icon('map-pin')}<span><b>${esc(x.name)}</b><small>${esc([x.admin1, x.country].filter(Boolean).join('・'))}</small></span></button></li>`).join('')
          : '<li class="muted small">見つかりませんでした。ひらがなや市の名前（例：熊本市）でも試してください</li>';
      } catch {
        box.innerHTML = '<li class="muted small">さがせませんでした（ネット接続を確認してください）</li>';
      }
    });
    $('#wxResults').addEventListener('click', e => {
      const b = e.target.closest('button[data-lat]');
      if (!b) return;
      setPref({ lat: Number(b.dataset.lat), lon: Number(b.dataset.lon), name: b.dataset.name });
      $('#wxResults').innerHTML = '';
      $('#wxCity').value = '';
      App.toast(`${b.dataset.name}の天気を表示します`);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    renderSettings();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  // 前から天気をオンにしている人の分も入れておく（app.js の読み込み後）
  window.addEventListener('load', () => { if (pref.on) syncPlace(); });
  setTimeout(() => refresh(), 500);
  return {
    get, mini, short, line, summary, refresh, kind, get on() { return !!pref.on; },
    // 毎朝のまとめ通知で使う場所（オンのときだけ）
    get place() { return pref.on && pref.lat != null ? { lat: pref.lat, lon: pref.lon, name: pref.name || '' } : null; },
  };
})();

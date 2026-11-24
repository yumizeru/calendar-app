'use strict';
/* =====================================================================
 * テーマ（色）
 *  テーマ ＝「アクセントの色」×「背景の色合い」の組み合わせ。
 *  ・おすすめの組み合わせ（かわいい〜かっこいい）から選ぶ
 *  ・アクセントと背景を自由に組み合わせる
 *  この端末だけの設定。画面がちらつかないよう <head> で読み込んで、すぐ色を当てる。
 * ===================================================================== */
const Theme = (() => {
  const KEY = 'hibilog:theme';

  // 背景の色合い（画面の地の色・カード・文字・線）
  const BASES = {
    auto:     { name: '自動（端末に合わせる）', tone: 'auto' },
    snow:     { name: 'スノー',       tone: 'light', bg: '#f6f7fb', surface: '#ffffff', surface2: '#eef0f6', text: '#1c1f27', muted: '#6b7280', border: '#e2e5ee' },
    cream:    { name: 'クリーム',     tone: 'light', bg: '#faf6ef', surface: '#fffdf8', surface2: '#f2ece1', text: '#2b2620', muted: '#7a6f62', border: '#e8dfd0' },
    blush:    { name: 'ブラッシュ',   tone: 'light', bg: '#fdf3f6', surface: '#fffafc', surface2: '#f8e8ee', text: '#2d1f25', muted: '#8a6b76', border: '#f0dbe2' },
    mist:     { name: 'ミスト',       tone: 'light', bg: '#eff3f8', surface: '#ffffff', surface2: '#e3e9f1', text: '#0f172a', muted: '#64748b', border: '#d6dee9' },
    mint:     { name: 'ミント',       tone: 'light', bg: '#eff7f3', surface: '#fbfefc', surface2: '#e1f0e8', text: '#13261d', muted: '#5d7a6c', border: '#d3e7dc' },
    lilac:    { name: 'ライラック',   tone: 'light', bg: '#f5f3fc', surface: '#fdfcff', surface2: '#ebe7f8', text: '#221d33', muted: '#736a8c', border: '#e0daf2' },
    charcoal: { name: 'チャコール',   tone: 'dark',  bg: '#14161c', surface: '#1d2028', surface2: '#262a34', text: '#e8eaf0', muted: '#9aa1ae', border: '#2f3440' },
    midnight: { name: 'ミッドナイト', tone: 'dark',  bg: '#0a1120', surface: '#111a2d', surface2: '#19243d', text: '#e6ecf7', muted: '#93a3bf', border: '#243250' },
    black:    { name: 'ブラック',     tone: 'dark',  bg: '#000000', surface: '#0f0f11', surface2: '#1b1b1f', text: '#f2f2f2', muted: '#9a9aa0', border: '#28282d' },
    espresso: { name: 'エスプレッソ', tone: 'dark',  bg: '#16110e', surface: '#201915', surface2: '#2b221c', text: '#f1e8df', muted: '#b2a293', border: '#3a2f27' },
    forest:   { name: 'フォレスト',   tone: 'dark',  bg: '#0e1613', surface: '#15201b', surface2: '#1d2b24', text: '#e3efe8', muted: '#93ad9f', border: '#26382f' },
  };

  // アクセントの色（ボタン・今日の印・選んでいるもの）
  const ACCENTS = [
    { id: 'blue',     name: 'ブルー',       hex: '#4f7cff' },
    { id: 'sakura',   name: 'さくら',       hex: '#ec4899' },
    { id: 'peach',    name: 'ピーチ',       hex: '#fb7185' },
    { id: 'coral',    name: 'コーラル',     hex: '#f97362' },
    { id: 'orange',   name: 'オレンジ',     hex: '#f97316' },
    { id: 'lemon',    name: 'レモン',       hex: '#eab308' },
    { id: 'matcha',   name: '抹茶',         hex: '#65a30d' },
    { id: 'mint',     name: 'ミント',       hex: '#10b981' },
    { id: 'teal',     name: 'ティール',     hex: '#0d9488' },
    { id: 'soda',     name: 'ソーダ',       hex: '#0ea5e9' },
    { id: 'cyan',     name: 'シアン',       hex: '#06b6d4' },
    { id: 'navy',     name: 'ネイビー',     hex: '#1d4ed8' },
    { id: 'indigo',   name: 'インディゴ',   hex: '#4f46e5' },
    { id: 'lavender', name: 'ラベンダー',   hex: '#a78bfa' },
    { id: 'violet',   name: 'バイオレット', hex: '#7c3aed' },
    { id: 'crimson',  name: 'クリムゾン',   hex: '#dc2626' },
    { id: 'bordeaux', name: 'ボルドー',     hex: '#9f1239' },
    { id: 'terracotta', name: 'テラコッタ', hex: '#c2410c' },
    { id: 'gold',     name: 'ゴールド',     hex: '#c9a227' },
    { id: 'forest',   name: 'フォレスト',   hex: '#15803d' },
    { id: 'slate',    name: 'スレート',     hex: '#64748b' },
    { id: 'graphite', name: 'グラファイト', hex: '#3f3f46' },
  ];
  const accentById = id => ACCENTS.find(a => a.id === id);

  // おすすめの組み合わせ
  const PRESETS = [
    { group: 'シンプル', id: 'default',   name: 'ひびログ（標準）', accent: 'blue',     base: 'auto' },
    { group: 'シンプル', id: 'white',     name: 'ホワイト',         accent: 'blue',     base: 'snow' },
    { group: 'シンプル', id: 'mono',      name: 'モノトーン',       accent: 'graphite', base: 'snow' },
    { group: 'シンプル', id: 'dark',      name: 'ダーク',           accent: 'blue',     base: 'charcoal' },
    { group: 'かわいい', id: 'sakura',    name: 'さくら',           accent: 'sakura',   base: 'blush' },
    { group: 'かわいい', id: 'peach',     name: 'ピーチ',           accent: 'peach',    base: 'cream' },
    { group: 'かわいい', id: 'lavender',  name: 'ラベンダー',       accent: 'lavender', base: 'lilac' },
    { group: 'かわいい', id: 'mintcream', name: 'ミントクリーム',   accent: 'mint',     base: 'mint' },
    { group: 'かわいい', id: 'soda',      name: 'ソーダ',           accent: 'soda',     base: 'mist' },
    { group: 'かわいい', id: 'lemon',     name: 'レモン',           accent: 'lemon',    base: 'cream' },
    { group: 'ナチュラル', id: 'matcha',  name: '抹茶',             accent: 'matcha',   base: 'cream' },
    { group: 'ナチュラル', id: 'terracotta', name: 'テラコッタ',   accent: 'terracotta', base: 'cream' },
    { group: 'ナチュラル', id: 'coral',   name: 'コーラル',         accent: 'coral',    base: 'snow' },
    { group: 'ナチュラル', id: 'cafe',    name: 'カフェ',           accent: 'gold',     base: 'espresso' },
    { group: 'クール', id: 'navy',        name: 'ネイビー',         accent: 'navy',     base: 'mist' },
    { group: 'クール', id: 'midnight',    name: 'ミッドナイト',     accent: 'cyan',     base: 'midnight' },
    { group: 'クール', id: 'blackgold',   name: 'ブラック×ゴールド', accent: 'gold',    base: 'black' },
    { group: 'クール', id: 'wine',        name: 'ワイン',           accent: 'crimson',  base: 'black' },
    { group: 'クール', id: 'deepforest',  name: 'ディープフォレスト', accent: 'mint',   base: 'forest' },
    { group: 'クール', id: 'slate',       name: 'スレート',         accent: 'slate',    base: 'charcoal' },
    { group: 'クール', id: 'indigo',      name: 'インディゴ',       accent: 'indigo',   base: 'snow' },
    { group: 'クール', id: 'violet',      name: 'バイオレット',     accent: 'violet',   base: 'midnight' },
  ];
  const GROUPS = ['シンプル', 'かわいい', 'ナチュラル', 'クール'];

  /* ---------- 色の計算 ---------- */
  const hexToRgb = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const lum = h => {
    const [r, g, b] = hexToRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const mix = (a, b, t) => { const p = hexToRgb(a), q = hexToRgb(b); return rgbToHex(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t); };
  // 背景に対して文字として読める濃さになるまで、アクセントを明るく（暗く）する
  function readableOn(accent, bg) {
    const toward = lum(bg) < 0.2 ? '#ffffff' : '#000000';
    let c = accent;
    for (let i = 0; i < 12 && contrast(c, bg) < 3.2; i++) c = mix(c, toward, 0.12);
    return c;
  }
  // ボタンの上の文字：白か黒の読みやすいほう
  const textOn = c => (contrast('#ffffff', c) >= contrast('#111111', c) ? '#ffffff' : '#111111');

  const systemDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  /* ---------- 保存と適用 ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { preset: 'default' }; } catch { return { preset: 'default' }; }
  }
  let current = load();

  function resolve(t = current) {
    const p = t.preset && PRESETS.find(x => x.id === t.preset);
    const accentHex = p ? accentById(p.accent).hex : (t.accentHex || (accentById(t.accent) || ACCENTS[0]).hex);
    const baseId = p ? p.base : (BASES[t.base] ? t.base : 'auto');
    return { preset: p || null, accentHex, baseId };
  }

  function apply() {
    const { accentHex, baseId } = resolve();
    const root = document.documentElement;
    const base = BASES[baseId];
    let tone = base.tone;
    const props = ['--bg', '--surface', '--surface-2', '--text', '--muted', '--border'];
    if (tone === 'auto') {
      tone = systemDark() ? 'dark' : 'light';
      props.forEach(p => root.style.removeProperty(p)); // style.css の自動の色を使う
    } else {
      root.style.setProperty('--bg', base.bg);
      root.style.setProperty('--surface', base.surface);
      root.style.setProperty('--surface-2', base.surface2);
      root.style.setProperty('--text', base.text);
      root.style.setProperty('--muted', base.muted);
      root.style.setProperty('--border', base.border);
    }
    const bg = base.bg || (tone === 'dark' ? '#14161c' : '#f6f7fb');
    // 画面の地の色に対して、はっきり見えるアクセントにそろえる
    const accent = readableOn(accentHex, base.surface || (tone === 'dark' ? '#1d2028' : '#ffffff'));
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--today', accent);
    root.style.setProperty('--accent-text', textOn(accent));
    root.dataset.tone = tone;
    root.style.colorScheme = tone; // 日付の入力欄なども同じ明るさに
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.setAttribute('content', bg); m.removeAttribute('media'); });
  }

  function set(t) {
    current = t;
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {}
    apply();
    renderPicker();
    if (typeof updateSettingsSummary === 'function') { try { updateSettingsSummary(); } catch {} }
  }

  function label() {
    const r = resolve();
    if (r.preset) return r.preset.name;
    const a = ACCENTS.find(x => x.hex === r.accentHex);
    return `カスタム（${a ? a.name : '自由な色'} × ${BASES[r.baseId].name}）`;
  }

  /* ---------- 設定画面の選択欄 ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 小さな見本：背景・カード・アクセントのボタン・文字の線
  function swatchPreview(accentHex, baseId) {
    const b = BASES[baseId];
    const dark = b.tone === 'dark' || (b.tone === 'auto' && systemDark());
    const bg = b.bg || (dark ? '#14161c' : '#f6f7fb');
    const sf = b.surface || (dark ? '#1d2028' : '#ffffff');
    const tx = b.text || (dark ? '#e8eaf0' : '#1c1f27');
    const ac = readableOn(accentHex, sf);
    return `<span class="tp-prev" style="background:${bg}">
      <span class="tp-card" style="background:${sf}"><i style="background:${tx}"></i><i style="background:${tx};opacity:.45"></i></span>
      <span class="tp-dot" style="background:${ac}"></span></span>`;
  }

  function renderPicker() {
    const box = document.getElementById('themePresets');
    if (!box) return;
    const r = resolve();
    box.innerHTML = GROUPS.map(g => `<div class="tp-group"><h4 class="acc-sub">${g}</h4><div class="tp-grid">` +
      PRESETS.filter(p => p.group === g).map(p => `<button class="tp-item${r.preset && r.preset.id === p.id ? ' on' : ''}" data-preset="${p.id}" aria-label="${esc(p.name)}">
        ${swatchPreview(accentById(p.accent).hex, p.base)}<span class="tp-name">${esc(p.name)}</span></button>`).join('') +
      '</div></div>').join('');

    document.getElementById('themeAccents').innerHTML = ACCENTS.map(a =>
      `<button class="ac-sw${!r.preset && r.accentHex === a.hex ? ' on' : ''}" data-accent="${a.id}" style="--sw:${a.hex}" title="${esc(a.name)}" aria-label="${esc(a.name)}"></button>`).join('');
    document.getElementById('themeAccentFree').value = r.accentHex;

    document.getElementById('themeBases').innerHTML = Object.entries(BASES).map(([id, b]) =>
      `<button class="tp-item small${!r.preset && r.baseId === id ? ' on' : ''}" data-base="${id}" aria-label="${esc(b.name)}">
        ${swatchPreview(r.accentHex, id)}<span class="tp-name">${esc(b.name)}</span></button>`).join('');
    const cur = document.getElementById('themeCurrent');
    if (cur) cur.textContent = label();
  }

  function wire() {
    const presets = document.getElementById('themePresets');
    if (!presets) return;
    presets.addEventListener('click', e => {
      const b = e.target.closest('[data-preset]');
      if (b) set({ preset: b.dataset.preset });
    });
    // アクセントや背景を変えたら「カスタム」になる（今の組み合わせから続けて変えられる）
    const custom = patch => { const r = resolve(); set({ accentHex: r.accentHex, base: r.baseId, ...patch }); };
    document.getElementById('themeAccents').addEventListener('click', e => {
      const b = e.target.closest('[data-accent]');
      if (b) custom({ accentHex: accentById(b.dataset.accent).hex });
    });
    document.getElementById('themeAccentFree').addEventListener('input', e => custom({ accentHex: e.target.value }));
    document.getElementById('themeBases').addEventListener('click', e => {
      const b = e.target.closest('[data-base]');
      if (b) custom({ base: b.dataset.base });
    });
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { apply(); renderPicker(); });
    }
    renderPicker();
  }

  apply(); // 読み込んだらすぐ色を当てる（画面のちらつき防止）
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  return { label, apply, set, get current() { return current; } };
})();

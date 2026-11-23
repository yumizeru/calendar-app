'use strict';
/* =====================================================================
 * 使い方ガイド（チュートリアル）
 *  ・初めて開いたときに1回だけ自動で表示。設定からいつでも見直せる
 *  ・案内する場所だけを明るくし、吹き出しで説明する
 * ===================================================================== */
const Tour = (() => {
  const DONE_KEY = 'hibilog:tourDone';
  const $ = s => document.querySelector(s);
  const tab = v => document.querySelector(`.tab[data-view="${v}"]`);
  const goTab = v => { const t = tab(v); if (t && !t.classList.contains('active')) t.click(); window.scrollTo(0, 0); };
  const goMonth = () => { goTab('calendar'); const b = document.querySelector('.seg-btn[data-mode="month"]'); if (b) b.click(); };

  // 案内の中身。target が null の回は画面の真ん中に吹き出しだけを出す
  const STEPS = [
    {
      target: null,
      title: 'ひびログへようこそ',
      text: '予定・習慣・やることを、ひとつのアプリでまとめて管理できます。\n大事なところだけ、順番にご案内します（1分ほど）。',
      before: goMonth,
    },
    {
      target: '#view-calendar .seg',
      title: 'カレンダーの見かた',
      text: '「月」「週」「リスト」で表示を切り替えられます。\n上の ‹ › か、左右にスワイプで前後に移動。月の名前をタップすると今日に戻ります。',
      before: goMonth,
    },
    {
      target: () => document.querySelector('#grid .cell.today, #grid .cell.selected, #monthCol .mrow.today, #monthCol .mrow.selected') || '#monthView',
      title: '日付をタップ',
      text: '日付をタップすると、その日の予定・やること・習慣が下に表示されます。',
      before: goMonth,
    },
    {
      target: '#addEvent',
      title: '予定を追加',
      text: '「＋ 予定」から予定を追加します。\n時刻・繰り返し・色分け・通知（リマインダー）も、ここで設定できます。',
      before: goMonth,
    },
    {
      target: () => tab('habits'),
      title: '習慣',
      text: '毎日の習慣（散歩・読書・水を飲む など）を記録できます。\n続いた日数やグラフで、振り返りもできます。',
      before: goMonth,
    },
    {
      target: () => tab('todos'),
      title: 'やること（ToDo）',
      text: '買い物や手続きなど「やること」のリストです。\n期限を決めると、カレンダーにも表示されます。',
      before: goMonth,
    },
    {
      target: '#view-settings .card',
      title: '文字が小さくて読みにくいときは',
      text: '「設定」の「見やすさ・表示」で、文字を大きくできます。\n文字を大きくしたときは、日付を縦に並べて予定を大きな文字で読める「1列」表示がおすすめです。',
      before: () => goTab('settings'),
      action: {
        label: '文字を大きくして「1列」にする',
        run: () => {
          if (typeof setPref === 'function') { setPref('font', '1.36'); setPref('monthStyle', 'column'); }
          App.toast('文字を大きくして「1列」表示にしました（設定からいつでも戻せます）');
        },
      },
    },
    {
      target: '#cloudCard',
      title: 'スマホとパソコンで同じデータを',
      text: 'ここでログインすると、ほかの端末と同じ予定を見られます。\n通知・ウィジェット・家族との共有カレンダーにも、ログインが必要です。',
      before: () => { goTab('settings'); const c = $('#cloudCard'); if (c) c.scrollIntoView({ block: 'center' }); },
    },
    {
      target: null,
      title: '準備ができました！',
      text: 'このガイドは「設定」の下の方にある「使い方ガイドを見る」から、いつでも見直せます。',
      before: goMonth,
    },
  ];

  let i = 0;
  let root = null;

  function build() {
    root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML = `
      <div class="tour-shade"></div>
      <div class="tour-hole" hidden></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
        <div class="tour-step" id="tourStep"></div>
        <h3 id="tourTitle"></h3>
        <p id="tourText"></p>
        <button class="btn primary tour-action" id="tourAction" hidden></button>
        <div class="tour-nav">
          <button class="btn" id="tourSkip">とじる</button>
          <span class="spacer"></span>
          <button class="btn" id="tourBack">もどる</button>
          <button class="btn primary" id="tourNext">つぎへ</button>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector('#tourNext').addEventListener('click', () => go(i + 1));
    root.querySelector('#tourBack').addEventListener('click', () => go(i - 1));
    root.querySelector('#tourSkip').addEventListener('click', finish);
    root.querySelector('#tourAction').addEventListener('click', () => {
      const a = STEPS[i].action;
      if (a) { a.run(); place(); }
    });
    // 案内中は後ろの画面を触れないようにする（吹き出しのボタンだけ使える）
    root.querySelector('.tour-shade').addEventListener('click', e => e.stopPropagation());
    window.addEventListener('resize', place);
    document.addEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') finish();
    if (e.key === 'ArrowRight') go(i + 1);
    if (e.key === 'ArrowLeft') go(i - 1);
  }

  function targetEl(step) {
    let t = typeof step.target === 'function' ? step.target() : step.target;
    if (typeof t === 'string') t = document.querySelector(t);
    return t && t.getClientRects().length ? t : null;
  }

  // 明るくする枠と吹き出しの位置を決める
  function place() {
    if (!root) return;
    const step = STEPS[i];
    const hole = root.querySelector('.tour-hole');
    const card = root.querySelector('.tour-card');
    const el = targetEl(step);
    card.classList.toggle('center', !el);
    // 後ろの画面を触れないよう、透明な幕は常に張っておく（暗さは枠の影でつける）
    root.querySelector('.tour-shade').classList.toggle('clear', !!el);
    if (!el) {
      hole.hidden = true;
      card.style.top = ''; card.style.bottom = ''; card.style.maxHeight = '';
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 6;
    hole.hidden = false;
    Object.assign(hole.style, {
      top: `${Math.max(4, r.top - pad)}px`, left: `${Math.max(4, r.left - pad)}px`,
      width: `${Math.min(innerWidth - 8, r.width + pad * 2)}px`, height: `${r.height + pad * 2}px`,
    });
    // 吹き出しは、枠の上と下のうち広いほうに出し、その広さに収まるようにする（文字が大きくても切れない）
    const gap = 12;
    const spaceBelow = innerHeight - (r.bottom + pad + gap) - gap;
    const spaceAbove = (r.top - pad - gap) - gap;
    const minUseful = 220;
    if (Math.max(spaceBelow, spaceAbove) < minUseful) {
      // どちらも狭いとき（枠が大きいとき）は、画面の下側に重ねて出す
      card.style.top = ''; card.style.bottom = `${gap}px`; card.style.maxHeight = `${Math.round(innerHeight * 0.55)}px`;
    } else if (spaceBelow >= spaceAbove) {
      card.style.top = `${Math.round(r.bottom + pad + gap)}px`; card.style.bottom = ''; card.style.maxHeight = `${Math.round(spaceBelow)}px`;
    } else {
      card.style.bottom = `${Math.round(innerHeight - r.top + pad + gap)}px`; card.style.top = ''; card.style.maxHeight = `${Math.round(spaceAbove)}px`;
    }
  }

  function go(n) {
    if (n < 0) return;
    if (n >= STEPS.length) { finish(); return; }
    i = n;
    const step = STEPS[i];
    if (step.before) step.before();
    root.querySelector('#tourStep').textContent = `${i + 1} / ${STEPS.length}`;
    root.querySelector('#tourTitle').textContent = step.title;
    root.querySelector('#tourText').textContent = step.text;
    const act = root.querySelector('#tourAction');
    act.hidden = !step.action;
    if (step.action) act.textContent = step.action.label;
    root.querySelector('#tourBack').style.visibility = i === 0 ? 'hidden' : '';
    root.querySelector('#tourNext').textContent = i === STEPS.length - 1 ? 'はじめる' : 'つぎへ';
    const el = targetEl(step);
    if (el && !el.closest('.tabbar')) el.scrollIntoView({ block: 'center' });
    // 画面の切り替えや移動が終わってから位置を合わせる
    requestAnimationFrame(() => requestAnimationFrame(place));
    root.querySelector('#tourNext').focus({ preventScroll: true });
  }

  function start() {
    if (root) return;
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    build();
    go(0);
  }
  function finish() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch {}
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey);
    if (root) root.remove();
    root = null;
    goMonth();
  }

  // 初めて開いたときだけ自動で表示
  function maybeStart() {
    let done = false;
    try { done = !!localStorage.getItem(DONE_KEY); } catch { done = true; }
    if (!done) setTimeout(start, 600);
  }

  const btn = $('#tourStart');
  if (btn) btn.addEventListener('click', start);
  maybeStart();
  return { start, get active() { return !!root; } };
})();

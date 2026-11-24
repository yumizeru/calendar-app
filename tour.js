'use strict';
/* =====================================================================
 * 使い方ガイド（画面を照らして案内する）
 *  ・はじめてガイド：初めて開いたときに1回だけ自動で表示
 *  ・テーマ別ガイド（共有など）：「使い方・ヘルプ」から呼び出す
 *  ・案内する場所だけを明るくし、吹き出しで説明する
 * ===================================================================== */
const Tour = (() => {
  const DONE_KEY = 'hibilog:tourDone';
  const $ = s => document.querySelector(s);
  const tab = v => document.querySelector(`.tab[data-view="${v}"]`);
  const goTab = v => { const t = tab(v); if (t && !t.classList.contains('active')) t.click(); window.scrollTo(0, 0); };
  const goMonth = () => { goTab('calendar'); const b = document.querySelector('.seg-btn[data-mode="month"]'); if (b) b.click(); };
  const loggedIn = () => typeof Cloud !== 'undefined' && !!Cloud.session;
  const openDetails = sel => { const d = $(sel); if (d) d.open = true; return d; };
  // 設定の項目はタップで開く形なので、案内する前にその項目を開いておく
  const openedByTour = new Set(); // ガイドが開いた項目は、終わったら閉じ直す
  const openAcc = sel => {
    const el = $(sel);
    const acc = el && (el.matches('details.acc') ? el : el.closest('details.acc'));
    if (acc && !acc.open) { acc.open = true; openedByTour.add(acc); }
    return el;
  };
  const settingsAt = sel => () => { goTab('settings'); const el = openAcc(sel); if (el) el.scrollIntoView({ block: 'center' }); };

  /* ---------- はじめてガイド ---------- */
  const MAIN = [
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
      target: '#accView',
      title: '文字が小さくて読みにくいときは',
      text: '「設定」の「見やすさ・表示」で、文字を大きくできます。\n文字を大きくしたときは、日付を縦に並べて予定を大きな文字で読める「1列」表示がおすすめです。\n\n設定の各項目は、タップすると開きます。',
      before: settingsAt('#accView'),
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
      text: '「アカウントと同期」でログインすると、ほかの端末と同じ予定を見られます。\n通知・ウィジェット・家族との共有カレンダーにも、ログインが必要です。',
      before: settingsAt('#cloudCard'),
    },
    {
      target: () => (loggedIn() ? '#sharedCard' : null),
      title: '家族や友人と予定を共有',
      text: '「共有カレンダー」を作って招待すると、家族の予定をみんなで見たり書いたりできます。\n手順が少し多いので、専用の案内を用意しています。',
      before: () => { if (loggedIn()) settingsAt('#sharedCard')(); else goTab('settings'); },
      action: { label: '共有のしかたを案内してもらう', run: () => start('shared') },
    },
    {
      target: '#helpCard',
      title: '困ったときは「使い方・ヘルプ」',
      text: 'テーマごとの説明が、いつでも読めます。\nこのガイドも、ここからもう一度見られます。',
      before: settingsAt('#helpCard'),
    },
  ];

  /* ---------- 共有のしかた ---------- */
  const SHARED = [
    {
      target: null,
      title: '家族や友人と予定を共有する',
      text: '流れは3つだけです。\n① 1人が「共有カレンダー」を作る\n② 招待コードを送り、相手が参加する\n③ 予定を作るときに、そのカレンダーを選ぶ\n\n共有されるのは、共有カレンダーに入れた予定だけです。自分の予定・習慣・ToDoは相手に見えません。',
      before: () => goTab('settings'),
    },
    {
      target: () => (loggedIn() ? null : '#cloudCard'),
      title: 'はじめに：全員ログインが必要です',
      text: '共有するには、あなたも相手も、それぞれのスマホでログイン（はじめての人は「新規登録」）しておく必要があります。\nログインは「設定」の「アカウントと同期」からできます。',
      before: settingsAt('#cloudCard'),
      skipIf: loggedIn,
    },
    {
      target: () => (loggedIn() ? '#shName' : null),
      title: 'あなたの表示名',
      text: '相手の画面に出る名前です（例：ママ、パパ、おばあちゃん）。\n「だれが予定を変えたか」の表示にも使われます。',
      before: settingsAt('#sharedCard'),
    },
    {
      target: () => (loggedIn() ? '.sh-details:first-of-type' : null),
      title: '① 共有カレンダーを作る（1人だけ）',
      text: '「新しく作る」をタップして、名前（例：家族）と色を決め、「作成」を押します。\n作るのは1人だけで大丈夫です。',
      before: () => { settingsAt('#sharedCard')(); openDetails('#sharedCard .sh-details'); },
    },
    {
      target: () => (loggedIn() && $('[data-sh-invite]') ? '[data-sh-invite]' : null),
      title: '② 相手を招待する',
      text: '作ったカレンダーの「招待する」を押すと、アプリのURLと10文字の招待コードが入った文章を、LINEやメールで送れます。',
      before: settingsAt('#sharedList'),
    },
    {
      target: () => (loggedIn() ? '#shJoin' : null),
      title: '②′ 招待された人は',
      text: '届いたURLを開いてログインしたら、「設定」→「家族と共有」→「招待コードで参加」に、10文字のコードを入力して「参加」を押します。',
      before: () => { settingsAt('#sharedCard')(); const ds = document.querySelectorAll('#sharedCard .sh-details'); if (ds[1]) { ds[1].open = true; ds[1].scrollIntoView({ block: 'center' }); } },
    },
    {
      target: '#addEvent',
      title: '③ 予定を共有に入れる',
      text: '予定を作る画面に「カレンダー」という欄が出ます。そこで「共有：家族」のような共有カレンダーを選ぶと、全員に共有されます。\n「自分だけ」を選べば、これまでどおり自分だけの予定です。',
      before: goMonth,
    },
    {
      target: null,
      title: '共有した予定の見え方',
      text: '共有の予定には人のマークと「家族」の印が付き、カレンダーの色で表示されます。\n予定を開くと「最後に変更した人」がわかります。\n通知（リマインダー）は、メンバー全員に届きます。',
      before: goMonth,
    },
    {
      target: null,
      title: 'うまくいかないときは',
      text: '・相手の予定が出ない → 相手のアプリを一度閉じて開き直す（変更は1分ごとに取り込みます）\n・「招待コードが見つかりません」→ コードを見直す。作った人が「コードを作り直す」と前のコードは使えません\n・やめたいとき → 「退出」。作った人は「削除」（全員から消えます）',
      before: goMonth,
    },
  ];

  const TOURS = { main: MAIN, shared: SHARED };

  let steps = MAIN;
  let tourName = 'main';
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
    root.querySelector('#tourNext').addEventListener('click', () => go(i + 1, 1));
    root.querySelector('#tourBack').addEventListener('click', () => go(i - 1, -1));
    root.querySelector('#tourSkip').addEventListener('click', finish);
    root.querySelector('#tourAction').addEventListener('click', () => {
      const a = steps[i].action;
      if (a) { a.run(); if (root) place(); }
    });
    // 案内中は後ろの画面を触れないようにする（吹き出しのボタンだけ使える）
    root.querySelector('.tour-shade').addEventListener('click', e => e.stopPropagation());
    window.addEventListener('resize', place);
    document.addEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') finish();
    if (e.key === 'ArrowRight') go(i + 1, 1);
    if (e.key === 'ArrowLeft') go(i - 1, -1);
  }

  function targetEl(step) {
    let t = typeof step.target === 'function' ? step.target() : step.target;
    if (typeof t === 'string') t = document.querySelector(t);
    return t && t.getClientRects().length ? t : null;
  }

  // 明るくする枠と吹き出しの位置を決める
  function place() {
    if (!root) return;
    const step = steps[i];
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

  // dir：進む向き（飛ばすステップがあるとき、その向きに飛ばす）
  function go(n, dir = 1) {
    while (n >= 0 && n < steps.length && steps[n].skipIf && steps[n].skipIf()) n += dir;
    if (n < 0) return;
    if (n >= steps.length) { finish(); return; }
    i = n;
    const step = steps[i];
    if (step.before) step.before();
    root.querySelector('#tourStep').textContent = `${i + 1} / ${steps.length}`;
    root.querySelector('#tourTitle').textContent = step.title;
    root.querySelector('#tourText').textContent = step.text;
    const act = root.querySelector('#tourAction');
    act.hidden = !step.action;
    if (step.action) act.textContent = step.action.label;
    root.querySelector('#tourBack').style.visibility = i === 0 ? 'hidden' : '';
    root.querySelector('#tourNext').textContent = i === steps.length - 1 ? (tourName === 'main' ? 'はじめる' : 'おわる') : 'つぎへ';
    root.querySelector('.tour-card').scrollTop = 0;
    const el = targetEl(step);
    if (el && !el.closest('.tabbar')) el.scrollIntoView({ block: 'center' });
    // すぐ位置を合わせ、画面の切り替えや移動が終わったあとにもう一度合わせ直す
    place();
    requestAnimationFrame(() => requestAnimationFrame(place));
    setTimeout(place, 250);
    root.querySelector('#tourNext').focus({ preventScroll: true });
  }

  function teardown() {
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey);
    if (root) root.remove();
    root = null;
    for (const acc of openedByTour) acc.open = false;
    openedByTour.clear();
  }
  // name：'main'（はじめてガイド） / 'shared'（共有のしかた）
  function start(name = 'main') {
    if (root) teardown(); // 案内の途中から別の案内に切り替える
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    tourName = TOURS[name] ? name : 'main';
    steps = TOURS[tourName];
    build();
    go(0);
  }
  function finish() {
    if (tourName === 'main') { try { localStorage.setItem(DONE_KEY, '1'); } catch {} }
    teardown();
    goMonth();
  }

  // 初めて開いたときだけ自動で表示
  function maybeStart() {
    let done = false;
    try { done = !!localStorage.getItem(DONE_KEY); } catch { done = true; }
    if (!done) setTimeout(() => { if (!root) start('main'); }, 600);
  }

  maybeStart();
  return { start, has: name => !!TOURS[name], get active() { return !!root; } };
})();

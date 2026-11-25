'use strict';
/* =====================================================================
 * 使い方・ヘルプ（説明一覧）
 *  設定の「使い方・ヘルプ」から、テーマごとの説明をいつでも読める。
 *  tour がある項目は「画面で案内する」で、画面を照らしながら案内する。
 *  ※ 機能を増やしたら、ここの説明も足すこと
 * ===================================================================== */
const Help = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // body は短い段落・番号つき手順・ヒントで書く（お年寄りにも読みやすいように）
  const TOPICS = [
    {
      id: 'start', icon: 'sprout', title: 'はじめての方へ（全体の流れ）', tour: 'main',
      summary: 'アプリの大事なところを順番に案内します',
      body: `
        <p>ひびログは、<b>予定</b>・<b>習慣</b>・<b>やること（ToDo）</b>をまとめて管理するアプリです。</p>
        <ol class="help-steps">
          <li>下の「カレンダー」で予定を見る・追加する</li>
          <li>「習慣」で毎日の習慣をチェックする</li>
          <li>「ToDo」でやることを管理する</li>
          <li>「設定」で文字の大きさやログインなどを決める</li>
        </ol>
        <p class="help-tip">${icon('lightbulb')}「画面で案内する」を押すと、画面を照らしながら1分ほどで案内します。</p>`,
    },
    {
      id: 'events', icon: 'calendar', title: '予定を追加・変更する',
      summary: '時刻・繰り返し・何日も続く予定・色分け',
      body: `
        <ol class="help-steps">
          <li>カレンダーで日付をタップし、「＋ 予定」を押します</li>
          <li>いちばん上の「ひと言で入力」に「明日15時 歯医者」のように打つと、日付・時刻・タイトルが自動で入ります</li>
          <li>中身を確かめて「保存」。時刻がない予定は「終日」にチェック</li>
          <li>旅行のように何日か続く予定は「終了日」を入れます</li>
          <li>毎週・毎月の予定は「繰り返し」を選びます（毎週は曜日も選べます）</li>
        </ol>
        <p><b>ひと言で入力の例</b>：「あさって 午前10時半から12時 会議」「毎週月・水・金 朝6時 ジョギング」「毎月25日 給料日」「金曜 夜7時 飲み会 30分前に通知」。読み取れた内容は入力欄の下に出ます。</p>
        <p><b>変更・削除</b>：予定をタップすると編集できます。繰り返しの予定は「この予定だけ」か「すべての予定」かを選べます。</p>
        <p><b>テンプレ</b>：よく作る予定は、予定の画面の下の「この内容をテンプレに保存」で保存できます。次からは予定の画面の上に出るボタンをタップするだけで入ります。</p>
        <p><b>誕生日・記念日</b>：「種類」で誕生日か記念日を選び、はじめの日付に生まれた日（始まった日）を入れます。毎年表示され、「30歳」「5周年」のように出ます。</p>
        <p><b>色分け</b>：「カテゴリ」で色が付きます。カテゴリの名前や色は「設定」の「カテゴリ（予定の色分け）」で変えられます。</p>`,
    },
    {
      id: 'reminder', icon: 'bell', title: '通知（リマインダー）を受け取る',
      summary: '予定や習慣の時間をお知らせ',
      body: `
        <p>予定の画面の「リマインダー」で、何分前に知らせるかを選べます。習慣は、習慣の編集画面で毎日の時刻を決められます（その日まだ達成していないときだけ届きます）。</p>
        <p><b>通知を受け取るための準備（iPhone）</b></p>
        <ol class="help-steps">
          <li>Safariでアプリを開き、共有ボタン →「ホーム画面に追加」</li>
          <li>ホーム画面のアイコンからアプリを開く</li>
          <li>「設定」でログインする</li>
          <li>「設定」→「通知（リマインダー）」→「通知をオンにする」→「許可」</li>
          <li>「テスト通知を送る」で届くか確かめる</li>
        </ol>
        <p><b>毎朝のまとめ</b>：「通知（リマインダー）」の「毎朝、今日のまとめを通知」をオンにすると、決めた時刻に「今日の天気・予定・やること・習慣」が1つの通知で届きます。天気も入れるには「天気予報」をオンにしてください。</p>
        <p class="help-tip">${icon('lightbulb')}届かないときは、iPhoneの「設定」→「通知」→「ひびログ」が許可になっているか、集中モードがオンになっていないかを確かめてください。</p>`,
    },
    {
      id: 'feeds', icon: 'calendar-days', title: 'iPhone・Googleのカレンダーを表示する',
      summary: '今使っているカレンダーの予定も一緒に見る',
      body: `
        <p>iPhoneのカレンダーやGoogleカレンダーに入っている予定を、ひびログのカレンダーにも表示できます。予定を移しかえる必要はありません。<b>見るだけ</b>なので、変更は元のアプリでします。</p>
        <p><b>iPhoneのカレンダーの場合</b></p>
        <ol class="help-steps">
          <li>iPhoneの「カレンダー」アプリ → 画面の下の「カレンダー」</li>
          <li>表示したいカレンダーの右の「i」→「公開カレンダー」をオン</li>
          <li>「リンクを共有…」→「コピー」</li>
          <li>ひびログの「設定」→「iPhone・Googleのカレンダーを表示」に名前を入れ、URLを貼り付けて「追加」</li>
        </ol>
        <p><b>Googleカレンダーの場合</b>：パソコンでGoogleカレンダーの「設定」→ カレンダーを選ぶ →「iCal 形式の非公開URL」をコピーして、同じように追加します。</p>
        <p class="help-tip">${icon('lightbulb')}URLを知っている人は予定を見られるので、URLは人に教えないでください。30分ごとに自動で新しくなります。すぐ反映したいときは「今すぐ更新」を押します。</p>`,
    },
    {
      id: 'habits', icon: 'list-checks', title: '習慣を記録する',
      summary: '毎日・曜日指定・週◯回、数値の記録、振り返り',
      body: `
        <ol class="help-steps">
          <li>「習慣」タブで「＋ 習慣を追加」</li>
          <li>名前と色を決め、頻度（毎日／曜日を選ぶ／週に◯回）を選ぶ</li>
          <li>水の量のように数で記録したいときは「数値で記録」にして、目標と単位を入れる</li>
        </ol>
        <p><b>記録</b>：カレンダーの日付をタップした下の「習慣」でチェック（または数を入力）します。習慣タブの7日分のマスからも記録できます。</p>
        <p><b>バッジ</b>：3日・7日・14日・30日・50日・100日・200日・365日続くと、バッジがもらえます。習慣のカードで、次のバッジまでの残りも見られます。</p>
        <p><b>振り返り</b>：習慣の「振り返り」を開くと、1年分の記録と月ごとの達成率のグラフが見られます。</p>`,
    },
    {
      id: 'todo', icon: 'list-todo', title: 'やること（ToDo）を使う',
      summary: '期限・重要マーク・カレンダーへの表示',
      body: `
        <ol class="help-steps">
          <li>「ToDo」タブの上の欄に、やることを入れて「追加」</li>
          <li>期限があるときは「期限」に日付を入れる（なくてもOK）</li>
          <li>終わったら左の丸をタップ</li>
        </ol>
        <p>ToDoをタップすると、期限・<b>星マーク（重要）</b>・メモを編集できます。期限のあるToDoはカレンダーにも表示され、今日までのものがあるとタブに赤い数字が出ます。</p>`,
    },
    {
      id: 'view', icon: 'eye', title: '見やすくする（文字の大きさ・表示）',
      summary: '文字を大きく、くっきり、1列表示',
      body: `
        <p>「設定」の「見やすさ・表示」で変えられます。この端末だけの設定です。</p>
        <ul class="help-steps">
          <li><b>文字の大きさ</b>：標準・大きい・とても大きい。ボタンなども一緒に大きくなります</li>
          <li><b>くっきり表示</b>：文字を濃く太くし、枠線をはっきりさせます</li>
          <li><b>月表示のスタイル</b>：シンプル（点）・予定名・1列</li>
        </ul>
        <p class="help-tip">${icon('lightbulb')}<b>文字を大きくしたときは「1列」表示がおすすめです。</b>日付を縦に並べて、予定の名前まで大きな文字で読めます。</p>
        <button class="btn primary help-quick" data-quick="big">文字を大きくして「1列」にする</button>`,
    },
    {
      id: 'diary', icon: 'notebook-pen', title: 'ひとこと日記・気分を残す',
      summary: '気分を5段階で、ひとことメモも',
      body: `
        <ol class="help-steps">
          <li>カレンダーで日付をタップ</li>
          <li>下の「ひとこと日記」で、その日の気分（つらい〜さいこう）を選ぶ</li>
          <li>書きたいことがあれば、下の欄にひとこと（なくてもOK）。自動で保存されます</li>
        </ol>
        <p>同じ気分をもう一度押すと取り消せます。「1列」表示では、日付の下に気分のマークが出ます。</p>`,
    },
    {
      id: 'search', icon: 'search', title: 'さがす・月のまとめ',
      summary: '予定をさがす、ひと月をふり返る',
      body: `
        <p><b>さがす</b>：カレンダーの上の虫めがねを押して、言葉を入れます。予定・ToDo・日記からさがせます。予定をタップすると、その日を開きます。</p>
        <p><b>月のまとめ</b>：虫めがねの右のグラフのボタンを押すと、その月の予定の数、ToDoの完了数、習慣の達成率、気分の記録を1つの画面で見られます。左右の矢印で月を切り替えられます。</p>`,
    },
    {
      id: 'weather', icon: 'cloud-sun', title: '天気予報を表示する',
      summary: 'カレンダーに16日先までの天気',
      body: `
        <ol class="help-steps">
          <li>「設定」→「天気予報」で「カレンダーに天気を表示」をオン</li>
          <li>「現在地を使う」を押すか、都市名（例：熊本市）でさがして選ぶ</li>
        </ol>
        <p>月のカレンダーには小さなマーク、週・リスト・1列には気温、日付をタップした下には天気・最高/最低気温・降水確率が出ます。</p>
        <p class="help-tip">${icon('lightbulb')}天気は無料の天気サービスから受け取ります。送るのは、だいたいの場所（約1km単位）だけです。</p>`,
    },
    {
      id: 'theme', icon: 'palette', title: 'テーマ（色）を変える',
      summary: 'かわいい色からかっこいい色まで',
      body: `n        <p>「設定」→「テーマ（色）」で、アプリ全体の色を変えられます。この端末だけの設定です。</p>
        <ol class="help-steps">
          <li><b>おすすめから選ぶ</b>：シンプル・かわいい・ナチュラル・クールの組み合わせから、タップするだけ</li>
          <li><b>自分で組み合わせる</b>：アクセントの色（ボタンや今日の印）と、背景の色合いを、それぞれ選ぶ</li>
          <li>一覧にない色は「好きな色を選ぶ」で自由に決められます</li>
        </ol>
        <p class="help-tip">${icon('lightbulb')}文字が読みにくい色にならないよう、背景に合わせて色の濃さを自動で少し調整します。</p>`,
    },
    {
      id: 'sync', icon: 'cloud', title: 'スマホとパソコンで同じデータを使う',
      summary: 'ログインと同期',
      body: `
        <ol class="help-steps">
          <li>「設定」→「アカウントと同期」で、メールアドレスとパスワードを入れる</li>
          <li>はじめての人は「新規登録」、2台目からは同じメールとパスワードで「ログイン」</li>
          <li>あとは自動で同期されます（「最終同期」の時刻で確かめられます）</li>
        </ol>
        <p><b>パスワードを忘れたとき</b></p>
        <ol class="help-steps">
          <li>「アカウントと同期」の「パスワードを忘れたとき」を押す</li>
          <li>登録したメールアドレスに届くメールのリンクを開く（届かないときは迷惑メールも確認）</li>
          <li>新しいパスワードを2回入れて「保存」</li>
          <li>ホーム画面のアプリを使っている人は、アプリを開いて新しいパスワードで「ログイン」</li>
        </ol>
        <p class="help-tip">${icon('lightbulb')}ログインしたままパスワードを変えたいときは「パスワードを変更」から変えられます。</p>`,
    },
    {
      id: 'shared', icon: 'users', title: '家族や友人と予定を共有する', tour: 'shared',
      summary: '共有カレンダーの作り方・招待・参加',
      body: `
        <p>共有されるのは<b>共有カレンダーに入れた予定だけ</b>です。自分の予定・習慣・ToDoは相手に見えません。</p>
        <p><b>準備</b>：あなたも相手も、それぞれログインしておきます（はじめての人は新規登録）。</p>
        <p><b>作る人（1人だけ）</b></p>
        <ol class="help-steps">
          <li>「設定」→「家族と共有（共有カレンダー）」→「新しく作る」</li>
          <li>名前（例：家族）と色を決めて「作成」</li>
          <li>「招待する」を押して、LINEやメールで相手に送る</li>
        </ol>
        <p><b>招待された人</b></p>
        <ol class="help-steps">
          <li>届いたURLを開き、「設定」でログイン（はじめてなら新規登録）</li>
          <li>「設定」→「家族と共有（共有カレンダー）」→「招待コードで参加」に10文字のコードを入れて「参加」</li>
        </ol>
        <p><b>予定を共有する</b>：予定を作る画面の「カレンダー」で「共有：家族」を選びます。共有の予定には人のマークが付き、通知はメンバー全員に届きます。</p>
        <p><b>家族の変更を通知</b>：「家族と共有」の「家族が予定を変えたら通知する」がオンだと、ほかのメンバーが予定を追加・変更・削除したときに通知が届きます（続けて直したときは1回にまとめます）。</p>
        <p class="help-tip">${icon('lightbulb')}相手の予定が出ないときは、アプリを一度閉じて開き直してください（変更は1分ごとに取り込みます）。<br>
        やめたいときは「退出」。作った人は「削除」もできます（全員から消えます）。</p>`,
    },
    {
      id: 'widget', icon: 'smartphone', title: 'ホーム画面にウィジェットを置く',
      summary: '今日の予定と習慣をホーム画面に',
      body: `
        <ol class="help-steps">
          <li>App Storeで無料アプリ「Scriptable」を入れる</li>
          <li>ひびログの「設定」→「ホーム画面（アプリ・ウィジェット）」→「スクリプトをコピー」（ログインが必要）</li>
          <li>Scriptableで「＋」を押して貼り付け、名前を「ひびログ」にして「Done」</li>
          <li>ホーム画面を長押し →「＋」→「Scriptable」を選んで追加</li>
          <li>置いたウィジェットを長押し →「ウィジェットを編集」→ Scriptを「ひびログ」に</li>
        </ol>
        <p>ウィジェットの色は、ふだんはアプリで選んだテーマの色に合わせます。ウィジェットだけ別の色にしたいときは、「設定」→「ホーム画面（アプリ・ウィジェット）」→「ウィジェットの色」で選べます。</p>
        <p class="help-tip">${icon('lightbulb')}スクリプトには、あなた専用の合言葉が入っています。人に見せないでください。</p>`,
    },
    {
      id: 'install', icon: 'house', title: 'アプリのようにホーム画面に置く',
      summary: 'iPhoneのホーム画面に追加',
      body: `
        <ol class="help-steps">
          <li>iPhoneの<b>Safari</b>でひびログを開く</li>
          <li>画面下の共有ボタン（□に↑）を押す</li>
          <li>「ホーム画面に追加」→「追加」</li>
        </ol>
        <p>ホーム画面のアイコンから開くと、アプリのように使えます。通知を受け取るにも、この方法で開く必要があります。</p>`,
    },
    {
      id: 'trouble', icon: 'life-buoy', title: '困ったとき',
      summary: '更新されない・データを守る など',
      body: `
        <p><b>新しい機能が出てこない</b>：「設定」→「アプリについて」→「今すぐ更新を確認」。それでもだめならアプリを完全に閉じて開き直してください。</p>
        <p><b>データを守りたい・間違えて消した</b>：ログインしていれば、毎週月曜の朝にクラウドへ自動で保存されます。「設定」→「データの管理」→「クラウドのバックアップ」から、その時点に戻せます。「今すぐ保存する」で手動でも保存できます。ファイルに書き出すこともできます。</p>
        <p><b>ほかの端末に変更が出ない</b>：「設定」→「アカウントと同期」→「今すぐ同期」を押してください。</p>
        <p><b>通知が届かない</b>：「通知（リマインダー）を受け取る」の説明を見てください。</p>`,
    },
  ];

  const dlg = $('#helpDialog');
  let current = null;

  function renderList() {
    $('#helpList').innerHTML = TOPICS.map(t => `<li><button class="help-item" data-help="${t.id}">
      <span class="hi-icon">${icon(t.icon)}</span>
      <span class="hi-text"><b>${esc(t.title)}${t.tour ? `<span class="hi-tour">${icon('map-pin')}</span>` : ''}</b><small>${esc(t.summary)}</small></span>
      <span class="hi-arrow">${icon('chevron-right')}</span></button></li>`).join('');
  }

  // 一覧を表示（「使い方・ヘルプ」を押したとき・一覧にもどるとき）
  function showList() {
    current = null;
    $('#helpTitle').innerHTML = icon('book-open') + '使い方・ヘルプ';
    $('#helpListView').hidden = false;
    $('#helpBody').hidden = true;
    $('#helpFoot').hidden = true;
    if (!dlg.open) dlg.showModal();
    $('#helpListView').scrollTop = 0;
  }
  // 1つの説明を表示
  function open(id) {
    const t = TOPICS.find(x => x.id === id);
    if (!t) return;
    current = t;
    $('#helpTitle').innerHTML = icon(t.icon) + esc(t.title);
    $('#helpBody').innerHTML = t.body;
    $('#helpListView').hidden = true;
    $('#helpBody').hidden = false;
    $('#helpFoot').hidden = false;
    $('#helpTour').hidden = !(t.tour && Tour.has(t.tour));
    if (!dlg.open) dlg.showModal();
    $('#helpBody').scrollTop = 0;
  }

  $('#helpOpen').addEventListener('click', showList);
  $('#helpList').addEventListener('click', e => {
    const b = e.target.closest('[data-help]');
    if (b) open(b.dataset.help);
  });
  $('#helpClose').addEventListener('click', () => dlg.close());
  $('#helpBack').addEventListener('click', showList);
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  $('#helpTour').addEventListener('click', () => { if (current && current.tour) Tour.start(current.tour); });
  $('#helpBody').addEventListener('click', e => {
    const q = e.target.closest('[data-quick]');
    if (q && q.dataset.quick === 'big' && typeof setPref === 'function') {
      setPref('font', '1.36'); setPref('monthStyle', 'column');
      App.toast('文字を大きくして「1列」表示にしました（設定からいつでも戻せます）');
    }
  });

  renderList();
  return { open, showList, topics: () => TOPICS.map(t => t.id) };
})();

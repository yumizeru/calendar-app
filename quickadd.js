'use strict';
/* =====================================================================
 * ひと言で予定入力
 *  「明日15時 歯医者」「毎週月曜 10時〜11時 ゴミ出し」などを読み取って、
 *  日付・時刻・繰り返し・タイトルに分ける。
 *  parse(text, today) → { title, date, time, endTime, endDate, repeat, remind, found[] }
 *   repeat: null | { rv: 'daily'|'weekly'|'biweekly'|'monthly'|'yearly', days: [0-6] }
 *   found: 読み取れたものの説明（画面に「こう読み取りました」と出す）
 * ===================================================================== */
const QuickAdd = (() => {
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const WD = '日月火水木金土';
  const WD_RE = '[日月火水木金土]';

  // 全角の数字・記号を半角にそろえる
  function normalize(s) {
    return String(s || '').normalize('NFKC')
      .replace(/[〜~～]/g, '~').replace(/[ー−–—]/g, '-').replace(/\s+/g, ' ').trim();
  }

  // 曜日を並べた部分（例：月・水・金 / 月水金 / 月曜と木曜）→ [1,3,5]
  function weekdaysIn(s) {
    const out = [];
    for (const ch of s.replace(/曜日?/g, '')) {
      const i = WD.indexOf(ch);
      if (i >= 0 && !out.includes(i)) out.push(i);
    }
    return out;
  }

  // 次のその曜日（今日がその曜日なら今日）
  const nextWeekday = (today, wd) => addDays(today, (wd - today.getDay() + 7) % 7);
  // 月曜はじまりで「今週・来週」のその曜日
  function weekOf(today, wd, plusWeeks) {
    const monday = addDays(today, -((today.getDay() + 6) % 7) + 7 * plusWeeks);
    return addDays(monday, (wd + 6) % 7);
  }
  // 年がない日付は、過ぎていれば来年にする
  function futureDate(today, m, d) {
    let x = new Date(today.getFullYear(), m - 1, d);
    if (x < today) x = new Date(today.getFullYear() + 1, m - 1, d);
    return x;
  }

  function parse(text, today) {
    today = today ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
    let s = ' ' + normalize(text) + ' ';
    const r = { title: '', date: null, time: '', endTime: '', endDate: '', repeat: null, remind: null, found: [] };
    // 読み取った部分は空白に置きかえて、最後に残った文字をタイトルにする
    const take = (re, fn) => {
      const m = s.match(re);
      if (!m) return false;
      if (fn(m) === false) return false;
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
      return true;
    };

    /* ---------- 通知（先に取る：「30分前」が時刻と混ざらないように） ---------- */
    take(/(前日)(?:に)?(?:通知|お知らせ|知らせて)/, () => { r.remind = 1440; });
    take(/(\d{1,3})\s*(分|時間)前(?:に)?(?:通知|お知らせ|知らせて)?/, m => {
      const min = Number(m[1]) * (m[2] === '時間' ? 60 : 1);
      const ok = [0, 5, 10, 30, 60, 1440];
      r.remind = ok.reduce((a, b) => (Math.abs(b - min) < Math.abs(a - min) ? b : a), 30);
    });

    /* ---------- 繰り返し ---------- */
    take(/毎日/, () => { r.repeat = { rv: 'daily', days: [] }; });
    if (!r.repeat) take(/平日(?:は|に)?/, () => { r.repeat = { rv: 'weekly', days: [1, 2, 3, 4, 5] }; });
    if (!r.repeat) take(/(?:毎週末|週末|土日)(?:は|に)?/, m => { if (!/毎|週末/.test(m[0]) && !/毎/.test(s)) return false; r.repeat = { rv: 'weekly', days: [6, 0] }; });
    if (!r.repeat) take(new RegExp(`(毎週|隔週)((?:${WD_RE}(?:曜日?)?[・、,と]?)*)`), m => {
      const days = weekdaysIn(m[2]);
      r.repeat = { rv: m[1] === '隔週' ? 'biweekly' : 'weekly', days };
    });
    if (!r.repeat) take(/毎月(\d{1,2})日/, m => {
      r.repeat = { rv: 'monthly', days: [] };
      const d = Number(m[1]);
      let x = new Date(today.getFullYear(), today.getMonth(), d);
      if (x < today) x = new Date(today.getFullYear(), today.getMonth() + 1, d);
      r.date = x;
    });
    if (!r.repeat) take(/毎年(\d{1,2})[月/](\d{1,2})日?/, m => {
      r.repeat = { rv: 'yearly', days: [] };
      r.date = futureDate(today, Number(m[1]), Number(m[2]));
    });
    if (!r.repeat) take(/毎月/, () => { r.repeat = { rv: 'monthly', days: [] }; });
    if (!r.repeat) take(/毎年/, () => { r.repeat = { rv: 'yearly', days: [] }; });

    /* ---------- 日付 ---------- */
    const setDate = d => { if (!r.date) r.date = d; };
    take(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/, m => setDate(new Date(+m[1], m[2] - 1, +m[3])));
    if (!r.date) take(/(\d{1,2})月(\d{1,2})日/, m => setDate(futureDate(today, +m[1], +m[2])));
    if (!r.date) take(/(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d:])/, m => setDate(futureDate(today, +m[1], +m[2])));
    if (!r.date) take(/来月(\d{1,2})日/, m => setDate(new Date(today.getFullYear(), today.getMonth() + 1, +m[1])));
    if (!r.date) take(/しあさって/, () => setDate(addDays(today, 3)));
    if (!r.date) take(/(明後日|あさって)/, () => setDate(addDays(today, 2)));
    if (!r.date) take(/(明日|あした|あす)/, () => setDate(addDays(today, 1)));
    if (!r.date) take(/(今日|きょう|本日)/, () => setDate(today));
    if (!r.date) take(/(\d{1,2})日後/, m => setDate(addDays(today, +m[1])));
    if (!r.date) take(new RegExp(`(再来週|来週|今週)の?(${WD_RE})曜日?`), m => {
      const plus = m[1] === '再来週' ? 2 : m[1] === '来週' ? 1 : 0;
      setDate(weekOf(today, WD.indexOf(m[2]), plus));
    });
    if (!r.date) take(/来週/, () => setDate(weekOf(today, 1, 1)));
    if (!r.date) take(/週末/, () => setDate(nextWeekday(today, 6)));
    // 曜日だけ（「金曜 飲み会」）。毎週の曜日が書かれていないときは、それも曜日として使う
    if (!r.date || (r.repeat && /weekly/.test(r.repeat.rv) && !r.repeat.days.length)) {
      take(new RegExp(`((?:${WD_RE}曜日?[・、,と]?)+)`), m => {
        const days = weekdaysIn(m[1]);
        if (!days.length) return false;
        if (r.repeat && /weekly/.test(r.repeat.rv) && !r.repeat.days.length) r.repeat.days = days;
        if (!r.date) setDate(nextWeekday(today, days[0]));
      });
    }
    if (!r.date && !(r.repeat && r.repeat.rv === 'monthly')) take(/(?<![\d:/])(\d{1,2})日(?!後|間)/, m => {
      const d = +m[1];
      let x = new Date(today.getFullYear(), today.getMonth(), d);
      if (x < today) x = new Date(today.getFullYear(), today.getMonth() + 1, d);
      setDate(x);
    });
    // 毎週で日付が書いてなければ、次の該当する曜日から
    if (!r.date && r.repeat && /weekly/.test(r.repeat.rv) && r.repeat.days.length) {
      const cands = r.repeat.days.map(d => nextWeekday(today, d)).sort((a, b) => a - b);
      r.date = cands[0];
    }
    if (!r.date && r.repeat && r.repeat.rv === 'monthly') r.date = today;

    /* ---------- 時刻 ---------- */
    // 「午後3時半」「15:30」「朝7時」「夜8時」「正午」
    const T = '(午前|午後|朝|昼|夕方|夜|深夜)?\\s*(?:(\\d{1,2}):(\\d{2})|(\\d{1,2})時(?:(半)|(\\d{1,2})分)?|(正午))';
    const toTime = (m, o) => {
      const ap = m[o];
      if (m[o + 6]) return '12:00';
      let h = Number(m[o + 1] != null ? m[o + 1] : m[o + 3]);
      const min = m[o + 2] != null ? Number(m[o + 2]) : m[o + 4] ? 30 : m[o + 5] != null ? Number(m[o + 5]) : 0;
      if (h > 24 || min > 59) return null;
      if (/午後|夕方|夜/.test(ap || '') && h < 12) h += 12;
      else if (ap === '昼' && h < 6) h += 12;
      else if ((ap === '午前' || ap === '朝' || ap === '深夜') && h === 12) h = 0;
      // 午前・午後が書いてない「3時」は、ふつう午後のこと
      else if (!ap && h >= 1 && h <= 6) h += 12;
      if (h === 24) h = 0;
      return `${pad(h)}:${pad(min)}`;
    };
    const range = new RegExp(`${T}\\s*(?:~|-|から)\\s*${T}(?:まで)?`);
    const hit = take(range, m => {
      const a = toTime(m, 1), b0 = toTime(m, 8);
      if (!a || !b0) return false;
      let b = b0;
      // 「10時〜3時」のように終わりが前なら午後とみなす
      if (!m[8] && b < a && Number(b.slice(0, 2)) + 12 < 24) b = `${pad(Number(b.slice(0, 2)) + 12)}${b.slice(2)}`;
      r.time = a; r.endTime = b > a ? b : '';
    });
    if (!hit) {
      take(new RegExp(`${T}(?:から|~)?`), m => {
        const a = toTime(m, 1);
        if (!a) return false;
        r.time = a;
      });
      take(new RegExp(`(?:~|まで)\\s*${T}(?:まで)?`), m => { const b = toTime(m, 1); if (b && b > r.time) r.endTime = b; else return false; });
    }

    /* ---------- タイトル ---------- */
    let title = s
      .replace(/(?:^|\s)(?:に|は|の|で|から|まで|と|、|,|。)(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .replace(/^(?:に|は|の|で|から|まで|、|,)+\s*/, '')
      .replace(/\s*(?:に|は|の|で|から|まで|、|,|。)+$/, '')
      .trim();
    r.title = title.slice(0, 60);

    /* ---------- 説明 ---------- */
    if (r.date) {
      r.date = ymd(r.date);
      const d = new Date(+r.date.slice(0, 4), r.date.slice(5, 7) - 1, +r.date.slice(8));
      r.found.push(`${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`);
    }
    if (r.time) r.found.push(r.endTime ? `${r.time}〜${r.endTime}` : r.time);
    if (r.repeat) {
      const days = r.repeat.days.map(i => WD[i]).join('・');
      r.found.push({ daily: '毎日', weekly: '毎週', biweekly: '隔週', monthly: '毎月', yearly: '毎年' }[r.repeat.rv] + (days ? ` ${days}` : ''));
    }
    if (r.remind != null) r.found.push(r.remind === 1440 ? '前日に通知' : r.remind === 0 ? '時刻に通知' : r.remind === 60 ? '1時間前に通知' : `${r.remind}分前に通知`);
    return r;
  }

  return { parse, normalize };
})();
if (typeof module !== 'undefined') module.exports = QuickAdd;

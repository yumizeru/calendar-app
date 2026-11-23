'use strict';
/* =====================================================================
 * 予定の計算（画面・同期・リマインダーで共通に使う）
 *
 * 予定のデータ:
 *  { id, title, date, time, endDate, endTime, memo, remind, categoryId,
 *    repeat: null | { freq: 'daily'|'weekly'|'monthly'|'yearly', interval, byWeekday: [0-6], until },
 *    exdates: ['YYYY-MM-DD'],      // 繰り返しのうち「この回だけ削除・変更」した日
 *    parentId, origDate,           // 「この回だけ変更」で切り離した予定の元
 *    updatedAt, deleted }
 * ===================================================================== */
const Core = (() => {
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const addDaysStr = (s, n) => ymd(addDays(parseYmd(s), n));
  // 日数の差（夏時間などの影響を受けないよう UTC で数える）
  const diffDays = (a, b) => {
    const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
  };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];

  const duration = ev => (ev.endDate && ev.endDate > ev.date ? diffDays(ev.date, ev.endDate) : 0);

  // その日が繰り返しの1回に当たるか
  function matches(ev, s) {
    if (s < ev.date) return false;
    const r = ev.repeat;
    if (r.until && s > r.until) return false;
    const iv = Math.max(1, Number(r.interval) || 1);
    const st = parseYmd(ev.date), d = parseYmd(s);
    switch (r.freq) {
      case 'daily':
        return diffDays(ev.date, s) % iv === 0;
      case 'weekly': {
        const days = Array.isArray(r.byWeekday) && r.byWeekday.length ? r.byWeekday : [st.getDay()];
        if (!days.includes(d.getDay())) return false;
        const weeks = Math.floor(diffDays(ymd(addDays(st, -st.getDay())), ymd(addDays(d, -d.getDay()))) / 7);
        return weeks % iv === 0;
      }
      case 'monthly': {
        if (d.getDate() !== st.getDate()) return false;
        const months = (d.getFullYear() - st.getFullYear()) * 12 + d.getMonth() - st.getMonth();
        return months % iv === 0;
      }
      case 'yearly':
        return d.getMonth() === st.getMonth() && d.getDate() === st.getDate() &&
          (d.getFullYear() - st.getFullYear()) % iv === 0;
      default:
        return s === ev.date;
    }
  }

  /**
   * from〜to（両端を含む）に重なる予定の「1回ぶん」を全部並べる
   * 戻り値: [{ ev, start, end, key }]  start/end はその回の開始日・終了日
   */
  function expand(events, from, to) {
    const out = [];
    for (const ev of events) {
      if (!ev || ev.deleted || !ev.date || !ev.title) continue;
      const dur = duration(ev);
      if (!ev.repeat) {
        const end = addDaysStr(ev.date, dur);
        if (ev.date <= to && end >= from) out.push({ ev, start: ev.date, end, key: ev.id });
        continue;
      }
      const ex = new Set(ev.exdates || []);
      let s = ev.date > addDaysStr(from, -dur) ? ev.date : addDaysStr(from, -dur);
      const last = ev.repeat.until && ev.repeat.until < to ? ev.repeat.until : to;
      for (let guard = 0; s <= last && guard < 4000; guard++, s = addDaysStr(s, 1)) {
        if (ex.has(s) || !matches(ev, s)) continue;
        out.push({ ev, start: s, end: addDaysStr(s, dur), key: `${ev.id}@${s}` });
      }
    }
    return out;
  }

  // ある1日に表示する予定（時刻順。終日・複数日の途中は先頭に）
  function onDay(events, day) {
    return expand(events, day, day).map(o => ({ ...o, day }))
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }
  function sortKey(o) {
    const allDayish = !o.ev.time || o.start < o.day;
    return (allDayish ? '0' : '1') + (o.start < o.day ? '00:00' : (o.ev.time || '00:00')) + o.ev.title;
  }

  // 一覧に出す時刻の文字（例: 10:00–12:00 / 終日 / 10:00〜 / 〜12:00）
  function timeLabel(o) {
    const ev = o.ev, day = o.day || o.start;
    const multi = o.end > o.start;
    if (!multi) {
      if (!ev.time) return '終日';
      return ev.endTime ? `${ev.time}–${ev.endTime}` : ev.time;
    }
    if (day === o.start) return ev.time ? `${ev.time}〜` : '終日〜';
    if (day === o.end) return ev.endTime ? `〜${ev.endTime}` : '〜終日';
    return '終日';
  }

  function repeatLabel(r) {
    if (!r) return '';
    const iv = Math.max(1, Number(r.interval) || 1);
    const every = iv === 1 ? '毎' : `${iv}`;
    let s;
    switch (r.freq) {
      case 'daily': s = iv === 1 ? '毎日' : `${iv}日ごと`; break;
      case 'weekly': {
        const days = (r.byWeekday || []).slice().sort().map(i => WD[i]).join('・');
        s = (iv === 1 ? '毎週' : `${iv}週ごと`) + (days ? ` ${days}` : '');
        break;
      }
      case 'monthly': s = iv === 1 ? '毎月' : `${iv}か月ごと`; break;
      case 'yearly': s = iv === 1 ? '毎年' : `${iv}年ごと`; break;
      default: s = every;
    }
    return r.until ? `${s}（${Number(r.until.slice(5, 7))}/${Number(r.until.slice(8))}まで）` : s;
  }

  return { pad, ymd, parseYmd, addDays, addDaysStr, diffDays, WD, matches, expand, onDay, timeLabel, repeatLabel, duration };
})();
if (typeof module !== 'undefined') module.exports = Core;

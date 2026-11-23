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

  /* ===================================================================
   * 習慣
   *  habit: { id, name, color, createdAt,
   *           freq: { type: 'daily'|'weekdays'|'weekly', days: [0-6], times: N },
   *           target: null | { value, unit },   // 数値で記録する習慣
   *           remindAt: '' | 'HH:MM' }
   *  marks: { "YYYY-MM-DD|habitId": { on, v, t } }   v は数値の記録
   * =================================================================== */
  const freqOf = h => (h && h.freq && h.freq.type ? h.freq : { type: 'daily' });
  const isNumeric = h => !!(h && h.target && Number(h.target.value) > 0);
  const weekStart = s => { const d = parseYmd(s); return ymd(addDays(d, -d.getDay())); };

  // その日は「やる日」か（曜日指定のときだけ休みの日がある）
  function isDue(h, s) {
    const f = freqOf(h);
    if (f.type === 'weekdays') return (f.days || []).includes(parseYmd(s).getDay());
    return true;
  }
  const markOf = (marks, s, hid) => (marks && marks[`${s}|${hid}`]) || null;
  function isDoneMark(h, m) {
    if (!m) return false;
    if (isNumeric(h)) return (Number(m.v) || 0) >= Number(h.target.value);
    return !!m.on;
  }
  const doneOn = (h, marks, s) => isDoneMark(h, markOf(marks, s, h.id));
  const valueOn = (h, marks, s) => { const m = markOf(marks, s, h.id); return m && m.v != null ? Number(m.v) : null; };

  function weekCount(h, marks, s) {
    const ws = weekStart(s);
    let n = 0;
    for (let i = 0; i < 7; i++) if (doneOn(h, marks, addDaysStr(ws, i))) n++;
    return n;
  }
  const weekNeed = h => Math.max(1, Number(freqOf(h).times) || 1);

  // 連続記録。週N回の習慣は「達成した週」を数える
  function streak(h, marks, today) {
    if (freqOf(h).type === 'weekly') {
      const need = weekNeed(h);
      let ws = weekStart(today);
      if (weekCount(h, marks, ws) < need) ws = addDaysStr(ws, -7); // 今週はまだ途中
      let n = 0;
      while (n < 520 && weekCount(h, marks, ws) >= need) { n++; ws = addDaysStr(ws, -7); }
      return { n, unit: '週' };
    }
    let s = today;
    if (!doneOn(h, marks, s)) s = addDaysStr(s, -1); // 今日はまだこれから
    let n = 0;
    for (let g = 0; g < 3660; g++, s = addDaysStr(s, -1)) {
      if (!isDue(h, s)) continue; // 休みの日は飛ばす
      if (doneOn(h, marks, s)) n++; else break;
    }
    return { n, unit: '日' };
  }

  // 最初に記録した日（作成日より前の記録がある場合のため）
  function firstMark(h, marks) {
    let first = null;
    const suffix = `|${h.id}`;
    for (const k in marks || {}) {
      if (k.endsWith(suffix)) { const s = k.slice(0, 10); if (!first || s < first) first = s; }
    }
    return first;
  }

  // from〜to の達成率（習慣を始める前の期間は数えない）
  function rate(h, marks, from, to) {
    let begin = h.createdAt || null;
    const fm = firstMark(h, marks);
    if (fm && (!begin || fm < begin)) begin = fm;
    if (begin && from < begin) from = begin;
    if (from > to) return { done: 0, total: 0, pct: 0 };
    if (freqOf(h).type === 'weekly') {
      const need = weekNeed(h);
      let done = 0, total = 0;
      for (let ws = weekStart(from); ws <= to; ws = addDaysStr(ws, 7)) {
        done += Math.min(weekCount(h, marks, ws), need);
        total += need;
      }
      return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
    }
    let done = 0, total = 0;
    for (let s = from; s <= to; s = addDaysStr(s, 1)) {
      if (!isDue(h, s)) continue;
      total++;
      if (doneOn(h, marks, s)) done++;
    }
    return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
  }

  // ヒートマップの濃さ（-1 = 休みの日, 0〜4）
  function level(h, marks, s) {
    if (isNumeric(h)) {
      const v = valueOn(h, marks, s);
      if (!v) return isDue(h, s) ? 0 : -1;
      return Math.max(1, Math.min(4, Math.ceil(v / Number(h.target.value) * 4)));
    }
    if (doneOn(h, marks, s)) return 4;
    return isDue(h, s) ? 0 : -1;
  }

  function freqLabel(h) {
    const f = freqOf(h);
    if (f.type === 'weekdays') return (f.days || []).slice().sort().map(i => WD[i]).join('・') || '曜日未設定';
    if (f.type === 'weekly') return `週${weekNeed(h)}回`;
    return '毎日';
  }
  const fmtNum = v => (Math.round(Number(v) * 100) / 100).toString();

  return {
    pad, ymd, parseYmd, addDays, addDaysStr, diffDays, WD, matches, expand, onDay, timeLabel, repeatLabel, duration,
    freqOf, isNumeric, weekStart, isDue, markOf, isDoneMark, doneOn, valueOn, weekCount, weekNeed, streak, rate, level, freqLabel, fmtNum,
  };
})();
if (typeof module !== 'undefined') module.exports = Core;

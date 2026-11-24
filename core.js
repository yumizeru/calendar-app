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

  // これまでで一番長く続いた記録（バッジ用）。週N回の習慣は週の数
  function bestStreak(h, marks, today) {
    let first = null;
    const suffix = `|${h.id}`;
    for (const k in marks || {}) if (k.endsWith(suffix) && (!first || k.slice(0, 10) < first)) first = k.slice(0, 10);
    if (!first) return { n: 0, unit: freqOf(h).type === 'weekly' ? '週' : '日' };
    let best = 0, run = 0;
    if (freqOf(h).type === 'weekly') {
      const need = weekNeed(h);
      for (let ws = weekStart(first); ws <= today; ws = addDaysStr(ws, 7)) {
        if (weekCount(h, marks, ws) >= need) { run++; best = Math.max(best, run); }
        else if (addDaysStr(ws, 6) < today) run = 0; // 今週はまだ途中なので途切れにしない
      }
      return { n: best, unit: '週' };
    }
    for (let s = first; s <= today; s = addDaysStr(s, 1)) {
      if (!isDue(h, s)) continue;
      if (doneOn(h, marks, s)) { run++; best = Math.max(best, run); }
      else if (s < today) run = 0;
    }
    return { n: best, unit: '日' };
  }
  const BADGE_STEPS = [3, 7, 14, 30, 50, 100, 200, 365];

  // 誕生日・記念日の「〇歳」「〇周年」
  function kindSuffix(ev, occStart) {
    if (!ev || !ev.kind) return '';
    const n = Number(occStart.slice(0, 4)) - Number(ev.date.slice(0, 4));
    if (ev.kind === 'birthday') return n >= 0 ? `（${n}歳）` : '';
    if (ev.kind === 'anniv') return n >= 1 ? `（${n}周年）` : '';
    return '';
  }

  function freqLabel(h) {
    const f = freqOf(h);
    if (f.type === 'weekdays') return (f.days || []).slice().sort().map(i => WD[i]).join('・') || '曜日未設定';
    if (f.type === 'weekly') return `週${weekNeed(h)}回`;
    return '毎日';
  }
  const fmtNum = v => (Math.round(Number(v) * 100) / 100).toString();

  /* ===================================================================
   * ほかのカレンダー（iPhone・Google など）の ICS を読む
   *  parseIcs(text, { from, to, tz, feedId })
   *   → from〜to に重なる予定を「1回ずつ」に展開した配列（繰り返しなし）
   *  tz: 表示する時間帯（省略時はこの端末の時間帯）
   * =================================================================== */
  // ある時間帯での「年月日」と「時:分」（Intl を使う）
  function partsIn(ms, tz) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = {};
    for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
  }
  // 時間帯 zone の「壁の時計」で y-m-d h:m のときの、本当の時刻（ミリ秒）
  function wallToMs(y, mo, d, h, mi, zone) {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    try {
      const p = partsIn(guess, zone);
      const [py, pm, pd] = p.date.split('-').map(Number), [ph, pmi] = p.time.split(':').map(Number);
      return guess - (Date.UTC(py, pm - 1, pd, ph, pmi) - guess);
    } catch { return guess; }
  }
  // ICS の日時 → { date, time }（time が '' なら終日）
  function icsWhen(prop, tz) {
    if (!prop) return null;
    const m = prop.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    const [, y, mo, d, h, mi, , z] = m;
    if (h == null || prop.params.VALUE === 'DATE') return { date: `${y}-${mo}-${d}`, time: '' };
    let ms;
    if (z) ms = Date.UTC(+y, mo - 1, +d, +h, +mi);
    else if (prop.params.TZID) ms = wallToMs(+y, +mo, +d, +h, +mi, prop.params.TZID.replace(/^"|"$/g, ''));
    else return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` }; // 時間帯なし＝そのまま
    try { return partsIn(ms, tz); } catch { return partsIn(ms, 'Asia/Tokyo'); }
  }
  const unesc = s => String(s || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
  const WDCODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  // 繰り返しのルール（RRULE）にその日が当たるか
  function rruleHit(rule, start, s) {
    const iv = Math.max(1, Number(rule.INTERVAL) || 1);
    const st = parseYmd(start), d = parseYmd(s);
    const byDay = rule.BYDAY ? rule.BYDAY.split(',').map(x => { const m = x.match(/^([+-]?\d+)?([A-Z]{2})$/); return m ? { n: m[1] ? Number(m[1]) : 0, wd: WDCODE.indexOf(m[2]) } : null; }).filter(Boolean) : [];
    const byMonthDay = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : [];
    const byMonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : [];
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    // 「第2月曜」「最後の金曜」
    const nthOk = b => {
      if (b.wd !== d.getDay()) return false;
      if (!b.n) return true;
      return b.n > 0 ? Math.ceil(d.getDate() / 7) === b.n : Math.ceil((dim - d.getDate() + 1) / 7) === -b.n;
    };
    const mdOk = () => byMonthDay.some(x => (x > 0 ? x : dim + x + 1) === d.getDate());
    switch (rule.FREQ) {
      case 'DAILY':
        if (byDay.length && !byDay.some(b => b.wd === d.getDay())) return false;
        return diffDays(start, s) % iv === 0;
      case 'WEEKLY': {
        const days = byDay.length ? byDay.map(b => b.wd) : [st.getDay()];
        if (!days.includes(d.getDay())) return false;
        // 週のはじまり（WKST）は月曜がふつう
        const ws = WDCODE.indexOf(rule.WKST || 'MO');
        const back = x => addDays(x, -((x.getDay() - ws + 7) % 7));
        return Math.round(diffDays(ymd(back(st)), ymd(back(d))) / 7) % iv === 0;
      }
      case 'MONTHLY': {
        const months = (d.getFullYear() - st.getFullYear()) * 12 + d.getMonth() - st.getMonth();
        if (months % iv !== 0) return false;
        if (byDay.length) return byDay.some(nthOk) && (!byMonthDay.length || mdOk());
        if (byMonthDay.length) return mdOk();
        return d.getDate() === st.getDate();
      }
      case 'YEARLY': {
        if ((d.getFullYear() - st.getFullYear()) % iv !== 0) return false;
        const months = byMonth.length ? byMonth : [st.getMonth() + 1];
        if (!months.includes(d.getMonth() + 1)) return false;
        if (byDay.length) return byDay.some(nthOk);
        if (byMonthDay.length) return mdOk();
        return d.getDate() === st.getDate();
      }
      default: return false;
    }
  }

  function parseIcs(text, opt) {
    opt = opt || {};
    const tz = opt.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
    const from = opt.from, to = opt.to, feedId = opt.feedId || 'feed';
    // 折り返された行をつなぐ
    const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const vevents = [];
    let cur = null, depth = 0;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { cur = {}; depth = 0; continue; }
      if (!cur) continue;
      if (line.startsWith('BEGIN:')) { depth++; continue; } // VALARM など
      if (line.startsWith('END:')) {
        if (line === 'END:VEVENT' && depth === 0) { vevents.push(cur); cur = null; } else depth--;
        continue;
      }
      if (depth) continue;
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...ps] = line.slice(0, i).split(';');
      const params = {};
      for (const p of ps) { const j = p.indexOf('='); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1); }
      const prop = { value: line.slice(i + 1), params };
      const key = name.toUpperCase();
      if (key === 'EXDATE') (cur.EXDATE = cur.EXDATE || []).push(prop);
      else cur[key] = prop;
    }

    const out = [];
    const overrides = new Set(); // 「この回だけ変更」された回（UID@日付）
    const make = (ve, st, en, date) => {
      let endDate = '', endTime = '';
      if (en) {
        if (!st.time) {
          // 終日の終わりは「次の日」で書かれている
          const last = addDaysStr(en.date, -1);
          if (last > st.date) endDate = addDaysStr(date, diffDays(st.date, last));
        } else {
          endTime = en.time;
          if (en.date > st.date) endDate = addDaysStr(date, diffDays(st.date, en.date));
          if (!endDate && endTime <= st.time) endTime = '';
        }
      }
      const uidv = ve.UID ? ve.UID.value : `${st.date}${st.time}${unesc(ve.SUMMARY && ve.SUMMARY.value)}`;
      return {
        id: `feed:${feedId}:${uidv}@${date}`, feedId, readonly: true,
        title: unesc(ve.SUMMARY && ve.SUMMARY.value).slice(0, 80) || '（タイトルなし）',
        date, time: st.time, endDate, endTime: st.time ? endTime : '',
        memo: unesc(ve.LOCATION && ve.LOCATION.value).slice(0, 200), updatedAt: 0,
      };
    };
    const inRange = (s, e) => (!from || e >= from) && (!to || s <= to);

    // 先に「この回だけ変更」を集める
    for (const ve of vevents) {
      if (!ve['RECURRENCE-ID'] || !ve.UID) continue;
      const rid = icsWhen(ve['RECURRENCE-ID'], tz);
      if (rid) overrides.add(`${ve.UID.value}@${rid.date}`);
    }
    for (const ve of vevents) {
      if (ve.STATUS && /CANCELLED/i.test(ve.STATUS.value)) continue;
      const st = icsWhen(ve.DTSTART, tz);
      if (!st) continue;
      let en = icsWhen(ve.DTEND, tz);
      if (!en && ve.DURATION) {
        const m = ve.DURATION.value.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
        if (m) {
          const days = (+m[1] || 0) * 7 + (+m[2] || 0), mins = (+m[3] || 0) * 60 + (+m[4] || 0);
          if (!st.time) en = { date: addDaysStr(st.date, days), time: '' };
          else {
            const [h, mi] = st.time.split(':').map(Number);
            const tot = h * 60 + mi + mins;
            en = { date: addDaysStr(st.date, days + Math.floor(tot / 1440)), time: `${pad(Math.floor(tot % 1440 / 60))}:${pad(tot % 60)}` };
          }
        }
      }
      const span = en ? Math.max(0, diffDays(st.date, st.time ? en.date : addDaysStr(en.date, -1))) : 0;
      const rr = ve.RRULE && !ve['RECURRENCE-ID']
        ? Object.fromEntries(ve.RRULE.value.split(';').map(x => x.split('=')).map(([k, v]) => [k.toUpperCase(), v]))
        : null;
      if (!rr) {
        if (inRange(st.date, addDaysStr(st.date, span))) out.push(make(ve, st, en, st.date));
        continue;
      }
      const ex = new Set();
      for (const p of ve.EXDATE || []) for (const v of p.value.split(',')) { const w = icsWhen({ value: v, params: p.params }, tz); if (w) ex.add(w.date); }
      let until = null;
      if (rr.UNTIL) { const u = icsWhen({ value: rr.UNTIL, params: {} }, tz); if (u) until = u.date; }
      const count = rr.COUNT ? Number(rr.COUNT) : 0;
      const last = [until, to || addDaysStr(st.date, 730)].filter(Boolean).sort()[0];
      let n = 0;
      // 回数の指定（COUNT）がなければ、表示する期間の少し前から数えれば足りる
      const begin = !count && from && addDaysStr(from, -span) > st.date ? addDaysStr(from, -span) : st.date;
      for (let s = begin, guard = 0; s <= last && guard < 20000; s = addDaysStr(s, 1), guard++) {
        if (!rruleHit(rr, st.date, s)) continue;
        n++;
        if (count && n > count) break;
        if (ex.has(s) || overrides.has(`${ve.UID && ve.UID.value}@${s}`)) continue;
        if (inRange(s, addDaysStr(s, span))) out.push(make(ve, st, en, s));
      }
    }
    return out;
  }

  return {
    pad, ymd, parseYmd, addDays, addDaysStr, diffDays, WD, matches, expand, onDay, timeLabel, repeatLabel, duration,
    freqOf, isNumeric, weekStart, isDue, markOf, isDoneMark, doneOn, valueOn, weekCount, weekNeed, streak, rate, level, freqLabel, fmtNum,
    bestStreak, BADGE_STEPS, kindSuffix, parseIcs,
  };
})();
if (typeof module !== 'undefined') module.exports = Core;

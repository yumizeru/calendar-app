'use strict';
/*
 * 日本の祝日を計算する（ネット不要）。2000〜2099年に対応。
 * 振替休日・国民の休日、2019〜2021年の特例も反映。
 * 使い方: JPHolidays.get('2026-11-23') → '勤労感謝の日'（祝日でなければ null）
 */
const JPHolidays = (() => {
  const cache = new Map();
  const pad = n => String(n).padStart(2, '0');
  const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  // m月の第n月曜日
  const nthMonday = (y, m, n) => {
    const first = new Date(y, m - 1, 1).getDay();
    return 1 + ((8 - first) % 7) + (n - 1) * 7;
  };
  const shunbun = y => Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  const shubun = y => Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

  function build(y) {
    const h = {};
    const add = (m, d, name) => { h[key(y, m, d)] = name; };

    add(1, 1, '元日');
    add(1, nthMonday(y, 1, 2), '成人の日');
    add(2, 11, '建国記念の日');
    if (y >= 2020) add(2, 23, '天皇誕生日');
    add(3, shunbun(y), '春分の日');
    add(4, 29, y >= 2007 ? '昭和の日' : 'みどりの日');
    add(5, 3, '憲法記念日');
    if (y >= 2007) add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');

    // 海の日・スポーツの日・山の日（東京五輪の特例あり）
    if (y === 2020) { add(7, 23, '海の日'); add(7, 24, 'スポーツの日'); add(8, 10, '山の日'); }
    else if (y === 2021) { add(7, 22, '海の日'); add(7, 23, 'スポーツの日'); add(8, 8, '山の日'); }
    else {
      add(7, nthMonday(y, 7, 3), '海の日');
      if (y >= 2016) add(8, 11, '山の日');
      add(10, nthMonday(y, 10, 2), y >= 2020 ? 'スポーツの日' : '体育の日');
    }

    add(9, nthMonday(y, 9, 3), '敬老の日');
    add(9, shubun(y), '秋分の日');
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');
    if (y <= 2018) add(12, 23, '天皇誕生日');

    if (y === 2019) { add(5, 1, '天皇の即位の日'); add(10, 22, '即位礼正殿の儀の行われる日'); }

    // 国民の休日：祝日に挟まれた平日
    const base = { ...h };
    const isBase = d => !!base[key(d.getFullYear(), d.getMonth() + 1, d.getDate())];
    for (let d = new Date(y, 0, 2); d.getFullYear() === y; d.setDate(d.getDate() + 1)) {
      const k = key(y, d.getMonth() + 1, d.getDate());
      if (base[k] || d.getDay() === 0) continue;
      const prev = new Date(d); prev.setDate(d.getDate() - 1);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      if (isBase(prev) && isBase(next)) h[k] = '国民の休日';
    }

    // 振替休日：日曜の祝日の後、最初の祝日でない日
    for (const k of Object.keys(base)) {
      const [yy, mm, dd] = k.split('-').map(Number);
      const d = new Date(yy, mm - 1, dd);
      if (d.getDay() !== 0) continue;
      const s = new Date(d);
      do { s.setDate(s.getDate() + 1); } while (h[key(s.getFullYear(), s.getMonth() + 1, s.getDate())]);
      if (s.getFullYear() === y) h[key(y, s.getMonth() + 1, s.getDate())] = '振替休日';
    }
    return h;
  }

  function forYear(y) {
    if (!cache.has(y)) cache.set(y, build(y));
    return cache.get(y);
  }
  return {
    get(ymd) {
      const y = Number(ymd.slice(0, 4));
      if (y < 2000 || y > 2099) return null;
      return forYear(y)[ymd] || null;
    },
    forYear,
  };
})();
if (typeof module !== 'undefined') module.exports = JPHolidays;

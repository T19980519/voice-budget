/* 오늘 얼마 썼어? — 나라별 공휴일 · 은행 휴무일
 * 통화로 나라를 정함: KRW → 대한민국, USD → 미국, CAD → 캐나다(온타리오)
 * 각 날짜: { name, bank }  bank = 은행이 이체를 처리하지 않는 날 (자동이체가 다음 영업일로 밀림)
 *
 * 출처 (2026-11 확인)
 *  - 한국: 우주항공청·한국천문연구원 월력요항(2026~2028), 2026년 공휴일법 개정(노동절·제헌절 공휴일, 대체공휴일 포함)
 *          2029~2030 설날·부처님오신날·추석은 음력 환산 날짜 (월력요항 발표 전 잠정)
 *  - 캐나다: Payments Canada 비처리일 (PNC Canada 2026 처리 달력). Family Day·Civic Holiday는 온타리오 휴일이지만 은행 이체는 처리함
 *  - 미국: Federal Reserve 휴일 (K.8). 일요일이면 다음 월요일 휴무, 토요일이면 대체 없음
 */
(function (root) {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const D = (y, m, d) => new Date(y, m - 1, d);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
  /** n번째 요일 (wd: 0=일 … 6=토), n = -1 이면 마지막 */
  function nthWeekday(y, m, wd, n) {
    if (n > 0) { const first = D(y, m, 1); return D(y, m, 1 + ((wd - first.getDay() + 7) % 7) + (n - 1) * 7); }
    const last = new Date(y, m, 0); return D(y, m, last.getDate() - ((last.getDay() - wd + 7) % 7));
  }
  function easter(y) {   // 그레고리력 부활절
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return D(y, month, day);
  }

  // ---------- 대한민국 ----------
  // 음력 공휴일 (양력 날짜): 설날·추석은 당일, 앞뒤 하루씩 함께 쉼
  const KR_LUNAR = {
    2025: { seol: '01-29', buddha: '05-05', chuseok: '10-06' },
    2026: { seol: '02-17', buddha: '05-24', chuseok: '09-25' },
    2027: { seol: '02-07', buddha: '05-13', chuseok: '09-15' },
    2028: { seol: '01-27', buddha: '05-02', chuseok: '10-03' },
    2029: { seol: '02-13', buddha: '05-20', chuseok: '09-22' },   // 잠정
    2030: { seol: '02-03', buddha: '05-09', chuseok: '09-12' },   // 잠정
  };
  // 선거일 (공휴일)
  const KR_EXTRA = { '2026-06-03': '지방선거일', '2028-04-12': '국회의원선거일' };
  function korea(y) {
    const map = new Map();
    const add = (d, name) => { const k = key(d); const o = map.get(k); map.set(k, { name: o ? o.name + '·' + name : name, bank: true, overlap: !!o }); };
    const subs = [];   // 대체공휴일 대상 { days:[Date], sat: 토요일도 대체?, name }
    const fixed = [['01-01', '신정', 0], ['03-01', '삼일절', 1], ['05-01', '노동절', 1], ['05-05', '어린이날', 1], ['06-06', '현충일', 0],
      ['07-17', '제헌절', 1], ['08-15', '광복절', 1], ['10-03', '개천절', 1], ['10-09', '한글날', 1], ['12-25', '성탄절', 1]];
    for (const [md, name, sub] of fixed) {
      if (y < 2026 && (name === '노동절' || name === '제헌절')) continue;   // 2026년부터 공휴일
      const [m, d] = md.split('-').map(Number); const day = D(y, m, d); add(day, name);
      if (sub) subs.push({ days: [day], sat: true, name });
    }
    const L = KR_LUNAR[y];
    if (L) {
      for (const [k, name] of [['seol', '설날'], ['chuseok', '추석']]) {
        const [m, d] = L[k].split('-').map(Number); const mid = D(y, m, d);
        const days = [addDays(mid, -1), mid, addDays(mid, 1)];
        days.forEach((x, i) => add(x, i === 1 ? name : name + ' 연휴'));
        subs.push({ days, sat: false, name });
      }
      const [bm, bd] = L.buddha.split('-').map(Number); const b = D(y, bm, bd); add(b, '부처님오신날'); subs.push({ days: [b], sat: true, name: '부처님오신날' });
    }
    for (const k in KR_EXTRA) if (k.startsWith(y + '-')) { const [yy, m, d] = k.split('-').map(Number); add(D(yy, m, d), KR_EXTRA[k]); }
    // 대체공휴일: 설날·추석은 일요일이나 다른 공휴일과 겹칠 때, 나머지는 토·일이나 다른 공휴일과 겹칠 때 → 그 뒤 첫 평일
    // 두 공휴일이 같은 날 겹치면 대체공휴일은 하루만 (예: 2028 추석·개천절 → 10/5 하루)
    const usedOverlap = new Set();
    for (const s of subs) {
      const weekend = s.days.some((d) => d.getDay() === 0 || (s.sat && d.getDay() === 6));
      const ov = s.days.filter((d) => map.get(key(d)).overlap && !usedOverlap.has(key(d)));
      if (!weekend && !ov.length) continue;
      ov.forEach((d) => usedOverlap.add(key(d)));
      let x = addDays(s.days[s.days.length - 1], 1);
      while (isWeekend(x) || map.has(key(x))) x = addDays(x, 1);
      map.set(key(x), { name: '대체공휴일', bank: true });
    }
    return map;
  }

  // ---------- 캐나다 (온타리오, 은행 기준) ----------
  function canada(y) {
    const map = new Map();
    const bank = [[D(y, 1, 1), '신정'], [addDays(easter(y), -2), '성금요일'], [addDays(D(y, 5, 25), -(((D(y, 5, 25).getDay() + 6) % 7) || 7)), '빅토리아데이'],
      [D(y, 7, 1), '캐나다데이'], [nthWeekday(y, 9, 1, 1), '노동절'], [D(y, 9, 30), '진실화해의날'], [nthWeekday(y, 10, 1, 2), '추수감사절'],
      [D(y, 11, 11), '현충일'], [D(y, 12, 25), '성탄절'], [D(y, 12, 26), '박싱데이']];
    for (const [d, name] of bank) map.set(key(d), { name, bank: true });
    // 주말이면 다음 평일에 은행 휴무 (예: 박싱데이가 토요일 → 월요일, 크리스마스·박싱데이 둘 다 주말 → 월·화)
    for (const [d, name] of bank) {
      if (!isWeekend(d)) continue;
      let x = addDays(d, 1);
      while (isWeekend(x) || map.has(key(x))) x = addDays(x, 1);
      map.set(key(x), { name: name + ' (대체)', bank: true });
    }
    // 온타리오 공휴일이지만 은행 이체는 처리하는 날 (달력에만 빨간색)
    for (const [d, name] of [[nthWeekday(y, 2, 1, 3), '가족의날'], [nthWeekday(y, 8, 1, 1), '시빅홀리데이']])
      if (!map.has(key(d))) map.set(key(d), { name, bank: false, note: '은행 업무함' });
    return map;
  }

  // ---------- 미국 (Federal Reserve) ----------
  function usa(y) {
    const map = new Map();
    const list = [[D(y, 1, 1), '신정'], [nthWeekday(y, 1, 1, 3), '킹목사의날'], [nthWeekday(y, 2, 1, 3), '대통령의날'], [nthWeekday(y, 5, 1, -1), '메모리얼데이'],
      [D(y, 6, 19), '준틴스'], [D(y, 7, 4), '독립기념일'], [nthWeekday(y, 9, 1, 1), '노동절'], [nthWeekday(y, 10, 1, 2), '콜럼버스데이'],
      [D(y, 11, 11), '재향군인의날'], [nthWeekday(y, 11, 4, 4), '추수감사절'], [D(y, 12, 25), '성탄절']];
    for (const [d, name] of list) {
      map.set(key(d), { name, bank: d.getDay() !== 6 && d.getDay() !== 0 });   // 토·일 당일은 어차피 주말
      if (d.getDay() === 0) map.set(key(addDays(d, 1)), { name: name + ' (대체)', bank: true });   // 일요일 → 월요일 휴무, 토요일은 대체 없음
    }
    return map;
  }

  const COUNTRY = { KRW: 'KR', USD: 'US', CAD: 'CA' };
  const cache = {};
  function yearMap(cc, y) {
    const k = cc + y;
    if (!cache[k]) cache[k] = cc === 'KR' ? korea(y) : cc === 'US' ? usa(y) : canada(y);
    return cache[k];
  }
  let CUR = 'CAD';
  const api = {
    setCurrency(c) { CUR = COUNTRY[c] ? c : 'CAD'; },
    country() { return COUNTRY[CUR]; },
    countryName() { return { KR: '대한민국', US: '미국', CA: '캐나다 (온타리오)' }[COUNTRY[CUR]]; },
    /** 그날 공휴일 { name, bank } 또는 null */
    get(d) { return yearMap(COUNTRY[CUR], d.getFullYear()).get(key(d)) || null; },
    /** 은행이 쉬는 날 (주말 또는 은행 휴무 공휴일) */
    isBankOff(d) { if (isWeekend(d)) return true; const h = api.get(d); return !!(h && h.bank); },
    /** 자동이체: 쉬는 날이면 다음 영업일 */
    nextBizDay(d) { let x = new Date(d); let g = 0; while (api.isBankOff(x) && g++ < 14) x = addDays(x, 1); return x; },
    /** 급여: 쉬는 날이면 앞 영업일 */
    prevBizDay(d) { let x = new Date(d); let g = 0; while (api.isBankOff(x) && g++ < 14) x = addDays(x, -1); return x; },
    /** 달력 색: 'sun'(일·공휴일 빨강) | 'sat'(토 파랑) | '' */
    dayClass(d) { if (d.getDay() === 0 || api.get(d)) return 'sun'; if (d.getDay() === 6) return 'sat'; return ''; },
    /** 그 해 공휴일 목록 (확인·테스트용) */
    list(y) { return [...yearMap(COUNTRY[CUR], y).entries()].sort().map(([k, v]) => `${k} ${v.name}${v.note ? ' (' + v.note + ')' : ''}`); },
  };
  if (typeof module !== 'undefined') module.exports = api;
  root.Holidays = api;
})(typeof window !== 'undefined' ? window : globalThis);

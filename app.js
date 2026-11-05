/* 오늘 얼마 썼어? v0.9.3 — 모든 데이터는 이 폰(localStorage)에만 저장 */
(function () {
  'use strict';
  const P = window.VBParser;
  const $ = (id) => document.getElementById(id);
  const KEY_REC = 'vb.records.v1', KEY_SET = 'vb.settings.v1', KEY_NOTI = 'vb.notified.v1';
  const IS_PREVIEW = !!window.VB_PREVIEW; // claude.ai 미리보기 모드
  const CATS = ['커피', '식비', '장보기', '교통', '전자제품', '생활용품', '쇼핑', '통신/구독', '주거', '의료', '여가', '교육', '선물/경조사', '수입', '기타'];

  // ---------- 문구 ({이름} 자리에 값 넣기) ----------
  const T = (ko, v) => {
    let out = ko;
    if (v) for (const k in v) out = out.split('{' + k + '}').join(v[k]);
    return out;
  };

  // ---------- 저장소 ----------
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast(T('저장 공간이 부족합니다')); } };
  let allRecords = load(KEY_REC, []);          // 모든 통화의 기록
  const settingsRaw = load(KEY_SET, null);
  const settings = Object.assign({ firstPay: '2026-11-04', payTime: '04:00', notifyTime: '21:00', weekStart: 1 }, settingsRaw || {});
  delete settings.lang;
  if (!settings.budgets || typeof settings.budgets !== 'object') settings.budgets = {};
  // ---------- 통화 (폰마다 하나: KRW 원 / USD 미국 달러 / CAD 캐나다 달러) ----------
  const CURRENCIES = { KRW: '원 · KRW (대한민국)', USD: '달러 · USD (미국)', CAD: '달러 · CAD (캐나다)' };
  function guessCurrency() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (/Asia\/Seoul/.test(tz)) return 'KRW';
      if (/America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal|Moncton|Whitehorse|Yellowknife|Iqaluit|Glace_Bay|Goose_Bay|Swift_Current|Dawson|Creston)/.test(tz)) return 'CAD';
      if (/^America\//.test(tz) || /^Pacific\/Honolulu/.test(tz)) return 'USD';
    } catch (e) {}
    return /^ko/i.test(navigator.language || '') ? 'KRW' : 'CAD';
  }
  // 예전부터 쓰던 폰(기록·설정이 있음)은 캐나다 달러 그대로, 처음 쓰는 폰은 시간대로 추측
  if (!CURRENCIES[settings.currency]) settings.currency = (allRecords.length || settingsRaw) ? 'CAD' : guessCurrency();
  for (const r of allRecords) if (!r.cur) r.cur = 'CAD';
  let records = allRecords.filter((r) => r.cur === settings.currency);   // 지금 통화의 기록만 화면·합계에 사용
  P.setCurrency(settings.currency);
  // ---------- 급여 (격주 / 매주 / 매달 N일 / 없음) ----------
  if (!settings.payCycle) {
    if (!settingsRaw && settings.currency === 'KRW') Object.assign(settings, { payCycle: 'monthly', payDay: 25, payName: '월급', payTime: '09:00' });
    else settings.payCycle = 'biweekly';
  }
  if (!settingsRaw) {   // 처음 쓰는 날을 기억 (그 전 지급일은 묻지 않기)
    const d = new Date(); settings.since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    try { localStorage.setItem(KEY_SET, JSON.stringify(settings)); } catch (e) {}
  }
  if (!settings.payName) settings.payName = settings.payCycle === 'monthly' ? '월급' : '직장주급';
  if (!(settings.payDay >= 0)) settings.payDay = 25;   // 0 = 말일
  const payName = () => settings.payName || '급여';
  const payItem = () => (settings.payCycle === 'monthly' ? '월급' : '주급');
  const KEY_LEARN = 'vb.learn.v1';
  const learn = Object.assign({ words: {}, cats: {}, phrases: {} }, load(KEY_LEARN, {}));
  P.setLearned(learn.words, learn.cats); P.setPhrases(learn.phrases);
  const saveLearn = () => { save(KEY_LEARN, learn); P.setLearned(learn.words, learn.cats); P.setPhrases(learn.phrases); };
  /** 내가 저장 전에 고친 내용 배우기: 받아쓴 말 → 고친 말, 단어 → 카테고리 */
  function learnFrom(said, parsed, f) {
    if (!said || !parsed) return;
    const pairs = [[parsed.merchant, f.merchant], [parsed.item, f.item]];
    for (const [a, b] of pairs) {
      if (!a || !b || a === b) continue;
      const x = a.split(/\s+/), y = b.split(/\s+/);
      if (x.length !== y.length) continue;
      x.forEach((w, i) => { if (w !== y[i] && w.length <= 10 && y[i] && !/^\d/.test(w) && !y[i].includes(w) && !w.includes(y[i])) learn.words[w] = y[i]; });
    }
    if (f.type === 'out' && parsed.category !== f.category && f.category !== '기타') {
      const key = f.merchant || (f.item || '').split(/\s+/)[0];
      if (key) learn.cats[key] = f.category;
    }
    saveLearn();
  }
  // 같은 가게·같은 물건의 예전 금액 (단위 없이 말한 금액을 판단할 때 기준)
  P.setPriceHistory((r) => {
    const m = (r.merchant || '').trim(), it = (r.item || '').trim();
    const out = [];
    for (let i = records.length - 1; i >= 0 && out.length < 12; i--) {
      const x = records[i];
      if (x.type !== 'out' || !(x.amount > 0)) continue;
      if ((m && x.merchant === m && (!it || x.item === it)) || (!m && it && x.item === it)) out.push(x.amount);
    }
    return out.length >= 2 ? out : null;
  });
  const saveRecords = () => {
    for (const r of records) if (!r.cur) r.cur = settings.currency;
    records.sort((a, b) => a.ts - b.ts);
    allRecords = allRecords.filter((r) => r.cur !== settings.currency).concat(records).sort((a, b) => a.ts - b.ts);
    save(KEY_REC, allRecords);
  };
  // 예전에 잘못 알아들어 저장된 말 바로잡기 (권도 → 콘도, 골 기지 → 모기지 …)
  (function fixOldRecords() {
    let changed = false;
    for (const r of records) {
      const oldGuess = r.type === 'out' ? P.guessCategory((r.merchant || '') + ' ' + (r.item || '')) : null;
      const before = (r.merchant || '') + '|' + (r.item || '');
      for (const k of ['merchant', 'item', 'memo']) {
        if (!r[k]) continue;
        const v = P.fixSounds(r[k]);
        if (v !== r[k]) { r[k] = v; changed = true; }
      }
      if (r.type === 'out' && !r.meal && !r.desc) {
        const fx = P.repairRecord(r);
        if (fx.merchant !== (r.merchant || '') || fx.item !== (r.item || '')) {
          const merchantChanged = fx.merchant !== (r.merchant || '');
          r.merchant = fx.merchant; r.item = fx.item;
          r.memo = [fx.merchant, ...fx.item.split(/\s+/), fx.area].filter(Boolean).join(' ');
          if (merchantChanged || r.category === '기타') { const c = P.guessCategory(r.merchant + ' ' + r.item); if (c !== '기타' && c !== '수입') r.category = c; }
          changed = true;
        }
      }
      // 잘못 알아들어 자동으로 정해졌던 카테고리도 바로잡기 (내가 직접 고른 카테고리는 그대로)
      if (r.type === 'out' && before !== (r.merchant || '') + '|' + (r.item || '') && r.category === oldGuess) {
        const c = P.guessCategory((r.merchant || '') + ' ' + (r.item || ''));
        if (c !== '기타' && c !== '수입' && c !== r.category) { r.category = c; changed = true; }
      }
      if (changed && r.type === 'out' && (!r.category || r.category === '기타')) {
        const c = P.guessCategory((r.merchant || '') + ' ' + (r.item || ''));
        if (c !== '기타' && c !== '수입') r.category = c;
      }
    }
    if (changed) saveRecords();
  })();

  // ---------- 날짜 ----------
  const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
  const DOWx = (i) => DOW_KO[i];
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const sow = (d) => { const x = sod(d); const diff = (x.getDay() - settings.weekStart + 7) % 7; return addDays(x, -diff); };
  const som = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const dkey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtDate = (d) => `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} (${DOW_KO[d.getDay()]})`;
  const fmtTime = (d) => { const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0'); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${m}`; };
  const toLocalInput = (d) => `${dkey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const isWon = () => settings.currency === 'KRW';
  /** 45,670원 / $12.99 */
  const money = (n) => {
    const neg = n < 0 ? '-' : '', a = Math.abs(n);
    if (isWon()) return neg + Math.round(a).toLocaleString('ko-KR') + '원';
    return neg + '$' + a.toLocaleString(settings.currency === 'USD' ? 'en-US' : 'en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  /** 좁은 칸용: 345만원, 1.2억원 / $1,850 */
  const moneyShort = (n) => {
    const neg = n < 0 ? '-' : '', a = Math.abs(n);
    if (isWon()) {
      if (a >= 1e8) return neg + (a / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억원';
      if (a >= 1e6) return neg + Math.round(a / 1e4).toLocaleString('ko-KR') + '만원';
      return money(n);
    }
    return a >= 1000 ? neg + '$' + Math.round(a).toLocaleString('en-CA') : money(n);
  };
  /** 차트 눈금용: 345만 / $1.2k */
  const moneyTick = (n) => isWon()
    ? (n >= 1e8 ? (n / 1e8).toFixed(1).replace(/\.0$/, '') + '억' : n >= 1e4 ? Math.round(n / 1e4) + '만' : Math.round(n).toLocaleString('ko-KR'))
    : (n >= 1000 ? '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(n));
  const roundAmt = (n) => (isWon() ? Math.round(n) : Math.round(n * 100) / 100);
  const parseAmt = (v) => roundAmt(parseFloat(String(v).replace(/[$,원₩￦\s]/g, '')));
  const fmtAmtInput = (n) => (isWon() ? String(Math.round(n)) : n.toFixed(2));

  function range(kind, offset = 0, now = new Date()) {
    if (kind === 'day') { const s = addDays(sod(now), offset); return [s, addDays(s, 1)]; }
    if (kind === 'week') { const s = addDays(sow(now), offset * 7); return [s, addDays(s, 7)]; }
    if (kind === 'month') { const s = new Date(now.getFullYear(), now.getMonth() + offset, 1); return [s, new Date(s.getFullYear(), s.getMonth() + 1, 1)]; }
    if (kind === 'year') { const s = new Date(now.getFullYear() + offset, 0, 1); return [s, new Date(s.getFullYear() + 1, 0, 1)]; }
    return [new Date(0), new Date(8.64e15)];
  }
  function totals(from, to) {
    let inn = 0, out = 0, n = 0;
    for (const r of records) if (r.ts >= +from && r.ts < +to) { r.type === 'in' ? (inn += r.amount) : (out += r.amount); n++; }
    return { inn, out, net: inn - out, n };
  }
  const balance = () => records.reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);

  // ---------- 월 예산 ----------
  const BUDGET_ALL = '전체';
  const BUDGET_CATS = [BUDGET_ALL, ...CATS.filter((c) => c !== '수입')];
  /** 이번 달(또는 m 달) 예산별 사용 현황 [{cat, limit, spent, pct, level}] level: 0 정상, 1 80%↑, 2 초과 */
  function budgetStatus(m = new Date()) {
    const s = som(m), e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
    const spent = {}; let all = 0;
    for (const r of records) if (r.type === 'out' && r.ts >= +s && r.ts < +e) { spent[r.category || '기타'] = (spent[r.category || '기타'] || 0) + r.amount; all += r.amount; }
    spent[BUDGET_ALL] = all;
    return BUDGET_CATS.filter((c) => settings.budgets[c] > 0).map((c) => {
      const limit = settings.budgets[c], sp = roundAmt(spent[c] || 0), pct = sp / limit;
      return { cat: c, limit, spent: sp, pct, left: roundAmt(limit - sp), level: pct >= 1 ? 2 : pct >= 0.8 ? 1 : 0 };
    });
  }
  function budgetHTML(b) {
    const cls = b.level === 2 ? 'over' : b.level === 1 ? 'warn' : '';
    const st = b.level === 2 ? `<b>초과</b> ${money(-b.left)} 넘었어요` : b.level === 1 ? `<b>주의</b> ${money(b.left)} 남았어요` : `<b>여유</b> ${money(b.left)} 남았어요`;
    return `<div class="bud ${cls}"><div class="top"><b>${esc(b.cat === BUDGET_ALL ? '전체 지출' : b.cat)}</b><span class="num">${money(b.spent)} / ${money(b.limit)}</span></div>
      <div class="track" role="img" aria-label="${Math.round(b.pct * 100)}% 사용"><i style="width:${Math.min(100, b.pct * 100).toFixed(1)}%"></i></div>
      <div class="st">${st} · ${Math.round(b.pct * 100)}%</div></div>`;
  }
  function renderHomeBudget() {
    const list = budgetStatus();
    const box = $('homeBudget');
    if (!list.length) { box.innerHTML = ''; return; }
    // 많이 쓴 순서(비율)로, 최대 4개
    const show = list.slice().sort((a, b) => b.pct - a.pct).slice(0, 4);
    box.innerHTML = `<h2>이번 달 예산</h2><div class="card pad" style="padding-block:6px">${show.map(budgetHTML).join('')}
      ${list.length > show.length ? `<button class="linkbtn" data-go-settings>예산 ${list.length}개 모두 보기·바꾸기</button>` : '<button class="linkbtn" data-go-settings>예산 바꾸기</button>'}</div>`;
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-go-settings]')) { go('settings'); setTimeout(() => $('budgetFields').scrollIntoView({ block: 'center' }), 50); } });
  /** 저장 전후를 비교해서 80%·100%를 새로 넘은 예산 찾기 */
  function budgetCrossings(before) {
    const after = budgetStatus();
    return after.filter((b) => { const o = before.find((x) => x.cat === b.cat); return b.level > (o ? o.level : 0); });
  }
  function warnBudgets(crossed) {
    if (!crossed.length) return false;
    const b = crossed.sort((x, y) => y.level - x.level)[0];
    const name = b.cat === BUDGET_ALL ? '이번 달 전체 지출' : `이번 달 ${b.cat}`;
    const msg = b.level === 2 ? `⚠️ ${name} 예산을 넘었어요 (${money(b.spent)} / ${money(b.limit)})` : `${name} 예산의 ${Math.round(b.pct * 100)}%를 썼어요 · ${money(b.left)} 남음`;
    setTimeout(() => toast(msg, 4200), 2500);
    const mk = dkey(som(new Date()));
    for (const c of crossed) {
      const key = 'b|' + c.cat + '|' + mk;
      if ((notified[key] || 0) >= c.level) continue;
      notify(c.level === 2 ? '예산 초과' : '예산 80% 사용', (c.cat === BUDGET_ALL ? '전체 지출' : c.cat) + ` ${money(c.spent)} / ${money(c.limit)}`, 'vb-b-' + c.cat)
        .then((ok) => { if (ok) { notified[key] = c.level; save(KEY_NOTI, notified); } });
    }
    return true;
  }

  // ---------- 화면 공통 ----------
  let toastT;
  function toast(msg, ms = 2400) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const CAT_ICON = { '커피': 'i-cup', '식비': 'i-food', '장보기': 'i-cart', '교통': 'i-car', '전자제품': 'i-bolt', '생활용품': 'i-box',
    '쇼핑': 'i-bag', '통신/구독': 'i-phone', '주거': 'i-house', '의료': 'i-cross', '여가': 'i-ticket', '교육': 'i-ledger', '선물/경조사': 'i-gift', '수입': 'i-coins', '기타': 'i-dollar' };
  const icon = (id) => `<svg class="i"><use href="#${id}"/></svg>`;
  const emptyHTML = (msg, id = 'i-wallet') => `<div class="empty">${icon(id)}<div>${msg}</div></div>`;
  function rowHTML(r, showDate) {
    const d = new Date(r.ts);
    const meta = (showDate ? fmtDate(d) + ' ' : '') + fmtTime(d) + ' · ' + esc(T(r.category));
    return `<div class="row" data-id="${r.id}"><span class="cat ${r.type}">${icon(r.type === 'in' ? 'i-coins' : (CAT_ICON[r.category] || 'i-dollar'))}</span>
      <div class="main"><div class="desc">${P.describeHTML(r)}</div><div class="meta">${meta}</div></div>
      <div class="amt num ${r.type}">${r.type === 'in' ? '+' : '-'}${money(r.amount)}</div></div>`;
  }

  // ---------- 확인 창 (confirm 대신) ----------
  function askConfirm(msg, okLabel = T('확인')) {
    return new Promise((done) => {
      $('cfMsg').textContent = msg; $('cfOk').textContent = okLabel;
      $('confirmBox').hidden = false;
      const close = (v) => { $('confirmBox').hidden = true; $('cfOk').onclick = $('cfNo').onclick = null; done(v); };
      $('cfOk').onclick = () => close(true); $('cfNo').onclick = () => close(false);
    });
  }

  // ---------- 탭 ----------
  let page = 'home';
  function go(p) {
    page = p;
    document.querySelectorAll('section[data-page]').forEach((s) => s.classList.toggle('on', s.dataset.page === p));
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.go === p));
    render();
    window.scrollTo(0, 0);
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.go); });

  // ---------- 홈 ----------
  // 기본은 '전체'(지금까지 모든 입금·지출), 마지막에 고른 탭을 기억
  const KEY_PERIOD = 'vb.homePeriod';
  let homePeriod = 'all';
  try { const v = localStorage.getItem(KEY_PERIOD); if (['all', 'day', 'week', 'month'].includes(v)) homePeriod = v; } catch (e) {}
  const PERIOD_WORD = { all: '전체', day: '오늘', week: '이번 주', month: '이번 달' };
  function syncPeriodSeg() {
    $('periodSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.p === homePeriod));
    const w = PERIOD_WORD[homePeriod];
    $('pInL').textContent = w + ' 입금'; $('pOutL').textContent = w + ' 지출'; $('pNetL').textContent = homePeriod === 'all' ? '남은 금액' : w + ' 남은 금액';
  }
  $('periodSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    homePeriod = b.dataset.p;
    try { localStorage.setItem(KEY_PERIOD, homePeriod); } catch (e2) {}
    renderHome();
  });
  function renderHome() {
    const bal = balance();
    $('balance').textContent = money(bal);
    $('balance').classList.toggle('neg', bal < 0);
    syncPeriodSeg();
    const t = totals(...range(homePeriod === 'all' ? 'all' : homePeriod));
    const short = moneyShort;
    $('pIn').textContent = short(t.inn); $('pOut').textContent = short(t.out); $('pNet').textContent = short(t.net);
    const rec = records.slice(-6).reverse();
    $('recent').innerHTML = rec.length ? rec.map((r) => rowHTML(r, true)).join('') : emptyHTML(T('아직 기록이 없어요.<br>지출 버튼을 누르고 말해보세요.'));
    renderPayday();
    renderHomeBudget();
  }

  // ---------- 급여일 (격주·매주는 첫 지급일부터 14·7일마다, 매달은 N일 / 말일, 입금 가능 시각 이후 입력) ----------
  function paydayAt(d) { const [h, m] = settings.payTime.split(':').map(Number); const x = sod(d); x.setHours(h, m, 0, 0); return x; }
  function monthPayday(y, mo) {   // mo: 0~11, payDay 0 = 말일, 그 달에 없는 날(31일 등)은 말일로
    const last = new Date(y, mo + 1, 0).getDate();
    const d = settings.payDay > 0 ? Math.min(settings.payDay, last) : last;
    return paydayAt(new Date(y, mo, d));
  }
  /** now 기준: 가장 최근 지급일(이미 지난)과 다음 지급일 */
  function payInfo(now = new Date()) {
    const cyc = settings.payCycle;
    if (cyc === 'none') return { last: null, next: null, todayBefore: false };
    if (cyc === 'monthly') {
      let cand = monthPayday(now.getFullYear(), now.getMonth()), todayBefore = false;
      if (now < cand) { todayBefore = dkey(cand) === dkey(now); cand = monthPayday(now.getFullYear(), now.getMonth() - 1); }
      const next = monthPayday(cand.getFullYear(), cand.getMonth() + 1);
      return { last: cand, next, todayBefore };
    }
    const step = cyc === 'weekly' ? 7 : 14;
    const [y, mo, da] = settings.firstPay.split('-').map(Number);
    const first = paydayAt(new Date(y, mo - 1, da));
    const days = Math.floor((sod(now) - sod(first)) / 864e5);
    if (days < 0) return { last: null, next: first, todayBefore: false };
    let n = Math.floor(days / step);
    let cand = paydayAt(addDays(sod(first), n * step));
    let todayBefore = false;
    if (now < cand) { todayBefore = dkey(cand) === dkey(now); n--; cand = n >= 0 ? paydayAt(addDays(sod(first), n * step)) : null; }
    const next = paydayAt(addDays(sod(first), (n + 1) * step));
    return { last: cand, next, todayBefore };
  }
  const cycleText = () => ({ biweekly: '2주마다', weekly: '매주', monthly: settings.payDay > 0 ? `매달 ${settings.payDay}일` : '매달 말일', none: '' })[settings.payCycle];
  // 급여를 이미 넣었는지: 배너로 넣은 기록, 또는 지급일~3일 뒤 사이에 말로 넣은 수입 기록
  const wagePaid = (day) => { const s0 = +sod(day), e0 = +addDays(sod(day), 4); return records.some((r) => r.payday === dkey(day) || (r.type === 'in' && r.ts >= s0 && r.ts < e0)); };
  // 앱을 처음 쓰기 전의 지급일은 묻지 않기
  const payDue = (info) => !!(info.last && !wagePaid(info.last) && !(settings.since && dkey(info.last) < settings.since));
  function renderPayday() {
    const info = payInfo(); const box = $('paydayBanner');
    let html = '';
    if (payDue(info)) {
      html = `<div class="banner"><span class="ic">${icon('i-coins')}</span><div class="t"><b>${T('{name} 입금일', { name: payName() })}</b>${T('{date} ' + payItem() + '을 입력하세요', { date: `${info.last.getMonth() + 1}.${info.last.getDate()} (${DOWx(info.last.getDay())})` })}</div>
        <button id="payBtn">${T('입금 입력')}</button></div>`;
    } else if (info.todayBefore) {
      html = `<div class="banner"><span class="ic">${icon('i-coins')}</span><div class="t"><b>${T('오늘은 {name} 입금일', { name: payName() })}</b>${T('{time} 이후에 입력할 수 있어요', { time: fmtTime(info.next) })}</div>
        <button disabled>${T('대기 중')}</button></div>`;
    }
    box.innerHTML = html;
    const b = $('payBtn');
    if (b) b.onclick = () => openEntry('in', { merchant: payName(), item: payItem(), category: '수입', when: new Date(), payday: dkey(info.last) });
  }

  // ---------- 기록 ----------
  let viewMonth = som(new Date());
  $('mPrev').onclick = () => { catFilter = null; viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderHistory(); };
  $('mNext').onclick = () => { catFilter = null; viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderHistory(); };
  function monthRecords(m) { const s = som(m), e = new Date(s.getFullYear(), s.getMonth() + 1, 1); return records.filter((r) => r.ts >= +s && r.ts < +e); }
  function renderHistory() {
    $('mLabel').textContent = T('{y}년 {m}월', { y: viewMonth.getFullYear(), m: viewMonth.getMonth() + 1, });
    const list = monthRecords(viewMonth);
    const t = totals(som(viewMonth), new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));
    const short = moneyShort;
    $('mIn').textContent = short(t.inn); $('mOut').textContent = short(t.out); $('mNet').textContent = short(t.net);
    renderCharts(list);
    if (!list.length) { $('historyList').innerHTML = emptyHTML(T('이 달에는 기록이 없어요.'), 'i-ledger'); return; }
    const shown = catFilter ? list.filter((r) => (r.category || '기타') === catFilter) : list;
    document.querySelectorAll('#catChart .cbar').forEach((b) => b.classList.toggle('sel', b.dataset.cat === catFilter));
    $('catTip').innerHTML = catFilter ? `<b>${esc(catFilter)}</b> 기록만 보여주는 중 · 막대를 다시 누르면 전체` : '막대를 누르면 그 카테고리 기록만 볼 수 있어요';
    if (!shown.length) { $('historyList').innerHTML = emptyHTML(`이 달 ${esc(catFilter)} 기록이 없어요.`, 'i-ledger'); return; }
    const groups = new Map();
    for (const r of shown.slice().reverse()) { const k = dkey(new Date(r.ts)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    let html = '';
    for (const [k, rs] of groups) {
      const out = rs.filter((r) => r.type === 'out').reduce((s, r) => s + r.amount, 0);
      html += `<div class="dayhead"><span>${fmtDate(new Date(rs[0].ts))}</span><span class="num">${T('지출 {amt}', { amt: money(out) })}</span></div>` + rs.map((r) => rowHTML(r, false)).join('');
    }
    $('historyList').innerHTML = html;
  }
  // ---------- 차트: 카테고리별(지난달 비교) + 최근 6개월 ----------
  const catSums = (list) => { const m = {}; for (const r of list) if (r.type === 'out') m[r.category || '기타'] = (m[r.category || '기타'] || 0) + r.amount; return m; };
  function renderCharts(list) {
    const cur = catSums(list), prev = catSums(monthRecords(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1)));
    const curTotal = Object.values(cur).reduce((a, b) => a + b, 0), prevTotal = Object.values(prev).reduce((a, b) => a + b, 0);
    const cats = Object.keys(cur).sort((a, b) => cur[b] - cur[a]);
    const max = Math.max(1, ...cats.map((c) => Math.max(cur[c], prev[c] || 0)));
    $('chartTotal').textContent = curTotal ? `지출 ${money(curTotal)}` + (prevTotal ? ` · 지난달 ${money(prevTotal)}` : '') : '';
    $('catTip').textContent = '';
    $('catChart').innerHTML = cats.length ? cats.map((c) => {
      const p = prev[c] || 0, diff = p ? Math.round((cur[c] - p) / p * 100) : null;
      const cmp = p ? (diff === 0 ? '지난달과 같음' : `지난달보다 ${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}%`) : '지난달 없음';
      return `<button class="cbar" data-cat="${esc(c)}" aria-label="${esc(c)} ${money(cur[c])}, ${cmp}">
        <span class="lb">${esc(c)}</span>
        <span class="tr"><i style="width:${(cur[c] / max * 100).toFixed(1)}%"></i>${p ? `<u style="left:calc(${(p / max * 100).toFixed(1)}% - 1px)"></u>` : ''}</span>
        <span class="v num">${money(cur[c])}<small>${cmp}</small></span></button>`;
    }).join('') : emptyHTML('이 달 지출이 없어요.', 'i-ledger');
    // 최근 6개월 (보고 있는 달까지)
    const months = []; for (let i = 5; i >= 0; i--) months.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - i, 1));
    const vals = months.map((m) => monthRecords(m).filter((r) => r.type === 'out').reduce((s, r) => s + r.amount, 0));
    const tmax = Math.max(1, ...vals);
    const k = moneyTick;
    $('trendChart').innerHTML = months.map((m, i) => `<button data-m="${i}" class="${i === 5 ? 'cur' : ''}" aria-label="${m.getMonth() + 1}월 지출 ${money(vals[i])}">
      <span class="tv num">${vals[i] ? k(vals[i]) : ''}</span><span class="col" style="height:${(vals[i] / tmax * 78).toFixed(1)}%"></span><span class="m">${m.getMonth() + 1}월</span></button>`).join('');
    const avg = vals.slice(0, 5).filter(Boolean);
    $('trendTip').innerHTML = avg.length ? `이전 ${avg.length}개월 평균 <b class="num">${money(avg.reduce((a, b) => a + b, 0) / avg.length)}</b> · 막대를 누르면 그 달로 이동` : '막대를 누르면 그 달로 이동해요';
    $('trendChart').onclick = (e) => { const b = e.target.closest('button[data-m]'); if (!b) return; viewMonth = months[Number(b.dataset.m)]; renderHistory(); };
  }
  // 카테고리 막대를 누르면 그 카테고리 기록만 보기 (다시 누르면 전체)
  let catFilter = null;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#catChart .cbar'); if (!b) return;
    catFilter = catFilter === b.dataset.cat ? null : b.dataset.cat;
    renderHistory();
  });
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.row[data-id]');
    if (row && !e.target.closest('.sheet')) { const r = records.find((x) => x.id === row.dataset.id); if (r) openEntry(r.type, null, r); }
  });

  // ---------- 음성 인식 ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  function listen(btn, input, onDone) {
    if (rec) { rec.stop(); return; }
    if (!SR || IS_PREVIEW) { input.focus(); toast('키보드의 🎤 버튼을 눌러 말해주세요'); return; }
    rec = new SR(); rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 5;
    btn.classList.add('listening');
    let finalText = '';
    rec.onresult = (ev) => {
      let txt = '';
      for (const res of ev.results) {
        // 여러 후보 중 금액·아는 단어가 가장 많이 들어간 문장을 고름
        let best = res[0].transcript, bs = -99;
        if (res.isFinal && res.length > 1) for (let i = 0; i < res.length; i++) { const sc = P.scoreText(res[i].transcript); if (sc > bs) { bs = sc; best = res[i].transcript; } }
        txt += best;
      }
      input.value = txt; finalText = txt; input.dispatchEvent(new Event('input'));
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast(T('마이크 권한이 필요해요. 키보드의 🎤를 써도 됩니다'));
      else if (ev.error !== 'no-speech' && ev.error !== 'aborted') toast(T('음성 인식 오류: {e}', { e: ev.error }));
    };
    rec.onend = () => { btn.classList.remove('listening'); rec = null; if (finalText && onDone) onDone(finalText); };
    try { rec.start(); } catch (e) { btn.classList.remove('listening'); rec = null; input.focus(); }
  }

  // ---------- 질문 예시 ----------
  const CHIPS = ['이번달 커피 지출은 총 얼마야?', '내가 언제 베스트바이에서 배터리를 얼마에 샀지?', '이번주 지출 총 얼마야?', '오늘 식비 얼마 썼어?',
    '이번달 주거 지출은 총 얼마야?', '스타벅스 이번달 몇 번 갔어?', '이번달 어디에 제일 많이 썼어?', '오늘 가장 큰 지출은 뭐야?', '남은 금액 얼마야?', '이번달 예산 얼마 남았어?', '지난주 토요일 얼마 썼어?'];
  function setupStatic() {
    $('askChips').innerHTML = CHIPS.map((c) => `<button>${esc(c)}</button>`).join('');
    $('fCategory').innerHTML = CATS.map((c) => `<option value="${c}">${esc(c)}</option>`).join('');
    $('verLine').textContent = '오늘 얼마 썼어? v0.9.3' + (IS_PREVIEW ? ' · 미리보기 (기록은 이 화면에만 저장)' : '');
    $('sCurrency').innerHTML = Object.entries(CURRENCIES).map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join('');
    applyCurrencyUI();
  }
  function applyCurrencyUI() {
    $('ncCur').textContent = settings.currency;
    $('ncEmblem').setAttribute('href', isWon() ? '#i-won' : '#i-dollar');
    $('fAmountL').textContent = isWon() ? '금액 (원)' : '금액 ($)';
    $('fAmount').placeholder = isWon() ? '0' : '0.00';
    $('fAmount').inputMode = isWon() ? 'numeric' : 'decimal';
    document.querySelectorAll('#budgetFields input').forEach((i) => { i.inputMode = isWon() ? 'numeric' : 'decimal'; });
  }
  // 통화 바꾸기: 기록은 지우지 않고, 고른 통화로 저장한 기록만 보여줌. 예산도 통화마다 따로
  function switchCurrency(c) {
    if (!CURRENCIES[c] || c === settings.currency) return;
    saveRecords();
    settings.budgetsByCur = settings.budgetsByCur || {};
    settings.budgetsByCur[settings.currency] = settings.budgets;
    settings.currency = c;
    settings.budgets = settings.budgetsByCur[c] || {};
    save(KEY_SET, settings);
    P.setCurrency(c);
    records = allRecords.filter((r) => r.cur === c);
    applyCurrencyUI(); render(); renderSettings();
    const other = allRecords.length - records.length;
    toast(`${CURRENCIES[c]}로 바꿨어요` + (other ? ` · 다른 통화 기록 ${other}건은 그대로 보관돼요` : ''), 3600);
  }

  // ---------- 입력 시트 ----------
  let entry = null; // {type, editing, payday}
  function openEntry(type, preset, existing) {
    entry = { extra: existing ? { to: existing.to, forWho: existing.forWho, dest: existing.dest, verb: existing.verb } : null, type, editing: existing || null, payday: preset?.payday || existing?.payday || null, multi: null,
              lang: 'ko' };
    $('detailFields').hidden = false;
    $('sheetTitle').textContent = T(existing ? '기록 수정' : (type === 'in' ? '입금 입력' : '지출 입력'));
    $('entryMic').className = type;
    $('entryText').placeholder = isWon()
      ? (type === 'in' ? `예) ${payName()} 3,456,400원` : '예) 이마트에서 장보기 45,670원')
      : (type === 'in' ? `예) ${payName()} 1850불 25` : '예) 철수랑 코리아하우스에서 저녁 45불');
    const src = existing || preset || {};
    $('entryText').value = existing ? (existing.memo || '') : '';
    growText();
    $('fAmount').value = src.amount ?? '';
    $('fMerchant').value = src.merchant || '';
    $('fItem').value = src.item || '';
    $('fWith').value = (src.with || []).join(', ');
    $('fMeal').value = src.meal || '';
    $('fCategory').value = src.category || (type === 'in' ? '수입' : '기타');
    $('fWhen').value = toLocalInput(existing ? new Date(existing.ts) : (src.when || new Date()));
    $('btnDelete').hidden = !existing;
    entry.descDirty = false;
    $('fDesc').value = existing ? P.describe(existing) : '';
    $('fDescAll').checked = true;
    updatePreview();
    $('scrim').classList.add('on'); $('sheet').classList.add('on');
    if (!existing && !preset) { if (IS_PREVIEW) $('entryText').focus(); else setTimeout(() => listen($('entryMic'), $('entryText')), 250); }
  }
  function closeEntry() { if (rec) rec.abort(); $('scrim').classList.remove('on'); $('sheet').classList.remove('on'); entry = null; }
  $('scrim').onclick = closeEntry; $('btnCancel').onclick = closeEntry;
  $('entryMic').onclick = () => listen($('entryMic'), $('entryText'));

  function currentForm() {
    return {
      type: entry.type,
      amount: parseAmt($('fAmount').value),
      merchant: $('fMerchant').value.trim(),
      item: $('fItem').value.trim(),
      with: $('fWith').value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      meal: $('fMeal').value,
      category: $('fCategory').value,
      lang: entry.lang,
      ...(entry.extra || {}),
    };
  }
  function growText() { const t = $('entryText'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }
  function catIcon(r) { return icon(r.type === 'in' ? 'i-coins' : (CAT_ICON[r.category] || 'i-dollar')); }
  function updatePreview() {
    if (!entry) return;
    const box = $('entryPreview');
    if (entry.multi) {
      const total = entry.multi.reduce((s, r) => s + (r.amount || 0), 0);
      box.className = 'receipt multi';
      box.innerHTML = entry.multi.map((r) => `<div class="mrow"><span class="cat ${r.type}">${catIcon(r)}</span>
        <div class="d">${P.describeHTML(r)}${r.date ? `<div class="when past">${icon('i-cal')}<span><b>${fmtDate(new Date(r.date + 'T12:00'))}</b></span></div>` : ''}${r.amount ? (r.amountGuess ? `<div class="amtnote">'${esc(r.amountGuess.heard)}' → ${money(r.amount)}로 읽었어요</div>` : r.amountOdd ? '<div class="amtnote">금액이 커 보여요. 확인해 주세요</div>' : '') : `<div class="missing">${T('금액을 못 알아들었어요')}</div>`}</div>
        <b class="num ${r.type}">${r.amount ? money(r.amount) : '$ —'}</b></div>`).join('') +
        `<div class="mtotal"><span>${T('{n}건 · 저장하면 따로따로 기록돼요', { n: entry.multi.length })}</span><b class="num">${money(total)}</b></div>`;
      return;
    }
    box.className = 'receipt';
    const f = currentForm();
    if (entry.descDirty && $('fDesc').value.trim()) f.desc = $('fDesc').value.trim();
    else if (!entry.descDirty && entry.editing?.desc && !entry.clearDesc) f.desc = entry.editing.desc;
    if (!entry.descDirty) $('fDesc').value = P.describe(f);
    const g = entry.amountNote;
    const wd = new Date($('fWhen').value);
    const pastNote = !isNaN(wd) && dkey(wd) !== dkey(new Date())
      ? `<div class="when past">${icon('i-cal')}<span><b>${fmtDate(wd)}</b> 날짜로 기록돼요</span></div>` : '';
    const note = g ? `<div class="amtnote">${g.odd ? '금액이 커 보여요. 맞는지 확인해 주세요' : `'${esc(g.heard)}'를 ${money(g.to)}로 읽었어요 · 아니면 금액 칸을 고쳐주세요`}</div>` : '';
    $('entryPreview').innerHTML = `<span class="cat ${f.type}">${icon(f.type === 'in' ? 'i-coins' : (CAT_ICON[f.category] || 'i-dollar'))}</span>
      <div class="d">${P.describeHTML(f)}${note}${pastNote}</div><b class="num ${f.type}">${isNaN(f.amount) ? '$ —' : money(f.amount)}</b>`;
  }
  $('entryText').addEventListener('input', () => {
    growText();
    const said = $('entryText').value;
    const segs = entry && !entry.editing && !entry.payday ? P.splitEntries(said) : [said];
    if (segs.length > 1) {
      let carry = null;   // "10월 31일 코스트코 150불 그다음 주유 60불" → 둘 다 10월 31일
      entry.multi = segs.map((sg) => {
        const r = P.parseEntry(sg); r.type = entry.type;
        if (r.date) carry = r.date; else if (r.dayOffset) carry = dkey(addDays(new Date(), r.dayOffset)); else if (carry) r.date = carry;
        if (entry.type === 'in') r.category = '수입'; else if (r.category === '수입') r.category = '기타';
        return r;
      });
      $('detailFields').hidden = true;
      updatePreview(); return;
    }
    if (entry?.multi) { entry.multi = null; $('detailFields').hidden = false; }
    const p = P.parseEntry(said);
    if (said.trim()) { entry.lang = p.lang; entry.extra = { to: p.to, forWho: p.forWho, dest: p.dest, verb: p.verb }; }
    if (p.amount != null) $('fAmount').value = fmtAmtInput(p.amount);
    entry.amountNote = p.amountGuess ? p.amountGuess : p.amountOdd ? { odd: true } : null;
    if (p.merchant || !entry?.payday) $('fMerchant').value = p.merchant || (entry?.payday ? payName() : '');
    $('fItem').value = p.item || (entry?.payday ? payItem() : '');
    $('fWith').value = p.with.join(', ');
    $('fMeal').value = p.meal;
    if (entry?.type === 'out') $('fCategory').value = p.category === '수입' ? '기타' : p.category;
    const when = new Date();
    if (p.date) { const [y, mo, d] = p.date.split('-').map(Number); when.setFullYear(y, mo - 1, d); }
    else if (p.dayOffset) when.setDate(when.getDate() + p.dayOffset);
    if (!entry?.editing) $('fWhen').value = toLocalInput(when);
    updatePreview();
  });
  $('fAmount').addEventListener('input', () => { if (entry) entry.amountNote = null; });
  ['fAmount', 'fMerchant', 'fItem', 'fWith', 'fMeal', 'fCategory', 'fWhen'].forEach((id) => $(id).addEventListener('input', updatePreview));
  // 기록 문장을 직접 고치면 미리보기에 바로 반영
  $('fDesc').addEventListener('input', () => { if (entry) { entry.descDirty = true; updatePreview(); } });
  $('fDescReset').onclick = () => { if (!entry) return; entry.descDirty = false; entry.clearDesc = true; updatePreview(); };
  $('entryText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

  $('btnSave').onclick = () => {
    const budBefore = budgetStatus();
    if (entry.multi) {
      const ok = entry.multi.filter((r) => r.amount > 0);
      if (ok.length < entry.multi.length) { toast(T('금액이 없는 항목이 있어요. 다시 말하거나 나눠서 입력해주세요')); return; }
      const now = Date.now();
      ok.forEach((r, i) => {
        const d = new Date(now + i);
        if (r.date) { const [y, mo, dd] = r.date.split('-').map(Number); d.setFullYear(y, mo - 1, dd); } else if (r.dayOffset) d.setDate(d.getDate() + r.dayOffset);
        records.push({ id: now.toString(36) + i + Math.random().toString(36).slice(2, 5), type: entry.type, amount: r.amount,
          merchant: r.merchant, item: r.item, with: r.with, meal: r.meal, category: r.category, lang: r.lang, to: r.to, forWho: r.forWho, dest: r.dest, verb: r.verb,
          ts: +d, memo: r.keywords.join(' ') });
      });
      saveRecords();
      toast(T('{n}건 저장: {amt} · 남은 금액 {bal}', { n: ok.length, amt: money(ok.reduce((s, r) => s + r.amount, 0)), bal: money(balance()) }));
      warnBudgets(budgetCrossings(budBefore));
      closeEntry(); render(); return;
    }
    const f = currentForm();
    if (!(f.amount > 0)) { toast(T('금액을 확인해주세요')); $('fAmount').focus(); return; }
    const ts = new Date($('fWhen').value).getTime() || Date.now();
    if (entry.payday) {
      const due = paydayAt(new Date(entry.payday + 'T00:00'));
      if (Date.now() < +due) { toast(T('{time} 이후에 입력할 수 있어요', { time: fmtTime(due) })); return; }
    }
    const said = $('entryText').value.trim();
    if (said) f.lang = P.parseEntry(said).lang;
    const parsedSaid = said ? P.parseEntry(said) : null;
    if (parsedSaid && !entry.editing) learnFrom(said, parsedSaid, f);
    const memo = parsedSaid ? parsedSaid.keywords.join(' ') : (entry.editing?.memo || '');
    // 내가 고친 기록 문장 배우기
    const typed = $('fDesc').value.trim();
    const shownBefore = P.describe(Object.assign({}, f, { desc: undefined }));
    let taught = false;
    if (entry.descDirty) {
      if (!typed || typed === P.describeAuto(f)) { f.desc = undefined; }
      else if (typed !== shownBefore || entry.editing?.desc) {
        const res = P.learnPhrase(f, typed, $('fDescAll').checked);
        if (res.wordFix) { learn.words[res.wordFix.from] = res.wordFix.to; Object.assign(f, res.fields); }
        Object.assign(learn.phrases, res.rules); saveLearn(); taught = true;
        f.desc = P.describe(Object.assign({}, f, { desc: undefined })) === typed ? undefined : typed;
      }
    } else if (entry.editing?.desc && !entry.clearDesc) f.desc = entry.editing.desc;
    if (entry.editing && f.desc === undefined) delete entry.editing.desc;
    const data = Object.assign(f, { ts, memo });
    if (entry.payday) data.payday = entry.payday;
    if (entry.editing) Object.assign(entry.editing, data);
    else records.push(Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }, data));
    saveRecords();
    toast(taught ? (($('fDescAll').checked) ? '저장했어요. 비슷한 기록도 이 표현으로 보여드릴게요' : '저장했어요. 이 표현을 기억할게요')
      : (dkey(new Date(ts)) !== dkey(new Date()) ? `${fmtDate(new Date(ts))} 날짜로 ` : '') + T('{t} 저장: {amt} · 남은 금액 {bal}', { t: T(entry.type === 'in' ? '입금' : '지출'), amt: money(f.amount), bal: money(balance()) }));
    warnBudgets(budgetCrossings(budBefore));
    closeEntry(); render();
  };
  $('btnDelete').onclick = async () => {
    if (!entry?.editing || !(await askConfirm(T('이 기록을 삭제할까요?'), T('삭제')))) return;
    records = records.filter((r) => r !== entry.editing); saveRecords(); closeEntry(); render(); toast(T('삭제했어요'));
  };
  $('btnOut').onclick = () => openEntry('out');
  $('btnIn').onclick = () => openEntry('in');

  // ---------- 질문 ----------
  const PERIOD_LABEL = { day: ['오늘', '어제', '그저께'], week: ['이번 주', '지난주'], month: ['이번 달', '지난달'], year: ['올해', '작년'] };
  function periodRange(p) {
    if (!p) return null;
    if (p.kind === 'lastdays') { const e = addDays(sod(new Date()), 1); return { r: [addDays(e, -p.n), e], label: `최근 ${p.n}일` }; }
    if (p.kind === 'weekend') {
      const ws = addDays(sow(new Date()), p.offset * 7), sat = addDays(ws, (6 - ws.getDay() + 7) % 7);
      return { r: [sat, addDays(sat, 2)], label: p.offset ? '지난 주말' : '이번 주말' };
    }
    if (p.kind === 'ymd') {
      const [y, mo, d] = p.date.split('-').map(Number), s = new Date(y, mo - 1, d);
      return { r: [s, addDays(s, 1)], label: `${mo}월 ${d}일 (${DOW_KO[s.getDay()]})` };
    }
    if (p.kind === 'date') {
      const now = new Date(); let y = now.getFullYear(); const d0 = new Date(y, p.month - 1, p.day); if (d0 > now) y--;
      const s = new Date(y, p.month - 1, p.day); return { r: [s, addDays(s, 1)], label: `${p.month}월 ${p.day}일` };
    }
    if (p.kind === 'monthOf') {
      const now = new Date(); let y = now.getFullYear(); if (p.month > now.getMonth() + 1 || p.lastYear) y--;
      const s = new Date(y, p.month - 1, 1); return { r: [s, new Date(y, p.month, 1)], label: `${y}년 ${p.month}월` };
    }
    return { r: range(p.kind, p.offset), label: PERIOD_LABEL[p.kind][-p.offset] || '' };
  }
  function answer(text) {
    text = String(text || '').trim(); if (!text) return;
    $('askInput').value = text;
    const q = P.parseQuery(text);
    const pr = periodRange(q.period);
    let list = records.filter((r) => (!q.type || r.type === q.type) && P.recordMatches(r, q.keywords));
    if (pr) list = list.filter((r) => r.ts >= +pr.r[0] && r.ts < +pr.r[1]);
    // 모든 단어가 맞는 기록이 없으면, 가장 많이 맞는 기록으로 찾기 (언제·어디 질문만)
    let partial = false;
    if (!list.length && q.intent === 'list' && q.keywords.length > 1) {
      let pool = records.filter((r) => !q.type || r.type === q.type);
      if (pr) pool = pool.filter((r) => r.ts >= +pr.r[0] && r.ts < +pr.r[1]);
      const best = Math.max(0, ...pool.map((r) => P.matchCount(r, q.keywords)));
      if (best > 0) { list = pool.filter((r) => P.matchCount(r, q.keywords) === best); partial = true; }
    }
    const kw = q.keywords.join(' ');
    const typeWord = (q.type === 'in' ? '입금' : q.type === 'out' ? '지출' : '기록');
    const fD = fmtDate, fT = fmtTime;
    let html = '';

    if (/예산/.test(text)) {
      const list = budgetStatus();
      $('answer').innerHTML = list.length ? `<div class="note">${new Date().getMonth() + 1}월 예산</div>` + list.map(budgetHTML).join('')
        : emptyHTML('아직 예산이 없어요.<br>설정 → 월 예산에서 한도를 적어주세요.', 'i-ask');
      return;
    }
    if (q.intent === 'count') {
      const where = kw ? `'${esc(kw)}'` : typeWord;
      html = `<div class="note">${pr ? esc(pr.label) + ' · ' : ''}${where} 횟수</div><div class="total num">${list.length}번</div>
        <div class="note">합계 ${money(list.reduce((s, r) => s + r.amount, 0))}</div>`;
      if (list.length) html += '<div style="margin-top:10px">' + list.slice().reverse().slice(0, 30).map((r) => rowHTML(r, true)).join('') + '</div>';
      $('answer').innerHTML = html; return;
    }
    if (q.intent === 'max' || q.intent === 'min') {
      const where = pr ? pr.label : '전체 기간';
      if (!list.length) {
        $('answer').innerHTML = emptyHTML(`${esc(where)} ${typeWord} 기록이 없어요.`, 'i-ask'); return;
      }
      const sorted = list.slice().sort((a, b) => q.intent === 'max' ? b.amount - a.amount : a.amount - b.amount);
      const best = sorted[0], d = new Date(best.ts);
      html = `<div class="note">${esc(where)} ${q.intent === 'max' ? '가장 큰' : '가장 작은'} ${typeWord}${kw ? ' · ' + esc(kw) : ''}</div>
        <div class="total num ${best.type}">${money(best.amount)}</div>
        <div style="font-size:17px;margin:2px 0 4px"><span class="sent">${P.describeHTML(best)}</span></div>
        <div class="note">${fD(d)} ${fT(d)} · ${esc(best.category || '기타')}</div>`;
      if (sorted.length > 1) html += `<div class="note" style="margin-top:12px">그다음 순서</div>` + sorted.slice(1, 4).map((r) => rowHTML(r, true)).join('');
      $('answer').innerHTML = html; return;
    }
    if (q.intent === 'top') {
      const by = (key) => { const m = new Map(); for (const r of list) { const k = key(r); if (k) m.set(k, (m.get(k) || 0) + r.amount); } return [...m].sort((a, b) => b[1] - a[1]).slice(0, 5); };
      const cats = by((r) => r.category || '기타'), places = by((r) => r.merchant);
      const total = list.reduce((s, r) => s + r.amount, 0);
      const bar = ([k, v]) => `<div class="row"><div class="main"><div class="desc"><b>${esc(k)}</b></div>
        <div class="meta">${total ? Math.round(v / total * 100) : 0}%</div></div><div class="amt num">${money(v)}</div></div>`;
      html = `<div class="note">${pr ? esc(pr.label) : '전체 기간'} · 지출 ${money(total)}</div>`;
      html += cats.length ? `<div class="note" style="margin-top:10px">카테고리별</div>${cats.map(bar).join('')}` : emptyHTML(`${esc(pr ? pr.label : '전체 기간')} 지출 기록이 없어요.`, 'i-ask');
      if (places.length) html += `<div class="note" style="margin-top:10px">장소별</div>${places.map(bar).join('')}`;
      $('answer').innerHTML = html; return;
    }
    if (q.intent === 'balance') {
      html = `<div class="note">${'현재 남은 금액'}</div><div class="total num">${money(balance())}</div>`;
      if (pr) { const t = totals(...pr.r); html += `<div class="note">${pr.label}: ${'입금'} ${money(t.inn)} · ${'지출'} ${money(t.out)} · ${'남은 금액'} ${money(t.net)}</div>`; }
    } else if (q.intent === 'sum') {
      const sum = list.reduce((s, r) => s + r.amount, 0);
      const oneDay = pr && (+pr.r[1] - +pr.r[0]) <= 864e5 + 36e5;
      const range = pr ? (oneDay ? `${pr.label}${/\(/.test(pr.label) ? '' : ` (${fD(pr.r[0])})`}` : `${pr.label} (${fD(pr.r[0])} ~ ${fD(addDays(pr.r[1], -1))})`) : '전체 기간';
      html = `<div class="note">${esc(range)}${kw ? ' · ' + esc(kw) : ''} ${typeWord + ' 합계'}</div>
        <div class="total num ${q.type || ''}">${money(sum)}</div><div class="note">${list.length}건</div>`;
      if (list.length) html += '<div style="margin-top:10px">' + list.slice().reverse().slice(0, 30).map((r) => rowHTML(r, true)).join('') + '</div>';
    } else {
      if (!list.length) {
        html = emptyHTML(`'${esc(kw || text)}' 기록을 찾지 못했어요.<br>가게 이름이나 물건 이름을 한 단어만 말해보세요.`, 'i-ask');
      } else {
        const latest = list[list.length - 1], d = new Date(latest.ts);
        html = `<div class="note">${'가장 최근 기록'}</div>
          <div style="font-size:18px;margin:4px 0"><b>${fD(d)} ${fT(d)}</b><br><span class="sent">${P.describeHTML(latest)}</span> — <b class="num">${money(latest.amount)}</b></div>`;
        if (list.length > 1) html += `<div class="note" style="margin-top:8px">전체 ${list.length}건 · 합계 ${money(list.reduce((s, r) => s + r.amount, 0))}</div>` +
          list.slice().reverse().slice(0, 30).map((r) => rowHTML(r, true)).join('');
      }
    }
    $('answer').innerHTML = html;
  }
  $('askMic').onclick = () => listen($('askMic'), $('askInput'), answer);
  $('askGo').onclick = () => {
    if (rec) rec.stop();
    const t = $('askInput').value.trim();
    if (!t) { toast(T('질문을 말하거나 입력해주세요')); $('askInput').focus(); return; }
    answer(t); $('askInput').blur();
  };
  $('askCancel').onclick = () => {
    if (rec) rec.abort();
    $('askInput').value = ''; $('askInput').blur();
    $('answer').innerHTML = emptyHTML(T('마이크를 누르고 물어보세요.'), 'i-ask');
  };
  $('askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); answer(e.target.value); e.target.blur(); } });
  $('askChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) answer(b.textContent); });

  // ---------- 엑셀 (월 단위) ----------
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = window.VB_XLSX_SRC || 'lib/xlsx.full.min.js'; s.onload = () => ok(window.XLSX); s.onerror = bad; document.head.appendChild(s); });
  }
  async function exportMonth(m) {
    const list = monthRecords(m);
    if (!list.length) { toast(T('이 달에는 기록이 없어요')); return; }
    let XLSX; try { XLSX = await loadXLSX(); } catch (e) { toast(T('엑셀 기능을 불러오지 못했어요')); return; }
    const y = m.getFullYear(), mo = m.getMonth() + 1;
    // 월초 잔액(이전 달까지 누적)부터 시작하는 누적 잔액
    let run = records.filter((r) => r.ts < +som(m)).reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
    const openBal = run;
    const rows = [['날짜', '요일', '시간', '구분', '내용', '장소', '아이템', '함께한 사람', '식사', '카테고리', '입금', '지출', '잔액', '키워드']];
    for (const r of list) {
      const d = new Date(r.ts);
      run += r.type === 'in' ? r.amount : -r.amount;
      rows.push([dkey(d), DOWx(d.getDay()), fmtTime(d), T(r.type === 'in' ? '입금' : '지출'), P.describe(r), r.merchant || '', r.item || '',
        (r.with || []).join(', '), r.meal ? T(r.meal) : '', T(r.category || '기타'), r.type === 'in' ? r.amount : null, r.type === 'out' ? r.amount : null, roundAmt(run), r.memo || '']);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [12, 5, 10, 6, 36, 16, 18, 16, 10, 10, 12, 12, 12, 40].map((w) => ({ wch: w }));
    const fmt = isWon() ? '#,##0"원"' : '"$"#,##0.00';
    for (let i = 1; i < rows.length; i++) for (const c of ['K', 'L', 'M']) { const cell = ws[c + (i + 1)]; if (cell) cell.z = fmt; }
    ws['!autofilter'] = { ref: `A1:N${rows.length}` };

    const t0 = totals(som(m), new Date(y, mo, 1));
    const r2 = roundAmt;
    const t = { inn: r2(t0.inn), out: r2(t0.out), net: r2(t0.net) };
    const byCat = {};
    for (const r of list) if (r.type === 'out') byCat[r.category] = (byCat[r.category] || 0) + r.amount;
    const sum = [[`${y}년 ${mo}월 가계부 요약`], [], ['월초 잔액', r2(openBal)], ['총 입금', t.inn], ['총 지출', t.out], ['이 달 남은 금액 (입금-지출)', t.net], ['월말 잔액', r2(openBal + t0.net)], [], ['카테고리별 지출', '금액', '비율']];
    Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([c, v]) => sum.push([T(c), r2(v), t.out ? v / t.out : 0]));
    const ws2 = XLSX.utils.aoa_to_sheet(sum);
    ws2['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 8 }];
    for (let i = 3; i <= sum.length; i++) { const b = ws2['B' + i]; if (b && typeof b.v === 'number') b.z = fmt; const c = ws2['C' + i]; if (c && typeof c.v === 'number') c.z = '0.0%'; }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws2, '요약');
    XLSX.utils.book_append_sheet(wb, ws, `${mo}월 기록`);
    const name = `가계부_${y}-${String(mo).padStart(2, '0')}.xlsx`;
    const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await shareOrDownload(blob, name);
  }
  async function shareOrDownload(blob, name) {
    if (IS_PREVIEW) {
      const dl = window.claude ? await window.claude.use('downloads') : null;
      if (!dl) { toast(T('이 화면에서는 파일 저장을 할 수 없어요')); return; }
      try { await dl.save({ filename: name, data: blob }); toast(T('저장했어요')); }
      catch (e) { if (e.code !== 'declined') toast(T('파일 저장 실패: {e}', { e: e.message || e.code })); }
      return;
    }
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  $('btnExcel').onclick = () => exportMonth(viewMonth);

  // ---------- 알림 (앱을 열 때 지난 요약을 알림으로) ----------
  const notified = load(KEY_NOTI, {});
  async function notify(title, body, tag) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return false;
      const reg = await navigator.serviceWorker?.ready;
      if (reg) await reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
      else new Notification(title, { body, tag });
      return true;
    } catch (e) { return false; }
  }
  const sumLine = (t) => T('입금 {a} · 지출 {b} · 남은 금액 {c}', { a: money(t.inn), b: money(t.out), c: money(t.net) });
  async function checkSummaries() {
    const now = new Date();
    const [h, m] = settings.notifyTime.split(':').map(Number);
    const cut = new Date(now); cut.setHours(h, m, 0, 0);
    const after = now >= cut;
    const jobs = [];
    // 일간: 알림 시각이 지났으면 오늘, 아니면 어제
    const day = after ? sod(now) : addDays(sod(now), -1);
    jobs.push(['d', dkey(day), T('{date} 일간 요약', { date: fmtDate(day) }), totals(day, addDays(day, 1))]);
    // 주간: 이번 주 마지막 날 알림 시각 이후면 이번 주, 아니면 지난주
    let ws = sow(now); if (!(dkey(addDays(ws, 6)) === dkey(now) && after)) ws = addDays(ws, -7);
    jobs.push(['w', dkey(ws), T('주간 요약 ({range})', { range: `${ws.getMonth() + 1}/${ws.getDate()}~${addDays(ws, 6).getMonth() + 1}/${addDays(ws, 6).getDate()}` }), totals(ws, addDays(ws, 7))]);
    // 월간
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const ms = (dkey(lastDay) === dkey(now) && after) ? som(now) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
    jobs.push(['m', dkey(ms), T('{y}년 {m}월 월간 요약', { y: ms.getFullYear(), m: ms.getMonth() + 1, }), totals(ms, new Date(ms.getFullYear(), ms.getMonth() + 1, 1))]);
    // 주급
    const pi = payInfo(now);
    if (payDue(pi)) jobs.push(['p', dkey(pi.last), T('{name} 입금일', { name: payName() }), null]);

    for (const [k, key, title, t] of jobs) {
      if (notified[k] === key) continue;
      if (k !== 'p' && records.length === 0) continue;
      const body = t ? sumLine(t) + '\n' + T('현재 남은 금액 {bal}', { bal: money(balance()) }) : T('앱에서 직장주급 입금을 입력해주세요.');
      if (await notify(title, body, 'vb-' + k)) { notified[k] = key; save(KEY_NOTI, notified); }
    }
  }
  function renderNotifyState() {
    const ok = 'Notification' in window;
    const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    let msg;
    if (IS_PREVIEW) msg = T('미리보기에서는 알림이 지원되지 않아요. 홈 화면 앱으로 설치하면 켤 수 있어요.');
    else if (!standalone) msg = T('Safari 공유 버튼 → "홈 화면에 추가" 후, 홈 화면 아이콘으로 열어야 알림을 켤 수 있어요.');
    else if (!ok) msg = T('이 기기에서는 알림을 지원하지 않아요 (iOS 16.4 이상 필요).');
    else if (Notification.permission === 'granted') msg = T('알림 켜짐. 앱을 열 때 지난 일간·주간·월간 요약과 주급일 알림이 와요.');
    else if (Notification.permission === 'denied') msg = T('알림이 꺼져 있어요. 아이폰 설정 → 알림 → 가계부에서 켜주세요.');
    else msg = T('버튼을 눌러 알림을 허용해주세요.');
    $('notifyNote').textContent = msg;
    $('btnNotify').hidden = IS_PREVIEW || !(ok && standalone && Notification.permission === 'default');
  }
  $('btnNotify').onclick = async () => {
    try { await Notification.requestPermission(); } catch (e) { }
    renderNotifyState();
    if (Notification.permission === 'granted') { await notify(T('오늘 얼마 썼어?'), T('알림이 켜졌어요.'), 'vb-hello'); checkSummaries(); }
  };

  // ---------- 설정 ----------
  function renderLearned() {
    const box = $('learnList'); if (!box) return;
    const seen = new Set(), phraseRows = [];
    for (const [k, r] of Object.entries(learn.phrases)) {
      const id = r.from + '\u0000' + r.to; if (seen.has(id)) continue; seen.add(id);
      const general = Object.values(learn.phrases).some((x) => x.general && x.from === r.from && x.to === r.to);
      phraseRows.push(['p', id, `<span class="note">${general ? '비슷한 기록 모두' : '이 내용만'}</span><br>'${esc(r.from)}'<br>→ <b>'${esc(r.to)}'</b>`]);
    }
    const rows = [...phraseRows, ...Object.entries(learn.words).map(([a, b]) => ['w', a, `'${esc(a)}' → '${esc(b)}'`]),
                  ...Object.entries(learn.cats).map(([a, c]) => ['c', a, `'${esc(a)}' → ${esc(c)} 카테고리`])];
    box.innerHTML = rows.length ? rows.map(([k, a, label]) => `<div class="row"><div class="main"><div class="desc">${label}</div></div>
      <button class="mini" data-k="${k}" data-a="${esc(a)}">삭제</button></div>`).join('')
      : '<div class="note" style="padding:12px 0">아직 배운 말이 없어요. 입력 화면에서 기록 문장이나 장소·아이템·카테고리를 고쳐서 저장하면 다음부터 자동으로 바로잡아요.</div>';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#learnList .mini'); if (!b) return;
    if (b.dataset.k === 'p') { const [fr, to] = b.dataset.a.split('\u0000'); for (const k in learn.phrases) if (learn.phrases[k].from === fr && learn.phrases[k].to === to) delete learn.phrases[k]; }
    else delete (b.dataset.k === 'w' ? learn.words : learn.cats)[b.dataset.a];
    saveLearn(); renderLearned(); render(); toast('삭제했어요');
  });
  function renderBudgetFields() {
    const box = $('budgetFields');
    if (box.contains(document.activeElement)) return; // 입력 중에는 다시 그리지 않음
    box.innerHTML = BUDGET_CATS.map((c) => `<label class="field"><span>${c === BUDGET_ALL ? '전체 지출' : esc(c)}</span>
      <input class="num" data-bcat="${esc(c)}" inputmode="decimal" placeholder="한도 없음" value="${settings.budgets[c] ? settings.budgets[c] : ''}"></label>`).join('');
  }
  $('budgetFields').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-bcat]'); if (!inp) return;
    const v = parseAmt(inp.value);
    if (v > 0) { settings.budgets[inp.dataset.bcat] = v; inp.value = v; } else { delete settings.budgets[inp.dataset.bcat]; inp.value = ''; }
    save(KEY_SET, settings); toast(v > 0 ? `${inp.dataset.bcat === BUDGET_ALL ? '전체' : inp.dataset.bcat} 예산 ${money(v)} 저장` : '예산을 지웠어요');
  });
  function renderSettings() {
    renderLearned();
    renderBudgetFields();
    $('sCurrency').value = settings.currency;
    $('sPayName').value = settings.payName; $('sPayCycle').value = settings.payCycle; $('sPayDay').value = String(settings.payDay);
    $('sFirstPay').value = settings.firstPay; $('sPayTime').value = settings.payTime;
    const cyc = settings.payCycle;
    $('payFirstF').hidden = !(cyc === 'biweekly' || cyc === 'weekly'); $('payDayF').hidden = cyc !== 'monthly'; $('payTimeF').hidden = cyc === 'none';
    $('sNotifyTime').value = settings.notifyTime; $('sWeekStart').value = String(settings.weekStart);
    const pi = payInfo();
    $('nextPay').textContent = pi.next ? `다음 ${payName()}: ${fmtDate(pi.next)} ${fmtTime(pi.next)} (${cycleText()})` : '급여 알림을 쓰지 않아요';
    renderNotifyState();
  }
  $('sCurrency').addEventListener('change', (e) => switchCurrency(e.target.value));
  [['sFirstPay', 'firstPay'], ['sPayTime', 'payTime'], ['sNotifyTime', 'notifyTime'], ['sWeekStart', 'weekStart'], ['sPayName', 'payName'], ['sPayCycle', 'payCycle'], ['sPayDay', 'payDay']].forEach(([id, k]) =>
    $(id).addEventListener('change', (e) => {
      const v = String(e.target.value).trim();
      if (!v) return;
      settings[k] = k === 'weekStart' || k === 'payDay' ? Number(v) : v;
      if (k === 'payName' || k === 'payCycle' || k === 'payDay') renderHome();
      save(KEY_SET, settings); renderSettings(); toast(T('저장했어요'));
    }));
  $('btnBackup').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'voice-budget', version: 2, exported: new Date().toISOString(), settings, learn, records: (saveRecords(), allRecords) }, null, 1)], { type: 'application/json' });
    shareOrDownload(blob, `가계부_백업_${dkey(new Date())}.json`);
  };
  $('btnRestore').onclick = () => $('restoreFile').click();
  $('restoreFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.records)) throw new Error();
      if (!(await askConfirm(T('백업의 기록 {n}건으로 바꿀까요? 지금 기록은 덮어써져요.', { n: data.records.length }), T('불러오기')))) { e.target.value = ''; return; }
      Object.assign(settings, data.settings || {}); delete settings.lang;
      if (!CURRENCIES[settings.currency]) settings.currency = 'CAD';
      if (!settings.budgets || typeof settings.budgets !== 'object') settings.budgets = {};
      allRecords = data.records.map((r) => (r.cur ? r : Object.assign(r, { cur: 'CAD' })));
      P.setCurrency(settings.currency);
      records = allRecords.filter((r) => r.cur === settings.currency); applyCurrencyUI();
      save(KEY_SET, settings); saveRecords();
      if (data.learn && typeof data.learn === 'object') { for (const k of ['words', 'cats', 'phrases']) learn[k] = data.learn[k] || {}; saveLearn(); }
      render(); toast(T('불러왔어요') + (data.learn ? ' (내가 가르친 말 포함)' : ''));
    } catch (err) { toast(T('백업 파일을 읽을 수 없어요')); }
    e.target.value = '';
  };
  $('btnWipe').onclick = async () => {
    if (!(await askConfirm(T('모든 기록을 삭제할까요? 되돌릴 수 없어요. 먼저 백업을 권장합니다.'), T('모두 삭제')))) return;
    allRecords = []; records = []; saveRecords(); render(); toast(T('모두 삭제했어요'));
  };

  // ---------- 시작 ----------
  function render() {
    if (page === 'home') renderHome();
    if (page === 'history') renderHistory();
    if (page === 'settings') renderSettings();
  }
  function tick() { const n = new Date(); $('clock').textContent = `${fmtDate(n)} ${fmtTime(n)}`; }
  tick(); setInterval(() => { tick(); if (page === 'home' && !entry) renderPayday(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); render(); checkSummaries(); } });
  if (!IS_PREVIEW && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  setupStatic(); render(); checkSummaries();

  // 테스트용으로 노출
  window.VB = { payInfo, range, totals, exportMonth, answer, get records() { return records; }, get allRecords() { return allRecords; }, switchCurrency };
})();

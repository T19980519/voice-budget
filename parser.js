/* 오늘 얼마 썼어? — 한국어 규칙 기반 파서 (무료, 서버 없음)
 * 1) parseEntry(text)  : "베스트바이에서 밧데리 12불99" → {amount, merchant, item, category, dayOffset}
 * 2) parseQuery(text)  : "이번달 커피 지출은 총 얼마야?" → {intent, period, type, keywords}
 * 3) normalizeKeyword  : 밧데리/배터리, 베스트바이/best buy 같은 표기 통일
 */
(function (root) {
  'use strict';

  // ---------- 숫자 ----------
  const KO_DIGIT = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9 };
  const KO_SMALL = { 십: 10, 백: 100, 천: 1000 };

  function parseKoNumber(tok) {
    tok = String(tok).replace(/,/g, '').trim();
    if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok);
    let total = 0, section = 0, num = 0, sawArabic = false, any = false;
    for (const ch of tok) {
      if (/\d/.test(ch)) { num = (sawArabic ? num * 10 : 0) + Number(ch); sawArabic = true; any = true; continue; }
      sawArabic = false;
      if (ch in KO_DIGIT) { num = KO_DIGIT[ch]; any = true; continue; }
      if (ch in KO_SMALL) { section += (num || 1) * KO_SMALL[ch]; num = 0; any = true; continue; }
      if (ch === '만') { section += num; total += (section || 1) * 10000; section = 0; num = 0; any = true; continue; }
      if (ch === '억') { section += num; total = (total + section || 1) * 100000000; section = 0; num = 0; any = true; continue; }
      return NaN;
    }
    return any ? total + section + num : NaN;
  }

  const NUM = '(\\d[\\d,]*(?:\\.\\d+)?|[0-9영공일이삼사오육륙칠팔구십백천만]+)';
  const DOLLAR = '(?:불|뿔|달러|달라|딸라|딸러|달란|dollars?|bucks?|벅스)';
  const CENT = '(?:센트|센츠|쎈트|셴트|센트요|cents?)';
  // 센트 자리 숫자 뒤에 이런 단위가 오면 개수/시간이므로 센트가 아님
  const NOT_CENT_AFTER = /^\s*(개|병|잔|캔|팩|박스|봉|장|권|시|분|일|월|번|명|인분|모|판|마리|송이|켤레|그릇|접시|벌|통|줄|단|포기|알|kg|g|lb|리터|L)/i;

  function round2(n) { return Math.round(n * 100) / 100; }

  /** 텍스트에서 금액을 찾아 {amount, start, end} 반환 */
  // ---------- 통화 ----------
  // 'CAD' | 'USD' : 불·달러·센트 / 'KRW' : 원 (45,670원, 사만오천육백칠십 원, 4만 5천 원, 1.5만원, 3억)
  let CURRENCY = 'CAD';
  function setCurrency(c) { CURRENCY = ['KRW', 'USD', 'CAD'].includes(c) ? c : 'CAD'; }
  const WON_NUM = '[\\d,.일이삼사오육륙칠팔구십백천만억]+';
  /** "1.5만", "4만5,670", "삼백사십오만육천사백" → 숫자 */
  function parseWon(tok) {
    const t = String(tok).replace(/,/g, '');
    const m = /^(\d+\.\d+)(억|만|천)(.*)$/.exec(t);
    if (m) { const U = { 억: 1e8, 만: 1e4, 천: 1e3 }[m[2]]; const rest = m[3] ? parseWon(m[3]) : 0; return isNaN(rest) ? NaN : Number(m[1]) * U + rest; }
    if (/\./.test(t)) return /^\d+\.\d+$/.test(t) ? Number(t) : NaN;
    return parseKoNumber(t);
  }
  /** 원 앞의 숫자로 볼 만한지: 아라비아 숫자, 두 글자 이상, 또는 십·백·천·만·억 ("사원"·"오원"은 금액이 아님) */
  const okWonNum = (n) => /\d/.test(n) || String(n).replace(/,/g, '').length >= 2 || /[십백천만억]/.test(n);
  function findWon(text) {
    let m;
    if ((m = /[₩￦]\s*(\d[\d,]*)/.exec(text))) return { amount: parseWon(m[1]), start: m.index, end: m.index + m[0].length };
    // 숫자 + 원 : 여러 개면 가장 큰 금액 ("사원 식당 8000원"에서 '사 원'을 4원으로 보지 않게)
    const re = new RegExp('(^|[^가-힣\\d])(' + WON_NUM + ')\\s*(원|won)(?:짜리|어치|정도|이요|이야|입니다|이에요|요)?', 'gi');
    let best = null;
    while ((m = re.exec(text))) {
      if (!okWonNum(m[2])) continue;
      const v = parseWon(m[2]);
      if (isNaN(v) || v <= 0) continue;
      const st = m.index + m[1].length;
      if (!best || v > best.amount) best = { amount: v, start: st, end: m.index + m[0].length };
    }
    if (best) return best;
    // 단위 없이 "4만5천", "삼만 오천" 처럼 자릿말이 들어간 금액
    re.lastIndex = 0;
    const re2 = new RegExp('(^|\\s)(' + WON_NUM + ')(?=\\s|$|[,.!?])', 'g');
    while ((m = re2.exec(text))) {
      if (!/[천만억]/.test(m[2]) || m[2].length < 2) continue;
      const v = parseWon(m[2]);
      if (!isNaN(v) && v >= 1000 && (!best || v > best.amount)) best = { amount: v, start: m.index + m[1].length, end: m.index + m[0].length };
    }
    if (best) return best;
    // 마지막: 단위 없는 숫자 (개수·시간 단위가 붙은 건 제외)
    const reN = /(\d[\d,]*)(?!\d)/g; let last = null;
    while ((m = reN.exec(text))) if (!NOT_CENT_AFTER.test(text.slice(m.index + m[0].length))) last = m;
    if (last) return { amount: parseKoNumber(last[1]), start: last.index, end: last.index + last[0].length, bare: true };
    return null;
  }

  function findAmount(text) {
    if (CURRENCY === 'KRW') { const w = findWon(text); if (w) w.amount = Math.round(w.amount); return w; }
    let m;
    // $1.99 / $ 12
    m = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/.exec(text);
    if (m) return { amount: round2(parseKoNumber(m[1])), start: m.index, end: m.index + m[0].length };

    // 1불99 / 1불 99센트 / 십이달러 오십 / 12.99불
    const reD = new RegExp(NUM + '\\s*' + DOLLAR + '(?:\\s*' + NUM + '\\s*(' + CENT + ')?)?', 'gi');
    while ((m = reD.exec(text))) {
      const a = parseKoNumber(m[1]);
      if (isNaN(a)) continue;
      let amount = a, end = m.index + m[0].length;
      if (m[2] !== undefined) {
        const b = parseKoNumber(m[2]);
        const after = text.slice(m.index + m[0].length);
        if (!isNaN(b) && b < 100 && (m[3] || !NOT_CENT_AFTER.test(after))) {
          amount = a + b / 100;
        } else {
          // 센트가 아니면 두번째 숫자는 금액에 포함하지 않음
          const dm = new RegExp(DOLLAR, 'i').exec(m[0]);
          end = m.index + dm.index + dm[0].length;
        }
      }
      return { amount: round2(amount), start: m.index, end };
    }

    // 99센트
    m = new RegExp(NUM + '\\s*' + CENT, 'i').exec(text);
    if (m) {
      const c = parseKoNumber(m[1]);
      if (!isNaN(c)) return { amount: round2(c / 100), start: m.index, end: m.index + m[0].length };
    }

    // 12.99 (소수점 숫자)
    m = /(\d[\d,]*\.\d{1,2})(?!\d)/.exec(text);
    if (m) return { amount: round2(parseKoNumber(m[1])), start: m.index, end: m.index + m[0].length };

    // "4 95" 처럼 단위 없이 띄어 말한 달러·센트
    m = /(?:^|\s)(\d{1,4})\s+(\d{2})(?=\s|$|[.,!?])/.exec(text);
    if (m && !NOT_CENT_AFTER.test(text.slice(m.index + m[0].length))) {
      const st = m.index + m[0].indexOf(m[1]);
      return { amount: round2(Number(m[1]) + Number(m[2]) / 100), start: st, end: m.index + m[0].length, bare: true };
    }
    // 마지막 수단: 단위 없는 숫자 (개수/시간 단위가 붙은 건 제외)
    const reN = /(\d[\d,]*)(?!\d)/g; let last = null;
    while ((m = reN.exec(text))) {
      if (!NOT_CENT_AFTER.test(text.slice(m.index + m[0].length))) last = m;
    }
    if (last) return { amount: round2(parseKoNumber(last[1])), start: last.index, end: last.index + last[0].length, bare: true, digits: last[1].replace(/,/g, '') };
    return null;
  }

  // ---------- 단위 없이 말한 금액이 말이 되는지 ----------
  // 받아쓰기가 소수점을 빼먹는 경우가 많음: "4.95" → "495". 커피 한 잔에 $495는 말이 안 되므로 $4.95로 봄
  const PRICE_MAX = { 커피: 30, 식비: 400, 장보기: 900, 교통: 250, 생활용품: 400, 쇼핑: 1500, 전자제품: 4000, 여가: 500, 의료: 800,
    '통신/구독': 400, 교육: 3000, '선물/경조사': 2000, 기타: 0, 주거: 0, 수입: 0 };
  const ITEM_MAX = [[/커피|라떼|아메리카노|카푸치노|에스프레소|티$|차$|도넛|머핀|베이글|음료|주스|스무디|물$|껌|과자|아이스크림/, 30],
    [/김밥|라면|햄버거|버거|샌드위치|피자|치킨|도시락|국밥|짜장|짬뽕|우동|맥도날드|서브웨이/, 120], [/주차|파킹|우버|택시|버스|TTC|프레스토/, 150]];
  function priceMaxFor(rec) {
    const txt = [rec.merchant, rec.item, rec.meal].join(' ');
    let max = PRICE_MAX[rec.category] ?? 0;
    for (const [re, mx] of ITEM_MAX) if (re.test(txt)) { max = max ? Math.min(max, mx) : mx; }
    return max;
  }
  function plausibleAmount(a, rec, history) {
    if (CURRENCY === 'KRW') return a ? a.amount : null;
    if (!a || !a.bare || !a.digits || a.digits.length < 3 || /^0/.test(a.digits)) return a ? a.amount : null;
    const n = Number(a.digits), cents = round2(n / 100);
    const max = priceMaxFor(rec);
    // 같은 곳·같은 물건의 예전 금액이 있으면 그걸 기준으로
    if (history && history.length) {
      const sorted = history.slice().sort((x, y) => x - y), med = sorted[Math.floor(sorted.length / 2)];
      if (Math.abs(Math.log(cents / med)) < Math.abs(Math.log(n / med))) return cents;
      return n;
    }
    return max && n > max && cents <= max ? cents : n;
  }
  let PRICE_HISTORY = null; // app이 넣어줌: (rec) => [예전 금액들]
  function setPriceHistory(fn) { PRICE_HISTORY = fn; }

  // ---------- 표기 통일 (동의어) ----------
  const SYNONYMS = [
    ['배달의민족', '배민', '배달의 민족'], ['쿠팡이츠', '쿠팡 이츠'], ['씨유', 'cu'], ['지에스25', 'gs25', '지에스 25', 'gs 25'], ['이마트24', '이마트 24', 'emart24'],
    ['투썸플레이스', '투썸', 'twosome'], ['컴포즈커피', '컴포즈'], ['메가커피', '메가 커피', '메가엠지씨커피', '메가MGC커피'], ['케이티엑스', 'ktx'], ['에스알티', 'srt'],
    ['에스케이티', 'skt', '에스케이 텔레콤'], ['케이티', 'kt'], ['엘지유플러스', '유플러스', 'lg유플러스', 'lgu+', 'u+'], ['마켓컬리', '컬리', 'kurly'], ['이마트', 'emart', 'e마트'],
    ['에쓰오일', 's-oil', '에스오일'], ['지에스칼텍스', 'gs칼텍스'], ['교통카드', '교통 카드'], ['티머니', 't-money', 'tmoney'],
    ['슬리퍼', '쓰레빠', '쓰리빠', '슬리빠', '쓰레파', 'slippers'],
    ['배터리', '건전지', '배터리들', '밧데리', '바테리', '빳데리', '빠떼리', '밧떼리', 'battery', 'batteries'],
    ['베스트바이', '베스트 바이', '베스트봐이', 'bestbuy', 'best buy'],
    ['코스트코', 'costco'],
    ['팀홀튼', '팀 홀튼', '팀호튼', '팀홀턴', '팀스', 'tim hortons', 'tims'],
    ['스타벅스', '스벅', 'starbucks'],
    ['월마트', 'walmart'],
    ['아마존', 'amazon'],
    ['맥도날드', '맥날', 'mcdonalds', "mcdonald's"],
    ['쇼퍼스', '샤퍼스', 'shoppers', 'shoppers drug mart'],
    ['로블로', '로블로스', 'loblaws'],
    ['노프릴스', '노 프릴스', 'no frills'],
    ['한아름', 'h마트', '에이치마트', 'hmart', 'h mart'],
    ['티앤티', 't&t', '티엔티'],
    ['캐네디언타이어', '캐나디언타이어', '캐나디안타이어', 'canadian tire'],
    ['홈디포', 'home depot'],
    ['다이소', 'daiso'],
    ['커피', 'coffee'],
    ['유니클로', '유니끌로', '유니클러', 'uniqlo'], ['에이치앤엠', 'h&m', '에이치엔엠'], ['룰루레몬', '룰루', 'lululemon'], ['세포라', 'sephora'],
    ['영화', '영화관', '극장', '영화구경', '시네플렉스', '씨네플렉스', 'cineplex', '무비', 'movie', 'movies', '아이맥스', 'imax'],
    ['공연', '콘서트', '뮤지컬', 'concert', 'show'],
    ['모기지', '모게지', '모기쥐', 'mortgage'],
    ['콘도', '컨도', '콘도미니엄', 'condo'],
    ['관리비', '메인터넌스', '메인테넌스', '메인터넌스피', 'maintenance', 'maintenance fee', '콘도피', 'condo fee'],
    ['유틸리티', '유틸', '유틸리티비', '공과금', 'utility', 'utilities'],
    ['보험', '인슈어런스', 'insurance'],
    ['주유', '기름', '기름값', '개스', '휘발유', 'gas', 'fuel', 'gasoline', 'petrol'],
    ['가스비', 'gas bill'],
    ['장보기', 'groceries', 'grocery', 'grocery shopping'],
    ['아침', 'breakfast'], ['점심', 'lunch'], ['저녁', 'dinner', 'supper'], ['브런치', 'brunch'],
    ['식당', 'restaurant'], ['피자', 'pizza'], ['치킨', 'chicken', 'wings'], ['버거', 'burger', 'hamburger'], ['초밥', 'sushi'],
    ['샌드위치', 'sandwich'], ['도넛', 'donut', 'doughnut'], ['라떼', 'latte'], ['아메리카노', 'americano'], ['카페', 'cafe'],
    ['과일', 'fruit'], ['우유', 'milk'], ['계란', 'egg', 'eggs'], ['쌀', 'rice'], ['야채', 'vegetables', 'veggies'],
    ['주차', 'parking'], ['택시', 'taxi', 'cab'], ['우버', 'uber'], ['버스', 'bus'],
    ['충전기', 'charger'], ['케이블', 'cable'], ['이어폰', 'earphones', 'earbuds', 'airpods'], ['노트북', 'laptop'], ['모니터', 'monitor'],
    ['세제', 'detergent'], ['휴지', 'tissue', 'toilet paper', 'paper towel'], ['샴푸', 'shampoo'], ['치약', 'toothpaste'],
    ['옷', 'clothes', 'shirt', 'pants', 'jacket'], ['신발', 'shoes', 'sneakers'],
    ['핸드폰비', 'phone bill', 'cell phone bill'], ['인터넷', 'internet'], ['넷플릭스', 'netflix'], ['유튜브', 'youtube'],
    ['렌트', 'rent'], ['하이드로', 'hydro', 'electricity', 'electric bill'], ['수도세', 'water bill'], ['재산세', 'property tax'],
    ['약국', 'pharmacy', 'drugstore'], ['병원', 'hospital', 'clinic', 'doctor'], ['치과', 'dentist'], ['안경', 'glasses'],
    ['볼링', 'bowling'], ['골프', 'golf'], ['노래방', 'karaoke'], ['티켓', 'ticket'], ['팝콘', 'popcorn'],
    ['주급', 'paycheck', 'salary', 'wage', 'wages'], ['보너스', 'bonus'], ['환급', 'refund', 'tax refund'], ['이자', 'interest'], ['배당', 'dividend'],
    ['세컨드컵', 'second cup'], ['서브웨이', 'subway sandwich'],
    ['메트로', 'metro'], ['소비스', 'sobeys'], ['푸드베이직스', '푸드 베이직스', 'food basics'], ['프레시코', 'freshco'], ['렉살', 'rexall'],
    ['엘씨비오', 'lcbo'], ['비어스토어', 'beer store', 'the beer store'], ['에쏘', '에소', 'esso'], ['페트로캐나다', 'petro-canada', 'petro canada', 'petrocan'],
    ['쉘', 'shell'], ['위너스', 'winners'], ['홈센스', 'homesense'], ['달러라마', 'dollarama'], ['스테이플스', 'staples'], ['인디고', 'indigo'],
    ['이케아', 'ikea'], ['피자피자', 'pizza pizza'], ['스위스샬레', 'swiss chalet'], ['하비스', "harvey's", 'harveys'], ['웬디스', "wendy's", 'wendys'],
    ['버거킹', 'burger king'], ['케이에프씨', 'kfc'], ['파파이스', 'popeyes'], ['치폴레', 'chipotle'], ['스포츠첵', 'sport chek', 'sportchek'],
    ['더베이', 'the bay', "hudson's bay", 'hudsons bay'], ['애플스토어', 'apple store'], ['우버이츠', 'uber eats', 'ubereats'], ['스킵더디쉬', 'skip the dishes', 'skipthedishes'], ['도어대시', 'doordash'],
    ['머핀', 'muffin'], ['베이글', 'bagel'], ['크루아상', 'croissant'], ['케이크', 'cake'], ['아이스크림', 'ice cream'], ['과자', 'snacks', 'snack', 'chips'],
    ['물', 'water'], ['음료수', 'pop', 'soda'], ['샐러드', 'salad'], ['파스타', 'pasta'], ['스테이크', 'steak'], ['국수', 'noodles'],
    ['쌀국수', 'pho'], ['타코', 'tacos', 'taco'], ['감자튀김', 'fries'], ['두부', 'tofu'], ['사과', 'apples'], ['바나나', 'banana', 'bananas'],
    ['빵', 'bread'], ['갈비', 'galbi', 'short ribs'], ['냉면', 'naengmyeon', 'cold noodles'], ['소주', 'soju'], ['맥주', 'beer'], ['와인', 'wine'],
    ['삼겹살', 'pork belly'], ['불고기', 'bulgogi'], ['비빔밥', 'bibimbap'], ['김밥', 'kimbap'], ['라면', 'ramen', 'ramyeon'], ['떡볶이', 'tteokbokki'],
    ['짜장면', 'jjajangmyeon', 'black bean noodles'], ['선물', 'gift', 'present'], ['생일선물', '생일 선물', 'birthday gift', 'birthday present'],
    ['이발', '머리', '헤어컷', 'haircut', 'hair cut'], ['미용실', 'hair salon', 'salon', 'barber', 'barbershop'], ['세탁', 'laundry', 'dry cleaning'],
    ['수리', 'repair', 'repairs'], ['세차', 'car wash'], ['용돈', 'allowance', 'pocket money'], ['공항', 'airport'], ['회사', 'work', 'the office'],
    ['집', 'home'], ['약', 'medicine', 'meds'], ['비타민', 'vitamins'], ['책', 'book', 'books'], ['장난감', 'toy', 'toys'], ['꽃', 'flowers'],
    ['주유소', 'gas station'], ['자동차', 'car'], ['자동차보험', 'car insurance'], ['핸드폰', '휴대폰', 'phone', 'cell phone'],
  ];
  // 생활 단어장: 장보기·생활용품·옷 (받아쓰기 오타를 바로잡고 카테고리를 정할 때 사용)
  const GROCERY = ('시리얼 오트밀 그래놀라 호두 아몬드 땅콩 캐슈넛 식빵 호두식빵 모닝빵 우유 두유 요거트 요구르트 치즈 버터 계란 달걀 햄 소시지 베이컨 ' +
    '닭고기 소고기 돼지고기 삼겹살 목살 갈비살 다짐육 생선 연어 고등어 갈치 새우 오징어 조개 굴 김치 깍두기 두부 콩나물 숙주 시금치 배추 양배추 ' +
    '무 양파 마늘 대파 쪽파 감자 고구마 당근 오이 애호박 호박 버섯 표고 팽이 토마토 방울토마토 상추 깻잎 고추 피망 브로콜리 옥수수 ' +
    '사과 배 바나나 딸기 포도 오렌지 귤 한라봉 수박 참외 복숭아 키위 블루베리 망고 레몬 자몽 체리 아보카도 ' +
    '쌀 현미 찹쌀 잡곡 라면 국수 소면 당면 떡 떡국떡 떡볶이떡 어묵 만두 냉동만두 밀가루 부침가루 튀김가루 설탕 소금 후추 ' +
    '간장 된장 고추장 쌈장 참기름 들기름 식용유 올리브유 식초 케첩 마요네즈 머스타드 잼 꿀 시럽 커피믹스 원두 녹차 보리차 ' +
    '생수 탄산수 콜라 사이다 주스 오렌지주스 맥주 와인 소주 막걸리 과자 초콜릿 사탕 젤리 아이스크림 빵 케이크 쿠키 크래커 ' +
    '참치캔 스팸 통조림 김 미역 다시마 멸치 반찬 밑반찬 즉석밥 햇반 컵라면 냉동피자 물').split(' ');
  const HOUSE = ('세제 주방세제 섬유유연제 표백제 휴지 화장지 두루마리 키친타월 물티슈 샴푸 린스 컨디셔너 바디워시 비누 핸드워시 치약 칫솔 치실 ' +
    '면도기 면도날 기저귀 생리대 로션 선크림 건전지 전구 쓰레기봉투 비닐봉투 랩 호일 지퍼백 수세미 고무장갑 행주 걸레 ' +
    '수건 이불 베개 컵 머그컵 접시 그릇 냄비 프라이팬 칼 도마 수저 젓가락 숟가락 밀폐용기 옷걸이 방향제 살충제 모기약 ' +
    '배터리 충전기 케이블 공구 드라이버 페인트 테이프 접착제 못 나사 전선 연장선 멀티탭 와이퍼 워셔액 엔진오일 부동액 타이어').split(' ');
  const CLOTHES = ('슬리퍼 쓰레빠 쓰리빠 슬리빠 쪼리 샌들 운동화 구두 부츠 장화 양말 스타킹 속옷 팬티 런닝 내복 티셔츠 반팔 긴팔 셔츠 남방 ' +
    '바지 청바지 반바지 치마 원피스 자켓 재킷 점퍼 잠바 패딩 코트 조끼 후드 후드티 맨투맨 니트 스웨터 가디건 잠옷 모자 장갑 목도리 ' +
    '머플러 벨트 가방 지갑 우산 선글라스 안경').split(' ');

  const SYN_MAP = new Map();
  for (const g of SYNONYMS) for (const w of g) SYN_MAP.set(w.toLowerCase().replace(/\s+/g, ''), g[0]);

  function normalizeKeyword(w) {
    const k = String(w).toLowerCase().replace(/\s+/g, '');
    if (SYN_MAP.has(k)) return SYN_MAP.get(k);
    // 영어 복수형: batteries → battery, donuts → donut
    if (/^[a-z]{3,}ies$/.test(k) && SYN_MAP.has(k.slice(0, -3) + 'y')) return SYN_MAP.get(k.slice(0, -3) + 'y');
    if (/^[a-z]{3,}[^s]s$/.test(k)) { const one = k.slice(0, -1); return SYN_MAP.get(one) || one; }
    return k;
  }

  /** 기록 검색용 텍스트: 모든 단어를 표기 통일해서 이어붙임 */
  function searchText(s) {
    let t = String(s || '').toLowerCase();
    // 여러 단어 동의어 먼저 치환
    for (const g of SYNONYMS) for (const w of g) {
      if (w.includes(' ')) t = t.split(w.toLowerCase()).join(g[0]);
    }
    const words = t.split(/\s+/).filter(Boolean).map(w => normalizeKeyword(stripParticle(w)));
    return t.replace(/\s+/g, '') + ' ' + words.join(' ');
  }

  // ---------- 카테고리 ----------
  const CATEGORIES = [
    ['커피', ['이디야', '메가커피', '컴포즈커피', '빽다방', '투썸플레이스', '할리스', '폴바셋', '커피빈', '공차', '탐앤탐스', '커피', '아이스캡', '프라푸치노', '핫초코', '밀크티', '버블티', '머핀', '베이글', '크루아상', '도넛', '스타벅스', '팀홀튼', '라떼', '아메리카노', '카페', '에스프레소', '카푸치노', '세컨드컵', '블루보틀', '밸런스커피', '발란스']],
    ['식비', ['김밥천국', '롯데리아', '배달의민족', '요기요', '쿠팡이츠', '백반', '치맥', '회식', '파리바게뜨', '뚜레쥬르', '본죽', '교촌', '비비큐', '맘스터치', '국밥', '설렁탕', '감자탕', '순두부', '김치찌개', '된장찌개', '짬뽕', '탕수육', '만두', '우동', '생선회', '사시미', '햄버거', '치킨', '분식', '순대', '족발', '보쌈', '닭갈비', '곱창', '쌀국수', '돈까스', '카레', '도시락', '반찬', '외식', '배달', '식사', '밥값', '술집', '술자리', '술값', '피자피자', '스위스샬레', '하비스', '웬디스', '버거킹', '케이에프씨', '파파이스', '치폴레', '우버이츠', '스킵더디쉬', '도어대시', '엘씨비오', '비어스토어', '소주', '맥주', '와인', '갈비', '냉면', '삼겹살', '불고기', '비빔밥', '김밥', '떡볶이', '짜장면', '국수', '쌀국수', '샐러드', '파스타', '스테이크', '타코', '감자튀김', '아이스크림', '과자', '음료수', '케이크', 'food', 'takeout', 'take-out', 'meal', '점심', '저녁', '아침', '식당', '밥', '피자', '치킨', '버거', '맥도날드', '라면', '짜장', '초밥', '스시', '외식', '배달', '도시락', '샌드위치', '서브웨이']],
    ['장보기', ['이마트', '홈플러스', '롯데마트', '트레이더스', '하나로마트', '노브랜드', '마켓컬리', '편의점', '이마트24', '지에스25', '씨유', '세븐일레븐', '미니스톱', '메트로', '소비스', '푸드베이직스', '프레시코', '두부', '사과', '바나나', '코스트코', '한아름', '갤러리아', '티앤티', '노프릴스', '로블로', '월마트', '장보기', '식료품', '마트', '과일', '야채', '우유', '계란', '쌀']],
    ['교통', ['교통카드', '티머니', '카카오택시', '케이티엑스', '에스알티', '고속버스', '시외버스', '하이패스', '톨게이트', '에쓰오일', '지에스칼텍스', '현대오일뱅크', '따릉이', '주차비', '주차료', '톨비', '통행료', '에쏘', '페트로캐나다', '쉘', '주유소', '세차', '자동차', '자동차보험', 'go train', 'train', '주유', '기름', '개스', '주차', '프레스토', 'presto', 'ttc', '택시', '우버', 'uber', '407', '톨비', '지하철', '버스']],
    ['전자제품', ['하이마트', '전자랜드', '베스트바이', '배터리', '충전기', '케이블', '이어폰', '컴퓨터', '노트북', '아이폰', '애플', '맥북', '모니터']],
    ['생활용품', ['키친타월', '물티슈', '전구', '쓰레기봉투', '수건', '그릇', '청소', '세정제', '방향제', '화장지', '달러라마', '홈센스', '이케아', '스테이플스', '세탁', '수리', '미용실', '이발', '다이소', '캐네디언타이어', '홈디포', '쇼퍼스', '세제', '휴지', '샴푸', '치약']],
    ['쇼핑', ['쿠팡', '무신사', '지마켓', '11번가', '옥션', '올리브영', '교보문고', '유니클로', '자라', '에이치앤엠', '갭', '올드네이비', '나이키', '아디다스', '룰루레몬', '세포라', '마셜스', '티제이맥스', '바지', '셔츠', '자켓', '재킷', '패딩', '양말', '속옷', '운동화', '구두', '가방', '모자', '화장품', '향수', '네일', '안경테', '지갑', '시계', '위너스', '더베이', '스포츠첵', '인디고', '애플스토어', '책', '장난감', '꽃', '아마존', '옷', '신발', '쇼핑']],
    ['통신/구독', ['에스케이티', '케이티', '엘지유플러스', '알뜰폰', '티빙', '웨이브', '쿠팡플레이', '멜론', '통신비', '휴대폰요금', '핸드폰비', '전화비', '인터넷', '넷플릭스', '유튜브', '구독', '클로드', '로저스', '벨', '텔러스', '프리덤']],
    ['주거', ['대출', '월세', '전세', '전기요금', '가스요금', '수도요금', '도시가스', '대출이자', '모기지', '콘도', '관리비', '유틸리티', '보험', '렌트', '월세', '전기세', '전기요금', '수도세', '가스비', '하이드로', 'hydro', '에너지', 'enbridge', '엔브리지', '재산세', '프로퍼티택스']],
    ['의료', ['한의원', '안과', '피부과', '정형외과', '내과', '소아과', '이비인후과', '병원비', '렉살', '약', '비타민', '약국', '병원', '치과', '약값', '안경']],
    ['여가', ['영화', '공연', '팝콘', '볼링', '골프', '노래방', '당구', '스키', '박물관', '미술관', '전시', '티켓', '경기', '야구', '하키', '농구', '게임']],
    ['교육', ['학원', '학원비', '레슨', '레슨비', '과외', '교재', '수업료', '등록금', '학비', '튜터']],
    ['선물/경조사', ['선물', '생일선물', '축의금', '조의금', '부조', '부조금', '헌금', '십일조', '감사헌금', '기부', '후원', '세뱃돈', '용돈']],
    ['수입', ['주급', '월급', '보너스', '환급', '이자', '배당']],
  ];
  CATEGORIES.splice(CATEGORIES.findIndex((c) => c[0] === '장보기') + 1, 0);
  for (const c of CATEGORIES) { if (c[0] === '장보기') c[1].push(...GROCERY); if (c[0] === '생활용품') c[1].push(...HOUSE); if (c[0] === '쇼핑') c[1].push(...CLOTHES); }
  const KNOWN_WORDS = new Set();
  for (const g of SYNONYMS) for (const w of g) KNOWN_WORDS.add(w.toLowerCase());
  for (const [, keys] of CATEGORIES) for (const k of keys) KNOWN_WORDS.add(k.toLowerCase());
  function guessCategory(text) {
    const t = searchText(text);
    const toks = t.split(' ').slice(1).filter(Boolean);   // 단어 단위
    for (const k in LEARNED_CAT) if (k && t.includes(normalizeKeyword(k))) return LEARNED_CAT[k];
    const hit = (key) => {
      const k = normalizeKeyword(key);
      if (k.length <= 1) return toks.includes(k);                          // '무', '배' 는 단어 전체가 같을 때만
      if (k.length === 2) return toks.some((w) => w === k || (w.startsWith(k) && w.length <= 4));   // 주차 → 주차비, 사과 → 사과주스
      return t.includes(k);
    };
    for (const [cat, keys] of CATEGORIES) if (keys.some(hit)) return cat;
    return '기타';
  }

  // ---------- 조사/불용어 ----------
  const PARTICLES = ['에서는', '에서', '으로', '에게', '한테', '까지', '부터', '이랑', '하고', '을', '를', '은', '는', '로', '도', '랑', '와', '과', '의', '에'];
  function stripParticle(w) {
    w = w.replace(/[?!.,~"'“”‘’]+/g, '');
    if (KNOWN_WORDS.has(w.toLowerCase())) return w; // '하이드로' 같은 단어는 조사로 자르지 않음
    // "컵이랑", "빵이랑" → 컵, 빵 (받침 있는 한 글자 + 이랑)
    if (w.length === 3 && /이랑$/.test(w) && hasBatchim(w[0])) return w[0];
    for (const p of PARTICLES) {
      if (w.length > p.length + 1 && w.endsWith(p)) return w.slice(0, -p.length);
    }
    // "관리비가", "금액이", "커피가" → 아는 말 + 이/가
    if (w.length >= 3 && /[이가]$/.test(w)) { const b = w.slice(0, -1); if (KNOWN_WORDS.has(b.toLowerCase()) || FILLER_WORDS.has(b)) return b; }
    // 두 글자 + 을/를/은/는 ("빵을", "삽을") → 한 글자로 (뒤에서 쓸모 있는 말인지 다시 거름)
    if (w.length === 2 && /[을를은는]$/.test(w) && /[가-힣]/.test(w[0])) return w[0];
    return w;
  }
  // 한 글자로도 뜻이 있는 물건 이름
  const ONE_CHAR = new Set('쌀 빵 약 물 술 차 옷 책 꽃 펜 떡 김 귤 배 감 무 파 국 밥 회 잼 꿀 콩 팥 껌 컵 공 칼 못 굴 닭 게 밤 잣 깨 표 차비'.split(' '));
  const ADNOMINAL = /^(먹|마시|사|쓰|입|신|타|보|듣|읽|하|드시|좋|싼|비싼|맛있|맛없|필요하|새|쓸|먹을|마실|살|신을|입을)(는|은|던|ㄴ|ㄹ|을)?$|^(먹는|사는|산|쓰는|입는|신는|마시는|먹던|쓸|먹을|마실|살|신을|입을|필요한|좋은|싼|비싼)$/;
  const LONE_PARTICLE = /^(을|를|이|가|은|는|도|에|와|과|랑|의|로|으로|에서|하고|이랑|요|고|서|해|해서|그)$/;
  /** 물건 이름으로 쓸 만한 말인지 (받아쓰기 조각 거르기) */
  function goodItemWord(w) {
    if (!w) return false;
    if (LONE_PARTICLE.test(w) || ADNOMINAL.test(w)) return false;
    if (/^\d+\s*\S*$/.test(w)) return /[가-힣a-z]/i.test(w);          // 2잔, 1모 같은 개수는 남김
    if (w.length === 1) return ONE_CHAR.has(w) || KNOWN_WORDS.has(w);
    return true;
  }

  // 키워드가 아닌 말: 감탄사·부사·시간말·동사 (정확히 일치할 때만 제외해서 '한아름', '사과' 같은 단어는 지키기)
  const FILLER_WORDS = new Set(['음', '어', '아', '에', '저기', '그', '이', '저', '뭐', '그거', '이거', '저거', '거기', '여기',
    '그리고', '그래서', '그냥', '좀', '막', '진짜', '정말', '너무', '완전', '또', '다시', '그때', '일단', '오늘', '어제', '그저께', '그제',
    '아까', '방금', '지금', '이번에', '총', '합계', '모두', '전부', '돈', '가격', '값', '금액', '얼마', '정도', '쯤', '혼자', '나', '내가', '제가', '우리',
    '구경', '이번달', '이번주', '지난달', '지난주', '이달', '매달', '매월', '이번', '피', '카드', '카드로', '현금', '데빗', '크레딧', '신용카드', '체크카드', '비자', '마스터', '마스터카드', '애플페이', '세금', '택스', '포함', '포함해서', '팁', '약', '대략', '거의', '꺼', '거', '것', '사요', '먹어요', '마셔요', '해요', '했어용', '샀어용', '그래서', '그리구', '하나', '한개', '방금전', '아까전', '오늘아침', '오늘저녁', '오늘점심', '많이', '조금', '있는', '거기서', '여기서', '그다음', '다음', '다음에', '그다음에', '그담', '그리고나서', '그러고', '그러니까', '그니까', '근데', '그런데', '뭐냐', '있잖아', '저기요', '음음', '어어', '아니', '네', '예']);
  const VERB_RE = /^(치고|쳤|치러|쳐서|맡겼|맡기고|자르고|잘랐|깎았|깎고|만나|만나서|만나가지고|만나고|만났|만났어|만났는데|만나서는|만남|가지고|같이|함께|질렀|지름|긁었|긁음|사먹|사먹었|사먹고|시켜먹|시켜먹었|배달|배달시켰|배달시켜서|주문했|계산했|결제했|충전|충전했|채웠|넣었|넣고|넣음|타고|탔|줬|주었|드렸|보냈|송금|송금했|빌려줬|이체|이체했|시켜|시켜서|시켰|주문|주문해서|봤|본|보고|보러|봐|볼|구경|구경하고|구경하러|샀|산|사서|사고|사러|살|구입|구매|결제|계산|지불|지출|냈|낸|내고|썼|쓴|쓰고|먹었|먹고|먹으러|먹은|마셨|마시고|마신|갔|가서|갔다가|왔|와서|들렀|들러서|했|하고|해서|함|됐|입금|받았|받은|받고|들어왔|주고|줬|나왔|나갔)(어|어요|다|음|지|네|는데|고|습니다|어서|다가|요|구|었어|었다)?$/;
  const ENDING_RE = /(었|았|였|했|겠)(어|어요|다|음|지|네|는데|습니다|고|구)?$/;
  const AREAS = /^(토론토|다운타운|노스욕|노스요크|스카보로|미시사가|쏜힐|손힐|리치몬드힐|마캄|본|브램튼|에토비코|오크빌|버링턴|해밀턴|욕빌|코리아타운|한인타운|이스트요크|애잭스|피커링|뉴마켓|오로라)$/;
  // 지난 기록을 부탁할 때 붙는 말·상황 설명 (기록 내용이 아님)
  const META_RE = /^(기록|입력|저장|등록|추가|메모|적어|날짜|그날|그날짜|해줘|해 줘|해주세요|해줄래|줘|부탁해|부탁|좀|날)(해|해줘|해주세요|해놔|해둬|하기|좀|은|는|을|를|로|으로|에|도|이|가)?$|^(깜빡|깜박|까먹|잊어|잊었|잊고|빼먹|빠뜨|놓쳤|못했|못하|안했|안하|잘못)|^(전에|후에|다음에|끝나고|끝나서|끝난|하기전|하기전에|출근|퇴근|출근길|퇴근길|출근길에|퇴근길에|출근전|퇴근후|근무|근무중|일하기|일하러|일하다|일하다가|쉬는|쉬는시간|브레이크|타임|중에|때|땐|동안|그때|아까|오전|오후|새벽|밤|낮)$|(거든|는데|던데|잖아|더라|더라구|더라고|길래|니까|해서|하고서|했던)$|하기$/;
  function isFiller(w) {
    if (!w) return true;
    if (w !== '장보기' && !KNOWN_WORDS.has(w) && META_RE.test(w)) return true;
    if (AREAS.test(w)) return true;
    if (FILLER_WORDS.has(w) || VERB_RE.test(w)) return true;
    if (w.length >= 2 && ENDING_RE.test(w)) return true;
    // 받침이 ㅆ인 글자가 끝 쪽에 있으면 과거형 동사 (봤어, 넣었다, 갔음 …)
    const tail = KNOWN_WORDS.has(w) ? '' : w;
    for (const ch of tail) { const c = ch.charCodeAt(0); if (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 20) return true; }
    if (/^\d+$/.test(w)) return true;
    return false;
  }
  function cleanWord(w) {
    w = stripParticle(w);
    if (w.length > 2 && w.endsWith('요') && !VERB_RE.test(w)) w = w.slice(0, -1);
    if (w.length > 2 && /(구경|보기)$/.test(w) && w !== '장보기') w = w.replace(/(구경|보기)$/, ''); // 영화구경 → 영화
    if (w.length > 2 && /값$/.test(w) && !KNOWN_WORDS.has(w)) w = w.slice(0, -1);                   // 커피값 → 커피
    return stripParticle(w);
  }

  const STORES = new Set(['편의점', '이마트', '홈플러스', '롯데마트', '트레이더스', '하나로마트', '노브랜드', '이마트24', '지에스25', '씨유', '세븐일레븐', '미니스톱', '쿠팡', '마켓컬리', '무신사', '올리브영', '이디야', '메가커피', '컴포즈커피', '빽다방', '투썸플레이스', '할리스', '폴바셋', '커피빈', '공차', '탐앤탐스', '김밥천국', '롯데리아', '배달의민족', '요기요', '쿠팡이츠', '교보문고', '하이마트', '전자랜드', '유니클로', '자라', '에이치앤엠', '갭', '올드네이비', '나이키', '아디다스', '룰루레몬', '애플', '삼성', '세포라', '바이브레이', '마셜스', '티제이맥스', '노드스트롬', '코치', '팬도라', '플레이밍고', '파머스마켓', '파리바게뜨', '뚜레쥬르', '본죽', '교촌', '비비큐', '맘스터치', '메트로', '소비스', '푸드베이직스', '프레시코', '렉살', '엘씨비오', '비어스토어', '에쏘', '페트로캐나다', '쉘', '위너스', '홈센스', '달러라마', '스테이플스', '인디고', '피자피자', '스위스샬레', '하비스', '웬디스', '버거킹', '케이에프씨', '파파이스', '치폴레', '스포츠첵', '더베이', '우버이츠', '스킵더디쉬', '도어대시', '베스트바이', '코스트코', '팀홀튼', '스타벅스', '월마트', '아마존', '맥도날드', '쇼퍼스', '로블로',
    '노프릴스', '한아름', '티앤티', '캐네디언타이어', '홈디포', '다이소', '갤러리아', '서브웨이', '세컨드컵', '이케아', 'ikea', '애플스토어']);

  // ---------- 식사 / 동행인 ----------
  const FOODS = /^(커피|밥|술|점심|저녁|아침|식사|오늘|어제|맥주|소주|와인|막걸리|음식|빵|케이크|갈비|냉면|삼겹살|목살|불고기|비빔밥|김치찌개|된장찌개|순두부|짜장면|짜장|짬뽕|탕수육|만두|김밥|떡볶이|순대|국밥|설렁탕|감자탕|라면|우동|초밥|회|치킨|피자|햄버거|버거|콜라|사이다|반찬|파스타|스테이크|샐러드|도넛|빙수)$/;
  const MEALS = [['브런치', '브런치'], ['아침', '아침식사'], ['점심', '점심식사'], ['저녁', '저녁식사'], ['회식', '회식'], ['술', '술자리'], ['식사', '식사']];
  function findMeal(text) {
    // "아침에 커피 샀어"처럼 시간만 말한 경우는 식사가 아님 → 먹었다/식사/외식/음식 이름이 있을 때만
    const ate = /(먹|식사|외식|회식|브런치|술자리|한잔|한 잔)/.test(text) ||
      text.split(/\s+/).some((w) => FOODS.test(stripParticle(w)) && !/^(커피|술|점심|저녁|아침|식사|오늘|어제)$/.test(stripParticle(w)));
    for (const [k, v] of MEALS) {
      if (!text.includes(k)) continue;
      if (/^(아침|점심|저녁)$/.test(k) && new RegExp(k + '\\s*(에|때)').test(text) && !ate) continue;
      if (k === '술' && !/(술\s*(마셨|먹었|한잔|한\s*잔|\d+\s*잔|자리)|술값|술집)/.test(text)) continue;
      return v;
    }
    return '';
  }
  /** "철수랑", "영희하고", "김부장님과" → 동행인 (식사/같이/함께가 있을 때만) */
  function findCompanions(text) {
    if (!/(같이|함께|식사|점심|저녁|아침|브런치|회식|술|만나|만났|만남|데이트)/.test(text)) return [];
    const out = [];
    const re = /(?:^|\s)([가-힣A-Za-z]{1,10}?)(이랑|랑|하고|이와|와|과)(?=\s|$)/g;
    const placeAt = text.search(/에서/);
    const TITLE = /^(형님|형|누나|언니|오빠|선배|선배님|후배|부장님|과장님|차장님|대리님|사장님|회장님|이사님|님|씨|선생님|목사님|집사님|장로님|권사님|교수님|삼촌|이모|고모|형수님|아저씨|아주머니)$/;
    let m;
    while ((m = re.exec(text))) {
      let name = m[1];
      // "수환 형님하고" → "수환 형님"
      if (TITLE.test(name)) {
        const pm = /(?:^|\s)([가-힣A-Za-z]{1,5})\s*$/.exec(text.slice(0, m.index));
        if (pm && !/에서$|에$/.test(pm[1]) && !isFiller(pm[1]) && !STORES.has(normalizeKeyword(pm[1])) && !KNOWN_WORDS.has(pm[1])) name = pm[1] + ' ' + name;
      }
      // "~에서" 뒤에 나오는 "갈비랑 냉면이랑"은 사람이 아니라 먹은 것
      if (placeAt >= 0 && m.index > placeAt && !/(님|씨|형|누나|언니|오빠|엄마|아빠|동생|친구|부장|과장|대리|사장|선배|후배|와이프|아내|남편|아들|딸)$/.test(name)) continue;
      if (FOODS.test(name) || KNOWN_WORDS.has(name.toLowerCase())) continue;
      if (STORES.has(normalizeKeyword(name))) continue;
      out.push(name);
    }
    return out;
  }

  // ---------- 날짜 표현 ----------
  /** "11월 3일에", "3일에", "금요일에", "지난주 토요일" → 'YYYY-MM-DD' (오늘 기준, 미래가 되면 지난 날짜로) */
  // 말로 한 날짜: "11월 1일에", "시월 삼십일일", "지난달 28일", "11/1", "2025년 12월 24일", "3일 전", "이틀 전",
  //   "엊그제", "지난 금요일", "저번 주 토요일", "토욜" → 'YYYY-MM-DD' (오늘 기준, 미래가 되면 지난 날짜로)
  const KO_MONTH = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 유: 6, 육: 6, 칠: 7, 팔: 8, 구: 9, 시: 10, 십: 10, 십일: 11, 십이: 12 };
  const MON_RE = '(1[0-2]|0?[1-9]|십이|십일|시|십|유|육|[일이삼사오칠팔구])\\s*월';
  const DAY_RE = '(3[01]|[12]\\d|0?[1-9]|[일이삼사오육칠팔구십]+)\\s*일';
  const DATE_TAIL = '\\s*(?:날|째|째날)?\\s*(?:에는|에|날에|로|으로|날로)?(?=\\s|$|[,.!?])';
  const NATIVE_DAYS = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4, 닷새: 5, 엿새: 6, 이레: 7, 열흘: 10 };
  const NATIVE_N = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
  function dateFrom(text, now = new Date()) {
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
    const num = (t) => (/^\d+$/.test(t) ? Number(t) : NATIVE_N[t] ?? parseKoNumber(t));
    const out = (d, match, extra = []) => ({ date: ymd(d), match, remove: [match, ...extra].filter(Boolean) });
    const t = String(text || '');
    let m;
    // 년도: "2025년", "작년", "재작년" (월·일과 함께 말할 때만 사용)
    let year = null, yearWord = '';
    if ((m = /(?:^|\s)((20\d\d)\s*년(?:도)?)/.exec(t))) { year = Number(m[2]); yearWord = m[1]; }
    else if ((m = /(?:^|\s)(재작년|작년|지난해|올해)(?=\s|$)/.exec(t))) { year = now.getFullYear() - ({ 재작년: 2, 작년: 1, 지난해: 1, 올해: 0 })[m[1]]; yearWord = m[1]; }

    // 1) 월 + 일: "11월 1일", "시월 삼십일일", "10월31일날"
    m = new RegExp('(^|[^가-힣\\d]|년)\\s*' + MON_RE + '\\s*' + DAY_RE + DATE_TAIL).exec(t);
    if (m) {
      const mo = /^\d+$/.test(m[2]) ? Number(m[2]) : KO_MONTH[m[2]], da = num(m[3]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        let y = year ?? now.getFullYear();
        let d = new Date(y, mo - 1, da);
        if (year == null && d > today) d = new Date(y - 1, mo - 1, da);
        if (d.getMonth() === mo - 1) return out(d, m[0].slice(m[1].length), [yearWord]);
      }
    }
    // 2) 11/1, 10/31
    if ((m = /(^|\s)(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])(?:에|일)?(?=\s|$)/.exec(t))) {
      let d = new Date(year ?? now.getFullYear(), Number(m[2]) - 1, Number(m[3]));
      if (year == null && d > today) d.setFullYear(d.getFullYear() - 1);
      return out(d, m[0], [yearWord]);
    }
    // 3) 며칠 전: "3일 전", "이틀 전", "일주일 전", "두 주 전"
    if ((m = /(?:^|\s)(하루|이틀|사흘|나흘|닷새|엿새|이레|열흘)\s*(?:전|前)(?:에|날|에는)?(?=\s|$)/.exec(t))) return out(back(NATIVE_DAYS[m[1]]), m[0]);
    if ((m = /(?:^|\s)(\d{1,2}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|[일이삼사오육칠팔구십]+)\s*(일|주일|주)\s*(?:전|前)(?:에|날|에는)?(?=\s|$)/.exec(t))) {
      const n = num(m[1]);
      if (n >= 1 && n <= 60) return out(back(n * (m[2] === '일' ? 1 : 7)), m[0]);
    }
    // 4) 어제·그저께 등 (말한 그 단어를 기록 내용에서 빼기)
    if ((m = /(?:^|\s)(그끄저께|그끄제|엊그저께|엊그제|그저께|그제|어저께|어제)(?:로|에|에는|는|날)?(?=\s|$)/.exec(t))) {
      const n = /그끄/.test(m[1]) ? 3 : /그저께|그제/.test(m[1]) ? 2 : 1;
      return out(back(n), m[0]);
    }
    // 5) 요일: "금요일", "지난 금요일", "지난주 토요일", "지지난주 일요일", "토욜"
    if ((m = /(?:^|\s)(지지난\s*주|지난\s*주|저번\s*주|이번\s*주|요번\s*주|지난|저번)?\s*(월|화|수|목|금|토|일)(?:요일|욜)(?:날)?(?:에는|에|로|날에)?(?=\s|$|[,.])/.exec(t))) {
      const X = '일월화수목금토'.indexOf(m[2]), monOff = (X + 6) % 7, todayMonOff = (today.getDay() + 6) % 7;
      const thisMon = back(todayMonOff);
      const p = (m[1] || '').replace(/\s+/g, '');
      let d;
      if (/^지지난주/.test(p)) { d = new Date(thisMon); d.setDate(d.getDate() - 14 + monOff); }
      else if (/^(지난주|저번주)$/.test(p)) { d = new Date(thisMon); d.setDate(d.getDate() - 7 + monOff); }
      else if (/^(이번주|요번주)$/.test(p)) { d = new Date(thisMon); d.setDate(d.getDate() + monOff); if (d > today) d.setDate(d.getDate() - 7); }
      else if (/^(지난|저번)$/.test(p)) d = back(((today.getDay() - X + 7) % 7) || 7);
      else d = back((today.getDay() - X + 7) % 7);
      return out(d, m[0]);
    }
    // 6) 일만: "1일에", "28일날", "지난달 28일", "저번 달 3일에"
    if ((m = /(?:^|\s)(지난\s*달|저번\s*달|지난달|이번\s*달|이달)?\s*(3[01]|[12]\d|0?[1-9]|[일이삼사오육칠팔구십]{1,4})\s*일(\s*(?:날|째)?\s*(?:에는|에|날에|로|날로)|날)?(?=\s|$|[,.])/.exec(t)) && (m[1] || m[3])) {
      const da = num(m[2]);
      if (da >= 1 && da <= 31) {
        const prevMonth = m[1] && /지난|저번/.test(m[1]);
        let d = new Date(today.getFullYear(), today.getMonth() - (prevMonth ? 1 : 0), da);
        if (!prevMonth && d > today) d = new Date(today.getFullYear(), today.getMonth() - 1, da);
        return out(d, m[0]);
      }
    }
    return null;
  }
  function dayOffsetFrom(text) {
    if (/그저께|그제/.test(text)) return -2;
    if (/어제/.test(text)) return -1;
    return 0;
  }

  /** 입력 문장 해석 (한국어) */
  function parseEntryKo(text) {
    const raw = String(text || '').trim();
    const res = { raw, amount: null, merchant: '', item: '', category: '기타', dayOffset: dayOffsetFrom(raw),
                  with: [], meal: '' };
    let rest = raw;
    const dt = dateFrom(rest);
    if (dt) {
      res.date = dt.date; res.dayOffset = 0;
      for (const r of dt.remove) rest = rest.replace(r, ' ');
      // 지난 날짜를 말할 때 붙는 말: "날짜는", "그날로", "기록해줘", "깜빡했는데" (아래 걸러내기에서 처리)
    }
    const a = findAmount(rest);
    if (a) { res.amount = a.amount; res._a = a; rest = rest.slice(0, a.start) + ' ' + rest.slice(a.end); }

    // "기록 못 했는데", "입력 안 했어" 같은 말 빼기 (못 = 물건 '못'이 아님)
    rest = rest.replace(/(^|\s)(못|안)\s+(했|하고|해서|한|적|넣|올리|썼|쓰고|챙기)\S*/g, ' ');
    // 돈을 준 사람: "아들한테 50불 줬어", "엄마에게 용돈 100불 보냈어"
    const gm = /(?:^|\s)([가-힣A-Za-z]{1,8}?)(에게|한테|께)(?=\s)/.exec(rest);
    if (gm && /(줬|주었|드렸|보냈|송금|빌려|이체)/.test(rest)) { res.to = gm[1]; rest = rest.replace(gm[0], ' '); }
    // 식사 + 동행인
    res.meal = findMeal(rest);
    res.with = findCompanions(rest);
    for (const p of res.with) rest = rest.replace(new RegExp('(^|\\s)' + p.replace(/\s+/g, '\\s*') + '(이랑|랑|하고|이와|와|과)(?=\\s|$)'), ' ');
    if (!res.meal) rest = rest.replace(/(아침|점심|저녁|밤|새벽|오전|오후)\s*(에|때|에는)(?=\s|$)/g, ' ');
    if (res.meal) rest = rest.replace(/(같이|함께)/g, ' ').replace(/(아침|점심|저녁|브런치)\s*(식사)?/g, ' ')
                             .replace(/(먹었|먹은|먹고|마셨)[가-힣]*/g, ' ').replace(/술\s*(\d+\s*잔|한\s*잔|한잔)/g, ' ').replace(/(^|\s)술(?=\s|$)/g, ' ');

    // "우버 타고 공항 갔어" → 우버를 타고 공항에 갔어요
    const tm = /(?:^|\s)([가-힣A-Za-z]{1,8}?)(?:을|를)?\s+타고\s+([가-힣A-Za-z]{1,10}?)(?:에|까지|으로|로)?\s+(?:갔|가|다녀|왔)/.exec(rest);
    if (tm && !isFiller(tm[1]) && !isFiller(tm[2])) { res.dest = tm[2]; rest = rest.replace(tm[0], ' ' + tm[1] + ' '); }
    rest = rest.replace(/\S+에\s*있는/g, ' '); // "노스욕에 있는" 같은 위치 설명은 빼기
    // "~에서" 앞 단어 = 상호
    // "코스트코 가서", "한아름에 들러서" → 가게
    const gm2 = !/에서/.test(rest) && /(?:^|\s)([가-힣A-Za-z&']{2,12}?)(?:에)?\s+(?:가서|들러서|들러|가서는|갔다가|가가지고)(?=\s|$)/.exec(rest);
    if (gm2 && !isFiller(gm2[1])) { res.merchant = gm2[1]; rest = rest.replace(gm2[0], ' '); }
    const mm = !res.merchant && /([^\s]+?)\s*에서/.exec(rest);
    if (mm && !/^(오늘|어제|그저께|그제)$/.test(mm[1])) {
      res.merchant = mm[1];
      rest = rest.slice(0, mm.index) + ' ' + rest.slice(mm.index + mm[0].length);
    }
    let words = rest.split(/\s+/).map(cleanWord).filter(w => !isFiller(w)).map(w => (w === '장' ? '장보기' : w)).filter(goodItemWord);
    // 아는 가게 이름이 있으면 그게 장소: "베이징에서 월마트 …" → 월마트 (앞말은 동네 이름으로 보고 뺌)
    const si = words.findIndex(w => STORES.has(normalizeKeyword(w)));
    if (si >= 0 && (!res.merchant || !STORES.has(normalizeKeyword(res.merchant)))) {
      if (res.merchant) res.area = res.merchant;
      res.merchant = words[si]; words.splice(si, 1);
    }
    res.item = words.join(' ').trim();
    if (res.meal && !res.item) res.item = res.meal;
    res.category = res.meal ? '식비' : guessCategory(res.merchant + ' ' + res.item);
    // 기록용 키워드: 장소, 함께한 사람, 식사, 아이템
    if (res.to) { words = words.filter((w) => !/^(돈)$/.test(w)); res.item = words.join(' '); res.category = guessCategory(res.item) === '기타' ? '기타' : guessCategory(res.item); }
    // 실제로 말한 동사 기억: "갈비 샀어"는 먹은 게 아니라 산 것
    if (res.to && /(보냈|송금|이체)/.test(raw)) res.verb = 'send';
    else if (res.to && /빌려/.test(raw)) res.verb = 'lend';
    else if (/충전(?!기)/.test(raw) && res.item && !/충전기/.test(res.item)) res.verb = 'charge';
    else if (/(사왔|샀|구입|구매|장\s*봤|주문했)/.test(raw) && !/(사먹|먹었|마셨|시켜먹)/.test(raw)) res.verb = 'buy';
    else if (/(시켜\s*먹|배달|테이크아웃|포장)/.test(raw) || /^(우버이츠|스킵더디쉬|도어대시)$/.test(res.merchant)) res.verb = 'order';
    else if (/(사먹|먹었|먹고)/.test(raw)) res.verb = 'eat';
    else if (/마셨|마시고/.test(raw)) res.verb = 'drink';
    res.keywords = [res.merchant, ...res.with, res.meal, res.to, ...words].filter((w, i, a) => w && a.indexOf(w) === i);
    if (res.area) res.keywords.push(res.area);
    if (res._a) {
      const hist = PRICE_HISTORY ? PRICE_HISTORY(res) : null;
      const fixed = plausibleAmount(res._a, res, hist);
      if (fixed !== res.amount) { res.amountGuess = { heard: res._a.digits, to: fixed }; res.amount = fixed; }
      else { const mx = priceMaxFor(res) * (CURRENCY === 'KRW' ? 1000 : 1); if (mx && res.amount > mx * 1.5) res.amountOdd = true; }
      delete res._a;
    }
    res.lang = 'ko';
    return res;
  }

  // ---------- 한 줄 표기 ----------
  function hasBatchim(word) {
    const w = String(word).trim(), c = w.slice(-1).charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
    if (/[0-9]$/.test(w)) return /[013678]$/.test(w);
    if (/^[A-Z&]{2,}$/.test(w)) return /[LMNR]$/.test(w);       // TTC(씨)를, LCBO(오)를, BMO(오) / H&M(엠)을          // 일, 삼, 육, 칠, 팔, 십 → 받침 있음
    return /[bcdgjklmnpqtvxz]$/i.test(w);                     // John과, Jane와 (영어 이름 끝소리)
  }
  function josa(word, withB, noB) { return word + (hasBatchim(word) ? withB : noB); }

  /** 기록 → 자연스러운 문장 조각 [{t, b}] (b=true면 중요 키워드)
   *  "베스트바이에서 밧데리를 샀어요", "철수와 코리아하우스에서 저녁식사를 했어요" */
  const DRINK_RE = /커피|라떼|아이스캡|프라푸치노|핫초코|아메리카노|카푸치노|에스프레소|녹차|홍차|밀크티|버블티|주스|스무디|음료|맥주|와인|소주|^티$|^차$/;
  const NATIVE_W = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
  /** "커피 1잔" → "커피 한 잔", "계란 2판" → "계란 두 판" */
  const nativeCount = (t) => String(t).replace(/(^|\s)(\d{1,2})\s*(잔|개|병|캔|팩|박스|봉지|봉|권|켤레|인분|마리|송이|판|그릇|접시|벌|통|모|줄|단|포기|알)(?=\s|$)/g,
    (m, sp, n, u) => (Number(n) >= 1 && Number(n) <= 10 ? sp + NATIVE_W[Number(n)] + ' ' + u : m));
  function sentenceParts(rec) {
    const P = [], K = (t) => P.push({ t: nativeCount(t), b: true }), T = (t) => P.push({ t, b: false });
    const end = (w) => (hasBatchim(w) ? '을' : '를');
    const who = (rec.with || []).filter(Boolean);
    const item = (rec.item || '').trim(), place = (rec.merchant || '').trim(), cat = rec.category || '';

    if (rec.type === 'in') {
      const name = place || item || '입금';
      K(name); T(hasBatchim(name) ? '이 ' : '가 ');
      if (place && item && item !== place && !/주급|월급/.test(place + item)) { /* 세부 내용 */ T('(' ); K(item); T(') '); }
      T('들어왔어요');
      return P;
    }
    if (rec.meal) {
      if (who.length) { who.forEach((w, i) => { K(w); if (i < who.length - 1) T(', '); }); T(hasBatchim(who[who.length - 1]) ? '과 ' : '와 '); }
      if (place) { K(place); T('에서 '); }
      if (item && item !== rec.meal) {
        const us = item.split(/\s+/);
        us.forEach((u, i) => { K(u); if (i < us.length - 2) T(', '); else if (i === us.length - 2) T(hasBatchim(u) ? '과 ' : '와 '); });
        T(end(us[us.length - 1]) + ' 먹었어요 ('); K(rec.meal); T(')');
      }
      else { K(rec.meal); T(end(rec.meal) + (rec.meal === '브런치' ? ' 먹었어요' : ' 했어요')); }
      return P;
    }
    if (rec.to) {
      const gv = rec.verb === 'send' ? ' 보냈어요' : rec.verb === 'lend' ? ' 빌려줬어요' : ' 줬어요';
      K(rec.to); T('에게 '); if (item) { K(item); T(end(item) + gv); } else T('돈을' + gv); return P;
    }
    if (rec.dest && item) { K(item); T(end(item) + ' 타고 '); K(rec.dest); T('에 갔어요'); return P; }
    if (who.length) { who.forEach((w, i) => { K(w); if (i < who.length - 1) T(', '); }); T(hasBatchim(who[who.length - 1]) ? '과 ' : '와 '); }
    if (place) { K(place); T('에서 '); }
    if (rec.forWho && item) { K(rec.forWho); T(end(rec.forWho) + ' 위한 '); K(item); T(end(item) + ' 샀어요'); return P; }
    if (!item) {
      if (place && cat === '장보기') { K('장'); T('을 봤어요'); return P; }   // "코스트코 210불" → 코스트코에서 장을 봤어요
      T(place ? '썼어요' : (cat && cat !== '기타' ? cat + ' 지출' : '지출')); return P;
    }
    if (rec.verb === 'charge') { K(item); T(end(item) + ' 충전했어요'); return P; }
    // 서비스: 이발했어요, 세차했어요 / 미용실에 다녀왔어요 / 골프를 쳤어요
    if (/^(이발|세차|세탁|드라이클리닝|네일|마사지|파마|염색|주유)$/.test(item)) { K(item); T('했어요'); return P; }
    if (/^(세탁소|미용실|이발소|바버샵|네일샵|마사지샵|정비소|카센터)$/.test(item)) { K(item); T('에 다녀왔어요'); return P; }
    if (/^(골프|볼링|당구|탁구|테니스|스크린골프)$/.test(item)) { K(item); T(end(item) + ' 쳤어요'); return P; }
    if (/^(하이드로|유틸리티|엔브리지|인터넷|가스|전기|수도)$/.test(item)) { K(item); T(' 요금을 냈어요'); return P; }

    // 물건/내용에 맞는 동사
    if (item === '장보기' || item === '장') { K('장'); T('을 봤어요'); return P; }
    // 여러 물건은 "A와 B"로 잇기 (콘도 관리비 같은 복합어는 그대로)
    const COUNT = /^\d+\s*(개|잔|병|캔|팩|박스|봉지|봉|장|권|인분|모|판|마리|송이|켤레|그릇|접시|벌|통|줄|단|포기|알|kg|g|lb|L)$/i;
    const units = [];
    const ADDON = /^(세트|콤보|밀|라지|스몰|미디엄|레귤러|사이즈|곱빼기|추가|한판|반반)$/;   // "빅맥 세트"는 한 물건
    for (const w of item.split(/\s+/)) { if ((COUNT.test(w) || ADDON.test(w)) && units.length) units[units.length - 1] += ' ' + w; else units.push(w); }
    const listy = units.length > 1 && !['주거', '통신/구독', '교통', '의료', '수입', '교육', '선물/경조사'].includes(cat) && !/^(콘도|집|차|자동차|핸드폰|폰)$/.test(units[0]);
    if (listy) {
      units.forEach((u, i) => {
        K(u);
        if (i < units.length - 2) T(', ');
        else if (i === units.length - 2) T(hasBatchim(u) ? '과 ' : '와 ');
      });
      const last = units[units.length - 1];
      const allDrinks = units.every((u) => DRINK_RE.test(u.replace(/\s*\d.*$/, '')));
      T(end(last) + ' ' + (rec.verb === 'buy' ? '샀어요' : rec.verb === 'eat' ? '먹었어요' : rec.verb === 'order' ? '시켜 먹었어요' : rec.verb === 'drink' || allDrinks ? '마셨어요' : cat === '식비' ? '먹었어요' : '샀어요'));
      return P;
    }
    let verb = '샀어요';
    if (/(용돈|세뱃돈)$/.test(item)) verb = '줬어요';
    else if (cat === '교육' || /(헌금|십일조|축의금|조의금|부조|부조금|기부|후원|학원비|레슨비|수업료|등록금|학비|회비)$/.test(item)) verb = '냈어요';
    else if (cat === '주거' || cat === '통신/구독' || /요금|보험|모기지|렌트|월세|관리비|유틸리티|구독|이자|(전기|수도|가스|재산|자동차)세$|(주차|통신|핸드폰|전화|인터넷|학원|레슨|병원|진료|수리|세탁)(비|료)$/.test(item) ||
             (!['식비', '장보기', '커피', '쇼핑', '생활용품'].includes(cat) && /(비|료)$/.test(item))) verb = '냈어요';
    else if (DRINK_RE.test(item.replace(/\s*\d.*$/, ''))) {
      // LCBO·마트에서 산 술·음료는 마신 게 아니라 산 것
      const shop = place && (/^(엘씨비오|비어스토어|lcbo)$/i.test(normalizeKeyword(place)) || ['장보기', '생활용품'].includes(guessCategory(place)));
      verb = shop || rec.verb === 'buy' ? '샀어요' : '마셨어요';
    }
    else if (/기름|주유|개스|휘발유/.test(item)) verb = '넣었어요';
    else if (/우버|택시|버스|지하철|기차|^TTC$|고트레인|go\s*train/i.test(item)) verb = '탔어요';
    else if (/영화|공연|콘서트|뮤지컬|경기|전시/.test(item)) verb = '봤어요';
    else if (cat === '식비') verb = rec.verb === 'buy' ? '샀어요' : rec.verb === 'order' ? '시켜 먹었어요' : '먹었어요';
    if ((rec.verb === 'eat' || rec.verb === 'order') && verb === '샀어요' && cat !== '쇼핑' && cat !== '생활용품' && cat !== '전자제품') verb = '먹었어요';
    else if (cat === '의료' && /병원|치과|진료/.test(item) && !/(비|료)$/.test(item)) verb = '다녀왔어요';
    if (cat === '통신/구독' && !/(비|료|요금|세)$/.test(item)) { K(item); T(' 요금을 냈어요'); return P; }
    if (verb === '줬어요') { K(item); T(end(item) + ' 줬어요'); return P; }
    if (verb === '탔어요' || verb === '다녀왔어요') { K(item); T((verb === '탔어요' ? (hasBatchim(item) ? '을 ' : '를 ') : '에 ') + verb); return P; }
    K(item); T(end(item) + ' ' + verb);
    return P;
  }
  /** 일반 글자 (엑셀용) */
  // =====================================================================
  //  내가 고친 문장 표현 배우기
  //  자동 문장 "{0}에서 {1}[을] 마셨어요" → 내가 고친 "{0} {1} 한 잔"
  //  같은 카테고리·같은 모양의 문장에는 다음부터 내 표현을 사용
  // =====================================================================
  let PHRASES = {};
  const PCLS = { 을: '을', 를: '을', 이: '이', 가: '이', 과: '과', 와: '과', 은: '은', 는: '은', 으로: '로', 로: '로', 이랑: '랑', 랑: '랑' };
  const normParticles = (tpl) => tpl.replace(/(\{\d+(?::s)?\})(으로|이랑|로|랑|을|를|이|가|과|와|은|는)(?=\s|$|[.,!?)~])/g, (m, slot, pt) => slot + '[' + PCLS[pt] + ']');
  function josaFor(word, cls) {
    const b = hasBatchim(word), c = String(word).trim().slice(-1).charCodeAt(0);
    const rieul = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 8;
    return { 을: b ? '을' : '를', 이: b ? '이' : '가', 과: b ? '과' : '와', 은: b ? '은' : '는', 로: b && !rieul ? '으로' : '로', 랑: b ? '이랑' : '랑' }[cls] || '';
  }
  /** 문장 조각 → { vals: 굵은 키워드들, tpl: 키워드 자리를 {0} {1}… 로 바꾼 틀 } */
  function partsTemplate(parts) {
    const vals = []; let tpl = '';
    for (const p of parts) {
      if (p.b) { let i = vals.indexOf(p.t); if (i < 0) { vals.push(p.t); i = vals.length - 1; } tpl += '{' + i + '}'; }
      else tpl += p.t;
    }
    return { vals, tpl: normParticles(tpl) };
  }
  /** 틀 + 키워드 → 문장 조각 (조사는 키워드 받침에 맞춰 을/를, 이/가 …) */
  const shortOf = (v) => String(v || '').replace(/식사$/, '');
  function fillTemplate(tpl, vals) {
    const out = [];
    for (const seg of tpl.split(/(\{\d+(?::s)?\}(?:\[[^\]]+\])?)/)) {
      if (!seg) continue;
      const m = /^\{(\d+)(:s)?\}(?:\[([^\]]+)\])?$/.exec(seg);
      if (!m) { out.push({ t: seg, b: false }); continue; }
      let v = vals[Number(m[1])];
      if (v && m[2]) v = shortOf(v);
      m[2] = m[3];
      if (!v) continue;
      out.push({ t: v, b: true });
      if (m[2]) out.push({ t: josaFor(v, m[2]), b: false });
    }
    // 빈 자리 때문에 생긴 겹친 띄어쓰기 정리
    for (const p of out) if (!p.b) p.t = p.t.replace(/\s{2,}/g, ' ');
    if (out.length && !out[0].b) out[0].t = out[0].t.replace(/^\s+/, '');
    return out;
  }
  /** 사용자가 쓴 문장에서 키워드 위치를 찾아 틀로 만들기 */
  const PART_END = /^(으로|이랑|에서|에게|한테|까지|부터|로|랑|을|를|이|가|과|와|은|는|도|의|에|만)?(?=$|[\s.,!?)~·])/;
  /** 단어 경계에서만 찾기: '장'이 '장보기' 속에서 잡히지 않게 */
  function findWord(u, v, from = 0) {
    let at = u.indexOf(v, from);
    while (at >= 0) {
      const before = at === 0 ? ' ' : u[at - 1];
      if (/[\s(\u0002·,]/.test(before) && PART_END.test(u.slice(at + v.length))) return at;
      at = u.indexOf(v, at + 1);
    }
    return -1;
  }
  function textTemplate(text, vals) {
    let u = String(text || '').trim(); const used = new Set();
    const order = vals.map((v, i) => [v, i]).filter(([v]) => v).sort((a, b) => b[0].length - a[0].length);
    const put = (at, len, tok) => { u = u.slice(0, at) + '\u0001' + tok + '\u0002' + u.slice(at + len); };
    for (const [v, i] of order) {
      let at = findWord(u, v);
      if (at >= 0) { put(at, v.length, i); used.add(i); continue; }
      const sv = shortOf(v);                      // 저녁식사 → 저녁
      if (sv !== v && (at = findWord(u, sv)) >= 0) { put(at, sv.length, i + ':s'); used.add(i); }
    }
    return { tpl: normParticles(u.replace(/\u0001(\d+(?::s)?)\u0002/g, '{$1}')), used };
  }
  const recKeys = (rec, auto) => {
    const sk = (rec.type || 'out') + '|' + (rec.category || '') + '|' + auto.tpl;
    return { general: 'G|' + sk, exact: 'E|' + sk + '|' + auto.vals.join('|') };
  };
  /** 화면에 보일 문장 조각: 내가 직접 쓴 문장 → 배운 표현 → 자동 문장 순서 */
  function partsFor(rec) {
    const base = sentenceParts(rec);
    const auto = partsTemplate(base);
    if (rec.desc) return fillTemplate(textTemplate(rec.desc, auto.vals).tpl, auto.vals);
    const k = recKeys(rec, auto);
    const rule = PHRASES[k.exact] || PHRASES[k.general];
    return rule ? fillTemplate(rule.tpl, auto.vals) : base;
  }
  /** 내가 고친 문장 배우기. 받아쓰기 오타 고침(뺨→짜장방)도 함께 찾아냄 */
  function learnPhrase(rec, text, general = true) {
    text = String(text || '').trim();
    let r = Object.assign({}, rec, { desc: undefined });
    let auto = partsTemplate(sentenceParts(r));
    let tt = textTemplate(text, auto.vals);
    let wordFix = null;
    const missing = auto.vals.map((v, i) => i).filter((i) => !tt.used.has(i));
    if (missing.length === 1) {
      // 바뀐 단어 하나 찾기: 내 문장에만 있는 단어
      const autoText = sentenceParts(r).map((p) => p.t).join('');
      const old = auto.vals[missing[0]];
      const cands = tt.tpl.replace(/\{\d+(?::s)?\}(\[[^\]]+\])?/g, ' ').split(/\s+/).map(stripParticle)
        .filter((w) => w && /^[가-힣A-Za-z&']{2,10}$/.test(w) && !autoText.includes(w) && !isFiller(w) && !/요$/.test(w) &&
          !(w.length <= 3 && /(음|함|됨|줌|냄|임|봄|삼|감|옴|했|었|았|다)$/.test(w)) && !w.includes(old) && !old.includes(w));
      const wholeField = old && (old === r.merchant || (r.item || '').split(/\s+/).includes(old) || (r.with || []).includes(old));
      if (cands.length === 1 && wholeField && old.length <= 12) {
        wordFix = { from: old, to: cands[0] };
        for (const f of ['merchant', 'item', 'to', 'dest', 'forWho']) if (r[f]) r[f] = r[f].split(old).join(cands[0]);
        r.with = (r.with || []).map((w) => w.split(old).join(cands[0]));
        auto = partsTemplate(sentenceParts(r));
        tt = textTemplate(text, auto.vals);
      }
    }
    const k = recKeys(r, auto), from = sentenceParts(r).map((p) => p.t).join('');
    const rules = {};
    rules[k.exact] = { tpl: tt.tpl, from, to: text };
    if (general && tt.used.size) rules[k.general] = { tpl: tt.tpl, from, to: text, general: true };
    return { rules, wordFix, fields: { merchant: r.merchant, item: r.item, with: r.with, to: r.to, dest: r.dest, forWho: r.forWho } };
  }
  function setPhrases(p) { PHRASES = p || {}; }

  function describe(rec) { return partsFor(rec).map((p) => p.t).join(''); }
  /** 화면용: 중요 키워드는 <b> */
  function describeHTML(rec) {
    const e = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return partsFor(rec).map((p) => (p.b ? '<b>' + e(p.t) + '</b>' : e(p.t))).join('');
  }
  /** 배운 표현 없이 만든 기본 문장 (비교용) */
  function describeAuto(rec) { return sentenceParts(rec).map((p) => p.t).join(''); }

  // ---------- 질문 해석 ----------
  // 질문에서 빼는 말: 정확히 일치하는 단어 + 몇 가지 안전한 시작말 (다이소·하이드로 같은 단어는 지킴)
  const QUERY_STOP_WORDS = new Set(['내가', '나', '제가', '저', '우리', '언제', '어디', '어디서', '무엇', '뭐', '뭘', '몇', '총', '합계', '모두', '전부', '다',
    '지출', '수입', '입금', '돈', '금액', '기록', '내역', '사용', '사용한', '오늘', '어제', '그저께', '올해', '작년', '금년', '이달', '금주', '금월', '최근', '동안',
    '남은', '잔액', '인지', '건', '거', '것', '좀', '정도', '했던', '했었던', '그', '그때', '가장', '마지막', '마지막으로', '처음', '최근에',
    '번', '회', '몇번', '군데', '횟수', '제일', '젤', '큰', '비싼', '작은', '싼', '적게', '적은', '최대', '최소', '중', '중에', '중에서', '것은', '건', '거는', '뭐야', '뭐였어', '뭐지', '무엇', '어떤', '어느', '많이', '많은', '어디에', '어디다', '어디에다', '뭐에', '뭐에다', '순위', '쓴', '쓴거', '쓴게', '데', '곳', '건지', '주말', '일주일', '1주일', '한달', '달', '개월', '알려줘', '보여줘', '찾아줘', '줘', '봐', '좀', '혹시', '있어', '있나', '있었어', '얼마나', '돈을', '돈']);
  const QUERY_STOP = { test: (w) => QUERY_STOP_WORDS.has(w) || LONE_PARTICLE.test(w) || /^(번|회)(이야|이지|이었어|이었지|이에요|인가|인지|이나|째)?$/.test(w) || /^(간|갔던|가본|다닌|다녀온|간데|간곳|들른)$/.test(w) || /^(얼마|이번|요번|지난|저번|알려|보여|찾아|계산|남았)/.test(w) || isFiller(w) };

  // ---------- 묶음 말 (v1.0.2): "배달 음식", "기름값", "술값", "편의점" … 여러 가게·물건을 한 번에 찾기 ----------
  // say: 질문·검색에서 이 묶음을 뜻하는 말 / words: 기록에 이 중 하나라도 있으면 해당 / not: 있으면 빼기 / verb: 이렇게 기록된 문장도 포함
  const GROUPS = [
    { id: '배달', label: '배달 음식', say: /배달\s*(?:음식|시킨\s*(?:거|것|음식)?|시켜\s*먹은\s*(?:거|것)?|비|앱)?|시켜\s*먹은\s*(?:거|것|음식)?|딜리버리|delivery|take\s*-?out|테이크\s*아웃|포장\s*(?:음식|해\s*온\s*(?:거|것))?/gi,
      words: ['배달의민족', '요기요', '쿠팡이츠', '우버이츠', '스킵더디쉬', '도어대시', '배달', '딜리버리', '시켜먹', '테이크아웃', '포장'], verb: 'order' },
    { id: '주유', label: '주유·기름값', say: /주유\s*(?:비|소)?|기름\s*값?|개스\s*(?:비|값)?|gas/gi,
      words: ['주유', '기름', '개스', '에쏘', '페트로캐나다', '쉘', '울트라마', '파이오니어', '하스키', 'sk에너지', 'gs칼텍스', '에쓰오일', '현대오일뱅크'] },
    { id: '술', label: '술', say: /(?:^|\s)(?:술\s*(?:값|자리|집|마신\s*(?:거|것)?)?|주류)(?=\s|$|[을를은는이가에도])/g,
      words: ['술', '소주', '맥주', '와인', '막걸리', '위스키', '보드카', '사케', '하이볼', '칵테일', '엘씨비오', '비어스토어', '치맥', '호프', '이자카야', '포차'] },
    { id: '편의점', label: '편의점', say: /편의점/g,
      words: ['편의점', '씨유', '지에스25', '세븐일레븐', '이마트24', '미니스톱', '써클케이', '서클케이', '마크스', 'macs'] },
    { id: '패스트푸드', label: '패스트푸드', say: /패스트\s*푸드|fast\s*food|햄버거\s*(?:집|가게)/gi,
      words: ['맥도날드', '버거킹', '웬디스', '케이에프씨', '파파이스', '서브웨이', '하비스', '롯데리아', '맘스터치', '치폴레', '에이앤더블유', 'a&w', '파이브가이즈', '햄버거', '버거'] },
    { id: '공과금', label: '공과금', say: /공과금|유틸리티\s*(?:비|요금)?|각종\s*요금|전기\s*(?:세|요금|비)|수도\s*(?:세|요금|비)|가스\s*(?:세|요금|비)/g,
      words: ['공과금', '유틸리티', '하이드로', '엔브리지', '전기세', '전기요금', '수도세', '수도요금', '가스비', '가스요금', '도시가스', '관리비'] },
    { id: '대중교통', label: '대중교통', say: /대중\s*교통|버스\s*(?:비|요금)?|지하철|전철|티티씨|TTC/gi,
      words: ['ttc', '프레스토', '버스', '지하철', '전철', '교통카드', '티머니', '기차', 'ktx', '고트레인', 'go트레인', '업익스프레스'] },
    { id: '택시', label: '택시·우버', say: /택시\s*(?:비|요금)?|우버(?!\s*이츠)|리프트/g,
      words: ['택시', '우버', '리프트', '카카오택시', '카카오t'], not: ['우버이츠'] },
  ];
  /** 질문·검색 말에서 묶음 말을 찾아 빼냄 → { groups: ['배달', …], rest: 남은 말 } */
  function takeGroups(text) {
    let rest = String(text || ''); const groups = [];
    for (const g of GROUPS) {
      g.say.lastIndex = 0;
      if (g.say.test(rest)) { groups.push(g.id); g.say.lastIndex = 0; rest = rest.replace(g.say, ' '); }
    }
    return { groups, rest };
  }
  const groupLabel = (id) => (GROUPS.find((g) => g.id === id) || { label: id }).label;
  function groupMatches(rec, id, hay) {
    const g = GROUPS.find((x) => x.id === id); if (!g) return false;
    if (g.not && g.not.some((w) => hay.includes(w)) && !g.words.some((w) => w !== '우버' && hay.includes(w))) return false;
    return (g.verb && rec.verb === g.verb) || g.words.some((w) => hay.includes(w.toLowerCase()));
  }

  function parseQueryKo(text) {
    const raw = String(text || '').trim();
    const q = { raw, lang: 'ko', intent: 'list', period: null, type: null, keywords: [], groups: [] };
    let dq = null;

    // 기간
    let m;
    if (/오늘/.test(raw)) q.period = { kind: 'day', offset: 0 };
    else if (/그저께|그제/.test(raw)) q.period = { kind: 'day', offset: -2 };
    else if (/어제/.test(raw)) q.period = { kind: 'day', offset: -1 };
    else if (/(이번|요번)\s*주말/.test(raw)) q.period = { kind: 'weekend', offset: 0 };
    else if (/(지난|저번)\s*주말/.test(raw)) q.period = { kind: 'weekend', offset: -1 };
    else if ((dq = dateFrom(raw))) q.period = { kind: 'ymd', date: dq.date };
    else if ((m = /(\d{1,2}|십이|십일|십|[일이삼사오육칠팔구])\s*월(?!\s*\d)/.exec(raw)) && parseKoNumber(m[1]) >= 1 && parseKoNumber(m[1]) <= 12)
      q.period = { kind: 'monthOf', month: parseKoNumber(m[1]), lastYear: /작년|지난\s*해/.test(raw) };
    else if ((m = /(?:최근|지난)\s*(\d+)\s*일/.exec(raw))) q.period = { kind: 'lastdays', n: Number(m[1]) };
    else if (/(최근|지난)\s*(일주일|1주일|한\s*주)/.test(raw)) q.period = { kind: 'lastdays', n: 7 };
    else if (/(최근|지난)\s*(한\s*달|1개월|한\s*개월)/.test(raw)) q.period = { kind: 'lastdays', n: 30 };
    else if (/(이번|요번|금)\s*주/.test(raw)) q.period = { kind: 'week', offset: 0 };
    else if (/(지난|저번)\s*주/.test(raw)) q.period = { kind: 'week', offset: -1 };
    else if (/(이번|요번)\s*달|이달|금월/.test(raw)) q.period = { kind: 'month', offset: 0 };
    else if (/(지난|저번)\s*달/.test(raw)) q.period = { kind: 'month', offset: -1 };
    else if (/올해|금년|올\s*한\s*해/.test(raw)) q.period = { kind: 'year', offset: 0 };
    else if (/작년|지난\s*해/.test(raw)) q.period = { kind: 'year', offset: -1 };

    // 종류
    if (/입금|수입|들어온|받은|주급|월급/.test(raw)) q.type = 'in';
    else if (/지출|썼|쓴|샀|산\b|사용|결제|구입|구매/.test(raw)) q.type = 'out';

    // 의도
    if (/잔액|남은\s*(돈|금액)|얼마\s*남/.test(raw)) q.intent = 'balance';
    else if (/몇\s*(번|회|군데)|횟수/.test(raw)) q.intent = 'count';
    // 한 건 기준: "가장 큰 지출은 뭐야?", "제일 비싼 거", "제일 적게 쓴 건"
    else if (!/어디|뭐에|무엇에|카테고리|순위|분야|항목별/.test(raw) &&
             /(가장|제일|젤|최고로|최대로?)\s*(큰|비싼|많이\s*(쓴|나간|낸)|많은|큰돈)|최대\s*지출|큰\s*지출|비싼\s*(거|것|건)/.test(raw)) q.intent = 'max';
    else if (!/어디|뭐에|카테고리|순위/.test(raw) && /(가장|제일|젤)\s*(작은|싼|적게|적은)|최소\s*지출/.test(raw)) q.intent = 'min';
    else if (/(제일|가장|젤|최고로)\s*(많이|많은|큰|비싼)|어디(에|에다|다)?\s*(돈을\s*)?(제일|가장|많이)|뭐(에|에다)?\s*(제일|가장|많이)|순위|top/i.test(raw)) q.intent = 'top';
    else if (/언제|어디|뭐|무엇|내역|기록|찾아|보여/.test(raw)) q.intent = 'list';
    else if (/총|합계|모두|전부|얼마|몇/.test(raw)) q.intent = 'sum';

    // 키워드
    let t = raw.replace(/[?!.,~]/g, ' ');
    if (dq) for (const r of dq.remove) t = t.replace(r, ' ');
    const tg = takeGroups(t); q.groups = tg.groups; t = tg.rest;
    for (const g of SYNONYMS) for (const w of g) if (w.includes(' ')) t = t.split(w).join(g[0]);
    q.keywords = t.split(/\s+/).map(cleanWord)
      .filter(w => w && !QUERY_STOP.test(w) && !/^\d+(월|일|월달)?$/.test(w) && !/^(일|주|월|달|년)$/.test(w))
      .map(normalizeKeyword)
      .map((k) => (/^(외식|밥값|식사)$/.test(k) ? '식비' : /^(기름값|주유비|개스비)$/.test(k) ? '주유' : k))
      .filter((k) => !/^(남|남았|요일|토요일|일요일|월요일|화요일|수요일|목요일|금요일)$/.test(k));
    // 키워드가 '주급/월급'이면 입금 종류로
    if (q.keywords.some(k => /주급|월급/.test(k))) q.type = 'in';
    if (['sum', 'top', 'count', 'max', 'min'].includes(q.intent) && !q.type) q.type = 'out';
    return q;
  }

  /** 기록이 키워드를 모두 포함하는지 */
  /** 몇 개의 키워드가 맞는지 (질문 단어와 기록의 동의어까지 비교) */
  const recHay = (rec) => searchText([rec.merchant, rec.item, rec.category, rec.memo, rec.desc, rec.meal, rec.dest, rec.to, (rec.with || []).join(' ')].join(' '));
  function matchCount(rec, keywords, groups = []) {
    const hay = recHay(rec);
    return keywords.filter((k) => hay.includes(k)).length + groups.filter((g) => groupMatches(rec, g, hay)).length;
  }
  function recordMatches(rec, keywords, groups = []) {
    if (!keywords.length && !groups.length) return true;
    const hay = recHay(rec);
    return keywords.every(k => hay.includes(k)) && groups.every((g) => groupMatches(rec, g, hay));
  }

  // ---------- 기록 탭 검색 (v1.0.2): 단어·묶음 말·금액 ----------
  /** "코스트코 45.99", "배달 음식", "12불" → { groups, keywords, amounts } */
  function parseSearch(text) {
    const tg = takeGroups(normalizeSpoken(String(text || '')));
    const amounts = [], keywords = [];
    for (let w of tg.rest.split(/\s+/)) {
      w = w.replace(/[?!,~]/g, ''); if (!w) continue;
      const m = /^\$?(\d+(?:\.\d{1,2})?)\s*(불|달러|원|\$)?$/.exec(w.replace(/,/g, ''));
      if (m) { amounts.push({ v: Number(m[1]), exact: m[1].includes('.') }); continue; }
      const k = normalizeKeyword(stripParticle(w));
      if (k) keywords.push(k);
    }
    return { groups: tg.groups, keywords, amounts };
  }
  function searchMatches(rec, s) {
    if (s.amounts.some((a) => (a.exact ? Math.abs(rec.amount - a.v) > 0.004 : Math.floor(rec.amount + 1e-9) !== a.v))) return false;
    return recordMatches(rec, s.keywords, s.groups);
  }

  // ---------- 말로 한 숫자 정리 ----------
  // ---------- 잘못 알아들은 말 바로잡기 ----------
  // 아이폰 받아쓰기가 자주 틀리는 소리: "권도"→콘도, "골 기지"→모기지, "gonzo"→콘도 …
  const SOUND_FIX = [
    [/갤러리어|겔러리아|갈레리아/g, '갤러리아'], [/프래스토|프레스또|presto/gi, '프레스토'], [/로져스|로저쓰|rogers/gi, '로저스'],
    [/텔루스|텔러쓰|telus/gi, '텔러스'], [/쇼퍼즈|샤퍼즈|샵퍼스|shoppers/gi, '쇼퍼스'], [/노\s?프릴즈|노\s?프릴스|노\s?프릴(?=\s|$)|no\s*frills/gi, '노프릴스'],
    [/캐나디언\s?타이어|캐네디언\s?타이어|캐나디안\s?타이어|canadian\s*tire/gi, '캐네디언타이어'], [/홈\s?디포|홈\s?데포|home\s*depot/gi, '홈디포'],
    [/월\s?마트|월마(?=\s|$|에서|에|랑)|walmart/gi, '월마트'], [/맥\s?도날드|맥\s?도널드|맥\s?다날드|mcdonald'?s/gi, '맥도날드'], [/써브웨이|섭웨이/g, '서브웨이'],
    [/엣소|에소(?=\s|$|에서)|esso/gi, '에쏘'], [/페트로\s?캐나다|패트로\s?캐나다|petro[-\s]?canada/gi, '페트로캐나다'], [/랜트(?=\s|$|비)/g, '렌트'],
    [/파킹비|파킹(?=\s|$)|parking/gi, '주차비'], [/사공칠|사영칠/g, '407'], [/407(?![\d.,]|\s*(?:불|달러|센트))\s?(?:톨비|톨|도로|etr|비)?/gi, '407톨비'], [/티티씨|ttc/gi, 'TTC'], [/우바(?=\s|$)|우버이(?=\s)/g, '우버'],
    [/아마죤|아마존에서|amazon/gi, (m) => m.endsWith('에서') ? '아마존에서' : '아마존'], [/다이쏘|다이써/g, '다이소'], [/한\s?인\s?마트/g, '한인마트'],
    [/(^|\s)(권도|곤도|건도|컨도|칸도|깐도|큰도|콘두|곤두|콘더|건더|곤더|콘또|꼰도|gonzo|gondo|condo|kondo|konzo|condos)(?=\s|$|[을를은는이가의에도랑와과])/gi, '$1콘도'],
    [/(^|\s)(?:골|굴|몰|머|무|목|모|몽|못|뭐|물|문|묵|북|복|볼)\s?기지(?=\s|$|[을를은는이가의에도])/g, '$1모기지'],
    [/모게지|모기쥐|모기찌|모지기|마기지|모그지|모르기지|머게지|머기지|모기찌|모기 지|mortgage|mortgages|모기지론/gi, '모기지'],
    [/콘도\s+기지/g, '콘도 모기지'],
    [/관리\s+비|괄리비|관니비|광리비|콴리비|관리피|관리삐|간리비|곤리비/g, '관리비'],
    [/메인터넌스\s*피|메인테넌스\s*피|메인터넌스비|maintenance\s*fees?|콘도\s*피(?=\s|$)|condo\s*fees?/gi, '관리비'],
    [/유틸\s?리\s?티|유틸리디|유틸이티|유티리티|유틸리치|유털리티|utilities|utility/gi, '유틸리티'],
    [/하이\s?드\s?로|하이드러|하이도로|하이드루|hydro/gi, '하이드로'],
    [/엔\s?브리지|엔브릿지|인브리지|엔브리찌|enbridge/gi, '엔브리지'],
    [/보엄|보홈|인슈런스|인슈어런스|insurance/gi, '보험'],
    [/프로퍼티\s*택스|property\s*tax/gi, '재산세'],
    [/건전\s?지/g, '건전지'],
    [/코스트\s?코|코스코|costco/gi, '코스트코'], [/베스트\s?바이|best\s*buy/gi, '베스트바이'], [/스타\s?벅스|starbucks/gi, '스타벅스'],
    [/팀\s?홀\s?튼|팀\s?호튼|팀\s?홀턴|tim\s*hortons?/gi, '팀홀튼'], [/한\s?아름|h\s?mart/gi, '한아름'], [/넷\s?플릭스|netflix/gi, '넷플릭스'],
  ];
  // 소리가 비슷한 말 찾기 (자모 단위로 비교: ㄱ/ㅋ/ㄲ, ㅗ/ㅝ/ㅓ 처럼 헷갈리는 소리는 거리를 작게)
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ', JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
  function jamo(w) {
    const out = [];
    for (const ch of w) {
      const c = ch.charCodeAt(0) - 0xac00;
      if (c < 0 || c > 11171) { out.push(ch); continue; }
      out.push(CHO[Math.floor(c / 588)], JUNG[Math.floor((c % 588) / 28)]);
      if (c % 28) out.push(JONG[c % 28]);
    }
    return out;
  }
  const NEAR = ['ㄱㅋㄲ', 'ㄷㅌㄸ', 'ㅂㅍㅃ', 'ㅈㅊㅉ', 'ㅅㅆ', 'ㅐㅔㅒㅖ', 'ㅗㅝㅓ', 'ㅜㅡㅠ', 'ㅕㅛ', 'ㅚㅙㅞ', 'ㄴㅇ', 'ㅢㅣ'];
  const subCost = (a, b) => a === b ? 0 : NEAR.some((g) => g.includes(a) && g.includes(b)) ? 0.35 : 1;
  function soundDist(a, b) {
    const x = jamo(a), y = jamo(b), d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= y.length; j++) d[0][j] = j;
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + subCost(x[i - 1], y[j - 1]));
    return { d: d[x.length][y.length], n: Math.max(x.length, y.length) };
  }
  // 띄어서 잘못 적힌 가게 이름 합치기: "걔네 비엔 타이어" → "캐네디언타이어"
  const STORE_FULL = ['캐네디언타이어', '베스트바이', '코스트코', '스타벅스', '팀홀튼', '월마트', '맥도날드', '노프릴스', '쇼퍼스', '홈디포', '한아름',
    '갤러리아', '페트로캐나다', '달러라마', '스테이플스', '스포츠첵', '피자피자', '스위스샬레', '푸드베이직스', '프레시코', '애플스토어', '이케아',
    '세컨드컵', '서브웨이', '위너스', '홈센스', '로블로', '메트로', '소비스', '다이소', '티앤티', '렉살', '엘씨비오', '비어스토어', '버거킹', '웬디스'];
  const SOUND_TARGETS = ['콘도', '모기지', '관리비', '유틸리티', '하이드로', '엔브리지', '보험', '재산세', '코스트코', '베스트바이', '스타벅스',
    '팀홀튼', '한아름', '갤러리아', '넷플릭스', '프레스토', '주차비', '건전지', '배터리', '밧데리', '월마트', '맥도날드', '다이소', ...STORE_FULL];
  // 세 글자 이상 생활 단어도 소리 비슷하면 바로잡기 (시리엘 → 시리얼)
  const SOUND_TARGETS_LONG = () => [...GROCERY, ...HOUSE, ...CLOTHES].filter((w) => w.length >= 3);
  function fixWord(tok) {
    const base = tok.replace(/(에서|으로|하고|이랑|한테|에게|을|를|은|는|이|가|의|에|도|랑|와|과|로)$/, '');
    if (base.length < 2 || !/^[가-힣]+$/.test(base) || KNOWN_WORDS.has(base) || SOUND_TARGETS.includes(base)) return tok;
    let best = null;
    const targets = base.length >= 3 ? [...SOUND_TARGETS, ...SOUND_TARGETS_LONG()] : SOUND_TARGETS;
    for (const t of targets) {
      if (Math.abs(t.length - base.length) > 1) continue;
      const { d, n } = soundDist(base, t);
      if (d <= (n >= 7 ? Math.max(0.75, n * 0.18) : 0.75) && (!best || d < best.d)) best = { t, d };
    }
    return best ? best.t + tok.slice(base.length) : tok;
  }
  // 내가 고친 말을 기억해 두었다가 다음부터 자동으로 바로잡기 (예: 내가 '권도'를 '콘도'로 고치면)
  let LEARNED = {}, LEARNED_CAT = {};
  function setLearned(words, cats) { LEARNED = words || {}; LEARNED_CAT = cats || {}; }
  function fixStoreRuns(t) {
    const toks = t.split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      let done = false;
      for (let len = Math.min(3, toks.length - i); len >= 2 && !done; len--) {
        const last = toks[i + len - 1], pm = /(에서|에|에서는|으로|로|을|를|이|가|은|는|랑|하고)$/.exec(last);
        const tail = pm && last.length > pm[0].length ? pm[0] : '';
        const joined = toks.slice(i, i + len).join('').slice(0, tail ? -tail.length : undefined);
        if (!/^[가-힣]+$/.test(joined) || joined.length < 3) continue;
        // 이미 온전한 가게 이름이 들어 있거나 숫자 말(오, 이십오)이 섞이면 붙이지 않음: "스타벅스 오 불" → 그대로
        const parts = toks.slice(i, i + len).map((x, j) => (j === len - 1 && tail ? x.slice(0, -tail.length) : x));
        if (parts.some((x) => STORE_FULL.includes(x) || /^[영공일이삼사오육칠팔구십백천만]+$/.test(x))) continue;
        let best = null;
        for (const st of STORE_FULL) {
          if (Math.abs(st.length - joined.length) > 1) continue;
          const { d, n } = soundDist(joined, st);
          if (n >= 8 && d <= n * 0.2 && (!best || d < best.d)) best = { st, d };
        }
        if (best) { out.push(best.st + tail); i += len - 1; done = true; }
      }
      if (!done) out.push(toks[i]);
    }
    return out.join(' ');
  }
  function fixSounds(text) {
    let t = String(text || '');
    for (const wrong in LEARNED) {
      const esc = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      t = t.replace(new RegExp('(^|\\s)' + esc + '(?=\\s|$|[을를은는이가의에도랑와과])', 'g'), '$1' + LEARNED[wrong]);
    }
    for (const [re, to] of SOUND_FIX) t = t.replace(re, to);
    t = fixStoreRuns(t);
    return t.split(/(\s+)/).map((w) => (/^\s+$/.test(w) ? w : fixWord(w))).join('');
  }

  const NATIVE = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열두: 12 };
  // ---------- 띄어서 말한 한국어 숫자 붙이기 ----------
  // "천 이백 불" → "천이백 불", "삼백 오십 불" → "삼백오십 불", "오 불 이십 오" → "오 불 이십오"
  const KO_NUM_TOK_D = /^[영공일이삼사오육륙칠팔구십백천만]+$/;
  const KO_NUM_TOK_W = /^(?=.*[일이삼사오육륙칠팔구십백천만억]|[\d,]+$)[\d,일이삼사오육륙칠팔구십백천만억]+$/;   // 원: "4만", "5,670", "오천"
  const UNIT_TOK_D = new RegExp('^' + '(?:' + DOLLAR.slice(3, -1) + '|' + CENT.slice(3, -1) + ')', 'i');
  const UNIT_TOK_W = /^(원|won)/i;
  const lowPlace = (n) => { let p = 1; while (n && n % (p * 10) === 0) p *= 10; return p; };
  function joinSpacedNumbers(text) {
    const W = CURRENCY === 'KRW';
    const KO_NUM_TOK = W ? KO_NUM_TOK_W : KO_NUM_TOK_D, UNIT_TOK = W ? UNIT_TOK_W : UNIT_TOK_D;
    // 원: "5,670원" → "5,670 원" (숫자와 원 사이를 띄워서 앞 숫자와 이어 붙일 수 있게)
    if (W) text = String(text).replace(/(^|\s)([\d,.일이삼사오육칠팔구십백천만억]+)원(?=\s|$|[,.!?]|짜리|어치|정도|이요|이야|요)/g, (m0, a, n) => (okWonNum(n) ? a + n + ' 원' : m0));
    const toks = String(text).split(' ');
    const out = [];
    const nextIsUnit = (i) => i < toks.length && UNIT_TOK.test(toks[i]);
    for (let i = 0; i < toks.length; i++) {
      let cur = toks[i];
      if (!KO_NUM_TOK.test(cur)) { out.push(cur); continue; }
      // 금액 자리인지: 뒤에 불/센트가 오거나, 바로 앞이 '불'(센트 부분)
      let k = i; while (k + 1 < toks.length && KO_NUM_TOK.test(toks[k + 1])) k++;
      const inAmount = nextIsUnit(k + 1) || UNIT_TOK.test(out[out.length - 1] || '');
      let j = i;
      while (inAmount && j < k) {
        const a = W ? parseWon(cur) : parseKoNumber(cur), b = W ? parseWon(toks[j + 1]) : parseKoNumber(toks[j + 1]);
        if (isNaN(a) || isNaN(b)) break;
        const placeOnly = /^[십백천만억]/.test(toks[j + 1]);
        // 큰 자리 다음에 작은 수(천 이백), 또는 한 자리 숫자 다음에 자리말(이 백)
        const ok = (b > 0 && b < lowPlace(a) && a >= 10) || (a >= 1 && a <= 9 && placeOnly);
        if (!ok) break;
        cur += toks[j + 1]; j++;
      }
      out.push(cur); i = j;
    }
    return out.join(' ');
  }
  function normalizeSpoken(text) {
    return joinSpacedNumbers(fixSounds(text))
      // "251불 점 삼 팔" / "251점38불" / "12 점 99" → 251.38불
      .replace(/(\d+)\s*(불|달러)?\s*점\s*([0-9영공일이삼사오육칠팔구])\s*([0-9영공일이삼사오육칠팔구])?\s*(?:불|달러)?(?=\s|$|[^0-9가-힣])/g,
        (all, a, unit, d1, d2) => a + '.' + (KO_DIGIT[d1] ?? d1) + (d2 ? (KO_DIGIT[d2] ?? d2) : '') + '불')
      // "커피 두 잔", "한 개", "세 병" → 2잔, 1개, 3병
      .replace(/(^|\s)(열두|다섯|여섯|일곱|여덟|아홉|한|두|세|네|열)\s*(잔|개|병|캔|팩|박스|봉지|봉|권|켤레|인분|마리|송이|판|그릇|접시|벌|통|모|줄|단|포기|알)(?=\s|$|랑|이랑|하고|과|와|을|를|씩)/g,
        (all, sp, n, u) => sp + NATIVE[n] + u)
      .replace(/생일\s+선물/g, '생일선물').replace(/콘도\s*피/g, '관리비').replace(/장\s+봤/g, '장 봤')
      // "12불 정도", "약 12불", "한 12불" → 12불
      .replace(/(^|\s)(약|대략|한|거의)\s+(?=\d)/g, '$1')
      // "$12.99불"처럼 겹친 표기
      .replace(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*(불|달러)/g, '$$$1');
  }
  function parseEntry(text) { return parseEntryKo(normalizeSpoken(text)); }
  function parseQuery(text) { return parseQueryKo(normalizeSpoken(text)); }

  // ---------- 여러 건을 한 번에 말할 때 ----------
  /** 단위가 분명한 금액만 찾기 ($12.99, 12불99, 99센트, 12.99불) */
  function strictAmounts(text) {
    const out = [];
    if (CURRENCY === 'KRW') {
      // 원: "89,000 원", "사만오천 원", "₩5000", 단위 없이 자릿말이 있는 "4만5천"
      const rw = new RegExp('()([₩￦]\\s*\\d[\\d,]*)|(^|[^가-힣\\d])(' + WON_NUM + '\\s*(?:원|won)(?:짜리|어치)?)', 'gi');
      let w;
      while ((w = rw.exec(text))) {
        const pre = w[1] != null ? w[1] : w[3], body = w[2] != null ? w[2] : w[4];
        const num = body.replace(/\s*(원|won)(짜리|어치)?$/i, '').replace(/^[₩￦]\s*/, '');
        if (isNaN(parseWon(num)) || !okWonNum(num)) continue;
        const st = w.index + pre.length;
        out.push({ start: st, end: st + body.length });
      }
      const rb = /(?:^|\s)(\d[\d,]*)(?=\s*(?:,(?!\d)|;|그리고|그다음|그담|다음에|또|$))/g;
      while ((w = rb.exec(text))) {
        const st = w.index + w[0].indexOf(w[1]), en = st + w[1].length;
        if (out.some((o) => st < o.end && en > o.start)) continue;
        out.push({ start: st, end: en });
      }
      out.sort((a, b) => a.start - b.start);
      return out;
    }
    const re = new RegExp('\\$\\s*\\d[\\d,]*(?:\\.\\d{1,2})?|' + NUM + '\\s*' + DOLLAR + '(?:\\s*(?:and\\s*)?' + NUM + '\\s*(?:' + CENT + ')?)?|' + NUM + '\\s*' + CENT, 'gi');
    let m;
    while ((m = re.exec(text))) {
      // 두번째 숫자가 개수(2잔 등)이면 잘라냄
      let len = m[0].length;
      const after = text.slice(m.index + len);
      const inner = new RegExp('^(.*?' + DOLLAR + ')\\s*(?:and\\s*)?' + NUM + '$', 'i').exec(m[0]);
      if (inner && NOT_CENT_AFTER.test(after)) len = inner[1].length;
      if (/^[0-9영공일이삼사오육륙칠팔구십백천만,.\s]+$/.test(m[0])) continue;
      out.push({ start: m.index, end: m.index + len });
      re.lastIndex = m.index + len;
    }
    // 단위 없이 말한 금액: 숫자 바로 뒤에 "and / then / 그리고 / 그다음" 같은 이음말이 오면 한 건의 끝으로 봄
    const reBare = /(?:^|\s)(\d[\d,]*(?:\.\d{1,2})?)(?=\s*(?:,(?!\d)|;|\band\b|\bthen\b|\balso\b|\bplus\b|그리고|그다음|그담|다음에|또|$))/gi;
    while ((m = reBare.exec(text))) {
      const st = m.index + m[0].indexOf(m[1]), en = st + m[1].length;
      if (out.some((o) => st < o.end && en > o.start)) continue;
      if (NOT_CENT_AFTER.test(text.slice(en))) continue;
      out.push({ start: st, end: en });
    }
    out.sort((a, b) => a.start - b.start);
    return out;
  }
  /** "모기지 2100불 그다음 관리비 650불" → ["모기지 2100불", "그다음 관리비 650불"] */
  function splitEntries(text) {
    const t = normalizeSpoken(text);
    const am = strictAmounts(t);
    if (am.length < 2) return [String(text || '')];
    const parts = []; let from = 0;
    am.forEach((a, i) => {
      let to = i === am.length - 1 ? t.length : a.end;
      // 금액 바로 뒤의 "센트", 동사(냈어, 샀어 / paid) 는 앞 덩어리에 붙임
      if (i < am.length - 1) { const mm = /^\s*(?:센트|cents?|[가-힣]*(?:었|았|했|냈|샀|썼)[가-힣]*)?/i.exec(t.slice(to)); to += mm ? mm[0].length : 0; }
      parts.push(t.slice(from, to).trim()); from = to;
    });
    return parts.filter(Boolean);
  }

    /** 음성인식 후보 중 가장 그럴듯한 문장 고르기용 점수 */
  function scoreText(text) {
    const t = normalizeSpoken(text); let sc = 0;
    if (strictAmounts(t).length) sc += 3; else if (findAmount(t)) sc += 1;
    for (const w of t.split(/\s+/)) { const b = stripParticle(w); if (KNOWN_WORDS.has(b.toLowerCase()) || STORES.has(normalizeKeyword(b))) sc += 1; }
    if (/[a-z]{3,}/i.test(t)) sc -= 1;
    return sc;
  }
    /** 예전에 잘못 저장된 기록 고치기 (받아쓰기 조각, 띄어 적힌 가게 이름, 동네 이름이 가게로 들어간 것) */
  function repairRecord(r) {
    let toks = String(r.item || '').split(/\s+/).filter(Boolean), merchant = r.merchant || '', area = '';
    if (merchant && !STORES.has(normalizeKeyword(merchant))) {
      for (let k = 0; k <= toks.length; k++) {
        const seq = [...toks.slice(0, k), merchant, ...toks.slice(k)];
        const ft = fixStoreRuns(seq.join(' ')).split(' ');
        const st = ft.find((w) => STORE_FULL.includes(w));
        if (st && !seq.includes(st)) { merchant = st; toks = ft.filter((w) => w !== st); break; }
      }
    }
    let words = toks.map(fixWord).map(cleanWord).filter((w) => !isFiller(w)).filter(goodItemWord);
    const si = words.findIndex((w) => STORES.has(normalizeKeyword(w)));
    if (si >= 0 && (!merchant || !STORES.has(normalizeKeyword(merchant)))) { area = merchant; merchant = words[si]; words.splice(si, 1); }
    return { merchant, item: words.join(' '), area };
  }
  const api = { parseSearch, searchMatches, groupLabel, setCurrency, parseWon, findWon, repairRecord, goodItemWord, setPriceHistory, plausibleAmount, nativeCount, learnPhrase, setPhrases, describeAuto, scoreText, setLearned, fixSounds, dateFrom, splitEntries, matchCount, describe, describeHTML, josa, parseKoNumber, findAmount, parseEntry, parseQuery, normalizeKeyword, searchText, recordMatches, guessCategory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VBParser = api;
})(typeof window !== 'undefined' ? window : globalThis);

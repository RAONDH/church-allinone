// 예제 자료: 처음 쓰는 목회자가 둘러보는 용도. 실제 교회 자료·실제 예배송출과 완전히 분리된다.
// 찬양 가사는 저작권 문제를 피하려고 예제용으로 직접 쓴 글이다 (실제 곡 아님).
import { uid } from './store.mjs';
import { DEFAULT_CATEGORIES } from './finance.mjs';

export function sundayOf(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + ((7 - x.getDay()) % 7));
  return x;
}
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };

const song = (title, key, lyrics, extra = {}) => {
  const slides = [];
  for (const block of lyrics.trim().split(/\n\s*\n/)) {
    let lines = block.split('\n').map((s) => s.trim()).filter(Boolean);
    let label = '';
    if (lines[0]?.startsWith('#')) { label = lines[0].slice(1).trim(); lines = lines.slice(1); }
    for (let i = 0; i < lines.length; i += 2) slides.push({ id: uid(), text: lines.slice(i, i + 2).join('\n'), ...(i === 0 && label ? { label } : {}) });
  }
  return { id: uid(), type: 'song', title, key, bpm: 0, memo: '', theme: '', arr: [], slides, updatedAt: Date.now(), ...extra };
};

export function sampleWcSeed() {
  const s1 = song('[예제] 아침의 노래', 'G', `#1절\n새 아침 주신 주님께\n감사의 노래 드리네\n어제의 짐을 내려놓고\n오늘을 주께 맡기네\n\n#후렴\n주님 함께 걸으면\n두려움 없네\n주님 함께 걸으면\n평안이 있네\n\n#2절\n작은 일 하나하나도\n주님의 손에 있으니\n서두르지 않아도 되네\n주께서 길을 여시네`, { arr: ['1절', '후렴', '2절', '후렴'], memo: '후렴 두 번째는 조용히' });
  const s2 = song('[예제] 은혜의 강', 'D', `#1절\n은혜의 강이 흐르네\n메마른 땅을 적시네\n\n#후렴\n흘러라 흘러라\n주의 은혜여`, { arr: ['1절', '후렴', '후렴'] });
  // 같은 제목, 다른 곡 (구분 정보는 라온 교회 올인원의 찬양 자료에 기록)
  const s3a = song('[예제] 주님만 바라봅니다', 'A', `#1절\n세상 소리 멀어지고\n주님만 바라봅니다\n\n#후렴\n나의 소망 나의 기쁨\n주님만 바라봅니다`, { arr: ['1절', '후렴'] });
  const s3b = song('[예제] 주님만 바라봅니다', 'E', `#1절\n고요한 밤 기도하며\n주님만 바라봅니다\n\n#후렴\n주의 얼굴 구하오니\n나를 만나 주옵소서`, { arr: ['1절', '후렴'] });
  const s4 = song('[예제] 보내심의 노래', 'C', `#1절\n이제 세상 속으로\n주님과 함께 갑니다\n\n#후렴\n나를 보내소서\n주님 뜻 이루도록`, { arr: ['1절', '후렴'] });

  const last = addDays(ymd(sundayOf()), -7);
  const t = (text, theme = 'title') => ({ id: uid(), type: 'text', title: text.split('\n')[0], theme, arr: [], key: '', bpm: 0, memo: '', slides: [{ id: uid(), text }], updatedAt: Date.now() });
  const lastItems = [
    t('지금은 기도로\n예배를 준비하는 시간입니다', 'prayer'), t('예배의 부름'), t('경배와 찬양'), s1, s2,
    t('대표 기도\n(기도하실 분)'), t('성경 봉독\n시편 23:1-6'), t('말씀 선포\n부족함이 없는 사람'), s4,
    t('봉헌\n감사의 예물을 드립니다'),
    { ...t('교회 소식', 'notice'), slides: [{ id: uid(), text: '교회 소식' }, { id: uid(), text: '다음 주일은 추수감사주일입니다' }, { id: uid(), text: '예배 후 함께 점심 식사합니다' }] },
    t('축도'),
  ];
  const svc = { id: uid(), name: '주일 예배', date: last, itemIds: lastItems.map((i) => i.id) };
  return {
    items: [s1, s2, s3a, s3b, s4, ...lastItems.filter((i) => i.type !== 'song')],
    services: [svc],
    currentServiceId: svc.id,
    props: [{ id: uid(), text: '설교 · 예제교회 담임목사', sub: '부족함이 없는 사람', where: 'both', pos: 'bottom' }],
  };
}

// 라온 교회 올인원 쪽 예제 자료 (지난주 예배 기록 1개). 예배송출 예배 순서와 연결해 둔다.
export function sampleHubSeed(wcState) {
  const svc = wcState.services[0];
  const find = (re) => wcState.items.find((i) => svc.itemIds.includes(i.id) && re.test(i.slides[0]?.text || ''))?.id || null;
  const id = uid();
  const s3a = wcState.items.filter((i) => i.title === '[예제] 주님만 바라봅니다');
  return {
    church: { name: '예제교회', pastor: '예제 목사', defaultServiceName: '주일 예배', sample: true },
    weeks: {
      [id]: {
        id, date: svc.date, name: '주일 예배', passage: '시편 23:1-6', sermonTitle: '부족함이 없는 사람',
        announcements: ['다음 주일은 추수감사주일입니다', '예배 후 함께 점심 식사합니다'],
        sermonNotes: '1. 목자 되신 하나님\n2. 쉴 만한 물가\n3. 원수의 목전에서 베푸시는 상',
        sermonVideoUrl: '', prayerLeader: '',
        wc: { serviceId: svc.id, links: { passage: find(/^성경 봉독/), title: find(/^말씀 선포/), notice: find(/^교회 소식/), prayer: find(/^대표 기도/) } },
        final: null, createdAt: Date.now(), updatedAt: Date.now(),
      },
    },
    songMeta: {
      [s3a[0]?.id]: { writer: '예제 작사·작곡 김예제', source: '예제 자료집 12번', distinguish: 'A키, 빠른 곡 (청년부가 부르던 곡)' },
      [s3a[1]?.id]: { writer: '예제 작사 이예제 / 작곡 박예제', source: '예제 자료집 48번', distinguish: 'E키, 느린 기도곡' },
    },
  };
}

// 예제 성도 명부 (지어낸 이름·번호·주소. 실제 인물 아님). 생일·심방·출석은 오늘 기준으로 맞춰 홈 화면 알림이 보이게 한다.
export function samplePeopleSeed(today = new Date()) {
  const t = ymd(today);
  const md = (n) => addDays(t, n).slice(5);
  const sun = ymd(sundayOf(today)) > t ? addDays(ymd(sundayOf(today)), -7) : t;   // 오늘이나 지난 주일
  const fam = { kim: uid(), park: uid() };
  const P = (name, o = {}) => ({ id: uid(), name, gender: '', birth: '', lunar: false, phone: '', address: '', role: '성도', group: '', baptism: '', registeredAt: '', status: 'active', familyId: '', relation: '', memo: '', createdAt: Date.now(), updatedAt: Date.now(), ...o });
  const list = [
    P('김믿음', { gender: '남', birth: `1962-${md(2)}`, phone: '010-0000-0001', address: '예제시 예제동 1', role: '장로', group: '1구역', baptism: '세례', baptismDate: '1985-04-07', baptismPlace: '예제교회', baptismBy: '예제 목사', registeredAt: '2009-03-01', familyId: fam.kim, relation: '세대주' }),
    P('이은혜', { gender: '여', birth: `1965-${md(40)}`, lunar: true, phone: '010-0000-0002', role: '권사', group: '1구역', baptism: '세례', registeredAt: '2009-03-01', familyId: fam.kim, relation: '배우자' }),
    P('김하늘', { gender: '여', birth: `2010-${md(5)}`, role: '학생', group: '청소년부', baptism: '유아세례', registeredAt: '2010-06-06', familyId: fam.kim, relation: '자녀' }),
    P('박소망', { gender: '남', birth: '1978-02-14', phone: '010-0000-0003', role: '집사', group: '2구역', baptism: '세례', registeredAt: '2015-09-13', familyId: fam.park, relation: '세대주' }),
    P('최기쁨', { gender: '여', birth: '1980-07-21', phone: '010-0000-0004', role: '집사', group: '2구역', baptism: '세례', registeredAt: '2015-09-13', familyId: fam.park, relation: '배우자' }),
    P('정사랑', { gender: '여', birth: `1941-${md(-1)}`, phone: '010-0000-0005', address: '예제시 예제요양원', role: '권사', group: '1구역', baptism: '세례', registeredAt: '1998-01-04', memo: '무릎이 불편하셔서 예배는 온라인으로 드리심' }),
    P('한평안', { gender: '남', birth: '1990-11-30', phone: '010-0000-0006', role: '성도', group: '청년', baptism: '학습', registeredAt: addDays(t, -20), memo: '새가족 (지인 소개)' }),
    P('윤온유', { gender: '여', birth: '1972-04-08', phone: '010-0000-0007', role: '성도', group: '2구역', baptism: '세례', registeredAt: '2020-05-10' }),
    P('서충성', { gender: '남', birth: '1955-09-02', phone: '010-0000-0008', role: '안수집사', group: '1구역', baptism: '세례', registeredAt: '2001-02-11', status: 'inactive', memo: '자녀 집 근처로 이사 준비 중' }),
  ];
  const id = (n) => list.find((m) => m.name === n).id;
  const V = (names, date, kind, note, planned = false) => { const v = { id: uid(), memberIds: names.map(id), date, kind, planned, note, createdAt: Date.now(), updatedAt: Date.now() }; return [v.id, v]; };
  const visits = Object.fromEntries([
    V(['정사랑'], addDays(t, 2), '심방', '요양원 방문, 성찬 준비', true),
    V(['한평안'], addDays(t, 4), '새가족', '새가족 2주차 만남', true),
    V(['박소망', '최기쁨'], addDays(t, -10), '심방', '가정 심방. 자녀 진학 위해 기도 부탁하심'),
    V(['윤온유'], addDays(t, -5), '전화', '최근 3주 결석, 몸살로 쉬고 계심. 이번 주 통화 다시'),
  ]);
  const regular = list.filter((m) => m.status === 'active' && !['정사랑', '한평안', '윤온유'].includes(m.name)).map((m) => m.id);
  const attendance = {};
  for (let w = 0; w < 4; w++) {
    const d = addDays(sun, -7 * w);
    attendance[d] = [...regular, ...(w <= 2 ? [id('한평안')] : []), ...(w === 3 ? [id('윤온유')] : [])];
  }
  return { members: Object.fromEntries(list.map((m) => [m.id, m])), visits, attendance };
}

// 예제 재정 (지어낸 금액). 최근 10주 주일 헌금 + 매달 고정 지출 + 올해 이월금.
export function sampleFinanceSeed(members = {}, today = new Date()) {
  const t = ymd(today);
  const byName = Object.fromEntries(Object.values(members).map((m) => [m.name, m.id]));
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const tx = {};
  let k = 0;
  const add = (date, type, fund, category, name, amount, note = '') => {
    const id = uid();
    tx[id] = { id, date, type, fund, category, name, memberId: byName[name] || '', amount, note, createdAt: Date.now() + k++, updatedAt: Date.now() };
  };
  const year = t.slice(0, 4);
  add(`${year}-01-01`, 'income', '일반재정', '일반이월금', '', 3200000, '지난해에서 넘어온 돈 (예제)');
  add(`${year}-01-01`, 'income', '특별재정', '특별이월금', '', 850000, '예제');
  const givers = ['김믿음', '이은혜', '박소망', '최기쁨', '윤온유', '한평안', '정사랑'];
  const lastSun = (() => { const d = new Date(t + 'T00:00:00'); return addDays(t, -d.getDay()); })();
  for (let w = 9; w >= 0; w--) {
    const d = addDays(lastSun, -7 * w);
    add(d, 'income', '일반재정', '주일헌금', '무명', 30000 + rnd(5) * 10000);
    for (const g of givers) {
      if (rnd(10) < 2) continue;   // 가끔 빠짐
      if (rnd(4) === 0) add(d, 'income', '일반재정', '십일조', g, (20 + rnd(30)) * 10000);
      if (rnd(3) === 0) add(d, 'income', '일반재정', '감사헌금', g, (1 + rnd(5)) * 10000);
    }
    if (w % 4 === 0) add(d, 'income', '특별재정', '선교헌금', givers[rnd(givers.length)], 50000);
  }
  const months = [...new Set(Array.from({ length: 10 }, (_, w) => addDays(lastSun, -7 * w).slice(0, 7)))].sort();
  for (const m of months) {
    add(`${m}-05`, 'expense', '일반재정', '임대료·관리비', '예제 건물주', 900000);
    add(`${m}-10`, 'expense', '일반재정', '목회자사례비', '', 1500000);
    add(`${m}-15`, 'expense', '일반재정', '교제비', '예제 식당', 120000 + rnd(5) * 10000, '주일 점심');
    add(`${m}-20`, 'expense', '특별재정', '선교비', '예제 선교회', 100000);
  }
  for (const v of Object.values(tx)) if (v.date > t) delete tx[v.id];   // 오늘 뒤 날짜는 빼기
  return {
    settings: { categories: structuredClone(DEFAULT_CATEGORIES), receipt: { regNo: '000-00-00000 (예제)', address: '예제시 예제동 1', representative: '예제 목사' } },
    tx, budgets: { [year]: { 주일헌금: 2500000, 십일조: 40000000, 감사헌금: 3000000, 목회자사례비: 18000000, '임대료·관리비': 10800000, 교제비: 1800000, 선교비: 1200000 } },
  };
}

// 예제 행정: 일정·회의록 (지어낸 내용)
export function sampleAdminSeed(members = {}, today = new Date()) {
  const t = ymd(today);
  const E = (d, title, kind, o = {}) => { const id = uid(); return [id, { id, date: addDays(t, d), endDate: '', time: '', title, kind, place: '', memo: '', createdAt: Date.now(), updatedAt: Date.now(), ...o }]; };
  const events = Object.fromEntries([
    E(3, '수요 기도회', '예배', { time: '19:30', place: '본당' }),
    E(6, '청소년부 수련회', '행사', { endDate: addDays(t, 7), place: '예제 수양관', memo: '참가비 3만원, 차량 2대' }),
    E(7, '제직회', '회의', { time: '13:30', place: '교육관', memo: '내년 예산안' }),
    E(14, '성탄 장식', '행사', { time: '14:00' }),
    E(-4, '구역장 모임', '회의', { time: '20:00' }),
  ]);
  const mid = uid();
  const minutes = { [mid]: {
    id: mid, date: addDays(t, -14), meeting: '제직회', title: '11월 정기 제직회', place: '교육관', attendees: '예제 목사, 김믿음 장로, 이은혜 권사, 박소망 집사, 최기쁨 집사 (5명)',
    content: '1. 개회 기도 (김믿음 장로)\n2. 지난 회의록 낭독 및 채택\n3. 보고\n  - 재정 보고: 10월 수입·지출 보고 (박소망 집사)\n  - 구역 보고\n4. 안건\n  - 추수감사주일 준비\n  - 성탄 행사 준비 위원 선정\n5. 폐회 기도',
    decisions: '1. 추수감사주일 예배 후 함께 식사한다 (식사 담당: 2구역)\n2. 성탄 행사 준비 위원: 이은혜 권사, 최기쁨 집사', chair: '예제 목사', recorder: '박소망', createdAt: Date.now(), updatedAt: Date.now(),
  } };
  return { events, minutes, certs: {} };
}

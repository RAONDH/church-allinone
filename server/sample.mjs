// 예제 자료: 처음 쓰는 목회자가 둘러보는 용도. 실제 교회 자료·실제 예배송출과 완전히 분리된다.
// 찬양 가사는 저작권 문제를 피하려고 예제용으로 직접 쓴 글이다 (실제 곡 아님).
import { uid } from './store.mjs';

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

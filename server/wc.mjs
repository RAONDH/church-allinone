// 예배송출(worship-caster) 연결.
// 실제 교회 자료: 이 컴퓨터에서 켜진 예배송출(기본 http://127.0.0.1:5300)의 API를 서버끼리 부른다.
//   (예배송출은 같은 컴퓨터에서 온 요청을 PIN 없이 받고, 브라우저의 다른 주소에서 온 요청은 막는다 → 반드시 이 서버가 대신 부름)
// 예제 자료: 실제 예배송출을 건드리지 않도록 같은 규칙으로 움직이는 '가상 예배송출'을 파일 하나로 흉내 낸다.
import fs from 'node:fs';
import { uid } from './store.mjs';

const SONG_TYPES = new Set(['song', 'score']);

export function httpWc(base) {
  async function call(method, p, body) {
    let r;
    try {
      r = await fetch(base + p, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw Object.assign(new Error('예배송출이 켜져 있지 않거나 연결할 수 없습니다.'), { code: 'WC_OFFLINE' });
    }
    if (!r.ok) throw new Error(`예배송출이 요청을 거절했습니다 (${r.status}).`);
    return r.json();
  }
  return {
    kind: 'http',
    base,
    state: () => call('GET', '/api/state'),
    createService: (b) => call('POST', '/api/services', b),
    updateService: (id, b) => call('PUT', `/api/services/${id}`, b),
    setCurrent: (id) => call('PUT', '/api/current-service', { id }),
    addItem: (b) => call('POST', '/api/items', b),
    updateItem: (id, b) => call('PUT', `/api/items/${id}`, b),
    setProps: (props) => call('PUT', '/api/props', { props }),
  };
}

// ── 가상 예배송출 (예제 모드 전용) ─────────────────────────
const SUNDAY_STEPS = [
  ['지금은 기도로\n예배를 준비하는 시간입니다', 'prayer'], ['예배의 부름', 'title'], ['경배와 찬양', 'title'],
  ['신앙고백\n사도신경', 'title'], ['대표 기도\n(기도하실 분)', 'title'], ['성경 봉독\n(본문)', 'title'],
  ['말씀 선포\n(설교 제목)', 'title'], ['응답의 찬양', 'title'], ['봉헌\n감사의 예물을 드립니다', 'title'],
  ['교회 소식\n(광고)', 'notice'], ['축도', 'title'], ['예배를 마칩니다\n한 주간도 주님과 동행하세요', 'title'],
];
export const TEMPLATES = [['sunday', '주일 예배'], ['', '빈 순서']];

export function memoryWc(file, seed) {
  let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : seed();
  const save = () => fs.writeFileSync(file, JSON.stringify(db, null, 1));
  const ok = (v) => Promise.resolve(structuredClone(v));
  function addItem(b) {
    const it = {
      id: uid(), title: b.title || '새 자료', type: b.type || 'song',
      slides: (b.slides || []).map((s) => ({ id: s.id || uid(), ...s })),
      arr: b.arr || [], key: b.key || '', bpm: b.bpm || 0, memo: b.memo || '', theme: b.theme || '', updatedAt: Date.now(),
    };
    db.items.push(it);
    if (b.place || !SONG_TYPES.has(it.type)) db.services.find((s) => s.id === db.currentServiceId)?.itemIds.push(it.id);
    return it;
  }
  function prune() {
    const used = new Set(db.services.flatMap((s) => s.itemIds));
    db.items = db.items.filter((i) => SONG_TYPES.has(i.type) || used.has(i.id));
  }
  return {
    kind: 'memory',
    base: '예제용 가상 예배송출',
    reset() { db = seed(); save(); },
    state: () => ok({ items: db.items, services: db.services, currentServiceId: db.currentServiceId, props: db.props, live: { itemId: null } }),
    createService(b) {
      const s = { id: uid(), name: b.name || '새 예배', date: b.date, itemIds: [] };
      db.services.push(s); db.currentServiceId = s.id;
      if (b.template === 'sunday') for (const [text, theme] of SUNDAY_STEPS) addItem({ type: 'text', title: text.split('\n')[0], theme, slides: [{ text }] });
      save(); return ok(s);
    },
    updateService(id, b) {
      const s = db.services.find((x) => x.id === id);
      if (!s) return Promise.reject(new Error('예배 순서를 찾을 수 없습니다.'));
      Object.assign(s, { name: b.name ?? s.name, date: b.date ?? s.date, itemIds: b.itemIds ?? s.itemIds });
      if (b.note !== undefined) s.note = b.note;
      prune(); save(); return ok(s);
    },
    setCurrent(id) { db.currentServiceId = id; save(); return ok({ ok: true }); },
    addItem(b) { const it = addItem(b); save(); return ok(it); },
    updateItem(id, b) {
      const it = db.items.find((i) => i.id === id);
      if (!it) return Promise.reject(new Error('자료를 찾을 수 없습니다.'));
      for (const k of ['title', 'slides', 'arr', 'key', 'bpm', 'memo', 'theme']) if (b[k] !== undefined) it[k] = b[k];
      it.slides = it.slides.map((s) => ({ id: s.id || uid(), ...s }));
      it.updatedAt = Date.now(); save(); return ok(it);
    },
    setProps(props) { db.props = props.map((p) => ({ id: p.id || uid(), ...p })); save(); return ok(db.props); },
  };
}

// ── 예배 정보 ↔ 예배송출 순서 연결 ─────────────────────────
// 예배송출 주일 템플릿의 '성경 봉독\n(본문)', '말씀 선포\n(설교 제목)', '교회 소식\n(광고)' 자막을 찾아
// 라온 교회 올인원에 입력한 본문·설교 제목·광고로 채운다. 같은 내용을 두 번 입력하지 않게 하는 핵심 연결.
const firstLine = (it) => String(it?.slides?.[0]?.text || '').split('\n')[0].trim();
const allText = (it) => (it?.slides || []).map((s) => s.text).join('\n');

export function findLinks(state, serviceId) {
  const svc = state.services.find((s) => s.id === serviceId);
  if (!svc) return null;
  const items = svc.itemIds.map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
  const pick = (re, firstRe) => items.find((i) => i.type === 'text' && (re.test(allText(i)) || firstRe.test(firstLine(i))))?.id || null;
  return {
    passage: pick(/\(본문\)/, /^(성경 봉독|성경봉독|말씀 봉독)$/),
    title: pick(/\(설교 제목\)/, /^(말씀 선포|말씀|설교)$/),
    notice: pick(/\(광고\)/, /^(교회 소식|광고)$/),
    prayer: pick(/\(기도하실 분\)/, /^(대표 기도|대표기도|기도)$/),
  };
}

/** shared: false 면 함께 쓰는 이름 자막은 그 예배가 예배송출에서 지금 고른 예배일 때만 바꾼다 */
export async function applyWeek(wc, week, { shared = true } = {}) {
  const link = week.wc;
  if (!link?.serviceId) return { skipped: true };
  const state = await wc.state();
  const svc = state.services.find((s) => s.id === link.serviceId);
  if (!svc) throw new Error('연결된 예배송출 예배 순서가 지워졌습니다. 다시 연결해 주세요.');
  const done = [];
  if (svc.name !== week.name || svc.date !== week.date) { await wc.updateService(svc.id, { name: week.name, date: week.date }); done.push('예배 이름·날짜'); }
  const byId = (id) => state.items.find((i) => i.id === id);
  async function setText(id, head, body, what) {
    const it = byId(id);
    if (!it) return;
    const h = firstLine(it) || head;
    const text = `${h}\n${body}`;
    if (it.slides.length === 1 && it.slides[0].text === text) return;
    await wc.updateItem(id, { slides: [{ ...it.slides[0], text }] });
    done.push(what);
  }
  // 예전에 연결해 두어 아직 모르는 자막이 있으면 지금 순서에서 찾아 둔다
  const found = findLinks(state, svc.id);
  const l = (link.links ||= {});
  for (const k of Object.keys(found)) if (l[k] === undefined) l[k] = found[k];
  if (l.passage) await setText(l.passage, '성경 봉독', week.passage?.trim() || '(본문)', '본문');
  if (l.title) await setText(l.title, '말씀 선포', week.sermonTitle?.trim() || '(설교 제목)', '설교 제목');
  if (l.prayer) await setText(l.prayer, '대표 기도', week.prayerLeader?.trim() || '(기도하실 분)', '대표 기도자');
  if (l.notice) {
    const it = byId(l.notice);
    const lines = (week.announcements || []).map((a) => a.trim()).filter(Boolean);
    const slides = lines.length ? [{ text: firstLine(it) || '교회 소식' }, ...lines.map((text) => ({ text }))] : [{ text: `${firstLine(it) || '교회 소식'}\n(광고)` }];
    const cur = (it?.slides || []).map((s) => s.text);
    if (it && JSON.stringify(cur) !== JSON.stringify(slides.map((s) => s.text))) {
      await wc.updateItem(l.notice, { slides: slides.map((s, i) => ({ ...(it.slides[i]?.id ? { id: it.slides[i].id } : {}), ...s })) });
      done.push('광고');
    }
  }
  // 이름 자막 중 '설교'가 들어간 것의 아랫줄을 설교 제목으로 (예: 설교 · 담임목사 / 오늘의 제목)
  if (week.sermonTitle?.trim() && Array.isArray(state.props) && (shared || state.currentServiceId === svc.id)) {
    const props = state.props.map((p) => (/설교/.test(p.text) ? { ...p, sub: week.sermonTitle.trim() } : p));
    if (JSON.stringify(props) !== JSON.stringify(state.props)) { await wc.setProps(props); done.push('설교자 이름 자막'); }
  }
  return { done };
}

// 지난 예배 순서를 복사해 새 예배 순서 만들기.
// 찬양(곡)은 같은 곡을 다시 쓰고, 순서 자막·광고 같은 자료는 새로 복사한다
// (같은 자막을 두 주가 함께 쓰면 이번 주 설교 제목을 고칠 때 지난주 것도 바뀌기 때문).
export async function copyService(wc, fromServiceId, { name, date }) {
  const state = await wc.state();
  const from = state.services.find((s) => s.id === fromServiceId);
  if (!from) throw new Error('복사할 지난 예배 순서를 예배송출에서 찾을 수 없습니다.');
  const svc = await wc.createService({ name, date, template: '' });
  const ids = [];
  const map = {};
  for (const id of from.itemIds) {
    const it = state.items.find((i) => i.id === id);
    if (!it) continue;
    if (SONG_TYPES.has(it.type)) { ids.push(it.id); continue; }
    const { id: _, updatedAt, ...rest } = it;
    const copy = await wc.addItem({ ...rest, slides: it.slides.map(({ id: __, ...s }) => s) });
    ids.push(copy.id); map[it.id] = copy.id;
  }
  await wc.updateService(svc.id, { itemIds: ids, note: from.note || '' });
  return { service: { ...svc, itemIds: ids }, map };
}

// 예배송출 순서의 준비 상태 요약 (화면 표시용)
export function summarize(state, serviceId) {
  const svc = state.services.find((s) => s.id === serviceId);
  if (!svc) return null;
  const items = svc.itemIds.map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
  const songs = items.filter((i) => SONG_TYPES.has(i.type));
  const placeholders = [];
  for (const it of items) for (const m of allText(it).match(/\((기도하실 분|본문|설교 제목|광고|날짜·시간|＋[^)]*)\)/g) || []) placeholders.push({ itemId: it.id, title: it.title, text: m });
  return {
    id: svc.id, name: svc.name, date: svc.date, note: svc.note || '',
    isCurrent: state.currentServiceId === svc.id,
    items: items.map((i) => ({
      id: i.id, type: i.type, title: i.title, key: i.key || '', bpm: i.bpm || 0, memo: i.memo || '', arr: i.arr || [],
      slideCount: (i.slides || []).length, labels: [...new Set((i.slides || []).map((s) => s.label).filter(Boolean))],
      // 자막 탭에서 장마다 무슨 글이 나가는지 보이게 (글은 앞부분만, 그림·HTML 장은 표시만)
      slides: (i.slides || []).map((s) => ({ text: String(s.text || '').slice(0, 400), label: s.label || '', media: (s.text || '').trim() ? '' : s.html || s.htmlFile ? 'HTML' : s.bg ? '그림' : '' })),
      empty: !(i.slides || []).some((s) => (s.text || '').trim() || s.bg || s.html || s.htmlFile),
    })),
    songCount: songs.length,
    songsWithoutLyrics: songs.filter((s) => !(s.slides || []).some((x) => (x.text || '').trim() || x.bg)).map((s) => s.title),
    songsWithoutKey: songs.filter((s) => !s.key).map((s) => s.title),
    placeholders,
    slideTotal: items.reduce((n, i) => n + (i.slides || []).length, 0),
  };
}

// 확정본: 예배에 쓸 순서·자막을 그대로 떠 둔 것
export function snapshot(state, serviceId) {
  const svc = state.services.find((s) => s.id === serviceId);
  if (!svc) return null;
  const items = svc.itemIds.map((id) => state.items.find((i) => i.id === id)).filter(Boolean)
    .map(({ id, type, title, slides, arr, key, bpm, memo, theme }) => ({ id, type, title, slides: slides.map(({ id: sid, ...s }) => ({ id: sid, ...s })), arr, key, bpm, memo, theme }));
  return { serviceId, name: svc.name, date: svc.date, itemIds: [...svc.itemIds], items };
}

export function fingerprint(snap) {
  if (!snap) return '';
  return JSON.stringify([snap.itemIds, snap.items.map((i) => [i.id, i.title, i.arr, i.key, i.slides.map((s) => [s.text, s.label || '', s.bg || ''])])]);
}

export function diffSnapshots(a, b) {
  if (!a || !b) return [];
  const out = [];
  if (JSON.stringify(a.itemIds) !== JSON.stringify(b.itemIds)) out.push('순서가 바뀌었거나 자료가 추가·삭제됨');
  const bm = new Map(b.items.map((i) => [i.id, i]));
  for (const i of a.items) {
    const j = bm.get(i.id);
    if (!j) continue;
    if (JSON.stringify(i.slides.map((s) => s.text)) !== JSON.stringify(j.slides.map((s) => s.text))) out.push(`‘${i.title}’ 자막 내용`);
    else if (JSON.stringify(i.arr) !== JSON.stringify(j.arr)) out.push(`‘${i.title}’ 곡 구성 순서`);
    else if (i.key !== j.key) out.push(`‘${i.title}’ 조성`);
  }
  return out;
}

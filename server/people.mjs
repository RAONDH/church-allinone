// 성도 명부 · 심방 기록 · 출석 (라온 교회 올인원 자료 파일 안에 함께 저장)
// 성도 정보는 민감한 개인정보라 이 컴퓨터 밖으로 보내지 않는다: AI 프롬프트·외부 주소 어디에도 쓰지 않음.
import { uid } from './store.mjs';

// 이 컴퓨터 시간대 기준 오늘 (toISOString 은 UTC라 아침 9시 전엔 어제가 됨)
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const str = (v, n = 200) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
const oneOf = (list, v, d = '') => (list.includes(v) ? v : d);
export const STATUSES = ['active', 'inactive', 'absent', 'moved', 'deceased', 'other'];
const STATUS_FROM_LABEL = { 재적: 'active', '쉬는 중': 'inactive', 쉬는중: 'inactive', 휴면: 'inactive', 비출석: 'absent', 이명: 'moved', 별세: 'deceased', 소천: 'deceased', 기타: 'other' };
export const BAPTISMS = ['', '학습', '세례', '유아세례', '입교'];
export const VISIT_KINDS = ['심방', '전화', '병원', '새가족', '상담', '기타'];

// 날짜 글자를 YYYY-MM-DD (생일은 MM-DD 만도 허용) 로 맞춤. 1965.3.2 / 19650302 / 3/2 같은 입력도 받는다.
export function normDate(v, { monthDayOk = false } = {}) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[.\-/\s년]*(\d{1,2})[.\-/\s월]*(\d{1,2})일?\.?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : '';
  m = s.match(/^(\d{1,2})[.\-/\s월]+(\d{1,2})일?\.?$/);
  if (m && monthDayOk) return valid(2000, +m[1], +m[2]) ? `${pad(m[1])}-${pad(m[2])}` : '';
  return '';
}
const pad = (x) => String(x).padStart(2, '0');
const valid = (y, mo, d) => mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(y, mo, 0).getDate() && y >= 1900 && y <= 2100;

const FIELDS = {
  name: (v) => str(v, 40).trim(),
  gender: (v) => oneOf(['남', '여', ''], String(v ?? '').trim().replace(/^(남자|남성|M)$/i, '남').replace(/^(여자|여성|F)$/i, '여')),
  birth: (v) => normDate(v, { monthDayOk: true }),
  lunar: (v) => v === true || /^(true|1|음|음력|y|o)$/i.test(String(v ?? '').trim()),
  lunarLeap: (v) => v === true || /^(true|1|윤|윤달)$/i.test(String(v ?? '').trim()),
  phone: (v) => str(v, 30).trim(),
  address: (v) => str(v, 200).trim(),
  role: (v) => str(v, 20).trim(),
  group: (v) => str(v, 30).trim(),
  baptism: (v) => oneOf(BAPTISMS, String(v ?? '').trim()),
  registeredAt: (v) => normDate(v),
  baptismDate: (v) => normDate(v),
  baptismPlace: (v) => str(v, 60).trim(),
  baptismBy: (v) => str(v, 30).trim(),
  // 명부 파일에서 다시 넣을 때는 '이명'·'별세' 같은 말로 와도 알아듣는다 (내보내기·가져오기 왕복)
  status: (v) => oneOf(STATUSES, v, '') || STATUS_FROM_LABEL[String(v ?? '').trim()] || 'active',
  relation: (v) => str(v, 20).trim(),
  memo: (v) => str(v, 3000),
};
export function cleanMember(b, { partial = false } = {}) {
  const out = {};
  for (const [k, f] of Object.entries(FIELDS)) if (!partial || b[k] !== undefined) out[k] = f(b[k]);
  return out;
}
export const emptyMember = () => ({ ...cleanMember({}), familyId: '' });

export const FIELD_LABEL = { name: '이름', gender: '성별', birth: '생일', lunar: '음력', lunarLeap: '윤달', phone: '전화', address: '주소', role: '직분', group: '구역', baptism: '세례', registeredAt: '등록일', baptismDate: '세례일', baptismPlace: '세례 교회', baptismBy: '집례자', status: '상태', relation: '가족 관계', memo: '메모' };
/** 고친 칸 가운데, 다른 창이 먼저 다른 값으로 바꾼 칸 (_base 가 없으면 예전 방식으로 그대로 저장) */
export function memberConflicts(m, patch, base) {
  if (!base || typeof base !== 'object') return [];
  const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
  const out = [];
  for (const k of Object.keys(patch)) {
    if (!Object.prototype.hasOwnProperty.call(base, k) || !FIELDS[k]) continue;
    const was = FIELDS[k](base[k]);
    if (!same(m[k], was) && !same(m[k], patch[k])) out.push({ field: k, label: FIELD_LABEL[k] || k, current: m[k] });
  }
  return out;
}

/** 출석 합치기: 이 창이 처음 본 명단(base)에서 더하고 뺀 것만 지금 명단에 반영한다 (다른 창이 그사이 체크한 분을 지우지 않게) */
export function mergeAttendance(current, base, next) {
  if (!Array.isArray(base)) return next;
  const b = new Set(base), n = new Set(next);
  const added = next.filter((id) => !b.has(id)), removed = new Set(base.filter((id) => !n.has(id)));
  return [...new Set([...(current || []).filter((id) => !removed.has(id)), ...added])];
}

/** 그 번호의 성도가 있는지 ('__proto__'·'constructor' 같은 이름이 성도로 통과하지 않게 자기 칸만 본다) */
export const hasMember = (db, id) => typeof id === 'string' && !!db.members && Object.prototype.hasOwnProperty.call(db.members, id);

function cleanVisit(b, db) {
  const ids = (Array.isArray(b.memberIds) ? b.memberIds : []).filter((id) => hasMember(db, id));
  if (!ids.length) throw Object.assign(new Error('심방 대상 성도를 한 분 이상 골라 주세요.'), { code: 400 });
  const date = normDate(b.date);
  if (!date) throw Object.assign(new Error('날짜를 입력해 주세요.'), { code: 400 });
  return { memberIds: [...new Set(ids)].slice(0, 30), date, kind: oneOf(VISIT_KINDS, b.kind, '심방'), planned: !!b.planned, note: str(b.note, 5000) };
}

// 가족으로 묶기: 고른 분의 가족 번호를 같이 쓴다 (없으면 새로 만들어 두 분 모두에게)
function joinFamily(db, m, withId) {
  if (withId === undefined) return;
  if (!withId) { m.familyId = ''; return; }
  const other = hasMember(db, withId) ? db.members[withId] : null;
  if (!other || other.id === m.id) return;
  if (!other.familyId) other.familyId = uid();
  m.familyId = other.familyId;
}

const CSV_COLS = [['name', '이름'], ['gender', '성별'], ['birth', '생일'], ['lunar', '음력'], ['lunarLeap', '윤달'], ['phone', '전화'], ['address', '주소'], ['role', '직분'], ['group', '구역'], ['baptism', '세례'], ['registeredAt', '등록일'], ['status', '상태'], ['family', '가족'], ['relation', '관계'], ['memo', '메모']];
const STATUS_LABEL = { active: '재적', inactive: '쉬는 중', absent: '비출석', moved: '이명', deceased: '별세', other: '기타' };
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // 엑셀에서 수식으로 실행되지 않게
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function membersCsv(db) {
  const ms = Object.values(db.members).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  // 가족은 가족 중 가장 먼저 등록된 분 이름으로 표시 (다시 붙여 넣을 때 같은 이름끼리 묶임)
  const head = {};
  for (const m of [...ms].sort((a, b) => a.createdAt - b.createdAt)) if (m.familyId && !head[m.familyId]) head[m.familyId] = m.name;
  const rows = ms.map((m) => CSV_COLS.map(([k]) => (k === 'family' ? (m.familyId ? head[m.familyId] : '') : k === 'lunar' ? (m.lunar ? '음력' : '') : k === 'lunarLeap' ? (m.lunar && m.lunarLeap ? '윤달' : '') : k === 'status' ? STATUS_LABEL[m.status] : m[k])));
  return '﻿' + [CSV_COLS.map((c) => c[1]), ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** 성도·심방·출석 API. 처리했으면 true, 이 모듈 주소가 아니면 false. */
export async function peopleApi({ sub, req, res, db, save, body, send, HttpError }) {
  let q;
  const s = (re) => sub.match(re);
  db.members ??= {}; db.visits ??= {}; db.attendance ??= {};
  const getMember = (id) => { const m = hasMember(db, id) ? db.members[id] : null; if (!m) throw new HttpError(404, '성도를 찾을 수 없습니다.'); return m; };
  const wrap = (fn) => { try { return fn(); } catch (e) { throw e.code === 400 ? new HttpError(400, e.message) : e; } };

  if (sub === '/people' && req.method === 'GET') {
    send(res, 200, { members: Object.values(db.members), visits: Object.values(db.visits), attendance: db.attendance });
    return true;
  }
  if (sub === '/people/export.csv' && req.method === 'GET') {
    const day = localDay();
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="members-${day}.csv"; filename*=UTF-8''${encodeURIComponent(`성도명부-${day}.csv`)}` });
    res.end(membersCsv(db));
    return true;
  }
  if (sub === '/members' && req.method === 'POST') {
    const b = await body(req);
    const m = { id: uid(), ...emptyMember(), ...cleanMember(b), createdAt: Date.now(), updatedAt: Date.now() };
    if (!m.name) throw new HttpError(400, '이름을 입력해 주세요.');
    db.members[m.id] = m;
    joinFamily(db, m, b.familyWith);
    await save();
    send(res, 200, { member: m });
    return true;
  }
  // 엑셀에서 붙여 넣은 여러 분을 한 번에 (같은 '가족' 글자끼리 한 가족으로)
  if (sub === '/members/bulk' && req.method === 'POST') {
    const b = await body(req);
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 3000);
    const fam = {};
    let added = 0;
    for (const row of rows) {
      const m = { id: uid(), ...emptyMember(), ...cleanMember(row || {}), createdAt: Date.now() + added, updatedAt: Date.now() };
      if (!m.name) continue;
      const key = str(row.family, 40).trim();
      if (key) m.familyId = fam[key] ||= uid();
      db.members[m.id] = m; added++;
    }
    if (!added) throw new HttpError(400, '넣을 성도가 없습니다. 첫 줄에 "이름" 칸이 있는지 확인해 주세요.');
    await save();
    send(res, 200, { added });
    return true;
  }
  if ((q = s(/^\/members\/([a-f0-9]+)$/))) {
    const m = getMember(q[1]);
    if (req.method === 'PUT') {
      const b = await body(req);
      const patch = cleanMember(b, { partial: true });
      if (patch.name === '') throw new HttpError(400, '이름은 비워 둘 수 없습니다.');
      // 두 창 충돌: 고친 칸의 처음 값(_base)을 받았으면, 그사이 다른 창이 그 칸을 다르게 바꿨는지 본다 (먼저 저장한 내용을 덮어쓰지 않게)
      const conflicts = memberConflicts(m, patch, b._base);
      if (conflicts.length) { send(res, 409, { error: `다른 창에서 이 성도의 ${conflicts.map((c) => c.label).join('·')}을(를) 먼저 바꿨습니다. 최신 내용을 확인한 뒤 다시 고쳐 주세요.`, conflicts }); return true; }
      Object.assign(m, patch, { updatedAt: Date.now() });
      joinFamily(db, m, b.familyWith);
      await save();
      send(res, 200, { member: m });
      return true;
    }
    if (req.method === 'DELETE') {
      delete db.members[m.id];
      // 이분만 대상이던 심방 기록은 함께 지우고, 여러 분 기록에서는 이름만 뺀다
      for (const v of Object.values(db.visits)) {
        v.memberIds = v.memberIds.filter((id) => id !== m.id);
        if (!v.memberIds.length) delete db.visits[v.id];
      }
      for (const d of Object.keys(db.attendance)) {
        db.attendance[d] = db.attendance[d].filter((id) => id !== m.id);
        if (!db.attendance[d].length) delete db.attendance[d];   // 빈 날을 '모두 결석'으로 세지 않게
      }
      if (db.serve) {   // 봉사표: 지난 기록은 이름으로 남기고, 맡는 분 목록에서는 뺀다
        for (const r of db.serve.roles) r.pool = r.pool.filter((id) => id !== m.id);
        for (const day of Object.values(db.serve.plan)) for (const k of Object.keys(day)) day[k] = day[k].map((x) => (x === m.id ? m.name : x));
      }
      await save();
      send(res, 200, { ok: true });
      return true;
    }
  }
  if (sub === '/visits' && req.method === 'POST') {
    const b = await body(req);
    const v = { id: uid(), ...wrap(() => cleanVisit(b, db)), createdAt: Date.now(), updatedAt: Date.now() };
    db.visits[v.id] = v;
    await save();
    send(res, 200, { visit: v });
    return true;
  }
  if ((q = s(/^\/visits\/([a-f0-9]+)$/))) {
    const v = db.visits[q[1]];
    if (!v) throw new HttpError(404, '심방 기록을 찾을 수 없습니다.');
    if (req.method === 'PUT') {
      const b = await body(req);
      Object.assign(v, wrap(() => cleanVisit(b, db)), { updatedAt: Date.now() });
      await save();
      send(res, 200, { visit: v });
      return true;
    }
    if (req.method === 'DELETE') {
      delete db.visits[v.id];
      await save();
      send(res, 200, { ok: true });
      return true;
    }
  }
  // 출석: 그날 출석한 성도 번호 목록을 통째로 저장 (빈 목록이면 그날 기록을 없앰)
  if ((q = s(/^\/attendance\/(\d{4}-\d{2}-\d{2})$/)) && req.method === 'PUT') {
    if (!normDate(q[1])) throw new HttpError(400, '날짜가 올바르지 않습니다.');
    const b = await body(req);
    const next = [...new Set((Array.isArray(b.memberIds) ? b.memberIds : []).filter((id) => hasMember(db, id)))];
    const ids = mergeAttendance(db.attendance[q[1]], Array.isArray(b._base) ? b._base.filter((id) => typeof id === 'string') : null, next).filter((id) => hasMember(db, id));
    if (ids.length) db.attendance[q[1]] = ids; else delete db.attendance[q[1]];
    await save();
    send(res, 200, { date: q[1], memberIds: ids });
    return true;
  }
  return false;
}

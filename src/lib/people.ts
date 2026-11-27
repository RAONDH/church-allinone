// 성도 명부 계산 (화면·시험에서 함께 씀). 오늘 날짜는 밖에서 넣어 시험할 수 있게 한다.
import type { Cert, Member, Minutes, People, Serve, Tx, Visit } from './types';
import { serveOf } from './serve';
import { addDays, ymd } from './week';
import { lunarToSolar } from './lunar';

export const STATUS_LABEL: Record<Member['status'], string> = { active: '재적', inactive: '쉬는 중', absent: '비출석', moved: '이명', deceased: '별세', other: '기타' };
/** 가족 관계 고르기 (예전에 직접 적은 다른 말도 그대로 둔다) */
export const RELATIONS = ['세대주', '배우자', '자녀', '부모', '기타'];
/** 직분 고르기 도움말 (직접 적어도 됨) */
export const ROLES = ['목사', '부목사', '전도사', '장로', '안수집사', '권사', '집사', '성도', '학생'];
export const VISIT_KINDS = ['심방', '전화', '병원', '새가족', '상담', '기타'];
export const BAPTISMS = ['', '학습', '세례', '유아세례', '입교'];
/** 지금 교회 식구 (이명·별세가 아닌 분): 재적·쉬는 중·비출석·기타. 생일·심방·봉사·증명서 대상 */
export const isCurrent = (m: Pick<Member, 'status'>) => m.status !== 'moved' && m.status !== 'deceased';

const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);

/** 다가오는 생일 (birth: YYYY-MM-DD 또는 MM-DD). 2월 29일생은 평년엔 2월 28일.
 *  음력 생일(lunar)은 그해 음력 날짜를 양력으로 바꿔 계산한다 (leap: 윤달생, 그해 윤달이 없으면 평달). */
export function nextBirthday(birth: string, today: string, opt: { lunar?: boolean; lunarLeap?: boolean } = {}): { date: string; days: number; age: number | null; lunar?: boolean } | null {
  const m = birth.match(/^(?:(\d{4})-)?(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y0 = +today.slice(0, 4);
  if (opt.lunar) {
    // 음력 설은 양력 1~2월이라, 지난해 음력 생일이 올해 양력 초에 올 수 있다
    for (const y of [y0 - 1, y0, y0 + 1]) {
      const date = lunarToSolar(y, +m[2], +m[3], !!opt.lunarLeap);
      if (!date) continue;
      const days = daysBetween(today, date);
      if (days >= 0) return { date, days, age: m[1] ? y - +m[1] : null, lunar: true };
    }
    return null;
  }
  for (const y of [y0, y0 + 1]) {
    let mo = +m[2], d = +m[3];
    if (mo === 2 && d === 29 && new Date(y, 1, 29).getMonth() !== 1) d = 28;
    const date = ymd(new Date(y, mo - 1, d));
    const days = daysBetween(today, date);
    if (days >= 0) return { date, days, age: m[1] ? y - +m[1] : null };
  }
  return null;
}

export function upcomingBirthdays(members: Member[], today: string, within = 7) {
  return members.filter(isCurrent)
    .map((m) => ({ m, b: nextBirthday(m.birth, today, m) }))
    .filter((x): x is { m: Member; b: NonNullable<ReturnType<typeof nextBirthday>> } => !!x.b && x.b.days <= within)
    .sort((a, b) => a.b.days - b.b.days);
}

/** 예정된 심방 중 기한이 지났거나 within일 안에 있는 것 */
export function dueVisits(visits: Visit[], today: string, within = 7) {
  const end = addDays(today, within);
  return visits.filter((v) => v.planned && v.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}

/** 성도별 마지막으로 다녀온(예정 아님) 심방 날짜 */
export function lastVisitMap(visits: Visit[]) {
  const out: Record<string, string> = {};
  for (const v of visits) if (!v.planned) for (const id of v.memberIds) if (!out[id] || out[id] < v.date) out[id] = v.date;
  return out;
}

// 그 날짜가 든 주의 주일 (일요일 시작)
const weekOf = (d: string) => addDays(d, -new Date(d + 'T00:00:00').getDay());
/** 출석을 기록한 주 묶음 (오늘까지, 주일 날짜 → 그 주에 기록한 날짜들), 오래된 주부터 */
function recordedWeeks(p: People, today: string) {
  const out = new Map<string, string[]>();
  for (const d of Object.keys(p.attendance).filter((d) => d <= today).sort()) {
    const w = weekOf(d);
    out.set(w, [...(out.get(w) || []), d]);
  }
  return [...out.values()];
}
/** 출석을 기록한 서로 다른 주의 수 */
export const attendanceWeeks = (p: People, today: string) => recordedWeeks(p, today).length;

/** 출석을 기록한 최근 n주에 한 번도 오지 않은 재적 성도 (한 주에 여러 번 기록해도 한 주로 세고, 그 주 어느 예배든 왔으면 출석).
 *  그 기간에 등록한 분은 뺌. 기록한 주가 n주가 안 되면 빈 목록. */
export function absentees(p: People, today: string, n = 3) {
  const weeks = recordedWeeks(p, today).slice(-n);
  if (weeks.length < n) return [];
  const dates = weeks.flat();
  const came = new Set(dates.flatMap((d) => p.attendance[d]));
  return p.members.filter((m) => m.status === 'active' && !came.has(m.id) && (!m.registeredAt || m.registeredAt <= dates[0]));
}

export function familyOf(members: Member[], m: Member) {
  return m.familyId ? members.filter((x) => x.familyId === m.familyId && x.id !== m.id) : [];
}

export function ageOf(birth: string, today: string) {
  const m = birth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  let a = +today.slice(0, 4) - +m[1];
  if (today.slice(5) < `${m[2]}-${m[3]}`) a--;
  return a;
}

// 엑셀·한글 표에서 복사해 붙여 넣은 글을 성도 목록으로 (첫 줄은 칸 이름)
const HEAD: [RegExp, string][] = [
  [/^(이름|성명|성도명|교인명)$/, 'name'], [/^성별$/, 'gender'], [/^(생일|생년월일|생년)$/, 'birth'], [/^(음력|양\/?음)$/, 'lunar'],
  [/^(전화|연락처|휴대폰|핸드폰|전화번호|휴대전화)$/, 'phone'], [/^주소$/, 'address'], [/^(직분|직책)$/, 'role'],
  [/^(구역|소그룹|목장|셀|교구|부서)$/, 'group'], [/^(세례|세례여부|신급)$/, 'baptism'], [/^(등록일|등록일자|등록)$/, 'registeredAt'],
  [/^(가족|세대주|가정)$/, 'family'], [/^(관계|가족관계)$/, 'relation'], [/^(메모|비고|특이사항)$/, 'memo'],
  [/^(상태|교적상태|교적)$/, 'status'], [/^윤달$/, 'lunarLeap'],
];
export function parsePaste(text: string): { rows: Record<string, string>[]; columns: string[]; unknown: string[] } {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = src.split('\n').find((l) => l.trim()) || '';
  if (!first) return { rows: [], columns: [], unknown: [] };
  const sep = first.includes('\t') ? '\t' : ',';
  // 따옴표로 묶은 칸 안의 줄바꿈(여러 줄 메모)은 한 칸으로 읽는다 (줄마다 나누면 메모 둘째 줄이 가짜 성도가 됨)
  const table = splitTable(src, sep).map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
  const headRow = table[0];
  const head = headRow.map((h) => HEAD.find(([re]) => re.test(h.replace(/\s/g, '')))?.[1] || '');
  if (!head.includes('name')) {
    // 칸 이름이 없으면 한 줄에 한 분, 첫 칸은 이름
    return { rows: table.map((r) => ({ name: r[0] })).filter((r) => r.name), columns: ['name'], unknown: [] };
  }
  const unknown = headRow.filter((_, i) => !head[i] && headRow[i]);
  const rows = table.slice(1).map((cells) => {
    const r: Record<string, string> = {};
    head.forEach((k, i) => { if (k && cells[i]) r[k] = cells[i]; });
    if (r.lunar && /^양/.test(r.lunar)) delete r.lunar;
    for (const k of Object.keys(r)) r[k] = r[k].replace(/^'(?=[=+\-@])/, '');   // 내보낼 때 수식으로 실행되지 않게 붙인 ' 떼기
    return r;
  }).filter((r) => r.name);
  return { rows, columns: head.filter(Boolean), unknown };
}
/** 쉼표·탭으로 나눈 표 읽기. 따옴표 안의 쉼표·줄바꿈·"" 는 칸 안의 글자로 */
export function splitTable(text: string, sep: string) {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"' && cur.trim() === '') { q = true; cur = ''; }
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** 오늘이 주일이면 오늘, 아니면 지난 주일 */
export function lastSunday(today: string) {
  const d = new Date(today + 'T00:00:00');
  return addDays(today, -d.getDay());
}

// ── 성도 한 분의 기록 모아보기 (명부·심방·출석·헌금·증명서·봉사·회의록) ──
export type HistKind = 'church' | 'visit' | 'attend' | 'give' | 'cert' | 'serve' | 'meeting';
export interface HistItem { date: string; kind: HistKind; text: string; future?: boolean }
export const HIST_LABEL: Record<HistKind, string> = { church: '교회', visit: '심방', attend: '출석', give: '헌금', cert: '증명서', serve: '봉사', meeting: '회의' };
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export function memberHistory(m: Member, p: People, today: string, more: { tx?: Tx[]; certs?: Cert[]; serve?: Serve; minutes?: Minutes[] } = {}): HistItem[] {
  const out: HistItem[] = [];
  const day = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');
  if (day(m.registeredAt)) out.push({ date: m.registeredAt, kind: 'church', text: '교회 등록' });
  if (m.baptism && day(m.baptismDate || '')) out.push({ date: m.baptismDate!, kind: 'church', text: `${m.baptism}${m.baptismPlace ? ` (${m.baptismPlace}${m.baptismBy ? ` · ${m.baptismBy}` : ''})` : ''}` });
  for (const v of p.visits) if (v.memberIds.includes(m.id)) out.push({ date: v.date, kind: 'visit', text: `${v.kind}${v.planned ? ' 예정' : ''}${v.note ? ` — ${v.note}` : ''}` });
  // 출석: 해마다 한 줄 (그해 마지막으로 나온 날에)
  const years: Record<string, { came: string[]; all: number }> = {};
  for (const [d, ids] of Object.entries(p.attendance)) {
    const y = (years[d.slice(0, 4)] ??= { came: [], all: 0 });
    y.all++; if (ids.includes(m.id)) y.came.push(d);
  }
  for (const [y, a] of Object.entries(years)) {
    if (!a.came.length) { if (!m.registeredAt || m.registeredAt.slice(0, 4) <= y) out.push({ date: `${y}-12-31` < today ? `${y}-12-31` : today, kind: 'attend', text: `${y}년 출석 기록 없음 (기록한 ${a.all}번 중)` }); continue; }
    const last = a.came.sort()[a.came.length - 1];
    out.push({ date: last, kind: 'attend', text: `${y}년 ${a.came.length}번 출석 (기록한 ${a.all}번 중) · 마지막 ${+last.slice(5, 7)}월 ${+last.slice(8)}일` });
  }
  // 헌금: 해마다 한 줄 (항목별 합계)
  const give: Record<string, { last: string; n: number; sum: number; cat: Record<string, number> }> = {};
  for (const t of more.tx || []) {
    if (t.memberId !== m.id || t.type !== 'income' || /이월금$/.test(t.category)) continue;
    const g = (give[t.date.slice(0, 4)] ??= { last: '', n: 0, sum: 0, cat: {} });
    g.n++; g.sum += t.amount; g.cat[t.category] = (g.cat[t.category] || 0) + t.amount; if (t.date > g.last) g.last = t.date;
  }
  for (const [y, g] of Object.entries(give)) {
    const cats = Object.entries(g.cat).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${won(n)}`).join(', ');
    out.push({ date: g.last, kind: 'give', text: `${y}년 헌금 ${g.n}건 · ${won(g.sum)} (${cats})` });
  }
  for (const c of more.certs || []) if (c.memberId === m.id) out.push({ date: c.date, kind: 'cert', text: `${c.type} 발급 (제 ${c.no}호)${c.purpose ? ` · ${c.purpose}` : ''}` });
  for (const s of serveOf(more.serve, m.id)) out.push({ date: s.date, kind: 'serve', text: `봉사: ${s.role}` });
  if (m.name.length >= 2) for (const x of more.minutes || []) if ((x.attendees || '').includes(m.name)) out.push({ date: x.date, kind: 'meeting', text: `${x.meeting}${x.title ? ` "${x.title}"` : ''} 참석` });
  return out.map((x) => (x.date > today ? { ...x, future: true } : x)).sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
}

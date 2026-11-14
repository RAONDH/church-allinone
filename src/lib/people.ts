// 성도 명부 계산 (화면·시험에서 함께 씀). 오늘 날짜는 밖에서 넣어 시험할 수 있게 한다.
import type { Member, People, Visit } from './types';
import { addDays, ymd } from './week';

export const STATUS_LABEL: Record<Member['status'], string> = { active: '재적', inactive: '쉬는 중', moved: '이명', deceased: '별세' };
export const VISIT_KINDS = ['심방', '전화', '병원', '새가족', '상담', '기타'];
export const BAPTISMS = ['', '학습', '세례', '유아세례', '입교'];
const isCurrent = (m: Member) => m.status === 'active' || m.status === 'inactive';

const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);

/** 다가오는 생일 (birth: YYYY-MM-DD 또는 MM-DD). 2월 29일생은 평년엔 2월 28일. */
export function nextBirthday(birth: string, today: string): { date: string; days: number; age: number | null } | null {
  const m = birth.match(/^(?:(\d{4})-)?(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y0 = +today.slice(0, 4);
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
    .map((m) => ({ m, b: nextBirthday(m.birth, today) }))
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

/** 출석을 기록한 최근 n번의 예배에 모두 빠진 재적 성도 (그 기간에 등록한 분은 뺌). 기록이 n번이 안 되면 빈 목록. */
export function absentees(p: People, today: string, n = 3) {
  const dates = Object.keys(p.attendance).filter((d) => d <= today).sort().slice(-n);
  if (dates.length < n) return [];
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
];
export function parsePaste(text: string): { rows: Record<string, string>[]; columns: string[]; unknown: string[] } {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return { rows: [], columns: [], unknown: [] };
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const split = (l: string) => (sep === ',' ? splitCsv(l) : l.split('\t')).map((c) => c.trim());
  const head = split(lines[0]).map((h) => HEAD.find(([re]) => re.test(h.replace(/\s/g, '')))?.[1] || '');
  if (!head.includes('name')) {
    // 칸 이름이 없으면 한 줄에 한 분, 첫 칸은 이름
    return { rows: lines.map((l) => ({ name: split(l)[0] })).filter((r) => r.name), columns: ['name'], unknown: [] };
  }
  const unknown = split(lines[0]).filter((_, i) => !head[i] && split(lines[0])[i]);
  const rows = lines.slice(1).map((l) => {
    const cells = split(l), r: Record<string, string> = {};
    head.forEach((k, i) => { if (k && cells[i]) r[k] = cells[i]; });
    if (r.lunar && /^양/.test(r.lunar)) delete r.lunar;
    return r;
  }).filter((r) => r.name);
  return { rows, columns: head.filter(Boolean), unknown };
}
function splitCsv(l: string) {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** 오늘이 주일이면 오늘, 아니면 지난 주일 */
export function lastSunday(today: string) {
  const d = new Date(today + 'T00:00:00');
  return addDays(today, -d.getDay());
}

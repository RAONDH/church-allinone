// 재정 계산 (화면·시험에서 함께 씀)
import type { Fund, Member, Tx } from './types';

export const FUNDS: Fund[] = ['일반재정', '특별재정', '지정재정'];
export const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export const isCarry = (cat: string) => /이월금$/.test(cat);
const sum = (xs: Tx[]) => xs.reduce((s, t) => s + t.amount, 0);

/** 기간 안 수입·지출·차액 */
export function totals(tx: Tx[], from: string, to: string) {
  const xs = tx.filter((t) => t.date >= from && t.date <= to);
  const income = sum(xs.filter((t) => t.type === 'income')), expense = sum(xs.filter((t) => t.type === 'expense'));
  return { income, expense, net: income - expense, count: xs.length };
}

/** 그날까지 재정별 잔액 (이월금 포함 전체 누적) */
export function balances(tx: Tx[], until: string) {
  const out = Object.fromEntries(FUNDS.map((f) => [f, 0])) as Record<Fund, number>;
  for (const t of tx) if (t.date <= until) out[t.fund] = (out[t.fund] || 0) + (t.type === 'income' ? t.amount : -t.amount);
  return out;
}

/** 한 해 항목별 합계: type → fund → category → 금액 */
export function byCategory(tx: Tx[], year: string) {
  const out: Record<string, Record<string, Record<string, number>>> = { income: {}, expense: {} };
  for (const t of tx) if (t.date.startsWith(year)) {
    const f = (out[t.type][t.fund] ||= {});
    f[t.category] = (f[t.category] || 0) + t.amount;
  }
  return out;
}

/** 한 해 월별 수입·지출 (이월금은 수입에서 뺌) */
export function monthly(tx: Tx[], year: string) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}`;
    const xs = tx.filter((t) => t.date.startsWith(m));
    return { month: i + 1, income: sum(xs.filter((t) => t.type === 'income' && !isCarry(t.category))), expense: sum(xs.filter((t) => t.type === 'expense')) };
  });
}

export interface Donor { key: string; name: string; member: Member | null; total: number; count: number; tx: Tx[] }
/** 기부금 영수증용 헌금자별 합계 (이월금·이름 없는 기록·'무명' 제외). 명부와 연결된 기록은 성도 기준으로 모은다. */
export function donors(tx: Tx[], year: string, members: Member[]): Donor[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.name, (counts.get(m.name) || 0) + 1);
  const byName = new Map(members.filter((m) => counts.get(m.name) === 1).map((m) => [m.name, m]));
  const map = new Map<string, Donor>();
  for (const t of tx) {
    if (t.type !== 'income' || !t.date.startsWith(year) || isCarry(t.category)) continue;
    // 명부와 이어진 기록은 그 성도로, 이름만 적힌 기록도 명부에 같은 이름이 한 분뿐이면 그분으로 (주소가 영수증에 들어가게)
    const member = (t.memberId && byId.get(t.memberId)) || (!t.memberId && byName.get(t.name.trim())) || null;
    const name = member?.name || t.name.trim();
    if (!name || /^(무명|익명)$/.test(name)) continue;
    const key = member ? `m:${member.id}` : `n:${name}`;
    const d = map.get(key) || { key, name, member, total: 0, count: 0, tx: [] };
    d.total += t.amount; d.count++; d.tx.push(t);
    map.set(key, d);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 영수증에 적는 월별 합계 */
export function donorMonths(d: Donor) {
  const m: Record<string, number> = {};
  for (const t of d.tx) m[t.date.slice(0, 7)] = (m[t.date.slice(0, 7)] || 0) + t.amount;
  return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
}

/** 금액 입력: 1,000 / 1만 / 3만5천 / 150000원 */
export function parseWon(s: string): number {
  const x = String(s).replace(/[,\s원₩]/g, '');
  if (!x) return 0;
  if (/^\d+$/.test(x)) return +x;
  const m = x.match(/^(?:(\d+)억)?(?:(\d+)천만)?(?:(\d+)만)?(?:(\d+)천)?(?:(\d+))?$/);
  if (!m || !m[0]) return 0;
  const [, eok, cheonman, man, cheon, rest] = m.map((v) => (v ? +v : 0));
  return eok * 1e8 + cheonman * 1e7 + man * 1e4 + cheon * 1e3 + rest;
}

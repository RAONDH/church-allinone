// 예배 봉사 배정표 계산 (화면·시험에서 함께 씀). 배정 칸에는 성도 번호(id)나, 명부에 없는 분은 이름 글자를 그대로 넣는다.
import type { Member, Serve } from './types';
import { addDays } from './week';

/** 'YYYY-MM' 달의 주일 날짜들 */
export function sundaysOf(month: string) {
  const first = new Date(`${month}-01T00:00:00`);
  const out: string[] = [];
  let d = addDays(`${month}-01`, (7 - first.getDay()) % 7);
  while (d.startsWith(month)) { out.push(d); d = addDays(d, 7); }
  return out;
}

/** 배정 칸 하나를 사람 이름으로 */
export const whoName = (entry: string, members: Member[]) => members.find((m) => m.id === entry)?.name ?? entry;

/**
 * 비어 있는 칸을 돌아가며 채운다. 역할마다 '맡는 분' 목록(pool)을 차례로 돌고,
 * 그 앞에 마지막으로 맡았던 분 다음 사람부터 시작한다. 같은 날 다른 봉사를 맡은 분은 되도록 건너뛴다.
 * 이미 채운 칸은 그대로 둔다. 바뀐 날짜만 돌려준다.
 */
export function autoFill(serve: Serve, dates: string[], activeIds?: Set<string>) {
  const plan: Serve['plan'] = JSON.parse(JSON.stringify(serve.plan || {}));
  const targets = [...dates].sort();
  const changed = new Set<string>();
  for (const role of serve.roles) {
    const pool = role.pool.filter((id) => !activeIds || activeIds.has(id));
    if (!pool.length) continue;
    // 첫 날 앞에서 마지막으로 맡은 분
    let next = 0;
    for (const d of Object.keys(plan).filter((d) => d < targets[0]).sort()) {
      for (const e of plan[d]?.[role.id] || []) { const i = pool.indexOf(e); if (i >= 0) next = (i + 1) % pool.length; }
    }
    for (const d of targets) {
      const cur = plan[d]?.[role.id] || [];
      if (cur.length) { for (const e of cur) { const i = pool.indexOf(e); if (i >= 0) next = (i + 1) % pool.length; } continue; }
      const need = Math.min(role.count, pool.length);
      const busy = new Set(Object.values(plan[d] || {}).flat());
      const picked: string[] = [];
      // 한 바퀴는 같은 날 다른 봉사가 없는 분만, 모자라면 두 번째 바퀴에서 아무나
      for (let pass = 0; pass < 2 && picked.length < need; pass++) {
        for (let k = 0; k < pool.length && picked.length < need; k++) {
          const id = pool[(next + k) % pool.length];
          if (picked.includes(id) || (pass === 0 && busy.has(id))) continue;
          picked.push(id);
        }
      }
      if (!picked.length) continue;
      next = (pool.indexOf(picked[picked.length - 1]) + 1) % pool.length;
      plan[d] = { ...(plan[d] || {}), [role.id]: picked };
      changed.add(d);
    }
  }
  return Object.fromEntries([...changed].sort().map((d) => [d, plan[d]]));
}

/** 이 성도가 맡은 봉사 (날짜·역할) */
export function serveOf(serve: Serve | undefined, memberId: string) {
  if (!serve) return [];
  const name = (id: string) => serve.roles.find((r) => r.id === id)?.name || '';
  return Object.entries(serve.plan || {}).flatMap(([date, roles]) => Object.entries(roles).filter(([rid, xs]) => xs.includes(memberId) && name(rid)).map(([rid]) => ({ date, role: name(rid) })));
}

/** 오늘 이후 가장 가까운 주일(오늘 포함)의 봉사 */
export function nextServe(serve: Serve | undefined, today: string) {
  if (!serve) return null;
  const date = Object.keys(serve.plan || {}).filter((d) => d >= today && d <= addDays(today, 6)).sort()[0];
  if (!date) return null;
  const rows = serve.roles.map((r) => ({ role: r.name, who: serve.plan[date][r.id] || [] })).filter((r) => r.who.length);
  return rows.length ? { date, rows } : null;
}

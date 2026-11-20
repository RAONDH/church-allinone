// 행정 → 봉사: 주일마다 대표기도·안내·헌금위원·반주·차량·식사 당번 등을 배정하고 인쇄한다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { useGuardedClose } from '../lib/guard';
import { api } from '../lib/api';
import { autoFill, nextServe, sundaysOf, whoName } from '../lib/serve';
import type { Admin as AdminData, Member, Serve, ServeRole } from '../lib/types';
import { ymd } from '../lib/week';

const monthOf = (d: string) => d.slice(0, 7);
const shift = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00`); d.setMonth(d.getMonth() + n); return ymd(d).slice(0, 7); };
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const dow = (d: string) => DOW[new Date(d + 'T00:00:00').getDay()];
const current = (m: Member) => m.status === 'active' || m.status === 'inactive';

export default function ServeTab({ data, members, reload }: { data: AdminData; members: Member[]; reload: () => Promise<void> }) {
  const { base, ov } = useApp();
  const serve: Serve = data.serve || { roles: [], plan: {} };
  const [month, setMonth] = useState(monthOf(ymd(new Date())));
  const [cell, setCell] = useState<{ date: string; role: ServeRole } | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [extra, setExtra] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const dates = useMemo(() => [...new Set([...sundaysOf(month), ...Object.keys(serve.plan).filter((d) => monthOf(d) === month)])].sort(), [month, serve.plan]);
  const today = ymd(new Date());
  const name = (e: string) => whoName(e, members);
  const hasPool = serve.roles.some((r) => r.pool.length);

  const put = async (dates: Serve['plan']) => {
    setErr('');
    try { await api(`${base}/serve/plan`, { method: 'PUT', body: { dates } }); await reload(); } catch (e: any) { setErr(e.message); }
  };
  const fill = async () => {
    const active = new Set(members.filter(current).map((m) => m.id));
    const changed = autoFill(serve, dates, active);
    const n = Object.keys(changed).length;
    if (!n) { setMsg(hasPool ? '빈 칸이 없습니다. 이미 모두 채워져 있습니다.' : '먼저 "봉사 종류·맡는 분"에서 봉사마다 맡는 분을 골라 주세요.'); return; }
    await put(changed); setMsg(`${n}주의 빈 칸을 돌아가며 채웠습니다. 칸을 눌러 바꿀 수 있습니다.`);
  };
  const clearMonth = async () => {
    if (!confirm(`${+month.slice(5)}월 봉사 배정을 모두 비울까요? (봉사 종류와 맡는 분 목록은 그대로 남습니다)`)) return;
    await put(Object.fromEntries(dates.filter((d) => serve.plan[d]).map((d) => [d, {}])));
  };
  const addDay = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(extra)) return;
    setMonth(monthOf(extra));
    if (!serve.plan[extra]) setCell(serve.roles[0] ? { date: extra, role: serve.roles[0] } : null);
    setExtra('');
  };

  const Table = ({ print = false }: { print?: boolean }) => (
    <table className={print ? '' : 'serve-table'}>
      <thead><tr><th>날짜</th>{serve.roles.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
      <tbody>
        {dates.map((d) => (
          <tr key={d} className={!print && d < today ? 'past' : ''}>
            <th>{md(d)}{dow(d) !== '일' ? ` (${dow(d)})` : ''}</th>
            {serve.roles.map((r) => {
              const xs = serve.plan[d]?.[r.id] || [];
              return print ? <td key={r.id}>{xs.map(name).join(', ')}</td> : (
                <td key={r.id}><button className="serve-cell" onClick={() => setCell({ date: d, role: r })} title="눌러서 바꾸기">
                  {xs.length ? xs.map(name).join(', ') : <span className="muted">＋</span>}
                </button></td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div>
      <div className="row between wrap">
        <div className="row">
          <button onClick={() => setMonth(shift(month, -1))} aria-label="지난달">◀</button>
          <h3 style={{ margin: 0 }}>{month.slice(0, 4)}년 {+month.slice(5)}월 봉사</h3>
          <button onClick={() => setMonth(shift(month, 1))} aria-label="다음달">▶</button>
          {month !== monthOf(today) && <button className="link small" onClick={() => setMonth(monthOf(today))}>이번 달</button>}
        </div>
        <div className="row wrap">
          <button onClick={() => setRolesOpen(true)}>봉사 종류·맡는 분</button>
          <button className="primary" onClick={fill} disabled={!serve.roles.length}>빈 칸 돌아가며 채우기</button>
          <button onClick={() => window.print()} disabled={!serve.roles.length}>인쇄</button>
        </div>
      </div>
      {!hasPool && serve.roles.length > 0 && <p className="alert info small">처음이시면 <b>봉사 종류·맡는 분</b>에서 봉사마다 맡을 분을 골라 두세요. 그러면 <b>빈 칸 돌아가며 채우기</b>가 지난번 다음 사람부터 차례로 채웁니다. 칸을 눌러 직접 넣어도 됩니다.</p>}
      {msg && <p className="alert info small" onClick={() => setMsg('')}>{msg}</p>}
      {err && <p className="alert err">{err}</p>}
      {serve.roles.length ? <div className="table-scroll"><Table /></div> : <p className="muted">봉사 종류가 없습니다. <button className="link" onClick={() => setRolesOpen(true)}>봉사 종류 만들기</button></p>}
      <div className="row wrap small" style={{ marginTop: 8 }}>
        <span className="muted">주일 말고 다른 날(성탄절·수요예배 등)도 넣으려면</span>
        <input type="date" value={extra} onChange={(e) => setExtra(e.target.value)} />
        <button className="small" disabled={!extra} onClick={addDay}>그날 봉사 넣기</button>
        <span className="grow" />
        {dates.some((d) => serve.plan[d]) && <button className="danger-link small" onClick={clearMonth}>이달 배정 비우기</button>}
      </div>
      <p className="muted small">홈 화면 '이번 주 돌볼 분' 카드에 이번 주 봉사가 나오고, 성도 창의 '기록 모아보기'에 그분이 맡은 봉사가 쌓입니다.</p>

      <div className="print-area serve-print">
        <h2>{ov?.church?.name || ''} {month.slice(0, 4)}년 {+month.slice(5)}월 예배 봉사표</h2>
        <Table print />
      </div>
      {cell && <CellDialog key={cell.date + cell.role.id} date={cell.date} role={cell.role} serve={serve} members={members} onClose={() => setCell(null)} onSave={async (xs) => { await put({ [cell.date]: { ...(serve.plan[cell.date] || {}), [cell.role.id]: xs } }); setCell(null); }} />}
      {rolesOpen && <RolesDialog serve={serve} members={members} onClose={() => setRolesOpen(false)} reload={reload} />}
    </div>
  );
}

// 한 칸(날짜×봉사) 바꾸기: 맡는 분을 먼저, 그 밖의 성도와 명부에 없는 이름도
function CellDialog({ date, role, serve, members, onClose, onSave }: { date: string; role: ServeRole; serve: Serve; members: Member[]; onClose: () => void; onSave: (xs: string[]) => Promise<void> }) {
  const g = useGuardedClose(onClose);
  const init = serve.plan[date]?.[role.id] || [];
  const [pick, setPick] = useState<string[]>(init.filter((x) => members.some((m) => m.id === x)));
  const [text, setText] = useState(init.filter((x) => !members.some((m) => m.id === x)).join(', '));
  const [allOpen, setAllOpen] = useState(false);
  const busy = new Set(Object.entries(serve.plan[date] || {}).filter(([k]) => k !== role.id).flatMap(([, v]) => v));
  const pool = role.pool.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => !!m && current(m));
  const others = members.filter((m) => current(m) && !role.pool.includes(m.id)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const toggle = (id: string) => setPick(pick.includes(id) ? pick.filter((x) => x !== id) : [...pick, id]);
  const Chip = ({ m }: { m: Member }) => <button className={`chip ${pick.includes(m.id) ? 'on' : ''}`} onClick={() => toggle(m.id)} title={busy.has(m.id) ? '이날 다른 봉사도 맡았습니다' : ''}>{m.name}{busy.has(m.id) ? ' ·' : ''}</button>;
  const result = [...pick, ...text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)];
  return (
    <div className="dialog-back" onClick={g.close}>
      <div {...g.track} className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>{md(date)} ({dow(date)}) {role.name}</h2>
        <p className="muted small">{role.count}명 · 고른 분 {result.length}명{busy.size ? ' · 이름 옆 점(·)은 이날 다른 봉사도 맡은 분' : ''}</p>
        {pool.length > 0 && <><div className="small"><b>맡는 분</b></div><div className="chips">{pool.map((m) => <Chip key={m.id} m={m} />)}</div></>}
        {(allOpen || !pool.length) ? <><div className="small"><b>다른 성도</b></div><div className="chips">{others.map((m) => <Chip key={m.id} m={m} />)}</div></>
          : <button className="link small" onClick={() => setAllOpen(true)}>다른 성도도 보기</button>}
        <label>명부에 없는 분 (쉼표로 나눔)<input value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 반주자 홍길동, 외부 강사" /></label>
        <div className="row between">
          <button className="danger-link" onClick={() => onSave([])}>이 칸 비우기</button>
          <div className="row"><button onClick={g.close}>닫기</button><button className="primary" onClick={() => onSave(result)}>저장</button></div>
        </div>
      </div>
    </div>
  );
}

// 봉사 종류(이름·인원) 고치기와 봉사마다 '맡는 분' 고르기
function RolesDialog({ serve, members, onClose, reload }: { serve: Serve; members: Member[]; onClose: () => void; reload: () => Promise<void> }) {
  const g = useGuardedClose(onClose);
  const { base } = useApp();
  const [roles, setRoles] = useState<ServeRole[]>(serve.roles.map((r) => ({ ...r, pool: [...r.pool] })));
  const [open, setOpen] = useState<number>(roles.findIndex((r) => !r.pool.length));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const people = members.filter(current).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const upd = (i: number, p: Partial<ServeRole>) => setRoles(roles.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= roles.length) return; const x = [...roles]; [x[i], x[j]] = [x[j], x[i]]; setRoles(x); setOpen(open === i ? j : open === j ? i : open); };
  const removed = serve.roles.filter((r) => !roles.some((x) => x.id === r.id));
  const save = async () => {
    const lost = removed.filter((r) => Object.values(serve.plan).some((d) => d[r.id]?.length));
    if (lost.length && !confirm(`${lost.map((r) => r.name).join(', ')} 봉사를 지우면 그동안 배정한 기록도 함께 지워집니다. 계속할까요?`)) return;
    setBusy(true); setErr('');
    try { await api(`${base}/serve/roles`, { method: 'PUT', body: { roles } }); await reload(); onClose(); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="dialog-back" onClick={g.close}>
      <div {...g.track} className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>봉사 종류·맡는 분</h2>
        <p className="muted small">봉사마다 맡는 분을 고르면, '빈 칸 돌아가며 채우기'가 고른 순서대로 차례를 돌립니다. 이름·인원·순서는 교회에 맞게 바꾸세요.</p>
        <ul className="role-list">
          {roles.map((r, i) => (
            <li key={r.id}>
              <div className="row">
                <input value={r.name} onChange={(e) => upd(i, { name: e.target.value })} aria-label="봉사 이름" style={{ width: '9em' }} />
                <select value={r.count} onChange={(e) => upd(i, { count: +e.target.value })} aria-label="인원">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}명</option>)}</select>
                <button className="link small grow" style={{ textAlign: 'left' }} onClick={() => setOpen(open === i ? -1 : i)}>
                  맡는 분 {r.pool.length ? `${r.pool.length}명: ${r.pool.map((id) => whoName(id, members)).join(', ')}` : '(아직 없음 — 눌러서 고르기)'}
                </button>
                <button className="small" onClick={() => move(i, -1)} aria-label="위로">↑</button>
                <button className="small" onClick={() => move(i, 1)} aria-label="아래로">↓</button>
                <button className="small danger-link" onClick={() => { setRoles(roles.filter((_, k) => k !== i)); setOpen(-1); }}>지우기</button>
              </div>
              {open === i && (
                <div className="chips pool">
                  {people.map((m) => {
                    const n = r.pool.indexOf(m.id);
                    return <button key={m.id} className={`chip ${n >= 0 ? 'on' : ''}`} onClick={() => upd(i, { pool: n >= 0 ? r.pool.filter((x) => x !== m.id) : [...r.pool, m.id] })}>{n >= 0 ? `${n + 1}. ` : ''}{m.name}</button>;
                  })}
                  {!people.length && <span className="muted small">성도 명부에 분이 없습니다. 성도 화면에서 먼저 넣어 주세요.</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
        <button className="small" onClick={() => { setRoles([...roles, { id: `n${Date.now().toString(36)}`, name: '', count: 1, pool: [] }]); setOpen(roles.length); }}>+ 봉사 종류 추가</button>
        {err && <p className="alert err">{err}</p>}
        <div className="row between">
          <span />
          <div className="row"><button onClick={g.close}>닫기</button><button className="primary" disabled={busy} onClick={save}>{busy ? '저장 중…' : '저장'}</button></div>
        </div>
      </div>
    </div>
  );
}

// 홈 화면 '이번 주 돌볼 분' 카드: 이번 주 봉사
export function WeekServe({ members }: { members: Member[] }) {
  const { base } = useApp();
  const nav = useNavigate();
  const [serve, setServe] = useState<Serve | null>(null);
  useEffect(() => { api<AdminData>(`${base}/admin`).then((a) => setServe(a.serve)).catch(() => setServe(null)); }, [base]);
  if (!serve || !serve.roles.length) return null;
  const w = nextServe(serve, ymd(new Date()));
  return (
    <div className="care-serve">
      <div className="muted small">🙋 이번 주 봉사{w ? ` (${md(w.date)})` : ''}</div>
      {w ? w.rows.map((r) => <div key={r.role}><span className="muted">{r.role}</span> {r.who.map((x) => whoName(x, members)).join(', ')}</div>) : <div className="muted small">아직 배정하지 않았습니다</div>}
      <button className="link small" onClick={() => nav('/admin/serve')}>봉사 배정표</button>
    </div>
  );
}

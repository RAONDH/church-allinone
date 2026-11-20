import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { useGuardedClose } from '../lib/guard';
import { api } from '../lib/api';
import type { Admin as AdminData, Member, People as PeopleData, Tx, Visit } from '../lib/types';
import { absentees, attendanceWeeks, ageOf, HIST_LABEL, memberHistory, type HistKind, upcomingBirthdays, BAPTISMS, dueVisits, isCurrent, RELATIONS, ROLES, familyOf, lastSunday, lastVisitMap, nextBirthday, parsePaste, STATUS_LABEL, VISIT_KINDS } from '../lib/people';
import { fmtDate, ymd } from '../lib/week';
import { WeekEvents } from './Admin';
import { WeekServe } from './ServeTab';

const TABS = [['list', '성도 명부'], ['visits', '심방'], ['attendance', '출석']] as const;
type Tab = (typeof TABS)[number][0];

export function usePeople() {
  const { base } = useApp();
  const [data, setData] = useState<PeopleData | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api<PeopleData>(`${base}/people`).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message)), [base]);
  useEffect(() => { load(); }, [load]);
  return { data, err, load };
}

export default function People() {
  const { tab = 'list' } = useParams();
  const nav = useNavigate();
  const { data, err, load } = usePeople();
  const t = (TABS.some(([k]) => k === tab) ? tab : 'list') as Tab;
  return (
    <section>
      <div className="home-head">
        <div>
          <h1>성도</h1>
          <p className="muted small">🔒 성도 정보는 이 컴퓨터에만 저장됩니다. AI나 인터넷으로 보내지 않습니다.</p>
        </div>
      </div>
      <div className="tabs">
        {TABS.map(([k, label]) => <button key={k} className={t === k ? 'on' : ''} onClick={() => nav(`/people/${k}`)}>{label}</button>)}
      </div>
      {err && <p className="alert err">{err} <button onClick={load}>다시 시도</button></p>}
      {!data ? (!err && <p className="muted">불러오는 중…</p>)
        : t === 'list' ? <MemberList data={data} reload={load} />
        : t === 'visits' ? <Visits data={data} reload={load} />
        : <Attendance data={data} reload={load} />}
    </section>
  );
}

// ── 성도 명부 ─────────────────────────────────────
function MemberList({ data, reload }: { data: PeopleData; reload: () => Promise<void> }) {
  const { base } = useApp();
  const [qs, setQs] = useState('');
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState<'current' | 'all' | Member['status']>('current');
  const [edit, setEdit] = useState<Member | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const today = ymd(new Date());
  const groups = useMemo(() => [...new Set(data.members.map((m) => m.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), [data.members]);
  const last = useMemo(() => lastVisitMap(data.visits), [data.visits]);
  const list = data.members
    .filter((m) => (status === 'all' ? true : status === 'current' ? isCurrent(m) : m.status === status))
    .filter((m) => !group || m.group === group)
    .filter((m) => !qs.trim() || [m.name, m.phone, m.role, m.group, m.memo, m.address].some((v) => v.includes(qs.trim())))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const active = data.members.filter((m) => m.status === 'active').length;

  return (
    <>
      <div className="card">
        <div className="row between">
          <div className="muted">재적 {active}명 · 전체 {data.members.length}명</div>
          <div className="row wrap">
            <button onClick={() => setImporting(true)}>엑셀에서 붙여 넣기</button>
            {data.members.length > 0 && <a className="btn" href={`${base}/people/export.csv`}>엑셀(CSV)로 내보내기</a>}
            <button className="primary" onClick={() => setEdit('new')}>성도 추가</button>
          </div>
        </div>
        {data.members.length > 0 && (
          <div className="row wrap people-filter">
            <input className="grow" placeholder="이름·전화·메모로 찾기" value={qs} onChange={(e) => setQs(e.target.value)} />
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">모든 구역</option>
              {groups.map((g) => <option key={g}>{g}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="current">지금 성도 (이명·별세 빼고)</option>
              <option value="active">재적만</option>
              <option value="inactive">쉬는 중</option>
              <option value="absent">비출석</option>
              <option value="moved">이명</option>
              <option value="deceased">별세</option>
              <option value="other">기타</option>
              <option value="all">모두</option>
            </select>
          </div>
        )}
      </div>

      {data.members.length === 0 ? (
        <div className="card empty">
          <h2>성도 명부가 비어 있습니다</h2>
          <p>한 분씩 추가하거나, 엑셀로 관리하던 명단을 복사해 한 번에 붙여 넣을 수 있습니다.</p>
          <div className="row"><button className="primary" onClick={() => setEdit('new')}>성도 추가</button><button onClick={() => setImporting(true)}>엑셀에서 붙여 넣기</button></div>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="people-table">
            <thead><tr><th>이름</th><th>직분</th><th>구역</th><th>전화</th><th>생일</th><th>최근 심방</th></tr></thead>
            <tbody>
              {list.map((m) => {
                const b = nextBirthday(m.birth, today, m);
                return (
                  <tr key={m.id} onClick={() => setEdit(m)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEdit(m)}>
                    <td><b>{m.name}</b>{m.status !== 'active' && <span className="pill info">{STATUS_LABEL[m.status]}</span>}{m.familyId && <span className="muted small"> · 가족 {familyOf(data.members, m).length + 1}</span>}</td>
                    <td>{m.role}</td>
                    <td>{m.group}</td>
                    <td>{m.phone}</td>
                    <td>{m.birth ? <>{m.birth.slice(-5).replace('-', '/')}{m.lunar && <span className="muted small"> 음{m.lunarLeap ? '(윤)' : ''}</span>}{b && b.days <= 7 && <span className="pill todo">{b.days === 0 ? '오늘' : `${b.days}일 뒤`}</span>}</> : ''}</td>
                    <td className="muted">{last[m.id] ? fmtDate(last[m.id]) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length === 0 && <p className="muted">찾는 조건에 맞는 성도가 없습니다.</p>}
        </div>
      )}
      {edit && <MemberDialog data={data} member={edit === 'new' ? null : edit} onClose={() => setEdit(null)} reload={reload} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} reload={reload} />}
    </>
  );
}

const blank = (): Omit<Member, 'id' | 'createdAt' | 'updatedAt'> => ({ name: '', gender: '', birth: '', lunar: false, phone: '', address: '', role: '', group: '', baptism: '', registeredAt: '', status: 'active', familyId: '', relation: '', memo: '' });

function MemberDialog({ data, member, onClose, reload }: { data: PeopleData; member: Member | null; onClose: () => void; reload: () => Promise<void> }) {
  const g = useGuardedClose(onClose);
  const { base } = useApp();
  const [f, setF] = useState(member ? { ...member } : blank());
  const [familyWith, setFamilyWith] = useState<string | undefined>(undefined);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [visit, setVisit] = useState<Visit | 'new' | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const family = member ? familyOf(data.members, member) : [];
  const others = data.members.filter((m) => m.id !== member?.id).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const visits = member ? data.visits.filter((v) => v.memberIds.includes(member.id)).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const today = ymd(new Date());
  const age = ageOf(f.birth, today);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { ...f, familyWith: familyWith === '__none' ? '' : familyWith || undefined };
      if (member) await api(`${base}/members/${member.id}`, { method: 'PUT', body });
      else await api(`${base}/members`, { method: 'POST', body });
      await reload(); onClose();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const remove = async () => {
    if (!member) return;
    const own = visits.filter((v) => v.memberIds.length === 1).length;
    if (!confirm(`${member.name} 님을 명부에서 지울까요?\n출석 기록과${own ? ` 이분만의 심방 기록 ${own}건도` : ''} 함께 지워지며 되돌릴 수 없습니다.\n(교회를 옮기셨다면 지우지 말고 상태를 '이명'으로 바꾸면 기록이 남습니다.)`)) return;
    try { await api(`${base}/members/${member.id}`, { method: 'DELETE' }); await reload(); onClose(); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="dialog-back" onClick={g.close}>
      <div {...g.track} className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>{member ? `${member.name} 님` : '성도 추가'}</h2>
        <div className="form-grid">
          <label>이름<input value={f.name} onChange={set('name')} autoFocus={!member} /></label>
          <label>성별<select value={f.gender} onChange={set('gender')}><option value="">-</option><option>남</option><option>여</option></select></label>
          <label>생일 {age !== null && <span className="muted small">(만 {age}세)</span>}<input value={f.birth} onChange={set('birth')} placeholder="1965-03-02 또는 03-02" /></label>
          <label className="check"><input type="checkbox" checked={f.lunar} onChange={set('lunar')} />음력 생일{f.lunar && <span className="muted small"> (해마다 양력 날짜로 바꿔 알려 드립니다)</span>}</label>
          {f.lunar && <label className="check"><input type="checkbox" checked={!!f.lunarLeap} onChange={set('lunarLeap')} />윤달 생일</label>}
          <label>전화<input value={f.phone} onChange={set('phone')} inputMode="tel" /></label>
          <label>직분<input value={f.role} onChange={set('role')} list="roles" placeholder="목사·전도사·장로·권사·집사·성도" /></label>
          <label>구역·소그룹<input value={f.group} onChange={set('group')} list="groups" /></label>
          <label>세례<select value={f.baptism} onChange={set('baptism')}>{BAPTISMS.map((b) => <option key={b} value={b}>{b || '-'}</option>)}</select></label>
          {f.baptism && <>
            <label>세례일<input value={f.baptismDate || ''} onChange={set('baptismDate')} placeholder="1985-04-07" /></label>
            <label>세례 교회 · 집례자<div className="row"><input value={f.baptismPlace || ''} onChange={set('baptismPlace')} placeholder="교회" /><input value={f.baptismBy || ''} onChange={set('baptismBy')} placeholder="집례 목사" /></div></label>
          </>}
          <label>등록일<input value={f.registeredAt} onChange={set('registeredAt')} placeholder="2020-05-10" /></label>
          <label>상태<select value={f.status} onChange={set('status')}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="span2">주소<input value={f.address} onChange={set('address')} /></label>
          <label>가족으로 묶기
            <select value={familyWith ?? ''} onChange={(e) => setFamilyWith(e.target.value)}>
              <option value="">{family.length ? '지금 가족 그대로' : '묶지 않음'}</option>
              {family.length > 0 && <option value="__none">가족에서 빼기</option>}
              {others.map((m) => <option key={m.id} value={m.id}>{m.name} 님 가족으로{m.group ? ` (${m.group})` : ''}</option>)}
            </select>
          </label>
          <label>가족 관계<select value={f.relation} onChange={set('relation')}>
            <option value="">-</option>
            {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            {f.relation && !RELATIONS.includes(f.relation) && <option value={f.relation}>{f.relation} (예전에 적은 말)</option>}
          </select></label>
          <label className="span2">메모<textarea rows={3} value={f.memo} onChange={set('memo')} placeholder="기도 제목, 건강, 형편 등 목회자만 보는 메모" /></label>
        </div>
        <datalist id="roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
        <datalist id="groups">{[...new Set(data.members.map((m) => m.group).filter(Boolean))].map((g) => <option key={g} value={g} />)}</datalist>
        {member && <Giving memberId={member.id} />}
        {family.length > 0 && <p className="small">가족: {family.map((m) => `${m.name}${m.relation ? `(${m.relation})` : ''}`).join(', ')}</p>}

        {member && <History data={data} member={member} />}
        {member && (
          <div className="sub-box">
            <div className="row between"><b>심방 기록 {visits.length}건</b><button className="small" onClick={() => setVisit('new')}>심방 기록 추가</button></div>
            <VisitList data={data} visits={visits.slice(0, 5)} onEdit={setVisit} />
          </div>
        )}
        {err && <p className="alert err">{err}</p>}
        <div className="row between">
          {member ? <button className="danger-link" onClick={remove}>명부에서 지우기</button> : <span />}
          <div className="row">
            <button onClick={g.close}>닫기</button>
            <button className="primary" disabled={busy} onClick={() => save()}>{busy ? '저장 중…' : '저장'}</button>
          </div>
        </div>
        {visit && <VisitDialog data={data} visit={visit === 'new' ? null : visit} preset={member ? [member.id] : []} onClose={() => setVisit(null)} reload={reload} />}
      </div>
    </div>
  );
}

function ImportDialog({ onClose, reload }: { onClose: () => void; reload: () => Promise<void> }) {
  const g = useGuardedClose(onClose);
  const { base } = useApp();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const p = useMemo(() => parsePaste(text), [text]);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api<{ added: number }>(`${base}/members/bulk`, { method: 'POST', body: { rows: p.rows } });
      await reload(); alert(`${r.added}명을 명부에 넣었습니다.`); onClose();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const LABEL: Record<string, string> = { name: '이름', gender: '성별', birth: '생일', lunar: '음력', phone: '전화', address: '주소', role: '직분', group: '구역', baptism: '세례', registeredAt: '등록일', family: '가족', relation: '관계', memo: '메모' };
  return (
    <div className="dialog-back" onClick={g.close}>
      <div {...g.track} className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>엑셀에서 붙여 넣기</h2>
        <p className="muted small">엑셀·한글 표에서 <b>칸 이름 줄까지 함께</b> 복사해 아래에 붙여 넣으세요. 알아듣는 칸: 이름, 성별, 생년월일, 음력, 전화, 주소, 직분, 구역(소그룹·목장), 세례, 등록일, 가족, 관계, 메모.<br />
          '가족' 칸에 같은 글자(예: 세대주 이름)를 쓴 분들은 한 가족으로 묶입니다. 이미 있는 성도와 겹쳐도 새로 추가되니 처음 한 번만 쓰세요.</p>
        <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={'이름\t전화\t생년월일\t구역\n홍길동\t010-0000-0000\t1970-01-01\t1구역'} />
        {text.trim() && (
          <p className="small">
            {p.rows.length}명 · 알아들은 칸: {p.columns.map((c) => LABEL[c]).join(', ') || '없음'}
            {p.unknown.length > 0 && <span className="muted"> · 넣지 않는 칸: {p.unknown.join(', ')}</span>}
          </p>
        )}
        {p.rows.length > 0 && (
          <div className="table-wrap preview"><table className="people-table"><tbody>{p.rows.slice(0, 5).map((r, i) => <tr key={i}>{p.columns.map((c) => <td key={c}>{r[c]}</td>)}</tr>)}</tbody></table></div>
        )}
        {err && <p className="alert err">{err}</p>}
        <div className="row end">
          <button onClick={g.close}>취소</button>
          <button className="primary" disabled={busy || !p.rows.length} onClick={go}>{p.rows.length}명 넣기</button>
        </div>
      </div>
    </div>
  );
}

// ── 심방 ─────────────────────────────────────────
const names = (data: PeopleData, ids: string[]) => ids.map((id) => data.members.find((m) => m.id === id)?.name || '(지운 성도)').join(', ');

function VisitList({ data, visits, onEdit }: { data: PeopleData; visits: Visit[]; onEdit: (v: Visit) => void }) {
  if (!visits.length) return <p className="muted small">기록이 없습니다.</p>;
  return (
    <ul className="visit-list">
      {visits.map((v) => (
        <li key={v.id} onClick={() => onEdit(v)}>
          <span className="muted">{fmtDate(v.date)}</span>
          <span className={`pill ${v.planned ? 'todo' : 'done'}`}>{v.planned ? '예정' : v.kind}</span>
          <b>{names(data, v.memberIds)}</b>
          <span className="visit-note">{v.note}</span>
        </li>
      ))}
    </ul>
  );
}

function Visits({ data, reload }: { data: PeopleData; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState<Visit | 'new' | null>(null);
  const today = ymd(new Date());
  const planned = data.visits.filter((v) => v.planned).sort((a, b) => a.date.localeCompare(b.date));
  const done = data.visits.filter((v) => !v.planned).sort((a, b) => b.date.localeCompare(a.date));
  const last = lastVisitMap(data.visits);
  const long = data.members.filter((m) => m.status === 'active' && (!last[m.id] || last[m.id] < addMonths(today, -6)))
    .filter((m) => !planned.some((v) => v.memberIds.includes(m.id)));
  return (
    <>
      <div className="row between"><span /><button className="primary" disabled={!data.members.length} onClick={() => setEdit('new')}>심방 기록·예정 추가</button></div>
      {!data.members.length && <p className="alert info">성도 명부에 성도를 먼저 넣어 주세요.</p>}
      <div className="grid2">
        <div className="card">
          <h3>예정된 심방 {planned.length}</h3>
          <VisitList data={data} visits={planned} onEdit={setEdit} />
          <p className="muted small">다녀오신 뒤 눌러서 '예정'을 풀고 내용을 적으면 기록으로 옮겨집니다.</p>
        </div>
        <div className="card">
          <h3>6개월 넘게 심방 기록이 없는 재적 성도 {long.length}</h3>
          {long.length ? <p className="small">{long.map((m) => m.name).join(', ')}</p> : <p className="muted small">없습니다.</p>}
        </div>
      </div>
      <div className="card">
        <h3>지난 기록 {done.length}</h3>
        <VisitList data={data} visits={done} onEdit={setEdit} />
      </div>
      {edit && <VisitDialog data={data} visit={edit === 'new' ? null : edit} preset={[]} onClose={() => setEdit(null)} reload={reload} />}
    </>
  );
}
const addMonths = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setMonth(d.getMonth() + n); return ymd(d); };

function VisitDialog({ data, visit, preset, onClose, reload }: { data: PeopleData; visit: Visit | null; preset: string[]; onClose: () => void; reload: () => Promise<void> }) {
  const g = useGuardedClose(onClose);
  const { base } = useApp();
  const today = ymd(new Date());
  const [f, setF] = useState({ memberIds: visit?.memberIds || preset, date: visit?.date || today, kind: visit?.kind || '심방', planned: visit?.planned ?? false, note: visit?.note || '' });
  const [pick, setPick] = useState('');
  const [err, setErr] = useState('');
  const candidates = data.members.filter((m) => !f.memberIds.includes(m.id) && isCurrent(m)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const add = (id: string) => {
    if (!id) return;
    const m = data.members.find((x) => x.id === id);
    setF({ ...f, memberIds: [...f.memberIds, id] });
    setPick('');
    return m;
  };
  const addFamily = () => {
    const ids = new Set(f.memberIds);
    for (const id of f.memberIds) { const m = data.members.find((x) => x.id === id); if (m) familyOf(data.members, m).forEach((x) => ids.add(x.id)); }
    setF({ ...f, memberIds: [...ids] });
  };
  const save = async () => {
    setErr('');
    try {
      if (visit) await api(`${base}/visits/${visit.id}`, { method: 'PUT', body: f });
      else await api(`${base}/visits`, { method: 'POST', body: f });
      await reload(); onClose();
    } catch (e: any) { setErr(e.message); }
  };
  const remove = async () => {
    if (!visit || !confirm('이 심방 기록을 지울까요? 되돌릴 수 없습니다.')) return;
    try { await api(`${base}/visits/${visit.id}`, { method: 'DELETE' }); await reload(); onClose(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="dialog-back" onClick={g.close}>
      <div {...g.track} className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>{visit ? (visit.planned ? '예정된 심방' : '심방 기록') : '심방 기록·예정 추가'}</h2>
        <div className="chips">
          {f.memberIds.map((id) => <span key={id} className="chip">{names(data, [id])}<button className="icon" aria-label="빼기" onClick={() => setF({ ...f, memberIds: f.memberIds.filter((x) => x !== id) })}>×</button></span>)}
          {f.memberIds.length > 0 && <button className="small" onClick={addFamily}>가족도 함께</button>}
        </div>
        <label>대상 성도 추가
          <select value={pick} onChange={(e) => add(e.target.value)}>
            <option value="">이름을 고르세요</option>
            {candidates.map((m) => <option key={m.id} value={m.id}>{m.name}{m.group ? ` (${m.group})` : ''}</option>)}
          </select>
        </label>
        <div className="row">
          <label>날짜<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="grow">종류<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{VISIT_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.planned} onChange={(e) => setF({ ...f, planned: e.target.checked })} />아직 다녀오지 않은 예정 (홈 화면에 알려 드림)</label>
        <label>내용·기도 제목<textarea rows={4} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        {err && <p className="alert err">{err}</p>}
        <div className="row between">
          {visit ? <button className="danger-link" onClick={remove}>기록 지우기</button> : <span />}
          <div className="row">
            <button onClick={g.close}>취소</button>
            {visit?.planned && <button onClick={() => setF({ ...f, planned: false, date: f.date > today ? today : f.date })}>다녀왔어요</button>}
            <button className="primary" onClick={save}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 출석 ─────────────────────────────────────────
function Attendance({ data, reload }: { data: PeopleData; reload: () => Promise<void> }) {
  const { base } = useApp();
  const today = ymd(new Date());
  const [date, setDate] = useState(lastSunday(today));
  const [sel, setSel] = useState<Set<string>>(new Set(data.attendance[date] || []));
  const [msg, setMsg] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setSel(new Set(data.attendance[date] || [])); setDirty(false); setMsg(''); }, [date, data.attendance]);
  const people = data.members.filter((m) => isCurrent(m) || sel.has(m.id));
  const byGroup = useMemo(() => {
    const g: Record<string, typeof people> = {};
    for (const m of [...people].sort((a, b) => a.name.localeCompare(b.name, 'ko'))) (g[m.group || '구역 없음'] ||= []).push(m);
    return Object.entries(g).sort(([a], [b]) => (a === '구역 없음' ? 1 : b === '구역 없음' ? -1 : a.localeCompare(b, 'ko')));
  }, [people]);
  const toggle = (id: string) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); setDirty(true); };
  const save = async () => {
    try { await api(`${base}/attendance/${date}`, { method: 'PUT', body: { memberIds: [...sel] } }); await reload(); setMsg('저장했습니다.'); setDirty(false); } catch (e: any) { setMsg(e.message); }
  };
  const recent = Object.keys(data.attendance).sort().slice(-8);
  const absent = absentees(data, today, 3);
  if (!data.members.length) return <p className="alert info">성도 명부에 성도를 먼저 넣어 주세요.</p>;
  return (
    <div className="grid2 wide-left">
      <div className="card">
        <div className="row between">
          <label className="inline">예배 날짜<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <span><b>{sel.size}</b>명 출석</span>
        </div>
        {byGroup.map(([g, ms]) => (
          <div key={g} className="att-group">
            <div className="muted small">{g} · {ms.filter((m) => sel.has(m.id)).length}/{ms.length}</div>
            <div className="att-grid">
              {ms.map((m) => (
                <button key={m.id} className={`att ${sel.has(m.id) ? 'on' : ''}`} onClick={() => toggle(m.id)} aria-pressed={sel.has(m.id)}>
                  {sel.has(m.id) ? '✓ ' : ''}{m.name}{m.status !== 'active' && <small> {STATUS_LABEL[m.status]}</small>}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="row end">
          {msg && <span className="muted">{msg}</span>}
          <button className="primary" disabled={!dirty} onClick={save}>출석 저장</button>
        </div>
      </div>
      <div className="col">
        <div className="card">
          <h3>3주 연속 결석</h3>
          {attendanceWeeks(data, today) < 3 ? <p className="muted small">출석을 3주 이상 기록하면 알려 드립니다.</p>
            : absent.length ? <p className="small">{absent.map((m) => m.name).join(', ')}</p> : <p className="muted small">없습니다.</p>}
        </div>
        <div className="card">
          <h3>최근 출석</h3>
          {recent.length ? (
            <ul className="plain att-recent">
              {[...recent].reverse().map((d) => <li key={d}><button className="link" onClick={() => setDate(d)}>{fmtDate(d)}</button> <b>{data.attendance[d].length}</b>명</li>)}
            </ul>
          ) : <p className="muted small">아직 기록이 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}

// ── 홈 화면용: 이번 주 돌볼 분 ─────────────────────────
export function CareCard() {
  const nav = useNavigate();
  const { data } = usePeople();
  if (!data) return null;
  const today = ymd(new Date());
  if (!data.members.length) {
    return (
      <div className="card care">
        <div className="row between"><h3>이번 주 돌볼 분</h3><button className="small" onClick={() => nav('/people')}>성도 명부 만들기</button></div>
        <p className="muted small">성도 명부를 만들면 생일·예정된 심방·연속 결석하신 분을 여기서 알려 드립니다.</p>
        <div className="care-grid"><WeekEvents /></div>
      </div>
    );
  }
  const births = upcomingBirthdays(data.members, today, 7);
  const due = dueVisits(data.visits, today, 7);
  const absent = absentees(data, today, 3);
  return (
    <div className="card care">
      <div className="row between"><h3>이번 주 돌볼 분</h3><button className="small" onClick={() => nav('/people')}>성도 명부</button></div>
      <div className="care-grid">
        <div>
          <div className="muted small">🎂 생일 (7일 안)</div>
          {births.length ? births.map(({ m, b }) => <div key={m.id}><b>{m.name}</b> {b.days === 0 ? '오늘' : fmtDate(b.date)}{m.lunar ? ` (음력 ${+m.birth.slice(-5, -3)}/${+m.birth.slice(-2)}${m.lunarLeap ? ' 윤달' : ''})` : ''}{b.age ? ` · ${b.age}세` : ''}</div>) : <div className="muted small">없습니다</div>}
        </div>
        <div>
          <div className="muted small">🏠 심방 예정</div>
          {due.length ? due.map((v) => <div key={v.id} className={v.date < today ? 'warn-text' : ''}><b>{names(data, v.memberIds)}</b> {fmtDate(v.date)}{v.date < today ? ' (지남)' : ''}</div>) : <div className="muted small">없습니다</div>}
          {due.length > 0 && <button className="link small" onClick={() => nav('/people/visits')}>심방 화면</button>}
        </div>
        <WeekEvents />
        <WeekServe members={data.members} />
        <div>
          <div className="muted small">📋 3주 연속 결석</div>
          {absent.length ? <div>{absent.map((m) => m.name).join(', ')}</div> : <div className="muted small">{attendanceWeeks(data, today) < 3 ? '출석 기록 3주부터' : '없습니다'}</div>}
        </div>
      </div>
    </div>
  );
}

// 성도 창에 올해 헌금 합계 (재정 장부에서 이분과 이어진 기록)
function Giving({ memberId }: { memberId: string }) {
  const { base } = useApp();
  const nav = useNavigate();
  const [g, setG] = useState<{ n: number; total: number } | null>(null);
  const year = String(new Date().getFullYear());
  useEffect(() => {
    api<{ tx: { memberId: string; type: string; date: string; amount: number; category: string }[] }>(`${base}/finance`)
      .then((f) => { const xs = f.tx.filter((t) => t.memberId === memberId && t.type === 'income' && t.date.startsWith(year) && !/이월금$/.test(t.category)); setG({ n: xs.length, total: xs.reduce((s, t) => s + t.amount, 0) }); })
      .catch(() => setG(null));
  }, [base, memberId, year]);
  if (!g || !g.n) return null;
  return <p className="small">💰 {year}년 헌금 {g.n}건 · {g.total.toLocaleString('ko-KR')}원 <button className="link" onClick={() => nav('/finance/receipts')}>기부금 영수증</button></p>;
}

// 성도 창: 이분의 기록을 날짜순으로 (심방·출석·헌금·증명서·봉사·회의 참석)
function History({ data, member }: { data: PeopleData; member: Member }) {
  const { base } = useApp();
  const [more, setMore] = useState<{ tx?: Tx[]; admin?: AdminData }>({});
  const [kind, setKind] = useState<HistKind | ''>('');
  const [all, setAll] = useState(false);
  useEffect(() => {
    api<{ tx: Tx[] }>(`${base}/finance`).then((f) => setMore((x) => ({ ...x, tx: f.tx }))).catch(() => {});
    api<AdminData>(`${base}/admin`).then((a) => setMore((x) => ({ ...x, admin: a }))).catch(() => {});
  }, [base]);
  const today = ymd(new Date());
  const items = useMemo(() => memberHistory(member, data, today, { tx: more.tx, certs: more.admin?.certs, serve: more.admin?.serve, minutes: more.admin?.minutes }), [member, data, today, more]);
  const kinds = (Object.keys(HIST_LABEL) as HistKind[]).filter((k) => items.some((x) => x.kind === k));
  const picked = items.filter((x) => !kind || x.kind === kind);
  const ahead = picked.filter((x) => x.future).reverse();   // 앞으로 할 일은 가까운 것부터 한 줄로
  const list = picked.filter((x) => !x.future);
  const shown = all ? list : list.slice(0, 12);
  return (
    <details className="sub-box history" open>
      <summary><b>기록 모아보기</b> <span className="muted small">{items.length}건 · 심방·출석·헌금·증명서·봉사·회의 참석</span></summary>
      {!items.length ? <p className="muted small">아직 기록이 없습니다. 심방·출석·헌금(장부에서 이분과 이어진 것)·봉사를 기록하면 여기 모입니다.</p> : <>
        <div className="seg small">
          <button className={!kind ? 'on' : ''} onClick={() => setKind('')}>전체</button>
          {kinds.map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{HIST_LABEL[k]}</button>)}
        </div>
        {ahead.length > 0 && <p className="small hist-ahead"><b>앞으로</b> {ahead.slice(0, 6).map((x) => `${+x.date.slice(5, 7)}/${+x.date.slice(8)} ${x.text.replace(/^봉사: /, '')}`).join(' · ')}{ahead.length > 6 ? ` 외 ${ahead.length - 6}건` : ''}</p>}
        <ul className="hist">
          {shown.map((x, i) => (
            <li key={i}>
              <span className="hist-date">{x.date.slice(0, 4)}.{+x.date.slice(5, 7)}.{+x.date.slice(8)}</span>
              <span className={`hist-kind k-${x.kind}`}>{HIST_LABEL[x.kind]}</span>
              <span>{x.text}</span>
            </li>
          ))}
        </ul>
        {list.length > shown.length && <button className="link small" onClick={() => setAll(true)}>{list.length - shown.length}건 더 보기</button>}
      </>}
    </details>
  );
}

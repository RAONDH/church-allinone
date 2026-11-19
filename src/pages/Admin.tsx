import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { Admin as AdminData, Cert, ChurchEvent, GcalCal, Member, Visit } from '../lib/types';
import { eventsOn, monthGrid, upcomingEvents } from '../lib/admin';
import { nextBirthday } from '../lib/people';
import MinutesTab from './MinutesTab';
import ServeTab from './ServeTab';
import { fmtDate, fmtTime, ymd } from '../lib/week';

const TABS = [['calendar', '일정'], ['minutes', '회의록'], ['serve', '봉사'], ['certs', '증명서']] as const;
const KINDS = ['예배', '행사', '회의', '교육', '심방', '기타'];

export function useAdmin() {
  const { base } = useApp();
  const [data, setData] = useState<AdminData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([api<AdminData>(`${base}/admin`), api<{ members: Member[]; visits: Visit[] }>(`${base}/people`)]);
      setData(a); setMembers(p.members); setVisits(p.visits); setErr('');
    } catch (e: any) { setErr(e.message); }
  }, [base]);
  useEffect(() => { load(); }, [load]);
  return { data, members, visits, err, load };
}

export default function Admin() {
  const { tab = 'calendar' } = useParams();
  const nav = useNavigate();
  const { data, members, visits, err, load } = useAdmin();
  const t = TABS.some(([k]) => k === tab) ? tab : 'calendar';
  return (
    <section>
      <div className="home-head"><div><h1>행정</h1><p className="muted small">🔒 행정 자료도 이 컴퓨터에만 저장됩니다.</p></div></div>
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={t === k ? 'on' : ''} onClick={() => nav(`/admin/${k}`)}>{l}</button>)}</div>
      {err && <p className="alert err">{err} <button onClick={load}>다시 시도</button></p>}
      {!data ? (!err && <p className="muted">불러오는 중…</p>)
        : t === 'calendar' ? <Calendar data={data} members={members} visits={visits} reload={load} />
        : t === 'minutes' ? <MinutesTab data={data} reload={load} />
        : t === 'serve' ? <ServeTab data={data} members={members} reload={load} />
        : <Certs data={data} members={members} reload={load} />}
    </section>
  );
}

// ── 일정 ──────────────────────────────────────────
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function Calendar({ data, members, visits, reload }: { data: AdminData; members: Member[]; visits: Visit[]; reload: () => Promise<void> }) {
  const nav = useNavigate();
  const today = ymd(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [edit, setEdit] = useState<ChurchEvent | { date: string } | null>(null);
  const [showCare, setShowCare] = useState(true);
  const weeks = monthGrid(month);
  const shift = (n: number) => { const d = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1); setMonth(ymd(d).slice(0, 7)); };
  const name = (id: string) => members.find((m) => m.id === id)?.name || '';
  const birthdaysOn = (d: string) => showCare ? members.filter((m) => (m.status === 'active' || m.status === 'inactive') && nextBirthday(m.birth, d, m)?.days === 0) : [];
  const visitsOn = (d: string) => showCare ? visits.filter((v) => v.planned && v.date === d) : [];
  const [gview, setGview] = useState<(ChurchEvent & { cal?: string }) | null>(null);
  const calOf = (id?: string) => data.gcals.find((g) => g.id === id);
  const gev = data.gcalEvents.map((e) => ({ ...e, kind: '구글' }));
  const up = upcomingEvents([...data.events, ...gev], today, 30);
  return (
    <>
      {!data.gcals.length && <GcalCard cals={data.gcals} reload={reload} />}
      <div className="card">
        <div className="row between">
          <div className="row">
            <button className="icon" onClick={() => shift(-1)} aria-label="지난달">◀</button>
            <b className="month-label">{+month.slice(0, 4)}년 {+month.slice(5, 7)}월</b>
            <button className="icon" onClick={() => shift(1)} aria-label="다음 달">▶</button>
            {month !== today.slice(0, 7) && <button className="link" onClick={() => setMonth(today.slice(0, 7))}>이번 달</button>}
          </div>
          <div className="row wrap">
            <label className="check"><input type="checkbox" checked={showCare} onChange={(e) => setShowCare(e.target.checked)} />생일·심방 예정</label>
            {data.gcals.length > 0 && <GcalToggles cals={data.gcals} reload={reload} />}
            <button className="primary" onClick={() => setEdit({ date: today })}>일정 추가</button>
          </div>
        </div>
        <div className="cal">
          {DOW.map((d, i) => <div key={d} className={`cal-dow ${i === 0 ? 'sun' : ''}`}>{d}</div>)}
          {weeks.flat().map((d) => {
            const evs = eventsOn([...data.events, ...gev], d);
            return (
              <div key={d} className={`cal-day ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today ? 'today' : ''}`} onClick={() => setEdit({ date: d })}>
                <div className={`cal-num ${new Date(d + 'T00:00:00').getDay() === 0 ? 'sun' : ''}`}>{+d.slice(8)}</div>
                {evs.map((e) => <button key={e.id} style={e.kind === '구글' ? { background: `${calOf((e as any).cal)?.color || '#1a73e8'}1f`, color: calOf((e as any).cal)?.color || '#1a73e8' } : undefined} className={`cal-ev k-${KINDS.indexOf(e.kind)} ${e.kind === '구글' ? 'g' : ''}`} onClick={(x) => { x.stopPropagation(); if (e.kind === '구글') setGview(e); else setEdit(e); }} title={e.title}>{e.time && <small>{e.time} </small>}{e.title}</button>)}
                {visitsOn(d).map((v) => <button key={v.id} className="cal-ev care" onClick={(x) => { x.stopPropagation(); nav('/people/visits'); }}>🏠 {v.memberIds.map(name).join(', ')}</button>)}
                {birthdaysOn(d).map((m) => <div key={m.id} className="cal-ev care">🎂 {m.name}</div>)}
              </div>
            );
          })}
        </div>
        <p className="muted small">날짜 칸을 누르면 그날 일정을 추가합니다. 심방 예정은 성도 → 심방에서, 생일은 성도 명부에서 옵니다.</p>
      </div>
      <div className="card">
        <h3>앞으로 30일 일정</h3>
        {up.length ? (
          <ul className="visit-list">
            {up.map((e) => <li key={e.id} onClick={() => (e.kind === '구글' ? setGview(e) : setEdit(e))}><span className="muted">{fmtDate(e.date)}{e.endDate ? ` ~ ${fmtDate(e.endDate)}` : ''}{e.time ? ` ${e.time}` : ''}</span><span className="pill info" style={e.kind === '구글' ? { color: calOf((e as any).cal)?.color } : undefined}>{e.kind === '구글' ? calOf((e as any).cal)?.name || '구글' : e.kind}</span><b>{e.title}</b>{e.place && <span className="muted">@ {e.place}</span>}{e.memo && <span className="visit-note">{e.memo}</span>}</li>)}
          </ul>
        ) : <p className="muted small">없습니다.</p>}
      </div>
      {data.gcals.length > 0 && <GcalCard cals={data.gcals} reload={reload} />}
      {edit && <EventDialog ev={'id' in edit ? edit : null} date={edit.date} onClose={() => setEdit(null)} reload={reload} />}
      {gview && (
        <div className="dialog-back" onClick={() => setGview(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
            <h2>{gview.title}</h2>
            <p>{fmtDate(gview.date)}{gview.endDate ? ` ~ ${fmtDate(gview.endDate)}` : ''}{gview.time ? ` ${gview.time}` : ''}{gview.place ? ` · ${gview.place}` : ''}</p>
            {gview.memo && <p className="visit-note">{gview.memo}</p>}
            <p className="muted small">구글 캘린더 '{calOf(gview.cal)?.name}'에서 받아 온 일정입니다. 고치려면 구글 캘린더에서 고쳐 주세요.</p>
            <div className="row end"><button onClick={() => setGview(null)}>닫기</button></div>
          </div>
        </div>
      )}
    </>
  );
}

// 달력 위: 캘린더별 보이기·숨기기
function GcalToggles({ cals, reload }: { cals: GcalCal[]; reload: () => Promise<void> }) {
  const { base } = useApp();
  const toggle = async (g: GcalCal) => { await api(`${base}/gcals/${g.id}`, { method: 'PUT', body: { hidden: !g.hidden } }).catch(() => {}); await reload(); };
  return <>{cals.map((g) => <label key={g.id} className="check cal-toggle"><input type="checkbox" checked={!g.hidden} onChange={() => toggle(g)} /><i style={{ background: g.color }} />{g.name}</label>)}</>;
}

// 구글 캘린더 여러 개: 비공개 주소로 받아 보기 (+ 반대로 파일로 보내기)
function GcalCard({ cals, reload }: { cals: GcalCal[]; reload: () => Promise<void> }) {
  const { base, ws } = useApp();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(!cals.length);
  const [adding, setAdding] = useState(!cals.length);
  const [rename, setRename] = useState<{ id: string; to: string } | null>(null);
  // 15분 넘게 지났으면 들어올 때 새로 받기
  useEffect(() => {
    if (cals.some((g) => Date.now() - (g.fetchedAt || 0) > 15 * 60000)) api(`${base}/gcals/refresh`, { method: 'POST' }).then(reload).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  const connect = async () => {
    setBusy(true); setMsg('');
    try { const r = await api<{ gcal: GcalCal }>(`${base}/gcals`, { method: 'POST', body: { url } }); setUrl(''); await reload(); setMsg(`'${r.gcal.name}' 캘린더를 연결했습니다 (일정 ${r.gcal.count}개). 다른 캘린더도 이어서 더할 수 있습니다.`); } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  const refresh = async () => { setBusy(true); setMsg(''); try { await api(`${base}/gcals/refresh`, { method: 'POST' }); await reload(); setMsg('모두 새로 받았습니다.'); } catch (e: any) { setMsg(e.message); } setBusy(false); };
  const put = async (g: GcalCal, body: object) => { try { await api(`${base}/gcals/${g.id}`, { method: 'PUT', body }); await reload(); } catch (e: any) { setMsg(e.message); } };
  const remove = async (g: GcalCal) => {
    if (!confirm(`'${g.name}' 캘린더 연결을 끊을까요? 그 캘린더 일정이 여기 달력에서 사라집니다. (구글 캘린더 자체는 그대로입니다)`)) return;
    await api(`${base}/gcals/${g.id}`, { method: 'DELETE' }); await reload();
  };
  const COLORS = ['#1a73e8', '#d81b60', '#0b8043', '#f4511e', '#8e24aa', '#039be5', '#e67c73', '#7986cb', '#33b679', '#f6bf26'];
  return (
    <div className="card">
      <div className="row between">
        <h3>{cals.length ? `구글 캘린더 ${cals.length}개 연결됨` : '📅 구글 캘린더에 적은 일정을 여기서 보기'}</h3>
        <button className="link" onClick={() => setOpen(!open)}>{open ? '접기' : '펼치기'}</button>
      </div>
      {open && (
        <>
          {ws === 'sample' ? <p className="alert warn small">예제 자료에서는 연결하지 않습니다. '우리 교회'로 바꾼 뒤 연결해 주세요.</p> : (
            <>
              {cals.length > 0 && (
                <>
                  <ul className="cat-list gcal-list">
                    {cals.map((g) => (
                      <li key={g.id}>
                        <details className="color-pick"><summary><i style={{ background: g.color }} /></summary>
                          <div>{COLORS.map((c) => <button key={c} aria-label={`색 ${c}`} style={{ background: c }} onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; put(g, { color: c }); }} />)}</div>
                        </details>
                        {rename?.id === g.id ? (
                          <>
                            <input autoFocus value={rename.to} onChange={(e) => setRename({ id: g.id, to: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { put(g, { label: rename.to }); setRename(null); } }} />
                            <button className="small primary" onClick={() => { put(g, { label: rename.to }); setRename(null); }}>저장</button>
                          </>
                        ) : (
                          <span className="grow"><b>{g.name}</b> <span className="muted small">· 일정 {g.count}개{g.fetchedAt ? ` · ${fmtTime(g.fetchedAt)}에 받음` : ''}</span>{g.error && <span className="warn-text small"> · {g.error}</span>}</span>
                        )}
                        <label className="check small"><input type="checkbox" checked={!g.hidden} onChange={() => put(g, { hidden: !g.hidden })} />보기</label>
                        {rename?.id !== g.id && <button className="small" onClick={() => setRename({ id: g.id, to: g.name })}>이름</button>}
                        <button className="small" onClick={() => remove(g)}>연결 끊기</button>
                      </li>
                    ))}
                  </ul>
                  <div className="row wrap">
                    <button disabled={busy} onClick={refresh}>{busy ? '받는 중…' : '모두 지금 새로 받기'}</button>
                    {!adding && <button className="primary" onClick={() => setAdding(true)}>캘린더 더 연결하기</button>}
                  </div>
                  <p className="muted small">라온 교회 올인원이 켜져 있는 동안 15분마다 저절로 새로 받습니다. 구글 캘린더에서 적고 고치면 여기 달력과 홈 화면에 나옵니다. 고치는 것은 구글 캘린더에서 합니다.</p>
                </>
              )}
              {adding && (
                <div className={cals.length ? 'sub-box' : ''}>
                  <ol className="small">
                    <li>구글 캘린더 왼쪽 <b>내 캘린더</b>에서 캘린더 이름에 마우스를 올리고 <b>⋮ → 설정 및 공유</b></li>
                    <li>아래로 내려 <b>캘린더 통합</b> → <b>iCal 형식의 비공개 주소</b> 칸 오른쪽의 <b>복사 단추(⧉)</b> 누르기</li>
                    <li>아래 칸에 붙여 넣고 <b>연결</b> — 캘린더마다 주소가 따로 있으니, 보고 싶은 캘린더마다 한 번씩 합니다</li>
                  </ol>
                  <p className="alert warn small">파일을 받는 것이 아닙니다. '가져오기/내보내기'의 <b>내보내기</b>(zip 파일)나 주소 글자를 누르면 파일이 받아지는데, 그 파일은 필요 없습니다. <b>복사 단추</b>로 주소만 복사해 오세요. 주소는 <code>https://calendar.google.com/calendar/ical/…/private-…/basic.ics</code> 모양입니다.</p>
                  <div className="row"><input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) connect(); }} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" /><button className="primary" disabled={busy || !url.trim()} onClick={connect}>{busy ? '확인 중…' : '연결'}</button></div>
                  <p className="muted small">🔒 비공개 주소는 이 컴퓨터에만 저장됩니다. 다른 사람에게 알려 주지 마세요. 이 기능만 인터넷을 씁니다.</p>
                </div>
              )}
              {msg && <p className="small">{msg}</p>}
            </>
          )}
          <details className="send-g">
            <summary>반대로, 여기 적은 일정을 구글로 보내고 싶을 때 (대부분은 필요 없음)</summary>
            <a className="btn" href={`${base}/events.ics`}>구글 캘린더용 파일 받기 (.ics)</a>
            <ol className="small">
              <li>구글 캘린더(웹) 오른쪽 위 ⚙ <b>설정 → 가져오기/내보내기</b></li>
              <li><b>가져오기</b>에서 받은 파일을 고르고, 넣을 캘린더를 고른 뒤 <b>가져오기</b></li>
            </ol>
            <p className="muted small">여기서 보낸 일정은 구글에서 다시 받아 올 때 겹쳐 보이지 않게 빼 둡니다.</p>
          </details>
        </>
      )}
    </div>
  );
}

function EventDialog({ ev, date, onClose, reload }: { ev: ChurchEvent | null; date: string; onClose: () => void; reload: () => Promise<void> }) {
  const { base } = useApp();
  const [f, setF] = useState({ date: ev?.date || date, endDate: ev?.endDate || '', time: ev?.time || '', title: ev?.title || '', kind: ev?.kind || '행사', place: ev?.place || '', memo: ev?.memo || '' });
  const [err, setErr] = useState('');
  const save = async () => {
    try { await api(ev ? `${base}/events/${ev.id}` : `${base}/events`, { method: ev ? 'PUT' : 'POST', body: f }); await reload(); onClose(); } catch (e: any) { setErr(e.message); }
  };
  const remove = async () => {
    if (!ev || !confirm(`'${ev.title}' 일정을 지울까요?`)) return;
    try { await api(`${base}/events/${ev.id}`, { method: 'DELETE' }); await reload(); onClose(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>{ev ? '일정 고치기' : '일정 추가'}</h2>
        <label>일정 이름<input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="예: 제직회, 성탄 발표회" /></label>
        <div className="form-grid">
          <label>날짜<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label>끝나는 날 (여러 날이면)<input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
          <label>시간<input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
          <label>종류<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="span2">장소<input value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} /></label>
          <label className="span2">메모<textarea rows={3} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></label>
        </div>
        {err && <p className="alert err">{err}</p>}
        <div className="row between">
          {ev ? <button className="danger-link" onClick={remove}>일정 지우기</button> : <span />}
          <div className="row"><button onClick={onClose}>취소</button><button className="primary" onClick={save}>저장</button></div>
        </div>
      </div>
    </div>
  );
}

// ── 증명서 ─────────────────────────────────────────
function Certs({ data, members, reload }: { data: AdminData; members: Member[]; reload: () => Promise<void> }) {
  const { base, ov } = useApp();
  const [type, setType] = useState('교인증명서');
  const [memberId, setMemberId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [err, setErr] = useState('');
  const [show, setShow] = useState<Cert | null>(null);
  const cands = useMemo(() => members.filter((m) => m.status === 'active' || m.status === 'inactive').filter((m) => type !== '세례증명서' || ['세례', '유아세례', '입교'].includes(m.baptism)).sort((a, b) => a.name.localeCompare(b.name, 'ko')), [members, type]);
  const issue = async () => {
    setErr('');
    try { const r = await api<{ cert: Cert }>(`${base}/certs`, { method: 'POST', body: { type, memberId, purpose } }); await reload(); setShow(r.cert); } catch (e: any) { setErr(e.message); }
  };
  const log = [...data.certs].sort((a, b) => b.createdAt - a.createdAt);
  const church = ov?.church?.name || '', pastor = ov?.church?.pastor || '';
  return (
    <>
      <div className="grid2">
        <div className="card">
          <h3>증명서 발급</h3>
          <label>종류<select value={type} onChange={(e) => { setType(e.target.value); setMemberId(''); }}><option>교인증명서</option><option>세례증명서</option></select></label>
          <label>성도<select value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">이름을 고르세요</option>{cands.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` (${m.role})` : ''}</option>)}</select></label>
          {type === '세례증명서' && <p className="muted small">성도 명부에 세례(세례·유아세례·입교)가 적힌 분만 나옵니다. 세례일·세례 교회·집례자를 적어 두면 증명서에 들어갑니다.</p>}
          <label>용도<input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="예: 학교 제출용, 이명용" /></label>
          {err && <p className="alert err">{err}</p>}
          <button className="primary" disabled={!memberId} onClick={issue}>발급하고 미리 보기</button>
          <p className="muted small">발급하면 발급 대장에 번호(연도-순번)와 함께 남습니다. 증명서 내용은 발급할 때의 성도 명부 정보입니다.</p>
        </div>
        <div className="card">
          <h3>발급 대장 {log.length}건</h3>
          {log.length ? (
            <table className="people-table"><thead><tr><th>번호</th><th>날짜</th><th>종류</th><th>이름</th><th>용도</th></tr></thead>
              <tbody>{log.map((c) => <tr key={c.id} onClick={() => setShow(c)}><td>{c.no}</td><td>{c.date}</td><td>{c.type}</td><td>{c.snap.name}</td><td className="muted">{c.purpose}</td></tr>)}</tbody>
            </table>
          ) : <p className="muted small">아직 발급한 증명서가 없습니다.</p>}
        </div>
      </div>
      {show && (
        <>
          <div className="dialog-back" onClick={() => setShow(null)}>
            <div className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
              <CertDoc c={show} church={church} pastor={pastor} />
              <div className="row end"><button onClick={() => setShow(null)}>닫기</button><button className="primary" onClick={() => window.print()}>인쇄</button></div>
            </div>
          </div>
          <div className="print-area"><CertDoc c={show} church={church} pastor={pastor} /></div>
        </>
      )}
    </>
  );
}

const ko = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${+d.slice(0, 4)}년 ${+d.slice(5, 7)}월 ${+d.slice(8)}일` : /^\d{2}-\d{2}$/.test(d) ? `${+d.slice(0, 2)}월 ${+d.slice(3)}일` : d);

function CertDoc({ c, church, pastor }: { c: Cert; church: string; pastor: string }) {
  const s = c.snap;
  const baptism = c.type === '세례증명서';
  return (
    <div className="doc cert">
      <div className="receipt-no">제 {c.no} 호</div>
      <h2 className="doc-title cert-title">{c.type.split('').join(' ')}</h2>
      <table className="doc-table">
        <tbody>
          <tr><th>성명</th><td>{s.name}</td><th>성별</th><td>{s.gender}</td></tr>
          <tr><th>생년월일</th><td colSpan={3}>{ko(s.birth)}</td></tr>
          <tr><th>주소</th><td colSpan={3}>{s.address}</td></tr>
          {baptism ? <>
            <tr><th>구분</th><td>{s.baptism}</td><th>세례일</th><td>{ko(s.baptismDate)}</td></tr>
            <tr><th>세례 교회</th><td>{s.baptismPlace || church}</td><th>집례자</th><td>{s.baptismBy}</td></tr>
          </> : <>
            <tr><th>직분</th><td>{s.role}</td><th>등록일</th><td>{ko(s.registeredAt)}</td></tr>
            <tr><th>세례</th><td colSpan={3}>{s.baptism || '-'}{s.baptismDate ? ` (${ko(s.baptismDate)})` : ''}</td></tr>
          </>}
          <tr><th>용도</th><td colSpan={3}>{c.purpose}</td></tr>
        </tbody>
      </table>
      <p className="cert-text">{baptism ? '위 사람은 위와 같이 세례를 받았음을 증명합니다.' : `위 사람은 ${church}에 등록된 교인임을 증명합니다.`}</p>
      <p className="receipt-sign">{ko(c.date)}<br /><b>{church}</b> 담임목사 {pastor} (인)</p>
    </div>
  );
}

// ── 홈 화면용: 이번 주 일정 ───────────────────────────
export function WeekEvents() {
  const { base } = useApp();
  const nav = useNavigate();
  const [evs, setEvs] = useState<ChurchEvent[] | null>(null);
  useEffect(() => { api<AdminData>(`${base}/admin`).then((a) => setEvs([...a.events, ...a.gcalEvents])).catch(() => setEvs(null)); }, [base]);
  if (!evs) return null;
  const up = upcomingEvents(evs, ymd(new Date()), 7);
  return (
    <div>
      <div className="muted small">📅 7일 안 일정</div>
      {up.length ? up.map((e) => <div key={e.id}><b>{e.title}</b> {fmtDate(e.date)}{e.time ? ` ${e.time}` : ''}</div>) : <div className="muted small">없습니다</div>}
      <button className="link small" onClick={() => nav('/admin')}>일정 화면</button>
    </div>
  );
}

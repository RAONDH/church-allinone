// 회의록 + 회의록 작성기 (녹음·녹음 파일 → 녹취 → AI 정리: 내용 정리 · 결정 사항 · 해야 할 일 · 전체 녹취록)
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { useGuardedClose } from '../lib/guard';
import { api } from '../lib/api';
import type { Admin as AdminData, Minutes } from '../lib/types';
import { fmtDate, fmtTime, ymd } from '../lib/week';
import { decodeToWav, needsConvert, Recorder } from '../lib/audio';

const TEMPLATE = '1. 개회 기도\n2. 지난 회의록 낭독 및 채택\n3. 보고\n  - 재정 보고\n  - 부서 보고\n4. 안건\n  - \n5. 기타\n6. 폐회 기도';

interface Job { stage: 'transcribe' | 'summarize'; progress: number; startedAt: number; error: string; label: string }
interface Stt {
  platform: 'mac' | 'windows' | 'other'; engine: boolean; brew: boolean; canDownloadEngine: boolean; sample: boolean;
  models: Record<string, { label: string; size: number; ready: boolean }>;
  installs: Record<string, { done: number; size: number; error: string }>;
  jobs: Record<string, Job>;
}
const mb = (n: number) => `${Math.round(n / 1048576)}MB`;
const clock = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor(s / 60) % 60).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

function useStt() {
  const { base } = useApp();
  const [st, setSt] = useState<Stt | null>(null);
  const load = useCallback(() => api<Stt>(`${base}/stt`).then(setSt).catch(() => {}), [base]);
  useEffect(() => { load(); }, [load]);
  const busy = !!st && (Object.keys(st.jobs).length > 0 || Object.values(st.installs).some((x) => !x.error));
  useEffect(() => { if (!busy) return; const t = setInterval(load, 2500); return () => clearInterval(t); }, [busy, load]);
  return { st, load };
}
const sttReady = (st: Stt | null) => !!st && (st.sample || (st.engine && Object.values(st.models).some((m) => m.ready)));

export default function MinutesTab({ data, reload }: { data: AdminData; reload: () => Promise<void> }) {
  const { ov } = useApp();
  const { st, load: loadStt } = useStt();
  const [edit, setEdit] = useState<Minutes | 'new' | null>(null);
  const [view, setView] = useState<Minutes | null>(null);
  const [rec, setRec] = useState(false);
  const [setup, setSetup] = useState(false);
  const [types, setTypes] = useState(false);
  const [qs, setQs] = useState('');
  const [kind, setKind] = useState('');
  // 작업이 끝나면 회의록 목록도 새로
  const running = st ? Object.keys(st.jobs).join(',') : '';
  const prev = useRef(running);
  useEffect(() => { if (prev.current && prev.current !== running) reload(); prev.current = running; }, [running, reload]);
  const kinds = [...new Set([...data.meetingTypes, ...data.minutes.map((m) => m.meeting)])].filter((k) => data.minutes.some((m) => m.meeting === k));
  const list = data.minutes.filter((m) => !kind || m.meeting === kind)
    .filter((m) => !qs.trim() || [m.title, m.content, m.decisions, m.attendees, m.todos || '', m.transcript || ''].some((v) => v.includes(qs.trim())))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const cur = view && data.minutes.find((m) => m.id === view.id);
  return (
    <>
      <div className="card recorder-hero">
        <div>
          <h3>🎙 회의록 작성기</h3>
          <p className="small muted">회의를 녹음하거나 녹음 파일을 넣으면, 이 컴퓨터에서 글로 받아 적고(녹취) AI가 <b>내용 정리 · 결정 사항 · 해야 할 일</b>로 정리합니다. 전체 녹취록도 함께 남습니다.</p>
        </div>
        <div className="row wrap">
          <button onClick={() => setSetup(true)}>녹취 준비{st && !sttReady(st) ? ' ⚠️' : ''}</button>
          <button className="primary" onClick={() => setRec(true)}>녹음으로 회의록 만들기</button>
        </div>
      </div>
      <div className="card">
        <div className="row between">
          <div className="row wrap">
            <input className="search" placeholder="내용·결정·녹취록에서 찾기" value={qs} onChange={(e) => setQs(e.target.value)} />
            <select className="auto" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">모든 회의</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select>
          </div>
          <div className="row"><button onClick={() => setTypes(true)}>회의 이름 관리</button><button onClick={() => setEdit('new')}>직접 쓰기</button></div>
        </div>
        {!list.length ? <p className="muted">{data.minutes.length ? '찾는 회의록이 없습니다.' : '아직 회의록이 없습니다.'}</p> : (
          <ul className="visit-list">
            {list.map((m) => {
              const job = st?.jobs[m.id];
              return (
                <li key={m.id} onClick={() => setView(m)}>
                  <span className="muted">{fmtDate(m.date)}</span><span className="pill info">{m.meeting}</span><b>{m.title || `${m.meeting} 회의록`}</b>
                  {m.audio && <span title="녹음 있음">🎙</span>}
                  {m.recording && <span className={`pill ${recCut(m) ? 'warn' : 'info'}`}>{recCut(m) ? '녹음이 끊김' : '녹음 중'} · {clock(m.recording.seconds || 0)} 저장됨</span>}
                  {job ? <JobPill job={job} /> : m.ai ? <span className="pill done">AI 정리됨</span> : m.transcript ? <span className="pill todo">녹취록만 있음</span> : null}
                  {m.decisions && <span className="visit-note">결정: {m.decisions.split('\n')[0]}{m.decisions.includes('\n') ? ' …' : ''}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {cur && (
        <MinutesView m={cur} st={st} church={ov?.church?.name || ''} onClose={() => setView(null)} onEdit={() => { setEdit(cur); setView(null); }} reload={async () => { await reload(); await loadStt(); }} />
      )}
      {edit && <MinutesDialog m={edit === 'new' ? null : edit} types={data.meetingTypes} onClose={() => setEdit(null)} reload={reload} />}
      {types && <MeetingTypes data={data} onClose={() => setTypes(false)} reload={reload} />}
      {rec && <RecorderDialog types={data.meetingTypes} st={st} onSetup={() => setSetup(true)} onClose={() => setRec(false)} reload={async () => { await reload(); await loadStt(); }} />}
      {setup && <SttSetup st={st} load={loadStt} onClose={() => setSetup(false)} />}
    </>
  );
}

function JobPill({ job }: { job: Job }) {
  if (job.error) return <span className="pill warn">{job.stage === 'transcribe' ? '녹취' : 'AI 정리'} 실패</span>;
  return <span className="pill info">{job.stage === 'transcribe' ? `녹취 중 ${job.progress}%` : `AI 정리 중 (${job.label})`}</span>;
}

// ── 회의록 보기 (녹음 듣기 · 녹취 · AI 정리 · 인쇄) ─────────────────────
function MinutesView({ m, st, church, onClose, onEdit, reload }: { m: Minutes; st: Stt | null; church: string; onClose: () => void; onEdit: () => void; reload: () => Promise<void> }) {
  const { base } = useApp();
  const [err, setErr] = useState('');
  const [withTranscript, setWithTranscript] = useState(false);
  const job = st?.jobs[m.id];
  const run = async (what: 'transcribe' | 'summarize', extra: object = {}) => {
    setErr('');
    try { await api(`${base}/minutes/${m.id}/${what}`, { method: 'POST', body: extra }); await reload(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <>
      <div className="dialog-back" onClick={onClose}>
        <div className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
          {m.recording && <RecoverBox m={m} reload={reload} />}
          {m.audio && (
            <div className="sub-box">
              <div className="row between wrap">
                <b className="small">🎙 {m.audio.name} · {mb(m.audio.size)}</b>
                <a className="small" href={`${base}/minutes/${m.id}/audio?download=1`}>녹음 파일 받기</a>
              </div>
              <audio controls preload="none" src={`${base}/minutes/${m.id}/audio`} style={{ width: '100%', marginTop: 6 }} />
              <div className="row wrap" style={{ marginTop: 6 }}>
                {job && !job.error ? <JobPill job={job} /> : (
                  <>
                    <button className="small" disabled={!sttReady(st)} onClick={() => run('transcribe', { auto: true })}>{m.transcript ? '다시 녹취하고 정리' : '녹취하고 AI로 정리'}</button>
                    {!sttReady(st) && <span className="muted small">녹취 준비가 필요합니다</span>}
                  </>
                )}
                {job?.error && <span className="warn-text small">{job.error}</span>}
              </div>
            </div>
          )}
          {!m.audio && job && <p><JobPill job={job} /> {job.error && <span className="warn-text small">{job.error}</span>}</p>}
          <MinutesDoc m={m} church={church} withTranscript />
          {err && <p className="alert err">{err}</p>}
          <div className="row between wrap">
            <div className="row wrap">
              {m.transcript?.trim() && !(job && !job.error) && (
                <button onClick={() => { if (!m.ai || confirm('AI가 녹취록으로 다시 정리합니다. 내용 정리·결정 사항·해야 할 일 칸을 새 결과로 바꿀까요?')) run('summarize', { overwrite: true }); }}>{m.ai ? 'AI로 다시 정리' : 'AI로 정리'}</button>
              )}
              <label className="check small"><input type="checkbox" checked={withTranscript} onChange={(e) => setWithTranscript(e.target.checked)} />녹취록도 인쇄</label>
            </div>
            <div className="row">
              <button onClick={onClose}>닫기</button>
              <button onClick={onEdit}>고치기</button>
              <button className="primary" onClick={() => window.print()}>인쇄</button>
            </div>
          </div>
          {m.transcript?.trim() && <p className="muted small">AI로 정리하면 녹취록 글이 연결된 AI(Claude·ChatGPT 구독 또는 제미나이 API 키)로 보내집니다. 녹음 파일은 보내지 않습니다.</p>}
        </div>
      </div>
      <div className="print-area"><MinutesDoc m={m} church={church} withTranscript={withTranscript} print /></div>
    </>
  );
}

export function MinutesDoc({ m, church, withTranscript = false, print = false }: { m: Minutes; church: string; withTranscript?: boolean; print?: boolean }) {
  return (
    <div className="doc">
      <h2 className="doc-title">{church} {m.title || `${m.meeting} 회의록`}</h2>
      <table className="doc-table">
        <tbody>
          <tr><th>회의</th><td>{m.meeting}</td><th>일시</th><td>{fmtDate(m.date)}</td></tr>
          <tr><th>장소</th><td>{m.place}</td><th>사회</th><td>{m.chair}</td></tr>
          <tr><th>참석</th><td colSpan={3}>{m.attendees}</td></tr>
        </tbody>
      </table>
      <h3>회의 내용</h3>
      <div className="doc-body">{m.content || <span className="muted">아직 없습니다.</span>}</div>
      {m.decisions && <><h3>결정 사항</h3><div className="doc-body">{m.decisions}</div></>}
      {m.todos && <><h3>해야 할 일</h3><div className="doc-body">{m.todos}</div></>}
      {!print && m.ai && <p className="muted small">AI 정리: {fmtTime(m.ai.at)} · {m.ai.via}. 녹취와 AI 정리는 틀릴 수 있으니 꼭 읽어 보고 고쳐 주세요.</p>}
      <div className="doc-sign"><span>회장 {m.chair} (인)</span><span>서기 {m.recorder} (인)</span></div>
      {withTranscript && m.transcript?.trim() && (print
        ? <><h3 className="page-break">전체 녹취록</h3><div className="doc-body transcript">{m.transcript}</div></>
        : <details className="transcript-box"><summary>전체 녹취록{m.stt ? ` (${clock(m.stt.seconds)} · ${m.stt.model === 'sample' ? '예제' : m.stt.model})` : ''}</summary><div className="doc-body transcript">{m.transcript}</div></details>)}
    </div>
  );
}

function MinutesDialog({ m, types, onClose, reload, init }: { m: Minutes | null; types: string[]; onClose: () => void; reload: () => Promise<void>; init?: Partial<Minutes> }) {
  const g = useGuardedClose(onClose);
  const { base, ov } = useApp();
  const [f, setF] = useState({
    date: m?.date || ymd(new Date()), meeting: m?.meeting || types[0] || '회의', title: m?.title || '', place: m?.place || '', attendees: m?.attendees || '',
    content: m?.content ?? TEMPLATE, decisions: m?.decisions || '', todos: m?.todos || '', transcript: m?.transcript || '',
    chair: m?.chair || ov?.church?.pastor || '', recorder: m?.recorder || '', ...init,
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try { await api(m ? `${base}/minutes/${m.id}` : `${base}/minutes`, { method: m ? 'PUT' : 'POST', body: f }); await reload(); onClose(); } catch (e: any) { setErr(e.message); }
  };
  const remove = async () => {
    if (!m || !confirm(`이 회의록을 지울까요?${m.audio ? ' 녹음 파일도 함께 지워집니다.' : ''} 되돌릴 수 없습니다.`)) return;
    try { await api(`${base}/minutes/${m.id}`, { method: 'DELETE' }); await reload(); onClose(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="dialog-back" onClick={g.close}>
      <div {...g.track} className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>{m ? '회의록 고치기' : '회의록 쓰기'}</h2>
        <datalist id="meetings">{types.map((x) => <option key={x} value={x} />)}</datalist>
        <div className="form-grid">
          <label>회의 <span className="muted small">(목록에서 고르거나 새 이름 쓰기)</span><input list="meetings" value={f.meeting} onChange={set('meeting')} /></label>
          <label>날짜<input type="date" value={f.date} onChange={set('date')} /></label>
          <label className="span2">제목<input value={f.title} onChange={set('title')} placeholder={`예: 11월 정기 ${f.meeting}`} /></label>
          <label>장소<input value={f.place} onChange={set('place')} /></label>
          <label>사회 (회장)<input value={f.chair} onChange={set('chair')} /></label>
          <label className="span2">참석자<input value={f.attendees} onChange={set('attendees')} placeholder="이름을 쉼표로" /></label>
          <label className="span2">회의 내용<textarea rows={9} value={f.content} onChange={set('content')} /></label>
          <label className="span2">결정 사항<textarea rows={4} value={f.decisions} onChange={set('decisions')} placeholder="1. …" /></label>
          <label className="span2">해야 할 일<textarea rows={3} value={f.todos} onChange={set('todos')} placeholder="- [담당자] 할 일 (기한)" /></label>
          <label className="span2">전체 녹취록 <span className="muted small">(클로바노트 등에서 받은 녹취록 글을 붙여 넣어도 AI로 정리할 수 있습니다)</span><textarea rows={5} value={f.transcript} onChange={set('transcript')} /></label>
          <label>서기<input value={f.recorder} onChange={set('recorder')} /></label>
        </div>
        {err && <p className="alert err">{err}</p>}
        <div className="row between">
          {m ? <button className="danger-link" onClick={remove}>회의록 지우기</button> : <span />}
          <div className="row"><button onClick={g.close}>취소</button><button className="primary" onClick={save}>저장</button></div>
        </div>
      </div>
    </div>
  );
}

// ── 녹음으로 회의록 만들기 ───────────────────────────────
function RecorderDialog({ types, st, onSetup, onClose, reload }: { types: string[]; st: Stt | null; onSetup: () => void; onClose: () => void; reload: () => Promise<void> }) {
  const { base, ov } = useApp();
  const [info, setInfo] = useState({ meeting: types[0] || '회의', date: ymd(new Date()), title: '', attendees: '', chair: ov?.church?.pastor || '' });
  const [mode, setMode] = useState<'choose' | 'recording' | 'paste' | 'sending' | 'done'>('choose');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [paused, setPaused] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(true);
  const [text, setText] = useState('');
  const recRef = useRef<Recorder | null>(null);
  // 붙여 넣은 녹취록·적어 둔 참석자가 있으면 바깥을 눌러 닫기 전에 묻는다 (다 보낸 뒤에는 묻지 않음)
  const g = useGuardedClose(onClose, () => mode !== 'done' && !!(text.trim() || info.attendees.trim() || info.title.trim()));
  const ready = sttReady(st);
  // 녹음 조각 저장: 녹음을 시작하면 회의록을 먼저 만들고, 30초마다 서버에 이어 붙인다 (창이 닫혀도 저장된 데까지 남음)
  const mRef = useRef<string>('');
  const queue = useRef<Int16Array[]>([]);
  const seqRef = useRef(0);
  const sending = useRef<Promise<void> | null>(null);
  const [savedSecs, setSavedSecs] = useState(0);
  const [lag, setLag] = useState(false);
  const flush = () => {
    if (sending.current) return sending.current;
    sending.current = (async () => {
      while (queue.current.length && mRef.current) {
        const piece = queue.current[0];
        try {
          const r = await fetch(`${base}/minutes/${mRef.current}/rec?seq=${seqRef.current}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: piece.buffer as ArrayBuffer });
          if (!r.ok) throw new Error(String(r.status));
          const j = await r.json();
          queue.current.shift(); seqRef.current++;
          setSavedSecs(j.recording?.seconds || 0); setLag(false);
        } catch { setLag(true); break; }   // 다음 차례에 다시 보냄 (그동안 조각은 이 창에 보관)
      }
    })().finally(() => { sending.current = null; });
    return sending.current;
  };
  useEffect(() => {
    if (mode !== 'recording') return;
    const t = setInterval(() => { const r = recRef.current; if (!r) return; const piece = r.take(); if (piece.length) queue.current.push(piece); flush(); }, 30000);
    return () => clearInterval(t);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'recording') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [mode]);
  useEffect(() => () => { recRef.current?.cancel(); }, []);

  const create = async (extra: object = {}) => (await api<{ item: Minutes }>(`${base}/minutes`, { method: 'POST', body: { ...info, content: '', ...extra } })).item;
  const upload = (id: string, blob: Blob, name: string) => new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${base}/minutes/${id}/audio`);
    x.setRequestHeader('X-File-Name', encodeURIComponent(name));
    x.upload.onprogress = (e) => e.lengthComputable && setMsg(`녹음 파일 올리는 중… ${Math.round((e.loaded / e.total) * 100)}%`);
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error(JSON.parse(x.responseText || '{}').error || `올리지 못했습니다 (${x.status})`)));
    x.onerror = () => reject(new Error('라온 교회 올인원과 연결이 끊겼습니다.'));
    x.send(blob);
  });
  const finish = async (blob: Blob, name: string) => {
    setMode('sending'); setErr('');
    try {
      const m = await create();
      await upload(m.id, blob, name);
      if (ready) { setMsg('녹취를 시작했습니다…'); await api(`${base}/minutes/${m.id}/transcribe`, { method: 'POST', body: { auto } }); }
      await reload();
      setMode('done');
      setMsg(ready ? `녹취를 시작했습니다. 회의록 목록에서 진행 상황이 보이고, 끝나면 ${auto ? 'AI가 이어서 정리합니다' : '녹취록이 들어갑니다'}. 이 창은 닫아도 됩니다.` : '녹음 파일을 회의록에 저장했습니다. 녹취 준비를 마친 뒤 회의록을 열어 "녹취하고 AI로 정리"를 누르세요.');
    } catch (e: any) { setErr(e.message); setMode('choose'); }
  };
  const start = async () => {
    setErr('');
    try {
      const r = new Recorder((s, lv) => { setSecs(s); setLevel(lv); });
      await r.start();
      try { mRef.current = (await create()).id; } catch (e) { r.cancel(); throw e; }
      queue.current = [new Int16Array(0)]; seqRef.current = 0; setSavedSecs(0); setLag(false);
      flush();   // 빈 조각으로 '녹음 중' 표시를 바로 붙인다 (30초 안에 창이 닫혀도 목록에 남게)
      recRef.current = r; setPaused(false); setSecs(0); setMode('recording');
    } catch (e: any) { setErr(/Permission|NotAllowed/i.test(e.name + e.message) ? '마이크 사용이 막혀 있습니다. 주소창 왼쪽 자물쇠 아이콘에서 마이크를 허용해 주세요.' : /NotFound/i.test(e.name) ? '마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인해 주세요.' : e.message); }
  };
  const stop = async () => {
    const r = recRef.current; if (!r) return;
    recRef.current = null;
    const rest = r.finish();
    if (rest.length) queue.current.push(rest);
    setMode('sending'); setErr(''); setMsg('녹음을 저장하는 중…');
    const id = mRef.current;
    try {
      for (let i = 0; i < 5 && queue.current.length; i++) { await flush(); if (queue.current.length) await new Promise((ok) => setTimeout(ok, 1500)); }
      if (queue.current.length) throw new Error('녹음 일부를 저장하지 못했습니다. 라온 교회 올인원이 켜져 있는지 확인한 뒤, 회의록 목록의 "저장된 녹음으로 마무리"를 눌러 주세요.');
      await api(`${base}/minutes/${id}/rec/finish`, { method: 'POST' });
      await api(`${base}/minutes/${id}`, { method: 'PUT', body: { ...info, content: '' } });   // 녹음 중에 고친 회의 이름·참석자
      mRef.current = '';
      if (ready) { setMsg('녹취를 시작했습니다…'); await api(`${base}/minutes/${id}/transcribe`, { method: 'POST', body: { auto } }); }
      await reload();
      setMode('done');
      setMsg(ready ? `녹취를 시작했습니다. 회의록 목록에서 진행 상황이 보이고, 끝나면 ${auto ? 'AI가 이어서 정리합니다' : '녹취록이 들어갑니다'}. 이 창은 닫아도 됩니다.` : '녹음 파일을 회의록에 저장했습니다. 녹취 준비를 마친 뒤 회의록을 열어 "녹취하고 AI로 정리"를 누르세요.');
    } catch (e: any) { setErr(e.message); setMode('done'); await reload(); }
  };
  const discard = async () => {
    recRef.current?.cancel(); recRef.current = null; queue.current = [];
    if (mRef.current) { try { await api(`${base}/minutes/${mRef.current}`, { method: 'DELETE' }); } catch { /* 이미 없음 */ } mRef.current = ''; }
    await reload(); setMode('choose');
  };
  const pick = async (file: File) => {
    setErr('');
    try {
      if (needsConvert(file.name)) {
        setMode('sending'); setMsg('녹음 파일을 녹취할 수 있는 형식(wav)으로 바꾸는 중… 긴 파일은 몇 분 걸릴 수 있습니다.');
        const wav = await decodeToWav(file);
        await finish(wav, file.name.replace(/\.[^.]+$/, '') + '.wav');
      } else await finish(file, file.name);
    } catch (e: any) { setErr(`이 파일을 읽지 못했습니다: ${e.message}`); setMode('choose'); }
  };
  const savePaste = async () => {
    setMode('sending'); setErr('');
    try {
      const m = await create({ transcript: text });
      if (auto) await api(`${base}/minutes/${m.id}/summarize`, { method: 'POST', body: {} });
      await reload(); setMode('done');
      setMsg(auto ? 'AI가 정리하고 있습니다. 회의록 목록에서 진행 상황이 보입니다. 이 창은 닫아도 됩니다.' : '녹취록을 회의록에 저장했습니다.');
    } catch (e: any) { setErr(e.message); setMode('paste'); }
  };

  return (
    <div className="dialog-back" onClick={mode === 'recording' || mode === 'sending' ? undefined : g.close}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>녹음으로 회의록 만들기</h2>
        <div className="form-grid">
          <label>회의<input list="meetings-r" value={info.meeting} onChange={(e) => setInfo({ ...info, meeting: e.target.value })} /></label>
          <label>날짜<input type="date" value={info.date} onChange={(e) => setInfo({ ...info, date: e.target.value })} /></label>
          <label className="span2">참석자 <span className="muted small">(적어 두면 정리에 도움이 됩니다)</span><input value={info.attendees} onChange={(e) => setInfo({ ...info, attendees: e.target.value })} placeholder="이름을 쉼표로" /></label>
        </div>
        <datalist id="meetings-r">{types.map((x) => <option key={x} value={x} />)}</datalist>
        {!ready && st && mode === 'choose' && (
          <p className="alert warn small">녹취 준비가 아직 안 되어 있습니다. 지금 녹음해 두고 나중에 녹취할 수 있습니다. <button className="link" onClick={onSetup}>녹취 준비하기</button></p>
        )}

        {mode === 'choose' && (
          <>
            <div className="rec-choices">
              <button className="rec-choice" onClick={start}><span>🔴</span><b>지금 녹음하기</b><small>이 컴퓨터 마이크로 녹음</small></button>
              <label className="rec-choice"><span>📁</span><b>녹음 파일 넣기</b><small>mp3 · m4a · wav · ogg 등</small>
                <input type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.webm,.aac" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
              </label>
              <button className="rec-choice" onClick={() => setMode('paste')}><span>📝</span><b>녹취록 글 붙여 넣기</b><small>클로바노트 등에서 받은 글</small></button>
            </div>
            <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />녹취가 끝나면 AI로 바로 정리 (내용 정리 · 결정 사항 · 해야 할 일)</label>
            <p className="muted small">녹음과 녹취(받아 적기)는 이 컴퓨터 안에서만 합니다. AI로 정리할 때만 녹취록 글이 연결된 AI(Claude·ChatGPT 구독 또는 제미나이 API 키)로 보내집니다.</p>
          </>
        )}
        {mode === 'recording' && (
          <div className="rec-live">
            <div className={`rec-dot ${paused ? 'paused' : ''}`} />
            <div className="rec-time">{clock(secs)}</div>
            <div className="rec-meter"><div style={{ width: `${Math.min(100, level * 300)}%` }} /></div>
            <p className="muted small">{paused ? '잠시 멈춤' : '녹음 중입니다.'} 30초마다 저장합니다{savedSecs ? ` (지금까지 ${clock(savedSecs)} 저장됨)` : ''}. 창이 닫혀도 저장된 데까지는 회의록에 남습니다. 컴퓨터가 잠자기에 들어가지 않게 해 주세요.</p>
            {lag && <p className="alert warn small">저장이 잠시 밀렸습니다. 녹음은 계속되고, 다시 연결되면 이어서 저장합니다.</p>}
            <div className="row">
              <button onClick={() => { if (paused) recRef.current?.resume(); else recRef.current?.pause(); setPaused(!paused); }}>{paused ? '계속 녹음' : '잠시 멈춤'}</button>
              <button className="primary" onClick={stop}>녹음 끝내기</button>
              <button className="danger-link" onClick={() => { if (confirm('녹음을 버릴까요? 지금까지 저장된 녹음도 지웁니다.')) discard(); }}>버리기</button>
            </div>
          </div>
        )}
        {mode === 'paste' && (
          <>
            <label>녹취록<textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="클로바노트·다른 녹취 앱에서 복사한 글을 붙여 넣으세요" /></label>
            <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />저장하고 AI로 바로 정리</label>
            <div className="row end"><button onClick={() => setMode('choose')}>뒤로</button><button className="primary" disabled={!text.trim()} onClick={savePaste}>회의록 만들기</button></div>
          </>
        )}
        {(mode === 'sending' || mode === 'done') && <p className={mode === 'done' ? 'alert info' : 'muted'}>{msg}</p>}
        {err && <p className="alert err">{err}</p>}
        {mode !== 'recording' && mode !== 'sending' && <div className="row end"><button onClick={g.close}>닫기</button></div>}
      </div>
    </div>
  );
}

// ── 녹취 준비 (엔진 · 모델) ─────────────────────────────
function SttSetup({ st, load, onClose }: { st: Stt | null; load: () => Promise<void>; onClose: () => void }) {
  const { base } = useApp();
  const [err, setErr] = useState('');
  const get = async (path: string) => { setErr(''); try { await api(`${base}${path}`, { method: 'POST' }); await load(); } catch (e: any) { setErr(e.message); } };
  const prog = (k: string) => { const x = st?.installs[k]; return x ? (x.error ? <span className="warn-text small">{x.error}</span> : <span className="small">받는 중 {Math.round((x.done / x.size) * 100)}% ({mb(x.done)} / {mb(x.size)})</span>) : null; };
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>녹취 준비</h2>
        <p className="small muted">녹취(음성 → 글)는 무료 음성 인식 프로그램 <b>whisper</b>로 이 컴퓨터 안에서 합니다. 처음 한 번만 준비하면 됩니다. 인터넷으로 받는 것 말고 따로 드는 비용은 없습니다.</p>
        {!st ? <p className="muted">확인 중…</p> : st.sample ? <p className="alert info">예제 자료에서는 녹취 엔진 없이 예제 녹취록으로 보여 드립니다. 실제로 쓰려면 '우리 교회'로 바꾼 뒤 준비해 주세요.</p> : (
          <>
            <div className="sub-box">
              <b>① 녹취 엔진</b> {st.engine ? <span className="pill done">준비됨</span> : <span className="pill warn">없음</span>}
              {!st.engine && st.platform === 'windows' && (st.canDownloadEngine
                ? <div className="row wrap" style={{ marginTop: 6 }}><button className="primary" disabled={!!st.installs.engine && !st.installs.engine.error} onClick={() => get('/stt/engine')}>엔진 받기 (공식 whisper.cpp · 22MB)</button>{prog('engine')}</div>
                : <p className="small">이 컴퓨터(ARM 윈도우)용 엔진은 아직 자동으로 받을 수 없습니다.</p>)}
              {!st.engine && st.platform === 'mac' && (
                <div className="small" style={{ marginTop: 6 }}>
                  <ol className="mac-steps">
                    <li><b>터미널 열기</b>: ⌘+스페이스 → '터미널' 입력 → Enter</li>
                    {!st.brew && <li><b>Homebrew 설치</b> (맥에 프로그램을 설치해 주는 무료 도구, 처음 한 번): 아래 명령을 붙여 넣고 Enter. 맥 로그인 암호를 물으면 입력하세요(글자가 보이지 않아도 입력됩니다). 5~10분 걸립니다.
                      <Cmd text={HOMEBREW} /></li>}
                    <li><b>녹취 엔진 설치</b>: 아래 명령을 붙여 넣고 Enter. 몇 분 걸립니다.
                      <Cmd text="brew install whisper-cpp" />
                      <span className="muted">"brew: command not found"가 나오면 애플 칩 맥은 <code>/opt/homebrew/bin/brew install whisper-cpp</code>, 인텔 맥은 <code>/usr/local/bin/brew install whisper-cpp</code> 를 넣으세요.</span></li>
                    <li>끝나면 <button className="link" onClick={load}>다시 확인</button>을 누르고, 아래 ② 모델을 받습니다.</li>
                  </ol>
                  <p className="muted">어려우시면 카카오 오픈채팅으로 물어 주세요. 그동안은 클로바노트 등에서 받은 녹취록 글을 붙여 넣어 AI 정리를 쓸 수 있습니다.</p>
                </div>
              )}
            </div>
            <div className="sub-box">
              <b>② 녹취 모델</b> <span className="muted small">(하나만 있으면 됩니다)</span>
              {Object.entries(st.models).map(([k, mo]) => (
                <div key={k} className="row wrap" style={{ marginTop: 6 }}>
                  <span className="grow">{mo.label}{k === 'turbo' ? ' — 권장, 한국어가 더 정확' : ' — 느린 컴퓨터용'}</span>
                  {mo.ready ? <span className="pill done">받음</span> : <button disabled={!!st.installs[k] && !st.installs[k].error} onClick={() => get(`/stt/model/${k}`)}>받기 ({mb(mo.size)})</button>}
                  {prog(k)}
                </div>
              ))}
            </div>
            <p className="muted small">걸리는 시간(어림): 1시간 회의를 받아 적는 데 M 시리즈 맥은 10~15분, 일반 윈도우 노트북은 40~60분쯤입니다. 받아 적는 동안 다른 일을 해도 됩니다.</p>
          </>
        )}
        {err && <p className="alert err">{err}</p>}
        <div className="row end"><button onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}

// ── 회의 이름 관리 ─────────────────────────────────
function MeetingTypes({ data, onClose, reload }: { data: AdminData; onClose: () => void; reload: () => Promise<void> }) {
  const { base } = useApp();
  const [adding, setAdding] = useState('');
  const [ren, setRen] = useState<{ name: string; to: string } | null>(null);
  const [msg, setMsg] = useState('');
  const list = data.meetingTypes;
  const count = (n: string) => data.minutes.filter((m) => m.meeting === n).length;
  const run = async (body: object, done = '') => {
    try { await api(`${base}/meeting-types`, { method: 'POST', body }); await reload(); setMsg(done); return true; } catch (e: any) { setMsg(e.message); return false; }
  };
  const add = async () => { const n = adding.trim(); if (n && (await run({ op: 'add', name: n }, `'${n}'을(를) 더했습니다.`))) setAdding(''); };
  const rename = async () => {
    if (!ren) return;
    const n = count(ren.name);
    if (n && !confirm(`'${ren.name}' 회의록 ${n}건의 회의 이름도 '${ren.to.trim()}'(으)로 함께 바뀝니다. 바꿀까요?`)) return;
    if (await run({ op: 'rename', name: ren.name, to: ren.to.trim() }, '이름을 바꿨습니다.')) setRen(null);
  };
  const remove = (n: string) => {
    if (!confirm(count(n) ? `'${n}'을(를) 목록에서 뺄까요? 이미 쓴 회의록 ${count(n)}건은 그대로 남습니다.` : `'${n}'을(를) 목록에서 뺄까요?`)) return;
    run({ op: 'remove', name: n }, `'${n}'을(를) 뺐습니다.`);
  };
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>회의 이름 관리</h2>
        <p className="muted small">교회에서 쓰는 회의 이름을 더하고 고칩니다. 누르는 즉시 저장됩니다. 맨 위 이름이 새 회의록의 기본값입니다.</p>
        <ul className="cat-list">
          {list.map((n, i) => (
            <li key={n}>
              {ren?.name === n ? (
                <>
                  <input autoFocus value={ren.to} onChange={(e) => setRen({ name: n, to: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) rename(); if (e.key === 'Escape') setRen(null); }} />
                  <button className="small primary" disabled={!ren.to.trim() || ren.to.trim() === n} onClick={rename}>바꾸기</button>
                  <button className="small" onClick={() => setRen(null)}>취소</button>
                </>
              ) : (
                <>
                  <span className="grow">{n} {count(n) > 0 && <span className="muted small">· 회의록 {count(n)}건</span>}</span>
                  <button className="icon" aria-label="위로" disabled={i === 0} onClick={() => run({ op: 'move', name: n, dir: -1 })}>▲</button>
                  <button className="icon" aria-label="아래로" disabled={i === list.length - 1} onClick={() => run({ op: 'move', name: n, dir: 1 })}>▼</button>
                  <button className="small" onClick={() => setRen({ name: n, to: n })}>이름 바꾸기</button>
                  <button className="small" onClick={() => remove(n)}>빼기</button>
                </>
              )}
            </li>
          ))}
          {!list.length && <li className="muted">회의 이름이 없습니다. 아래에서 더해 주세요.</li>}
        </ul>
        <div className="row">
          <input className="grow" placeholder="새 회의 이름 (예: 청년부 임원회, 선교위원회)" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }} />
          <button className="primary" disabled={!adding.trim()} onClick={add}>더하기</button>
        </div>
        {msg && <p className="small muted">{msg}</p>}
        <div className="row end"><button onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}

const HOMEBREW = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
// 명령 한 줄 + 복사 단추
function Cmd({ text }: { text: string }) {
  const [ok, setOk] = useState('');
  const copy = async () => {
    let done = false;
    try { await navigator.clipboard.writeText(text); done = true; } catch { /* 아래 방식 */ }
    if (!done) { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { done = document.execCommand('copy'); } catch { done = false; } t.remove(); }
    setOk(done ? '복사됨' : '직접 선택해 복사해 주세요');
  };
  return <div className="cmd"><code>{text}</code><button className="small" onClick={copy}>{ok || '복사'}</button></div>;
}

// 녹음이 끊긴 회의록: 마지막 조각이 1분 넘게 오지 않았으면 끊긴 것으로 본다
const recCut = (m: Minutes) => !!m.recording && Date.now() - (m.recording.at || m.recording.startedAt) > 90000;
function RecoverBox({ m, reload }: { m: Minutes; reload: () => Promise<void> }) {
  const { base } = useApp();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { await api(`${base}/minutes/${m.id}/rec/finish`, { method: 'POST' }); await reload(); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className={`alert ${recCut(m) ? 'warn' : 'info'} small`}>
      {recCut(m) ? <>녹음이 중간에 끊겼습니다(창이 닫혔거나 컴퓨터가 잠들었을 수 있습니다). <b>{clock(m.recording?.seconds || 0)}</b>까지 저장되어 있습니다.</>
        : <>이 회의는 지금 녹음 중입니다 ({clock(m.recording?.seconds || 0)} 저장됨).</>}
      {recCut(m) && <> <button className="small" disabled={busy} onClick={save}>{busy ? '저장 중…' : '저장된 녹음으로 마무리'}</button></>}
      {err && <span className="warn-text"> {err}</span>}
    </div>
  );
}

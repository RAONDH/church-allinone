import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { PraiseFlowStatus, Rec, Recs, Song, SummaryItem, SyncResult, Week, WeekStatus } from '../lib/types';
import { fmtDate, fmtTime, matchSongs, norm, prepSteps, setlistText } from '../lib/week';
import { StepList } from './Home';
import AfterTab from './AfterTab';
import { docText } from '../lib/docText';
import { setBusy } from '../lib/busy';
import BulletinCard from './Bulletin';
import MusicSheetCard from './MusicSheetCard';

const TABS = [['info', '예배 정보'], ['setlist', '찬양 콘티'], ['subs', '자막'], ['outputs', '결과물'], ['after', '설교 후 자료']] as const;
const EDITABLE = ['date', 'name', 'passage', 'sermonTitle', 'announcements', 'sermonNotes', 'sermonVideoUrl', 'prayerLeader'] as const;
type SaveState = { state: 'saved' | 'dirty' | 'saving' | 'error'; msg?: string; sync?: SyncResult; restored?: boolean };

export default function WeekPage() {
  const { id, tab = 'info' } = useParams();
  const { base, ws, reload } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [week, setWeek] = useState<Week | null>(null);
  const [status, setStatus] = useState<WeekStatus | null>(null);
  const [err, setErr] = useState('');
  const [save, setSave] = useState<SaveState>({ state: 'saved', sync: (loc.state as any)?.sync });
  const pendingKey = `pending:${ws}:${id}`;
  const draftRef = useRef<Week | null>(null);
  const verRef = useRef(0);

  const loadStatus = useCallback(() => api<WeekStatus>(`${base}/weeks/${id}/status`).then(setStatus).catch(() => {}), [base, id]);
  useEffect(() => {
    setWeek(null); setStatus(null); setErr('');
    api<{ week: Week; status: WeekStatus }>(`${base}/weeks/${id}`).then(({ week: w, status: s }) => {
      // 저장하지 못하고 닫혔던 내용이 있으면 되살린다
      let pending: any = null;
      try { pending = JSON.parse(localStorage.getItem(pendingKey) || 'null'); } catch { /* 무시 */ }
      if (pending && pending.at > w.updatedAt) {
        const merged = { ...w, ...pending.fields };
        draftRef.current = merged; setWeek(merged); setSave({ state: 'dirty', restored: true }); verRef.current++;
      } else { draftRef.current = w; setWeek(w); }
      setStatus(s);
    }).catch((e) => setErr(e.message));
  }, [base, id, pendingKey]);

  const doSave = useCallback(async () => {
    const w = draftRef.current;
    if (!w) return;
    const v = verRef.current;
    setSave((s) => ({ ...s, state: 'saving' }));
    const fields = Object.fromEntries(EDITABLE.map((k) => [k, w[k]]));
    try {
      const r = await api<{ week: Week; sync: SyncResult }>(`${base}/weeks/${id}`, { method: 'PUT', body: fields });
      if (v === verRef.current) {
        try { localStorage.removeItem(pendingKey); } catch { /* 무시 */ }
        setSave({ state: 'saved', sync: r.sync });
      }
      loadStatus();
      reload();
    } catch (e: any) {
      setSave({ state: 'error', msg: e.message });
    }
  }, [base, id, pendingKey, loadStatus, reload]);

  // 저장하지 않은 입력이 있는 동안은 업데이트 안내 창을 띄우지 않음
  useEffect(() => { setBusy('saving', save.state !== 'saved'); return () => setBusy('saving', false); }, [save.state]);
  // 자동 저장: 입력이 멈추고 0.7초 뒤, 실패하면 5초마다 다시 시도
  useEffect(() => {
    if (save.state === 'dirty') { const t = setTimeout(doSave, 700); return () => clearTimeout(t); }
    if (save.state === 'error') { const t = setTimeout(doSave, 5000); return () => clearTimeout(t); }
  }, [save.state, week, doSave]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (save.state !== 'saved') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [save.state]);

  const update = (patch: Partial<Week>) => {
    const next = { ...draftRef.current!, ...patch };
    draftRef.current = next; verRef.current++;
    setWeek(next);
    setSave((s) => ({ ...s, state: 'dirty', restored: s.restored }));
    try { localStorage.setItem(pendingKey, JSON.stringify({ at: Date.now(), fields: Object.fromEntries(EDITABLE.map((k) => [k, next[k]])) })); } catch { /* 무시 */ }
  };
  const replaceWeek = (w: Week) => { draftRef.current = { ...w, ...Object.fromEntries(EDITABLE.map((k) => [k, draftRef.current![k]])) }; setWeek(draftRef.current); };

  if (err) return <div className="alert err">{err} <Link to="/">이번 주 준비함으로</Link></div>;
  if (!week) return <p className="muted">불러오는 중…</p>;
  const steps = prepSteps(week, status);

  return (
    <section>
      <div className="week-head">
        <div>
          <Link to="/" className="muted small">← 이번 주 준비함</Link>
          <h1>{fmtDate(week.date)} {week.name}</h1>
        </div>
        <SaveBadge s={save} onRetry={doSave} />
      </div>
      {save.restored && <div className="alert info">저장되지 못했던 입력 내용을 되살렸습니다. 곧 자동으로 저장됩니다.</div>}
      {save.state === 'error' && <div className="alert err"><b>저장하지 못했습니다.</b> {save.msg} 입력한 내용은 이 브라우저에 임시로 보관 중이며, 5초마다 다시 저장을 시도합니다. <button onClick={doSave}>지금 다시 저장</button></div>}
      {save.sync && !save.sync.ok && <div className="alert warn">라온 교회 올인원에는 저장했지만 예배송출에 반영하지 못했습니다: {save.sync.error} 예배송출이 켜지면 다음 저장 때 자동으로 반영됩니다.</div>}
      <nav className="tabs">
        {TABS.map(([k, label]) => {
          const st = steps.find((s) => s.tab === k && (s.level === 'todo' || s.level === 'warn'));
          return <button key={k} className={tab === k ? 'on' : ''} onClick={() => nav(`/week/${id}/${k}`, { replace: true })}>{label}{st && <span className={`dot ${st.level}`} />}</button>;
        })}
      </nav>
      {tab === 'info' && <InfoTab week={week} status={status} update={update} replaceWeek={replaceWeek} loadStatus={loadStatus} />}
      {tab === 'setlist' && <SetlistTab week={week} status={status} setStatus={setStatus} replaceWeek={replaceWeek} />}
      {tab === 'subs' && <SubsTab week={week} status={status} setStatus={setStatus} replaceWeek={replaceWeek} />}
      {tab === 'outputs' && <OutputsTab week={week} status={status} steps={steps} />}
      {tab === 'after' && <AfterTab week={week} onGoInfo={() => nav(`/week/${id}/info`, { replace: true })} />}
    </section>
  );
}

function SaveBadge({ s, onRetry }: { s: SaveState; onRetry: () => void }) {
  if (s.state === 'saving') return <span className="save saving">저장 중…</span>;
  if (s.state === 'dirty') return <span className="save dirty">입력 중…</span>;
  if (s.state === 'error') return <button className="save error" onClick={onRetry}>저장 실패 · 다시 시도</button>;
  const done = s.sync?.ok && s.sync.done?.length ? ` · 예배송출에 반영: ${s.sync.done.join(', ')}` : '';
  return <span className="save saved">✓ 저장됨{done}</span>;
}

// ── 예배 정보 ─────────────────────────────────────
function InfoTab({ week, status, update, replaceWeek, loadStatus }: { week: Week; status: WeekStatus | null; update: (p: Partial<Week>) => void; replaceWeek: (w: Week) => void; loadStatus: () => void }) {
  const { base, ov, reload } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [pick, setPick] = useState('');
  const [ann, setAnn] = useState(week.announcements.join('\n'));
  useEffect(() => { setAnn(week.announcements.join('\n')); }, [week.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (serviceId?: string) => {
    setBusy(true); setMsg('');
    try {
      const r = await api<{ week: Week; sync: SyncResult }>(`${base}/weeks/${week.id}/link`, { method: 'POST', body: serviceId ? { serviceId } : {} });
      replaceWeek(r.week);
      setMsg(r.sync.ok ? '예배송출과 연결했습니다.' : `연결하지 못했습니다: ${r.sync.error}`);
      loadStatus(); reload();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm(`${fmtDate(week.date)} ${week.name} 기록을 지울까요?\n예배송출의 예배 순서는 지우지 않고 그대로 둡니다.`)) return;
    await api(`${base}/weeks/${week.id}`, { method: 'DELETE' });
    await reload(); nav('/');
  };
  const linkedSvc = ov?.wc.services?.find((s) => s.id === week.wc?.serviceId);

  return (
    <div className="grid2">
      <div className="card">
        <h2>예배 정보</h2>
        <div className="row">
          <label>날짜<input type="date" value={week.date} onChange={(e) => e.target.value && update({ date: e.target.value })} /></label>
          <label className="grow">예배 이름<input value={week.name} onChange={(e) => update({ name: e.target.value })} /></label>
        </div>
        <label>성경 본문<input value={week.passage} placeholder="예: 시편 23:1-6" onChange={(e) => update({ passage: e.target.value })} /></label>
        <label>설교 제목<input value={week.sermonTitle} onChange={(e) => update({ sermonTitle: e.target.value })} /></label>
        <label>대표 기도<input value={week.prayerLeader} placeholder="기도하실 분 (예: 김○○ 집사)" onChange={(e) => update({ prayerLeader: e.target.value })} /></label>
        <label>광고 <span className="muted small">(한 줄에 하나씩 · 자막에서는 한 줄이 한 화면)</span>
          <textarea rows={5} value={ann} onChange={(e) => { setAnn(e.target.value); update({ announcements: e.target.value.split('\n').filter((x) => x.trim()) }); }} />
        </label>
        <p className="muted small">본문·설교 제목·대표 기도·광고는 예배송출의 ‘성경 봉독’, ‘말씀 선포’, ‘대표 기도’, ‘교회 소식’ 자막과 설교자 이름 자막에 자동으로 들어갑니다.</p>
      </div>
      <div className="col">
        <div className="card">
          <h2>설교 자료</h2>
          <label>설교 원고 또는 요지<textarea rows={8} value={week.sermonNotes} placeholder="원고를 붙여 넣거나 요지를 적어 두세요. 주보·묵상지·쇼츠 등 설교 후 자료에 다시 쓰입니다." onChange={(e) => update({ sermonNotes: e.target.value })} /></label>
          <NotesFile current={week.sermonNotes} onText={(t) => update({ sermonNotes: t })} />
          <label>설교 영상 주소 <span className="muted small">(예배 후 · 쇼츠 만들 때 사용)</span><input value={week.sermonVideoUrl} placeholder="https://youtube.com/…" onChange={(e) => update({ sermonVideoUrl: e.target.value })} /></label>
        </div>
        <div className="card">
          <h2>예배송출 연결</h2>
          {week.wc?.serviceId ? (
            status?.connected === false ? <p className="alert warn">예배송출이 꺼져 있습니다. <Link to="/apps">켜기</Link></p>
              : status?.missing ? <p className="alert warn">연결된 예배 순서가 예배송출에서 지워졌습니다. 아래에서 다시 연결해 주세요.</p>
              : <p>✓ 예배송출의 <b>{linkedSvc ? `${linkedSvc.date} ${linkedSvc.name}` : '예배 순서'}</b>와 연결되어 있습니다.{status?.summary?.isCurrent && <span className="pill done">지금 예배</span>}</p>
          ) : <p className="muted">아직 연결되지 않았습니다. 연결하면 본문·제목·광고가 자막에 자동으로 들어갑니다.</p>}
          {(!week.wc?.serviceId || status?.missing) && (
            <>
              <button className="primary" disabled={busy} onClick={() => link()}>예배송출에 주일 예배 순서 새로 만들기</button>
              {ov?.wc.services?.length ? (
                <div className="row">
                  <select value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">이미 만든 예배 순서 고르기…</option>
                    {ov.wc.services.map((s) => <option key={s.id} value={s.id}>{s.date} {s.name} ({s.count}개)</option>)}
                  </select>
                  <button disabled={!pick || busy} onClick={() => link(pick)}>이 순서와 연결</button>
                </div>
              ) : null}
            </>
          )}
          {ov?.wc.ok === false && <p className="muted small">예배송출이 꺼져 있으면 연결할 수 없습니다. <Link to="/apps">프로그램</Link>에서 켜 주세요.</p>}
          {msg && <p className="muted">{msg}</p>}
        </div>
        <button className="danger-link" onClick={remove}>이 예배 기록 지우기</button>
      </div>
    </div>
  );
}

// ── 찬양 콘티 ─────────────────────────────────────
const KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'Cm', 'Dm', 'Em', 'Fm', 'Gm', 'Am', 'Bm'];

function useSongs() {
  const { base } = useApp();
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api<{ ok: boolean; songs?: Song[]; error?: string }>(`${base}/songs`).then((r) => { if (r.ok) setSongs(r.songs!); else setErr(r.error!); }).catch((e) => setErr(e.message)), [base]);
  useEffect(() => { load(); }, [load]);
  return { songs, err, load };
}

function NeedLink({ status }: { status: WeekStatus | null }) {
  if (!status) return <p className="muted">확인 중…</p>;
  if (!status.linked) return <div className="card"><p>이 예배는 아직 예배송출과 연결되지 않았습니다.</p><Link to="../info" relative="path">예배 정보 탭에서 연결하기 →</Link></div>;
  if (status.connected === false) return <div className="alert warn">예배송출이 꺼져 있어 콘티·자막을 불러올 수 없습니다. <Link to="/apps">예배송출 켜기</Link></div>;
  if (status.missing) return <div className="alert warn">연결된 예배 순서가 예배송출에서 지워졌습니다. 예배 정보 탭에서 다시 연결해 주세요.</div>;
  return null;
}

function SetlistTab({ week, status, setStatus, replaceWeek }: { week: Week; status: WeekStatus | null; setStatus: (s: WeekStatus) => void; replaceWeek: (w: Week) => void }) {
  const { base } = useApp();
  const { songs, load: loadSongs } = useSongs();
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState(status?.summary?.note || '');
  useEffect(() => { setNote(status?.summary?.note || ''); }, [status?.summary?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const op = async (body: any) => {
    setErr('');
    try { setStatus(await api<WeekStatus>(`${base}/weeks/${week.id}/setlist`, { method: 'POST', body })); if (body.op === 'addNew') await loadSongs(); } catch (e: any) { setErr(e.message); }
  };
  const block = <NeedLink status={status} />;
  if (!status?.summary) return block;
  const inSet = status.summary.items.filter((i) => i.type === 'song' || i.type === 'score');
  const ids = new Set(inSet.map((i) => i.id));
  const titleCount = (t: string) => songs?.filter((s) => s.title === t).length || 0;
  const filtered = (songs || []).filter((s) => !q.trim() || [s.title, s.lyrics, s.meta.writer, s.meta.source, s.meta.distinguish].join(' ').toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="grid2 wide-left">
      <div className="col">
        <div className="card">
          <h2>이번 주 찬양 ({inSet.length}곡)</h2>
          {err && <p className="alert err">{err}</p>}
          {inSet.length === 0 && <p className="muted">‘찬양 자료에서 넣기’ 목록에서 곡을 넣어 주세요.</p>}
          <ol className="setlist">
            {inSet.map((it, i) => <SetlistRow key={it.id} it={it} first={i === 0} last={i === inSet.length - 1} sameTitle={titleCount(it.title) > 1} meta={songs?.find((s) => s.id === it.id)?.meta} op={op} />)}
          </ol>
          <label>인도자 메모 (콘티 전체)<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (status.summary!.note || '') && op({ op: 'note', note })} /></label>
          <p className="muted small">조성과 곡 구성(1절 → 후렴 …)은 예배송출에서 곡 자체에 저장됩니다. 다른 주에 같은 곡을 쓰면 함께 바뀌므로, 지난 예배는 ‘자막 확정’으로 보존해 두세요.</p>
        </div>
        <MusicSheetCard week={week} songCount={inSet.length} setStatus={setStatus} onSongsChanged={loadSongs} />
        <RecommendCard week={week} songs={songs} inSet={ids} op={op} replaceWeek={replaceWeek} />
      </div>
      <div className="card">
        <h2>찬양 자료에서 넣기</h2>
        <input placeholder="제목·가사·작사작곡자로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        {!songs ? <p className="muted">불러오는 중…</p> : (
          <ul className="song-pick">
            {filtered.slice(0, 80).map((s) => (
              <li key={s.id}>
                <div className="grow">
                  <b>{s.title}</b> {s.key && <span className="pill info">{s.key}</span>}
                  {titleCount(s.title) > 1 && <div className="small">{s.meta.distinguish || s.meta.writer || <span className="warn-text">같은 제목 곡 {titleCount(s.title)}개 · 찬양 자료에서 구분 정보를 적어 두세요</span>}</div>}
                  <div className="muted small">{s.slideCount ? `화면 ${s.slideCount}장` : '가사 없음'}{s.lastUsed ? ` · 최근 ${s.lastUsed}` : ''}</div>
                </div>
                {ids.has(s.id) ? <span className="pill done">넣음</span> : <button className="small" onClick={() => op({ op: 'add', itemId: s.id })}>넣기</button>}
              </li>
            ))}
            {filtered.length === 0 && <li className="muted">찾는 곡이 없습니다. 새 곡의 가사 등록은 예배송출에서 합니다 (인터넷 가사 찾기 지원).</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── PraiseFlow(찬양 큐레이터) 추천 ───────────────────────
function RecommendCard({ week, songs, inSet, op, replaceWeek }: { week: Week; songs: Song[] | null; inSet: Set<string>; op: (b: any) => Promise<void>; replaceWeek: (w: Week) => void }) {
  const { base, ws } = useApp();
  const [pf, setPf] = useState<PraiseFlowStatus | null>(null);
  const [hymn, setHymn] = useState(2);
  const [ccm, setCcm] = useState(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error: string; needKey?: boolean; offline?: boolean } | null>(null);
  const [adding, setAdding] = useState('');
  const recs: Recs | null | undefined = week.recs;
  const loadPf = useCallback(() => api<PraiseFlowStatus>(`${base}/praiseflow`).then(setPf).catch(() => setPf(null)), [base]);
  useEffect(() => { loadPf(); }, [loadPf]);

  const ready = !!(week.passage.trim() || week.sermonTitle.trim());
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ ok: boolean; recs?: Recs; error?: string; needKey?: boolean; offline?: boolean }>(`${base}/weeks/${week.id}/recommend`, { method: 'POST', body: { hymnCount: hymn, ccmCount: ccm } });
      if (r.ok) replaceWeek({ ...week, recs: r.recs! }); else setErr({ error: r.error!, needKey: r.needKey, offline: r.offline });
    } catch (e: any) { setErr({ error: e.message }); }
    setBusy(false); loadPf();
  };
  const openPf = async () => {
    const tab = window.open('about:blank', '_blank');
    try { const r = await api<{ url: string }>('/api/apps/worship/start', { method: 'POST' }); if (tab) tab.location.href = r.url; else window.open(r.url, '_blank'); loadPf(); }
    catch (e: any) { tab?.close(); setErr({ error: e.message }); }
  };
  const addNew = async (r: Rec) => {
    setAdding(r.title);
    await op({ op: 'addNew', title: r.title, artist: r.artist, source: 'PraiseFlow 추천' });
    setAdding('');
  };

  return (
    <div className="card">
      <h2>찬양 큐레이터(PraiseFlow) 추천</h2>
      <p className="muted small">이번 주 본문·설교 제목·설교 요지를 PraiseFlow에 보내 찬송가와 CCM을 추천받습니다. 결과는 이 예배 기록에 보관됩니다.</p>
      {ws === 'real' && pf && (
        <p className="small">
          {pf.running ? (pf.ready ? <span className="pill done">PraiseFlow 연결됨 · {pf.providerLabel}</span> : <><span className="pill warn">AI 연결 준비 안 됨 ({pf.providerLabel})</span> PraiseFlow의 ‘AI 연결’ 설정에서 구독 또는 API 키를 연결해 주세요. <button className="small" onClick={openPf}>PraiseFlow 열기</button></>)
            : pf.installed === false ? <span className="pill warn">PraiseFlow 폴더를 찾을 수 없습니다</span>
            : <><span className="pill info">PraiseFlow 꺼짐</span> 추천받기를 누르면 자동으로 켭니다.</>}
        </p>
      )}
      <div className="row wrap">
        <label className="inline">찬송가 <select value={hymn} onChange={(e) => setHymn(+e.target.value)}>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}곡</option>)}</select></label>
        <label className="inline">CCM <select value={ccm} onChange={(e) => setCcm(+e.target.value)}>{[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}곡</option>)}</select></label>
        <button className="primary" disabled={busy || !ready || hymn + ccm === 0} onClick={run}>{busy ? '추천 받는 중… (1~3분)' : recs ? '다시 추천받기' : '추천받기'}</button>
        {ws === 'real' && <button onClick={openPf}>PraiseFlow 열기</button>}
      </div>
      {!ready && <p className="muted small">먼저 예배 정보 탭에서 본문이나 설교 제목을 입력해 주세요.</p>}
      {ws === 'real' && <p className="muted small">인터넷이 필요하고, PraiseFlow에서 고른 AI(Claude·ChatGPT 구독 또는 Gemini API 키)로 요청합니다.</p>}
      {err && <p className="alert warn">{err.error} {(err.needKey || err.offline) && <button className="small" onClick={openPf}>PraiseFlow 열기</button>}</p>}
      {recs && (
        <div className="recs-box">
          <p className="muted small">{recs.sample && <span className="pill info">예제 결과</span>} {fmtTime(recs.at)}에 추천받음</p>
          {recs.theme && <p><b>주제:</b> {recs.theme}</p>}
          {recs.keyMessage && <p className="muted small">{recs.keyMessage}</p>}
          {recs.items.length === 0 && <p className="muted">추천곡이 없습니다. 다시 추천받아 보세요.</p>}
          <ul className="recs">
            {recs.items.map((r, i) => {
              const ms = songs ? matchSongs(r.title, songs) : [];
              return (
                <li key={i}>
                  <div><b>{r.title}</b> <span className="muted small">{[r.artist, r.type, r.era].filter(Boolean).join(' · ')}</span></div>
                  {r.reason && <div className="small">{r.reason}</div>}
                  {r.mood && <div className="muted small">분위기: {r.mood}</div>}
                  <div className="row wrap rec-actions">
                    {!songs ? <span className="muted small">찬양 자료 확인 중…</span>
                      : ms.length ? ms.map((m) => inSet.has(m.id)
                        ? <span key={m.id} className="pill done">콘티에 있음</span>
                        : <button key={m.id} className="small" onClick={() => op({ op: 'add', itemId: m.id })}>
                            콘티에 넣기{(() => { const d = [norm(m.title) !== norm(r.title) && m.title, ms.length > 1 && (m.meta.distinguish || m.key)].filter(Boolean).join(' · '); return d ? ` (${d})` : ''; })()}{m.slideCount ? '' : ' · 가사 없음'}
                          </button>)
                      : <button className="small" disabled={!!adding} onClick={() => addNew(r)}>{adding === r.title ? '만드는 중…' : '새 곡으로 콘티에 넣기'}</button>}
                    {ms.map((m) => m.lastUsed && <span key={'u' + m.id} className="muted small">최근 {m.lastUsed} 사용</span>)}
                    {r.youtubeUrl && <a className="small" href={r.youtubeUrl} target="_blank" rel="noreferrer">유튜브</a>}
                    {r.sheetMusicUrl && <a className="small" href={r.sheetMusicUrl} target="_blank" rel="noreferrer">악보</a>}
                  </div>
                  {songs && !ms.length && <div className="muted small">찬양 자료에 없는 곡입니다. 넣으면 예배송출에 제목만 있는 곡이 만들어지고, 가사는 예배송출에서 채웁니다(인터넷 가사 찾기 지원).</div>}
                </li>
              );
            })}
          </ul>
          {recs.sources.length > 0 && <details className="small"><summary>참고한 자료 {recs.sources.length}개</summary><ul>{recs.sources.map((x, i) => <li key={i}><a href={x.uri} target="_blank" rel="noreferrer">{x.title || x.uri}</a></li>)}</ul></details>}
          <p className="muted small">AI 추천이라 실제로 없는 곡이나 틀린 정보가 섞일 수 있습니다. 유튜브·악보로 확인한 뒤 넣어 주세요.</p>
        </div>
      )}
    </div>
  );
}

function SetlistRow({ it, first, last, sameTitle, meta, op }: { it: SummaryItem; first: boolean; last: boolean; sameTitle: boolean; meta?: Song['meta']; op: (b: any) => void }) {
  const [memo, setMemo] = useState(it.memo);
  const [key, setKey] = useState(it.key);
  useEffect(() => setMemo(it.memo), [it.memo]);
  useEffect(() => setKey(it.key), [it.key]);
  const setArr = (arr: string[]) => op({ op: 'item', itemId: it.id, arr });
  return (
    <li className="set-row">
      <div className="set-main">
        <div className="set-title"><b>{it.title}</b>{sameTitle && meta?.distinguish && <span className="muted small"> ({meta.distinguish})</span>}{it.empty && <span className="pill warn">가사 없음</span>}</div>
        <div className="row wrap">
          <label className="inline">조성
            <input list="keys" className="key" value={key} onChange={(e) => setKey(e.target.value)} onBlur={() => key !== it.key && op({ op: 'item', itemId: it.id, key })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </label>
          <input className="grow" placeholder="흐름 메모 (예: 후렴 두 번째는 조용히)" value={memo} onChange={(e) => setMemo(e.target.value)} onBlur={() => memo !== it.memo && op({ op: 'item', itemId: it.id, memo })} />
        </div>
        {it.labels.length > 0 ? (
          <div className="arr">
            <span className="muted small">곡 구성</span>
            {(it.arr.length ? it.arr : []).map((l, i) => <button key={i} className="chip on" title="빼기" onClick={() => setArr(it.arr.filter((_, j) => j !== i))}>{l} ×</button>)}
            {!it.arr.length && <span className="muted small">등록 순서대로</span>}
            <span className="sep">＋</span>
            {it.labels.map((l) => <button key={l} className="chip" onClick={() => setArr([...it.arr, l])}>{l}</button>)}
            {it.arr.length > 0 && <button className="link small" onClick={() => setArr([])}>처음대로</button>}
          </div>
        ) : <div className="muted small">가사에 절·후렴 표시가 없어 등록 순서대로 나갑니다.</div>}
      </div>
      <div className="set-actions">
        <button className="icon" disabled={first} aria-label="위로" onClick={() => op({ op: 'move', itemId: it.id, dir: -1, songsOnly: true })}>▲</button>
        <button className="icon" disabled={last} aria-label="아래로" onClick={() => op({ op: 'move', itemId: it.id, dir: 1, songsOnly: true })}>▼</button>
        <button className="icon" aria-label="빼기" onClick={() => op({ op: 'remove', itemId: it.id })}>✕</button>
      </div>
      <datalist id="keys">{KEYS.map((k) => <option key={k} value={k} />)}</datalist>
    </li>
  );
}

// ── 자막 ─────────────────────────────────────────
function openCaster(base: string, weekId: string, setErr: (s: string) => void) {
  const win = window.open('about:blank', '_blank');
  api<{ url: string | null }>(`${base}/weeks/${weekId}/open-caster`, { method: 'POST' })
    .then((r) => { if (r.url && win) win.location.href = r.url; else { win?.close(); if (!r.url) setErr('예제 모드에서는 실제 예배송출을 열지 않습니다. 대신 이 예배가 가상 예배송출의 ‘지금 예배’로 선택되었습니다.'); } })
    .catch((e) => { win?.close(); setErr(e.message); });
}

function SubsTab({ week, status, setStatus, replaceWeek }: { week: Week; status: WeekStatus | null; setStatus: (s: WeekStatus) => void; replaceWeek: (w: Week) => void }) {
  const { base, ov } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const block = <NeedLink status={status} />;
  if (!status?.summary) return block;
  const s = status.summary;
  const f = status.final!;
  const ph = new Map<string, string[]>();
  for (const p of s.placeholders) ph.set(p.itemId, [...(ph.get(p.itemId) || []), p.text]);
  const host = (ov?.settings.wcUrl || '').replace('127.0.0.1', 'localhost');
  const real = ov?.sample === false;

  const finalize = async () => {
    if (s.placeholders.length && !confirm(`아직 채우지 않은 칸이 ${s.placeholders.length}곳 있습니다. 그래도 확정할까요?`)) return;
    setBusy(true); setErr('');
    try { const r = await api<{ week: Week; status: WeekStatus }>(`${base}/weeks/${week.id}/finalize`, { method: 'POST' }); replaceWeek(r.week); setStatus(r.status); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const restore = async () => {
    if (!confirm('예배송출의 이 예배 순서를 확정본 내용으로 되돌릴까요?\n확정 뒤에 바꾼 자막·순서·조성은 확정본 내용으로 바뀝니다.')) return;
    setBusy(true); setErr('');
    try { const r = await api<{ week: Week; status: WeekStatus }>(`${base}/weeks/${week.id}/restore`, { method: 'POST' }); replaceWeek(r.week); setStatus(r.status); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="grid2 wide-left">
      <div className="card">
        <div className="row between">
          <h2>예배 순서와 자막 ({s.items.length}개 · 화면 {s.slideTotal}장)</h2>
          <button onClick={() => openCaster(base, week.id, setErr)}>예배송출에서 편집 ↗</button>
        </div>
        {err && <p className="alert warn">{err}</p>}
        <ol className="order">
          {s.items.map((it) => (
            <li key={it.id} className={ph.has(it.id) || it.empty ? 'warn' : ''}>
              <span className={`type t-${it.type}`}>{({ song: '찬양', score: '악보', text: '순서', notice: '광고', bible: '말씀', ppt: 'PPT', html: 'HTML' } as any)[it.type] || it.type}</span>
              <span className="grow">{it.title}{it.type === 'song' && it.arr.length ? <span className="muted small"> · {it.arr.join(' → ')}</span> : null}</span>
              <span className="muted small">{it.slideCount}장</span>
              {ph.has(it.id) && <span className="pill warn">채울 칸 {ph.get(it.id)!.join(' ')}</span>}
              {it.empty && <span className="pill warn">내용 없음</span>}
            </li>
          ))}
        </ol>
        <p className="muted small">글자 크기·배경·줄 나누기 같은 자막 편집, 미리보기, 송출은 예배송출에서 합니다. 성경 본문 자막은 예배송출의 성경 기능으로 넣으세요.</p>
      </div>
      <div className="col">
        <div className="card">
          <h2>확정본</h2>
          {f.state === 'none' && <p>아직 확정하지 않았습니다. 준비가 끝나면 확정해 두세요. 확정본은 라온 교회 올인원에 따로 보관되어, 나중에 곡 조성이나 자막을 바꿔도 이 예배 내용은 그대로 남습니다.</p>}
          {f.state === 'same' && <p className="ok-text">✓ {fmtTime(f.at!)}에 확정한 내용과 지금 예배송출 내용이 같습니다.</p>}
          {f.state === 'changed' && (
            <div className="alert warn">
              <b>{fmtTime(f.at!)} 확정 뒤에 바뀐 곳이 있습니다.</b>
              <ul>{(f.changes || []).map((c, i) => <li key={i}>{c}</li>)}</ul>
              바뀐 내용이 맞으면 다시 확정하고, 실수라면 확정본으로 되돌리세요.
            </div>
          )}
          <div className="row wrap">
            <button className="primary" disabled={busy} onClick={finalize}>{f.state === 'none' ? '자막 확정' : '지금 내용으로 다시 확정'}</button>
            {f.state === 'changed' && <button disabled={busy} onClick={restore}>확정본으로 되돌리기</button>}
          </div>
          <p className="muted small">예배송출은 고친 내용이 송출 화면에 바로 반영됩니다. 예배 중에는 예배송출에서 수정하지 않도록 주의하세요.</p>
        </div>
        <div className="card">
          <h2>송출 화면 주소</h2>
          {real ? (
            <ul className="plain small">
              <li>예배당 TV·프로젝터: <code>{host}/output</code></li>
              <li>유튜브(OBS 브라우저 소스, 1920×1080): <code>{host}/overlay</code></li>
              <li>설교자 프롬프터: <code>{host}/stage</code></li>
              <li>넘기기: 예배송출 운영 화면에서 ← → 키, 휴대폰 리모컨</li>
            </ul>
          ) : <p className="muted small">예제 모드에는 실제 송출 화면이 없습니다. 우리 교회 자료에서 예배송출과 연결하면 주소가 표시됩니다.</p>}
        </div>
      </div>
    </div>
  );
}

// ── 결과물 ───────────────────────────────────────
function OutputsTab({ week, status, steps }: { week: Week; status: WeekStatus | null; steps: ReturnType<typeof prepSteps> }) {
  const { ov } = useApp();
  const [copied, setCopied] = useState('');
  const [showFinal, setShowFinal] = useState(false);
  const text = useMemo(() => setlistText(week, status), [week, status]);
  const songs = status?.summary?.items.filter((i) => i.type === 'song' || i.type === 'score') || [];
  const copy = async (t: string, what: string) => {
    try { await navigator.clipboard.writeText(t); setCopied(what); } catch { setCopied('복사하지 못했습니다. 글을 직접 선택해 복사해 주세요.'); }
    setTimeout(() => setCopied(''), 2500);
  };
  return (
    <div className="col">
      <div className="card">
        <h2>준비 상태</h2>
        <StepList steps={steps} />
      </div>
      <div className="grid2">
        <div className="card">
          <div className="row between"><h2>찬양 콘티</h2><div className="row"><button onClick={() => copy(text, '콘티 글을 복사했습니다')} disabled={!songs.length}>카톡용 글 복사</button><button onClick={() => window.print()} disabled={!songs.length}>인쇄</button></div></div>
          {copied && <p className="ok-text">{copied}</p>}
          {songs.length ? <pre className="share-text">{text}</pre> : <p className="muted">콘티에 곡이 없습니다.</p>}
          <div className="print-area">
            <h1>{ov?.church?.name} 찬양 콘티</h1>
            <p>{fmtDate(week.date)} {week.name}{week.passage ? ` · ${week.passage}` : ''}{week.sermonTitle ? ` 「${week.sermonTitle}」` : ''}</p>
            <table>
              <thead><tr><th>#</th><th>곡</th><th>조성</th><th>곡 구성</th><th>메모</th></tr></thead>
              <tbody>{songs.map((s, i) => <tr key={s.id}><td>{i + 1}</td><td>{s.title}</td><td>{s.key}</td><td>{s.arr.join(' → ')}</td><td>{s.memo}</td></tr>)}</tbody>
            </table>
            {status?.summary?.note && <p>메모: {status.summary.note}</p>}
          </div>
        </div>
        <div className="col">
          <BulletinCard week={week} />
          <div className="card">
            <h2>자막 확정본</h2>
            {week.final ? (
              <>
                <p>{fmtTime(week.final.at)} 확정 · {week.final.snap.items.length}개 자료 · 화면 {week.final.snap.items.reduce((n, i) => n + i.slides.length, 0)}장</p>
                <button onClick={() => setShowFinal(!showFinal)}>{showFinal ? '접기' : '확정본 내용 보기'}</button>
                {showFinal && (
                  <ol className="final-view">
                    {week.final.snap.items.map((it) => (
                      <li key={it.id}><b>{it.title}</b>{it.key && ` (${it.key})`}{it.arr?.length ? <span className="muted small"> · {it.arr.join(' → ')}</span> : null}
                        <div className="slides">{it.slides.map((s) => <div key={s.id} className="slide-mini">{s.label && <em>{s.label}</em>}{s.text}</div>)}</div>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : <p className="muted">아직 확정하지 않았습니다. 자막 탭에서 확정할 수 있습니다.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// 원고 파일(워드·한글 hwpx·글 파일)에서 글을 꺼내 '설교 원고' 칸에 넣는다. 파일은 이 컴퓨터 화면 안에서만 읽는다.
function NotesFile({ current, onText }: { current: string; onText: (t: string) => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      const t = (await docText(f)).trim();
      if (!t) throw new Error('파일에서 글을 찾지 못했습니다.');
      if (current.trim() && !confirm(`지금 적혀 있는 원고(${current.trim().length}자)를 "${f.name}"의 글(${t.length}자)로 바꿀까요?`)) return;
      onText(t);
      setMsg({ ok: true, text: `"${f.name}"에서 ${t.length.toLocaleString('ko-KR')}자를 넣었습니다. 표·그림·각주는 빠질 수 있으니 한 번 훑어봐 주세요.` });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };
  return (
    <div className="notes-file">
      <label className="btn small">원고 파일에서 가져오기<input type="file" hidden accept=".docx,.hwpx,.txt,.md,.hwp,.pdf,.doc" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <span className="muted small">워드(.docx) · 한글(.hwpx) · 글(.txt)</span>
      {msg && <p className={msg.ok ? 'ok-text small' : 'alert err small'}>{msg.text}</p>}
    </div>
  );
}

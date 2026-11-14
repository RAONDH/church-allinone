import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { SyncResult, Week, WeekStatus } from '../lib/types';
import { fmtDate, nextStep, prepSteps, splitWeeks, type Step } from '../lib/week';

export function StepList({ steps, onGo }: { steps: Step[]; onGo?: (s: Step) => void }) {
  const icon = { done: '✓', todo: '○', warn: '!', info: '–', unknown: '?' } as const;
  const word = { done: '완료', todo: '할 일', warn: '확인 필요', info: '안내', unknown: '확인 불가' } as const;
  return (
    <ul className="steps">
      {steps.map((s) => (
        <li key={s.key} className={`step ${s.level}`}>
          <span className="step-icon" aria-hidden>{icon[s.level]}</span>
          <span className="step-label">{s.label}</span>
          <span className={`pill ${s.level}`}>{word[s.level]}</span>
          <span className="step-text">{s.text}</span>
          {onGo && s.action && <button className="small" onClick={() => onGo(s)}>{s.action}</button>}
        </li>
      ))}
    </ul>
  );
}

export function CreateWeekDialog({ from, defaultDate, onClose }: { from: Week | null; defaultDate: string; onClose: () => void }) {
  const { base, ov, reload } = useApp();
  const nav = useNavigate();
  const [date, setDate] = useState(defaultDate);
  const [name, setName] = useState(from?.name || ov?.church?.defaultServiceName || '주일 예배');
  const [parts, setParts] = useState({ setlist: true, announcements: true, sermon: false });
  const [makeWc, setMakeWc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const wcMode = from ? (parts.setlist ? 'copy' : makeWc ? 'template' : 'none') : makeWc ? 'template' : 'none';
      const r = await api<{ week: Week; sync: SyncResult }>(`${base}/weeks`, { method: 'POST', body: { date, name, fromWeekId: from?.id, parts, wcMode } });
      await reload();
      nav(`/week/${r.week.id}`, { state: { sync: r.sync } });
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>{from ? '지난 예배 복사해서 시작' : '이번 주 예배 만들기'}</h2>
        {from && <p className="muted">복사할 예배: {fmtDate(from.date)} {from.name}{from.sermonTitle ? ` · ${from.sermonTitle}` : ''}</p>}
        <div className="row">
          <label>날짜<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="grow">예배 이름<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        </div>
        {from ? (
          <fieldset>
            <legend>무엇을 가져올까요?</legend>
            <label className="check"><input type="checkbox" checked={parts.setlist} onChange={(e) => setParts({ ...parts, setlist: e.target.checked })} />찬양 콘티와 예배 순서 자막 (예배송출에 새 순서로 복사)</label>
            <label className="check"><input type="checkbox" checked={parts.announcements} onChange={(e) => setParts({ ...parts, announcements: e.target.checked })} />광고</label>
            <label className="check"><input type="checkbox" checked={parts.sermon} onChange={(e) => setParts({ ...parts, sermon: e.target.checked })} />본문·설교 제목 (연속 설교일 때)</label>
            {!parts.setlist && <label className="check"><input type="checkbox" checked={makeWc} onChange={(e) => setMakeWc(e.target.checked)} />대신 예배송출에 주일 예배 기본 순서 만들기</label>}
          </fieldset>
        ) : (
          <label className="check"><input type="checkbox" checked={makeWc} onChange={(e) => setMakeWc(e.target.checked)} />예배송출에 주일 예배 기본 순서(예배의 부름~축도 자막)도 함께 만들기</label>
        )}
        <p className="muted small">예배송출에서는 새 예배가 ‘지금 예배’로 선택됩니다. 지난 예배 순서는 그대로 남습니다.</p>
        {err && <p className="alert err">{err}</p>}
        <div className="row end">
          <button onClick={onClose}>취소</button>
          <button className="primary" disabled={busy || !date} onClick={go}>{busy ? '만드는 중…' : '만들기'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { ov, base } = useApp();
  const nav = useNavigate();
  const [status, setStatus] = useState<Record<string, WeekStatus>>({});
  const [dialog, setDialog] = useState<null | 'new' | 'copy'>(null);
  const weeks = ov!.weeks;
  const { sun, thisWeek, primary, previous, upcoming } = splitWeeks(weeks);

  useEffect(() => {
    for (const w of [...thisWeek, ...upcoming]) api<WeekStatus>(`${base}/weeks/${w.id}/status`).then((s) => setStatus((x) => ({ ...x, [w.id]: s }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, weeks.length]);

  const steps = primary ? prepSteps(primary, status[primary.id] || null) : [];
  const next = nextStep(steps);
  const recent = [...weeks].sort((a, b) => b.date.localeCompare(a.date)).filter((w) => !thisWeek.includes(w) && !upcoming.includes(w)).slice(0, 6);

  return (
    <section>
      <div className="home-head">
        <div>
          <h1>이번 주 준비함</h1>
          <p className="muted">이번 주일 {fmtDate(sun)}</p>
        </div>
        <div className="row wrap">
          <button disabled={!previous} title={previous ? '' : '복사할 지난 예배가 없습니다'} onClick={() => setDialog('copy')}>지난주 예배 복사</button>
          <button onClick={() => setDialog('new')}>이번 주 예배 만들기</button>
          <button className="primary" disabled={!primary} onClick={() => nav(`/week/${primary!.id}/${next?.tab || 'info'}`)}>준비 이어하기</button>
          <button disabled={!primary} onClick={() => nav(`/week/${primary!.id}/outputs`)}>결과물 확인</button>
        </div>
      </div>

      {ov!.wc.ok === false && (
        <div className="alert warn">
          예배송출이 꺼져 있어 콘티·자막 상태를 확인할 수 없습니다. 예배 정보는 그대로 입력·저장할 수 있고, 예배송출을 켜면 자동으로 이어집니다.
          {' '}<Link to="/apps">예배송출 켜기</Link>
        </div>
      )}

      {!primary ? (
        <div className="card empty">
          <h2>이번 주 예배가 아직 없습니다</h2>
          {previous ? (
            <>
              <p>지난 예배({fmtDate(previous.date)} {previous.name}{previous.sermonTitle ? ` · ${previous.sermonTitle}` : ''})를 복사해서 시작하면 콘티·순서 자막·광고를 다시 입력하지 않아도 됩니다.</p>
              <div className="row"><button className="primary" onClick={() => setDialog('copy')}>지난주 예배 복사해서 시작</button><button onClick={() => setDialog('new')}>새로 만들기</button></div>
            </>
          ) : (
            <>
              <p>첫 예배를 만들어 보세요. 예배송출에 주일 예배 기본 순서가 함께 만들어집니다.</p>
              <button className="primary" onClick={() => setDialog('new')}>이번 주 예배 만들기</button>
            </>
          )}
        </div>
      ) : (
        <div className="card hero">
          <div className="hero-top">
            <div>
              <div className="muted">{fmtDate(primary.date)}</div>
              <h2>{primary.name}</h2>
              <div className="hero-word">
                {primary.passage ? <span className="passage">{primary.passage}</span> : <span className="muted">본문 미입력</span>}
                {primary.sermonTitle ? <b>「{primary.sermonTitle}」</b> : <span className="muted">설교 제목 미입력</span>}
              </div>
            </div>
            {next ? (
              <div className="next">
                <div className="muted small">다음으로 할 일</div>
                <b>{next.label}: {next.text}</b>
                <button className="primary" onClick={() => nav(`/week/${primary.id}/${next.tab}`)}>{next.action || '이어서 하기'}</button>
              </div>
            ) : (
              <div className="next done"><b>이번 주 예배 준비가 끝났습니다.</b><button onClick={() => nav(`/week/${primary.id}/outputs`)}>결과물 확인</button></div>
            )}
          </div>
          <StepList steps={steps} onGo={(s) => nav(`/week/${primary.id}/${s.tab}`)} />
        </div>
      )}

      {thisWeek.length > 1 && (
        <div className="card">
          <h3>이번 주 다른 예배</h3>
          <WeekList weeks={thisWeek.filter((w) => w !== primary)} />
        </div>
      )}
      {upcoming.length > 0 && (<div className="card"><h3>미리 준비 중인 예배</h3><WeekList weeks={upcoming} /></div>)}
      {recent.length > 0 && (<div className="card"><h3>지난 예배</h3><WeekList weeks={recent} /></div>)}

      {dialog && <CreateWeekDialog from={dialog === 'copy' ? previous : null} defaultDate={sun} onClose={() => setDialog(null)} />}
    </section>
  );
}

function WeekList({ weeks }: { weeks: Week[] }) {
  return (
    <ul className="week-list">
      {weeks.map((w) => (
        <li key={w.id}>
          <Link to={`/week/${w.id}`}>
            <span className="muted">{fmtDate(w.date)}</span> <b>{w.name}</b>
            <span>{[w.passage, w.sermonTitle && `「${w.sermonTitle}」`].filter(Boolean).join(' ') || <span className="muted">본문·제목 미입력</span>}</span>
            {w.final && <span className="pill done">확정본 있음</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

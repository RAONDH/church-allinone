// 성도·재정·행정 잠금: 잠금 화면, 위쪽 '잠그기' 단추, 설정의 잠금 카드
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';

export interface LockView { enabled: boolean; areas: string[]; idleMin: number; unlocked: boolean; resetFile: string }
const AREAS: [string, string][] = [['people', '성도'], ['finance', '재정'], ['admin', '행정']];
interface LockCtx { lv: LockView | null; reload: () => Promise<void> }
const LC = createContext<LockCtx>({ lv: null, reload: async () => {} });
export const useLock = () => useContext(LC);

export function LockProvider({ children }: { children: ReactNode }) {
  const { ws } = useApp();
  const [lv, setLv] = useState<LockView | null>(null);
  const reload = useCallback(async () => { if (ws !== 'real') { setLv(null); return; } try { setLv(await api<LockView>('/api/ws/real/lock')); } catch { setLv(null); } }, [ws]);
  useEffect(() => { reload(); }, [reload]);
  // 자리를 비워 서버가 다시 잠갔으면(423) 잠금 화면으로
  useEffect(() => { const h = () => { reload(); }; window.addEventListener('allinone-locked', h); return () => window.removeEventListener('allinone-locked', h); }, [reload]);
  return <LC.Provider value={{ lv, reload }}>{children}</LC.Provider>;
}

/** 잠긴 구역이면 잠금 화면, 아니면 내용 */
export function LockGate({ area, children }: { area: string; children: ReactNode }) {
  const { ws } = useApp();
  const { lv } = useLock();
  if (ws !== 'real' || !lv?.enabled || !lv.areas.includes(area) || lv.unlocked) return <>{children}</>;
  return <LockScreen area={area} />;
}

function LockScreen({ area }: { area: string }) {
  const { lv, reload } = useLock();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const go = async () => {
    setErr('');
    try { await api('/api/ws/real/lock/unlock', { method: 'POST', body: { pin } }); setPin(''); await reload(); } catch (e: any) { setErr(e.message); setPin(''); ref.current?.focus(); }
  };
  const name = AREAS.find(([k]) => k === area)?.[1] || '';
  return (
    <section className="narrow lock-screen">
      <div className="card">
        <div className="lock-icon" aria-hidden>🔒</div>
        <h1>{name} 자료는 잠겨 있습니다</h1>
        <p className="muted">잠금 암호(숫자)를 넣으면 {lv?.areas.map((a) => AREAS.find(([k]) => k === a)?.[1]).join('·')} 자료가 열립니다. {lv?.idleMin}분 동안 손대지 않으면 다시 잠깁니다.</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <input ref={ref} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="잠금 암호" aria-label="잠금 암호" />
          <button className="primary" disabled={pin.length < 4}>열기</button>
        </form>
        {err && <p className="alert err small">{err}</p>}
        <details className="small muted"><summary>암호를 잊었어요</summary>
          <p>이 컴퓨터의 라온 교회 올인원 자료 폴더(맥: <code>교회 올인원/data</code>, 윈도우: <code>%APPDATA%\ChurchAllInOne</code>)에 <code>{lv?.resetFile}</code> 이라는 빈 파일을 만들고 프로그램을 다시 켜면 잠금이 풀립니다. 자료는 그대로 남습니다.</p>
        </details>
      </div>
    </section>
  );
}

/** 위쪽 메뉴의 '잠그기' 단추 (잠금을 켰고 지금 풀려 있을 때) */
export function LockButton() {
  const { lv, reload } = useLock();
  if (!lv?.enabled || !lv.unlocked) return null;
  return <button className="lock-btn" title="성도·재정·행정 자료를 지금 잠급니다" onClick={async () => { await api('/api/ws/real/lock/lock', { method: 'POST' }); await reload(); }}>🔒 잠그기</button>;
}

/** 설정 → 잠금 */
export function LockSettings() {
  const { lv, reload } = useLock();
  const [f, setF] = useState({ pin: '', pin2: '', current: '', areas: ['people', 'finance', 'admin'], idleMin: 10 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (lv?.enabled) setF((x) => ({ ...x, areas: lv.areas, idleMin: lv.idleMin })); }, [lv?.enabled, lv?.areas.join(), lv?.idleMin]);
  if (!lv) return null;
  const toggleArea = (a: string) => setF({ ...f, areas: f.areas.includes(a) ? f.areas.filter((x) => x !== a) : [...f.areas, a] });
  const save = async (enabled: boolean) => {
    setMsg(null);
    if (enabled && (f.pin || !lv.enabled) && f.pin !== f.pin2) { setMsg({ ok: false, text: '새 잠금 암호 두 칸이 서로 다릅니다.' }); return; }
    try {
      await api('/api/ws/real/lock', { method: 'PUT', body: enabled ? { enabled, pin: f.pin || undefined, current: f.current, areas: f.areas, idleMin: f.idleMin } : { enabled: false, current: f.current } });
      setF({ ...f, pin: '', pin2: '', current: '' }); await reload();
      setMsg({ ok: true, text: enabled ? (lv.enabled ? '잠금 설정을 바꿨습니다.' : '잠금을 켰습니다. 위쪽 🔒 잠그기 단추로 바로 잠글 수 있습니다.') : '잠금을 껐습니다.' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };
  const num = (k: 'pin' | 'pin2' | 'current') => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '').slice(0, 8) });
  return (
    <div className="card">
      <h2>잠금 (성도·재정·행정)</h2>
      <p className="muted small">교회 사무실 컴퓨터처럼 여럿이 쓰는 곳이면 켜 두세요. 잠근 곳은 잠금 암호를 넣어야 열리고, 정한 시간 동안 손대지 않으면 다시 잠깁니다. 예배 준비·자막 화면은 잠그지 않습니다. 잠금을 켜면 백업 파일 받기·되살리기도 암호가 필요합니다.</p>
      <p className="small">{lv.enabled ? <>🔒 켜져 있음 · {lv.areas.map((a) => AREAS.find(([k]) => k === a)?.[1]).join('·')} · {lv.idleMin}분</> : '꺼져 있음'}</p>
      <div className="chips">{AREAS.map(([k, l]) => <label key={k} className={`chip ${f.areas.includes(k) ? 'on' : ''}`}><input type="checkbox" hidden checked={f.areas.includes(k)} onChange={() => toggleArea(k)} />{l}</label>)}</div>
      <div className="form-grid">
        {lv.enabled && <label>지금 잠금 암호<input type="password" inputMode="numeric" value={f.current} onChange={num('current')} aria-label="지금 잠금 암호" /></label>}
        <label>{lv.enabled ? '새 잠금 암호 (바꿀 때만)' : '잠금 암호 (숫자 4~8자리)'}<input type="password" inputMode="numeric" value={f.pin} onChange={num('pin')} aria-label="새 잠금 암호" /></label>
        <label>한 번 더<input type="password" inputMode="numeric" value={f.pin2} onChange={num('pin2')} aria-label="새 잠금 암호 확인" /></label>
        <label>손대지 않으면 다시 잠그기<select value={f.idleMin} onChange={(e) => setF({ ...f, idleMin: +e.target.value })}>{[5, 10, 20, 30, 60].map((n) => <option key={n} value={n}>{n}분</option>)}</select></label>
      </div>
      <div className="row">
        <button className="primary" onClick={() => save(true)}>{lv.enabled ? '잠금 설정 저장' : '잠금 켜기'}</button>
        {lv.enabled && <button className="danger-link" onClick={() => save(false)}>잠금 끄기</button>}
      </div>
      {msg && <p className={msg.ok ? 'alert info small' : 'alert err small'}>{msg.text}</p>}
    </div>
  );
}

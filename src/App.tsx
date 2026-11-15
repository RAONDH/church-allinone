import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import type { AppInfo, Overview, Ws } from './lib/types';
import Home from './pages/Home';
import WeekPage from './pages/WeekPage';
import Songs from './pages/Songs';
import Guide from './pages/Guide';
import People from './pages/People';
import Finance from './pages/Finance';
import Admin from './pages/Admin';

interface Ctx { ws: Ws; setWs: (w: Ws) => void; ov: Overview | null; reload: () => Promise<void>; base: string; loadError: string }
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);

// 주소에 ?ws=sample 을 붙이면 예제로 바로 열기 (설명서·소개 사진용 링크)
const readWs = (): Ws => {
  const q = new URLSearchParams(window.location.search).get('ws');
  if (q === 'sample' || q === 'real') { try { localStorage.setItem('ws', q); } catch { /* 저장 안 돼도 동작 */ } return q; }
  try { return localStorage.getItem('ws') === 'sample' ? 'sample' : 'real'; } catch { return 'real'; }
};

export default function App() {
  const [ws, setWsState] = useState<Ws>(readWs);
  const { pathname } = useLocation();
  const [ovState, setOv] = useState<(Overview & { ws: Ws }) | null>(null);
  const ov = ovState?.ws === ws ? ovState : null;   // 작업 공간을 바꾸는 순간 이전 자료가 잠깐 보이지 않게
  const [loadError, setLoadError] = useState('');
  const base = `/api/ws/${ws}`;
  const reload = useCallback(async () => {
    try { setOv({ ...(await api<Overview>(base)), ws: base.endsWith('sample') ? 'sample' : 'real' }); setLoadError(''); } catch (e: any) { setLoadError(e.message); }
  }, [base]);
  useEffect(() => { reload(); }, [reload]);
  const setWs = (w: Ws) => { try { localStorage.setItem('ws', w); } catch { /* 저장 안 돼도 동작 */ } setWsState(w); };

  return (
    <C.Provider value={{ ws, setWs, ov, reload, base, loadError }}>
      {ws === 'sample' && (
        <div className="sample-banner">
          <b>예제 자료를 보고 있습니다.</b> 여기서 바꾼 내용은 실제 교회 자료·실제 예배송출에 영향을 주지 않습니다.
          <button className="link" onClick={() => setWs('real')}>우리 교회 자료로 돌아가기</button>
        </div>
      )}
      <header className="top">
        <NavLink to="/" className="brand">라온 교회 올인원{ov?.church ? <small>{ov.church.name}</small> : null}</NavLink>
        <nav>
          <NavLink to="/" end>이번 주 준비함</NavLink>
          <NavLink to="/people">성도</NavLink>
          <NavLink to="/finance">재정</NavLink>
          <NavLink to="/admin">행정</NavLink>
          <NavLink to="/songs">찬양 자료</NavLink>
          <NavLink to="/apps">프로그램</NavLink>
          <NavLink to="/settings">설정</NavLink>
          <NavLink to="/guide">사용설명서</NavLink>
        </nav>
        <div className="ws-toggle" role="group" aria-label="자료 선택">
          <button className={ws === 'real' ? 'on' : ''} onClick={() => setWs('real')}>우리 교회</button>
          <button className={ws === 'sample' ? 'on sample' : ''} onClick={() => setWs('sample')}>예제</button>
        </div>
      </header>
      <main>
        {loadError ? <div className="alert err">{loadError} <button onClick={reload}>다시 시도</button></div>
          : !ov ? <p className="muted">불러오는 중…</p>
          : !ov.church ? (pathname === '/guide' ? <Guide /> : <Setup />)
          : (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/week/:id" element={<WeekPage />} />
              <Route path="/week/:id/:tab" element={<WeekPage />} />
              <Route path="/people" element={<People />} />
              <Route path="/people/:tab" element={<People />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/finance/:tab" element={<Finance />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/:tab" element={<Admin />} />
              <Route path="/songs" element={<Songs />} />
              <Route path="/apps" element={<Apps />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/guide" element={<Guide />} />
              <Route path="*" element={<Home />} />
            </Routes>
          )}
      </main>
      <footer className="site-foot">
        라온 교회 올인원은 무료로 쓰실 수 있습니다. <NavLink to="/settings#support">후원 안내</NavLink> · <a href="https://open.kakao.com/o/gSkET2Wi" target="_blank" rel="noopener">카카오 오픈채팅 문의</a>
      </footer>
    </C.Provider>
  );
}

function Setup() {
  const { base, reload, setWs } = useApp();
  const [f, setF] = useState({ name: '', pastor: '', defaultServiceName: '주일 예배' });
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api(`${base}/church`, { method: 'PUT', body: f }); await reload(); } catch (x: any) { setErr(x.message); }
  };
  return (
    <div className="setup">
      <h1>혼자 목회해도, 매주 준비를 혼자 다 하지 않도록.</h1>
      <p className="lead">라온 교회 올인원은 이미 쓰고 계신 예배송출(자막·콘티), 찬양곡 선정, 설교 쇼츠, 회계장부를 한 화면에 이어 줍니다.<br />
        예배 정보를 한 번 입력하면 예배송출 자막에도 그대로 들어갑니다.</p>
      <div className="setup-grid">
        <form className="card" onSubmit={submit}>
          <h2>우리 교회로 시작하기</h2>
          <label>교회 이름<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 라온동행교회" /></label>
          <label>목회자 이름<input value={f.pastor} onChange={(e) => setF({ ...f, pastor: e.target.value })} /></label>
          <label>주로 준비하는 예배 이름<input value={f.defaultServiceName} onChange={(e) => setF({ ...f, defaultServiceName: e.target.value })} /></label>
          {err && <p className="alert err">{err}</p>}
          <button className="primary">시작하기</button>
          <p className="muted small">자료는 이 컴퓨터에만 저장됩니다. 회원 가입이나 인터넷 계정이 필요 없습니다.</p>
        </form>
        <div className="card sample-card">
          <h2>먼저 예제로 둘러보기</h2>
          <p>지난주 예배가 미리 들어 있는 예제 교회로 사용법을 살펴볼 수 있습니다. 예제는 실제 자료와 완전히 분리되어 있고, 실제 예배송출에도 들어가지 않습니다.</p>
          <button onClick={() => setWs('sample')}>예제 열기</button>
        </div>
      </div>
    </div>
  );
}

export function Apps() {
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const load = () => api<AppInfo[]>('/api/apps').then(setApps).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const open = async (a: AppInfo) => {
    setBusy(a.id); setErr('');
    const w = window.open('about:blank', '_blank');
    try {
      const r = await api<{ url: string }>(`/api/apps/${a.id}/start`, { method: 'POST' });
      if (w) w.location.href = r.url; else window.location.href = r.url;
      load();
    } catch (e: any) { w?.close(); setErr(`${a.name}: ${e.message}`); }
    setBusy('');
  };
  return (
    <section>
      <h1>프로그램</h1>
      <p className="muted">이미 쓰고 계신 프로그램을 여기서 켜고 엽니다. 필요할 때 자동으로 켜집니다.</p>
      {err && <p className="alert err">{err}</p>}
      <div className="apps">
        {apps?.map((a) => (
          <div key={a.id} className="card app" style={{ borderTopColor: a.color }}>
            <div className="app-head"><span className="app-icon">{a.icon}</span><b>{a.name}</b></div>
            <p className="muted small">{a.desc}</p>
            <div className="row">
              <span className={`pill ${a.running ? 'done' : 'info'}`}>{!a.installed ? '설치 폴더 없음' : a.running ? '켜져 있음' : '꺼져 있음'}</span>
              <button disabled={!a.installed || busy === a.id} onClick={() => open(a)}>{busy === a.id ? '켜는 중…' : '열기'}</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Settings() {
  const { ov, base, reload, ws } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ name: ov?.church?.name || '', pastor: ov?.church?.pastor || '', defaultServiceName: ov?.church?.defaultServiceName || '주일 예배', theology: ov?.church?.theology || '' });
  const [msg, setMsg] = useState('');
  const save = async () => {
    try { await api(`${base}/church`, { method: 'PUT', body: f }); await reload(); setMsg('저장했습니다.'); } catch (e: any) { setMsg(e.message); }
  };
  const resetSample = async () => {
    if (!confirm('예제 자료를 처음 상태로 되돌릴까요? (실제 교회 자료는 그대로입니다)')) return;
    await api(`${base}/reset`, { method: 'POST' }); await reload(); nav('/');
  };
  return (
    <section className="narrow">
      <h1>설정</h1>
      <div className="card">
        <h2>교회 정보</h2>
        <label>교회 이름<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>목회자 이름<input value={f.pastor} onChange={(e) => setF({ ...f, pastor: e.target.value })} /></label>
        <label>기본 예배 이름<input value={f.defaultServiceName} onChange={(e) => setF({ ...f, defaultServiceName: e.target.value })} /></label>
        <label>신학 관점·말투 <span className="muted small">(선택 · 설교 후 자료를 만들 때 AI에게 알려 줍니다)</span><input value={f.theology} onChange={(e) => setF({ ...f, theology: e.target.value })} placeholder="예: 웨슬리안 성결 신학, 사중복음(중생·성결·신유·재림). 따뜻하고 단정한 말투" /></label>
        <div className="row"><button className="primary" onClick={save}>저장</button>{msg && <span className="muted">{msg}</span>}</div>
      </div>
      <div className="card">
        <h2>연결과 저장 위치</h2>
        <ul className="plain">
          <li>예배송출 연결 주소: <code>{ov?.settings.wcUrl}</code> {ov?.wc.ok ? <span className="pill done">연결됨</span> : <span className="pill warn">연결 안 됨</span>}</li>
          <li>라온 교회 올인원 자료(성도 명부·재정 포함): 이 컴퓨터의 <code>교회 올인원/data</code> 폴더 (윈도우는 <code>%APPDATA%\ChurchAllInOne</code>) · 매일 자동 백업, 14일 보관</li>
          <li>🔒 성도 명부·심방·출석·재정·행정 자료는 AI나 인터넷으로 보내지 않습니다. 이 컴퓨터를 다른 사람과 함께 쓰신다면 컴퓨터 로그인 암호를 걸어 두세요.</li>
          <li>찬양 가사·곡 구성·자막은 예배송출에 저장됩니다. 예배송출의 백업(zip)도 함께 챙겨 주세요.</li>
        </ul>
      </div>
      <div className="card">
        <h2>인터넷 없이 쓸 수 있는 범위</h2>
        <ul className="plain">
          <li>✅ 이번 주 준비함, 예배 정보, 콘티, 확정본: 이 컴퓨터 안에서만 동작 (외부 주소를 부르지 않음)</li>
          <li>✅ 자막 송출: 예배송출이 담당 (예배송출 안내 기준 인터넷 없이 예배 진행 가능)</li>
          <li>⚠️ 찬양곡 추천(PraiseFlow), 가사 인터넷 검색, 쇼츠 제작은 인터넷이 필요합니다</li>
        </ul>
      </div>
      <Support />
      {ws === 'sample' && (
        <div className="card"><h2>예제 자료</h2><button onClick={resetSample}>예제 자료 처음 상태로</button></div>
      )}
    </section>
  );
}

const ACCOUNT = { bank: '카카오뱅크', number: '3333-01-9034483', holder: '이광복' };

function Support() {
  const [copied, setCopied] = useState('');
  const { hash } = useLocation();
  useEffect(() => { if (hash === '#support') document.getElementById('support')?.scrollIntoView({ behavior: 'smooth' }); }, [hash]);
  const copy = async () => {
    const text = `${ACCOUNT.bank} ${ACCOUNT.number}`;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* 아래 방식으로 다시 시도 */ }
    if (!ok) {
      const t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      t.remove();
    }
    setCopied(ok ? '계좌번호를 복사했습니다.' : `복사하지 못했습니다. 직접 적어 주세요: ${text}`);
  };
  return (
    <div className="card support" id="support">
      <h2>후원 안내</h2>
      <p>라온 교회 올인원은 자율 후원으로 운영됩니다. 후원은 부담을 갖지 않으셔도 됩니다. 무료로 사용하셔도 괜찮습니다.</p>
      <div className="account">
        <span>{ACCOUNT.bank}</span> <b>{ACCOUNT.number}</b> <span>{ACCOUNT.holder}</span>
        <button onClick={copy}>계좌번호 복사</button>
      </div>
      {copied && <p className="muted small">{copied}</p>}
    </div>
  );
}

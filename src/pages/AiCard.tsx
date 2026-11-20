// 설정 → AI 연결: Claude·ChatGPT 구독 로그인 상태와 제미나이 API 키
// 제미나이 키는 PraiseFlow 와 함께 씁니다(한 번 넣으면 찬양 추천·설교 후 자료·회의록 정리 모두). 키 값은 화면에 다시 보여 주지 않습니다.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Sub { installed: boolean; loggedIn: boolean }
export interface AiStatus { provider: string | null; label: string; claude: Sub; codex: Sub; gemini: Sub }

export default function AiCard() {
  const [st, setSt] = useState<AiStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback((refresh = false) => api<AiStatus>(`/api/ai${refresh ? '?refresh' : ''}`).then(setSt).catch((e) => setMsg({ ok: false, text: e.message })), []);
  useEffect(() => { load(); }, [load]);
  const saveKey = async (k: string) => {
    setBusy(true); setMsg(null);
    try { setSt(await api<AiStatus>('/api/ai/gemini-key', { method: 'PUT', body: { key: k } })); setKey(''); setMsg({ ok: true, text: k ? '제미나이 API 키를 저장했습니다.' : '제미나이 API 키를 지웠습니다.' }); }
    catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  };
  const row = (name: string, s: Sub | undefined, how: React.ReactNode) => (
    <li>{s?.loggedIn ? <span className="pill done">연결됨</span> : <span className="pill">연결 안 됨</span>} <b>{name}</b> <span className="muted small">{how}</span></li>
  );
  return (
    <div className="card ai-card" id="ai-connect">
      <h2>AI 연결</h2>
      <p className="muted small">설교 후 자료와 회의록 정리에 씁니다. 셋 중 하나만 있으면 됩니다. 여러 개가 연결되어 있으면 설교 후 자료 탭에서 고를 수 있습니다.</p>
      {!st ? <p className="muted">확인하는 중…</p> : (
        <>
          <ul className="ai-list">
            {row('Claude 구독', st.claude, <>터미널에서 <code>claude</code> 로 로그인</>)}
            {row('ChatGPT 구독', st.codex, <>터미널에서 <code>codex login</code> 으로 로그인</>)}
            {row('제미나이 API 키', st.gemini, '아래에 키를 넣기 (PraiseFlow와 함께 씀)')}
          </ul>
          <p className="small">지금 쓰는 AI: <b>{st.label || '없음'}</b> <button className="link" onClick={() => load(true)}>다시 확인</button></p>
          <div className="row wrap">
            <input className="grow" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={st.gemini?.loggedIn ? '제미나이 API 키 (저장됨 · 바꾸려면 새 키 넣기)' : '제미나이 API 키 붙여 넣기'} aria-label="제미나이 API 키" />
            <button className="primary" disabled={busy || key.trim().length < 20} onClick={() => saveKey(key)}>키 저장</button>
            {st.gemini?.loggedIn && <button className="link small" disabled={busy} onClick={() => { if (window.confirm('제미나이 API 키를 지울까요? PraiseFlow에서도 지워집니다.')) saveKey(''); }}>키 지우기</button>}
          </div>
          <p className="muted small">키는 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>에서 무료로 받을 수 있습니다(무료 사용량 안에서는 요금 없음). 무료 사용량으로 보낸 글은 구글이 서비스 개선에 쓸 수 있으니, 성도 개인 이야기가 많은 회의록은 구독 방식을 권합니다. 성도 명부·재정 자료는 어느 AI로도 보내지 않습니다.</p>
        </>
      )}
      {msg && <p className={`alert small ${msg.ok ? 'info' : 'err'}`}>{msg.text}</p>}
    </div>
  );
}

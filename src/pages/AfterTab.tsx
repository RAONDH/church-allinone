import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { Week } from '../lib/types';
import { fmtTime } from '../lib/week';

type Kind = 'infographic' | 'blog' | 'sg-adult' | 'sg-youth' | 'summary' | 'cards' | 'qt' | 'family' | 'shorts' | 'review';
interface Doc { at: number; via: string; sample: boolean; chars: number; basis: string }
interface Job { startedAt: number; provider: string; label: string; waiting?: boolean }
interface SubState { installed: boolean; loggedIn: boolean }
interface AfterState {
  ai: { provider: string | null; label: string; claude?: SubState; codex?: SubState };
  docs: Partial<Record<Kind, Doc>>; running: Partial<Record<Kind, Job>>; errors: Partial<Record<Kind, { at: number; message: string }>>;
  notesChars: number; minNotes: number;
}

interface Item { kind: Kind; icon: string; title: string; desc: string; html: boolean; copy?: string }
const GROUPS: { title: string; note?: string; items: Item[] }[] = [
  { title: '성도와 나누기', items: [
    { kind: 'infographic', icon: '🖼', title: '설교 인포그래픽', desc: '대지·중심 말씀·핵심 단어·적용 체크리스트·기도문을 한 장의 웹페이지로. 성도에게 링크나 파일로 나눌 수 있습니다.', html: true },
    { kind: 'cards', icon: '🗂', title: '카드뉴스 · 말씀카드', desc: '정사각형 카드 6~8장(표지·대지·말씀카드·실천·마무리). 카드마다 그림(PNG)으로 저장해 인스타그램·카카오톡에 올립니다.', html: true },
    { kind: 'summary', icon: '📰', title: '주보·문자용 요약', desc: '주보에 싣는 300~400자 요약, 핵심 문장, 한 주 질문, 단체 문자·카톡용 짧은 글.', html: false, copy: '요약' },
    { kind: 'blog', icon: '✍️', title: '블로그 글', desc: '설교 원고를 읽는 글 말투로 다듬은 블로그용 글. 복사해서 네이버 블로그·티스토리에 붙여 넣습니다.', html: false, copy: '글' },
  ] },
  { title: '소그룹 · 가정', items: [
    { kind: 'sg-adult', icon: '👥', title: '소그룹 나눔지 (장년 · 90분)', desc: '마음 열기 → 말씀 속으로 → 삶에 가져오기 → 적용 → 중보기도, 접히는 인도자 가이드 포함. 인쇄해서 쓸 수 있습니다.', html: true },
    { kind: 'sg-youth', icon: '🔥', title: '소그룹 나눔지 (청소년 · 75분)', desc: '웜업 → OX 퀴즈 → 토크타임 4단계 → 이번 주 챌린지 → 함께 기도.', html: true },
    { kind: 'qt', icon: '🌅', title: '한 주 묵상 (주일~토요일)', desc: '설교 본문을 날마다 다른 초점으로 이어 묵상: 읽을 말씀·묵상·질문·실천·기도. 요일 단추와 인쇄 지원.', html: true },
    { kind: 'family', icon: '🏡', title: '가정예배지 (30~40분)', desc: '모임 → 말씀(어린이 설명 포함) → 나눔 → 기도 → 마침, 잘라서 붙이는 암송 구절 카드까지.', html: true },
  ] },
  { title: '목회자용', note: '이 두 가지는 성도에게 나누는 자료가 아니라 목사님이 보시는 자료입니다.', items: [
    { kind: 'shorts', icon: '🎬', title: '쇼츠 대본', desc: '설교 영상에서 1분 이내로 자를 구간 3개: 첫 3초 문구, 원고에서 찾을 곳, 대본(원고 문장 그대로), 자막 줄, 설명란·해시태그.', html: false, copy: '대본' },
    { kind: 'review', icon: '🩺', title: '설교 점검', desc: '예상 분량(분), 한 문장 메시지, 구조 흐름, 잘된 점·다듬을 점, 적용·본문 연결 점검. 신학은 판단하지 않습니다.', html: false, copy: '점검' },
  ] },
];
const ITEMS = GROUPS.flatMap((g) => g.items);

export default function AfterTab({ week, onGoInfo }: { week: Week; onGoInfo: () => void }) {
  const { base } = useApp();
  const root = `${base}/weeks/${week.id}/after`;
  const [st, setSt] = useState<AfterState | null>(null);
  const [err, setErr] = useState('');
  const [provider, setProvider] = useState('');
  const [now, setNow] = useState(Date.now());

  const load = useCallback((refresh = false) => api<AfterState>(`${root}${refresh ? '?refresh=1' : ''}`).then((s) => { setSt(s); setErr(''); }).catch((e) => setErr(e.message)), [root]);
  useEffect(() => { load(); }, [load]);
  const busy = !!st && Object.keys(st.running).length > 0;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { setNow(Date.now()); load(); }, 4000);
    return () => clearInterval(t);
  }, [busy, load]);

  const make = async (kind: Kind) => {
    try { await api(`${root}/${kind}`, { method: 'POST', body: { provider: provider || undefined } }); await load(); }
    catch (e: any) { setErr(e.message); }
  };
  const makeAll = async (kinds: Kind[]) => {
    setErr('');
    try { for (const k of kinds) await api(`${root}/${k}`, { method: 'POST', body: { provider: provider || undefined } }); }
    catch (e: any) { setErr(e.message); }
    await load();
  };

  if (!st) return <div className="card">{err ? <p className="alert err">{err}</p> : <p className="muted">불러오는 중…</p>}</div>;
  const sample = st.ai.provider === 'sample';
  const enough = st.notesChars >= st.minNotes;
  const subs = (['claude', 'codex'] as const).filter((p) => st.ai[p]?.loggedIn);

  return (
    <div className="col">
      <div className="card">
        <div className="row between">
          <h2>설교 후 자료</h2>
          {sample ? <span className="pill info">예제 · AI를 부르지 않음</span>
            : st.ai.provider ? <span className="pill done">AI 연결됨 · {st.ai.label}</span>
            : <span className="pill warn">AI 구독 연결 안 됨</span>}
        </div>
        <p className="muted">예배 정보 탭의 <b>설교 원고</b>로 만듭니다. 원고를 고쳤다면 '다시 만들기'를 누르세요. 만든 자료는 이 예배 기록에 보관됩니다.</p>
        {!sample && !st.ai.provider && (
          <div className="alert warn">
            이 컴퓨터에 로그인된 AI 구독이 없습니다. 터미널(윈도우는 PowerShell)에서 <code>claude</code>(Claude 구독) 또는 <code>codex login</code>(ChatGPT 구독)으로 로그인한 뒤
            <button className="link" onClick={() => load(true)}>다시 확인</button>을 눌러 주세요.
          </div>
        )}
        {!sample && subs.length > 1 && (
          <label className="inline">사용할 AI
            <select value={provider || st.ai.provider || ''} onChange={(e) => setProvider(e.target.value)}>
              {subs.map((p) => <option key={p} value={p}>{p === 'claude' ? 'Claude 구독' : 'ChatGPT 구독'}</option>)}
            </select>
          </label>
        )}
        {!enough && (
          <div className="alert warn">
            설교 원고가 {st.notesChars}자입니다. 요지만으로는 내용을 지어내기 쉬워서 {st.minNotes}자 이상 원고가 있어야 만듭니다.
            <button className="link" onClick={onGoInfo}>예배 정보 탭에서 원고 붙여 넣기</button>
          </div>
        )}
        {err && <p className="alert err">{err}</p>}
        {!sample && st.ai.provider && <p className="muted small">자료 하나에 보통 2~5분 걸리고 구독 사용량을 씁니다(추가 요금 없음). 한꺼번에 눌러도 두 개씩 차례로 만듭니다. 만드는 동안 다른 화면으로 가도 됩니다.</p>}
        {(() => {
          const left = ITEMS.filter((it) => !st.docs[it.kind] && !st.running[it.kind] && it.kind !== 'review').map((it) => it.kind);
          return left.length > 0 && enough && (sample || st.ai.provider) ? (
            <div className="row"><button className="primary" onClick={() => makeAll(left)}>아직 안 만든 자료 {left.length}가지 한꺼번에 만들기</button><span className="muted small">설교 점검은 빼고 만듭니다{sample ? '' : ` · 모두 끝나려면 ${Math.ceil(left.length / 2) * 3}분 안팎`}</span></div>
          ) : null;
        })()}
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} className="after-group">
          <h3 className="after-group-title">{g.title}{g.note && <span className="muted small"> · {g.note}</span>}</h3>
          <div className="grid2">
            {g.items.map((it) => {
              const doc = st.docs[it.kind], job = st.running[it.kind], fail = st.errors[it.kind];
              const view = `${root}/${it.kind}/view`;
              return (
                <div key={it.kind} className="card after-card">
                  <h3>{it.icon} {it.title}</h3>
                  <p className="muted small">{it.desc}</p>
                  {job ? <p className="pill info">{job.waiting ? `차례 기다리는 중 · ${job.label}` : `만드는 중… ${Math.max(0, Math.round((now - job.startedAt) / 1000))}초 · ${job.label}`}</p>
                    : doc ? <p className="small">✅ {fmtTime(doc.at)} · {doc.via}{doc.sample ? ' (예제)' : ''} <span className="muted">· {doc.basis}</span></p>
                    : <p className="muted small">아직 만들지 않았습니다.</p>}
                  {fail && !job && <p className="alert err small">{fail.message}</p>}
                  <div className="row">
                    <button className={doc ? '' : 'primary'} disabled={!!job || !enough || (!sample && !st.ai.provider)} onClick={() => make(it.kind)}>{doc ? '다시 만들기' : '만들기'}</button>
                    {doc && it.html && <a className="btn" href={view} target="_blank" rel="noopener">{it.kind === 'cards' ? '카드 보기·저장' : '열어 보기'}</a>}
                    {doc && <a className="btn" href={`${view}?download=1`}>파일로 받기</a>}
                  </div>
                  {doc && !it.html && <BlogPreview url={`${root}/${it.kind}`} at={doc.at} what={it.copy || '글'} />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="muted small">AI가 만든 자료는 꼭 한 번 읽어 보고 나눠 주세요. 성경 구절·인용·예화가 원고와 같은지 확인이 필요합니다.</p>
    </div>
  );
}

function BlogPreview({ url, at, what = '글' }: { url: string; at: number; what?: string }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { api<{ content: string }>(url).then((d) => setText(d.content)).catch(() => setText('')); }, [url, at]);
  const plain = text.replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '').replace(/\*\*(.+?)\*\*/g, '$1');
  const copy = async (t: string, what: string) => {
    let ok = false;
    try { await navigator.clipboard.writeText(t); ok = true; } catch { /* 아래 방식 */ }
    if (!ok) {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
    }
    setMsg(ok ? `${what}을 복사했습니다.` : '복사하지 못했습니다. 미리 보기에서 직접 선택해 복사해 주세요.');
    setTimeout(() => setMsg(''), 3000);
  };
  if (!text) return null;
  return (
    <div className="blog-box">
      <div className="row">
        <button onClick={() => copy(plain, what)}>{what} 복사</button>
        <button onClick={() => copy(text, '마크다운')}>마크다운 복사</button>
        <button className="link" onClick={() => setOpen(!open)}>{open ? '미리 보기 접기' : '미리 보기'}</button>
      </div>
      {msg && <p className="ok-text">{msg}</p>}
      {open && <div className="blog-preview">{renderMd(text)}</div>}
    </div>
  );
}

// 간단한 마크다운 미리 보기 (HTML을 직접 넣지 않고 글자로만 그림)
function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
}
function renderMd(md: string) {
  const out: JSX.Element[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`}>{list.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); list = []; } };
  md.split(/\n/).forEach((line, i) => {
    const l = line.trimEnd();
    if (/^[-*]\s+/.test(l)) { list.push(l.replace(/^[-*]\s+/, '')); return; }
    flush();
    if (!l.trim()) return;
    if (l.startsWith('# ')) out.push(<h2 key={i}>{inline(l.slice(2))}</h2>);
    else if (/^#{2,6}\s/.test(l)) out.push(<h3 key={i}>{inline(l.replace(/^#+\s/, ''))}</h3>);
    else if (l.startsWith('>')) out.push(<blockquote key={i}>{inline(l.replace(/^>\s?/, ''))}</blockquote>);
    else out.push(<p key={i}>{inline(l)}</p>);
  });
  flush();
  return out;
}

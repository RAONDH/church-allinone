import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { Week } from '../lib/types';
import { fmtTime } from '../lib/week';

type Kind = 'infographic' | 'blog' | 'sg-adult' | 'sg-youth' | 'summary' | 'cards' | 'qt' | 'family' | 'review';
interface Doc { at: number; via: string; sample: boolean; chars: number; basis: string }
interface Job { startedAt: number; provider: string; label: string; waiting?: boolean }
interface SubState { installed: boolean; loggedIn: boolean }
interface AfterState {
  ai: { provider: string | null; label: string; claude?: SubState; codex?: SubState; gemini?: SubState };
  docs: Partial<Record<Kind, Doc>>; running: Partial<Record<Kind, Job>>; errors: Partial<Record<Kind, { at: number; message: string }>>;
  notesChars: number; minNotes: number;
}

interface Item { kind: Kind; icon: string; title: string; desc: string; html: boolean; copy?: string }
const GROUPS: { title: string; note?: string; items: Item[] }[] = [
  { title: '성도와 나누기', items: [
    { kind: 'infographic', icon: '🖼', title: '설교 인포그래픽', desc: '대지·중심 말씀·적용·기도문을 한 장 웹페이지로', html: true },
    { kind: 'cards', icon: '🗂', title: '카드뉴스 · 말씀카드', desc: '정사각형 카드 6~8장, 그림(PNG)으로 저장해 SNS·카톡에', html: true },
    { kind: 'summary', icon: '📰', title: '주보·문자용 요약', desc: '주보 요약 · 핵심 문장 · 단체 문자용 짧은 글', html: false, copy: '요약' },
    { kind: 'blog', icon: '✍️', title: '블로그 글', desc: '읽는 글로 다듬어 블로그에 붙여 넣기', html: false, copy: '글' },
  ] },
  { title: '소그룹 · 가정', items: [
    { kind: 'sg-adult', icon: '👥', title: '장년 소그룹 나눔지', desc: '90분 · 질문·중보기도 표·인도자 가이드', html: true },
    { kind: 'sg-youth', icon: '🔥', title: '청소년 소그룹 나눔지', desc: '75분 · OX 퀴즈·토크타임·이번 주 챌린지', html: true },
    { kind: 'qt', icon: '🌅', title: '한 주 묵상', desc: '주일~토요일 7일 · 묵상·질문·실천·기도', html: true },
    { kind: 'family', icon: '🏡', title: '가정예배지', desc: '30~40분 · 어린이 설명·가족 나눔·암송 카드', html: true },
  ] },
  { title: '목회자용', note: '성도에게 나누는 자료가 아닙니다', items: [
    { kind: 'review', icon: '🩺', title: '설교 점검', desc: '분량·구조·다듬을 점·적용 점검 (신학은 판단하지 않음)', html: false, copy: '점검' },
  ] },
];
const ITEMS = GROUPS.flatMap((g) => g.items);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function AfterTab({ week, onGoInfo }: { week: Week; onGoInfo: () => void }) {
  const { base } = useApp();
  const root = `${base}/weeks/${week.id}/after`;
  const [st, setSt] = useState<AfterState | null>(null);
  const [err, setErr] = useState('');
  const [provider, setProvider] = useState('');
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState('');

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
  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(week.sermonVideoUrl); setCopied('영상 주소를 복사했습니다'); } catch { setCopied('주소를 복사하지 못했습니다'); }
    setTimeout(() => setCopied(''), 2500);
  };

  if (!st) return <div className="card">{err ? <p className="alert err">{err}</p> : <p className="muted">불러오는 중…</p>}</div>;
  const sample = st.ai.provider === 'sample';
  const enough = st.notesChars >= st.minNotes;
  const ready = enough && (sample || !!st.ai.provider);
  const subs = (['claude', 'codex', 'gemini'] as const).filter((p) => st.ai[p]?.loggedIn);
  const made = ITEMS.filter((it) => st.docs[it.kind]).length;
  const left = ITEMS.filter((it) => !st.docs[it.kind] && !st.running[it.kind] && it.kind !== 'review').map((it) => it.kind);

  return (
    <div className="col">
      <div className="card after-head">
        <div className="row between wrap">
          <div>
            <h2>설교 후 자료 <span className="muted small">{made}/{ITEMS.length} 만듦</span></h2>
            <p className="muted small">예배 정보 탭의 설교 원고({st.notesChars.toLocaleString('ko-KR')}자)로 만들고, 이 예배 기록에 보관합니다.</p>
          </div>
          <div className="row wrap">
            {sample ? <span className="pill info">예제 · AI를 부르지 않음</span>
              : st.ai.provider ? <span className="pill done">AI 연결됨</span>
              : <span className="pill warn">AI 연결 안 됨</span>}
            {!sample && subs.length > 1 && (
              <select value={provider || st.ai.provider || ''} onChange={(e) => setProvider(e.target.value)} aria-label="사용할 AI">
                {subs.map((p) => <option key={p} value={p}>{AI_NAME[p]}</option>)}
              </select>
            )}
            {ready && left.length > 0 && <button className="primary" onClick={() => makeAll(left)}>남은 {left.length}가지 한꺼번에 만들기</button>}
          </div>
        </div>
        {!sample && !st.ai.provider && (
          <div className="alert warn">
            연결된 AI가 없습니다. 터미널(윈도우는 PowerShell)에서 <code>claude</code>(Claude 구독) 또는 <code>codex login</code>(ChatGPT 구독)으로 로그인하거나, <a href="/settings#ai-connect">설정 &gt; AI 연결</a>에서 제미나이 API 키를 넣은 뒤
            <button className="link" onClick={() => load(true)}>다시 확인</button>을 눌러 주세요.
          </div>
        )}
        {!enough && (
          <div className="alert warn">
            설교 원고가 {st.notesChars}자입니다. 요지만으로는 내용을 지어내기 쉬워서 {st.minNotes}자 이상 원고가 있어야 만듭니다.
            <button className="link" onClick={onGoInfo}>예배 정보 탭에서 원고 넣기</button>
          </div>
        )}
        {err && <p className="alert err">{err}</p>}
        {!sample && st.ai.provider && <p className="muted small">하나에 2~5분, {(provider || st.ai.provider) === 'gemini' ? '제미나이 API 무료 사용량을 씁니다(한도를 넘으면 잠시 뒤 다시).' : '구독 사용량을 씁니다(추가 요금 없음).'} 한꺼번에 누르면 두 개씩 차례로 만들고(설교 점검은 빼고), 그동안 다른 화면으로 가도 됩니다.</p>}
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} className="card after-list">
          <h3>{g.title}{g.note && <span className="muted small"> · {g.note}</span>}</h3>
          <ul>
            {g.items.map((it) => (
              <AfterRow key={it.kind} it={it} root={root} doc={st.docs[it.kind]} job={st.running[it.kind]} fail={st.errors[it.kind]} now={now} ready={ready} onMake={() => make(it.kind)} />
            ))}
            {g.title === '목회자용' && <ShortsRow url={week.sermonVideoUrl} copied={copied} onCopy={copyUrl} onGoInfo={onGoInfo} />}
          </ul>
        </div>
      ))}
      <p className="muted small">AI가 만든 자료는 꼭 한 번 읽어 보고 나눠 주세요. 성경 구절·인용·예화가 원고와 같은지 확인이 필요합니다.</p>
    </div>
  );
}

// 설교 쇼츠는 따로 설치한 '설교 쇼츠 제작' 프로그램이 영상에서 직접 구간을 찾아 자막까지 넣어 만든다 (여기서는 주소를 넘겨주고 열기만)
function ShortsRow({ url, copied, onCopy, onGoInfo }: { url: string; copied: string; onCopy: () => void; onGoInfo: () => void }) {
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const open = async () => {
    setErr(''); setInfo('');
    if (url) onCopy();
    const w = window.open('about:blank', '_blank');
    try {
      const r = await api<{ url: string; message?: string }>('/api/apps/shorts/start', { method: 'POST' });
      if (!r.url) { w?.close(); setInfo(r.message || ''); }
      else if (w) w.location.href = r.url; else window.open(r.url, '_blank');
    } catch (e: any) { w?.close(); setErr(e.message); }
  };
  return (
    <li className="after-row">
      <span className="after-ico" aria-hidden>🎬</span>
      <div className="after-main">
        <div className="after-title"><b>설교 쇼츠 영상</b><span className="muted small">설교 쇼츠 제작 프로그램</span></div>
        <div className="muted small">{url ? <>설교 영상 <code>{url}</code></> : <>예배 정보 탭에 설교 영상 주소(유튜브)를 넣어 두면 열 때 주소가 복사됩니다 · <button className="link" onClick={onGoInfo}>주소 넣기</button></>}</div>
        {copied && <p className="ok-text small">{copied} — 쇼츠 제작 화면에 붙여 넣으세요.</p>}
        {err && <p className="alert err small">{err}</p>}
        {info && <p className="alert info small">{info}</p>}
      </div>
      <div className="after-act">
        <button className="primary-btn" onClick={open}>{url ? '주소 복사하고 열기' : '열기'}</button>
      </div>
    </li>
  );
}

// 자료 한 줄: 아이콘 · 이름·상태 · 설명 | 오른쪽에 같은 자리의 단추들. 글 자료는 '복사'와 '미리 보기'.
function AfterRow({ it, root, doc, job, fail, now, ready, onMake, children }: { it: Item; root: string; doc?: Doc; job?: Job; fail?: { message: string }; now: number; ready: boolean; onMake: () => void; children?: React.ReactNode }) {
  const view = `${root}/${it.kind}/view`;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (doc && !it.html) api<{ content: string }>(`${root}/${it.kind}`).then((d) => setText(d.content)).catch(() => setText('')); }, [root, it, doc?.at]);
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
  const what = it.copy || '글';
  return (
    <li className={`after-row${doc ? ' made' : ''}`}>
      <span className="after-ico" aria-hidden>{it.icon}</span>
      <div className="after-main">
        <div className="after-title">
          <b>{it.title}</b>
          {job ? <span className="pill info">{job.waiting ? '차례 기다리는 중' : `만드는 중 ${mmss(Math.max(0, Math.round((now - job.startedAt) / 1000)))}`}</span>
            : doc ? <span className="after-when" title={`${doc.via} · ${doc.basis}`}>✓ {fmtTime(doc.at)}{doc.sample ? ' (예제)' : ''}</span> : null}
        </div>
        <div className="muted small">{it.desc}</div>
        {fail && !job && <p className="alert err small">{fail.message}</p>}
        {msg && <p className="ok-text small">{msg}</p>}
      </div>
      <div className="after-act">
        {doc && it.html && <a className="btn primary-btn" href={view} target="_blank" rel="noopener">{it.kind === 'cards' ? '카드 보기' : '열기'}</a>}
        {doc && !it.html && text && <button className="primary-btn" onClick={() => copy(plain, what)}>{what} 복사</button>}
        {doc && !it.html && text && <button onClick={() => setOpen(!open)}>{open ? '접기' : '보기'}</button>}
        {doc && <a className="btn" href={`${view}?download=1`} title="파일로 받기">받기</a>}
        <button className={doc ? 'quiet' : 'primary'} disabled={!!job || !ready} onClick={onMake}>{doc ? '다시 만들기' : '만들기'}</button>
      </div>
      {open && text && (
        <div className="after-extra">
          <div className="blog-preview">{renderMd(text)}</div>
          {it.kind === 'blog' && <button className="link small" onClick={() => copy(text, '마크다운')}>마크다운으로 복사</button>}
        </div>
      )}
      {children}
    </li>
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
const AI_NAME = { claude: 'Claude 구독', codex: 'ChatGPT 구독', gemini: '제미나이 API 키' } as const;

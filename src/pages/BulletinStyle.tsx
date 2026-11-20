// 주보 꾸미기: 주보의 겉모양(글꼴·색·제목 꾸밈·선)만 고른다. 내용·칸 배치·분량 재기는 그대로.
// - 기본 스타일(기본·따뜻한·고전적인·단정한) 중에서 고르거나
// - 연결된 AI(Claude·ChatGPT 구독, 제미나이 키)에 원하는 분위기를 글로 적어 새 스타일을 만든다 (분위기 설명만 보냄)
// - 저장하기 전에 미리보기로 비교하고, 마음에 들면 [이 스타일로 적용]. 좋은 스타일은 '내 스타일'로 저장해 둔다
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { useGuardedClose } from '../lib/guard';
import { api } from '../lib/api';
import type { Week } from '../lib/types';
import { Preview, type FitPart } from './BulletinEditor';

interface Theme { id: string; name: string; css: string }
interface StyleView { themes: Theme[]; theme: string; customCss: string; customName: string; myStyles: { name: string; css: string }[] }
interface Pick { key: string; label: string; theme: string; customCss: string; customName: string; kind: 'theme' | 'mine' | 'current' | 'new' }
type Fmt = 'print' | 'fold4' | 'mobile';
const FMTS: [Fmt, string][] = [['print', '2단 인쇄용'], ['fold4', '접는 4면'], ['mobile', '휴대폰']];
const MAX_MINE = 8;
// 스타일 이름 앞의 색 점: 그 스타일의 강조색(--a)
const dot = (css: string) => (css.match(/--a:\s*(#[0-9a-fA-F]{3,6})/) || [])[1] || '#2f5d50';

export default function BulletinStyle({ week, onClose }: { week: Week; onClose: () => void }) {
  const { base, ws } = useApp();
  // AI로 만들었지만 적용·저장하지 않은 스타일이 있으면 닫을 때 한 번 묻는다
  const unsaved = useRef(false);
  const g = useGuardedClose(onClose, useCallback(() => unsaved.current, []));
  const [v, setV] = useState<StyleView | null>(null);
  const [sel, setSel] = useState<Pick | null>(null);
  const [made, setMade] = useState<Pick | null>(null);
  const [desc, setDesc] = useState('');
  const [fromCur, setFromCur] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fmt, setFmt] = useState<Fmt>('print');
  const [tok, setTok] = useState('');
  const [fit, setFit] = useState<FitPart[] | null>(null);
  const [edit, setEdit] = useState('');

  const load = useCallback(() => api<StyleView>(`${base}/bulletin/style`).then((x) => { setV(x); return x; }), [base]);
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: e.message })); }, [load]);

  // 고를 수 있는 것들: 기본 스타일 · 지금 쓰는 AI 스타일 · 내 스타일 · 방금 만든 스타일
  const picks: Pick[] = [];
  if (v) {
    for (const t of v.themes) picks.push({ key: `t:${t.id}`, label: t.name, theme: t.id, customCss: '', customName: '', kind: 'theme' });
    const inMine = v.myStyles.some((m) => m.css === v.customCss);
    if (v.theme === 'custom' && v.customCss && !inMine) picks.push({ key: 'cur', label: v.customName || '지금 쓰는 스타일', theme: 'custom', customCss: v.customCss, customName: v.customName, kind: 'current' });
    v.myStyles.forEach((m, i) => picks.push({ key: `m:${i}`, label: m.name, theme: 'custom', customCss: m.css, customName: m.name, kind: 'mine' }));
    if (made) picks.push(made);
  }
  const isNow = (p: Pick) => !!v && (p.theme === 'custom' ? v.theme === 'custom' && v.customCss === p.customCss : v.theme === p.theme);
  // 처음 열면 지금 쓰는 스타일을 고른 상태로
  useEffect(() => { if (v && !sel) setSel(picks.find(isNow) || picks[0]); }, [v]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEdit(sel?.customCss || (sel ? v?.themes.find((t) => t.id === sel.theme)?.css || '' : '')); }, [sel?.key, made]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 고른 스타일로 미리보기 (저장하지 않음)
  useEffect(() => {
    if (!sel) return;
    let live = true;
    setFit(null);
    api<{ token: string }>(`${base}/bulletin/style/preview`, { method: 'POST', body: { theme: sel.theme, customCss: sel.customCss } })
      .then((r) => { if (live) setTok(r.token); }).catch((e) => setMsg({ ok: false, text: e.message }));
    return () => { live = false; };
  }, [base, sel]);

  const makeAi = async () => {
    setBusy('ai'); setMsg(null);
    try {
      const r = await api<{ css: string; name: string; dropped: number; via: string; sample?: boolean }>(`${base}/bulletin/style/ai`, { method: 'POST', body: { desc, base: fromCur && sel ? edit : '' } });
      const p: Pick = { key: `new:${Date.now()}`, label: `새로 만든 스타일: ${r.name}`, theme: 'custom', customCss: r.css, customName: r.name, kind: 'new' };
      setMade(p); setSel(p); unsaved.current = true;
      setMsg({ ok: true, text: `${r.via}${r.sample ? '' : '로'} 새 스타일 '${r.name}'을 만들었습니다. 아래 미리보기를 보고 마음에 들면 [이 스타일로 적용]을 누르세요.${r.dropped ? ` (주보 틀을 깨뜨릴 수 있는 설정 ${r.dropped}개는 뺐습니다)` : ''}` });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy('');
  };
  const apply = async () => {
    if (!sel) return;
    setBusy('apply'); setMsg(null);
    try {
      await api(`${base}/bulletin/style`, { method: 'PUT', body: { theme: sel.theme, customCss: sel.customCss, customName: sel.customName } });
      await load(); unsaved.current = false;
      setMsg({ ok: true, text: `'${sel.label.replace(/^새로 만든 스타일: /, '')}' 스타일을 주보에 적용했습니다. 이제 여는 주보가 모두 이 모양입니다. (확정해 둔 주보는 그대로)` });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy('');
  };
  const saveMine = async () => {
    if (!v || !sel?.customCss) return;
    if (v.myStyles.length >= MAX_MINE) { setMsg({ ok: false, text: `내 스타일은 ${MAX_MINE}개까지 저장할 수 있습니다. 쓰지 않는 것을 지운 뒤 저장해 주세요.` }); return; }
    const name = window.prompt('이 스타일의 이름', sel.customName || '내 스타일');
    if (name === null) return;
    setBusy('mine');
    try {
      const r = await api<StyleView>(`${base}/bulletin/style`, { method: 'PUT', body: { myStyles: [...v.myStyles, { name: name.trim() || '내 스타일', css: sel.customCss }] } });
      const x = await load();
      const i = r.myStyles.length - 1;
      setMade(null); unsaved.current = false;
      setSel({ key: `m:${i}`, label: x.myStyles[i].name, theme: 'custom', customCss: x.myStyles[i].css, customName: x.myStyles[i].name, kind: 'mine' });
      setMsg({ ok: true, text: `'내 스타일'에 저장했습니다. 언제든 다시 고를 수 있습니다.` });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy('');
  };
  const delMine = async (i: number) => {
    if (!v || !window.confirm(`내 스타일 '${v.myStyles[i].name}'을 지울까요? (지금 주보에 적용된 모양은 그대로입니다)`)) return;
    try { await api(`${base}/bulletin/style`, { method: 'PUT', body: { myStyles: v.myStyles.filter((_, j) => j !== i) } }); await load(); setSel(null); } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };
  // 직접 고친 CSS 로 미리보기 (서버가 걸러서 그림)
  const useEdit = () => {
    const p: Pick = { key: `new:${Date.now()}`, label: '새로 만든 스타일: 직접 고침', theme: 'custom', customCss: edit, customName: sel?.customName || '직접 고친 스타일', kind: 'new' };
    setMade(p); setSel(p);
  };

  const over = (fit || []).filter((p) => p.status === 'over');
  const src = tok ? `${base}/weeks/${week.id}/bulletin?format=${fmt}&look=${tok}` : '';
  return (
    <div className="dialog-back" onClick={g.close}>
      <div className="dialog wide bul-style" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label="주보 꾸미기">
        <h2>주보 꾸미기</h2>
        <p className="muted small">주보의 <b>겉모양</b>(글꼴·색·제목 꾸밈·선)만 바꿉니다. 내용·칸 배치·분량 표시·확정본은 그대로입니다. 미리보기를 보고 <b>이 스타일로 적용</b>을 눌러야 바뀝니다.</p>
        {!v ? <p className="muted">불러오는 중…</p> : (
          <>
            <div className="style-picks" role="radiogroup" aria-label="주보 스타일">
              {picks.map((p) => (
                <span key={p.key} className={`style-pick${sel?.key === p.key ? ' on' : ''}`}>
                  <button role="radio" aria-checked={sel?.key === p.key} onClick={() => setSel(p)}>
                    <span className="style-dot" aria-hidden style={{ background: dot(p.customCss || v.themes.find((t) => t.id === p.theme)?.css || '') }} />{p.label}{isNow(p) && <span className="pill done">적용 중</span>}
                  </button>
                  {p.kind === 'mine' && <button className="link small" aria-label={`내 스타일 ${p.label} 지우기`} onClick={() => delMine(+p.key.slice(2))}>✕</button>}
                </span>
              ))}
            </div>

            <fieldset className="style-ai">
              <legend>AI로 새 스타일 만들기</legend>
              <p className="muted small">원하는 분위기를 적으면 연결된 AI(설정 &gt; AI 연결)가 주보 꾸밈을 만들어 줍니다. AI에는 <b>이 설명만</b> 보내고 교회 자료·성도 이름은 보내지 않습니다.{ws === 'sample' && ' 예제 자료에서는 AI를 부르지 않고 예시 스타일을 보여 줍니다.'}</p>
              <textarea rows={2} value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} aria-label="원하는 주보 분위기" placeholder="예: 고풍스러운 명조체, 진한 초록과 금색, 제목 아래 가는 두 줄" />
              <div className="row wrap">
                <button className="primary" disabled={!!busy || desc.trim().length < 2} onClick={makeAi}>{busy === 'ai' ? 'AI가 만드는 중… (1분쯤 걸릴 수 있음)' : 'AI로 만들기'}</button>
                <label className="check small"><input type="checkbox" checked={fromCur} onChange={(e) => setFromCur(e.target.checked)} />고른 스타일을 바탕으로 고치기</label>
              </div>
            </fieldset>

            <div className="row wrap" style={{ margin: '10px 0 6px' }}>
              {FMTS.map(([k, t]) => <button key={k} className={`small${fmt === k ? ' primary' : ''}`} onClick={() => { setFit(null); setFmt(k); }}>{t}</button>)}
              <span className="grow" />
              {sel && sel.customCss && sel.kind !== 'mine' && <button className="small" disabled={!!busy} onClick={saveMine}>내 스타일로 저장</button>}
              <button className="primary" disabled={!!busy || !sel || isNow(sel)} onClick={apply}>{sel && isNow(sel) ? '적용 중인 스타일' : busy === 'apply' ? '적용하는 중…' : '이 스타일로 적용'}</button>
            </div>
            {msg && <p className={`alert small ${msg.ok ? 'info' : 'err'}`} role="status">{msg.text}</p>}
            {over.length > 0 && <p className="alert warn small" role="status">이 스타일로는 {over.map((p) => p.name).join('·')}이(가) 약 {Math.max(...over.map((p) => p.lines))}줄 넘칩니다. 글자가 큰 스타일이면 다른 스타일을 고르거나 설명에 "글자는 작게"를 넣어 다시 만들어 보세요.</p>}
            {src && <Preview key={src} src={src} onFit={setFit} />}

            <details className="style-css">
              <summary className="small">꾸밈 CSS 직접 보기·고치기 (잘 아는 분만)</summary>
              <p className="muted small">겉모양 설정(색·글꼴·테두리·안쪽 여백 등)만 받습니다. 자리·크기·숨김을 바꾸는 설정과 바깥 주소(url)는 빼고 적용합니다.</p>
              <textarea rows={8} value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="꾸밈 CSS" spellCheck={false} />
              <button className="small" onClick={useEdit} disabled={!edit.trim()}>이 CSS로 미리보기</button>
            </details>
          </>
        )}
        <div className="row end"><button onClick={g.close}>닫기</button></div>
      </div>
    </div>
  );
}

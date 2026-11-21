// 주보 편집 창: 왼쪽에서 칸 배치(교회 전체에 한 번)와 이번 주 글 고치기, 오른쪽에서 주보 미리보기
// - 배치(순서·켜기/끄기·2단 왼쪽/오른쪽·4면 몇 면)는 매주 그대로 쓴다
// - 글 고치기·글자 작게는 이 예배 주보에만 저장되고, 원래 자료(예배 순서·광고·봉사표)는 바꾸지 않는다
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { Week } from '../lib/types';
import { UNSAVED_MSG, useGuardedClose } from '../lib/guard';
import { shrinkImage } from '../lib/image';

export type BlockSize = 's' | 'n' | 'l' | 'xl';
export interface LayoutItem { id: string; on: boolean; col: 'L' | 'R'; face: 2 | 3 | 4; size: BlockSize }
const SIZE_NAMES: [BlockSize, string][] = [['s', '작게'], ['n', '보통'], ['l', '크게'], ['xl', '아주 크게']];
interface Rect { x: number; y: number; w: number; h: number }
interface Block { id: string; title: string; locked: boolean; auto: string; text: string | null; size: 'n' | 's'; img?: string | null }
interface Settings { layout: LayoutItem[]; [k: string]: any }
type Fmt = 'print' | 'fold4';
/** 주보 화면이 재서 알려 주는 단·면마다의 분량 (server/bulletin.mjs 의 fitScript) */
export interface FitPart { name: string; key: string; pct: number | null; status: 'ok' | 'near' | 'over'; lines: number; cut: string[] }

export default function BulletinEditor({ week, onClose }: { week: Week; onClose: () => void }) {
  const { base } = useApp();
  const [s, setS] = useState<Settings | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [fmt, setFmt] = useState<Fmt>('print');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0);
  const path = `${base}/weeks/${week.id}/bulletin/blocks`;
  const show = (r: { settings: Settings; blocks: Block[] }) => { setS(r.settings); setBlocks(r.blocks); setTick((t) => t + 1); };
  const load = useCallback(() => api<{ settings: Settings; blocks: Block[] }>(path).then(show).catch((e) => setErr(e.message)), [path]);
  useEffect(() => { load(); }, [load]);

  // 저장하지 않은 글: 이 컴퓨터에 임시로 두었다가, 창을 다시 열면 되살린다
  const draftKey = `bulletin-draft:${base}:${week.id}`;
  const dirtyNow = () => { if (!editing) return false; const b = blocks.find((x) => x.id === editing); return !!b && draft !== (b.text ?? b.auto); };
  const keepDraft = (id: string, text: string) => { try { localStorage.setItem(draftKey, JSON.stringify({ id, text })); } catch { /* 무시 */ } };
  const dropDraft = () => { try { localStorage.removeItem(draftKey); } catch { /* 무시 */ } };
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !blocks.length) return;
    restored.current = true;
    let d: { id: string; text: string } | null = null;
    try { d = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { /* 무시 */ }
    const b = d && blocks.find((x) => x.id === d!.id && !x.locked);
    if (d && b && d.text !== (b.text ?? b.auto)) { setEditing(b.id); setDraft(d.text); setMsg(`저장하지 않았던 ‘${b.title}’ 입력을 되살렸습니다. [이번 주에 저장]을 눌러야 주보에 들어갑니다.`); }
    else dropDraft();
  }, [blocks]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = useGuardedClose(() => { dropDraft(); onClose(); }, dirtyNow);
  const [inline, setInline] = useState<{ id: string; rect: Rect } | null>(null);   // 미리보기에서 눌러 고치는 칸
  const openEdit = (b: Block) => {
    if (dirtyNow() && !window.confirm(UNSAVED_MSG)) return false;
    setInline(null);
    if (editing === b.id) { setEditing(null); dropDraft(); return false; }
    setEditing(b.id); setDraft(b.text ?? b.auto); dropDraft();
    return true;
  };
  const closeInline = () => {
    if (dirtyNow() && !window.confirm(UNSAVED_MSG)) return;
    setInline(null); setEditing(null); dropDraft();
  };
  const typeDraft = (id: string, text: string) => { setDraft(text); keepDraft(id, text); };

  // 분량: 미리보기 주보가 재서 알려 준다. 고치던 글(저장 전)이 있으면 그 글로 미리보기를 다시 그린다
  const [fit, setFit] = useState<FitPart[] | null>(null);
  const [tok, setTok] = useState('');
  const dirty = dirtyNow();
  useEffect(() => {
    if (!editing || !dirty || draft.length > MAX) { setTok(''); return; }
    const b = blocks.find((x) => x.id === editing);
    const t = setTimeout(() => {
      api<{ token: string }>(`${base}/weeks/${week.id}/bulletin/preview`, { method: 'POST', body: { id: editing, text: draft, size: b?.size, img: b?.img } })
        .then((r) => setTok(r.token)).catch(() => setTok(''));
    }, 600);
    return () => clearTimeout(t);
  }, [editing, draft, dirty, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFit(null); }, [fmt]);

  // 사진·포스터 칸: 크기를 줄여 올리고 이번 주 주보에 넣는다 (설명 글은 아래 글 칸)
  const [photoBusy, setPhotoBusy] = useState(false);
  const upPhoto = async (file: File) => {
    setPhotoBusy(true); setErr(''); setMsg('');
    try {
      const data = await shrinkImage(file, { maxSide: 1400, maxBytes: 600 * 1024 });
      const r = await api<{ id: string }>(`${base}/bulletin/images`, { method: 'POST', body: { data } });
      if (await saveBlock('photo', { img: r.id })) setMsg('사진을 이번 주 주보에 넣었습니다. 자리와 순서는 왼쪽 목록에서 바꿀 수 있습니다.');
    } catch (e: any) { setErr(e.message); }
    setPhotoBusy(false);
  };

  const saveLayout = async (layout: LayoutItem[]) => {
    if (!s) return;
    setErr(''); setMsg('');
    const flags = { showOrder: on(layout, 'order'), showSummary: on(layout, 'summary'), showServe: on(layout, 'serve'), showEvents: on(layout, 'events'), showBirthdays: on(layout, 'births') };
    try { await api(`${base}/bulletin`, { method: 'PUT', body: { ...s, ...flags, layout } }); await load(); setMsg('배치를 저장했습니다. 다음 주에도 이 배치를 씁니다.'); }
    catch (e: any) { setErr(e.message); }
  };
  const saveBlock = async (id: string, body: { text?: string | null; size?: 'n' | 's'; img?: string | null }) => {
    setErr(''); setMsg('');
    const b = blocks.find((x) => x.id === id)!;
    const next = { id, text: body.text !== undefined ? body.text : b.text, size: body.size || b.size, img: body.img !== undefined ? body.img : b.img };
    try { show(await api(path, { method: 'PUT', body: next })); setMsg(next.text === null && body.text === null ? `‘${b.title}’을 자동 내용으로 되돌렸습니다.` : `‘${b.title}’을 이 예배 주보에 저장했습니다.`); return true; }
    catch (e: any) { setErr(e.message); return false; }
  };

  if (!s) return <Dialog onClose={g.close}><p className="muted">{err || '불러오는 중…'}</p></Dialog>;
  const layout = s.layout;
  const cutIds = new Set((fit || []).flatMap((p) => p.cut));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= layout.length) return; const n = [...layout]; [n[i], n[j]] = [n[j], n[i]]; saveLayout(n); };
  const patch = (id: string, p: Partial<LayoutItem>) => saveLayout(layout.map((x) => (x.id === id ? { ...x, ...p } : x)));
  // 미리보기에서 칸을 끌어 놓음: 그 단(2단)·면(4면)의 before 칸 앞으로, before 가 없으면 그 자리 맨 끝으로
  const moveTo = (id: string, place: unknown, before: string | null) => {
    const key = fmt === 'print' ? 'col' : 'face';
    const ok = fmt === 'print' ? place === 'L' || place === 'R' : [2, 3, 4].includes(place as number);
    const it = layout.find((x) => x.id === id);
    if (!it || !ok || before === id) return;
    const n = layout.filter((x) => x.id !== id);
    let i = before ? n.findIndex((x) => x.id === before) : -1;
    if (i < 0) { let last = -1; n.forEach((x, j) => { if (x.on && x[key] === place) last = j; }); i = last < 0 ? n.length : last + 1; }
    n.splice(i, 0, { ...it, [key]: place });
    if (n.every((x, j) => x.id === layout[j].id && x[key] === layout[j][key])) return;
    saveLayout(n);
  };
  const onPreviewMsg = (m: any) => {
    if (m?.type === 'bulletin-move' && typeof m.id === 'string') moveTo(m.id, m.place, typeof m.before === 'string' ? m.before : null);
    if (m?.type === 'bulletin-pick' && typeof m.id === 'string') {
      const b = blocks.find((x) => x.id === m.id);
      if (!b) return;
      if (b.locked) { setErr(`‘${b.title}’ 칸은 잠금 중이라 고칠 수 없습니다.`); return; }
      if (editing === b.id && inline?.id === b.id) return;
      if (editing !== b.id && !openEdit(b)) return;
      if (b.id === 'photo') { document.querySelector('.bul-blocks .bul-text')?.scrollIntoView({ block: 'nearest' }); return; }   // 사진은 왼쪽에서 파일을 고른다
      const r = m.rect || {};
      setInline({ id: b.id, rect: { x: +r.x || 0, y: +r.y || 0, w: +r.w || 300, h: +r.h || 0 } });
    }
  };
  const inlineBlock = inline && editing === inline.id ? blocks.find((x) => x.id === inline.id) : undefined;
  const inlineItem = inlineBlock && layout.find((x) => x.id === inlineBlock.id);
  const overlay = inline && inlineBlock && inlineItem ? (k: number, boxW: number, boxH: number) => {
    const w = Math.min(boxW - 8, Math.max(320, inline.rect.w * k));
    const left = Math.max(4, Math.min(inline.rect.x * k, boxW - w - 4));
    const top = Math.max(4, Math.min(inline.rect.y * k, boxH - 290));
    const b = inlineBlock;
    return (
      <div className="bul-inline" style={{ left, top, width: w }} role="group" aria-label={`${b.title} 바로 고치기`}>
        <div className="row" style={{ alignItems: 'center', gap: 6 }}>
          <b className="grow">{b.title}</b>
          <select aria-label={`${b.title} 글자 크기 (미리보기)`} value={inlineItem.size} onChange={(e) => patch(b.id, { size: e.target.value as BlockSize })}>{SIZE_NAMES.map(([v, t]) => <option key={v} value={v}>글자 {t}</option>)}</select>
        </div>
        <textarea autoFocus rows={Math.min(10, Math.max(3, (draft.match(/\n/g)?.length || 0) + 2))} value={draft} onChange={(e) => typeDraft(b.id, e.target.value)} aria-label={`${b.title} 바로 고치기 글`} />
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="muted small grow">{draft.length > MAX ? '너무 깁니다' : '이 예배 주보에만 저장'}</span>
          <button className="small" onClick={closeInline}>취소</button>
          {b.text !== null && <button className="small" onClick={async () => { if (await saveBlock(b.id, { text: null })) { setDraft(b.auto); dropDraft(); } }}>자동 내용으로</button>}
          <button className="small primary" disabled={draft.length > MAX} onClick={async () => { if (await saveBlock(b.id, { text: draft })) { setEditing(null); setInline(null); dropDraft(); } }}>저장</button>
        </div>
      </div>
    );
  } : undefined;

  return (
    <Dialog onClose={g.close}>
      <div className="row wrap" style={{ alignItems: 'center' }}>
        <h2 className="grow" style={{ margin: 0 }}>주보 편집 · {week.date}</h2>
        <div className="ws-toggle" role="group" aria-label="주보 모양">
          <button className={fmt === 'print' ? 'on' : ''} onClick={() => setFmt('print')}>2단 인쇄용</button>
          <button className={fmt === 'fold4' ? 'on' : ''} onClick={() => setFmt('fold4')}>접는 4면</button>
        </div>
        <button onClick={g.close}>닫기</button>
      </div>
      <p className="muted small">칸의 <b>순서·켜기/끄기·자리</b>는 교회 주보 배치로 저장되어 매주 그대로 씁니다. <b>글 고치기</b>와 <b>글자 작게</b>는 이 예배 주보에만 저장되고, 예배 순서·광고·봉사표 같은 원래 자료는 바뀌지 않습니다. 표지(교회 이름·날짜)는 늘 맨 위{fmt === 'fold4' ? '(1면)' : ''}에 있습니다.</p>
      {err && <p className="alert err small">{err}</p>}
      {msg && <p className="alert info small" role="status">{msg}</p>}
      <div className="bul-edit">
        <ol className="bul-blocks">
          {layout.map((it, i) => {
            const b = blocks.find((x) => x.id === it.id);
            if (!b) return null;
            const changed = b.text !== null;
            return (
              <li key={it.id} className={it.on ? '' : 'off'}>
                <div className="row wrap" style={{ alignItems: 'center', gap: 6 }}>
                  <label className="check grow"><input type="checkbox" checked={it.on} onChange={(e) => patch(it.id, { on: e.target.checked })} /><b>{b.title}</b>
                    {changed && <span className="pill todo">이번 주 고침</span>}{b.size === 's' && <span className="pill info">작게</span>}{b.locked && <span className="pill">🔒 잠김</span>}{it.on && cutIds.has(it.id) && <span className="pill warn">잘림</span>}</label>
                  <button className="small" title="위로" aria-label={`${b.title} 위로`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="small" title="아래로" aria-label={`${b.title} 아래로`} disabled={i === layout.length - 1} onClick={() => move(i, 1)}>↓</button>
                  {fmt === 'print'
                    ? <select aria-label={`${b.title} 자리`} value={it.col} onChange={(e) => patch(it.id, { col: e.target.value as 'L' | 'R' })}><option value="L">왼쪽</option><option value="R">오른쪽</option></select>
                    : <select aria-label={`${b.title} 면`} value={it.face} onChange={(e) => patch(it.id, { face: +e.target.value as 2 | 3 | 4 })}><option value={2}>2면</option><option value={3}>3면</option><option value={4}>4면(뒷면)</option></select>}
                  <select aria-label={`${b.title} 글자 크기`} title="이 칸의 글자 크기 (매주 그대로)" value={it.size} onChange={(e) => patch(it.id, { size: e.target.value as BlockSize })}>{SIZE_NAMES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                  <button className="small" disabled={b.locked} onClick={() => openEdit(b)}>{it.id === 'photo' ? '사진 넣기' : '글 고치기'}</button>
                </div>
                {editing === it.id && inline?.id === it.id && <p className="muted small" style={{ margin: '4px 0 0' }}>미리보기에서 고치는 중입니다.</p>}
                {editing === it.id && inline?.id !== it.id && (
                  <div className="bul-text">
                    {it.id === 'photo' && (
                      <div className="bul-photo">
                        {b.img ? <img src={`${base}/bulletin/images/${b.img}`} alt="이번 주 사진" /> : <p className="muted small">교회 행사 사진이나 포스터를 한 장 넣을 수 있습니다. 크기를 줄여 저장합니다.</p>}
                        <div className="row wrap">
                          <label className="btn small">{photoBusy ? '줄이는 중…' : b.img ? '사진 바꾸기' : '사진 고르기'}<input type="file" hidden accept="image/*" aria-label="주보 사진 파일" disabled={photoBusy} onChange={(e) => { const x = e.target.files?.[0]; if (x) upPhoto(x); e.target.value = ''; }} /></label>
                          {b.img && <button className="small" onClick={async () => { if (await saveBlock('photo', { img: null })) setMsg('사진을 뺐습니다.'); }}>사진 빼기</button>}
                        </div>
                        <p className="muted small">아래는 사진 설명입니다 (비워도 됩니다).</p>
                      </div>
                    )}
                    <textarea rows={Math.min(12, Math.max(3, (draft.match(/\n/g)?.length || 0) + 2))} value={draft} onChange={(e) => typeDraft(it.id, e.target.value)} aria-label={it.id === 'photo' ? '사진 설명' : `${b.title} 이번 주 글`} />
                    <p className="muted small">{['order', 'ann', 'events', 'sermon', 'info'].includes(it.id) ? '한 줄에 한 항목입니다. ' : ''}{it.id === 'photo' ? '' : '비워 두고 저장하면 이번 주에는 이 칸을 넣지 않습니다.'}
                      <span className={draft.length > MAX ? 'warn-text' : ''}> · {draft.length.toLocaleString()} / {MAX.toLocaleString()}자{draft.length > MAX ? ' (너무 깁니다)' : ''}</span></p>
                    <div className="row wrap">
                      <label className="check"><input type="checkbox" checked={b.size === 's'} onChange={(e) => saveBlock(it.id, { size: e.target.checked ? 's' : 'n' })} />이번 주 글자 작게</label>
                      <span className="grow" />
                      {changed && <button onClick={async () => { if (await saveBlock(it.id, { text: null })) { setDraft(b.auto); dropDraft(); } }}>자동 내용으로 되돌리기</button>}
                      <button className="primary" disabled={draft.length > MAX} onClick={async () => { if (await saveBlock(it.id, { text: draft })) { setEditing(null); dropDraft(); } }}>이번 주에 저장</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <div className="bul-right">
          <FitBar fit={fit} fmt={fmt} draft={!!tok} />
          <p className="muted small bul-hint">미리보기에서 칸을 <b>끌어</b> 다른 {fmt === 'print' ? '단' : '면'}이나 다른 칸 앞으로 옮기고, 칸을 <b>누르면</b> 그 자리에서 글을 고칩니다.</p>
          <Preview src={`${base}/weeks/${week.id}/bulletin?format=${fmt}&v=${tick}${tok ? `&preview=${tok}` : ''}&edit=1`} onFit={setFit} onMessage={onPreviewMsg} overlay={overlay} />
        </div>
      </div>
    </Dialog>
  );
}
const MAX = 10000;   // server/bulletin.mjs 의 WEEK_BLOCK_MAX 와 같게
const on = (l: LayoutItem[], id: string) => !!l.find((x) => x.id === id)?.on;

function Dialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog full" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label="주보 편집">{children}</div>
    </div>
  );
}

// 단·면마다 얼마나 찼는지: 여유 있음 / 거의 참 / 넘침(약 몇 줄, 어느 칸이 잘리는지)
function FitBar({ fit, fmt, draft }: { fit: FitPart[] | null; fmt: Fmt; draft: boolean }) {
  if (!fit) return <p className="muted small bul-fit">분량을 재는 중…</p>;
  const title = (id: string) => TITLES[id] || id;
  const over = fit.filter((p) => p.status === 'over');
  return (
    <div className="bul-fit" role="status" aria-label="주보 분량">
      {draft && <p className="small" style={{ color: "var(--info)", margin: "0 0 4px" }}>저장하지 않은 글로 그린 미리보기입니다. [이번 주에 저장]을 눌러야 주보에 들어갑니다.</p>}
      <ul>
        {fit.map((p) => (
          <li key={p.key} className={`fit-${p.status}`}>
            <b>{p.name}</b>
            {p.pct !== null && <span className="fit-meter" aria-hidden><span style={{ width: `${Math.min(100, p.pct)}%` }} /></span>}
            <span>{p.status === 'over' ? `넘침 · 약 ${p.lines}줄${p.cut.length ? ` (‘${p.cut.map(title).join('’·‘')}’ 잘림)` : ''}` : p.status === 'near' ? `거의 참${p.pct !== null ? ` · ${p.pct}%` : ''}` : `여유 있음${p.pct !== null ? ` · ${p.pct}%` : ''}`}</span>
          </li>
        ))}
      </ul>
      {over.length > 0 && <p className="small warn-text">줄이는 방법: 잘리는 칸을 {fmt === 'print' ? '덜 찬 단' : '덜 찬 면'}으로 옮기기 · 글 줄이기 · ‘이번 주 글자 작게’. 글자를 더 작게는 하지 않습니다(읽기 어려워짐).</p>}
    </div>
  );
}
const TITLES: Record<string, string> = { order: '예배 순서', sermon: '오늘의 말씀', summary: '설교 요약', ann: '교회 소식', photo: '사진·포스터', serve: '섬기는 분들', events: '다음 주 일정', births: '생일을 축하합니다', info: '교회 안내' };

// A4 가로 주보(약 1100px 폭)를 칸 폭에 맞게 줄여 보여 준다. 주보가 잰 분량은 onFit 으로 받는다
// onMessage: 편집용 미리보기(edit=1)가 보내는 끌어 옮기기·눌러 고치기 알림. overlay: 미리보기 위에 띄울 것 (배율 k, 상자 폭·높이)
export function Preview({ src, onFit, onMessage, overlay }: { src: string; onFit: (f: FitPart[]) => void; onMessage?: (m: any) => void; overlay?: (k: number, w: number, h: number) => React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const msgRef = useRef(onMessage);
  msgRef.current = onMessage;
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if (e.data?.type !== 'bulletin-fit') { msgRef.current?.(e.data); return; }
      onFit(e.data.parts);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [onFit]);
  const [k, setK] = useState(0.5);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setK(Math.min(1, el.clientWidth / 1120));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="bul-preview" ref={box} style={{ height: 1700 * k }}>
      <iframe ref={frame} title="주보 미리보기" src={src} style={{ width: 1120, height: 1700, transform: `scale(${k})` }} />
      {overlay?.(k, 1120 * k, 1700 * k)}
    </div>
  );
}

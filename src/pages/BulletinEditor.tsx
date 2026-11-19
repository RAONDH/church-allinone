// 주보 편집 창: 왼쪽에서 칸 배치(교회 전체에 한 번)와 이번 주 글 고치기, 오른쪽에서 주보 미리보기
// - 배치(순서·켜기/끄기·2단 왼쪽/오른쪽·4면 몇 면)는 매주 그대로 쓴다
// - 글 고치기·글자 작게는 이 예배 주보에만 저장되고, 원래 자료(예배 순서·광고·봉사표)는 바꾸지 않는다
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { Week } from '../lib/types';

export interface LayoutItem { id: string; on: boolean; col: 'L' | 'R'; face: 2 | 3 | 4; size: 'n' | 's' }
interface Block { id: string; title: string; locked: boolean; auto: string; text: string | null; size: 'n' | 's' }
interface Settings { layout: LayoutItem[]; [k: string]: any }
type Fmt = 'print' | 'fold4';

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

  const saveLayout = async (layout: LayoutItem[]) => {
    if (!s) return;
    setErr(''); setMsg('');
    const flags = { showOrder: on(layout, 'order'), showSummary: on(layout, 'summary'), showServe: on(layout, 'serve'), showEvents: on(layout, 'events'), showBirthdays: on(layout, 'births') };
    try { await api(`${base}/bulletin`, { method: 'PUT', body: { ...s, ...flags, layout } }); await load(); setMsg('배치를 저장했습니다. 다음 주에도 이 배치를 씁니다.'); }
    catch (e: any) { setErr(e.message); }
  };
  const saveBlock = async (id: string, body: { text?: string | null; size?: 'n' | 's' }) => {
    setErr(''); setMsg('');
    const b = blocks.find((x) => x.id === id)!;
    const next = { id, text: body.text !== undefined ? body.text : b.text, size: body.size || b.size };
    try { show(await api(path, { method: 'PUT', body: next })); setMsg(next.text === null && body.text === null ? `‘${b.title}’을 자동 내용으로 되돌렸습니다.` : `‘${b.title}’을 이 예배 주보에 저장했습니다.`); return true; }
    catch (e: any) { setErr(e.message); return false; }
  };

  if (!s) return <Dialog onClose={onClose}><p className="muted">{err || '불러오는 중…'}</p></Dialog>;
  const layout = s.layout;
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= layout.length) return; const n = [...layout]; [n[i], n[j]] = [n[j], n[i]]; saveLayout(n); };
  const patch = (id: string, p: Partial<LayoutItem>) => saveLayout(layout.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <Dialog onClose={onClose}>
      <div className="row wrap" style={{ alignItems: 'center' }}>
        <h2 className="grow" style={{ margin: 0 }}>주보 편집 · {week.date}</h2>
        <div className="ws-toggle" role="group" aria-label="주보 모양">
          <button className={fmt === 'print' ? 'on' : ''} onClick={() => setFmt('print')}>2단 인쇄용</button>
          <button className={fmt === 'fold4' ? 'on' : ''} onClick={() => setFmt('fold4')}>접는 4면</button>
        </div>
        <button onClick={onClose}>닫기</button>
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
                    {changed && <span className="pill todo">이번 주 고침</span>}{b.size === 's' && <span className="pill info">작게</span>}{b.locked && <span className="pill">🔒 잠김</span>}</label>
                  <button className="small" title="위로" aria-label={`${b.title} 위로`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="small" title="아래로" aria-label={`${b.title} 아래로`} disabled={i === layout.length - 1} onClick={() => move(i, 1)}>↓</button>
                  {fmt === 'print'
                    ? <select aria-label={`${b.title} 자리`} value={it.col} onChange={(e) => patch(it.id, { col: e.target.value as 'L' | 'R' })}><option value="L">왼쪽</option><option value="R">오른쪽</option></select>
                    : <select aria-label={`${b.title} 면`} value={it.face} onChange={(e) => patch(it.id, { face: +e.target.value as 2 | 3 | 4 })}><option value={2}>2면</option><option value={3}>3면</option><option value={4}>4면(뒷면)</option></select>}
                  <button className="small" disabled={b.locked} onClick={() => { setEditing(editing === it.id ? null : it.id); setDraft(b.text ?? b.auto); }}>글 고치기</button>
                </div>
                {editing === it.id && (
                  <div className="bul-text">
                    <textarea rows={Math.min(12, Math.max(3, (draft.match(/\n/g)?.length || 0) + 2))} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`${b.title} 이번 주 글`} />
                    <p className="muted small">{['order', 'ann', 'events', 'sermon', 'info'].includes(it.id) ? '한 줄에 한 항목입니다. ' : ''}비워 두고 저장하면 이번 주에는 이 칸을 넣지 않습니다.</p>
                    <div className="row wrap">
                      <label className="check"><input type="checkbox" checked={b.size === 's'} onChange={(e) => saveBlock(it.id, { size: e.target.checked ? 's' : 'n' })} />이번 주 글자 작게</label>
                      <span className="grow" />
                      {changed && <button onClick={async () => { if (await saveBlock(it.id, { text: null })) setDraft(b.auto); }}>자동 내용으로 되돌리기</button>}
                      <button className="primary" onClick={async () => { if (await saveBlock(it.id, { text: draft })) setEditing(null); }}>이번 주에 저장</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <Preview src={`${base}/weeks/${week.id}/bulletin?format=${fmt}&v=${tick}`} />
      </div>
    </Dialog>
  );
}
const on = (l: LayoutItem[], id: string) => !!l.find((x) => x.id === id)?.on;

function Dialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog full" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label="주보 편집">{children}</div>
    </div>
  );
}

// A4 가로 주보(약 1100px 폭)를 칸 폭에 맞게 줄여 보여 준다
function Preview({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
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
      <iframe title="주보 미리보기" src={src} style={{ width: 1120, height: 1700, transform: `scale(${k})` }} />
    </div>
  );
}

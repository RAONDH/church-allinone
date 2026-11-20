// 자료 파일이 깨졌을 때 나오는 복구 화면 (실제 교회 자료만)
// - 서버는 깨진 파일을 real.json.broken-… 으로 보관하고, 복구할 때까지 저장을 멈춘다
// - 여기서 멀쩡한 백업(이 컴퓨터 자동 백업·바깥 백업 폴더·받아 둔 백업 파일)을 골라 되살린다
// - 백업이 하나도 없을 때만 '빈 자료로 새로 시작'을 고를 수 있게 한다 (확인 글자를 넣어야 함)
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtTime } from '../lib/week';
import { kb, label } from './BackupCard';

interface Broken { kept: string; error: string; at: number; size: number }
interface Cand { source: 'local' | 'external'; file: string; at: number; size: number; ok: boolean; error?: string; church?: string; weeks?: number; members?: number; tx?: number }
interface View { broken: Broken | null; list: Cand[]; externalDir?: string }

const name = (c: Cand) => {
  const m = c.file.match(/^real-(\d{4})-(\d{2})-(\d{2})\.json$/);
  if (c.source === 'external' && m) return `${+m[2]}월 ${+m[3]}일 바깥 백업`;
  return label(c.file);
};

export default function Recovery({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [word, setWord] = useState('');
  const load = useCallback(() => api<View>('/api/recovery').then((x) => { setV(x); if (!x.broken) onDone(); }).catch((e) => setErr(e.message)), [onDone]);
  useEffect(() => { load(); }, [load]);

  const finish = (r: { church?: string; weeks?: number; members?: number; tx?: number }) => {
    setMsg(`되살렸습니다: ${r.church || '(교회 이름 없음)'} · 예배 ${r.weeks ?? 0} · 성도 ${r.members ?? 0} · 장부 ${r.tx ?? 0}건. 화면을 엽니다…`);
    setTimeout(onDone, 1200);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); } catch (e: any) { setErr(e.message); load(); }
    setBusy(false);
  };
  const restore = (c: Cand) => {
    if (!window.confirm(`${name(c)}(${fmtTime(c.at)})로 되살릴까요?\n그 뒤에 입력한 내용은 들어 있지 않습니다. 깨진 파일은 지우지 않고 그대로 보관합니다.`)) return;
    run(async () => finish(await api('/api/recovery/restore', { method: 'POST', body: { source: c.source, file: c.file } })));
  };
  const restoreFile = (file: File) => {
    if (!window.confirm(`"${file.name}"로 되살릴까요?`)) return;
    run(async () => {
      const r = await fetch('/api/backup/restore', { method: 'POST', headers: { 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `되살리지 못했습니다 (${r.status})`);
      finish(j);
    });
  };
  const fresh = () => run(async () => { await api('/api/recovery/fresh', { method: 'POST', body: { confirm: word.trim() } }); onDone(); });

  if (!v) return <div className="card"><p className="muted">{err || '자료 상태를 확인하는 중…'}</p></div>;
  if (!v.broken) return null;
  const good = v.list.filter((c) => c.ok);
  const bad = v.list.filter((c) => !c.ok);
  return (
    <div className="card recovery" role="alert" aria-label="자료 복구">
      <h1>자료 파일을 읽지 못했습니다</h1>
      <p>우리 교회 자료 파일이 깨져 있습니다. 컴퓨터가 갑자기 꺼졌거나 디스크에 문제가 있을 때 드물게 생깁니다. <b>자료가 지워진 것은 아닙니다.</b></p>
      <ul className="small">
        <li>깨진 파일은 지우지 않고 자료 폴더에 <code>{v.broken.kept}</code>로 보관했습니다 ({kb(v.broken.size)}).</li>
        <li>빈 자료로 덮어쓰지 않도록, 되살릴 때까지 <b>우리 교회 자료의 저장을 멈췄습니다.</b> 예제 자료는 그대로 쓸 수 있습니다.</li>
        <li>아래에서 멀쩡한 백업을 골라 되살려 주세요. 보통 <b>맨 위(가장 최근)</b>를 고르시면 됩니다.</li>
      </ul>
      {err && <p className="alert err small">{err}</p>}
      {msg && <p className="alert info small" role="status">{msg}</p>}

      <h2>되살릴 수 있는 백업</h2>
      {good.length === 0 ? <p className="muted small">이 컴퓨터와 바깥 백업 폴더에서 멀쩡한 백업을 찾지 못했습니다.{v.externalDir ? '' : ' (바깥 백업 폴더를 정해 두지 않았습니다)'}</p> : (
        <ul className="recovery-list">
          {good.map((c) => (
            <li key={c.source + c.file}>
              <span><b>{name(c)}</b> <span className="muted small">· {fmtTime(c.at)} · {kb(c.size)}</span><br />
                <span className="small">{c.church || '(교회 이름 없음)'} · 예배 {c.weeks} · 성도 {c.members} · 장부 {c.tx}건</span></span>
              <button className="primary small" disabled={busy} onClick={() => restore(c)}>이 백업으로 되살리기</button>
            </li>
          ))}
        </ul>
      )}
      {bad.length > 0 && <p className="muted small">읽지 못한 백업 {bad.length}개는 뺐습니다: {bad.map(name).join(', ')}</p>}
      <p className="small">USB·클라우드에 받아 둔 백업 파일이 있으면:{' '}
        <label className="btn small backup-file">백업 파일(.zip·.json)에서 되살리기<input type="file" hidden accept=".zip,.json" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) restoreFile(f); e.target.value = ''; }} /></label></p>
      {v.externalDir === '' && <p className="muted small">USB가 빠져 있어 바깥 백업이 안 보이면, 꽂은 뒤 <button className="link" onClick={load}>다시 찾기</button>를 눌러 주세요.</p>}
      {v.externalDir !== '' && <p className="muted small">바깥 백업 폴더: {v.externalDir} · USB를 방금 꽂았으면 <button className="link" onClick={load}>다시 찾기</button></p>}

      {good.length === 0 && (
        <details className="recovery-fresh">
          <summary>백업이 하나도 없으면: 빈 자료로 새로 시작</summary>
          <p className="small">예배 기록·성도·장부가 모두 빈 상태로 시작합니다. 깨진 파일은 그대로 보관되니, 나중에 전문가가 살려 낼 수도 있습니다. 계속하려면 아래 칸에 <b>새로 시작</b>이라고 적어 주세요.</p>
          <div className="row">
            <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="새로 시작" aria-label="확인 글자" />
            <button disabled={busy || word.trim() !== '새로 시작'} onClick={fresh}>빈 자료로 새로 시작</button>
          </div>
        </details>
      )}
    </div>
  );
}

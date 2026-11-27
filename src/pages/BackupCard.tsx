// 설정 → 백업: 바깥 백업 폴더(USB·클라우드), 지금 백업, 백업 파일 받기, 되살리기
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtTime } from '../lib/week';

interface BackupView {
  dir: string; lastAt: number; lastError: string; lastFile: string; upToDate: boolean; recordings: number;
  places: { dir: string; label: string }[];
  local: { file: string; size: number; at: number }[];
  parts?: { files: number; bytes: number }[];
}
interface VerifyResult { ok: boolean; error?: string; file?: string; where?: 'external' | 'local'; at?: number; rows?: { label: string; backup: string | number; now: string | number; same: boolean }[]; allSame?: boolean; changedAfter?: boolean }
export const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1e3))}KB`);
export const label = (f: string) => {
  const m = f.match(/^real-(\d{4})-(\d{2})-(\d{2})\.json$/);
  if (m) return `${+m[2]}월 ${+m[3]}일 자동 백업`;
  if (f.startsWith('before-restore-')) return '되살리기 직전 자료';
  return f;
};

export default function BackupCard() {
  const [v, setV] = useState<BackupView | null>(null);
  const [dir, setDir] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<VerifyResult | null>(null);
  const verify = async () => { setBusy(true); try { setCheck(await api<VerifyResult>('/api/backup/verify', { method: 'POST' })); } catch (e: any) { setCheck({ ok: false, error: e.message }); } setBusy(false); };
  const load = useCallback(() => api<BackupView>('/api/backup').then((x) => { setV(x); setDir(x.dir); }).catch((e) => setMsg({ ok: false, text: e.message })), []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy(false); load();
  };
  const saveDir = (d: string) => run(async () => {
    const r = await api<BackupView & { result: { ok?: boolean; error?: string; off?: boolean } }>('/api/backup/settings', { method: 'PUT', body: { dir: d } });
    if (r.result?.error) throw new Error(r.result.error);
    return r.result?.off ? '바깥 백업을 껐습니다.' : `바깥 백업 폴더를 정하고 지금 한 번 백업했습니다: ${r.dir}`;
  });
  const now = () => run(async () => {
    const r = await api<BackupView & { result: { ok?: boolean; error?: string; recordings?: number } }>('/api/backup/now', { method: 'POST' });
    if (r.result?.error) throw new Error(r.result.error);
    return `백업했습니다${r.result?.recordings ? ` (새 녹음 ${r.result.recordings}개 포함)` : ''}.`;
  });
  const restoreDone = (r: { church: string; weeks: number; members: number; tx: number; recordingsOnly?: boolean; recordings?: number; recordingsReplaced?: number }) => {
    const rep = r.recordingsReplaced ? ` 녹음 ${r.recordingsReplaced}개는 백업한 때의 내용으로 바꾸고, 바뀌어 있던 것은 녹음 폴더의 before-restore 폴더에 남겨 두었습니다.` : '';
    if (r.recordingsOnly) return `녹음 파일 ${r.recordings || 0}개를 더했습니다 (나눠 받은 백업의 녹음 묶음이라 교회 자료는 그대로 둡니다).${rep}`;
    setTimeout(() => window.location.reload(), 1500);
    return `되살렸습니다: ${r.church || '(교회 이름 없음)'} · 예배 ${r.weeks} · 성도 ${r.members} · 장부 ${r.tx}건. 바로 앞 자료는 '되살리기 직전 자료'로 남겨 두었습니다.${rep} 화면을 새로 고칩니다…`;
  };
  const restoreLocal = (f: string) => {
    if (!confirm(`${label(f)}로 되살릴까요?\n지금 자료는 '되살리기 직전 자료'로 따로 남겨 두니, 마음이 바뀌면 그것으로 다시 되살릴 수 있습니다.`)) return;
    run(async () => restoreDone(await api('/api/backup/restore-local', { method: 'POST', body: { file: f } })));
  };
  const restoreFile = (file: File) => {
    if (!confirm(`"${file.name}"로 되살릴까요?\n지금 자료는 '되살리기 직전 자료'로 따로 남겨 둡니다.`)) return;
    run(async () => {
      const r = await fetch('/api/backup/restore', { method: 'POST', headers: { 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `되살리지 못했습니다 (${r.status})`);
      return restoreDone(j);
    });
  };

  return (
    <div className="card backup-card">
      <h2>백업</h2>
      <p className="muted small">교회 자료(성도·재정·행정·예배 기록)는 매일 이 컴퓨터 안에 자동 백업됩니다. 컴퓨터가 고장 나도 남도록 <b>바깥 백업 폴더</b>(USB, iCloud Drive, 구글 드라이브·OneDrive 폴더)를 정해 두세요. 예제 자료는 백업하지 않습니다.</p>

      <h3>바깥 백업 폴더</h3>
      {v?.dir ? (
        <p className={v.lastError ? 'alert warn small' : 'small'}>
          {v.lastError ? <>⚠️ {v.lastError}</> : <>{v.upToDate ? '✅' : '🕘'} {v.lastAt ? `${fmtTime(v.lastAt)}에 백업했습니다` : '아직 백업 전'}{v.lastAt ? (v.upToDate ? ' · 현재 자료까지 백업됨' : ' · 그 뒤 고친 내용은 10분 안에 다시 백업합니다') : ''} · <code>{v.dir}</code></>}
        </p>
      ) : <p className="alert warn small">아직 바깥 백업 폴더가 없습니다. 컴퓨터가 고장 나면 백업도 함께 사라집니다.</p>}
      {v && v.places.length > 0 && (
        <div className="chips">{v.places.map((p) => <button key={p.dir} className={`chip ${v.dir === p.dir ? 'on' : ''}`} disabled={busy} onClick={() => saveDir(p.dir)} title={p.dir}>{p.label}</button>)}</div>
      )}
      <div className="row wrap">
        <input className="grow" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="또는 폴더 위치를 직접 적기 (예: /Volumes/USB, D:\백업)" aria-label="바깥 백업 폴더" />
        <button disabled={busy || dir === (v?.dir || '')} onClick={() => saveDir(dir)}>폴더 정하기</button>
        {v?.dir && <button disabled={busy} onClick={now}>지금 백업</button>}
        {v?.dir && <button className="link small" disabled={busy} onClick={() => { setDir(''); saveDir(''); }}>끄기</button>}
      </div>
      <p className="muted small">정해 두면 자료를 저장할 때(같은 날 또 고치면 10분쯤 뒤 다시) 그 폴더의 <code>라온교회올인원-백업</code>에 교회 자료와 새 녹음 파일을 복사하고, 60일치를 보관합니다.</p>

      <h3>백업 파일 받기</h3>
      {(v?.parts?.length || 1) > 1 ? (
        <>
          <p className="small muted">회의 녹음이 많아 <b>{v!.parts!.length}개 파일</b>로 나눠 받습니다 (파일 하나가 너무 크면 되살릴 수 없어서). 모두 받아 두세요. 되살릴 때는 <b>1부를 먼저</b>, 그다음 나머지를 차례로 고르면 녹음이 더해집니다.</p>
          <div className="row wrap backup-parts">
            {v!.parts!.map((x, i) => <a key={i} className="btn small" href={`/api/backup/download?part=${i}`}>{i + 1}부 받기 <span className="muted">({i === 0 ? '교회 자료' : '녹음'}{x.files - (i === 0 ? 1 : 0) > 0 ? `${i === 0 ? '+녹음' : ''} ${x.files - (i === 0 ? 1 : 0)}개` : ''} · {kb(x.bytes)})</span></a>)}
          </div>
        </>
      ) : (
        <p className="small"><a className="btn" href="/api/backup/download">백업 파일 받기 (.zip)</a> <span className="muted">교회 자료{v?.recordings ? `와 회의 녹음 ${v.recordings}개` : ''}를 파일 하나로 받습니다. 다른 컴퓨터로 옮길 때도 씁니다.</span></p>
      )}

      <h3>복원 확인</h3>
      <p className="small"><button disabled={busy} onClick={verify}>가장 최근 백업 확인하기</button> <span className="muted">백업 파일을 실제로 열어 되살릴 수 있는지 보고, 성도·예배·장부·회의록·녹음을 지금 자료와 견줍니다. 아무것도 바꾸지 않습니다.</span></p>
      {check && (check.ok ? (
        <div className={`small backup-verify ${check.allSame ? 'alert info' : 'alert warn'}`}>
          <p>{check.allSame ? '✅ 가장 최근 백업으로 지금 자료를 그대로 되살릴 수 있습니다.' : check.changedAfter ? '🕘 백업한 뒤에 바뀐 자료가 있습니다. 다음 백업 때 함께 들어갑니다.' : '⚠️ 백업과 지금 자료가 다릅니다. 아래 표를 확인해 주세요.'} <span className="muted">({check.where === 'external' ? '바깥 백업' : '이 컴퓨터 백업'} · {check.at ? fmtTime(check.at) : ''})</span></p>
          <table className="people-table"><thead><tr><th>항목</th><th className="num">백업</th><th className="num">지금</th><th /></tr></thead>
            <tbody>{check.rows!.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{typeof r.backup === 'number' ? r.backup.toLocaleString('ko-KR') : r.backup}</td><td className="num">{typeof r.now === 'number' ? r.now.toLocaleString('ko-KR') : r.now}</td><td>{r.same ? '같음' : '다름'}</td></tr>)}</tbody></table>
        </div>
      ) : <p className="alert err small">복원 확인 실패: {check.error}</p>)}

      <h3>되살리기</h3>
      <label className="btn small backup-file">받아 둔 백업 파일(.zip·.json)에서 되살리기<input type="file" hidden accept=".zip,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) restoreFile(f); e.target.value = ''; }} /></label>
      {v && v.local.length > 0 && (
        <details>
          <summary className="small">이 컴퓨터 안의 백업 {v.local.length}개에서 고르기</summary>
          <ul className="backup-list">
            {v.local.map((b) => <li key={b.file}><span>{label(b.file)} <span className="muted small">· {fmtTime(b.at)} · {kb(b.size)}</span></span><button className="small" disabled={busy} onClick={() => restoreLocal(b.file)}>이 백업으로 되살리기</button></li>)}
          </ul>
        </details>
      )}
      {msg && <p className={msg.ok ? 'alert info small' : 'alert err small'}>{msg.text}</p>}
    </div>
  );
}

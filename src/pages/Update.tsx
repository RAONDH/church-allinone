// 새 버전 알림 창 · 위쪽 줄의 🔔 새 버전 단추 · 다시 켜진 뒤 저절로 새로 고침
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { busyNow } from '../lib/busy';
import { SafeMd } from '../lib/md';

export interface UpdateView {
  current: string; latest: { version: string; url: string; notes: string; name: string } | null;
  available: boolean; installable: boolean; snoozed: boolean; notify: boolean; checkedAt: number; checkError: string; busy: string;
  job: { phase: 'idle' | 'downloading' | 'installing' | 'restarting' | 'error'; done: number; total: number; error: string; version: string };
}
const CHECK_EVERY = 6 * 3600e3;

export function useUpdate() {
  const [u, setU] = useState<UpdateView | null>(null);
  const [open, setOpen] = useState(false);
  const shown = useRef('');
  const load = useCallback(async (force = false) => {
    try { const v = await api<UpdateView>(`/api/update${force ? '?force=1' : ''}`); setU(v); return v; } catch { return null; }
  }, []);
  // 켤 때와 6시간마다 확인. 새 버전이 있고, 알림을 켜 두었고, 미루지 않았고, 작업 중이 아니면 저절로 띄운다
  useEffect(() => {
    const tick = async () => {
      const v = await load();
      if (v?.available && v.notify && !v.snoozed && !v.busy && !busyNow() && shown.current !== v.latest?.version) { shown.current = v.latest!.version; setOpen(true); }
    };
    tick();
    const t = setInterval(tick, CHECK_EVERY);
    return () => clearInterval(t);
  }, [load]);
  // 프로그램이 새 버전으로 다시 켜지면, 열려 있던 창도 저절로 새로 고침
  useEffect(() => {
    let first = '';
    const t = setInterval(async () => {
      try {
        const h = await api<{ version: string }>('/api/health');
        if (!first) first = h.version; else if (h.version !== first) window.location.reload();
      } catch { /* 다시 켜지는 중 */ }
    }, 5000);
    return () => clearInterval(t);
  }, []);
  return { u, open, setOpen, load, setU };
}

export function UpdateBell({ u, onOpen }: { u: UpdateView | null; onOpen: () => void }) {
  if (!u?.available) return null;
  return <button className="update-bell" onClick={onOpen} title={`새 버전 v${u.latest?.version}`}>🔔 새 버전</button>;
}

export function UpdateDialog({ u, setU, onClose }: { u: UpdateView; setU: (v: UpdateView) => void; onClose: () => void }) {
  const [err, setErr] = useState('');
  const job = u.job;
  const working = job.phase === 'downloading' || job.phase === 'installing' || job.phase === 'restarting';
  // 설치하는 동안 진행 상황을 자주 묻는다
  useEffect(() => {
    if (!working) return;
    const t = setInterval(async () => { try { setU(await api<UpdateView>('/api/update')); } catch { /* 다시 켜지는 중 */ } }, 1000);
    return () => clearInterval(t);
  }, [working, setU]);
  const install = async () => {
    setErr('');
    try { setU(await api<UpdateView>('/api/update/install', { method: 'POST' })); } catch (e: any) { setErr(e.message); }
  };
  const later = async () => {
    try { setU(await api<UpdateView>('/api/update/snooze', { method: 'POST', body: { version: u.latest?.version } })); } catch { /* 닫기만 */ }
    onClose();
  };
  const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const status = job.phase === 'downloading' ? `받는 중…${job.total ? ` ${pct}%` : ''}` : job.phase === 'installing' ? '설치하는 중…' : job.phase === 'restarting' ? '설치했습니다. 다시 켜는 중…' : '';
  return (
    <div className="dialog-back" onClick={working ? undefined : onClose}>
      <div className="dialog update-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-labelledby="upd-title">
        <div className="update-head">
          <span className="update-icon" aria-hidden>⛪</span>
          <div>
            <h2 id="upd-title">새 버전이 있습니다</h2>
            <p>v{u.current} → <b>v{u.latest?.version}</b></p>
          </div>
        </div>
        <div className="update-body">
          <h3>업데이트 내용</h3>
          <div className="update-notes">{u.latest?.notes ? <SafeMd text={u.latest.notes} /> : <p className="muted">설명이 없습니다.</p>}</div>
          {u.latest?.url && <p className="small"><a href={u.latest.url} target="_blank" rel="noopener noreferrer">GitHub에서 전체 보기 →</a></p>}
          {status && <div className="update-progress"><p><b>{status}</b></p>{job.phase === 'downloading' && job.total > 0 && <div className="bar"><span style={{ width: `${pct}%` }} /></div>}</div>}
          {job.phase === 'error' && <p className="alert err small">{job.error}</p>}
          {err && <p className="alert err small">{err}</p>}
          {!working && u.busy && <p className="alert warn small">{u.busy} 끝난 뒤에 업데이트할 수 있습니다. (업데이트하면 프로그램이 다시 켜집니다)</p>}
          {!u.installable && <p className="alert info small">이 버전은 자동 설치를 지원하지 않습니다. 'GitHub에서 전체 보기'에서 받아 설치해 주세요.</p>}
          <p className="muted small">설치 전에 교회 자료를 자료 폴더의 backups 에 한 벌 더 저장합니다. 입력한 자료는 그대로 남습니다.</p>
        </div>
        <div className="update-foot">
          <button className="primary big" disabled={working || !u.installable || !!u.busy} onClick={install}>{working ? status : job.phase === 'error' ? '다시 시도' : '지금 업데이트'}</button>
          {!working && <button className="link" onClick={later}>나중에</button>}
        </div>
      </div>
    </div>
  );
}

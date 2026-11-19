// 찬양 콘티 탭: 라온 music sheet(찬양팀 콘티) 공유 링크로 이번 주 곡 가져오기 → 예배송출 자막에 넣기
// 한쪽으로만 읽습니다(music sheet → 올인원). 로그인 정보는 쓰지 않고, 공유 링크와 공유 비밀번호만 씁니다.
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { Week, WeekStatus } from '../lib/types';

interface MsSong { title: string; artist: string; key: string; bpm: number; capo: number; youtubeUrl: string; flowText: string; notes: string }
interface MsSetlist { name: string; date: string; serviceType: string; status: 'draft' | 'confirmed'; songs: MsSong[] }
interface MsView { link: { url: string; hasPin: boolean } | null; setlist?: MsSetlist; error?: string; needPin?: boolean }
interface ApplyResult { results: { title: string; key: string; done: string[] }[]; removed: string[]; status: WeekStatus }

export default function MusicSheetCard({ week, songCount, setStatus, onSongsChanged }: { week: Week; songCount: number; setStatus: (s: WeekStatus) => void; onSongsChanged: () => void }) {
  const { base } = useApp();
  const [v, setV] = useState<MsView | null>(null);
  const [url, setUrl] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState<ApplyResult | null>(null);
  const path = `${base}/weeks/${week.id}/musicsheet`;
  const show = (x: MsView) => { setV(x); if (x.link) setUrl(x.link.url); };

  useEffect(() => { setDone(null); setErr(''); api<MsView>(path).then(show).catch((e) => setErr(e.message)); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (clear = false) => {
    setBusy('save'); setErr(''); setDone(null);
    try { show(await api<MsView>(path, { method: 'PUT', body: clear ? { url: '' } : { url, ...(pin ? { pin } : {}) } })); setPin(''); if (clear) setUrl(''); }
    catch (e: any) { setErr(e.message); }
    setBusy('');
  };
  const refresh = async () => { setBusy('load'); setErr(''); try { show(await api<MsView>(path)); } catch (e: any) { setErr(e.message); } setBusy(''); };
  const apply = async () => {
    const n = v?.setlist?.songs.length || 0;
    if (songCount && !window.confirm(`지금 콘티의 곡 ${songCount}곡을 music sheet 순서의 ${n}곡으로 바꿉니다. 조성·곡 구성은 곡 자체에 저장되어 다른 주에도 함께 바뀝니다. 넣을까요?`)) return;
    setBusy('apply'); setErr('');
    try { const r = await api<ApplyResult>(`${path}/apply`, { method: 'POST' }); setDone(r); setStatus(r.status); onSongsChanged(); }
    catch (e: any) { setErr(e.message); }
    setBusy('');
  };

  const sl = v?.setlist;
  return (
    <div className="card musicsheet-card">
      <h2>라온 music sheet에서 가져오기</h2>
      <p className="muted small">찬양팀이 music sheet에서 만든 콘티의 <b>공유 링크</b>를 붙여 넣으면 곡·조성·진행을 가져옵니다. music sheet의 새 링크는 잠겨 있으니 공유 설정에서 <b>공유 비밀번호</b>를 걸고 그 비밀번호를 함께 넣어 주세요. 로그인 정보는 쓰지 않습니다.</p>
      <div className="row wrap">
        <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://raon-music-sheet.vercel.app/share/…" aria-label="music sheet 공유 링크" />
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder={v?.link?.hasPin ? '공유 비밀번호 (저장됨)' : '공유 비밀번호'} aria-label="공유 비밀번호" autoComplete="off" style={{ maxWidth: 180 }} />
        <button className="primary" disabled={!url.trim() || !!busy} onClick={() => save()}>{busy === 'save' ? '가져오는 중…' : '가져오기'}</button>
        {v?.link && <button disabled={!!busy} onClick={refresh}>{busy === 'load' ? '읽는 중…' : '다시 읽기'}</button>}
        {v?.link && <button className="link small" disabled={!!busy} onClick={() => save(true)}>연결 끊기</button>}
      </div>
      {(err || v?.error) && <p className="alert err small">{err || v?.error}</p>}
      {sl && (
        <>
          <p className="small"><b>{sl.name || '이름 없는 콘티'}</b>{sl.date && ` · ${sl.date}`}{sl.serviceType && ` · ${sl.serviceType}`} {sl.status === 'confirmed' ? <span className="pill done">확정</span> : <span className="pill todo">작성 중</span>}
            {sl.date && sl.date !== week.date && <span className="warn-text small"> · 이 예배 날짜({week.date})와 다릅니다</span>}</p>
          {sl.songs.length === 0 ? <p className="muted small">콘티에 곡이 없습니다.</p> : (
            <ol className="ms-songs">
              {sl.songs.map((s, i) => (
                <li key={i}>
                  <b>{s.title}</b>{s.key && <span className="pill info">{s.key}</span>}{s.bpm ? <span className="muted small"> {s.bpm} BPM</span> : null}{s.capo ? <span className="muted small"> · 카포 {s.capo}</span> : null}
                  {s.artist && <span className="muted small"> · {s.artist}</span>}
                  {s.flowText && <div className="muted small">진행: {s.flowText}</div>}
                  {s.notes && <div className="muted small">메모: {s.notes}</div>}
                </li>
              ))}
            </ol>
          )}
          <div className="row end">
            <button className="primary" disabled={!sl.songs.length || !!busy} onClick={apply}>{busy === 'apply' ? '넣는 중…' : '예배송출 자막에 넣기'}</button>
          </div>
        </>
      )}
      {done && (
        <div className="alert info small" role="status">
          <b>예배송출 콘티에 {done.results.length}곡을 넣었습니다.</b>
          <ul>{done.results.map((r, i) => <li key={i}>{r.title}: {r.done.join(' · ')}</li>)}</ul>
          {done.removed.length > 0 && <div>콘티에서 뺀 곡: {done.removed.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

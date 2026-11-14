import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { Song } from '../lib/types';

export default function Songs() {
  const { base } = useApp();
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const load = useCallback(() => api<{ ok: boolean; songs?: Song[]; error?: string }>(`${base}/songs`).then((r) => (r.ok ? setSongs(r.songs!) : setErr(r.error!))).catch((e) => setErr(e.message)), [base]);
  useEffect(() => { load(); }, [load]);

  const count = (t: string) => songs?.filter((s) => s.title === t).length || 0;
  const list = (songs || []).filter((s) => !q.trim() || [s.title, s.lyrics, s.meta.writer, s.meta.source, s.meta.distinguish].join(' ').toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  const cur = songs?.find((s) => s.id === sel) || null;

  return (
    <section>
      <h1>찬양 자료</h1>
      <p className="muted">가사와 곡 구성은 예배송출 자료실에 있는 그대로 보여 줍니다. 여기서는 작사·작곡·출처와 같은 제목 곡을 구분하는 메모를 적어 둘 수 있습니다. 새 곡 등록과 가사 수정은 <Link to="/apps">예배송출</Link>에서 합니다.</p>
      {err && <div className="alert warn">{err} <Link to="/apps">예배송출 켜기</Link></div>}
      <div className="grid2 wide-left">
        <div className="card">
          <input placeholder="제목·가사·작사작곡자·출처로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          <p className="muted small">{songs ? `${list.length}곡` : '불러오는 중…'}</p>
          <ul className="song-list">
            {list.map((s) => (
              <li key={s.id} className={s.id === sel ? 'on' : ''} onClick={() => setSel(s.id)}>
                <b>{s.title}</b> {s.key && <span className="pill info">{s.key}</span>}
                {count(s.title) > 1 && <span className={`pill ${s.meta.distinguish ? 'info' : 'warn'}`}>같은 제목 {count(s.title)}곡</span>}
                <div className="muted small">{[s.meta.distinguish, s.meta.writer].filter(Boolean).join(' · ') || (s.slideCount ? `화면 ${s.slideCount}장` : '가사 없음')}{s.lastUsed ? ` · 최근 사용 ${s.lastUsed}` : ''}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          {cur ? <SongDetail key={cur.id} song={cur} onSaved={load} /> : <p className="muted">왼쪽에서 곡을 고르세요.</p>}
        </div>
      </div>
    </section>
  );
}

function SongDetail({ song, onSaved }: { song: Song; onSaved: () => void }) {
  const { base } = useApp();
  const [m, setM] = useState({ writer: song.meta.writer || '', source: song.meta.source || '', distinguish: song.meta.distinguish || '' });
  const [msg, setMsg] = useState('');
  const save = async () => {
    try { await api(`${base}/songs/${song.id}/meta`, { method: 'PUT', body: m }); setMsg('저장했습니다.'); onSaved(); } catch (e: any) { setMsg(`저장하지 못했습니다: ${e.message}`); }
  };
  return (
    <div>
      <h2>{song.title}</h2>
      <p className="muted small">조성 {song.key || '미입력'} · 곡 구성 {song.arr.length ? song.arr.join(' → ') : '등록 순서대로'}{song.memo ? ` · ${song.memo}` : ''}</p>
      <label>작사·작곡<input value={m.writer} onChange={(e) => setM({ ...m, writer: e.target.value })} placeholder="예: 작사 ○○○ / 작곡 ○○○" /></label>
      <label>출처 (찬송가 번호, 악보집, 저작권 정보)<input value={m.source} onChange={(e) => setM({ ...m, source: e.target.value })} /></label>
      <label>같은 제목 곡 구분 메모<input value={m.distinguish} onChange={(e) => setM({ ...m, distinguish: e.target.value })} placeholder="예: 느린 기도곡, 청년부 버전" /></label>
      <div className="row"><button className="primary" onClick={save}>저장</button>{msg && <span className="muted">{msg}</span>}</div>
      <h3>가사</h3>
      <pre className="lyrics">{song.lyrics || '가사가 없습니다.'}</pre>
    </div>
  );
}

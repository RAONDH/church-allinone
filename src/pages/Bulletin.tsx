// 예배 화면 '결과물' 탭의 주보: 인쇄용(A4 가로 2단) 열기, 휴대폰 주보 파일 받기, 고정 정보·보일 칸 정하기, 확정본 보관
import { useCallback, useEffect, useState } from 'react';
import { fmtTime } from '../lib/week';
import { useApp } from '../App';
import { useGuardedClose } from '../lib/guard';
import { api } from '../lib/api';
import type { Week } from '../lib/types';
import BulletinEditor from './BulletinEditor';
import BulletinStyle from './BulletinStyle';
import { shrinkImage } from '../lib/image';

interface BulletinSettings { logo?: string; autoFill?: boolean; address: string; phone: string; worshipTimes: string; account: string; motto: string; mottoVerse: string; showOrder: boolean; showSummary: boolean; showServe: boolean; showEvents: boolean; showBirthdays: boolean }

export default function BulletinCard({ week }: { week: Week }) {
  const { base } = useApp();
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState(false);
  const [style, setStyle] = useState(false);
  const [s, setS] = useState<BulletinSettings | null>(null);
  const [ft, setFt] = useState(0);   // 주보 편집·고정 정보를 닫으면 확정본 바뀜 여부를 다시 본다
  useEffect(() => { api<BulletinSettings>(`${base}/bulletin`).then(setS).catch(() => {}); }, [base, open]);
  const url = `${base}/weeks/${week.id}/bulletin`;
  const empty = s && !s.address && !s.worshipTimes && !s.phone;
  return (
    <div className="card">
      <h2>주보</h2>
      <p className="muted small">입력한 예배 정보·예배 순서·찬양·광고·봉사·다음 주 일정과 설교 후 자료의 <b>주보 요약</b>을 모아 주보를 만듭니다. AI를 쓰지 않습니다.</p>
      <div className="row wrap">
        <a className="btn primary-link" href={`${url}?format=print`} target="_blank" rel="noopener">인쇄용 주보 열기 (A4 가로 2단)</a>
        <a className="btn" href={`${url}?format=fold4`} target="_blank" rel="noopener">접는 4면 주보 열기</a>
        <a className="btn" href={`${url}?format=mobile&download=1`}>휴대폰 주보 파일 받기</a>
        <a className="btn" href={`${url}?format=mobile`} target="_blank" rel="noopener">휴대폰 주보 미리 보기</a>
        <button className="primary" onClick={() => setEditor(true)}>주보 편집 (배치·글 고치기)</button>
        <button onClick={() => setStyle(true)}>주보 꾸미기</button>
        <button onClick={() => setOpen(true)}>주보 고정 정보</button>
      </div>
      <Finals key={ft} url={url} />
      {empty && <p className="alert info small">처음이시면 <b>주보 고정 정보</b>에 교회 주소·예배 시간·헌금 계좌를 한 번 적어 두세요. 매주 주보 아래에 들어갑니다.</p>}
      <p className="muted small">인쇄용은 열린 화면의 <b>인쇄</b> 단추(또는 ⌘/Ctrl+P)로 A4 가로로 인쇄해 반으로 접으면 됩니다. 칸 순서·자리를 바꾸거나 이번 주 글을 손보려면 <b>주보 편집</b>을 누르세요. <b>접는 4면</b>은 A4 한 장 앞뒤로 인쇄(양면 · 짧은 쪽으로 넘기기)해 접으면 표지 → 안쪽 2·3면 → 뒷면이 됩니다. 휴대폰 주보 파일은 카카오톡으로 보내면 받은 분이 열어 볼 수 있습니다.</p>
      {editor && <BulletinEditor week={week} onClose={() => { setEditor(false); setFt((x) => x + 1); api<BulletinSettings>(`${base}/bulletin`).then(setS).catch(() => {}); }} />}
      {style && <BulletinStyle week={week} onClose={() => { setStyle(false); setFt((x) => x + 1); api<BulletinSettings>(`${base}/bulletin`).then(setS).catch(() => {}); }} />}
      {open && s && <SettingsDialog s={s} onClose={() => setOpen(false)} onSaved={(x) => { setS(x); setOpen(false); setFt((n) => n + 1); }} />}
    </div>
  );
}

function SettingsDialog({ s, onClose, onSaved }: { s: BulletinSettings; onClose: () => void; onSaved: (x: BulletinSettings) => void }) {
  const g = useGuardedClose(onClose);
  const { base } = useApp();
  const [f, setF] = useState(s);
  const [err, setErr] = useState('');
  const t = (k: keyof BulletinSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const c = (k: keyof BulletinSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.checked });
  const [logoBusy, setLogoBusy] = useState(false);
  // 로고: 크기를 줄여 올리고 번호만 설정에 넣는다 ([저장]을 눌러야 주보에 들어감)
  const upLogo = async (file: File) => {
    setLogoBusy(true); setErr('');
    try { const data = await shrinkImage(file, { maxSide: 600, maxBytes: 300 * 1024, keepPng: true }); const r = await api<{ id: string }>(`${base}/bulletin/images`, { method: 'POST', body: { data } }); setF((x) => ({ ...x, logo: r.id })); }
    catch (e: any) { setErr(e.message); }
    setLogoBusy(false);
  };
  const save = async () => { try { onSaved(await api<BulletinSettings>(`${base}/bulletin`, { method: 'PUT', body: f })); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="dialog-back" onClick={g.close}>
      <div {...g.track} className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>주보 고정 정보</h2>
        <p className="muted small">한 번 적어 두면 매주 주보에 들어갑니다. 교회 이름은 설정의 교회 정보에서 가져옵니다.</p>
        <div className="logo-row">
          {f.logo ? <img className="logo-thumb" src={`${base}/bulletin/images/${f.logo}`} alt="교회 로고" /> : <span className="muted small">교회 로고 없음</span>}
          <label className="btn small">{logoBusy ? '줄이는 중…' : f.logo ? '로고 바꾸기' : '교회 로고 넣기'}<input type="file" hidden accept="image/*" aria-label="교회 로고 파일" disabled={logoBusy} onChange={(e) => { const x = e.target.files?.[0]; if (x) upLogo(x); e.target.value = ''; }} /></label>
          {f.logo && <button className="link small" onClick={() => setF({ ...f, logo: '' })}>로고 빼기</button>}
          <span className="muted small">주보 맨 위(접는 4면은 표지)에 들어갑니다. 크기를 줄여 저장합니다.</span>
        </div>
        <div className="form-grid">
          <label>표어<input value={f.motto} onChange={t('motto')} placeholder="예: 말씀으로 함께 걷는 교회" /></label>
          <label>표어 말씀<input value={f.mottoVerse} onChange={t('mottoVerse')} placeholder="예: 시편 23:1" /></label>
          <label className="span2">예배 시간 안내 <span className="muted small">(한 줄에 하나)</span><textarea rows={3} value={f.worshipTimes} onChange={t('worshipTimes')} placeholder={'주일 예배 오전 11시\n수요 기도회 오후 7시 30분'} /></label>
          <label className="span2">교회 주소<input value={f.address} onChange={t('address')} /></label>
          <label>전화<input value={f.phone} onChange={t('phone')} /></label>
          <label>헌금 계좌<input value={f.account} onChange={t('account')} placeholder="예: ○○은행 000-000-000000 (예금주)" /></label>
        </div>
        <fieldset>
          <legend>주보에 넣을 칸</legend>
          <label className="check"><input type="checkbox" checked={f.showOrder} onChange={c('showOrder')} />예배 순서 (예배송출의 순서)</label>
          <label className="check"><input type="checkbox" checked={f.showSummary} onChange={c('showSummary')} />설교 요약 (설교 후 자료의 주보 요약을 만들었을 때)</label>
          <label className="check"><input type="checkbox" checked={f.showServe} onChange={c('showServe')} />섬기는 분들 (이번 주·다음 주 봉사)</label>
          <label className="check"><input type="checkbox" checked={f.showEvents} onChange={c('showEvents')} />다음 주 일정</label>
          <label className="check"><input type="checkbox" checked={f.showBirthdays} onChange={c('showBirthdays')} />이번 주 생일 <span className="muted small">(성도 이름과 날짜가 인쇄물에 나갑니다)</span></label>
        </fieldset>
        <label className="check"><input type="checkbox" checked={f.autoFill !== false} onChange={(e) => setF({ ...f, autoFill: e.target.checked })} />빈 자리를 줄간격으로 자동 채우기 <span className="muted small">(내용이 적은 단·면은 줄과 칸 사이를 넓혀 종이 아래까지 고르게 채웁니다. 줄간격은 최대 1.9배)</span></label>
        {err && <p className="alert err">{err}</p>}
        <div className="row end"><button onClick={g.close}>닫기</button><button className="primary" onClick={save}>저장</button></div>
      </div>
    </div>
  );
}

// 주보 확정본: 배포한 주보를 그대로 보관하고(차수·확정 시각), 그 뒤 바뀐 내용이 있으면 알린다
interface FinalsView { finals: { v: number; at: number }[]; changed: boolean | null }
function Finals({ url }: { url: string }) {
  const [f, setF] = useState<FinalsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [more, setMore] = useState(false);
  const load = useCallback(() => api<FinalsView>(`${url}/finals`).then(setF).catch((e) => setErr(e.message)), [url]);
  // 다른 탭에서 고치고 돌아오면 바뀜 여부를 다시 본다
  useEffect(() => { load(); const on = () => { if (document.visibilityState === 'visible') load(); }; document.addEventListener('visibilitychange', on); return () => document.removeEventListener('visibilitychange', on); }, [load]);
  const confirmNow = async () => {
    const last = f?.finals[0];
    if (last && !window.confirm(`주보를 ${last.v + 1}차로 다시 확정할까요? ${last.v}차 확정본도 그대로 남습니다.`)) return;
    setBusy(true); setErr('');
    try { setF(await api<FinalsView>(`${url}/finals`, { method: 'POST' })); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  if (!f) return err ? <p className="alert err small">{err}</p> : null;
  const last = f.finals[0];
  const open = (v: number, fmt: string) => `${url}?final=${v}&format=${fmt}`;
  return (
    <div className="bul-final">
      {!last ? (
        <p className="small"><b>주보 확정:</b> 인쇄하거나 보내기 전에 누르면 그때의 주보를 그대로 보관합니다. 나중에 표어·광고·배치를 바꿔도 이 주보는 그대로 다시 열 수 있습니다.{' '}
          <button className="small" disabled={busy} onClick={confirmNow}>{busy ? '확정하는 중…' : '주보 확정'}</button></p>
      ) : (
        <>
          <p className="small">
            <span className="pill done">확정본 {last.v}차</span> <span className="muted">{fmtTime(last.at)} 확정</span>{' '}
            <a href={open(last.v, 'print')} target="_blank" rel="noopener">인쇄용</a> · <a href={open(last.v, 'fold4')} target="_blank" rel="noopener">4면</a> · <a href={open(last.v, 'mobile')} target="_blank" rel="noopener">휴대폰</a> · <a href={`${open(last.v, 'mobile')}&download=1`}>휴대폰 파일 받기</a>
          </p>
          {f.changed && <p className="alert warn small" role="status">초안에 변경이 있습니다. 확정한 뒤 예배 정보·광고·배치 등이 바뀌어, 지금 주보가 확정본과 다릅니다. 바뀐 내용으로 다시 내보내려면 <button className="small" disabled={busy} onClick={confirmNow}>{busy ? '확정하는 중…' : `${last.v + 1}차로 다시 확정`}</button></p>}
          {!f.changed && <p className="muted small">확정한 뒤 바뀐 내용이 없습니다.</p>}
          {f.finals.length > 1 && (
            <p className="small"><button className="link small" onClick={() => setMore(!more)}>지난 확정본 {f.finals.length - 1}개 {more ? '접기' : '보기'}</button>
              {more && <span> · {f.finals.slice(1).map((x) => <span key={x.v}>{x.v}차({fmtTime(x.at)}) <a href={open(x.v, 'print')} target="_blank" rel="noopener">인쇄용</a> <a href={open(x.v, 'fold4')} target="_blank" rel="noopener">4면</a> <a href={open(x.v, 'mobile')} target="_blank" rel="noopener">휴대폰</a> · </span>)}</span>}</p>
          )}
        </>
      )}
      {err && <p className="alert err small">{err}</p>}
    </div>
  );
}

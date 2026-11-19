// 예배 화면 '결과물' 탭의 주보: 인쇄용(A4 가로 2단) 열기, 휴대폰 주보 파일 받기, 고정 정보·보일 칸 정하기
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { Week } from '../lib/types';
import BulletinEditor from './BulletinEditor';

interface BulletinSettings { address: string; phone: string; worshipTimes: string; account: string; motto: string; mottoVerse: string; showOrder: boolean; showSummary: boolean; showServe: boolean; showEvents: boolean; showBirthdays: boolean }

export default function BulletinCard({ week }: { week: Week }) {
  const { base } = useApp();
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState(false);
  const [s, setS] = useState<BulletinSettings | null>(null);
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
        <button onClick={() => setOpen(true)}>주보 고정 정보</button>
      </div>
      {empty && <p className="alert info small">처음이시면 <b>주보 고정 정보</b>에 교회 주소·예배 시간·헌금 계좌를 한 번 적어 두세요. 매주 주보 아래에 들어갑니다.</p>}
      <p className="muted small">인쇄용은 열린 화면의 <b>인쇄</b> 단추(또는 ⌘/Ctrl+P)로 A4 가로로 인쇄해 반으로 접으면 됩니다. 칸 순서·자리를 바꾸거나 이번 주 글을 손보려면 <b>주보 편집</b>을 누르세요. <b>접는 4면</b>은 A4 한 장 앞뒤로 인쇄(양면 · 짧은 쪽으로 넘기기)해 접으면 표지 → 안쪽 2·3면 → 뒷면이 됩니다. 휴대폰 주보 파일은 카카오톡으로 보내면 받은 분이 열어 볼 수 있습니다.</p>
      {editor && <BulletinEditor week={week} onClose={() => { setEditor(false); api<BulletinSettings>(`${base}/bulletin`).then(setS).catch(() => {}); }} />}
      {open && s && <SettingsDialog s={s} onClose={() => setOpen(false)} onSaved={(x) => { setS(x); setOpen(false); }} />}
    </div>
  );
}

function SettingsDialog({ s, onClose, onSaved }: { s: BulletinSettings; onClose: () => void; onSaved: (x: BulletinSettings) => void }) {
  const { base } = useApp();
  const [f, setF] = useState(s);
  const [err, setErr] = useState('');
  const t = (k: keyof BulletinSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const c = (k: keyof BulletinSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.checked });
  const save = async () => { try { onSaved(await api<BulletinSettings>(`${base}/bulletin`, { method: 'PUT', body: f })); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>주보 고정 정보</h2>
        <p className="muted small">한 번 적어 두면 매주 주보에 들어갑니다. 교회 이름은 설정의 교회 정보에서 가져옵니다.</p>
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
        {err && <p className="alert err">{err}</p>}
        <div className="row end"><button onClick={onClose}>닫기</button><button className="primary" onClick={save}>저장</button></div>
      </div>
    </div>
  );
}

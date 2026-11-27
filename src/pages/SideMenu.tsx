// 왼쪽 묶음 메뉴와 위쪽 날짜 줄 (2026-11 새 화면 시안)
// - 업무별 묶음: 예배 준비 · 사람 돌봄 · 재정 · 행정·문서 · 설정·도움
// - 화면 안의 탭(심방·출석·회의록 등)도 메뉴에서 바로 연다. 주소와 화면은 예전 그대로.
// - 휴대폰처럼 좁은 화면에서는 [메뉴] 단추로 펼치고, 고르면 저절로 접힌다.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Ws } from '../lib/types';
import { ymd } from '../lib/week';

const I = (d: ReactNode) => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const ICON = {
  home: I(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>),
  music: I(<><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>),
  people: I(<><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-7 7-7s7 3 7 7" /><path d="M17 4a4 4 0 0 1 0 8" /><path d="M22 21c0-3-2-6-5-7" /></>),
  heart: I(<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />),
  check: I(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18" /><path d="M8 2v4M16 2v4" /><path d="M9 15l2 2 4-4" /></>),
  list: I(<><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>),
  card: I(<><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></>),
  chart: I(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  receipt: I(<><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></>),
  calendar: I(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18" /><path d="M8 2v4M16 2v4" /></>),
  clip: I(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3h6v3H9z" /><path d="M9 11h6M9 15h4" /></>),
  medal: I(<><circle cx="12" cy="9" r="6" /><path d="M8.5 14L7 22l5-3 5 3-1.5-8" /></>),
  grid: I(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
  gear: I(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>),
  help: I(<><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>),
  menu: I(<path d="M3 6h18M3 12h18M3 18h18" />),
};

interface Item { to: string; label: string; icon: ReactNode; on: (p: string) => boolean }
const starts = (...ps: string[]) => (p: string) => ps.some((x) => p === x || p.startsWith(`${x}/`));
const exact = (...ps: string[]) => (p: string) => ps.includes(p);
export const MENU: { group: string; items: Item[] }[] = [
  { group: '예배 준비', items: [
    { to: '/', label: '이번 주 준비함', icon: ICON.home, on: (p) => p === '/' || p.startsWith('/week/') },
    { to: '/songs', label: '찬양 자료', icon: ICON.music, on: starts('/songs') },
  ] },
  { group: '사람 돌봄', items: [
    { to: '/people', label: '성도 명부', icon: ICON.people, on: exact('/people', '/people/list') },
    { to: '/people/visits', label: '심방', icon: ICON.heart, on: starts('/people/visits') },
    { to: '/people/attendance', label: '출석', icon: ICON.check, on: starts('/people/attendance') },
    { to: '/admin/serve', label: '봉사 배정', icon: ICON.list, on: starts('/admin/serve') },
  ] },
  { group: '재정', items: [
    { to: '/finance', label: '장부', icon: ICON.card, on: exact('/finance', '/finance/ledger') },
    { to: '/finance/report', label: '보고서·예산', icon: ICON.chart, on: starts('/finance/report') },
    { to: '/finance/receipts', label: '기부금 영수증', icon: ICON.receipt, on: starts('/finance/receipts') },
    { to: '/finance/settings', label: '항목·가져오기', icon: ICON.list, on: starts('/finance/settings') },
  ] },
  { group: '행정·문서', items: [
    { to: '/admin', label: '일정', icon: ICON.calendar, on: exact('/admin', '/admin/calendar') },
    { to: '/admin/minutes', label: '회의록', icon: ICON.clip, on: starts('/admin/minutes') },
    { to: '/admin/certs', label: '증명서', icon: ICON.medal, on: starts('/admin/certs') },
  ] },
  { group: '설정·도움', items: [
    { to: '/apps', label: '프로그램', icon: ICON.grid, on: starts('/apps') },
    { to: '/settings', label: '설정', icon: ICON.gear, on: starts('/settings') },
    { to: '/guide', label: '사용설명서', icon: ICON.help, on: starts('/guide') },
  ] },
];

/** 화면 크게 보기 (글자 16px → 18px). 이 컴퓨터에만 기억한다 */
export function useBigText() {
  const [big, setBig] = useState(() => { try { return localStorage.getItem('bigText') === '1'; } catch { return false; } });
  useEffect(() => {
    document.documentElement.classList.toggle('big-text', big);
    try { localStorage.setItem('bigText', big ? '1' : '0'); } catch { /* 기억 못 해도 지금은 적용 */ }
  }, [big]);
  return [big, setBig] as const;
}

export function SideMenu({ church, ws, setWs }: { church: string; ws: Ws; setWs: (w: Ws) => void }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);   // 좁은 화면에서 펼침
  const [big, setBig] = useBigText();
  useEffect(() => { setOpen(false); }, [pathname]);
  return (
    <aside className={`side ${open ? 'open' : ''}`}>
      <div className="side-head">
        <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true">라</span><span className="brand-text">라온 교회 올인원{church ? <small>{church}</small> : null}</span></Link>
        <button className="side-toggle" aria-expanded={open} aria-controls="side-menu" onClick={() => setOpen(!open)}>{ICON.menu}<span>메뉴</span></button>
      </div>
      <nav id="side-menu" className="side-nav" aria-label="주 메뉴">
        {MENU.map((g) => (
          <div key={g.group} className="side-group">
            <span className="side-group-name">{g.group}</span>
            {g.items.map((it) => {
              const on = it.on(pathname);
              return <Link key={it.to} to={it.to} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined}>{it.icon}<span>{it.label}</span></Link>;
            })}
          </div>
        ))}
        <div className="side-foot">
          <div className="ws-toggle" role="group" aria-label="자료 선택">
            <button className={ws === 'real' ? 'on' : ''} aria-pressed={ws === 'real'} onClick={() => setWs('real')}>우리 교회</button>
            <button className={ws === 'sample' ? 'on sample' : ''} aria-pressed={ws === 'sample'} onClick={() => setWs('sample')}>예제</button>
          </div>
          <label className="check big-toggle"><input type="checkbox" checked={big} onChange={(e) => setBig(e.target.checked)} />화면 크게 보기</label>
        </div>
      </nav>
    </aside>
  );
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** 오늘과 이번 주일(오늘이 주일이면 오늘). D-n */
export function weekLine(now = new Date()) {
  const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((7 - now.getDay()) % 7));
  const d = Math.round((sun.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
  return { today: `${now.getMonth() + 1}월 ${now.getDate()}일 (${DOW[now.getDay()]})`, sunday: `${sun.getMonth() + 1}월 ${sun.getDate()}일`, sundayYmd: ymd(sun), dday: d === 0 ? '오늘' : `D-${d}` };
}

/** 위쪽 한 줄: 교회 이름 · 오늘 · 이번 주일. 오른쪽에 잠그기·새 버전 */
export function TopLine({ church, ws, children }: { church: string; ws: Ws; children?: ReactNode }) {
  const w = weekLine();
  return (
    <header className={`top ${ws === 'sample' ? 'is-sample' : ''}`}>
      <p className="top-context">
        {church && <b>{church}</b>}
        {ws === 'sample' && <span className="pill todo">예제</span>}
        <span className="muted"> · {w.today} · 이번 주일 {w.sunday} </span>
        <span className="dday">{w.dday}</span>
      </p>
      <div className="top-actions">{children}</div>
    </header>
  );
}

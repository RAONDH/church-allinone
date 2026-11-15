import type { Song, Week, WeekStatus } from './types';

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function sundayOf(d = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + ((7 - x.getDay()) % 7));
  return ymd(x);
}
export const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export function fmtDate(s: string) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;
}
export const fmtTime = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** 이번 주 = 다가오는 주일(오늘이 주일이면 오늘)까지의 7일 */
export function splitWeeks(weeks: Week[], today = new Date()) {
  const sun = sundayOf(today), start = addDays(sun, -6);
  const sorted = [...weeks].sort((a, b) => a.date.localeCompare(b.date));
  const thisWeek = sorted.filter((w) => w.date >= start && w.date <= sun);
  const primary = thisWeek.find((w) => w.date === sun) || thisWeek[0] || null;
  const previous = sorted.filter((w) => w.date < start).pop() || null;
  const upcoming = sorted.filter((w) => w.date > sun);
  return { sun, start, thisWeek, primary, previous, upcoming };
}

export type Level = 'done' | 'todo' | 'warn' | 'info' | 'unknown';
export interface Step { key: string; label: string; level: Level; text: string; tab: string; action?: string }

/** 실제 저장된 내용과 예배송출 상태로 준비 상태를 계산한다 (추측으로 '완료'를 표시하지 않음) */
export function prepSteps(w: Week, st: WeekStatus | null): Step[] {
  const steps: Step[] = [];
  const info = !!(w.passage.trim() && w.sermonTitle.trim());
  steps.push({ key: 'info', label: '예배 정보', tab: 'info', level: info ? 'done' : 'todo',
    text: info ? `${w.passage} · ${w.sermonTitle}` : !w.passage.trim() && !w.sermonTitle.trim() ? '본문과 설교 제목을 입력하세요' : !w.passage.trim() ? '본문을 입력하세요' : '설교 제목을 입력하세요',
    action: '예배 정보 입력' });

  if (!st) {
    steps.push({ key: 'setlist', label: '찬양 콘티', tab: 'setlist', level: 'unknown', text: '확인 중…' });
    steps.push({ key: 'subs', label: '자막', tab: 'subs', level: 'unknown', text: '확인 중…' });
  } else if (!st.linked) {
    steps.push({ key: 'setlist', label: '찬양 콘티', tab: 'info', level: 'todo', text: '예배송출 예배 순서와 아직 연결되지 않았습니다', action: '예배송출과 연결' });
    steps.push({ key: 'subs', label: '자막', tab: 'info', level: 'todo', text: '예배송출과 연결하면 순서 자막이 만들어집니다', action: '예배송출과 연결' });
  } else if (st.connected === false) {
    steps.push({ key: 'setlist', label: '찬양 콘티', tab: 'setlist', level: 'unknown', text: '예배송출이 꺼져 있어 확인할 수 없습니다' });
    steps.push({ key: 'subs', label: '자막', tab: 'subs', level: 'unknown', text: '예배송출이 꺼져 있어 확인할 수 없습니다' });
  } else if (st.missing || !st.summary) {
    steps.push({ key: 'setlist', label: '찬양 콘티', tab: 'info', level: 'warn', text: '연결된 예배 순서가 예배송출에서 지워졌습니다', action: '다시 연결' });
    steps.push({ key: 'subs', label: '자막', tab: 'info', level: 'warn', text: '연결된 예배 순서가 예배송출에서 지워졌습니다', action: '다시 연결' });
  } else {
    const s = st.summary;
    steps.push({ key: 'setlist', label: '찬양 콘티', tab: 'setlist',
      level: s.songCount === 0 ? 'todo' : s.songsWithoutLyrics.length ? 'warn' : 'done',
      text: s.songCount === 0 ? '아직 곡이 없습니다' : s.songsWithoutLyrics.length ? `${s.songCount}곡 · 가사 없는 곡: ${s.songsWithoutLyrics.join(', ')}` : `${s.songCount}곡 준비됨${s.songsWithoutKey.length ? ` (조성 미입력 ${s.songsWithoutKey.length}곡)` : ''}`,
      action: s.songCount === 0 ? '곡 고르기' : '콘티 확인' });
    const f = st.final?.state || 'none';
    const ph = s.placeholders;
    steps.push({ key: 'subs', label: '자막', tab: ph.length ? 'info' : 'subs',
      level: ph.length ? 'warn' : f === 'same' ? 'done' : f === 'changed' ? 'warn' : 'todo',
      text: ph.length ? `채울 칸 ${ph.length}곳: ${ph.map((p) => `${p.title} ${p.text}`).join(', ')}`
        : f === 'same' ? `확정됨 (${fmtTime(st.final!.at!)}) · 화면 ${s.slideTotal}장`
        : f === 'changed' ? `확정 뒤에 바뀐 곳이 있습니다: ${(st.final!.changes || []).join(', ') || '내용 변경'}`
        : `화면 ${s.slideTotal}장 준비됨 · 아직 확정 전`,
      action: ph.length ? '빈칸 채우기' : f === 'same' ? undefined : '자막 확정' });
  }
  const notes = w.sermonNotes.trim();
  steps.push({ key: 'sermon', label: '설교 자료', tab: 'info', level: notes ? 'done' : 'todo', text: notes ? `원고·요지 등록됨 (${notes.length.toLocaleString()}자)` : '설교 원고나 요지를 붙여 넣으세요', action: '설교 자료 등록' });
  return steps;
}

export const nextStep = (steps: Step[]) => steps.find((s) => s.level === 'todo' || s.level === 'warn') || null;

/** 카카오톡 등에 붙여 넣을 콘티 글 (가사는 빼고) */
export function setlistText(w: Week, st: WeekStatus | null) {
  const songs = st?.summary?.items.filter((i) => i.type === 'song' || i.type === 'score') || [];
  const lines = [`[${fmtDate(w.date)} ${w.name}] 찬양 콘티`];
  if (w.passage || w.sermonTitle) lines.push(`말씀: ${[w.passage, w.sermonTitle && `「${w.sermonTitle}」`].filter(Boolean).join(' ')}`);
  lines.push('');
  songs.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title}${s.key ? ` (${s.key})` : ''}`);
    if (s.arr.length) lines.push(`   └ ${s.arr.join(' → ')}`);
    if (s.memo) lines.push(`   └ ${s.memo}`);
  });
  if (st?.summary?.note) lines.push('', `메모: ${st.summary.note}`);
  return lines.join('\n');
}

/** 곡 제목 비교용: [예제]·괄호·띄어쓰기·문장부호 무시 */
export const norm = (s: string) => s.replace(/\[예제\]|\(.*?\)|[\s·\-_,.!?'"]/g, '').toLowerCase();

/** 추천곡 제목과 찬양 자료(예배송출) 곡 맞추기: 같으면 그 곡들, 없으면 한쪽이 다른 쪽을 포함하는 곡(4글자 이상)을 후보로 */
export function matchSongs(title: string, songs: Song[]) {
  const t = norm(title);
  if (!t) return [];
  const exact = songs.filter((s) => norm(s.title) === t);
  if (exact.length) return exact;
  return t.length >= 4 ? songs.filter((s) => { const n = norm(s.title); return n.length >= 4 && (n.includes(t) || t.includes(n)); }) : [];
}

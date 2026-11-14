// 행정 계산 (달력·다가오는 일정)
import type { ChurchEvent } from './types';
import { addDays, ymd } from './week';

/** 그달 달력: 일요일부터 시작하는 주 단위 날짜 목록 */
export function monthGrid(month: string): string[][] {
  const first = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1, 1);
  let d = addDays(ymd(first), -first.getDay());
  const weeks: string[][] = [];
  do {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    d = addDays(d, 7);
  } while (d.slice(0, 7) === month);
  return weeks;
}

/** 그날 걸쳐 있는 일정 (여러 날 일정 포함), 시간순 */
export function eventsOn(events: ChurchEvent[], day: string) {
  return events.filter((e) => e.date <= day && (e.endDate || e.date) >= day).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}

/** 오늘부터 n일 안에 걸치는 일정 */
export function upcomingEvents(events: ChurchEvent[], today: string, days: number) {
  const end = addDays(today, days);
  return events.filter((e) => (e.endDate || e.date) >= today && e.date <= end).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
}

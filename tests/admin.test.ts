import { describe, expect, it } from 'vitest';
// @ts-ignore 서버 모듈은 JS
import { cleanEvent, cleanMinutes } from '../server/admin.mjs';
import { eventsOn, monthGrid, upcomingEvents } from '../src/lib/admin';
import type { ChurchEvent } from '../src/lib/types';

const E = (p: Partial<ChurchEvent>): ChurchEvent => ({ id: Math.random().toString(16).slice(2), date: '2026-11-20', endDate: '', time: '', title: 't', kind: '행사', place: '', memo: '', ...p });

describe('행정', () => {
  it('달력은 일요일부터, 그달을 모두 덮는다', () => {
    const g = monthGrid('2026-11');   // 11/1 이 일요일
    expect(g[0][0]).toBe('2026-11-01');
    expect(g.at(-1)!.at(-1)).toBe('2026-12-05');
    const f = monthGrid('2026-08');   // 8/1 토요일
    expect(f[0][0]).toBe('2026-07-26');
    expect(f.length).toBe(6);
  });
  it('여러 날 일정과 다가오는 일정', () => {
    const evs = [E({ title: 'a', date: '2026-11-21', endDate: '2026-11-22' }), E({ title: 'b', date: '2026-11-22', time: '09:00' }), E({ title: 'c', date: '2026-12-30' })];
    expect(eventsOn(evs, '2026-11-22').map((e) => e.title)).toEqual(['b', 'a']);
    expect(upcomingEvents(evs, '2026-11-22', 7).map((e) => e.title)).toEqual(['a', 'b']);
  });
  it('입력 정리', () => {
    expect(cleanEvent({ date: '2026.11.20', title: ' 제직회 ', kind: 'x', time: '13:30', endDate: '2026-11-20' })).toMatchObject({ date: '2026-11-20', endDate: '', title: '제직회', kind: '기타', time: '13:30' });
    expect(() => cleanEvent({ date: '2026-11-20', title: 'a', endDate: '2026-11-19' })).toThrow();
    expect(() => cleanEvent({ date: '', title: 'a' })).toThrow();
    expect(cleanMinutes({ date: '2026-11-01', meeting: '' }).meeting).toBe('회의');
  });
});

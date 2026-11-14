import { describe, expect, it } from 'vitest';
// @ts-ignore 서버 모듈은 JS
import { toIcs, parseIcs, expandRule, parseWhen } from '../server/ical.mjs';
// @ts-ignore
import { checkIcsUrl } from '../server/admin.mjs';

const G = (body: string) => `BEGIN:VCALENDAR\r\n${body}\r\nEND:VCALENDAR`;
describe('구글 캘린더 (.ics)', () => {
  it('내보낸 파일을 다시 읽으면 우리 일정은 빠진다 (겹침 방지)', () => {
    const ics = toIcs([{ id: 'a', date: '2026-11-20', endDate: '', time: '13:30', title: '제직회, 결산', kind: '회의', place: '', memo: '' }]);
    expect(ics).toContain('SUMMARY:제직회\\, 결산');
    expect(ics).toContain('UID:a@church-allinone');
    expect(parseIcs(ics, { from: '2026-11-01', to: '2026-12-31' })).toEqual([]);
  });
  it('하루 종일·여러 날·UTC 시각', () => {
    const r = parseIcs(G('BEGIN:VEVENT\r\nUID:1\r\nDTSTART;VALUE=DATE:20261224\r\nDTEND;VALUE=DATE:20261226\r\nSUMMARY:성탄\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:2\r\nDTSTART:20261116T010000Z\r\nDTEND:20261116T020000Z\r\nSUMMARY:아침\r\nEND:VEVENT'), { from: '2026-11-01', to: '2026-12-31' });
    expect(r.map((e: any) => [e.date, e.endDate, e.title])).toEqual([['2026-11-16', '', '아침'], ['2026-12-24', '2026-12-25', '성탄']]);
    expect(parseWhen('20261116T010000Z').date).toBe('2026-11-16');
  });
  it('반복 일정: 매주·횟수·제외·옮긴 날', () => {
    const r = parseIcs(G('BEGIN:VEVENT\r\nUID:x\r\nDTSTART;VALUE=DATE:20261102\r\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5\r\nEXDATE;VALUE=DATE:20261109\r\nSUMMARY:구역\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:x\r\nRECURRENCE-ID;VALUE=DATE:20261116\r\nDTSTART;VALUE=DATE:20261117\r\nSUMMARY:구역(옮김)\r\nEND:VEVENT'), { from: '2026-11-01', to: '2026-12-31' });
    expect(r.map((e: any) => e.date + e.title)).toEqual(['2026-11-02구역', '2026-11-17구역(옮김)', '2026-11-23구역', '2026-11-30구역']);
  });
  it('매월 둘째 주일, 마지막 금요일, 격주', () => {
    expect(expandRule('2026-01-11', 'FREQ=MONTHLY;BYDAY=2SU', '2026-11-01', '2027-01-31')).toEqual(['2026-11-08', '2026-12-13', '2027-01-10']);
    expect(expandRule('2026-01-30', 'FREQ=MONTHLY;BYDAY=-1FR', '2026-11-01', '2026-12-31')).toEqual(['2026-11-27', '2026-12-25']);
    expect(expandRule('2026-11-01', 'FREQ=WEEKLY;INTERVAL=2', '2026-11-01', '2026-11-30')).toEqual(['2026-11-01', '2026-11-15', '2026-11-29']);
  });
  it('비공개 주소 확인', () => {
    expect(checkIcsUrl('https://calendar.google.com/calendar/ical/a%40gmail.com/private-x/basic.ics')).toContain('calendar.google.com');
    expect(() => checkIcsUrl('http://calendar.google.com/a.ics')).toThrow();
    expect(() => checkIcsUrl('https://127.0.0.1/a.ics')).toThrow();
    expect(() => checkIcsUrl('https://localhost/a.ics')).toThrow();
    expect(() => checkIcsUrl('https://calendar.google.com/calendar/embed?src=x')).toThrow();
    expect(() => checkIcsUrl('https://evil.example.com/basic.ics')).toThrow();
    expect(() => checkIcsUrl('https://calendar.google.com.evil.com/a.ics')).toThrow();
    expect(() => checkIcsUrl('https://calendar.google.com:8443/a.ics')).toThrow();
  });
});

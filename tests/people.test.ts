import { describe, expect, it } from 'vitest';
// @ts-ignore 서버 모듈은 JS
import { normDate, cleanMember, membersCsv } from '../server/people.mjs';
// @ts-ignore
import { samplePeopleSeed } from '../server/sample.mjs';
import { nextBirthday, upcomingBirthdays, dueVisits, absentees, attendanceWeeks, parsePaste, lastSunday, ageOf } from '../src/lib/people';
import type { Member, People } from '../src/lib/types';
import { lunarToSolar } from '../src/lib/lunar';
// @ts-ignore 서버 모듈은 JS
import { lunarToSolar as serverLunar } from '../server/lunar.mjs';
// @ts-ignore 서버 모듈은 JS
import { bulletinData } from '../server/bulletin.mjs';

const M = (p: Partial<Member>): Member => ({ id: 'x', name: '가', gender: '', birth: '', lunar: false, phone: '', address: '', role: '', group: '', baptism: '', registeredAt: '', status: 'active', familyId: '', relation: '', memo: '', createdAt: 0, updatedAt: 0, ...p });

describe('성도 명부', () => {
  it('여러 날짜 모양을 맞춘다', () => {
    expect(normDate('1965.3.2')).toBe('1965-03-02');
    expect(normDate('19650302')).toBe('1965-03-02');
    expect(normDate('1965년 3월 2일')).toBe('1965-03-02');
    expect(normDate('3/2', { monthDayOk: true })).toBe('03-02');
    expect(normDate('3/2')).toBe('');
    expect(normDate('1965-02-30')).toBe('');
  });
  it('성별·음력·상태를 정리한다', () => {
    const m = cleanMember({ name: ' 홍길동 ', gender: '남자', lunar: '음력', status: 'xx' });
    expect(m).toMatchObject({ name: '홍길동', gender: '남', lunar: true, status: 'active' });
  });
  it('다가오는 생일과 나이 (해 넘김·윤년)', () => {
    expect(nextBirthday('1962-11-16', '2026-11-14')).toEqual({ date: '2026-11-16', days: 2, age: 64 });
    expect(nextBirthday('01-03', '2026-12-30')).toEqual({ date: '2027-01-03', days: 4, age: null });
    expect(nextBirthday('2000-02-29', '2027-02-20')?.date).toBe('2027-02-28');
    expect(ageOf('1962-11-16', '2026-11-14')).toBe(63);
  });
  it('예제 성도로 홈 화면 알림이 계산된다', () => {
    const seed = samplePeopleSeed(new Date(2026, 10, 14));
    const p: People = { members: Object.values(seed.members), visits: Object.values(seed.visits), attendance: seed.attendance };
    expect(upcomingBirthdays(p.members, '2026-11-14').map((x) => x.m.name)).toEqual(['김믿음', '김하늘']);
    expect(dueVisits(p.visits, '2026-11-14').length).toBe(2);
    expect(absentees(p, '2026-11-14').map((m) => m.name)).toEqual(['정사랑', '윤온유']);
  });
  it('출석 기록이 3번이 안 되면 결석 알림 없음, 새로 등록한 분은 뺌', () => {
    const p: People = { members: [M({ id: 'a' }), M({ id: 'b', registeredAt: '2026-11-08' })], visits: [], attendance: { '2026-10-25': [], '2026-11-01': [] } };
    expect(absentees(p, '2026-11-14')).toEqual([]);
    p.attendance['2026-11-08'] = [];
    expect(absentees(p, '2026-11-14').map((m) => m.id)).toEqual(['a']);
  });
  it('3주 연속 결석은 서로 다른 3주로 센다 (한 주에 여러 번 기록해도 한 주, 그 주 아무 예배에 왔으면 출석)', () => {
    const p: People = { members: [M({ id: 'a' }), M({ id: 'b' })], visits: [], attendance: { '2026-11-08': ['b'], '2026-11-11': ['b'], '2026-11-13': [] } };
    expect(attendanceWeeks(p, '2026-11-14')).toBe(1);
    expect(absentees(p, '2026-11-14')).toEqual([]);              // 한 주 안의 기록 3번은 3주가 아님
    p.attendance['2026-10-25'] = ['b']; p.attendance['2026-11-04'] = ['a'];   // 수요일에만 온 주
    expect(attendanceWeeks(p, '2026-11-14')).toBe(3);
    expect(absentees(p, '2026-11-14')).toEqual([]);              // a 는 11월 첫 주 수요일에 왔음
    p.attendance['2026-11-04'] = [];
    expect(absentees(p, '2026-11-14').map((m) => m.id)).toEqual(['a']);
  });
  it('음력 생일은 그해 양력 날짜로 바꿔 알린다 (설날·윤달·작은 달, 화면과 주보가 같은 계산)', () => {
    expect(nextBirthday('1960-01-01', '2026-11-19', { lunar: true })?.date).toBe('2027-02-07');   // 음력 1/1 = 2027 설날
    expect(nextBirthday('1960-01-01', '2026-11-19')?.date).toBe('2027-01-01');                   // 양력은 그대로
    expect(nextBirthday('12-20', '2027-01-10', { lunar: true })?.date).toBe('2027-01-27');       // 지난해 음력 12/20 이 올해 1월
    expect(nextBirthday('1990-06-10', '2025-07-01', { lunar: true })?.date).toBe('2025-07-04');
    expect(nextBirthday('1990-06-10', '2025-07-10', { lunar: true, lunarLeap: true })?.date).toBe('2025-08-03'); // 2025 윤6월
    expect(nextBirthday('1990-06-10', '2026-07-01', { lunar: true, lunarLeap: true })?.date).toBe('2026-07-23'); // 윤달 없는 해는 평달
    expect(upcomingBirthdays([M({ id: 'l', birth: '1960-01-01', lunar: true }), M({ id: 's', birth: '1960-01-01' })], '2027-02-05').map((x) => x.m.id)).toEqual(['l']);
    for (let y = 2024; y <= 2030; y++) for (const [m, d, lp] of [[1, 1, false], [4, 30, false], [6, 10, true], [12, 30, false]] as const)
      expect(serverLunar(y, m, d, lp)).toBe(lunarToSolar(y, m, d, lp));
    const db = { members: { a: { name: '음력분', birth: '1960-01-01', lunar: true, status: 'active' }, b: { name: '양력분', birth: '1960-01-01', status: 'active' } }, events: {} };
    expect(bulletinData({ db, week: { id: 'w', date: '2027-02-07' }, order: [] }).birthdays.map((b: any) => [b.name, b.date])).toEqual([['음력분', '2027-02-07']]);
  });
  it('엑셀 붙여 넣기 (탭·쉼표, 칸 이름 인식)', () => {
    const r = parsePaste('성명\t연락처\t생년월일\t목장\t비고칸\n홍길동\t010-1\t1970.1.1\t1목장\tx\n\n김철수\t\t\t\t');
    expect(r.rows).toEqual([{ name: '홍길동', phone: '010-1', birth: '1970.1.1', group: '1목장' }, { name: '김철수' }]);
    expect(r.unknown).toEqual(['비고칸']);
    expect(parsePaste('이름,메모\n"이, 영희","말씀 ""좋아요"""').rows).toEqual([{ name: '이, 영희', memo: '말씀 "좋아요"' }]);
    expect(parsePaste('홍길동\n김철수').rows.map((x) => x.name)).toEqual(['홍길동', '김철수']);
  });
  it('CSV 내보내기는 엑셀 수식이 실행되지 않게 막는다', () => {
    const csv = membersCsv({ members: { a: { ...M({ id: 'a', name: '=HYPERLINK("x")', memo: '줄\n바꿈' }) } } });
    expect(csv.startsWith('﻿이름,')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it('지난 주일', () => {
    expect(lastSunday('2026-11-14')).toBe('2026-11-08');
    expect(lastSunday('2026-11-15')).toBe('2026-11-15');
  });
});

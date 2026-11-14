import { describe, expect, it } from 'vitest';
// @ts-ignore 서버 모듈은 JS
import { normDate, cleanMember, membersCsv } from '../server/people.mjs';
// @ts-ignore
import { samplePeopleSeed } from '../server/sample.mjs';
import { nextBirthday, upcomingBirthdays, dueVisits, absentees, parsePaste, lastSunday, ageOf } from '../src/lib/people';
import type { Member, People } from '../src/lib/types';

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

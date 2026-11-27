import { describe, expect, it } from 'vitest';
// @ts-ignore 서버 모듈은 JS
import { importLedger, emptyFinance, cleanTx, financeCsv, matchMember } from '../server/finance.mjs';
import { balances, budgetKey, budgetOf, donors, isReceiptCat, donorMonths, monthly, parseWon, totals } from '../src/lib/finance';
import type { Member, Tx } from '../src/lib/types';

const M = (id: string, name: string): Member => ({ id, name, gender: '', birth: '', lunar: false, phone: '', address: '주소' + id, role: '', group: '', baptism: '', registeredAt: '', status: 'active', familyId: '', relation: '', memo: '', createdAt: 0, updatedAt: 0 });
const T = (p: Partial<Tx>): Tx => ({ id: Math.random().toString(16).slice(2), date: '2026-03-01', type: 'income', fund: '일반재정', category: '십일조', name: '', memberId: '', amount: 10000, note: '', createdAt: 0, updatedAt: 0, ...p });

describe('재정', () => {
  it('금액 입력을 알아듣는다', () => {
    expect(parseWon('30,000원')).toBe(30000);
    expect(parseWon('3만')).toBe(30000);
    expect(parseWon('3만5천')).toBe(35000);
    expect(parseWon('1억2천만')).toBe(120000000);
    expect(parseWon('abc')).toBe(0);
  });
  it('금액: 소수점(3.5만)·원정·₩도 알아듣고, 못 읽는 글은 0', () => {
    expect(parseWon('3.5만')).toBe(35000);
    expect(parseWon('3만원정')).toBe(30000);
    expect(parseWon('₩ 12,500')).toBe(12500);
    expect(parseWon('1.25억')).toBe(125000000);
    expect(parseWon('삼만')).toBe(0);
  });
  it('이달 합계: 이월금은 수입에 넣지 않고 따로 (보고서 월별 수입과 같은 숫자)', () => {
    const tx = [T({ category: '일반이월금', date: '2026-01-01', amount: 5000000 }), T({ date: '2026-01-04', amount: 50000 }), T({ type: 'expense', category: '교제비', date: '2026-01-05', amount: 20000 })];
    expect(totals(tx, '2026-01-01', '2026-01-31')).toMatchObject({ income: 50000, carry: 5000000, expense: 20000, net: 30000 });
    expect(totals(tx, '2026-01-01', '2026-01-31').income).toBe(monthly(tx, '2026')[0].income);
  });
  it('예산: 이름이 같은 항목도 수입/지출·재정마다 따로, 예전(이름만) 예산도 읽는다', () => {
    const b = { [budgetKey('income', '일반재정', '기타')]: 100, [budgetKey('expense', '일반재정', '기타')]: 200, 선교: 300 };
    expect(budgetOf(b, 'income', '일반재정', '기타')).toBe(100);
    expect(budgetOf(b, 'expense', '일반재정', '기타')).toBe(200);
    expect(budgetOf(b, 'expense', '특별재정', '선교')).toBe(300);   // 예전 방식
    expect(budgetOf({ ...b, [budgetKey('expense', '특별재정', '선교')]: 0 }, 'expense', '특별재정', '선교')).toBe(0);   // 새 칸이 있으면 그것
  });
  it('잔액·기간 합계', () => {
    const tx = [T({ category: '일반이월금', date: '2026-01-01', amount: 100 }), T({ amount: 50 }), T({ type: 'expense', category: '교제비', amount: 30 }), T({ fund: '특별재정', amount: 7, date: '2026-04-01' })];
    expect(balances(tx, '2026-03-31')).toEqual({ 일반재정: 120, 특별재정: 0, 지정재정: 0 });
    expect(totals(tx, '2026-03-01', '2026-03-31')).toMatchObject({ income: 50, expense: 30, net: 20 });
    expect(monthly(tx, '2026')[0].income).toBe(0);   // 이월금 제외
  });
  it('영수증: 성도 기준으로 모으고 이월금·무명은 뺀다', () => {
    const ms = [M('a', '홍길동')];
    const tx = [T({ memberId: 'a', name: '홍길동', amount: 10 }), T({ memberId: 'a', name: '옛이름', date: '2026-05-02', amount: 5 }), T({ name: '무명', amount: 99 }), T({ name: '김철수', amount: 3 }), T({ category: '일반이월금', name: '홍길동', amount: 1000 }), T({ memberId: 'a', date: '2025-12-31', amount: 1 })];
    const d = donors(tx, '2026', ms);
    expect(d.map((x) => [x.name, x.total, !!x.member])).toEqual([['김철수', 3, false], ['홍길동', 15, true]]);
    expect(donorMonths(d[1])).toEqual([['2026-03', 10], ['2026-05', 5]]);
  });
  it('기록 정리: 동명이인은 연결하지 않음, 잘못된 금액은 막음', () => {
    const db = { members: { a: M('a', '홍길동'), b: M('b', '김영희'), c: M('c', '김영희') } };
    expect(matchMember(db, '홍길동')).toBe('a');
    expect(matchMember(db, '김영희')).toBe('');
    expect(cleanTx({ date: '2026.3.1', type: 'income', fund: 'x', category: '십일조', name: '홍길동', amount: '1,000' }, db)).toMatchObject({ date: '2026-03-01', fund: '일반재정', memberId: 'a', amount: 1000 });
    expect(() => cleanTx({ date: '2026-03-01', category: '십일조', amount: 0 }, db)).toThrow();
    expect(cleanTx({ date: '2026-03-01', type: 'expense', category: '교제비', name: '홍길동', amount: 5 }, db).memberId).toBe('');
  });
  it('기존 회계장부 백업 가져오기: 항목 추가, 두 번 넣어도 겹치지 않음, 예산', () => {
    const db: any = { members: { a: M('a', '홍길동') }, finance: emptyFinance() };
    const backup = { transactions: [
      { id: 1, date: '2026-02-01', type: 'income', financeType: '특별재정', category: '씨앗헌금(특별)', name: '홍길동', amount: 50000, note: '' },
      { id: 2, date: '2026-02-03', type: 'expense', financeType: '일반재정', category: '서무비', name: '문구점', amount: 12000, note: '복사지' },
      { id: 3, date: '', type: 'income', category: '감사헌금', amount: 1 },
    ], budgets: { 서무비: 300000 } };
    expect(importLedger(db, backup, 2026)).toEqual({ added: 2, skipped: 0, bad: 1, budget: true });
    expect(importLedger(db, backup, 2026)).toMatchObject({ added: 0, skipped: 2 });
    expect(db.finance.settings.categories.income.특별재정).toContain('씨앗헌금(특별)');
    expect(Object.values<any>(db.finance.tx).find((t) => t.name === '홍길동').memberId).toBe('a');
    expect(db.finance.budgets[2026]).toEqual({ 서무비: 300000 });
    const csv = financeCsv(db, '2026');
    expect(csv.split('\r\n')[1]).toBe('2026-02-01,수입,특별재정,씨앗헌금(특별),홍길동,50000,,');
  });
});

describe('영수증 주소', () => {
  it('이름만 적힌 기록도 명부에 같은 이름이 한 분뿐이면 그 성도(주소)로 모인다', () => {
    const ms = [M('a', '홍길동'), M('b', '김영희'), M('c', '김영희')];
    const d = donors([T({ name: '홍길동', amount: 5 }), T({ memberId: 'a', amount: 1 }), T({ name: '김영희', amount: 2 })], '2026', ms);
    expect(d.map((x) => [x.name, x.total, x.member?.address || ''])).toEqual([['김영희', 2, ''], ['홍길동', 6, '주소a']]);
  });
});

describe('기부금 영수증 대상·동명이인', () => {
  it('차입금·이자·기타수입처럼 헌금이 아닌 수입은 이름이 있어도 영수증 합계에 넣지 않고, 항목마다 바꿀 수 있다', () => {
    const ms = [M('a', '홍길동')];
    const tx = [T({ memberId: 'a', category: '십일조', amount: 100 }), T({ memberId: 'a', category: '차입금', amount: 1000000 }), T({ memberId: 'a', category: '기타수입', amount: 7 }), T({ memberId: 'a', category: '건축헌금', amount: 20 })];
    expect(donors(tx, '2026', ms)[0].total).toBe(120);
    expect(donors(tx, '2026', ms, { 기타수입: true })[0].total).toBe(127);   // 항목 탭에서 넣기로 정함
    expect(donors(tx, '2026', ms, { 건축헌금: false })[0].total).toBe(100);
    expect(['주일헌금', '십일조', '차입금', '이자수입', '일반이월금'].map((c) => isReceiptCat(c))).toEqual([true, true, false, false, false]);
  });
  it('명부에 같은 이름이 두 분인데 어느 분인지 이어 두지 않은 헌금은 한 사람 것으로 합치지 않고 확인 필요로 둔다', () => {
    const ms = [M('a', '김영희'), M('b', '김영희')];
    const d = donors([T({ name: '김영희', amount: 5 }), T({ name: '김영희', amount: 7 }), T({ memberId: 'b', name: '김영희', amount: 3 })], '2026', ms);
    const amb = d.find((x) => x.ambiguous)!;
    expect([amb.total, amb.member]).toEqual([12, null]);
    expect(d.find((x) => x.member?.id === 'b')?.total).toBe(3);   // 어느 분인지 고른 기록은 그분 것으로
  });
});

describe('이월금과 잔액', () => {
  it('새해 이월금을 적으면 그날부터 새로 세어, 지난해 잔액이 두 번 더해지지 않는다', () => {
    const tx = [
      T({ category: '일반이월금', date: '2025-01-01', amount: 300000 }), T({ date: '2025-06-01', amount: 900000 }), T({ type: 'expense', category: '교제비', date: '2025-07-01', amount: 200000 }),
      T({ category: '일반이월금', date: '2026-01-01', amount: 1000000 }), T({ date: '2026-01-04', amount: 50000 }),
      T({ fund: '특별재정', category: '선교헌금', date: '2025-03-01', amount: 7 }),
    ];
    expect(balances(tx, '2025-12-31').일반재정).toBe(1000000);    // 지난해 말 잔액
    expect(balances(tx, '2026-01-31').일반재정).toBe(1050000);    // 예전에는 2,050,000 (지난해 잔액 + 이월금)
    expect(balances(tx, '2026-01-31').특별재정).toBe(7);          // 이월금이 없는 재정은 그대로 누적
  });
});


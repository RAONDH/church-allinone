import { describe, expect, it } from 'vitest';
// @ts-ignore 서버 모듈은 JS
import { applyServePlan, cleanServeRoles, DEFAULT_SERVE_ROLES } from '../server/admin.mjs';
import { autoFill, nextServe, serveOf, sundaysOf } from '../src/lib/serve';
import { memberHistory } from '../src/lib/people';
import type { Member, Serve } from '../src/lib/types';

const M = (id: string, name: string, p: Partial<Member> = {}): Member => ({ id, name, gender: '', birth: '', lunar: false, phone: '', address: '', role: '', group: '', baptism: '', registeredAt: '', status: 'active', familyId: '', relation: '', memo: '', createdAt: 0, updatedAt: 0, ...p });

describe('봉사 배정표', () => {
  it('그달의 주일', () => {
    expect(sundaysOf('2026-11')).toEqual(['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']);
    expect(sundaysOf('2026-12')[0]).toBe('2026-12-06');
  });
  it('지난번 다음 사람부터 돌아가며 채우고, 이미 채운 칸은 그대로 둔다', () => {
    const serve: Serve = { roles: [{ id: 'a', name: '안내', count: 2, pool: ['1', '2', '3'] }], plan: { '2026-10-25': { a: ['1', '2'] }, '2026-11-08': { a: ['x'] } } };
    const ch = autoFill(serve, ['2026-11-01', '2026-11-08', '2026-11-15']);
    expect(ch['2026-11-01'].a).toEqual(['3', '1']);
    expect(ch['2026-11-08']).toBeUndefined();   // 손으로 넣은 칸
    expect(ch['2026-11-15'].a).toEqual(['2', '3']);
  });
  it('같은 날 다른 봉사를 맡은 분은 되도록 건너뛰고, 쉬는 분은 빼고 돈다', () => {
    const serve: Serve = { roles: [{ id: 'p', name: '기도', count: 1, pool: ['1'] }, { id: 'o', name: '헌금', count: 1, pool: ['1', '2', '3'] }], plan: {} };
    expect(autoFill(serve, ['2026-11-01'])['2026-11-01']).toEqual({ p: ['1'], o: ['2'] });
    expect(autoFill(serve, ['2026-11-01'], new Set(['1', '3']))['2026-11-01']).toEqual({ p: ['1'], o: ['3'] });
  });
  it('맡는 분이 한 명뿐이면 겹쳐도 넣는다', () => {
    const serve: Serve = { roles: [{ id: 'p', name: '기도', count: 1, pool: ['1'] }, { id: 'o', name: '반주', count: 1, pool: ['1'] }], plan: {} };
    expect(autoFill(serve, ['2026-11-01'])['2026-11-01']).toEqual({ p: ['1'], o: ['1'] });
  });
  it('이번 주 봉사와 성도별 봉사', () => {
    const serve: Serve = { roles: [{ id: 'a', name: '안내', count: 1, pool: [] }], plan: { '2026-11-15': { a: ['1'] }, '2026-11-22': { a: ['2'] } } };
    expect(nextServe(serve, '2026-11-10')?.date).toBe('2026-11-15');
    expect(nextServe(serve, '2026-11-02')).toBeNull();   // 일주일 안에 없음
    expect(serveOf(serve, '2')).toEqual([{ date: '2026-11-22', role: '안내' }]);
  });
  it('서버: 봉사 종류 정리와 배정 저장', () => {
    expect(DEFAULT_SERVE_ROLES.map((r: any) => r.name)).toContain('헌금위원');
    expect(() => cleanServeRoles([{ name: '안내' }, { name: '안내' }])).toThrow(/두 번/);
    const roles = cleanServeRoles([{ id: 'd1', name: ' 안내 ', count: 9, pool: ['m1', 'zz', 'm1'] }, { id: 'BAD id', name: '반주' }], { m1: {} });
    expect(roles[0]).toEqual({ id: 'd1', name: '안내', count: 5, pool: ['m1'] });
    expect(roles[1].id).not.toBe('BAD id');
    const serve = { roles, plan: { '2026-11-01': { d1: ['m1'] } } as Record<string, any> };
    applyServePlan(serve, { '2026-11-08': { d1: ['m1', ' 홍길동 ', ''], nope: ['x'] }, '2026-11-01': {} });
    expect(serve.plan).toEqual({ '2026-11-08': { d1: ['m1', '홍길동'] } });
  });
});

describe('성도 기록 모아보기', () => {
  it('심방·출석·헌금·증명서·봉사·회의 참석을 날짜순으로 모은다', () => {
    const kim = M('k', '김믿음', { registeredAt: '2009-03-01', baptism: '세례', baptismDate: '1985-04-07', baptismPlace: '예제교회' });
    const p = { members: [kim], visits: [{ id: 'v', memberIds: ['k'], date: '2026-11-03', kind: '심방', planned: false, note: '가정 심방', createdAt: 0, updatedAt: 0 }], attendance: { '2026-11-01': ['k'], '2026-11-08': [], '2025-12-28': ['x'] } };
    const tx = [
      { id: 't1', date: '2026-11-01', type: 'income', fund: '일반재정', category: '십일조', name: '김믿음', memberId: 'k', amount: 100000, note: '', createdAt: 0, updatedAt: 0 },
      { id: 't2', date: '2026-11-08', type: 'income', fund: '일반재정', category: '감사헌금', name: '김믿음', memberId: 'k', amount: 30000, note: '', createdAt: 0, updatedAt: 0 },
      { id: 't3', date: '2026-01-01', type: 'income', fund: '일반재정', category: '전년도 이월금', name: '', memberId: 'k', amount: 999, note: '', createdAt: 0, updatedAt: 0 },
    ] as any;
    const serve: Serve = { roles: [{ id: 'a', name: '안내', count: 1, pool: [] }], plan: { '2026-11-22': { a: ['k'] } } };
    const minutes = [{ id: 'm', date: '2026-10-30', meeting: '제직회', title: '', attendees: '예제 목사, 김믿음 장로', content: '', decisions: '', chair: '', recorder: '', place: '', createdAt: 0, updatedAt: 0 }];
    const h = memberHistory(kim, p, '2026-11-15', { tx, serve, minutes, certs: [{ id: 'c', no: '2026-001', type: '교인증명서', date: '2026-11-10', purpose: '제출용', memberId: 'k' } as any] });
    expect(h.map((x) => x.kind)).toEqual(['serve', 'cert', 'give', 'visit', 'attend', 'meeting', 'attend', 'church', 'church']);
    expect(h[0].future).toBe(true);
    expect(h.find((x) => x.kind === 'give')!.text).toBe('2026년 헌금 2건 · 130,000원 (십일조 100,000원, 감사헌금 30,000원)');
    expect(h.find((x) => x.kind === 'attend')!.text).toContain('2026년 1번 출석 (기록한 2번 중)');
    expect(h.some((x) => x.text.includes('2025년 출석 기록 없음'))).toBe(true);
  });
});

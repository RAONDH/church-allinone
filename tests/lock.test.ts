// 잠금 점검: 구역 나누기, 암호 저장 방식, 자리 비우면 다시 잠김, 잊었을 때 풀기 파일
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore 서버 모듈은 JS
import { makeLock, areaOf, RESET_FILE } from '../server/lock.mjs';

const fakeRes = () => { const h: Record<string, string> = {}; return { setHeader: (k: string, v: string) => { h[k] = v; }, h }; };
const reqWith = (res: { h: Record<string, string> }) => ({ headers: { cookie: (res.h['Set-Cookie'] || '').split(';')[0] } });
afterEach(() => vi.useRealTimers());

describe('잠금', () => {
  it('주소마다 잠금 구역이 정해진다 (예배 준비는 잠그지 않음)', () => {
    expect(['/people', '/people/export.csv', '/members/abc', '/visits', '/attendance/2026-11-15'].map(areaOf)).toEqual(Array(5).fill('people'));
    expect(['/finance', '/finance/tx/abc', '/finance/export.csv'].map(areaOf)).toEqual(Array(3).fill('finance'));
    expect(['/admin', '/events.ics', '/minutes/abc/audio', '/certs', '/serve/plan', '/meeting-types', '/gcals'].map(areaOf)).toEqual(Array(7).fill('admin'));
    expect(['/', '/weeks', '/weeks/abc/after', '/songs', '/church', '/bulletin', '/stt'].map(areaOf)).toEqual(Array(7).fill(''));
  });
  it('암호는 원문이 아니라 섞은 값으로만 저장한다', () => {
    const l = makeLock({ dataDir: os.tmpdir() }), db: any = {};
    l.configure(db, { pin: '482915', areas: ['people'] }, fakeRes());
    expect(JSON.stringify(db.lock)).not.toContain('482915');
    expect(db.lock.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => l.configure({}, { pin: '12' }, fakeRes())).toThrow(/4~8자리/);
    expect(() => l.configure({}, { pin: 'abcd' }, fakeRes())).toThrow(/4~8자리/);
  });
  it('정한 시간 동안 손대지 않으면 다시 잠긴다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
    const l = makeLock({ dataDir: os.tmpdir() }), db: any = {};
    const res = fakeRes();
    l.configure(db, { pin: '1234', areas: ['finance'], idleMin: 5 }, res);
    const req = reqWith(res);
    expect(() => l.guard(db, req, 'finance')).not.toThrow();
    vi.setSystemTime(new Date('2026-11-19T10:04:00Z'));
    expect(() => l.guard(db, req, 'finance')).not.toThrow();   // 4분 뒤 손댐 → 다시 5분
    vi.setSystemTime(new Date('2026-11-19T10:08:30Z'));
    expect(() => l.guard(db, req, 'finance')).not.toThrow();
    vi.setSystemTime(new Date('2026-11-19T10:14:00Z'));
    expect(() => l.guard(db, req, 'finance')).toThrow(/잠겨 있습니다/);
    expect(() => l.guard(db, { headers: {} }, 'people')).not.toThrow();   // 잠그지 않은 구역
  });
  it('암호를 잊으면: 자료 폴더에 잠금풀기 파일을 두고 다시 켜면 잠금이 풀린다', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'allinone-lock-'));
    try {
      const db: any = {};
      makeLock({ dataDir: d }).configure(db, { pin: '1234' }, fakeRes());
      expect(makeLock({ dataDir: d }).applyReset(db)).toBe(false);
      fs.writeFileSync(path.join(d, RESET_FILE), '');
      expect(makeLock({ dataDir: d }).applyReset(db)).toBe(true);
      expect(db.lock).toBeUndefined();
      expect(fs.existsSync(path.join(d, RESET_FILE))).toBe(false);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
});

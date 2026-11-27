// 프로그램이 꺼지거나 자료가 망가지지 않게 하는 보완들
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
// @ts-ignore 서버 모듈은 JS
import { memoryWc } from '../server/wc.mjs';
// @ts-ignore
import { streamZip } from '../server/backup.mjs';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-robust-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('예제 예배송출 파일', () => {
  it('깨진 파일이 있어도 예외 없이 예제를 새로 만들고, 깨진 파일은 옆에 남긴다', async () => {
    const d = tmp(), f = path.join(d, 'sample-caster.json');
    fs.writeFileSync(f, '{"items":[{"id":');   // 쓰다가 잘린 파일
    const wc = memoryWc(f, () => ({ items: [], services: [], currentServiceId: null, props: [] }));
    expect(await wc.state()).toMatchObject({ items: [] });
    expect(fs.readdirSync(d).some((x) => x.startsWith('sample-caster.json.broken-'))).toBe(true);
  });
  it('저장은 임시 파일을 거쳐 바꾸므로 임시 파일이 남지 않는다', async () => {
    const d = tmp(), f = path.join(d, 'sample-caster.json');
    const wc = memoryWc(f, () => ({ items: [], services: [], currentServiceId: null, props: [] }));
    await wc.createService({ name: '시험 예배', date: '2026-11-29' });
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toBeTruthy();
    expect(fs.existsSync(`${f}.tmp`)).toBe(false);
  });
});

describe('백업 파일(zip) 받기', () => {
  it('받는 사이에 지워진 녹음 파일이 있어도 멈추지 않고 나머지를 담는다', async () => {
    const d = tmp(), a = path.join(d, 'real.json');
    fs.writeFileSync(a, '{"church":{}}');
    const out = new PassThrough(), bufs: Buffer[] = [];
    out.on('data', (c) => bufs.push(c));
    await streamZip(out, [{ name: 'real.json', file: a }, { name: '녹음/없는.wav', file: path.join(d, '없는.wav') }]);
    const zip = Buffer.concat(bufs);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from('real.json'))).toBe(true);
    expect(zip.includes(Buffer.from('없는.wav'))).toBe(false);
  });
});

// @ts-ignore 서버 모듈은 JS
import { renameRetry, renameRetrySync } from '../server/fsx.mjs';
describe('윈도우 파일 잠김', () => {
  const busy = (n: number, code = 'EBUSY') => { let left = n; const calls: string[] = []; const f = (a: string, b: string) => { calls.push(`${a}>${b}`); if (left-- > 0) throw Object.assign(new Error(code), { code }); }; return { f, calls }; };
  it('이름 바꾸기가 잠깐 막혀도(EBUSY·EPERM) 다시 해서 끝낸다', async () => {
    const a = busy(2); renameRetrySync('t', 'x', a.f); expect(a.calls.length).toBe(3);
    const b = busy(2, 'EPERM'); await renameRetry('t', 'x', async (x: string, y: string) => b.f(x, y)); expect(b.calls.length).toBe(3);
  });
  it('계속 막히거나 다른 오류면 그대로 알린다', () => {
    expect(() => renameRetrySync('t', 'x', busy(99).f)).toThrow('EBUSY');
    const c = busy(1, 'ENOENT'); expect(() => renameRetrySync('t', 'x', c.f)).toThrow('ENOENT'); expect(c.calls.length).toBe(1);
  });
});

// @ts-ignore 서버 모듈은 JS
import { hasMember } from '../server/people.mjs';
describe('성도 번호 확인', () => {
  it("'__proto__'·'constructor' 같은 이름은 성도 번호로 통과하지 않는다", () => {
    const db = { members: { a1: { id: 'a1' } } };
    expect(['a1', '__proto__', 'constructor', 'toString', 5 as any].map((x) => hasMember(db, x))).toEqual([true, false, false, false, false]);
  });
});

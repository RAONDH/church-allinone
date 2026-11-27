// 백업 점검: 날짜 이름, 바깥 백업 폴더, zip 만들기·되살리기 (임시 폴더만 씀)
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
// @ts-ignore 서버 모듈은 JS
import { openStore } from '../server/store.mjs';
// @ts-ignore 서버 모듈은 JS
import { makeBackups, streamZip, checkRestore } from '../server/backup.mjs';
// @ts-ignore 서버 모듈은 JS
import { unzip } from '../server/update.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'allinone-backup-'));
const dirs: string[] = [];
const T = () => { const d = tmp(); dirs.push(d); return d; };
afterEach(() => { vi.useRealTimers(); process.env.TZ = ''; for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('백업', () => {
  it('자동 백업 파일 이름은 이 컴퓨터 날짜로 (한국 오전 9시 전에도 오늘 날짜)', async () => {
    process.env.TZ = 'Asia/Seoul';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T15:30:00Z'));   // 한국 시간 11월 19일 새벽 0시 30분
    const d = T();
    const s = openStore(d, 'real');
    await s.save();                 // 처음 저장 (백업할 파일 없음)
    s.db.church = { name: '시험' };
    await s.save();                 // 이때 어제까지의 파일을 오늘 날짜로 백업
    expect(fs.readdirSync(path.join(d, 'backups'))).toEqual(['real-2026-11-19.json']);
  });
  it('바깥 백업: 같은 날 그 뒤에 고친 내용도 잠시 뒤 그날 백업 파일에 반영하고, 현재 자료까지 백업됐는지 알려 준다', async () => {
    const d = T(), ext = T();
    const s = openStore(d, 'real'); s.db.church = { name: '아침' }; await s.save();
    const b = makeBackups({ dataDir: d, store: s, againMs: 150 });
    expect((await b.setDir(ext)).ok).toBe(true);
    expect(b.view().upToDate).toBe(true);
    const file = path.join(ext, '라온교회올인원-백업', fs.readdirSync(path.join(ext, '라온교회올인원-백업')).find((f) => f.endsWith('.json'))!);
    await new Promise((r) => setTimeout(r, 20));
    s.db.church = { name: '저녁에 고침' }; await s.save();
    expect(b.view().upToDate).toBe(false);
    expect((await b.external()).skipped).toBe('soon');            // 방금 백업했으니 조금 뒤에
    await new Promise((r) => setTimeout(r, 400));
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).church.name).toBe('저녁에 고침');
    expect(b.view().upToDate).toBe(true);
    expect((await b.external()).skipped).toBe('uptodate');        // 바뀐 게 없으면 다시 복사하지 않음
  });
  it('바깥 백업 폴더: 정하면 자료와 녹음을 복사하고, 폴더가 없어지면 멈추지 않고 알린다', async () => {
    const d = T(), ext = T();
    const s = openStore(d, 'real'); s.db.church = { name: '바깥' }; s.db.weeks = {}; await s.save();
    fs.mkdirSync(path.join(d, 'recordings', 'real'), { recursive: true });
    fs.writeFileSync(path.join(d, 'recordings', 'real', 'a.wav'), 'RIFFxxxx');
    const b = makeBackups({ dataDir: d, store: s });
    await expect(b.setDir('상대경로')).rejects.toThrow(/처음부터/);
    await expect(b.setDir(path.join(d, 'backups'))).rejects.toThrow(/자료 폴더 안/);
    const r = await b.setDir(ext);
    expect(r.ok).toBe(true);
    const target = path.join(ext, '라온교회올인원-백업');
    expect(fs.readdirSync(target).filter((f) => f.endsWith('.json')).length).toBe(1);
    expect(fs.readFileSync(path.join(target, 'recordings', 'a.wav'), 'utf8')).toBe('RIFFxxxx');
    fs.rmSync(ext, { recursive: true, force: true });
    const r2 = await b.external(true);
    expect(r2.ok).toBe(false);
    expect(b.view().lastError).toMatch(/연결되어 있지 않습니다/);
  });
  it('백업 zip: 자료와 녹음이 들어 있고, 그 zip 으로 되살리면 바로 앞 자료를 따로 남긴다', async () => {
    const d = T();
    const s = openStore(d, 'real'); s.db.church = { name: '원래교회' }; s.db.weeks = { w1: { id: 'w1' } }; await s.save();
    fs.mkdirSync(path.join(d, 'recordings', 'real'), { recursive: true });
    fs.writeFileSync(path.join(d, 'recordings', 'real', 'm1.wav'), Buffer.alloc(5000, 7));
    const b = makeBackups({ dataDir: d, store: s });
    const out = new PassThrough(); const parts: Buffer[] = [];
    out.on('data', (c) => parts.push(c));
    (out as any).writeHead = () => {};
    await b.download(out);
    const zip = Buffer.concat(parts);
    const x = T(); unzip(zip, x);
    expect(JSON.parse(fs.readFileSync(path.join(x, 'real.json'), 'utf8')).church.name).toBe('원래교회');
    expect(fs.readFileSync(path.join(x, 'recordings', 'm1.wav')).length).toBe(5000);
    // 자료를 바꾼 뒤 그 zip 으로 되살리기
    s.db.church = { name: '바뀐교회' }; await s.save();
    fs.rmSync(path.join(d, 'recordings', 'real', 'm1.wav'));
    const r = await b.restoreUpload(zip, 'backup.zip');
    expect([r.church, r.weeks, r.recordings]).toEqual(['원래교회', 1, 1]);
    expect(s.db.church.name).toBe('원래교회');
    expect(JSON.parse(fs.readFileSync(path.join(d, 'backups', r.kept), 'utf8')).church.name).toBe('바뀐교회');
    expect(fs.existsSync(path.join(d, 'recordings', 'real', 'm1.wav'))).toBe(true);
  });
  it('녹음이 많으면 백업을 여러 부로 나눠 받고 (한 파일이 되살리기 한도를 넘지 않게), 1부부터 차례로 되살리면 녹음이 모두 돌아온다', async () => {
    const d = T();
    const s = openStore(d, 'real'); s.db.church = { name: '원래교회' }; s.db.weeks = {}; await s.save();
    const rec = path.join(d, 'recordings', 'real'); fs.mkdirSync(rec, { recursive: true });
    for (const n of ['a', 'b', 'c']) fs.writeFileSync(path.join(rec, `${n}.wav`), Buffer.alloc(4000, 1));
    const b = makeBackups({ dataDir: d, store: s, partBytes: 6000 });   // 시험용 한도: 녹음 한 개 + 자료
    expect(b.view().parts.map((x: any) => x.files)).toEqual([2, 1, 1]);
    const get = async (part: number) => { const out = new PassThrough(), bufs: Buffer[] = []; out.on('data', (c) => bufs.push(c)); (out as any).writeHead = () => {}; await b.download(out, part); return Buffer.concat(bufs); };
    const zips = [await get(0), await get(1), await get(2)];
    expect(zips.every((z) => z.length < 6000 + 1000)).toBe(true);
    for (const n of ['a', 'b', 'c']) fs.rmSync(path.join(rec, `${n}.wav`));
    s.db.church = { name: '바뀐교회' }; await s.save();
    expect((await b.restoreUpload(zips[0], '1부.zip')).church).toBe('원래교회');
    const r2 = await b.restoreUpload(zips[1], '2부.zip');
    expect([r2.recordingsOnly, r2.recordings]).toEqual([true, 1]);
    await b.restoreUpload(zips[2], '3부.zip');
    expect(fs.readdirSync(rec).sort()).toEqual(['a.wav', 'b.wav', 'c.wav']);
    expect(s.db.church.name).toBe('원래교회');   // 녹음 묶음은 교회 자료를 건드리지 않음
  });
  it('되살리기: 올인원 자료가 아닌 파일, 작업 중일 때는 거절', async () => {
    const d = T();
    const s = openStore(d, 'real'); await s.save();
    expect(() => checkRestore({ hello: 1 })).toThrow(/백업 파일이 아닙니다/);
    const b = makeBackups({ dataDir: d, store: s });
    await expect(b.restoreUpload(Buffer.from('그냥 글'), 'x.json')).rejects.toThrow(/읽지 못했습니다/);
    const busy = makeBackups({ dataDir: d, store: s, isBusy: () => '설교 후 자료를 만드는 중이라' });
    await expect(busy.restoreUpload(Buffer.from(JSON.stringify({ church: null, weeks: {} })), 'x.json')).rejects.toThrow(/끝난 뒤에/);
  });
  it('zip 은 4GB 아래 파일을 그대로 담는다 (빈 목록도 올바른 zip)', async () => {
    const out = new PassThrough(); const parts: Buffer[] = []; out.on('data', (c) => parts.push(c));
    await streamZip(out, []);
    const z = Buffer.concat(parts);
    expect(z.readUInt32LE(0)).toBe(0x06054b50);
  });
});

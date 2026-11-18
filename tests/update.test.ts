// 새 버전 자동 설치 점검: 가짜 배포 서버로 받기 → 확인값 틀리면 거절 → 맞으면 설치 → 새 버전으로 다시 켜짐 → 자료 그대로
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { spawn, type ChildProcess } from 'node:child_process';
// @ts-ignore 서버 모듈은 JS
import { cmpVer, pickRuntime } from '../server/boot.mjs';
// @ts-ignore 서버 모듈은 JS
import { sumFor, unzip, notesExcerpt } from '../server/update.mjs';

const HUB = path.resolve(__dirname, '..');
const BUNDLED = JSON.parse(fs.readFileSync(path.join(HUB, 'package.json'), 'utf8')).version;
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), `allinone-${p}-`));
const cleanup: (() => void)[] = [];
afterAll(() => { for (const f of cleanup.reverse()) try { f(); } catch { /* 이미 정리됨 */ } });

function zip(files: Record<string, Buffer>) {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let off = 0, n = 0;
  for (const [name, raw] of Object.entries(files)) {
    const nm = Buffer.from(name), data = deflateRawSync(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nm, data); central.push(c, nm); off += 30 + nm.length + data.length; n++;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(n, 8); e.writeUInt16LE(n, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
/** 프로그램 파일(server·dist·apps.json·package.json)을 버전만 바꿔 모으기 */
function appFiles(version: string) {
  const out: Record<string, Buffer> = {};
  const walk = (d: string) => { for (const e of fs.readdirSync(path.join(HUB, d), { withFileTypes: true })) { const r = `${d}/${e.name}`; if (e.isDirectory()) walk(r); else out[r] = fs.readFileSync(path.join(HUB, r)); } };
  walk('server'); walk('dist');
  out['apps.json'] = fs.readFileSync(path.join(HUB, 'apps.json'));
  out['package.json'] = Buffer.from(JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(HUB, 'package.json'), 'utf8')), version }));
  return out;
}
function writeApp(dir: string, files: Record<string, Buffer>) { for (const [n, b] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), b); } }
const freePort = () => new Promise<number>((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); }); });
async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 30000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v !== undefined) return v; } catch { /* 아직 */ } await new Promise((r) => setTimeout(r, 300)); }
  throw new Error('시간 초과');
}
const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, init); return r.json(); };

describe('업데이트 · 작은 부품', () => {
  it('버전 비교', () => {
    expect(cmpVer('0.2.10', '0.2.9')).toBe(1);
    expect(cmpVer('v1.0.0', '1.0.0')).toBe(0);
    expect(cmpVer('0.2.4', '0.3.0')).toBe(-1);
  });
  it('확인값 목록 읽기 (윈도우식 줄바꿈·* 표시)', () => {
    const t = `${'a'.repeat(64)}  ChurchAllInOne-mac.zip\r\n${'B'.repeat(64)} *ChurchAllInOne-update.zip\r\n`;
    expect(sumFor(t, 'ChurchAllInOne-update.zip')).toBe('b'.repeat(64));
    expect(sumFor(t, 'nope.zip')).toBe('');
  });
  it('묶음 밖으로 나가는 파일 이름은 거절', () => {
    const d = tmp('zip'); cleanup.push(() => fs.rmSync(d, { recursive: true, force: true }));
    expect(() => unzip(zip({ '../evil.txt': Buffer.from('x') }), d)).toThrow(/허용되지 않은/);
    expect(unzip(zip({ 'a/b.txt': Buffer.from('ok') }), d)).toBe(1);
    expect(fs.readFileSync(path.join(d, 'a/b.txt'), 'utf8')).toBe('ok');
  });
  it('업데이트 내용은 받기 표 앞까지만', () => {
    expect(notesExcerpt('## 제목\n- 바뀐 것\n\n### 받기\n| 파일 | 내용 |')).toBe('## 제목\n- 바뀐 것');
  });
  it('켤 본체 고르기: 새 버전·망가진 것·지난번 실패·앱이 더 새것', () => {
    const root = tmp('root'), data = tmp('data');
    cleanup.push(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); });
    writeApp(root, { 'package.json': Buffer.from(JSON.stringify({ version: '1.0.0' })), 'server/main.mjs': Buffer.from('') });
    const upd = path.join(data, 'app-update');
    const put = (v: string, ok = true) => { writeApp(path.join(upd, v), { 'package.json': Buffer.from(JSON.stringify({ version: ok ? v : '0' })), 'server/main.mjs': Buffer.from('') }); fs.writeFileSync(path.join(upd, 'current.json'), JSON.stringify({ version: v })); };
    expect(pickRuntime(root, data).updated).toBe(false);
    put('1.1.0'); expect(pickRuntime(root, data)).toMatchObject({ updated: true, version: '1.1.0' });
    fs.writeFileSync(path.join(upd, 'booting.json'), JSON.stringify({ version: '1.1.0' }));
    expect(pickRuntime(root, data).updated).toBe(false); expect(fs.existsSync(upd)).toBe(false);   // 지난번에 못 켬 → 치움
    put('1.2.0', false); expect(pickRuntime(root, data).updated).toBe(false); expect(fs.existsSync(upd)).toBe(false);   // 온전하지 않음
    put('0.9.0'); expect(pickRuntime(root, data).updated).toBe(false); expect(fs.existsSync(upd)).toBe(false);   // 앱이 더 새것
  });
});

describe('업데이트 · 가짜 배포 서버로 끝까지', () => {
  it('확인값 틀리면 거절 → 맞으면 설치 → 새 버전으로 다시 켜짐 → 자료 그대로 → 망가진 버전은 앱 버전으로', async () => {
    const NEW = '9.9.9';
    const app = tmp('app'), data = tmp('data');
    cleanup.push(() => { fs.rmSync(app, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); });
    writeApp(app, appFiles(BUNDLED));
    const pkg = zip(appFiles(NEW));
    const goodSum = crypto.createHash('sha256').update(pkg).digest('hex');
    let wrong = true;
    const rel = http.createServer((req, res) => {
      const base = `http://127.0.0.1:${(rel.address() as net.AddressInfo).port}`;
      if (req.url === '/latest') return res.end(JSON.stringify({ tag_name: `v${NEW}`, name: `v${NEW}`, html_url: `${base}/page`, body: '## 시험 버전\n- 바뀐 것\n\n### 받기\n| 파일 | 내용 |', assets: [{ name: 'ChurchAllInOne-update.zip', browser_download_url: `${base}/releases/download/v${NEW}/ChurchAllInOne-update.zip` }, { name: 'SHA256SUMS.txt', browser_download_url: `${base}/releases/download/v${NEW}/SHA256SUMS.txt` }] }));
      if (req.url?.endsWith('/SHA256SUMS.txt')) return res.end(`${wrong ? '0'.repeat(64) : goodSum}  ChurchAllInOne-update.zip\r\n`);
      if (req.url?.endsWith('/ChurchAllInOne-update.zip')) { res.setHeader('Content-Length', pkg.length); return res.end(pkg); }
      res.statusCode = 404; res.end();
    });
    await new Promise<void>((ok) => rel.listen(0, '127.0.0.1', () => ok()));
    cleanup.push(() => rel.close());
    const relBase = `http://127.0.0.1:${(rel.address() as net.AddressInfo).port}`;
    const port = await freePort();
    const H = `http://127.0.0.1:${port}`;
    const env = { ...process.env, PORT: String(port), HUB_DATA_DIR: data, WC_URL: 'http://127.0.0.1:9', UPDATE_LATEST_URL: `${relBase}/latest`, UPDATE_ALLOWED_PREFIX: `${relBase}/releases/download/` };
    delete (env as any).HUB_APP_ROOT; delete (env as any).BUNDLE_DIR;
    const pids = new Set<number>();
    cleanup.push(() => { for (const p of pids) try { process.kill(p); } catch { /* 이미 끝남 */ } });
    const start = () => { const c: ChildProcess = spawn(process.execPath, [path.join(app, 'server', 'index.mjs')], { cwd: app, env, stdio: 'ignore' }); pids.add(c.pid!); return c; };

    start();
    const h1 = await waitFor(async () => { const h = await j(`${H}/api/health`); return h.ok ? h : undefined; });
    expect(h1.version).toBe(BUNDLED);
    await j(`${H}/api/ws/real/church`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '시험교회', pastor: '시험 목사' }) });

    const v = await j(`${H}/api/update?force=1`);
    expect(v).toMatchObject({ available: true, installable: true, latest: { version: NEW } });
    expect(v.latest.notes).toBe('## 시험 버전\n- 바뀐 것');

    // 1) 확인값이 틀리면 설치하지 않는다
    await j(`${H}/api/update/install`, { method: 'POST' });
    const bad = await waitFor(async () => { const x = await j(`${H}/api/update`); return x.job.phase === 'error' ? x : undefined; });
    expect(bad.job.error).toMatch(/확인값/);
    expect(fs.existsSync(path.join(data, 'app-update', 'current.json'))).toBe(false);
    expect((await j(`${H}/api/health`)).version).toBe(BUNDLED);

    // 2) 맞으면 설치하고 새 버전으로 다시 켜진다 (옛 본체는 끝남)
    wrong = false;
    await j(`${H}/api/update/install`, { method: 'POST' });
    const h2 = await waitFor(async () => { const h = await j(`${H}/api/health`); return h.version === NEW ? h : undefined; }, 45000);
    pids.add(h2.pid);
    expect(h2.pid).not.toBe(h1.pid);
    expect(JSON.parse(fs.readFileSync(path.join(data, 'app-update', 'current.json'), 'utf8')).version).toBe(NEW);
    expect(fs.existsSync(path.join(data, 'app-update', 'booting.json'))).toBe(false);   // 끝까지 켜짐

    // 3) 자료 그대로, 설치 전 백업 있음
    expect((await j(`${H}/api/ws/real`)).church.name).toBe('시험교회');
    const bk = fs.readdirSync(path.join(data, 'backups')).find((d) => d.startsWith(`before-update-${BUNDLED}-to-${NEW}`));
    expect(bk).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(path.join(data, 'backups', bk!, 'real.json'), 'utf8')).church.name).toBe('시험교회');
    expect((await j(`${H}/api/update`)).current).toBe(NEW);

    // 4) 끈 뒤 다시 켜도 받아 둔 새 버전으로 켜진다
    process.kill(h2.pid);
    await waitFor(async () => { try { await fetch(`${H}/api/health`); return undefined; } catch { return true; } });
    start();
    expect((await waitFor(async () => { const h = await j(`${H}/api/health`); return h.ok ? h : undefined; })).version).toBe(NEW);
    process.kill((await j(`${H}/api/health`)).pid);
    await waitFor(async () => { try { await fetch(`${H}/api/health`); return undefined; } catch { return true; } });

    // 5) 받아 둔 버전이 망가져 켜지지 않으면 치우고 앱에 든 버전으로 켠다
    const broken = path.join(data, 'app-update', NEW, 'server', 'main.mjs');
    fs.writeFileSync(broken, "throw new Error('망가진 시험 버전');\n");
    start();
    const h3 = await waitFor(async () => { const h = await j(`${H}/api/health`); return h.ok ? h : undefined; });
    pids.add(h3.pid);
    expect(h3.version).toBe(BUNDLED);
    expect(fs.existsSync(path.join(data, 'app-update'))).toBe(false);
    expect((await j(`${H}/api/ws/real`)).church.name).toBe('시험교회');
  }, 120000);
});

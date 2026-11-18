#!/usr/bin/env node
// 윈도우 묶음 실행 시험 (GitHub Actions 의 윈도우 컴퓨터에서 돈다 · 윈도우가 아니면 건너뜀)
// 실제 묶음과 같은 실행 파일(installer/windows/*.cmd)로 켜 보고, 올인원이 짐작하는 설치 위치가 맞는지 확인한다.
// 하나라도 실패하면 끝 코드 1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { runChecks, ok, eq, HUB, sleep } from './harness/lib.mjs';

if (process.platform !== 'win32') { console.log('윈도우가 아니어서 윈도우 실행 시험을 건너뜁니다.'); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'allinone-win-'));
const crlf = (src, dst) => fs.writeFileSync(dst, fs.readFileSync(src, 'utf8').replace(/\r?\n/g, '\r\n'));
const health = async (port) => { try { return await (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })).json(); } catch { return null; } };
const waitPort = async (url, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.ok) return true; } catch { /* 아직 */ } await sleep(1000); } return false; };
const expand = (v) => String(v).replace(/%(\w+)%/g, (m, k) => process.env[k] ?? m);
const kill = (pid) => { try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']); } catch { /* 이미 끝남 */ } };

const results = await runChecks('윈도우 묶음 실행 시험', [
  ['윈도우 실행 파일: "라온 교회 올인원 실행.cmd"로 켜면 열리고, 자료는 %APPDATA%\\ChurchAllInOne 에 생긴다', async () => {
    const root = path.join(tmp, '라온 교회 올인원');
    for (const d of ['server', 'dist']) fs.cpSync(path.join(HUB, d), path.join(root, 'hub', d), { recursive: true });
    for (const f of ['apps.json', 'package.json']) fs.copyFileSync(path.join(HUB, f), path.join(root, 'hub', f));
    fs.mkdirSync(path.join(root, 'node'), { recursive: true });
    fs.copyFileSync(process.execPath, path.join(root, 'node', 'node.exe'));
    crlf(path.join(HUB, 'installer', 'windows', 'allinone.cmd'), path.join(root, '라온 교회 올인원 실행.cmd'));
    const appdata = path.join(tmp, 'appdata');   // 시험용 %APPDATA%
    fs.mkdirSync(appdata, { recursive: true });
    spawn('cmd', ['/c', path.join(root, '라온 교회 올인원 실행.cmd')], { env: { ...process.env, APPDATA: appdata }, stdio: 'ignore', detached: true }).unref();
    let h = null; for (let i = 0; i < 60 && !h; i++) { h = await health(5191); if (!h) await sleep(1000); }
    ok(h?.ok, '5191 에서 올인원이 답해야 함', h);
    eq(h.version, JSON.parse(fs.readFileSync(path.join(HUB, 'package.json'), 'utf8')).version, '켜진 버전');
    ok(fs.existsSync(path.join(appdata, 'ChurchAllInOne', 'backups')), '%APPDATA%\\ChurchAllInOne 자료 폴더', fs.readdirSync(appdata));
    const r = await fetch('http://127.0.0.1:5191/api/ws/real/church', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '윈도우시험교회' }) });
    eq(r.status, 200, '교회 정보 저장');
    ok(fs.readFileSync(path.join(appdata, 'ChurchAllInOne', 'real.json'), 'utf8').includes('윈도우시험교회'), '자료 파일에 저장됨');
    kill(h.pid);
  }],
  ['HWP 변환기: start-hub.cmd 가 파이썬 부품을 받고 5050 에서 켜진다', async () => {
    const dir = path.join(tmp, 'hwp');
    fs.mkdirSync(dir, { recursive: true });
    const tgz = path.join(tmp, 'hwp.tgz');
    const r = await fetch('https://codeload.github.com/raon-easypaster/hwp-pdf-to-markdown/tar.gz/refs/heads/main');
    ok(r.ok, 'HWP 변환기 원본 받기', r.status);
    fs.writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
    const t = spawnSync('tar', ['-xzf', tgz, '-C', dir, '--strip-components', '1'], { encoding: 'utf8' });
    eq(t.status, 0, `압축 풀기 ${t.stderr}`);
    crlf(path.join(HUB, 'installer', 'windows', 'hwp-start-hub.cmd'), path.join(dir, 'start-hub.cmd'));
    const log = path.join(tmp, 'hwp.log');
    const c = spawn('cmd', ['/c', 'start-hub.cmd'], { cwd: dir, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')], detached: true });
    const up = await waitPort('http://127.0.0.1:5050/', 300000);
    const tail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(-600) : '';
    ok(up, `5050 에서 변환기가 답해야 함\n      기록: ${tail}`);
    kill(c.pid);
  }],
  ['설교 쇼츠 메이커: 공식 설치 파일(확인값 대조)을 조용히 설치하면, 올인원이 찾는 위치에 실행 파일이 생긴다', async () => {
    const rel = await (await fetch('https://api.github.com/repos/raon-easypaster/sermon-shorts-maker/releases/latest', { headers: { 'User-Agent': 'allinone-ci', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) } })).json();
    const exe = rel.assets.find((a) => /Setup-.*\.exe$/.test(a.name)), sums = rel.assets.find((a) => a.name === 'SHA256SUMS.txt');
    ok(exe && sums, '릴리스에 설치 파일과 확인값', rel.assets?.map((a) => a.name));
    const buf = Buffer.from(await (await fetch(exe.browser_download_url)).arrayBuffer());
    const want = (await (await fetch(sums.browser_download_url)).text()).replace(/\r/g, '').split('\n').find((l) => l.endsWith(exe.name))?.split(/\s+/)[0];
    eq(crypto.createHash('sha256').update(buf).digest('hex'), want, '설치 파일 확인값');
    const setup = path.join(tmp, exe.name);
    fs.writeFileSync(setup, buf);
    const s = spawnSync(setup, ['/S'], { timeout: 300000 });
    eq(s.status, 0, '조용히 설치 (/S)');
    const app = JSON.parse(fs.readFileSync(path.join(HUB, 'apps.json'), 'utf8')).find((a) => a.id === 'shorts');
    const cands = [].concat(app.win.exe).map(expand);
    const found = cands.find((p) => fs.existsSync(p));
    let actual = [];
    try { const progs = path.join(process.env.LOCALAPPDATA, 'Programs'); actual = fs.readdirSync(progs).flatMap((d) => { try { return fs.readdirSync(path.join(progs, d)).filter((f) => f.endsWith('.exe')).map((f) => path.join(progs, d, f)); } catch { return []; } }); } catch { /* 없음 */ }
    ok(found, `apps.json 의 위치 가운데 하나에 실행 파일이 있어야 함\n      찾은 위치: ${cands.join(' | ')}\n      실제 설치된 exe: ${actual.join(' | ')}`);
  }],
]);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? '✗' : '✓'} 윈도우 실행 시험 ${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);

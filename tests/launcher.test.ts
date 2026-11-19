// 아이콘으로 켤 때: 켜져 있는 서버가 앱보다 옛 버전이면 끄고, 같거나 더 새 버전이면 그대로 둔다 (server/launch-check.mjs)
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const HUB = path.resolve(__dirname, '..');
const OWN = require(path.join(HUB, 'package.json')).version;
const freePort = () => new Promise<number>((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); }); });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** 가짜 '켜져 있는 올인원': health 에 version(없을 수도)과 pid 를 답한다 */
async function fakeServer(version: string | null) {
  const port = await freePort();
  const code = `require('http').createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify(${version === null ? "{ok:true}" : `{ok:true,version:'${version}',pid:process.pid}`}))}).listen(${port},'127.0.0.1')`;
  const c = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  return { port, pid: c.pid!, stop: () => { try { process.kill(c.pid!); } catch { /* 이미 꺼짐 */ } } };
}
const check = (port: number) => spawnSync(process.execPath, [path.join(HUB, 'server', 'launch-check.mjs')], { env: { ...process.env, PORT: String(port) }, encoding: 'utf8', timeout: 20000 });

describe('아이콘으로 켜기', () => {
  it('켜져 있는 서버가 앱보다 옛 버전이면 끈다 (새로 설치했는데 옛 서버가 계속 돌던 문제)', async () => {
    const f = await fakeServer('0.0.1');
    const r = check(f.port);
    expect(r.stdout).toContain('옛 버전이라 끄고 새로 켭니다');
    await new Promise((ok) => setTimeout(ok, 300));
    expect(alive(f.pid)).toBe(false);
  });
  it('버전을 알려 주지 않는 아주 옛 서버(0.2.5 전)도 포트로 찾아 끈다', async () => {
    const f = await fakeServer(null);
    check(f.port);
    await new Promise((ok) => setTimeout(ok, 300));
    expect(alive(f.pid)).toBe(false);
  });
  it('같은 버전이거나 자동 업데이트로 받은 더 새 버전이면 그대로 둔다', async () => {
    for (const v of [OWN, '99.0.0']) {
      const f = await fakeServer(v);
      const r = check(f.port);
      expect({ v, out: r.stdout }).toEqual({ v, out: '' });
      expect(alive(f.pid)).toBe(true);
      f.stop();
    }
  });
  it('아무것도 켜져 있지 않으면 조용히 끝난다', async () => {
    const r = check(await freePort());
    expect([r.status, r.stdout]).toEqual([0, '']);
  });
});

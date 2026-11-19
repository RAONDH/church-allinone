// 아이콘(맥 start.sh · 윈도우 실행 파일)이 켜기 전에 부르는 확인:
// 이미 켜져 있는 올인원이 이 앱보다 옛 버전이면(새로 설치했는데 옛 서버가 계속 돌고 있으면) 끄고, 아이콘이 새 버전을 켜게 한다.
// 자동 업데이트로 받은 더 새 버전이 돌고 있으면 건드리지 않는다. node 기본 기능만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cmpVer } from './boot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5191);
const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const health = () => new Promise((ok) => {
  const r = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', agent: false, timeout: 1500, headers: { Connection: 'close' } }, (res) => {
    let t = ''; res.setEncoding('utf8'); res.on('data', (c) => (t += c)); res.on('end', () => { try { ok(JSON.parse(t)); } catch { ok(null); } });
  });
  r.on('timeout', () => r.destroy()); r.on('error', () => ok(null));
});
// 옛 버전(0.2.5 전)은 pid 를 알려 주지 않아서, 포트를 듣고 있는 프로그램을 찾는다
function listenerPid() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
      const line = out.split('\n').find((l) => new RegExp(`127\\.0\\.0\\.1:${PORT}\\s.*LISTENING`).test(l));
      return line ? Number(line.trim().split(/\s+/).pop()) : 0;
    }
    return Number(execFileSync('lsof', ['-tnP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0]) || 0;
  } catch { return 0; }
}

const h = await health();
if (h?.ok && (!h.version || cmpVer(h.version, own) < 0)) {
  const pid = h.pid || listenerPid();
  console.log(`[켜기] 켜져 있는 올인원(${h.version || '0.2.5 전'})이 이 앱(${own})보다 옛 버전이라 끄고 새로 켭니다.`);
  if (pid) { try { process.kill(pid); } catch { /* 이미 꺼짐 */ } }
  for (let i = 0; i < 40 && (await health()); i++) await new Promise((r) => setTimeout(r, 250));
}

// 점검(하네스) 공용 도구: 시험 서버 띄우기 · 가짜 바깥 서비스 · 점검 하나하나 돌리고 값 비교
// 실제 자료(data/, %APPDATA%)와 켜져 있는 프로그램(5191·5300·5173·3939·5050)은 건드리지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REAL_PORTS = [5191, 5300, 5173, 3939, 5050];

export const freePort = () => new Promise((ok) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => (REAL_PORTS.includes(p) ? freePort().then(ok) : ok(p))); });
});
export const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `allinone-harness-${name}-`));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 값 비교: 다르면 무엇이 어떻게 다른지 */
const show = (v) => { const s = JSON.stringify(v); return s === undefined ? String(v) : s.length > 300 ? `${s.slice(0, 300)}…` : s; };
export function eq(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}\n      기대: ${show(expected)}\n      실제: ${show(actual)}`);
}
export function ok(cond, what, actual) {
  if (!cond) throw new Error(`${what}${actual !== undefined ? `\n      실제: ${show(actual)}` : ''}`);
}
export function has(text, part, what) {
  if (!String(text).includes(part)) throw new Error(`${what}\n      찾는 글: ${show(part)}\n      실제: ${show(String(text).slice(0, 300))}`);
}

/** 점검 묶음 실행: 이름마다 ✓/✗, 실패하면 이유. 결과 [{name, ok, error}] */
export async function runChecks(title, list) {
  console.log(`\n▶ ${title}`);
  const results = [];
  for (const [name, fn] of list) {
    const t0 = Date.now();
    try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name} (${Date.now() - t0}ms)`); }
    catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
  }
  return results;
}

/** 가짜 바깥 서비스: 경로 → 처리 함수 */
export async function fakeServer(routes) {
  const srv = http.createServer(async (req, res) => {
    const h = routes[req.url.split('?')[0]] || routes['*'];
    if (!h) { res.statusCode = 404; return res.end('없음'); }
    try { await h(req, res); } catch (e) { res.statusCode = 500; res.end(String(e)); }
  });
  const port = await freePort();
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  return { port, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => srv.close(r)) };
}
export const json = (obj) => (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(typeof obj === 'function' ? obj() : obj)); };

/** 시험용 라온 교회 올인원 서버: 임시 자료 폴더, 다른 포트, 바깥 연결은 모두 가짜·닫힌 포트로 */
/** prepare(dataDir): 서버를 켜기 전에 자료 폴더를 꾸민다 (깨진 자료 파일·옛 백업 등) */
export async function startHub({ env = {}, name = 'hub', prepare } = {}) {
  const port = await freePort();
  const closed = await freePort();   // 아무도 듣지 않는 포트 (예배송출·PraiseFlow 자리)
  const dataDir = tmpDir(`${name}-data`), logDir = tmpDir(`${name}-log`), sttDir = tmpDir(`${name}-stt`);
  const fullEnv = {
    ...process.env, PORT: String(port), HUB_DATA_DIR: dataDir, HUB_LOG_DIR: logDir, STT_DIR: sttDir,
    WC_URL: `http://127.0.0.1:${closed}`, PRAISEFLOW_URL: `http://127.0.0.1:${closed}`,
    // 제미나이 키·PraiseFlow 설정은 사용자의 실제 파일(~/.praiseflow) 대신 임시 파일, 제미나이 서버는 닫힌 포트
    PRAISEFLOW_CONFIG: path.join(dataDir, 'praiseflow-config.json'), GEMINI_API_BASE: `http://127.0.0.1:${closed}`,
    UPDATE_LATEST_URL: `http://127.0.0.1:${closed}/latest`, UPDATE_ALLOWED_PREFIX: `http://127.0.0.1:${closed}/releases/download/`,
    ...env,
  };
  delete fullEnv.HUB_APP_ROOT; delete fullEnv.BUNDLE_DIR; if (!env.GEMINI_API_KEY) delete fullEnv.GEMINI_API_KEY;
  // 프로그램 목록도 기본으로 시험용 (실제 apps.json 을 쓰면 '프로그램' 화면이 켜져 있는 예배송출·PraiseFlow 포트에 요청을 보낸다)
  if (!env.HUB_APPS_FILE) {
    const appsFile = path.join(dataDir, 'test-apps.json');
    fs.writeFileSync(appsFile, JSON.stringify([{ id: 'fake', name: '시험 프로그램', desc: '점검용 (닫힌 포트)', icon: '🧪', color: '#000', port: closed, dir: dataDir, start: 'true', win: { dir: dataDir, run: ['node', '-e', '0'] } }]));
    fullEnv.HUB_APPS_FILE = appsFile;
  }
  if (prepare) await prepare(dataDir);
  const out = [];
  const child = spawn(process.execPath, [path.join(HUB, 'server', 'index.mjs')], { cwd: HUB, env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (c) => out.push(String(c))); child.stderr.on('data', (c) => out.push(String(c)));
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { up = true; break; } } catch { /* 켜지는 중 */ }
    if (child.exitCode !== null) throw new Error(`시험 서버가 켜지지 않았습니다:\n${out.join('')}`);
    await sleep(150);
  }
  // 12초가 지나도 답이 없으면 여기서 멈춘다 (그대로 넘어가면 뒤 점검들이 엉뚱한 이유로 실패한다)
  if (!up) { try { child.kill(); } catch { /* 이미 끝남 */ } throw new Error(`시험 서버가 12초 안에 답하지 않았습니다:\n${out.join('').slice(-2000)}`); }
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const ct = r.headers.get('content-type') || '';
    const raw = Buffer.from(await r.arrayBuffer());
    // 글자 그대로 (fetch 의 text() 는 맨 앞 BOM 을 지워 버리므로 직접 푼다)
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw);
    const data = ct.includes('json') ? JSON.parse(text) : text;
    return { status: r.status, data, headers: r.headers, raw };
  };
  // Host 머리글을 바꿔 보내기 (fetch 로는 못 바꿈)
  const rawGet = (p, headers) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, data: b })); }).on('error', reject);
  });
  return {
    port, base, dataDir, log: () => out.join(''), rawGet,
    // 몸통을 그대로 보내기 (녹음 조각·백업 파일)
    postRaw: async (p, buf, headers = {}) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body: buf }); const t = await r.text(); let data = t; try { data = JSON.parse(t); } catch { /* 글 */ } return { status: r.status, data }; },
    get: (p, h) => call('GET', p, undefined, h), post: (p, b = {}, h) => call('POST', p, b, h), put: (p, b = {}, h) => call('PUT', p, b, h), del: (p) => call('DELETE', p),
    async stop() {
      // 서버가 정말 끝난 뒤에 폴더를 지운다 (윈도우에서는 열린 파일이 있으면 못 지움)
      if (child.exitCode === null) {
        const done = new Promise((ok) => child.once('exit', ok));
        try { child.kill(); } catch { /* 이미 끝남 */ }
        await Promise.race([done, sleep(5000)]);
      }
      for (const d of [dataDir, logDir, sttDir]) fs.rmSync(d, { recursive: true, force: true });
    },
  };
}

/** 응답이 기대한 상태 코드인지 + 값 꺼내기 */
export function expectStatus(r, code, what) {
  if (r.status !== code) throw new Error(`${what}\n      기대 상태: ${code}\n      실제 상태: ${r.status} ${show(r.data)}`);
  return r.data;
}

/** 가짜 라온 music sheet: 공유 링크 토큰마다 열린 콘티·비밀번호 콘티·팀원만 콘티를 흉내 낸다 (실제 사이트 대신) */
export async function fakeMusicSheet() {
  const seen = { pins: [] };
  const setlist = {
    name: '화면시험 주일 콘티', gigDate: '2026-11-22T00:00:00.000Z', serviceType: '주일 예배', status: 'confirmed',
    // 예배 순서(items)의 곡 순서가 곡 목록 순서와 다르다: 새 곡 → 은혜의 강
    items: [{ kind: 'song', title: '', songIndex: 1 }, { kind: 'text', title: '기도', songIndex: -1 }, { kind: 'song', title: '', songIndex: 0 }],
    songs: [
      { _id: 'a', title: '[예제] 은혜의 강', artist: '예제', key: 'E', bpm: 72, capo: 0, structure: '', notes: '후렴 반복은 조용히',
        flow: [{ part: 'intro', n: 0, times: 1 }, { part: 'verse', n: 1, times: 1 }, { part: 'chorus', n: 0, times: 1 }, { part: 'verse', n: 1, times: 1 }, { part: 'chorus', n: 0, times: 2 }] },
      { _id: 'b', title: '화면시험 새 노래', artist: '시험', key: 'A', bpm: 120, capo: 2, structure: 'I-V1-C', flow: [], notes: '' },
    ],
  };
  const srv = await fakeServer({
    '*': (req, res) => {
      const m = req.url.match(/^\/api\/setlists\/public\/([^/?]+)$/);
      res.setHeader('Content-Type', 'application/json');
      const pin = req.headers['x-share-pin'] || '';
      if (pin) seen.pins.push(pin);
      if (!m) { res.statusCode = 404; return res.end('{"message":"없음"}'); }
      if (m[1] === 'opentoken1') return res.end(JSON.stringify(setlist));
      if (m[1] === 'pintoken12') {
        if (pin !== '2468') { res.statusCode = 401; return res.end(JSON.stringify({ message: '이 콘티는 비밀번호가 필요합니다', needPin: true })); }
        return res.end(JSON.stringify(setlist));
      }
      if (m[1] === 'lockedtok1') { res.statusCode = 401; return res.end(JSON.stringify({ message: '팀원만', needLogin: true })); }
      res.statusCode = 404; return res.end('{"message":"유효하지 않은 링크입니다"}');
    },
  });
  return { ...srv, seen, link: (t) => `${srv.base}/share/${t}` };
}

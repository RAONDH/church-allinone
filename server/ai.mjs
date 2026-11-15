// 이 컴퓨터에 로그인된 AI 구독(Claude Code · Codex)으로 글을 만든다. API 키·추가 요금 없이 구독 사용량을 쓴다.
// 다른 프로젝트 설정·파일을 읽지 않도록 빈 작업 폴더에서, 도구(검색·파일) 없이 글만 쓰게 실행한다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnCli } from './cli.mjs';

const PF_CONFIG = path.join(os.homedir(), '.praiseflow', 'config.json'); // PraiseFlow에서 고른 방식을 같이 따름
const WORK_DIR = path.join(os.homedir(), '.raon-workspace', 'ai-work');
export const AI_TIMEOUT = 600_000;

export const LABELS = { claude: 'Claude 구독', codex: 'ChatGPT 구독' };

class AiError extends Error { constructor(msg, kind = 'fail') { super(msg); this.kind = kind; } }

export function runCli(cmd, args, input, timeout) {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnCli(cmd, args, { cwd: WORK_DIR }); }
    catch (e) { reject(e.code === 'ENOENT' ? new AiError(`${cmd} 프로그램이 이 컴퓨터에 없습니다.`, 'missing') : e); return; }
    let out = '', err = '';
    const t = setTimeout(() => { child.kill('SIGTERM'); reject(new AiError(`AI 응답이 ${Math.round(timeout / 60000)}분 넘게 없어 멈췄습니다. 잠시 뒤 다시 시도해 주세요.`, 'timeout')); }, timeout);
    // 한글은 한 글자가 여러 바이트라, 조각마다 글자로 바꾸면 조각 경계에 걸린 글자가 깨진다 → 이어서 풀기
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; if (err.length > 1e5) err = err.slice(-5e4); });
    child.on('error', (e) => { clearTimeout(t); reject(e.code === 'ENOENT' ? new AiError(`${cmd} 프로그램이 이 컴퓨터에 없습니다.`, 'missing') : e); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    child.stdin.end(input ?? '');
  });
}

let cache = { at: 0, v: null };
export async function aiStatus(force = false) {
  if (!force && cache.v && Date.now() - cache.at < 60_000) return cache.v;
  const [claude, codex] = await Promise.all([
    runCli('claude', ['auth', 'status'], null, 15_000).then((r) => {
      try { const j = JSON.parse(r.out); return { installed: true, loggedIn: !!j.loggedIn && j.authMethod === 'claude.ai' }; } catch { return { installed: true, loggedIn: false }; }
    }, () => ({ installed: false, loggedIn: false })),
    runCli('codex', ['login', 'status'], null, 15_000).then((r) => ({ installed: true, loggedIn: /Logged in using ChatGPT/i.test(r.out + r.err) }), () => ({ installed: false, loggedIn: false })),
  ]);
  let preferred = null;
  try { const p = JSON.parse(fs.readFileSync(PF_CONFIG, 'utf8')).provider; if (p === 'claude' || p === 'codex') preferred = p; } catch { /* 없으면 순서대로 */ }
  const order = [preferred, 'claude', 'codex'].filter(Boolean);
  const provider = order.find((p) => ({ claude, codex })[p].loggedIn) || null;
  cache = { at: Date.now(), v: { provider, label: provider ? LABELS[provider] : '', claude, codex } };
  return cache.v;
}

async function withClaude(system, prompt) {
  // 지시문은 파일로 넘긴다 (윈도우 명령 줄에서 한글·줄바꿈이 깨지지 않게)
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const sysFile = path.join(WORK_DIR, `system-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(sysFile, system);
  let r;
  try {
    r = await runCli('claude', ['-p', '--output-format', 'json', '--model', 'sonnet', '--setting-sources', '', '--strict-mcp-config',
      '--disable-slash-commands', '--no-session-persistence', '--tools', '', '--system-prompt-file', sysFile], prompt, AI_TIMEOUT);
  } finally { fs.rmSync(sysFile, { force: true }); }
  let j; try { j = JSON.parse(r.out); } catch { j = null; }
  if (!j) throw new AiError(`Claude 실행 실패: ${(r.err || r.out).trim().slice(-300) || `종료 코드 ${r.code}`}`);
  if (j.is_error) {
    const m = String(j.result || j.error || '');
    if (/log ?in|auth|credential/i.test(m)) throw new AiError('Claude에 로그인되어 있지 않습니다. 터미널에서 claude 를 실행해 로그인해 주세요.', 'login');
    if (/limit|usage/i.test(m)) throw new AiError(`Claude 구독 사용 한도에 걸렸습니다: ${m.slice(0, 200)}`, 'limit');
    throw new AiError(`Claude 오류: ${m.slice(0, 300)}`);
  }
  return String(j.result || '');
}

function codexModels() {
  const list = [];
  try { list.push(JSON.parse(fs.readFileSync(PF_CONFIG, 'utf8')).codexModel); } catch { /* 없음 */ }
  try {
    const d = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex', 'models_cache.json'), 'utf8'));
    list.push(...(d.models || d).map((m) => m.slug).filter((x) => x && !/reserve|review/i.test(x)));
  } catch { /* 없음 */ }
  return [...new Set([...list.filter(Boolean), null])].slice(0, 4);
}
async function withCodex(system, prompt) {
  let last = '';
  for (const model of codexModels()) {
    const outFile = path.join(WORK_DIR, `codex-${process.pid}-${Date.now()}.txt`);
    const r = await runCli('codex', ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-o', outFile, ...(model ? ['-m', model] : []), '-'],
      `${system}\n\n---\n\n${prompt}`, AI_TIMEOUT);
    let text = ''; try { text = fs.readFileSync(outFile, 'utf8'); fs.unlinkSync(outFile); } catch { /* 없음 */ }
    if (r.code === 0 && text.trim()) return text;
    last = (r.err.match(/"message":"([^"]+)"/) || [])[1] || r.err.trim().split('\n').pop() || `종료 코드 ${r.code}`;
    if (/not logged in|unauthorized/i.test(last) && !/model/i.test(last)) throw new AiError('ChatGPT(Codex)에 로그인되어 있지 않습니다. 터미널에서 codex login 을 실행해 주세요.', 'login');
    if (/usage limit|rate limit/i.test(last)) throw new AiError(`ChatGPT 구독 사용 한도에 걸렸습니다: ${last.slice(0, 200)}`, 'limit');
    if (!/model/i.test(last)) break;
  }
  throw new AiError(`Codex 실행 실패: ${last.slice(0, 300)}`);
}

export async function generate(provider, system, prompt) {
  if (provider === 'claude') return withClaude(system, prompt);
  if (provider === 'codex') return withCodex(system, prompt);
  throw new AiError('이 컴퓨터에 로그인된 AI 구독(Claude Code 또는 Codex)이 없습니다.', 'login');
}

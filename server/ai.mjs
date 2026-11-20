// AI로 글을 만든다. 세 가지 중 되는 것을 쓴다.
// - Claude 구독(Claude Code) · ChatGPT 구독(Codex): 이 컴퓨터에 로그인된 구독으로, API 키·추가 요금 없이 구독 사용량을 쓴다.
//   다른 프로젝트 설정·파일을 읽지 않도록 빈 작업 폴더에서, 도구(검색·파일) 없이 글만 쓰게 실행한다.
// - 제미나이 API 키: PraiseFlow 와 같은 키(~/.praiseflow/config.json 의 apiKey)를 함께 쓴다. 구글 무료 사용량 안에서는 무료.
//   (구글 개인 계정 로그인으로 쓰던 Gemini CLI 는 구글이 지원을 끊어 쓰지 않는다)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnCli } from './cli.mjs';

// PraiseFlow에서 고른 방식과 제미나이 API 키를 같이 쓴다 (점검에서는 PRAISEFLOW_CONFIG 로 임시 파일을 씀)
const PF_CONFIG = process.env.PRAISEFLOW_CONFIG || path.join(os.homedir(), '.praiseflow', 'config.json');
const GEMINI_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const WORK_DIR = path.join(os.homedir(), '.raon-workspace', 'ai-work');
export const AI_TIMEOUT = 600_000;

export const LABELS = { claude: 'Claude 구독', codex: 'ChatGPT 구독', gemini: '제미나이 API 키' };
export const PROVIDERS = Object.keys(LABELS);

// ── 제미나이 API 키 (PraiseFlow 설정 파일에 함께 보관, 권한 600. 화면에는 키 값을 돌려주지 않음) ──
const readPf = () => { try { return JSON.parse(fs.readFileSync(PF_CONFIG, 'utf8')); } catch { return {}; } };
const validKey = (k) => (typeof k === 'string' && !/PLACEHOLDER/i.test(k) && k.trim().length >= 20 ? k.trim() : '');
export const geminiKey = () => validKey(readPf().apiKey) || validKey(process.env.GEMINI_API_KEY || '');
/** 키 저장 ('' 이면 지움). PraiseFlow 의 다른 설정은 그대로 둔다 */
export function setGeminiKey(key) {
  const k = String(key ?? '').trim();
  if (k && (!validKey(k) || !/^[\w.-]+$/.test(k) || k.length > 200)) throw Object.assign(new Error('제미나이 API 키 모양이 아닙니다. Google AI Studio에서 받은 키를 그대로 붙여 넣어 주세요.'), { code: 400 });
  const cfg = readPf();
  if (k) cfg.apiKey = k; else delete cfg.apiKey;
  fs.mkdirSync(path.dirname(PF_CONFIG), { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${PF_CONFIG}.tmp`, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(`${PF_CONFIG}.tmp`, PF_CONFIG);
  cache = { at: 0, v: null };
}

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
  const gemini = { installed: true, loggedIn: !!geminiKey() };
  // PraiseFlow 에서 고른 방식을 먼저 (PraiseFlow 의 'apikey' = 제미나이 API 키)
  const p = readPf().provider;
  const preferred = p === 'apikey' ? 'gemini' : PROVIDERS.includes(p) ? p : null;
  const order = [preferred, 'claude', 'codex', 'gemini'].filter(Boolean);
  const subs = { claude, codex, gemini };
  const provider = order.find((x) => subs[x].loggedIn) || null;
  cache = { at: Date.now(), v: { provider, label: provider ? LABELS[provider] : '', claude, codex, gemini } };
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

async function withGemini(system, prompt) {
  const key = geminiKey();
  if (!key) throw new AiError('제미나이 API 키가 없습니다. 설정 > AI 연결에서 키를 넣어 주세요.', 'login');
  let r;
  try {
    r = await fetch(`${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(AI_TIMEOUT),
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.6 } }),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new AiError(`AI 응답이 ${Math.round(AI_TIMEOUT / 60000)}분 넘게 없어 멈췄습니다. 잠시 뒤 다시 시도해 주세요.`, 'timeout');
    throw new AiError('제미나이에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  }
  const j = await r.json().catch(() => ({}));
  const msg = String(j.error?.message || '').slice(0, 200);
  if (r.status === 400 && /api key|API_KEY/i.test(msg + JSON.stringify(j.error?.details || ''))) throw new AiError('제미나이 API 키가 맞지 않습니다. 설정 > AI 연결에서 키를 다시 넣어 주세요.', 'login');
  if (r.status === 401 || r.status === 403) throw new AiError(`제미나이가 이 키를 받지 않습니다: ${msg}`, 'login');
  if (r.status === 429) throw new AiError(`제미나이 사용 한도에 걸렸습니다(무료 사용량은 하루·분마다 한도가 있음). 잠시 뒤 다시 해 주세요. ${msg}`, 'limit');
  if (!r.ok) throw new AiError(`제미나이 오류(${r.status}): ${msg || '알 수 없는 오류'}`);
  const text = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  if (!text.trim()) throw new AiError(`제미나이가 빈 답을 보냈습니다${j.candidates?.[0]?.finishReason ? ` (${j.candidates[0].finishReason})` : ''}. 다시 시도해 주세요.`);
  return text;
}

export async function generate(provider, system, prompt) {
  if (provider === 'claude') return withClaude(system, prompt);
  if (provider === 'codex') return withCodex(system, prompt);
  if (provider === 'gemini') return withGemini(system, prompt);
  throw new AiError('연결된 AI가 없습니다. Claude·ChatGPT 구독에 로그인하거나 제미나이 API 키를 넣어 주세요.', 'login');
}

// 녹취(음성 → 글): whisper.cpp 의 whisper-cli 를 이 컴퓨터에서 실행한다. 음성은 밖으로 나가지 않는다.
// - 엔진: 맥은 Homebrew 의 whisper-cpp(whisper-cli), 윈도우는 공식 배포판(ggml-org/whisper.cpp b5454)을 받아 씀
// - 모델: Hugging Face ggerganov/whisper.cpp 에서 처음 쓸 때 한 번 받음 (체크섬 확인)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const WIN = process.platform === 'win32';
export const STT_DIR = process.env.STT_DIR || (WIN ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ChurchAllInOne', 'whisper') : path.join(os.homedir(), '.raon-workspace', 'whisper'));
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
export const MODELS = {
  turbo: { file: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', label: '정확한 모델 (large-v3-turbo · 574MB)' },
  small: { file: 'ggml-small-q5_1.bin', size: 190085487, sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', label: '가벼운 모델 (small · 190MB)' },
};
const WIN_ENGINE = { url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-blas-bin-x64.zip', size: 21715607, sha256: 'b1158bd10edf92c9799149a6fc5d3e58da3f495241d6fb3423088130e88ffbf3' };
export const AUDIO_EXT = ['wav', 'mp3', 'ogg', 'flac'];   // whisper-cli 가 바로 읽는 형식 (그 밖은 화면에서 wav 로 바꿔 올림)

const exe = (n) => (WIN ? `${n}.exe` : n);
function findIn(dir, name, depth = 3) {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
      if (e.isDirectory() && depth > 0) { const r = findIn(p, name, depth - 1); if (r) return r; }
    }
  } catch { /* 없음 */ }
  return null;
}
export function findEngine() {
  if (process.env.WHISPER_CLI && fs.existsSync(process.env.WHISPER_CLI)) return process.env.WHISPER_CLI;
  const own = findIn(path.join(STT_DIR, 'engine'), exe('whisper-cli'));
  if (own) return own;
  const dirs = [...String(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const d of dirs) for (const n of ['whisper-cli', 'whisper-cpp']) { const p = path.join(d, exe(n)); if (d && fs.existsSync(p)) return p; }
  return null;
}
const hasBrew = () => !WIN && ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].some((p) => fs.existsSync(p));
const modelPath = (k) => path.join(STT_DIR, 'models', MODELS[k].file);
const modelReady = (k) => { try { return fs.statSync(modelPath(k)).size === MODELS[k].size; } catch { return false; } };

// 받는 중인 것 (엔진·모델)
const installs = {};
export function sttStatus() {
  const engine = findEngine();
  return {
    platform: WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'other', engine: !!engine, enginePath: engine || '', brew: hasBrew(),
    canDownloadEngine: WIN && process.arch === 'x64',
    models: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { label: m.label, size: m.size, ready: modelReady(k) }])),
    installs,
  };
}

async function download(url, dest, { size, sha256 }, key) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  installs[key] = { done: 0, size, error: '' };
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error(`받지 못했습니다 (${r.status})`);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    for await (const chunk of r.body) {
      hash.update(chunk); installs[key].done += chunk.length;
      if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
    }
    await new Promise((ok, no) => out.end((e) => (e ? no(e) : ok())));
    if (hash.digest('hex') !== sha256) throw new Error('받은 파일의 체크섬이 맞지 않아 지웠습니다. 다시 받아 주세요.');
    fs.renameSync(part, dest);
    delete installs[key];
    return dest;
  } catch (e) {
    fs.rmSync(part, { force: true });
    installs[key] = { ...installs[key], error: e.cause ? '인터넷에 연결하지 못했습니다.' : e.message };
    throw e;
  }
}
export function installModel(k) {
  if (!MODELS[k]) throw Object.assign(new Error('알 수 없는 모델입니다.'), { code: 400 });
  if (installs[k] && !installs[k].error) return;
  download(HF + MODELS[k].file, modelPath(k), MODELS[k], k).catch(() => {});
}
export function installEngine() {
  if (!WIN) throw Object.assign(new Error('맥은 Homebrew 로 설치합니다: 터미널에서 brew install whisper-cpp'), { code: 400 });
  if (installs.engine && !installs.engine.error) return;
  const zip = path.join(STT_DIR, 'whisper-bin.zip');
  download(WIN_ENGINE.url, zip, WIN_ENGINE, 'engine').then(() => {
    const dir = path.join(STT_DIR, 'engine');
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xf', zip, '-C', dir], { windowsHide: true });   // 윈도우 10 이상에 들어 있는 tar 로 풀기
    fs.rmSync(zip, { force: true });
    if (!findEngine()) installs.engine = { done: 0, size: 0, error: '엔진 파일을 풀었지만 whisper-cli.exe 를 찾지 못했습니다.' };
  }).catch((e) => { installs.engine = { ...(installs.engine || {}), error: installs.engine?.error || e.message }; });
}

const hms = (s) => { s = Math.floor(s); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const sec = (t) => { const m = String(t).match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0; };

/** 녹음 파일 → 녹취록 글 ("[00:01:23] 말한 내용" 줄들). onProgress(0~100) */
export function transcribe(file, k, onProgress = () => {}) {
  const engine = findEngine();
  if (!engine) return Promise.reject(Object.assign(new Error('녹취 엔진(whisper)이 없습니다. 회의록 화면의 "녹취 준비"를 먼저 해 주세요.'), { code: 400 }));
  const key = MODELS[k] && modelReady(k) ? k : Object.keys(MODELS).find(modelReady);
  if (!key) return Promise.reject(Object.assign(new Error('녹취 모델이 없습니다. "녹취 준비"에서 모델을 먼저 받아 주세요.'), { code: 400 }));
  const outBase = path.join(path.dirname(file), `${path.basename(file).replace(/\.[^.]+$/, '')}-stt-${Date.now()}`);
  const threads = String(Math.max(2, Math.min(8, (os.availableParallelism?.() || os.cpus().length) - 1)));
  const args = ['-m', modelPath(key), '-f', file, '-l', 'ko', '-oj', '-of', outBase, '-t', threads, '-pp',
    '--prompt', '교회 회의 녹음입니다. 당회, 제직회, 공동의회, 목사, 장로, 권사, 집사, 예산, 결산, 안건, 결의.'];
  return new Promise((resolve, reject) => {
    const child = spawn(engine, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    const onData = (c) => {
      const s = String(c); err = (err + s).slice(-20000);
      const m = [...s.matchAll(/progress\s*=\s*(\d+)%/g)].pop();
      if (m) onProgress(+m[1]);
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('error', (e) => reject(new Error(`녹취 엔진을 실행하지 못했습니다: ${e.message}`)));
    child.on('close', (code) => {
      const jf = `${outBase}.json`;
      try {
        if (code !== 0 || !fs.existsSync(jf)) throw new Error(/failed to read|audio/i.test(err) ? '녹음 파일을 읽지 못했습니다. wav·mp3·ogg·flac 파일인지 확인해 주세요.' : `녹취 엔진 오류 (종료 코드 ${code}): ${err.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`);
        const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
        const segs = (j.transcription || []).map((s) => ({ t: s.offsets ? s.offsets.from / 1000 : sec(s.timestamps?.from), text: String(s.text || '').trim() })).filter((s) => s.text);
        resolve({ text: segs.map((s) => `[${hms(s.t)}] ${s.text}`).join('\n'), seconds: segs.length ? segs[segs.length - 1].t : 0, model: key });
      } catch (e) { reject(e); } finally { fs.rmSync(jf, { force: true }); }
    });
  });
}

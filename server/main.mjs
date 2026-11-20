// 라온 교회 올인원 서버: 이번 주 준비함 + 기존 프로그램(예배송출·PraiseFlow·쇼츠·장부 등) 연결.
// 외부 인터넷 없이 이 컴퓨터 안에서만 동작한다 (PraiseFlow 찬양 추천만 그 프로그램이 인터넷을 씀).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore, uid } from './store.mjs';
import { parseShareLink, fetchSetlist, applySetlist } from './musicsheet.mjs';
import { httpWc, memoryWc, findLinks, applyWeek, copyService, summarize, snapshot, fingerprint, diffSnapshots } from './wc.mjs';
import { sampleWcSeed, sampleHubSeed, samplePeopleSeed, sampleFinanceSeed, sampleAdminSeed, sampleServeSeed } from './sample.mjs';
import { aiStatus, generate, LABELS, PROVIDERS, setGeminiKey } from './ai.mjs';
import { KINDS, MIN_NOTES, buildPrompt, extractResult, sampleResult } from './after.mjs';
import { peopleApi } from './people.mjs';
import { financeApi } from './finance.mjs';
import { adminApi, fetchGcal, minutesBusy } from './admin.mjs';
import { makeUpdater } from './update.mjs';
import { bootingFile } from './boot.mjs';
import { makeBackups } from './backup.mjs';
import { makeLock, areaOf } from './lock.mjs';
import { cleanCss, cleanStyleSettings, THEMES, STYLE_SYSTEM, stylePrompt, extractCss, sampleStyle } from './bulletinStyle.mjs';
import { bulletinData, bulletinHtml, cleanBulletinSettings, cleanWeekBlock, blockText, BLOCKS, PRIVATE_BLOCKS, BULLETIN_DEFAULTS, cleanImage, fillImages, pruneImages } from './bulletin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } })();
const PORT = Number(process.env.PORT || 5191);
const WIN = process.platform === 'win32';
// 윈도우판은 프로그램 폴더를 통째로 바꿔 업데이트하므로 자료는 %APPDATA% 에 둔다 (예배송출과 같은 방식)
const DATA_DIR = process.env.HUB_DATA_DIR || (WIN ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ChurchAllInOne') : path.join(ROOT, 'data'));
// 윈도우 묶음의 맨 위 폴더 (node·apps 폴더가 있는 곳)
const BUNDLE_DIR = process.env.BUNDLE_DIR || path.resolve(ROOT, '..');
const WC_URL = process.env.WC_URL || 'http://127.0.0.1:5300';
const PRAISEFLOW_URL = process.env.PRAISEFLOW_URL || 'http://127.0.0.1:5173';
// 점검(하네스)에서는 기록 폴더와 프로그램 목록을 시험용으로 바꿔 실제 기록·프로그램을 건드리지 않는다
const LOG_DIR = process.env.HUB_LOG_DIR || path.join(os.homedir(), '.raon-workspace');
const APPS_FILE = process.env.HUB_APPS_FILE || path.join(ROOT, 'apps.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });
if (!WIN) process.env.PATH = `${os.homedir()}/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`;

// ── 새 버전 알림·자동 설치 (server/update.mjs) ─────────────
// 설교 후 자료·회의록 AI 작업이 돌고 있으면 다시 켜지 않는다 (그 작업이 사라지므로)
const busyNow = () => (afterJobs.size ? '설교 후 자료를 만드는 중이라' : minutesBusy() ? '회의록을 받아 적거나 정리하는 중이라' : '');
const updater = makeUpdater({ dataDir: DATA_DIR, version: VERSION, appRoot: process.env.HUB_APP_ROOT || ROOT, isBusy: () => busyNow(), restart: (v) => restartInto(v) });

// ── 작업 공간: real(우리 교회) / sample(예제) ─────────────────
let backups = null;   // 아래에서 만듦 (저장할 때마다 하루 한 번 바깥 백업)
const sampleWc = memoryWc(path.join(DATA_DIR, 'sample-caster.json'), sampleWcSeed);
const spaces = {
  real: { store: openStore(DATA_DIR, 'real', { onSaved: () => backups?.external() }), wc: () => httpWc(spaces.real.store.db.settings?.wcUrl || WC_URL) },
  sample: { store: openStore(DATA_DIR, 'sample'), wc: () => sampleWc },
};
backups = makeBackups({ dataDir: DATA_DIR, store: spaces.real.store, isBusy: () => busyNow() });
// 성도·재정·행정 잠금 (실제 교회 자료만). 자료 폴더에 '잠금풀기.txt' 가 있으면 켤 때 잠금을 없앤다
const lock = makeLock({ dataDir: DATA_DIR });
if (!spaces.real.store.broken && lock.applyReset(spaces.real.store.db)) { await spaces.real.store.save(); console.log('[잠금] 잠금풀기 파일이 있어 잠금을 없앴습니다.'); }
backups.external().catch(() => {});   // 켤 때 한 번 (오늘 아직 안 했으면)

async function resetSample() {
  sampleWc.reset();
  const people = samplePeopleSeed();
  await spaces.sample.store.reset({ ...sampleHubSeed(await sampleWc.state()), ...people, peopleSeeded: true, finance: sampleFinanceSeed(people.members), financeSeeded: true, ...sampleAdminSeed(people.members), adminSeeded: true, ...sampleServeSeed(people.members), serveSeeded: true });
}
if (!spaces.sample.store.db.church) await resetSample();
// 성도 명부가 생기기 전에 만든 예제 자료에도 예제 성도를 한 번 넣어 준다 (실제 교회 자료에는 넣지 않음)
{
  const db = spaces.sample.store.db;
  if (!db.peopleSeeded) { Object.assign(db, samplePeopleSeed(), { peopleSeeded: true }); await spaces.sample.store.save(); }
  if (!db.adminSeeded) { Object.assign(db, sampleAdminSeed(db.members), { adminSeeded: true }); await spaces.sample.store.save(); }
  if (!db.serveSeeded) { Object.assign(db, sampleServeSeed(db.members), { serveSeeded: true }); await spaces.sample.store.save(); }
  if (!db.financeSeeded) { Object.assign(db, { finance: sampleFinanceSeed(db.members), financeSeeded: true }); await spaces.sample.store.save(); }
}

// 구글 캘린더(비공개 주소)를 연결해 두었으면 15분마다 새로 받아 둔다 (화면을 열지 않아도 홈·달력에 최신 일정)
async function refreshGcal() {
  const db = spaces.real.store.db;
  const cals = db.gcals || (db.gcal ? [db.gcal] : []);
  if (!cals.length) return;
  for (const g of cals) await fetchGcal(g);
  await spaces.real.store.save();
}
setTimeout(() => refreshGcal().catch(() => {}), 5000);
setInterval(() => refreshGcal().catch(() => {}), 15 * 60 * 1000).unref();

// ── 도움 함수 ─────────────────────────────────────
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
async function body(req, max = 5e6) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > max) throw new HttpError(413, '보낸 자료가 너무 큽니다.'); }
  try { return s ? JSON.parse(s) : {}; } catch { throw new HttpError(400, '자료 형식이 올바르지 않습니다.'); }
}
const str = (v, n = 200) => String(v ?? '').slice(0, n);
const WEEK_FIELDS = {
  date: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined),
  name: (v) => str(v, 60), passage: (v) => str(v, 120), sermonTitle: (v) => str(v, 120),
  announcements: (v) => (Array.isArray(v) ? v.map((x) => str(x, 300)).slice(0, 30) : undefined),
  sermonNotes: (v) => str(v, 100000), sermonVideoUrl: (v) => str(v, 300), prayerLeader: (v) => str(v, 40),
};
const WEEK_LABEL = { date: '날짜', name: '예배 이름', passage: '본문', sermonTitle: '설교 제목', announcements: '광고', sermonNotes: '설교 원고', sermonVideoUrl: '설교 영상 주소', prayerLeader: '대표 기도' };
function cleanWeek(b) {
  const out = {};
  for (const [k, f] of Object.entries(WEEK_FIELDS)) if (b[k] !== undefined) { const v = f(b[k]); if (v !== undefined) out[k] = v; }
  return out;
}
// 화면으로 보낼 예배 기록: music sheet 공유 비밀번호와 이번 주 주보 고침은 뺀다
// (주보 고침에는 봉사자 이름 같은 잠금 대상이 들어갈 수 있어, 잠금을 따지는 /bulletin/blocks 로만 준다)
const pub = (w) => {
  if (!w.musicSheet && !w.bulletin) return w;
  const { bulletin, ...rest } = w;
  return rest.musicSheet ? { ...rest, musicSheet: { url: rest.musicSheet.url, hasPin: !!rest.musicSheet.pin } } : rest;
};
const getWeek = (sp, id) => { const w = sp.store.db.weeks[id]; if (!w) throw new HttpError(404, '예배 기록을 찾을 수 없습니다.'); return w; };

// 함께 쓰는 '설교자 이름 자막'은 가장 최근(이번 주·다음 예배) 기록일 때만 바꾼다.
// 지난 예배를 열어 보거나 고쳐도 지금 송출용 이름 자막이 지난 제목으로 바뀌지 않게.
const isNewest = (sp, w) => !Object.values(sp.store.db.weeks).some((x) => x.id !== w.id && x.wc?.serviceId && x.date > w.date);

async function wcTry(fn) {
  try { return { ok: true, ...(await fn()) }; }
  catch (e) { return { ok: false, offline: e.code === 'WC_OFFLINE', error: e.message }; }
}

// 예배 기록 하나의 예배송출 쪽 상태 (콘티·자막·확정본)
async function weekStatus(sp, w) {
  if (!w.wc?.serviceId) return { linked: false, connected: null };
  try {
    // 예배송출이 꺼져 있을 때 저장한 본문·제목·광고가 있으면 지금 반영 (바뀐 게 없으면 아무것도 쓰지 않음)
    if (w.wc.serviceId) await applyWeek(sp.wc(), w, { shared: isNewest(sp, w) }).catch((e) => { if (e.code === 'WC_OFFLINE') throw e; });
    const state = await sp.wc().state();
    const summary = summarize(state, w.wc.serviceId);
    if (!summary) return { linked: true, connected: true, missing: true };
    let final = { state: 'none' };
    if (w.final) {
      const now = snapshot(state, w.wc.serviceId);
      const same = fingerprint(now) === w.final.fp;
      final = { state: same ? 'same' : 'changed', at: w.final.at, changes: same ? [] : diffSnapshots(w.final.snap, now) };
    }
    return { linked: true, connected: true, summary, final };
  } catch (e) {
    return { linked: true, connected: false, error: e.message };
  }
}

async function linkTemplate(sp, w, template = 'sunday') {
  const wc = sp.wc();
  const svc = await wc.createService({ name: w.name, date: w.date, template });
  const links = findLinks(await wc.state(), svc.id);
  w.wc = { serviceId: svc.id, links };
  return applyWeek(wc, w, { shared: isNewest(sp, w) });
}

// ── 프로그램 실행 (기존 '라온동행교회 작업실'의 방식을 그대로 가져옴) ─────
// apps.json의 '~/…' 경로는 이 컴퓨터 사용자의 홈 폴더로 바꿔 읽는다 (다른 맥에 설치해도 그대로 동작)
// 윈도우에서는 각 프로그램의 "win" 설정을 쓰고, 그 설정이 없는 프로그램(맥 전용)은 보이지 않게 한다.
// {bundle} = 윈도우 묶음 맨 위 폴더, %이름% = 윈도우 환경 변수
const expand = (v) => String(v || '').replace(/^~(?=[\\/]|$)/, os.homedir()).replace(/\{bundle\}/g, BUNDLE_DIR).replace(/%(\w+)%/g, (m, k) => process.env[k] ?? m);
const loadApps = () => JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'))
  .map((a) => (WIN ? (a.win ? { ...a, ...a.win } : null) : a)).filter(Boolean)
  .map((a) => ({
    ...a, dir: a.dir ? path.normalize(expand(a.dir)) : '', env: Object.fromEntries(Object.entries(a.env || {}).map(([k, v]) => [k, expand(v)])),
    exe: (a.exe ? [].concat(a.exe) : []).map((x) => path.normalize(expand(x))), installer: a.installer ? path.normalize(expand(a.installer)) : '',
  }));
// 자기 창을 띄우는 데스크톱 앱(윈도우의 설교 쇼츠 메이커 등): 설치되어 있으면 실행, 아니면 묶음에 든 설치 파일을 연다
const appExe = (a) => a.exe.find((x) => fs.existsSync(x)) || '';
const appInstalled = (a) => (a.exe.length ? !!appExe(a) || (!!a.installer && fs.existsSync(a.installer)) : fs.existsSync(a.dir));
const logTail = (id) => { try { return fs.readFileSync(path.join(LOG_DIR, `${id}.log`), 'utf8').trim().split('\n').slice(-3).join(' ').slice(-300); } catch { return ''; } };
async function probe(app) {
  try { await fetch(`http://localhost:${app.port}/`, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
}
async function ensureRunning(app) {
  if (await probe(app)) return;
  if (!fs.existsSync(app.dir)) throw new HttpError(400, `프로그램 폴더를 찾을 수 없습니다: ${app.dir}`);
  const log = fs.openSync(path.join(LOG_DIR, `${app.id}.log`), 'a');
  for (const v of Object.values(app.env)) if (/[\\/]/.test(v)) fs.mkdirSync(v, { recursive: true });   // 자료 폴더 미리 만들기
  const env = { ...process.env, BROWSER: 'none', ...app.env };
  // "run": ["node", "server.js"] 형식이면 쉘 없이 바로 실행 ("node"는 라온 교회 올인원이 쓰는 Node 그대로)
  const child = Array.isArray(app.run)
    ? spawn(app.run[0] === 'node' ? process.execPath : app.run[0], app.run.slice(1), { cwd: app.dir, detached: true, stdio: ['ignore', log, log], env, windowsHide: true })
    : spawn('/bin/zsh', ['-lc', app.start], { cwd: app.dir, detached: true, stdio: ['ignore', log, log], env });
  child.unref();
  let exited = null;
  child.on('exit', (code) => { exited = code; });
  // 처음 켤 때 부품을 받거나 화면을 만드는 프로그램이 있어 넉넉히 기다린다 (최대 3분)
  for (let i = 0; i < 360; i++) {
    if (await probe(app)) return;
    if (exited !== null && exited !== 0) {
      const tail = logTail(app.id);
      throw new HttpError(500, /PYTHON_MISSING/.test(tail) ? `${app.name}에는 파이썬(Python 3)이 필요합니다. https://www.python.org/downloads/ 에서 설치한 뒤(윈도우는 'Add Python to PATH' 체크) 다시 눌러 주세요.` : `${app.name}을 켜지 못했습니다. ${tail ? `(${tail})` : ''} 기록: ${path.join(LOG_DIR, `${app.id}.log`)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new HttpError(504, `프로그램이 제때 켜지지 않았습니다. 처음 켤 때는 부품 준비로 오래 걸릴 수 있으니 잠시 뒤 다시 눌러 주세요. 기록: ${path.join(LOG_DIR, `${app.id}.log`)}`);
}

// 설교 후 자료 만들기는 몇 분 걸려서 뒤에서 돌리고 화면은 상태를 다시 묻는다 (서버를 끄면 진행 중인 것은 사라짐)
const afterJobs = new Map(), afterErrors = new Map();
// 한꺼번에 여러 개를 눌러도 AI 구독은 두 개씩만 돌린다 (나머지는 차례를 기다림)
const AFTER_MAX = 2, afterWait = [];
let afterBusy = 0;
function afterRun(job, task) {
  const go = () => { afterBusy++; job.waiting = false; job.startedAt = Date.now(); task().finally(() => { afterBusy--; const next = afterWait.shift(); if (next) next(); }); };
  if (afterBusy < AFTER_MAX) go(); else { job.waiting = true; afterWait.push(go); }
}

// 주보 편집: 저장하기 전 글로 보는 미리보기 (표 → 칸 글, 10분 뒤 사라짐, 메모리에만)
const bulletinDrafts = new Map();

// 백업 모듈의 오류(code 400·404·409)를 화면에 그대로 알린다
const wrapB = async (fn) => { try { return await fn(); } catch (e) { throw e.code >= 400 && e.code < 500 ? new HttpError(e.code, e.message) : e; } };

// ── API ──────────────────────────────────────────
async function api(req, res, url) {
  const p = url.pathname;
  const m = (re) => p.match(re);
  let r;

  if (p === '/api/health') return send(res, 200, { ok: true, version: VERSION, pid: process.pid });
  if (p === '/api/update' && req.method === 'GET') { await updater.check(url.searchParams.has('force')); return send(res, 200, updater.view()); }
  if (p === '/api/update/install' && req.method === 'POST') {
    const busy = busyNow();
    if (busy) throw new HttpError(409, `${busy} 끝난 뒤에 업데이트해 주세요. (업데이트하면 프로그램이 다시 켜집니다)`);
    updater.install();   // 뒤에서 받고 설치한다. 화면은 /api/update 의 job 으로 진행을 본다
    return send(res, 200, updater.view());
  }
  // ── AI 연결 상태와 제미나이 API 키 (키 값은 돌려주지 않음. 키는 PraiseFlow 와 함께 씀) ──
  if (p === '/api/ai' && req.method === 'GET') return send(res, 200, await aiStatus(url.searchParams.has('refresh')));
  if (p === '/api/ai/gemini-key' && req.method === 'PUT') { const b = await body(req); await wrapB(() => setGeminiKey(b.key)); return send(res, 200, await aiStatus(true)); }
  // ── 백업 (실제 교회 자료만) ──
  if (p === '/api/backup' && req.method === 'GET') return send(res, 200, backups.view());
  // ── 자료 파일이 깨졌을 때 복구 (실제 교회 자료) ──
  // 깨진 동안에는 아래 작업 공간 주소가 모두 503 으로 막히고, 화면은 복구 화면을 띄운다
  if (p === '/api/recovery' && req.method === 'GET') {
    const broken = spaces.real.store.broken;
    return send(res, 200, broken ? { broken, ...backups.candidates() } : { broken: null, list: [] });
  }
  if (p.startsWith('/api/recovery/') && !spaces.real.store.broken) throw new HttpError(409, '자료 파일이 멀쩡해서 복구할 것이 없습니다. 지난 백업으로 되돌리려면 설정 > 백업에서 해 주세요.');
  if (p === '/api/recovery/restore' && req.method === 'POST') { const b = await body(req); return send(res, 200, await wrapB(() => backups.restoreCandidate(b.source, b.file))); }
  if (p === '/api/recovery/fresh' && req.method === 'POST') {
    const b = await body(req);
    if (b.confirm !== '새로 시작') throw new HttpError(400, '빈 자료로 새로 시작하려면 확인 글자를 넣어 주세요.');
    await spaces.real.store.reset({});
    return send(res, 200, { ok: true });
  }
  // 잠금을 켰으면 상태 보기만 빼고 모든 백업 기능(폴더 바꾸기·지금 백업·받기·되살리기)은 암호 뒤에
  if (p.startsWith('/api/backup/')) await wrapB(() => lock.guardAny(spaces.real.store.db, req));
  if (p === '/api/backup/settings' && req.method === 'PUT') { const b = await body(req); const r = await wrapB(() => backups.setDir(b.dir)); return send(res, 200, { ...backups.view(), result: r }); }
  if (p === '/api/backup/now' && req.method === 'POST') { const r = await backups.external(true); return send(res, 200, { ...backups.view(), result: r }); }
  if (p === '/api/backup/download' && req.method === 'GET') { await backups.download(res); return; }
  if (p === '/api/backup/restore-local' && req.method === 'POST') { const b = await body(req); return send(res, 200, await wrapB(() => backups.restoreLocal(b.file))); }
  if (p === '/api/backup/restore' && req.method === 'POST') {
    // 브라우저가 미리 확인(preflight)해야만 붙일 수 있는 머리글이 있어야 받는다 → 다른 곳에서 몰래 보내는 되살리기를 막음
    if (!req.headers['x-file-name']) throw new HttpError(400, '백업 파일 이름(X-File-Name)이 없는 요청은 받지 않습니다.');
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > 2e9) throw new HttpError(413, '백업 파일이 2GB보다 큽니다.'); chunks.push(c); }
    const name = decodeURIComponent(String(req.headers['x-file-name'] || 'backup'));
    return send(res, 200, await wrapB(() => backups.restoreUpload(Buffer.concat(chunks), name)));
  }
  if (p === '/api/update/snooze' && req.method === 'POST') { const b = await body(req); updater.snooze(b.version); return send(res, 200, updater.view()); }
  if (p === '/api/update/settings' && req.method === 'PUT') { const b = await body(req); updater.setNotify(b.notify !== false); return send(res, 200, updater.view()); }

  if (p === '/api/apps' && req.method === 'GET') {
    const apps = await Promise.all(loadApps().map(async (a) => ({ id: a.id, name: a.name, desc: a.desc, icon: a.icon, color: a.color, port: a.port, openPath: a.openPath || '/', installed: appInstalled(a), desktop: a.exe.length > 0, needsInstall: a.exe.length > 0 && !appExe(a), running: a.port ? await probe(a) : false })));
    return send(res, 200, apps);
  }
  if ((r = m(/^\/api\/apps\/([\w-]+)\/start$/)) && req.method === 'POST') {
    const app = loadApps().find((a) => a.id === r[1]);
    if (!app) throw new HttpError(404, '알 수 없는 프로그램입니다.');
    if (app.exe.length) {
      const exe = appExe(app);
      const target = exe || (app.installer && fs.existsSync(app.installer) ? app.installer : '');
      if (!target) throw new HttpError(400, `${app.name}이 설치되어 있지 않습니다.`);
      spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return send(res, 200, { ok: true, url: '', message: exe ? `${app.name} 창이 열립니다. 잠시 기다려 주세요.` : `${app.name} 설치 창을 열었습니다. 설치를 마친 뒤 다시 눌러 주세요.` });
    }
    await ensureRunning(app);
    return send(res, 200, { ok: true, url: `http://localhost:${app.port}${app.openPath || '/'}` });
  }

  r = m(/^\/api\/ws\/(real|sample)(\/.*)?$/);
  if (!r) throw new HttpError(404, '없는 주소입니다.');
  const sp = spaces[r[1]];
  const db = sp.store.db;
  const sub = r[2] || '/';
  const s = (re) => sub.match(re);
  let q;

  // 저장 상태 (저장이 실패하면 화면 위에 알리고, [다시 저장]으로 바로 다시 시도)
  if (sub === '/save-status' && req.method === 'GET') return send(res, 200, sp.store.status());
  if (sub === '/save-status/retry' && req.method === 'POST') { await sp.store.save().catch(() => {}); return send(res, 200, sp.store.status()); }

  // 자료 파일이 깨졌으면 복구할 때까지 실제 교회 자료는 읽지도 저장하지도 않는다 (빈 자료가 '처음 설정'처럼 보이지 않게)
  if (r[1] === 'real' && sp.store.broken) return send(res, 503, { error: '자료 파일이 깨져 있어 읽지 못했습니다. 백업을 골라 되살려 주세요.', broken: sp.store.broken });

  // ── 잠금 (실제 교회 자료의 성도·재정·행정) ──
  if (r[1] === 'real') {
    if (sub === '/lock' && req.method === 'GET') return send(res, 200, lock.view(db, req));
    if (sub === '/lock/unlock' && req.method === 'POST') { const b = await body(req); return send(res, 200, await wrapB(() => lock.unlock(db, b.pin, res))); }
    if (sub === '/lock/lock' && req.method === 'POST') { lock.lockNow(req, res); return send(res, 200, lock.view(db, req)); }
    if (sub === '/lock' && req.method === 'PUT') { const b = await body(req); const v = await wrapB(() => lock.configure(db, b, res)); await sp.store.save(); return send(res, 200, v); }
    await wrapB(() => lock.guard(db, req, areaOf(sub)));
  }

  if (sub === '/' && req.method === 'GET') {
    const wc = await wcTry(async () => { const st = await sp.wc().state(); return { services: st.services.map((x) => ({ id: x.id, name: x.name, date: x.date, count: x.itemIds.length })), currentServiceId: st.currentServiceId }; });
    return send(res, 200, { church: db.church, weeks: Object.values(db.weeks).map(pub), settings: { wcUrl: sp.wc().base }, wc, sample: r[1] === 'sample' });
  }
  if (sub === '/church' && req.method === 'PUT') {
    const b = await body(req);
    db.church = { ...(db.church || {}), name: str(b.name, 60), pastor: str(b.pastor, 40), defaultServiceName: str(b.defaultServiceName || '주일 예배', 40), theology: str(b.theology ?? db.church?.theology ?? '', 200) };
    if (!db.church.name.trim()) throw new HttpError(400, '교회 이름을 입력해 주세요.');
    await sp.store.save();
    return send(res, 200, db.church);
  }
  if (sub === '/reset' && req.method === 'POST') {
    if (r[1] !== 'sample') throw new HttpError(400, '예제 자료만 처음 상태로 되돌릴 수 있습니다.');
    await resetSample();
    return send(res, 200, { ok: true });
  }

  // 새 예배 만들기 (빈 예배 / 지난 예배 복사)
  if (sub === '/weeks' && req.method === 'POST') {
    const b = await body(req);
    const base = cleanWeek(b);
    if (!base.date) throw new HttpError(400, '날짜를 입력해 주세요.');
    const from = b.fromWeekId ? getWeek(sp, b.fromWeekId) : null;
    const parts = b.parts || {};
    const w = {
      id: uid(), date: base.date, name: base.name || from?.name || db.church?.defaultServiceName || '주일 예배',
      passage: '', sermonTitle: '', announcements: [], sermonNotes: '', sermonVideoUrl: '', prayerLeader: '',
      wc: null, final: null, copiedFrom: from?.id || null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    if (from && parts.announcements) w.announcements = [...from.announcements];
    if (from && parts.sermon) Object.assign(w, { passage: from.passage, sermonTitle: from.sermonTitle });
    Object.assign(w, base);
    db.weeks[w.id] = w;
    let sync = { ok: true, skipped: true };
    if (b.wcMode === 'copy' && from?.wc?.serviceId) {
      sync = await wcTry(async () => {
        const wc = sp.wc();
        const { service, map } = await copyService(wc, from.wc.serviceId, { name: w.name, date: w.date });
        const L = from.wc.links || {};
        w.wc = { serviceId: service.id, links: { passage: map[L.passage] || null, title: map[L.title] || null, notice: map[L.notice] || null, prayer: map[L.prayer] || null } };
        return applyWeek(wc, w, { shared: isNewest(sp, w) });
      });
    } else if (b.wcMode === 'template' || (b.wcMode === 'copy' && !from?.wc?.serviceId)) {
      sync = await wcTry(() => linkTemplate(sp, w, 'sunday'));
    }
    await sp.store.save();
    return send(res, 200, { week: pub(w), sync });
  }

  if ((q = s(/^\/weeks\/([a-f0-9]+)$/))) {
    const w = getWeek(sp, q[1]);
    if (req.method === 'GET') return send(res, 200, { week: pub(w), status: await weekStatus(sp, w) });
    if (req.method === 'PUT') {
      const b = await body(req);
      const next = cleanWeek(b);
      // 두 창에서 같은 예배를 고칠 때: 화면은 고친 칸만 보내고, 고치기 시작할 때의 값(_base)을 함께 보낸다.
      // 그 사이 다른 창이 같은 칸을 바꿨으면 덮어쓰지 않고 알려 준다 (_base 가 없으면 예전처럼 그대로 저장)
      if (b._base && typeof b._base === 'object') {
        const was = cleanWeek(b._base), J = JSON.stringify;
        const conflicts = Object.keys(next).filter((k) => k in was && J(w[k] ?? '') !== J(was[k] ?? '') && J(w[k] ?? '') !== J(next[k]))
          .map((k) => ({ field: k, label: WEEK_LABEL[k] || k, theirs: w[k] ?? '' }));
        if (conflicts.length) return send(res, 409, { error: `다른 창에서 ${conflicts.map((c) => `‘${c.label}’`).join('·')}을(를) 먼저 바꿨습니다.`, conflicts });
      }
      Object.assign(w, next, { updatedAt: Date.now() });
      await sp.store.save();   // 라온 교회 올인원 저장은 예배송출 연결과 상관없이 먼저 끝낸다
      const sync = await wcTry(() => applyWeek(sp.wc(), w, { shared: isNewest(sp, w) }));
      return send(res, 200, { week: pub(w), sync });
    }
    if (req.method === 'DELETE') {
      delete db.weeks[w.id];
      if (db.after) delete db.after[w.id];   // 이 예배 기록으로 만든 설교 후 자료도 함께
      await sp.store.save();
      return send(res, 200, { ok: true });
    }
  }
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/status$/)) && req.method === 'GET') {
    return send(res, 200, await weekStatus(sp, getWeek(sp, q[1])));
  }
  // 예배송출 연결: 새 순서 만들기 / 이미 있는 순서에 연결
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/link$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]);
    const b = await body(req);
    const sync = await wcTry(async () => {
      if (b.serviceId) {
        const state = await sp.wc().state();
        if (!state.services.some((x) => x.id === b.serviceId)) throw new Error('그 예배 순서를 예배송출에서 찾을 수 없습니다.');
        w.wc = { serviceId: b.serviceId, links: findLinks(state, b.serviceId) };
        return applyWeek(sp.wc(), w, { shared: isNewest(sp, w) });
      }
      return linkTemplate(sp, w, 'sunday');
    });
    await sp.store.save();
    return send(res, 200, { week: pub(w), sync });
  }
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/unlink$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]);
    w.wc = null;
    await sp.store.save();
    return send(res, 200, { week: pub(w) });
  }
  // 라온 music sheet 공유 링크로 콘티 가져오기 (한쪽으로만 읽음, 로그인 정보는 쓰지 않음)
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/musicsheet$/))) {
    const w = getWeek(sp, q[1]);
    const view = async () => {
      const l = w.musicSheet;
      if (!l?.token) return { link: null };
      const link = { url: l.url, hasPin: !!l.pin };
      try { return { link, setlist: await fetchSetlist(l.token, l.pin) }; } catch (e) { return { link, error: e.message, needPin: e.code === 401 }; }
    };
    if (req.method === 'GET') return send(res, 200, await view());
    if (req.method === 'PUT') {
      const b = await body(req);
      const token = await wrapB(() => parseShareLink(b.url));
      if (!token) delete w.musicSheet;
      else {
        const keepPin = w.musicSheet?.token === token ? w.musicSheet.pin : '';
        w.musicSheet = { url: str(b.url, 300).trim(), token, pin: b.pin === undefined ? keepPin || '' : str(b.pin, 40).trim() };
      }
      w.updatedAt = Date.now();
      await sp.store.save();
      return send(res, 200, await view());
    }
  }
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/musicsheet\/apply$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]);
    if (!w.wc?.serviceId) throw new HttpError(400, '먼저 예배송출 예배 순서와 연결해 주세요.');
    if (!w.musicSheet?.token) throw new HttpError(400, '먼저 music sheet 공유 링크를 넣어 주세요.');
    const sl = await wrapB(() => fetchSetlist(w.musicSheet.token, w.musicSheet.pin));
    const r = await wrapB(() => applySetlist(sp.wc(), w.wc.serviceId, sl));
    return send(res, 200, { ...r, status: await weekStatus(sp, w) });
  }
  // 콘티: 곡 넣기·빼기·순서·조성·곡 구성
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/setlist$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]);
    if (!w.wc?.serviceId) throw new HttpError(400, '먼저 예배송출 예배 순서와 연결해 주세요.');
    const b = await body(req);
    const wc = sp.wc();
    const st = await wc.state();
    const svc = st.services.find((x) => x.id === w.wc.serviceId);
    if (!svc) throw new HttpError(404, '연결된 예배 순서를 예배송출에서 찾을 수 없습니다.');
    let ids = [...svc.itemIds];
    const typeOf = (id) => st.items.find((i) => i.id === id)?.type;
    if (b.op === 'add') {
      if (!st.items.some((i) => i.id === b.itemId && (i.type === 'song' || i.type === 'score'))) throw new HttpError(404, '곡을 찾을 수 없습니다.');
      let at = -1;
      ids.forEach((id, i) => { if (typeOf(id) === 'song' || typeOf(id) === 'score') at = i; });
      if (at < 0) at = ids.findIndex((id) => /찬양/.test(st.items.find((i) => i.id === id)?.title || ''));
      if (at < 0) ids.push(b.itemId); else ids.splice(at + 1, 0, b.itemId);
    } else if (b.op === 'addNew') {
      // 찬양 자료에 없는 추천곡: 예배송출에 제목만 있는 새 곡을 만들고 콘티에 넣는다 (가사는 예배송출에서 채움)
      const title = str(b.title, 100).trim();
      if (!title) throw new HttpError(400, '곡 제목이 없습니다.');
      const it = await wc.addItem({ type: 'song', title, slides: [] });
      if (b.artist || b.source) db.songMeta[it.id] = { writer: str(b.artist, 200), source: str(b.source, 200), distinguish: '' };
      st.items.push(it);
      let at = -1;
      ids.forEach((id, i) => { if (typeOf(id) === 'song' || typeOf(id) === 'score') at = i; });
      if (at < 0) at = ids.findIndex((id) => /찬양/.test(st.items.find((i) => i.id === id)?.title || ''));
      if (at < 0) ids.push(it.id); else ids.splice(at + 1, 0, it.id);
      await sp.store.save();
    } else if (b.op === 'remove') {
      ids = ids.filter((id) => id !== b.itemId);
    } else if (b.op === 'move') {
      // 콘티 화면에서는 곡끼리만 자리를 바꾼다 (순서 자막 사이로 끼어들지 않게)
      const isSong = (id) => ['song', 'score'].includes(typeOf(id));
      const i = ids.indexOf(b.itemId), d = b.dir < 0 ? -1 : 1;
      let j = i + d;
      if (b.songsOnly) while (j >= 0 && j < ids.length && !isSong(ids[j])) j += d;
      if (i >= 0 && j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
    } else if (b.op === 'item') {
      const patch = {};
      if (b.key !== undefined) patch.key = str(b.key, 10);
      if (b.memo !== undefined) patch.memo = str(b.memo, 200);
      if (Array.isArray(b.arr)) patch.arr = b.arr.map((x) => str(x, 20)).filter(Boolean).slice(0, 60);
      await wc.updateItem(b.itemId, patch);
    } else if (b.op === 'note') {
      await wc.updateService(svc.id, { note: str(b.note, 1000) });
    } else throw new HttpError(400, '알 수 없는 작업입니다.');
    if (['add', 'addNew', 'remove', 'move'].includes(b.op)) await wc.updateService(svc.id, { itemIds: ids });
    return send(res, 200, await weekStatus(sp, w));
  }
  // 확정본 만들기 / 확정본으로 되돌리기
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/finalize$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]);
    if (!w.wc?.serviceId) throw new HttpError(400, '예배송출 예배 순서와 연결된 뒤에 확정할 수 있습니다.');
    const snap = snapshot(await sp.wc().state(), w.wc.serviceId);
    if (!snap) throw new HttpError(404, '연결된 예배 순서를 예배송출에서 찾을 수 없습니다.');
    w.final = { at: Date.now(), snap, fp: fingerprint(snap) };
    (w.finalHistory ||= []).unshift({ at: w.final.at, snap });
    w.finalHistory = w.finalHistory.slice(0, 5);
    await sp.store.save();
    return send(res, 200, { week: pub(w), status: await weekStatus(sp, w) });
  }
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/restore$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]);
    if (!w.final) throw new HttpError(400, '확정본이 없습니다.');
    const wc = sp.wc();
    const st = await wc.state();
    const ids = [];
    for (const it of w.final.snap.items) {
      const fields = { title: it.title, slides: it.slides, arr: it.arr, key: it.key, bpm: it.bpm, memo: it.memo, theme: it.theme };
      if (st.items.some((x) => x.id === it.id)) { await wc.updateItem(it.id, fields); ids.push(it.id); }
      else ids.push((await wc.addItem({ ...fields, type: it.type, slides: it.slides.map(({ id, ...x }) => x) })).id);
    }
    await wc.updateService(w.wc.serviceId, { itemIds: ids });
    const snap = snapshot(await wc.state(), w.wc.serviceId);
    w.final = { ...w.final, snap, fp: fingerprint(snap) };
    await sp.store.save();
    return send(res, 200, { week: pub(w), status: await weekStatus(sp, w) });
  }
  // 예배송출에서 이 예배를 '지금 예배'로 열기
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/open-caster$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]);
    if (!w.wc?.serviceId) throw new HttpError(400, '예배송출 예배 순서와 연결되어 있지 않습니다.');
    await sp.wc().setCurrent(w.wc.serviceId);
    return send(res, 200, { ok: true, url: sp.wc().kind === 'http' ? `${sp.wc().base.replace('127.0.0.1', 'localhost')}/control` : null });
  }

  // 주보: 고정 정보(주소·예배 시간·계좌·표어)와 보일 칸 고르기, 인쇄용·휴대폰 주보 만들기
  if (sub === '/bulletin' && req.method === 'GET') return send(res, 200, cleanBulletinSettings({ ...BULLETIN_DEFAULTS, ...(db.bulletin || {}) }));
  if (sub === '/bulletin' && req.method === 'PUT' && r[1] === 'real') await wrapB(() => lock.guardAny(db, req));   // 잠금 중에는 주보 칸(생일 등)을 켜지 못하게
  if (sub === '/bulletin' && req.method === 'PUT') { db.bulletin = cleanBulletinSettings(await body(req)); pruneImages(db); await sp.store.save(); return send(res, 200, db.bulletin); }
  // 주보 그림 올리기 (화면이 크기를 줄여 data URL 로 보냄) → 번호. 같은 그림은 한 번만 둔다
  // 주보 꾸미기 (겉모양만): 기본 스타일 목록 · 고른 스타일 저장 · AI 로 새 스타일 만들기
  // 겉모양은 성도 정보를 드러내지 않으므로 잠금과 상관없이 바꿀 수 있다. AI 에는 분위기 설명만 보낸다(교회 자료는 보내지 않음).
  if (sub === '/bulletin/style' && req.method === 'GET') {
    const cur = cleanBulletinSettings({ ...BULLETIN_DEFAULTS, ...(db.bulletin || {}) });
    return send(res, 200, { themes: Object.entries(THEMES).map(([id, t]) => ({ id, name: t.name, css: t.css })), theme: cur.theme, customCss: cur.customCss, customName: cur.customName, myStyles: cur.myStyles });
  }
  if (sub === '/bulletin/style' && req.method === 'PUT') {
    const b = await body(req);
    const cur = db.bulletin || {};
    const next = cleanStyleSettings({ theme: b.theme ?? cur.theme, customCss: b.customCss ?? cur.customCss, customName: b.customName ?? cur.customName, myStyles: b.myStyles ?? cur.myStyles });
    db.bulletin = cleanBulletinSettings({ ...BULLETIN_DEFAULTS, ...cur, ...next });
    await sp.store.save();
    return send(res, 200, { theme: db.bulletin.theme, customCss: db.bulletin.customCss, customName: db.bulletin.customName, myStyles: db.bulletin.myStyles });
  }
  if (sub === '/bulletin/style/ai' && req.method === 'POST') {
    const b = await body(req);
    const desc = String(b.desc ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 500);
    if (desc.length < 2) throw new HttpError(400, '원하는 주보 분위기를 적어 주세요. 예: 고풍스러운 명조체, 진한 초록과 금색');
    const base = b.base ? cleanCss(b.base).css : '';
    if (r[1] === 'sample') { await new Promise((ok) => setTimeout(ok, 300)); const x = sampleStyle(desc); return send(res, 200, { ...x, dropped: 0, via: '예제 (AI를 부르지 않음)', sample: true }); }
    const st = await aiStatus(true);
    const provider = PROVIDERS.includes(b.provider) && st[b.provider]?.loggedIn ? b.provider : st.provider;
    if (!provider) throw new HttpError(400, '연결된 AI가 없습니다. 설정 > AI 연결에서 Claude·ChatGPT 구독에 로그인하거나 제미나이 API 키를 넣어 주세요. AI 없이도 기본 스타일은 고를 수 있습니다.');
    let text;
    try { text = await generate(provider, STYLE_SYSTEM, stylePrompt(desc, base)); }
    catch (e) { throw new HttpError(502, e.message || 'AI가 답하지 않았습니다.'); }
    const { css: rawCss, name } = extractCss(text);
    const { css, dropped } = cleanCss(rawCss);
    if (!css) throw new HttpError(502, 'AI가 주보에 쓸 수 있는 꾸밈을 만들지 못했습니다. 설명을 조금 바꿔 다시 해 주세요.');
    return send(res, 200, { css, name: name || desc.slice(0, 20), dropped, via: LABELS[provider] });
  }
  if (sub === '/bulletin/images' && req.method === 'POST') {
    const b = await body(req, 2e6);
    const { id, data } = await wrapB(() => cleanImage(b.data));
    (db.bulletinImages ||= {})[id] = { data, at: Date.now() };
    await sp.store.save();
    return send(res, 200, { id });
  }
  if ((q = s(/^\/bulletin\/images\/([a-f0-9]{16})$/)) && req.method === 'GET') {
    const m = String(db.bulletinImages?.[q[1]]?.data || '').match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!m) throw new HttpError(404, '그림을 찾을 수 없습니다.');
    res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.end(Buffer.from(m[2], 'base64')); return;
  }
  // 주보 편집 창: 칸마다 자동 내용과 이번 주에 고친 글
  const bulletinHide = () => (r[1] === 'real' ? { people: !lock.isOpen(db, req, 'people'), admin: !lock.isOpen(db, req, 'admin') } : {});
  const bulletinOrder = async (w) => {
    // 예배 순서: 예배송출에서 (꺼져 있으면 확정본에서)
    const st = await weekStatus(sp, w);
    return (st.summary?.items || w.final?.snap?.items || []).map((i) => ({ title: i.title, type: i.type }));
  };
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/bulletin\/blocks$/))) {
    const w = getWeek(sp, q[1]);
    if (req.method === 'PUT') {
      const b = await body(req);
      const v = await wrapB(() => cleanWeekBlock(b));
      if (!v) throw new HttpError(400, '없는 주보 칸입니다.');
      // 성도·행정 정보가 든 칸은 잠금을 풀어야 고칠 수 있다
      if (r[1] === 'real' && PRIVATE_BLOCKS[b.id]) for (const a of PRIVATE_BLOCKS[b.id]) await wrapB(() => lock.guard(db, req, a));
      const blocks = ((w.bulletin ||= {}).blocks ||= {});
      if (v.img && !db.bulletinImages?.[v.img]) throw new HttpError(400, '그림을 먼저 올려 주세요.');
      if (Object.keys(v).length) blocks[b.id] = v; else delete blocks[b.id];
      pruneImages(db);
      w.updatedAt = Date.now();
      await sp.store.save();
    } else if (req.method !== 'GET') throw new HttpError(405, '지원하지 않는 요청입니다.');
    const hide = bulletinHide();
    const d = bulletinData({ db, week: w, order: await bulletinOrder(w), hide });
    return send(res, 200, {
      settings: d.s,
      blocks: BLOCKS.map(([id, title]) => {
        const locked = (PRIVATE_BLOCKS[id] || []).some((a) => hide[a]);
        const o = locked ? {} : w.bulletin?.blocks?.[id] || {};
        return { id, title, locked, auto: locked ? '' : blockText(d, id), text: typeof o.text === 'string' ? o.text : null, size: o.size === 's' ? 's' : 'n', ...(id === 'photo' ? { img: o.img || null } : {}) };
      }),
    });
  }
  // 저장하기 전 글로 미리보기: 고치던 글을 잠시(10분) 맡겨 두고 표를 돌려준다 → 주보 주소에 &preview=표 를 붙여 연다.
  // 자료에는 저장하지 않는다. 잠금 칸은 고칠 때와 똑같이 잠금을 풀어야 한다.
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/bulletin\/preview$/)) && req.method === 'POST') {
    getWeek(sp, q[1]);
    const b = await body(req);
    const v = await wrapB(() => cleanWeekBlock(b));
    if (!v) throw new HttpError(400, '없는 주보 칸입니다.');
    if (r[1] === 'real' && PRIVATE_BLOCKS[b.id]) for (const a of PRIVATE_BLOCKS[b.id]) await wrapB(() => lock.guard(db, req, a));
    const now = Date.now();
    for (const [k, x] of bulletinDrafts) if (now - x.at > 10 * 60e3) bulletinDrafts.delete(k);
    while (bulletinDrafts.size >= 50) bulletinDrafts.delete(bulletinDrafts.keys().next().value);
    const token = uid() + uid();
    bulletinDrafts.set(token, { ws: r[1], weekId: q[1], id: b.id, v, at: now });
    return send(res, 200, { token });
  }
  // 꾸밈 미리보기: 저장하지 않은 스타일을 잠시(10분) 맡겨 두고 표를 돌려준다 → 주보 주소에 &look=표
  if (sub === '/bulletin/style/preview' && req.method === 'POST') {
    const b = await body(req);
    const look = cleanStyleSettings({ theme: b.theme, customCss: b.customCss });
    const now = Date.now();
    for (const [k, x] of bulletinDrafts) if (now - x.at > 10 * 60e3) bulletinDrafts.delete(k);
    while (bulletinDrafts.size >= 50) bulletinDrafts.delete(bulletinDrafts.keys().next().value);
    const token = uid() + uid();
    bulletinDrafts.set(token, { ws: r[1], look: { theme: look.theme, customCss: look.customCss }, at: now });
    return send(res, 200, { token });
  }
  // 주보 확정본: [주보 확정]을 누른 때의 주보를 세 모양(인쇄용·4면·휴대폰) 그대로 보관한다 (차수·확정 시각).
  // 나중에 표어·광고·배치가 바뀌어도 확정본은 그대로 열린다. 예배마다 최근 FINAL_KEEP 개까지.
  // 확정할 때 잠금으로 가려진 칸(hide)도 함께 적어 두고, 바뀜 비교와 열람 잠금에 쓴다.
  const FINAL_KEEP = 5;
  const renderAll = async (w, hide) => {
    const order = await bulletinOrder(w);
    const d = bulletinData({ db, week: w, order, hide, imgToken: true });   // 그림은 자리표로 (보여 줄 때 채움)
    return { print: bulletinHtml(d, 'print'), fold4: bulletinHtml(d, 'fold4'), mobile: bulletinHtml(d, 'mobile') };
  };
  const finalsView = async (w) => {
    const list = w.bulletin?.finals || [];
    const last = list.at(-1);
    let changed = null;
    if (last) changed = (await renderAll(w, last.hide)).print !== last.html.print;
    return { finals: list.map((f) => ({ v: f.v, at: f.at })).reverse(), changed };
  };
  // 확정본에 봉사자 이름·생일·일정이 들어 있으면 그 잠금을 풀어야 연다
  const guardFinal = async (f) => {
    if (r[1] !== 'real') return;
    if (!f.hide?.people) await wrapB(() => lock.guard(db, req, 'people'));
    if (!f.hide?.admin) await wrapB(() => lock.guard(db, req, 'admin'));
  };
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/bulletin\/finals$/))) {
    const w = getWeek(sp, q[1]);
    if (req.method === 'POST') {
      const hide = bulletinHide();
      const html = await renderAll(w, hide);
      const finals = ((w.bulletin ||= {}).finals ||= []);
      const v = (finals.at(-1)?.v || 0) + 1;
      finals.push({ v, at: Date.now(), hide: { people: !!hide.people, admin: !!hide.admin }, html });
      if (finals.length > FINAL_KEEP) finals.splice(0, finals.length - FINAL_KEEP);
      pruneImages(db);
      await sp.store.save();
    } else if (req.method !== 'GET') throw new HttpError(405, '지원하지 않는 요청입니다.');
    return send(res, 200, await finalsView(w));
  }
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/bulletin$/)) && req.method === 'GET' && url.searchParams.has('final')) {
    const w = getWeek(sp, q[1]);
    const f = (w.bulletin?.finals || []).find((x) => String(x.v) === url.searchParams.get('final'));
    if (!f) throw new HttpError(404, '그 확정본을 찾을 수 없습니다. (예배마다 최근 5개까지 보관합니다)');
    await guardFinal(f);
    const format = ['mobile', 'fold4'].includes(url.searchParams.get('format')) ? url.searchParams.get('format') : 'print';
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" };
    if (url.searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename="bulletin-${w.date}-v${f.v}.html"; filename*=UTF-8''${encodeURIComponent(`${db.church?.name || '교회'} 주보 ${w.date} 확정${f.v}차.html`)}`;
    const at = new Date(f.at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    // 화면에서만 보이는 확정본 표시 (인쇄·휴대폰 파일 본문에는 넣지 않음)
    const note = format === 'mobile' ? '' : `<p class="how final-note" style="background:#e8f3ec;border-color:#9cc8ad">📌 확정본 ${f.v}차 · ${at} 확정 · 그 뒤에 바뀐 내용은 들어 있지 않습니다.</p>`;
    res.writeHead(200, headers);
    res.end(fillImages(f.html[format], db).replace(/(<body[^>]*>)/, `$1${note}`)); return;
  }
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/bulletin$/)) && req.method === 'GET') {
    let w = getWeek(sp, q[1]);
    const dr = bulletinDrafts.get(url.searchParams.get('preview') || '');
    if (dr && !dr.look && dr.ws === r[1] && dr.weekId === w.id) w = { ...w, bulletin: { ...(w.bulletin || {}), blocks: { ...(w.bulletin?.blocks || {}), [dr.id]: dr.v } } };
    const order = await bulletinOrder(w);
    const format = ['mobile', 'fold4'].includes(url.searchParams.get('format')) ? url.searchParams.get('format') : 'print';
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" };
    if (url.searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename="bulletin-${w.date}.html"; filename*=UTF-8''${encodeURIComponent(`${db.church?.name || '교회'} 주보 ${w.date}.html`)}`;
    res.writeHead(200, headers); const hide = bulletinHide();
    const d = bulletinData({ db, week: w, order, hide });
    const lk = bulletinDrafts.get(url.searchParams.get('look') || '');
    if (lk?.look && lk.ws === r[1]) d.s = { ...d.s, ...lk.look };
    res.end(bulletinHtml(d, format)); return;
  }

  // 찬양 자료 (가사·곡 구성은 예배송출, 작사·작곡·출처·구분 메모는 라온 교회 올인원)
  if (sub === '/songs' && req.method === 'GET') {
    const r2 = await wcTry(async () => {
      const st = await sp.wc().state();
      const used = {};
      for (const sv of st.services) for (const id of sv.itemIds) (used[id] ||= []).push(sv.date);
      const songs = st.items.filter((i) => i.type === 'song' || i.type === 'score').map((i) => ({
        id: i.id, type: i.type, title: i.title, key: i.key || '', arr: i.arr || [], memo: i.memo || '',
        labels: [...new Set((i.slides || []).map((x) => x.label).filter(Boolean))],
        lyrics: (i.slides || []).map((x) => (x.label ? `[${x.label}]\n` : '') + (x.text || '')).join('\n'),
        slideCount: (i.slides || []).length, lastUsed: (used[i.id] || []).sort().pop() || null,
        meta: db.songMeta[i.id] || {},
      }));
      return { songs };
    });
    return send(res, 200, r2);
  }
  if ((q = s(/^\/songs\/([a-f0-9]+)\/meta$/)) && req.method === 'PUT') {
    const b = await body(req);
    db.songMeta[q[1]] = { writer: str(b.writer, 200), source: str(b.source, 200), distinguish: str(b.distinguish, 200) };
    await sp.store.save();
    return send(res, 200, db.songMeta[q[1]]);
  }

  // ── PraiseFlow(찬양 큐레이터) 연동 ──
  // 상태: 켜져 있는지, Gemini API 키가 저장돼 있는지 (키 값 자체는 받지 않음)
  if (sub === '/praiseflow' && req.method === 'GET') {
    if (r[1] === 'sample') return send(res, 200, { sample: true, running: true, ready: true, providerLabel: '예제' });
    const app = loadApps().find((a) => a.id === 'worship');
    try {
      const j = await (await fetch(`${PRAISEFLOW_URL}/api/status`, { signal: AbortSignal.timeout(2000) })).json();
      return send(res, 200, { running: true, ready: j.ready ?? !!j.hasApiKey, providerLabel: j.providerLabel || 'Gemini API 키', installed: true });
    } catch { return send(res, 200, { running: false, ready: null, installed: !!app && fs.existsSync(app.dir) }); }
  }
  // 이번 주 본문·제목·요지로 추천받고, 결과를 예배 기록에 보관 (다시 열어도 남아 있음)
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/recommend$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]);
    const b = await body(req);
    const hymnCount = Math.min(5, Math.max(0, +b.hymnCount || 0)), ccmCount = Math.min(10, Math.max(0, +b.ccmCount || 0));
    if (!hymnCount && !ccmCount) throw new HttpError(400, '추천받을 곡 수를 정해 주세요.');
    const input = [w.passage && `본문: ${w.passage}`, w.sermonTitle && `설교 제목: ${w.sermonTitle}`, w.sermonNotes && `설교 원고/요지:\n${w.sermonNotes}`].filter(Boolean).join('\n');
    if (!w.passage.trim() && !w.sermonTitle.trim()) throw new HttpError(400, '예배 정보 탭에서 본문이나 설교 제목을 먼저 입력해 주세요.');
    let j;
    if (r[1] === 'sample') {
      j = { theme: '하나님의 돌보심 (예시)', keyMessage: '예제 모드에서는 인터넷에 묻지 않고 정해진 예시를 보여 줍니다.', recommendations: [
        { title: '[예제] 은혜의 강', artist: '예제', type: 'CCM', reason: '돌보심에 대한 고백', mood: '잔잔함', era: '최근 10년 (2016년 이후)' },
        { title: '[예제] 주님만 바라봅니다', artist: '예제', type: 'CCM', reason: '말씀 앞에서 시선을 모음', mood: '고요함', era: '1980년대 ~ 2015년' },
        { title: '[예제] 보내심의 노래', artist: '예제', type: 'CCM', reason: '말씀 후 결단', mood: '힘참', era: '최근 10년 (2016년 이후)' },
      ] };
    } else {
      const app = loadApps().find((a) => a.id === 'worship');
      const up = await fetch(`${PRAISEFLOW_URL}/api/status`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
      if (!up) try { await ensureRunning(app); } catch (e) { return send(res, 200, { ok: false, offline: true, error: `PraiseFlow를 켜지 못했습니다: ${e.message}` }); }
      try {
        const pr = await fetch(`${PRAISEFLOW_URL}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: input.slice(0, 30000), hymnCount, ccmCount }), signal: AbortSignal.timeout(300000) });
        j = await pr.json().catch(() => ({}));
        if (!pr.ok) return send(res, 200, { ok: false, needKey: pr.status === 401, error: j.error || `PraiseFlow 오류 (${pr.status})` });
      } catch (e) {
        return send(res, 200, { ok: false, offline: e.name !== 'TimeoutError', error: e.name === 'TimeoutError' ? 'PraiseFlow 응답이 5분 넘게 없어 멈췄습니다. 잠시 뒤 다시 눌러 주세요.' : 'PraiseFlow에 연결하지 못했습니다.' });
      }
    }
    const url = (v) => (/^https?:\/\//.test(String(v || '')) ? str(v, 500) : '');
    w.recs = {
      at: Date.now(), sample: r[1] === 'sample', basis: str(input, 200),
      theme: str(j.theme, 200), keyMessage: str(j.keyMessage, 1000),
      items: (Array.isArray(j.recommendations) ? j.recommendations : []).slice(0, 20).map((x) => ({
        title: str(x.title, 100), artist: str(x.artist, 100), type: str(x.type, 20), reason: str(x.reason, 500), mood: str(x.mood, 100),
        era: str(x.era, 40), youtubeUrl: url(x.youtubeUrl), sheetMusicUrl: url(x.sheetMusicUrl),
      })).filter((x) => x.title),
      sources: (Array.isArray(j.searchSources) ? j.searchSources : []).slice(0, 10).map((x) => ({ uri: url(x.uri), title: str(x.title, 100) })).filter((x) => x.uri),
    };
    await sp.store.save();
    return send(res, 200, { ok: true, recs: w.recs });
  }
  // ── 성도 명부 · 심방 · 출석 ──
  if (await peopleApi({ sub, req, res, db, save: () => sp.store.save(), body, send, HttpError })) return;
  // ── 재정 (장부 · 예산 · 기부금 영수증) ──
  if (await financeApi({ sub, req, res, url, db, save: () => sp.store.save(), body, send, HttpError })) return;
  // ── 행정 (일정 · 회의록 · 증명서) ──
  if (await adminApi({ sub, req, res, db, save: () => sp.store.save(), body, send, HttpError, sample: r[1] === 'sample', dataDir: DATA_DIR, ws: r[1] })) return;

  // ── 설교 후 자료 (인포그래픽 · 블로그 글 · 소그룹 나눔지) ──────────
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/after$/)) && req.method === 'GET') {
    const w = getWeek(sp, q[1]);
    const sample = r[1] === 'sample';
    const ai = sample ? { provider: 'sample', label: '예제 (AI를 부르지 않음)' } : await aiStatus(url.searchParams.has('refresh'));
    const docs = {}, running = {}, errors = {};
    for (const k of Object.keys(KINDS)) {
      const d = db.after?.[w.id]?.[k];
      if (d) docs[k] = { at: d.at, via: d.via, sample: d.sample, chars: d.content.length, basis: d.basis };
      const key = `${r[1]}:${w.id}:${k}`;
      if (afterJobs.has(key)) running[k] = afterJobs.get(key);
      if (afterErrors.has(key)) errors[k] = afterErrors.get(key);
    }
    return send(res, 200, { ai, docs, running, errors, notesChars: w.sermonNotes.trim().length, minNotes: sample ? 0 : MIN_NOTES });
  }
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/after\/([\w-]+)$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]), kind = q[2];
    if (!KINDS[kind]) throw new HttpError(404, '알 수 없는 자료입니다.');
    const sample = r[1] === 'sample';
    if (!sample && w.sermonNotes.trim().length < MIN_NOTES) throw new HttpError(400, `예배 정보 탭의 '설교 원고'에 원고를 붙여 넣어 주세요. (지금 ${w.sermonNotes.trim().length}자 · ${MIN_NOTES}자 이상 필요)`);
    const key = `${r[1]}:${w.id}:${kind}`;
    if (afterJobs.has(key)) return send(res, 200, { ok: true, running: afterJobs.get(key) });
    const b = await body(req);
    let provider = 'sample';
    if (!sample) {
      const st = await aiStatus(true);
      provider = PROVIDERS.includes(b.provider) && st[b.provider]?.loggedIn ? b.provider : st.provider;
      if (!provider) throw new HttpError(400, '연결된 AI가 없습니다. Claude Code(claude)·Codex(codex login)에 로그인하거나, 설정 > AI 연결에서 제미나이 API 키를 넣어 주세요.');
    }
    const ctx = { church: db.church?.name || '', pastor: db.church?.pastor || '', theology: db.church?.theology || '', date: w.date, service: w.name, passage: w.passage, title: w.sermonTitle, notes: w.sermonNotes.trim().slice(0, 60000) };
    const job = { startedAt: Date.now(), provider, label: sample ? '예제' : LABELS[provider] };
    afterJobs.set(key, job); afterErrors.delete(key);
    afterRun(job, async () => {
      try {
        let content;
        if (sample) { await new Promise((ok) => setTimeout(ok, 1200)); content = sampleResult(kind, ctx); }
        else { const { system, prompt } = buildPrompt(kind, ctx); content = extractResult(kind, await generate(provider, system, prompt), ctx); }
        db.after ??= {};
        if (!db.weeks[w.id]) return;   // 그 사이 예배 기록이 지워졌으면 버림
        (db.after[w.id] ??= {})[kind] = { at: Date.now(), via: job.label, sample, basis: `${w.sermonTitle || ''} · 원고 ${ctx.notes.length}자`, content };
        await sp.store.save();
      } catch (e) {
        console.error(`설교 후 자료(${kind}) 실패:`, e.message);
        afterErrors.set(key, { at: Date.now(), message: e.message || '만들지 못했습니다.', kind: e.kind || 'fail' });
      } finally { afterJobs.delete(key); }
    });
    return send(res, 200, { ok: true, running: job });
  }
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/after\/([\w-]+)(\/view)?$/)) && req.method === 'GET') {
    const w = getWeek(sp, q[1]), kind = q[2], def = KINDS[kind];
    const d = def && db.after?.[w.id]?.[kind];
    if (!d) throw new HttpError(404, '아직 만들지 않은 자료입니다.');
    if (!q[3]) return send(res, 200, { ...d });
    const ext = def.format === 'html' ? 'html' : 'md';
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (url.searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename="${w.date}-${def.file}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${w.date} ${w.sermonTitle || ''} ${def.label}.${ext}`.replace(/[\\/:*?"<>|]/g, ''))}`;
    if (ext === 'html') {
      // AI가 만든 페이지는 따로 떨어진 상자(sandbox)에서만 열어 라온 교회 올인원 자료에 손대지 못하게 한다
      headers['Content-Type'] = 'text/html; charset=utf-8';
      headers['Content-Security-Policy'] = "sandbox allow-scripts allow-modals allow-popups allow-downloads; default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data:; script-src 'unsafe-inline'";
    } else headers['Content-Type'] = 'text/plain; charset=utf-8';
    res.writeHead(200, headers); res.end(d.content); return;
  }
  throw new HttpError(404, '없는 주소입니다.');
}

// ── 정적 파일 (빌드된 화면) ─────────────────────────
const DIST = path.join(ROOT, 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function serveStatic(res, url) {
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('화면이 아직 만들어지지 않았습니다. npm run build 를 먼저 실행하세요.'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'max-age=31536000' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      // 이 컴퓨터 주소로 온 요청만 받는다 (다른 사이트가 DNS 재바인딩으로 교회 자료를 읽어 가지 못하게)
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(req.headers.host || ''))) throw new HttpError(403, '이 컴퓨터 주소(localhost)로만 열 수 있습니다.');
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new HttpError(403, '다른 사이트에서 온 요청은 막혀 있습니다.');
      return await api(req, res, url);
    }
    serveStatic(res, url);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e instanceof HttpError ? e.code : 500, { error: e.message || '알 수 없는 오류' });
  }
});
// 업데이트로 다시 켤 때는 옛 본체가 포트를 내줄 때까지 잠시 기다린다
let listenTries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && process.env.HUB_WAIT_PORT && listenTries++ < 60) { setTimeout(() => server.listen(PORT, '127.0.0.1'), 500); return; }
  console.error(e); process.exit(1);
});
server.on('listening', () => {
  delete process.env.HUB_WAIT_PORT;
  fs.rmSync(bootingFile(DATA_DIR), { force: true });   // 끝까지 켜졌다는 표시 (server/index.mjs)
  console.log(`라온 교회 올인원 ${VERSION}: http://localhost:${PORT}  (예배송출 연결: ${spaces.real.wc().base})`);
});
server.listen(PORT, '127.0.0.1');

// 새 본체를 먼저 띄우고(포트를 비워 줌), 새 본체가 그 버전으로 답하면 옛 본체는 끝난다. 30초 안에 안 되면 다시 연다
async function restartInto(ver) {
  await new Promise((ok) => { server.close(() => ok()); server.closeAllConnections?.(); });
  const appRoot = process.env.HUB_APP_ROOT || ROOT;
  const env = { ...process.env, HUB_WAIT_PORT: '1' };
  delete env.HUB_APP_ROOT;
  const log = fs.openSync(path.join(LOG_DIR, 'allinone.log'), 'a');
  const child = spawn(process.execPath, [path.join(appRoot, 'server', 'index.mjs')], { cwd: appRoot, env, detached: true, stdio: ['ignore', log, log], windowsHide: !WIN });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) })).json();
      if (j.version === ver && j.pid !== process.pid) { console.log(`[업데이트] ${ver} 로 다시 켰습니다.`); setTimeout(() => process.exit(0), 200); return; }
    } catch { /* 아직 */ }
  }
  try { child.kill(); } catch { /* 이미 끝남 */ }
  await new Promise((ok) => { server.once('listening', ok); server.listen(PORT, '127.0.0.1'); });
  throw new Error('새 버전이 30초 안에 켜지지 않았습니다');
}

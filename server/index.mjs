// 라온 교회 올인원 서버: 이번 주 준비함 + 기존 프로그램(예배송출·PraiseFlow·쇼츠·장부 등) 연결.
// 외부 인터넷 없이 이 컴퓨터 안에서만 동작한다 (PraiseFlow 찬양 추천만 그 프로그램이 인터넷을 씀).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore, uid } from './store.mjs';
import { httpWc, memoryWc, findLinks, applyWeek, copyService, summarize, snapshot, fingerprint, diffSnapshots } from './wc.mjs';
import { sampleWcSeed, sampleHubSeed, samplePeopleSeed, sampleFinanceSeed, sampleAdminSeed, sampleServeSeed } from './sample.mjs';
import { aiStatus, generate, LABELS } from './ai.mjs';
import { KINDS, MIN_NOTES, buildPrompt, extractResult, sampleResult } from './after.mjs';
import { peopleApi } from './people.mjs';
import { financeApi } from './finance.mjs';
import { adminApi, fetchGcal } from './admin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5191);
const WIN = process.platform === 'win32';
// 윈도우판은 프로그램 폴더를 통째로 바꿔 업데이트하므로 자료는 %APPDATA% 에 둔다 (예배송출과 같은 방식)
const DATA_DIR = process.env.HUB_DATA_DIR || (WIN ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ChurchAllInOne') : path.join(ROOT, 'data'));
// 윈도우 묶음의 맨 위 폴더 (node·apps 폴더가 있는 곳)
const BUNDLE_DIR = process.env.BUNDLE_DIR || path.resolve(ROOT, '..');
const WC_URL = process.env.WC_URL || 'http://127.0.0.1:5300';
const PRAISEFLOW_URL = process.env.PRAISEFLOW_URL || 'http://127.0.0.1:5173';
const LOG_DIR = path.join(os.homedir(), '.raon-workspace');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });
if (!WIN) process.env.PATH = `${os.homedir()}/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`;

// ── 작업 공간: real(우리 교회) / sample(예제) ─────────────────
const sampleWc = memoryWc(path.join(DATA_DIR, 'sample-caster.json'), sampleWcSeed);
const spaces = {
  real: { store: openStore(DATA_DIR, 'real'), wc: () => httpWc(spaces.real.store.db.settings?.wcUrl || WC_URL) },
  sample: { store: openStore(DATA_DIR, 'sample'), wc: () => sampleWc },
};
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
function cleanWeek(b) {
  const out = {};
  for (const [k, f] of Object.entries(WEEK_FIELDS)) if (b[k] !== undefined) { const v = f(b[k]); if (v !== undefined) out[k] = v; }
  return out;
}
const getWeek = (sp, id) => { const w = sp.store.db.weeks[id]; if (!w) throw new HttpError(404, '예배 기록을 찾을 수 없습니다.'); return w; };

async function wcTry(fn) {
  try { return { ok: true, ...(await fn()) }; }
  catch (e) { return { ok: false, offline: e.code === 'WC_OFFLINE', error: e.message }; }
}

// 예배 기록 하나의 예배송출 쪽 상태 (콘티·자막·확정본)
async function weekStatus(sp, w) {
  if (!w.wc?.serviceId) return { linked: false, connected: null };
  try {
    // 예배송출이 꺼져 있을 때 저장한 본문·제목·광고가 있으면 지금 반영 (바뀐 게 없으면 아무것도 쓰지 않음)
    if (w.wc.serviceId) await applyWeek(sp.wc(), w).catch((e) => { if (e.code === 'WC_OFFLINE') throw e; });
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
  return applyWeek(wc, w);
}

// ── 프로그램 실행 (기존 '라온동행교회 작업실'의 방식을 그대로 가져옴) ─────
// apps.json의 '~/…' 경로는 이 컴퓨터 사용자의 홈 폴더로 바꿔 읽는다 (다른 맥에 설치해도 그대로 동작)
// 윈도우에서는 각 프로그램의 "win" 설정을 쓰고, 그 설정이 없는 프로그램(맥 전용)은 보이지 않게 한다.
// {bundle} = 윈도우 묶음 맨 위 폴더, %이름% = 윈도우 환경 변수
const expand = (v) => String(v || '').replace(/^~(?=[\\/]|$)/, os.homedir()).replace(/\{bundle\}/g, BUNDLE_DIR).replace(/%(\w+)%/g, (m, k) => process.env[k] ?? m);
const loadApps = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps.json'), 'utf8'))
  .map((a) => (WIN ? (a.win ? { ...a, ...a.win } : null) : a)).filter(Boolean)
  .map((a) => ({ ...a, dir: path.normalize(expand(a.dir)), env: Object.fromEntries(Object.entries(a.env || {}).map(([k, v]) => [k, expand(v)])) }));
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
  for (let i = 0; i < 120; i++) { if (await probe(app)) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new HttpError(504, `프로그램이 제때 켜지지 않았습니다. 기록: ${path.join(LOG_DIR, `${app.id}.log`)}`);
}

// 설교 후 자료 만들기는 몇 분 걸려서 뒤에서 돌리고 화면은 상태를 다시 묻는다 (서버를 끄면 진행 중인 것은 사라짐)
const afterJobs = new Map(), afterErrors = new Map();

// ── API ──────────────────────────────────────────
async function api(req, res, url) {
  const p = url.pathname;
  const m = (re) => p.match(re);
  let r;

  if (p === '/api/health') return send(res, 200, { ok: true });

  if (p === '/api/apps' && req.method === 'GET') {
    const apps = await Promise.all(loadApps().map(async (a) => ({ id: a.id, name: a.name, desc: a.desc, icon: a.icon, color: a.color, port: a.port, openPath: a.openPath || '/', installed: fs.existsSync(a.dir), running: await probe(a) })));
    return send(res, 200, apps);
  }
  if ((r = m(/^\/api\/apps\/([\w-]+)\/start$/)) && req.method === 'POST') {
    const app = loadApps().find((a) => a.id === r[1]);
    if (!app) throw new HttpError(404, '알 수 없는 프로그램입니다.');
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

  if (sub === '/' && req.method === 'GET') {
    const wc = await wcTry(async () => { const st = await sp.wc().state(); return { services: st.services.map((x) => ({ id: x.id, name: x.name, date: x.date, count: x.itemIds.length })), currentServiceId: st.currentServiceId }; });
    return send(res, 200, { church: db.church, weeks: Object.values(db.weeks), settings: { wcUrl: sp.wc().base }, wc, sample: r[1] === 'sample' });
  }
  if (sub === '/church' && req.method === 'PUT') {
    const b = await body(req);
    db.church = { ...(db.church || {}), name: str(b.name, 60), pastor: str(b.pastor, 40), defaultServiceName: str(b.defaultServiceName || '주일 예배', 40) };
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
        return applyWeek(wc, w);
      });
    } else if (b.wcMode === 'template' || (b.wcMode === 'copy' && !from?.wc?.serviceId)) {
      sync = await wcTry(() => linkTemplate(sp, w, 'sunday'));
    }
    await sp.store.save();
    return send(res, 200, { week: w, sync });
  }

  if ((q = s(/^\/weeks\/([a-f0-9]+)$/))) {
    const w = getWeek(sp, q[1]);
    if (req.method === 'GET') return send(res, 200, { week: w, status: await weekStatus(sp, w) });
    if (req.method === 'PUT') {
      const b = await body(req);
      Object.assign(w, cleanWeek(b), { updatedAt: Date.now() });
      await sp.store.save();   // 라온 교회 올인원 저장은 예배송출 연결과 상관없이 먼저 끝낸다
      const sync = await wcTry(() => applyWeek(sp.wc(), w));
      return send(res, 200, { week: w, sync });
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
        return applyWeek(sp.wc(), w);
      }
      return linkTemplate(sp, w, 'sunday');
    });
    await sp.store.save();
    return send(res, 200, { week: w, sync });
  }
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/unlink$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]);
    w.wc = null;
    await sp.store.save();
    return send(res, 200, { week: w });
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
    return send(res, 200, { week: w, status: await weekStatus(sp, w) });
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
    return send(res, 200, { week: w, status: await weekStatus(sp, w) });
  }
  // 예배송출에서 이 예배를 '지금 예배'로 열기
  if ((q = s(/^\/weeks\/([a-f0-9]+)\/open-caster$/)) && req.method === 'POST') {
    const w = getWeek(sp, q[1]);
    if (!w.wc?.serviceId) throw new HttpError(400, '예배송출 예배 순서와 연결되어 있지 않습니다.');
    await sp.wc().setCurrent(w.wc.serviceId);
    return send(res, 200, { ok: true, url: sp.wc().kind === 'http' ? `${sp.wc().base.replace('127.0.0.1', 'localhost')}/control` : null });
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
      provider = (b.provider === 'claude' || b.provider === 'codex') && st[b.provider].loggedIn ? b.provider : st.provider;
      if (!provider) throw new HttpError(400, '이 컴퓨터에 로그인된 AI 구독이 없습니다. Claude Code(claude) 또는 Codex(codex login)에 로그인해 주세요.');
    }
    const ctx = { church: db.church?.name || '', pastor: db.church?.pastor || '', date: w.date, service: w.name, passage: w.passage, title: w.sermonTitle, notes: w.sermonNotes.trim().slice(0, 60000) };
    const job = { startedAt: Date.now(), provider, label: sample ? '예제' : LABELS[provider] };
    afterJobs.set(key, job); afterErrors.delete(key);
    (async () => {
      try {
        let content;
        if (sample) { await new Promise((ok) => setTimeout(ok, 1200)); content = sampleResult(kind, ctx); }
        else { const { system, prompt } = buildPrompt(kind, ctx); content = extractResult(kind, await generate(provider, system, prompt)); }
        db.after ??= {};
        if (!db.weeks[w.id]) return;   // 그 사이 예배 기록이 지워졌으면 버림
        (db.after[w.id] ??= {})[kind] = { at: Date.now(), via: job.label, sample, basis: `${w.sermonTitle || ''} · 원고 ${ctx.notes.length}자`, content };
        await sp.store.save();
      } catch (e) {
        console.error(`설교 후 자료(${kind}) 실패:`, e.message);
        afterErrors.set(key, { at: Date.now(), message: e.message || '만들지 못했습니다.', kind: e.kind || 'fail' });
      } finally { afterJobs.delete(key); }
    })();
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
      headers['Content-Security-Policy'] = "sandbox allow-scripts allow-modals allow-popups; default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data:; script-src 'unsafe-inline'";
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

http.createServer(async (req, res) => {
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
}).listen(PORT, '127.0.0.1', () => console.log(`라온 교회 올인원: http://localhost:${PORT}  (예배송출 연결: ${spaces.real.wc().base})`));

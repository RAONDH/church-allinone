// 새 버전 알림과 자동 설치.
// - 6시간에 한 번 GitHub Releases 의 latest 를 보고, 지금보다 새 버전이면 화면에 알린다.
// - 설치: 우리 저장소의 releases/download/ 에서 업데이트 묶음과 SHA256SUMS.txt 를 받아 확인값이 맞을 때만,
//   사용자 자료를 한 벌 백업한 뒤 자료 폴더의 app-update/버전 에 풀고, 다 풀린 뒤에야 current.json 을 바꾼다.
//   (맥 .app 이나 앱 폴더의 파일은 고치지 않는다)
// - 다시 켜기: 옛 본체가 문을 닫고 새 본체를 띄워, 새 본체가 준비되면 옛 본체가 끝난다. 안 켜지면 되돌린다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { cmpVer } from './boot.mjs';

const REPO = 'raon-easypaster/church-allinone';
// 시험할 때만 가짜 배포 서버를 쓸 수 있게 환경 변수로 바꿀 수 있다 (이 컴퓨터에서 켤 때 정하는 값)
const LATEST_URL = process.env.UPDATE_LATEST_URL || `https://api.github.com/repos/${REPO}/releases/latest`;
const ALLOWED = process.env.UPDATE_ALLOWED_PREFIX || `https://github.com/${REPO}/releases/download/`;
export const ASSET = 'ChurchAllInOne-update.zip';
const SUMS = 'SHA256SUMS.txt';
const CHECK_EVERY = 6 * 3600e3;
const SNOOZE = 24 * 3600e3;
const MAX_SIZE = 150e6;

const bad = (msg) => Object.assign(new Error(msg), { code: 400 });

/** 받는 주소: 처음 주소는 우리 저장소 releases/download/ 로만, 그 뒤 GitHub 가 넘기는 곳은 GitHub 파일 서버로만 */
export function allowedStart(u) { return typeof u === 'string' && u.startsWith(ALLOWED) && !u.slice(ALLOWED.length).includes('..'); }
function allowedRedirect(u) {
  try {
    const x = new URL(u);
    if (u.startsWith(ALLOWED)) return true;
    return x.protocol === 'https:' && !x.port && !x.username && (x.hostname === 'github.com' || x.hostname.endsWith('.githubusercontent.com'));
  } catch { return false; }
}
async function get(url, opts = {}) {
  if (!allowedStart(url)) throw bad('허용되지 않은 주소에서는 받지 않습니다.');
  let u = url;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(opts.timeout || 600000), headers: { 'User-Agent': 'church-allinone-updater' } });
    if (r.status >= 300 && r.status < 400) {
      const next = new URL(r.headers.get('location') || '', u).href;
      if (!allowedRedirect(next)) throw bad('GitHub 가 아닌 곳으로 넘기려 해서 멈췄습니다.');
      u = next; continue;
    }
    if (!r.ok) throw bad(`받지 못했습니다 (${r.status}).`);
    return r;
  }
  throw bad('주소가 너무 여러 번 넘겨져 멈췄습니다.');
}

/** SHA256SUMS.txt 에서 파일 확인값 찾기 (윈도우식 줄바꿈·* 표시도 받아 줌) */
export function sumFor(text, name) {
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (m && m[2].trim() === name) return m[1].toLowerCase();
  }
  return '';
}

/** zip 풀기 (부품 없이). 상위 폴더로 나가거나 절대 경로인 이름은 거절한다 */
export function unzip(buf, dest) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw bad('업데이트 묶음이 zip 파일이 아닙니다.');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const root = path.resolve(dest);
  let files = 0;
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw bad('업데이트 묶음이 손상되었습니다.');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'utf8').replace(/\\/g, '/');
    p += 46 + nl + el + cl;
    if (!name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')) throw bad(`업데이트 묶음에 허용되지 않은 파일 이름이 있습니다: ${name}`);
    const out = path.resolve(root, name);
    if (out !== root && !out.startsWith(root + path.sep)) throw bad(`업데이트 묶음에 허용되지 않은 파일 이름이 있습니다: ${name}`);
    if (name.endsWith('/')) { fs.mkdirSync(out, { recursive: true }); continue; }
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw bad('업데이트 묶음의 압축 방식을 풀 수 없습니다.');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
    files++;
  }
  return files;
}

/** 릴리스 설명에서 '받기' 표 앞까지만 */
export function notesExcerpt(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const end = lines.findIndex((l) => /^#{1,6}\s*받기/.test(l.trim()) || /^\|\s*파일\s*\|/.test(l.trim()));
  return (end < 0 ? lines : lines.slice(0, end)).join('\n').trim().slice(0, 8000);
}

export function makeUpdater({ dataDir, version, appRoot, isBusy = () => '', restart }) {
  const dir = path.join(dataDir, 'app-update');
  const stFile = path.join(dataDir, 'update.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(stFile, 'utf8')); } catch { return {}; } };
  let saved = { notify: true, ...load() };
  const persist = () => { const t = `${stFile}.tmp`; fs.writeFileSync(t, JSON.stringify(saved, null, 1)); fs.renameSync(t, stFile); };
  let job = { phase: 'idle', done: 0, total: 0, error: '', version: '' };
  let checking = null;

  async function check(force = false) {
    if (!force && saved.checkedAt && Date.now() - saved.checkedAt < CHECK_EVERY) return;
    if (checking) return checking;
    checking = (async () => {
      try {
        const r = await fetch(LATEST_URL, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'church-allinone-updater' } });
        if (!r.ok) throw new Error(`GitHub 응답 ${r.status}`);
        const j = await r.json();
        const asset = (j.assets || []).find((a) => a.name === ASSET), sums = (j.assets || []).find((a) => a.name === SUMS);
        saved.latest = {
          version: String(j.tag_name || '').replace(/^v/, ''), url: String(j.html_url || `https://github.com/${REPO}/releases/latest`),
          notes: notesExcerpt(j.body), name: String(j.name || ''),
          asset: asset?.browser_download_url || '', sums: sums?.browser_download_url || '',
        };
        saved.checkError = '';
      } catch (e) { saved.checkError = e.cause ? '인터넷에 연결하지 못했습니다.' : e.message; }
      saved.checkedAt = Date.now(); persist(); checking = null;
    })();
    return checking;
  }

  function view() {
    const l = saved.latest;
    const newer = !!l?.version && cmpVer(l.version, version) > 0;
    const installable = newer && allowedStart(l.asset) && allowedStart(l.sums);
    const snoozed = !!(saved.snooze && l && saved.snooze.version === l.version && saved.snooze.until > Date.now());
    return { current: version, latest: newer ? { version: l.version, url: l.url, notes: l.notes, name: l.name } : null, available: newer, installable, snoozed, notify: saved.notify !== false, checkedAt: saved.checkedAt || 0, checkError: saved.checkError || '', busy: isBusy(), job };
  }

  async function install() {
    if (['downloading', 'installing', 'restarting'].includes(job.phase)) return;
    job = { phase: 'downloading', done: 0, total: 0, error: '', version: '' };
    let tmp = '', dl = '';
    try {
      const busy = isBusy();
      if (busy) throw bad(`${busy} 끝난 뒤에 업데이트해 주세요. (업데이트하면 프로그램이 다시 켜집니다)`);
      await check(true);
      const l = saved.latest;
      if (!l?.version || cmpVer(l.version, version) <= 0) throw bad('설치할 새 버전이 없습니다.');
      if (!allowedStart(l.asset) || !allowedStart(l.sums)) throw bad('이 버전에는 자동 설치 묶음이 없습니다. GitHub에서 직접 받아 설치해 주세요.');
      const ver = l.version.replace(/[^\w.-]/g, '');
      job.version = ver;
      tmp = path.join(dir, `${ver}.tmp`); dl = path.join(dir, `${ver}.download`);
      fs.mkdirSync(dir, { recursive: true });
      const sum = sumFor(await (await get(l.sums, { timeout: 30000 })).text(), ASSET);
      if (!sum) throw bad('확인값 목록(SHA256SUMS.txt)에 업데이트 묶음이 없어 설치하지 않았습니다.');
      const r = await get(l.asset);
      job.total = +r.headers.get('content-length') || 0;
      if (job.total > MAX_SIZE) throw bad('업데이트 묶음이 너무 큽니다.');
      const hash = crypto.createHash('sha256'), chunks = [];
      for await (const c of r.body) { hash.update(c); chunks.push(c); job.done += c.length; if (job.done > MAX_SIZE) throw bad('업데이트 묶음이 너무 큽니다.'); }
      if (hash.digest('hex') !== sum) throw bad('받은 파일의 확인값(SHA256)이 맞지 않아 설치하지 않았습니다. 잠시 뒤 다시 눌러 주세요.');
      job.phase = 'installing';
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(dl, buf);
      // 1) 사용자 자료 한 벌 백업 (녹음 파일은 업데이트가 건드리지 않아 그대로 둠)
      const bk = path.join(dataDir, 'backups', `before-update-${version}-to-${ver}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      fs.mkdirSync(bk, { recursive: true });
      for (const f of fs.readdirSync(dataDir)) if (f.endsWith('.json') && fs.statSync(path.join(dataDir, f)).isFile()) fs.copyFileSync(path.join(dataDir, f), path.join(bk, f));
      // 2) 임시 폴더에 다 푼 뒤 확인
      fs.rmSync(tmp, { recursive: true, force: true });
      unzip(buf, tmp);
      const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
      if (pkg.version !== ver) throw bad(`묶음 안 버전(${pkg.version})이 릴리스(${ver})와 다릅니다.`);
      for (const f of ['server/index.mjs', 'server/main.mjs', 'server/boot.mjs', 'dist/index.html', 'apps.json']) if (!fs.existsSync(path.join(tmp, f))) throw bad(`업데이트 묶음에 ${f} 가 없습니다.`);
      // 3) 제자리로 옮기고, 그다음에야 current 표시를 바꾼다
      const final = path.join(dir, ver);
      fs.rmSync(final, { recursive: true, force: true });
      fs.renameSync(tmp, final);
      const cur = path.join(dir, 'current.json');
      const prev = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8') : '';
      fs.writeFileSync(`${cur}.tmp`, JSON.stringify({ version: ver, at: Date.now(), from: version }));
      fs.renameSync(`${cur}.tmp`, cur);
      fs.rmSync(dl, { force: true });
      for (const d of fs.readdirSync(dir)) if (d !== ver && /^\d/.test(d)) fs.rmSync(path.join(dir, d), { recursive: true, force: true });   // 옛 받은 버전 정리
      job.phase = 'restarting';
      // 4) 새 본체로 다시 켜기 (안 켜지면 current 를 되돌린다)
      setTimeout(() => restart(ver).catch((e) => {
        if (prev) fs.writeFileSync(cur, prev); else fs.rmSync(cur, { force: true });
        fs.rmSync(final, { recursive: true, force: true });
        job = { ...job, phase: 'error', error: `새 버전을 켜지 못해 지금 버전으로 계속합니다. (${e.message})` };
      }), 300);
    } catch (e) {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      if (dl) fs.rmSync(dl, { force: true });
      job = { ...job, phase: 'error', error: e.code === 400 ? e.message : e.cause ? '인터넷에 연결하지 못했습니다.' : `설치하지 못했습니다: ${e.message}` };
    }
  }

  return {
    check, view, install,
    snooze(v) { saved.snooze = { version: String(v || ''), until: Date.now() + SNOOZE }; persist(); },
    setNotify(on) { saved.notify = !!on; persist(); },
  };
}

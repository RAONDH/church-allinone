// 백업: 이 컴퓨터 밖(USB·iCloud Drive·구글 드라이브·OneDrive 폴더)으로 하루 한 번 복사, 백업 파일(zip) 받기, 되살리기.
// 실제 교회 자료(real)만 다룬다. 예제(sample)는 백업하지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzip } from './update.mjs';

export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const FOLDER = '라온교회올인원-백업';
const KEEP_DAYS = 60;
const AUDIO = /\.(wav|mp3|ogg|flac)$/i;
const bad = (msg, code = 400) => Object.assign(new Error(msg), { code });

// ── zip 쓰기 (부품 없이 · 압축 없이 저장, 큰 녹음 파일도 메모리에 다 올리지 않고 흘려 보냄) ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crcUpdate(crc, buf) { let c = crc ^ 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function fileCrc(f) { let crc = 0; for await (const c of fs.createReadStream(f)) crc = crcUpdate(crc, c); return crc; }
/** entries: [{ name, file }] → res 로 zip 을 흘려 보낸다 (파일마다 두 번 읽음: 확인값 → 내용) */
export async function streamZip(res, entries) {
  const central = []; let off = 0;
  const write = (b) => new Promise((ok) => (res.write(b) ? ok() : res.once('drain', ok)));
  for (const e of entries) {
    const size = fs.statSync(e.file).size;
    if (size >= 0xffffffff) continue;   // 4GB 넘는 파일은 zip(옛 형식)에 못 넣음
    const crc = await fileCrc(e.file), nm = Buffer.from(e.name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt32LE(crc, 14); h.writeUInt32LE(size, 18); h.writeUInt32LE(size, 22); h.writeUInt16LE(nm.length, 26);
    await write(h); await write(nm);
    for await (const c of fs.createReadStream(e.file)) await write(c);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt32LE(crc, 16); c.writeUInt32LE(size, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nm); off += 30 + nm.length + size;
  }
  const cd = Buffer.concat(central), n = central.length / 2, eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(n, 8); eocd.writeUInt16LE(n, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  await write(cd); res.end(eocd);
}

/** 되살릴 자료가 올인원 자료 모양인지 */
export function checkRestore(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad('라온 교회 올인원 백업 파일이 아닙니다.');
  if (typeof obj.weeks !== 'object' || !('church' in obj)) throw bad('라온 교회 올인원 백업 파일이 아닙니다. (예배 기록·교회 정보가 없음)');
  return obj;
}
const counts = (db) => ({ church: db.church?.name || '', weeks: Object.keys(db.weeks || {}).length, members: Object.keys(db.members || {}).length, tx: Object.keys(db.finance?.tx || {}).length, minutes: Object.keys(db.minutes || {}).length });

/** 고를 만한 바깥 백업 위치 (있는 것만) */
export function backupPlaces() {
  const home = os.homedir(), out = [];
  const add = (dir, label) => { try { if (fs.statSync(dir).isDirectory()) out.push({ dir, label }); } catch { /* 없음 */ } };
  if (process.platform === 'win32') {
    for (const d of fs.readdirSync(home).filter((x) => /^OneDrive/i.test(x))) add(path.join(home, d), `OneDrive (${d})`);
    for (const L of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${L}:\\`;
      add(path.join(root, '내 드라이브'), `구글 드라이브 (${L}:)`); add(path.join(root, 'My Drive'), `구글 드라이브 (${L}:)`);
      if (!out.some((p) => p.dir.startsWith(root))) add(root, `${L}: 드라이브 (USB·외장 디스크 등)`);
    }
  } else {
    add(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), 'iCloud Drive');
    const cs = path.join(home, 'Library', 'CloudStorage');
    try {
      for (const d of fs.readdirSync(cs)) {
        if (/^GoogleDrive/i.test(d)) { add(path.join(cs, d, '내 드라이브'), `구글 드라이브 (${d.replace(/^GoogleDrive-/, '')})`); add(path.join(cs, d, 'My Drive'), `구글 드라이브 (${d.replace(/^GoogleDrive-/, '')})`); }
        else if (/^OneDrive|^Dropbox/i.test(d)) add(path.join(cs, d), d.replace(/-/g, ' '));
      }
    } catch { /* 없음 */ }
    try { for (const v of fs.readdirSync('/Volumes')) if (!/^Macintosh HD/i.test(v) && !fs.lstatSync(path.join('/Volumes', v)).isSymbolicLink()) add(path.join('/Volumes', v), `USB·외장 디스크: ${v}`); } catch { /* 없음 */ }
  }
  return out;
}

// 저장한 뒤 이만큼 지나면 바깥 백업을 그날 파일에 새로 덮어쓴다 (저장할 때마다 복사하지 않게 모아서)
const AGAIN_MS = 10 * 60 * 1000;

export function makeBackups({ dataDir, store, isBusy = () => '', againMs = AGAIN_MS }) {
  const stFile = path.join(dataDir, 'backup.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(stFile, 'utf8')); } catch { return {}; } };
  let st = { dir: '', lastAt: 0, lastError: '', lastFile: '', lastDay: '', ...load() };
  const persist = () => { fs.writeFileSync(`${stFile}.tmp`, JSON.stringify(st, null, 1)); fs.renameSync(`${stFile}.tmp`, stFile); };
  const realFile = path.join(dataDir, 'real.json');
  const recDir = path.join(dataDir, 'recordings', 'real');
  const localDir = path.join(dataDir, 'backups');
  const recFiles = () => { try { return fs.readdirSync(recDir).filter((f) => AUDIO.test(f)); } catch { return []; } };

  function checkDir(dir) {
    const d = String(dir || '').trim();
    if (!d) return '';
    if (!path.isAbsolute(d)) throw bad('폴더 위치를 처음부터(예: /Volumes/USB 또는 D:\\) 적어 주세요.');
    const abs = path.resolve(d);
    if (abs === path.resolve(dataDir) || abs.startsWith(path.resolve(dataDir) + path.sep)) throw bad('자료 폴더 안은 바깥 백업이 될 수 없습니다. USB나 클라우드 폴더를 골라 주세요.');
    let s; try { s = fs.statSync(abs); } catch { throw bad('그 폴더를 찾을 수 없습니다. USB가 꽂혀 있는지, 위치가 맞는지 확인해 주세요.'); }
    if (!s.isDirectory()) throw bad('폴더가 아닙니다.');
    const t = path.join(abs, `.allinone-test-${process.pid}`);
    try { fs.writeFileSync(t, 'ok'); fs.rmSync(t); } catch { throw bad('그 폴더에 쓸 수 없습니다. 다른 폴더를 골라 주세요.'); }
    return abs;
  }

  const changedAt = () => { try { return fs.statSync(realFile).mtimeMs; } catch { return 0; } };
  let timer = null;
  /** 바깥 폴더로 복사. 날짜마다 파일 하나(real-날짜.json)이고, 같은 날 자료가 또 바뀌면
   *  마지막 백업에서 againMs 가 지난 뒤 그날 파일을 새 내용으로 덮어쓴다 (force 면 바로). */
  async function external(force = false) {
    if (!st.dir) return { skipped: 'off' };
    const day = localDay();
    if (!force && st.lastDay === day && !st.lastError) {
      if (changedAt() <= st.lastAt) return { skipped: 'uptodate' };
      const wait = st.lastAt + againMs - Date.now();
      if (wait > 0) {
        if (!timer) { timer = setTimeout(() => { timer = null; external().catch(() => {}); }, wait); timer.unref?.(); }
        return { skipped: 'soon' };
      }
    }
    if (timer) { clearTimeout(timer); timer = null; }
    try {
      if (!fs.existsSync(st.dir)) throw bad('바깥 백업 폴더가 연결되어 있지 않습니다 (USB가 빠져 있거나 클라우드 폴더가 없음). 연결되면 다음 저장 때 다시 백업합니다.');
      if (!fs.existsSync(realFile)) return { skipped: 'nodata' };
      const target = path.join(st.dir, FOLDER);
      fs.mkdirSync(path.join(target, 'recordings'), { recursive: true });
      const dst = path.join(target, `real-${day}.json`);
      fs.copyFileSync(realFile, `${dst}.tmp`); fs.renameSync(`${dst}.tmp`, dst);
      let copied = 0;
      for (const f of recFiles()) {   // 녹음은 새 파일만 (이미 있으면 크기가 같을 때 건너뜀)
        const a = path.join(recDir, f), b = path.join(target, 'recordings', f);
        if (fs.existsSync(b) && fs.statSync(b).size === fs.statSync(a).size) continue;
        fs.copyFileSync(a, `${b}.tmp`); fs.renameSync(`${b}.tmp`, b); copied++;
      }
      const old = fs.readdirSync(target).filter((f) => /^real-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - KEEP_DAYS))) fs.rmSync(path.join(target, f));
      Object.assign(st, { lastAt: Date.now(), lastDay: day, lastError: '', lastFile: dst }); persist();
      return { ok: true, file: dst, recordings: copied };
    } catch (e) {
      Object.assign(st, { lastError: e.code === 400 ? e.message : `바깥 백업을 하지 못했습니다: ${e.message}` }); persist();
      return { ok: false, error: st.lastError };
    }
  }

  async function restoreObj(obj, why) {
    const busy = isBusy();
    if (busy) throw bad(`${busy} 끝난 뒤에 되살려 주세요.`, 409);
    checkRestore(obj);
    // 되살리기 전 지금 자료를 따로 남겨 둔다 (되살린 것을 되돌릴 수 있게)
    const keep = path.join(localDir, `before-restore-${localDay()}-${Date.now()}.json`);
    fs.mkdirSync(localDir, { recursive: true });
    if (fs.existsSync(realFile)) fs.copyFileSync(realFile, keep);
    await store.reset(obj);
    return { ok: true, why, kept: path.basename(keep), ...counts(store.db) };
  }

  return {
    view() {
      const local = (() => { try { return fs.readdirSync(localDir).filter((f) => /^(real-\d{4}-\d{2}-\d{2}|before-restore-.+)\.json$/.test(f)).map((f) => { const s = fs.statSync(path.join(localDir, f)); return { file: f, size: s.size, at: s.mtimeMs }; }).sort((a, b) => b.at - a.at); } catch { return []; } })();
      return { dir: st.dir, lastAt: st.lastAt, lastError: st.lastError, lastFile: st.lastFile, upToDate: !!st.lastAt && changedAt() <= st.lastAt, places: backupPlaces(), local, recordings: recFiles().length };
    },
    async setDir(dir) { st.dir = checkDir(dir); st.lastError = ''; st.lastDay = ''; persist(); return st.dir ? external(true) : { ok: true, off: true }; },
    external,
    async download(res) {
      const entries = [];
      if (fs.existsSync(realFile)) entries.push({ name: 'real.json', file: realFile });
      for (const f of recFiles()) entries.push({ name: `recordings/${f}`, file: path.join(recDir, f) });
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="church-allinone-backup-${localDay()}.zip"; filename*=UTF-8''${encodeURIComponent(`라온교회올인원-백업-${localDay()}.zip`)}` });
      await streamZip(res, entries);
    },
    async restoreLocal(file) {
      const f = path.basename(String(file || ''));
      if (!/^(real-\d{4}-\d{2}-\d{2}|before-restore-.+)\.json$/.test(f) || !fs.existsSync(path.join(localDir, f))) throw bad('그 백업 파일을 찾을 수 없습니다.', 404);
      return restoreObj(JSON.parse(fs.readFileSync(path.join(localDir, f), 'utf8')), f);
    },
    /** 받은 백업 파일(.json 또는 백업 zip)에서 되살리기 */
    async restoreUpload(buf, name) {
      if (buf[0] === 0x50 && buf[1] === 0x4b) {   // zip
        const tmp = path.join(dataDir, `restore-tmp-${Date.now()}`);
        try {
          unzip(buf, tmp);
          if (!fs.existsSync(path.join(tmp, 'real.json'))) throw bad('백업 zip 안에 real.json 이 없습니다.');
          const obj = checkRestore(JSON.parse(fs.readFileSync(path.join(tmp, 'real.json'), 'utf8')));
          const r = await restoreObj(obj, name);
          let rec = 0;
          const src = path.join(tmp, 'recordings');
          if (fs.existsSync(src)) { fs.mkdirSync(recDir, { recursive: true }); for (const f of fs.readdirSync(src)) if (AUDIO.test(f) && !fs.existsSync(path.join(recDir, f))) { fs.copyFileSync(path.join(src, f), path.join(recDir, f)); rec++; } }
          return { ...r, recordings: rec };
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      }
      let obj;
      try { obj = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); } catch { throw bad('백업 파일을 읽지 못했습니다. 라온 교회 올인원에서 받은 .json 또는 .zip 파일인지 확인해 주세요.'); }
      return restoreObj(obj, name);
    },
  };
}

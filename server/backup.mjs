// 백업: 이 컴퓨터 밖(USB·iCloud Drive·구글 드라이브·OneDrive 폴더)으로 하루 한 번 복사, 백업 파일(zip) 받기, 되살리기.
// 실제 교회 자료(real)만 다룬다. 예제(sample)는 백업하지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzip } from './update.mjs';
import { renameRetrySync } from './fsx.mjs';

export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const FOLDER = '라온교회올인원-백업';
const KEEP_DAYS = 60;
const AUDIO = /\.(wav|mp3|ogg|flac)$/i;
// 받는 백업 파일 하나의 최대 크기 (되살리기는 2GB까지 받는다). 시험에서는 작게 바꿀 수 있다
export const PART_BYTES = Number(process.env.BACKUP_PART_BYTES) || 1.8e9;
const bad = (msg, code = 400) => Object.assign(new Error(msg), { code });

// ── zip 쓰기 (부품 없이 · 압축 없이 저장, 큰 녹음 파일도 메모리에 다 올리지 않고 흘려 보냄) ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crcUpdate(crc, buf) { let c = crc ^ 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function fileCrc(f) { let crc = 0; for await (const c of fs.createReadStream(f)) crc = crcUpdate(crc, c); return crc; }
/** entries: [{ name, file }] → res 로 zip 을 흘려 보낸다 (파일마다 두 번 읽음: 확인값 → 내용) */
export async function streamZip(res, entries) {
  const central = [], skipped = []; let off = 0;
  const write = (b) => new Promise((ok) => (res.write(b) ? ok() : res.once('drain', ok)));
  for (const e of entries) {
    let size; try { size = fs.statSync(e.file).size; } catch { continue; }   // 받는 사이에 지워진 녹음은 건너뜀
    // zip(옛 형식)은 4GB 안쪽만 담을 수 있다. 넘치면 그 파일부터는 넣지 않는다 (서버가 꺼지지 않게)
    if (size >= 0xffffffff || off + 30 + Buffer.byteLength(e.name) + size >= 0xffffffff) { skipped.push(e.name); continue; }
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
  return { skipped };
}

/** 되살릴 자료가 올인원 자료 모양인지 */
export function checkRestore(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad('라온 교회 올인원 백업 파일이 아닙니다.');
  if (typeof obj.weeks !== 'object' || !('church' in obj)) throw bad('라온 교회 올인원 백업 파일이 아닙니다. (예배 기록·교회 정보가 없음)');
  checkShape(obj);
  return obj;
}

// 되살리기 전에 자료 모양을 본다: 모양이 틀린 자료를 받아들이면 화면이 열리지 않으므로, 틀렸으면 되살리지 않고 지금 자료를 그대로 둔다
/** 두 파일 내용이 같은지 (크기 먼저, 같으면 내용) */
function sameFile(a, b) {
  try { if (fs.statSync(a).size !== fs.statSync(b).size) return false; return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; }
}
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function checkShape(db) {
  const no = (where) => { throw bad(`백업 파일의 자료 모양이 맞지 않아 되살리지 않았습니다 (${where}). 지금 자료는 그대로입니다. 다른 백업을 골라 주세요.`); };
  const coll = (key, label, each) => {
    if (db[key] === undefined || db[key] === null) return;
    if (!isObj(db[key])) no(`${label} 묶음`);
    for (const [k, v] of Object.entries(db[key])) { if (!isObj(v)) no(`${label} ${k}`); each?.(v, k); }
  };
  const optStr = (v, where) => { if (v !== undefined && v !== null && typeof v !== 'string') no(where); };
  if (db.church !== null && db.church !== undefined) { if (!isObj(db.church)) no('교회 정보'); optStr(db.church.name, '교회 이름'); }
  if (!isObj(db.weeks)) no('예배 기록 묶음');
  coll('weeks', '예배 기록', (w, k) => {
    if (typeof w.id !== 'string') no(`예배 기록 ${k}의 번호`);
    if (w.date !== undefined && !(typeof w.date === 'string' && DAY.test(w.date))) no(`예배 기록 ${k}의 날짜`);
    for (const f of ['name', 'passage', 'sermonTitle', 'sermonNotes', 'prayerLeader']) optStr(w[f], `예배 기록 ${k}의 ${f}`);
    if (w.announcements !== undefined && !(Array.isArray(w.announcements) && w.announcements.every((x) => typeof x === 'string'))) no(`예배 기록 ${k}의 광고`);
    if (w.wc !== undefined && w.wc !== null && !isObj(w.wc)) no(`예배 기록 ${k}의 예배송출 연결`);
  });
  coll('members', '성도', (m, k) => { if (typeof m.name !== 'string') no(`성도 ${k}의 이름`); });
  coll('visits', '심방', (v, k) => { if (!Array.isArray(v.memberIds)) no(`심방 ${k}의 대상`); });
  if (db.attendance !== undefined && db.attendance !== null) {
    if (!isObj(db.attendance)) no('출석 묶음');
    for (const [d, ids] of Object.entries(db.attendance)) if (!DAY.test(d) || !Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) no(`출석 ${d}`);
  }
  if (db.finance !== undefined && db.finance !== null) {
    if (!isObj(db.finance)) no('재정 묶음');
    if (db.finance.tx !== undefined) {
      if (!isObj(db.finance.tx)) no('장부 묶음');
      for (const [k, t] of Object.entries(db.finance.tx)) {
        if (!isObj(t) || typeof t.date !== 'string' || !DAY.test(t.date) || !['income', 'expense'].includes(t.type) || typeof t.amount !== 'number' || !Number.isFinite(t.amount)) no(`장부 기록 ${k}`);
      }
    }
  }
  for (const [key, label] of [['minutes', '회의록'], ['events', '일정'], ['certs', '증명서']]) coll(key, label);
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

const LOCAL_RE = /^(real-\d{4}-\d{2}-\d{2}|before-restore-.+)\.json$/;
const EXTERNAL_RE = /^real-\d{4}-\d{2}-\d{2}\.json$/;
/** 백업 파일 하나를 읽어 올인원 자료인지 확인 (깨졌으면 알아듣게 알림) */
function readBackup(full) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '')); } catch { throw bad('이 백업 파일도 깨져 있어 읽지 못했습니다. 다른 날짜를 골라 주세요.'); }
  return checkRestore(obj);
}

// 저장한 뒤 이만큼 지나면 바깥 백업을 그날 파일에 새로 덮어쓴다 (저장할 때마다 복사하지 않게 모아서)
const AGAIN_MS = 10 * 60 * 1000;

export function makeBackups({ dataDir, store, isBusy = () => '', againMs = AGAIN_MS, partBytes = PART_BYTES }) {
  const stFile = path.join(dataDir, 'backup.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(stFile, 'utf8')); } catch { return {}; } };
  let st = { dir: '', lastAt: 0, lastError: '', lastFile: '', lastDay: '', ...load() };
  const persist = () => { fs.writeFileSync(`${stFile}.tmp`, JSON.stringify(st, null, 1)); renameRetrySync(`${stFile}.tmp`, stFile); };
  const realFile = path.join(dataDir, 'real.json');
  const recDir = path.join(dataDir, 'recordings', 'real');
  const localDir = path.join(dataDir, 'backups');
  const recFiles = () => { try { return fs.readdirSync(recDir).filter((f) => AUDIO.test(f)); } catch { return []; } };
  function parts() {
    const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
    const out = [{ entries: [], bytes: 0 }];
    if (fs.existsSync(realFile)) out[0].entries.push({ name: 'real.json', file: realFile }), (out[0].bytes += size(realFile));
    for (const f of recFiles().sort()) {
      const file = path.join(recDir, f), b = size(file);
      let cur = out[out.length - 1];
      if (cur.entries.length && cur.bytes + b > partBytes) { cur = { entries: [], bytes: 0 }; out.push(cur); }
      cur.entries.push({ name: `recordings/${f}`, file }); cur.bytes += b;
    }
    return out;
  }

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
    if (store.broken) return { skipped: 'broken' };   // 깨진 자료 파일을 바깥 백업에 덮어쓰지 않는다
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
      fs.copyFileSync(realFile, `${dst}.tmp`); renameRetrySync(`${dst}.tmp`, dst);
      let copied = 0;
      for (const f of recFiles()) {   // 녹음은 새 파일만 (이미 있으면 크기가 같을 때 건너뜀)
        const a = path.join(recDir, f), b = path.join(target, 'recordings', f);
        if (fs.existsSync(b) && fs.statSync(b).size === fs.statSync(a).size) continue;
        fs.copyFileSync(a, `${b}.tmp`); renameRetrySync(`${b}.tmp`, b); copied++;
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
    // 되살리기 전 지금 자료를 따로 남겨 둔다 (되살린 것을 되돌릴 수 있게).
    // 자료 파일이 깨진 상태면 이미 real.json.broken-… 으로 보관했으니 백업 목록에 깨진 파일을 넣지 않는다
    const keep = path.join(localDir, `before-restore-${localDay()}-${Date.now()}.json`);
    fs.mkdirSync(localDir, { recursive: true });
    const wasBroken = store.broken;
    if (!wasBroken && fs.existsSync(realFile)) fs.copyFileSync(realFile, keep);
    await store.reset(obj);
    return { ok: true, why, kept: wasBroken ? wasBroken.kept : path.basename(keep), ...counts(store.db) };
  }

  return {
    view() {
      const local = (() => { try { return fs.readdirSync(localDir).filter((f) => /^(real-\d{4}-\d{2}-\d{2}|before-restore-.+)\.json$/.test(f)).map((f) => { const s = fs.statSync(path.join(localDir, f)); return { file: f, size: s.size, at: s.mtimeMs }; }).sort((a, b) => b.at - a.at); } catch { return []; } })();
      return { dir: st.dir, lastAt: st.lastAt, lastError: st.lastError, lastFile: st.lastFile, upToDate: !!st.lastAt && changedAt() <= st.lastAt, places: backupPlaces(), local, recordings: recFiles().length, parts: parts().map((x) => ({ files: x.entries.length, bytes: x.bytes })) };
    },
    async setDir(dir) { st.dir = checkDir(dir); st.lastError = ''; st.lastDay = ''; persist(); return st.dir ? external(true) : { ok: true, off: true }; },
    external,
    /** 받을 백업 묶음 나누기: 한 파일이 PART_BYTES 를 넘지 않게 녹음을 나눠 담는다 (되살리기는 2GB까지 받으므로). 1부에는 교회 자료가 들어간다 */
    parts,
    async download(res, part = 0) {
      const all = parts(), n = all.length;
      const i = Number.isInteger(part) && part >= 0 && part < n ? part : 0;
      const entries = all[i].entries;
      const suffix = n > 1 ? `-${i + 1}of${n}` : '';
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="church-allinone-backup-${localDay()}${suffix}.zip"; filename*=UTF-8''${encodeURIComponent(`라온교회올인원-백업-${localDay()}${n > 1 ? `-${i + 1}부(전체${n}부)` : ''}.zip`)}` });
      await streamZip(res, entries);
    },
    /**
     * 복원 확인: 가장 최근 백업(바깥 백업 폴더가 있으면 그쪽, 없으면 이 컴퓨터 안)을 실제로 읽어 되살릴 수 있는 모양인지 보고,
     * 성도 수·예배 수·장부 건수와 합계·회의록 수·녹음을 지금 자료와 견준다. 아무것도 바꾸지 않는다.
     */
    verify() {
      const pick = (dir, re) => { try { return fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ''; } catch { return ''; } };
      const extDir = st.dir ? path.join(st.dir, FOLDER) : '';
      const file = (extDir && pick(extDir, EXTERNAL_RE)) || pick(localDir, /^real-\d{4}-\d{2}-\d{2}\.json$/);
      if (!file) return { ok: false, error: '아직 백업이 없습니다. 바깥 백업 폴더를 정하거나 [지금 백업]을 눌러 주세요.' };
      let obj;
      try { obj = readBackup(file); } catch (e) { return { ok: false, file, error: e.message }; }
      const sum = (db) => Object.values(db.finance?.tx || {}).reduce((a, t) => a + (t.type === 'income' ? t.amount : -t.amount), 0);
      const now = store.db, at = fs.statSync(file).mtimeMs;
      const row = (label, b, n) => ({ label, backup: b, now: n, same: b === n });
      const rows = [
        row('교회 이름', obj.church?.name || '', now.church?.name || ''),
        row('성도', Object.keys(obj.members || {}).length, Object.keys(now.members || {}).length),
        row('예배 기록', Object.keys(obj.weeks || {}).length, Object.keys(now.weeks || {}).length),
        row('장부 건수', Object.keys(obj.finance?.tx || {}).length, Object.keys(now.finance?.tx || {}).length),
        row('장부 수입−지출 합계', sum(obj), sum(now)),
        row('회의록', Object.keys(obj.minutes || {}).length, Object.keys(now.minutes || {}).length),
      ];
      // 녹음: 바깥 백업 폴더에 지금 녹음이 모두 같은 크기로 들어 있는지
      if (extDir) {
        const mine = recFiles(), missing = mine.filter((f) => { try { return fs.statSync(path.join(extDir, 'recordings', f)).size !== fs.statSync(path.join(recDir, f)).size; } catch { return true; } });
        rows.push(row('녹음 (바깥 백업에 들어 있음)', mine.length - missing.length, mine.length));
      }
      const changedAfter = rows.some((r) => !r.same) && changedAt() > at;
      return { ok: true, file, where: extDir && file.startsWith(extDir) ? 'external' : 'local', at, rows, allSame: rows.every((r) => r.same), changedAfter };
    },
    async restoreLocal(file) {
      const f = path.basename(String(file || ''));
      if (!LOCAL_RE.test(f) || !fs.existsSync(path.join(localDir, f))) throw bad('그 백업 파일을 찾을 수 없습니다.', 404);
      return restoreObj(readBackup(path.join(localDir, f)), f);
    },
    /** 자료 파일이 깨졌을 때 고를 수 있는 백업: 이 컴퓨터의 자동 백업 + 바깥 백업 폴더. 하나씩 열어 보고 멀쩡한지·무엇이 들었는지 알려 준다 */
    candidates() {
      const out = [];
      const scan = (source, dir, re) => {
        let files = []; try { files = fs.readdirSync(dir).filter((f) => re.test(f)); } catch { return; }
        for (const f of files) {
          const full = path.join(dir, f);
          let at = 0, size = 0; try { const s = fs.statSync(full); at = s.mtimeMs; size = s.size; } catch { continue; }
          try { out.push({ source, file: f, at, size, ok: true, ...counts(readBackup(full)) }); }
          catch (e) { out.push({ source, file: f, at, size, ok: false, error: e.message }); }
        }
      };
      scan('local', localDir, LOCAL_RE);
      if (st.dir) scan('external', path.join(st.dir, FOLDER), EXTERNAL_RE);
      return { externalDir: st.dir ? path.join(st.dir, FOLDER) : '', list: out.sort((a, b) => b.at - a.at) };
    },
    /** 위 목록에서 고른 백업으로 되살리기 */
    async restoreCandidate(source, file) {
      const f = path.basename(String(file || ''));
      if (source === 'local') return this.restoreLocal(f);
      if (source !== 'external' || !st.dir || !EXTERNAL_RE.test(f)) throw bad('그 백업 파일을 찾을 수 없습니다.', 404);
      const full = path.join(st.dir, FOLDER, f);
      if (!fs.existsSync(full)) throw bad('그 백업 파일을 찾을 수 없습니다. USB나 클라우드 폴더가 연결되어 있는지 확인해 주세요.', 404);
      return restoreObj(readBackup(full), f);
    },
    /** 받은 백업 파일(.json 또는 백업 zip)에서 되살리기 */
    async restoreUpload(buf, name) {
      if (buf[0] === 0x50 && buf[1] === 0x4b) {   // zip
        const tmp = path.join(dataDir, `restore-tmp-${Date.now()}`);
        try {
          unzip(buf, tmp);
          const src = path.join(tmp, 'recordings');
          const hasData = fs.existsSync(path.join(tmp, 'real.json'));
          if (!hasData && !fs.existsSync(src)) throw bad('백업 zip 안에 real.json 이 없습니다.');
          // 나눠 받은 백업의 2부부터는 녹음만 들어 있다: 교회 자료는 그대로 두고 녹음만 더한다
          const r = hasData ? await restoreObj(checkRestore(JSON.parse(fs.readFileSync(path.join(tmp, 'real.json'), 'utf8'))), name) : { ok: true, recordingsOnly: true };
          let rec = 0;
          // 녹음도 백업한 때의 내용으로: 같은 이름인데 내용이 다르면 지금 파일은 recordings/real/before-restore-시각/ 에 옮겨 두고 백업본으로 바꾼다.
          // (예전에는 같은 이름이 있으면 건너뛰어, 되살렸다고 나와도 바뀐 녹음이 그대로 남았다) 백업에 없는 녹음은 지우지 않는다
          let replaced = 0; const keepDir = path.join(recDir, `before-restore-${Date.now()}`);
          if (fs.existsSync(src)) {
            fs.mkdirSync(recDir, { recursive: true });
            for (const f of fs.readdirSync(src)) {
              if (!AUDIO.test(f)) continue;
              const from = path.join(src, f), to = path.join(recDir, f);
              if (fs.existsSync(to)) {
                if (sameFile(from, to)) continue;
                fs.mkdirSync(keepDir, { recursive: true }); renameRetrySync(to, path.join(keepDir, f)); replaced++;
              }
              fs.copyFileSync(from, to); rec++;
            }
          }
          return { ...r, recordings: rec, recordingsReplaced: replaced, recordingsKept: replaced ? path.basename(keepDir) : '' };
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      }
      let obj;
      try { obj = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); } catch { throw bad('백업 파일을 읽지 못했습니다. 라온 교회 올인원에서 받은 .json 또는 .zip 파일인지 확인해 주세요.'); }
      return restoreObj(obj, name);
    },
  };
}

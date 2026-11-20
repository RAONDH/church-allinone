// 성도·재정·행정 잠금: 잠금 암호(숫자 4~8자리)를 넣어야 그 자료를 열 수 있다. 서버가 직접 막는다 (주소를 직접 쳐도 안 보임).
// - 한 번 풀면 고른 곳이 모두 열리고, 정한 시간 동안 손대지 않으면 다시 잠긴다.
// - 암호는 원문이 아니라 섞은 값(scrypt + 소금)만 저장한다. 5번 틀릴 때마다 기다리는 시간이 30초 → 1분 → 2분 … (최대 1시간)으로 늘고,
//   틀린 기록은 자료 폴더(lock-fails.json)에 남겨 프로그램을 다시 켜도 초기화되지 않는다. 잠금 풀기와 설정 바꾸기 모두 같은 제한을 받는다.
// - 암호를 잊으면: 자료 폴더에 '잠금풀기.txt' 를 만들고 프로그램을 다시 켜면 잠금이 풀린다 (그 컴퓨터를 직접 쓰는 사람만 가능).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const AREAS = { people: '성도', finance: '재정', admin: '행정' };
export const RESET_FILE = '잠금풀기.txt';
const COOKIE = 'allinone_unlock';
const bad = (msg, code = 400) => Object.assign(new Error(msg), { code });

/** 이 주소가 어느 잠금 구역인지 (실제 교회 자료만) */
export function areaOf(sub) {
  if (/^\/(people|members|visits|attendance)(\/|\.|$)/.test(sub)) return 'people';
  if (/^\/finance(\/|$)/.test(sub)) return 'finance';
  if (/^\/(admin|events|minutes|certs|serve|meeting-types|gcals)(\/|\.|$)/.test(sub)) return 'admin';
  return '';
}
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), Buffer.from(salt, 'hex'), 32).toString('hex');
const cleanPin = (pin) => { const p = String(pin ?? '').trim(); if (!/^\d{4,8}$/.test(p)) throw bad('잠금 암호는 숫자 4~8자리로 정해 주세요.'); return p; };

export function makeLock({ dataDir }) {
  const sessions = new Map();   // 쪽지(token) → 마지막으로 쓴 때
  // 틀린 기록: { fails, waitUntil, rounds } — 파일에 남겨 다시 켜도 이어진다
  const failFile = path.join(dataDir, 'lock-fails.json');
  let ft = (() => { try { return { fails: 0, waitUntil: 0, rounds: 0, ...JSON.parse(fs.readFileSync(failFile, 'utf8')) }; } catch { return { fails: 0, waitUntil: 0, rounds: 0 }; } })();
  const saveFails = () => { try { fs.writeFileSync(failFile, JSON.stringify(ft)); } catch { /* 자료 폴더에 못 쓰면 메모리로만 */ } };
  /** 모든 암호 확인이 여기를 거친다 (잠금 풀기·설정 바꾸기·끄기) */
  function checkPin(l, pin, wrongMsg) {
    if (Date.now() < ft.waitUntil) throw bad(`여러 번 틀려서 ${Math.ceil((ft.waitUntil - Date.now()) / 1000)}초 뒤에 다시 넣어 주세요.`, 429);
    if (hashPin(String(pin ?? '').trim(), l.salt) !== l.hash) {
      ft.fails++;
      if (ft.fails >= 5) { ft.waitUntil = Date.now() + Math.min(3600e3, 30e3 * 2 ** ft.rounds); ft.rounds++; ft.fails = 0; }
      saveFails();
      throw bad(wrongMsg, 403);
    }
    if (ft.fails || ft.rounds) { ft = { fails: 0, waitUntil: 0, rounds: 0 }; saveFails(); }
  }
  // 암호를 잊었을 때: 잠금풀기 파일이 있으면 켤 때 잠금을 없앤다
  const resetRequested = () => fs.existsSync(path.join(dataDir, RESET_FILE));

  const tokenOf = (req) => (String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{48})`)) || [])[1] || '';
  const idleMs = (lock) => Math.max(1, Math.min(240, lock?.idleMin || 10)) * 60e3;
  function alive(lock, req, touch = true) {
    const t = tokenOf(req), at = sessions.get(t);
    if (!t || !at || Date.now() - at > idleMs(lock)) { if (t) sessions.delete(t); return false; }
    if (touch) sessions.set(t, Date.now());
    return true;
  }
  return {
    applyReset(db) {
      if (!resetRequested()) return false;
      delete db.lock; sessions.clear();
      fs.rmSync(path.join(dataDir, RESET_FILE), { force: true });
      return true;
    },
    view(db, req) {
      const l = db.lock;
      return { enabled: !!l?.hash, areas: l?.areas || [], idleMin: l?.idleMin || 10, unlocked: !!l?.hash && alive(l, req, false), resetFile: RESET_FILE };
    },
    /** 이 구역이 지금 열려 있는지 (잠금이 없거나, 그 구역을 잠그지 않았거나, 풀린 쪽지가 있음) — 주보처럼 일부만 가릴 때 */
    isOpen(db, req, area) { const l = db.lock; return !l?.hash || !l.areas.includes(area) || alive(l, req, false); },
    /** 잠긴 구역이면 풀린 쪽지가 있어야 한다 (없으면 423) */
    guard(db, req, area) {
      const l = db.lock;
      if (!l?.hash || !area || !l.areas.includes(area)) return;
      if (!alive(l, req)) throw bad(`${AREAS[area]} 자료는 잠겨 있습니다. 잠금 암호를 넣어 주세요.`, 423);
    },
    /** 백업 받기·되살리기: 잠금을 켰으면 풀린 상태여야 한다 */
    guardAny(db, req, what = '백업 기능을 쓰려면') {
      if (db.lock?.hash && !alive(db.lock, req)) throw bad(`잠금을 켜 두어서, ${what} 먼저 잠금 암호를 넣어 주세요.`, 423);
    },
    unlock(db, pin, res) {
      const l = db.lock;
      if (!l?.hash) return { ok: true };
      checkPin(l, pin, '잠금 암호가 맞지 않습니다.');
      const t = crypto.randomBytes(24).toString('hex');
      sessions.set(t, Date.now());
      res.setHeader('Set-Cookie', `${COOKIE}=${t}; HttpOnly; SameSite=Strict; Path=/`);
      return { ok: true };
    },
    lockNow(req, res) { sessions.delete(tokenOf(req)); res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`); },
    /** 잠금 켜기·바꾸기·끄기. 이미 켜져 있으면 지금 암호(current)가 맞아야 한다 */
    configure(db, b, res) {
      const l = db.lock;
      if (l?.hash) checkPin(l, b.current, '지금 잠금 암호가 맞지 않습니다.');
      if (b.enabled === false) { delete db.lock; sessions.clear(); return { enabled: false }; }
      const areas = [...new Set((Array.isArray(b.areas) ? b.areas : Object.keys(AREAS)).filter((a) => AREAS[a]))];
      if (!areas.length) throw bad('잠글 곳을 하나 이상 골라 주세요.');
      const idleMin = Math.max(1, Math.min(240, Math.round(+b.idleMin || 10)));
      let salt = l?.salt, hash = l?.hash;
      if (b.pin || !hash) { const pin = cleanPin(b.pin); salt = crypto.randomBytes(16).toString('hex'); hash = hashPin(pin, salt); }
      db.lock = { salt, hash, areas, idleMin };
      // 켠 사람은 바로 풀린 상태로 둔다
      sessions.clear();
      const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, Date.now());
      res.setHeader('Set-Cookie', `${COOKIE}=${t}; HttpOnly; SameSite=Strict; Path=/`);
      return { enabled: true, areas, idleMin };
    },
  };
}

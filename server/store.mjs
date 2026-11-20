// 라온 교회 올인원 자료 저장: 작업 공간(real·sample)마다 JSON 파일 하나.
// 쓰기는 임시 파일 → 이름 바꾸기(중간에 꺼져도 파일이 깨지지 않음), 하루 한 번 자동 백업(14일 보관).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const uid = () => crypto.randomBytes(6).toString('hex');

const empty = () => ({ version: 1, church: null, weeks: {}, songMeta: {}, members: {}, visits: {}, attendance: {}, events: {}, minutes: {}, certs: {} });

// 이 컴퓨터 시간대 기준 날짜 (toISOString 은 UTC 라 한국에서는 오전 9시 전 저장이 어제 날짜가 됨)
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** onSaved: 저장이 끝날 때마다 부르는 함수 (바깥 백업용) */
export function openStore(dataDir, ws, { onSaved } = {}) {
  fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
  const file = path.join(dataDir, `${ws}.json`);
  let db = empty();
  // 파일이 깨졌으면: 지우지 않고 옆에 보관하고, 복구할 때까지 저장을 멈춘다.
  // (빈 자료로 저장해 버리면 깨진 파일마저 덮어써지고, 화면은 '처음 설정'처럼 보여 놀라게 됨)
  let broken = null;
  if (fs.existsSync(file)) {
    try {
      const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('자료 모양이 아닙니다');
      db = { ...empty(), ...obj };
    } catch (e) {
      const keep = `${file}.broken-${Date.now()}`;
      fs.copyFileSync(file, keep);
      broken = { kept: path.basename(keep), error: e.message, at: Date.now(), size: fs.statSync(file).size };
      console.error(`자료 파일을 읽지 못해 ${keep} 로 보관했습니다. 복구할 때까지 저장을 멈춥니다:`, e.message);
    }
  }
  let chain = Promise.resolve();
  function backup() {
    if (!fs.existsSync(file)) return;
    const day = localDay();
    const dst = path.join(dataDir, 'backups', `${ws}-${day}.json`);
    if (!fs.existsSync(dst)) fs.copyFileSync(file, dst);
    const old = fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.startsWith(ws + '-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 14))) fs.rmSync(path.join(dataDir, 'backups', f));
  }
  const st = { lastSavedAt: 0, lastError: '', lastErrorAt: 0 };
  function save({ skipBackup = false } = {}) {
    if (broken) return Promise.reject(Object.assign(new Error('자료 파일이 깨져 있어 저장을 멈췄습니다. 복구 화면에서 백업을 골라 주세요.'), { code: 503 }));
    const run = chain.then(async () => {
      try {
        if (!skipBackup) backup();
        const tmp = `${file}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(db, null, 1));
        await fs.promises.rename(tmp, file);
      } catch (e) {
        Object.assign(st, { lastError: e.message, lastErrorAt: Date.now() });
        console.error('자료 저장 실패:', e.message);
        throw e;
      }
      Object.assign(st, { lastSavedAt: Date.now(), lastError: '' });
      if (onSaved) try { await onSaved(); } catch (e) { console.error('저장 뒤 백업:', e.message); }
    });
    // 이번 저장이 실패해도 다음 저장은 새로 시도한다 (실패가 줄 전체를 막지 않게)
    chain = run.catch(() => {});
    return run;
  }
  return {
    get db() { return db; },
    save,
    /** 마지막으로 저장한 시각과 실패 내용 (화면 표시용) */
    status: () => ({ ...st, broken }),
    /** 자료 파일이 깨져서 저장을 멈췄으면 그 내용 (보관한 파일 이름·오류), 아니면 null */
    get broken() { return broken; },
    /** 자료를 통째로 바꾼다 (되살리기·예제 초기화). 깨진 상태였으면 풀린다.
     *  깨진 파일을 오늘 자동 백업으로 복사하지 않는다 (좋은 옛 백업이 밀려 지워지지 않게) */
    reset(next) { const was = !!broken; broken = null; db = { ...empty(), ...next }; return save({ skipBackup: was }); },
  };
}

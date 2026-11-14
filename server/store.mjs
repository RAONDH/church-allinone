// 라온 교회 올인원 자료 저장: 작업 공간(real·sample)마다 JSON 파일 하나.
// 쓰기는 임시 파일 → 이름 바꾸기(중간에 꺼져도 파일이 깨지지 않음), 하루 한 번 자동 백업(14일 보관).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const uid = () => crypto.randomBytes(6).toString('hex');

const empty = () => ({ version: 1, church: null, weeks: {}, songMeta: {} });

export function openStore(dataDir, ws) {
  fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
  const file = path.join(dataDir, `${ws}.json`);
  let db = empty();
  if (fs.existsSync(file)) {
    try { db = { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
    catch (e) {
      // 파일이 깨졌으면 지우지 않고 옆에 보관한 뒤 빈 자료로 시작
      const keep = `${file}.broken-${Date.now()}`;
      fs.copyFileSync(file, keep);
      console.error(`자료 파일을 읽지 못해 ${keep} 로 보관했습니다:`, e.message);
    }
  }
  let chain = Promise.resolve();
  function backup() {
    if (!fs.existsSync(file)) return;
    const day = new Date().toISOString().slice(0, 10);
    const dst = path.join(dataDir, 'backups', `${ws}-${day}.json`);
    if (!fs.existsSync(dst)) fs.copyFileSync(file, dst);
    const old = fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.startsWith(ws + '-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 14))) fs.rmSync(path.join(dataDir, 'backups', f));
  }
  function save() {
    chain = chain.then(async () => {
      backup();
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(db, null, 1));
      await fs.promises.rename(tmp, file);
    });
    return chain;
  }
  return {
    get db() { return db; },
    save,
    reset(next) { db = { ...empty(), ...next }; return save(); },
  };
}

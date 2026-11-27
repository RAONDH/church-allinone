// 라온 교회 올인원 시작 파일. 맥 start.sh·윈도우 실행 파일이 이 파일을 켠다.
// 자료 폴더에 받아 둔 새 버전이 있으면 그 본체를, 없으면 이 폴더의 본체(main.mjs)를 켠다. (server/boot.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pickRuntime, dataDirFor, bootingFile } from './boot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = dataDirFor(ROOT);
// 받아 둔 본체는 자료 폴더 안에서 돌기 때문에, 자료 폴더와 묶음 폴더는 처음 앱 위치로 고정해 둔다
process.env.HUB_DATA_DIR ||= dataDir;
process.env.BUNDLE_DIR ||= path.resolve(ROOT, '..');
process.env.HUB_APP_ROOT = ROOT;
fs.mkdirSync(dataDir, { recursive: true });

const pick = pickRuntime(ROOT, dataDir);
if (pick.note) console.log(`[업데이트] ${pick.note}`);
if (pick.updated) {
  // 끝까지 켜지면 본체가 이 표시를 지운다. 남아 있으면 다음에 켤 때 앱에 든 버전으로 돌아간다
  fs.writeFileSync(bootingFile(dataDir), JSON.stringify({ version: pick.version, at: Date.now() }));
  try {
    await import(pathToFileURL(pick.main).href);
  } catch (e) {
    console.error(`[업데이트] 받아 둔 버전 ${pick.version}을 켜지 못해 앱에 든 버전으로 켭니다:`, e?.message || e);
    // 켜지 못한 버전만 치우고, 그 앞 버전(지금 돌고 있을 수 있는 본체)은 남긴다
    const upd = path.join(dataDir, 'app-update'), cur = path.join(upd, 'current.json');
    let from = '';
    try { from = JSON.parse(fs.readFileSync(cur, 'utf8')).from || ''; } catch { /* 없음 */ }
    fs.rmSync(path.join(upd, String(pick.version).replace(/[^\w.-]/g, '')), { recursive: true, force: true });
    if (from && fs.existsSync(path.join(upd, from, 'server', 'main.mjs'))) {
      fs.writeFileSync(cur, JSON.stringify({ version: from, at: Date.now(), from: '' }));
      fs.rmSync(bootingFile(dataDir), { force: true });
    } else fs.rmSync(upd, { recursive: true, force: true });   // 되돌아갈 받은 버전이 없으면 모두 치운다
    await import('./main.mjs');
  }
} else {
  await import('./main.mjs');
}

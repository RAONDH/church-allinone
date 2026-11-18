// 시작할 때 어떤 본체를 켤지 고른다 (부품 없이 node 기본 기능만 씀 — 새 버전이 망가져도 이 파일은 앱에 든 그대로)
// - 자료 폴더의 app-update/current.json 이 앱보다 새 버전을 가리키고 그 폴더가 온전하면 그것을 켠다
// - 앱이 더 새것이면(사용자가 새 버전을 직접 설치) 받아 둔 것은 지운다
// - 지난번에 그 버전으로 켜다가 끝까지 못 켰으면(booting 표시가 남아 있으면) 치우고 앱에 든 버전으로 켠다
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const cmpVer = (a, b) => {
  const p = (v) => String(v || '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
};
export const dataDirFor = (root) => process.env.HUB_DATA_DIR || (process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ChurchAllInOne')
  : path.join(root, 'data'));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** 켤 본체 고르기. { main: 켤 main.mjs 경로, version, updated: 받아 둔 버전인지, note: 무슨 일이 있었는지 } */
export function pickRuntime(root, dataDir = dataDirFor(root)) {
  const bundled = readJson(path.join(root, 'package.json'))?.version || '0.0.0';
  const own = { main: path.join(root, 'server', 'main.mjs'), version: bundled, updated: false, note: '' };
  const upd = path.join(dataDir, 'app-update');
  const cur = readJson(path.join(upd, 'current.json'));
  if (!cur?.version) return own;
  const clear = (note) => { fs.rmSync(upd, { recursive: true, force: true }); return { ...own, note }; };
  if (cmpVer(cur.version, bundled) <= 0) return clear(`앱(${bundled})이 받아 둔 버전(${cur.version})보다 새것이라 받아 둔 것을 지웠습니다.`);
  const dir = path.join(upd, String(cur.version).replace(/[^\w.-]/g, ''));
  const main = path.join(dir, 'server', 'main.mjs');
  if (!fs.existsSync(main) || readJson(path.join(dir, 'package.json'))?.version !== cur.version) return clear(`받아 둔 버전(${cur.version})이 온전하지 않아 지웠습니다.`);
  const boot = readJson(path.join(upd, 'booting.json'));
  if (boot?.version === cur.version) return clear(`받아 둔 버전(${cur.version})이 지난번에 켜지지 않아 지우고 앱에 든 버전으로 켭니다.`);
  return { main, version: cur.version, updated: true, note: '' };
}
export const bootingFile = (dataDir) => path.join(dataDir, 'app-update', 'booting.json');

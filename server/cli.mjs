// 맥·윈도우 모두에서 claude / codex 같은 명령을 실행하기 위한 도움 함수.
// 윈도우는 npm으로 깐 명령이 .cmd 파일이라 그냥 spawn 하면 찾지 못한다 → 찾아서 cmd.exe로 실행.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const WIN = process.platform === 'win32';
const HOME = os.homedir();
const EXTRA = WIN
  ? [path.join(HOME, '.local', 'bin'), path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'npm'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude')]
  : [path.join(HOME, '.local/bin'), path.join(HOME, '.local/node/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
export const CLI_PATH = [...EXTRA, ...(process.env.PATH || '').split(path.delimiter)].filter(Boolean).join(path.delimiter);

function findWin(cmd) {
  for (const dir of CLI_PATH.split(';')) {
    for (const ext of ['.exe', '.cmd', '.bat']) {
      const f = path.join(dir, cmd + ext);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}
// cmd.exe 한 줄 안에서 안전하게 쓰도록 따옴표 처리 (우리가 넘기는 값은 옵션·모델 이름·파일 경로뿐)
const q = (a) => (a === '' || /[\s"&|<>^()%!]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);

export function spawnCli(cmd, args, opts) {
  const env = { ...process.env, ...(opts.env || {}), PATH: CLI_PATH };
  if (!WIN) return spawn(cmd, args, { ...opts, env });
  const file = findWin(cmd);
  if (!file) { const e = new Error(`${cmd} not found`); e.code = 'ENOENT'; throw e; }
  if (file.endsWith('.exe')) return spawn(file, args, { ...opts, env, windowsHide: true });
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[file, ...args].map(q).join(' ')}"`], { ...opts, env, windowsHide: true, windowsVerbatimArguments: true });
}

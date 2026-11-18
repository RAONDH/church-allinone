// 설치·배포 스크립트 점검 (실행하지 않고 문법과 내용만 본다 — 실제 묶음을 만들지 않음)
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HUB = path.resolve(__dirname, '..');
const sh = (f: string) => fs.readFileSync(path.join(HUB, 'installer', f), 'utf8');

describe('배포 스크립트', () => {
  it('설치·배포 스크립트에 문법 오류가 없다 (bash -n)', () => {
    for (const f of ['install.sh', 'make-package.sh', 'make-windows.sh', 'make-update.sh', 'make-release.sh']) {
      const r = spawnSync('bash', ['-n', path.join(HUB, 'installer', f)], { encoding: 'utf8' });
      expect({ f, err: r.stderr }).toEqual({ f, err: '' });
    }
  });
  it('배포 파일을 만드는 스크립트는 모두 전체 점검을 먼저 돌리고, 실패하면 멈춘다', () => {
    for (const f of ['make-package.sh', 'make-windows.sh', 'make-update.sh', 'make-release.sh']) {
      const s = sh(f);
      const gate = s.indexOf('tests/run.js');
      expect({ f, gate: gate > 0 }).toEqual({ f, gate: true });
      expect({ f, stops: /tests\/run\.js[^\n]*\|\|[^\n]*exit 1/.test(s) }).toEqual({ f, stops: true });
    }
  });
  it('릴리스 스크립트는 확인값 목록에 서명하고, 올리기 전에 서명을 다시 확인한다', () => {
    const s = sh('make-release.sh');
    expect(s.indexOf('signing.mjs" sign')).toBeGreaterThan(s.indexOf('SHA256SUMS.txt'));
    expect(s.indexOf('signing.mjs" verify')).toBeGreaterThan(s.indexOf('signing.mjs" sign'));
    expect(s).toContain('SHA256SUMS.txt.sig');
  });
});

describe('서명 도구', () => {
  it('프로그램에 공개 열쇠가 없는 비밀 열쇠로는 서명하지 않는다 (실제 비밀 열쇠는 쓰지 않음)', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'allinone-sign-'));
    try {
      const k = crypto.generateKeyPairSync('ed25519').privateKey;
      fs.writeFileSync(path.join(d, 'test.key'), k.export({ type: 'pkcs8', format: 'pem' }));
      fs.writeFileSync(path.join(d, 'SHA256SUMS.txt'), `${'a'.repeat(64)}  x.zip\n`);
      const r = spawnSync(process.execPath, [path.join(HUB, 'installer', 'signing.mjs'), 'sign', d], { encoding: 'utf8', env: { ...process.env, ALLINONE_SIGNING_KEY: path.join(d, 'test.key') } });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('공개 열쇠가 프로그램');
      expect(fs.existsSync(path.join(d, 'SHA256SUMS.txt.sig'))).toBe(false);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  it('비밀 열쇠는 저장소 안에 없다', () => {
    const r = spawnSync('git', ['ls-files'], { cwd: HUB, encoding: 'utf8' });
    const head = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');   // 이 점검 파일 자체가 걸리지 않게 나눠 씀
    const bad = r.stdout.split('\n').filter((f) => /\.key$|\.pem$/.test(f) || (f && fs.existsSync(path.join(HUB, f)) && fs.readFileSync(path.join(HUB, f), 'utf8').includes(head)));
    expect(bad).toEqual([]);
  });
});

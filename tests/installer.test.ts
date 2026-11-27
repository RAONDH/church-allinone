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

describe('배포 안전장치', () => {
  // 임시 저장소에 릴리스 스크립트만 두고 돌린다 (점검·묶음 만들기 앞에서 멈춰야 함)
  const fakeRepo = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'allinone-rel-'));
    fs.mkdirSync(path.join(d, 'installer'));
    fs.copyFileSync(path.join(HUB, 'installer', 'make-release.sh'), path.join(d, 'installer', 'make-release.sh'));
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    const git = (...a: string[]) => spawnSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { encoding: 'utf8' });
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'x');
    return { d, git, run: () => spawnSync('bash', [path.join(d, 'installer', 'make-release.sh'), path.join(d, 'out')], { encoding: 'utf8', env: { ...process.env, ALLOW_DIRTY: '' } }) };
  };
  it('커밋하지 않은 변경이 있거나 같은 버전 태그가 이미 있으면 릴리스 파일을 만들지 않는다', () => {
    const r = fakeRepo();
    try {
      fs.writeFileSync(path.join(r.d, 'new.txt'), 'x');
      const a = r.run();
      expect([a.status, /커밋하지 않은 변경/.test(a.stdout)]).toEqual([1, true]);
      fs.rmSync(path.join(r.d, 'new.txt'));
      r.git('tag', 'v1.2.3');
      const b = r.run();
      expect([b.status, /v1\.2\.3 태그가 이미 있습니다/.test(b.stdout)]).toEqual([1, true]);
      expect(fs.existsSync(path.join(r.d, 'out'))).toBe(false);
    } finally { fs.rmSync(r.d, { recursive: true, force: true }); }
  });
  it('package-lock.json 의 버전이 package.json 과 같다 (버전을 올릴 때 함께)', () => {
    const v = JSON.parse(fs.readFileSync(path.join(HUB, 'package.json'), 'utf8')).version;
    const lock = JSON.parse(fs.readFileSync(path.join(HUB, 'package-lock.json'), 'utf8'));
    expect([lock.version, lock.packages[''].version]).toEqual([v, v]);
  });
  it('바깥 부품(HWP 변환기)은 고정한 커밋으로 받는다 (main 을 그대로 받지 않음)', () => {
    for (const f of ['make-package.sh', 'make-windows.sh']) {
      expect(sh(f)).not.toMatch(/refs\/heads\/main/);
      expect(sh(f)).toMatch(/pins\.sh/);
    }
    expect(sh('pins.sh')).toMatch(/HWP_COMMIT="[0-9a-f]{40}"/);
  });
  it('--if-needed 지문에 배포·실행 스크립트도 들어가고, 점검 중 코드가 바뀌면 통과로 기록하지 않는다', () => {
    const run = fs.readFileSync(path.join(HUB, 'tests', 'run.js'), 'utf8');
    for (const x of ["'installer'", "'start.sh'", "'.command'", "'package-lock.json'"]) expect(run).toContain(x);
    expect(run).toMatch(/fp1 === fp0/);
  });
});

describe('윈도우 점검·실행 파일', () => {
  it('GitHub Actions 가 윈도우·맥에서 전체 점검을 돌리고, 윈도우에서는 묶음 실행 시험도 돈다', () => {
    const y = fs.readFileSync(path.join(HUB, '.github', 'workflows', 'verify.yml'), 'utf8');
    for (const t of ['windows-latest', 'macos-latest', 'npm ci', 'npm run verify', 'node tests/win-smoke.mjs']) expect({ t, has: y.includes(t) }).toEqual({ t, has: true });
  });
  it('윈도우 묶음과 실행 시험이 같은 실행 파일(installer/windows)을 쓰고, 실행 파일은 영문만 (윈도우 명령 창 한글 깨짐 방지)', () => {
    const mw = sh('make-windows.sh'), smoke = fs.readFileSync(path.join(HUB, 'tests', 'win-smoke.mjs'), 'utf8');
    for (const f of ['allinone.cmd', 'caster.cmd', 'hwp-start-hub.cmd']) {
      expect({ f, inBundle: mw.includes(`installer/windows/${f}`) }).toEqual({ f, inBundle: true });
      expect({ f, ascii: /^[\x00-\x7f]*$/.test(fs.readFileSync(path.join(HUB, 'installer', 'windows', f), 'utf8')) }).toEqual({ f, ascii: true });
    }
    for (const f of ['allinone.cmd', 'hwp-start-hub.cmd']) expect({ f, inSmoke: smoke.includes(`'${f}'`) }).toEqual({ f, inSmoke: true });
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

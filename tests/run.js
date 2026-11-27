#!/usr/bin/env node
// 라온 교회 올인원 전체 점검(하네스). 하나라도 실패하면 끝 코드 1.
//   node tests/run.js            전체 점검
//   node tests/run.js --if-needed 같은 코드로 이미 모두 통과했으면 건너뜀 (배포 스크립트가 씀)
// 실제 자료(data/, %APPDATA%)와 켜져 있는 프로그램은 건드리지 않는다: 시험 서버는 임시 자료 폴더·다른 포트로 띄우고 끝나면 지운다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = path.join(HUB, 'node_modules', '.cache', 'allinone-verify.json');
process.chdir(HUB);

// 점검 대상 코드의 지문 (바뀌면 다시 점검)
function fingerprint() {
  const h = crypto.createHash('sha256');
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { h.update(path.relative(HUB, p)); h.update(fs.readFileSync(p)); } } };
  // 배포·실행 스크립트(installer·start.sh·.command)도 점검 대상이다 (installer.test·launcher.test 가 이 파일들을 확인한다)
  for (const d of ['server', 'src', 'tests', 'public', 'installer', '.github']) if (fs.existsSync(d)) walk(d);
  const files = ['apps.json', 'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'start.sh', ...fs.readdirSync('.').filter((f) => f.endsWith('.command')).sort()];
  for (const f of files) if (fs.existsSync(f)) { h.update(f); h.update(fs.readFileSync(f)); }
  return h.digest('hex');
}
if (process.argv.includes('--if-needed')) {
  try { const s = JSON.parse(fs.readFileSync(STAMP, 'utf8')); if (s.fp === fingerprint() && s.ok) { console.log(`✓ 같은 코드로 이미 전체 점검 ${s.passed}/${s.total} 통과 (${new Date(s.at).toLocaleString('ko-KR')}) — 다시 돌리지 않습니다.`); process.exit(0); } } catch { /* 처음 */ }
}

// 지문은 점검을 시작할 때 잰다. 점검하는 동안 코드가 바뀌면(다른 작업이 함께 고치는 경우) 통과로 기록하지 않는다
const fp0 = fingerprint();
const all = [];
const step = (name, fn) => { const t0 = Date.now(); const r = fn(); all.push({ name, ...r }); console.log(`${r.ok ? '  ✓' : '  ✗'} ${name} (${Date.now() - t0}ms)${r.ok ? '' : `\n      ${String(r.error).split('\n').slice(0, 15).join('\n      ')}`}`); return r.ok; };
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: HUB, encoding: 'utf8', env: process.env, shell: process.platform === 'win32' });

// 실제 자료에 시험 자료가 섞이지 않았는지 보려고 점검에서 쓰는 글자 (켜져 있는 프로그램이 그사이 저장해도 오탐하지 않게)
const MARKS = ['시험교회', '화면시험', '김시험', '시험모임', '바뀐헌금', '시험 목사', '닫기시험성도', '고르기시험성도', '읽는금액성도', '못읽는금액성도', '바로떠나기 시험', '한 시간 분량 녹취록이라고', '저장 시험', '보안 시험'];
// data 폴더의 모든 자료 파일(real·sample·예제 예배송출·업데이트 상태 등)을 본다
const realFiles = fs.existsSync('data') ? fs.readdirSync('data').filter((f) => f.endsWith('.json')).map((f) => `data/${f}`) : [];
const already = Object.fromEntries(realFiles.map((f) => [f, MARKS.filter((m) => fs.readFileSync(f, 'utf8').includes(m))]));

console.log('\n▶ 준비');
step('형식 검사: 화면 코드에 타입 오류가 없다 (tsc)', () => { const r = sh('npx', ['tsc', '--noEmit']); return { ok: r.status === 0, error: (r.stdout + r.stderr).trim() }; });
step('화면 빌드: 화면을 만들 수 있다 (vite build)', () => { const r = sh('npx', ['vite', 'build']); return { ok: r.status === 0, error: (r.stdout + r.stderr).trim().split('\n').slice(-10).join('\n') }; });

console.log('\n▶ 단위·통합 점검 (vitest)');
{
  const out = path.join(os.tmpdir(), `allinone-vitest-${process.pid}.json`);
  const r = sh('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`]);
  try {
    const j = JSON.parse(fs.readFileSync(out, 'utf8'));
    for (const f of j.testResults) for (const t of f.assertionResults) {
      const name = `${t.ancestorTitles.join(' › ')} › ${t.title}`;
      const okd = t.status === 'passed';
      all.push({ name, ok: okd, error: (t.failureMessages || []).join('\n') });
      console.log(`${okd ? '  ✓' : '  ✗'} ${name}${okd ? '' : `\n      ${(t.failureMessages || []).join('\n').split('\n').slice(0, 8).join('\n      ')}`}`);
    }
    // 파일 자체를 읽지 못한 경우만 따로 센다 (실패한 점검이 든 파일은 위에서 이미 셈)
    const unread = j.testResults.filter((f) => f.status === 'failed' && !f.assertionResults.length);
    if (!j.testResults.length || unread.length) all.push({ name: 'vitest: 점검 파일을 모두 읽었다', ok: false, error: unread.map((f) => `${f.name}: ${f.message}`).join('\n') || '점검 파일이 하나도 없습니다' });
  } catch (e) { all.push({ name: 'vitest 실행', ok: false, error: `${e.message}\n${r.stdout}${r.stderr}`.slice(0, 2000) }); console.log(`  ✗ vitest 실행\n      ${r.stderr.slice(0, 500)}`); }
  fs.rmSync(out, { force: true });
}

const { runApi } = await import('./harness/api.mjs');
all.push(...(await runApi()));
const { runUi } = await import('./harness/ui.mjs');
all.push(...(await runUi()));

console.log('\n▶ 마무리');
step('실제 자료를 건드리지 않았다 (data 폴더의 자료 파일에 시험 자료가 없다)', () => {
  const now = fs.existsSync('data') ? fs.readdirSync('data').filter((f) => f.endsWith('.json')).map((f) => `data/${f}`) : [];
  const leaked = now.flatMap((f) => { let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; } return MARKS.filter((m) => !(already[f] || []).includes(m) && t.includes(m)).map((m) => `${f}: "${m}"`); });
  return { ok: !leaked.length, error: `시험 자료가 실제 자료에 들어갔습니다: ${leaked.join(', ')}` };
});

const passed = all.filter((x) => x.ok).length, total = all.length;
const failed = all.filter((x) => !x.ok);
console.log(`\n${failed.length ? '✗' : '✓'} 점검 ${passed}/${total} 통과${failed.length ? `\n  실패:\n${failed.map((f) => `   - ${f.name}`).join('\n')}` : ''}`);
fs.mkdirSync(path.dirname(STAMP), { recursive: true });
const fp1 = fingerprint();
if (fp1 !== fp0) console.log('⚠️ 점검하는 동안 코드가 바뀌어 이번 결과를 "통과"로 기록하지 않습니다. 다시 돌려 주세요.');
fs.writeFileSync(STAMP, JSON.stringify({ fp: fp0, ok: !failed.length && fp1 === fp0, passed, total, at: Date.now() }));
process.exit(failed.length ? 1 : 0);

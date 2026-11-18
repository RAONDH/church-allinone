#!/usr/bin/env node
// 자동 업데이트 서명 도구 (Ed25519, node 기본 기능만 씀)
//   node installer/signing.mjs keygen           처음 한 번: 비밀 열쇠를 이 맥에 만들고, 공개 열쇠를 server/update-keys.mjs 에 넣는다
//   node installer/signing.mjs sign <폴더>      그 폴더의 SHA256SUMS.txt 에 서명해 SHA256SUMS.txt.sig 를 만든다 (만든 뒤 바로 확인)
//   node installer/signing.mjs verify <폴더>    서명이 프로그램에 든 공개 열쇠와 맞는지 확인
// 비밀 열쇠는 저장소에 넣지 않는다: ~/.raon-workspace/signing/church-allinone-update.key (또는 ALLINONE_SIGNING_KEY 가 가리키는 파일)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.ALLINONE_SIGNING_KEY || path.join(os.homedir(), '.raon-workspace', 'signing', 'church-allinone-update.key');
const KEYS_FILE = path.join(HUB, 'server', 'update-keys.mjs');
const [cmd, arg] = process.argv.slice(2);
const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };

async function trusted() { return (await import(`${KEYS_FILE}?t=${Date.now()}`)).TRUSTED_KEYS; }
const pubOf = (k) => (k.type === 'public' ? k : crypto.createPublicKey(k)).export({ type: 'spki', format: 'der' }).toString('base64');

if (cmd === 'keygen') {
  let priv;
  if (fs.existsSync(KEY)) {
    // 이미 있으면 새로 만들지 않는다 (새 열쇠로 바꾸면 이미 설치된 프로그램이 새 릴리스를 믿지 못함). 공개 열쇠 등록만 확인
    priv = crypto.createPrivateKey(fs.readFileSync(KEY));
    console.log(`• 비밀 열쇠가 이미 있어 그대로 씁니다: ${KEY}`);
  } else {
    priv = crypto.generateKeyPairSync('ed25519').privateKey;
    fs.mkdirSync(path.dirname(KEY), { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEY, priv.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.log(`✓ 비밀 열쇠를 만들었습니다: ${KEY} (이 맥에만 있음 · 꼭 따로 보관하세요)`);
  }
  const pub = pubOf(priv);
  const list = [...new Set([...(await trusted()), pub])];
  fs.writeFileSync(KEYS_FILE, keysSource(list));
  console.log(`✓ 공개 열쇠가 ${path.relative(HUB, KEYS_FILE)} 에 들어 있습니다: ${pub}`);
} else if (cmd === 'sign') {
  const sums = path.join(arg || '.', 'SHA256SUMS.txt');
  if (!fs.existsSync(sums)) die(`${sums} 가 없습니다`);
  if (!fs.existsSync(KEY)) die(`비밀 열쇠가 없습니다: ${KEY}\n  처음이면 node installer/signing.mjs keygen`);
  const key = crypto.createPrivateKey(fs.readFileSync(KEY));
  if (!(await trusted()).includes(pubOf(key))) die('이 비밀 열쇠의 공개 열쇠가 프로그램(server/update-keys.mjs)에 없습니다. 이대로 배포하면 자동 설치가 거절됩니다.');
  const sig = crypto.sign(null, fs.readFileSync(sums), key).toString('base64');
  fs.writeFileSync(`${sums}.sig`, `${sig}\n`);
  if (!crypto.verify(null, fs.readFileSync(sums), crypto.createPublicKey(key), Buffer.from(sig, 'base64'))) die('서명을 만들었지만 확인되지 않습니다');
  console.log(`✓ 서명: ${sums}.sig`);
} else if (cmd === 'verify') {
  const sums = path.join(arg || '.', 'SHA256SUMS.txt');
  const { verifySums } = await import(path.join(HUB, 'server', 'update.mjs'));
  const ok = verifySums(fs.readFileSync(sums), fs.readFileSync(`${sums}.sig`, 'utf8'));
  if (!ok) die('서명이 프로그램에 든 공개 열쇠와 맞지 않습니다');
  console.log('✓ 서명이 맞습니다');
} else {
  die('사용: node installer/signing.mjs keygen | sign <폴더> | verify <폴더>');
}

function keysSource(list) {
  return `// 자동 업데이트 서명을 확인하는 공개 열쇠 (Ed25519, SPKI DER base64). 비밀 열쇠는 저장소에 없다.
// 열쇠를 바꿀 때는 새 공개 열쇠를 더하고, 옛 열쇠로 설치된 프로그램이 모두 새 버전으로 바뀐 뒤에 옛 열쇠를 뺀다.
// 만들기·서명: node installer/signing.mjs keygen | sign <폴더>
export const TRUSTED_KEYS = ${JSON.stringify(list, null, 2)};
`;
}

// 파일 이름 바꾸기 (임시 파일 → 진짜 파일). 윈도우에서는 백신(Defender)·색인기·OneDrive 가 방금 쓴 파일을 잠깐 잡고 있어
// EPERM·EBUSY·EACCES 로 실패할 때가 있다. 잠시 기다렸다가 몇 번 다시 해 본다 (맥에서는 대개 첫 번째에 끝남).
import fs from 'node:fs';

const RETRY = new Set(['EPERM', 'EBUSY', 'EACCES']);
const TRIES = 6, WAIT_MS = 100;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function renameRetrySync(from, to, rename = fs.renameSync) {
  for (let i = 1; ; i++) {
    try { return rename(from, to); }
    catch (e) { if (!RETRY.has(e.code) || i >= TRIES) throw e; sleepSync(WAIT_MS * i); }
  }
}
export async function renameRetry(from, to, rename = fs.promises.rename) {
  for (let i = 1; ; i++) {
    try { return await rename(from, to); }
    catch (e) { if (!RETRY.has(e.code) || i >= TRIES) throw e; await new Promise((r) => setTimeout(r, WAIT_MS * i)); }
  }
}

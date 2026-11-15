import { describe, expect, it } from 'vitest';
// @ts-ignore 서버 모듈은 JS
import { runCli } from '../server/ai.mjs';

describe('AI 답 받기', () => {
  it('한글 한 글자가 두 조각에 걸쳐 와도 깨지지 않는다', async () => {
    // '가'(EA B0 80)를 앞 두 바이트와 뒤 한 바이트로 나눠 따로 보낸다
    const js = "process.stdout.write(Buffer.from([0x41,0xEA,0xB0]));setTimeout(()=>process.stdout.write(Buffer.from([0x80,0x42])),50)";
    const r = await runCli(process.execPath, ['-e', js], '', 10000);
    expect(r.out).toBe('A가B');
  });
});

// 자료 저장 점검 (임시 폴더만 씀)
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore 서버 모듈은 JS
import { openStore } from '../server/store.mjs';

const dirs: string[] = [];
const T = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'allinone-store-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('자료 저장', () => {
  it('저장이 한 번 실패해도 원인이 없어지면 다음 저장은 된다 (실패·마지막 저장 시각을 알려 줌)', async () => {
    const d = T();
    const s = openStore(d, 'real');
    s.db.church = { name: '처음' };
    await s.save();
    const ok1 = s.status().lastSavedAt;
    expect(ok1).toBeGreaterThan(0);
    // 임시 파일 자리에 폴더를 만들어 쓰기를 일부러 실패시킨다
    fs.mkdirSync(path.join(d, 'real.json.tmp'));
    s.db.church = { name: '실패할 때' };
    await expect(s.save()).rejects.toThrow();
    expect(s.status().lastError).toBeTruthy();
    expect(s.status().lastSavedAt).toBe(ok1);
    // 원인을 없애면 다음 저장은 정상
    fs.rmSync(path.join(d, 'real.json.tmp'), { recursive: true });
    s.db.church = { name: '다시' };
    await s.save();
    expect(JSON.parse(fs.readFileSync(path.join(d, 'real.json'), 'utf8')).church.name).toBe('다시');
    expect(s.status().lastError).toBe('');
  });
});

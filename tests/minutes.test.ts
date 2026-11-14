import { describe, expect, it } from 'vitest';
// @ts-ignore 서버 모듈은 JS
import { parseMinutesJson, minutesPrompt, sampleMinutes } from '../server/minutes-ai.mjs';

describe('회의록 정리', () => {
  it('AI 답을 회의록 칸으로', () => {
    const r = parseMinutesJson('```json\n{"title":"제직회","summary":"1. 재정 보고","decisions":["1) 예산 통과","성탄 행사"],"todos":[{"who":"박집사","what":"업체 연락","when":"이번 주"},{"who":"","what":"","when":""}],"attendees":"5명"}\n```');
    expect(r.decisions).toBe('1. 예산 통과\n2. 성탄 행사');
    expect(r.todos).toBe('- [박집사] 업체 연락 (이번 주)');
    expect(r.content).toBe('1. 재정 보고');
  });
  it('형식이 틀리면 알려 준다', () => { expect(() => parseMinutesJson('죄송합니다')).toThrow(); });
  it('지시문에 녹취록과 지어내지 말라는 규칙이 들어간다', () => {
    const p = minutesPrompt({ church: '예제교회', meeting: '당회', date: '2026-11-15', attendees: '', transcript: '[00:00:01] 안녕하세요' });
    expect(p.system).toContain('지어내지 않습니다');
    expect(p.prompt).toContain('[00:00:01] 안녕하세요');
    expect(sampleMinutes().todos).toContain('난방기');
  });
});

// 주보 점검: 설교 요약 꺼내기, 이번 주 글 길이 (임시 자료만 씀)
import { describe, expect, it } from 'vitest';
// @ts-ignore 서버 모듈은 JS
import { summaryParts, cleanWeekBlock, WEEK_BLOCK_MAX } from '../server/bulletin.mjs';

describe('주보', () => {
  it('설교 요약: 첫머리의 제목·본문 줄만 빼고, 가운데점(·)이 든 본문 문장은 그대로 둔다', () => {
    const md = '# 주보용 설교 요약\n\n목자 · 시편 23:1-6\n\n하나님은 우리의 목자이십니다.\n은혜 · 감사 · 실천을 함께 나눕니다.\n\n라온교회 | 2026-11-22\n\n## 핵심 문장\n\n> 부족함이 없습니다';
    const p = summaryParts(md);
    expect(p.body).toBe('하나님은 우리의 목자이십니다.\n은혜 · 감사 · 실천을 함께 나눕니다.');
    expect(p.key).toBe('부족함이 없습니다');
  });
  it('이번 주 글: 정한 길이를 넘으면 잘라 저장하지 않고 알려 준다', () => {
    expect(cleanWeekBlock({ id: 'ann', text: '가'.repeat(5331) })?.text?.length).toBe(5331);
    expect(() => cleanWeekBlock({ id: 'ann', text: '가'.repeat(WEEK_BLOCK_MAX + 1) })).toThrow(/자까지/);
  });
});

describe('주보 꾸미기', () => {
  it('기본 스타일 14가지는 모두 거르기를 그대로 통과한다 (빠지는 설정 없음, 이름 중복 없음)', async () => {
    const { THEMES, cleanCss } = await import('../server/bulletinStyle.mjs');
    expect(Object.keys(THEMES).length).toBe(14);
    const names = Object.values(THEMES).map((t: any) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const [id, t] of Object.entries(THEMES) as [string, any][]) {
      const r = cleanCss(t.css);
      expect({ id, dropped: r.dropped, same: r.css.replace(/\s/g, '') === t.css.replace(/\s/g, '') }).toEqual({ id, dropped: 0, same: true });
    }
  });
});

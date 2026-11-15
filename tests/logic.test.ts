import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore 서버 모듈은 JS
import { memoryWc, findLinks, applyWeek, copyService, snapshot, fingerprint, diffSnapshots, summarize } from '../server/wc.mjs';
// @ts-ignore
import { sampleWcSeed } from '../server/sample.mjs';
import { prepSteps, splitWeeks, nextStep, setlistText } from '../src/lib/week';
import type { Week } from '../src/lib/types';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hub-')), 'wc.json');
const week = (p: Partial<Week> = {}): Week => ({ id: 'w', date: '2026-11-15', name: '주일 예배', passage: '', sermonTitle: '', announcements: [], sermonNotes: '', sermonVideoUrl: '', prayerLeader: '', wc: null, final: null, copiedFrom: null, createdAt: 0, updatedAt: 0, ...p });

describe('이번 주 계산', () => {
  it('토요일이면 다음날 주일이 이번 주', () => {
    const r = splitWeeks([week({ id: 'a', date: '2026-11-08' }), week({ id: 'b', date: '2026-11-15' }), week({ id: 'c', date: '2026-11-11' })], new Date(2026, 10, 14));
    expect(r.sun).toBe('2026-11-15');
    expect(r.primary?.id).toBe('b');
    expect(r.thisWeek.map((w) => w.id)).toEqual(['c', 'b']);
    expect(r.previous?.id).toBe('a');
  });
  it('주일 당일은 그날이 이번 주일', () => {
    expect(splitWeeks([], new Date(2026, 10, 15)).sun).toBe('2026-11-15');
  });
});

describe('준비 상태는 저장된 내용으로만 완료 표시', () => {
  it('아무것도 없으면 예배 정보가 다음 할 일', () => {
    const s = prepSteps(week(), { linked: false, connected: null });
    expect(nextStep(s)?.key).toBe('info');
    expect(s.find((x) => x.key === 'bulletin')).toBeUndefined();   // 주보 요약은 설교 후 자료에서 만든다
  });
  it('예배송출이 꺼져 있으면 완료로 표시하지 않음', () => {
    const s = prepSteps(week({ passage: '요 3:16', sermonTitle: '사랑' }), { linked: true, connected: false });
    expect(s.find((x) => x.key === 'setlist')?.level).toBe('unknown');
  });
});

describe('예배송출 연결', () => {
  it('주일 템플릿의 본문·제목·광고 자막을 찾아 채우고, 지우면 빈칸 표시로 돌아감', async () => {
    const wc = memoryWc(tmp(), () => ({ items: [], services: [], currentServiceId: null, props: [{ id: 'p', text: '설교 · 담임목사', sub: '' }] }));
    const svc = await wc.createService({ name: '주일 예배', date: '2026-11-15', template: 'sunday' });
    const links = findLinks(await wc.state(), svc.id);
    expect(links.passage && links.title && links.notice).toBeTruthy();
    const w = week({ passage: '요한복음 3:16', sermonTitle: '이처럼 사랑하사', announcements: ['추수감사 주일', '성경공부'], wc: { serviceId: svc.id, links } });
    const r = await applyWeek(wc, w);
    expect(r.done).toEqual(['본문', '설교 제목', '광고', '설교자 이름 자막']);
    let st = await wc.state();
    expect(st.items.find((i: any) => i.id === links.title).slides[0].text).toBe('말씀 선포\n이처럼 사랑하사');
    expect(st.items.find((i: any) => i.id === links.notice).slides.map((s: any) => s.text)).toEqual(['교회 소식', '추수감사 주일', '성경공부']);
    expect(st.props[0].sub).toBe('이처럼 사랑하사');
    expect((await applyWeek(wc, w)).done).toEqual([]); // 바뀐 게 없으면 다시 쓰지 않음
    await applyWeek(wc, { ...w, sermonTitle: '' });
    st = await wc.state();
    expect(st.items.find((i: any) => i.id === links.title).slides[0].text).toBe('말씀 선포\n(설교 제목)');
    expect(summarize(st, svc.id).placeholders.map((p: any) => p.text)).toContain('(설교 제목)');
  });

  it('지난 예배 복사: 곡은 같은 곡을 쓰고 순서 자막은 새로 복사 (지난주 자막이 바뀌지 않음)', async () => {
    const wc = memoryWc(tmp(), sampleWcSeed);
    const st0 = await wc.state();
    const last = st0.services[0];
    const { service, map } = await copyService(wc, last.id, { name: '주일 예배', date: '2026-11-15' });
    const st = await wc.state();
    const typeOf = (id: string) => st.items.find((i: any) => i.id === id).type;
    const songsOld = last.itemIds.filter((id: string) => typeOf(id) === 'song');
    const songsNew = service.itemIds.filter((id: string) => typeOf(id) === 'song');
    expect(songsNew).toEqual(songsOld);
    const titleOld = st0.items.find((i: any) => last.itemIds.includes(i.id) && i.slides[0].text.startsWith('말씀 선포'));
    expect(map[titleOld.id]).toBeTruthy();
    await wc.updateItem(map[titleOld.id], { slides: [{ text: '말씀 선포\n새 제목' }] });
    const after = await wc.state();
    expect(after.items.find((i: any) => i.id === titleOld.id).slides[0].text).toBe(titleOld.slides[0].text);
  });

  it('확정본은 변경을 알아채고 무엇이 바뀌었는지 알려 줌', async () => {
    const wc = memoryWc(tmp(), sampleWcSeed);
    const st = await wc.state();
    const sid = st.services[0].id;
    const snap = snapshot(st, sid);
    const song = st.items.find((i: any) => i.type === 'song' && st.services[0].itemIds.includes(i.id));
    await wc.updateItem(song.id, { key: 'Bb' });
    const now = snapshot(await wc.state(), sid);
    expect(fingerprint(now)).not.toBe(fingerprint(snap));
    expect(diffSnapshots(snap, now)).toEqual([`‘${song.title}’ 조성`]);
  });
});

describe('콘티 공유 글', () => {
  it('곡·조성·곡 구성·메모를 담고 가사는 뺌', () => {
    const t = setlistText(week({ passage: '시편 23편', sermonTitle: '목자' }), { linked: true, connected: true, summary: { id: 's', name: '', date: '', note: '', isCurrent: true, songCount: 1, songsWithoutKey: [], songsWithoutLyrics: [], placeholders: [], slideTotal: 3,
      items: [{ id: '1', type: 'song', title: '아침의 노래', key: 'G', bpm: 0, memo: '조용히', arr: ['1절', '후렴'], slideCount: 3, labels: [], empty: false }] } });
    expect(t).toContain('1. 아침의 노래 (G)');
    expect(t).toContain('1절 → 후렴');
    expect(t).toContain('말씀: 시편 23편 「목자」');
  });
});

import { matchSongs } from '../src/lib/week';
describe('찬양 큐레이터 추천곡 ↔ 찬양 자료 맞추기', () => {
  const song = (id: string, title: string) => ({ id, type: 'song', title, key: '', arr: [], memo: '', labels: [], lyrics: '', slideCount: 1, lastUsed: null, meta: {} });
  const songs = [song('a', '은혜 아니면'), song('b', '주님만 바라봅니다'), song('c', '주님만 바라봅니다'), song('d', '나')];
  it('띄어쓰기·괄호가 달라도 같은 곡으로 찾는다', () => {
    expect(matchSongs('은혜아니면 (어노인팅)', songs).map((s) => s.id)).toEqual(['a']);
  });
  it('같은 제목 곡이 여러 개면 모두 후보로 보여 준다', () => {
    expect(matchSongs('주님만 바라봅니다', songs).map((s) => s.id)).toEqual(['b', 'c']);
  });
  it('짧은 제목은 포함 관계로 억지로 맞추지 않는다', () => {
    expect(matchSongs('나의 왕 앞에서', songs)).toEqual([]);
    expect(matchSongs('없는 곡', songs)).toEqual([]);
  });
});

// 설교 후 자료: AI 답에서 결과물만 꺼내기
import { extractResult, buildPrompt } from '../server/after.mjs';
describe('설교 후 자료', () => {
  const body = '<p>' + '가'.repeat(2000) + '</p>';
  it('HTML 앞뒤 설명과 코드 울타리를 떼어 낸다', () => {
    const out = extractResult('infographic', `여기 있습니다\n\`\`\`html\n<!doctype html><html><body>${body}</body></html>\n\`\`\`\n끝`);
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out.endsWith('</html>')).toBe(true);
  });
  it('HTML이 없거나 너무 짧으면 실패로 알린다', () => {
    expect(() => extractResult('sg-adult', '죄송합니다')).toThrow();
    expect(() => extractResult('sg-youth', '<html><body>짧음</body></html>')).toThrow();
  });
  it('블로그 글은 마크다운 울타리를 떼어 낸다', () => {
    const md = '# 제목\n\n' + '본문 '.repeat(100);
    expect(extractResult('blog', '```markdown\n' + md + '\n```')).toBe(md.trim());
  });
  it('지시문에 교회 이름과 원고가 들어간다', () => {
    const p = buildPrompt('sg-adult', { church: '샘물교회', pastor: '김목사', date: '2026-11-15', service: '주일 예배', passage: '시편 23', title: '목자', notes: '원고 내용' });
    expect(p.prompt).toContain('샘물교회 장년 소그룹');
    expect(p.prompt).toContain('원고 내용');
    expect(p.prompt).not.toContain('라온동행');
  });
});

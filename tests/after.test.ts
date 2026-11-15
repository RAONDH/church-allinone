import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
// @ts-ignore 서버 모듈은 JS
import { KINDS, buildPrompt, cardsPage, extractResult, parseCards, sampleResult } from '../server/after.mjs';
import { docText, xmlParagraphs } from '../src/lib/docText';

const ctx = { church: '예제교회', pastor: '예제 목사', theology: '웨슬리안 성결 신학', date: '2026-11-15', service: '주일 예배', passage: '시편 23:1-6', title: '부족함이 없는 사람', notes: '원고 '.repeat(200) };

// 시험용 zip (워드·hwpx 와 같은 방식으로 압축)
function zip(files: Record<string, string>) {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = deflateRawSync(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

describe('설교 후 자료 · 새 종류', () => {
  it('열 가지 종류, 지시문마다 원고에 없는 것을 지어내지 말라는 규칙과 신학 관점', () => {
    expect(Object.keys(KINDS)).toHaveLength(10);
    for (const k of Object.keys(KINDS)) {
      const p = buildPrompt(k, ctx);
      expect(p.system).toContain('원고에 없는 구절을 지어내지 않는다');
      expect(p.prompt).toContain('교회의 신학 관점·말투: 웨슬리안 성결 신학');
      expect(p.prompt).toContain('[설교 원고]');
    }
    expect(buildPrompt('family', ctx).system).toContain('찬송가 번호나 곡 이름을 지어내지 않는다');
    expect(buildPrompt('shorts', ctx).prompt).toContain('바꾸거나 지어내지 않는다');
    expect(buildPrompt('review', ctx).system).toContain('신학이나 교리를 평가하지 않고');
    expect(buildPrompt('review', ctx).prompt).toMatch(/약 \d+분 분량/);
  });
  it('신학 관점을 비워 두면 그 줄을 넣지 않는다', () => {
    expect(buildPrompt('qt', { ...ctx, theology: '' }).prompt).not.toContain('신학 관점');
  });
  it('카드뉴스: JSON을 정리하고 정해진 틀로 그린다', () => {
    const j = parseCards('여기 있습니다 {"mood":"nope","cards":[{"kind":"cover","title":"제목"},{"kind":"verse","text":"말씀 </script><script>alert(1)</script>","ref":"시 23:1"},{"kind":"apply","items":["하나","","둘"]},{"kind":"end","text":"끝"}]}');
    expect(j.mood).toBe('calm');
    expect(j.cards[2].items).toEqual(['하나', '둘']);
    const html = cardsPage(j, ctx);
    expect(html).not.toContain('</script><script>alert');   // 글 속 태그가 스크립트를 깨지 않게
    expect(html).toContain('\\u003c/script>');
    expect(() => parseCards('카드를 못 만들었어요')).toThrow(/JSON/);
    expect(() => parseCards('{"cards":[{"kind":"cover","title":"a"}]}')).toThrow(/적습니다/);
    expect(extractResult('cards', '{"cards":[{"kind":"cover","title":"a"},{"kind":"point","title":"b","body":"c"},{"kind":"end","text":"d"}]}', ctx)).toContain("createElement('canvas')");
  });
  it('예제 모드에서도 모든 종류를 보여 준다', () => {
    for (const k of Object.keys(KINDS)) {
      const r = sampleResult(k, ctx);
      if (KINDS[k].format === 'html') expect(r).toMatch(/^<!doctype html>/i); else expect(r.length).toBeGreaterThan(200);
    }
  });
});

describe('원고 파일에서 글 꺼내기', () => {
  it('워드(.docx)', async () => {
    const xml = '<w:document><w:body><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>여호와는 나의 목자시니</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">내게 </w:t></w:r><w:r><w:t>부족함이 &amp; 없으리로다</w:t></w:r></w:p></w:body></w:document>';
    const f = new File([zip({ '[Content_Types].xml': '<x/>', 'word/document.xml': xml })], '설교.docx');
    expect(await docText(f)).toBe('여호와는 나의 목자시니\n내게 부족함이 & 없으리로다');
  });
  it('한글(.hwpx) 여러 구역을 차례대로', async () => {
    const sec = (t: string) => `<hs:sec><hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p></hs:sec>`;
    const f = new File([zip({ 'Contents/section1.xml': sec('둘째 구역'), 'Contents/section0.xml': sec('첫째 구역'), 'mimetype': 'application/hwp+zip' })], '원고.hwpx');
    expect(await docText(f)).toBe('첫째 구역\n\n둘째 구역');
  });
  it('글 파일과 읽지 못하는 형식 안내', async () => {
    expect(await docText(new File(['안녕하세요'], 'a.txt'))).toBe('안녕하세요');
    await expect(docText(new File(['x'], 'a.hwp'))).rejects.toThrow(/HWPX/);
    await expect(docText(new File(['x'], 'a.pdf'))).rejects.toThrow(/복사/);
    await expect(docText(new File(['x'], 'a.docx'))).rejects.toThrow(/손상/);
  });
  it('문단 안의 줄바꿈·탭', () => {
    expect(xmlParagraphs('<w:p><w:r><w:t>가</w:t><w:tab/><w:t>나</w:t><w:br/><w:t>다</w:t></w:r></w:p>', 'w:p', 'w:t')).toBe('가\t나\n다');
  });
});

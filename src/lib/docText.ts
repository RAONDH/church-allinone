// 설교 원고 파일(.docx · .hwpx · .txt · .md)에서 글만 꺼낸다. 브라우저 안에서만 읽고 어디로도 보내지 않는다.
// .docx·.hwpx 는 zip 안의 XML 이라 따로 프로그램 없이 풀 수 있다. 예전 .hwp·PDF 는 글을 안정적으로 꺼내기 어려워 안내만 한다.

interface Entry { name: string; method: number; size: number; offset: number }

function entries(buf: Uint8Array): Entry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('파일이 손상되었거나 워드·한글(hwpx) 파일이 아닙니다.');
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Entry[] = [];
  const dec = new TextDecoder();
  for (let k = 0; k < n && p + 46 <= buf.length; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    out.push({ name: dec.decode(buf.subarray(p + 46, p + 46 + nl)), method, size, offset });
    p += 46 + nl + el + cl;
  }
  return out;
}

async function read(buf: Uint8Array, e: Entry) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  const raw = buf.subarray(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method !== 8) throw new Error('지원하지 않는 압축 방식입니다.');
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

/** 문단(p) 안의 글(t)을 모아 한 줄씩. 탭·줄바꿈 표시도 살린다. */
export function xmlParagraphs(xml: string, p: string, t: string) {
  // 문단·글자 모양 설정(탭 위치 등)은 글이 아니므로 먼저 걷어 낸다
  const paras = xml.replace(/<w:(pPr|rPr)\b[\s\S]*?<\/w:\1>/g, '').split(new RegExp(`</${p}>`));
  return paras.map((para) => {
    let s = '';
    const re = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>|<[\\w:]*(?:tab)\\b[^>]*/>|<[\\w:]*(?:br|lineBreak)\\b[^>]*/>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(para))) {
      if (m[1] !== undefined) s += unescapeXml(m[1].replace(/<[^>]+>/g, ''));
      else if (/tab/i.test(m[0])) s += '\t';
      else s += '\n';
    }
    return s;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function docText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (/\.(txt|md|text)$/.test(name)) {
    const b = new Uint8Array(await file.arrayBuffer());
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(b);
    // 메모장에서 ANSI(EUC-KR)로 저장한 파일
    return utf8.includes('�') ? new TextDecoder('euc-kr').decode(b) : utf8;
  }
  if (/\.hwp$/.test(name)) throw new Error('예전 한글 파일(.hwp)은 바로 읽지 못합니다. 한글에서 "다른 이름으로 저장 → 파일 형식: HWPX"로 저장해 넣거나, 원고를 복사해 붙여 넣어 주세요.');
  if (/\.pdf$/.test(name)) throw new Error('PDF는 바로 읽지 못합니다. PDF를 열어 원고를 모두 선택(Ctrl/⌘+A)해 복사한 뒤 붙여 넣어 주세요.');
  if (/\.doc$/.test(name)) throw new Error('예전 워드 파일(.doc)은 바로 읽지 못합니다. 워드에서 .docx 로 저장해 넣거나 복사해 붙여 넣어 주세요.');
  const buf = new Uint8Array(await file.arrayBuffer());
  const list = entries(buf);
  if (/\.docx$/.test(name)) {
    const e = list.find((x) => x.name === 'word/document.xml');
    if (!e) throw new Error('워드 문서 안에서 본문을 찾지 못했습니다.');
    return xmlParagraphs(await read(buf, e), 'w:p', 'w:t');
  }
  if (/\.hwpx$/.test(name)) {
    const secs = list.filter((x) => /^Contents\/section\d+\.xml$/i.test(x.name)).sort((a, b) => +a.name.replace(/\D/g, '') - +b.name.replace(/\D/g, ''));
    if (!secs.length) throw new Error('한글(hwpx) 문서 안에서 본문을 찾지 못했습니다.');
    const parts = [];
    for (const e of secs) parts.push(xmlParagraphs(await read(buf, e), 'hp:p', 'hp:t'));
    return parts.join('\n\n').trim();
  }
  throw new Error('워드(.docx)·한글(.hwpx)·글(.txt) 파일만 넣을 수 있습니다.');
}

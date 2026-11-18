// 마크다운을 안전하게 화면 글자로 (HTML 을 직접 넣지 않음). 제목·목록·인용·굵게·코드·https 링크만.
import type { ReactNode } from 'react';

function inline(s: string, k = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(<b key={`${k}-${i++}`}>{m[1]}</b>);
    else if (m[2]) out.push(<code key={`${k}-${i++}`}>{m[2]}</code>);
    else out.push(<a key={`${k}-${i++}`} href={m[4]} target="_blank" rel="noopener noreferrer">{m[3]}</a>);
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function SafeMd({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: { depth: number; text: string }[] = [];
  const flush = () => {
    if (!list.length) return;
    out.push(<ul key={`u${out.length}`}>{list.map((x, i) => <li key={i} style={x.depth ? { marginLeft: `${x.depth * 1.2}em` } : undefined}>{inline(x.text, i)}</li>)}</ul>);
    list = [];
  };
  text.replace(/\r/g, '').split('\n').forEach((line, i) => {
    const l = line.trimEnd();
    const li = l.match(/^(\s*)[-*]\s+(.*)$/);
    if (li) { list.push({ depth: Math.min(3, Math.floor(li[1].length / 2)), text: li[2] }); return; }
    flush();
    if (!l.trim() || /^\|/.test(l.trim()) || /^-{3,}$/.test(l.trim())) return;
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) out.push(h[1].length <= 2 ? <h3 key={i}>{inline(h[2], i)}</h3> : <h4 key={i}>{inline(h[2], i)}</h4>);
    else if (l.startsWith('>')) out.push(<blockquote key={i}>{inline(l.replace(/^>\s?/, ''), i)}</blockquote>);
    else out.push(<p key={i}>{inline(l, i)}</p>);
  });
  flush();
  return <>{out}</>;
}

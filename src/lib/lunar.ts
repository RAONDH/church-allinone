// 음력 → 양력 바꾸기. 브라우저·Node 에 들어 있는 한국 음력 달력(Intl 'dangi')을 쓴다 (따로 받는 표 없음).
// server/lunar.mjs 와 같은 계산이다 (주보는 서버에서 만들므로). 둘을 고치면 함께 고칠 것 — tests/people.test.ts 가 둘을 비교한다.
const cache = new Map<number, Map<string, string>>();
let fmt: Intl.DateTimeFormat | null = null;

// 음력 y년의 '월-일(-윤)' → 양력 날짜 표 (음력 y년은 양력 y년 1~2월쯤 시작해 y+1년 2월쯤 끝남)
function yearTable(y: number) {
  let t = cache.get(y);
  if (t) return t;
  t = new Map();
  try {
    fmt ||= new Intl.DateTimeFormat('en-u-ca-dangi', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    for (let ms = Date.UTC(y, 0, 1, 12), end = Date.UTC(y + 1, 2, 31, 12); ms <= end; ms += 86400000) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
      if (+(p.relatedYear || p.year) !== y) continue;
      const leap = /bis/.test(p.month);
      t.set(`${parseInt(p.month, 10)}-${+p.day}${leap ? '-윤' : ''}`, new Date(ms).toISOString().slice(0, 10));
    }
  } catch { /* 음력 달력이 없는 환경: 빈 표 */ }
  cache.set(y, t);
  return t;
}

/** 음력 y년 m월 d일(leap: 윤달)의 양력 날짜 'YYYY-MM-DD'. 그해 윤달이 없으면 평달로, 그달이 29일까지면 29일로. 못 바꾸면 null */
export function lunarToSolar(y: number, m: number, d: number, leap = false): string | null {
  const t = yearTable(y);
  for (const [mm, lp] of leap ? [[m, true], [m, false]] as const : [[m, false]] as const) {
    for (const dd of d === 30 ? [30, 29] : [d]) {
      const v = t.get(`${mm}-${dd}${lp ? '-윤' : ''}`);
      if (v) return v;
    }
  }
  return null;
}

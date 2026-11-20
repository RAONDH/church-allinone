// 주보 꾸미기: 주보의 겉모양(글꼴·색·제목 꾸밈·선)만 바꾸는 스타일(CSS)
// - 내용·칸 배치·분량 재기·자동 채우기·확정본·잠금은 그대로 두고, 겉모양만 덮어쓴다
// - 기본 스타일 몇 가지 + AI 가 글 설명을 보고 만든 스타일 + 저장해 둔 '내 스타일'
// - 어디서 온 CSS 든 cleanCss 로 걸러서만 저장·적용한다:
//   바깥 주소(url·@import)·스크립트 흔적은 버리고, 자리·크기·숨김을 바꾸는 속성(위치·너비·높이·display·overflow·
//   visibility·content 등)은 받지 않는다 → 칸이 사라지거나 종이 밖으로 나가지 않고, 분량 재기도 그대로 맞는다.

export const STYLE_MAX = 6000;     // 거른 뒤 CSS 글자 수 한도
export const MY_STYLES_MAX = 8;    // 저장해 둘 수 있는 내 스타일 수

// 받는 속성 (겉모양만). 그 밖의 속성은 버린다
const ALLOWED = new Set([
  'color', 'background', 'background-color', 'background-image',
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-color', 'border-style', 'border-width', 'border-radius',
  'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color',
  'border-top-width', 'border-bottom-width', 'border-left-width', 'border-right-width',
  'border-top-style', 'border-bottom-style', 'border-left-style', 'border-right-style',
  'outline', 'box-shadow', 'text-shadow',
  'font-family', 'font-weight', 'font-style', 'font-size', 'font-variant', 'letter-spacing', 'word-spacing',
  'text-align', 'text-decoration', 'text-decoration-color', 'text-decoration-style', 'text-transform', 'text-underline-offset',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'list-style-type',
  'background-size', 'background-repeat', 'background-position',
]);
// 주보 틀이 쓰는 변수(줄간격 자동 채우기)는 못 바꾸게 하고, 색 변수(--a 등)만 받는다
const VAR_OK = /^--(a|ink|muted|[a-z][a-z0-9-]{0,20})$/;
const VAR_BAD = new Set(['--lh', '--gap']);
// 고르는 말(선택자)에 쓸 수 있는 글자. 주보 바깥 단추·안내(.tools .how)는 건드리지 못한다
const SEL_OK = /^[a-zA-Z0-9\s.#:>,_+~()*\-[\]="]+$/;
const SEL_BAD = /\.tools|\.how|::?(before|after|marker|selection|first-letter|first-line)|:has|:not\(/i;
// 값에 있으면 버리는 것 (바깥 주소·스크립트·이스케이프·숨기기)
const VAL_BAD = /url\s*\(|image-set|expression|javascript:|@|\\|<|>|\{|\}|!\s*important|attr\s*\(|var\s*\(\s*--(lh|gap)/i;

/** CSS 를 걸러 겉모양 규칙만 남긴다: { css, dropped: 버린 개수 } */
export function cleanCss(raw) {
  let src = String(raw ?? '').slice(0, 40000);
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');   // 설명 글 빼기
  src = src.replace(/<\/?style[^>]*>/gi, '');
  let dropped = 0;
  // @규칙(@import·@font-face·@media·@page 등)은 통째로 버린다 (중괄호 안쪽까지)
  for (;;) {
    const i = src.indexOf('@');
    if (i < 0) break;
    const semi = src.indexOf(';', i), open = src.indexOf('{', i);
    if (open < 0 || (semi >= 0 && semi < open)) { src = src.slice(0, i) + src.slice(semi < 0 ? src.length : semi + 1); dropped++; continue; }
    let depth = 0, j = open;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    src = src.slice(0, i) + src.slice(j + 1);
    dropped++;
  }
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (!sel || sel.length > 200 || !SEL_OK.test(sel) || SEL_BAD.test(sel)) { dropped++; continue; }
    const decls = [];
    for (const d of m[2].split(';')) {
      if (!d.trim()) continue;
      const k = d.indexOf(':');
      if (k < 0) { dropped++; continue; }
      const prop = d.slice(0, k).trim().toLowerCase();
      const val = d.slice(k + 1).trim().replace(/\s+/g, ' ');
      const okProp = ALLOWED.has(prop) || (VAR_OK.test(prop) && !VAR_BAD.has(prop));
      if (!okProp || !val || val.length > 200 || VAL_BAD.test(val)) { dropped++; continue; }
      if (prop === 'background-image' && !/^(none|(repeating-)?(linear|radial)-gradient\([^;]*\))$/i.test(val)) { dropped++; continue; }
      if (prop === 'font-size' && !okFontSize(val)) { dropped++; continue; }
      decls.push(`${prop}:${val}`);
    }
    if (decls.length) out.push(`${sel}{${decls.join(';')}}`);
  }
  let css = out.join('\n');
  if (css.length > STYLE_MAX) { css = css.slice(0, STYLE_MAX).replace(/\n[^\n]*$/, ''); dropped++; }
  return { css, dropped };
}
// 글자 크기는 너무 크거나 작게 못 하게 (주보가 넘치거나 못 읽게 되는 것 막기)
function okFontSize(v) {
  const m = v.match(/^(\d*\.?\d+)(em|rem|px|pt|%)$/i);
  if (!m) return /^(smaller|larger|inherit)$/i.test(v);
  const n = +m[1], u = m[2].toLowerCase();
  if (u === 'em' || u === 'rem') return n >= 0.7 && n <= 2.6;
  if (u === '%') return n >= 70 && n <= 260;
  if (u === 'px') return n >= 9 && n <= 40;
  return n >= 7 && n <= 30;   // pt
}

// 기본 스타일 (AI 없이도 고를 수 있게). basic = 지금까지의 모양
// ── 직접 조합하기: 색 · 칸 제목 · 예배 순서 · 단 바탕 · 교회 안내 · 글꼴을 골라 하나의 스타일로 ──
// 실제 주보에서 흔한 모양(제목 띠, 가운데 큰 제목, 이름표, 점선 이음 순서, 단마다 다른 바탕, 아래 안내 상자)을 부품으로 나눴다.
export const COLORS = {
  green: { name: '초록', a: '#2f5d50', al: '#e8f0ec' },
  navy: { name: '남색', a: '#1f3b63', al: '#e8edf4' },
  slate: { name: '회청', a: '#5f7f8b', al: '#e6eef1' },
  mocha: { name: '모카 갈색', a: '#7d6555', al: '#f3eee9' },
  burgundy: { name: '버건디', a: '#7a1f2b', al: '#f6e9eb' },
  purple: { name: '보라', a: '#5a2d82', al: '#f0eaf6' },
  gold: { name: '금색', a: '#8a6d1f', al: '#f6f0dc' },
  gray: { name: '회색', a: '#5c5c5c', al: '#eeeeee' },
  black: { name: '흑백', a: '#000000', al: '#f2f2f2' },
};
export const HEADINGS = {
  line: { name: '왼쪽 선', css: '' },
  band: { name: '색 띠', css: 'h3{border-left:none;background:var(--a);color:#fff;padding:2px 8px;font-weight:600}' },
  tint: { name: '옅은 띠', css: 'h3{border-left:none;background:var(--al);color:var(--a);padding:3px 8px}' },
  center: { name: '가운데 큰 제목', css: 'h3{border-left:none;text-align:center;font-size:1.25rem;color:var(--ink);padding:2px 0}' },
  under: { name: '밑줄', css: 'h3{border-left:none;border-bottom:2px solid var(--a);padding:0 0 2px}' },
  lines: { name: '위아래 선', css: 'h3{border-left:none;text-align:center;border-top:1px solid var(--a);border-bottom:1px solid var(--a);padding:1px 0;letter-spacing:.2em}' },
  tag: { name: '이름표', css: 'h3{border-left:14px solid var(--al);color:var(--ink);padding-left:8px}' },
  pill: { name: '둥근 띠', css: 'h3{border-left:none;background:var(--al);color:var(--a);padding:2px 12px;border-radius:999px}' },
};
export const ORDERS = {
  dots: { name: '점선 밑줄', css: '' },
  leader: { name: '점선 이음 (굵은 순서)', css: '.order li{border-bottom:none;padding:3px 0;background-image:radial-gradient(circle,#a9a9a9 0.8px,transparent 1.3px);background-size:5px 4px;background-repeat:repeat-x;background-position:0 60%}\n.order li span{font-weight:700;background-color:var(--bg);padding-right:6px}\n.order li em{background-color:var(--bg);padding-left:6px}' },
  solid: { name: '가는 실선', css: '.order li{border-bottom:1px solid var(--al)}' },
  plain: { name: '줄 없이 넉넉히', css: '.order li{border-bottom:none;padding:4px 0}\n.order li span{font-weight:600}' },
  stripe: { name: '줄무늬', css: '.order li{border-bottom:none;padding:3px 6px}\n.order li:nth-child(odd){background:var(--al)}' },
};
// 진한 바탕(흰 글자) 단 안에서 색이 따로 정해진 글자들을 희게
const dark = (sel) => `${sel}{background:var(--a);color:#fff;padding:6px 10px;--bg:var(--a);--ink:#fff;--muted:#e9eef0}
${sel} .church,${sel} h3,${sel} .motto,${sel} .sermon .title{color:#fff}
${sel} h3{border-color:#ffffff99}
${sel} blockquote{background:#ffffff26}
${sel} .order li{border-color:#ffffff55}
${sel} .cover{background:none;border-color:#ffffff99}`;
const tintPanel = (sel) => `${sel}{background:var(--al);padding:6px 10px;--bg:var(--al)}`;
export const PANELS = {
  none: { name: '없음 (흰 바탕)', css: '' },
  leftTint: { name: '왼쪽 단 옅은 바탕', css: tintPanel('.sheet>div:first-child') },
  rightTint: { name: '오른쪽 단 옅은 바탕', css: tintPanel('.sheet>div:last-child') },
  leftDark: { name: '왼쪽 단 진한 바탕 (흰 글자)', css: dark('.sheet>div:first-child') },
  rightDark: { name: '오른쪽 단 진한 바탕 (흰 글자)', css: dark('.sheet>div:last-child') },
  boxes: { name: '칸마다 상자', css: 'section{background:var(--al);border-radius:8px;padding:5px 10px;--bg:var(--al)}\n.info{border-top:none}' },
};
export const INFOS = {
  plain: { name: '기본', css: '' },
  box: { name: '옅은 상자', css: '.info{border-top:none;background:var(--al);border-radius:6px;padding:8px 6px}' },
  band: { name: '진한 띠', css: '.info{border-top:none;background:var(--a);color:#fff;border-radius:4px;padding:8px 6px;--muted:#eef;--ink:#fff}' },
};
export const FONTS = {
  gothic: { name: '고딕', css: '' },
  serif: { name: '명조', css: "body,.sheet,.m{font-family:'Nanum Myeongjo','AppleMyungjo','Batang','Noto Serif KR',serif}" },
};
export const COMBO_PARTS = { color: COLORS, heading: HEADINGS, order: ORDERS, panel: PANELS, info: INFOS, font: FONTS };
export const COMBO_DEFAULT = { color: 'green', heading: 'line', order: 'dots', panel: 'none', info: 'plain', font: 'gothic' };
/** 고른 부품으로 스타일 만들기: { css, name, parts } (모르는 값은 기본 부품) */
export function composeStyle(raw = {}) {
  const parts = {};
  for (const [k, list] of Object.entries(COMBO_PARTS)) parts[k] = Object.hasOwn(list, raw[k]) ? raw[k] : COMBO_DEFAULT[k];
  const c = COLORS[parts.color];
  const css = [
    `:root{--a:${c.a};--al:${c.al};--bg:#fff}`,
    `blockquote{background:var(--al)}`,
    `.cover{border-color:var(--a);background:linear-gradient(#ffffff,var(--al))}`,
    HEADINGS[parts.heading].css, ORDERS[parts.order].css, PANELS[parts.panel].css, INFOS[parts.info].css, FONTS[parts.font].css,
  ].filter(Boolean).join('\n');
  const name = `${c.name} · ${HEADINGS[parts.heading].name} · ${ORDERS[parts.order].name.replace(/ \(.*\)$/, '')}${parts.panel !== 'none' ? ` · ${PANELS[parts.panel].name.replace(/ \(.*\)$/, '')}` : ''}${parts.font === 'serif' ? ' · 명조' : ''}`;
  return { css, name, parts };
}
const combo = (name, p) => ({ name, css: composeStyle(p).css, parts: composeStyle(p).parts });

export const THEMES = {
  basic: { name: '기본', css: '' },
  warm: {
    name: '따뜻한',
    css: `:root{--a:#9a4a1f;--ink:#3a2a1e;--muted:#7a6656}
header{border-bottom:3px double #c98a5a}
.church{letter-spacing:.04em}
h3{border-left:none;border-bottom:1px solid #e3c7ae;padding-left:0;padding-bottom:2px}
blockquote{background:#fbf1e6;border-radius:10px}
.cover{border-color:#c98a5a;background:linear-gradient(#fffaf4,#fbefe2)}`,
  },
  classic: {
    name: '고전적인',
    css: `:root{--a:#1f3a5f;--ink:#1d1d1d;--muted:#555}
body,.sheet,.m{font-family:'Nanum Myeongjo','AppleMyungjo','Batang','Noto Serif KR',serif}
header{border-bottom:1px solid var(--a);box-shadow:0 3px 0 -2px var(--a)}
.church{letter-spacing:.12em}
h3{border-left:none;text-align:center;letter-spacing:.2em;border-top:1px solid #c9d1dc;border-bottom:1px solid #c9d1dc;padding:2px 0}
blockquote{background:none;border-left:3px solid var(--a);border-radius:0;font-style:italic}
.cover{border-width:1px;border-style:double;border-color:var(--a)}`,
  },
  modern: {
    name: '단정한',
    css: `:root{--a:#222;--ink:#222;--muted:#777}
header{border-bottom:1px solid #222;text-align:left}
.church{font-weight:900;letter-spacing:-.02em}
h3{border-left:none;text-transform:uppercase;letter-spacing:.06em;font-size:.82rem;color:#888;padding-left:0}
.order li{border-bottom:1px solid #eee}
blockquote{background:#f4f4f4;border-radius:0}
.cover{border:none;border-radius:0;background:#fafafa}`,
  },
  // ── 아래 10가지: 실제 교회 주보에서 흔히 쓰는 모양(제목 띠·상자·종이·절기 색 등)을 겉모양만으로 옮긴 것 ──
  bandGray: {
    name: '회색 제목 띠',
    css: `:root{--a:#6f6f6f;--ink:#222;--muted:#666}
header{border-bottom:3px solid #8a8a8a}
.church{color:#333}
h3{border-left:none;background:#8a8a8a;color:#fff;padding:2px 8px;font-weight:600;letter-spacing:.03em}
table.serve th{background:#eeeeee;color:#333;text-align:center}
table.serve td{border-bottom:1px solid #cfcfcf}
.order li{border-bottom:1px solid #d6d6d6}
blockquote{background:#f1f1f1;border-left:4px solid #8a8a8a;border-radius:0}
.cover{border-color:#8a8a8a;background:linear-gradient(#ffffff,#f0f0f0)}`,
  },
  bandNavy: {
    name: '남색 제목 띠',
    css: `:root{--a:#1f3b63;--ink:#1c2430;--muted:#5d6878}
header{border-bottom:3px solid #1f3b63}
h3{border-left:none;background:#1f3b63;color:#fff;padding:2px 8px;font-weight:600}
table.serve th{background:#e8edf4;color:#1f3b63}
.order li{border-bottom:1px solid #d5dce6}
blockquote{background:#eef2f8;border-left:4px solid #1f3b63;border-radius:0}
.info{border-top:2px solid #1f3b63}
.cover{border-color:#1f3b63;background:linear-gradient(#f7f9fc,#e6ecf4)}`,
  },
  bandGreen: {
    name: '숲 초록 띠',
    css: `:root{--a:#2c5e3f;--ink:#1f2a22;--muted:#5d6b60}
header{border-bottom:3px solid #2c5e3f}
h3{border-left:none;background:#2c5e3f;color:#fff;padding:2px 8px;border-radius:3px;font-weight:600}
table.serve th{background:#e7f0e9;color:#2c5e3f}
.order li{border-bottom:1px dotted #9db9a4}
blockquote{background:#edf4ee;border-radius:6px}
.cover{border-color:#2c5e3f;background:linear-gradient(#f8fbf8,#e3eee5)}`,
  },
  card: {
    name: '상자형',
    css: `:root{--a:#34495e;--ink:#222;--muted:#666}
header{border-bottom:none;background:#f3f5f8;border-radius:8px;padding:6px 4px}
section{background:#f7f8fa;border:1px solid #dfe3e8;border-radius:8px;padding:4px 8px}
h3{border-left:none;border-bottom:1px solid #dfe3e8;padding:0 0 2px}
.order li{border-bottom:1px solid #e6e9ee}
blockquote{background:#fff;border:1px solid #dfe3e8}
.info{border-top:none}
.cover{border:1px solid #dfe3e8;background:#f7f8fa}`,
  },
  pastel: {
    name: '하늘 파스텔',
    css: `:root{--a:#3a78b8;--ink:#2a3440;--muted:#6b7a8c}
header{border-bottom:2px dashed #9cc3e8}
.church{color:#2d6aa8}
h3{border-left:none;background:#e3f0fb;color:#2d6aa8;padding:2px 10px;border-radius:999px;font-weight:700}
.order li{border-bottom:1px dotted #b9d4ee}
blockquote{background:#f0f7fd;border-radius:12px}
table.serve td{border-bottom:1px dotted #c5dcf1}
.cover{border:2px dashed #9cc3e8;background:linear-gradient(#ffffff,#eaf4fc)}`,
  },
  paper: {
    name: '베이지 종이 (명조)',
    css: `:root{--a:#6b4a2b;--ink:#2e2418;--muted:#7a6a58}
.sheet,.m{background:#fbf6ea;font-family:'Nanum Myeongjo','AppleMyungjo','Batang','Noto Serif KR',serif}
header{border-bottom:1px solid #b89a74}
h3{border-left:none;border-bottom:1px solid #d9c6a8;padding:0 0 2px;letter-spacing:.08em}
.order li{border-bottom:1px dotted #cdb894}
blockquote{background:#f3ead8;border-radius:2px;font-style:italic}
table.serve td{border-bottom:1px dotted #d9c6a8}
.cover{border:1px solid #b89a74;background:#f6eedc}`,
  },
  burgundy: {
    name: '버건디 고전',
    css: `:root{--a:#7a1f2b;--ink:#231a1b;--muted:#6e5b5d}
body,.sheet,.m{font-family:'Nanum Myeongjo','AppleMyungjo','Batang','Noto Serif KR',serif}
header{border-bottom:4px double #7a1f2b}
.church{letter-spacing:.1em}
h3{border-left:none;text-align:center;border-top:1px solid #7a1f2b;border-bottom:1px solid #7a1f2b;padding:1px 0;letter-spacing:.25em}
.sermon .title{color:#7a1f2b}
blockquote{background:none;border-left:3px double #7a1f2b;border-radius:0}
.cover{border:4px double #7a1f2b;background:#fffdfb}`,
  },
  mono: {
    name: '흑백 (흑백 인쇄용)',
    css: `:root{--a:#000;--ink:#000;--muted:#444}
header{border-bottom:2px solid #000}
.church{font-weight:900}
h3{border-left:none;border-bottom:2px solid #000;padding:0 0 1px;font-weight:800}
.order li{border-bottom:1px solid #bbb}
blockquote{background:none;border:1px solid #000;border-radius:0}
table.serve th{color:#000;font-weight:700}
.cover{border:2px solid #000;background:#fff}`,
  },
  purple: {
    name: '대림·사순 보라',
    css: `:root{--a:#5a2d82;--ink:#241b2e;--muted:#6c5f7a}
header{border-bottom:3px solid #5a2d82}
h3{border-left:none;background:linear-gradient(90deg,#5a2d82,#8a63b0);color:#fff;padding:2px 8px;font-weight:600}
.order li{border-bottom:1px dotted #b9a3d0}
blockquote{background:#f3eef8;border-left:4px solid #5a2d82;border-radius:0}
.cover{border-color:#5a2d82;background:linear-gradient(#ffffff,#efe7f6)}`,
  },
  christmas: {
    name: '성탄 빨강·초록',
    css: `:root{--a:#a3222a;--ink:#26201f;--muted:#6b5f5c}
header{border-bottom:3px double #1f6b3a}
.church{color:#a3222a}
h3{border-left:4px solid #1f6b3a;color:#a3222a}
.order li{border-bottom:1px dotted #c9a3a3}
blockquote{background:#fbf0ef;border-left:4px solid #a3222a;border-radius:0}
table.serve th{color:#1f6b3a}
.cover{border:3px double #1f6b3a;background:linear-gradient(#ffffff,#fbeeee)}`,
  },
  // ── 조합으로 만든 기본 스타일 10가지 (단 바탕·가운데 제목·점선 이음 등 여러 모양) ──
  slatePanel: combo('회청 진한 왼쪽 단', { color: 'slate', heading: 'center', order: 'leader', panel: 'leftDark', info: 'box' }),
  slateSoft: combo('회청 옅은 오른쪽 단', { color: 'slate', heading: 'center', order: 'leader', panel: 'rightTint', info: 'box' }),
  mochaTag: combo('모카 이름표', { color: 'mocha', heading: 'tag', order: 'leader', panel: 'rightTint', info: 'box' }),
  mochaDark: combo('모카 진한 오른쪽 단', { color: 'mocha', heading: 'tint', order: 'leader', panel: 'rightDark', info: 'plain' }),
  navyClean: combo('남색 밑줄 상자', { color: 'navy', heading: 'under', order: 'solid', panel: 'boxes', info: 'plain' }),
  goldThanks: combo('금색 감사 (명조)', { color: 'gold', heading: 'lines', order: 'leader', panel: 'none', info: 'box', font: 'serif' }),
  burgundyBox: combo('버건디 옅은 띠 (명조)', { color: 'burgundy', heading: 'tint', order: 'plain', panel: 'boxes', info: 'plain', font: 'serif' }),
  monoLeader: combo('흑백 점선 이음', { color: 'black', heading: 'under', order: 'leader', panel: 'none', info: 'box' }),
  greenStripe: combo('초록 줄무늬', { color: 'green', heading: 'pill', order: 'stripe', panel: 'leftTint', info: 'band' }),
  purpleSoft: combo('보라 옅은 오른쪽 단', { color: 'purple', heading: 'band', order: 'leader', panel: 'rightTint', info: 'box' }),
};

/** 설정의 꾸밈 부분 정리: theme(고른 스타일), customCss(AI·내 스타일), customName, myStyles */
export function cleanStyleSettings(b = {}) {
  const theme = Object.hasOwn(THEMES, b.theme) || b.theme === 'custom' ? b.theme : 'basic';
  const customCss = cleanCss(b.customCss).css;
  const customName = String(b.customName ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
  const myStyles = (Array.isArray(b.myStyles) ? b.myStyles : []).slice(0, MY_STYLES_MAX).map((x) => ({
    name: String(x?.name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || '내 스타일',
    css: cleanCss(x?.css).css,
  })).filter((x) => x.css);
  return { theme: theme === 'custom' && !customCss ? 'basic' : theme, customCss, customName, myStyles };
}
/** 주보에 덧붙일 꾸밈 CSS (설정 기준) */
export function themeCss(s) {
  if (s.theme === 'custom') return s.customCss || '';
  return Object.hasOwn(THEMES, s.theme) ? THEMES[s.theme].css : '';
}

// ── AI 로 스타일 만들기 ──
export const STYLE_SYSTEM = `당신은 한국 교회 주보 디자이너입니다. 사용자가 말한 분위기에 맞게 주보의 겉모양만 바꾸는 CSS 를 씁니다.
주보 HTML 의 구조(바꿀 수 없음):
- :root 의 색 변수: --a(강조색, 제목·선), --ink(본문 글자색), --muted(흐린 글자색)
- header(맨 위 머리말) 안: .church(교회 이름), .motto(표어), .date(날짜), img.logo
- section(칸 하나) 안: h3(칸 제목), 칸 종류는 section[data-b="order"|"sermon"|"summary"|"ann"|"photo"|"serve"|"events"|"births"|"info"]
- .order li(예배 순서 한 줄), .order em(찬양 표시), .sermon .passage(본문), .sermon .title(설교 제목), .sermon .by(설교자)
- blockquote(설교 요약 핵심 문장), .ann li(광고), table.serve th/td(봉사표), .ev li(일정), .info(교회 안내), .photo .cap(사진 설명)
- 인쇄용 종이는 .sheet, 접는 4면의 각 면은 .face, 4면 표지는 .cover(.cover .church, .cover .ctitle 등), 휴대폰 주보 본문은 .m
규칙:
- 쓸 수 있는 속성: color, background(-color), background-image(linear-gradient/radial-gradient 만), border 계열, border-radius, box-shadow, text-shadow, font-family, font-weight, font-style, font-size(0.7em~2.6em), letter-spacing, text-align, text-decoration, text-transform, padding 계열, list-style-type, 색 변수(--a 등).
- 쓰면 버려지는 것: url(), @import, @font-face, @media, 위치·너비·높이·margin·display·line-height·overflow·content·::before/::after.
- 글꼴은 컴퓨터에 깔린 것만: 'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR', 명조는 'Nanum Myeongjo','AppleMyungjo','Batang', serif.
- 인쇄물이므로 본문 글자는 진하고 읽기 쉽게, 배경은 옅게. 글자 크기를 크게 키우지 마세요(종이가 넘칩니다).
- 답은 \`\`\`css 코드 한 덩어리만 주세요. 코드 첫 줄에 /* 이름: (스타일 이름 10자 안쪽) */ 을 적으세요.`;

export function stylePrompt(desc, base = '') {
  return `원하는 주보 분위기: ${desc}${base ? `\n\n지금 쓰는 스타일(이것을 바탕으로 고쳐 주세요):\n\`\`\`css\n${base}\n\`\`\`` : ''}`;
}
/** AI 답에서 CSS 와 이름 꺼내기 */
export function extractCss(text) {
  const t = String(text || '');
  const m = t.match(/```(?:css)?\s*([\s\S]*?)```/i);
  const css = (m ? m[1] : t).trim();
  const name = (css.match(/\/\*\s*이름\s*[:：]\s*([^*]{1,40}?)\s*\*\//) || [])[1] || '';
  return { css, name: name.trim() };
}

// 예제 자료에서는 AI 를 부르지 않고, 설명의 낱말로 기본 스타일 하나를 바탕으로 한 예시를 보여 준다
export function sampleStyle(desc) {
  const d = String(desc || '');
  const pick = /명조|고전|전통|클래식|격식/.test(d) ? 'classic' : /따뜻|가을|추수|감사|부드|파스텔/.test(d) ? 'warm' : /단정|깔끔|현대|모던|심플|흑백/.test(d) ? 'modern' : 'warm';
  let css = THEMES[pick].css;
  const colors = { 초록: '#2e6b3f', 녹색: '#2e6b3f', 파랑: '#1f4f8f', 남색: '#1f3a5f', 보라: '#5b3d8a', 빨강: '#9b2c2c', 자주: '#7a2a55', 갈색: '#7a4a24', 금색: '#a07a1c', 회색: '#555' };
  const c = Object.keys(colors).find((k) => d.includes(k));
  if (c) css = css.replace(/--a:#[0-9a-f]{3,6}/i, `--a:${colors[c]}`);
  return { css, name: `예시 · ${THEMES[pick].name}${c ? ` ${c}` : ''}` };
}

// 설교 후 자료: 설교 원고 → 인포그래픽 웹페이지 · 블로그 글 · 소그룹 나눔지(장년·청소년)
// 지시문은 목사님이 쓰던 sermon-infographic · small-group-study 스킬을 바탕으로, 교회 이름·목회자는 설정에서 가져온다.

export const KINDS = {
  infographic: { label: '설교 인포그래픽', format: 'html', file: 'infographic' },
  blog: { label: '블로그 글', format: 'md', file: 'blog' },
  'sg-adult': { label: '소그룹 나눔지 (장년)', format: 'html', file: 'smallgroup-adult' },
  'sg-youth': { label: '소그룹 나눔지 (청소년)', format: 'html', file: 'smallgroup-youth' },
};
export const MIN_NOTES = 300; // 이보다 짧으면 원고가 아니라 요지로 보고 만들지 않음

const COMMON = `
[지켜야 할 것]
- 성경 구절 본문은 원고에 있는 그대로 옮긴다. 원고에 없는 구절을 지어내지 않는다. 원고에 본문이 없으면 장·절 표시만 한다.
- 예화·인물·숫자·원어(히브리어·헬라어) 설명은 원고에 있는 것만 쓴다. 없는 이야기를 만들지 않는다.
- 원고의 문장과 은혜를 살린다. 지나치게 줄이지 않는다.
- 한국어로 쓴다.`;

const HTML_RULES = `
[HTML 규칙]
- 완전한 단일 HTML 문서 하나만 출력한다. 첫 글자는 <!doctype html>, 마지막은 </html>. 설명·코드 울타리(\`\`\`)를 붙이지 않는다.
- CSS와 스크립트는 모두 문서 안에 넣는다. 외부 자원은 Google Fonts만 쓴다(이미지 파일·외부 스크립트 금지, 아이콘은 이모지나 CSS 도형).
- localStorage·쿠키·외부 요청을 쓰지 않는다.
- 모바일에서 읽기 좋게 반응형으로, 본문 16px 이상, 줄간격 1.7 이상. @media print 에서 배경을 흰색으로.`;

function header(ctx) {
  return [
    `교회: ${ctx.church || '(교회 이름 없음)'}`,
    ctx.pastor && `설교자: ${ctx.pastor}`,
    `날짜: ${ctx.date}`,
    ctx.service && `예배: ${ctx.service}`,
    ctx.passage && `본문: ${ctx.passage}`,
    ctx.title && `설교 제목: ${ctx.title}`,
  ].filter(Boolean).join('\n');
}

export function buildPrompt(kind, ctx) {
  const foot = `${ctx.church || '교회'}${ctx.pastor ? ` | ${ctx.pastor}` : ''} | ${ctx.date}`;
  const data = `${header(ctx)}\n\n[설교 원고]\n${ctx.notes}`;
  if (kind === 'infographic') return {
    system: `당신은 설교를 성도가 다시 읽기 좋은 "디지털 설교 리포트" 웹페이지로 만드는 인포그래픽 디자이너이자 웹 퍼블리셔입니다.${COMMON}${HTML_RULES}`,
    prompt: `아래 설교로 인포그래픽 웹페이지를 만들어 주세요.

[구성 · 순서 그대로]
1. 히어로 머리: 설교 제목과 본문을 헤드라인으로, 테마 색의 그라데이션이나 기하학 무늬 배경
2. 오늘의 중심 말씀: 본문 구절을 강조 상자에
3. 대지별 섹션 3~4개: 아이콘 + 소제목 + 핵심 내용(넉넉하고 풍성하게). 감동적인 문장·예화는 인용(blockquote) 모양으로
4. 핵심 단어 5~7개를 태그 모양으로
5. 결론 한 메시지: 가로 배너 카드 (원고 결론을 충분히)
6. 삶의 적용 체크리스트: 눌러서 체크되는 상자 (순수 HTML/CSS/JS, 저장 기능 없이)
7. 기도문과 아래쪽 정보: "${foot}"

[디자인]
- 설교 분위기에 맞는 새 색 조합(주색·보조색·강조색·배경)을 :root CSS 변수로. 본문 글꼴 'Noto Sans KR', 제목·강조는 'Gowun Batang' (Google Fonts)
- max-width 700px 가운데 정렬, 섹션마다 부드러운 테두리와 옅은 그림자, 넉넉한 여백
- <body data-scripture="${(ctx.passage || '').replace(/"/g, '')}">

${data}`,
  };
  if (kind === 'blog') return {
    system: `당신은 목회자의 설교 원고를 교회 블로그(네이버 블로그·티스토리 등)에 올릴 글로 다듬는 편집자입니다. 설교자의 목소리와 신학을 바꾸지 않고, 강단 말투("여러분, ~합니다")를 읽는 글에 맞게 자연스럽게 고칩니다.${COMMON}`,
    prompt: `아래 설교 원고를 블로그 글로 바꿔 주세요.

[형식 · 마크다운]
- 첫 줄: "# " 로 시작하는 블로그 제목 (설교 제목을 살리되 검색해서 들어온 사람도 끌리게)
- 다음 줄: 본문 구절과 날짜 한 줄 (예: "${ctx.passage || '본문'} · ${ctx.date}")
- 도입 2~3문단: 오늘 글이 다루는 삶의 질문으로 시작
- "## " 소제목 3~4개로 나눈 본문. 원고의 대지와 예화를 살리고, 핵심 문장은 "> " 인용으로 한두 번
- "## 오늘의 적용" 에 실천 3가지를 "- " 목록으로
- 마지막에 짧은 기도 한 문단
- 맨 끝 한 줄: "${foot}"
- 굵게는 **…** 만 쓰고, 표·이미지·HTML은 쓰지 않는다
- 해시태그 5~8개를 마지막 줄 다음에 "#태그" 형태로 한 줄에
- 설명 없이 글만 출력한다

${data}`,
  };
  if (kind === 'sg-adult') return {
    system: `당신은 설교 원고로 장년 소그룹 나눔지를 만드는 교회 교육 담당자입니다.${COMMON}${HTML_RULES}`,
    prompt: `아래 설교로 장년 소그룹 나눔지(90분) HTML을 만들어 주세요.

[구성 · 순서 그대로]
1. 머리: 설교 제목(명조 계열), 본문, 날짜·90분·"${ctx.church || '교회'} 장년 소그룹" 알약 모양 표시
2. 핵심 말씀 상자: 강조색 배경, 왼쪽 금색 테두리, 구절 + 출처
3. 함께 시작해요 (10분): 마음을 여는 질문 1개 + 기울임 힌트
4. 말씀 함께 읽기: 대표 본문 3~5절을 절 번호 강조해서
5. 말씀 속으로 (25분): 본문 이해 질문 2개 ("~라고 할 수 있는 이유는?"처럼 생각을 여는 질문), 질문마다 인도자 힌트와 답 적는 칸
6. 내 삶에 가져오기 (25분): 삶 적용 질문 2개, 힌트와 답 적는 칸
7. 이번 주 적용 (10분): 설교 적용점 3개 + "나의 한 가지" 빈칸
8. 중보기도 (20분): 이름·기도제목 표 5줄
9. 인도자 가이드: <details> 접기, 질문마다 핵심 포인트·보충 설명·분위기 여는 팁, 시간 조절 팁 (원어 설명은 원고에 있을 때만)
10. 아래쪽: "${foot}"

[디자인]
- 글꼴 Noto Sans KR + Noto Serif KR (Google Fonts), max-width 800px, 설교 분위기에 맞는 새 색 조합
- 인쇄하면 A4로 깔끔하게(details 숨김, 배경 흰색), 600px 이하 모바일 대응

${data}`,
  };
  if (kind === 'sg-youth') return {
    system: `당신은 설교 원고로 청소년 소그룹 나눔지를 만드는 청소년부 교사입니다. 청소년 눈높이의 밝고 에너지 있는 말투를 씁니다.${COMMON}${HTML_RULES}`,
    prompt: `아래 설교로 청소년 소그룹 나눔지(75분) HTML을 만들어 주세요.

[구성 · 순서 그대로]
1. 머리: "🔥 청소년 소그룹" 배지, 굵은 제목(강조어는 강조색), 본문, 날짜·75분·교회 이름 알약 3개
2. 웜업 (10분, 어두운 카드): 설교 주제와 이어지는 가벼운 자기 표현 질문, 돌아가며 말하는 방법 안내
3. 오늘의 말씀 (15분, 강조색 카드): 핵심 구절 2~3개 + OX 퀴즈 2개 (O/X 단추를 누르면 정답과 한 줄 해설이 보이게, 순수 JS)
4. 토크타임 (30분): 질문 4개, 순서대로 [공감] 비슷한 경험 → [솔직] 마음속 감정 → [도전] 지금 내 나이에 적용 → [깊이] 신앙의 핵심, 질문마다 적는 줄
5. 이번 주 챌린지 (5분, 노란 카드): 이번 주에 할 수 있는 구체적 행동 1개 + "나의 다짐" 빈칸
6. 함께 기도 (15분, 어두운 카드): 이름·기도제목 카드 4칸 + 30~40자 마무리 기도문
7. 아래쪽: "${ctx.church || '교회'} 청소년부${ctx.pastor ? ` | ${ctx.pastor}` : ''} | ${ctx.date}"

[디자인]
- 글꼴 Noto Sans KR (Google Fonts), max-width 800px, 설교 분위기에 맞는 선명한 새 색 조합, 600px 이하 모바일 대응, 인쇄 대응

${data}`,
  };
  throw new Error('알 수 없는 자료 종류');
}

// AI 답에서 결과물만 꺼낸다
export function extractResult(kind, raw) {
  let t = String(raw || '').trim();
  if (KINDS[kind].format === 'html') {
    const start = t.search(/<!doctype html|<html[\s>]/i);
    const end = t.toLowerCase().lastIndexOf('</html>');
    if (start < 0 || end < start) throw new Error('AI가 웹페이지(HTML) 형식으로 답하지 않았습니다. 다시 만들어 주세요.');
    t = t.slice(start, end + 7);
    if (t.length < 1500) throw new Error('AI가 만든 페이지가 너무 짧습니다. 다시 만들어 주세요.');
    return t;
  }
  t = t.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();
  if (t.length < 300) throw new Error('AI가 만든 글이 너무 짧습니다. 다시 만들어 주세요.');
  return t;
}

// ── 예제 모드: AI를 부르지 않고 바로 보여 주는 예시 ─────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const page = (title, bodyHtml, accent) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{--a:${accent};--bg:#faf8f4;--ink:#2b2a28}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.75 -apple-system,'Apple SD Gothic Neo',sans-serif}
.w{max-width:720px;margin:0 auto;padding:28px 18px 60px}.hero{background:linear-gradient(135deg,var(--a),#2b2a28);color:#fff;border-radius:16px;padding:32px 24px}
.hero small{opacity:.8}.card{background:#fff;border:1px solid #e6e1d8;border-radius:14px;padding:18px 20px;margin:16px 0;box-shadow:0 1px 3px #0000000d}
.verse{border-left:5px solid var(--a);background:#fff;padding:14px 18px;border-radius:10px;font-weight:600}.tag{display:inline-block;background:var(--a);color:#fff;border-radius:99px;padding:2px 12px;margin:3px;font-size:.9rem}
.note{background:#fff3cd;border-radius:10px;padding:10px 14px;font-size:.9rem}label{display:block;margin:6px 0}.line{border-bottom:1px solid #ccc;height:28px}
footer{text-align:center;color:#888;font-size:.85rem;margin-top:30px}@media print{body{background:#fff}.note{display:none}}</style></head>
<body><div class="w"><p class="note">예제 화면입니다. 실제 자료에서는 AI 구독이 설교 원고 전체를 읽고 훨씬 풍성하게 만듭니다.</p>${bodyHtml}</div></body></html>`;

export function sampleResult(kind, ctx) {
  const t = ctx.title || '부족함이 없는 사람', p = ctx.passage || '시편 23:1-6';
  const foot = `<footer>${esc(ctx.church || '예제 교회')} | ${esc(ctx.date)}</footer>`;
  if (kind === 'infographic') return page(`${t} · 설교 리포트`, `
<div class="hero"><small>${esc(p)}</small><h1>${esc(t)}</h1></div>
<div class="card"><h2>오늘의 중심 말씀</h2><p class="verse">${esc(p)}</p></div>
<div class="card"><h2>🐑 1. 목자 되신 하나님</h2><p>[예제] 원고의 첫 대지가 여기 들어갑니다.</p></div>
<div class="card"><h2>💧 2. 쉴 만한 물가</h2><p>[예제] 두 번째 대지와 예화가 인용 모양으로 들어갑니다.</p></div>
<div class="card"><h2>🍽 3. 원수의 목전에서 베푸시는 상</h2><p>[예제] 세 번째 대지가 들어갑니다.</p></div>
<div class="card"><h2>핵심 단어</h2><span class="tag">목자</span><span class="tag">쉼</span><span class="tag">동행</span><span class="tag">상</span></div>
<div class="card"><h2>이번 주 실천</h2><label><input type="checkbox"> 하루 10분 말씀 앞에 머물기</label><label><input type="checkbox"> 걱정 하나를 기도로 맡기기</label></div>
${foot}`, '#5b7f6a');
  if (kind === 'sg-adult') return page(`${t} · 장년 나눔지`, `
<div class="hero"><small>장년 소그룹 · 90분 · ${esc(p)}</small><h1>${esc(t)}</h1></div>
<div class="card"><h2>함께 시작해요 (10분)</h2><p>[예제] 요즘 내 마음이 가장 쉬었던 순간은 언제였나요?</p></div>
<div class="card"><h2>말씀 속으로 (25분)</h2><p>1. [예제] 다윗이 하나님을 '목자'라고 부른 이유는 무엇일까요?</p><div class="line"></div></div>
<div class="card"><h2>내 삶에 가져오기 (25분)</h2><p>1. [예제] 아직 맡기지 못하고 있는 것은 무엇인가요?</p><div class="line"></div></div>
<div class="card"><h2>중보기도 (20분)</h2><div class="line"></div><div class="line"></div></div>
${foot}`, '#3d5a80');
  if (kind === 'sg-youth') return page(`${t} · 청소년 나눔지`, `
<div class="hero"><small>🔥 청소년 소그룹 · 75분</small><h1>${esc(t)}</h1></div>
<div class="card"><h2>웜업 (10분)</h2><p>[예제] 요즘 나를 제일 지치게 하는 건 뭐야?</p></div>
<div class="card"><h2>오늘의 말씀 · OX 퀴즈</h2><p>[예제] 시편 23편은 다윗의 시다. (O)</p></div>
<div class="card"><h2>토크타임 (30분)</h2><p>[공감] [예제] 누군가 나를 챙겨 줘서 고마웠던 적 있어?</p><div class="line"></div></div>
<div class="card"><h2>이번 주 챌린지</h2><p>[예제] 고마운 사람에게 문자 한 통 보내기</p></div>
${foot}`, '#e76f51');
  return `# [예제] ${t}\n\n${p} · ${ctx.date}\n\n예제 글입니다. 실제 자료에서는 AI 구독이 설교 원고 전체를 블로그 글로 다듬습니다.\n\n## 1. 목자 되신 하나님\n\n원고의 첫 대지가 읽는 글 말투로 들어갑니다.\n\n> 핵심 문장이 이렇게 인용으로 들어갑니다.\n\n## 2. 쉴 만한 물가\n\n두 번째 대지와 예화가 들어갑니다.\n\n## 오늘의 적용\n\n- 하루 10분 말씀 앞에 머물기\n- 걱정 하나를 기도로 맡기기\n- 고마운 사람에게 안부 전하기\n\n주님, 오늘도 우리의 목자가 되어 주옵소서. 아멘.\n\n${ctx.church || '예제 교회'} | ${ctx.date}\n\n#시편23편 #주일설교 #목자 #예제`;
}

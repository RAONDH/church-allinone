// 설교 후 자료: 설교 원고 → 인포그래픽 웹페이지 · 블로그 글 · 소그룹 나눔지(장년·청소년)
// 지시문은 목사님이 쓰던 sermon-infographic · small-group-study 스킬을 바탕으로, 교회 이름·목회자는 설정에서 가져온다.

export const KINDS = {
  infographic: { label: '설교 인포그래픽', format: 'html', file: 'infographic' },
  blog: { label: '블로그 글', format: 'md', file: 'blog' },
  'sg-adult': { label: '소그룹 나눔지 (장년)', format: 'html', file: 'smallgroup-adult' },
  'sg-youth': { label: '소그룹 나눔지 (청소년)', format: 'html', file: 'smallgroup-youth' },
  summary: { label: '주보·문자용 요약', format: 'md', file: 'summary' },
  cards: { label: '카드뉴스·말씀카드', format: 'html', file: 'cardnews', json: true },
  qt: { label: '한 주 묵상 (7일)', format: 'html', file: 'devotion' },
  family: { label: '가정예배지', format: 'html', file: 'family-worship' },
  shorts: { label: '쇼츠 대본', format: 'md', file: 'shorts-script' },
  review: { label: '설교 점검 (목회자용)', format: 'md', file: 'sermon-review' },
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
    ctx.theology && `교회의 신학 관점·말투: ${ctx.theology} (이 관점을 존중하되, 원고에 없는 교리 설명을 길게 덧붙이지 않는다)`,
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
  if (kind === 'summary') return {
    system: `당신은 교회 주보와 성도 단체 문자에 실을 설교 요약을 쓰는 편집자입니다. 설교자의 표현을 살리고 해석을 덧붙이지 않습니다.${COMMON}`,
    prompt: `아래 설교로 주보·문자용 요약을 만들어 주세요.

[형식 · 마크다운, 순서 그대로]
- "# 주보용 설교 요약" 다음 줄에 "${ctx.title || '설교 제목'} · ${ctx.passage || '본문'}"
- 요약 본문 300~400자 (한 문단 또는 두 문단, 원고의 흐름 순서대로)
- "## 핵심 문장" 다음에 원고에서 가장 중심이 되는 문장 하나를 "> " 인용으로 (원고 문장 그대로)
- "## 한 주 동안 붙들 질문" 다음에 질문 하나
- "## 문자·카톡용 (100자 안팎)" 다음에 짧은 안부 겸 요약 한 문단 ("이번 주일 말씀은 ~" 처럼 시작)
- 맨 끝 한 줄: "${foot}"
- 설명 없이 글만 출력한다

${data}`,
  };
  if (kind === 'cards') return {
    system: `당신은 설교를 인스타그램·카카오톡에 올릴 카드뉴스(정사각형 카드 여러 장) 문구로 다듬는 편집자입니다. 디자인은 프로그램이 하므로 문구만 JSON으로 답합니다.${COMMON}`,
    prompt: `아래 설교로 카드뉴스 문구를 만들어 주세요. 반드시 JSON 하나만 출력합니다(설명·코드 울타리 없이).

{
  "mood": "calm | warm | hope | deep | fresh 중 설교 분위기에 맞는 하나",
  "cards": [
    { "kind": "cover", "title": "표지 제목 (24자 이내, 설교 제목을 살려 끌리게)", "sub": "본문 장·절" },
    { "kind": "point", "title": "대지 소제목 (20자 이내)", "body": "핵심 내용 (90자 이내, 원고 문장을 살려서)" },
    { "kind": "verse", "text": "말씀카드로 쓸 핵심 구절 (원고에 있는 구절 그대로, 120자 이내)", "ref": "장·절" },
    { "kind": "apply", "title": "이번 주 실천", "items": ["실천 1 (30자 이내)", "실천 2", "실천 3"] },
    { "kind": "end", "text": "마무리 한 문장 (50자 이내)" }
  ]
}

[규칙]
- 카드는 6~8장: cover 1장으로 시작, point 3~4장, verse 1장, apply 1장, end 1장으로 끝.
- verse 의 text 는 원고에 실제로 있는 성경 구절 문장만. 원고에 구절 본문이 없으면 verse 카드를 빼고 point 를 하나 더.
- 글자 수 제한을 꼭 지킨다(카드에 들어가야 함). 이모지·해시태그를 넣지 않는다.

${data}`,
  };
  if (kind === 'qt') return {
    system: `당신은 주일 설교를 성도 가정이 한 주 동안 이어서 묵상하도록 돕는 따뜻하고 지성적인 목회자입니다.${COMMON}
- 원어 단어는 원고에서 설교자가 직접 언급한 것만 쓴다. 없으면 그 칸을 만들지 않는다.
- 날마다 "읽을 말씀"은 설교 본문과 원고에 실제로 나온 구절에서만 고른다. 원고에 없는 다른 성경 구절을 끌어오지 않는다.${HTML_RULES}`,
    prompt: `아래 설교로 "말씀을 따라 사는 한 주 묵상" 7일분(주일~토요일) HTML을 만들어 주세요.

[날마다 초점을 달리해 반복이 아니라 깊어지게]
주일: 설교 핵심 메시지 전체 / 월: 본문의 배경과 문맥 / 화: 핵심 단어 / 수: 은혜와 복음 / 목: 성화·거룩한 삶의 적용 / 금: 가정과 공동체 / 토: 한 주를 돌아보며 다음 주일 준비

[하루 구성]
- 요일과 묵상 제목
- 오늘 읽을 말씀 (장·절)
- 말씀 묵상 3~5문장 (원고 내용을 바탕으로)
- 원어 단어 묵상 (원고에 언급이 있을 때만)
- 묵상 질문 1개 / 오늘의 실천 1개 (가정과 일상에서 구체적으로)
- 짧은 기도 3~4문장 ("우리 가정"을 주어로, 예수 그리스도의 이름으로 마침)
- "했어요" 체크 상자 (순수 HTML/CSS)

[화면]
- 위에 요일 단추 7개(누르면 그날로 이동), 오늘 요일을 강조하는 작은 스크립트(저장 기능 없이)
- 머리에 대제목 "${ctx.church || '우리 교회'} 말씀을 따라 사는 한 주 묵상", 설교 제목·본문·날짜
- 글꼴 Noto Sans KR + Gowun Batang (Google Fonts), max-width 720px, 차분한 새 색 조합
- 인쇄하면 하루가 반 쪽 정도로 깔끔하게(단추 숨김, 배경 흰색)
- 아래쪽: "${foot}"

${data}`,
  };
  if (kind === 'family') return {
    system: `당신은 주일 설교를 가정에서 이어받아 드리는 가정예배 순서지를 만드는 목회자입니다. 어린 자녀부터 어른까지 함께 드릴 수 있게, 단순하고 모두가 참여하도록 만듭니다.${COMMON}
- 찬송가 번호나 곡 이름을 지어내지 않는다. 찬양 칸은 "가족이 함께 부를 찬양: ________" 처럼 비워 둔다.${HTML_RULES}`,
    prompt: `아래 설교로 가정예배지(30~40분, A4 2쪽 안팎) HTML을 만들어 주세요.

[구성 · 순서 그대로]
1. 머리: "${ctx.church || '우리 교회'} 가정예배", 설교 제목·본문·날짜, 핵심 구절 한 줄
2. ① 모임 (5분): 가족이 함께 부를 찬양(빈칸), 근황 나누기 한 줄 안내
3. ② 말씀 (10~15분): 본문 읽기 안내(돌아가며), 설교 핵심 요약 200~300자, "🧒 어린이와 함께" 쉬운 설명 100~150자와 어린이 질문 1개
4. ③ 나눔 (10분): 가족 나눔 질문 3개(본문 이해 → 이번 주 경험 → 우리 가족 실천), "우리 가족은 이번 주 ______을 실천하겠습니다" 빈칸
5. ④ 기도 (5분): 가족 기도 제목 칸 4줄, 기도 도우미(대표 기도문 예시 3~4문장)
6. ⑤ 마침 (2분): 주기도문 또는 사도신경 안내, 부모가 자녀에게 하는 축복의 말 예시 한 문장
7. 잘라서 냉장고에 붙이는 암송 구절 카드(점선 상자, 원고에 있는 구절만)
8. 아래쪽: "${foot}"

[디자인]
- 따뜻한 색(연한 초록·베이지 계열), 이모지 아이콘, 손글씨 메모를 위한 넉넉한 여백
- 글꼴 Noto Sans KR + Gowun Batang (Google Fonts), max-width 800px, 인쇄하면 A4로 깔끔하게

${data}`,
  };
  if (kind === 'shorts') return {
    system: `당신은 주일 설교 영상에서 1분 이내 쇼츠로 자를 구간을 고르고 자막을 다는 편집자입니다. 대본은 설교자가 실제로 한 말(원고 문장)만 씁니다.${COMMON}`,
    prompt: `아래 설교 원고에서 유튜브 쇼츠·릴스로 만들 구간 3개를 골라 주세요.

[형식 · 마크다운]
- 첫 줄 "# 쇼츠 대본 · ${ctx.title || '설교'}"
- 후보마다 "## 쇼츠 1 — 제목(20자 이내)" 형식, 그 아래:
  - "**첫 3초 문구**: …" (화면 위에 띄울 끌리는 한 줄, 15자 이내)
  - "**찾을 곳**: 원고에서 이 구간이 시작하는 문장의 첫 마디를 그대로 따옴표로"
  - "**대본** (30~55초 분량, 약 150~250자)": 원고 문장을 그대로 옮긴다. 줄이기 위해 문장을 빼는 것은 되지만 바꾸거나 지어내지 않는다
  - "**자막 줄**": 대본을 한 줄 14자 안팎으로 끊은 목록 ("- " 로)
  - "**설명란**": 2~3문장 + 본문 장·절
  - "**해시태그**": 5개
- 고르는 기준: 이야기·예화가 있는 곳, 질문을 던지는 곳, 결론의 핵심 선포. 앞뒤 맥락 없이도 이해되는 구간
- 마지막에 "## 편집 팁" 2~3줄 (원고 순서상 앞쪽·중간·끝 어디쯤인지)

${data}`,
  };
  if (kind === 'review') return {
    system: `당신은 목회자가 설교를 다듬도록 돕는 동료 설교 코치입니다. 신학이나 교리를 평가하지 않고, 전달·구조·적용만 살핍니다. 정중하고 구체적으로 씁니다. 이 글은 설교자 본인만 봅니다.${COMMON}`,
    prompt: `아래 설교 원고를 점검해 주세요.

[형식 · 마크다운]
- "# 설교 점검" 다음 줄에 "원고 ${ctx.notes.length}자 · 말하는 속도 기준 약 ${Math.max(1, Math.round(ctx.notes.length / 330))}분 분량 (1분에 330자 안팎으로 셈)"
- "## 한 문장으로 본 이 설교": 원고가 실제로 말하는 중심 메시지 한 문장 (청중이 기억할 문장)
- "## 구조": 원고의 흐름을 서론-대지-결론 순서로 3~6줄 목록, 흐름이 끊기거나 갑자기 넘어가는 곳이 있으면 짚기
- "## 잘된 점" 3가지 (원고 문장을 짧게 인용하며)
- "## 다듬으면 좋을 점" 3가지: 각각 [어디] 원고 문장 첫 마디 → [이유] → [이렇게 바꿔 보면] 예시 문장
- "## 적용 점검": 적용이 구체적인지(누가·언제·무엇을), 더 구체적으로 만든 예 1~2개
- "## 본문과의 연결": 본문 구절이 설교 흐름에 실제로 쓰였는지, 본문에서 멀어진 부분이 있는지
- 신학적 옳고 그름, 교단 교리는 판단하지 않는다. 원고를 새로 써 주지 않는다
- 설명 없이 점검 글만 출력한다

${data}`,
  };
  throw new Error('알 수 없는 자료 종류');
}

// AI 답에서 결과물만 꺼낸다
export function extractResult(kind, raw, ctx = {}) {
  let t = String(raw || '').trim();
  if (KINDS[kind].json) return cardsPage(parseCards(t), ctx);
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
  if (kind === 'cards') return cardsPage({ mood: 'calm', cards: [
    { kind: 'cover', title: t, sub: p },
    { kind: 'point', title: '목자 되신 하나님', body: '[예제] 원고의 첫 대지가 90자 안쪽 문장으로 들어갑니다.' },
    { kind: 'point', title: '쉴 만한 물가', body: '[예제] 두 번째 대지의 핵심 문장이 들어갑니다.' },
    { kind: 'verse', text: '여호와는 나의 목자시니 내게 부족함이 없으리로다', ref: '시편 23:1' },
    { kind: 'apply', title: '이번 주 실천', items: ['하루 10분 말씀 앞에 머물기', '걱정 하나를 기도로 맡기기', '고마운 사람에게 안부 전하기'] },
    { kind: 'end', text: '[예제] 주님이 오늘도 우리의 목자 되십니다' },
  ] }, ctx);
  if (kind === 'qt') return page(`${t} · 한 주 묵상`, `
<div class="hero"><small>${esc(ctx.church || '예제 교회')} 말씀을 따라 사는 한 주 묵상 · ${esc(p)}</small><h1>${esc(t)}</h1></div>
${['주일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'].map((d, i) => `<div class="card"><h2>${d} · [예제] ${['목자 되신 하나님', '다윗이 이 시를 쓴 자리', '"목자"라는 말', '부족함이 없는 은혜', '쉴 만한 물가로', '함께 걷는 가족', '다음 주일을 기다리며'][i]}</h2><p>[예제] 그날의 초점에 맞춘 묵상 3~5문장이 들어갑니다.</p><p><b>묵상 질문</b> 오늘 내 마음을 가장 지치게 한 것은 무엇인가요?</p><p><b>오늘의 실천</b> 식사 전에 가족이 한 문장씩 감사 기도하기</p><label><input type="checkbox"> 했어요</label></div>`).join('')}
${foot}`, '#6b705c');
  if (kind === 'family') return page(`${t} · 가정예배지`, `
<div class="hero"><small>${esc(ctx.church || '예제 교회')} 가정예배 · ${esc(p)}</small><h1>${esc(t)}</h1></div>
<div class="card"><h2>① 모임 (5분)</h2><p>가족이 함께 부를 찬양: ____________</p></div>
<div class="card"><h2>② 말씀 (10~15분)</h2><p>[예제] 설교 핵심 요약이 200~300자로 들어갑니다.</p><p>🧒 <b>어린이와 함께</b> [예제] 양을 돌보는 목자처럼 하나님이 우리를 돌보세요. 오늘 누가 나를 돌봐 주었나요?</p></div>
<div class="card"><h2>③ 나눔 (10분)</h2><p>1. [예제] 다윗은 왜 하나님을 목자라고 했을까요?</p><p>2. [예제] 이번 주 하나님이 돌봐 주신다고 느낀 순간은?</p><p>3. 우리 가족은 이번 주 <span class="line" style="display:inline-block;width:160px"></span>을 실천하겠습니다.</p></div>
<div class="card"><h2>④ 기도 · ⑤ 마침</h2><div class="line"></div><div class="line"></div><p>주기도문으로 마칩니다. 부모가 자녀에게: "하나님이 너의 목자가 되어 주시길 축복해."</p></div>
<div class="card" style="border:2px dashed #999"><b>✂ 이번 주 암송 구절</b><p class="verse">여호와는 나의 목자시니 내게 부족함이 없으리로다 (시 23:1)</p></div>
${foot}`, '#7a9a6b');
  const tail = `\n\n${ctx.church || '예제 교회'} | ${ctx.date}`;
  if (kind === 'summary') return `# 주보용 설교 요약\n\n${t} · ${p}\n\n[예제] 예제 요약입니다. 실제 자료에서는 AI 구독이 설교 원고의 흐름 그대로 300~400자 요약을 씁니다. 다윗은 목자 되신 하나님 안에서 부족함이 없다고 고백합니다. 쉴 만한 물가와 원수의 목전에서 베푸시는 상은 오늘 우리 삶에도 주시는 약속입니다.\n\n## 핵심 문장\n\n> [예제] 원고에서 가장 중심이 되는 문장이 그대로 들어갑니다.\n\n## 한 주 동안 붙들 질문\n\n나는 무엇이 부족하다고 느끼며 살고 있나요?\n\n## 문자·카톡용 (100자 안팎)\n\n이번 주일 말씀은 "${t}"였습니다. 한 주 동안 목자 되신 주님을 기억하며 평안하시길 기도합니다.${tail}`;
  if (kind === 'shorts') return `# 쇼츠 대본 · ${t}\n\n## 쇼츠 1 — [예제] 부족함이 없다는 말\n\n- **첫 3초 문구**: 정말 부족함이 없나요?\n- **찾을 곳**: "[예제] 원고 문장의 첫 마디"\n- **대본**: [예제] 실제 자료에서는 원고 문장을 그대로 옮긴 30~55초 분량이 들어갑니다.\n- **자막 줄**:\n  - 여호와는 나의 목자시니\n  - 내게 부족함이 없으리로다\n- **설명란**: 주일 설교 중에서. ${p}\n- **해시태그**: #주일설교 #시편23편 #목자 #쇼츠 #예제\n\n## 편집 팁\n\n- 쇼츠 1은 원고 앞쪽, 2는 중간 예화, 3은 결론에 있습니다.${tail}`;
  if (kind === 'review') return `# 설교 점검\n\n[예제] 원고 0자 · 약 0분 분량\n\n## 한 문장으로 본 이 설교\n\n[예제] 목자 되신 하나님 안에서 우리는 부족함이 없다.\n\n## 구조\n\n- 서론: [예제] 요즘의 부족함\n- 1대지: 목자 되신 하나님\n- 2대지: 쉴 만한 물가\n- 결론: 동행의 고백\n\n## 잘된 점\n\n- [예제] 실제 자료에서는 원고 문장을 짧게 인용하며 3가지를 짚습니다.\n\n## 다듬으면 좋을 점\n\n- [어디] "…" → [이유] … → [이렇게 바꿔 보면] …\n\n## 적용 점검\n\n- [예제] "기도합시다" 대신 "이번 주 잠들기 전 걱정 하나를 적고 기도해 보세요"처럼 구체적으로.\n\n이 점검은 신학을 판단하지 않고 전달·구조·적용만 봅니다.`;
  return `# [예제] ${t}\n\n${p} · ${ctx.date}\n\n예제 글입니다. 실제 자료에서는 AI 구독이 설교 원고 전체를 블로그 글로 다듬습니다.\n\n## 1. 목자 되신 하나님\n\n원고의 첫 대지가 읽는 글 말투로 들어갑니다.\n\n> 핵심 문장이 이렇게 인용으로 들어갑니다.\n\n## 2. 쉴 만한 물가\n\n두 번째 대지와 예화가 들어갑니다.\n\n## 오늘의 적용\n\n- 하루 10분 말씀 앞에 머물기\n- 걱정 하나를 기도로 맡기기\n- 고마운 사람에게 안부 전하기\n\n주님, 오늘도 우리의 목자가 되어 주옵소서. 아멘.\n\n${ctx.church || '예제 교회'} | ${ctx.date}\n\n#시편23편 #주일설교 #목자 #예제`;
}

// ── 카드뉴스: AI는 문구(JSON)만, 그림은 이 프로그램이 정해진 틀로 그린다 (글자가 넘치거나 색이 깨지지 않게) ──
const MOODS = {
  calm: { bg: '#eef3ee', ink: '#1f3b2d', accent: '#5b7f6a', soft: '#ffffff' },
  warm: { bg: '#f8efe4', ink: '#4a2c17', accent: '#c46b2d', soft: '#fffaf3' },
  hope: { bg: '#eaf2fb', ink: '#17324d', accent: '#3d7cc9', soft: '#ffffff' },
  deep: { bg: '#1f2433', ink: '#f4efe6', accent: '#d9b25f', soft: '#2a3044' },
  fresh: { bg: '#f1f8f2', ink: '#173b2a', accent: '#2f9e6a', soft: '#ffffff' },
};
const cut = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export function parseCards(raw) {
  const t = String(raw || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  let j;
  try { j = JSON.parse(t.slice(a, b + 1)); } catch { throw new Error('AI가 카드 문구를 정해진 형식(JSON)으로 답하지 않았습니다. 다시 만들어 주세요.'); }
  const cards = (Array.isArray(j?.cards) ? j.cards : []).slice(0, 10).map((c) => {
    const kind = ['cover', 'point', 'verse', 'apply', 'end'].includes(c?.kind) ? c.kind : 'point';
    if (kind === 'cover') return { kind, title: cut(c.title, 40), sub: cut(c.sub, 40) };
    if (kind === 'verse') return { kind, text: cut(c.text, 160), ref: cut(c.ref, 30) };
    if (kind === 'apply') return { kind, title: cut(c.title || '이번 주 실천', 24), items: (Array.isArray(c.items) ? c.items : []).slice(0, 4).map((x) => cut(x, 44)).filter(Boolean) };
    if (kind === 'end') return { kind, text: cut(c.text, 80) };
    return { kind, title: cut(c.title, 30), body: cut(c.body, 130) };
  }).filter((c) => (c.title || c.text || c.body || c.items?.length));
  if (cards.length < 3) throw new Error('AI가 만든 카드가 너무 적습니다. 다시 만들어 주세요.');
  return { mood: MOODS[j.mood] ? j.mood : 'calm', cards };
}
export function cardsPage({ mood, cards }, ctx = {}) {
  const data = JSON.stringify({ pal: MOODS[mood] || MOODS.calm, cards, foot: cut(ctx.church || '', 40), title: cut(ctx.title || '카드뉴스', 60) }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ctx.title || '카드뉴스')} · 카드뉴스</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Noto+Sans+KR:wght@400;700&display=swap">
<style>body{margin:0;background:#f4f2ee;color:#2b2a28;font:16px/1.6 'Noto Sans KR',-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
.w{max-width:1100px;margin:0 auto;padding:20px 16px 50px}h1{font-size:1.3rem;margin:0 0 4px}.muted{color:#777;font-size:.9rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-top:16px}.item{background:#fff;border-radius:12px;padding:10px;box-shadow:0 1px 3px #0001}
canvas{width:100%;height:auto;border-radius:8px;display:block}.row{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:8px}
button{font:inherit;border:1px solid #ccc;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer}button.p{background:#2b2a28;color:#fff;border-color:#2b2a28}
@media print{.row,.top button{display:none}.grid{grid-template-columns:1fr 1fr}}</style></head>
<body><div class="w"><div class="top"><h1>카드뉴스 · 말씀카드</h1><p class="muted">카드마다 '그림으로 저장'을 누르면 1080×1080 그림(PNG)으로 저장됩니다. 인스타그램·카카오톡에 차례대로 올리세요. 글자를 고치려면 '다시 만들기'를 누르세요.</p>
<button class="p" id="all">모두 저장</button></div><div class="grid" id="g"></div></div>
<script>
const D=${data};const P=D.pal,S=1080;
const wrap=(c,t,max)=>{const out=[];let line='';for(const word of String(t).split(/(\\s+)/)){if(!word)continue;const test=line+word;if(c.measureText(test).width<=max){line=test;continue}if(line.trim())out.push(line.trim());line=word.trim();while(c.measureText(line).width>max){let k=line.length;while(k>1&&c.measureText(line.slice(0,k)).width>max)k--;out.push(line.slice(0,k));line=line.slice(k)}}if(line.trim())out.push(line.trim());return out};
const text=(c,t,x,y,size,font,max,lh,align)=>{c.font=font.replace('S',size+'px');c.textAlign=align||'left';const ls=wrap(c,t,max);ls.forEach((l,i)=>c.fillText(l,x,y+i*size*lh));return y+ls.length*size*lh};
const serif='700 S "Gowun Batang", serif',sans='400 S "Noto Sans KR", sans-serif',sansB='700 S "Noto Sans KR", sans-serif';
function draw(cv,card,i,n){const c=cv.getContext('2d');c.fillStyle=P.bg;c.fillRect(0,0,S,S);c.fillStyle=P.accent;c.fillRect(0,0,S,14);
 c.fillStyle=P.ink;c.globalAlpha=.55;c.font=sans.replace('S','30px');c.textAlign='left';c.fillText(D.foot||'',80,S-70);c.textAlign='right';c.fillText((i+1)+' / '+n,S-80,S-70);c.globalAlpha=1;
 if(card.kind==='cover'){c.fillStyle=P.accent;c.fillRect(80,300,90,10);c.fillStyle=P.ink;const y=text(c,card.title,80,420,92,serif,S-160,1.3);c.fillStyle=P.accent;text(c,card.sub||'',80,y+40,40,sansB,S-160,1.4);return}
 if(card.kind==='verse'){c.fillStyle=P.soft;c.fillRect(70,170,S-140,700);c.fillStyle=P.accent;c.font=serif.replace('S','160px');c.textAlign='left';c.fillText('“',100,330);c.fillStyle=P.ink;const y=text(c,card.text,140,400,54,serif,S-280,1.6);c.fillStyle=P.accent;text(c,'— '+(card.ref||''),S-140,Math.min(y+50,840),38,sansB,S-280,1.4,'right');return}
 if(card.kind==='apply'){c.fillStyle=P.accent;text(c,card.title||'이번 주 실천',80,220,64,serif,S-160,1.3);let y=360;(card.items||[]).forEach((it,k)=>{c.fillStyle=P.accent;c.beginPath();c.arc(108,y-16,26,0,7);c.fill();c.fillStyle=P.bg;c.font=sansB.replace('S','30px');c.textAlign='center';c.fillText(String(k+1),108,y-5);c.fillStyle=P.ink;y=text(c,it,160,y,46,sans,S-260,1.45)+50});return}
 if(card.kind==='end'){c.fillStyle=P.ink;text(c,card.text,S/2,470,62,serif,S-200,1.5,'center');c.fillStyle=P.accent;c.fillRect(S/2-45,380,90,8);return}
 c.fillStyle=P.accent;c.font=sansB.replace('S','34px');c.textAlign='left';c.fillText('POINT',80,200);c.fillStyle=P.ink;const y=text(c,card.title,80,300,70,serif,S-160,1.3);text(c,card.body||'',80,y+60,46,sans,S-160,1.6)}
const save=(cv,i)=>{const a=document.createElement('a');a.href=cv.toDataURL('image/png');a.download=(D.title||'카드뉴스').replace(/[\\\\/:*?"<>|]/g,'')+'-'+String(i+1).padStart(2,'0')+'.png';document.body.appendChild(a);a.click();a.remove()};
const cvs=[];function render(){const g=document.getElementById('g');g.innerHTML='';cvs.length=0;D.cards.forEach((card,i)=>{const box=document.createElement('div');box.className='item';const cv=document.createElement('canvas');cv.width=cv.height=S;draw(cv,card,i,D.cards.length);cvs.push(cv);const r=document.createElement('div');r.className='row';const lab=document.createElement('span');lab.className='muted';lab.textContent={cover:'표지',point:'내용',verse:'말씀카드',apply:'실천',end:'마무리'}[card.kind];const b=document.createElement('button');b.textContent='그림으로 저장';b.onclick=()=>save(cv,i);r.append(lab,b);box.append(cv,r);g.append(box)})}
document.getElementById('all').onclick=()=>cvs.forEach((cv,i)=>setTimeout(()=>save(cv,i),i*400));
const fonts=document.fonts?Promise.all([document.fonts.load('700 60px "Gowun Batang"'),document.fonts.load('400 40px "Noto Sans KR"'),document.fonts.load('700 40px "Noto Sans KR"')]):Promise.resolve();
render();Promise.race([fonts,new Promise(r=>setTimeout(r,4000))]).then(render,render);
</script></body></html>`;
}

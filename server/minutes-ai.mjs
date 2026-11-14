// 회의 녹취록 → 회의록 정리 (내용 정리 · 결정 사항 · 해야 할 일). 로그인된 AI 구독(Claude·ChatGPT)으로 만든다.
export function minutesPrompt(ctx) {
  const system = `당신은 한국 교회의 회의록 서기입니다. 회의 녹취록을 읽고 회의록을 정리합니다.

[지켜야 할 것]
- 녹취록에 있는 내용만 씁니다. 없는 결정·숫자·이름·날짜를 지어내지 않습니다.
- 녹취는 음성 인식이라 틀린 글자가 있을 수 있습니다. 문맥상 분명한 것(교회 용어, 직분, 이름)은 바로잡고, 애매한 것은 그대로 두거나 "(확인 필요)"를 붙입니다.
- 결정 사항은 회의에서 실제로 정해진 것만 씁니다. 의견만 나온 것은 내용 정리에 넣습니다.
- 해야 할 일은 누가·무엇을·언제까지를 녹취록에서 찾아 씁니다. 모르면 빈 글자("")로 둡니다.
- 존댓말 회의록 문체(…하기로 함, …보고함)로 씁니다. 한국어로 씁니다.

[출력]
다른 설명 없이 JSON 하나만 출력합니다. 형식:
{"title": "회의 제목(짧게)", "summary": "회의 내용 정리. 안건별로 '1. 안건 이름' 줄 아래 '  - 요점' 줄들. 보고 사항·논의 요지 포함.", "decisions": ["결정 사항 한 줄", "..."], "todos": [{"who": "담당자", "what": "할 일", "when": "기한"}], "attendees": "녹취록에서 확인되는 참석자(없으면 빈 글자)"}`;
  const head = [ctx.church && `교회: ${ctx.church}`, `회의: ${ctx.meeting}`, `날짜: ${ctx.date}`, ctx.attendees && `참석자(입력): ${ctx.attendees}`].filter(Boolean).join('\n');
  return { system, prompt: `${head}\n\n[녹취록]\n${ctx.transcript}` };
}

export function parseMinutesJson(text) {
  const s = String(text).replace(/^```(?:json)?\s*|\s*```\s*$/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('AI가 회의록 형식으로 답하지 않았습니다. 다시 시도해 주세요.');
  const j = JSON.parse(s.slice(a, b + 1));
  const list = (v) => (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const todos = (Array.isArray(j.todos) ? j.todos : []).map((t) => ({ who: String(t?.who ?? '').trim(), what: String(t?.what ?? '').trim(), when: String(t?.when ?? '').trim() })).filter((t) => t.what);
  return {
    title: String(j.title ?? '').trim().slice(0, 100),
    content: String(j.summary ?? '').trim().slice(0, 30000),
    decisions: list(j.decisions).map((x, i) => `${i + 1}. ${x.replace(/^\d+[.)]\s*/, '')}`).join('\n'),
    todos: todos.map((t) => `- ${t.who ? `[${t.who}] ` : ''}${t.what}${t.when ? ` (${t.when})` : ''}`).join('\n'),
    attendees: String(j.attendees ?? '').trim().slice(0, 1000),
  };
}

// 예제 모드: AI·녹취 엔진을 부르지 않고 보여 주는 결과
export const SAMPLE_TRANSCRIPT = `[00:00:05] 그럼 11월 제직회를 시작하겠습니다. 김믿음 장로님께서 기도해 주시겠습니다.
[00:01:40] 지난 회의록은 서기 박소망 집사님이 낭독하셨고 그대로 받기로 하겠습니다.
[00:02:30] 재정 보고 드리겠습니다. 10월 일반재정 수입은 칠백이십만 원, 지출은 이백오십만 원입니다.
[00:04:10] 성탄 발표회는 12월 20일 주일 오후로 하면 어떨까요. 네, 그렇게 하겠습니다.
[00:05:20] 발표회 준비는 이은혜 권사님과 최기쁨 집사님이 맡아 주시고, 12월 6일까지 순서지를 만들어 주세요.
[00:06:45] 교회 난방기 점검은 박소망 집사님이 이번 달 안에 업체에 연락하기로 하겠습니다.
[00:08:00] 내년 예산안은 다음 제직회에서 다시 논의하겠습니다. 마치는 기도는 목사님께서 해 주시겠습니다.`;
export function sampleMinutes() {
  return parseMinutesJson(JSON.stringify({
    title: '11월 정기 제직회 (예제)',
    summary: '1. 개회 기도 (김믿음 장로)\n2. 지난 회의록 낭독 및 채택 (서기 박소망 집사)\n3. 재정 보고\n  - 10월 일반재정 수입 720만 원, 지출 250만 원\n4. 성탄 발표회\n  - 12월 20일 주일 오후로 정함\n5. 난방기 점검\n6. 내년 예산안: 다음 제직회에서 다시 논의\n7. 폐회 기도 (담임목사)',
    decisions: ['성탄 발표회는 12월 20일 주일 오후에 한다.', '난방기 점검을 이번 달 안에 맡긴다.'],
    todos: [{ who: '이은혜 권사, 최기쁨 집사', what: '성탄 발표회 순서지 만들기', when: '12월 6일' }, { who: '박소망 집사', what: '난방기 점검 업체 연락', when: '이번 달 안' }],
    attendees: '',
  }));
}

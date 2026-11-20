// 서버·API 점검: 시험 서버에 실제로 요청을 보내 결과 값을 확인한다.
import fs from 'node:fs';
import path from 'node:path';
import { startHub, runChecks, eq, ok, has, expectStatus, fakeServer, fakeMusicSheet, json, tmpDir, sleep } from './lib.mjs';

const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const R = '/api/ws/real', S = '/api/ws/sample';
const waitFor = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(200); } throw new Error('기다려도 끝나지 않았습니다'); };

export async function runApi() {
  // 가짜 바깥 서비스: GitHub 릴리스, '프로그램' 목록에 나올 가짜 프로그램
  const gh = await fakeServer({ '/latest': json({ tag_name: 'v9.9.9', name: 'v9.9.9', html_url: 'https://example.invalid/r', body: '## 시험\n- 바뀐 것\n### 받기\n| 파일 | 내용 |', assets: [] }) });
  const fakeApp = await fakeServer({ '*': (q, r) => r.end('ok') });
  const appDir = tmpDir('fakeapp');
  const appsFile = path.join(appDir, 'apps.json');
  fs.writeFileSync(appsFile, JSON.stringify([
    // 윈도우에서는 win 설정이 있는 프로그램만 보이므로 둘 다 넣는다
    { id: 'fake', name: '가짜 프로그램', desc: '시험', icon: '🧪', color: '#000', port: fakeApp.port, dir: appDir, start: 'true', win: { dir: appDir, run: ['node', '-e', '0'] } },
    { id: 'gone', name: '없는 프로그램', desc: '시험', icon: '🧪', color: '#000', port: 1, dir: path.join(appDir, 'nope'), start: 'true', win: { dir: path.join(appDir, 'nope'), run: ['node', '-e', '0'] } },
  ]));
  const ms = await fakeMusicSheet();
  // 가짜 제미나이 API: 받은 요청을 적어 두고, mode 가 '429' 면 사용 한도 오류를 돌려준다
  const gem = { mode: 'ok', calls: [] };
  const gemini = await fakeServer({ '*': (q, r) => {
    let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => {
      gem.calls.push({ url: q.url, key: q.headers['x-goog-api-key'], body: JSON.parse(b || '{}') });
      r.setHeader('Content-Type', 'application/json');
      if (gem.mode === '429') { r.statusCode = 429; return r.end(JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).' } })); }
      // 주보 꾸미기 요청이면 CSS 를 돌려준다 (위험한 설정을 일부러 섞어 걸러지는지 본다)
      if (String(gem.calls.at(-1).body.systemInstruction?.parts?.[0]?.text || '').includes('주보 디자이너')) {
        return r.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '이렇게 꾸며 보았습니다.\n```css\n/* 이름: 초록 명조 */\n@import url(https://evil.example/x.css);\n:root{--a:#1d5c3a;--lh:3}\n.church{font-family:\'AppleMyungjo\',serif;color:var(--a)}\nh3{border-bottom:2px double #b8962e;background:url(https://evil.example/t.png)}\nsection[data-b="births"]{display:none}\n.tools{color:red}\n.sheet{position:fixed;font-size:9em}\n```' }] }, finishReason: 'STOP' }] }));
      }
      r.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: `# 주보용 설교 요약\n\n${'제미나이가 쓴 시험 요약 문장입니다. '.repeat(20)}` }] }, finishReason: 'STOP' }] }));
    });
  } });
  const hub = await startHub({ name: 'api', env: { UPDATE_LATEST_URL: `${gh.base}/latest`, HUB_APPS_FILE: appsFile, MUSICSHEET_ORIGIN: ms.base, GEMINI_API_BASE: gemini.base } });
  const { get, post, put, del } = hub;
  const ctx = {};
  // AI 키 바꾸기: 앞의 점검에서 켠 잠금이 남아 있으므로, 잠금을 푼 쪽지(주인)로 바꾼다
  const putKey = (b) => (ctx.fx ? ctx.fx('PUT', '/api/ai/gemini-key', b, ctx.lockCookie) : put('/api/ai/gemini-key', b));
  try {
    return await runChecks('서버·API 점검', [
      ['서버: 켜지면 상태 확인에 버전이 나온다', async () => {
        const h = expectStatus(await get('/api/health'), 200, '상태 확인');
        ok(/^\d+\.\d+\.\d+$/.test(h.version), '버전 모양이 0.0.0 이어야 함', h.version);
      }],
      ['보안: 다른 사이트에서 온 요청과 localhost가 아닌 주소는 막는다', async () => {
        expectStatus(await get(`${R}`, { Origin: 'https://evil.example' }), 403, '다른 사이트 Origin');
        expectStatus(await hub.rawGet(R, { Host: 'evil.example' }), 403, '다른 Host (DNS 재바인딩 막기)');
      }],
      ['교회 정보: 처음엔 비어 있고, 저장하면 이름·목회자·신학 관점이 남는다', async () => {
        eq((await get(R)).data.church ?? null, null, '처음 교회 정보');
        expectStatus(await put(`${R}/church`, { name: '' }), 400, '이름 없이 저장하면 거절');
        await put(`${R}/church`, { name: '시험교회', pastor: '시험 목사', defaultServiceName: '주일 예배', theology: '웨슬리안' });
        const c = (await get(R)).data.church;
        eq([c.name, c.pastor, c.theology], ['시험교회', '시험 목사', '웨슬리안'], '저장된 교회 정보');
      }],
      ['자료 저장: 저장이 한 번 실패해도 원인이 없어지면 [다시 저장]으로 저장되고, 실패와 마지막 저장 시각을 알려 준다', async () => {
        const s0 = expectStatus(await get(`${R}/save-status`), 200, '저장 상태');
        ok(s0.lastSavedAt > 0 && s0.lastError === '', '교회 정보를 저장한 뒤라 저장 시각이 있고 오류가 없어야 함', s0);
        const block = path.join(hub.dataDir, 'real.json.tmp');
        fs.mkdirSync(block);   // 임시 파일 자리에 폴더를 두어 쓰기를 일부러 실패시킴
        try {
          ok((await put(`${R}/church`, { name: '시험교회', pastor: '시험 목사', defaultServiceName: '주일 예배' })).status >= 500, '저장 실패는 오류로 알려야 함');
          const s1 = (await get(`${R}/save-status`)).data;
          ok(s1.lastError, '실패 내용이 있어야 함', s1); eq(s1.lastSavedAt, s0.lastSavedAt, '마지막 저장 시각은 그대로');
        } finally { fs.rmSync(block, { recursive: true, force: true }); }
        const s2 = expectStatus(await post(`${R}/save-status/retry`), 200, '다시 저장');
        eq(s2.lastError, '', '다시 저장한 뒤 오류');
        ok(s2.lastSavedAt > s0.lastSavedAt, '저장 시각이 새로 바뀌어야 함', s2);
        eq(JSON.parse(fs.readFileSync(path.join(hub.dataDir, 'real.json'), 'utf8')).church.name, '시험교회', '파일에 남은 교회 이름');
      }],
      ['이번 주 준비함: 예배를 만들면 목록에 보인다', async () => {
        const r = expectStatus(await post(`${R}/weeks`, { date: today, name: '주일 예배', wcMode: 'none' }), 200, '예배 만들기');
        ctx.week = r.week.id;
        ok((await get(R)).data.weeks.some((w) => w.id === ctx.week), '목록에 새 예배가 있어야 함');
        expectStatus(await post(`${R}/weeks`, { date: '' }), 400, '날짜 없이 만들면 거절');
      }],
      ['예배 정보: 본문·제목·광고·원고를 고치면 저장된다 (예배송출이 꺼져 있어도 먼저 저장)', async () => {
        const r = expectStatus(await put(`${R}/weeks/${ctx.week}`, { passage: '시편 23:1-6', sermonTitle: '목자', announcements: ['광고 하나'], sermonNotes: '짧은 원고' }), 200, '예배 정보 저장');
        ok(r.sync.skipped || r.sync.ok === false, '예배송출과 연결되지 않은 예배는 동기화를 건너뜀', r.sync);
        const w = (await get(`${R}/weeks/${ctx.week}`)).data.week;
        eq([w.passage, w.sermonTitle, w.announcements, w.sermonNotes], ['시편 23:1-6', '목자', ['광고 하나'], '짧은 원고'], '다시 읽은 예배 정보');
      }],
      ['두 창 충돌: 고친 칸만 저장해 다른 칸을 되돌리지 않고, 같은 칸을 다른 창이 먼저 바꿨으면 덮어쓰지 않고 알려 준다', async () => {
        const W = `${R}/weeks/${ctx.week}`;
        const w0 = (await get(W)).data.week;
        expectStatus(await put(W, { sermonTitle: '첫 창 제목', _base: { sermonTitle: w0.sermonTitle } }), 200, '첫 창: 제목');
        expectStatus(await put(W, { announcements: ['둘째 창 광고'], _base: { announcements: w0.announcements } }), 200, '둘째 창: 광고');
        let w = (await get(W)).data.week;
        eq([w.sermonTitle, w.announcements], ['첫 창 제목', ['둘째 창 광고']], '두 창에서 고친 칸이 모두 남음');
        const c = await put(W, { sermonTitle: '둘째 창 제목', _base: { sermonTitle: w0.sermonTitle } });
        eq(c.status, 409, '같은 칸을 옛 값 기준으로 고치면 충돌');
        eq(c.data.conflicts?.map((x) => [x.field, x.label, x.theirs]), [['sermonTitle', '설교 제목', '첫 창 제목']], '충돌한 칸과 다른 창의 값');
        eq((await get(W)).data.week.sermonTitle, '첫 창 제목', '충돌하면 덮어쓰지 않음');
        expectStatus(await put(W, { sermonTitle: '둘째 창 제목', _base: { sermonTitle: '첫 창 제목' } }), 200, '새 값을 보고 다시 저장하면 됨');
        expectStatus(await put(W, { sermonTitle: '둘째 창 제목', _base: { sermonTitle: '아주 옛 제목' } }), 200, '이미 같은 값이면 충돌 아님');
        expectStatus(await put(W, { passage: '시편 23:1-6', sermonTitle: '목자', announcements: ['광고 하나'] }), 200, '_base 없이 보내면 예전처럼 저장');
      }],
      ['설교 후 자료: 실제 자료에서 원고가 300자보다 짧으면 만들지 않는다', async () => {
        const r = await post(`${R}/weeks/${ctx.week}/after/summary`, {});
        eq(r.status, 400, '짧은 원고로 만들기');
        has(r.data.error, '300자', '안내 문구');
      }],
      ['예제: 예제 자료가 준비되어 있다 (교회·예배·성도·재정·봉사표)', async () => {
        const o = (await get(S)).data;
        ok(o.church?.name && o.weeks.length > 0, '예제 교회·예배', o.church);
        ok((await get(`${S}/people`)).data.members.length >= 5, '예제 성도');
        ok((await get(`${S}/finance`)).data.tx.length > 0, '예제 장부');
        ok((await get(`${S}/admin`)).data.serve.roles.length > 0, '예제 봉사표');
        ctx.sw = o.weeks.find((w) => w.wc?.serviceId)?.id;
        ok(ctx.sw, '예배송출과 연결된 예제 예배');
      }],
      ['찬양 자료(예제): 곡 목록이 나오고 작사·작곡 메모가 저장된다', async () => {
        const r = (await get(`${S}/songs`)).data;
        ok(r.ok && r.songs.length > 0, '곡 목록', r);
        ctx.song = r.songs[0].id;
        await put(`${S}/songs/${ctx.song}/meta`, { writer: '시험 작곡가', source: '시험 출처', distinguish: '' });
        eq((await get(`${S}/songs`)).data.songs.find((s) => s.id === ctx.song).meta.writer, '시험 작곡가', '저장된 작사·작곡');
      }],
      ['콘티(예제): 곡 넣기·조성·순서 바꾸기·빼기', async () => {
        const songsOf = (st) => st.summary.items.filter((i) => i.type === 'song' || i.type === 'score');
        const before = songsOf((await get(`${S}/weeks/${ctx.sw}`)).data.status);
        const candidate = (await get(`${S}/songs`)).data.songs.find((s) => !before.some((b) => b.id === s.id));
        ok(candidate, '넣을 곡');
        let st = expectStatus(await post(`${S}/weeks/${ctx.sw}/setlist`, { op: 'add', itemId: candidate.id }), 200, '곡 넣기');
        ok(songsOf(st).some((s) => s.id === candidate.id), '콘티에 넣은 곡이 있어야 함', songsOf(st).map((s) => s.title));
        st = (await post(`${S}/weeks/${ctx.sw}/setlist`, { op: 'item', itemId: candidate.id, key: 'G' })).data;
        eq(songsOf(st).find((s) => s.id === candidate.id).key, 'G', '조성');
        const order = songsOf(st).map((s) => s.id);
        st = (await post(`${S}/weeks/${ctx.sw}/setlist`, { op: 'move', itemId: candidate.id, dir: -1, songsOnly: true })).data;
        if (order.length > 1) ok(songsOf(st).map((s) => s.id).indexOf(candidate.id) === order.indexOf(candidate.id) - 1, '한 칸 위로', songsOf(st).map((s) => s.title));
        st = (await post(`${S}/weeks/${ctx.sw}/setlist`, { op: 'remove', itemId: candidate.id })).data;
        ok(!songsOf(st).some((s) => s.id === candidate.id), '뺀 곡은 없어야 함');
      }],
      ['자막 확정(예제): 확정본을 떠 두고, 바뀐 뒤 확정본으로 되돌린다', async () => {
        const f = expectStatus(await post(`${S}/weeks/${ctx.sw}/finalize`, {}), 200, '확정');
        ok(f.week.final?.snap?.items?.length > 0, '확정본 자료');
        const song = f.week.final.snap.items.find((i) => i.type === 'song');
        ok(song, '확정본 안의 곡');
        await post(`${S}/weeks/${ctx.sw}/setlist`, { op: 'item', itemId: song.id, key: 'Bb' });
        const changed = (await get(`${S}/weeks/${ctx.sw}`)).data.status;
        ok(changed.final && changed.final.changed !== false, '확정 뒤 바뀐 것을 알아야 함', changed.final);
        const r = expectStatus(await post(`${S}/weeks/${ctx.sw}/restore`, {}), 200, '확정본으로 되돌리기');
        eq(r.week.final.snap.items.find((i) => i.id === song.id)?.key ?? song.key, song.key, '되돌린 조성');
      }],
      ['설교 후 자료(예제): 9가지를 모두 만들고, 웹페이지는 따로 떨어진 상자(sandbox)로 연다', async () => {
        const st0 = (await get(`${S}/weeks/${ctx.sw}/after`)).data;
        const kinds = ['infographic', 'cards', 'summary', 'blog', 'sg-adult', 'sg-youth', 'qt', 'family', 'review'];
        ok(st0.ai?.provider === 'sample', '예제는 AI를 부르지 않음', st0.ai);
        for (const k of kinds) expectStatus(await post(`${S}/weeks/${ctx.sw}/after/${k}`, {}), 200, `${k} 만들기`);
        const done = await waitFor(async () => { const s = (await get(`${S}/weeks/${ctx.sw}/after`)).data; return kinds.every((k) => s.docs[k]) && !Object.keys(s.running).length ? s : null; }, 40000);
        eq(kinds.filter((k) => !done.docs[k]), [], '만들어지지 않은 자료');
        const v = await get(`${S}/weeks/${ctx.sw}/after/cards/view`);
        has(v.headers.get('content-security-policy'), 'sandbox', '웹페이지 보안 머리글');
        has(v.headers.get('content-security-policy'), 'allow-downloads', '카드 그림 저장 허용');
        has(v.data, "createElement('canvas')", '카드뉴스 그림 그리기');
        has((await get(`${S}/weeks/${ctx.sw}/after/summary/view`)).data, '# 주보용 설교 요약', '주보 요약 글');
        expectStatus(await post(`${S}/weeks/${ctx.sw}/after/shorts`, {}), 404, '빼기로 한 쇼츠 대본은 없음');
      }],
      ['성도: 추가·고치기·가족 묶기·지우기', async () => {
        const a = expectStatus(await post(`${R}/members`, { name: '김시험', birth: '1970-05-05', phone: '010-0000-0000', baptism: '세례', address: '시험시 1' }), 200, '성도 추가').member;
        const b = (await post(`${R}/members`, { name: '이시험', familyWith: a.id, relation: '배우자' })).data.member;
        const p = (await get(`${R}/people`)).data;
        eq(p.members.find((m) => m.id === a.id).familyId === p.members.find((m) => m.id === b.id).familyId && !!p.members.find((m) => m.id === b.id).familyId, true, '같은 가족으로 묶임');
        await put(`${R}/members/${a.id}`, { ...p.members.find((m) => m.id === a.id), role: '집사' });
        eq((await get(`${R}/people`)).data.members.find((m) => m.id === a.id).role, '집사', '고친 직분');
        expectStatus(await post(`${R}/members`, { name: '' }), 400, '이름 없이 추가하면 거절');
        ctx.kim = a.id; ctx.lee = b.id;
      }],
      ['성도: 엑셀에서 붙여 넣은 여러 분을 한 번에 (같은 가족 글자는 한 가족)', async () => {
        const r = expectStatus(await post(`${R}/members/bulk`, { rows: [{ name: '박하나', family: '박' }, { name: '박둘', family: '박' }, { name: '' }] }), 200, '여러 명 넣기');
        eq(r.added, 2, '넣은 수');
        const ms = (await get(`${R}/people`)).data.members.filter((m) => m.name.startsWith('박'));
        eq(ms[0].familyId && ms[0].familyId === ms[1].familyId, true, '한 가족');
      }],
      ['심방: 다녀온 기록과 예정을 넣고 지운다', async () => {
        const v = expectStatus(await post(`${R}/visits`, { memberIds: [ctx.kim], date: today, kind: '심방', planned: true, note: '시험 심방' }), 200, '심방 넣기');
        const id = v.visit?.id || v.item?.id || (await get(`${R}/people`)).data.visits[0].id;
        ok((await get(`${R}/people`)).data.visits.some((x) => x.id === id && x.planned), '예정 심방');
        await del(`${R}/visits/${id}`);
        ok(!(await get(`${R}/people`)).data.visits.some((x) => x.id === id), '지운 심방은 없어야 함');
      }],
      ['출석: 날짜별로 저장하고, 아무도 없으면 그날 기록을 없앤다', async () => {
        await put(`${R}/attendance/${today}`, { memberIds: [ctx.kim, 'no-such-id'] });
        eq((await get(`${R}/people`)).data.attendance[today], [ctx.kim], '저장된 출석 (없는 번호는 뺌)');
        await put(`${R}/attendance/${today}`, { memberIds: [] });
        eq((await get(`${R}/people`)).data.attendance[today] ?? null, null, '빈 날 기록');
      }],
      ['성도 명부 CSV: 한글이 깨지지 않게(BOM) 하고, = 로 시작하는 칸은 수식으로 실행되지 않게 막는다', async () => {
        await post(`${R}/members`, { name: '=HYPERLINK("x")' });
        const t = (await get(`${R}/people/export.csv`)).data;
        eq(t.charCodeAt(0), 0xfeff, '첫 글자 BOM');
        has(t, `'=HYPERLINK`, '수식 막기');
      }],
      ['재정: 여러 줄 입력·고치기·지우기, 이름이 하나뿐인 성도와 이어진다', async () => {
        const r = expectStatus(await post(`${R}/finance/tx`, { rows: [
          { date: today, type: 'income', fund: '일반재정', category: '십일조', name: '김시험', amount: '100,000' },
          { date: today, type: 'expense', fund: '일반재정', category: '시험지출', amount: 5000 },
        ] }), 200, '장부 입력');
        eq(r.added.length, 2, '넣은 줄 수');
        eq(r.added[0].memberId, ctx.kim, '성도와 이어짐');
        eq(r.added[0].amount, 100000, '금액 숫자로');
        expectStatus(await post(`${R}/finance/tx`, { rows: [{ date: today, category: '십일조', amount: 0 }] }), 400, '0원은 거절');
        const id = r.added[1].id;
        await put(`${R}/finance/tx/${id}`, { ...r.added[1], amount: 7000 });
        eq((await get(`${R}/finance`)).data.tx.find((t) => t.id === id).amount, 7000, '고친 금액');
        await del(`${R}/finance/tx/${id}`);
        ok(!(await get(`${R}/finance`)).data.tx.some((t) => t.id === id), '지운 기록은 없어야 함');
      }],
      ['재정: 항목 추가·이름 바꾸기 (이미 적은 장부도 함께 바뀜)', async () => {
        await post(`${R}/finance/category`, { op: 'add', type: 'income', fund: '일반재정', name: '시험헌금' });
        await post(`${R}/finance/tx`, { rows: [{ date: today, type: 'income', fund: '일반재정', category: '시험헌금', amount: 1000 }] });
        const r = (await post(`${R}/finance/category`, { op: 'rename', type: 'income', fund: '일반재정', name: '시험헌금', to: '바뀐헌금' })).data;
        eq(r.count, 1, '함께 바뀐 장부 수');
        ok(r.settings.categories.income['일반재정'].includes('바뀐헌금'), '바뀐 항목 이름');
      }],
      ['재정: 예산 저장, CSV 내보내기, 예전 회계장부를 두 번 가져와도 겹치지 않는다', async () => {
        const y = today.slice(0, 4);
        eq((await put(`${R}/finance/budgets/${y}`, { budgets: { 십일조: '1,000,000', 빈칸: 0 } })).data.budgets, { 십일조: 1000000 }, '저장된 예산');
        eq((await get(`${R}/finance/export.csv?year=${y}`)).data.charCodeAt(0), 0xfeff, 'CSV BOM');
        const ledger = { transactions: [{ id: 1, date: today, type: 'income', category: '감사헌금', amount: 30000, name: '이시험' }], budgets: {} };
        const a = (await post(`${R}/finance/import`, ledger)).data, b = (await post(`${R}/finance/import`, ledger)).data;
        eq([a.added, b.added], [1, 0], '두 번 가져온 결과 (처음 1, 두 번째 0)');
      }],
      ['일정: 추가·고치기·지우기, 구글 캘린더용 .ics 내보내기', async () => {
        const e = expectStatus(await post(`${R}/events`, { date: today, title: '시험 일정', kind: '행사', time: '10:00' }), 200, '일정 추가').item;
        await put(`${R}/events/${e.id}`, { ...e, title: '바뀐 일정' });
        eq((await get(`${R}/admin`)).data.events.find((x) => x.id === e.id).title, '바뀐 일정', '고친 일정');
        const ics = (await get(`${R}/events.ics`)).data;
        has(ics, 'BEGIN:VCALENDAR', 'ics 머리');
        has(ics, `${e.id}@church-allinone`, '일정 고유 번호');
        await del(`${R}/events/${e.id}`);
        ok(!(await get(`${R}/admin`)).data.events.some((x) => x.id === e.id), '지운 일정은 없어야 함');
        expectStatus(await post(`${R}/events`, { title: '날짜 없음' }), 400, '날짜 없이 추가하면 거절');
      }],
      ['구글 캘린더: 구글 캘린더 주소가 아니면 받지 않는다', async () => {
        for (const url of ['http://calendar.google.com/x.ics', 'https://evil.example/x.ics', 'https://calendar.google.com:8443/x.ics', 'https://calendar.google.com/x.txt']) {
          expectStatus(await post(`${R}/gcals`, { url }), 400, `거절해야 할 주소 ${url}`);
        }
      }],
      ['회의록: 쓰기·고치기, 새 회의 이름은 목록에 저절로 더해진다', async () => {
        const m = expectStatus(await post(`${R}/minutes`, { date: today, meeting: '시험모임', title: '1차', content: '내용' }), 200, '회의록 쓰기').item;
        ok((await get(`${R}/admin`)).data.meetingTypes.includes('시험모임'), '회의 이름 목록');
        await put(`${R}/minutes/${m.id}`, { ...m, decisions: '결정 1' });
        eq((await get(`${R}/admin`)).data.minutes.find((x) => x.id === m.id).decisions, '결정 1', '고친 결정 사항');
        await post(`${R}/meeting-types`, { op: 'rename', name: '시험모임', to: '바뀐모임' });
        eq((await get(`${R}/admin`)).data.minutes.find((x) => x.id === m.id).meeting, '바뀐모임', '회의 이름 바꾸면 회의록도');
      }],
      ['회의록(예제): 녹취와 AI 정리 예제가 채워진다', async () => {
        const m = (await post(`${S}/minutes`, { date: today, meeting: '제직회', title: '예제 녹취' })).data.item;
        await post(`${S}/minutes/${m.id}/transcribe`, { auto: true });
        const done = await waitFor(async () => { const x = (await get(`${S}/admin`)).data.minutes.find((y) => y.id === m.id); return x?.transcript && x?.decisions ? x : null; }, 20000);
        ok(done.transcript.length > 50 && done.decisions.length > 5, '녹취록과 결정 사항', { t: done.transcript.length, d: done.decisions });
      }],
      ['녹취 준비: 엔진·모델 상태를 알려 준다', async () => {
        const st = expectStatus(await get(`${R}/stt`), 200, '녹취 상태');
        const s = st.stt || st;
        ok(s.models && Object.keys(s.models).length >= 2, '모델 목록', s);
      }],
      ['증명서: 번호가 연도-순번으로 매겨지고, 세례 기록 없이 세례증명서는 거절', async () => {
        const c1 = expectStatus(await post(`${R}/certs`, { type: '교인증명서', memberId: ctx.kim }), 200, '교인증명서').cert;
        const c2 = (await post(`${R}/certs`, { type: '세례증명서', memberId: ctx.kim })).data.cert;
        eq([c1.no, c2.no], [`${today.slice(0, 4)}-001`, `${today.slice(0, 4)}-002`], '증명서 번호');
        expectStatus(await post(`${R}/certs`, { type: '세례증명서', memberId: ctx.lee }), 400, '세례 기록 없는 분');
      }],
      ['봉사 배정표: 봉사 종류·배정 저장, 지운 봉사의 배정도 정리', async () => {
        const roles = (await get(`${R}/admin`)).data.serve.roles;
        eq(roles.map((r) => r.name).slice(0, 3), ['대표기도', '안내', '헌금위원'], '기본 봉사 종류');
        await put(`${R}/serve/roles`, { roles: [{ ...roles[0], pool: [ctx.kim, 'nope'] }, roles[1]] });
        eq((await get(`${R}/admin`)).data.serve.roles[0].pool, [ctx.kim], '맡는 분 (없는 번호는 뺌)');
        await put(`${R}/serve/plan`, { dates: { [today]: { [roles[0].id]: [ctx.kim], [roles[1].id]: ['명부 밖 분'] } } });
        eq((await get(`${R}/admin`)).data.serve.plan[today], { [roles[0].id]: [ctx.kim], [roles[1].id]: ['명부 밖 분'] }, '저장된 배정');
        await put(`${R}/serve/roles`, { roles: [roles[0]] });
        eq(Object.keys((await get(`${R}/admin`)).data.serve.plan[today]), [roles[0].id], '지운 봉사의 배정');
      }],
      ['성도 지우기: 지우면 출석에서 빠지고 봉사표에는 이름으로 남는다', async () => {
        await put(`${R}/attendance/${today}`, { memberIds: [ctx.kim, ctx.lee] });
        await del(`${R}/members/${ctx.kim}`);
        const p = (await get(`${R}/people`)).data, a = (await get(`${R}/admin`)).data;
        eq(p.attendance[today], [ctx.lee], '출석에서 빠짐');
        ok(Object.values(a.serve.plan[today]).flat().includes('김시험'), '봉사표에는 이름 글자로', a.serve.plan[today]);
      }],
      ['녹음 조각: 30초 조각을 순서대로 이어 붙이고, 같은 조각을 다시 보내도 한 번만, 순서가 틀리면 거절', async () => {
        const m = (await post(`${R}/minutes`, { date: today, meeting: '당회', title: '조각 시험' })).data.item;
        ctx.recM = m.id;
        const piece = (sec) => Buffer.alloc(32000 * sec, 1);   // 16kHz·16비트·모노 = 1초에 32000바이트
        eq((await hub.postRaw(`${R}/minutes/${m.id}/rec?seq=0`, piece(2))).data.recording.seconds, 2, '첫 조각 뒤 저장 길이(초)');
        eq((await hub.postRaw(`${R}/minutes/${m.id}/rec?seq=0`, piece(2))).data.duplicate, true, '같은 조각 다시 보냄');
        expectStatus(await hub.postRaw(`${R}/minutes/${m.id}/rec?seq=5`, piece(1)), 409, '순서가 건너뛴 조각');
        expectStatus(await hub.postRaw(`${R}/minutes/${m.id}/rec?seq=1`, Buffer.alloc(3)), 400, '홀수 바이트 조각');
        eq((await hub.postRaw(`${R}/minutes/${m.id}/rec?seq=1`, piece(3))).data.recording.seconds, 5, '두 조각 뒤 저장 길이(초)');
        eq((await get(`${R}/admin`)).data.minutes.find((x) => x.id === m.id).recording.seconds, 5, '창이 닫혀도 회의록에 남은 저장 길이');
      }],
      ['녹음 마무리: 이어 붙인 조각이 재생되는 wav 가 되고, 녹음 중 표시는 사라진다', async () => {
        const r = expectStatus(await post(`${R}/minutes/${ctx.recM}/rec/finish`, {}), 200, '마무리');
        eq([r.seconds, r.audio.size], [5, 5 * 32000 + 44], '녹음 길이·파일 크기');
        const wav = await fetch(`${hub.base}${R}/minutes/${ctx.recM}/audio`).then((x) => x.arrayBuffer()).then((b) => Buffer.from(b));
        eq([wav.toString('ascii', 0, 4), wav.toString('ascii', 8, 12), wav.readUInt32LE(24), wav.readUInt32LE(40)], ['RIFF', 'WAVE', 16000, 160000], 'wav 머리 (16kHz, 소리 길이)');
        const m = (await get(`${R}/admin`)).data.minutes.find((x) => x.id === ctx.recM);
        eq([!!m.recording, m.audio?.name.endsWith('녹음.wav')], [false, true], '녹음 중 표시·녹음 파일');
        expectStatus(await post(`${R}/minutes/${ctx.recM}/rec/finish`, {}), 400, '저장된 조각이 없으면 마무리 거절');
      }],
      ['회의록 지우기: 녹음하던 조각 파일도 함께 지운다', async () => {
        const m = (await post(`${R}/minutes`, { date: today, meeting: '당회', title: '지울 녹음' })).data.item;
        await hub.postRaw(`${R}/minutes/${m.id}/rec?seq=0`, Buffer.alloc(32000, 1));
        const pcm = path.join(hub.dataDir, 'recordings', 'real', `${m.id}.rec.pcm`);
        ok(fs.existsSync(pcm), '조각 파일이 있어야 함');
        await del(`${R}/minutes/${m.id}`);
        ok(!fs.existsSync(pcm), '지운 뒤 조각 파일이 없어야 함');
      }],
      ['백업: 바깥 폴더를 정하면 바로 백업하고, 백업 파일(zip)을 받고, 날짜 백업으로 되살린다', async () => {
        const ext = tmpDir('ext-backup');
        try {
          expectStatus(await put('/api/backup/settings', { dir: 'relative/path' }), 400, '상대 경로 거절');
          const v = expectStatus(await put('/api/backup/settings', { dir: ext }), 200, '바깥 폴더 정하기');
          eq([v.dir, v.result.ok, v.lastError], [ext, true, ''], '정한 뒤 상태');
          ok(fs.readdirSync(path.join(ext, '라온교회올인원-백업')).some((f) => /^real-\d{4}-\d{2}-\d{2}\.json$/.test(f)), '바깥 폴더에 자료 백업');
          ok(fs.existsSync(path.join(ext, '라온교회올인원-백업', 'recordings', `${ctx.recM}.wav`)), '바깥 폴더에 녹음');
          const z = await fetch(`${hub.base}/api/backup/download`);
          eq([z.status, z.headers.get('content-type')], [200, 'application/zip'], '백업 파일 받기');
          const zip = Buffer.from(await z.arrayBuffer());
          eq(zip.readUInt32LE(0), 0x04034b50, 'zip 모양');
          const local = (await get('/api/backup')).data.local.find((b) => b.file.startsWith('real-'));
          ok(local, '이 컴퓨터 안 날짜 백업', (await get('/api/backup')).data.local);
          const before = (await get(R)).data.church.name;
          const r = expectStatus(await post('/api/backup/restore-local', { file: local.file }), 200, '날짜 백업으로 되살리기');
          ok(r.kept.startsWith('before-restore-'), '되살리기 직전 자료를 남김', r);
          expectStatus(await post('/api/backup/restore-local', { file: '../../etc/passwd' }), 404, '백업 폴더 밖 파일 거절');
          // 받은 zip 으로 다시 되살리면 원래대로
          const r2 = expectStatus(await hub.postRaw('/api/backup/restore', zip, { 'X-File-Name': 'backup.zip' }), 200, 'zip 으로 되살리기');
          eq(r2.church, before, '되살린 교회 이름');
          expectStatus(await hub.postRaw('/api/backup/restore', Buffer.from('{"a":1}'), { 'X-File-Name': 'x.json' }), 400, '올인원 자료가 아닌 파일 거절');
          const noName = await hub.postRaw('/api/backup/restore', zip, {});
          eq(noName.status, 400, '파일 이름 머리글 없는 되살리기 거절 (다른 곳에서 몰래 보내기 막기)');
          eq((await get(R)).data.church.name, before, '거절한 뒤 자료 그대로');
          await put('/api/backup/settings', { dir: '' });
        } finally { fs.rmSync(ext, { recursive: true, force: true }); }
      }],
      ['주보: 고정 정보와 이번 주 자료(예배 순서·본문·광고·봉사·일정)가 들어가고, 생일은 켰을 때만 나온다', async () => {
        const wk = (await get(S)).data.weeks.find((w) => w.wc?.serviceId);
        eq((await get(`${S}/bulletin`)).data.showBirthdays, false, '생일은 처음에 꺼져 있음');
        await put(`${S}/bulletin`, { address: '시험시 시험로 1', worshipTimes: '주일 예배 오전 11시', account: '시험은행 1-2-3', motto: '시험 표어' });
        const html = expectStatus(await get(`${S}/weeks/${wk.id}/bulletin?format=print`), 200, '인쇄용 주보');
        for (const t of ['예제교회', '시험 표어', '예배 순서', '시편 23', '교회 소식', '섬기는 분들', '시험시 시험로 1', '주일 예배 오전 11시', '시험은행 1-2-3']) has(html, t, `주보에 "${t}"`);
        ok(!html.includes('생일을 축하합니다'), '생일 칸이 없어야 함');
        ok(!/목사 목사/.test(html), '목사 호칭이 겹치지 않아야 함');
        await put(`${S}/bulletin`, { ...(await get(`${S}/bulletin`)).data, showBirthdays: true, showServe: false });
        const h2 = (await get(`${S}/weeks/${wk.id}/bulletin?format=mobile&download=1`));
        has(h2.data, '생일을 축하합니다', '생일을 켜면 생일 칸');
        ok(!h2.data.includes('섬기는 분들'), '봉사 칸을 끄면 없어야 함');
        has(h2.headers.get('content-disposition'), 'attachment', '휴대폰 주보는 파일로 받기');
        has(h2.data, 'name="viewport"', '휴대폰 화면 맞춤');
      }],
      ['접는 4면 주보: 바깥쪽에 4면·표지(1면), 안쪽에 2면(예배 순서·말씀)·3면(설교 요약·교회 소식)이 순서대로 들어간다', async () => {
        const wk = (await get(S)).data.weeks.find((w) => w.wc?.serviceId);
        await put(`${S}/bulletin`, { ...(await get(`${S}/bulletin`)).data, showServe: true, showOrder: true });   // 앞 점검이 꺼 둔 칸을 다시 켬
        const html = expectStatus(await get(`${S}/weeks/${wk.id}/bulletin?format=fold4`), 200, '접는 4면 주보');
        const outside = html.slice(html.indexOf('class="sheet outside"'), html.indexOf('class="sheet inside"'));
        const inside = html.slice(html.indexOf('class="sheet inside"'));
        ok(outside && inside, '바깥쪽·안쪽 두 쪽');
        ok(outside.indexOf('섬기는 분들') >= 0 && outside.indexOf('섬기는 분들') < outside.indexOf('class="cover"'), '바깥쪽: 왼쪽 4면(봉사) → 오른쪽 1면(표지)');
        has(outside, '예제교회', '표지에 교회 이름');
        ok(inside.indexOf('예배 순서') >= 0 && inside.indexOf('예배 순서') < inside.indexOf('교회 소식'), '안쪽: 왼쪽 2면(예배 순서) → 오른쪽 3면(교회 소식)');
        has(html, '짧은 쪽으로 넘기기', '양면 인쇄 안내');
        const two = (await get(`${S}/weeks/${wk.id}/bulletin?format=print`)).data;
        ok(!two.includes('sheet outside'), '2단 양식은 그대로 한 쪽');
      }],
      ['주보: 적은 글에 태그가 있어도 실행되지 않고 글자로 나온다 (보안)', async () => {
        await put(`${R}/weeks/${ctx.week}`, { announcements: ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>'] });
        const r = await get(`${R}/weeks/${ctx.week}/bulletin`);
        ok(!r.data.includes('<script>alert') && !r.data.includes('<img src=x'), '태그가 그대로 들어가면 안 됨');
        has(r.data, '&lt;script&gt;alert(1)&lt;/script&gt;', '글자로 바뀐 태그');
        has(r.headers.get('content-security-policy'), "default-src 'none'", '주보 보안 머리글');
      }],
      ['주보 편집: 칸 순서·자리(2단·4면)·켜기/끄기는 배치로 남고, 이번 주 글 고치기·작게·되돌리기는 그 주에만 (원래 자료는 그대로)', async () => {
        const wk = (await get(S)).data.weeks.find((w) => w.wc?.serviceId);
        const B = `${S}/weeks/${wk.id}/bulletin`;
        let e = expectStatus(await get(`${B}/blocks`), 200, '편집 창 자료');
        eq(e.blocks.map((b) => b.id), ['order', 'sermon', 'summary', 'ann', 'photo', 'serve', 'events', 'births', 'info'], '주보 칸 (사진·포스터 칸은 그림을 넣을 때만 나옴)');
        eq(e.blocks.find((b) => b.id === 'ann').auto, (wk.announcements || []).join('\n'), '교회 소식 자동 내용 = 이번 주 광고');
        eq(e.settings.layout.map((x) => `${x.id}:${x.col}${x.face}`).join(' '), 'order:L2 sermon:L2 summary:L3 ann:R3 photo:R3 serve:R4 events:R4 births:R4 info:R4', '처음 배치는 지금까지의 주보 모양 + 교회 소식 뒤에 사진 칸');
        const pos = (h, a, b) => h.indexOf(a) >= 0 && h.indexOf(b) >= 0 && h.indexOf(a) < h.indexOf(b);
        const faceOf = (h, t) => { const i = h.indexOf(`<h3>${t}</h3>`); const m = [...h.slice(0, i).matchAll(/<p class="fno">(\d)<\/p>/g)].pop(); return i < 0 ? null : m?.[1]; };
        // 교회 소식을 맨 앞·왼쪽·2면으로, 설교 요약 끄기
        const layout = e.settings.layout.map((x) => (x.id === 'ann' ? { ...x, col: 'L', face: 2 } : x.id === 'summary' ? { ...x, on: false } : x));
        layout.unshift(...layout.splice(layout.findIndex((x) => x.id === 'ann'), 1));
        expectStatus(await put(`${S}/bulletin`, { ...e.settings, layout, showSummary: false }), 200, '배치 저장');
        let h = (await get(`${B}?format=print`)).data;
        ok(pos(h, '<h3>교회 소식</h3>', '<h3>예배 순서</h3>'), '2단: 교회 소식이 예배 순서보다 앞', h.slice(0, 0));
        ok(!h.includes('<h3>설교 요약</h3>'), '끈 칸은 빠짐');
        eq(faceOf((await get(`${B}?format=fold4`)).data, '교회 소식'), '2', '4면: 교회 소식이 2면에');
        eq((await get(`${S}/bulletin`)).data.layout[0].id, 'ann', '배치는 다시 열어도 그대로');
        // 이번 주 글 고치기
        e = expectStatus(await put(`${B}/blocks`, { id: 'ann', text: '고친 광고 하나\n고친 광고 둘', size: 's' }), 200, '이번 주 글 저장');
        eq(e.blocks.find((b) => b.id === 'ann').text, '고친 광고 하나\n고친 광고 둘', '저장된 이번 주 글');
        h = (await get(`${B}?format=print`)).data;
        ok(h.includes('<li>고친 광고 하나</li><li>고친 광고 둘</li>') && h.includes('<section data-b="ann" class="sm"><h3>교회 소식</h3>'), '주보에 고친 글이 한 줄씩, 작은 글자로', h.slice(h.indexOf('교회 소식') - 30, h.indexOf('교회 소식') + 120));
        for (const a of wk.announcements || []) ok(!h.includes(a) || ['고친 광고 하나', '고친 광고 둘'].includes(a), '원래 광고는 이번 주 주보에서 빠짐', a);
        eq((await get(`${S}/weeks/${wk.id}`)).data.week.announcements, wk.announcements, '원래 광고 자료는 그대로');
        await put(`${B}/blocks`, { id: 'order', text: '<b>태그</b>' });
        h = (await get(`${B}?format=print`)).data;
        ok(h.includes('&lt;b&gt;태그&lt;/b&gt;') && !h.includes('<b>태그'), '고친 글의 태그는 글자로 (보안)');
        await put(`${B}/blocks`, { id: 'order', text: '' });
        ok(!(await get(`${B}?format=print`)).data.includes('<h3>예배 순서</h3>'), '비워 두면 이번 주에는 그 칸을 넣지 않음');
        // 되돌리기
        await put(`${B}/blocks`, { id: 'order', text: null });
        e = expectStatus(await put(`${B}/blocks`, { id: 'ann', text: null }), 200, '자동 내용으로 되돌리기');
        eq([e.blocks.find((b) => b.id === 'ann').text, e.blocks.find((b) => b.id === 'ann').size], [null, 'n'], '되돌린 뒤 교회 소식');
        h = (await get(`${B}?format=print`)).data;
        ok(!h.includes('고친 광고 하나') && h.includes('<h3>예배 순서</h3>'), '되돌리면 자동 내용으로');
        expectStatus(await put(`${B}/blocks`, { id: 'nope', text: 'x' }), 400, '없는 칸');
        // 다른 예배에는 고친 글이 없다
        const other = (await get(S)).data.weeks.find((w) => w.id !== wk.id);
        if (other) eq((await get(`${S}/weeks/${other.id}/bulletin/blocks`)).data.blocks.filter((b) => b.text !== null).length, 0, '다른 예배의 고친 칸');
        await put(`${S}/bulletin`, { ...e.settings, layout: null, showSummary: true });   // 다음 점검을 위해 처음 배치로
        eq((await get(`${S}/bulletin`)).data.layout.map((x) => x.id)[0], 'order', '처음 배치로 되돌림');
      }],
      ['프로그램 목록: 설치·켜짐 상태를 보여 준다 (가짜 프로그램)', async () => {
        const apps = (await get('/api/apps')).data;
        eq(apps.map((a) => [a.id, a.installed, a.running]), [['fake', true, true], ['gone', false, false]], '프로그램 상태');
      }],
      ['업데이트: 새 버전을 알리고, 받기 표 앞까지만 보여 주고, 미루면 하루 동안 조용 (가짜 GitHub)', async () => {
        const v = (await get('/api/update?force=1')).data;
        eq([v.available, v.latest?.version, v.installable], [true, '9.9.9', false], '새 버전 (자동 설치 묶음 없음)');
        eq(v.latest.notes, '## 시험\n- 바뀐 것', '업데이트 내용');
        eq((await post('/api/update/snooze', { version: '9.9.9' })).data.snoozed, true, '나중에');
        eq((await put('/api/update/settings', { notify: false })).data.notify, false, '알림 끄기');
        expectStatus(await post('/api/update/install', {}), 200, '설치 요청');
        const j = await waitFor(async () => { const x = (await get('/api/update')).data.job; return x.phase === 'error' ? x : null; });
        has(j.error, '자동 설치 묶음이 없습니다', '묶음 없는 릴리스는 설치하지 않음');
      }],
      ['자동 백업: 저장하면 backups 폴더에 오늘 백업이 생긴다', async () => {
        const files = fs.readdirSync(path.join(hub.dataDir, 'backups'));
        ok(files.some((f) => f.startsWith('real-')), 'real 백업 파일', files);
      }],
      ['잠금: 켜면 성도·재정·행정 자료는 암호 없이 안 보이고(주소를 직접 쳐도), 예배 자료와 예제는 그대로 보인다', async () => {
        const fx = async (method, p, body, cookie = '') => { const r = await fetch(hub.base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => null), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
        const on = await fx('PUT', `${R}/lock`, { pin: '2468', areas: ['people', 'finance', 'admin'], idleMin: 10 });
        eq(on.status, 200, '잠금 켜기');
        ctx.fx = fx;
        for (const p of ['/people', '/people/export.csv', '/finance', '/finance/export.csv', '/admin', '/events.ics']) eq((await fx('GET', `${R}${p}`)).status, 423, `암호 없이 ${p}`);
        eq((await fx('POST', `${R}/members`, { name: '몰래' })).status, 423, '암호 없이 성도 추가');
        eq((await fx('GET', '/api/backup/download')).status, 423, '암호 없이 백업 파일 받기');
        eq((await fx('PUT', '/api/backup/settings', { dir: '/tmp' })).status, 423, '암호 없이 바깥 백업 폴더 바꾸기');
        eq((await fx('POST', '/api/backup/now', {})).status, 423, '암호 없이 지금 백업');
        eq((await fx('POST', '/api/backup/restore-local', { file: 'x.json' })).status, 423, '암호 없이 날짜 백업으로 되살리기');
        eq((await fx('GET', '/api/backup')).status, 200, '백업 상태 보기는 됨');
        eq((await fx('GET', `${R}/weeks/${ctx.week}`)).status, 200, '예배 자료는 그대로');
        eq((await fx('GET', `${S}/people`)).status, 200, '예제는 잠그지 않음');
        eq((await fx('GET', `${R}/people`, null, on.cookie)).status, 200, '켠 사람은 바로 열린 상태');
      }],
      ['잠금: 틀린 암호는 거절하고, 맞으면 열리고, 잠그기로 다시 잠긴다', async () => {
        const { fx } = ctx;
        eq((await fx('POST', `${R}/lock/unlock`, { pin: '0000' })).status, 403, '틀린 암호');
        const un = await fx('POST', `${R}/lock/unlock`, { pin: '2468' });
        eq(un.status, 200, '맞는 암호');
        eq((await fx('GET', `${R}/finance`, null, un.cookie)).status, 200, '풀린 쪽지로 재정 열림');
        await fx('POST', `${R}/lock/lock`, {}, un.cookie);
        eq((await fx('GET', `${R}/finance`, null, un.cookie)).status, 423, '잠그기 뒤에는 같은 쪽지로도 잠김');
      }],
      ['잠금: 바꾸거나 끄려면 지금 암호가 필요하고, 끄면 다시 모두 보인다', async () => {
        const { fx } = ctx;
        eq((await fx('PUT', `${R}/lock`, { enabled: false })).status, 403, '지금 암호 없이 끄기');
        eq((await fx('PUT', `${R}/lock`, { enabled: false, current: '1111' })).status, 403, '틀린 암호로 끄기');
        eq((await fx('PUT', `${R}/lock`, { enabled: false, current: '2468' })).status, 200, '지금 암호로 끄기');
        eq((await fx('GET', `${R}/people`)).status, 200, '끈 뒤 성도 자료');
        eq((await get(`${R}/lock`)).data.enabled, false, '잠금 상태');
      }],
      ['잠금 중 주보: 봉사자 이름·생일·일정은 빼고, 주보 칸 설정도 바꿀 수 없다', async () => {
        const { fx } = ctx;
        await put(`${R}/bulletin`, { showBirthdays: true });
        await put('/api/ws/real/serve/plan', { dates: { [today]: { d1: ['잠금시험봉사자'] } } });
        has((await get(`${R}/weeks/${ctx.week}/bulletin`)).data, '잠금시험봉사자', '잠금 전에는 봉사자 이름이 보임');
        const on = await fx('PUT', `${R}/lock`, { pin: '1357', areas: ['people', 'admin'], idleMin: 10 });
        eq(on.status, 200, '잠금 다시 켜기');
        ctx.lockCookie = on.cookie;
        const locked = (await get(`${R}/weeks/${ctx.week}/bulletin`)).data;
        ok(!locked.includes('잠금시험봉사자') && !locked.includes('섬기는 분들'), '잠긴 동안 주보에 봉사자 이름이 없어야 함');
        has(locked, '잠금이 걸려 있어', '빠진 까닭 안내');
        const open = await fetch(`${hub.base}${R}/weeks/${ctx.week}/bulletin`, { headers: { Cookie: on.cookie } }).then((x) => x.text());
        has(open, '잠금시험봉사자', '잠금을 푼 쪽지로는 봉사자 이름이 보임');
        eq((await fx('PUT', `${R}/bulletin`, { showBirthdays: true })).status, 423, '잠긴 동안 주보 칸 바꾸기');
      }],
      ['주보 분량·저장 전 미리보기(예제): 고치던 글을 저장하지 않고 미리보기에만 넣고, 주보는 단·면마다 분량을 재서 넘치면 몇 줄·어느 칸인지 알린다', async () => {
        const wk = (await get(S)).data.weeks.find((w) => w.wc?.serviceId);
        const B = `${S}/weeks/${wk.id}/bulletin`;
        const before = (await get(`${B}/blocks`)).data.blocks.find((b) => b.id === 'ann').text;
        const { token } = expectStatus(await post(`${B}/preview`, { id: 'ann', text: '미리보기 전용 광고' }), 200, '저장 전 글 맡기기');
        ok(/^[a-f0-9]{24}$/.test(token), '미리보기 표', token);
        has((await get(`${B}?format=print&preview=${token}`)).data, '미리보기 전용 광고', '표를 붙이면 고치던 글로 그림');
        ok(!(await get(`${B}?format=print`)).data.includes('미리보기 전용 광고'), '표 없이 열면 저장된 주보 그대로');
        ok(!(await get(`${R}/weeks/${ctx.week}/bulletin?preview=${token}`)).data.includes('미리보기 전용 광고'), '다른 작업 공간·예배에는 쓰지 않음');
        eq((await get(`${B}/blocks`)).data.blocks.find((b) => b.id === 'ann').text, before, '미리보기는 저장하지 않음');
        expectStatus(await post(`${B}/preview`, { id: 'nope', text: 'x' }), 400, '없는 칸 거절');
        expectStatus(await post(`${B}/preview`, { id: 'ann', text: 'x'.repeat(10001) }), 400, '너무 긴 글 거절');
        const h = (await get(`${B}?format=fold4`)).data;
        ok(h.includes('data-b="ann"') && h.includes("type:'bulletin-fit'"), '칸 표시와 분량 알림이 주보에 들어 있음');
      }],
      ['주보 확정본(예제): 확정하면 그때 주보를 세 모양 그대로 보관하고, 나중에 표어를 바꿔도 확정본은 그대로이며, 바뀌면 알리고 다시 확정하면 차수가 오른다', async () => {
        const wk = (await get(S)).data.weeks.find((w) => w.wc?.serviceId);
        const B = `${S}/weeks/${wk.id}/bulletin`;
        const settings = (await get(`${S}/bulletin`)).data;
        eq(expectStatus(await get(`${B}/finals`), 200, '확정본 목록').finals, [], '처음에는 확정본 없음');
        await put(`${S}/bulletin`, { ...settings, motto: '확정 때 표어' });
        try {
          let f = expectStatus(await post(`${B}/finals`, {}), 200, '주보 확정');
          eq([f.finals.map((x) => x.v), f.changed], [[1], false], '1차 확정, 바뀐 것 없음');
          for (const fmt of ['print', 'fold4', 'mobile']) has((await get(`${B}?final=1&format=${fmt}`)).data, '확정 때 표어', `확정본 ${fmt}`);
          has((await get(`${B}?final=1&format=print`)).data, '확정본 1차', '화면에 확정본 표시');
          await put(`${S}/bulletin`, { ...settings, motto: '나중 표어' });
          const old = (await get(`${B}?final=1&format=print`)).data;
          ok(old.includes('확정 때 표어') && !old.includes('나중 표어'), '표어를 바꿔도 확정본은 그대로');
          has((await get(`${B}?format=print`)).data, '나중 표어', '지금 주보는 새 표어');
          eq((await get(`${B}/finals`)).data.changed, true, '확정 뒤 바뀌면 알림');
          f = expectStatus(await post(`${B}/finals`, {}), 200, '다시 확정');
          eq([f.finals.map((x) => x.v), f.changed], [[2, 1], false], '2차 확정 (1차도 남음)');
          ok((await get(`${B}?final=1&format=print`)).data.includes('확정 때 표어'), '1차 확정본도 그대로 열림');
          expectStatus(await get(`${B}?final=99`), 404, '없는 차수');
          for (let i = 0; i < 4; i++) await post(`${B}/finals`, {});
          eq((await get(`${B}/finals`)).data.finals.map((x) => x.v), [6, 5, 4, 3, 2], '최근 5개만 보관');
          expectStatus(await get(`${B}?final=1`), 404, '오래된 확정본은 지워짐');
          ok(!JSON.stringify((await get(`${S}/weeks/${wk.id}`)).data).includes('확정 때 표어'), '예배 기록 응답에 확정본이 섞이지 않음');
        } finally { await put(`${S}/bulletin`, settings); }
      }],
      ['주보 그림(예제): 교회 로고와 사진·포스터 칸을 넣으면 주보에 나오고, 그림 아닌 파일·큰 파일은 거절하며, 확정본은 그림을 한 번만 보관해도 그대로 열린다', async () => {
        const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const wk = (await get(S)).data.weeks.find((w) => w.wc?.serviceId);
        const B = `${S}/weeks/${wk.id}/bulletin`;
        const settings = (await get(`${S}/bulletin`)).data;
        expectStatus(await post(`${S}/bulletin/images`, { data: 'data:text/html;base64,PGI+' }), 400, '그림이 아닌 파일 거절');
        expectStatus(await post(`${S}/bulletin/images`, { data: `data:image/png;base64,${Buffer.from('그림 아님').toString('base64')}` }), 400, '그림인 척하는 파일 거절');
        expectStatus(await post(`${S}/bulletin/images`, { data: `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(900 * 1024)]).toString('base64')}` }), 400, '너무 큰 그림 거절');
        const { id } = expectStatus(await post(`${S}/bulletin/images`, { data: PNG }), 200, '그림 올리기');
        ok(/^[a-f0-9]{16}$/.test(id), '그림 번호', id);
        eq(expectStatus(await post(`${S}/bulletin/images`, { data: PNG }), 200, '같은 그림 다시').id, id, '같은 그림은 같은 번호 (한 번만 보관)');
        const raw = await fetch(`${hub.base}${S}/bulletin/images/${id}`);
        eq([raw.status, raw.headers.get('content-type')], [200, 'image/png'], '그림 보기');
        try {
          await put(`${S}/bulletin`, { ...settings, logo: id });
          has((await get(`${B}?format=print`)).data, `<img class="logo" src="${PNG}"`, '2단 주보 머리에 로고');
          has((await get(`${B}?format=fold4`)).data, `<div class="cover"><img class="logo" src="${PNG}"`, '4면 표지에 로고');
          expectStatus(await put(`${B}/blocks`, { id: 'photo', img: '0123456789abcdef' }), 400, '올리지 않은 그림 번호 거절');
          const e = expectStatus(await put(`${B}/blocks`, { id: 'photo', img: id, text: '추수감사 행사 사진' }), 200, '사진 칸 저장');
          eq(e.blocks.find((b) => b.id === 'photo').img, id, '편집 창 자료의 사진 번호');
          const h = (await get(`${B}?format=print`)).data;
          ok(h.includes(`<section data-b="photo" data-t="사진·포스터" class="photo"><img src="${PNG}" alt="추수감사 행사 사진"><p class="cap">추수감사 행사 사진</p></section>`), '주보에 사진과 설명', h.slice(h.indexOf('data-b="photo"') - 20, h.indexOf('data-b="photo"') + 300));
          expectStatus(await put(`${B}/blocks`, { id: 'photo', img: id, text: '추수감사 행사 사진' }), 200, '같은 사진 다시 저장');
          const fv = expectStatus(await post(`${B}/finals`, {}), 200, '사진이 든 주보 확정').finals[0].v;
          const stored = JSON.parse(fs.readFileSync(path.join(hub.dataDir, 'sample.json'), 'utf8')).weeks[wk.id].bulletin.finals.at(-1).html.print;
          ok(stored.includes(`allinone-img:${id}`) && !stored.includes('data:image'), '확정본에는 그림 자리표만 보관 (그림을 여러 번 넣지 않음)');
          // 사진·로고를 빼도 확정본이 가리키는 그림은 남는다
          await put(`${B}/blocks`, { id: 'photo', text: null });
          await put(`${S}/bulletin`, settings);
          ok(!(await get(`${B}?format=print`)).data.includes('data-b="photo"'), '사진을 빼면 주보에서 사진 칸이 사라짐');
          has((await get(`${B}?final=${fv}&format=print`)).data, `src="${PNG}"`, '확정본에는 그 사진이 그대로');
          eq((await fetch(`${hub.base}${S}/bulletin/images/${id}`)).status, 200, '확정본이 가리키는 그림은 지우지 않음');
        } finally { await put(`${B}/blocks`, { id: 'photo', text: null }); await put(`${S}/bulletin`, settings); }
      }],
      ['잠금 중 주보 편집: 봉사·일정·생일 칸은 자동 내용도 고친 글도 보이지 않고 고칠 수 없다 (광고는 고칠 수 있음)', async () => {
        const { fx } = ctx;
        const B = `${R}/weeks/${ctx.week}/bulletin`;
        eq((await fx('PUT', `${B}/blocks`, { id: 'serve', text: '고친 봉사' }, ctx.lockCookie)).status, 200, '잠금을 푼 쪽지로 봉사 칸 고치기');
        const e = (await fx('GET', `${B}/blocks`)).data;
        const sv = e.blocks.find((b) => b.id === 'serve');
        eq([sv.locked, sv.auto, sv.text], [true, '', null], '잠긴 동안 봉사 칸');
        ok(!JSON.stringify(e).includes('잠금시험봉사자') && !JSON.stringify(e).includes('고친 봉사'), '잠긴 동안 편집 자료에 이름이 없어야 함');
        ok(!(await get(`${B}`)).data.includes('고친 봉사'), '잠긴 동안 주보에 고친 봉사 글도 빠짐');
        ok(!JSON.stringify((await fx('GET', `${R}/weeks/${ctx.week}`)).data).includes('고친 봉사') && !JSON.stringify((await fx('GET', R)).data).includes('고친 봉사'), '잠긴 동안 예배 기록·목록에도 고친 봉사 글이 없어야 함');
        eq((await fx('PUT', `${B}/blocks`, { id: 'serve', text: '몰래' })).status, 423, '잠긴 동안 봉사 칸 고치기');
        eq((await fx('PUT', `${B}/blocks`, { id: 'births', text: '몰래' })).status, 423, '잠긴 동안 생일 칸 고치기');
        // 잠금을 푼 채 확정한 주보(봉사자 이름이 들어 있음)는 잠긴 동안 열 수 없다
        await fx('PUT', `${B}/blocks`, { id: 'serve', text: '확정본 봉사 글' }, ctx.lockCookie);
        const fv = (await fx('POST', `${B}/finals`, {}, ctx.lockCookie)).data.finals[0].v;
        eq((await fx('GET', `${B}?final=${fv}&format=print`)).status, 423, '잠긴 동안 이름이 든 확정본 열기');
        has(await (await fetch(`${hub.base}${B}?final=${fv}&format=print`, { headers: { Cookie: ctx.lockCookie } })).text(), '확정본 봉사 글', '잠금을 풀면 확정본이 열림');
        ok(!JSON.stringify((await fx('GET', `${R}/weeks/${ctx.week}`)).data).includes('확정본 봉사 글'), '예배 기록 응답에 확정본이 섞이지 않음');
        await fx('PUT', `${B}/blocks`, { id: 'serve', text: null }, ctx.lockCookie);
        eq((await fx('POST', `${B}/preview`, { id: 'serve', text: '몰래 미리보기' })).status, 423, '잠긴 동안 봉사 칸 저장 전 미리보기');
        eq((await fx('PUT', `${B}/blocks`, { id: 'ann', text: '광고는 됨' })).status, 200, '잠긴 동안에도 광고 칸은 고칠 수 있음');
        await fx('PUT', `${B}/blocks`, { id: 'ann', text: null });
        await fx('PUT', `${B}/blocks`, { id: 'serve', text: null }, ctx.lockCookie);
      }],
      ['잠금 중 제미나이 키: 잠금 암호 없이는 키를 넣거나 지울 수 없다 (몰래 다른 키로 바꿔 AI 요청을 가로채지 못하게)', async () => {
        const { fx } = ctx;
        const cfg = path.join(hub.dataDir, 'praiseflow-config.json');
        const before = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : null;
        const r = await fx('PUT', '/api/ai/gemini-key', { key: 'AIzaSy-thief_KEY.0123456789abcdefghijk' });
        eq(r.status, 423, '잠금 암호 없이 키 넣기');
        has(r.data?.error || '', '잠금 암호', '잠금 안내');
        eq(fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : null, before, '설정 파일은 그대로');
        eq((await fx('PUT', '/api/ai/gemini-key', { key: '' })).status, 423, '잠금 암호 없이 키 지우기');
        const okd = await fx('PUT', '/api/ai/gemini-key', { key: 'AIzaSy-owner_KEY.0123456789abcdefghijk' }, ctx.lockCookie);
        eq([okd.status, okd.data?.gemini?.loggedIn], [200, true], '잠금을 푼 쪽지로는 키를 넣을 수 있음');
        eq((await fx('PUT', '/api/ai/gemini-key', { key: '' }, ctx.lockCookie)).status, 200, '잠금을 푼 쪽지로 키 지우기');
      }],
      ['잠금: 5번 틀리면 기다려야 하고, 그동안은 설정 바꾸기·끄기도 막힌다 (암호 맞히기 막기)', async () => {
        const { fx } = ctx;
        for (let i = 0; i < 5; i++) await fx('POST', `${R}/lock/unlock`, { pin: '0000' });
        const wait = await fx('POST', `${R}/lock/unlock`, { pin: '1357' });
        eq(wait.status, 429, '5번 틀린 뒤에는 맞는 암호도 기다림');
        has(wait.data.error, '초 뒤에', '기다리라는 안내');
        eq((await fx('PUT', `${R}/lock`, { enabled: false, current: '1357' })).status, 429, '기다리는 동안 맞는 암호로 끄기');
        eq((await fx('PUT', `${R}/lock`, { current: '9999', pin: '1111' })).status, 429, '기다리는 동안 설정 바꾸기');
        ok(fs.existsSync(path.join(hub.dataDir, 'lock-fails.json')), '틀린 기록이 파일에 남아 다시 켜도 이어짐');
      }],
      ['music sheet 연동: 공유 링크만 받고, 비밀번호·팀원만 링크는 알맞게 안내하며, 가져온 곡을 예배송출 콘티에 순서·조성·곡 구성대로 넣는다', async () => {
        const url = (w) => `${S}/weeks/${w}/musicsheet`;
        expectStatus(await put(url(ctx.sw), { url: 'https://evil.example/share/opentoken1' }), 400, '다른 사이트 링크는 거절');
        expectStatus(await put(url(ctx.sw), { url: `${ms.base}/setlists/abc` }), 400, '공유 링크가 아닌 주소는 거절');
        has((await put(url(ctx.sw), { url: ms.link('lockedtok1') })).data.error, '팀원만', '팀원만 볼 수 있는 링크 안내');
        let v = (await put(url(ctx.sw), { url: ms.link('pintoken12') })).data;
        ok(v.needPin && /비밀번호가 필요/.test(v.error), '비밀번호가 필요하다고 안내', v);
        has((await put(url(ctx.sw), { url: ms.link('pintoken12'), pin: '1111' })).data.error, '맞지 않습니다', '틀린 비밀번호 안내');
        v = expectStatus(await put(url(ctx.sw), { url: ms.link('pintoken12'), pin: '2468' }), 200, '맞는 비밀번호');
        eq(v.setlist?.songs.map((x) => x.title), ['화면시험 새 노래', '[예제] 은혜의 강'], '예배 순서대로 가져온 곡');
        eq([v.setlist.songs[1].key, v.setlist.songs[1].flowText, v.setlist.songs[0].flowText], ['E', 'Intro → V1 → C → V1 → C ×2', 'Intro → V1 → C'], '조성·진행 (진행이 없으면 송폼 글자로)');
        ok(v.link.hasPin && !JSON.stringify(v).includes('2468'), '비밀번호는 저장만 하고 돌려주지 않음', v.link);
        eq((await get(url(ctx.sw))).data.setlist?.songs.length, 2, '다시 읽기 (저장된 비밀번호로)');
        ok(!JSON.stringify((await get(`${S}/weeks/${ctx.sw}`)).data).includes('2468') && !JSON.stringify((await get(S)).data).includes('2468'), '예배 기록을 읽어도 비밀번호는 나오지 않음');
        ok(ms.seen.pins.includes('2468'), '비밀번호를 x-share-pin 머리글로 보냄');
        const r = expectStatus(await post(`${url(ctx.sw)}/apply`), 200, '예배송출 자막에 넣기');
        const songs = r.status.summary.items.filter((i) => i.type === 'song');
        eq(songs.map((x) => x.title), ['화면시험 새 노래', '[예제] 은혜의 강'], '예배송출 콘티의 곡 순서');
        eq([songs[1].key, songs[1].arr], ['E', ['1절', '후렴', '1절', '후렴', '후렴']], '찾은 곡의 조성·곡 구성');
        eq(songs[0].key, 'A', '새로 만든 곡의 조성');
        has(r.results[0].done.join(' '), '새 곡', '새로 만든 곡 알림');
        ok(r.removed.length > 0, '원래 있던 다른 곡은 콘티에서 빠졌다고 알림', r.removed);
        expectStatus(await put(url(ctx.sw), { url: '' }), 200, '연결 끊기');
        eq((await get(url(ctx.sw))).data.link, null, '끊은 뒤 링크');
      }],
      ['송출 자막 보호: 지난 예배를 열거나 고쳐도 함께 쓰는 설교자 이름 자막은 이번 주 제목 그대로 (그 예배 자막은 바뀜)', async () => {
        const caster = () => JSON.parse(fs.readFileSync(path.join(hub.dataDir, 'sample-caster.json'), 'utf8'));
        const old = expectStatus(await post(`${S}/weeks`, { date: '2020-01-05', name: '주일 예배', wcMode: 'template' }), 200, '지난 예배 만들기').week;
        const now = expectStatus(await post(`${S}/weeks`, { date: '2099-01-04', name: '주일 예배', wcMode: 'template' }), 200, '이번 예배 만들기').week;
        await put(`${S}/weeks/${now.id}`, { sermonTitle: '이번 주 제목' });
        const sub = () => caster().props.find((p) => /설교/.test(p.text))?.sub;
        eq(sub(), '이번 주 제목', '이번 예배 제목을 고치면 이름 자막에 들어감');
        await put(`${S}/weeks/${old.id}`, { sermonTitle: '지난 제목' });
        expectStatus(await get(`${S}/weeks/${old.id}`), 200, '지난 예배 열기');
        eq(sub(), '이번 주 제목', '지난 예배를 고치고 열어도 이름 자막');
        const titleId = (await get(`${S}/weeks/${old.id}`)).data.week.wc.links.title;
        has(caster().items.find((i) => i.id === titleId).slides[0].text, '지난 제목', '지난 예배 자신의 설교 제목 자막');
      }],
      ['예제: 처음 상태로 되돌리면 바꾼 것이 사라진다 (실제 자료는 그대로)', async () => {
        expectStatus(await post(`${S}/reset`, {}), 200, '예제 되돌리기');
        ok(!(await get(`${S}/admin`)).data.minutes.some((m) => m.title === '예제 녹취'), '예제에서 만든 회의록은 사라짐');
        eq((await get(R)).data.church.name, '시험교회', '실제 자료 교회 이름');
        expectStatus(await post(`${R}/reset`, {}), 400, '실제 자료는 되돌리기 거절');
      }],
      ['제미나이 연결: API 키를 넣으면(PraiseFlow 설정과 함께, 키 값은 돌려주지 않음) 설교 후 자료를 제미나이로 만들고, 사용 한도에 걸리면 알아듣게 알린다', async () => {
        const cfg = path.join(hub.dataDir, 'praiseflow-config.json');
        fs.writeFileSync(cfg, JSON.stringify({ provider: 'claude', codexModel: '그대로 둘 값' }));
        eq(expectStatus(await get('/api/ai?refresh'), 200, 'AI 상태').gemini.loggedIn, false, '키가 없으면 제미나이 연결 안 됨');
        expectStatus(await putKey({ key: '짧은키' }), 400, '키 모양이 아니면 거절');
        const KEY = 'AIzaSy-test_KEY.0123456789abcdefghijk';
        const st = expectStatus(await putKey({ key: KEY }), 200, '키 저장');
        eq(st.gemini.loggedIn, true, '키를 넣으면 제미나이 연결됨');
        ok(!JSON.stringify(st).includes(KEY) && !JSON.stringify((await get('/api/ai')).data).includes(KEY), '키 값은 화면으로 돌려주지 않음');
        const saved = JSON.parse(fs.readFileSync(cfg, 'utf8'));
        eq([saved.apiKey, saved.provider, saved.codexModel], [KEY, 'claude', '그대로 둘 값'], 'PraiseFlow 설정에 키만 더하고 나머지는 그대로');
        if (process.platform !== 'win32') eq((fs.statSync(cfg).mode & 0o777).toString(8), '600', '키 파일은 나만 읽기');
        // 실제 교회 자료의 새 예배에 원고를 넣고 제미나이로 주보 요약 만들기
        const wk = expectStatus(await post(`${R}/weeks`, { date: '2099-03-01', name: '주일 예배' }), 200, '예배 만들기').week;
        await put(`${R}/weeks/${wk.id}`, { sermonTitle: '제미나이 시험 설교', sermonNotes: '제미나이 시험 원고 문장입니다. '.repeat(30) });
        expectStatus(await post(`${R}/weeks/${wk.id}/after/summary`, { provider: 'gemini' }), 200, '제미나이로 만들기');
        const done = await waitFor(async () => { const a = (await get(`${R}/weeks/${wk.id}/after`)).data; return a.docs.summary || a.errors.summary ? a : null; });
        eq(done.errors.summary, undefined, '만들기 오류');
        has(done.docs.summary.via, '제미나이', '제미나이로 만든 것으로 표시');
        has((await get(`${R}/weeks/${wk.id}/after/summary/view`)).data, '제미나이가 쓴 시험 요약', '만든 글');
        const c = gem.calls.at(-1);
        eq(c.key, KEY, '머리글로 키를 보냄 (주소에 넣지 않음)');
        ok(!c.url.includes(KEY) && c.url.includes(':generateContent'), '요청 주소', c.url);
        ok(c.body.systemInstruction?.parts?.[0]?.text && c.body.contents?.[0]?.parts?.[0]?.text.includes('제미나이 시험 원고'), '지시문과 원고를 보냄');
        // 사용 한도
        gem.mode = '429';
        try {
          expectStatus(await post(`${R}/weeks/${wk.id}/after/blog`, { provider: 'gemini' }), 200, '한도 시험 만들기');
          const e = await waitFor(async () => (await get(`${R}/weeks/${wk.id}/after`)).data.errors.blog);
          has(e.message, '사용 한도', '한도 안내');
        } finally { gem.mode = 'ok'; }
        // 키 지우기
        eq(expectStatus(await putKey({ key: '' }), 200, '키 지우기').gemini.loggedIn, false, '지우면 연결 안 됨');
        eq(JSON.parse(fs.readFileSync(cfg, 'utf8')).apiKey, undefined, '설정 파일에서도 지워짐');
      }],
      ['주보 꾸미기: 기본 스타일을 고르면 세 모양 주보에 겉모양만 덧붙고, AI 스타일은 위험한 설정(바깥 주소·숨기기·자리 바꾸기)을 거른 뒤 미리보기·적용·내 스타일 저장이 된다', async () => {
        const wk = (await get(S)).data.weeks.find((w) => w.wc?.serviceId);
        const B = `${S}/weeks/${wk.id}/bulletin`;
        const v0 = expectStatus(await get(`${S}/bulletin/style`), 200, '꾸밈 목록');
        eq(v0.themes.map((t) => t.id), ['basic', 'warm', 'classic', 'modern'], '기본 스타일 목록');
        eq(v0.theme, 'basic', '처음에는 기본 모양');
        const plain = (await get(`${B}?format=print`)).data;
        ok(!plain.includes('주보 꾸미기'), '기본 모양에는 꾸밈을 덧붙이지 않음');
        try {
          // 미리보기: 저장하지 않고 고른 모양으로 그려 보기
          const { token } = expectStatus(await post(`${S}/bulletin/style/preview`, { theme: 'classic' }), 200, '꾸밈 미리보기');
          has((await get(`${B}?format=print&look=${token}`)).data, 'Nanum Myeongjo', '미리보기에 고전적인 스타일');
          eq((await get(`${S}/bulletin/style`)).data.theme, 'basic', '미리보기는 저장하지 않음');
          // 적용: 세 모양 모두 <style> 맨 끝에 덧붙음 (내용은 그대로)
          expectStatus(await put(`${S}/bulletin/style`, { theme: 'warm' }), 200, '따뜻한 스타일 적용');
          for (const f of ['print', 'fold4', 'mobile']) {
            const h = (await get(`${B}?format=${f}`)).data;
            ok(/\/\* 주보 꾸미기 \*\/\n:root\{--a:#9a4a1f[^<]*<\/style>/.test(h), `${f}: 꾸밈이 style 맨 끝에`);
            eq(h.replace(/<style>[\s\S]*?<\/style>/, ''), (await get(`${B}?format=${f}&look=${(await post(`${S}/bulletin/style/preview`, { theme: 'basic' })).data.token}`)).data.replace(/<style>[\s\S]*?<\/style>/, ''), `${f}: 꾸밈을 바꿔도 내용은 그대로`);
          }
          eq((await get(`${S}/bulletin`)).data.theme, 'warm', '고정 정보에도 고른 스타일');
          expectStatus(await put(`${S}/bulletin`, { ...(await get(`${S}/bulletin`)).data, motto: '꾸밈 시험 표어' }), 200, '고정 정보 저장');
          eq((await get(`${S}/bulletin/style`)).data.theme, 'warm', '고정 정보를 저장해도 스타일은 그대로');
          // 예제 자료의 AI: AI 를 부르지 않고 예시 스타일
          const calls = gem.calls.length;
          const sx = expectStatus(await post(`${S}/bulletin/style/ai`, { desc: '고풍스러운 명조체, 보라색' }), 200, '예제 AI 꾸밈');
          eq([sx.sample, gem.calls.length], [true, calls], '예제는 AI를 부르지 않음');
          ok(sx.css.includes('--a:#5b3d8a') && sx.css.includes('Myeongjo'), '설명에 맞는 예시 (명조·보라)', sx.css);
          expectStatus(await post(`${S}/bulletin/style/ai`, { desc: '' }), 400, '설명 없으면 거절');
          // 직접 넣은 CSS 도 걸러서 저장
          const bad = expectStatus(await put(`${S}/bulletin/style`, { theme: 'custom', customCss: 'h3{color:red}.order{display:none}body{background:url(http://x/y)}</style><script>alert(1)</script>' }), 200, '직접 넣은 CSS');
          eq(bad.customCss, 'h3{color:red}', '겉모양만 남김');
          ok(!(await get(`${B}?format=print`)).data.includes('<script>alert'), '스크립트가 주보에 들어가지 않음');
        } finally { await put(`${S}/bulletin/style`, { theme: 'basic', customCss: '', myStyles: [] }); }
        // 실제 자료: 연결된 AI(가짜 제미나이)로 만들기 — 분위기 설명만 보내고 교회 자료는 보내지 않음
        const cfg = path.join(hub.dataDir, 'praiseflow-config.json');
        expectStatus(await putKey({ key: 'AIzaSy-style_KEY.0123456789abcdefghijk' }), 200, '키 저장');
        try {
          const church = (await get(R)).data.church.name;
          const a = expectStatus(await post(`${R}/bulletin/style/ai`, { desc: '고풍스러운 명조체, 진한 초록', provider: 'gemini' }), 200, 'AI로 꾸밈 만들기');
          const c = gem.calls.findLast((x) => String(x.body.systemInstruction?.parts?.[0]?.text).includes('주보 디자이너'));
          ok(c.body.contents[0].parts[0].text.includes('고풍스러운 명조체') && !!church && !JSON.stringify(c.body).includes(church), 'AI에는 분위기 설명만 보냄', c.body.contents[0].parts[0].text);
          eq(a.name, '초록 명조', 'AI가 붙인 이름');
          has(a.via, '제미나이', '만든 AI');
          eq(a.css, ":root{--a:#1d5c3a}\n.church{font-family:'AppleMyungjo',serif;color:var(--a)}\nh3{border-bottom:2px double #b8962e}", '위험한 설정을 거른 CSS');
          ok(a.dropped >= 5, '거른 설정 수', a.dropped);
          const wr = expectStatus(await post(`${R}/weeks`, { date: '2099-04-05', name: '주일 예배' }), 200, '예배 만들기').week;
          const { token } = expectStatus(await post(`${R}/bulletin/style/preview`, { theme: 'custom', customCss: a.css }), 200, 'AI 꾸밈 미리보기');
          has((await get(`${R}/weeks/${wr.id}/bulletin?format=fold4&look=${token}`)).data, 'border-bottom:2px double #b8962e', '미리보기');
          expectStatus(await get(`${S}/weeks/${wk.id}/bulletin?format=print&look=${token}`), 200, '다른 자료의 미리보기 표');
          ok(!(await get(`${S}/weeks/${wk.id}/bulletin?format=print&look=${token}`)).data.includes('#b8962e'), '실제 자료의 미리보기 표는 예제에 쓰이지 않음');
          const sv = expectStatus(await put(`${R}/bulletin/style`, { theme: 'custom', customCss: a.css, customName: a.name, myStyles: [{ name: '초록 명조', css: a.css }] }), 200, '적용·내 스타일 저장');
          eq([sv.theme, sv.customName, sv.myStyles.length], ['custom', '초록 명조', 1], '적용된 스타일');
          has((await get(`${R}/weeks/${wr.id}/bulletin?format=print`)).data, '#1d5c3a', '주보에 적용됨');
          eq(expectStatus(await put(`${R}/bulletin/style`, { theme: 'basic' }), 200, '기본으로 되돌리기').myStyles.length, 1, '되돌려도 내 스타일은 남음');
          ok(!(await get(`${R}/weeks/${wr.id}/bulletin?format=print`)).data.includes('#1d5c3a'), '기본 모양으로 돌아감');
        } finally {
          await put(`${R}/bulletin/style`, { theme: 'basic', customCss: '', myStyles: [] });
          await putKey({ key: '' });
          ok(fs.existsSync(cfg), '설정 파일');
        }
      }],
      ['자료 손상 복구: 자료 파일이 깨지면 빈 자료로 덮어쓰지 않고 저장을 멈춘 뒤, 고른 백업으로 되살린다', async () => {
        const ext = tmpDir('broken-ext');
        const good = (name, weeks) => JSON.stringify({ version: 1, church: { name }, weeks: Object.fromEntries(Array.from({ length: weeks }, (_, i) => [`w${i}`, { id: `w${i}` }])), members: {} });
        const BROKEN = '{"version":1,"church":{"name":"깨진교회"},"weeks":{"a":';
        const h2 = await startHub({ name: 'broken', prepare: (d) => {
          fs.writeFileSync(path.join(d, 'real.json'), BROKEN);
          fs.writeFileSync(path.join(d, 'sample.json'), '{깨진 예제');
          fs.mkdirSync(path.join(d, 'backups'));
          fs.writeFileSync(path.join(d, 'backups', 'real-2026-01-01.json'), good('옛교회', 1));
          fs.writeFileSync(path.join(d, 'backups', 'real-2026-01-02.json'), '{깨짐');
          fs.writeFileSync(path.join(d, 'backup.json'), JSON.stringify({ dir: ext }));
          fs.mkdirSync(path.join(ext, '라온교회올인원-백업'));
          fs.writeFileSync(path.join(ext, '라온교회올인원-백업', 'real-2026-01-03.json'), good('바깥교회', 2));
        } });
        try {
          const ov = await h2.get(R);
          eq(ov.status, 503, '깨진 자료를 빈 자료(처음 설정)처럼 보여 주지 않음');
          ok(ov.data.broken?.kept?.startsWith('real.json.broken-'), '깨진 파일을 보관한 이름을 알려 줌', ov.data);
          eq((await h2.put(`${R}/church`, { name: '새교회' })).status, 503, '깨진 동안 저장 거절');
          eq(fs.readFileSync(path.join(h2.dataDir, 'real.json'), 'utf8'), BROKEN, '깨진 real.json 을 덮어쓰지 않음');
          ok(fs.readdirSync(h2.dataDir).some((f) => f.startsWith('real.json.broken-')), '깨진 파일 보관본', fs.readdirSync(h2.dataDir));
          ok(!fs.existsSync(path.join(ext, '라온교회올인원-백업', `real-${today}.json`)), '켤 때 깨진 파일을 바깥 백업으로 복사하지 않음');
          ok((await h2.get(S)).data.church?.name, '예제 자료는 깨져도 다시 만들어 그대로 씀', (await h2.get(S)).data.church);

          const rec = expectStatus(await h2.get('/api/recovery'), 200, '복구 후보 보기');
          const find = (src, f) => rec.list.find((c) => c.source === src && c.file === f);
          eq(find('local', 'real-2026-01-01.json')?.church, '옛교회', '이 컴퓨터 자동 백업과 그 안의 교회 이름');
          eq(find('local', 'real-2026-01-02.json')?.ok, false, '깨진 백업은 고를 수 없다고 표시');
          eq(find('external', 'real-2026-01-03.json')?.weeks, 2, '바깥 백업 폴더의 백업과 예배 수');
          expectStatus(await h2.post('/api/recovery/restore', { source: 'local', file: 'real-2026-01-02.json' }), 400, '깨진 백업으로 되살리기 거절');
          expectStatus(await h2.post('/api/recovery/restore', { source: 'external', file: '../real.json' }), 404, '백업 폴더 밖 파일 거절');
          expectStatus(await h2.post('/api/recovery/fresh', { confirm: '' }), 400, '확인 글자 없이 새로 시작 거절');

          const r = expectStatus(await h2.post('/api/recovery/restore', { source: 'external', file: 'real-2026-01-03.json' }), 200, '바깥 백업으로 되살리기');
          eq(r.church, '바깥교회', '되살린 교회 이름');
          eq(expectStatus(await h2.get(R), 200, '되살린 뒤 자료 열기').church.name, '바깥교회', '되살린 뒤 교회 이름');
          expectStatus(await h2.put(`${R}/church`, { name: '바깥교회2' }), 200, '되살린 뒤 저장 다시 됨');
          eq(JSON.parse(fs.readFileSync(path.join(h2.dataDir, 'real.json'), 'utf8')).church.name, '바깥교회2', '저장된 파일');
          ok(!fs.readdirSync(path.join(h2.dataDir, 'backups')).some((f) => f.startsWith('before-restore-')), '깨진 파일을 되살리기 직전 자료로 백업 목록에 넣지 않음');
          eq(fs.readFileSync(path.join(h2.dataDir, 'backups', 'real-2026-01-01.json'), 'utf8'), good('옛교회', 1), '옛 자동 백업은 그대로');
          expectStatus(await h2.post('/api/recovery/restore', { source: 'local', file: 'real-2026-01-01.json' }), 409, '멀쩡해진 뒤에는 복구 주소로 되돌리지 않음');
          eq((await h2.get('/api/recovery')).data.broken, null, '복구 상태 풀림');
        } finally { await h2.stop(); fs.rmSync(ext, { recursive: true, force: true }); }
      }],
    ]);
  } finally {
    await hub.stop(); await gh.close(); await fakeApp.close(); await ms.close(); await gemini.close();
    fs.rmSync(appDir, { recursive: true, force: true });
  }
}

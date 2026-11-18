// 서버·API 점검: 시험 서버에 실제로 요청을 보내 결과 값을 확인한다.
import fs from 'node:fs';
import path from 'node:path';
import { startHub, runChecks, eq, ok, has, expectStatus, fakeServer, json, tmpDir, sleep } from './lib.mjs';

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
  const hub = await startHub({ name: 'api', env: { UPDATE_LATEST_URL: `${gh.base}/latest`, HUB_APPS_FILE: appsFile } });
  const { get, post, put, del } = hub;
  const ctx = {};
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
      ['주보: 적은 글에 태그가 있어도 실행되지 않고 글자로 나온다 (보안)', async () => {
        await put(`${R}/weeks/${ctx.week}`, { announcements: ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>'] });
        const r = await get(`${R}/weeks/${ctx.week}/bulletin`);
        ok(!r.data.includes('<script>alert') && !r.data.includes('<img src=x'), '태그가 그대로 들어가면 안 됨');
        has(r.data, '&lt;script&gt;alert(1)&lt;/script&gt;', '글자로 바뀐 태그');
        has(r.headers.get('content-security-policy'), "default-src 'none'", '주보 보안 머리글');
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
      ['예제: 처음 상태로 되돌리면 바꾼 것이 사라진다 (실제 자료는 그대로)', async () => {
        expectStatus(await post(`${S}/reset`, {}), 200, '예제 되돌리기');
        ok(!(await get(`${S}/admin`)).data.minutes.some((m) => m.title === '예제 녹취'), '예제에서 만든 회의록은 사라짐');
        eq((await get(R)).data.church.name, '시험교회', '실제 자료 교회 이름');
        expectStatus(await post(`${R}/reset`, {}), 400, '실제 자료는 되돌리기 거절');
      }],
    ]);
  } finally {
    await hub.stop(); await gh.close(); await fakeApp.close();
    fs.rmSync(appDir, { recursive: true, force: true });
  }
}

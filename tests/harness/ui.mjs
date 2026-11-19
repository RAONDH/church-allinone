// 화면 점검: 헤드리스 크롬으로 시험 서버 화면을 열어 단추를 누르고, 나와야 할 것이 나오는지와 화면 오류(콘솔 에러)가 없는지 본다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
import { startHub, runChecks, eq, ok, has, fakeServer, fakeMusicSheet, json, tmpDir, sleep, HUB } from './lib.mjs';

export function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  return c.find((p) => fs.existsSync(p)) || '';
}

// 시험용 워드 파일 (zip 안의 word/document.xml)
function docx(text) {
  const files = { '[Content_Types].xml': '<Types/>', 'word/document.xml': `<w:document><w:body>${text.split('\n').map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>` };
  const parts = [], central = []; let off = 0, n = 0;
  for (const [name, t] of Object.entries(files)) {
    const nm = Buffer.from(name), raw = Buffer.from(t), data = deflateRawSync(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nm, data); central.push(c, nm); off += 30 + nm.length + data.length; n++;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(n, 8); e.writeUInt16LE(n, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

export async function runUi() {
  const chrome = findChrome();
  if (!chrome) return [{ name: '화면 점검: 크롬을 찾지 못함 (CHROME_PATH 로 알려 주세요)', ok: false, error: '크롬이 없어 화면 점검을 하지 못했습니다' }];
  if (!fs.existsSync(path.join(HUB, 'dist', 'index.html'))) return [{ name: '화면 점검: 빌드된 화면(dist)이 없음', ok: false, error: 'npm run build 를 먼저 하세요' }];
  const gh = await fakeServer({ '/latest': json({ tag_name: 'v9.9.9', name: 'v9.9.9', html_url: 'https://example.invalid/r', body: '## 시험 버전\n- 화면 점검용', assets: [] }) });
  const ms = await fakeMusicSheet();
  const hub = await startHub({ name: 'ui', env: { UPDATE_LATEST_URL: `${gh.base}/latest`, MUSICSHEET_ORIGIN: ms.base } });
  const files = tmpDir('ui-files');
  const profile = tmpDir('ui-profile');   // 사용자의 크롬 프로필과 섞이지 않게
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
    '--autoplay-policy=no-user-gesture-required',
    // 이 컴퓨터의 소리 장치 상태와 관계없이 소리 처리가 돌게 (시험용 가짜 오디오 출력)
    '--disable-audio-output'] });
  const page = await browser.newPage();
  // 마이크 대신 크롬 안에서 만든 소리(발진음)를 넣는다. 맥의 실제 마이크·권한 창은 점검으로 확인할 수 없어 건너뜀
  await page.evaluateOnNewDocument(() => {
    if (!navigator.mediaDevices) return;
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(); const osc = ctx.createOscillator(); const dst = ctx.createMediaStreamDestination();
      osc.frequency.value = 440; osc.connect(dst); osc.start(); await ctx.resume();
      return dst.stream;
    };
  });
  await page.setViewport({ width: 1280, height: 900 });
  let errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('dialog', (d) => d.accept());
  const U = (p) => `${hub.base}${p}`;
  const go = async (p) => { await page.goto(U(p), { waitUntil: 'networkidle0' }); };
  const waitText = (t, timeout = 10000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t).catch(() => { throw new Error(`화면에 "${t}" 이(가) 나오지 않았습니다`); });
  const clickText = async (t, sel = 'button, a, label') => {
    const okd = await page.evaluate((text, s) => {
      const els = [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null);
      const el = els.find((e) => e.innerText.trim() === text) || els.find((e) => e.innerText.trim().includes(text));
      if (el) { el.click(); return true; } return false;
    }, t, sel);
    if (!okd) throw new Error(`"${t}" 단추를 찾지 못했습니다`);
    await sleep(150);
  };
  const typeLabel = async (labelText, value) => {
    const h = await page.evaluateHandle((t) => [...document.querySelectorAll('label')].find((l) => l.innerText.trim().startsWith(t))?.querySelector('input, textarea'), labelText);
    const el = h.asElement(); if (!el) throw new Error(`"${labelText}" 칸을 찾지 못했습니다`);
    await el.click({ clickCount: 3 }); await el.type(value);
  };
  const noErrors = (what) => { const e = errors; errors = []; if (e.length) throw new Error(`${what}: 화면 오류 ${e.length}건\n      ${e.slice(0, 3).join('\n      ')}`); };
  const sampleWeek = async () => (await hub.get('/api/ws/sample')).data.weeks.find((w) => w.wc?.serviceId).id;

  try {
    return await runChecks('화면 점검 (헤드리스 크롬)', [
      ['업데이트 안내 창: 새 버전이 있으면 저절로 뜨고, [나중에] 뒤에는 🔔 새 버전 단추만 남는다', async () => {
        await go('/');
        await waitText('새 버전이 있습니다');
        await waitText('v9.9.9'); await waitText('화면 점검용');
        await clickText('나중에');
        await page.waitForFunction(() => !document.body.innerText.includes('새 버전이 있습니다'));
        await waitText('🔔 새 버전');
        await go('/'); await sleep(800);
        ok(!(await page.evaluate(() => document.body.innerText.includes('새 버전이 있습니다'))), '미룬 뒤 다시 열어도 창이 뜨지 않아야 함');
        await clickText('🔔 새 버전'); await waitText('새 버전이 있습니다'); await clickText('나중에');
        noErrors('업데이트 창');
      }],
      ['처음 화면: 교회 이름을 넣고 시작하기를 누르면 이번 주 준비함이 열린다', async () => {
        await go('/');
        await waitText('시작하기');
        await typeLabel('교회 이름', '화면시험교회');
        await clickText('시작하기');
        await waitText('이번 주 예배 만들기');
        eq((await hub.get('/api/ws/real')).data.church.name, '화면시험교회', '저장된 교회 이름');
        noErrors('처음 화면');
      }],
      ['이번 주 준비함: 예배 만들기 창으로 만들면 예배 화면과 탭 5개가 열린다', async () => {
        await clickText('이번 주 예배 만들기');
        await waitText('무엇을 가져올까요?').catch(() => {});
        await page.evaluate(() => [...document.querySelectorAll('.dialog button.primary')].find((b) => b.innerText.includes('만들기'))?.click());
        for (const t of ['예배 정보', '찬양 콘티', '자막', '결과물', '설교 후 자료']) await waitText(t);
        ok(/\/week\//.test(page.url()), '예배 화면 주소', page.url());
        errors = errors.filter((e) => !/Failed to load resource/.test(e));   // 예배송출이 꺼져 있어 생기는 연결 실패 안내는 정상
        noErrors('예배 만들기');
      }],
      ['예배 정보: 설교 제목을 쓰면 잠시 뒤 "저장됨"이 되고 서버에 남는다', async () => {
        await typeLabel('설교 제목', '화면 점검 설교');
        await page.waitForFunction(() => /저장됨/.test(document.body.innerText), { timeout: 8000 });
        const id = page.url().split('/week/')[1].split('/')[0];
        eq((await hub.get(`/api/ws/real/weeks/${id}`)).data.week.sermonTitle, '화면 점검 설교', '서버에 저장된 제목');
        errors = errors.filter((e) => !/Failed to load resource/.test(e));
        noErrors('예배 정보');
      }],
      ['원고 파일 가져오기: 워드(.docx)를 넣으면 원고 칸에 글이 들어간다', async () => {
        const f = path.join(files, '원고.docx');
        fs.writeFileSync(f, docx('첫 문단 원고입니다\n둘째 문단 원고입니다'));
        const input = await page.$('input[type=file][accept*=".docx"]');
        ok(input, '원고 파일 넣는 칸');
        await input.uploadFile(f);
        await waitText('원고.docx');
        const v = await page.evaluate(() => [...document.querySelectorAll('textarea')].map((t) => t.value).find((x) => x.includes('첫 문단')) || '');
        eq(v, '첫 문단 원고입니다\n둘째 문단 원고입니다', '원고 칸의 글');
        errors = errors.filter((e) => !/Failed to load resource/.test(e));
        noErrors('원고 파일');
      }],
      ['예제 보기: 예제를 누르면 예제 배너와 예제 교회가 보인다', async () => {
        await go('/');
        await clickText('예제', '.ws-toggle button');
        await waitText('예제 자료를 보고 있습니다');
        await waitText('예제교회');
        noErrors('예제 보기');
      }],
      ['설교 후 자료(예제): 남은 자료 한꺼번에 만들기 → 설교 점검을 뺀 8가지가 모두 만들어진다', async () => {
        await go(`/week/${await sampleWeek()}/after?ws=sample`);
        await waitText('성도와 나누기');
        await clickText('한꺼번에 만들기');
        await page.waitForFunction(() => /8\/9 만듦|9\/9 만듦/.test(document.body.innerText), { timeout: 40000 }).catch(() => { throw new Error('8가지(설교 점검 빼고)가 만들어지지 않았습니다'); });
        await waitText('카드 보기');
        noErrors('설교 후 자료');
      }],
      ['카드뉴스(예제): 카드 보기에서 카드 그림이 6장 이상 그려지고 그림으로 저장할 수 있다', async () => {
        const p2 = await browser.newPage();
        const errs = []; p2.on('pageerror', (e) => errs.push(String(e.message)));
        await p2.goto(U(`/api/ws/sample/weeks/${await sampleWeek()}/after/cards/view`), { waitUntil: 'load' });
        await p2.waitForFunction(() => document.querySelectorAll('canvas').length >= 6, { timeout: 8000 }).catch(() => {});
        const r = await p2.evaluate(() => ({ n: document.querySelectorAll('canvas').length, png: document.querySelector('canvas')?.toDataURL('image/png').length || 0, btn: [...document.querySelectorAll('button')].filter((b) => b.innerText.includes('그림으로 저장')).length }));
        await p2.close();
        ok(r.n >= 6 && r.png > 5000 && r.btn === r.n, '카드 수·그림·저장 단추', r);
        eq(errs, [], '카드 화면 오류');
      }],
      ['성도(예제): 성도 추가 창으로 넣으면 명부에 보이고, 이름을 누르면 기록 모아보기가 나온다', async () => {
        await go('/people?ws=sample');
        await clickText('성도 추가');
        await typeLabel('이름', '화면시험성도');
        await page.evaluate(() => [...document.querySelectorAll('.dialog button.primary')].find((b) => b.innerText.includes('저장'))?.click());
        await waitText('화면시험성도');
        await clickText('화면시험성도', 'td, b, span, a, button, div');
        await waitText('기록 모아보기');
        noErrors('성도');
      }],
      ['재정(예제): 수입을 입력해 장부에 넣으면 목록에 보인다', async () => {
        await go('/finance?ws=sample');
        await clickText('수입·지출 입력');
        const name = await page.$('input.entry-name'), amt = await page.$('.entry-table input.num');
        ok(name && amt, '입력 칸');
        await name.type('화면시험헌금자'); await amt.type('12345');
        await clickText('장부에 넣기');
        await waitText('넣었습니다');
        await waitText('화면시험헌금자');
        noErrors('재정');
      }],
      ['행정(예제): 일정 추가 창으로 넣으면 달력에 보인다', async () => {
        await go('/admin?ws=sample');
        await clickText('일정 추가');
        await typeLabel('일정 이름', '화면시험일정');
        await page.evaluate(() => [...document.querySelectorAll('.dialog button.primary')].find((b) => b.innerText.includes('저장'))?.click());
        await waitText('화면시험일정');
        noErrors('행정 일정');
      }],
      ['봉사 배정표(예제): 다음 달 빈 칸 돌아가며 채우기 → 표가 채워진다', async () => {
        await go('/admin/serve?ws=sample');
        await page.click('button[aria-label="다음달"]'); await sleep(200);
        await page.click('button[aria-label="다음달"]'); await sleep(200);
        await clickText('빈 칸 돌아가며 채우기');
        await waitText('주의 빈 칸을 돌아가며 채웠습니다');
        const filled = await page.evaluate(() => [...document.querySelectorAll('.serve-cell')].filter((c) => c.innerText.trim() && c.innerText.trim() !== '＋').length);
        ok(filled >= 4, '채워진 칸 수', filled);
        noErrors('봉사 배정표');
      }],
      ['설정: 새 버전 알림 끄기를 누르면 저장된다', async () => {
        await go('/settings');
        await waitText('새 버전이 나오면 알려 주기');
        await clickText('새 버전이 나오면 알려 주기', 'label');
        await sleep(500);
        eq((await hub.get('/api/update')).data.notify, false, '서버에 저장된 알림 설정');
        noErrors('설정');
      }],
      ['설정 → 백업: 바깥 백업 폴더를 적어 정하면 바로 백업하고 날짜 백업 목록이 보인다', async () => {
        const ext = tmpDir('ui-ext');
        try {
          await go('/settings?ws=real');
          await waitText('바깥 백업 폴더');
          const input = await page.$('input[aria-label="바깥 백업 폴더"]');
          await input.click({ clickCount: 3 }); await input.type(ext);
          await clickText('폴더 정하기');
          await waitText('바깥 백업 폴더를 정하고 지금 한 번 백업했습니다');
          ok(fs.existsSync(path.join(ext, '라온교회올인원-백업')), '바깥 폴더에 백업 폴더가 생겨야 함');
          await waitText('이 컴퓨터 안의 백업');
          ok(await page.$('a[href="/api/backup/download"]'), '백업 파일 받기 단추');
          await clickText('끄기'); await waitText('바깥 백업을 껐습니다');
          noErrors('백업 설정');
        } finally { fs.rmSync(ext, { recursive: true, force: true }); }
      }],
      ['회의록 녹음(마이크 대신 시험 소리): 녹음하는 동안 30초마다 저장되고, 녹음 끝내기를 누르면 녹음 파일이 생긴다', async () => {
        // 앞 점검이 연 탭 뒤에 숨어 있으면 크롬이 소리 처리를 멈추므로, 녹음할 탭을 앞으로
        await page.bringToFront();
        await go('/admin/minutes?ws=real');
        await clickText('녹음으로 회의록 만들기');
        // 실제 사람처럼 마우스로 누른다 (스크립트로 누르면 크롬이 오디오를 멈춘 채로 둘 수 있음)
        const recBtn = await page.waitForSelector('button.rec-choice');
        await recBtn.click();
        await waitText('녹음 중입니다');
        const findRec = async () => (await hub.get('/api/ws/real/admin')).data.minutes.find((m) => m.recording);
        ok(await findRec(), '녹음을 시작하면 회의록이 먼저 생겨야 함');
        await page.waitForFunction(() => /저장됨\)/.test(document.body.innerText), { timeout: 45000 }).catch(async () => {
          const dlg = await page.evaluate(() => (document.querySelector('.dialog')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300));
          const srv = (await hub.get('/api/ws/real/admin')).data.minutes.find((m) => m.recording)?.recording;
          throw new Error(`30초가 지나도 "저장됨"이 나오지 않았습니다\n      창: ${dlg}\n      서버 녹음 상태: ${JSON.stringify(srv)}\n      화면 오류: ${errors.slice(0, 3).join(' | ')}`);
        });
        const mid = await findRec();
        ok(mid.recording.seconds >= 20, '녹음 중 서버에 저장된 길이(초)', mid.recording);
        await clickText('녹음 끝내기');
        await waitText('녹음 파일을 회의록에 저장했습니다', 20000);
        const done = (await hub.get('/api/ws/real/admin')).data.minutes.find((m) => m.id === mid.id);
        ok(done.audio && done.audio.size > mid.recording.bytes && !done.recording, '녹음 파일 (끝낸 뒤 조각까지 합쳐짐)', { audio: done.audio, rec: done.recording });
        noErrors('회의록 녹음');
      }],
      ['주보(예제): 결과물 탭에서 인쇄용 주보를 열 수 있고, A4 가로 한 장으로 인쇄된다', async () => {
        const wk = await sampleWeek();
        await go(`/week/${wk}/outputs?ws=sample`);
        await waitText('인쇄용 주보 열기');
        await clickText('주보 고정 정보');
        await typeLabel('교회 주소', '화면시험 주소 1');
        await page.evaluate(() => [...document.querySelectorAll('.dialog button.primary')].find((b) => b.innerText.includes('저장'))?.click());
        await page.waitForFunction(() => !document.querySelector('.dialog'));
        const href = await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.innerText.includes('인쇄용 주보 열기'))?.getAttribute('href'));
        const p2 = await browser.newPage();
        const errs = []; p2.on('pageerror', (e) => errs.push(String(e.message)));
        await p2.goto(U(href), { waitUntil: 'load' });
        has(await p2.evaluate(() => document.body.innerText), '화면시험 주소 1', '저장한 고정 정보');
        const pdf = Buffer.from(await p2.pdf({ format: 'A4', landscape: true, preferCSSPageSize: true, printBackground: true }));
        await p2.close();
        const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
        eq(pages, 1, 'A4 가로 인쇄 쪽수');
        eq(errs, [], '주보 화면 오류');
        noErrors('주보');
      }],
      ['접는 4면 주보(예제): 결과물 탭 단추로 열면 A4 가로 앞뒤 2쪽으로 인쇄되고, 넘치는 면이 없다', async () => {
        await go(`/week/${await sampleWeek()}/outputs?ws=sample`);
        const href = await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.innerText.includes('접는 4면 주보 열기'))?.getAttribute('href'));
        ok(href, '접는 4면 주보 단추');
        const p2 = await browser.newPage();
        const errs = []; p2.on('pageerror', (e) => errs.push(String(e.message)));
        await p2.goto(U(href), { waitUntil: 'load' });
        ok(!(await p2.evaluate(() => document.body.innerText.includes('잘립니다'))), '넘쳐 잘리는 면이 없어야 함');
        const pdf = Buffer.from(await p2.pdf({ format: 'A4', landscape: true, preferCSSPageSize: true, printBackground: true }));
        await p2.close();
        eq((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 2, 'A4 가로 인쇄 쪽수 (앞·뒤)');
        eq(errs, [], '주보 화면 오류');
        noErrors('접는 4면 주보');
      }],
      ['주보 편집(예제): 교회 소식 글을 고쳐 저장하면 미리보기에 나오고, 4면에서 자리를 바꾸면 그 면으로 옮겨지며, 되돌리면 처음대로', async () => {
        const wk = await sampleWeek();
        await go(`/week/${wk}/outputs?ws=sample`);
        await clickText('주보 편집 (배치·글 고치기)');
        await waitText('주보 편집 ·');
        const frameText = async (fmt, want, timeout = 8000) => {
          const end = Date.now() + timeout; let t = '';
          while (Date.now() < end) {
            const f = page.frames().find((x) => x.url().includes(`bulletin?format=${fmt}`));
            t = f ? await f.evaluate(() => document.body?.innerText || '').catch(() => '') : '';
            if (want(t)) return t;
            await sleep(200);
          }
          throw new Error(`미리보기(${fmt})가 기대대로 바뀌지 않았습니다: ${t.slice(0, 200)}`);
        };
        await frameText('print', (t) => t.includes('교회 소식'));
        // 교회 소식 칸의 [글 고치기]
        await page.evaluate(() => [...document.querySelectorAll('.bul-blocks li')].find((li) => li.innerText.includes('교회 소식'))?.querySelector('button:last-of-type')?.click());
        const ta = await page.waitForSelector('textarea[aria-label="교회 소식 이번 주 글"]');
        await ta.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await ta.type('화면시험 고친 광고');
        await clickText('이번 주에 저장');
        await waitText('이 예배 주보에 저장했습니다');
        await waitText('이번 주 고침');
        await frameText('print', (t) => t.includes('화면시험 고친 광고'));
        // 접는 4면: 교회 소식을 4면(뒷면)으로
        await clickText('접는 4면', '.dialog button');
        await frameText('fold4', (t) => t.includes('화면시험 고친 광고'));
        await page.select('select[aria-label="교회 소식 면"]', '4');
        await waitText('배치를 저장했습니다');
        const layout = (await hub.get('/api/ws/sample/bulletin')).data.layout;
        eq(layout.find((x) => x.id === 'ann').face, 4, '저장된 교회 소식 면');
        const html = (await hub.get(`/api/ws/sample/weeks/${wk}/bulletin?format=fold4`)).data;
        ok(html.indexOf('<p class="fno">4</p>') < html.indexOf('화면시험 고친 광고') && html.indexOf('화면시험 고친 광고') < html.indexOf('<p class="fno">2</p>'), '고친 광고가 4면에 있어야 함');
        // 되돌리기
        await page.evaluate(() => [...document.querySelectorAll('.bul-blocks li')].find((li) => li.innerText.includes('교회 소식'))?.querySelector('button:last-of-type')?.click());
        await clickText('자동 내용으로 되돌리기');
        await waitText('자동 내용으로 되돌렸습니다');
        await frameText('fold4', (t) => !t.includes('화면시험 고친 광고'));
        await page.select('select[aria-label="교회 소식 면"]', '3');
        await waitText('배치를 저장했습니다');
        await clickText('닫기', '.dialog button');
        noErrors('주보 편집');
      }],
      ['잠금: 설정에서 켜고 🔒 잠그기를 누르면 성도·재정이 잠금 화면이 되고, 암호를 넣으면 열린다', async () => {
        await go('/settings?ws=real');
        await waitText('잠금 (성도·재정·행정)');
        const set = async (label, v) => { const el = await page.$(`input[aria-label="${label}"]`); await el.click({ clickCount: 3 }); await el.type(v); };
        await set('새 잠금 암호', '1357'); await set('새 잠금 암호 확인', '1357');
        await clickText('잠금 켜기');
        await waitText('잠금을 켰습니다');
        await clickText('🔒 잠그기');
        await go('/people?ws=real');
        await waitText('성도 자료는 잠겨 있습니다');
        await go('/finance?ws=real');
        await waitText('재정 자료는 잠겨 있습니다');
        const pin = await page.$('input[aria-label="잠금 암호"]');
        await pin.type('9999'); await clickText('열기');
        await waitText('잠금 암호가 맞지 않습니다');
        await pin.type('1357'); await clickText('열기');
        await waitText('수입·지출 입력');
        await go('/people?ws=real');
        await waitText('성도 추가');   // 한 번 풀면 성도도 열림
        // 끄기 (다른 점검에 영향 없게)
        await go('/settings?ws=real');
        await set('지금 잠금 암호', '1357');
        await clickText('잠금 끄기');
        await waitText('잠금을 껐습니다');
        errors = errors.filter((e) => !/status of 4(23|03)/.test(e));   // 잠긴 자료를 부를 때 나오는 423·403 은 정상
        noErrors('잠금');
      }],
      ['찬양 콘티(예제): music sheet 공유 링크를 넣고 가져오기 → 곡 목록이 보이고, 예배송출 자막에 넣기 → 이번 주 찬양에 들어간다', async () => {
        await go(`/week/${await sampleWeek()}/setlist?ws=sample`);
        await waitText('라온 music sheet에서 가져오기');
        const input = await page.$('input[aria-label="music sheet 공유 링크"]');
        await input.click({ clickCount: 3 }); await input.type(ms.link('opentoken1'));
        await clickText('가져오기');
        await waitText('화면시험 새 노래'); await waitText('Intro → V1 → C → V1 → C ×2');
        await clickText('예배송출 자막에 넣기');
        await waitText('예배송출 콘티에 2곡을 넣었습니다');
        const list = await page.evaluate(() => document.querySelector('ol.setlist')?.innerText || '');
        ok(list.indexOf('화면시험 새 노래') >= 0 && list.indexOf('화면시험 새 노래') < list.indexOf('은혜의 강'), '이번 주 찬양에 music sheet 순서대로', list.slice(0, 200));
        noErrors('music sheet 가져오기');
      }],
      ['모든 화면이 오류 없이 열린다 (위 메뉴 · 예배 탭 · 성도·재정·행정 탭)', async () => {
        const wk = await sampleWeek();
        const pages = [['/', '이번 주'], [`/week/${wk}/info`, '예배 정보'], [`/week/${wk}/setlist`, '콘티'], [`/week/${wk}/subs`, '자막'], [`/week/${wk}/outputs`, '준비 상태'], [`/week/${wk}/after`, '설교 후 자료'],
          ['/people/list', '성도'], ['/people/visits', '심방'], ['/people/attendance', '출석'], ['/finance/ledger', '재정'], ['/finance/report', '보고서'], ['/finance/receipts', '영수증'], ['/finance/settings', '항목'],
          ['/admin/calendar', '일정'], ['/admin/minutes', '회의록'], ['/admin/serve', '봉사'], ['/admin/certs', '증명서'], ['/songs', '찬양 자료'], ['/apps', '프로그램'], ['/settings', '설정'], ['/guide', '사용설명서']];
        const bad = [];
        for (const [p, t] of pages) {
          await go(`${p}${p.includes('?') ? '&' : '?'}ws=sample`);
          const text = await page.evaluate(() => document.body.innerText);
          if (!text.includes(t)) bad.push(`${p}: "${t}" 없음`);
          const e = errors.filter((x) => !/Failed to load resource: the server responded with a status of 404/.test(x) || !/favicon/.test(x)); errors = [];
          if (e.length) bad.push(`${p}: 화면 오류 ${e[0]}`);
        }
        eq(bad, [], '문제가 있는 화면');
      }],
    ]);
  } finally {
    await browser.close().catch(() => {});
    await hub.stop(); await gh.close(); await ms.close();
    fs.rmSync(files, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

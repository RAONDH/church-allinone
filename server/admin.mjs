// 행정: 교회 일정 · 회의록 · 증명서 발급 대장. 라온 교회 올인원 자료 파일 안에 함께 저장 (외부로 보내지 않음).
import { uid } from './store.mjs';
import { normDate } from './people.mjs';
import { toIcs, parseIcs } from './ical.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { sttStatus, installModel, installEngine, transcribe, AUDIO_EXT } from './stt.mjs';
import { aiStatus, generate, LABELS } from './ai.mjs';
import { minutesPrompt, parseMinutesJson, SAMPLE_TRANSCRIPT, sampleMinutes } from './minutes-ai.mjs';

// 회의록 녹취·정리 작업 (뒤에서 돌고 화면이 상태를 다시 묻는다)
const mJobs = new Map();

// 이 컴퓨터 시간대 기준 오늘 (toISOString 은 UTC라 아침 9시 전엔 어제가 됨)
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const str = (v, n = 200) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
export const EVENT_KINDS = ['예배', '행사', '회의', '교육', '심방', '기타'];
export const CERT_TYPES = ['교인증명서', '세례증명서'];
export const DEFAULT_MEETINGS = ['당회', '제직회', '공동의회', '운영위원회', '구역장 모임', '교사 회의'];
const bad = (msg) => Object.assign(new Error(msg), { code: 400 });

export function cleanEvent(b) {
  const date = normDate(b.date);
  if (!date) throw bad('날짜를 넣어 주세요.');
  const title = str(b.title, 80).trim();
  if (!title) throw bad('일정 이름을 넣어 주세요.');
  let endDate = normDate(b.endDate);
  if (endDate && endDate < date) throw bad('끝나는 날이 시작하는 날보다 앞입니다.');
  if (endDate === date) endDate = '';
  const time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '';
  return { date, endDate, time, title, kind: EVENT_KINDS.includes(b.kind) ? b.kind : '기타', place: str(b.place, 80).trim(), memo: str(b.memo, 2000) };
}

export function cleanMinutes(b) {
  const date = normDate(b.date);
  if (!date) throw bad('회의 날짜를 넣어 주세요.');
  const meeting = str(b.meeting, 30).trim() || '회의';
  return {
    date, meeting, title: str(b.title, 100).trim(), place: str(b.place, 80).trim(), attendees: str(b.attendees, 1000),
    content: str(b.content, 30000), decisions: str(b.decisions, 10000), todos: str(b.todos, 10000), transcript: str(b.transcript, 500000),
    chair: str(b.chair, 30).trim(), recorder: str(b.recorder, 30).trim(),
  };
}

// 구글 캘린더 비공개 주소(iCal): https 이고 이 컴퓨터·사설망 주소가 아닌 .ics 주소만
export function checkIcsUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim().replace(/^webcal:/i, 'https:')); } catch { throw bad('주소 모양이 올바르지 않습니다. 구글 캘린더의 "iCal 형식의 비공개 주소"를 그대로 붙여 넣어 주세요.'); }
  if (u.protocol !== 'https:') throw bad('https 로 시작하는 주소만 쓸 수 있습니다.');
  // 구글 캘린더 전용 기능이라 구글 캘린더 주소만 받는다 (이 컴퓨터·사설망 같은 다른 곳을 부르지 못하게)
  if (u.hostname !== 'calendar.google.com' || u.port || u.username || u.password) throw bad('구글 캘린더 주소(https://calendar.google.com/…)만 쓸 수 있습니다.');
  if (!/\.ics$/i.test(u.pathname)) throw bad('주소가 .ics 로 끝나야 합니다. 구글 캘린더 설정의 "iCal 형식의 비공개 주소"를 복사해 주세요.');
  return u.toString();
}
const mask = (url) => { try { const u = new URL(url); return `${u.hostname}/…${u.pathname.slice(-12)}`; } catch { return ''; } };
const day = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };

export async function fetchGcal(g) {
  try {
    const r = await fetch(checkIcsUrl(g.url), { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Accept: 'text/calendar' } });
    if (r.status >= 300 && r.status < 400) throw new Error('구글 캘린더가 다른 주소로 넘기려 해서 멈췄습니다. 비공개 주소를 다시 복사해 주세요.');
    if (!r.ok) throw new Error(r.status === 404 ? '캘린더를 찾을 수 없습니다. 비공개 주소를 다시 복사해 주세요(주소를 재설정했다면 새 주소가 필요합니다).' : `구글 캘린더 응답 오류 (${r.status})`);
    const text = await r.text();
    if (text.length > 8e6) throw new Error('캘린더가 너무 큽니다.');
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('받은 내용이 캘린더 파일이 아닙니다. 비공개 주소가 맞는지 확인해 주세요.');
    const name = (text.match(/^X-WR-CALNAME:(.*)$/m)?.[1] || '').trim();
    Object.assign(g, { events: parseIcs(text, { from: day(-62), to: day(400) }), fetchedAt: Date.now(), error: '', name: name || g.name || '구글 캘린더' });
  } catch (e) {
    Object.assign(g, { error: e.name === 'TimeoutError' ? '구글 캘린더 응답이 없습니다. 인터넷 연결을 확인해 주세요.' : e.cause ? '인터넷에 연결하지 못했습니다.' : e.message, triedAt: Date.now() });
  }
  return g;
}
const url_download = (req) => /[?&]download=1/.test(req.url || '');
export const GCAL_COLORS = ['#1a73e8', '#d81b60', '#0b8043', '#f4511e', '#8e24aa', '#039be5', '#e67c73', '#7986cb', '#33b679', '#f6bf26'];
const gcalView = (g) => ({ id: g.id, where: mask(g.url), name: g.label || g.name || '구글 캘린더', googleName: g.name || '', color: g.color, hidden: !!g.hidden, fetchedAt: g.fetchedAt || 0, error: g.error || '', count: (g.events || []).length });

export async function adminApi({ sub, req, res, db, save, body, send, HttpError, sample = false, dataDir = '', ws = 'real' }) {
  let q;
  const s = (re) => sub.match(re);
  db.events ??= {}; db.minutes ??= {}; db.certs ??= {};
  if (db.gcal) { db.gcals = [{ id: uid(), color: '#1a73e8', ...db.gcal }]; delete db.gcal; }   // 예전 한 개 연결 → 목록으로
  db.gcals ??= []; db.meetingTypes ??= [...DEFAULT_MEETINGS];
  const wrap = (fn) => { try { return fn(); } catch (e) { throw e.code === 400 ? new HttpError(400, e.message) : e; } };
  // 일정·회의록은 같은 방식 (만들기·고치기·지우기)
  const crud = async (coll, path, clean, label) => {
    if (sub === path && req.method === 'POST') {
      const b = await body(req);
      const x = { id: uid(), ...wrap(() => clean(b)), createdAt: Date.now(), updatedAt: Date.now() };
      db[coll][x.id] = x; await save(); send(res, 200, { item: x }); return true;
    }
    if ((q = s(new RegExp(`^${path}/([a-f0-9]+)$`)))) {
      const x = db[coll][q[1]];
      if (!x) throw new HttpError(404, `${label}을 찾을 수 없습니다.`);
      if (req.method === 'PUT') { const b = await body(req); Object.assign(x, wrap(() => clean(b)), { updatedAt: Date.now() }); await save(); send(res, 200, { item: x }); return true; }
      if (req.method === 'DELETE') { delete db[coll][x.id]; await save(); send(res, 200, { ok: true }); return true; }
    }
    return false;
  };

  if (sub === '/admin' && req.method === 'GET') {
    send(res, 200, { events: Object.values(db.events), minutes: Object.values(db.minutes), certs: Object.values(db.certs), meetingTypes: db.meetingTypes, gcals: db.gcals.map(gcalView), gcalEvents: db.gcals.filter((g) => !g.hidden).flatMap((g) => (g.events || []).map((e) => ({ ...e, id: `${g.id}-${e.id}`, cal: g.id }))) });
    return true;
  }
  // 구글 캘린더 '가져오기'용 파일
  if (sub === '/events.ics' && req.method === 'GET') {
    const name = `${db.church?.name || '교회'} 일정`;
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="church-events.ics"; filename*=UTF-8''${encodeURIComponent(`${name}.ics`)}` });
    res.end(toIcs(Object.values(db.events).sort((a, b) => a.date.localeCompare(b.date)), { calName: name }));
    return true;
  }
  // 구글 캘린더 여러 개: 더하기 · 빼기 · 이름/색 · 지금 새로 받기
  const getCal = (id) => { const g = db.gcals.find((x) => x.id === id); if (!g) throw new HttpError(404, '연결된 캘린더를 찾을 수 없습니다.'); return g; };
  if (sub === '/gcals' && req.method === 'POST') {
    if (sample) throw new HttpError(400, '예제 자료에서는 구글 캘린더를 연결하지 않습니다. 오른쪽 위 \'우리 교회\'로 바꾼 뒤 연결해 주세요.');
    if (db.gcals.length >= 20) throw new HttpError(400, '캘린더는 20개까지 연결할 수 있습니다.');
    const b = await body(req);
    const url = wrap(() => checkIcsUrl(b.url));
    if (db.gcals.some((x) => x.url === url)) throw new HttpError(400, '이미 연결한 캘린더입니다.');
    const used = new Set(db.gcals.map((x) => x.color));
    const g = { id: uid(), url, events: [], color: GCAL_COLORS.find((c) => !used.has(c)) || GCAL_COLORS[db.gcals.length % GCAL_COLORS.length] };
    await fetchGcal(g);
    if (!g.fetchedAt) throw new HttpError(400, g.error);
    db.gcals.push(g);
    await save();
    send(res, 200, { gcal: gcalView(g) });
    return true;
  }
  if (sub === '/gcals/refresh' && req.method === 'POST') {
    for (const g of db.gcals) await fetchGcal(g);
    await save();
    send(res, 200, { gcals: db.gcals.map(gcalView) });
    return true;
  }
  if ((q = s(/^\/gcals\/([a-f0-9]+)$/))) {
    const g = getCal(q[1]);
    if (req.method === 'PUT') {
      const b = await body(req);
      if (b.label !== undefined) g.label = str(b.label, 40).trim();
      if (GCAL_COLORS.includes(b.color)) g.color = b.color;
      if (b.hidden !== undefined) g.hidden = !!b.hidden;
      await save(); send(res, 200, { gcal: gcalView(g) }); return true;
    }
    if (req.method === 'DELETE') { db.gcals = db.gcals.filter((x) => x.id !== g.id); await save(); send(res, 200, { ok: true }); return true; }
  }
  if (await crud('events', '/events', cleanEvent, '일정')) return true;
  const recDir = path.join(dataDir, 'recordings', ws);
  const audioFile = (m) => (m?.audio?.file ? path.join(recDir, path.basename(m.audio.file)) : '');
  if ((q = s(/^\/minutes\/([a-f0-9]+)$/)) && req.method === 'DELETE' && db.minutes[q[1]]) {
    const f = audioFile(db.minutes[q[1]]); if (f) fs.rmSync(f, { force: true });   // 회의록을 지우면 녹음 파일도 함께
  }
  // 회의록에 새 회의 이름을 쓰면 회의 이름 목록에도 더한다
  const cleanAndRemember = (b) => { const x = cleanMinutes(b); if (!db.meetingTypes.includes(x.meeting) && x.meeting !== '회의') db.meetingTypes.push(x.meeting); return x; };
  if (await crud('minutes', '/minutes', cleanAndRemember, '회의록')) return true;

  // 회의 이름 고치기: 더하기 · 이름 바꾸기(이미 쓴 회의록도 함께) · 순서 · 빼기(회의록은 그대로)
  if (sub === '/meeting-types' && req.method === 'POST') {
    const b = await body(req);
    const list = db.meetingTypes, name = str(b.name, 30).trim(), to = str(b.to, 30).trim();
    const used = (n) => Object.values(db.minutes).filter((m) => m.meeting === n);
    if (b.op === 'add') {
      if (!name) throw new HttpError(400, '회의 이름을 넣어 주세요.');
      if (list.includes(name)) throw new HttpError(400, `'${name}'은(는) 이미 있습니다.`);
      list.push(name);
    } else if (b.op === 'rename') {
      const i = list.indexOf(name);
      if (i < 0) throw new HttpError(404, '회의 이름을 찾을 수 없습니다.');
      if (!to) throw new HttpError(400, '새 이름을 넣어 주세요.');
      if (to !== name && list.includes(to)) throw new HttpError(400, `'${to}'은(는) 이미 있습니다.`);
      list[i] = to;
      for (const m of used(name)) { m.meeting = to; m.updatedAt = Date.now(); }
    } else if (b.op === 'move') {
      const i = list.indexOf(name), j = i + (b.dir < 0 ? -1 : 1);
      if (i >= 0 && j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
    } else if (b.op === 'remove') {
      db.meetingTypes = list.filter((x) => x !== name);
    } else throw new HttpError(400, '알 수 없는 작업입니다.');
    await save();
    send(res, 200, { meetingTypes: db.meetingTypes, count: used(b.op === 'rename' ? to : name).length });
    return true;
  }

  // ── 회의록 작성기: 녹취 준비 · 녹음 파일 · 녹취 · AI 정리 ──
  if (sub === '/stt' && req.method === 'GET') {
    const jobs = Object.fromEntries([...mJobs].filter(([k]) => k.startsWith(ws + ':')).map(([k, v]) => [k.split(':')[1], v]));
    send(res, 200, { ...sttStatus(), sample, jobs });
    return true;
  }
  if ((q = s(/^\/stt\/model\/(\w+)$/)) && req.method === 'POST') { wrap(() => installModel(q[1])); send(res, 200, { ok: true }); return true; }
  if (sub === '/stt/engine' && req.method === 'POST') { wrap(() => installEngine()); send(res, 200, { ok: true }); return true; }

  const getM = (id) => { const m = db.minutes[id]; if (!m) throw new HttpError(404, '회의록을 찾을 수 없습니다.'); return m; };
  if ((q = s(/^\/minutes\/([a-f0-9]+)\/audio$/))) {
    const m = getM(q[1]);
    if (req.method === 'POST') {
      // 녹음 파일 올리기: 몸통을 그대로 파일로 (JSON 아님). 최대 2GB
      const name = decodeURIComponent(String(req.headers['x-file-name'] || 'recording.wav')).slice(0, 120);
      const ext = (name.match(/\.(\w+)$/)?.[1] || '').toLowerCase();
      if (!AUDIO_EXT.includes(ext)) throw new HttpError(400, `${ext || '이'} 형식은 바로 녹취할 수 없습니다. wav·mp3·ogg·flac 으로 올려 주세요.`);
      fs.mkdirSync(recDir, { recursive: true });
      const file = path.join(recDir, `${m.id}.${ext}`), part = `${file}.part`;
      let n = 0;
      const out = fs.createWriteStream(part);
      try {
        for await (const c of req) { n += c.length; if (n > 2e9) throw new HttpError(413, '녹음 파일이 2GB보다 큽니다.'); if (!out.write(c)) await new Promise((ok) => out.once('drain', ok)); }
        await new Promise((ok, no) => out.end((e) => (e ? no(e) : ok())));
      } catch (e) { out.destroy(); fs.rmSync(part, { force: true }); throw e; }
      if (!n) { fs.rmSync(part, { force: true }); throw new HttpError(400, '빈 파일입니다.'); }
      const old = audioFile(m); if (old && old !== file) fs.rmSync(old, { force: true });
      fs.renameSync(part, file);
      m.audio = { file: path.basename(file), name, size: n, at: Date.now() };
      await save();
      send(res, 200, { audio: m.audio });
      return true;
    }
    if (req.method === 'GET') {
      const f = audioFile(m);
      if (!f || !fs.existsSync(f)) throw new HttpError(404, '녹음 파일이 없습니다.');
      const size = fs.statSync(f).size, type = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac' }[path.extname(f).slice(1)] || 'application/octet-stream';
      const range = String(req.headers.range || '').match(/bytes=(\d*)-(\d*)/);
      if (range) {
        const a = range[1] ? +range[1] : 0, b = range[2] ? Math.min(+range[2], size - 1) : size - 1;
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 });
        fs.createReadStream(f, { start: a, end: b }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', ...(url_download(req) ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(m.audio.name)}` } : {}) });
        fs.createReadStream(f).pipe(res);
      }
      return true;
    }
    if (req.method === 'DELETE') {
      const f = audioFile(m); if (f) fs.rmSync(f, { force: true });
      delete m.audio; await save(); send(res, 200, { ok: true }); return true;
    }
  }
  // 녹취 (끝나면 auto=true 일 때 이어서 AI 정리)
  if ((q = s(/^\/minutes\/([a-f0-9]+)\/(transcribe|summarize)$/)) && req.method === 'POST') {
    const m = getM(q[1]), what = q[2], key = `${ws}:${m.id}`;
    if (mJobs.get(key) && !mJobs.get(key).error) { send(res, 200, { job: mJobs.get(key) }); return true; }
    const b = await body(req);
    let provider = 'sample';
    const wantAi = what === 'summarize' || b.auto;
    if (!sample && wantAi) {
      const st = await aiStatus(true);
      provider = (b.provider === 'claude' || b.provider === 'codex') && st[b.provider].loggedIn ? b.provider : st.provider;
      if (!provider && what === 'summarize') throw new HttpError(400, '이 컴퓨터에 로그인된 AI 구독이 없습니다. Claude Code(claude) 또는 Codex(codex login)에 로그인해 주세요.');
    }
    if (what === 'transcribe' && !sample) {
      const st = sttStatus();
      if (!st.engine) throw new HttpError(400, '녹취 엔진(whisper)이 없습니다. "녹취 준비"를 먼저 해 주세요.');
      if (!Object.values(st.models).some((x) => x.ready)) throw new HttpError(400, '녹취 모델이 없습니다. "녹취 준비"에서 모델을 받아 주세요.');
      if (!audioFile(m) || !fs.existsSync(audioFile(m))) throw new HttpError(400, '녹음 파일이 없습니다.');
    }
    if (what === 'summarize' && !(m.transcript || '').trim()) throw new HttpError(400, '녹취록이 비어 있습니다. 녹취를 하거나 녹취록 글을 붙여 넣어 주세요.');
    const job = { stage: what, progress: 0, startedAt: Date.now(), error: '', label: provider === 'sample' ? '예제' : LABELS[provider] || '' };
    mJobs.set(key, job);
    (async () => {
      try {
        if (what === 'transcribe') {
          let r;
          if (sample) { for (let i = 1; i <= 4; i++) { await new Promise((ok) => setTimeout(ok, 500)); job.progress = i * 25; } r = { text: SAMPLE_TRANSCRIPT, seconds: 480, model: 'sample' }; }
          else r = await transcribe(audioFile(m), b.model, (p) => { job.progress = p; });
          if (!db.minutes[m.id]) return;
          Object.assign(m, { transcript: r.text, stt: { at: Date.now(), model: r.model, seconds: r.seconds }, updatedAt: Date.now() });
          await save();
          if (!b.auto || !provider) { mJobs.delete(key); return; }
          Object.assign(job, { stage: 'summarize', progress: 0, startedAt: Date.now() });
        }
        let out;
        if (sample) { await new Promise((ok) => setTimeout(ok, 1200)); out = sampleMinutes(); }
        else {
          const { system, prompt } = minutesPrompt({ church: db.church?.name || '', meeting: m.meeting, date: m.date, attendees: m.attendees, transcript: m.transcript.slice(0, 200000) });
          out = parseMinutesJson(await generate(provider, system, prompt));
        }
        if (!db.minutes[m.id]) return;
        // 이미 손으로 적어 둔 칸은 덮지 않고, 비어 있거나 기본 순서만 있는 칸만 채운다
        const blankish = (v) => !String(v || '').trim() || /^1\. 개회 기도\n2\. 지난 회의록/.test(String(v));
        Object.assign(m, {
          content: blankish(m.content) || b.overwrite ? out.content : m.content,
          decisions: !m.decisions?.trim() || b.overwrite ? out.decisions : m.decisions,
          todos: !m.todos?.trim() || b.overwrite ? out.todos : m.todos,
          title: m.title || out.title, attendees: m.attendees || out.attendees,
          ai: { at: Date.now(), via: job.label }, updatedAt: Date.now(),
        });
        await save();
        mJobs.delete(key);
      } catch (e) {
        console.error('회의록 작성기 실패:', e.message);
        Object.assign(job, { error: e.message || '처리하지 못했습니다.' });
      }
    })();
    send(res, 200, { job });
    return true;
  }

  // 증명서 발급: 대장에 남기고 발급번호(연도-순번)를 매긴다. 내용은 그때의 성도 정보로 고정.
  if (sub === '/certs' && req.method === 'POST') {
    const b = await body(req);
    if (!CERT_TYPES.includes(b.type)) throw new HttpError(400, '증명서 종류를 골라 주세요.');
    const m = db.members?.[b.memberId];
    if (!m) throw new HttpError(404, '성도를 찾을 수 없습니다.');
    if (b.type === '세례증명서' && !['세례', '유아세례', '입교'].includes(m.baptism)) throw new HttpError(400, `${m.name} 님은 성도 명부에 세례 기록이 없습니다. 성도 명부에서 세례를 먼저 적어 주세요.`);
    const date = localDay();
    const year = date.slice(0, 4);
    const seq = Object.values(db.certs).filter((c) => c.no.startsWith(year)).length + 1;
    const c = {
      id: uid(), no: `${year}-${String(seq).padStart(3, '0')}`, type: b.type, date, purpose: str(b.purpose, 60).trim() || '제출용',
      memberId: m.id,
      snap: { name: m.name, gender: m.gender, birth: m.birth, address: m.address, role: m.role, registeredAt: m.registeredAt, baptism: m.baptism, baptismDate: m.baptismDate || '', baptismPlace: m.baptismPlace || '', baptismBy: m.baptismBy || '' },
      createdAt: Date.now(),
    };
    db.certs[c.id] = c;
    await save();
    send(res, 200, { cert: c });
    return true;
  }
  return false;
}

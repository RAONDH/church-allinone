// 일정 파일(iCalendar, .ics) 만들기와 읽기.
// - 만들기: 라온 교회 올인원 일정을 구글 캘린더 '가져오기'용 파일로
// - 읽기: 구글 캘린더 '비공개 주소(iCal)'에서 받은 일정을 달력에 함께 보여 주기 (반복 일정 펼치기 포함)
export const UID_SUFFIX = '@church-allinone';

const pad = (n, w = 2) => String(n).padStart(w, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const compact = (s) => s.replace(/-/g, '');
export const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';

// ── 만들기 ─────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
// 한 줄 75바이트 넘으면 접기 (한글이 깨지지 않게 글자 단위로)
function fold(line) {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function toIcs(events, { calName = '교회 일정', tz = localTz(), now = new Date() } = {}) {
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Raon//Church All-in-One//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(calName)}`, `X-WR-TIMEZONE:${tz}`];
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${e.id}${UID_SUFFIX}`, `DTSTAMP:${stamp}`);
    if (e.time) {
      // 시간이 있으면 1시간 일정으로 (여러 날이면 끝나는 날 같은 시각까지)
      const [h, m] = e.time.split(':').map(Number);
      const end = e.endDate ? `${compact(e.endDate)}T${pad(h)}${pad(m)}00` : (() => { const d = new Date(`${e.date}T${e.time}:00`); d.setHours(d.getHours() + 1); return `${compact(ymd(d))}T${pad(d.getHours())}${pad(d.getMinutes())}00`; })();
      L.push(`DTSTART;TZID=${tz}:${compact(e.date)}T${pad(h)}${pad(m)}00`, `DTEND;TZID=${tz}:${end}`);
    } else {
      L.push(`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(addDays(e.endDate || e.date, 1))}`);
    }
    L.push(`SUMMARY:${esc(e.title)}`);
    if (e.place) L.push(`LOCATION:${esc(e.place)}`);
    if (e.memo || e.kind) L.push(`DESCRIPTION:${esc([e.kind && `[${e.kind}]`, e.memo].filter(Boolean).join(' '))}`);
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

// ── 읽기 ─────────────────────────────────────────
const unesc = (s) => s.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

function tzOffsetMs(utcMs, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
  } catch { return null; }
}

/** DTSTART 같은 값을 이 컴퓨터 시각으로: { date, time, allDay } */
export function parseWhen(value, params = {}) {
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined || params.VALUE === 'DATE') return { date: `${y}-${mo}-${d}`, time: '', allDay: true };
  let t;
  if (z) t = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  else if (params.TZID && params.TZID !== localTz()) {
    const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
    const off = tzOffsetMs(guess, params.TZID);
    t = new Date(off === null ? new Date(+y, +mo - 1, +d, +h, +mi).getTime() : guess - off);
  } else t = new Date(+y, +mo - 1, +d, +h, +mi);
  return { date: ymd(t), time: `${pad(t.getHours())}:${pad(t.getMinutes())}`, allDay: false };
}

function parseLines(text) {
  const raw = String(text).replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (const l of raw) { if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l.slice(1); else if (l) lines.push(l); }
  return lines.map((l) => {
    const i = l.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    if (i < 0) return null;
    const [name, ...ps] = l.slice(0, i).split(';');
    const params = Object.fromEntries(ps.map((p) => { const [k, ...v] = p.split('='); return [k.toUpperCase(), v.join('=').replace(/^"|"$/g, '')]; }));
    return { name: name.toUpperCase(), params, value: l.slice(i + 1) };
  }).filter(Boolean);
}

/** VEVENT 목록 (속성 그대로) */
function vevents(text) {
  const out = []; let cur = null, depth = 0;
  for (const p of parseLines(text)) {
    if (p.name === 'BEGIN' && p.value === 'VEVENT') { cur = { props: {}, exdates: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (p.name === 'BEGIN') { depth++; continue; }   // VALARM 같은 안쪽 묶음은 건너뜀
    if (p.name === 'END' && depth) { depth--; continue; }
    if (p.name === 'END' && p.value === 'VEVENT') { out.push(cur); cur = null; continue; }
    if (depth) continue;
    if (p.name === 'EXDATE') { for (const v of p.value.split(',')) { const w = parseWhen(v, p.params); if (w) cur.exdates.push(w.date); } continue; }
    if (!cur.props[p.name]) cur.props[p.name] = p;
  }
  return out;
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function parseRule(s) {
  const r = Object.fromEntries(s.split(';').map((x) => x.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
  return {
    freq: r.FREQ, interval: Math.max(1, +r.INTERVAL || 1), count: r.COUNT ? +r.COUNT : null,
    until: r.UNTIL ? parseWhen(r.UNTIL)?.date || null : null,
    byday: r.BYDAY ? r.BYDAY.split(',').map((x) => { const m = x.match(/^([+-]?\d+)?([A-Z]{2})$/); return m ? { n: m[1] ? +m[1] : 0, wd: DAYS.indexOf(m[2]) } : null; }).filter(Boolean) : [],
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : [],
    bymonth: r.BYMONTH ? r.BYMONTH.split(',').map(Number) : [],
  };
}
const dayNum = (s) => Math.round(new Date(s + 'T00:00:00Z').getTime() / 86400000);

/** 반복 규칙으로 start부터 날짜를 펼친다 (from~to 안의 것만 돌려줌) */
export function expandRule(start, rule, from, to, exdates = []) {
  const r = typeof rule === 'string' ? parseRule(rule) : rule;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq)) return start >= from && start <= to ? [start] : [];
  const s = new Date(start + 'T00:00:00Z');
  const sd = dayNum(start), sWeek = Math.floor((sd + 3) / 7);   // 월요일 기준 주 번호 (1970-01-01은 목요일)
  const ex = new Set(exdates), out = [];
  let n = 0;
  const end = r.until && r.until < to ? r.until : to;
  for (let day = sd, i = 0; i < 40000; day++, i++) {
    const d = new Date(day * 86400000), ds = d.toISOString().slice(0, 10);
    if (ds > end) break;
    const wd = d.getUTCDay(), dom = d.getUTCDate(), mon = d.getUTCMonth() + 1;
    const months = (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + d.getUTCMonth() - s.getUTCMonth();
    let ok = false;
    if (r.freq === 'DAILY') ok = (day - sd) % r.interval === 0 && (!r.byday.length || r.byday.some((b) => b.wd === wd));
    else if (r.freq === 'WEEKLY') ok = (Math.floor((day + 3) / 7) - sWeek) % r.interval === 0 && (r.byday.length ? r.byday.some((b) => b.wd === wd) : wd === s.getUTCDay());
    else if (r.freq === 'MONTHLY' || r.freq === 'YEARLY') {
      const inPeriod = r.freq === 'MONTHLY' ? months % r.interval === 0 : (d.getUTCFullYear() - s.getUTCFullYear()) % r.interval === 0 && (r.bymonth.length ? r.bymonth.includes(mon) : mon === s.getUTCMonth() + 1);
      if (inPeriod) {
        const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        if (r.bymonthday.length) ok = r.bymonthday.some((x) => (x > 0 ? x : last + 1 + x) === dom);
        else if (r.byday.length) ok = r.byday.some((b) => b.wd === wd && (!b.n || (b.n > 0 ? Math.ceil(dom / 7) === b.n : Math.ceil((last - dom + 1) / 7) === -b.n)));
        else ok = dom === s.getUTCDate();
      }
    }
    if (!ok) continue;
    n++;
    if (r.count && n > r.count) break;
    if (ds >= from && !ex.has(ds)) out.push(ds);
  }
  return out;
}

/** 받은 .ics 글을 달력용 일정 목록으로. from~to 기간만, 우리가 내보낸 일정(UID 끝이 @church-allinone)은 빼서 겹치지 않게. */
export function parseIcs(text, { from, to }) {
  const evs = vevents(text);
  const overrides = new Map();   // 반복 일정 중 따로 바뀐 날
  for (const e of evs) if (e.props['RECURRENCE-ID']) {
    const w = parseWhen(e.props['RECURRENCE-ID'].value, e.props['RECURRENCE-ID'].params);
    if (w) (overrides.get(e.props.UID?.value) || overrides.set(e.props.UID?.value, new Set()).get(e.props.UID?.value)).add(w.date);
  }
  const out = [];
  for (const e of evs) {
    const P = e.props, uid = P.UID?.value || '';
    if (uid.endsWith(UID_SUFFIX) || P.STATUS?.value === 'CANCELLED' || !P.DTSTART) continue;
    const st = parseWhen(P.DTSTART.value, P.DTSTART.params);
    if (!st) continue;
    let span = 0;
    if (P.DTEND) {
      const en = parseWhen(P.DTEND.value, P.DTEND.params);
      if (en) span = Math.max(0, dayNum(en.date) - dayNum(st.date) - (st.allDay || en.time === '00:00' ? 1 : 0));
    }
    const base = { title: unesc(P.SUMMARY?.value || '(제목 없음)').slice(0, 120), place: unesc(P.LOCATION?.value || '').slice(0, 120), memo: unesc(P.DESCRIPTION?.value || '').slice(0, 1000), time: st.time };
    const dates = P.RRULE && !P['RECURRENCE-ID']
      ? expandRule(st.date, P.RRULE.value, addDays(from, -span), to, [...e.exdates, ...(overrides.get(uid) || [])])
      : (st.date <= to && addDays(st.date, span) >= from ? [st.date] : []);
    for (const d of dates) out.push({ id: `g${out.length}-${d}`, date: d, endDate: span ? addDays(d, span) : '', ...base });
    if (out.length > 3000) break;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

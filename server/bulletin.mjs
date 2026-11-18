// 주보: 이미 입력한 자료(예배 순서·본문·설교 제목·대표 기도·찬양·설교 요약·광고·봉사·일정)를 모아
// A4 가로 2단 인쇄용(반으로 접기) 또는 휴대폰 주보(카톡으로 나누는 웹페이지 파일)로 만든다. AI 를 쓰지 않는다.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
const lines = (s) => esc(s).split('\n').join('<br>');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const day = (d) => { const x = new Date(`${d}T00:00:00`); return `${x.getMonth() + 1}월 ${x.getDate()}일 (${DOW[x.getDay()]})`; };
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
export const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const BULLETIN_DEFAULTS = { address: '', phone: '', worshipTimes: '', account: '', motto: '', mottoVerse: '', showOrder: true, showSummary: true, showServe: true, showEvents: true, showBirthdays: false };
export function cleanBulletinSettings(b = {}) {
  const t = (k, n) => str(b[k], n).trim();
  const flag = (k) => (b[k] === undefined ? BULLETIN_DEFAULTS[k] : !!b[k]);
  return {
    address: t('address', 200), phone: t('phone', 60), worshipTimes: t('worshipTimes', 600), account: t('account', 120), motto: t('motto', 100), mottoVerse: t('mottoVerse', 200),
    showOrder: flag('showOrder'), showSummary: flag('showSummary'), showServe: flag('showServe'), showEvents: flag('showEvents'), showBirthdays: flag('showBirthdays'),
  };
}

/** 주보용 설교 요약(마크다운)에서 본문 문단과 핵심 문장만 꺼낸다 */
export function summaryParts(markdown) {
  const parts = String(markdown || '').replace(/\r/g, '').split(/\n(?=## )/);
  const body = (parts[0] || '').split('\n').filter((l) => l.trim() && !/^#\s/.test(l) && !/ · /.test(l) && !/^\S+ \| /.test(l)).join('\n').trim();
  const key = (parts.find((p) => /^## 핵심 문장/.test(p)) || '').split('\n').slice(1).map((l) => l.replace(/^>\s?/, '')).join(' ').trim();
  return { body, key };
}

/** 주보에 들어갈 자료 모으기 (db 와 예배 순서에서) */
/** hide: { people, admin } — 잠금이 걸린 동안은 성도·행정에서 온 내용(생일·봉사자 이름·일정)을 넣지 않는다 */
export function bulletinData({ db, week, order, hide = {} }) {
  const s = { ...BULLETIN_DEFAULTS, ...(db.bulletin || {}) };
  const date = week.date;
  const serveOn = (from, to) => {
    const sv = db.serve; if (!sv) return null;
    const d = Object.keys(sv.plan || {}).filter((x) => x >= from && x <= to).sort()[0];
    if (!d) return null;
    const who = (x) => db.members?.[x]?.name ?? x;
    const rows = sv.roles.map((r) => ({ role: r.name, who: (sv.plan[d][r.id] || []).map(who) })).filter((r) => r.who.length);
    return rows.length ? { date: d, rows } : null;
  };
  const birthdays = Object.values(db.members || {}).filter((m) => (m.status === 'active' || m.status === 'inactive') && /^(\d{4}-)?\d{2}-\d{2}$/.test(m.birth || ''))
    .map((m) => { const mmdd = m.birth.slice(-5); const y = date.slice(0, 4); let d = `${y}-${mmdd}`; if (d < date) d = `${+y + 1}-${mmdd}`; return { name: m.name, date: d }; })
    .filter((b) => b.date <= addDays(date, 6)).sort((a, b) => a.date.localeCompare(b.date));
  const events = Object.values(db.events || {}).filter((e) => e.date > date && e.date <= addDays(date, 7)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const sum = summaryParts(db.after?.[week.id]?.summary?.content);
  const hideServe = hide.people || hide.admin;
  return { s, church: db.church || {}, week, order: order || [], summary: sum, serveThis: hideServe ? null : serveOn(date, addDays(date, 6)), serveNext: hideServe ? null : serveOn(addDays(date, 7), addDays(date, 13)), birthdays: hide.people ? [] : birthdays, events: hide.admin ? [] : events, hidden: !!(hide.people || hide.admin) };
}

export function bulletinHtml(d, format = 'print') {
  const { s, church, week: w } = d;
  const songs = d.order.filter((i) => i.type === 'song' || i.type === 'score');
  const sec = (title, inner) => (inner ? `<section><h3>${esc(title)}</h3>${inner}</section>` : '');
  const orderHtml = s.showOrder && d.order.length
    ? `<ol class="order">${d.order.map((i) => `<li><span>${esc(i.title)}</span>${i.type === 'song' || i.type === 'score' ? '<em>찬양</em>' : ''}</li>`).join('')}</ol>` : '';
  const sermon = `<div class="sermon">${w.passage ? `<p class="passage">${esc(w.passage)}</p>` : ''}${w.sermonTitle ? `<p class="title">「${esc(w.sermonTitle)}」</p>` : ''}${church.pastor ? `<p class="by">${esc(/(목사|전도사|선교사)$/.test(church.pastor.trim()) ? church.pastor : `${church.pastor} 목사`)}</p>` : ''}${w.prayerLeader ? `<p class="small">대표 기도: ${esc(w.prayerLeader)}</p>` : ''}${!orderHtml && songs.length ? `<p class="small">찬양: ${songs.map((x) => esc(x.title)).join(', ')}</p>` : ''}</div>`;
  const summary = s.showSummary && (d.summary.body || d.summary.key) ? `${d.summary.key ? `<blockquote>${esc(d.summary.key)}</blockquote>` : ''}${d.summary.body ? `<p>${lines(d.summary.body)}</p>` : ''}` : '';
  const ann = (w.announcements || []).length ? `<ol class="ann">${w.announcements.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : '';
  const serveTable = (x) => `<table class="serve"><tbody>${x.rows.map((r) => `<tr><th>${esc(r.role)}</th><td>${r.who.map(esc).join(', ')}</td></tr>`).join('')}</tbody></table>`;
  const serve = s.showServe && (d.serveThis || d.serveNext)
    ? `${d.serveThis ? `<p class="small b">이번 주 (${md(d.serveThis.date)})</p>${serveTable(d.serveThis)}` : ''}${d.serveNext ? `<p class="small b">다음 주 (${md(d.serveNext.date)})</p>${serveTable(d.serveNext)}` : ''}` : '';
  const events = s.showEvents && d.events.length ? `<ul class="ev">${d.events.map((e) => `<li><b>${md(e.date)}${e.time ? ` ${esc(e.time)}` : ''}</b> ${esc(e.title)}${e.place ? ` · ${esc(e.place)}` : ''}</li>`).join('')}</ul>` : '';
  const births = s.showBirthdays && d.birthdays.length ? `<p>${d.birthdays.map((b) => `${md(b.date)} ${esc(b.name)}`).join(' · ')}</p>` : '';
  const info = [s.worshipTimes && `<p class="times">${lines(s.worshipTimes)}</p>`, s.address && `<p>${esc(s.address)}</p>`, s.phone && `<p>☎ ${esc(s.phone)}</p>`, s.account && `<p>헌금 계좌 ${esc(s.account)}</p>`].filter(Boolean).join('');
  const head = `<header><p class="church">${esc(church.name || '')}</p>${s.motto ? `<p class="motto">${esc(s.motto)}</p>` : ''}${s.mottoVerse ? `<p class="small">${esc(s.mottoVerse)}</p>` : ''}<p class="date">${day(w.date)} · ${esc(w.name || '주일 예배')}</p></header>`;
  const left = `${head}${sec('예배 순서', orderHtml)}${sec('오늘의 말씀', sermon)}${sec('설교 요약', summary)}`;
  const right = `${d.hidden ? '<p class="small" style="color:#a33">🔒 잠금이 걸려 있어 생일·봉사·일정은 넣지 않았습니다. 잠금을 풀고 다시 열어 주세요.</p>' : ''}${sec('교회 소식', ann)}${sec('섬기는 분들', serve)}${sec('다음 주 일정', events)}${sec('생일을 축하합니다', births)}${info ? `<section class="info">${info}</section>` : ''}`;
  const title = `${church.name || '교회'} 주보 ${w.date}`;
  const css = `:root{--a:#2f5d50;--ink:#222;--muted:#666}*{box-sizing:border-box}body{margin:0;color:var(--ink);font:15px/1.6 'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;background:#f3f1ec}
header{text-align:center;border-bottom:2px solid var(--a);padding-bottom:8px;margin-bottom:10px}.church{font-size:1.5rem;font-weight:800;margin:0;color:var(--a)}.motto{margin:2px 0;font-weight:700}.date{margin:4px 0 0;color:var(--muted)}
section{margin:0 0 12px}h3{font-size:1rem;margin:0 0 6px;color:var(--a);border-left:4px solid var(--a);padding-left:8px}
.order{list-style:none;padding:0;margin:0}.order li{display:flex;justify-content:space-between;border-bottom:1px dotted #bbb;padding:2px 0}.order em{font-style:normal;color:var(--muted);font-size:.85em}
.sermon{text-align:center}.sermon p{margin:2px 0}.passage{font-weight:700}.title{font-size:1.15rem;font-weight:800}.by{color:var(--muted)}
blockquote{margin:0 0 6px;padding:6px 10px;background:#eef3f0;border-radius:6px;font-weight:700}.ann{padding-left:1.2em;margin:0}.ann li{margin:2px 0}
table.serve{width:100%;border-collapse:collapse;font-size:.9em;margin-bottom:6px}.serve th{text-align:left;width:5.5em;color:var(--muted);font-weight:400;padding:2px 4px}.serve td{padding:2px 4px;border-bottom:1px dotted #ddd}
.ev{list-style:none;padding:0;margin:0}.small{font-size:.85em}.b{font-weight:700;margin:4px 0 2px}.info{border-top:1px solid #ccc;padding-top:8px;font-size:.85em;color:var(--muted);text-align:center}.info p{margin:2px 0}.times{color:var(--ink)}
.tools{position:fixed;right:12px;top:12px;display:flex;gap:6px}.tools button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid #999;background:#fff;cursor:pointer}`;
  if (format === 'mobile') {
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}
.m{max-width:560px;margin:0 auto;background:#fff;padding:18px 16px 30px;min-height:100vh}</style></head><body><main class="m">${left}${right}</main></body></html>`;
  }
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}
@page{size:A4 landscape;margin:8mm}.sheet{width:281mm;min-height:194mm;margin:12px auto;background:#fff;display:grid;grid-template-columns:1fr 1fr;gap:10mm;padding:6mm;box-shadow:0 1px 6px #0002;font-size:11.5px;line-height:1.45}.sheet section{margin-bottom:8px}.sheet .order li{padding:0}.sheet header{margin-bottom:6px;padding-bottom:4px}.sheet .church{font-size:1.35rem}
.sheet>div{overflow:hidden}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;padding:0;width:auto;min-height:0}.tools{display:none}}</style></head>
<body><div class="tools"><button onclick="print()">인쇄</button></div><div class="sheet"><div>${left}</div><div>${right}</div></div></body></html>`;
}

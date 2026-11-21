// 주보: 이미 입력한 자료(예배 순서·본문·설교 제목·대표 기도·찬양·설교 요약·광고·봉사·일정)를 모아
// A4 가로 2단 인쇄용(한 면), 접는 4면(A4 가로 앞뒤로 인쇄해 반으로 접기), 휴대폰 주보(카톡으로 나누는 웹페이지 파일)로 만든다. AI 를 쓰지 않는다.
import crypto from 'node:crypto';
import { lunarToSolar } from './lunar.mjs';
import { cleanStyleSettings, themeCss } from './bulletinStyle.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
const lines = (s) => esc(s).split('\n').join('<br>');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const day = (d) => { const x = new Date(`${d}T00:00:00`); return `${x.getMonth() + 1}월 ${x.getDate()}일 (${DOW[x.getDay()]})`; };
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
export const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const BULLETIN_DEFAULTS = { address: '', phone: '', worshipTimes: '', account: '', motto: '', mottoVerse: '', logo: '', coverPhoto: '', coverBanner: true, autoFill: true, showOrder: true, showSummary: true, showServe: true, showEvents: true, showBirthdays: false };

// 주보의 칸: [id, 제목, 켜고 끄는 예전 설정 이름]. 표지(교회 이름·날짜)는 늘 맨 위(4면은 1면)에 있다
export const BLOCKS = [
  ['order', '예배 순서', 'showOrder'], ['sermon', '오늘의 말씀', null], ['summary', '설교 요약', 'showSummary'], ['ann', '교회 소식', null], ['photo', '사진·포스터', null],
  ['serve', '섬기는 분들', 'showServe'], ['events', '다음 주 일정', 'showEvents'], ['births', '생일을 축하합니다', 'showBirthdays'], ['info', '교회 안내', null],
];
const TITLE = Object.fromEntries(BLOCKS.map(([id, t]) => [id, t]));
// 기본 배치 = 지금까지의 주보 모양 (2단: 왼쪽 L·오른쪽 R / 접는 4면: 2·3·4면)
const DEFAULT_PLACE = { order: ['L', 2], sermon: ['L', 2], summary: ['L', 3], ann: ['R', 3], photo: ['R', 3], serve: ['R', 4], events: ['R', 4], births: ['R', 4], info: ['R', 4] };
/** 칸 배치 정리: 순서대로 { id, on, col: 'L'|'R', face: 2|3|4, size: 's'|'n'|'l'|'xl' (작게·보통·크게·아주 크게) }. 모르는 칸은 빼고 빠진 칸은 기본 자리로 뒤에 붙인다 */
export const SIZES = ['s', 'n', 'l', 'xl'];
const SIZE_CLASS = { s: 'sm', n: '', l: 'lg', xl: 'xl' };
export function cleanLayout(raw) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || !TITLE[x.id] || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push({ id: x.id, on: x.on !== false, col: x.col === 'R' ? 'R' : 'L', face: [2, 3, 4].includes(+x.face) ? +x.face : DEFAULT_PLACE[x.id][1], size: SIZES.includes(x.size) ? x.size : 'n' });
  }
  for (const [id, , flag] of BLOCKS) if (!seen.has(id)) out.push({ id, on: flag ? BULLETIN_DEFAULTS[flag] : true, col: DEFAULT_PLACE[id][0], face: DEFAULT_PLACE[id][1], size: 'n' });
  return out;
}
export function cleanBulletinSettings(b = {}) {
  const t = (k, n) => str(b[k], n).trim();
  // 칸을 켜고 끄는 예전 설정(showOrder 등)이 오면 그것이 이긴다 (예전 화면·자료와 맞게)
  const layout = cleanLayout(b.layout);
  for (const it of layout) { const flag = BLOCKS.find(([id]) => id === it.id)[2]; if (flag && b[flag] !== undefined) it.on = !!b[flag]; }
  const on = (id) => layout.find((x) => x.id === id).on;
  return {
    address: t('address', 200), phone: t('phone', 60), worshipTimes: t('worshipTimes', 600), account: t('account', 120), motto: t('motto', 100), mottoVerse: t('mottoVerse', 200), logo: IMG_ID.test(b.logo || '') ? b.logo : '', coverPhoto: IMG_ID.test(b.coverPhoto || '') ? b.coverPhoto : '', coverBanner: b.coverBanner !== false, autoFill: b.autoFill !== false, ...cleanStyleSettings(b),
    showOrder: on('order'), showSummary: on('summary'), showServe: on('serve'), showEvents: on('events'), showBirthdays: on('births'),
    layout,
  };
}
/** 이번 주에 고친 칸 글의 최대 글자 수 (넘으면 잘라 저장하지 않고 거절) */
export const WEEK_BLOCK_MAX = 10000;
/** 이번 주에만 고친 칸: { [칸]: { text?: 글(null 이면 자동), size?: 's' } } */
export function cleanWeekBlock(b = {}) {
  if (!TITLE[b.id]) return null;
  const v = {};
  if (typeof b.text === 'string') {
    const t = b.text.replace(/\r/g, '');
    if (t.length > WEEK_BLOCK_MAX) throw Object.assign(new Error(`한 칸에는 ${WEEK_BLOCK_MAX.toLocaleString()}자까지 넣을 수 있습니다 (지금 ${t.length.toLocaleString()}자). 줄이거나 다른 칸으로 나눠 주세요.`), { code: 400 });
    v.text = str(t, WEEK_BLOCK_MAX);
  }
  if (b.size === 's') v.size = 's';
  if (b.id === 'photo' && IMG_ID.test(b.img || '')) v.img = b.img;
  return v;
}

// ── 주보 그림 (교회 로고 · 사진·포스터 칸) ──
// 그림은 자료 파일 안 db.bulletinImages[번호] = { data: 'data:image/…;base64,…', at } 에 한 번만 두고, 주보·확정본은 번호로 가리킨다.
// 화면이 올리기 전에 크기를 줄여 보내고, 여기서는 모양(png·jpeg·webp)과 크기만 확인한다.
export const IMG_ID = /^[a-f0-9]{16}$/;
export const IMG_MAX = 800 * 1024;   // 줄인 뒤 그림 한 장 최대 (바이트)
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] };
/** 올린 그림(data URL) 확인 → { id, data } */
export function cleanImage(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  const bad = (msg) => Object.assign(new Error(msg), { code: 400 });
  if (!m) throw bad('그림 파일(PNG·JPG·WEBP)만 넣을 수 있습니다.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > IMG_MAX) throw bad(`그림이 너무 큽니다 (${Math.round(buf.length / 1024)}KB). ${Math.round(IMG_MAX / 1024)}KB 이하로 줄여 주세요.`);
  if (!MAGIC[m[1]].every((x, i) => buf[i] === x)) throw bad('그림 파일이 깨졌거나 모양이 맞지 않습니다.');
  const data = `data:image/${m[1]};base64,${buf.toString('base64')}`;
  return { id: crypto.createHash('sha1').update(data).digest('hex').slice(0, 16), data };
}
/** 확정본 HTML 안의 그림 자리표(allinone-img:번호)를 실제 그림으로 */
export const fillImages = (html, db) => html.replace(/allinone-img:([a-f0-9]{16})/g, (_, id) => db.bulletinImages?.[id]?.data || '');
/** 쓰지 않는 그림 정리: 로고·표지 사진·이번 주 사진·확정본에서 가리키지 않고, 올린 지 1시간이 지난 것 */
export function pruneImages(db) {
  const imgs = db.bulletinImages; if (!imgs) return;
  const used = new Set([db.bulletin?.logo, db.bulletin?.coverPhoto]);
  for (const w of Object.values(db.weeks || {})) {
    used.add(w.bulletin?.blocks?.photo?.img);
    for (const f of w.bulletin?.finals || []) for (const h of Object.values(f.html || {})) for (const x of String(h).matchAll(/allinone-img:([a-f0-9]{16})/g)) used.add(x[1]);
  }
  for (const [id, v] of Object.entries(imgs)) if (!used.has(id) && Date.now() - (v.at || 0) > 3600e3) delete imgs[id];
}
// 성도·행정 정보가 든 칸 (잠금 중에는 빼고, 고치려면 잠금을 풀어야 함)
export const PRIVATE_BLOCKS = { serve: ['people', 'admin'], events: ['admin'], births: ['people'] };

/** 주보용 설교 요약(마크다운)에서 본문 문단과 핵심 문장만 꺼낸다 */
export function summaryParts(markdown) {
  const parts = String(markdown || '').replace(/\r/g, '').split(/\n(?=## )/);
  // 첫머리의 '제목 · 본문' 줄(맨 위 한 줄)과 끝의 '교회 | 날짜' 줄만 뺀다. 본문 문장에 가운데점이 있어도 지우지 않는다
  const ls = (parts[0] || '').split('\n').filter((l) => l.trim() && !/^#\s/.test(l));
  if (ls.length && / · /.test(ls[0]) && ls[0].length <= 80) ls.shift();
  if (ls.length && /^\S+ \| /.test(ls[ls.length - 1])) ls.pop();
  const body = ls.join('\n').trim();
  const key = (parts.find((p) => /^## 핵심 문장/.test(p)) || '').split('\n').slice(1).map((l) => l.replace(/^>\s?/, '')).join(' ').trim();
  return { body, key };
}

/** 주보에 들어갈 자료 모으기 (db 와 예배 순서에서) */
/** hide: { people, admin } — 잠금이 걸린 동안은 성도·행정에서 온 내용(생일·봉사자 이름·일정)을 넣지 않는다 */
export function bulletinData({ db, week, order, hide = {}, imgToken = false }) {
  // imgToken: 확정본으로 보관할 때는 그림 대신 자리표(allinone-img:번호)를 넣는다 (같은 그림을 여러 번 보관하지 않게)
  const img = (id) => (!IMG_ID.test(id || '') || !db.bulletinImages?.[id] ? '' : imgToken ? `allinone-img:${id}` : db.bulletinImages[id].data);
  const s = cleanBulletinSettings({ ...BULLETIN_DEFAULTS, ...(db.bulletin || {}) });
  const date = week.date;
  const serveOn = (from, to) => {
    const sv = db.serve; if (!sv) return null;
    const d = Object.keys(sv.plan || {}).filter((x) => x >= from && x <= to).sort()[0];
    if (!d) return null;
    const who = (x) => db.members?.[x]?.name ?? x;
    const rows = sv.roles.map((r) => ({ role: r.name, who: (sv.plan[d][r.id] || []).map(who) })).filter((r) => r.who.length);
    return rows.length ? { date: d, rows } : null;
  };
  const birthdays = Object.values(db.members || {}).filter((m) => m.status !== 'moved' && m.status !== 'deceased' && /^(\d{4}-)?\d{2}-\d{2}$/.test(m.birth || ''))
    .map((m) => { const mmdd = m.birth.slice(-5); const y = +date.slice(0, 4);
      // 음력 생일은 그해 양력 날짜로 바꿔서 (음력 설이 양력 1~2월이라 지난해 음력 생일도 본다)
      if (m.lunar) return { name: m.name, date: [y - 1, y, y + 1].map((yy) => lunarToSolar(yy, +mmdd.slice(0, 2), +mmdd.slice(3), !!m.lunarLeap)).find((d) => d && d >= date) || '' };
      let d = `${y}-${mmdd}`; if (d < date) d = `${y + 1}-${mmdd}`; return { name: m.name, date: d }; })
    .filter((b) => b.date && b.date <= addDays(date, 6)).sort((a, b) => a.date.localeCompare(b.date));
  const events = Object.values(db.events || {}).filter((e) => e.date > date && e.date <= addDays(date, 7)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const sum = summaryParts(db.after?.[week.id]?.summary?.content);
  const hideServe = hide.people || hide.admin;
  // 이번 주에 고친 칸 (잠금 중에는 성도·행정 정보가 든 칸의 고친 글도 넣지 않는다)
  const over = {};
  for (const [id, v] of Object.entries(week.bulletin?.blocks || {})) if (TITLE[id] && !(PRIVATE_BLOCKS[id] || []).some((a) => hide[a])) over[id] = v;
  return { img, logo: img(s.logo), cover: img(s.coverPhoto), over, s, church: db.church || {}, week, order: order || [], summary: sum, serveThis: hideServe ? null : serveOn(date, addDays(date, 6)), serveNext: hideServe ? null : serveOn(addDays(date, 7), addDays(date, 13)), birthdays: hide.people ? [] : birthdays, events: hide.admin ? [] : events, hidden: !!(hide.people || hide.admin) };
}

// 칸 하나의 자동 내용을 글로 (편집 창에서 고칠 때 처음 글로 씀)
export function blockText(d, id) {
  const { s, church, week: w } = d;
  const serveText = (x, label) => (x ? [`${label} (${md(x.date)})`, ...x.rows.map((r) => `${r.role}: ${r.who.join(', ')}`)].join('\n') : '');
  switch (id) {
    case 'order': return d.order.map((i) => i.title).join('\n');
    case 'sermon': return [w.passage, w.sermonTitle && `「${w.sermonTitle}」`, church.pastor && pastorName(church.pastor), w.prayerLeader && `대표 기도: ${w.prayerLeader}`].filter(Boolean).join('\n');
    case 'summary': return [d.summary.key, d.summary.body].filter(Boolean).join('\n\n');
    case 'ann': return (w.announcements || []).join('\n');
    case 'serve': return [serveText(d.serveThis, '이번 주'), serveText(d.serveNext, '다음 주')].filter(Boolean).join('\n');
    case 'events': return d.events.map((e) => `${md(e.date)}${e.time ? ` ${e.time}` : ''} ${e.title}${e.place ? ` · ${e.place}` : ''}`).join('\n');
    case 'births': return d.birthdays.map((b) => `${md(b.date)} ${b.name}`).join(' · ');
    case 'info': return [s.worshipTimes, s.address, s.phone && `☎ ${s.phone}`, s.account && `헌금 계좌 ${s.account}`].filter(Boolean).join('\n');
    default: return '';
  }
}
const pastorName = (p) => (/(목사|전도사|선교사)$/.test(p.trim()) ? p : `${p} 목사`);

// 분량 재기: 인쇄 화면이 직접 단(2단)·면(4면)마다 얼마나 찼는지 재서
// 넘치면 위에 경고(인쇄에는 안 나옴)를 띄우고, 주보 편집 창(부모 창)에 결과를 알린다.
// status: ok(여유 있음) · near(90% 넘게 참) · over(넘침, lines = 대략 넘친 줄 수, cut = 잘리는 칸)
// auto: 남는 자리가 있으면 그 단·면의 줄간격(--lh)과 칸 사이(--gap)를 넓혀 아래까지 채운다 (넘치지 않는 데까지, 줄간격 최대 1.9).
//   줄간격을 최대로 넓혀도 많이 남으면(내용이 아주 적은 면) 칸 사이만 더 벌린다 (최대 72px)
// 분량(pct·status)은 넓히기 전의 원래 분량으로 알린다
function fitScript(kind, auto) {
  return `<script>addEventListener('load',()=>{const sh=document.querySelector('.sheet');const lh=parseFloat(getComputedStyle(sh).lineHeight)||17;let parts;
if('${kind}'==='print'){const m=document.createElement('div');m.style.height='${PRINT_ROOM_MM}mm';document.body.appendChild(m);const room=m.getBoundingClientRect().height;m.remove();parts=[...document.querySelectorAll('.sheet>div')].map((c,i)=>({name:i?'오른쪽 단':'왼쪽 단',key:i?'R':'L',el:c,room}));}
else parts=[...document.querySelectorAll('.face')].map(f=>{const n=+((f.querySelector('.fno')||{}).textContent||1);return{name:n+'면',key:String(n),el:f,room:f.clientHeight,cover:n===1}}).sort((a,b)=>a.key-b.key);
const use=p=>{const top=p.el.getBoundingClientRect().top;return p.cover?(p.el.firstElementChild||p.el).scrollHeight:Math.max(0,...[...p.el.children].filter(c=>!c.classList.contains('fno')).map(c=>c.getBoundingClientRect().bottom+(parseFloat(getComputedStyle(c).marginBottom)||0)-top))};
const out=parts.map(p=>{const top=p.el.getBoundingClientRect().top;const used=use(p);const over=used>p.room+2;
const cs=[...p.el.querySelectorAll('section[data-b]')].filter(x=>x.getBoundingClientRect().bottom-top>p.room+2);const cut=cs.map(x=>x.dataset.b),cutName=cs.map(x=>x.dataset.t||(x.querySelector('h3')||{}).textContent||'교회 안내');
return{name:p.name,key:p.key,pct:p.cover?null:Math.round(used/p.room*100),status:over?'over':!p.cover&&used>p.room*.9?'near':'ok',lines:over?Math.max(1,Math.ceil((used-p.room)/lh)):0,cut,cutName}});
const bad=out.filter(o=>o.status==='over');
if(bad.length){const p=document.createElement('p');p.className='how warn';p.style.background='#fde8e8';p.style.borderColor='#e9a3a3';
p.textContent='⚠️ '+bad.map(o=>o.name+'이 약 '+o.lines+'줄 넘칩니다'+(o.cutName.length?' (‘'+o.cutName.join('’·‘')+'’ 칸이 잘림)':'')).join(', ')+'. '+('${kind}'==='print'?'이대로 인쇄하면 2쪽 이상이 됩니다. 주보 편집에서 칸을 다른 단으로 옮기거나':'잘린 부분은 인쇄되지 않습니다. 주보 편집에서 칸을 다른 면으로 옮기거나')+', 글을 줄이거나, ‘이번 주 글자 작게’를 써 주세요.';
document.body.insertBefore(p,document.querySelector('.sheet'));}
if(${auto ? 'true' : 'false'})for(const p of parts){if(p.cover||use(p)>=p.room-8)continue;const set=t=>{p.el.style.setProperty('--lh',(1.45+t*.45).toFixed(3));p.el.style.setProperty('--gap',(8+t*16).toFixed(1)+'px')};let lo=0,hi=1;for(let i=0;i<12;i++){const m=(lo+hi)/2;set(m);if(use(p)<=p.room-8)lo=m;else hi=m}set(lo);if(lo>.99&&use(p)<p.room-40){let a=24,b=72;for(let i=0;i<10;i++){const m=(a+b)/2;p.el.style.setProperty('--gap',m+'px');if(use(p)<=p.room-8)a=m;else b=m}p.el.style.setProperty('--gap',a+'px')}p.el.dataset.fill=lo.toFixed(2)}
window.__fit=out;try{if(parent!==window)parent.postMessage({type:'bulletin-fit',format:'${kind}',parts:out.map(({cutName,...o})=>o)},location.origin)}catch(e){}});</script>`;
}

// 인쇄 종이 모양 (A4 가로, 프린터 여백 8mm 안쪽): 사방 안쪽 여백 PAD, 두 단·두 면 사이 GAP, 본문 글자 FONT
// 종이 가장자리에서 글까지 = 8 + PAD mm, 가운데 접는 선 양쪽 = GAP/2 mm
export const PAD = 7, GAP = 18, FONT = 12.5;
/** 2단 인쇄용 한 단에 들어가는 높이 (194mm - 위아래 여백, 2mm 넉넉히) */
export const PRINT_ROOM_MM = 194 - PAD * 2 - 2;
// 주보 편집 창의 미리보기에서만 쓰는 편집 도구 (인쇄·파일·확정본에는 넣지 않음)
// - 칸을 끌어 다른 단(2단) · 다른 면(4면)이나 다른 칸 앞으로 옮기면 'bulletin-move' { id, place, before }
// - 칸을 누르면(끌지 않고) 'bulletin-pick' { id, rect } → 편집 창이 그 자리에 글 고치기 칸을 띄운다
export function editScript(kind) {
  return `<style>body.bul-editing section[data-b]{cursor:grab;outline:1px dashed transparent;outline-offset:2px;border-radius:4px}body.bul-editing section[data-b]:hover{outline-color:#2f6fd6;background:#2f6fd60d}
section.bul-dragging{opacity:.35}.bul-drop{height:0;border-top:3px solid #2f6fd6;margin:-2px 0 2px;pointer-events:none}.bul-ghost{position:fixed;z-index:9;pointer-events:none;padding:4px 10px;border-radius:6px;background:#2f6fd6;color:#fff;font:600 13px sans-serif;box-shadow:0 2px 8px #0004}
.bul-target{background:#2f6fd610;box-shadow:inset 0 0 0 2px #2f6fd655}</style>
<script>addEventListener('load',()=>{document.body.classList.add('bul-editing');
const boxes=()=>'${kind}'==='print'?[...document.querySelectorAll('.sheet>div')].map((el,i)=>({el,place:i?'R':'L'})):[...document.querySelectorAll('.face')].map(el=>({el,place:+((el.querySelector('.fno')||{}).textContent||1)})).filter(b=>b.place>1);
let st=null;const line=document.createElement('div');line.className='bul-drop';const ghost=document.createElement('div');ghost.className='bul-ghost';
const clear=()=>{line.remove();ghost.remove();document.querySelectorAll('.bul-target').forEach(e=>e.classList.remove('bul-target'));if(st&&st.sec)st.sec.classList.remove('bul-dragging')};
const where=(x,y)=>{const bs=boxes();let b=bs.find(b=>{const r=b.el.getBoundingClientRect();return x>=r.left&&x<=r.right});if(!b)return null;
const secs=[...b.el.querySelectorAll('section[data-b]')].filter(s=>s!==st.sec);const nx=secs.find(s=>{const r=s.getBoundingClientRect();return y<r.top+r.height/2});return{b,before:nx||null,last:secs[secs.length-1]}};
addEventListener('pointerdown',e=>{const sec=e.target.closest&&e.target.closest('section[data-b]');if(!sec||e.button!==0)return;e.preventDefault();st={sec,x:e.clientX,y:e.clientY,drag:false}});
addEventListener('pointermove',e=>{if(!st)return;if(!st.drag&&Math.hypot(e.clientX-st.x,e.clientY-st.y)<6)return;
if(!st.drag){st.drag=true;st.sec.classList.add('bul-dragging');ghost.textContent=(st.sec.querySelector('h3')||{}).textContent||st.sec.dataset.t||'칸';document.body.appendChild(ghost)}
ghost.style.left=(e.clientX+12)+'px';ghost.style.top=(e.clientY+8)+'px';const w=where(e.clientX,e.clientY);document.querySelectorAll('.bul-target').forEach(x=>x.classList.remove('bul-target'));st.to=w;if(!w){line.remove();return}
w.b.el.classList.add('bul-target');if(w.before)w.before.before(line);else if(w.last)w.last.after(line);else w.b.el.appendChild(line)});
addEventListener('pointerup',e=>{if(!st)return;const s=st;clear();st=null;
if(s.drag){if(s.to)parent.postMessage({type:'bulletin-move',id:s.sec.dataset.b,place:s.to.b.place,before:s.to.before?s.to.before.dataset.b:null},location.origin);return}
const r=s.sec.getBoundingClientRect();parent.postMessage({type:'bulletin-pick',id:s.sec.dataset.b,rect:{x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height}},location.origin)});
addEventListener('pointercancel',()=>{clear();st=null});});</script>`;
}

export function bulletinHtml(d, format = 'print', { edit = false } = {}) {
  const { s, church, week: w } = d;
  const songs = d.order.filter((i) => i.type === 'song' || i.type === 'score');
  const on = (id) => s.layout.find((x) => x.id === id)?.on;
  const orderHtml = on('order') && d.order.length
    ? `<ol class="order">${d.order.map((i) => `<li><span>${esc(i.title)}</span>${i.type === 'song' || i.type === 'score' ? '<em>찬양</em>' : ''}</li>`).join('')}</ol>` : '';
  const sermon = `<div class="sermon">${w.passage ? `<p class="passage">${esc(w.passage)}</p>` : ''}${w.sermonTitle ? `<p class="title">「${esc(w.sermonTitle)}」</p>` : ''}${church.pastor ? `<p class="by">${esc(pastorName(church.pastor))}</p>` : ''}${w.prayerLeader ? `<p class="small">대표 기도: ${esc(w.prayerLeader)}</p>` : ''}${!orderHtml && songs.length ? `<p class="small">찬양: ${songs.map((x) => esc(x.title)).join(', ')}</p>` : ''}</div>`;
  const summary = on('summary') && (d.summary.body || d.summary.key) ? `${d.summary.key ? `<blockquote>${esc(d.summary.key)}</blockquote>` : ''}${d.summary.body ? `<p>${lines(d.summary.body)}</p>` : ''}` : '';
  const ann = (w.announcements || []).length ? `<ol class="ann">${w.announcements.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : '';
  const serveTable = (x) => `<table class="serve"><tbody>${x.rows.map((r) => `<tr><th>${esc(r.role)}</th><td>${r.who.map(esc).join(', ')}</td></tr>`).join('')}</tbody></table>`;
  const serve = on('serve') && (d.serveThis || d.serveNext)
    ? `${d.serveThis ? `<p class="small b">이번 주 (${md(d.serveThis.date)})</p>${serveTable(d.serveThis)}` : ''}${d.serveNext ? `<p class="small b">다음 주 (${md(d.serveNext.date)})</p>${serveTable(d.serveNext)}` : ''}` : '';
  const events = on('events') && d.events.length ? `<ul class="ev">${d.events.map((e) => `<li><b>${md(e.date)}${e.time ? ` ${esc(e.time)}` : ''}</b> ${esc(e.title)}${e.place ? ` · ${esc(e.place)}` : ''}</li>`).join('')}</ul>` : '';
  const births = on('births') && d.birthdays.length ? `<p>${d.birthdays.map((b) => `${md(b.date)} ${esc(b.name)}`).join(' · ')}</p>` : '';
  const info = [s.worshipTimes && `<p class="times">${lines(s.worshipTimes)}</p>`, s.address && `<p>${esc(s.address)}</p>`, s.phone && `<p>☎ ${esc(s.phone)}</p>`, s.account && `<p>헌금 계좌 ${esc(s.account)}</p>`].filter(Boolean).join('');
  const auto = { order: orderHtml, sermon, summary, ann, serve, events, births, info, photo: '' };
  const logo = d.logo ? `<img class="logo" src="${d.logo}" alt="">` : '';
  // 이번 주에 고친 글 (줄마다 한 항목)
  const L = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  const freeHtml = (id, t) => {
    if (!t.trim()) return '';
    if (id === 'order') return `<ol class="order">${L(t).map((x) => `<li><span>${esc(x)}</span></li>`).join('')}</ol>`;
    if (id === 'ann') return `<ol class="ann">${L(t).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;
    if (id === 'events') return `<ul class="ev">${L(t).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (id === 'sermon') return `<div class="sermon">${L(t).map((x) => `<p>${esc(x)}</p>`).join('')}</div>`;
    if (id === 'info') return L(t).map((x) => `<p>${esc(x)}</p>`).join('');
    return `<p>${lines(t.trim())}</p>`;
  };
  const block = (it) => {
    if (!it.on) return '';
    const o = d.over[it.id] || {};
    // 글자 크기: 이번 주 '글자 작게'가 먼저, 아니면 배치에 정한 칸 크기
    const sz = o.size === 's' ? 'sm' : SIZE_CLASS[it.size] || '';
    if (it.id === 'photo') {   // 사진·포스터: 그림 한 장 + 설명 글(있으면)
      const src = d.img(o.img), cap = typeof o.text === 'string' ? o.text.trim() : '';
      if (!src && !cap) return '';
      return `<section data-b="photo" data-t="사진·포스터" class="photo${sz ? ` ${sz}` : ''}">${src ? `<img src="${src}" alt="${esc(cap.split('\n')[0] || '사진')}">` : ''}${cap ? `<p class="cap">${lines(cap)}</p>` : ''}</section>`;
    }
    const inner = typeof o.text === 'string' ? freeHtml(it.id, o.text) : auto[it.id];
    if (!inner) return '';
    return it.id === 'info' ? `<section data-b="info" class="info${sz ? ` ${sz}` : ''}">${inner}</section>` : `<section data-b="${it.id}"${sz ? ` class="${sz}"` : ''}><h3>${esc(TITLE[it.id])}</h3>${inner}</section>`;
  };
  const blocksWhere = (f) => s.layout.filter(f).map(block).join('');
  const lockNote = (short) => (d.hidden ? `<p class="small" style="color:#a33">🔒 잠금이 걸려 있어 생일·봉사·일정은 넣지 않았습니다.${short ? '' : ' 잠금을 풀고 다시 열어 주세요.'}</p>` : '');
  // 표지 사진: 접는 4면은 표지(1면) 전체를 사진으로 덮고, 2단·휴대폰은 맨 위 머리말을 사진 띠로 (글자는 사진 위에 흰 글씨)
  const bg = d.cover ? `<img class="cover-bg" src="${d.cover}" alt="">` : '';
  const head = `<header${bg && s.coverBanner ? ' class="pc"' : ''}>${bg && s.coverBanner ? bg : ''}${logo}<p class="church">${esc(church.name || '')}</p>${s.motto ? `<p class="motto">${esc(s.motto)}</p>` : ''}${s.mottoVerse ? `<p class="small">${esc(s.mottoVerse)}</p>` : ''}<p class="date">${day(w.date)} · ${esc(w.name || '주일 예배')}</p></header>`;
  const left = `${head}${blocksWhere((x) => x.col === 'L')}`;
  const right = `${lockNote(false)}${blocksWhere((x) => x.col === 'R')}`;
  const title = `${church.name || '교회'} 주보 ${w.date}`;
  const css = `:root{--a:#2f5d50;--ink:#222;--muted:#666}*{box-sizing:border-box}body{margin:0;color:var(--ink);font:16px/1.6 'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;background:#f3f1ec}
header{text-align:center;border-bottom:2px solid var(--a);padding-bottom:8px;margin-bottom:10px}.church{font-size:1.5rem;font-weight:800;margin:0;color:var(--a)}.motto{margin:2px 0;font-weight:700}.date{margin:4px 0 0;color:var(--muted)}
section{margin:0 0 12px}h3{font-size:1rem;margin:0 0 6px;color:var(--a);border-left:4px solid var(--a);padding-left:8px}
.order{list-style:none;padding:0;margin:0}.order li{display:flex;justify-content:space-between;border-bottom:1px dotted #bbb;padding:2px 0}.order em{font-style:normal;color:var(--muted);font-size:.85em}
.sermon{text-align:center}.sermon p{margin:2px 0}.passage{font-weight:700}.title{font-size:1.15rem;font-weight:800}.by{color:var(--muted)}
blockquote{margin:0 0 6px;padding:6px 10px;background:#eef3f0;border-radius:6px;font-weight:700}.ann{padding-left:1.2em;margin:0}.ann li{margin:2px 0}
table.serve{width:100%;border-collapse:collapse;font-size:.9em;margin-bottom:6px}.serve th{text-align:left;width:5.5em;color:var(--muted);font-weight:400;padding:2px 4px}.serve td{padding:2px 4px;border-bottom:1px dotted #ddd}
.ev{list-style:none;padding:0;margin:0}.small{font-size:.85em}.b{font-weight:700;margin:4px 0 2px}.info{border-top:1px solid #ccc;padding-top:8px;font-size:.85em;color:var(--muted);text-align:center}.info p{margin:2px 0}.times{color:var(--ink)}
.sm{font-size:.86em}section.sm h3{font-size:1rem}.lg{font-size:1.12em}section.lg h3{font-size:1.08rem}.xl{font-size:1.25em}section.xl h3{font-size:1.18rem}.logo{display:block;margin:0 auto 4px;max-height:60px;max-width:180px;object-fit:contain}section.photo img{display:block;margin:0 auto;max-width:100%;max-height:420px;object-fit:contain}section.photo.sm img{max-height:260px}.photo .cap{text-align:center;margin:4px 0 0}.tools{position:fixed;right:12px;top:12px;display:flex;gap:6px}.tools button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid #999;background:#fff;cursor:pointer}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover-bg{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;z-index:0}
header.pc{position:relative;overflow:hidden;border:none;border-radius:6px;padding:7mm 4mm 5mm;color:#fff;text-shadow:0 1px 3px #0009}
header.pc::after,.cover.pc::after{content:'';position:absolute;left:0;top:0;right:0;bottom:0;background:linear-gradient(rgba(0,0,0,.22),rgba(0,0,0,.58));z-index:0}
header.pc>*:not(.cover-bg){position:relative;z-index:1}
header.pc .church,header.pc .date,header.pc .motto,header.pc .small{color:#fff}
.cover.pc{position:relative;overflow:hidden;border:none;padding:0;background:#333;color:#fff;text-shadow:0 1px 4px #000a}
.cover.pc .cover-in{position:relative;z-index:1;width:100%;padding:12mm 8mm;display:flex;flex-direction:column;align-items:center}
.cover.pc .church,.cover.pc .date,.cover.pc .verse,.cover.pc .cby,.cover.pc .motto,.cover.pc .ctitle,.cover.pc .cpass{color:#fff}`;
  // 주보 꾸미기(겉모양만): 각 모양의 <style> 맨 끝에 덧붙여 기본 모양을 덮어쓴다
  const tcss = themeCss(s);
  const theme = tcss ? `\n/* 주보 꾸미기 */\n${tcss}` : '';
  if (format === 'mobile') {
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}
.m{max-width:560px;margin:0 auto;background:#fff;padding:18px 16px 30px;min-height:100vh}${theme}</style></head><body><main class="m">${left}${right}</main></body></html>`;
  }
  const sheetCss = `@page{size:A4 landscape;margin:8mm}.sheet{width:281mm;height:194mm;margin:12px auto;background:#fff;display:grid;grid-template-columns:1fr 1fr;gap:${GAP}mm;padding:${PAD}mm;box-shadow:0 1px 6px #0002;font-size:${FONT}px;line-height:1.45;overflow:hidden}.sheet section{margin-bottom:8px}.sheet .order li{padding:0}.sheet header{margin-bottom:6px;padding-bottom:4px}.sheet .church{font-size:1.5rem}.sheet h3{font-size:1.06rem}.sheet .logo{max-height:16mm;max-width:45mm}.sheet section.photo img{max-height:48mm}.sheet section.photo.sm img{max-height:32mm}.sheet>div,.sheet .face{line-height:var(--lh,1.45)}.sheet>div section,.sheet .face section{margin-bottom:var(--gap,8px)}
.sheet>div{overflow:hidden}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;padding:${PAD}mm;width:auto;height:194mm;break-after:page;page-break-after:always}.sheet:last-of-type{break-after:auto;page-break-after:auto}.tools,.how{display:none}}`;
  if (format === 'fold4') {
    // 접는 4면: 1쪽(바깥) = 왼쪽 4면(뒷표지) · 오른쪽 1면(표지) / 2쪽(안쪽) = 왼쪽 2면 · 오른쪽 3면
    const cover = `<div class="cover${bg ? ' pc' : ''}">${bg}${bg ? '<div class="cover-in">' : ''}${logo}<p class="church">${esc(church.name || '')}</p>${s.motto ? `<p class="motto">${esc(s.motto)}</p>` : ''}${s.mottoVerse ? `<p class="verse">${esc(s.mottoVerse)}</p>` : ''}<p class="date">${day(w.date)}<br>${esc(w.name || '주일 예배')}</p>${w.sermonTitle ? `<p class="ctitle">「${esc(w.sermonTitle)}」</p>` : ''}${w.passage ? `<p class="cpass">${esc(w.passage)}</p>` : ''}${church.pastor ? `<p class="cby">담임 ${esc(church.pastor)}</p>` : ''}${bg ? '</div>' : ''}</div>`;
    const face = (n) => blocksWhere((x) => x.face === n);
    const p4 = `<div class="face"><p class="fno">4</p>${lockNote(true)}${face(4)}</div>`;
    const p1 = `<div class="face">${cover}</div>`;
    const p2 = `<div class="face"><p class="fno">2</p>${face(2)}</div>`;
    const p3 = `<div class="face"><p class="fno">3</p>${face(3)}</div>`;
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)} (접는 4면)</title><style>${css}
${sheetCss}.face{position:relative;overflow:hidden;height:100%}.fno{position:absolute;right:0;bottom:0;margin:0;color:#aaa;font-size:.8em}
.cover{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;border:2px solid var(--a);border-radius:6mm;padding:12mm 8mm}
.cover .logo{max-height:38mm;max-width:70mm;margin-bottom:6mm}.cover .church{font-size:2.1rem}.cover .motto{font-size:1.2rem;margin-top:6mm}.cover .verse{color:var(--muted)}.cover .date{margin-top:10mm;font-size:1.05rem;color:var(--ink)}.cover .ctitle{margin-top:8mm;font-size:1.25rem;font-weight:800}.cover .cpass{margin:2px 0;font-weight:700}.cover .cby{margin-top:8mm;color:var(--muted)}
.how{max-width:281mm;margin:12px auto 0;padding:8px 12px;background:#fff8e1;border:1px solid #e8d48a;border-radius:8px;font-size:13px}${theme}</style></head>
<body><div class="tools"><button onclick="print()">인쇄</button></div>
<p class="how">📄 <b>접는 4면 주보</b> — 인쇄 창에서 <b>양면 인쇄</b>를 켜고 <b>짧은 쪽으로 넘기기</b>(Flip on short edge)를 고르세요. A4 한 장 앞뒤로 인쇄한 뒤 가운데를 반으로 접으면 1면(표지) → 2·3면(안쪽) → 4면(뒷면) 순서가 됩니다. 양면 인쇄가 안 되는 프린터는 1쪽을 인쇄한 뒤 종이를 뒤집어 다시 넣고 2쪽을 인쇄하세요.</p>
<div class="sheet outside"><div>${p4}</div><div>${p1}</div></div><div class="sheet inside"><div>${p2}</div><div>${p3}</div></div>
${fitScript('fold4', s.autoFill)}${edit ? editScript('fold4') : ''}</body></html>`;
  }
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}
@page{size:A4 landscape;margin:8mm}.sheet{width:281mm;min-height:194mm;margin:12px auto;background:#fff;display:grid;grid-template-columns:1fr 1fr;gap:${GAP}mm;padding:${PAD}mm;box-shadow:0 1px 6px #0002;font-size:${FONT}px;line-height:1.45}.sheet section{margin-bottom:8px}.sheet .order li{padding:0}.sheet header{margin-bottom:6px;padding-bottom:4px}.sheet .church{font-size:1.5rem}.sheet h3{font-size:1.06rem}.sheet .logo{max-height:16mm;max-width:45mm}.sheet section.photo img{max-height:48mm}.sheet section.photo.sm img{max-height:32mm}.sheet>div{line-height:var(--lh,1.45)}.sheet>div section{margin-bottom:var(--gap,8px)}
.sheet>div{overflow:hidden}.how{max-width:281mm;margin:12px auto 0;padding:8px 12px;background:#fde8e8;border:1px solid #e9a3a3;border-radius:8px;font-size:13px}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;padding:${PAD}mm;width:auto;min-height:0}.tools,.how{display:none}}${theme}</style></head>
<body><div class="tools"><button onclick="print()">인쇄</button></div><div class="sheet"><div>${left}</div><div>${right}</div></div>
${fitScript('print', s.autoFill)}${edit ? editScript('print') : ''}</body></html>`;
}

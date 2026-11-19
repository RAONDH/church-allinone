// 라온 music sheet(찬양팀 콘티 사이트) 공유 링크로 이번 주 콘티 가져오기 — 한쪽으로만 읽는다(music sheet → 올인원).
// - 로그인 정보는 받지도 저장하지도 않는다. 공유 링크와 (걸려 있으면) 공유 비밀번호만 쓴다.
// - 정해 둔 music sheet 주소의 /share/<토큰> 링크만 받는다 (다른 사이트로 요청을 보내지 않게).
// - 가져온 곡은 [예배송출 자막에 넣기]를 눌렀을 때만 예배송출 콘티에 넣는다.

export const MS_ORIGIN = (process.env.MUSICSHEET_ORIGIN || 'https://raon-music-sheet.vercel.app').replace(/\/+$/, '');
const SONG_TYPES = new Set(['song', 'score']);

const bad = (msg, code = 400) => Object.assign(new Error(msg), { code });
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/** 공유 링크 확인 → 토큰. 빈 글이면 '' (연결 끊기) */
export function parseShareLink(url) {
  const u0 = String(url || '').trim();
  if (!u0) return '';
  let u;
  try { u = new URL(u0); } catch { throw bad('링크 모양이 아닙니다. music sheet의 공유 링크를 그대로 붙여 넣어 주세요.'); }
  const m = u.pathname.match(/^\/share\/([A-Za-z0-9_-]{6,100})\/?$/);
  if (u.origin !== MS_ORIGIN || !m) throw bad(`라온 music sheet의 공유 링크(${MS_ORIGIN}/share/…)만 넣을 수 있습니다.`);
  return m[1];
}

// 곡 진행 칸 → 짧은 이름 (music sheet 와 같은 규칙: V1, C, Pre2, B …)
const CODE = { intro: 'Intro', verse: 'V', pre: 'Pre', chorus: 'C', bridge: 'B', inter: '간주', outro: 'Outro', ending: '엔딩' };
const codeOf = (f) => (f.part === 'etc' ? f.label : `${CODE[f.part] || '?'}${f.n ? f.n : ''}`);
// 곡에 적어 둔 송폼 글자(예: 'I-V1-C-V2-C×2-B-C')를 칸으로 (music sheet 의 parseStructure 와 같은 뜻)
const ALIASES = [
  [/^(i|intro|인트로|전주)$/i, 'intro'], [/^(v|verse|벌스)(\d)?$/i, 'verse'], [/^(\d)절$/, 'verse', true],
  [/^(p|pc|pre|prechorus|프리)(\d)?$/i, 'pre'], [/^(c|ch|chorus|후렴)(\d)?$/i, 'chorus'], [/^(b|br|bridge|브릿지)(\d)?$/i, 'bridge'],
  [/^(it|int|inter|interlude|간주)$/i, 'inter'], [/^(o|out|outro|아웃트로)$/i, 'outro'], [/^(e|end|ending|엔딩|마무리)$/i, 'ending'],
];
function parseStructure(text) {
  const out = [];
  for (const raw of String(text || '').replace(/pre[-\s]?chorus/gi, 'prechorus').split(/[\s,\-–—→>/|]+/)) {
    if (!raw) continue;
    const alone = raw.match(/^[x×*](\d)$/i);
    if (alone && out.length) { out[out.length - 1].times = Number(alone[1]); continue; }
    const rep = raw.match(/^(.+?)\s*[x×*](\d)$/i);
    const word = rep ? rep[1] : raw;
    let item = null;
    for (const [re, part, numFirst] of ALIASES) {
      const m = word.match(re);
      if (m) { item = { part, n: numFirst ? Number(m[1]) : Number(m[2] || 0), times: rep ? Number(rep[2]) : 1, label: '' }; break; }
    }
    out.push(item || { part: 'etc', n: 0, times: rep ? Number(rep[2]) : 1, label: word.slice(0, 12) });
  }
  return out.slice(0, 40);
}
const cleanFlow = (raw) => (Array.isArray(raw) ? raw : []).slice(0, 40)
  .filter((f) => f && (CODE[f.part] || (f.part === 'etc' && f.label)))
  .map((f) => ({ part: f.part, n: Math.max(0, Math.min(9, Number(f.n) || 0)), times: Math.max(1, Math.min(9, Number(f.times) || 1)), label: str(f.label, 12) }));

/** music sheet 응답 → 올인원에서 쓰는 모양 */
export function normalizeSetlist(j) {
  const raw = Array.isArray(j?.songs) ? j.songs.slice(0, 40) : [];
  // 예배 순서(items)에 곡 위치가 있으면 그 순서로, 없으면 곡 목록 순서로
  const order = Array.isArray(j?.items) ? j.items.filter((it) => it?.kind === 'song' && Number.isInteger(it.songIndex) && raw[it.songIndex]).map((it) => it.songIndex) : [];
  const idx = order.length ? [...new Set(order)] : raw.map((_, i) => i);
  const songs = idx.map((i) => raw[i]).filter((s) => str(s?.title, 100)).map((s) => {
    const flow = cleanFlow(s.flow).length ? cleanFlow(s.flow) : parseStructure(s.structure);
    return {
      title: str(s.title, 100), artist: str(s.artist, 100), key: str(s.key, 10), bpm: Number(s.bpm) > 0 ? Math.round(Number(s.bpm)) : 0,
      capo: Number(s.capo) > 0 ? Math.round(Number(s.capo)) : 0, youtubeUrl: /^https:\/\//.test(s.youtubeUrl || '') ? str(s.youtubeUrl, 300) : '',
      flow, flowText: flow.map((f) => `${codeOf(f)}${f.times > 1 ? ` ×${f.times}` : ''}`).join(' → '), notes: str(s.notes, 500),
    };
  });
  return {
    name: str(j?.name, 100), date: /^\d{4}-\d{2}-\d{2}/.test(j?.gigDate || '') ? j.gigDate.slice(0, 10) : '',
    serviceType: str(j?.serviceType, 40), status: j?.status === 'confirmed' ? 'confirmed' : 'draft', songs,
  };
}

/** 공유 링크에서 콘티 읽기 */
export async function fetchSetlist(token, pin, fetchImpl = fetch) {
  let r;
  try {
    r = await fetchImpl(`${MS_ORIGIN}/api/setlists/public/${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json', ...(pin ? { 'x-share-pin': String(pin).slice(0, 40) } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch { throw bad('music sheet에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.', 502); }
  const text = await r.text();
  if (text.length > 3_000_000) throw bad('music sheet에서 받은 자료가 너무 큽니다.', 502);
  let j = null; try { j = JSON.parse(text); } catch { /* 아래에서 */ }
  if (r.status === 404) throw bad('콘티를 찾을 수 없습니다. 링크가 바뀌었거나 공유를 끈 것 같습니다.', 404);
  if (r.status === 401 && j?.needLogin) throw bad('이 링크는 팀원만 볼 수 있게 잠겨 있습니다. music sheet의 공유 설정에서 공유 비밀번호를 걸고, 그 비밀번호를 여기에 넣어 주세요.', 401);
  if (r.status === 401) throw bad(pin ? '공유 비밀번호가 맞지 않습니다.' : '이 콘티는 공유 비밀번호가 필요합니다. 아래 칸에 넣어 주세요.', 401);
  if (r.status === 429) throw bad(str(j?.message, 200) || '비밀번호를 여러 번 틀려 잠시 잠겼습니다. 조금 뒤 다시 해 주세요.', 429);
  if (!r.ok || !j) throw bad(`music sheet에서 콘티를 읽지 못했습니다 (${r.status}).`, 502);
  return normalizeSetlist(j);
}

const norm = (s) => String(s || '').replace(/\[예제\]|\(.*?\)|[\s·\-_,.!?'"]/g, '').toLowerCase();

// music sheet 진행 칸 → 예배송출 곡의 자막 이름(1절·후렴…) 중 있는 것. 노래 없는 칸(인트로·간주…)은 뺀다
function arrFor(flow, labels) {
  const has = new Set(labels);
  const pick = (names) => names.find((x) => has.has(x));
  const out = [];
  for (const f of flow) {
    let names;
    if (f.part === 'verse') names = [`${f.n || 1}절`, `V${f.n || 1}`, ...(f.n ? [] : ['V'])];
    else if (f.part === 'chorus') names = f.n > 1 ? [`후렴${f.n}`, `C${f.n}`] : ['후렴', 'C', 'C1', '후렴1'];
    else if (f.part === 'pre') names = [`Pre${f.n || ''}`, '프리코러스', 'Pre', 'Pre1'];
    else if (f.part === 'bridge') names = ['브릿지', '브리지', `B${f.n || ''}`, 'B', 'B1'];
    else if (f.part === 'etc') names = [f.label];
    else continue;   // 인트로·간주·아웃트로·엔딩: 자막 없음
    const l = pick(names);
    if (!l) return null;   // 맞는 자막이 없으면 곡 구성을 건드리지 않는다
    for (let i = 0; i < f.times; i++) out.push(l);
  }
  return out.length ? out : null;
}

/** 가져온 콘티의 곡을 예배송출 예배 순서에 넣기: 지금 순서의 곡 자리를 music sheet 순서로 바꾼다 */
export async function applySetlist(wc, serviceId, setlist) {
  if (!setlist.songs.length) throw bad('가져온 콘티에 곡이 없습니다.');
  const st = await wc.state();
  const svc = st.services.find((s) => s.id === serviceId);
  if (!svc) throw bad('연결된 예배 순서를 예배송출에서 찾을 수 없습니다.', 404);
  const typeOf = (id) => st.items.find((i) => i.id === id)?.type;
  const songItems = st.items.filter((i) => i.type === 'song');
  const results = [], newIds = [];
  for (const s of setlist.songs) {
    const same = songItems.filter((i) => norm(i.title) === norm(s.title));
    let it = same.find((i) => svc.itemIds.includes(i.id)) || same[0];
    const r = { title: s.title, key: s.key, done: [] };
    if (!it) {
      it = await wc.addItem({ type: 'song', title: s.title, slides: [], key: s.key });
      songItems.push(it);
      r.done.push('새 곡으로 만듦(가사는 예배송출에서 채워 주세요)');
    } else r.done.push('찬양 자료에서 찾음');
    const patch = {};
    if (s.key && s.key !== it.key) { patch.key = s.key; r.done.push(`조성 ${it.key || '없음'} → ${s.key}`); }
    const labels = [...new Set((it.slides || []).map((x) => x.label).filter(Boolean))];
    const arr = s.flow.length ? arrFor(s.flow, labels) : null;
    if (arr && JSON.stringify(arr) !== JSON.stringify(it.arr || [])) { patch.arr = arr; r.done.push(`곡 구성 ${arr.join(' → ')}`); }
    else if (s.flow.length && !arr) r.done.push('곡 구성은 그대로(자막 이름이 달라 맞추지 못함)');
    if (Object.keys(patch).length) await wc.updateItem(it.id, patch);
    if (!newIds.includes(it.id)) newIds.push(it.id);
    results.push(r);
  }
  // 곡 자리: 지금 첫 곡 자리, 곡이 없으면 '찬양' 자막 다음, 그것도 없으면 끝
  const old = svc.itemIds;
  let at = old.findIndex((id) => SONG_TYPES.has(typeOf(id)));
  const rest = old.filter((id) => !SONG_TYPES.has(typeOf(id)));
  if (at >= 0) at = old.slice(0, at).filter((id) => !SONG_TYPES.has(typeOf(id))).length;
  else { const t = rest.findIndex((id) => /찬양/.test(st.items.find((i) => i.id === id)?.title || '')); at = t >= 0 ? t + 1 : rest.length; }
  const ids = [...rest.slice(0, at), ...newIds, ...rest.slice(at)];
  const removed = old.filter((id) => SONG_TYPES.has(typeOf(id)) && !newIds.includes(id)).map((id) => st.items.find((i) => i.id === id)?.title || '');
  await wc.updateService(serviceId, { itemIds: ids });
  return { results, removed };
}

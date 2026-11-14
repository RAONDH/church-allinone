// 재정 (수입·지출 장부, 예산, 기부금 영수증용 집계). 라온 교회 올인원 자료 파일 안에 함께 저장.
// 성도 명부와 같은 이유로 이 컴퓨터 밖으로 보내지 않는다.
// 기존 '회계장부' 프로그램은 그대로 두고, 그 백업(JSON)을 복사해 가져올 수 있다.
import { uid } from './store.mjs';
import { normDate } from './people.mjs';

const str = (v, n = 200) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
export const FUNDS = ['일반재정', '특별재정', '지정재정'];
// 처음 쓰는 교회를 위한 기본 항목 (설정에서 고칠 수 있음)
export const DEFAULT_CATEGORIES = {
  income: {
    일반재정: ['주일헌금', '십일조', '감사헌금', '기타헌금', '일반이월금', '기타수입'],
    특별재정: ['선교헌금', '구제헌금', '절기헌금', '특별이월금'],
    지정재정: ['건축헌금', '기타지정헌금'],
  },
  expense: {
    일반재정: ['목회자사례비', '예배·교육비', '행사비', '교제비', '심방비', '경조비', '비품·서무비', '임대료·관리비', '상회비', '예비비'],
    특별재정: ['선교비', '구제비', '후원비'],
    지정재정: ['건축지출', '기타지정지출'],
  },
};
const CARRY = /이월금$/;   // 이월금은 헌금이 아니라 영수증 합계에서 뺀다

export const emptyFinance = () => ({
  settings: { categories: structuredClone(DEFAULT_CATEGORIES), receipt: { regNo: '', address: '', representative: '' } },
  tx: {}, budgets: {},
});

const won = (v) => {
  const n = Math.round(Number(String(v ?? '').replace(/[,\s원₩]/g, '')));
  return Number.isFinite(n) && n > 0 && n < 1e12 ? n : 0;
};

// 이름이 명부의 한 분과만 맞으면 그분과 연결 (동명이인이면 연결하지 않음)
export function matchMember(db, name) {
  const n = String(name || '').trim();
  if (!n) return '';
  const hits = Object.values(db.members || {}).filter((m) => m.name === n);
  return hits.length === 1 ? hits[0].id : '';
}

function ensureCategory(f, type, fund, cat) {
  const list = ((f.settings.categories[type] ||= {})[fund] ||= []);
  if (cat && !list.includes(cat)) list.push(cat);
}

export function cleanTx(b, db) {
  const type = b.type === 'expense' ? 'expense' : 'income';
  const fund = FUNDS.includes(b.fund) ? b.fund : '일반재정';
  const date = normDate(b.date);
  const category = str(b.category, 40).trim();
  const amount = won(b.amount);
  if (!date) throw Object.assign(new Error('날짜가 올바르지 않습니다.'), { code: 400 });
  if (!category) throw Object.assign(new Error('항목을 골라 주세요.'), { code: 400 });
  if (!amount) throw Object.assign(new Error('금액을 1원 이상 넣어 주세요.'), { code: 400 });
  const name = str(b.name, 60).trim();
  const memberId = type === 'income' ? (b.memberId && db.members?.[b.memberId] ? b.memberId : matchMember(db, name)) : '';
  return { date, type, fund, category, name, memberId, amount, note: str(b.note, 300) };
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function financeCsv(db, year) {
  const rows = Object.values(db.finance.tx).filter((t) => !year || t.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const out = [['날짜', '구분', '재정', '항목', '이름·거래처', '수입', '지출', '메모']];
  for (const t of rows) out.push([t.date, t.type === 'income' ? '수입' : '지출', t.fund, t.category, (t.memberId && db.members?.[t.memberId]?.name) || t.name, t.type === 'income' ? t.amount : '', t.type === 'expense' ? t.amount : '', t.note]);
  return '﻿' + out.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** 기존 회계장부 백업 { transactions, budgets } 가져오기. 같은 백업을 두 번 넣어도 겹치지 않는다. */
export function importLedger(db, data, year = new Date().getFullYear()) {
  const f = db.finance;
  const seen = new Set(Object.values(f.tx).map((t) => t.srcId).filter(Boolean));
  let added = 0, skipped = 0, bad = 0;
  for (const raw of Array.isArray(data?.transactions) ? data.transactions.slice(0, 100000) : []) {
    const srcId = `ledger:${raw?.id ?? ''}:${raw?.date ?? ''}:${raw?.amount ?? ''}`;
    if (seen.has(srcId)) { skipped++; continue; }
    let t;
    try {
      t = cleanTx({ date: raw.date, type: raw.type, fund: raw.financeType, category: raw.category, name: raw.name, amount: raw.amount, note: raw.note }, db);
    } catch { bad++; continue; }
    ensureCategory(f, t.type, t.fund, t.category);
    const id = uid();
    f.tx[id] = { id, ...t, srcId, createdAt: Date.now() + added, updatedAt: Date.now() };
    seen.add(srcId); added++;
  }
  // 회계장부 예산은 연도 구분이 없어 올해 예산으로 넣는다 (올해 예산이 비어 있을 때만)
  let budget = false;
  if (data?.budgets && typeof data.budgets === 'object' && !Object.keys(f.budgets[year] || {}).length) {
    const b = {};
    for (const [k, v] of Object.entries(data.budgets)) if (won(v)) b[str(k, 40)] = won(v);
    if (Object.keys(b).length) { f.budgets[year] = b; budget = true; }
  }
  return { added, skipped, bad, budget };
}

export async function financeApi({ sub, req, res, url, db, save, body, send, HttpError }) {
  let q;
  const s = (re) => sub.match(re);
  db.finance ??= emptyFinance();
  const f = db.finance;
  const wrap = (fn) => { try { return fn(); } catch (e) { throw e.code === 400 ? new HttpError(400, e.message) : e; } };

  if (sub === '/finance' && req.method === 'GET') {
    send(res, 200, { settings: f.settings, tx: Object.values(f.tx), budgets: f.budgets });
    return true;
  }
  if (sub === '/finance/export.csv' && req.method === 'GET') {
    const year = /^\d{4}$/.test(url.searchParams.get('year') || '') ? url.searchParams.get('year') : '';
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="finance-${year || 'all'}.csv"; filename*=UTF-8''${encodeURIComponent(`재정장부-${year || '전체'}.csv`)}` });
    res.end(financeCsv(db, year));
    return true;
  }
  // 여러 줄 한꺼번에 (주일 헌금 입력)
  if (sub === '/finance/tx' && req.method === 'POST') {
    const b = await body(req);
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 500);
    const clean = rows.map((r, i) => wrap(() => { try { return cleanTx(r, db); } catch (e) { e.message = `${i + 1}번째 줄: ${e.message}`; throw e; } }));
    if (!clean.length) throw new HttpError(400, '넣을 내용이 없습니다.');
    const added = clean.map((t, i) => {
      ensureCategory(f, t.type, t.fund, t.category);
      const id = uid();
      return (f.tx[id] = { id, ...t, createdAt: Date.now() + i, updatedAt: Date.now() });
    });
    await save();
    send(res, 200, { added });
    return true;
  }
  if ((q = s(/^\/finance\/tx\/([a-f0-9]+)$/))) {
    const t = f.tx[q[1]];
    if (!t) throw new HttpError(404, '장부 기록을 찾을 수 없습니다.');
    if (req.method === 'PUT') {
      const b = await body(req);
      Object.assign(t, wrap(() => cleanTx({ ...t, ...b }, db)), { updatedAt: Date.now() });
      ensureCategory(f, t.type, t.fund, t.category);
      await save();
      send(res, 200, { tx: t });
      return true;
    }
    if (req.method === 'DELETE') {
      delete f.tx[t.id];
      await save();
      send(res, 200, { ok: true });
      return true;
    }
  }
  if (sub === '/finance/settings' && req.method === 'PUT') {
    const b = await body(req);
    if (b.categories) {
      const c = { income: {}, expense: {} };
      for (const type of ['income', 'expense']) for (const fund of FUNDS) {
        c[type][fund] = [...new Set((b.categories?.[type]?.[fund] || []).map((x) => str(x, 40).trim()).filter(Boolean))].slice(0, 80);
      }
      f.settings.categories = c;
    }
    if (b.receipt) f.settings.receipt = { regNo: str(b.receipt.regNo, 30).trim(), address: str(b.receipt.address, 200).trim(), representative: str(b.receipt.representative, 40).trim() };
    await save();
    send(res, 200, { settings: f.settings });
    return true;
  }
  // 항목 하나씩 고치기: 추가 · 이름 바꾸기(이미 적은 기록·예산도 함께) · 순서 · 빼기(기록은 그대로)
  if (sub === '/finance/category' && req.method === 'POST') {
    const b = await body(req);
    const type = b.type === 'expense' ? 'expense' : 'income';
    if (!FUNDS.includes(b.fund)) throw new HttpError(400, '재정 구분이 올바르지 않습니다.');
    const list = ((f.settings.categories[type] ||= {})[b.fund] ||= []);
    const name = str(b.name, 40).trim(), to = str(b.to, 40).trim();
    const used = (c) => Object.values(f.tx).filter((t) => t.type === type && t.fund === b.fund && t.category === c);
    if (b.op === 'add') {
      if (!name) throw new HttpError(400, '항목 이름을 넣어 주세요.');
      if (list.includes(name)) throw new HttpError(400, `'${name}' 항목이 이미 있습니다.`);
      list.push(name);
    } else if (b.op === 'rename') {
      const i = list.indexOf(name);
      if (i < 0) throw new HttpError(404, '항목을 찾을 수 없습니다.');
      if (!to) throw new HttpError(400, '새 이름을 넣어 주세요.');
      if (to !== name && list.includes(to)) throw new HttpError(400, `'${to}' 항목이 이미 있습니다.`);
      list[i] = to;
      for (const t of used(name)) { t.category = to; t.updatedAt = Date.now(); }
      for (const y of Object.values(f.budgets)) if (y[name] !== undefined && y[to] === undefined) { y[to] = y[name]; delete y[name]; }
    } else if (b.op === 'move') {
      const i = list.indexOf(name), j = i + (b.dir < 0 ? -1 : 1);
      if (i >= 0 && j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
    } else if (b.op === 'remove') {
      f.settings.categories[type][b.fund] = list.filter((c) => c !== name);
    } else throw new HttpError(400, '알 수 없는 작업입니다.');
    await save();
    send(res, 200, { settings: f.settings, count: used(b.op === 'rename' ? to : name).length });
    return true;
  }
  if ((q = s(/^\/finance\/budgets\/(\d{4})$/)) && req.method === 'PUT') {
    const b = await body(req);
    const out = {};
    for (const [k, v] of Object.entries(b.budgets || {})) if (won(v)) out[str(k, 40)] = won(v);
    f.budgets[q[1]] = out;
    await save();
    send(res, 200, { budgets: out });
    return true;
  }
  if (sub === '/finance/import' && req.method === 'POST') {
    const b = await body(req, 50e6);
    if (!Array.isArray(b?.transactions)) throw new HttpError(400, '회계장부 백업 파일이 아닙니다. (transactions 항목이 없음)');
    const r = importLedger(db, b);
    await save();
    send(res, 200, r);
    return true;
  }
  // 이름만 적힌 헌금 기록을 명부의 성도와 다시 맞춰 보기 (명부에 성도를 넣은 뒤)
  if (sub === '/finance/relink' && req.method === 'POST') {
    let linked = 0;
    for (const t of Object.values(f.tx)) {
      if (t.type !== 'income' || (t.memberId && db.members?.[t.memberId])) continue;
      const id = matchMember(db, t.name);
      if (id) { t.memberId = id; linked++; } else t.memberId = '';
    }
    await save();
    send(res, 200, { linked });
    return true;
  }
  return false;
}

export const isCarry = (cat) => CARRY.test(cat);

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { useGuardedClose } from '../lib/guard';
import { clickable } from '../lib/a11y';
import { api } from '../lib/api';
import type { Finance as FinanceData, FinanceSettings, Fund, Member, Tx } from '../lib/types';
import { balances, budgetKey, budgetOf, byCategory, donorMonths, donors, FUNDS, monthly, parseWon, totals, won, type Donor } from '../lib/finance';
import { lastSunday } from '../lib/people';
import { fmtDate, ymd } from '../lib/week';

const TABS = [['ledger', '장부'], ['report', '보고서·예산'], ['receipts', '기부금 영수증'], ['settings', '항목·가져오기']] as const;
const TYPE_LABEL = { income: '수입', expense: '지출' } as const;

function useFinance() {
  const { base } = useApp();
  const [data, setData] = useState<FinanceData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try {
      const [f, p] = await Promise.all([api<FinanceData>(`${base}/finance`), api<{ members: Member[] }>(`${base}/people`)]);
      setData(f); setMembers(p.members); setErr('');
    } catch (e: any) { setErr(e.message); }
  }, [base]);
  useEffect(() => { load(); }, [load]);
  return { data, members, err, load };
}

export default function Finance() {
  const { tab = 'ledger' } = useParams();
  const nav = useNavigate();
  const { data, members, err, load } = useFinance();
  const t = TABS.some(([k]) => k === tab) ? tab : 'ledger';
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const years = useMemo(() => {
    const ys = new Set([String(new Date().getFullYear()), ...(data?.tx || []).map((x) => x.date.slice(0, 4))]);
    return [...ys].sort().reverse();
  }, [data]);
  return (
    <section>
      <div className="home-head">
        <div>
          <h1>재정</h1>
          <p className="muted small">🔒 재정 자료는 이 컴퓨터에만 저장됩니다. AI나 인터넷으로 보내지 않습니다.</p>
        </div>
        {t !== 'ledger' && t !== 'settings' && (
          <label className="inline">연도<select value={year} onChange={(e) => setYear(e.target.value)}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
        )}
      </div>
      <div className="tabs">
        {TABS.map(([k, label]) => <button key={k} className={t === k ? 'on' : ''} onClick={() => nav(`/finance/${k}`)}>{label}</button>)}
      </div>
      {err && <p className="alert err">{err} <button onClick={load}>다시 시도</button></p>}
      {!data ? (!err && <p className="muted">불러오는 중…</p>)
        : t === 'ledger' ? <Ledger data={data} members={members} reload={load} />
        : t === 'report' ? <Report data={data} year={year} reload={load} />
        : t === 'receipts' ? <Receipts data={data} members={members} year={year} reload={load} />
        : <Settings data={data} reload={load} />}
    </section>
  );
}

// ── 장부 ──────────────────────────────────────────
interface Row { date: string; type: 'income' | 'expense'; fund: Fund; category: string; name: string; amount: string; note: string }

function Ledger({ data, members, reload }: { data: FinanceData; members: Member[]; reload: () => Promise<void> }) {
  const { base } = useApp();
  const today = ymd(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [qs, setQs] = useState('');
  const [edit, setEdit] = useState<Tx | null>(null);
  const [adding, setAdding] = useState(false);
  const last = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
  const from = `${month}-01`, to = `${month}-${String(last).padStart(2, '0')}`;
  const sum = totals(data.tx, from, to);
  const bal = balances(data.tx, to);
  const nameOf = (t: Tx) => members.find((m) => m.id === t.memberId)?.name || t.name;
  const list = data.tx.filter((t) => t.date >= from && t.date <= to)
    .filter((t) => !qs.trim() || [nameOf(t), t.category, t.note, t.fund].some((v) => v.includes(qs.trim())))
    .sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type) || a.createdAt - b.createdAt);
  const days = [...new Set(list.map((t) => t.date))];
  const shift = (n: number) => { const d = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1); setMonth(ymd(d).slice(0, 7)); };

  return (
    <>
      <div className="card">
        <div className="row between">
          <div className="row">
            <button className="icon" onClick={() => shift(-1)} aria-label="지난달">◀</button>
            <b className="month-label">{+month.slice(0, 4)}년 {+month.slice(5, 7)}월</b>
            <button className="icon" onClick={() => shift(1)} aria-label="다음 달">▶</button>
            {month !== today.slice(0, 7) && <button className="link" onClick={() => setMonth(today.slice(0, 7))}>이번 달</button>}
          </div>
          <div className="row wrap">
            <a className="btn" href={`${base}/finance/export.csv?year=${month.slice(0, 4)}`}>{month.slice(0, 4)}년 엑셀(CSV)</a>
            <button className="primary" onClick={() => setAdding(!adding)}>{adding ? '입력 닫기' : '수입·지출 입력'}</button>
          </div>
        </div>
        <div className="fin-stats">
          <div><span className="muted small">이달 수입</span><b className="ok-text">{won(sum.income)}</b></div>
          <div><span className="muted small">이달 지출</span><b className="warn-text">{won(sum.expense)}</b></div>
          <div><span className="muted small">이달 차액</span><b>{won(sum.net)}</b></div>
          {sum.carry > 0 && <div><span className="muted small">이월금 (수입에 넣지 않음)</span><b>{won(sum.carry)}</b></div>}
          {FUNDS.map((f) => <div key={f}><span className="muted small">{f} 잔액 (월말)</span><b>{won(bal[f])}</b></div>)}
        </div>
      </div>

      {adding && <EntryForm data={data} members={members} onSaved={reload} />}

      <div className="card">
        <div className="row between">
          <h3>{+month.slice(5, 7)}월 내역 {list.length}건</h3>
          <input className="search" placeholder="이름·항목·메모로 찾기" value={qs} onChange={(e) => setQs(e.target.value)} />
        </div>
        {!list.length ? <p className="muted">이 달에는 기록이 없습니다.{!data.tx.length && " 오른쪽 위 '수입·지출 입력'으로 시작하거나, '항목·가져오기'에서 기존 회계장부 백업을 가져오세요."}</p> : (
          <div className="table-wrap">
            <table className="people-table fin-table">
              <thead><tr><th>날짜</th><th>재정</th><th>항목</th><th>이름·거래처</th><th className="num">수입</th><th className="num">지출</th><th>메모</th></tr></thead>
              <tbody>
                {days.map((d) => {
                  const xs = list.filter((t) => t.date === d);
                  return (
                    <Fragment key={d}>
                      {xs.map((t, i) => (
                        <tr key={t.id} {...clickable(() => setEdit(t))} aria-label={`${fmtDate(t.date)} ${t.category} ${won(t.amount)} 고치기`}>
                          <td className="muted">{i === 0 ? fmtDate(d) : ''}</td>
                          <td>{t.fund.replace('재정', '')}</td>
                          <td>{t.category}</td>
                          <td>{nameOf(t)}{t.type === 'income' && t.name && !t.memberId && !/^(무명|익명)$/.test(t.name) && <span className="muted small" title="성도 명부에 없는 이름"> *</span>}</td>
                          <td className="num ok-text">{t.type === 'income' ? won(t.amount) : ''}</td>
                          <td className="num warn-text">{t.type === 'expense' ? won(t.amount) : ''}</td>
                          <td className="muted small">{t.note}</td>
                        </tr>
                      ))}
                      <tr className="day-sum"><td /><td colSpan={3} className="muted small">{fmtDate(d)} 합계</td><td className="num">{won(totals(xs, d, d).income + totals(xs, d, d).carry)}</td><td className="num">{won(totals(xs, d, d).expense)}</td><td /></tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">* 표시는 성도 명부에 없는 이름입니다. 명부에 같은 이름의 성도를 넣으면 영수증에서 함께 모입니다.</p>
          </div>
        )}
      </div>
      {edit && <TxDialog data={data} members={members} tx={edit} onClose={() => setEdit(null)} reload={reload} />}
    </>
  );
}

const cats = (s: FinanceSettings, type: 'income' | 'expense', fund: Fund) => s.categories[type]?.[fund] || [];
const NEW_CAT = '\u0000new';
// 입력하다가 그 자리에서 새 항목 만들기
async function askCategory(base: string, type: 'income' | 'expense', fund: Fund, reload: () => Promise<void>) {
  const name = prompt(`${fund} ${TYPE_LABEL[type]} 항목에 더할 이름을 넣어 주세요.`)?.trim();
  if (!name) return '';
  try { await categoryOp(base, { op: 'add', type, fund, name }); await reload(); return name; }
  catch (e: any) { if (/이미 있습니다/.test(e.message)) return name; alert(e.message); return ''; }
}

function EntryForm({ data, members, onSaved }: { data: FinanceData; members: Member[]; onSaved: () => Promise<void> }) {
  const { base } = useApp();
  const first = (): Row => ({ date: lastSunday(ymd(new Date())), type: 'income', fund: '일반재정', category: cats(data.settings, 'income', '일반재정')[0] || '', name: '', amount: '', note: '' });
  // 적던 줄은 이 컴퓨터에 잠시 보관한다: 입력 창을 닫거나 다른 탭에 다녀와도, 실수로 창을 닫아도 다시 나온다
  const draftKey = `fin-entry-draft:${base}`;
  const used = (r: Row) => !!(r.name.trim() || r.amount.trim() || r.note.trim());
  const [rows, setRows] = useState<Row[]>(() => {
    try { const d = JSON.parse(localStorage.getItem(draftKey) || 'null'); if (Array.isArray(d) && d.some(used)) return d; } catch { /* 없음 */ }
    return [first()];
  });
  const [restored] = useState(() => rows.some(used));
  useEffect(() => {
    try { if (rows.some(used)) localStorage.setItem(draftKey, JSON.stringify(rows)); else localStorage.removeItem(draftKey); } catch { /* 저장 못 해도 입력은 계속 */ }
  }, [rows, draftKey]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => {
    if (j !== i) return r;
    const n = { ...r, ...patch };
    if ((patch.type || patch.fund) && !cats(data.settings, n.type, n.fund).includes(n.category)) n.category = cats(data.settings, n.type, n.fund)[0] || '';
    return n;
  }));
  const newCategory = (type: Row['type'], fund: Fund) => askCategory(base, type, fund, onSaved);
  const addRow = () => { const p = rows[rows.length - 1]; setRows([...rows, { ...p, name: '', amount: '', note: '' }]); setTimeout(() => { const els = document.querySelectorAll<HTMLInputElement>('.entry-name'); els[els.length - 1]?.focus(); }, 0); };
  const filled = rows.filter((r) => parseWon(r.amount) > 0);
  // 금액을 읽지 못한 줄 (이름이나 금액을 적었는데 금액이 0): 장부에 넣지 않고 그대로 남겨 고치게 한다
  const unread = (r: Row) => used(r) && parseWon(r.amount) <= 0;
  const bad = rows.filter(unread);
  const total = filled.reduce((s, r) => s + (r.type === 'income' ? 1 : -1) * parseWon(r.amount), 0);
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await api<{ added: Tx[] }>(`${base}/finance/tx`, { method: 'POST', body: { rows: filled.map((x) => ({ ...x, amount: parseWon(x.amount) })) } });
      await onSaved();
      const p = rows[rows.length - 1];
      // 금액을 읽지 못한 줄은 지우지 않고 남긴다 (예전에는 함께 지워져 헌금 기록이 사라졌다)
      setRows(bad.length ? bad : [{ ...p, name: '', amount: '', note: '' }]);
      setMsg(`${r.added.length}건을 장부에 넣었습니다.${bad.length ? ` 금액을 읽지 못한 ${bad.length}줄은 넣지 않고 남겨 두었습니다. 금액을 고친 뒤 다시 넣어 주세요.` : ''}`);
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  return (
    <div className="card">
      <h3>수입·지출 입력</h3>
      <p className="muted small">금액 칸에서 <b>Enter</b>를 누르면 날짜·항목이 같은 새 줄이 생깁니다 (주일 헌금을 이름만 바꿔 계속 넣을 때). 금액은 <code>30000</code>, <code>3만</code>, <code>3만5천</code>처럼 넣어도 됩니다.</p>
      <datalist id="member-names">{members.filter((m) => m.status !== 'deceased').map((m) => <option key={m.id} value={m.name} />)}</datalist>
      <div className="table-wrap">
        <table className="entry-table">
          <thead><tr><th>날짜</th><th>구분</th><th>재정</th><th>항목</th><th>이름·거래처</th><th>금액</th><th>메모</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input type="date" value={r.date} onChange={(e) => set(i, { date: e.target.value })} /></td>
                <td><select value={r.type} onChange={(e) => set(i, { type: e.target.value as Row['type'] })}><option value="income">수입</option><option value="expense">지출</option></select></td>
                <td><select value={r.fund} onChange={(e) => set(i, { fund: e.target.value as Fund })}>{FUNDS.map((f) => <option key={f}>{f}</option>)}</select></td>
                <td><select value={r.category} onChange={async (e) => { if (e.target.value === NEW_CAT) { const n = await newCategory(r.type, r.fund); if (n) set(i, { category: n }); } else set(i, { category: e.target.value }); }}>{cats(data.settings, r.type, r.fund).map((c) => <option key={c}>{c}</option>)}<option value={NEW_CAT}>+ 새 항목 만들기…</option></select></td>
                <td><input className="entry-name" list={r.type === 'income' ? 'member-names' : undefined} value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder={r.type === 'income' ? '헌금자 (무명 가능)' : '거래처'} /></td>
                <td><input className={`num ${unread(r) ? 'bad-input' : ''}`} aria-invalid={unread(r) || undefined} inputMode="numeric" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addRow(); } }} placeholder="0" />{r.amount && parseWon(r.amount) > 0 && !/^\d+$/.test(r.amount.replace(/[,\s]/g, '')) && <small className="muted">{won(parseWon(r.amount))}</small>}{unread(r) && <small className="warn-text entry-bad">금액을 읽지 못함</small>}</td>
                <td><input value={r.note} onChange={(e) => set(i, { note: e.target.value })} /></td>
                <td><button className="icon" aria-label="줄 빼기" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row between">
        <button onClick={addRow}>줄 추가</button>
        <div className="row">
          {msg && <span className={/넣었습니다/.test(msg) && !bad.length ? 'ok-text' : 'warn-text'}>{msg}</span>}
          {!msg && restored && <span className="muted small">지난번에 적던 줄을 다시 불러왔습니다.</span>}
          <span className="muted">{filled.length}건 · {won(total)}{bad.length ? <span className="warn-text"> · 금액을 읽지 못한 줄 {bad.length}</span> : null}</span>
          <button className="primary" disabled={busy || !filled.length} onClick={save}>{busy ? '저장 중…' : '장부에 넣기'}</button>
        </div>
      </div>
    </div>
  );
}

function TxDialog({ data, members, tx, onClose, reload }: { data: FinanceData; members: Member[]; tx: Tx; onClose: () => void; reload: () => Promise<void> }) {
  const g = useGuardedClose(onClose);
  const { base } = useApp();
  const member = members.find((m) => m.id === tx.memberId);
  const [f, setF] = useState({ date: tx.date, type: tx.type, fund: tx.fund, category: tx.category, name: member?.name || tx.name, amount: String(tx.amount), note: tx.note });
  const [err, setErr] = useState('');
  const options = cats(data.settings, f.type, f.fund);
  const save = async () => {
    try { await api(`${base}/finance/tx/${tx.id}`, { method: 'PUT', body: { ...f, amount: parseWon(f.amount), memberId: member && f.name === member.name ? member.id : '' } }); await reload(); onClose(); } catch (e: any) { setErr(e.message); }
  };
  const remove = async () => {
    if (!confirm(`${fmtDate(tx.date)} ${tx.category} ${won(tx.amount)} 기록을 지울까요? 되돌릴 수 없습니다.`)) return;
    try { await api(`${base}/finance/tx/${tx.id}`, { method: 'DELETE' }); await reload(); onClose(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="dialog-back" onClick={g.close}>
      <div {...g.track} className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2>장부 기록 고치기</h2>
        <datalist id="member-names-edit">{members.map((m) => <option key={m.id} value={m.name} />)}</datalist>
        <div className="form-grid">
          <label>날짜<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label>구분<select value={f.type} onChange={(e) => { const type = e.target.value as Tx['type']; setF({ ...f, type, category: cats(data.settings, type, f.fund).includes(f.category) ? f.category : cats(data.settings, type, f.fund)[0] || '' }); }}><option value="income">수입</option><option value="expense">지출</option></select></label>
          <label>재정<select value={f.fund} onChange={(e) => { const fund = e.target.value as Fund; setF({ ...f, fund, category: cats(data.settings, f.type, fund).includes(f.category) ? f.category : cats(data.settings, f.type, fund)[0] || '' }); }}>{FUNDS.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>항목<select value={f.category} onChange={async (e) => { if (e.target.value === NEW_CAT) { const n = await askCategory(base, f.type, f.fund, reload); if (n) setF({ ...f, category: n }); } else setF({ ...f, category: e.target.value }); }}>{[...new Set([...options, f.category])].filter(Boolean).map((c) => <option key={c}>{c}</option>)}<option value={NEW_CAT}>+ 새 항목 만들기…</option></select></label>
          <label>이름·거래처<input list="member-names-edit" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>금액<input inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label className="span2">메모<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        </div>
        {member && <p className="muted small">성도 명부의 {member.name} 님과 연결된 기록입니다.</p>}
        {err && <p className="alert err">{err}</p>}
        <div className="row between">
          <button className="danger-link" onClick={remove}>기록 지우기</button>
          <div className="row"><button onClick={g.close}>취소</button><button className="primary" onClick={save}>저장</button></div>
        </div>
      </div>
    </div>
  );
}

// ── 보고서 · 예산 ───────────────────────────────────
function Report({ data, year, reload }: { data: FinanceData; year: string; reload: () => Promise<void> }) {
  const { base, ov } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const by = byCategory(data.tx, year);
  const budget = data.budgets[year] || {};
  const end = balances(data.tx, `${year}-12-31`);
  const months = monthly(data.tx, year);
  const allNames = (type: 'income' | 'expense', fund: Fund) => [...new Set([...cats(data.settings, type, fund), ...Object.keys(by[type][fund] || {})])];
  // 고칠 때는 수입/지출·재정·항목마다 따로 (예전 이름만 쓴 예산은 그 값을 각 칸에 옮겨 둔다)
  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const type of ['income', 'expense'] as const) for (const fund of FUNDS) for (const c of allNames(type, fund)) { const v = budgetOf(budget, type, fund, c); if (v) d[budgetKey(type, fund, c)] = String(v); }
    setDraft(d); setEditing(true); setMsg('');
  };
  const saveBudget = async () => {
    try {
      // 화면에 없는 항목의 옛 예산(이름만 쓴 것)은 그대로 남긴다
      const shown = new Set((['income', 'expense'] as const).flatMap((type) => FUNDS.flatMap((fund) => allNames(type, fund))));
      const keep = Object.fromEntries(Object.entries(budget).filter(([k]) => !k.includes('/') && !shown.has(k)));
      await api(`${base}/finance/budgets/${year}`, { method: 'PUT', body: { budgets: { ...keep, ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, parseWon(v)])) } } });
      await reload(); setEditing(false); setMsg('예산을 저장했습니다.');
    } catch (e: any) { setMsg(e.message); }
  };
  const rowsFor = (type: 'income' | 'expense', fund: Fund) => {
    return allNames(type, fund).map((c) => ({ c, k: budgetKey(type, fund, c), actual: by[type][fund]?.[c] || 0, plan: budgetOf(budget, type, fund, c) })).filter((x) => x.actual || x.plan || editing);
  };
  const table = (type: 'income' | 'expense') => {
    let tp = 0, ta = 0;
    return (
      <table className="people-table fin-table report-table">
        <thead><tr><th>{TYPE_LABEL[type]}</th><th className="num">예산</th><th className="num">결산</th><th className="num">비율</th></tr></thead>
        <tbody>
          {FUNDS.map((fund) => {
            const rows = rowsFor(type, fund);
            if (!rows.length) return null;
            const p = rows.reduce((s, r) => s + r.plan, 0), a = rows.reduce((s, r) => s + r.actual, 0);
            tp += p; ta += a;
            return (
              <Fragment key={fund}>
                <tr className="fund-head"><td colSpan={4}>{fund}</td></tr>
                {rows.map((r) => (
                  <tr key={r.c}>
                    <td>{r.c}</td>
                    <td className="num">{editing ? <input className="num budget-input" inputMode="numeric" value={draft[r.k] ?? ''} onChange={(e) => setDraft({ ...draft, [r.k]: e.target.value })} aria-label={`${fund} ${r.c} 예산`} /> : r.plan ? won(r.plan) : ''}</td>
                    <td className="num">{won(r.actual)}</td>
                    <td className="num muted">{r.plan ? `${Math.round((r.actual / r.plan) * 100)}%` : ''}</td>
                  </tr>
                ))}
                <tr className="day-sum"><td>{fund} 소계</td><td className="num">{p ? won(p) : ''}</td><td className="num">{won(a)}</td><td /></tr>
              </Fragment>
            );
          })}
          <tr className="grand"><td>{TYPE_LABEL[type]} 합계</td><td className="num">{tp ? won(tp) : ''}</td><td className="num">{won(ta)}</td><td className="num muted">{tp ? `${Math.round((ta / tp) * 100)}%` : ''}</td></tr>
        </tbody>
      </table>
    );
  };
  const body = (
    <>
      <div className="grid2">
        <div>{table('income')}</div>
        <div>{table('expense')}</div>
      </div>
      <h3>재정별 잔액</h3>
      <table className="people-table fin-table">
        <thead><tr><th>재정</th><th className="num">{year}년 수입</th><th className="num">{year}년 지출</th><th className="num">연말 잔액</th></tr></thead>
        <tbody>
          {FUNDS.map((f) => {
            const xs = data.tx.filter((t) => t.fund === f && t.date.startsWith(year));
            return <tr key={f}><td>{f}</td><td className="num">{won(xs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0))}</td><td className="num">{won(xs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0))}</td><td className="num"><b>{won(end[f])}</b></td></tr>;
          })}
        </tbody>
      </table>
      <h3>월별 (이월금 제외)</h3>
      <div className="table-wrap">
        <table className="people-table fin-table">
          <thead><tr><th /><th className="num">수입</th><th className="num">지출</th><th className="num">차액</th></tr></thead>
          <tbody>{months.map((m) => <tr key={m.month}><td>{m.month}월</td><td className="num">{won(m.income)}</td><td className="num">{won(m.expense)}</td><td className="num">{won(m.income - m.expense)}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
  return (
    <>
      <div className="card">
        <div className="row between">
          <h2>{year}년 예산·결산</h2>
          <div className="row wrap">
            {msg && <span className="muted">{msg}</span>}
            {editing ? <><button onClick={() => setEditing(false)}>취소</button><button className="primary" onClick={saveBudget}>예산 저장</button></>
              : <><button onClick={startEdit}>예산 넣기·고치기</button><button onClick={() => window.print()}>인쇄 (제직회·공동의회용)</button></>}
          </div>
        </div>
        {body}
      </div>
      {!editing && (
        <div className="print-area">
          <h2>{ov?.church?.name} {year}년 재정 보고</h2>
          <p>출력일 {ymd(new Date())}</p>
          {body}
        </div>
      )}
    </>
  );
}

// ── 기부금 영수증 ───────────────────────────────────
function Receipts({ data, members, year, reload }: { data: FinanceData; members: Member[]; year: string; reload: () => Promise<void> }) {
  const { base, ov } = useApp();
  const nav = useNavigate();
  const list = useMemo(() => donors(data.tx, year, members), [data.tx, year, members]);
  const [sel, setSel] = useState<string>('');
  const [printAll, setPrintAll] = useState(false);
  const [msg, setMsg] = useState('');
  const d = list.find((x) => x.key === sel) || null;
  const r = data.settings.receipt;
  const missing = [!r.regNo && '고유번호', !r.address && '소재지'].filter(Boolean);
  const unlinked = list.filter((x) => !x.member);
  const relink = async () => {
    try { const x = await api<{ linked: number }>(`${base}/finance/relink`, { method: 'POST' }); await reload(); setMsg(`${x.linked}건을 명부의 성도와 이었습니다.`); } catch (e: any) { setMsg(e.message); }
  };
  const print = (all: boolean) => { setPrintAll(all); setTimeout(() => window.print(), 50); };
  const ctx = { church: ov?.church?.name || '', pastor: r.representative || ov?.church?.pastor || '', regNo: r.regNo, address: r.address, year };
  return (
    <>
      <div className="alert info small">
        국세청 기부금 영수증 서식(소득세법 시행규칙 별지 제45호의2)을 참고한 양식입니다. <b>주민등록번호는 저장하지 않으니</b> 인쇄한 뒤 직접 적어 주세요.
        연말정산 간소화 서비스(전자기부금영수증)에 올리는 것은 이 프로그램이 하지 않습니다.
      </div>
      {missing.length > 0 && <p className="alert warn">영수증에 넣을 교회 {missing.join('·')}가 비어 있습니다. <button className="link" onClick={() => nav('/finance/settings')}>항목·가져오기 탭</button>에서 넣어 주세요.</p>}
      <div className="grid2 wide-left receipts">
        <div className="card">
          <div className="row between">
            <h3>{year}년 헌금자 {list.length}명</h3>
            <button disabled={!list.length} onClick={() => print(true)}>모두 인쇄</button>
          </div>
          {!list.length ? <p className="muted">{year}년 헌금 기록이 없습니다. (이월금·무명 헌금은 영수증에서 뺍니다)</p> : (
            <table className="people-table">
              <thead><tr><th>이름</th><th className="num">건수</th><th className="num">합계</th></tr></thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.key} className={sel === x.key ? 'on' : ''} onClick={() => setSel(x.key)}>
                    <td><b>{x.name}</b>{!x.member && <span className="muted small" title="성도 명부에 없는 이름"> *</span>}</td>
                    <td className="num">{x.count}</td>
                    <td className="num">{won(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {unlinked.length > 0 && (
            <p className="muted small">* {unlinked.length}명은 성도 명부에 없는 이름입니다. 성도 명부에 같은 이름으로 넣으면 그 성도로 모이고 주소도 영수증에 들어갑니다. (장부 기록까지 이어 두려면 <button className="link" onClick={relink}>명부와 다시 맞추기</button>)</p>
          )}
          {msg && <p className="ok-text small">{msg}</p>}
        </div>
        <div className="card">
          {d ? (
            <>
              <div className="row between"><h3>{d.name} 님 영수증</h3><button className="primary" onClick={() => print(false)}>인쇄</button></div>
              <ReceiptDoc d={d} n={list.indexOf(d) + 1} {...ctx} preview />
            </>
          ) : <p className="muted">왼쪽에서 이름을 누르면 영수증을 미리 봅니다.</p>}
        </div>
      </div>
      <div className="print-area receipts-print">
        {(printAll ? list : d ? [d] : []).map((x) => <ReceiptDoc key={x.key} d={x} n={list.indexOf(x) + 1} {...ctx} />)}
      </div>
    </>
  );
}

function ReceiptDoc({ d, n, church, pastor, regNo, address, year, preview = false }: { d: Donor; n: number; church: string; pastor: string; regNo: string; address: string; year: string; preview?: boolean }) {
  const months = donorMonths(d);
  return (
    <div className="receipt">
      <div className="receipt-no">일련번호 {year}-{String(n).padStart(3, '0')}</div>
      <h2 className="receipt-title">기 부 금 영 수 증</h2>
      <table>
        <tbody>
          <tr><th colSpan={4} className="sec">① 기부자</th></tr>
          <tr><th>성명</th><td>{d.name}</td><th>주민등록번호</th><td className="blank" /></tr>
          <tr><th>주소</th><td colSpan={3}>{d.member?.address || (preview ? <span className="muted small no-print">{d.member ? '성도 명부에 주소가 없습니다 — 성도 → 이름 누르기 → 주소' : '성도 명부에 없는 이름이라 주소를 넣을 수 없습니다'}</span> : '')}</td></tr>
          <tr><th colSpan={4} className="sec">② 기부금 단체</th></tr>
          <tr><th>단체명</th><td>{church}</td><th>고유번호</th><td>{regNo}</td></tr>
          <tr><th>소재지</th><td colSpan={3}>{address}</td></tr>
          <tr><th colSpan={4} className="sec">③ 기부 내용</th></tr>
          <tr><th>유형 (코드)</th><th>구분</th><th>연월</th><th className="num">금액</th></tr>
          {months.map(([m, v]) => <tr key={m}><td>종교단체 (41)</td><td>금전</td><td>{m.replace('-', '년 ')}월</td><td className="num">{won(v)}</td></tr>)}
          <tr className="grand"><td colSpan={3}>합계</td><td className="num">{won(d.total)}</td></tr>
        </tbody>
      </table>
      <p className="receipt-foot">위와 같이 기부금을 기부받았음을 증명합니다.</p>
      <p className="receipt-sign">{ymd(new Date()).replace(/-/g, '. ')}.<br />기부금 수령인 {church} 대표 {pastor} (인)</p>
    </div>
  );
}

// ── 항목·교회 정보·가져오기 ─────────────────────────────
function Settings({ data, reload }: { data: FinanceData; reload: () => Promise<void> }) {
  const { base, ov, ws } = useApp();
  const [receipt, setReceipt] = useState({ ...data.settings.receipt, representative: data.settings.receipt.representative || ov?.church?.pastor || '' });
  const [msg, setMsg] = useState('');
  const [imp, setImp] = useState('');
  const save = async () => {
    try { await api(`${base}/finance/settings`, { method: 'PUT', body: { receipt } }); await reload(); setMsg('저장했습니다.'); } catch (e: any) { setMsg(e.message); }
  };
  const importFile = async (file: File) => {
    setImp('읽는 중…');
    try {
      const j = JSON.parse(await file.text());
      const r = await api<{ added: number; skipped: number; bad: number; budget: boolean }>(`${base}/finance/import`, { method: 'POST', body: { transactions: j.transactions, budgets: j.budgets } });
      await reload();
      setImp(`${r.added}건을 가져왔습니다.${r.skipped ? ` (이미 가져온 ${r.skipped}건은 건너뜀)` : ''}${r.bad ? ` 날짜·금액이 비어 ${r.bad}건은 넣지 못했습니다.` : ''}${r.budget ? ' 올해 예산도 넣었습니다.' : ''}`);
    } catch (e: any) { setImp(e instanceof SyntaxError ? '회계장부 백업(JSON) 파일이 아닙니다.' : e.message); }
  };
  return (
    <div className="narrow">
      <div className="card">
        <h2>기존 회계장부 자료 가져오기</h2>
        <p className="small">쓰시던 <b>회계장부</b> 프로그램의 <b>설정 → 백업 파일 내보내기</b>로 받은 <code>…ledger_backup….json</code> 파일을 고르세요. 수입·지출 기록과 예산을 복사해 옵니다.</p>
        <ul className="small muted">
          <li>회계장부 프로그램과 그 자료는 그대로 남습니다 (복사만 함).</li>
          <li>같은 파일을 다시 가져와도 이미 들어온 기록은 겹치지 않습니다. 회계장부에 새로 적은 것만 더해집니다.</li>
          <li>헌금자 이름이 성도 명부의 한 분과 같으면 자동으로 이어집니다.</li>
        </ul>
        {ws === 'sample' && <p className="alert warn small">지금은 예제 자료입니다. 실제 장부는 왼쪽 메뉴 아래 '우리 교회'로 바꾼 뒤 가져오세요.</p>}
        <input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
        {imp && <p className="small">{imp}</p>}
      </div>
      <div className="card">
        <h2>영수증에 넣을 교회 정보</h2>
        <div className="form-grid">
          <label>고유번호 (사업자등록번호)<input value={receipt.regNo} onChange={(e) => setReceipt({ ...receipt, regNo: e.target.value })} placeholder="000-00-00000" /></label>
          <label>대표자<input value={receipt.representative} onChange={(e) => setReceipt({ ...receipt, representative: e.target.value })} /></label>
          <label className="span2">소재지<input value={receipt.address} onChange={(e) => setReceipt({ ...receipt, address: e.target.value })} /></label>
        </div>
        <div className="row end">{msg && <span className="muted">{msg}</span>}<button className="primary" onClick={save}>교회 정보 저장</button></div>
      </div>
      <CategoryEditor data={data} reload={reload} />
    </div>
  );
}

// 항목 편집: 재정 구분마다 항목을 더하고, 이름을 바꾸고, 순서를 바꾸고, 뺀다 (누르는 즉시 저장)
export async function categoryOp(base: string, body: { op: 'add' | 'rename' | 'move' | 'remove'; type: 'income' | 'expense'; fund: Fund; name: string; to?: string; dir?: number }) {
  return api<{ settings: FinanceSettings; count: number }>(`${base}/finance/category`, { method: 'POST', body });
}

function CategoryEditor({ data, reload }: { data: FinanceData; reload: () => Promise<void> }) {
  const { base } = useApp();
  const [type, setType] = useState<'income' | 'expense'>('income');
  const [fund, setFund] = useState<Fund>('일반재정');
  const [adding, setAdding] = useState('');
  const [renaming, setRenaming] = useState<{ name: string; to: string } | null>(null);
  const [msg, setMsg] = useState('');
  const list = cats(data.settings, type, fund);
  const count = (c: string) => data.tx.filter((t) => t.type === type && t.fund === fund && t.category === c).length;
  const run = async (body: Parameters<typeof categoryOp>[1], done?: string) => {
    try { await categoryOp(base, body); await reload(); setMsg(done || ''); return true; } catch (e: any) { setMsg(e.message); return false; }
  };
  const add = async () => { if (adding.trim() && (await run({ op: 'add', type, fund, name: adding.trim() }, `'${adding.trim()}' 항목을 더했습니다.`))) setAdding(''); };
  const rename = async () => {
    if (!renaming) return;
    const n = count(renaming.name);
    if (n && !confirm(`'${renaming.name}' 항목으로 적은 기록 ${n}건도 '${renaming.to}'(으)로 함께 바뀝니다. 바꿀까요?`)) return;
    if (await run({ op: 'rename', type, fund, name: renaming.name, to: renaming.to }, '이름을 바꿨습니다.')) setRenaming(null);
  };
  const remove = async (c: string) => {
    const n = count(c);
    if (!confirm(n ? `'${c}' 항목을 목록에서 뺄까요?\n이미 적은 기록 ${n}건은 지워지지 않고 그대로 남습니다 (보고서에도 나옵니다).` : `'${c}' 항목을 목록에서 뺄까요?`)) return;
    run({ op: 'remove', type, fund, name: c }, `'${c}' 항목을 뺐습니다.`);
  };
  return (
    <div className="card">
      <h2>수입·지출 항목</h2>
      <p className="muted small">교회에서 쓰는 이름대로 항목을 더하고 고치세요. 누르는 즉시 저장됩니다. 이름 끝이 '이월금'인 항목은 헌금으로 세지 않습니다(영수증·월별 수입에서 뺌).</p>
      <div className="row wrap">
        <div className="seg">{(['income', 'expense'] as const).map((t) => <button key={t} className={type === t ? 'on' : ''} onClick={() => { setType(t); setRenaming(null); }}>{TYPE_LABEL[t]}</button>)}</div>
        <div className="seg">{FUNDS.map((f) => <button key={f} className={fund === f ? 'on' : ''} onClick={() => { setFund(f); setRenaming(null); }}>{f}</button>)}</div>
      </div>
      <ul className="cat-list">
        {list.map((c, i) => (
          <li key={c}>
            {renaming?.name === c ? (
              <>
                <input autoFocus value={renaming.to} onChange={(e) => setRenaming({ name: c, to: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) rename(); if (e.key === 'Escape') setRenaming(null); }} />
                <button className="small primary" disabled={!renaming.to.trim() || renaming.to.trim() === c} onClick={rename}>바꾸기</button>
                <button className="small" onClick={() => setRenaming(null)}>취소</button>
              </>
            ) : (
              <>
                <span className="grow">{c} {count(c) > 0 && <span className="muted small">· 기록 {count(c)}건</span>}</span>
                <button className="icon" aria-label="위로" disabled={i === 0} onClick={() => run({ op: 'move', type, fund, name: c, dir: -1 })}>▲</button>
                <button className="icon" aria-label="아래로" disabled={i === list.length - 1} onClick={() => run({ op: 'move', type, fund, name: c, dir: 1 })}>▼</button>
                <button className="small" onClick={() => setRenaming({ name: c, to: c })}>이름 바꾸기</button>
                <button className="small" onClick={() => remove(c)}>빼기</button>
              </>
            )}
          </li>
        ))}
        {!list.length && <li className="muted">항목이 없습니다. 아래에서 더해 주세요.</li>}
      </ul>
      <div className="row">
        <input className="grow" placeholder={`${fund} ${TYPE_LABEL[type]} 항목 이름 (예: ${type === 'income' ? '추수감사헌금' : '차량유지비'})`} value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }} />
        <button className="primary" disabled={!adding.trim()} onClick={add}>항목 더하기</button>
      </div>
      {msg && <p className="small muted">{msg}</p>}
    </div>
  );
}

// Rapoarte: pontaj, ore suplimentare, sărbători, producție, financiar. Export PDF / Excel / CSV.
import { esc, icon, toast, emptyState } from '../ui.js';
import { fmtDate, localTime, toMs, weekStart, addDays, monthStart, monthEnd, round2, fmtMoney, monthName, dateRange } from '../util.js';
import { totalsFor, moneySummary, SETTLEMENT, HOLIDAY_MODES, compLedger, evalNorm } from '../calc.js';
import { COUNTRIES } from '../holidays.js';
import { toCSV, toXLSX, toPDF } from '../export.js';

const TYPES = { pontaj: 'Raport de pontaj', suplimentare: 'Raport de ore suplimentare', sarbatori: 'Raport de sărbători', productie: 'Raport de producție', financiar: 'Raport financiar' };
const h = (min) => round2((min || 0) / 60);
const st = { type: 'pontaj', preset: 'luna', from: null, to: null, employerId: '', contractId: '', activityId: '', country: '' };

function bounds(app) {
  const t = app.today();
  switch (st.preset) {
    case 'zi': return [st.from || t, st.from || t];
    case 'saptamana': { const ws = weekStart(st.from || t); return [ws, addDays(ws, 6)]; }
    case 'luna': { const a = (st.from || t); return [monthStart(a), monthEnd(a)]; }
    default: return [st.from || monthStart(t), st.to || t];
  }
}

function shiftsIn(app, R, from, to) {
  return [...R.calc.values()].filter((c) => c.date >= from && c.date <= to &&
    (!st.employerId || c.employerId === st.employerId) && (!st.contractId || c.contractId === st.contractId) &&
    (!st.country || (c.contract?.country || '') === st.country) &&
    (!st.activityId || c.slices.some((s) => s.activityId === st.activityId))).sort((a, b) => a.t.start - b.t.start);
}

export function buildReport(app, type, from, to) {
  const R = app.calc(); const S = app.state();
  const filterTxt = [st.employerId && app.name(st.employerId), st.contractId && app.name(st.contractId), st.activityId && app.name(st.activityId), st.country && COUNTRIES[st.country]].filter(Boolean).join(' · ');
  const base = { title: TYPES[type], subtitle: `Perioada ${fmtDate(from)} – ${fmtDate(to)}${filterTxt ? ' · ' + filterTxt : ''} · ore în format zecimal (ex. 10,5 = 10h 30m)`, sections: [] };
  const filter = { employerId: st.employerId || undefined, contractId: st.contractId || undefined, country: st.country || undefined };
  const list = shiftsIn(app, R, from, to);
  const loc = (l) => (l?.locationId ? app.name(l.locationId) : l?.geo ? `${l.geo.lat},${l.geo.lng}` : '');
  const N = (key, label, extra = {}) => ({ key, label, num: true, ...extra });
  const C = (key, label, extra = {}) => ({ key, label, ...extra });

  if (type === 'pontaj') {
    const rows = list.map((c) => {
      const acts = {}; for (const s of c.slices) acts[s.activityId || '_'] = (acts[s.activityId || '_'] || 0) + s.min;
      const effAct = st.activityId ? (acts[st.activityId] || 0) : c.t.effMin;
      return { date: fmtDate(c.date), start: localTime(c.t.start, app.tz), end: c.shift.end ? localTime(c.t.end, app.tz) : 'deschis', breaks: h(c.t.breakMin), eff: h(effAct), norm: c.dailyNormMin == null ? '' : h(c.dailyNormMin),
        diff: c.dailyNormMin == null ? '' : h(c.t.effMin - c.dailyNormMin), acts: Object.entries(acts).map(([k, v]) => `${k === '_' ? 'Nealocat' : app.name(k)} ${h(v)}h`).join('; '),
        locs: [...new Set([loc(c.shift.startLoc), ...(c.shift.segments || []).map((g) => loc(g)), loc(c.shift.endLoc)].filter(Boolean))].join('; '), emp: app.name(c.employerId) };
    });
    const sum = (k) => round2(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0));
    base.sections.push({ title: 'Pontaj', sheet: 'Pontaj', columns: [C('date', 'Data'), C('start', 'Începere'), C('end', 'Terminare'), N('breaks', 'Pauze (h)'), N('eff', 'Ore efective'), N('norm', 'Norma zilnică'), N('diff', 'Diferență față de normă'), C('acts', 'Activități', { w: 40 }), C('locs', 'Locații', { w: 30 }), C('emp', 'Angajator')],
      rows, totals: { date: `Total (${rows.length} ture)`, breaks: sum('breaks'), eff: sum('eff'), norm: sum('norm'), diff: sum('diff') } });
  }
  if (type === 'suplimentare') {
    const rows = list.map((c) => {
      const paid = c.shift.settlement?.ot === 'platit' ? c.otEligibleMin : 0;
      return { date: fmtDate(c.date), eff: h(c.t.effMin), norm: c.dailyNormMin == null ? '' : h(c.dailyNormMin), over: h(c.otMin), daily: h(c.dailyOverMin), elig: h(c.otEligibleMin), inel: h(c.otIneligibleMin), unc: h(c.otUnconfirmedMin),
        paid: h(paid), unpaid: h(Math.max(0, c.otEligibleMin - paid - (c.compFromOtMin || 0))), comp: h(c.compFromOtMin), status: c.otMin ? (SETTLEMENT[c.shift.settlement?.ot] || 'Neconfirmat') : '', reason: c.otMin ? c.otReason : '' };
    });
    const sum = (k) => round2(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0));
    base.sections.push({ title: 'Ore suplimentare', sheet: 'Ore suplimentare', columns: [C('date', 'Data'), N('eff', 'Efectiv'), N('norm', 'Normă'), N('over', 'Peste normă'), N('elig', 'Eligibile'), N('inel', 'Neeligibile'), N('unc', 'Neconfirmate'), N('paid', 'Plătite'), N('unpaid', 'Neplătite'), N('comp', 'Compensatorii'), C('status', 'Statut'), C('reason', 'Motiv', { w: 40 })],
      rows, totals: { date: 'Total', eff: sum('eff'), norm: sum('norm'), over: sum('over'), elig: sum('elig'), inel: sum('inel'), unc: sum('unc'), paid: sum('paid'), unpaid: sum('unpaid'), comp: sum('comp') } });
  }
  if (type === 'sarbatori') {
    const hl = list.filter((c) => c.holidayMin > 0);
    const rows = hl.map((c) => {
      const hol = c.slices.find((s) => s.holiday)?.holiday;
      const rate = c.breakdown?.find((b) => b.holiday);
      return { date: fmtDate(c.date), name: hol?.name || '', worked: h(c.t.effMin), hol: h(c.holidayMin), over: h(c.otMin), rule: HOLIDAY_MODES[c.holidayMode] || '', rate: rate ? `${rate.rate} × ${round2(rate.mult)}` : '',
        value: c.money.total, paid: c.shift.settlement?.holiday === 'platit' ? c.money.total : 0, comp: h(c.compFromHolidayMin), status: SETTLEMENT[c.shift.settlement?.holiday] || 'Neconfirmat' };
    });
    const sum = (k) => round2(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0));
    const L = compLedger(S, R, to);
    base.sections.push({ title: 'Zile de sărbătoare lucrate', sheet: 'Sărbători', columns: [C('date', 'Data'), C('name', 'Sărbătoarea'), N('worked', 'Ore lucrate'), N('hol', 'Ore de sărbătoare'), N('over', 'Din care peste normă'), C('rule', 'Regula'), C('rate', 'Tarif aplicat'), N('value', 'Valoare estimată', { fixed: true }), N('paid', 'Sume plătite', { fixed: true }), N('comp', 'Ore compensate'), C('status', 'Statut')],
      rows, totals: { date: `Total (${rows.length} zile)`, worked: sum('worked'), hol: sum('hol'), over: sum('over'), value: sum('value'), paid: sum('paid'), comp: sum('comp') } });
    base.sections.push({ title: 'Sold ore compensatorii', sheet: 'Sold', columns: [C('k', 'Indicator'), N('v', 'Ore')],
      rows: [{ k: 'Acordate (total)', v: h(L.granted) }, { k: 'Din lucru de sărbătoare', v: h(L.fromHoliday) }, { k: 'Folosite', v: h(L.used) }, { k: `Sold rămas la ${fmtDate(to)}`, v: h(L.balance) }] });
    base.note = 'Orele de sărbătoare care sunt și peste normă apar în ambele coloane, dar sunt numărate o singură dată în „Ore lucrate”.';
  }
  if (type === 'productie') {
    const prod = R.production.filter((p) => p.date >= from && p.date <= to && (!st.employerId || p.employerId === st.employerId) && (!st.contractId || p.contractId === st.contractId) && (!st.activityId || p.activityId === st.activityId))
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    base.sections.push({ title: 'Înregistrări de producție', sheet: 'Producție', columns: [C('date', 'Data'), C('time', 'Ora'), C('act', 'Activitatea'), N('qty', 'Cantitate'), C('unit', 'Unitate'), C('loc', 'Locația'), C('note', 'Observații', { w: 30 })],
      rows: prod.map((p) => ({ date: fmtDate(p.date), time: p.time ? localTime(toMs(p.time), app.tz) : '', act: app.name(p.activityId, ''), qty: Number(p.qty), unit: p.unit, loc: app.name(p.locationId, ''), note: p.note || '' })) });
    // îndeplinirea normelor pe perioade
    const norms = app.store.list('norm').filter((n) => (!st.employerId || n.employerId === st.employerId));
    const rows = [];
    for (const n of norms) {
      const seen = new Set();
      for (const d of dateRange(from, to)) {
        if ((n.validFrom && d < n.validFrom) || (n.validTo && d > n.validTo)) continue;
        const ctx = { production: R.production, today: app.today(), dayClosed: (x) => x < app.today(), effByDate: {}, dailyNormMin: null };
        const e = evalNorm(n, d, ctx);
        const key = e.range ? e.range.join('|') : d;
        if (seen.has(key)) continue; seen.add(key);
        if (!e.done && !e.required) continue;
        rows.push({ norm: n.name, period: e.range ? `${fmtDate(e.range[0])} – ${fmtDate(e.range[1] === '9999-12-31' ? to : e.range[1])}` : 'necunoscută', req: e.required ?? '', done: e.done, diff: e.required != null ? round2(e.done - e.required) : '', pct: e.pct ?? '', unit: n.unit, status: e.met === true ? 'Îndeplinită' : e.met === false ? 'Neîndeplinită' : 'Neconfirmat / în curs', act: app.name(n.activityId, 'toate') });
      }
    }
    base.sections.push({ title: 'Îndeplinirea normei', sheet: 'Normă', columns: [C('norm', 'Norma'), C('act', 'Activitatea'), C('period', 'Perioada'), N('req', 'Necesar'), N('done', 'Realizat'), N('diff', 'Diferența'), N('pct', '% îndeplinit'), C('unit', 'Unitate'), C('status', 'Statut')], rows });
  }
  if (type === 'financiar') {
    const months = [];
    for (let d = monthStart(from); d <= to; d = addDays(monthEnd(d), 1)) months.push(d);
    const rows = months.map((ms) => {
      const a = ms < from ? from : ms; const b = monthEnd(ms) > to ? to : monthEnd(ms);
      const M = moneySummary(S, R, a, b, filter);
      return { m: `${monthName(+ms.slice(5, 7))} ${ms.slice(0, 4)}`, normal: h(M.totals.effMin - M.totals.otMin), ot: h(M.totals.otMin), hol: h(M.totals.holidayMin), est: M.estimated, elig: M.eligible, unc: M.unconfirmed, inel: M.ineligible, bonus: M.totals.money.bonus, conf: M.confirmations.length ? M.confirmed : '', recv: M.received, due: round2(M.eligible - M.received) };
    });
    const sum = (k) => round2(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0));
    const F = (k, l) => N(k, l, { fixed: true });
    base.sections.push({ title: 'Sinteză financiară', sheet: 'Financiar', columns: [C('m', 'Luna'), N('normal', 'Ore normale'), N('ot', 'Ore suplimentare'), N('hol', 'Ore de sărbătoare'), F('est', 'Câștig estimat'), F('elig', 'Câștig eligibil'), F('unc', 'Neconfirmat'), F('inel', 'Neeligibil'), F('bonus', 'Bonusuri'), F('conf', 'Sume confirmate'), F('recv', 'Sume primite'), F('due', 'Sold restant')],
      rows, totals: { m: 'Total', normal: sum('normal'), ot: sum('ot'), hol: sum('hol'), est: sum('est'), elig: sum('elig'), unc: sum('unc'), inel: sum('inel'), bonus: sum('bonus'), conf: sum('conf'), recv: sum('recv'), due: sum('due') } });
    const MS = moneySummary(S, R, from, to, filter);
    base.sections.push({ title: 'Plăți primite', sheet: 'Plăți', columns: [C('date', 'Data'), C('emp', 'Angajator'), C('period', 'Perioada'), F('amount', 'Suma'), C('cur', 'Moneda'), N('hours', 'Ore achitate'), N('ot', 'Ore supl.'), N('hol', 'Ore sărb.'), F('bonus', 'Bonusuri'), C('note', 'Observații')],
      rows: MS.payments.map((p) => ({ date: fmtDate(p.date), emp: app.name(p.employerId), period: `${fmtDate(p.periodFrom)} – ${fmtDate(p.periodTo)}`, amount: Number(p.amount), cur: p.currency, hours: p.hours ?? '', ot: p.otHours ?? '', hol: p.holidayHours ?? '', bonus: p.bonuses ?? '', note: p.note || '' })) });
    base.note = `Moneda: ${app.cur}. Estimări fără impozite/contribuții. Cheltuielile nu sunt incluse.`;
  }
  return base;
}

export function render(root, app) {
  const [from, to] = bounds(app);
  const rep = buildReport(app, st.type, from, to);
  const rows = rep.sections.reduce((t, s) => t + s.rows.length, 0);
  const sel = (id, opts, v) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  root.innerHTML = `<div class="pagehead"><div><h1>Rapoarte și export</h1><p class="sub">Rapoarte cu totaluri, gata de trimis sau păstrat. Export în PDF, Excel sau CSV.</p></div></div>
  <section class="panel"><div class="fgrid">
    <label class="f">Raportul${sel('r-type', Object.entries(TYPES), st.type)}</label>
    <label class="f">Perioada${sel('r-preset', [['zi', 'O zi'], ['saptamana', 'Săptămâna'], ['luna', 'Luna'], ['custom', 'Personalizată']], st.preset)}</label>
    <label class="f">${st.preset === 'custom' ? 'De la' : 'Ziua de referință'}<input type="date" id="r-from" value="${st.preset === 'custom' ? from : (st.from || app.today())}"></label>
    ${st.preset === 'custom' ? `<label class="f">Până la<input type="date" id="r-to" value="${to}"></label>` : ''}
    <label class="f">Angajator${sel('r-emp', [['', 'Toți'], ...app.employers().map((e) => [e.id, e.name])], st.employerId)}</label>
    <label class="f">Contract${sel('r-con', [['', 'Toate'], ...app.contracts(st.employerId || undefined).map((c) => [c.id, c.name])], st.contractId)}</label>
    <label class="f">Activitate${sel('r-act', [['', 'Toate'], ...app.activities().map((a) => [a.id, a.name])], st.activityId)}</label>
    <label class="f">Țară${sel('r-cty', [['', 'Toate'], ...Object.entries(COUNTRIES)], st.country)}</label>
  </div>
  <div class="row"><button class="btn-primary" data-x="pdf">${icon('dl')} PDF</button><button data-x="xlsx">${icon('dl')} Excel</button><button data-x="csv">${icon('dl')} CSV</button><span class="small muted">${rows} rânduri · ${fmtDate(from)} – ${fmtDate(to)}</span></div></section>
  <section class="panel"><header><div><h2>${esc(rep.title)}</h2><p class="small muted">${esc(rep.subtitle)}</p></div></header>
    ${rep.note ? `<p class="small muted">${esc(rep.note)}</p>` : ''}
    ${rep.sections.map((s) => `<div class="stack">${rep.sections.length > 1 ? `<h3>${esc(s.title)}</h3>` : ''}${s.rows.length ? `<div class="tablewrap"><table><thead><tr>${s.columns.map((c) => `<th class="${c.num ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
      ${s.rows.map((r) => `<tr>${s.columns.map((c) => `<td class="${c.num ? 'r' : ''}">${esc(cell(r[c.key], c))}</td>`).join('')}</tr>`).join('')}</tbody>
      ${s.totals ? `<tfoot><tr>${s.columns.map((c) => `<td class="${c.num ? 'r' : ''}">${esc(cell(s.totals[c.key], c))}</td>`).join('')}</tr></tfoot>` : ''}</table></div>` : emptyState('Nicio înregistrare în perioada aleasă.')}</div>`).join('')}
  </section>`;
  const upd = () => {
    st.type = root.querySelector('#r-type').value; const np = root.querySelector('#r-preset').value;
    st.from = root.querySelector('#r-from').value || null; st.to = root.querySelector('#r-to')?.value || st.to;
    if (np === 'custom' && st.preset !== 'custom') { st.from = from; st.to = to; }
    st.preset = np;
    st.employerId = root.querySelector('#r-emp').value; st.contractId = root.querySelector('#r-con').value;
    st.activityId = root.querySelector('#r-act').value; st.country = root.querySelector('#r-cty').value;
    app.refresh();
  };
  root.querySelectorAll('select, input').forEach((e) => { e.onchange = upd; });
  root.querySelectorAll('[data-x]').forEach((b) => { b.onclick = async () => {
    const kind = b.dataset.x; const name = `${st.type}-${from}_${to}`;
    b.disabled = true;
    try {
      if (kind === 'csv') await app.download(`${name}.csv`, toCSV(rep));
      if (kind === 'xlsx') await app.download(`${name}.xlsx`, await toXLSX(rep));
      if (kind === 'pdf') await app.download(`${name}.pdf`, await toPDF(rep));
    } catch (e) { toast(e.message || 'Exportul nu a reușit.', { bad: true }); }
    b.disabled = false;
  }; });
}
function cell(v, c) { if (v == null || v === '') return ''; if (typeof v === 'number') return v.toLocaleString('ro-RO', { maximumFractionDigits: 2, minimumFractionDigits: c.fixed ? 2 : 0 }); return String(v); }

// Statistici și grafice simple (SVG desenat la scară, culori din temă).
import { esc } from '../ui.js';
import { fmtDur, fmtMoney, monthStart, monthEnd, addDays, dateRange, monthName, weekStart, round2, fmtNum } from '../util.js';
import { totalsFor, moneySummary } from '../calc.js';

export function barChart({ labels, series, stacked = true, unit = '', fmt = (v) => fmtNum(v, 1), height = 220, labelEvery = 1 }) {
  const W = 720, H = height, L = 46, B = 26, T = 12, Rr = 8;
  const n = labels.length;
  const totals = labels.map((_, i) => (stacked ? series.reduce((t, s) => t + Math.max(0, s.values[i] || 0), 0) : Math.max(0, ...series.map((s) => s.values[i] || 0))));
  const maxV = Math.max(1e-9, ...totals);
  const nice = niceMax(maxV); const ticks = 4;
  const cw = (W - L - Rr) / Math.max(1, n);
  const bw = Math.max(2, Math.min(36, cw * (stacked ? 0.7 : 0.8 / series.length)));
  const y = (v) => T + (H - T - B) * (1 - v / nice);
  let g = '';
  for (let k = 0; k <= ticks; k++) { const v = (nice / ticks) * k; g += `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(fmt(v))}</text>`; }
  labels.forEach((lab, i) => {
    const cx = L + cw * i + cw / 2;
    let acc = 0;
    series.forEach((s, si) => {
      const v = Math.max(0, s.values[i] || 0); if (!v) return;
      const x = stacked ? cx - bw / 2 : cx - (bw * series.length) / 2 + bw * si;
      const y0 = stacked ? y(acc + v) : y(v); const hgt = stacked ? y(acc) - y(acc + v) : y(0) - y(v);
      g += `<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, hgt).toFixed(1)}" fill="${s.color}" rx="2"><title>${esc(lab)} · ${esc(s.name)}: ${esc(fmt(v))}${unit}</title></rect>`;
      if (stacked) acc += v;
    });
    if (i % labelEvery === 0) g += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(lab)}</text>`;
  });
  g += `<line class="axis" x1="${L}" x2="${W - Rr}" y1="${y(0)}" y2="${y(0)}"/>`;
  return `<div style="overflow-x:auto"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" style="min-width:420px">${g}</svg></div>
    ${series.length > 1 ? `<div class="swatches">${series.map((s) => `<span><span class="swatch" style="background:${s.color}"></span> ${esc(s.name)}</span>`).join('')}</div>` : ''}`;
}
function niceMax(v) { const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }

export function render(root, app) {
  const R = app.calc(); const S = app.state();
  const today = app.today(); const cur = app.cur;
  const D = totalsFor(R, today, today);
  const W = totalsFor(R, weekStart(today), addDays(weekStart(today), 6));
  const M = totalsFor(R, monthStart(today), monthEnd(today));
  const Y = moneySummary(S, R, `${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`);
  const prodM = {}; for (const p of R.production.filter((x) => x.date.startsWith(today.slice(0, 7)))) prodM[p.unit] = (prodM[p.unit] || 0) + Number(p.qty || 0);
  const normEv = [...R.calc.values()].filter((c) => c.date === today || c.date >= monthStart(today)).flatMap((c) => c.normEvals || []);
  const lastEv = normEv[normEv.length - 1];
  // ultimele 12 luni
  const months = []; let ms = monthStart(today);
  for (let i = 0; i < 12; i++) { months.unshift(ms); ms = monthStart(addDays(ms, -1)); }
  const monthly = months.map((m) => ({ m, T: totalsFor(R, m, monthEnd(m)), S: moneySummary(S, R, m, monthEnd(m)) }));
  const ml = monthly.map((x) => monthName(+x.m.slice(5, 7)).slice(0, 3));
  const units = Object.keys(R.production.reduce((o, p) => ((o[p.unit] = 1), o), {}));
  const mainUnit = units.sort((a, b) => R.production.filter((p) => p.unit === b).length - R.production.filter((p) => p.unit === a).length)[0];
  const days = dateRange(monthStart(today), monthEnd(today));
  const dayT = days.map((d) => totalsFor(R, d, d));
  const H = (m) => round2(m / 60);
  const col = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', acc: 'var(--accent)', hol: 'var(--holiday)', info: 'var(--info)', mut: 'var(--fg-3)' };
  const kv = (l, v, c = '', hint = '') => `<div class="${c}"><span class="label">${esc(l)}</span><b>${v}</b>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;

  root.innerHTML = `<div class="pagehead"><div><h1>Statistici</h1><p class="sub">Ore, producție și bani dintr-o privire.</p></div></div>
  <section class="panel"><div class="kv">
    ${kv('Ore astăzi', fmtDur(D.effMin))}${kv('Ore săptămâna aceasta', fmtDur(W.effMin))}${kv('Ore luna aceasta', fmtDur(M.effMin), '', `${M.days} zile`)}
    ${kv('Ore suplimentare (luna)', fmtDur(M.otMin), 'warn')}${kv('Ore de sărbătoare (luna)', fmtDur(M.holidayMin), 'hol')}
    ${kv('Eligibile pentru plată', fmtDur(M.otEligibleMin), 'ok')}${kv('Neeligibile', fmtDur(M.otIneligibleMin), 'bad')}${kv('Neconfirmate', fmtDur(M.otUnconfirmedMin), 'warn')}
    ${kv('Producție (luna)', Object.entries(prodM).map(([u, q]) => `${fmtNum(q)} ${esc(u)}`).join(' · ') || '—')}
    ${kv('Progresul normei', lastEv?.pct != null ? `${fmtNum(lastEv.pct, 0)}%` : '—', '', lastEv ? esc(lastEv.name) : 'fără normă configurată')}
    ${kv('Câștig estimat (luna)', fmtMoney(M.money.total, cur))}${kv(`Bani primiți (${today.slice(0, 4)})`, fmtMoney(Y.received, cur), 'ok')}${kv('Bani rămași de primit', fmtMoney(Math.max(0, Y.outstandingVsEligible), cur), Y.outstandingVsEligible > 0 ? 'warn' : '', 'eligibil − primit, anul curent')}
  </div></section>
  <div class="grid2">
    <section class="panel"><h2>Ore lucrate pe zi – ${monthName(+today.slice(5, 7))}</h2>${barChart({ labels: days.map((d) => String(+d.slice(8))), labelEvery: 3, series: [
      { name: 'În normă', values: dayT.map((t) => H(t.effMin - t.otMin)), color: col.acc }, { name: 'Peste normă', values: dayT.map((t) => H(t.otMin)), color: col.warn }], fmt: (v) => fmtNum(v, 1) })}</section>
    <section class="panel"><h2>Ore lucrate pe lună</h2>${barChart({ labels: ml, series: [{ name: 'Ore efective', values: monthly.map((x) => H(x.T.effMin)), color: col.acc }, { name: 'din care de sărbătoare', values: monthly.map(() => 0), color: col.hol }].slice(0, 1) })}</section>
    <section class="panel"><h2>Ore suplimentare pe lună</h2>${barChart({ labels: ml, series: [
      { name: 'Eligibile', values: monthly.map((x) => H(x.T.otEligibleMin)), color: col.ok }, { name: 'Neconfirmate', values: monthly.map((x) => H(x.T.otUnconfirmedMin)), color: col.warn }, { name: 'Neeligibile', values: monthly.map((x) => H(x.T.otIneligibleMin)), color: col.bad }] })}</section>
    <section class="panel"><h2>Producție pe lună${mainUnit ? ` (${esc(mainUnit)})` : ''}</h2>${mainUnit ? barChart({ labels: ml, series: [{ name: mainUnit, values: monthly.map((x) => round2(R.production.filter((p) => p.unit === mainUnit && p.date >= x.m && p.date <= monthEnd(x.m)).reduce((t, p) => t + Number(p.qty || 0), 0))), color: col.acc }] }) : '<p class="small muted">Nicio producție înregistrată.</p>'}</section>
    <section class="panel"><h2>Câștiguri pe lună (${esc(cur)})</h2>${barChart({ labels: ml, fmt: (v) => fmtNum(v, 0), series: [
      { name: 'Eligibil', values: monthly.map((x) => x.T.money.eligible), color: col.ok }, { name: 'Neconfirmat', values: monthly.map((x) => x.T.money.unconfirmed), color: col.warn }, { name: 'Neeligibil', values: monthly.map((x) => x.T.money.ineligible), color: col.bad }] })}</section>
    <section class="panel"><h2>Plăți primite și restante (${esc(cur)})</h2>${barChart({ labels: ml, stacked: false, fmt: (v) => fmtNum(v, 0), series: [
      { name: 'Primit', values: monthly.map((x) => x.S.received), color: col.info }, { name: 'Restant (eligibil − primit)', values: monthly.map((x) => Math.max(0, x.S.outstandingVsEligible)), color: col.warn }] })}
      <p class="tiny muted">Plățile sunt atribuite lunilor din perioada pe care o acoperă.</p></section>
  </div>`;
}

// Ore suplimentare: separarea clară între ore lucrate, peste normă, eligibile, neeligibile, neconfirmate, compensate.
import { esc, icon, pill, emptyState, formDialog, toast, objOptions } from '../ui.js';
import { fmtDur, fmtDate, fmtMoney, monthEnd, pad, monthName, weekStart, addDays, isoWeek } from '../util.js';
import { totalsFor, OT_MODES, OT_BASIS, OT_COMP, SETTLEMENT, UNCONFIRMED_MSG, resolvePolicy } from '../calc.js';
import { editShift } from '../editors.js';
import { otStatusPill } from './today.js';

export function render(root, app) {
  const R = app.calc();
  const anchor = app.params.month || app.today().slice(0, 7);
  const from = anchor + '-01', to = monthEnd(from);
  const T = totalsFor(R, from, to);
  const [y, m] = anchor.split('-').map(Number);
  const shiftM = (k) => { const t = new Date(Date.UTC(y, m - 1 + k, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; };
  const days = [...R.calc.values()].filter((c) => c.date >= from && c.date <= to).sort((a, b) => a.t.start - b.t.start);
  const contract = app.activeContract();
  const pol = contract ? resolvePolicy(app.state(), contract.id, app.today()) : null;
  const mode = pol?.ot?.mode || 'unconfirmed';
  const paidOt = days.filter((c) => c.shift.settlement?.ot === 'platit').reduce((t, c) => t + c.otEligibleMin, 0);
  const compOt = days.reduce((t, c) => t + (c.compFromOtMin || 0), 0);
  const cur = app.cur;
  // săptămâni
  const weeks = new Map();
  for (const c of days) { const ws = weekStart(c.date); if (!weeks.has(ws)) weeks.set(ws, totalsFor(R, ws, addDays(ws, 6))); }

  root.innerHTML = `
  <div class="pagehead"><div><h1>Ore suplimentare</h1><p class="sub">Orele lucrate nu dispar niciodată. Regula decide doar dacă sunt plătibile.</p></div>
    <a class="btn" href="#angajatori">${icon('gear')} Regula angajatorului</a></div>
  <section class="panel">
    <header><h2>Regula în vigoare</h2>${mode === 'unconfirmed' ? pill('Neconfirmată', 'warn') : pill('Configurată', 'ok')}</header>
    <p><b>${esc(OT_MODES[mode])}</b> · ${esc(OT_BASIS[pol?.ot?.basis || 'daily'])} · ${esc(OT_COMP[pol?.ot?.comp || 'pay'])}</p>
    ${mode === 'unconfirmed' ? `<p class="note warn small">${UNCONFIRMED_MSG}</p>` : ''}
    ${pol?.ot?.note ? `<p class="small muted">Explicația angajatorului: ${esc(pol.ot.note)}</p>` : ''}
  </section>
  <section class="panel">
    <header><div class="row"><button class="iconbtn" data-m="-1" aria-label="Luna anterioară">${icon('chevl')}</button><h2>${monthName(m)} ${y}</h2><button class="iconbtn" data-m="1" aria-label="Luna următoare">${icon('chev')}</button></div></header>
    <div class="kv">
      <div><span class="label">1. Ore efectiv lucrate</span><b>${fmtDur(T.effMin)}</b></div>
      <div class="warn"><span class="label">2. Peste norma zilnică</span><b>${fmtDur(T.dailyOverMin)}</b></div>
      <div class="warn"><span class="label">3. Peste norma săptămânală</span><b>${[...weeks.values()].some((w) => w.normMin) ? fmtDur([...weeks.keys()].reduce((t, ws) => t + (R.weekInfo.get(`${ws}|${contract?.id}`)?.overMin || 0), 0)) : '—'}</b><span class="hint">săptămânile din lună (dacă norma săptămânală e configurată)</span></div>
      <div class="ok"><span class="label">4. Eligibile pentru plată</span><b>${fmtDur(T.otEligibleMin)}</b></div>
      <div class="bad"><span class="label">5. Neeligibile</span><b>${fmtDur(T.otIneligibleMin)}</b></div>
      <div class="warn"><span class="label">6. Eligibilitate neconfirmată</span><b>${fmtDur(T.otUnconfirmedMin)}</b></div>
      <div><span class="label">7. Compensate cu timp liber</span><b>${fmtDur(compOt)}</b></div>
      <div><span class="label">Marcate plătite</span><b>${fmtDur(paidOt)}</b><span class="hint">neplătite: ${fmtDur(Math.max(0, T.otEligibleMin - paidOt - compOt))}</span></div>
    </div>
    <p class="small muted">Valoare estimată ore suplimentare: eligibil inclus în ${fmtMoney(T.money.eligible, cur)} · neeligibil ${fmtMoney(T.money.ineligible, cur)} · neconfirmat ${fmtMoney(T.money.unconfirmed, cur)}.</p>
    ${days.length ? `<div class="tablewrap"><table><thead><tr><th>Data</th><th class="r">Efectiv</th><th class="r">Normă</th><th class="r">Peste normă</th><th>Statut</th><th class="r">Elig.</th><th class="r">Neelig.</th><th class="r">Neconf.</th><th>Plată</th><th>Motiv</th></tr></thead><tbody>
      ${days.map((c) => `<tr class="click" data-s="${c.id}"><td class="tabnum">${fmtDate(c.date)}${c.holidayMin ? ' ' + pill('sărb.', 'hol') : ''}</td><td class="r">${fmtDur(c.t.effMin)}</td><td class="r">${c.dailyNormMin == null ? '—' : fmtDur(c.dailyNormMin)}</td><td class="r"><b>${fmtDur(c.otMin)}</b></td>
        <td>${c.otMin ? otStatusPill(c) : '<span class="muted">—</span>'}</td><td class="r">${fmtDur(c.otEligibleMin)}</td><td class="r">${fmtDur(c.otIneligibleMin)}</td><td class="r">${fmtDur(c.otUnconfirmedMin)}</td>
        <td class="small">${c.otMin ? esc(SETTLEMENT[c.shift.settlement?.ot] || 'Neconfirmat') : ''}</td><td class="small" style="min-width:220px">${c.otMin ? esc(c.otReason) : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr><td>Total</td><td class="r">${fmtDur(T.effMin)}</td><td class="r">${fmtDur(T.normMin)}</td><td class="r">${fmtDur(T.otMin)}</td><td></td><td class="r">${fmtDur(T.otEligibleMin)}</td><td class="r">${fmtDur(T.otIneligibleMin)}</td><td class="r">${fmtDur(T.otUnconfirmedMin)}</td><td colspan="2"></td></tr></tfoot></table></div>
    <p class="tiny muted">Atinge o zi pentru a stabili manual eligibilitatea (ex. după confirmarea angajatorului) sau statutul plății.</p>` : emptyState('Nicio zi lucrată în această lună.')}
  </section>
  ${weeks.size ? `<section class="panel"><h2>Pe săptămâni</h2><div class="tablewrap"><table><thead><tr><th>Săptămâna</th><th class="r">Efectiv</th><th class="r">Peste normă (bază aleasă)</th><th class="r">Eligibile</th><th class="r">Neeligibile</th><th class="r">Neconfirmate</th></tr></thead><tbody>
    ${[...weeks.entries()].map(([ws, w]) => `<tr><td>S${isoWeek(ws).week} · ${fmtDate(ws)}</td><td class="r">${fmtDur(w.effMin)}</td><td class="r">${fmtDur(w.otMin)}</td><td class="r">${fmtDur(w.otEligibleMin)}</td><td class="r">${fmtDur(w.otIneligibleMin)}</td><td class="r">${fmtDur(w.otUnconfirmedMin)}</td></tr>`).join('')}
  </tbody></table></div></section>` : ''}`;
  root.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { app.params = { month: shiftM(+b.dataset.m) }; app.refresh(); }; });
  root.querySelectorAll('[data-s]').forEach((r) => { r.onclick = () => editShift(app, r.dataset.s); });
}

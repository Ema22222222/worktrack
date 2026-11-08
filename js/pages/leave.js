// Ore compensatorii (sold) și concedii / zile libere / absențe.
import { esc, icon, formDialog, toast, pill, emptyState, confirmDialog } from '../ui.js';
import { fmtDur, fmtDate, daysBetween, monthName, addDays } from '../util.js';
import { fmtHM } from './month.js';
import { compLedger, otBank } from '../calc.js';

export const ABSENCE_TYPES = {
  concediu: 'Concediu de odihnă', liber: 'Zi liberă', absenta: 'Absență', medical: 'Concediu medical',
  sarbatoare: 'Sărbătoare (zi liberă)', recuperare: 'Zi liberă din ore extra', compensatoriu: 'Ore libere compensatorii (din sold)',
};

export async function editAbsence(app, id, { date, type } = {}) {
  const orig = id ? app.store.get(id) : null;
  const vals = await formDialog({
    title: orig ? 'Corectează absența' : 'Adaugă concediu / zi liberă / absență',
    fields: [
      { name: 'type', label: 'Tipul', type: 'select', options: Object.entries(ABSENCE_TYPES), value: orig?.type || type || 'concediu' },
      { name: 'from', label: 'De la', type: 'date', required: true, value: orig?.from || date || app.today() },
      { name: 'to', label: 'Până la', type: 'date', value: orig?.to || orig?.from || date || app.today() },
      { name: 'minutes', label: 'Ore folosite din sold', type: 'number', step: '0.25', value: orig?.minutes != null ? orig.minutes / 60 : '',
        help: 'Numai pentru recuperare / ore compensatorii. Se scad din soldul orelor compensatorii.', show: (v) => v.type === 'recuperare' || v.type === 'compensatoriu' },
      { name: 'employerId', label: 'Angajatorul', type: 'select', options: [['', '—'], ...app.employers().map((e) => [e.id, e.name])], value: orig?.employerId || app.activeContract()?.employerId || '' },
      { name: 'note', label: 'Observații', type: 'textarea', full: true, value: orig?.note || '' },
    ],
    validate: (v) => (v.to && v.to < v.from ? 'Data de sfârșit este înaintea celei de început.' : ((v.type === 'recuperare' || v.type === 'compensatoriu') && !(v.minutes > 0) ? 'Completează câte ore folosești din sold.' : null)),
    extraActions: orig ? [{ label: 'Șterge', cls: 'btn-danger', onClick: async () => { const r = await confirmDialog('Ștergi această înregistrare? O poți restaura din istoric.', { danger: true, okLabel: 'Șterge' }); if (!r) return false; app.store.remove(orig.id); toast('Șters.'); app.refresh(); return null; } }] : [],
  });
  if (!vals) return;
  app.store.put('absence', { ...(orig ? { id: orig.id } : {}), ...vals, to: vals.to || vals.from, minutes: vals.minutes != null ? Math.round(vals.minutes * 60) : null });
  toast('Salvat.'); app.refresh();
}

export function renderLeave(root, app) {
  const list = app.store.list('absence').sort((a, b) => b.from.localeCompare(a.from));
  const year = app.today().slice(0, 4);
  const count = (t) => list.filter((a) => a.type === t && a.from.startsWith(year)).reduce((s, a) => s + daysBetween(a.from, a.to || a.from) + 1, 0);
  root.innerHTML = `<div class="pagehead"><div><h1>Concedii și zile libere</h1><p class="sub">Concedii, zile libere, absențe, zile de recuperare.</p></div><button class="btn-primary" id="add">${icon('plus')} Adaugă</button></div>
  <section class="panel"><header><h2>Anul ${year}</h2></header><div class="kv">
    ${['concediu', 'liber', 'medical', 'absenta', 'recuperare'].map((t) => `<div><span class="label">${esc(ABSENCE_TYPES[t])}</span><b>${count(t)} zile</b></div>`).join('')}</div></section>
  <section class="panel"><h2>Toate</h2>${list.length ? `<div class="list">${list.map((a) => `<div class="item click" data-id="${a.id}"><div class="grow"><b>${esc(ABSENCE_TYPES[a.type] || a.type)}</b><div class="small muted">${fmtDate(a.from)}${a.to && a.to !== a.from ? ' – ' + fmtDate(a.to) : ''}${a.minutes ? ' · ' + fmtDur(a.minutes) + ' din sold' : ''}${a.employerId ? ' · ' + esc(app.name(a.employerId)) : ''}${a.note ? ' · ' + esc(a.note) : ''}</div></div>${icon('edit')}</div>`).join('')}</div>` : emptyState('Nu ai înregistrat concedii sau zile libere.')}</section>`;
  root.querySelector('#add').onclick = () => editAbsence(app);
  root.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => editAbsence(app, b.dataset.id); });
}

export function renderComp(root, app) {
  const R = app.calc(); const st = app.state();
  const B = otBank(st, R);
  const today = app.today();
  const months = Object.keys(B.byMonth).filter((m) => B.byMonth[m].earned || B.byMonth[m].paid).sort().reverse();
  // rânduri afișate: orele extra lucrate grupate pe lună, restul individual
  const earnByMonth = {};
  for (const r of B.rows) if (r.kind === 'earn') { const m = r.date.slice(0, 7); earnByMonth[m] = earnByMonth[m] || { date: r.date, min: 0, days: 0, balance: 0 }; earnByMonth[m].min += r.min; earnByMonth[m].days++; earnByMonth[m].date = r.date; earnByMonth[m].balance = r.balance; }
  const show = [...Object.entries(earnByMonth).map(([m, e]) => ({ kind: 'earn', date: e.date, min: e.min, balance: e.balance, label: `Ore extra lucrate – ${monthName(+m.slice(5, 7))} ${m.slice(0, 4)}`, sub: `${e.days} zile` })),
    ...B.rows.filter((r) => r.kind !== 'earn').map((r) => ({ ...r, label: r.kind === 'paid' ? `Plătite${r.month ? ` (pentru ${monthName(+r.month.slice(5, 7))} ${r.month.slice(0, 4)})` : ''}` : r.kind === 'dayoff' ? `Zi liberă din ore extra – ${fmtDate(r.date, { long: true })}` : 'Ajustare manuală', sub: r.note }))]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const uncov = B.rows.filter((r) => r.kind === 'dayoff' && r.uncovered > 0);
  root.innerHTML = `<div class="pagehead"><div><h1>Sold ore extra</h1><p class="sub">Toate orele extra lucrate, minus cele plătite și zilele libere luate din ele.</p></div></div>
  <section class="hero" aria-label="Sold">
    <span class="small" style="color:var(--hero-muted);letter-spacing:.1em;font-weight:800">SOLD ORE EXTRA</span>
    <div class="bigtime" style="font-size:clamp(3rem,13vw,4.6rem)${B.balance < 0 ? ';color:var(--action)' : ''}">${fmtHM(B.balance)}<small>${B.balance < 0 ? 'lipsă' : 'disponibile'}</small></div>
    <div class="hstats"><div><span>Lucrate</span><b>${fmtHM(B.earned)}</b></div><div><span>Plătite</span><b>${fmtHM(B.paid)}</b></div><div class="x"><span>Zile libere</span><b>${fmtHM(B.used)}</b></div></div>
  </section>
  <div class="acts">
    <button class="act wide" id="paid">${icon('money')} Mi-au plătit ore extra</button>
    <button class="act wide" id="off">${icon('leave')} Iau zi liberă din ore extra</button>
  </div>
  ${uncov.length ? `<div class="note bad"><b>Zile libere neacoperite:</b> ${uncov.map((r) => `${fmtDate(r.date)} (lipsesc ${fmtHM(r.uncovered)})`).join(', ')}. Nu aveai destule ore extra strânse până atunci.</div>` : ''}
  <section class="panel"><header><h2>Pe luni</h2></header>
    ${months.length ? `<div class="tablewrap"><table><thead><tr><th>Luna</th><th class="r">Extra</th><th class="r">Plătite</th><th class="r">Rămase</th><th></th></tr></thead><tbody>
    ${months.map((m) => { const x = B.byMonth[m]; const rest = Math.max(0, x.earned - x.paid); return `<tr><td>${monthName(+m.slice(5, 7))} ${m.slice(0, 4)}</td><td class="r">${fmtHM(x.earned)}</td><td class="r">${fmtHM(x.paid)}</td><td class="r"><b>${fmtHM(rest)}</b></td><td>${rest > 0 ? `<button class="btn-sm" data-paym="${m}">Marchează plătite</button>` : pill('Plătite', 'ok')}</td></tr>`; }).join('')}
    </tbody></table></div>` : emptyState('Nu ai încă ore extra.')}</section>
  <section class="panel"><header><h2>Mișcări</h2><button class="btn-sm btn-ghost" id="adj">Ajustare manuală</button></header>
    ${show.length ? `<div class="list">${show.map((r) => `<div class="item${r.kind === 'earn' ? '' : ' click'}" ${r.kind === 'earn' ? '' : `data-ref="${r.ref}" data-kind="${r.kind}"`}>
      <div class="grow"><b>${esc(r.label)}</b>${r.kind === 'dayoff' && r.uncovered > 0 ? ' ' + pill(`neacoperită ${fmtHM(r.uncovered)}`, 'bad') : ''}<div class="small muted">${fmtDate(r.date)}${r.sub ? ' · ' + esc(r.sub) : ''} · sold după: ${fmtHM(r.balance)}</div></div>
      <b class="tabnum" style="color:${r.min >= 0 ? 'var(--ok)' : 'var(--bad)'}">${r.min >= 0 ? '+' : ''}${fmtHM(r.min)}</b></div>`).join('')}</div>` : emptyState('Nicio mișcare.')}
  </section>`;
  root.querySelector('#paid').onclick = () => editOtPay(app);
  root.querySelector('#off').onclick = () => dayOffFromOt(app, null);
  root.querySelector('#adj').onclick = () => editComp(app);
  root.querySelectorAll('[data-paym]').forEach((b) => { b.onclick = () => { const m = b.dataset.paym; const x = B.byMonth[m]; editOtPay(app, null, { month: m, hours: Math.max(0, x.earned - x.paid) / 60 }); }; });
  root.querySelectorAll('[data-ref]').forEach((b) => { b.onclick = () => {
    const k = b.dataset.kind; const id = b.dataset.ref;
    if (k === 'paid') editOtPay(app, id); else if (k === 'dayoff') editAbsence(app, id); else editComp(app, id);
  }; });
}

/** „Mi-au plătit X ore extra” – scade din sold. */
export async function editOtPay(app, id, pre = {}) {
  const orig = id ? app.store.get(id) : null;
  const B = otBank(app.state(), app.calc());
  const months = Object.keys(B.byMonth).filter((m) => B.byMonth[m].earned).sort().reverse();
  const opt = months.map((m) => [m, `${monthName(+m.slice(5, 7))} ${m.slice(0, 4)} – ${fmtHM(Math.max(0, B.byMonth[m].earned - B.byMonth[m].paid))} neplătite`]);
  const vals = await formDialog({
    title: orig ? 'Ore extra plătite' : 'Mi-au plătit ore extra',
    intro: '<p class="small muted">Orele trecute aici se scad din soldul de ore extra.</p>',
    fields: [
      { name: 'hours', label: 'Câte ore extra ți-au plătit', type: 'number', step: '0.25', required: true, value: orig ? orig.minutes / 60 : (pre.hours ?? '') },
      { name: 'month', label: 'Pentru luna', type: 'select', options: [['', '— nu contează —'], ...opt], value: orig?.month || pre.month || months[0] || '' },
      { name: 'date', label: 'Data plății', type: 'date', required: true, value: orig?.date || app.today() },
      { name: 'note', label: 'Observații', full: true, value: orig?.note || '' },
    ],
    validate: (v) => (!(v.hours > 0) ? 'Scrie un număr de ore mai mare decât zero.' : null),
    extraActions: orig ? [{ label: 'Șterge', cls: 'btn-danger', onClick: () => { app.store.remove(orig.id, 'Șters din sold'); app.refresh(); return null; } }] : [],
  });
  if (!vals) return;
  app.store.put('otpay', { ...(orig ? { id: orig.id } : {}), minutes: Math.round(vals.hours * 60), month: vals.month || null, date: vals.date, note: vals.note }, { action: 'ore extra plătite', undoLabel: 'Ore extra plătite' });
  // marchează orele extra din lună ca plătite când sunt acoperite complet
  if (vals.month) {
    const B2 = otBank(app.state(), app.calc()); const x = B2.byMonth[vals.month];
    const status = x && x.paid >= x.earned - 0.5 ? 'platit' : 'partial';
    for (const c of app.calc().calc.values()) if (c.date.startsWith(vals.month) && c.otMin > 0) app.store.put('shift', { id: c.id, settlement: { ...(c.shift.settlement || {}), ot: status } }, { action: 'statut plată', reason: 'Ore extra plătite', undoable: false });
  }
  toast(`${fmtHM(Math.round(vals.hours * 60))} scăzute din soldul de ore extra.`);
  app.refresh();
}

/** Zi liberă luată din orele extra. Dacă nu sunt destule ore, ziua se salvează și apare ca neacoperită. */
export async function dayOffFromOt(app, date) {
  const R = app.calc(); const st = app.state();
  const contract = app.activeContract();
  const pol = contract && st.policies.filter((p) => p.contractId === contract.id && !p.deleted).sort((a, b) => (b.validFrom || '').localeCompare(a.validFrom || ''))[0];
  const norm = pol?.schedule?.dailyNormMin ?? 600;
  const d0 = date || addDays(app.today(), 1);
  const vals = await formDialog({
    title: 'Zi liberă din ore extra',
    intro: `<p class="small">Sold acum: <b>${fmtHM(otBank(st, R).balance)}</b>. O zi liberă scade ${fmtHM(norm)} (norma ta).</p>`,
    fields: [
      { name: 'from', label: 'Ziua', type: 'date', required: true, value: d0 },
      { name: 'hours', label: 'Ore scăzute din sold', type: 'number', step: '0.25', required: true, value: norm / 60 },
      { name: 'note', label: 'Observații', full: true, value: '' },
    ],
    validate: (v) => {
      if (!(v.hours > 0)) return 'Scrie câte ore se scad.';
      if (app.store.list('shift').some((s) => (s.date || '') === v.from)) return 'În ziua asta ai deja ore lucrate trecute. Șterge-le întâi dacă a fost zi liberă.';
      return null;
    },
    submitLabel: 'Salvează ziua liberă',
  });
  if (!vals) return;
  const minutes = Math.round(vals.hours * 60);
  const a = app.store.put('absence', { type: 'recuperare', from: vals.from, to: vals.from, minutes, employerId: contract?.employerId || null, note: vals.note }, { action: 'zi liberă din ore extra', undoLabel: 'Zi liberă' });
  const B = otBank(app.state(), app.calc());
  const unc = B.uncovered[a.id];
  toast(unc ? `Zi liberă salvată, dar neacoperită: lipsesc ${fmtHM(unc)} din sold.` : `Zi liberă salvată. Sold rămas: ${fmtHM(B.balance)}.`, { bad: !!unc, ms: 8000, undo: () => { app.store.undo(); app.refresh(); } });
  app.refresh();
}

async function editComp(app, id) {
  const orig = id ? app.store.get(id) : null;
  const vals = await formDialog({
    title: 'Ajustare manuală a soldului',
    fields: [
      { name: 'date', label: 'Data', type: 'date', required: true, value: orig?.date || app.today() },
      { name: 'hours', label: 'Ore (+ adaugă în sold, − scade din sold)', type: 'number', step: '0.25', required: true, value: orig ? orig.minutes / 60 : '' },
      { name: 'note', label: 'Motiv', full: true, value: orig?.note || '' },
    ],
    extraActions: orig ? [{ label: 'Șterge', cls: 'btn-danger', onClick: () => { app.store.remove(orig.id); app.refresh(); return null; } }] : [],
  });
  if (!vals) return;
  app.store.put('comp', { ...(orig ? { id: orig.id } : {}), date: vals.date, minutes: Math.round(vals.hours * 60), note: vals.note });
  toast('Salvat.'); app.refresh();
}

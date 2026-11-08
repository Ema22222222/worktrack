// Producție: înregistrări și norme configurabile (cu istoric pe versiuni).
import { esc, icon, formDialog, toast, pill, emptyState, options, objOptions, confirmDialog } from '../ui.js';
import { uid, fmtDate, fmtNum, localTime, toMs, monthStart, monthEnd, addDays, pad, monthName } from '../util.js';
import { NORM_PERIODS, NORM_FULFILL, evalNorm } from '../calc.js';
import { editProduction, unitOptions, offerRetroactive } from '../editors.js';
import { normsFor } from '../actions.js';
import { normHtml } from './today.js';

export function render(root, app) {
  const R = app.calc();
  const anchor = app.params.month || app.today().slice(0, 7);
  const from = anchor + '-01', to = monthEnd(from);
  const list = R.production.filter((p) => p.date >= from && p.date <= to).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  const byUnit = {};
  for (const p of list) byUnit[p.unit] = (byUnit[p.unit] || 0) + Number(p.qty || 0);
  const contract = app.activeContract();
  const allNorms = app.store.list('norm');
  const series = new Map();
  for (const n of allNorms) { const k = n.seriesId || n.id; if (!series.has(k)) series.set(k, []); series.get(k).push(n); }
  const current = normsFor(app, contract, app.today());
  const evals = current.map((n) => evalNorm(n, app.today(), { production: R.production, today: app.today(), dayClosed: () => false, effByDate: {}, dailyNormMin: null }));
  const [y, m] = anchor.split('-').map(Number);
  const shiftM = (k) => { const t = new Date(Date.UTC(y, m - 1 + k, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; };
  const unconfirmed = !current.length || current.some((n) => n.status !== 'confirmat' || n.quantity == null || n.period === 'unknown');

  root.innerHTML = `
  <div class="pagehead"><div><h1>Producție și norme</h1><p class="sub">Înregistrează ce ai realizat: m³, tone, încărcături, transporturi, arbori…</p></div>
    <button class="btn-primary" id="add">${icon('plus')} Adaugă producție</button></div>
  ${unconfirmed ? `<div class="note warn"><b>Normă neconfirmată.</b> ${current.length ? 'Cel puțin o normă nu are cantitate, perioadă sau confirmare.' : 'Nu ai configurat nicio normă de producție.'} Producția se înregistrează normal; aplicația nu inventează o valoare necesară. Când afli regula de la angajator, configureaz-o mai jos.</div>` : ''}
  <section class="panel">
    <header><h2>Norme de producție</h2><button class="btn-sm" id="addnorm">${icon('plus')} Normă nouă</button></header>
    ${evals.map(normHtml).join('<div class="hr"></div>')}
    ${series.size ? `<div class="list">${[...series.values()].map((vers) => {
      vers.sort((a, b) => (b.validFrom || '').localeCompare(a.validFrom || ''));
      const n = vers[0];
      return `<div class="item"><div class="grow"><b>${esc(n.name)}</b> ${n.status === 'confirmat' ? pill('Confirmată', 'ok') : pill('Neconfirmată', 'warn')}${n.governsOvertime ? ' ' + pill('decide orele suplimentare', 'info') : ''}
        <div class="small muted">${n.quantity != null ? `${fmtNum(n.quantity)} ${esc(n.unit)}` : 'cantitate necunoscută'} · ${esc(NORM_PERIODS[n.period] || '')} · ${esc(NORM_FULFILL[n.fulfillment] || '')}</div>
        <div class="tiny muted">${esc(app.name(n.employerId))}${n.contractId ? ' · ' + esc(app.name(n.contractId)) : ''}${n.activityId ? ' · ' + esc(app.name(n.activityId)) : ' · toate activitățile'} · valabilă ${fmtDate(n.validFrom)}${n.validTo ? ' – ' + fmtDate(n.validTo) : ' – prezent'}${vers.length > 1 ? ` · ${vers.length} versiuni` : ''}</div>
        ${vers.length > 1 ? `<details class="tiny"><summary>Istoric versiuni</summary>${vers.map((v) => `<div>${fmtDate(v.validFrom)} – ${v.validTo ? fmtDate(v.validTo) : 'prezent'}: ${v.quantity != null ? fmtNum(v.quantity) + ' ' + esc(v.unit) : '—'} ${v.reason ? '· ' + esc(v.reason) : ''}</div>`).join('')}</details>` : ''}</div>
        <div class="row"><button class="btn-sm" data-ver="${n.id}">Versiune nouă</button><button class="btn-sm btn-ghost" data-edn="${n.id}">${icon('edit')}</button></div></div>`;
    }).join('')}</div>` : emptyState('Nicio normă configurată.')}
    <p class="tiny muted">„Versiune nouă” păstrează norma veche pentru zilele trecute. Corectarea unei versiuni existente se aplică doar zilelor care nu au regulile înghețate.</p>
  </section>
  <section class="panel">
    <header><div class="row"><button class="iconbtn" data-m="-1" aria-label="Luna anterioară">${icon('chevl')}</button><h2>${monthName(m)} ${y}</h2><button class="iconbtn" data-m="1" aria-label="Luna următoare">${icon('chev')}</button></div>
      <span class="small muted tabnum">${Object.entries(byUnit).map(([u, q]) => `${fmtNum(q)} ${esc(u)}`).join(' · ') || 'fără producție'}</span></header>
    ${list.length ? `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Ora</th><th class="r">Cantitate</th><th>Activitate</th><th>Locație</th><th>Observații</th></tr></thead><tbody>
      ${list.map((p) => `<tr class="click" data-p="${p.id}"><td class="tabnum">${fmtDate(p.date)}</td><td class="tabnum">${p.time ? localTime(toMs(p.time), app.tz) : '—'}</td><td class="r"><b>${fmtNum(p.qty)}</b> ${esc(p.unit)}</td><td>${esc(app.name(p.activityId, '—'))}</td><td>${esc(app.name(p.locationId, '—'))}</td><td class="small">${esc(p.note || '')}${p.attachments?.length ? ` ${p.attachments.map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name || 'fișier')}</a>`).join(' ')}` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : emptyState('Nicio producție în această lună.')}
  </section>`;
  root.querySelector('#add').onclick = () => editProduction(app);
  root.querySelector('#addnorm').onclick = () => editNorm(app);
  root.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { app.params = { month: shiftM(+b.dataset.m) }; app.refresh(); }; });
  root.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => editProduction(app, b.dataset.p); });
  root.querySelectorAll('[data-edn]').forEach((b) => { b.onclick = () => editNorm(app, b.dataset.edn); });
  root.querySelectorAll('[data-ver]').forEach((b) => { b.onclick = () => editNorm(app, b.dataset.ver, { newVersion: true }); });
}

export async function editNorm(app, id, { newVersion = false } = {}) {
  const orig = id ? app.store.get(id) : null;
  const contracts = app.contracts();
  if (!contracts.length) { toast('Adaugă mai întâi un contract.', { bad: true }); return; }
  const base = orig || { status: 'neconfirmat', period: 'unknown', fulfillment: 'unknown', governsOvertime: true, unit: 'm³' };
  const title = !orig ? 'Normă de producție nouă' : newVersion ? `Versiune nouă: ${orig.name}` : `Corectează: ${orig.name}`;
  const vals = await formDialog({
    title,
    intro: newVersion ? '<p class="small muted">Versiunea veche rămâne valabilă până în ziua dinaintea noii date. Zilele trecute nu se recalculează.</p>' : '<p class="small muted">Lasă cantitatea goală dacă nu o cunoști. Marchează „confirmată” doar după ce angajatorul ți-a explicat clar regula.</p>',
    fields: [
      { name: 'name', label: 'Numele normei', required: true, value: base.name || 'Normă producție' },
      { name: 'contractId', label: 'Contract / angajator', type: 'select', options: contracts.map((c) => [c.id, `${app.name(c.employerId)} — ${c.name}`]), value: base.contractId || app.activeContract()?.id },
      { name: 'activityId', label: 'Activitatea', type: 'select', options: options(app.activities(), 'name', { empty: 'Toate activitățile' }), value: base.activityId || '' },
      { name: 'quantity', label: 'Cantitatea necesară', type: 'number', step: 'any', value: base.quantity ?? '' },
      { name: 'unit', label: 'Unitatea de măsură', type: 'select', options: unitOptions(app, base.unit), value: base.unit },
      { name: 'newUnit', label: 'Numele unității noi', show: (v) => v.unit === '__new' },
      { name: 'period', label: 'Perioada normei', type: 'select', options: objOptions(NORM_PERIODS), value: base.period },
      { name: 'fulfillment', label: 'Momentul îndeplinirii', type: 'select', options: objOptions(NORM_FULFILL), value: base.fulfillment, full: true },
      { name: 'validFrom', label: newVersion ? 'Noua versiune se aplică de la' : 'Data de început a aplicării', type: 'date', required: true, value: newVersion ? app.today() : (base.validFrom || app.today()) },
      { name: 'validTo', label: 'Data de sfârșit (dacă există)', type: 'date', value: newVersion ? '' : (base.validTo || ''), help: 'Pentru normele pe proiect: sfârșitul proiectului.' },
      { name: 'governsOvertime', label: 'Această normă decide eligibilitatea orelor suplimentare', type: 'checkbox', value: base.governsOvertime, full: true },
      { name: 'status', label: 'Statut', type: 'select', options: [['neconfirmat', 'Neconfirmată – încă nu știu regula exactă'], ['confirmat', 'Confirmată de angajator']], value: base.status },
      { name: 'customRule', label: 'Descrierea regulii (cum a explicat-o angajatorul)', type: 'textarea', value: base.customRule || '', full: true },
      { name: 'reason', label: orig ? 'Motivul modificării' : 'Observații', full: true, value: newVersion ? '' : '' },
    ],
    validate: (v) => (v.validTo && v.validTo < v.validFrom ? 'Data de sfârșit este înaintea celei de început.' : v.unit === '__new' && !v.newUnit ? 'Scrie unitatea nouă.' : v.quantity != null && v.quantity <= 0 ? 'Cantitatea trebuie să fie pozitivă (sau goală dacă nu o știi).' : null),
  });
  if (!vals) return;
  const c = app.store.get(vals.contractId);
  const unit = vals.unit === '__new' ? vals.newUnit : vals.unit;
  if (vals.unit === '__new') app.saveSettings({ customUnits: [...new Set([...(app.settings().customUnits || []), unit])] });
  const body = { name: vals.name, employerId: c.employerId, contractId: c.id, activityId: vals.activityId || null, quantity: vals.quantity, unit,
    period: vals.period, fulfillment: vals.fulfillment, validFrom: vals.validFrom, validTo: vals.validTo || null, governsOvertime: vals.governsOvertime,
    status: vals.status, customRule: vals.customRule, reason: vals.reason };
  if (newVersion && orig) {
    if (vals.validFrom <= (orig.validFrom || '')) { toast('Noua versiune trebuie să înceapă după versiunea curentă.', { bad: true }); return; }
    app.store.put('norm', { id: orig.id, validTo: addDays(vals.validFrom, -1) }, { action: 'închidere versiune', reason: `Înlocuită de versiunea din ${vals.validFrom}` });
    app.store.put('norm', { ...body, seriesId: orig.seriesId || orig.id, previousId: orig.id, previous: { quantity: orig.quantity, unit: orig.unit, period: orig.period } }, { action: 'versiune nouă normă', reason: vals.reason });
  } else if (orig) {
    app.store.put('norm', { id: orig.id, ...body }, { action: 'corectare normă', reason: vals.reason });
  } else {
    const nid = uid('norm');
    app.store.put('norm', { id: nid, seriesId: nid, ...body }, { action: 'normă nouă', reason: vals.reason });
  }
  toast('Normă salvată.');
  await offerRetroactive(app, { employerId: c.employerId, from: vals.validFrom, label: 'norma de producție actualizată' });
  app.refresh();
}

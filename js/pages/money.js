// Bani: tarife (cu istoric), câștig estimat / eligibil / confirmat / primit / restant, plăți și confirmări.
import { esc, icon, pill, emptyState, formDialog, toast, options, confirmDialog } from '../ui.js';
import { fmtDur, fmtDate, fmtMoney, monthEnd, pad, monthName, addDays, fmtNum } from '../util.js';
import { moneySummary } from '../calc.js';
import { editPayment, editConfirmation, CURRENCIES, unitOptions, offerRetroactive } from '../editors.js';

let period = 'month';

export function periodBounds(app, p = period, anchor = app.params.month || app.today().slice(0, 7)) {
  if (p === 'year') return [anchor.slice(0, 4) + '-01-01', anchor.slice(0, 4) + '-12-31'];
  if (p === 'all') return ['2000-01-01', '2999-12-31'];
  return [anchor + '-01', monthEnd(anchor + '-01')];
}

export function render(root, app) {
  const R = app.calc(); const st = app.state();
  const anchor = app.params.month || app.today().slice(0, 7);
  const empF = app.params.employerId || '';
  const [from, to] = periodBounds(app, period, anchor);
  const S = moneySummary(st, R, from, to, { employerId: empF || undefined });
  const emp = empF ? app.store.get(empF) : app.activeContract() && app.store.get(app.activeContract().employerId);
  const cur = emp?.currency || app.cur;
  const [y, m] = anchor.split('-').map(Number);
  const shiftM = (k) => { const t = new Date(Date.UTC(y, m - 1 + (period === 'year' ? 12 * k : k), 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; };
  const T = S.totals;
  const rates = app.store.list('rate').sort((a, b) => (b.validFrom || '').localeCompare(a.validFrom || ''));
  const label = period === 'year' ? `Anul ${y}` : period === 'all' ? 'Tot istoricul' : `${monthName(m)} ${y}`;
  const unpaidDays = [...R.calc.values()].filter((c) => c.date >= from && c.date <= to && !c.t.open && (!empF || c.employerId === empF) && c.shift.settlement?.day !== 'platit').length;

  root.innerHTML = `
  <div class="pagehead"><div><h1>Bani și plăți</h1><p class="sub">Separat: cât ar trebui să câștigi, ce e eligibil, ce a confirmat angajatorul și ce ai primit.</p></div>
    <div class="row"><button class="btn-primary" id="pay">${icon('plus')} Plată primită</button><button id="conf">${icon('check')} Sumă confirmată</button></div></div>
  <section class="panel">
    <header><div class="row">${period !== 'all' ? `<button class="iconbtn" data-m="-1" aria-label="Înapoi">${icon('chevl')}</button>` : ''}<h2>${esc(label)}</h2>${period !== 'all' ? `<button class="iconbtn" data-m="1" aria-label="Înainte">${icon('chev')}</button>` : ''}</div>
      <div class="row"><div class="seg">${[['month', 'Lună'], ['year', 'An'], ['all', 'Tot']].map(([k, l]) => `<button data-p="${k}" class="${period === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="emp" aria-label="Angajator"><option value="">Toți angajatorii</option>${app.employers().map((e) => `<option value="${e.id}"${e.id === empF ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div></header>
    <div class="kv">
      <div><span class="label">1. Câștig estimat</span><b>${fmtMoney(S.estimated, cur)}</b><span class="hint">valoarea tuturor orelor lucrate</span></div>
      <div class="ok"><span class="label">2. Eligibil pentru plată</span><b>${fmtMoney(S.eligible, cur)}</b><span class="hint">conform regulilor configurate</span></div>
      <div><span class="label">3. Confirmat de angajator</span><b>${S.confirmations.length ? fmtMoney(S.confirmed, cur) : '—'}</b></div>
      <div class="ok"><span class="label">4. Primit efectiv</span><b>${fmtMoney(S.received, cur)}</b><span class="hint">${S.payments.length} plăți</span></div>
      <div class="${S.outstandingVsEligible > 0.009 ? 'warn' : ''}"><span class="label">5. Încă neplătit</span><b>${fmtMoney(Math.max(0, S.outstandingVsEligible), cur)}</b><span class="hint">eligibil − primit${S.outstandingVsConfirmed != null ? ` · confirmat − primit: ${fmtMoney(S.outstandingVsConfirmed, cur)}` : ''}</span></div>
      <div class="${S.diffEligibleConfirmed && Math.abs(S.diffEligibleConfirmed) > 0.009 ? 'bad' : ''}"><span class="label">6. Diferențe</span><b>${S.diffEligibleConfirmed == null ? '—' : fmtMoney(S.diffEligibleConfirmed, cur)}</b><span class="hint">confirmat − eligibil</span></div>
      <div class="warn"><span class="label">Neconfirmat</span><b>${fmtMoney(S.unconfirmed, cur)}</b><span class="hint">ore/sporuri cu regulă necunoscută</span></div>
      <div class="bad"><span class="label">Neeligibil (ore lucrate neplătite)</span><b>${fmtMoney(S.ineligible, cur)}</b></div>
    </div>
    ${T.missingRate ? '<p class="note warn small"><b>Lipsește tariful</b> pentru unele ore – valorile sunt incomplete. Adaugă un tarif mai jos.</p>' : ''}
    <div class="kv">
      <div><span class="label">Ore normale</span><b>${fmtDur(T.effMin - T.otMin)}</b></div>
      <div><span class="label">Ore suplimentare</span><b>${fmtDur(T.otMin)}</b><span class="hint">${fmtDur(T.otEligibleMin)} eligibile</span></div>
      <div class="hol"><span class="label">Ore de sărbătoare</span><b>${fmtDur(T.holidayMin)}</b></div>
      <div><span class="label">Plată pe producție</span><b>${fmtMoney(T.money.production, cur)}</b></div>
      <div><span class="label">Bonusuri</span><b>${fmtMoney(T.money.bonus, cur)}</b></div>
      <div><span class="label">Zile încă nemarcate „plătit”</span><b>${unpaidDays}</b></div>
      <div class="x"><span class="label">Ore extra neplătite</span><b>${fmtDur([...R.calc.values()].filter((c) => c.date >= from && c.date <= to && !c.t.open && c.otMin > 0 && (!empF || c.employerId === empF) && !['platit', 'compensat'].includes(c.shift.settlement?.ot)).reduce((t, c) => t + c.otMin, 0))}</b><span class="hint">marchează plata din pagina Luna</span></div>
    </div>
    <p class="tiny muted">Valorile sunt estimări brute/nete după cum ai configurat tariful. Aplicația nu calculează impozite sau contribuții. Cheltuielile sunt separate și nu intră în câștig.</p>
  </section>
  <section class="panel"><header><h2>Plăți primite</h2></header>
    ${S.payments.length ? `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Angajator</th><th>Perioada</th><th class="r">Suma</th><th class="r">Ore</th><th class="r">Supl.</th><th class="r">Sărb.</th><th>Observații</th></tr></thead><tbody>
      ${S.payments.sort((a, b) => b.date.localeCompare(a.date)).map((p) => `<tr class="click" data-pay="${p.id}"><td class="tabnum">${fmtDate(p.date)}</td><td>${esc(app.name(p.employerId))}</td><td class="small tabnum">${fmtDate(p.periodFrom)} – ${fmtDate(p.periodTo)}</td><td class="r"><b>${fmtMoney(Number(p.amount), p.currency || cur)}</b> <span class="tiny muted">${esc(p.basis || '')}</span></td><td class="r">${fmtNum(p.hours)}</td><td class="r">${fmtNum(p.otHours)}</td><td class="r">${fmtNum(p.holidayHours)}</td><td class="small">${esc(p.note || '')}${p.reference ? ` <span class="muted">#${esc(p.reference)}</span>` : ''}${p.attachments?.length ? ` ${p.attachments.map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">document</a>`).join(' ')}` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : emptyState('Nicio plată înregistrată în această perioadă.')}
  </section>
  <section class="panel"><header><h2>Sume confirmate de angajator</h2></header>
    ${S.confirmations.length ? `<div class="list">${S.confirmations.map((c) => `<div class="item click" data-conf="${c.id}"><div class="grow"><b>${fmtMoney(Number(c.amount), c.currency || cur)}</b> <span class="small muted">${fmtDate(c.periodFrom)} – ${fmtDate(c.periodTo)} · ${esc(app.name(c.employerId))}${c.hours ? ' · ' + fmtNum(c.hours) + ' h' : ''}${c.note ? ' · ' + esc(c.note) : ''}</span></div>${icon('edit')}</div>`).join('')}</div>` : emptyState('Nicio confirmare în această perioadă.')}
  </section>
  <section class="panel"><header><h2>Tarife</h2><button class="btn-sm" id="addrate">${icon('plus')} Tarif nou</button></header>
    ${rates.length ? `<div class="list">${rates.map((r) => `<div class="item"><div class="grow"><b>${fmtMoney(Number(r.normal), r.currency)} / oră</b> ${r.validTo && r.validTo < app.today() ? pill('istoric', '') : pill('în vigoare', 'ok')}
      <div class="small muted">${esc(app.name(r.employerId))}${r.contractId ? ' · ' + esc(app.name(r.contractId)) : ''}${r.activityId ? ' · ' + esc(app.name(r.activityId)) : ' · toate activitățile'} · ${fmtDate(r.validFrom)} – ${r.validTo ? fmtDate(r.validTo) : 'prezent'} · ${esc(r.basis || 'necunoscut')}</div>
      <div class="tiny muted">Supl.: ${r.otRate ? fmtMoney(Number(r.otRate), r.currency) : r.otMultiplier ? '×' + r.otMultiplier : 'neconfigurat'} · Sărb.: ${r.holidayRate ? fmtMoney(Number(r.holidayRate), r.currency) : r.holidayMultiplier ? '×' + r.holidayMultiplier : 'neconfigurat'}${r.satMultiplier ? ' · Sâmbătă ×' + r.satMultiplier : ''}${r.sunMultiplier ? ' · Duminică ×' + r.sunMultiplier : ''}${(r.perUnit || []).length ? ' · ' + r.perUnit.map((u) => `${fmtMoney(Number(u.price), r.currency)}/${esc(u.unit)}`).join(', ') : ''}${r.dailyBonus ? ' · bonus/zi ' + fmtMoney(Number(r.dailyBonus), r.currency) : ''}${r.reason ? ' · ' + esc(r.reason) : ''}</div></div>
      <div class="row"><button class="btn-sm" data-rver="${r.id}">Schimbă de la o dată</button><button class="btn-sm btn-ghost" data-red="${r.id}" aria-label="Corectează">${icon('edit')}</button></div></div>`).join('')}</div>`
    : emptyState('Niciun tarif configurat. Fără tarif, aplicația numără orele, dar nu poate estima banii.', '<button class="btn-primary" data-addrate>Adaugă tarif</button>')}
    <p class="tiny muted">„Schimbă de la o dată” închide tariful vechi și creează unul nou. Zilele încheiate își păstrează tariful folosit; recalcularea se face doar la cerere, din fișa zilei.</p>
  </section>`;
  root.querySelector('#pay').onclick = () => editPayment(app);
  root.querySelector('#conf').onclick = () => editConfirmation(app);
  root.querySelectorAll('#addrate, [data-addrate]').forEach((b) => { b.onclick = () => editRate(app); });
  root.querySelectorAll('[data-red]').forEach((b) => { b.onclick = () => editRate(app, b.dataset.red); });
  root.querySelectorAll('[data-rver]').forEach((b) => { b.onclick = () => editRate(app, b.dataset.rver, { newVersion: true }); });
  root.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = () => editPayment(app, b.dataset.pay); });
  root.querySelectorAll('[data-conf]').forEach((b) => { b.onclick = () => editConfirmation(app, b.dataset.conf); });
  root.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { period = b.dataset.p; app.refresh(); }; });
  root.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { app.params = { ...app.params, month: shiftM(+b.dataset.m) }; app.refresh(); }; });
  root.querySelector('#emp').onchange = (e) => { app.params = { ...app.params, employerId: e.target.value }; app.refresh(); };
}

export async function editRate(app, id, { newVersion = false } = {}) {
  const orig = id ? app.store.get(id) : null;
  const emps = app.employers();
  if (!emps.length) { toast('Adaugă mai întâi un angajator.', { bad: true }); return; }
  const b = orig || { currency: app.cur, basis: 'brut' };
  const pu = b.perUnit || [];
  const vals = await formDialog({
    title: !orig ? 'Tarif nou' : newVersion ? 'Tarif nou de la o dată' : 'Corectează tariful',
    intro: '<p class="small muted">Completează doar ce știi. Câmpurile goale rămân „neconfigurate” – aplicația nu inventează sporuri.</p>',
    fields: [
      { name: 'employerId', label: 'Angajatorul', type: 'select', options: options(emps), value: b.employerId || app.activeContract()?.employerId },
      { name: 'contractId', label: 'Contractul (opțional)', type: 'select', options: [['', 'Toate contractele angajatorului'], ...app.contracts().map((c) => [c.id, `${app.name(c.employerId)} — ${c.name}`])], value: b.contractId || '' },
      { name: 'activityId', label: 'Activitatea (opțional)', type: 'select', options: options(app.activities(), 'name', { empty: 'Toate activitățile' }), value: b.activityId || '' },
      { name: 'currency', label: 'Moneda', type: 'select', options: CURRENCIES.map((c) => [c, c]), value: b.currency },
      { name: 'normal', label: 'Tarif orar normal', type: 'number', step: '0.01', required: true, value: b.normal ?? '' },
      { name: 'basis', label: 'Valoarea este', type: 'select', options: [['brut', 'Brută'], ['net', 'Netă'], ['necunoscut', 'Nu știu']], value: b.basis },
      { name: 'otRate', label: 'Tarif ore suplimentare (sumă/oră)', type: 'number', step: '0.01', value: b.otRate ?? '', help: 'SAU multiplicatorul de mai jos.' },
      { name: 'otMultiplier', label: 'Multiplicator ore suplimentare', type: 'number', step: '0.01', value: b.otMultiplier ?? '', placeholder: 'ex. 1.25' },
      { name: 'holidayRate', label: 'Tarif special sărbători (sumă/oră)', type: 'number', step: '0.01', value: b.holidayRate ?? '' },
      { name: 'holidayMultiplier', label: 'Multiplicator sărbători', type: 'number', step: '0.01', value: b.holidayMultiplier ?? '', placeholder: 'ex. 1.5 sau 2' },
      { name: 'satMultiplier', label: 'Multiplicator sâmbătă', type: 'number', step: '0.01', value: b.satMultiplier ?? '' },
      { name: 'sunMultiplier', label: 'Multiplicator duminică', type: 'number', step: '0.01', value: b.sunMultiplier ?? '' },
      { name: 'pu1unit', label: 'Plată pe producție – unitate', type: 'select', options: [['', '—'], ...unitOptions(app, pu[0]?.unit).filter(([v]) => v !== '__new')], value: pu[0]?.unit || '' },
      { name: 'pu1price', label: 'Preț pe unitate', type: 'number', step: '0.01', value: pu[0]?.price ?? '' },
      { name: 'pu2unit', label: 'Plată pe încărcătură/transport – unitate', type: 'select', options: [['', '—'], ...unitOptions(app, pu[1]?.unit).filter(([v]) => v !== '__new')], value: pu[1]?.unit || '' },
      { name: 'pu2price', label: 'Preț pe unitate', type: 'number', step: '0.01', value: pu[1]?.price ?? '' },
      { name: 'dailyBonus', label: 'Bonus pe zi lucrată', type: 'number', step: '0.01', value: b.dailyBonus ?? '' },
      { name: 'bonusCondition', label: 'Bonusul se acordă', type: 'select', options: [['always', 'În orice zi lucrată'], ['norm_met', 'Numai dacă norma de producție e îndeplinită']], value: b.bonusCondition || 'always' },
      { name: 'validFrom', label: newVersion ? 'Noul tarif se aplică de la' : 'Valabil de la', type: 'date', required: true, value: newVersion ? app.today() : (b.validFrom || app.today().slice(0, 7) + '-01') },
      { name: 'validTo', label: 'Valabil până la (opțional)', type: 'date', value: newVersion ? '' : (b.validTo || '') },
      { name: 'reason', label: orig ? 'Motivul modificării' : 'Observații', full: true },
    ],
    validate: (v) => (!(v.normal >= 0) ? 'Tariful normal este obligatoriu.' : v.validTo && v.validTo < v.validFrom ? 'Perioada este inversată.' : null),
  });
  if (!vals) return;
  const perUnit = [[vals.pu1unit, vals.pu1price], [vals.pu2unit, vals.pu2price]].filter(([u, p]) => u && p != null).map(([unit, price]) => ({ unit, price }));
  const { pu1unit, pu1price, pu2unit, pu2price, ...rest } = vals;
  const body = { ...rest, contractId: rest.contractId || null, activityId: rest.activityId || null, validTo: rest.validTo || null, perUnit };
  if (newVersion && orig) {
    if (vals.validFrom <= (orig.validFrom || '')) { toast('Noul tarif trebuie să înceapă după cel curent.', { bad: true }); return; }
    app.store.put('rate', { id: orig.id, validTo: addDays(vals.validFrom, -1) }, { action: 'închidere tarif', reason: `Înlocuit din ${vals.validFrom}` });
    app.store.put('rate', { ...body, previousId: orig.id, previous: { normal: orig.normal, otRate: orig.otRate, otMultiplier: orig.otMultiplier, holidayRate: orig.holidayRate, holidayMultiplier: orig.holidayMultiplier } }, { action: 'tarif nou', reason: vals.reason });
  } else if (orig) {
    const r = await confirmDialog('Corectezi tariful existent. Zilele deja încheiate își păstrează tariful salvat; zilele deschise și cele fără reguli salvate vor folosi valoarea corectată.', { okLabel: 'Corectează' });
    if (!r) return;
    app.store.put('rate', { id: orig.id, ...body }, { action: 'corectare tarif', reason: vals.reason });
  } else app.store.put('rate', body, { action: 'tarif nou', reason: vals.reason });
  toast('Tarif salvat.');
  await offerRetroactive(app, { employerId: body.employerId, from: newVersion ? vals.validFrom : (orig?.validFrom && orig.validFrom < vals.validFrom ? orig.validFrom : vals.validFrom), label: 'tariful nou' });
  app.refresh();
}

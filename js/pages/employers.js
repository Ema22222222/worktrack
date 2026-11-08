// Angajatori, contracte, reguli (program + ore suplimentare + sărbători, cu versiuni), activități, locații.
import { esc, icon, pill, emptyState, formDialog, toast, options, objOptions, confirmDialog } from '../ui.js';
import { fmtDur, fmtDate, addDays, localTime, toMs } from '../util.js';
import { OT_MODES, OT_BASIS, OT_COMP, HOLIDAY_MODES, STACK_MODES, resolvePolicy } from '../calc.js';
import { COUNTRIES } from '../holidays.js';
import { CURRENCIES, setupWizard, offerRetroactive } from '../editors.js';
import { getLocation } from '../actions.js';

export function render(root, app) {
  const emps = app.store.list('employer');
  const active = app.activeContract();
  const acts = app.store.list('activity');
  root.innerHTML = `
  <div class="pagehead"><div><h1>Angajatori, contracte, reguli</h1><p class="sub">Fiecare zi de lucru e legată de un contract. Regulile au versiuni: o schimbare de la o dată nu modifică trecutul.</p></div>
    <button class="btn-primary" id="addemp">${icon('plus')} Angajator</button></div>
  ${emps.length ? emps.map((e) => {
    const cs = app.contracts(e.id);
    return `<section class="panel">
      <header><div><h2>${esc(e.name)}</h2><p class="small muted">${esc(COUNTRIES[e.country] || e.country || '')} · ${esc(e.currency || app.cur)}${e.contact ? ' · ' + esc(e.contact) : ''}</p></div>
        <div class="row"><button class="btn-sm" data-ec="${e.id}">${icon('plus')} Contract</button><button class="btn-sm btn-ghost" data-ee="${e.id}" aria-label="Editează angajatorul">${icon('edit')}</button></div></header>
      ${e.notes ? `<p class="small">${esc(e.notes)}</p>` : ''}
      ${cs.map((c) => contractHtml(app, c, active)).join('') || '<p class="small muted">Fără contracte.</p>'}
    </section>`;
  }).join('') : emptyState('Niciun angajator.', '<button class="btn-primary" data-setup>Configurare inițială</button>')}
  <section class="panel"><header><h2>Activități</h2><button class="btn-sm" id="addact">${icon('plus')} Activitate</button></header>
    ${acts.length ? `<div class="list">${acts.map((a) => `<div class="item click" data-act="${a.id}"><span class="swatch" style="background:${esc(a.color || 'var(--accent)')}"></span><div class="grow"><b>${esc(a.name)}</b>${a.archived ? ' ' + pill('arhivată') : ''}${a.description ? `<div class="small muted">${esc(a.description)}</div>` : ''}</div>${icon('edit')}</div>`).join('')}</div>` : emptyState('Nicio activitate.')}
    <p class="tiny muted">Tarifele pe activitate se configurează în „Bani și plăți” → Tarife; normele de producție pe activitate în „Producție”.</p></section>`;
  root.querySelector('#addemp').onclick = () => editEmployer(app);
  root.querySelector('[data-setup]')?.addEventListener('click', () => setupWizard(app));
  root.querySelector('#addact').onclick = () => editActivity(app);
  root.querySelectorAll('[data-ee]').forEach((b) => { b.onclick = () => editEmployer(app, b.dataset.ee); });
  root.querySelectorAll('[data-ec]').forEach((b) => { b.onclick = () => editContract(app, null, b.dataset.ec); });
  root.querySelectorAll('[data-ced]').forEach((b) => { b.onclick = () => editContract(app, b.dataset.ced); });
  root.querySelectorAll('[data-cact]').forEach((b) => { b.onclick = () => { app.saveSettings({ activeContractId: b.dataset.cact }); toast('Contract activ schimbat.'); app.refresh(); }; });
  root.querySelectorAll('[data-pol]').forEach((b) => { b.onclick = () => editPolicy(app, b.dataset.pol, { newVersion: b.dataset.v === '1' }); });
  root.querySelectorAll('[data-polnew]').forEach((b) => { b.onclick = () => editPolicy(app, null, { contractId: b.dataset.polnew }); });
  root.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => editActivity(app, b.dataset.act); });
}

function contractHtml(app, c, active) {
  const pols = app.store.list('policy').filter((p) => p.contractId === c.id).sort((a, b) => (b.validFrom || '').localeCompare(a.validFrom || ''));
  const p = resolvePolicy(app.state(), c.id, app.today()) || pols[0];
  const s = p?.schedule || {};
  const DN = ['', 'L', 'Ma', 'Mi', 'J', 'V', 'S', 'D'];
  return `<article class="panel" style="background:var(--surface-2)">
    <header><div><b>${esc(c.name)}</b> ${active?.id === c.id ? pill('activ', 'ok') : ''}<div class="small muted">${fmtDate(c.from)} – ${c.to ? fmtDate(c.to) : 'prezent'} · ${esc(COUNTRIES[c.country] || c.country || '')}${c.region ? ' · ' + esc(c.region) : ''}${c.locality ? ' · ' + esc(c.locality) : ''}</div></div>
      <div class="row">${active?.id !== c.id ? `<button class="btn-sm" data-cact="${c.id}">Folosește ca activ</button>` : ''}<button class="btn-sm btn-ghost" data-ced="${c.id}" aria-label="Editează contractul">${icon('edit')}</button></div></header>
    ${p ? `<div class="kv">
      <div><span class="label">Normă zilnică efectivă</span><b>${s.dailyNormMin == null ? '—' : fmtDur(s.dailyNormMin)}</b><span class="hint">săpt.: ${s.weeklyNormMin == null ? '—' : fmtDur(s.weeklyNormMin)} · lunar: ${s.monthlyNormMin == null ? '—' : fmtDur(s.monthlyNormMin)}</span></div>
      <div><span class="label">Program obișnuit</span><b>${esc(s.usualStart || '—')}–${esc(s.usualEnd || '—')}</b><span class="hint">pauză ${s.breakMin ?? '—'} min × ${s.breakCount ?? 1} · ${(s.workDays || []).map((d) => DN[d]).join(' ')}</span></div>
      <div class="${p.ot?.mode === 'unconfirmed' ? 'warn' : ''}"><span class="label">Ore suplimentare</span><b style="font-size:.95rem">${esc(OT_MODES[p.ot?.mode || 'unconfirmed'])}</b><span class="hint">${esc(OT_BASIS[p.ot?.basis || 'daily'])} · ${esc(OT_COMP[p.ot?.comp || 'pay'])}</span></div>
      <div class="${p.holiday?.mode === 'unconfirmed' ? 'warn' : ''}"><span class="label">Sărbători</span><b style="font-size:.95rem">${esc(HOLIDAY_MODES[p.holiday?.mode || 'unconfirmed'])}</b><span class="hint">Cumulare: ${esc(STACK_MODES[p.stackMode || 'max'])}</span></div>
    </div>
    <div class="row"><button class="btn-sm btn-primary" data-pol="${p.id}" data-v="1">Schimbă regulile de la o dată</button><button class="btn-sm" data-pol="${p.id}" data-v="0">${icon('edit')} Corectează versiunea curentă</button></div>
    ${pols.length > 1 ? `<details class="small"><summary>Istoric reguli (${pols.length} versiuni)</summary><div class="list" style="margin-top:6px">${pols.map((v) => `<div class="item"><div class="grow">${fmtDate(v.validFrom)} – ${v.validTo ? fmtDate(v.validTo) : 'prezent'}: normă ${v.schedule?.dailyNormMin == null ? '—' : fmtDur(v.schedule.dailyNormMin)}, ${esc(OT_MODES[v.ot?.mode || 'unconfirmed'])}${v.reason ? ' · ' + esc(v.reason) : ''}</div></div>`).join('')}</div></details>` : ''}`
    : `<div class="row"><button class="btn-primary btn-sm" data-polnew="${c.id}">Configurează programul și regulile</button></div>`}
  </article>`;
}

async function editEmployer(app, id) {
  const o = id ? app.store.get(id) : null;
  const vals = await formDialog({
    title: o ? 'Angajator' : 'Angajator nou',
    fields: [
      { name: 'name', label: 'Nume', required: true, value: o?.name || '' },
      { name: 'country', label: 'Țara', type: 'select', options: objOptions(COUNTRIES), value: o?.country || 'ES' },
      { name: 'currency', label: 'Moneda', type: 'select', options: CURRENCIES.map((c) => [c, c]), value: o?.currency || app.cur },
      { name: 'contact', label: 'Date de contact (opțional)', value: o?.contact || '' },
      { name: 'notes', label: 'Observații', type: 'textarea', full: true, value: o?.notes || '' },
      ...(o ? [{ name: 'reason', label: 'Motivul modificării', full: true }] : []),
    ],
  });
  if (!vals) return;
  const { reason, ...rest } = vals;
  const e = app.store.put('employer', { ...(o ? { id: o.id } : {}), ...rest }, { reason });
  toast('Salvat.');
  if (!o) await editContract(app, null, e.id);
  app.refresh();
}

async function editContract(app, id, employerId) {
  const o = id ? app.store.get(id) : null;
  const emp = app.store.get(o?.employerId || employerId);
  const vals = await formDialog({
    title: o ? 'Contract' : `Contract nou – ${emp?.name || ''}`,
    fields: [
      { name: 'name', label: 'Numele contractului', required: true, value: o?.name || 'Contract' },
      { name: 'from', label: 'Început', type: 'date', value: o?.from || app.today() },
      { name: 'to', label: 'Sfârșit (opțional)', type: 'date', value: o?.to || '' },
      { name: 'country', label: 'Țara de lucru', type: 'select', options: objOptions(COUNTRIES), value: o?.country || emp?.country || 'ES' },
      { name: 'region', label: 'Regiune / comunitate (cod)', value: o?.region || '', help: 'ex. GA pentru Galicia, AM pentru Alsacia-Moselle' },
      { name: 'locality', label: 'Localitate', value: o?.locality || '' },
      { name: 'notes', label: 'Observații', type: 'textarea', full: true, value: o?.notes || '' },
      ...(o ? [{ name: 'reason', label: 'Motivul modificării', full: true }] : []),
    ],
    validate: (v) => (v.to && v.to < v.from ? 'Perioada este inversată.' : null),
  });
  if (!vals) return;
  const { reason, ...rest } = vals;
  const c = app.store.put('contract', { ...(o ? { id: o.id } : {}), employerId: emp.id, ...rest, to: rest.to || null }, { reason });
  if (!o) { await editPolicy(app, null, { contractId: c.id }); if (!app.settings().activeContractId) app.saveSettings({ activeContractId: c.id }); }
  app.refresh();
}

export async function editPolicy(app, id, { newVersion = false, contractId } = {}) {
  const o = id ? app.store.get(id) : null;
  const cId = o?.contractId || contractId || app.activeContract()?.id;
  if (!cId) return;
  const s = o?.schedule || { workDays: [1, 2, 3, 4, 5], breakCount: 1 };
  const ot = o?.ot || { mode: 'unconfirmed', basis: 'daily', comp: 'pay', compRatio: 1 };
  const hol = o?.holiday || { mode: 'unconfirmed', compRatio: 1 };
  const h = (m) => (m == null ? '' : m / 60);
  const vals = await formDialog({
    title: !o ? 'Program și reguli' : newVersion ? 'Reguli noi de la o dată' : 'Corectează regulile',
    wide: true,
    intro: `<p class="small muted">${newVersion ? 'Versiunea actuală rămâne valabilă până în ziua dinaintea noii date. Zilele încheiate nu se recalculează.' : 'Nu presupune nimic: dacă nu știi o regulă, las-o „neconfirmată”.'}</p>`,
    fields: [
      { name: 'h1', type: 'html', html: '<h3>Program și norma de timp</h3>' },
      { name: 'dailyNormH', label: 'Norma zilnică de muncă EFECTIVĂ (ore)', type: 'number', step: '0.25', value: h(s.dailyNormMin), help: 'Fără pauze. ex. 10' },
      { name: 'weeklyNormH', label: 'Norma săptămânală (ore)', type: 'number', step: '0.25', value: h(s.weeklyNormMin) },
      { name: 'monthlyNormH', label: 'Norma lunară (ore)', type: 'number', step: '0.25', value: h(s.monthlyNormMin) },
      { name: 'usualStart', label: 'Ora obișnuită de începere', type: 'time', value: s.usualStart || '' },
      { name: 'usualEnd', label: 'Ora obișnuită de terminare', type: 'time', value: s.usualEnd || '' },
      { name: 'breakStart', label: 'Pauza începe la', type: 'time', value: s.breakStart || '12:00' },
      { name: 'breakMin', label: 'Durata pauzei (minute)', type: 'number', value: s.breakMin ?? '' },
      { name: 'breakCount', label: 'Numărul pauzelor', type: 'number', value: s.breakCount ?? 1 },
      { name: 'workDays', label: 'Zile lucrătoare', type: 'checks', options: [[1, 'Luni'], [2, 'Marți'], [3, 'Miercuri'], [4, 'Joi'], [5, 'Vineri'], [6, 'Sâmbătă'], [7, 'Duminică']], value: s.workDays || [] },
      { name: 'offDayAllOvertime', label: 'În zilele libere programate, toate orele lucrate sunt peste normă', type: 'checkbox', value: !!s.offDayAllOvertime, full: true },
      { name: 'h2', type: 'html', html: '<h3>Ore suplimentare</h3>' },
      { name: 'otMode', label: 'Eligibilitatea pentru plată', type: 'select', options: objOptions(OT_MODES), value: ot.mode, full: true },
      { name: 'otBasis', label: 'Se calculează peste', type: 'select', options: objOptions(OT_BASIS), value: ot.basis },
      { name: 'otComp', label: 'Orele eligibile', type: 'select', options: objOptions(OT_COMP), value: ot.comp },
      { name: 'otCompRatio', label: 'Ore libere pentru fiecare oră compensată', type: 'number', step: '0.05', value: ot.compRatio ?? 1, show: (v) => v.otComp === 'comp' },
      { name: 'otNote', label: 'Cum a explicat angajatorul regula (text liber)', type: 'textarea', full: true, value: ot.note || '', placeholder: 'ex. 10 ore + norma de producție; dacă atingi norma și mai lucrezi 2 ore, se plătesc' },
      { name: 'h3', type: 'html', html: '<h3>Sărbători legale</h3>' },
      { name: 'holMode', label: 'Regula pentru orele lucrate de sărbătoare', type: 'select', options: objOptions(HOLIDAY_MODES), value: hol.mode, full: true },
      { name: 'holCompRatio', label: 'Ore libere pentru fiecare oră lucrată de sărbătoare', type: 'number', step: '0.05', value: hol.compRatio ?? 1, show: (v) => v.holMode === 'comp_hours' || v.holMode === 'pay_and_comp' },
      { name: 'holCompDayH', label: 'Ore libere acordate pentru o zi de sărbătoare lucrată', type: 'number', step: '0.25', value: h(hol.compDayMin), show: (v) => v.holMode === 'comp_day', help: 'Gol = norma zilnică.' },
      { name: 'stackMode', label: 'Dacă o oră e simultan suplimentară și de sărbătoare', type: 'select', options: objOptions(STACK_MODES), value: o?.stackMode || 'max', full: true, help: 'Multiplicatorii sunt în tarif (Bani → Tarife).' },
      { name: 'h4', type: 'html', html: '<h3>Valabilitate</h3>' },
      { name: 'validFrom', label: newVersion ? 'Regulile noi se aplică de la' : 'Valabil de la', type: 'date', required: true, value: newVersion ? app.today() : (o?.validFrom || '2000-01-01') },
      { name: 'reason', label: o ? 'Motivul modificării' : 'Observații', full: true },
    ],
  });
  if (!vals) return;
  const m = (x) => (x == null ? null : Math.round(x * 60));
  const body = {
    contractId: cId, status: vals.otMode === 'unconfirmed' || vals.holMode === 'unconfirmed' ? 'neconfirmat' : 'configurat', reason: vals.reason,
    schedule: { dailyNormMin: m(vals.dailyNormH), weeklyNormMin: m(vals.weeklyNormH), monthlyNormMin: m(vals.monthlyNormH), usualStart: vals.usualStart, usualEnd: vals.usualEnd, breakStart: vals.breakStart,
      breakMin: vals.breakMin, breakCount: vals.breakCount, workDays: vals.workDays.map(Number), offDayAllOvertime: vals.offDayAllOvertime },
    ot: { mode: vals.otMode, basis: vals.otBasis, comp: vals.otComp, compRatio: vals.otCompRatio ?? 1, note: vals.otNote },
    holiday: { mode: vals.holMode, compRatio: vals.holCompRatio ?? 1, compDayMin: m(vals.holCompDayH) },
    stackMode: vals.stackMode, validFrom: vals.validFrom,
  };
  if (newVersion && o) {
    if (vals.validFrom <= (o.validFrom || '')) { toast('Noile reguli trebuie să înceapă după versiunea curentă.', { bad: true }); return; }
    app.store.put('policy', { id: o.id, validTo: addDays(vals.validFrom, -1) }, { action: 'închidere reguli', reason: `Înlocuite din ${vals.validFrom}` });
    app.store.put('policy', { ...body, validTo: null, previousId: o.id }, { action: 'reguli noi', reason: vals.reason });
  } else if (o) {
    app.store.put('policy', { id: o.id, ...body }, { action: 'corectare reguli', reason: vals.reason });
  } else app.store.put('policy', { ...body, validTo: null }, { action: 'reguli noi', reason: vals.reason });
  toast('Reguli salvate.');
  await offerRetroactive(app, { contractId: cId, from: newVersion ? vals.validFrom : undefined, label: 'regulile noi' });
  app.refresh();
}

async function editActivity(app, id) {
  const o = id ? app.store.get(id) : null;
  const vals = await formDialog({
    title: o ? 'Activitate' : 'Activitate nouă',
    fields: [
      { name: 'name', label: 'Nume', required: true, value: o?.name || '' },
      { name: 'color', label: 'Culoare', type: 'color', value: o?.color || '#1f6b45' },
      { name: 'description', label: 'Descriere', full: true, value: o?.description || '' },
      ...(o ? [{ name: 'archived', label: 'Arhivată (nu mai apare la pontaj; istoricul rămâne)', type: 'checkbox', value: !!o.archived, full: true }] : []),
    ],
  });
  if (!vals) return;
  app.store.put('activity', { ...(o ? { id: o.id } : {}), ...vals });
  toast('Salvat.'); app.refresh();
}

// ---------- Locații ----------
const LOC_KINDS = { santier: 'Șantier', padure: 'Pădure', incarcare: 'Punct de încărcare', depozit: 'Depozit', garaj: 'Garaj', descarcare: 'Punct de descărcare', alta: 'Altă locație' };

export function renderLocations(root, app) {
  const locs = app.store.list('location');
  const st = app.state();
  const points = [];
  for (const sh of st.shifts.filter((s) => !s.deleted)) {
    for (const [k, l] of [['Început', sh.startLoc], ['Sfârșit', sh.endLoc]]) if (l?.geo || l?.locationId) points.push({ at: k === 'Început' ? sh.start : sh.end, what: `${k} muncă`, l });
    for (const g of (sh.segments || []).filter((x) => !x.deleted && (x.geo || x.locationId))) points.push({ at: g.start, what: `Activitate: ${app.name(g.activityId)}`, l: { geo: g.geo, locationId: g.locationId } });
  }
  for (const p of st.production.filter((x) => !x.deleted && (x.geo || x.locationId))) points.push({ at: p.time || p.date, what: `Producție ${p.qty} ${p.unit}`, l: { geo: p.geo, locationId: p.locationId } });
  points.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const gps = app.settings().gps;
  root.innerHTML = `<div class="pagehead"><div><h1>Locații</h1><p class="sub">Locația se salvează doar la acțiuni (start, schimbare activitate, producție, final). Nu există urmărire continuă.</p></div>
    <button class="btn-primary" id="add">${icon('plus')} Locație salvată</button></div>
  <section class="panel"><header><h2>GPS</h2>${gps ? pill('Activat', 'ok') : pill('Dezactivat', '')}</header>
    <p class="small">${gps ? 'La fiecare acțiune importantă se încearcă citirea poziției. Dacă GPS-ul nu răspunde în câteva secunde, timpul se salvează fără locație.' : 'Locația GPS este oprită. Poți alege o locație salvată la start sau la producție.'} Activarea se face din „Setări”.</p>
    <p class="tiny muted">Unele browsere sau vizualizări blochează accesul la locație. În acest caz folosește locațiile salvate (introducere manuală).</p></section>
  <section class="panel"><h2>Locații salvate</h2>${locs.length ? `<div class="list">${locs.map((l) => `<div class="item click" data-l="${l.id}">${icon('pin')}<div class="grow"><b>${esc(l.name)}</b> <span class="small muted">${esc(COUNTRIES[l.country] || '')}${l.region ? ' · ' + esc(l.region) : ''} · ${esc(LOC_KINDS[l.kind] || '')}${l.address ? ' · ' + esc(l.address) : ''}${l.lat != null ? ` · ${l.lat}, ${l.lng}` : ''}</span></div>${l.lat != null ? `<a class="btn-sm btn" href="https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=15/${l.lat}/${l.lng}" target="_blank" rel="noopener">Hartă</a>` : ''}</div>`).join('')}</div>` : emptyState('Nicio locație salvată. Exemple: Pădure, Punct de încărcare, Depozit, Garaj.')}</section>
  <section class="panel"><h2>Istoricul locațiilor înregistrate</h2>${points.length ? `${mapSvg(points)}<div class="tablewrap"><table><thead><tr><th>Când</th><th>Acțiune</th><th>Locație</th><th></th></tr></thead><tbody>
    ${points.slice(0, 200).map((p) => `<tr><td class="tabnum small">${p.at && String(p.at).includes('T') ? `${fmtDate(String(p.at).slice(0, 10))} ${localTime(toMs(p.at), app.tz)}` : esc(p.at || '')}</td><td>${esc(p.what)}</td><td>${esc(p.l.locationId ? app.name(p.l.locationId) : '')}${p.l.geo ? ` <span class="small muted">${p.l.geo.lat}, ${p.l.geo.lng} (±${p.l.geo.acc || '?'} m)</span>` : ''}</td><td>${p.l.geo ? `<a href="https://www.openstreetmap.org/?mlat=${p.l.geo.lat}&mlon=${p.l.geo.lng}#map=15/${p.l.geo.lat}/${p.l.geo.lng}" target="_blank" rel="noopener">Hartă</a>` : ''}</td></tr>`).join('')}
  </tbody></table></div>` : emptyState('Nicio locație înregistrată încă.')}</section>`;
  root.querySelector('#add').onclick = () => editLocation(app);
  root.querySelectorAll('[data-l]').forEach((b) => { b.onclick = (e) => { if (e.target.closest('a')) return; editLocation(app, b.dataset.l); }; });
}

function mapSvg(points) {
  const g = points.filter((p) => p.l.geo).map((p) => p.l.geo);
  if (g.length < 2) return '';
  const lats = g.map((x) => x.lat), lngs = g.map((x) => x.lng);
  const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const W = 600, H = 240, pad = 20;
  const sx = (v) => pad + ((v - c) / Math.max(1e-6, d - c)) * (W - 2 * pad);
  const sy = (v) => H - pad - ((v - a) / Math.max(1e-6, b - a)) * (H - 2 * pad);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Schița pozițiilor înregistrate"><rect x="0" y="0" width="${W}" height="${H}" fill="var(--surface-2)" rx="8"/>
    ${g.map((x) => `<circle cx="${sx(x.lng).toFixed(1)}" cy="${sy(x.lat).toFixed(1)}" r="5" fill="var(--accent)" fill-opacity=".65"/>`).join('')}
    <text x="${pad}" y="14">Schiță relativă a pozițiilor (N sus). Pentru hartă, deschide un punct.</text></svg>`;
}

export async function editLocation(app, id) {
  const o = id ? app.store.get(id) : null;
  const vals = await formDialog({
    title: o ? 'Locație' : 'Locație nouă',
    fields: [
      { name: 'name', label: 'Nume', required: true, value: o?.name || '' },
      { name: 'country', label: 'Țara', type: 'select', options: objOptions(COUNTRIES), value: o?.country || 'ES', help: 'Sărbătorile legale se iau după țara locului în care ai lucrat.' },
      { name: 'region', label: 'Regiune (cod)', value: o?.region || '', placeholder: 'ex. NA = Navarra' },
      { name: 'locality', label: 'Localitate', value: o?.locality || '' },
      { name: 'kind', label: 'Tip', type: 'select', options: objOptions(LOC_KINDS), value: o?.kind || 'santier' },
      { name: 'address', label: 'Adresă / descriere', full: true, value: o?.address || '' },
      { name: 'lat', label: 'Latitudine', type: 'number', step: 'any', value: o?.lat ?? '' },
      { name: 'lng', label: 'Longitudine', type: 'number', step: 'any', value: o?.lng ?? '' },
      ...(app.settings().gps ? [{ name: 'useGps', label: 'Folosește poziția mea actuală', type: 'checkbox', value: false, full: true }] : []),
    ],
    extraActions: o ? [{ label: 'Șterge', cls: 'btn-danger', onClick: () => { app.store.remove(o.id); app.refresh(); return null; } }] : [],
  });
  if (!vals) return null;
  if (vals.useGps) {
    const g = await getLocation(app);
    if (g) { vals.lat = g.lat; vals.lng = g.lng; } else toast('Poziția GPS nu este disponibilă; locația se salvează fără coordonate.', { bad: true });
  }
  const { useGps, ...rest } = vals;
  const saved = app.store.put('location', { ...(o ? { id: o.id } : {}), ...rest });
  toast('Salvat.'); app.refresh();
  return saved;
}

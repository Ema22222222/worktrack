// Sărbători legale: calendar pe țară/regiune/localitate, import de propuneri, ore lucrate de sărbătoare și sold.
import { esc, icon, pill, emptyState, formDialog, openDialog, toast, objOptions, confirmDialog } from '../ui.js';
import { fmtDur, fmtDate, fmtMoney, dowOf, dayName } from '../util.js';
import { compLedger, SETTLEMENT, HOLIDAY_MODES, resolvePolicy } from '../calc.js';
import { PRESETS, COUNTRIES, buildProposals } from '../holidays.js';
import { editShift } from '../editors.js';

const STATUS = { confirmata: ['Confirmată', 'ok'], neconfirmata: ['Neconfirmată', 'warn'], respinsa: ['Respinsă', 'bad'] };
const SCOPE = { national: 'Națională', regional: 'Regională / comunitate', local: 'Locală' };

export function render(root, app) {
  const R = app.calc(); const st = app.state();
  const year = app.params.year || app.today().slice(0, 4);
  const hols = app.store.list('holiday').filter((h) => h.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date));
  const contract = app.activeContract();
  const pol = contract ? resolvePolicy(st, contract.id, app.today()) : null;
  const hmode = pol?.holiday?.mode || 'unconfirmed';
  // zile lucrate de sărbătoare
  const worked = [...R.calc.values()].filter((c) => c.holidayMin > 0 && c.date.startsWith(year)).sort((a, b) => a.t.start - b.t.start);
  const sum = (f) => worked.reduce((t, c) => t + f(c), 0);
  const holMin = sum((c) => c.holidayMin);
  const paid = sum((c) => (c.shift.settlement?.holiday === 'platit' ? c.holidayMin : 0));
  const compensated = sum((c) => (c.shift.settlement?.holiday === 'compensat' ? c.holidayMin : 0));
  const L = compLedger(st, R);
  const cur = app.cur;

  root.innerHTML = `
  <div class="pagehead"><div><h1>Sărbători legale</h1><p class="sub">Orele lucrate de sărbătoare sunt evidențiate separat. Ele pot fi în același timp și ore peste normă, dar se numără o singură dată în total.</p></div>
    <div class="row"><select id="year" aria-label="Anul">${[0, 1, -1, 2, -2].map((k) => String(+app.today().slice(0, 4) + k)).sort().map((y) => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
    <button id="import">${icon('dl')} Importă propuneri</button><button class="btn-primary" id="add">${icon('plus')} Sărbătoare</button></div></div>
  <section class="panel">
    <header><h2>Sold ore de sărbătoare – ${year}</h2>${hmode === 'unconfirmed' ? pill('Regulă neconfirmată', 'warn') : pill(HOLIDAY_MODES[hmode], 'info')}</header>
    <div class="kv">
      <div class="hol"><span class="label">Ore lucrate de sărbătoare</span><b>${fmtDur(holMin)}</b><span class="hint">${worked.length} zile</span></div>
      <div class="ok"><span class="label">Plătite</span><b>${fmtDur(paid)}</b></div>
      <div class="warn"><span class="label">Încă neplătite / necompensate</span><b>${fmtDur(Math.max(0, holMin - paid - compensated))}</b></div>
      <div><span class="label">Eligibile pentru compensare</span><b>${fmtDur(L.fromHoliday)}</b><span class="hint">conform regulii</span></div>
      <div><span class="label">Ore compensatorii acordate (total)</span><b>${fmtDur(L.granted)}</b></div>
      <div><span class="label">Folosite</span><b>${fmtDur(L.used)}</b></div>
      <div class="${L.balance >= 0 ? 'ok' : 'bad'}"><span class="label">Sold rămas</span><b>${fmtDur(L.balance, { sign: true })}</b></div>
    </div>
    ${hmode === 'unconfirmed' ? '<p class="note warn small">Nu se presupune niciun spor sau zi liberă pentru sărbători până nu configurezi regula în „Angajatori, contracte, reguli”.</p>' : ''}
    ${worked.length ? `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Sărbătoarea</th><th class="r">Lucrat</th><th class="r">Lucrat de sărbătoare</th><th class="r">Peste normă</th><th class="r">Valoare estimată</th><th class="r">De compensat</th><th>Statut</th></tr></thead><tbody>
      ${worked.map((c) => { const h = c.slices.find((s) => s.holiday)?.holiday; return `<tr class="click" data-s="${c.id}"><td class="tabnum">${fmtDate(c.date)}</td><td>${esc(h?.name || '')}${h && !h.confirmed ? ' ' + pill('neconf.', 'warn') : ''}</td><td class="r">${fmtDur(c.t.effMin)}</td><td class="r"><b>${fmtDur(c.holidayMin)}</b></td><td class="r">${fmtDur(c.otMin)}</td><td class="r">${fmtMoney(c.money.total, app.currencyFor(c.employerId))}</td><td class="r">${fmtDur(c.compFromHolidayMin)}</td><td>${pill(SETTLEMENT[c.shift.settlement?.holiday] || 'Neconfirmat', c.shift.settlement?.holiday === 'platit' ? 'ok' : c.shift.settlement?.holiday === 'compensat' ? 'info' : 'warn')}</td></tr>`; }).join('')}
    </tbody></table></div><p class="tiny muted">Atinge o zi pentru a-i schimba statutul (neconfirmat / confirmat / în așteptarea plății / plătit / compensat).</p>` : ''}
  </section>
  <section class="panel">
    <header><h2>Calendar ${year}</h2><span class="small muted">Contract activ: ${esc(COUNTRIES[contract?.country] || contract?.country || '—')}${contract?.region ? ' · ' + esc(contract.region) : ''}${contract?.locality ? ' · ' + esc(contract.locality) : ''}</span></header>
    ${hols.some((h) => h.status === 'neconfirmata') ? '<p class="note warn small">Unele sărbători sunt neconfirmate. Orele lucrate în ele sunt numărate ca ore de sărbătoare, dar orice spor rămâne „neconfirmat”. Verifică în calendarul oficial și confirmă.</p>' : ''}
    ${hols.length ? `<div class="list">${hols.map((h) => `<div class="item"><div class="grow"><b>${fmtDate(h.date)}</b> <span class="small muted">${dayName(dowOf(h.date))}</span> · ${esc(h.name)}
      <div class="small muted">${esc(COUNTRIES[h.country] || h.country || '')} · ${esc(SCOPE[h.scope] || '')}${h.region ? ' · ' + esc(h.region) : ''}${h.locality ? ' · ' + esc(h.locality) : ''}${h.source ? ' · ' + esc(h.source) : ''}</div></div>
      ${pill(STATUS[h.status]?.[0] || h.status, STATUS[h.status]?.[1])}
      ${h.status !== 'confirmata' ? `<button class="btn-sm" data-ok="${h.id}">${icon('check')} Confirm</button>` : ''}<button class="btn-sm btn-ghost" data-ed="${h.id}" aria-label="Editează">${icon('edit')}</button></div>`).join('')}</div>`
    : emptyState(`Nicio sărbătoare configurată pentru ${year}.`, '<button class="btn-primary" data-import>Importă propuneri pentru țara ta</button>')}
  </section>`;
  root.querySelector('#year').onchange = (e) => { app.params = { year: e.target.value }; app.refresh(); };
  root.querySelector('#add').onclick = () => editHoliday(app);
  root.querySelectorAll('#import, [data-import]').forEach((b) => { b.onclick = () => importDialog(app, year); });
  root.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => editHoliday(app, b.dataset.ed); });
  root.querySelectorAll('[data-ok]').forEach((b) => { b.onclick = () => { app.store.put('holiday', { id: b.dataset.ok, status: 'confirmata' }, { action: 'confirmare sărbătoare', reason: 'Verificat de utilizator' }); app.refresh(); }; });
  root.querySelectorAll('[data-s]').forEach((r) => { r.onclick = () => editShift(app, r.dataset.s); });
}

async function editHoliday(app, id) {
  const orig = id ? app.store.get(id) : null;
  const c = app.activeContract();
  const vals = await formDialog({
    title: orig ? 'Corectează sărbătoarea' : 'Adaugă sărbătoare',
    fields: [
      { name: 'date', label: 'Data', type: 'date', required: true, value: orig?.date || app.today() },
      { name: 'name', label: 'Denumirea', required: true, value: orig?.name || '' },
      { name: 'country', label: 'Țara', type: 'select', options: objOptions(COUNTRIES), value: orig?.country || c?.country || 'ES' },
      { name: 'scope', label: 'Tipul', type: 'select', options: objOptions(SCOPE), value: orig?.scope || 'national' },
      { name: 'region', label: 'Regiunea / comunitatea (cod)', value: orig?.region || c?.region || '', show: (v) => v.scope !== 'national' },
      { name: 'locality', label: 'Localitatea', value: orig?.locality || c?.locality || '', show: (v) => v.scope === 'local' },
      { name: 'status', label: 'Statut', type: 'select', options: [['confirmata', 'Confirmată (verificată în calendarul oficial)'], ['neconfirmata', 'Neconfirmată'], ['respinsa', 'Respinsă – nu se aplică']], value: orig?.status || 'confirmata' },
      { name: 'source', label: 'Sursa', value: orig?.source || '', placeholder: 'ex. BOE, DOG, primărie' },
    ],
    extraActions: orig ? [{ label: 'Șterge', cls: 'btn-danger', onClick: () => { app.store.remove(orig.id); toast('Șters (recuperabil din istoric).'); app.refresh(); return null; } }] : [],
  });
  if (!vals) return;
  const dup = !orig && app.store.list('holiday').find((h) => h.date === vals.date && h.country === vals.country && h.scope === vals.scope && (h.region || '') === (vals.region || ''));
  if (dup) { toast('Această sărbătoare există deja.', { bad: true }); return; }
  app.store.put('holiday', { ...(orig ? { id: orig.id } : {}), ...vals, region: vals.scope === 'national' ? '' : vals.region, locality: vals.scope === 'local' ? vals.locality : '' });
  toast('Salvat.'); app.refresh();
}

async function importDialog(app, year) {
  const c = app.activeContract();
  const wl = app.store.get(app.settings().lastLocationId);
  const country0 = PRESETS[wl?.country] ? wl.country : PRESETS[c?.country] ? c.country : 'ES';
  const step1 = await formDialog({
    title: 'Importă propuneri de sărbători',
    intro: '<p class="small muted">Datele sunt calculate pe baza regulilor cunoscute (inclusiv Paștele). Se importă ca <b>neconfirmate</b>; verifică-le în calendarul oficial al anului.</p>',
    fields: [
      { name: 'country', label: 'Țara', type: 'select', options: Object.entries(PRESETS).map(([k, p]) => [k, p.label]), value: country0 },
      { name: 'region', label: 'Regiunea', type: 'select', options: [['', 'Doar naționale'], ['NA', 'Navarra (ES)'], ['GA', 'Galicia (ES)'], ['AM', 'Alsacia-Moselle (FR)']], value: wl?.region || c?.region || '' },
      { name: 'year', label: 'Anul', type: 'number', value: year },
    ],
    submitLabel: 'Arată propunerile',
  });
  if (!step1) return;
  const props = buildProposals(step1.country, step1.region, Number(step1.year));
  const existing = app.store.list('holiday');
  const fresh = props.map((p) => ({ ...p, exists: existing.some((h) => h.date === p.date && h.country === p.country && (h.region || '') === (p.region || '')) }));
  const note = PRESETS[step1.country].note;
  const r = await openDialog({
    title: `Propuneri ${PRESETS[step1.country].label} ${step1.year}`,
    body: `<p class="note warn small">${esc(note)}</p><div class="list">${fresh.map((p, i) => `<label class="item"><input type="checkbox" data-i="${i}" ${p.exists ? 'disabled' : 'checked'}><div class="grow"><b>${fmtDate(p.date)}</b> ${esc(p.name)} <span class="small muted">${esc(SCOPE[p.scope])}${p.region ? ' ' + esc(p.region) : ''}${p.exists ? ' · există deja' : ''}</span></div></label>`).join('')}</div>`,
    actions: [{ label: 'Renunță' }, { label: 'Importă selectate', cls: 'btn-primary', onClick: (api) => [...api.el.querySelectorAll('[data-i]:checked')].map((x) => fresh[+x.dataset.i]) }],
  });
  if (!r?.length) return;
  for (const p of r) { const { exists, ...h } = p; app.store.put('holiday', h, { action: 'import propunere', undoable: false }); }
  toast(`${r.length} sărbători importate ca neconfirmate.`); app.refresh();
}

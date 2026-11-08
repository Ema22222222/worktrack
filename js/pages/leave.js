// Ore compensatorii (sold) și concedii / zile libere / absențe.
import { esc, icon, formDialog, toast, pill, emptyState, confirmDialog } from '../ui.js';
import { fmtDur, fmtDate, daysBetween } from '../util.js';
import { compLedger } from '../calc.js';

export const ABSENCE_TYPES = {
  concediu: 'Concediu de odihnă', liber: 'Zi liberă', absenta: 'Absență', medical: 'Concediu medical',
  sarbatoare: 'Sărbătoare (zi liberă)', recuperare: 'Zi de recuperare (din sold)', compensatoriu: 'Ore libere compensatorii (din sold)',
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
  const R = app.calc();
  const L = compLedger(app.state(), R);
  root.innerHTML = `<div class="pagehead"><div><h1>Ore compensatorii</h1><p class="sub">Ore libere câștigate (sărbători lucrate, ore suplimentare compensate) și folosite.</p></div>
    <div class="row"><button class="btn-primary" id="grant">${icon('plus')} Acordat manual</button><button id="use">${icon('leave')} Folosesc ore</button></div></div>
  <section class="panel"><div class="kv">
    <div class="${L.balance > 0 ? 'ok' : L.balance < 0 ? 'bad' : ''}"><span class="label">Sold rămas</span><b>${fmtDur(L.balance, { sign: true })}</b></div>
    <div><span class="label">Acordate total</span><b>${fmtDur(L.granted)}</b></div>
    <div class="hol"><span class="label">din lucru de sărbătoare</span><b>${fmtDur(L.fromHoliday)}</b></div>
    <div><span class="label">Folosite</span><b>${fmtDur(L.used)}</b></div></div>
    <p class="small muted">Orele „calculate” apar doar dacă regula de sărbători sau de ore suplimentare a contractului prevede compensare cu timp liber. Dacă angajatorul ți-a acordat altfel, folosește „Acordat manual”.</p></section>
  <section class="panel"><h2>Mișcări</h2>${L.rows.length ? `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Descriere</th><th class="r">Ore</th><th class="r">Sold</th></tr></thead><tbody>
    ${[...L.rows].reverse().map((r) => `<tr class="${r.kind === 'manual' ? 'click' : ''}" ${r.kind === 'manual' ? `data-m="${r.ref}"` : r.kind === 'folosit' ? `data-a="${r.ref}"` : `data-day="${r.date}"`} style="cursor:pointer"><td class="tabnum">${fmtDate(r.date)}</td><td>${esc(r.label)} ${r.kind === 'sarbatoare' ? pill('sărbătoare', 'hol') : ''}</td><td class="r" style="color:${r.min >= 0 ? 'var(--ok)' : 'var(--bad)'}">${fmtDur(r.min, { sign: true })}</td><td class="r">${fmtDur(r.balance, { sign: true })}</td></tr>`).join('')}
    </tbody></table></div>` : emptyState('Nicio oră compensatorie încă.')}</section>`;
  root.querySelector('#grant').onclick = () => editComp(app);
  root.querySelector('#use').onclick = () => editAbsence(app, null, { type: 'compensatoriu' });
  root.querySelectorAll('[data-m]').forEach((r) => { r.onclick = () => editComp(app, r.dataset.m); });
  root.querySelectorAll('[data-a]').forEach((r) => { r.onclick = () => editAbsence(app, r.dataset.a); });
  root.querySelectorAll('[data-day]').forEach((r) => { r.onclick = () => app.go('calendar', { date: r.dataset.day, anchor: r.dataset.day }); });
}

async function editComp(app, id) {
  const orig = id ? app.store.get(id) : null;
  const vals = await formDialog({
    title: orig ? 'Corectează' : 'Ore compensatorii acordate / ajustare',
    fields: [
      { name: 'date', label: 'Data', type: 'date', required: true, value: orig?.date || app.today() },
      { name: 'hours', label: 'Ore (+ acordate, − ajustare negativă)', type: 'number', step: '0.25', required: true, value: orig ? orig.minutes / 60 : '' },
      { name: 'note', label: 'Motiv / descriere', full: true, value: orig?.note || '', placeholder: 'ex. zi liberă acordată pentru 1 mai lucrat' },
    ],
    extraActions: orig ? [{ label: 'Șterge', cls: 'btn-danger', onClick: () => { app.store.remove(orig.id); app.refresh(); return null; } }] : [],
  });
  if (!vals) return;
  app.store.put('comp', { ...(orig ? { id: orig.id } : {}), date: vals.date, minutes: Math.round(vals.hours * 60), note: vals.note });
  toast('Salvat.'); app.refresh();
}

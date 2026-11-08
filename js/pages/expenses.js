// Cheltuieli legate de muncă – separate complet de salariu și de câștigul estimat.
import { esc, icon, formDialog, toast, emptyState, options } from '../ui.js';
import { fmtDate, fmtMoney, monthEnd, pad, monthName } from '../util.js';
import { CURRENCIES } from '../editors.js';

export const EXP_CATS = { combustibil: 'Combustibil', cazare: 'Cazare', mancare: 'Mâncare', transport: 'Transport', diurna: 'Diurnă', alte: 'Alte cheltuieli' };

export function render(root, app) {
  const anchor = app.params.month || app.today().slice(0, 7);
  const from = anchor + '-01', to = monthEnd(from);
  const list = app.store.list('expense').filter((e) => e.date >= from && e.date <= to).sort((a, b) => b.date.localeCompare(a.date));
  const byCat = {}; const byCur = {};
  for (const e of list) { const k = `${e.category}|${e.currency}`; byCat[k] = (byCat[k] || 0) + Number(e.amount || 0); byCur[e.currency] = (byCur[e.currency] || 0) + Number(e.amount || 0); }
  const [y, m] = anchor.split('-').map(Number);
  const shiftM = (k) => { const t = new Date(Date.UTC(y, m - 1 + k, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; };
  root.innerHTML = `<div class="pagehead"><div><h1>Cheltuieli</h1><p class="sub">Separate de salariu. Nu intră în câștigul estimat.</p></div><button class="btn-primary" id="add">${icon('plus')} Cheltuială</button></div>
  <section class="panel"><header><div class="row"><button class="iconbtn" data-m="-1" aria-label="Luna anterioară">${icon('chevl')}</button><h2>${monthName(m)} ${y}</h2><button class="iconbtn" data-m="1" aria-label="Luna următoare">${icon('chev')}</button></div>
    <b class="tabnum">${Object.entries(byCur).map(([c, v]) => fmtMoney(v, c)).join(' · ') || '—'}</b></header>
    <div class="kv">${Object.entries(byCat).map(([k, v]) => { const [c, cu] = k.split('|'); return `<div><span class="label">${esc(EXP_CATS[c] || c)}</span><b>${fmtMoney(v, cu)}</b></div>`; }).join('')}</div>
    ${list.length ? `<div class="list">${list.map((e) => `<div class="item click" data-e="${e.id}"><div class="grow"><b>${fmtMoney(Number(e.amount), e.currency)}</b> · ${esc(EXP_CATS[e.category] || e.category)} <div class="small muted">${fmtDate(e.date)}${e.employerId ? ' · ' + esc(app.name(e.employerId)) : ''}${e.reimbursable ? ' · decontabilă' : ''}${e.reimbursed ? ' · decontată' : ''}${e.note ? ' · ' + esc(e.note) : ''}</div></div>${icon('edit')}</div>`).join('')}</div>` : emptyState('Nicio cheltuială în această lună.')}</section>`;
  root.querySelector('#add').onclick = () => editExpense(app);
  root.querySelectorAll('[data-e]').forEach((b) => { b.onclick = () => editExpense(app, b.dataset.e); });
  root.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { app.params = { month: shiftM(+b.dataset.m) }; app.refresh(); }; });
}

async function editExpense(app, id) {
  const o = id ? app.store.get(id) : null;
  const vals = await formDialog({
    title: o ? 'Cheltuială' : 'Cheltuială nouă',
    fields: [
      { name: 'date', label: 'Data', type: 'date', required: true, value: o?.date || app.today() },
      { name: 'category', label: 'Categoria', type: 'select', options: Object.entries(EXP_CATS), value: o?.category || 'combustibil' },
      { name: 'amount', label: 'Suma', type: 'number', step: '0.01', required: true, value: o?.amount ?? '' },
      { name: 'currency', label: 'Moneda', type: 'select', options: CURRENCIES.map((c) => [c, c]), value: o?.currency || app.cur },
      { name: 'employerId', label: 'Angajatorul (opțional)', type: 'select', options: options(app.employers(), 'name', { empty: '—' }), value: o?.employerId || '' },
      { name: 'reimbursable', label: 'Decontabilă de angajator', type: 'checkbox', value: !!o?.reimbursable },
      { name: 'reimbursed', label: 'Decontată deja', type: 'checkbox', value: !!o?.reimbursed },
      { name: 'note', label: 'Observații', type: 'textarea', full: true, value: o?.note || '' },
    ],
    validate: (v) => (!(v.amount > 0) ? 'Suma trebuie să fie pozitivă.' : null),
    extraActions: o ? [{ label: 'Șterge', cls: 'btn-danger', onClick: () => { app.store.remove(o.id); app.refresh(); return null; } }] : [],
  });
  if (!vals) return;
  app.store.put('expense', { ...(o ? { id: o.id } : {}), ...vals });
  toast('Salvat.'); app.refresh();
}

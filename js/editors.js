// editors.js — formularele principale folosite din mai multe pagini:
// configurarea inițială, editorul de zi de lucru, producția, plățile.
import { formDialog, openDialog, confirmDialog, toast, esc, options, objOptions, icon, fieldHtml, readForm } from './ui.js';
import { uid, zonedToUtc, localDate, localTime, toIso, toMs, fmtDur, round2, fmtDate } from './util.js';
import { UNITS, SETTLEMENT, shiftOverlaps, segmentOverlaps, findDuplicatePayment, shiftTimes, resolvePolicy } from './calc.js';
import { freezeRules } from './actions.js';
import { COUNTRIES } from './holidays.js';

export const DEFAULT_ACTIVITIES = [
  ['Șofer camion', '#2f6fb0'], ['Transport lemn', '#1f6b45'], ['Încărcare lemn', '#b5651d'], ['Descărcare lemn', '#8a5a2b'],
  ['Exploatare forestieră', '#3f7d20'], ['Muncă în munți', '#5b6b7a'], ['Lucru cu utilaje', '#c08a00'],
  ['Încărcător frontal', '#a04a1a'], ['Manipulare materiale', '#6a4c93'],
];
export const CURRENCIES = ['EUR', 'RON', 'GBP', 'CHF', 'USD', 'PLN', 'HUF', 'SEK', 'NOK', 'DKK', 'CZK'];

const COUNTRY_TZ = { ES: 'Europe/Madrid', FR: 'Europe/Paris', RO: 'Europe/Bucharest', PT: 'Europe/Lisbon', IT: 'Europe/Rome', DE: 'Europe/Berlin', AT: 'Europe/Vienna', BE: 'Europe/Brussels', NL: 'Europe/Amsterdam' };
// ---------- Programul standard ----------
const hmToMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const minToHm = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export { hmToMin, minToHm };

/** Programul obișnuit al contractului (cu valori implicite 08:00–20:00, pauză 12:00–13:00, normă 10h). */
export function standardFor(app, contract) {
  const p = contract ? resolvePolicy(app.state(), contract.id, app.today()) : null;
  const s = p?.schedule || {};
  const start = s.usualStart || '08:00';
  const breakMin = s.breakMin ?? 60;
  const breakStart = s.breakStart || '12:00';
  const normMin = s.dailyNormMin ?? 600;
  const end = s.usualEnd || minToHm(hmToMin(start) + normMin + breakMin);
  return { start, end, breakStart, breakEnd: breakMin ? minToHm(hmToMin(breakStart) + breakMin) : '', breakMin, normMin,
    workDays: s.workDays || [1, 2, 3, 4, 5], otMode: p?.ot?.mode || 'unconfirmed', policy: p, configured: s.dailyNormMin != null };
}

const OT_SIMPLE = [['unconfirmed', 'Nu știu încă / trebuie confirmat'], ['always', 'Da, toate orele extra se plătesc'], ['if_norm', 'Doar dacă ating norma de producție']];
const DAYS = [[1, 'Luni'], [2, 'Marți'], [3, 'Miercuri'], [4, 'Joi'], [5, 'Vineri'], [6, 'Sâmbătă'], [7, 'Duminică']];
const effPreview = (v) => {
  let span = hmToMin(v.end) - hmToMin(v.start); if (span <= 0) span += 1440;
  let br = v.breakStart && v.breakEnd ? hmToMin(v.breakEnd) - hmToMin(v.breakStart) : 0; if (br < 0) br += 1440;
  return { eff: span - br, br };
};

/** Formularul simplu pentru programul obișnuit. */
export async function editStandard(app, contractArg) {
  const contract = contractArg || app.activeContract();
  if (!contract) return setupWizard(app);
  const std = standardFor(app, contract);
  const vals = await formDialog({
    title: 'Programul meu standard',
    intro: '<p class="small muted">Se folosește când completezi o zi sau o lună dintr-o atingere. Orele lucrate peste normă apar ca ore extra.</p>',
    fields: [
      { name: 'start', label: 'Încep la', type: 'time', required: true, value: std.start },
      { name: 'end', label: 'Termin la', type: 'time', required: true, value: std.end },
      { name: 'breakStart', label: 'Pauza de la', type: 'time', value: std.breakMin ? std.breakStart : '' },
      { name: 'breakEnd', label: 'Pauza până la', type: 'time', value: std.breakEnd },
      { name: 'normH', label: 'Norma zilnică (ore lucrate efectiv)', type: 'number', step: '0.25', required: true, value: std.normMin / 60, help: 'Tot ce trece peste = ore extra.' },
      { name: 'otMode', label: 'Orele extra se plătesc?', type: 'select', options: OT_SIMPLE.concat(OT_SIMPLE.some(([k]) => k === std.otMode) ? [] : [[std.otMode, 'Regulă avansată (din Angajatori)']]), value: std.otMode },
      { name: 'workDays', label: 'Zile lucrătoare', type: 'checks', options: DAYS, value: std.workDays },
      { name: 'offDayAllOvertime', label: 'În zilele nelucrătoare (ex. sâmbătă) toate orele sunt extra', type: 'checkbox', value: !!std.policy?.schedule?.offDayAllOvertime, full: true },
      { name: 'holidayAllOvertime', label: 'De sărbătoare (fiesta) toate orele sunt extra', type: 'checkbox', value: !!std.policy?.schedule?.holidayAllOvertime, full: true },
      { name: 'workerName', label: 'Numele tău (apare pe foaia pentru birou)', value: app.settings().workerName || '', full: true },
      { name: 'preview', type: 'html', html: '<p class="note small" id="std-prev"></p>' },
    ],
    validate: (v) => {
      const { eff } = effPreview(v);
      if ((v.breakStart && !v.breakEnd) || (!v.breakStart && v.breakEnd)) return 'Completează ambele ore ale pauzei sau lasă-le goale.';
      if (eff <= 0) return 'Pauza este mai lungă decât ziua.';
      if (!(v.normH > 0)) return 'Norma trebuie să fie mai mare decât zero.';
      return null;
    },
  });
  if (!vals) return;
  const { br } = effPreview(vals);
  const p = std.policy;
  const schedule = { ...(p?.schedule || {}), usualStart: vals.start, usualEnd: vals.end, breakStart: vals.breakStart || '12:00', breakMin: br, breakCount: br ? 1 : 0,
    dailyNormMin: Math.round(vals.normH * 60), workDays: vals.workDays.map(Number), offDayAllOvertime: vals.offDayAllOvertime, holidayAllOvertime: vals.holidayAllOvertime };
  if (vals.workerName !== (app.settings().workerName || '')) app.saveSettings({ workerName: vals.workerName });
  const ruleChanged = !p || p.schedule?.dailyNormMin !== schedule.dailyNormMin || (p.ot?.mode || 'unconfirmed') !== vals.otMode || JSON.stringify(p.schedule?.workDays) !== JSON.stringify(schedule.workDays) || !!p.schedule?.offDayAllOvertime !== schedule.offDayAllOvertime || !!p.schedule?.holidayAllOvertime !== schedule.holidayAllOvertime;
  if (p) app.store.put('policy', { id: p.id, schedule, ot: { ...(p.ot || {}), mode: vals.otMode } }, { reason: 'Program standard', action: 'program standard' });
  else app.store.put('policy', { contractId: contract.id, validFrom: '2000-01-01', validTo: null, schedule, ot: { basis: 'daily', mode: vals.otMode, comp: 'pay', compRatio: 1 }, holiday: { mode: 'unconfirmed', compRatio: 1 }, stackMode: 'max' }, { reason: 'Program standard' });
  toast('Program standard salvat.');
  if (ruleChanged) await offerRetroactive(app, { contractId: contract.id, label: 'noua normă și regula orelor extra' });
  app.refresh();
}
// previzualizare live în formularul de program
document.addEventListener('input', (e) => {
  const prev = document.getElementById('std-prev'); if (!prev || !e.target.closest('.dialog')) return;
  updateStdPreview(prev.closest('.dialog'));
});
function updateStdPreview(dlg) {
  const prev = dlg.querySelector('#std-prev'); if (!prev) return;
  const g = (n) => dlg.querySelector(`[name="${n}"]`)?.value || '';
  const { eff } = effPreview({ start: g('start'), end: g('end'), breakStart: g('breakStart'), breakEnd: g('breakEnd') });
  const norm = Math.round(Number(String(g('normH')).replace(',', '.')) * 60) || 0;
  prev.innerHTML = `Pe o zi standard: <b>${fmtDur(eff)}</b> lucrate · normă <b>${fmtDur(norm)}</b> · <b style="color:var(--action-ink)">${fmtDur(Math.max(0, eff - norm))} extra</b>`;
}
new MutationObserver(() => { const p = document.getElementById('std-prev'); if (p && !p.textContent) updateStdPreview(p.closest('.dialog')); }).observe(document.documentElement, { childList: true, subtree: true });

/**
 * După o schimbare de reguli/tarife: întreabă dacă se aplică și zilelor deja încheiate.
 * Fără confirmare, trecutul rămâne neschimbat. Regulile vechi rămân în istoricul fiecărei zile.
 */
export async function offerRetroactive(app, { contractId, employerId, from, label }) {
  const list = app.store.list('shift').filter((s) => s.end && s.frozen && (!contractId || s.contractId === contractId) && (!employerId || s.employerId === employerId) &&
    (s.date || localDate(toMs(s.start), app.tz)) >= (from || '0000-00-00'));
  if (!list.length) return false;
  const r = await openDialog({
    title: 'Aplic și zilelor deja înregistrate?',
    body: `<p>Ai <b>${list.length}</b> zile deja înregistrate${from ? ` din ${fmtDate(from)} încoace` : ''}, calculate cu regulile vechi.</p><p class="small muted">Dacă alegi „Da”, le recalculez cu ${esc(label)}. Valorile vechi rămân în istoric. Dacă alegi „Nu”, zilele trecute rămân exact cum sunt.</p>`,
    actions: [{ label: 'Nu, doar de acum', value: false }, { label: 'Da, recalculează', cls: 'btn-primary', value: true }],
  });
  if (!r) return false;
  const st = app.state();
  for (const s of list) app.store.put('shift', { id: s.id, frozen: freezeRules(st, s, s.date || localDate(toMs(s.start), app.tz)) }, { action: 'recalculare retroactivă', reason: `Aplicat: ${label}`, undoable: false });
  toast(`${list.length} zile recalculate.`);
  return true;
}

// ---------- Configurare inițială ----------
export async function setupWizard(app) {
  const vals = await formDialog({
    title: 'Hai să începem',
    intro: '<p class="small muted">Durează un minut. Orice poți schimba mai târziu.</p>',
    fields: [
      { name: 'employer', label: 'Pentru cine lucrezi (angajatorul)', required: true, placeholder: 'numele firmei' },
      { name: 'country', label: 'Țara în care lucrezi', type: 'select', options: objOptions(COUNTRIES), value: 'ES' },
      { name: 'currency', label: 'Moneda', type: 'select', options: CURRENCIES.map((c) => [c, c]), value: 'EUR' },
      { name: 'h1', type: 'html', html: '<h3 style="margin-top:4px">Programul tău obișnuit</h3>' },
      { name: 'start', label: 'Încep la', type: 'time', required: true, value: '08:00' },
      { name: 'end', label: 'Termin la', type: 'time', required: true, value: '20:00' },
      { name: 'breakStart', label: 'Pauza de la', type: 'time', value: '12:00' },
      { name: 'breakEnd', label: 'Pauza până la', type: 'time', value: '13:00' },
      { name: 'normH', label: 'Norma zilnică (ore lucrate efectiv)', type: 'number', step: '0.25', required: true, value: 10, help: 'Tot ce trece peste = ore extra.' },
      { name: 'otMode', label: 'Orele extra se plătesc?', type: 'select', options: OT_SIMPLE, value: 'unconfirmed' },
      { name: 'workDays', label: 'Zile lucrătoare', type: 'checks', options: DAYS, value: [1, 2, 3, 4, 5] },
      { name: 'preview', type: 'html', html: '<p class="note small" id="std-prev"></p>' },
      { name: 'acts', label: 'Adaugă activitățile: șofer camion, transport/încărcare/descărcare lemn, pădure, utilaje…', type: 'checkbox', value: true, full: true },
    ],
    submitLabel: 'Gata',
    validate: (v) => (effPreview(v).eff <= 0 ? 'Verifică orele: pauza e mai lungă decât ziua.' : null),
  });
  if (!vals) return;
  const { br } = effPreview(vals);
  const e = app.store.put('employer', { name: vals.employer, country: vals.country, currency: vals.currency }, { reason: 'Configurare inițială', undoable: false });
  const c = app.store.put('contract', { employerId: e.id, name: 'Contract principal', country: vals.country, region: '', locality: '', from: app.today(), to: null }, { reason: 'Configurare inițială', undoable: false });
  app.store.put('policy', {
    contractId: c.id, validFrom: '2000-01-01', validTo: null, reason: 'Configurare inițială',
    schedule: { dailyNormMin: Math.round(vals.normH * 60), weeklyNormMin: null, monthlyNormMin: null, usualStart: vals.start, usualEnd: vals.end, breakStart: vals.breakStart || '12:00', breakMin: br, breakCount: br ? 1 : 0, workDays: vals.workDays.map(Number), offDayAllOvertime: false },
    ot: { basis: 'daily', mode: vals.otMode, comp: 'pay', compRatio: 1 }, holiday: { mode: 'unconfirmed', compRatio: 1 }, stackMode: 'max',
  }, { reason: 'Configurare inițială', undoable: false });
  if (vals.acts && !app.store.list('activity').length) for (const [name, color] of DEFAULT_ACTIVITIES) app.store.put('activity', { name, color }, { undoable: false });
  app.saveSettings({ currency: vals.currency, activeContractId: c.id, tz: COUNTRY_TZ[vals.country] || app.settings().tz }, 'Configurare inițială');
  toast('Gata. Poți completa zilele din „Luna”.');
  app.go('luna');
}

// ---------- utilitare dată/oră ----------
export const dt = (app, ms) => (ms == null ? { d: '', t: '' } : { d: localDate(ms, app.tz), t: localTime(ms, app.tz) });
export const fromDT = (app, d, t) => (d && t ? zonedToUtc(d, t, app.tz) : null);

function rowHtml(kind, app, item, idx) {
  const s = dt(app, toMs(item.start)), e = dt(app, toMs(item.end));
  const acts = app.activities();
  const actSel = kind === 'seg' ? `<label class="f">Activitate<select data-k="activityId">${[['', '— nealocat —'], ...acts.map((a) => [a.id, a.name])].map(([v, l]) => `<option value="${esc(v)}"${v === (item.activityId || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : '';
  return `<div class="panel" data-row="${kind}" data-id="${esc(item.id || '')}" style="padding:10px;gap:8px">
    <div class="fgrid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,130px),1fr))">
      ${actSel}
      <label class="f">De la (data)<input type="date" data-k="sd" value="${s.d}"></label>
      <label class="f">Ora<input type="time" data-k="st" value="${s.t}"></label>
      <label class="f">Până la (data)<input type="date" data-k="ed" value="${e.d}"></label>
      <label class="f">Ora<input type="time" data-k="et" value="${e.t}"></label>
      <label class="f full">Observații<input type="text" data-k="note" value="${esc(item.note || '')}"></label>
    </div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn-sm btn-danger" data-rm>${icon('trash')} Elimină</button></div>
  </div>`;
}

/**
 * Editorul complet al unei zile de lucru (tură). Creează sau corectează.
 * Păstrează istoricul: pentru zilele încheiate cere motivul modificării.
 */
export async function editShift(app, shiftId, { date } = {}) {
  const orig = shiftId ? app.store.get(shiftId) : null;
  const contract = orig ? app.store.get(orig.contractId) : app.activeContract();
  if (!contract) { toast('Configurează mai întâi un angajator și un contract.', { bad: true }); return; }
  const d0 = date || app.today();
  const policy = app.state().policies.find((p) => p.contractId === contract.id && !p.deleted);
  const sch = policy?.schedule || {};
  const def = orig || {
    employerId: contract.employerId, contractId: contract.id,
    start: toIso(fromDT(app, d0, sch.usualStart || '08:00')), end: null, breaks: [], segments: [], notes: '', settlement: {},
  };
  const items = { brk: (def.breaks || []).filter((b) => !b.deleted).map((b) => ({ ...b })), seg: (def.segments || []).filter((g) => !g.deleted).map((g) => ({ ...g })) };
  const s = dt(app, toMs(def.start)), e = dt(app, toMs(def.end));
  const contracts = app.contracts();
  const isClosed = !!orig?.end;
  const st = def.settlement || {};
  const body = `
    <div class="fgrid">
      <label class="f full">Contract / angajator<select id="se-contract">${contracts.map((c) => `<option value="${c.id}"${c.id === def.contractId ? ' selected' : ''}>${esc(app.name(c.employerId))} — ${esc(c.name)}</option>`).join('')}</select></label>
      <label class="f">Început – data<input type="date" id="se-sd" value="${s.d}"></label>
      <label class="f">Început – ora<input type="time" id="se-st" value="${s.t}"></label>
      <label class="f">Sfârșit – data<input type="date" id="se-ed" value="${e.d || s.d}"></label>
      <label class="f">Sfârșit – ora<input type="time" id="se-et" value="${e.t}"><span class="help">Gol = zi încă în desfășurare.</span></label>
    </div>
    <section class="stack"><header class="row" style="justify-content:space-between"><h3>Pauze</h3><button type="button" class="btn-sm" data-add="brk">${icon('plus')} Adaugă pauză</button></header><div id="se-brk" class="stack"></div></section>
    <section class="stack"><header class="row" style="justify-content:space-between"><h3>Activități (intervale)</h3><button type="button" class="btn-sm" data-add="seg">${icon('plus')} Adaugă activitate</button></header><div id="se-seg" class="stack"></div>
      <p class="tiny muted">Timpul neacoperit de vreo activitate apare ca „nealocat”. Dacă intervalele se suprapun, timpul NU se dublează.</p></section>
    <label class="f">Observații<textarea id="se-notes">${esc(def.notes || '')}</textarea></label>
    <details><summary>Eligibilitate și statut plată (opțional)</summary><div class="fgrid" style="margin-top:8px">
      <label class="f">Ore suplimentare – eligibilitate<select id="se-ot">${[['auto', 'Automat, după regula configurată'], ['eligible', 'Eligibile (confirmat de angajator)'], ['ineligible', 'Neeligibile'], ['unconfirmed', 'Neconfirmate'], ['partial', 'Parțial eligibile']].map(([v, l]) => `<option value="${v}"${(def.otOverride || 'auto') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Minute suplimentare eligibile (pentru „parțial”)<input type="number" id="se-otmin" value="${def.otEligibleMin ?? ''}"></label>
      <label class="f full">Notă eligibilitate<input type="text" id="se-otnote" value="${esc(def.otOverrideNote || '')}"></label>
      <label class="f">Statut plată – ore normale<select id="se-s-day">${Object.entries(SETTLEMENT).map(([v, l]) => `<option value="${v}"${(st.day || 'neconfirmat') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Statut – ore suplimentare<select id="se-s-ot">${Object.entries(SETTLEMENT).map(([v, l]) => `<option value="${v}"${(st.ot || 'neconfirmat') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Statut – ore de sărbătoare<select id="se-s-hol">${Object.entries(SETTLEMENT).map(([v, l]) => `<option value="${v}"${(st.holiday || 'neconfirmat') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Minute compensatorii (doar regulă personalizată de sărbătoare)<input type="number" id="se-hcomp" value="${def.holidayCompMin ?? ''}"></label>
    </div></details>
    ${orig ? `<label class="f">Motivul modificării${isClosed ? ' *' : ''}<input type="text" id="se-reason" placeholder="ex. am uitat să apăs TERMINĂ PAUZA"></label>` : ''}
    <p class="small" id="se-err" style="color:var(--bad)" role="alert"></p>`;

  return openDialog({
    title: orig ? 'Corectează ziua de lucru' : 'Adaugă zi de lucru manual',
    body, wide: true,
    onMount: (api) => {
      const draw = (k) => { api.el.querySelector(`#se-${k}`).innerHTML = items[k].map((it, i) => rowHtml(k, app, it, i)).join('') || `<p class="tiny muted">Niciun interval.</p>`; };
      const collect = (k) => [...api.el.querySelectorAll(`[data-row="${k}"]`)].map((row) => {
        const g = (x) => row.querySelector(`[data-k="${x}"]`)?.value || '';
        const prev = items[k].find((i) => i.id === row.dataset.id) || {};
        return { ...prev, id: row.dataset.id || uid(k === 'brk' ? 'brk' : 'seg'), start: toIso(fromDT(app, g('sd'), g('st'))), end: toIso(fromDT(app, g('ed') || g('sd'), g('et'))), note: g('note'), ...(k === 'seg' ? { activityId: g('activityId') || null } : {}) };
      });
      draw('brk'); draw('seg');
      api.el.addEventListener('click', (ev) => {
        const add = ev.target.closest('[data-add]');
        if (add) {
          const k = add.dataset.add; items[k] = collect(k);
          const sd = api.el.querySelector('#se-sd').value;
          items[k].push({ id: uid(k === 'brk' ? 'brk' : 'seg'), start: null, end: null, _d: sd });
          draw(k);
          const rows = api.el.querySelectorAll(`[data-row="${k}"]`); const last = rows[rows.length - 1];
          last.querySelector('[data-k="sd"]').value = sd; last.querySelector('[data-k="ed"]').value = sd;
        }
        const rm = ev.target.closest('[data-rm]');
        if (rm) { const row = rm.closest('[data-row]'); const k = row.dataset.row; items[k] = collect(k).filter((x) => x.id !== row.dataset.id); draw(k); }
      });
      api.collect = collect;
    },
    actions: [
      { label: 'Renunță', value: null },
      ...(orig ? [{ label: `${icon('trash')} Șterge ziua`, cls: 'btn-danger', onClick: async () => {
        const r = await confirmDialog('Ziua va fi marcată ca ștearsă. O poți restaura din „Istoric modificări”.', { danger: true, okLabel: 'Șterge', reason: true, reasonRequired: true });
        if (!r) return false;
        app.store.remove(orig.id, r.reason); toast('Zi ștearsă (recuperabilă din istoric).', { undo: () => { app.store.restore(orig.id); app.refresh(); } }); app.refresh();
        return true;
      } }] : []),
      { label: 'Salvează', cls: 'btn-primary', onClick: async (api) => {
        const q = (x) => api.el.querySelector(x);
        const err = (m) => { q('#se-err').textContent = m; return false; };
        const start = fromDT(app, q('#se-sd').value, q('#se-st').value);
        const end = q('#se-et').value ? fromDT(app, q('#se-ed').value || q('#se-sd').value, q('#se-et').value) : null;
        if (!start) return err('Completează data și ora de început.');
        if (end != null && end <= start) return err('Sfârșitul trebuie să fie după început. Pentru tură peste miezul nopții, alege data zilei următoare la „Sfârșit – data”.');
        if (end != null && end - start > 36 * 3600000) return err('Intervalul depășește 36 de ore. Verifică datele.');
        const breaks = api.collect('brk'), segments = api.collect('seg');
        for (const b of [...breaks, ...segments]) {
          if (!b.start) return err('Fiecare pauză/activitate are nevoie de dată și oră de început.');
          const bs = toMs(b.start), be = toMs(b.end);
          if (be != null && be <= bs) return err('O pauză sau activitate se termină înainte să înceapă.');
          if (bs < start || (end != null && be != null && be > end) || (end != null && bs >= end)) return err('O pauză sau activitate este în afara intervalului zilei.');
          if (be == null && end != null) b.end = toIso(end);
        }
        const openBreaks = breaks.filter((b) => !b.end); if (openBreaks.length > 1) return err('Poate exista cel mult o pauză deschisă.');
        const contractId = q('#se-contract').value; const c = app.store.get(contractId);
        const cand = { ...(orig || {}), id: orig?.id, start: toIso(start), end: toIso(end), breaks, segments };
        const warnings = [];
        const ov = shiftOverlaps(app.state(), cand);
        if (ov.length) warnings.push(`se suprapune cu altă zi de lucru (${ov.map((x) => fmtTime(app, x.start)).join(', ')})`);
        if (segmentOverlaps(segments).length) warnings.push('are activități care se suprapun (timpul nu va fi dublat)');
        if (!end && app.openShift() && app.openShift().id !== orig?.id) return err('Există deja o zi în desfășurare. Completează ora de sfârșit.');
        if (warnings.length) {
          const ok = await confirmDialog(`Atenție: ziua ${warnings.join(' și ')}. Salvezi oricum?`, { okLabel: 'Salvează oricum' });
          if (!ok) return false;
        }
        const reason = q('#se-reason')?.value.trim() || '';
        if (isClosed && !reason) return err('Scrie motivul modificării – rămâne în istoric.');
        const date = localDate(start, app.tz);
        const patch = {
          ...(orig ? { id: orig.id } : {}), employerId: c.employerId, contractId, date, start: toIso(start), end: toIso(end), breaks, segments,
          notes: q('#se-notes').value, otOverride: q('#se-ot').value, otEligibleMin: q('#se-otmin').value === '' ? null : Number(q('#se-otmin').value),
          otOverrideNote: q('#se-otnote').value, holidayCompMin: q('#se-hcomp').value === '' ? null : Number(q('#se-hcomp').value),
          settlement: { day: q('#se-s-day').value, ot: q('#se-s-ot').value, holiday: q('#se-s-hol').value },
        };
        if (end != null && !(orig?.frozen)) patch.frozen = freezeRules(app.state(), { ...patch }, date);
        if (orig && orig.contractId !== contractId && end != null) patch.frozen = freezeRules(app.state(), { ...patch }, date);
        app.store.put('shift', patch, { reason: reason || (orig ? 'Corectare manuală' : 'Adăugare manuală'), action: orig ? 'corectare' : 'adăugare manuală', undoLabel: 'Salvare zi' });
        toast(orig ? 'Zi corectată. Valorile vechi sunt în istoric.' : 'Zi adăugată.', { undo: () => { app.store.undo(); app.refresh(); } });
        app.refresh();
        return true;
      } },
    ],
  });
}
const fmtTime = (app, iso) => `${localDate(toMs(iso), app.tz)} ${localTime(toMs(iso), app.tz)}`;

/** Recalcularea unei zile încheiate cu regulile actuale (cu confirmare; valorile vechi rămân în istoric). */
export async function recalcShift(app, shiftId) {
  const sh = app.store.get(shiftId); if (!sh) return;
  const r = await confirmDialog('Ziua va fi recalculată cu tarifele, regulile și normele valabile ACUM pentru data ei. Regulile vechi rămân salvate în istoric și pot fi restaurate.', { okLabel: 'Recalculează', reason: true, reasonRequired: true, reasonLabel: 'Motivul recalculării' });
  if (!r) return;
  app.store.put('shift', { id: sh.id, frozen: freezeRules(app.state(), sh, sh.date || localDate(toMs(sh.start), app.tz)) }, { action: 'recalculare retroactivă', reason: r.reason });
  toast('Zi recalculată.'); app.refresh();
}

// ---------- Producție ----------
export function unitOptions(app, current) {
  const custom = app.settings().customUnits || [];
  const all = [...new Set([...UNITS, ...custom, ...(current ? [current] : [])])];
  return [...all.map((u) => [u, u]), ['__new', '+ Unitate nouă…']];
}

export async function editProduction(app, prodId, { date, shiftId } = {}) {
  const orig = prodId ? app.store.get(prodId) : null;
  const open = app.openShift();
  const contract = orig ? app.store.get(orig.contractId) : (open ? app.store.get(open.contractId) : app.activeContract());
  if (!contract) { toast('Configurează mai întâi un angajator și un contract.', { bad: true }); return; }
  const now = Date.now();
  const curSeg = open && (open.segments || []).find((g) => !g.deleted && !g.end);
  const norms = app.store.list('norm').filter((n) => n.employerId === contract.employerId);
  const defUnit = orig?.unit || app.settings().lastUnit || norms[0]?.unit || 'm³';
  const tm = orig?.time ? toMs(orig.time) : (date && date !== app.today() ? null : now);
  const fields = [
    { name: 'qty', label: 'Cantitatea', type: 'number', step: 'any', required: true, value: orig?.qty ?? '' },
    { name: 'unit', label: 'Unitatea de măsură', type: 'select', options: unitOptions(app, defUnit), value: defUnit },
    { name: 'newUnit', label: 'Numele unității noi', show: (v) => v.unit === '__new' },
    { name: 'date', label: 'Data', type: 'date', required: true, value: orig?.date || date || app.today() },
    { name: 'hasTime', label: 'Știu ora exactă', type: 'checkbox', value: tm != null },
    { name: 'time', label: 'Ora', type: 'time', value: tm != null ? localTime(tm, app.tz) : '', show: (v) => v.hasTime },
    { name: 'activityId', label: 'Activitatea', type: 'select', options: options(app.activities(), 'name', { empty: '—' }), value: orig?.activityId ?? curSeg?.activityId ?? '' },
    { name: 'contractId', label: 'Contract / angajator', type: 'select', options: app.contracts().map((c) => [c.id, `${app.name(c.employerId)} — ${c.name}`]), value: contract.id },
    { name: 'locationId', label: 'Locația', type: 'select', options: options(app.store.list('location'), 'name', { empty: '—' }), value: orig?.locationId || '' },
    { name: 'note', label: 'Observații', type: 'textarea', value: orig?.note || '', full: true },
    ...(app.platform.assets ? [{ name: 'files', label: 'Fotografii / documente justificative (opțional)', type: 'file', accept: 'image/*,application/pdf', multiple: true, full: true,
      help: orig?.attachments?.length ? `${orig.attachments.length} atașament(e) existente.` : '' }] : []),
    ...(orig ? [{ name: 'reason', label: 'Motivul modificării', full: true }] : []),
  ];
  const vals = await formDialog({
    title: orig ? 'Corectează producția' : 'Adaugă producție',
    fields,
    validate: async (v) => {
      if (!(v.qty > 0)) return 'Cantitatea trebuie să fie mai mare decât zero.';
      if (v.unit === '__new' && !v.newUnit) return 'Scrie numele unității noi.';
      if (v.hasTime && !v.time) return 'Completează ora sau debifează „Știu ora exactă”.';
      if (!orig) {
        const t = v.hasTime ? zonedToUtc(v.date, v.time, app.tz) : null;
        const dup = app.store.list('production').find((p) => p.date === v.date && Number(p.qty) === v.qty && p.unit === (v.unit === '__new' ? v.newUnit : v.unit) &&
          (t == null || p.time == null || Math.abs(toMs(p.time) - t) < 5 * 60000));
        if (dup) { const ok = await confirmDialog('Există deja o înregistrare identică (aceeași zi, cantitate și unitate). Adaugi încă una?', { okLabel: 'Da, este alta' }); if (!ok) return 'Neadăugat – posibil duplicat.'; }
      }
      return null;
    },
  });
  if (!vals) return;
  const unit = vals.unit === '__new' ? vals.newUnit : vals.unit;
  if (vals.unit === '__new') app.saveSettings({ customUnits: [...new Set([...(app.settings().customUnits || []), unit])] });
  const c = app.store.get(vals.contractId);
  let attachments = orig?.attachments || [];
  if (vals.files?.length && app.platform.assets) {
    for (const f of vals.files) {
      try { const a = await app.platform.assets.upload(f); attachments = [...attachments, { id: a.id, url: a.url, name: f.name, type: f.type }]; }
      catch (e) { toast(`Fișierul ${f.name} nu a putut fi încărcat (${e?.code || 'eroare'}).`, { bad: true }); }
    }
  }
  const time = vals.hasTime ? toIso(zonedToUtc(vals.date, vals.time, app.tz)) : null;
  const sh = shiftId || (open && open.contractId === c.id && localDate(toMs(open.start), app.tz) === vals.date ? open.id : null);
  app.store.put('production', {
    ...(orig ? { id: orig.id } : {}), qty: round2(vals.qty), unit, date: vals.date, time, activityId: vals.activityId || null,
    employerId: c.employerId, contractId: c.id, locationId: vals.locationId || null, note: vals.note, attachments, shiftId: orig?.shiftId ?? sh ?? null,
    geo: orig?.geo ?? null,
  }, { reason: vals.reason || '', action: orig ? 'corectare producție' : 'ADAUGĂ PRODUCȚIE', undoLabel: 'Producție' });
  app.saveSettings({ lastUnit: unit });
  toast(orig ? 'Producție corectată.' : `Producție înregistrată: ${vals.qty} ${unit}.`, { undo: () => { app.store.undo(); app.refresh(); } });
  app.refresh();
}

// ---------- Plăți ----------
export async function editPayment(app, id, pre = {}) {
  const orig = id ? app.store.get(id) : null;
  const emps = app.employers();
  if (!emps.length) { toast('Adaugă mai întâi un angajator.', { bad: true }); return; }
  const today = app.today();
  const vals = await formDialog({
    title: orig ? 'Corectează plata' : 'Înregistrează o plată primită',
    fields: [
      { name: 'employerId', label: 'Angajatorul', type: 'select', options: options(emps), value: orig?.employerId || app.activeContract()?.employerId },
      { name: 'date', label: 'Data plății', type: 'date', required: true, value: orig?.date || today },
      { name: 'amount', label: 'Suma primită', type: 'number', step: '0.01', required: true, value: orig?.amount ?? '' },
      { name: 'currency', label: 'Moneda', type: 'select', options: CURRENCIES.map((c) => [c, c]), value: orig?.currency || app.cur },
      { name: 'basis', label: 'Suma este', type: 'select', options: [['net', 'Netă (în mână / în cont)'], ['brut', 'Brută'], ['necunoscut', 'Nu știu']], value: orig?.basis || 'net' },
      { name: 'periodFrom', label: 'Perioada plătită – de la', type: 'date', value: orig?.periodFrom || pre.periodFrom || today.slice(0, 7) + '-01' },
      { name: 'periodTo', label: 'Perioada plătită – până la', type: 'date', value: orig?.periodTo || pre.periodTo || today },
      { name: 'hours', label: 'Ore normale achitate', type: 'number', step: '0.01', value: orig?.hours ?? pre.hours ?? '' },
      { name: 'otHours', label: 'Ore extra achitate', type: 'number', step: '0.01', value: orig?.otHours ?? pre.otHours ?? '' },
      { name: 'holidayHours', label: 'Ore de sărbătoare achitate', type: 'number', step: '0.01', value: orig?.holidayHours ?? '' },
      { name: 'bonuses', label: 'Bonusuri achitate (sumă)', type: 'number', step: '0.01', value: orig?.bonuses ?? '' },
      { name: 'activities', label: 'Activitățile achitate', type: 'checks', options: options(app.activities()), value: orig?.activities || [], full: true },
      { name: 'reference', label: 'Referință (nr. fluturaș / tranzacție)', value: orig?.reference || '', help: 'Ajută la detectarea plăților înregistrate de două ori.' },
      { name: 'note', label: 'Observații', type: 'textarea', value: orig?.note || '', full: true },
      ...(app.platform.assets ? [{ name: 'files', label: 'Document justificativ (opțional)', type: 'file', accept: 'image/*,application/pdf', full: true }] : []),
      { name: 'markPaid', label: 'Marchează zilele din perioadă ca „Plătit” (orele normale)', type: 'checkbox', value: !orig, full: true },
      ...(orig ? [{ name: 'reason', label: 'Motivul modificării', full: true }] : []),
    ],
    validate: async (v) => {
      if (!(v.amount > 0)) return 'Suma trebuie să fie mai mare decât zero.';
      if (v.periodFrom && v.periodTo && v.periodTo < v.periodFrom) return 'Perioada este inversată.';
      const dup = findDuplicatePayment(app.store.list('payment'), { ...v, id: orig?.id });
      if (dup) {
        const ok = await confirmDialog(`Pare să existe deja această plată: ${esc(dup.date)}, ${dup.amount} ${esc(dup.currency || '')}. Este o plată diferită?`, { title: 'Posibil duplicat', okLabel: 'Da, e o altă plată' });
        if (!ok) return 'Plata nu a fost salvată (duplicat).';
      }
      return null;
    },
  });
  if (!vals) return;
  let attachments = orig?.attachments || [];
  if (vals.files?.length && app.platform.assets) for (const f of vals.files) {
    try { const a = await app.platform.assets.upload(f); attachments = [...attachments, { id: a.id, url: a.url, name: f.name, type: f.type }]; } catch (e) { toast(`Fișierul nu a putut fi încărcat (${e?.code || 'eroare'}).`, { bad: true }); }
  }
  const { files, markPaid, reason, ...rest } = vals;
  const p = app.store.put('payment', { ...(orig ? { id: orig.id } : {}), ...rest, attachments }, { reason: reason || '', action: orig ? 'corectare plată' : 'plată înregistrată', undoLabel: 'Plată' });
  if (markPaid && vals.periodFrom && vals.periodTo) {
    for (const sh of app.store.list('shift')) {
      if (sh.employerId !== vals.employerId || !sh.end) continue;
      const d = sh.date || localDate(toMs(sh.start), app.tz);
      if (d < vals.periodFrom || d > vals.periodTo) continue;
      app.store.put('shift', { id: sh.id, settlement: { ...(sh.settlement || {}), day: 'platit', dayPaymentId: p.id } }, { reason: `Plată din ${vals.date}`, action: 'statut plată', undoable: false });
    }
  }
  toast('Plată salvată.'); app.refresh();
}

export async function editConfirmation(app, id) {
  const orig = id ? app.store.get(id) : null;
  const today = app.today();
  const vals = await formDialog({
    title: orig ? 'Corectează confirmarea' : 'Sumă confirmată de angajator',
    intro: '<p class="small muted">Ce a confirmat angajatorul că îți datorează (fluturaș, mesaj, decont), înainte de plată.</p>',
    fields: [
      { name: 'employerId', label: 'Angajatorul', type: 'select', options: options(app.employers()), value: orig?.employerId || app.activeContract()?.employerId },
      { name: 'date', label: 'Data confirmării', type: 'date', value: orig?.date || today, required: true },
      { name: 'amount', label: 'Suma confirmată', type: 'number', step: '0.01', required: true, value: orig?.amount ?? '' },
      { name: 'currency', label: 'Moneda', type: 'select', options: CURRENCIES.map((c) => [c, c]), value: orig?.currency || app.cur },
      { name: 'periodFrom', label: 'Perioada – de la', type: 'date', value: orig?.periodFrom || today.slice(0, 7) + '-01' },
      { name: 'periodTo', label: 'Perioada – până la', type: 'date', value: orig?.periodTo || today },
      { name: 'hours', label: 'Ore confirmate', type: 'number', step: '0.01', value: orig?.hours ?? '' },
      { name: 'otHours', label: 'Ore suplimentare confirmate', type: 'number', step: '0.01', value: orig?.otHours ?? '' },
      { name: 'note', label: 'Observații', type: 'textarea', value: orig?.note || '', full: true },
    ],
  });
  if (!vals) return;
  app.store.put('confirmation', { ...(orig ? { id: orig.id } : {}), ...vals }, { action: orig ? 'corectare confirmare' : 'confirmare angajator' });
  toast('Confirmare salvată.'); app.refresh();
}

export function shiftSummaryLine(app, c) {
  return `${fmtDur(c.t.effMin)} efectiv · ${fmtDur(c.t.breakMin)} pauză`;
}
export { shiftTimes };

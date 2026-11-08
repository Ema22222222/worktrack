// Pontaj lunar: toate zilele lunii într-o listă. Programul standard se pune dintr-o atingere,
// pe o zi sau pe mai multe zile deodată. Orele peste normă apar direct ca ore extra.
import { esc, icon, openDialog, toast, confirmDialog, emptyState } from '../ui.js';
import { fmtDate, dateRange, monthEnd, dowOf, dayName, monthName, pad, zonedToUtc, toIso, toMs, localTime, localDate, addDays, fmtMoney, uid } from '../util.js';
import { totalsFor, shiftOverlaps, holidayFor, otBank } from '../calc.js';
import { freezeRules } from '../actions.js';
import { editShift, standardFor, editStandard, setupWizard, hmToMin, editPayment } from '../editors.js';
import { ABSENCE_TYPES, editOtPay, dayOffFromOt } from './leave.js';
import { defaultPlace, bindPlaceChips } from '../places.js';
import { exportHoja } from '../hoja.js';

let selecting = false;
let selected = new Set();
let selMonth = '';
let bulkPlace;

/** Durată compactă: 11h, 10h 30m, 0h */
export function fmtHM(min) {
  if (min == null) return '—';
  const neg = min < 0; let m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60); m %= 60;
  return `${neg ? '−' : ''}${h}h${m ? ` ${pad(m)}m` : ''}`;
}

/** Construiește intervalele unei zile din ore „HH:MM” (sfârșitul poate trece de miezul nopții). */
export function buildDay(app, date, { start, end, breakStart, breakEnd }) {
  const s = zonedToUtc(date, start, app.tz);
  let e = zonedToUtc(date, end, app.tz);
  if (e <= s) e = zonedToUtc(addDays(date, 1), end, app.tz);
  if (e - s > 24 * 3600000) return { error: 'Ziua depășește 24 de ore.' };
  const breaks = [];
  if (breakStart && breakEnd) {
    let bs = zonedToUtc(date, breakStart, app.tz);
    if (bs < s) bs = zonedToUtc(addDays(date, 1), breakStart, app.tz);
    let be = zonedToUtc(localDate(bs, app.tz), breakEnd, app.tz);
    if (be <= bs) be = zonedToUtc(addDays(localDate(bs, app.tz), 1), breakEnd, app.tz);
    if (bs < s || be > e) return { error: 'Pauza trebuie să fie între începutul și sfârșitul zilei.' };
    breaks.push({ start: toIso(bs), end: toIso(be) });
  }
  return { start: s, end: e, breaks, effMin: (e - s - breaks.reduce((t, b) => t + (toMs(b.end) - toMs(b.start)), 0)) / 60000 };
}

/** Adaugă programul standard pe zilele date (sare peste zilele care au deja ceva). */
export function applyStandard(app, dates, { activityId = null, locationId = null } = {}) {
  const contract = app.activeContract();
  const std = standardFor(app, contract);
  const ids = [];
  for (const d of dates) {
    const b = buildDay(app, d, std);
    if (b.error) continue;
    const shift = { employerId: contract.employerId, contractId: contract.id, date: d, start: toIso(b.start), end: toIso(b.end),
      breaks: b.breaks.map((x) => ({ id: uid('brk'), ...x })),
      segments: activityId ? [{ id: uid('seg'), activityId, start: toIso(b.start), end: toIso(b.end) }] : [],
      notes: '', settlement: {}, source: 'program standard', locationId: locationId || null };
    if (shiftOverlaps(app.state(), shift).length) continue;
    shift.frozen = freezeRules(app.state(), shift, d);
    ids.push(app.store.put('shift', shift, { reason: 'Program standard', action: 'completare program standard', undoable: false }).id);
  }
  return ids;
}

function dayData(app, R, d) {
  const shifts = (R.days.get(d) || []).slice().sort((a, b) => a.t.start - b.t.start);
  const abs = app.store.list('absence').filter((a) => a.from <= d && (a.to || a.from) >= d);
  const eff = shifts.reduce((t, c) => t + c.t.effMin, 0);
  const ot = shifts.reduce((t, c) => t + c.otMin, 0);
  const br = shifts.reduce((t, c) => t + c.t.breakMin, 0);
  const hol = shifts.flatMap((c) => c.slices).find((s) => s.holiday)?.holiday || app.state().holidays.find((h) => !h.deleted && h.date === d && h.status === 'confirmata' && h.scope === 'national' && h.country === app.activeContract()?.country);
  const acts = [...new Set(shifts.flatMap((c) => c.slices.map((s) => s.activityId)).filter(Boolean))].map((id) => app.name(id));
  return { shifts, abs, eff, ot, br, hol, acts, open: shifts.some((c) => c.t.open) };
}

export function render(root, app) {
  if (!app.employers().length) {
    root.innerHTML = `<div class="pagehead"><h1>Pontaj lunar</h1></div>${emptyState('Configurează mai întâi angajatorul și programul.', '<button class="btn-action" id="setup">Configurează</button>')}`;
    root.querySelector('#setup').onclick = () => setupWizard(app);
    return;
  }
  const today = app.today();
  const month = app.params.month || today.slice(0, 7);
  if (selMonth !== month) { selecting = false; selected = new Set(); selMonth = month; }
  const from = month + '-01', to = monthEnd(from);
  const R = app.calc();
  const contract = app.activeContract();
  const std = standardFor(app, contract);
  const T = totalsFor(R, from, to);
  const days = dateRange(from, to);
  const data = Object.fromEntries(days.map((d) => [d, dayData(app, R, d)]));
  const worked = days.filter((d) => data[d].eff > 0).length;
  const [y, m] = month.split('-').map(Number);
  const shiftM = (k) => { const t = new Date(Date.UTC(y, m - 1 + k, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; };
  const selectable = (d) => d <= today && !data[d].shifts.length && !data[d].abs.length;
  if (selecting && !selected.size && !root._preselected) {
    for (const d of days) if (selectable(d) && std.workDays.includes(dowOf(d)) && !data[d].hol) selected.add(d);
    root._preselected = true;
  }
  if (!selecting) root._preselected = false;
  const cur = app.currencyFor(contract?.employerId);
  const bank = otBank(app.state(), R);
  const hasMoney = T.money.total > 0;

  const rowHtml = (d) => {
    const x = data[d]; const dow = dowOf(d);
    const cls = ['mrow', dow >= 6 ? 'we' : '', dow === 1 && d !== from ? 'wkstart' : '', d === today ? 'today' : '', d > today ? 'fut' : '', selected.has(d) ? 'sel' : ''].join(' ');
    let main, sub = '', hours = '';
    if (x.shifts.length) {
      const s0 = x.shifts[0].t.start, e1 = x.shifts[x.shifts.length - 1].t.end;
      main = x.shifts.some((c) => c.shift.hoursOnly) ? 'Doar total ore (fără ore exacte)' : `${localTime(s0, app.tz)} – ${x.open ? 'în lucru' : localTime(e1, app.tz)}`;
      sub = [x.shifts[0].location?.name, x.br ? `pauză ${fmtHM(x.br)}` : 'fără pauză', x.hol ? `Sărbătoare: ${x.hol.name}` : '', ...x.acts].filter(Boolean).join(' · ');
      hours = `<b>${fmtHM(x.eff)}</b>${x.ot > 0 ? `<em class="extra">+${fmtHM(x.ot)} extra</em>` : ''}`;
    } else if (x.abs.length) {
      const a0 = x.abs[0];
      main = esc(ABSENCE_TYPES[a0.type] || 'Liber'); sub = a0.note || '';
      if ((a0.type === 'recuperare' || a0.type === 'compensatoriu') && a0.minutes) {
        const unc = bank.uncovered[a0.id];
        hours = `<b>−${fmtHM(a0.minutes)}</b>${unc ? `<em class="extra" style="background:var(--bad-soft);color:var(--bad)">neacoperită ${fmtHM(unc)}</em>` : '<em class="extra" style="background:var(--ok-soft);color:var(--ok)">din ore extra</em>'}`;
      }
    } else if (x.hol) {
      main = `<span style="color:var(--holiday)">${esc(x.hol.name)}</span>`; sub = 'Sărbătoare legală';
    } else main = `<span class="t none">${d > today ? '' : dow >= 6 || !std.workDays.includes(dow) ? 'Liber' : 'Necompletat'}</span>`;
    const dis = selecting && !selectable(d);
    return `<button class="${cls}" data-d="${d}" ${dis ? 'disabled' : ''} aria-label="${esc(fmtDate(d, { long: true }))}">
      <span class="chk-ind">${icon('check')}</span>
      <span class="mdate"><b>${+d.slice(8)}</b><small>${dayName(dow).slice(0, 3)}</small></span>
      <span class="mmain"><span class="t">${main}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <span class="mhours">${hours}</span></button>`;
  };

  root.innerHTML = `
  <div class="mhead">
    <div class="mswitch"><button class="iconbtn" data-m="-1" aria-label="Luna anterioară">${icon('chevl')}</button><h1>${monthName(m)} ${y}</h1><button class="iconbtn" data-m="1" aria-label="Luna următoare">${icon('chev')}</button></div>
    <div class="msum">
      <div><span>Zile lucrate</span><b>${worked}</b></div>
      <div><span>Ore lucrate</span><b>${fmtHM(T.effMin)}</b></div>
      <div><span>Ore normale</span><b>${fmtHM(T.effMin - T.otMin)}</b></div>
      <div class="x"><span>Ore extra</span><b>${fmtHM(T.otMin)}</b></div>
    </div>
    ${T.holidayMin || hasMoney ? `<div class="row small muted">${T.holidayMin ? `<span>Lucrat de sărbătoare: <b>${fmtHM(T.holidayMin)}</b></span>` : ''}${hasMoney ? `<span>· Câștig estimat: <b>${fmtMoney(T.money.total, cur)}</b></span>` : ''}</div>` : ''}
    ${!selecting ? `<a class="stdbar" href="#compensatorii" style="text-decoration:none;color:inherit"><span>Sold ore extra (toate lunile): <b style="color:${bank.balance < 0 ? 'var(--bad)' : 'var(--action-ink)'}">${fmtHM(bank.balance)}</b></span><span class="small">Vezi soldul ${icon('chev')}</span></a>` : ''}
    ${worked && !selecting ? payCard(app, month, days, data, T, bank) : ''}
    <div class="stdbar"><span>Programul tău: <b>${std.start}–${std.end}</b>${std.breakMin ? `, pauză <b>${std.breakStart}–${std.breakEnd}</b>` : ''} · normă <b>${fmtHM(std.normMin)}</b> → zi standard = <b>${fmtHM(buildDay(app, from, std).effMin || 0)}</b></span><button class="btn-sm btn-ghost" id="std">${icon('edit')} Modifică</button></div>
    ${selecting ? '' : `<div class="row"><button class="btn-action" id="fill">${icon('check')} Completează zilele cu programul standard</button></div>`}
    ${selecting || !worked ? '' : `<div class="row"><button class="btn-primary" id="hoja">${icon('dl')} PDF pentru birou (în spaniolă)</button><button class="btn-sm" id="hojax">${icon('dl')} Excel</button></div>`}
  </div>
  <div class="mlist${selecting ? ' selecting' : ''}">${days.map(rowHtml).join('')}</div>
  ${selecting ? `<div class="bulkbar" role="region" aria-label="Completare zile">
    <div><b>${selected.size} zile selectate</b> <span class="small">· atinge zilele ca să le bifezi sau debifezi</span></div>
    <div id="bulk-place" class="onDark"></div>
    <div class="row"><button class="btn-action" id="apply" ${selected.size ? '' : 'disabled'}>Pune ${std.start}–${std.end} pe ${selected.size} zile</button>
      <button class="ghost2 btn-sm" id="none">Debifează tot</button><button class="btn-ghost btn-sm" id="cancel">Renunță</button></div></div>` : `<p class="tiny muted">Atinge o zi pentru a o completa sau corecta. Zilele deja completate nu sunt modificate de completarea automată.</p>`}`;

  root.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { app.params = { month: shiftM(+b.dataset.m) }; app.refresh(); }; });
  root.querySelector('#std').onclick = () => editStandard(app);
  root.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = () => { const [k, v] = b.dataset.pay.split(':'); setMonthPay(app, days, data, k, v); }; });
  root.querySelectorAll('[data-otpay]').forEach((b) => { b.onclick = async () => {
    const bm = bank.byMonth[month] || { earned: 0, paid: 0 };
    const mine = app.store.list('otpay').filter((p) => p.month === month);
    if (b.dataset.otpay === 'part') return editOtPay(app, null, { month, hours: Math.max(0, bm.earned - bm.paid) / 60 });
    if (b.dataset.otpay === 'all') {
      const rest = Math.max(0, bm.earned - bm.paid);
      if (rest > 0) app.store.put('otpay', { minutes: Math.round(rest), month, date: app.today(), note: 'Toate orele extra din lună' }, { action: 'ore extra plătite', undoLabel: 'Ore extra plătite' });
      setMonthPay(app, days, data, 'ot', 'platit');
      return;
    }
    if (mine.length) {
      const r = await confirmDialog(`Ștergi plățile de ore extra trecute pentru luna asta (${fmtHM(bm.paid)})? Orele revin în sold.`, { okLabel: 'Da, sunt neplătite' });
      if (!r) return;
      for (const p of mine) app.store.remove(p.id, 'Marcat neplătit');
    }
    setMonthPay(app, days, data, 'ot', 'asteptare');
  }; });
  root.querySelector('#addpay')?.addEventListener('click', () => editPayment(app, null, { periodFrom: from, periodTo: to, hours: Math.round((T.effMin - T.otMin) / 6) / 10, otHours: 0 }));
  root.querySelectorAll('[data-payid]').forEach((b) => { b.onclick = () => editPayment(app, b.dataset.payid); });
  root.querySelector('#hoja')?.addEventListener('click', (e) => { e.currentTarget.disabled = true; exportHoja(app, month, 'pdf').finally(() => { const b = root.querySelector('#hoja'); if (b) b.disabled = false; }); });
  root.querySelector('#hojax')?.addEventListener('click', () => exportHoja(app, month, 'xlsx'));
  root.querySelector('#fill')?.addEventListener('click', () => { selecting = true; selected = new Set(); root._preselected = false; app.refresh(); });
  root.querySelector('#cancel')?.addEventListener('click', () => { selecting = false; selected = new Set(); app.refresh(); });
  root.querySelector('#none')?.addEventListener('click', () => { selected = new Set(); root._preselected = true; app.refresh(); });
  root.querySelector('#apply')?.addEventListener('click', () => {
    const list = [...selected].sort();
    app._suppress = true;
    const ids = applyStandard(app, list, { locationId: bulkPlace || null });
    if (bulkPlace) app.saveSettings({ lastLocationId: bulkPlace });
    app._suppress = false;
    selecting = false; selected = new Set();
    toast(`${ids.length} zile completate cu ${std.start}–${std.end}.`, { undo: () => { app._suppress = true; for (const id of ids) app.store.remove(id, 'Anulare completare'); app._suppress = false; app.refresh(); } });
    app.refresh();
  });
  const bp = root.querySelector('#bulk-place');
  if (bp) { if (bulkPlace === undefined) bulkPlace = defaultPlace(app); bindPlaceChips(app, bp, bulkPlace, (id) => { bulkPlace = id; }); }
  root.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => {
    const d = b.dataset.d;
    if (selecting) { if (selected.has(d)) selected.delete(d); else selected.add(d); root._preselected = true; app.refresh(); return; }
    dayDialog(app, d);
  }; });
}

const PAID = ['platit', 'compensat'];
function payState(shifts, key, minOf) {
  const rel = shifts.filter((c) => minOf(c) > 0);
  if (!rel.length) return 'none';
  const paid = rel.filter((c) => PAID.includes(c.shift.settlement?.[key])).length;
  const unpaid = rel.filter((c) => c.shift.settlement?.[key] === 'asteptare').length;
  return paid === rel.length ? 'paid' : unpaid === rel.length ? 'unpaid' : paid ? 'partial' : 'unset';
}
function payCard(app, month, days, data, T, bank) {
  const shifts = days.flatMap((d) => data[d].shifts).filter((c) => !c.t.open);
  const normal = payState(shifts, 'day', (c) => c.t.effMin - c.otMin);
  const bm = bank.byMonth[month] || { earned: 0, paid: 0 };
  const unpaidOt = Math.max(0, bm.earned - bm.paid);
  const extra = !bm.earned ? 'none' : bm.paid >= bm.earned - 0.5 ? 'paid' : bm.paid > 0 ? 'partial' : 'unpaid';
  const from = month + '-01', to = monthEnd(from);
  const pays = app.store.list('payment').filter((p) => (p.periodTo || p.date) >= from && (p.periodFrom || p.date) <= to);
  const lbl = { paid: ['Plătite', 'ok'], unpaid: ['Neplătite', 'bad'], partial: ['Parțial', 'warn'], unset: ['Nemarcat', ''], none: ['—', ''] };
  const row = (key, title, min, stt) => `<div class="payrow"><div class="grow"><span class="label">${title}</span><b>${fmtHM(min)}</b> <span class="pill ${lbl[stt][1]}">${lbl[stt][0]}</span></div>
    ${stt === 'none' ? '' : `<div class="seg"><button data-pay="${key}:platit" class="${stt === 'paid' ? 'on' : ''}">Plătite</button><button data-pay="${key}:asteptare" class="${stt === 'unpaid' ? 'on' : ''}">Neplătite</button></div>`}</div>`;
  return `<section class="panel paycard" aria-label="Plata lunii"><header><h2>Plata lunii</h2><button class="btn-sm" id="addpay">${icon('plus')} Sumă primită</button></header>
    ${row('day', 'Ore normale', T.effMin - T.otMin, normal)}
    <div class="payrow"><div class="grow"><span class="label">Ore extra</span><b>${fmtHM(bm.earned)}</b> <span class="pill ${lbl[extra][1]}">${extra === 'partial' ? `Plătite ${fmtHM(bm.paid)}` : lbl[extra][0]}</span></div>
      ${extra === 'none' ? '' : `<div class="seg"><button data-otpay="all" class="${extra === 'paid' ? 'on' : ''}" style="${extra === 'paid' ? 'background:var(--ok);color:var(--surface)' : ''}">Plătite</button><button data-otpay="part">Parțial…</button><button data-otpay="none" class="${extra === 'unpaid' ? 'on' : ''}" style="${extra === 'unpaid' ? 'background:var(--bad);color:var(--surface)' : ''}">Neplătite</button></div>`}</div>
    ${unpaidOt > 0 ? `<p class="note small" style="background:var(--action-soft);border:0;color:var(--action-ink)"><b>${fmtHM(unpaidOt)} ore extra neplătite</b> în această lună – rămân în soldul de ore extra.</p>` : ''}
    ${pays.length ? `<div class="list">${pays.map((p) => `<div class="item click" data-payid="${p.id}"><div class="grow"><b>${fmtMoney(Number(p.amount), p.currency || app.cur)}</b> <span class="small muted">primit ${fmtDate(p.date)}${p.otHours ? ` · ${p.otHours} h extra incluse` : ' · fără ore extra'}${p.note ? ' · ' + esc(p.note) : ''}</span></div>${icon('edit')}</div>`).join('')}</div>` : ''}
  </section>`;
}
function setMonthPay(app, days, data, key, status) {
  const shifts = days.flatMap((d) => data[d].shifts).filter((c) => !c.t.open && (key === 'ot' ? c.otMin > 0 : c.t.effMin - c.otMin > 0));
  app._suppress = true;
  for (const c of shifts) app.store.put('shift', { id: c.id, settlement: { ...(c.shift.settlement || {}), [key]: status } }, { action: 'statut plată', reason: `${key === 'ot' ? 'Ore extra' : 'Ore normale'}: ${status === 'platit' ? 'plătite' : 'neplătite'} (toată luna)`, undoable: false });
  app._suppress = false;
  toast(`${key === 'ot' ? 'Ore extra' : 'Ore normale'}: ${status === 'platit' ? 'plătite' : 'neplătite'} pentru toată luna.`);
  app.refresh();
}

/** Foaia rapidă a unei zile: ore de început/sfârșit/pauză, cu calcul imediat. */
export async function dayDialog(app, date) {
  const R = app.calc();
  const x = dayData(app, R, date);
  const contract = x.shifts[0] ? app.store.get(x.shifts[0].contractId) : app.activeContract();
  const std = standardFor(app, contract);
  const sh = x.shifts[0]?.shift;
  const complex = x.shifts.length > 1 || (sh && ((sh.breaks || []).filter((b) => !b.deleted).length > 1 || (sh.segments || []).filter((g) => !g.deleted).length > 1));
  const title = fmtDate(date, { long: true });
  if (x.open || complex) {
    return openDialog({
      title,
      body: `<p>${x.open ? 'Ziua este în desfășurare (pornită din butonul START).' : 'Ziua are mai multe pauze sau activități.'} Lucrat: <b>${fmtHM(x.eff)}</b>${x.ot ? `, din care <b style="color:var(--action-ink)">${fmtHM(x.ot)} extra</b>` : ''}.</p>`,
      actions: [{ label: 'Închide' }, ...x.shifts.map((c, i) => ({ label: `Corectează${x.shifts.length > 1 ? ` tura ${i + 1}` : ''} în detaliu`, cls: 'btn-primary', onClick: () => { setTimeout(() => editShift(app, c.id), 0); return true; } }))],
    });
  }
  const segAct = sh ? (sh.segments || []).find((g) => !g.deleted)?.activityId || '' : '';
  const brk = sh ? (sh.breaks || []).find((b) => !b.deleted) : null;
  const v0 = sh ? { start: localTime(toMs(sh.start), app.tz), end: localTime(toMs(sh.end), app.tz), breakStart: brk ? localTime(toMs(brk.start), app.tz) : '', breakEnd: brk?.end ? localTime(toMs(brk.end), app.tz) : '' }
    : { start: std.start, end: std.end, breakStart: std.breakMin ? std.breakStart : '', breakEnd: std.breakEnd };
  const acts = app.activities();
  let place = sh ? (sh.locationId || sh.startLoc?.locationId || null) : defaultPlace(app);
  const sched = std.policy?.schedule || {};
  const ctxFor = (pid) => { const l = pid && app.store.get(pid); return l && l.country ? { ...(contract || {}), country: l.country, region: l.region || '', locality: l.locality || '' } : contract; };
  const fiestaNow = () => holidayFor(app.state(), ctxFor(place), date);
  const normNow = () => {
    const h = fiestaNow();
    if (h && h.status === 'confirmata' && sched.holidayAllOvertime) return 0;
    if (!std.workDays.includes(dowOf(date)) && sched.offDayAllOvertime) return 0;
    return std.normMin;
  };
  const fiestaHtml = () => { const h = fiestaNow();
    return `<button type="button" class="pchip${h ? ' on' : ''}" id="dd-fiesta" aria-pressed="${!!h}">${icon('star')}<span>${h ? esc(h.name) : 'Fiesta / sărbătoare'}<small>${h ? (sched.holidayAllOvertime ? 'toate orele sunt extra · atinge ca să anulezi' : 'zi de sărbătoare · atinge ca să anulezi') : 'atinge dacă azi a fost fiesta'}</small></span></button>`; };
  const body = `
    <div class="f"><span class="label">Zi de sărbătoare?</span><div id="dd-fiesta-box">${fiestaHtml()}</div></div>
    ${x.abs.length ? `<p class="note info small">Marcat: <b>${esc(ABSENCE_TYPES[x.abs[0].type] || 'liber')}</b>. <button class="btn-sm" id="dd-unabs">Elimină</button></p>` : ''}
    ${sh ? '' : `<button class="btn-action" id="dd-std" style="width:100%;min-height:52px">${icon('check')} Program standard ${std.start}–${std.end}${std.breakMin ? `, pauză ${std.breakStart}–${std.breakEnd}` : ''}</button>`}
    <div class="tgrid">
      <label class="f">Început<input type="time" id="dd-s" value="${v0.start}"></label>
      <label class="f">Sfârșit<input type="time" id="dd-e" value="${v0.end}"></label>
      <label class="f">Pauza de la<input type="time" id="dd-bs" value="${v0.breakStart}"></label>
      <label class="f">Pauza până la<input type="time" id="dd-be" value="${v0.breakEnd}"></label>
    </div>
    <div class="daypreview" id="dd-prev"></div>
    <div class="f"><span class="label">Unde ai lucrat?</span><div id="dd-place"></div></div>
    ${acts.length ? `<label class="f">Activitate (opțional)<select id="dd-act"><option value="">—</option>${acts.map((a) => `<option value="${a.id}"${a.id === segAct ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
    <label class="f">Observații<input type="text" id="dd-note" value="${esc(sh?.notes || '')}"></label>
    ${sh ? '' : `<div class="row"><span class="small muted">Nu ai lucrat?</span><button class="btn-sm" id="dd-otoff">Liber din ore extra</button><button class="btn-sm" data-abs="liber">Zi liberă</button><button class="btn-sm" data-abs="concediu">Concediu</button><button class="btn-sm" data-abs="medical">Medical</button></div>`}
    <p class="small" id="dd-err" style="color:var(--bad)" role="alert"></p>`;
  const read = (el) => ({ start: el.querySelector('#dd-s').value, end: el.querySelector('#dd-e').value, breakStart: el.querySelector('#dd-bs').value, breakEnd: el.querySelector('#dd-be').value });
  const preview = (el) => {
    const v = read(el); const p = el.querySelector('#dd-prev');
    if (!v.start || !v.end) { p.innerHTML = ''; return; }
    const b = buildDay(app, date, v);
    if (b.error) { p.innerHTML = `<div style="grid-column:1/-1"><span class="small" style="color:var(--bad)">${esc(b.error)}</span></div>`; return; }
    const norm = normNow();
    p.innerHTML = `<div><span class="label">Lucrat</span><b>${fmtHM(b.effMin)}</b></div><div><span class="label">Normă</span><b>${fmtHM(norm)}</b></div><div class="x"><span class="label">Extra</span><b>${fmtHM(Math.max(0, b.effMin - norm))}</b></div>`;
  };
  return openDialog({
    title,
    body,
    onMount: (api) => {
      const el = api.el; preview(el);
      const drawFiesta = () => {
        el.querySelector('#dd-fiesta-box').innerHTML = fiestaHtml();
        el.querySelector('#dd-fiesta').onclick = async () => {
          const h = fiestaNow();
          if (h) {
            const r = await confirmDialog(`Anulezi sărbătoarea „${esc(h.name)}” din ${fmtDate(date)}?`, { okLabel: 'Anulează sărbătoarea' });
            if (!r) return;
            app.store.remove(h.id, 'Anulată din pontajul lunar');
          } else {
            const c = ctxFor(place) || {};
            const where = c.locality || c.region || '';
            app.store.put('holiday', { date, name: `Fiesta${where ? ' ' + where : ''}`, country: c.country || 'ES', scope: c.locality ? 'local' : c.region ? 'regional' : 'national',
              region: c.region || '', locality: c.locality || '', status: 'confirmata', source: 'Marcat de tine în pontaj' }, { reason: 'Marcat ca fiesta din pontajul lunar', undoable: false });
          }
          drawFiesta(); preview(el);
        };
      };
      drawFiesta();
      bindPlaceChips(app, el.querySelector('#dd-place'), place, (id) => { place = id; drawFiesta(); preview(el); });
      el.addEventListener('input', () => preview(el));
      el.querySelector('#dd-std')?.addEventListener('click', () => {
        el.querySelector('#dd-s').value = std.start; el.querySelector('#dd-e').value = std.end;
        el.querySelector('#dd-bs').value = std.breakMin ? std.breakStart : ''; el.querySelector('#dd-be').value = std.breakEnd;
        el.querySelector('footer .btn-primary').click();
      });
      el.querySelector('#dd-otoff')?.addEventListener('click', () => { api.close(null); setTimeout(() => dayOffFromOt(app, date), 0); });
      el.querySelector('#dd-unabs')?.addEventListener('click', () => { for (const a of x.abs) app.store.remove(a.id, 'Eliminat din pontajul lunar'); api.close(null); app.refresh(); });
      el.querySelectorAll('[data-abs]').forEach((b) => { b.onclick = () => {
        app.store.put('absence', { type: b.dataset.abs, from: date, to: date, employerId: contract?.employerId || null, note: '' }, { undoLabel: 'Zi liberă' });
        toast(`${fmtDate(date)}: ${ABSENCE_TYPES[b.dataset.abs]}.`, { undo: () => { app.store.undo(); app.refresh(); } });
        api.close(null); app.refresh();
      }; });
    },
    actions: [
      { label: 'Renunță', value: null },
      ...(sh ? [
        { label: 'Detalii', onClick: () => { setTimeout(() => editShift(app, sh.id), 0); return true; } },
        { label: `${icon('trash')} Șterge`, cls: 'btn-danger', onClick: async () => {
          const r = await confirmDialog('Ștergi ziua? O poți recupera din „Istoric modificări”.', { danger: true, okLabel: 'Șterge' });
          if (!r) return false;
          app.store.remove(sh.id, 'Șters din pontajul lunar');
          toast('Zi ștearsă.', { undo: () => { app.store.restore(sh.id); app.refresh(); } }); app.refresh(); return true;
        } }] : []),
      { label: 'Salvează', cls: 'btn-primary', onClick: (api) => {
        const el = api.el; const err = (msg) => { el.querySelector('#dd-err').textContent = msg; return false; };
        const v = read(el);
        if (!v.start || !v.end) return err('Completează ora de început și de sfârșit.');
        if (!!v.breakStart !== !!v.breakEnd) return err('Completează ambele ore ale pauzei sau lasă-le goale.');
        const b = buildDay(app, date, v);
        if (b.error) return err(b.error);
        const activityId = el.querySelector('#dd-act')?.value || null;
        const keepBrk = brk && v.breakStart ? brk.id : uid('brk');
        const segId = sh ? (sh.segments || []).find((g) => !g.deleted)?.id || uid('seg') : uid('seg');
        const patch = {
          ...(sh ? { id: sh.id } : { employerId: contract.employerId, contractId: contract.id, settlement: {} }),
          date, start: toIso(b.start), end: toIso(b.end),
          breaks: [...(sh ? (sh.breaks || []).filter((z) => z.deleted) : []), ...b.breaks.map((z) => ({ id: keepBrk, ...z }))],
          segments: [...(sh ? (sh.segments || []).filter((z) => z.deleted) : []), ...(activityId ? [{ id: segId, activityId, start: toIso(b.start), end: toIso(b.end) }] : [])],
          notes: el.querySelector('#dd-note').value, locationId: place || null, hoursOnly: false,
        };
        if (shiftOverlaps(app.state(), { ...patch, id: sh?.id }).length) return err('Se suprapune cu altă zi de lucru (ex. o tură de noapte din ziua anterioară).');
        if (!sh) patch.frozen = freezeRules(app.state(), patch, date);
        app.store.put('shift', patch, { reason: sh ? 'Corectare din pontajul lunar' : 'Adăugat din pontajul lunar', action: sh ? 'corectare' : 'adăugare', undoLabel: 'Zi' });
        for (const a of x.abs) app.store.remove(a.id, 'Înlocuit cu zi lucrată');
        if (place && place !== app.settings().lastLocationId) app.saveSettings({ lastLocationId: place });
        const nm = normNow();
        toast(`${fmtDate(date)}: ${fmtHM(b.effMin)} lucrate${b.effMin > nm ? `, ${fmtHM(b.effMin - nm)} extra` : ''}.`, { undo: () => { app.store.undo(); app.refresh(); } });
        app.refresh();
        return true;
      } },
    ],
  });
}
export { hmToMin };

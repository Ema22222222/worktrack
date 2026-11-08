// Calendar lunar/săptămânal și fișa completă a unei zile.
import { esc, icon, pill, emptyState } from '../ui.js';
import { fmtDur, fmtMoney, fmtDate, localTime, toMs, addDays, weekStart, monthStart, monthEnd, dowOf, monthName, dayName, fmtNum, pad } from '../util.js';
import { holidayFor, SETTLEMENT, totalsFor, HOLIDAY_MODES } from '../calc.js';
import { editShift, editProduction, recalcShift } from '../editors.js';
import { otStatusPill, normHtml, timelineHtml } from './today.js';
import { editAbsence, ABSENCE_TYPES } from './leave.js';

let view = 'month';

export function dayInfo(app, R, date) {
  const st = app.state();
  const shifts = R.days.get(date) || [];
  const contract = app.activeContract();
  const hol = holidayFor(st, contract, date) || st.holidays.find((h) => !h.deleted && h.date === date && h.status !== 'respinsa' && h.scope === 'national' && (!contract?.country || h.country === contract.country));
  const abs = st.absences.filter((a) => !a.deleted && a.from <= date && (a.to || a.from) >= date);
  const eff = shifts.reduce((t, c) => t + c.t.effMin, 0);
  const pol = contract && st.policies.find((p) => p.contractId === contract.id && !p.deleted);
  const workDays = pol?.schedule?.workDays || [1, 2, 3, 4, 5];
  const incomplete = shifts.some((c) => (c.t.open && date < app.today()) || (c.shift.breaks || []).some((b) => !b.deleted && !b.end && !c.t.open));
  const unconfirmed = shifts.some((c) => c.otStatus === 'unconfirmed' || c.flags.some((f) => f.includes('neconfirmat')));
  let status = 'none', label = 'Zi nelucrată';
  if (incomplete) { status = 'incomplete'; label = 'Program incomplet'; }
  else if (eff > 0 && hol) { status = 'holiday'; label = 'Sărbătoare lucrată'; }
  else if (eff > 0) { status = 'worked'; label = 'Zi lucrată'; }
  else if (abs.some((a) => a.type === 'concediu' || a.type === 'medical')) { status = 'leave'; label = 'Concediu'; }
  else if (hol) { status = 'holiday'; label = 'Sărbătoare legală'; }
  else if (abs.length) { status = 'off'; label = ABSENCE_TYPES[abs[0].type] || 'Zi liberă'; }
  else if (!workDays.includes(dowOf(date))) { status = 'off'; label = 'Zi liberă'; }
  return { shifts, hol, abs, eff, status, label, unconfirmed, incomplete };
}

export function render(root, app) {
  const R = app.calc();
  const sel = app.params.date || app.today();
  const anchor = app.params.anchor || sel;
  const today = app.today();
  let days;
  if (view === 'month') {
    const ms = monthStart(anchor), me = monthEnd(anchor);
    const gs = weekStart(ms); const ge = addDays(weekStart(me), 6);
    days = []; for (let d = gs; d <= ge; d = addDays(d, 1)) days.push(d);
  } else { const ws = weekStart(anchor); days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)); }
  const [y, m] = anchor.split('-').map(Number);
  const title = view === 'month' ? `${monthName(m)} ${y}` : `Săptămâna ${fmtDate(days[0])} – ${fmtDate(days[6])}`;
  const rangeT = totalsFor(R, view === 'month' ? monthStart(anchor) : days[0], view === 'month' ? monthEnd(anchor) : days[6]);
  const cur = app.cur;
  root.innerHTML = `
  <div class="pagehead"><div><h1>Calendar</h1><p class="sub">Atinge o zi pentru detalii și corecturi.</p></div>
    <div class="row"><div class="seg"><button data-v="month" class="${view === 'month' ? 'on' : ''}">Lună</button><button data-v="week" class="${view === 'week' ? 'on' : ''}">Săptămână</button></div>
    <button class="btn-primary" id="addday">${icon('plus')} Zi manuală</button></div></div>
  <section class="panel">
    <header><div class="row"><button class="iconbtn" data-nav-d="-1" aria-label="Înapoi">${icon('chevl')}</button><h2 style="min-width:12ch;text-align:center">${esc(title)}</h2><button class="iconbtn" data-nav-d="1" aria-label="Înainte">${icon('chev')}</button>
      <button class="btn-sm btn-ghost" data-today>Azi</button></div>
      <span class="small muted tabnum">${fmtDur(rangeT.effMin)} efectiv · ${fmtDur(rangeT.otMin)} peste normă · ${fmtDur(rangeT.holidayMin)} sărbătoare · ${fmtMoney(rangeT.money.total, cur)}</span></header>
    <div class="cal">${['L', 'Ma', 'Mi', 'J', 'V', 'S', 'D'].map((d) => `<div class="dh">${d}</div>`).join('')}
    ${days.map((d) => {
      const info = dayInfo(app, R, d);
      const out = view === 'month' && d.slice(0, 7) !== anchor.slice(0, 7);
      const ot = info.shifts.reduce((t, c) => t + c.otMin, 0);
      const tags = [];
      if (info.hol) tags.push('var(--holiday)');
      if (ot > 0) tags.push('var(--warn)');
      if (R.production.some((p) => p.date === d)) tags.push('var(--accent)');
      if (info.unconfirmed) tags.push('var(--fg-3)');
      return `<button class="d st-${info.status}${out ? ' out' : ''}${d === today ? ' today' : ''}" data-d="${d}" ${d === sel ? 'aria-current="date"' : ''} title="${esc(info.label)}${info.hol ? ' – ' + esc(info.hol.name) : ''}">
        <span class="n">${+d.slice(8)}</span>${info.eff > 0 ? `<span class="h">${fmtDur(info.eff).replace(' ', '')}</span>` : info.status !== 'none' ? `<span class="tiny muted" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(info.label)}</span>` : ''}
        <span class="tags">${tags.map((c) => `<i style="background:${c}"></i>`).join('')}</span></button>`;
    }).join('')}</div>
    <div class="legend"><span><span class="swatch" style="background:var(--ok-soft);border:1px solid var(--line)"></span>Lucrată</span><span><span class="swatch" style="background:var(--holiday-soft);border:1px solid var(--line)"></span>Sărbătoare</span>
      <span><span class="swatch" style="background:var(--info-soft);border:1px solid var(--line)"></span>Concediu</span><span><span class="swatch" style="background:var(--warn-soft);border:1px solid var(--line)"></span>Incomplet</span>
      <span><span class="swatch" style="background:var(--warn);border-radius:50%"></span>Peste normă</span><span><span class="swatch" style="background:var(--accent);border-radius:50%"></span>Producție</span><span><span class="swatch" style="background:var(--fg-3);border-radius:50%"></span>Neconfirmat</span></div>
  </section>
  <section id="dayview"></section>`;
  root.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => { view = b.dataset.v; app.refresh(); }; });
  root.querySelectorAll('[data-nav-d]').forEach((b) => { b.onclick = () => {
    const n = +b.dataset.navD;
    let a;
    if (view === 'month') { const [yy, mm] = anchor.split('-').map(Number); const t = new Date(Date.UTC(yy, mm - 1 + n, 1)); a = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`; }
    else a = addDays(anchor, 7 * n);
    app.params = { ...app.params, anchor: a }; app.refresh();
  }; });
  root.querySelector('[data-today]').onclick = () => { app.params = { date: today, anchor: today }; app.refresh(); };
  root.querySelector('#addday').onclick = () => editShift(app, null, { date: sel });
  root.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { app.params = { ...app.params, date: b.dataset.d }; app.refresh(); root.querySelector('#dayview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
  renderDay(root.querySelector('#dayview'), app, sel);
}

export function renderDay(el, app, date) {
  const R = app.calc(); const st = app.state();
  const info = dayInfo(app, R, date);
  const T = totalsFor(R, date, date);
  const prod = R.production.filter((p) => p.date === date);
  const pays = st.payments.filter((p) => !p.deleted && (p.periodFrom || p.date) <= date && (p.periodTo || p.date) >= date);
  const confs = st.confirmations.filter((p) => !p.deleted && (p.periodFrom || p.date) <= date && (p.periodTo || p.date) >= date);
  const cur = app.cur;
  const statusKind = { worked: 'ok', holiday: 'hol', leave: 'info', off: '', incomplete: 'warn', none: '' }[info.status];
  el.className = 'panel';
  el.innerHTML = `
    <header><div><h2>${esc(fmtDate(date, { long: true }))}</h2><div class="row" style="margin-top:6px">${pill(info.label, statusKind)}${info.hol ? pill(`${info.hol.name}${info.hol.status !== 'confirmata' ? ' (neconfirmată)' : ''}`, 'hol') : ''}${info.unconfirmed ? pill('Are înregistrări neconfirmate', 'warn') : ''}</div></div>
      <div class="row"><button class="btn-sm" data-add-shift>${icon('plus')} Zi de lucru</button><button class="btn-sm" data-add-prod>${icon('plus')} Producție</button><button class="btn-sm" data-add-abs>${icon('plus')} Absență</button></div></header>
    ${info.shifts.length ? `<div class="kv">
      <div><span class="label">Timp efectiv</span><b>${fmtDur(T.effMin)}</b></div>
      <div><span class="label">Pauze</span><b>${fmtDur(T.breakMin)}</b></div>
      <div><span class="label">Timp total</span><b>${fmtDur(T.spanMin)}</b></div>
      <div class="${T.otMin ? 'warn' : ''}"><span class="label">Peste normă</span><b>${fmtDur(T.otMin)}</b><span class="hint">${fmtDur(T.otEligibleMin)} elig. · ${fmtDur(T.otIneligibleMin)} neelig. · ${fmtDur(T.otUnconfirmedMin)} neconf.</span></div>
      <div class="${T.holidayMin ? 'hol' : ''}"><span class="label">Ore de sărbătoare</span><b>${fmtDur(T.holidayMin)}</b></div>
      <div><span class="label">Câștig estimat</span><b>${fmtMoney(T.money.total, cur)}</b><span class="hint">${fmtMoney(T.money.eligible, cur)} eligibil${T.money.unconfirmed ? ` · ${fmtMoney(T.money.unconfirmed, cur)} neconf.` : ''}${T.money.ineligible ? ` · ${fmtMoney(T.money.ineligible, cur)} neelig.` : ''}</span></div>
      <div><span class="label">Ore compensatorii generate</span><b>${fmtDur(T.compEarnedMin)}</b></div>
    </div>` : ''}
    ${info.shifts.map((c) => shiftCard(app, c)).join('') || emptyState('Nicio zi de lucru înregistrată.', '')}
    <section class="stack"><h3>Producție</h3>
      ${(info.shifts[0]?.normEvals || []).map(normHtml).join('')}
      ${prod.length ? `<div class="list">${prod.map((p) => `<div class="item click" data-prod="${p.id}"><div class="grow"><b class="tabnum">${fmtNum(p.qty)} ${esc(p.unit)}</b> <span class="small muted">${p.time ? localTime(toMs(p.time), app.tz) : 'fără oră'} · ${esc(app.name(p.activityId, 'fără activitate'))}${p.locationId ? ' · ' + esc(app.name(p.locationId)) : ''}${p.note ? ' · ' + esc(p.note) : ''}${p.attachments?.length ? ` · ${p.attachments.length} atașament(e)` : ''}</span></div>${icon('edit')}</div>`).join('')}</div>` : '<p class="small muted">Fără producție.</p>'}
    </section>
    ${info.abs.length ? `<section class="stack"><h3>Absențe / zile libere</h3><div class="list">${info.abs.map((a) => `<div class="item click" data-abs="${a.id}"><div class="grow"><b>${esc(ABSENCE_TYPES[a.type] || a.type)}</b> <span class="small muted">${fmtDate(a.from)}${a.to && a.to !== a.from ? ' – ' + fmtDate(a.to) : ''}${a.minutes ? ' · ' + fmtDur(a.minutes) : ''}${a.note ? ' · ' + esc(a.note) : ''}</span></div>${icon('edit')}</div>`).join('')}</div></section>` : ''}
    ${pays.length || confs.length ? `<section class="stack"><h3>Bani pentru perioada care include ziua</h3><div class="list">
      ${confs.map((p) => `<div class="item"><div class="grow">Confirmat de angajator: <b>${fmtMoney(Number(p.amount), p.currency || cur)}</b> <span class="small muted">${fmtDate(p.periodFrom)} – ${fmtDate(p.periodTo)}</span></div></div>`).join('')}
      ${pays.map((p) => `<div class="item"><div class="grow">Plată primită: <b>${fmtMoney(Number(p.amount), p.currency || cur)}</b> <span class="small muted">pe ${fmtDate(p.date)} · ${fmtDate(p.periodFrom)} – ${fmtDate(p.periodTo)}</span></div></div>`).join('')}</div></section>` : ''}`;
  el.querySelector('[data-add-shift]').onclick = () => editShift(app, null, { date });
  el.querySelector('[data-add-prod]').onclick = () => editProduction(app, null, { date });
  el.querySelector('[data-add-abs]').onclick = () => editAbsence(app, null, { date });
  el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editShift(app, b.dataset.edit); });
  el.querySelectorAll('[data-recalc]').forEach((b) => { b.onclick = () => recalcShift(app, b.dataset.recalc); });
  el.querySelectorAll('[data-prod]').forEach((b) => { b.onclick = () => editProduction(app, b.dataset.prod); });
  el.querySelectorAll('[data-abs]').forEach((b) => { b.onclick = () => editAbsence(app, b.dataset.abs); });
}

function shiftCard(app, c) {
  const sh = c.shift; const cur = app.currencyFor(c.employerId);
  const segs = (sh.segments || []).filter((g) => !g.deleted);
  const brks = (sh.breaks || []).filter((b) => !b.deleted);
  const loc = (l) => (l?.locationId ? app.name(l.locationId) : l?.geo ? `${l.geo.lat}, ${l.geo.lng}` : '');
  const set = sh.settlement || {};
  return `<article class="panel" style="background:var(--surface-2)">
    <header><div><b>${localTime(c.t.start, app.tz)} – ${sh.end ? localTime(c.t.end, app.tz) : 'în desfășurare'}</b> <span class="small muted">${esc(app.name(c.employerId))} · ${esc(c.contract?.name || '')}</span></div>
      <div class="row">${otStatusPill(c)}<button class="btn-sm" data-edit="${c.id}">${icon('edit')} Corectează</button>${sh.end ? `<button class="btn-sm btn-ghost" data-recalc="${c.id}" title="Recalculează cu tarifele și regulile actuale">Recalculează</button>` : ''}</div></header>
    ${timelineHtml(app, c)}
    <div class="tablewrap"><table><thead><tr><th>Interval</th><th>Tip</th><th class="r">Durată</th><th>Detalii</th></tr></thead><tbody>
      ${[...segs.map((g) => ({ s: toMs(g.start), e: toMs(g.end), t: app.name(g.activityId, 'Nealocat'), d: [loc(g), g.note].filter(Boolean).join(' · ') })),
        ...brks.map((b) => ({ s: toMs(b.start), e: toMs(b.end), t: 'Pauză', d: b.note || '', brk: true }))].sort((a, b) => a.s - b.s)
        .map((r) => `<tr><td class="tabnum">${localTime(r.s, app.tz)}–${r.e ? localTime(r.e, app.tz) : '…'}</td><td>${r.brk ? pill('Pauză', 'pause') : esc(r.t)}</td><td class="r">${fmtDur(((r.e || Date.now()) - r.s) / 60000)}</td><td class="small">${esc(r.d)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Fără intervale detaliate.</td></tr>'}
    </tbody></table></div>
    <div class="kv">
      <div><span class="label">Normă zilnică</span><b>${c.dailyNormMin == null ? '—' : fmtDur(c.dailyNormMin)}</b><span class="hint">Diferență ${c.dailyNormMin == null ? '—' : fmtDur(c.t.effMin - c.dailyNormMin, { sign: true })}</span></div>
      <div><span class="label">Bază ore suplimentare</span><b>${c.otBasis === 'weekly' ? 'Săptămânală' : 'Zilnică'}</b></div>
      <div><span class="label">Regulă sărbătoare</span><b class="small" style="font-size:.9rem">${esc(HOLIDAY_MODES[c.holidayMode] || '—')}</b></div>
      <div><span class="label">Statut plată</span><b class="small" style="font-size:.9rem">${esc(SETTLEMENT[set.day] || 'Neconfirmat')}</b><span class="hint">Supl.: ${esc(SETTLEMENT[set.ot] || 'Neconfirmat')} · Sărb.: ${esc(SETTLEMENT[set.holiday] || 'Neconfirmat')}</span></div>
    </div>
    ${c.otMin > 0 ? `<p class="small"><b>Ore suplimentare:</b> ${esc(c.otReason)}</p>` : ''}
    ${c.flags.length ? `<ul class="small" style="margin:0;padding-left:18px;color:var(--warn)">${c.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${loc(sh.startLoc) || loc(sh.endLoc) ? `<p class="small muted">Locație început: ${esc(loc(sh.startLoc) || '—')} · sfârșit: ${esc(loc(sh.endLoc) || '—')}</p>` : ''}
    ${sh.frozen ? `<p class="tiny muted">Calculat cu regulile salvate la ${new Date(sh.frozen.at).toLocaleString('ro-RO')}. Modificările ulterioare de tarife/reguli nu schimbă această zi decât dacă apeși „Recalculează”.</p>` : ''}
    ${sh.notes ? `<p class="small" style="white-space:pre-wrap"><b>Observații:</b> ${esc(sh.notes)}</p>` : ''}
    <p class="tiny muted">Valoare estimată: ${fmtMoney(c.money.total, cur)} (eligibil ${fmtMoney(c.money.eligible, cur)}${c.money.production ? `, din care producție ${fmtMoney(c.money.production, cur)}` : ''}${c.money.bonus ? `, bonus ${fmtMoney(c.money.bonus, cur)}` : ''})${c.money.missingRate ? ' · lipsește tariful pentru unele ore' : ''}</p>
  </article>`;
}

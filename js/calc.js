// calc.js — motorul de calcul. Funcții pure, fără DOM, testabile independent (vezi tests/).
//
// Principiul de bază: timpul efectiv lucrat se calculează O SINGURĂ DATĂ (interval − pauze).
// Apoi fiecare bucată de timp ("slice") primește etichete: activitate, dată calendaristică,
// sărbătoare, sâmbătă/duminică, peste normă, statut de eligibilitate. Etichetele nu adaugă
// niciodată timp: totalul efectiv = suma slice-urilor, indiferent câte etichete are fiecare.

import {
  toMs, mergeIntervals, subtractIntervals, sumIntervals, intersect, localDate, startOfLocalDay,
  addDays, dowOf, weekStart, monthStart, monthEnd, MIN, HOUR, round2,
} from './util.js';

export const UNCONFIRMED_MSG = 'Eligibilitate neconfirmată – verifică regula angajatorului.';

// ---------- Etichete pentru interfață ----------
export const OT_MODES = {
  unconfirmed: 'Regulă neconfirmată',
  always: 'Plătite indiferent de producție',
  if_norm: 'Plătite numai dacă norma de producție este atinsă (conform regulii normei)',
  norm_in_normal: 'Eligibile numai dacă norma e atinsă în programul normal',
  norm_incl_ot: 'Eligibile dacă norma e atinsă inclusiv în timpul suplimentar',
  proportional: 'Proporțional cu producția realizată',
  custom: 'Regulă personalizată – decid manual pe fiecare zi',
};
export const OT_BASIS = { daily: 'Peste norma zilnică', weekly: 'Peste norma săptămânală' };
export const OT_COMP = { pay: 'Se plătesc', comp: 'Se compensează cu timp liber', unconfirmed: 'Neconfirmat' };
export const HOLIDAY_MODES = {
  unconfirmed: 'Regulă neconfirmată',
  normal: 'Plată normală (fără spor)',
  multiplier: 'Multiplicator de plată (ex. 150%, 200%)',
  special_rate: 'Tarif special pentru sărbători',
  comp_hours: 'Plată normală + ore libere compensatorii',
  comp_day: 'Plată normală + zi liberă compensatorie',
  pay_and_comp: 'Multiplicator + ore libere compensatorii',
  custom: 'Regulă personalizată (decid manual)',
};
export const STACK_MODES = {
  max: 'Se aplică sporul cel mai mare (suplimentar SAU sărbătoare)',
  multiply: 'Sporurile se înmulțesc',
  add: 'Sporurile se adună',
};
export const NORM_PERIODS = {
  shift: 'Pe tură', daily: 'Zilnică', weekly: 'Săptămânală', monthly: 'Lunară',
  project: 'Pe proiect', custom: 'Personalizată (interval)', unknown: 'Necunoscută / neconfirmată',
};
export const NORM_FULFILL = {
  before_normal_end: 'Trebuie îndeplinită înainte de terminarea programului normal',
  incl_overtime: 'Poate fi îndeplinită și în timpul orelor suplimentare',
  proportional: 'Proporțională cu timpul lucrat',
  project: 'Calculată pe proiect',
  custom: 'Regulă personalizată',
  unknown: 'Regulă necunoscută / neconfirmată',
};
export const UNITS = ['m³', 'tone', 'încărcături', 'transporturi', 'arbori', 'bucăți'];
export const SETTLEMENT = {
  neconfirmat: 'Neconfirmat', confirmat: 'Confirmat', asteptare: 'În așteptarea plății',
  platit: 'Plătit', compensat: 'Compensat', partial: 'Plătit parțial',
};

// ---------- Selecție versiuni (istoric tarife/reguli/norme) ----------
const alive = (x) => x && !x.deleted;
export function pickVersion(list, date) {
  let best = null;
  for (const v of list) {
    if (!alive(v)) continue;
    if (v.validFrom && v.validFrom > date) continue;
    if (v.validTo && v.validTo < date) continue;
    if (!best || (v.validFrom || '') > (best.validFrom || '') ||
      ((v.validFrom || '') === (best.validFrom || '') && (v.createdAt || '') > (best.createdAt || ''))) best = v;
  }
  return best;
}

export function resolvePolicy(state, shiftOrContractId, date) {
  const shift = typeof shiftOrContractId === 'object' ? shiftOrContractId : null;
  if (shift?.frozen?.policy) return shift.frozen.policy;
  const contractId = shift ? shift.contractId : shiftOrContractId;
  return pickVersion((state.policies || []).filter((p) => p.contractId === contractId), date);
}

/** Tariful cel mai specific: contract+activitate > contract > angajator+activitate > angajator */
export function resolveRate(rates, { employerId, contractId, activityId }, date) {
  const cands = (rates || []).filter((r) => alive(r) && r.employerId === employerId &&
    (!r.contractId || r.contractId === contractId) && (!r.activityId || r.activityId === activityId));
  const groups = new Map();
  for (const r of cands) {
    const score = (r.contractId ? 2 : 0) + (r.activityId ? 1 : 0);
    if (!groups.has(score)) groups.set(score, []);
    groups.get(score).push(r);
  }
  for (const score of [3, 2, 1, 0]) {
    const v = groups.has(score) ? pickVersion(groups.get(score), date) : null;
    if (v) return v;
  }
  return null;
}

// ---------- Timpul unei ture ----------
/**
 * Calculează timpul unei ture. Pauzele nu sunt niciodată timp lucrat.
 * Activitățile care se suprapun nu dublează timpul: fiecare moment aparține unei singure
 * activități (cea începută cel mai recent). Timpul neacoperit de vreo activitate apare ca "nealocat".
 */
export function shiftTimes(shift, now = Date.now()) {
  const start = toMs(shift.start);
  const end = shift.end ? toMs(shift.end) : Math.max(start, now);
  const span = Math.max(0, end - start);
  const breaksRaw = (shift.breaks || []).filter(alive).map((b) => [toMs(b.start), b.end ? toMs(b.end) : end])
    .map(([s, e]) => [Math.max(s, start), Math.min(e, end)]).filter(([s, e]) => e > s);
  const breaks = mergeIntervals(breaksRaw);
  const breakMs = sumIntervals(breaks);
  const effIntervals = subtractIntervals([start, end], breaks);
  const effMs = sumIntervals(effIntervals);

  // activități
  const segs = (shift.segments || []).filter(alive).map((g) => ({
    activityId: g.activityId || null, s: Math.max(toMs(g.start), start), e: Math.min(g.end ? toMs(g.end) : end, end), id: g.id,
  })).filter((g) => g.e > g.s).sort((a, b) => a.s - b.s);
  const overlaps = [];
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const x = intersect([segs[i].s, segs[i].e], [segs[j].s, segs[j].e]);
    if (x) overlaps.push({ a: segs[i].id, b: segs[j].id, ms: x[1] - x[0] });
  }
  // puncte de tăiere
  const cuts = new Set([start, end]);
  for (const g of segs) { cuts.add(g.s); cuts.add(g.e); }
  for (const [s, e] of effIntervals) { cuts.add(s); cuts.add(e); }
  const pts = [...cuts].filter((t) => t >= start && t <= end).sort((a, b) => a - b);
  const slices = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    const mid = (s + e) / 2;
    if (!effIntervals.some(([a, b]) => mid > a && mid < b)) continue; // pauză
    let act = null, actStart = -Infinity;
    for (const g of segs) if (mid > g.s && mid < g.e && g.s >= actStart) { act = g.activityId; actStart = g.s; }
    if (act == null && !segs.length) act = shift.activityId || null;
    const last = slices[slices.length - 1];
    if (last && last.e === s && last.activityId === act) last.e = e;
    else slices.push({ s, e, activityId: act });
  }
  const openBreak = (shift.breaks || []).some((b) => alive(b) && !b.end);
  return {
    start, end, open: !shift.end, openBreak,
    spanMin: span / MIN, breakMin: breakMs / MIN, effMin: effMs / MIN,
    breaks, effIntervals, slices, overlaps,
  };
}

/** Momentul la care timpul efectiv cumulat atinge `targetMin` (sau null dacă nu se atinge). */
export function instantAtEffective(effIntervals, targetMin, alreadyMin = 0) {
  let acc = alreadyMin * MIN; const target = targetMin * MIN;
  if (acc >= target) return effIntervals.length ? effIntervals[0][0] : null;
  for (const [s, e] of effIntervals) {
    if (acc + (e - s) >= target) return s + (target - acc);
    acc += e - s;
  }
  return null;
}

/** Desparte slice-urile la miezul nopții local și la momentul (opțional) de început al orelor peste normă. */
function splitSlices(slices, tz, otCut) {
  const out = [];
  for (const sl of slices) {
    const pts = [sl.s, sl.e];
    let d = localDate(sl.s, tz);
    for (let i = 0; i < 400; i++) {
      const next = startOfLocalDay(addDays(d, 1), tz);
      if (next >= sl.e) break;
      if (next > sl.s) pts.push(next);
      d = addDays(d, 1);
    }
    if (otCut != null && otCut > sl.s && otCut < sl.e) pts.push(otCut);
    pts.sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) if (pts[i + 1] > pts[i]) {
      const s = pts[i], e = pts[i + 1];
      const date = localDate(s, tz);
      out.push({ s, e, min: (e - s) / MIN, activityId: sl.activityId, date, dow: dowOf(date), ot: otCut != null && s >= otCut });
    }
  }
  return out;
}

// ---------- Sărbători ----------
export function holidayFor(state, contract, date) {
  if (!contract) return null;
  const hs = (state.holidays || []).filter((h) => alive(h) && h.date === date && h.status !== 'respinsa');
  const country = contract.country || '';
  for (const h of hs) {
    if (country && h.country && h.country !== country) continue;
    if (h.scope === 'regional' && h.region && contract.region && h.region !== contract.region) continue;
    if (h.scope === 'regional' && h.region && !contract.region) continue;
    if (h.scope === 'local' && h.locality && (contract.locality || '').toLowerCase() !== h.locality.toLowerCase()) continue;
    return h;
  }
  return null;
}

// ---------- Producție și norme ----------
export function normRange(norm, date) {
  switch (norm.period) {
    case 'shift': case 'daily': return [date, date];
    case 'weekly': { const ws = weekStart(date); return [ws, addDays(ws, 6)]; }
    case 'monthly': return [monthStart(date), monthEnd(date)];
    case 'project': case 'custom': return [norm.validFrom || date, norm.validTo || '9999-12-31'];
    default: return null;
  }
}

function prodMatches(norm, p) {
  if (!alive(p)) return false;
  if (norm.employerId && p.employerId && p.employerId !== norm.employerId) return false;
  if (norm.contractId && p.contractId && p.contractId !== norm.contractId) return false;
  if (norm.activityId && p.activityId !== norm.activityId) return false;
  if ((norm.unit || '') !== (p.unit || '')) return false;
  return true;
}

/**
 * Evaluează o normă de producție pentru perioada care conține `date`.
 * met: true (îndeplinită) / false (neîndeplinită, perioadă încheiată) / null (neconfirmat sau în curs).
 */
export function evalNorm(norm, date, ctx, forcedRule) {
  const res = { normId: norm.id, name: norm.name, unit: norm.unit, required: null, done: 0, remaining: null, pct: null,
    met: null, reachedAt: null, reachedInNormal: null, closed: false, reason: '', range: null };
  const range = normRange(norm, date);
  res.range = range;
  const rule = forcedRule || norm.fulfillment || 'unknown';
  const entries = (ctx.production || []).filter((p) => prodMatches(norm, p) && range && p.date >= range[0] && p.date <= range[1]);
  res.done = round2(entries.reduce((t, p) => t + (Number(p.qty) || 0), 0));
  if (!range) { res.reason = 'Perioada normei este necunoscută / neconfirmată.'; return res; }
  if (norm.quantity == null || norm.quantity === '' || !(Number(norm.quantity) > 0)) { res.reason = 'Cantitatea normei nu este configurată.'; return res; }
  let required = Number(norm.quantity);
  if (rule === 'proportional') {
    const effInRange = ctx.effByDate ? Object.entries(ctx.effByDate).filter(([d]) => d >= range[0] && d <= range[1]).reduce((t, [, v]) => t + v, 0) : 0;
    const daysWorked = ctx.effByDate ? Object.entries(ctx.effByDate).filter(([d, v]) => d >= range[0] && d <= range[1] && v > 0).length : 0;
    const expected = (ctx.dailyNormMin || 0) * Math.max(1, daysWorked);
    if (expected > 0) required = required * effInRange / expected;
  }
  res.required = round2(required);
  // pentru regula "înainte de terminarea programului normal" contează doar producția din programul normal
  const sorted = [...entries].sort((a, b) => (toMs(a.time) || 0) - (toMs(b.time) || 0));
  let counted = 0, pending = 0, acc = 0;
  for (const p of sorted) {
    const q = Number(p.qty) || 0;
    if (rule === 'before_normal_end') {
      if (p._inNormal === true) counted += q;
      else if (p._inNormal == null) pending += q;
    } else counted += q;
    acc += q;
    if (res.reachedAt == null && acc >= required - 1e-9) { res.reachedAt = p.time || null; res.reachedInNormal = p._inNormal ?? null; }
  }
  const todayClosed = range[1] < ctx.today || (range[0] === range[1] && ctx.dayClosed?.(range[0]));
  res.closed = !!todayClosed;
  res.remaining = round2(Math.max(0, required - res.done));
  res.pct = required > 0 ? Math.min(999, round2((res.done / required) * 100)) : null;
  if (norm.status !== 'confirmat') res.reason = 'Normă neconfirmată.';
  if (rule === 'unknown' || rule === 'custom') { res.reason = res.reason || 'Regula de îndeplinire este necunoscută / personalizată.'; return res; }
  if (counted >= required - 1e-9) res.met = norm.status === 'confirmat' ? true : null;
  else if (counted + pending >= required - 1e-9) { res.met = null; res.reason = res.reason || 'Unele înregistrări nu au oră exactă – nu se poate stabili dacă norma a fost atinsă în programul normal.'; }
  else if (todayClosed) res.met = norm.status === 'confirmat' ? false : null;
  else { res.met = null; res.reason = res.reason || 'Perioada normei nu s-a încheiat încă.'; }
  return res;
}

// ---------- Calculul complet ----------
const DEFAULT_SCHEDULE = { dailyNormMin: null, weeklyNormMin: null, monthlyNormMin: null, workDays: [1, 2, 3, 4, 5], offDayAllOvertime: false };

function scheduleOf(policy) { return { ...DEFAULT_SCHEDULE, ...(policy?.schedule || {}) }; }

/**
 * Calculează totul pentru starea dată.
 * @param state { settings, employers, contracts, activities, rates, policies, norms, shifts, production, holidays, absences, compEntries, payments, confirmations }
 * @param opts { now, tz, today }
 * @returns { shifts: Map<id, ShiftCalc>, days: Map<date, DayAgg[]> , dayList }
 */
export function computeAll(state, opts = {}) {
  const tz = opts.tz || state.settings?.tz || 'Europe/Madrid';
  const now = opts.now ?? Date.now();
  const today = opts.today || localDate(now, tz);
  const contracts = new Map((state.contracts || []).map((c) => [c.id, c]));
  const shifts = (state.shifts || []).filter(alive).filter((s) => s.start);
  const calc = new Map();

  // 1) timpi + politică
  for (const sh of shifts) {
    const t = shiftTimes(sh, now);
    const date = localDate(t.start, tz);
    const policy = resolvePolicy(state, sh, date);
    calc.set(sh.id, { shift: sh, id: sh.id, date, t, policy, schedule: scheduleOf(policy), contract: contracts.get(sh.contractId) || null,
      employerId: sh.employerId, contractId: sh.contractId, flags: [] });
  }

  const locMap = new Map((state.locations || []).filter(alive).map((l) => [l.id, l]));
  // 2) normă de timp: zilnică (pe dată+contract) sau săptămânală
  const byDay = new Map();
  for (const c of calc.values()) {
    const k = `${c.date}|${c.contractId}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(c);
  }
  const effByDate = {};
  for (const c of calc.values()) effByDate[c.date] = (effByDate[c.date] || 0) + c.t.effMin;

  for (const group of byDay.values()) {
    group.sort((a, b) => a.t.start - b.t.start);
    const sch = group[0].schedule;
    let normMin = sch.dailyNormMin;
    const offDay = !(sch.workDays || []).includes(dowOf(group[0].date));
    if (offDay && sch.offDayAllOvertime) normMin = 0;
    if (sch.holidayAllOvertime) {
      const wl = group[0].shift.locationId ? locMap.get(group[0].shift.locationId) : null;
      const hctx = wl && wl.country ? { ...(group[0].contract || {}), country: wl.country, region: wl.region || '', locality: wl.locality || '' } : group[0].contract;
      const hd = holidayFor(state, hctx, group[0].date);
      if (hd && hd.status === 'confirmata') normMin = 0;
    }
    let acc = 0;
    group.forEach((c, i) => { c.firstOfDay = i === 0; });
    for (const c of group) {
      c.dailyNormMin = normMin;
      c.offDay = offDay;
      if (normMin == null) { c.normalEnd = null; c.dailyOverMin = null; c.flags.push('Norma zilnică de timp nu este configurată.'); }
      else {
        c.normalEnd = instantAtEffective(c.t.effIntervals, normMin, acc);
        c.dailyOverMin = Math.max(0, acc + c.t.effMin - Math.max(normMin, acc));
      }
      acc += c.t.effMin;
    }
  }

  // săptămânal
  const byWeek = new Map();
  for (const c of calc.values()) {
    const k = `${weekStart(c.date)}|${c.contractId}`;
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(c);
  }
  const weekInfo = new Map();
  for (const [k, group] of byWeek) {
    group.sort((a, b) => a.t.start - b.t.start);
    const sch = group[0].schedule;
    const wn = sch.weeklyNormMin;
    let acc = 0;
    for (const c of group) {
      c.weekKey = k;
      c.weeklyNormMin = wn;
      c.weekCut = wn == null ? null : instantAtEffective(c.t.effIntervals, wn, acc);
      acc += c.t.effMin;
    }
    weekInfo.set(k, { effMin: acc, normMin: wn, overMin: wn == null ? null : Math.max(0, acc - wn) });
  }

  // 3) slice-uri cu etichete
  for (const c of calc.values()) {
    const wl = c.shift.locationId ? locMap.get(c.shift.locationId) : null;
    c.location = wl || null;
    const holCtx = wl && wl.country ? { ...(c.contract || {}), country: wl.country, region: wl.region || '', locality: wl.locality || '' } : c.contract;
    const basis = c.policy?.ot?.basis || 'daily';
    c.otBasis = basis;
    const cut = basis === 'weekly' ? c.weekCut : c.normalEnd;
    c.otCut = cut;
    c.slices = splitSlices(c.t.slices, tz, cut);
    if ((basis === 'weekly' && c.weeklyNormMin == null)) c.flags.push('Norma săptămânală nu este configurată.');
    const holidayUnconf = new Set();
    for (const s of c.slices) {
      const h = holidayFor(state, holCtx, s.date);
      s.holiday = h ? { id: h.id, name: h.name, confirmed: h.status === 'confirmata' } : null;
      if (h && h.status !== 'confirmata') holidayUnconf.add(s.date);
    }
    if (holidayUnconf.size) c.flags.push('Sărbătoare neconfirmată în calendar.');
    c.otMin = c.slices.filter((s) => s.ot).reduce((t, s) => t + s.min, 0);
    c.holidayMin = c.slices.filter((s) => s.holiday).reduce((t, s) => t + s.min, 0);
    c.satMin = c.slices.filter((s) => s.dow === 6).reduce((t, s) => t + s.min, 0);
    c.sunMin = c.slices.filter((s) => s.dow === 7).reduce((t, s) => t + s.min, 0);
    if (c.t.overlaps.length) c.flags.push('Activități suprapuse – timpul NU este dublat; verifică intervalele.');
    if (c.t.openBreak) c.flags.push('Pauză neîncheiată.');
    if (c.t.open) c.flags.push('Zi în desfășurare / neîncheiată.');
  }

  // 4) producție: marcare "în programul normal"
  const production = (state.production || []).filter(alive).map((p) => ({ ...p }));
  for (const p of production) {
    const tm = toMs(p.time);
    if (tm == null) { p._inNormal = null; continue; }
    const day = [...calc.values()].filter((c) => c.date === p.date && (!p.employerId || c.employerId === p.employerId));
    if (!day.length) { p._inNormal = null; continue; }
    const ends = day.map((c) => c.normalEnd).filter((x) => x != null);
    if (!ends.length) p._inNormal = day.every((c) => c.dailyNormMin != null) ? true : null;
    else p._inNormal = tm <= Math.min(...ends);
  }
  const dayClosed = (d) => { const l = [...calc.values()].filter((c) => c.date === d); return l.length > 0 && l.every((c) => !c.t.open); };

  // 5) eligibilitate ore suplimentare + bani
  const normsAll = (state.norms || []);
  const evalCache = new Map();
  for (const c of calc.values()) {
    const pol = c.policy || {};
    const ot = pol.ot || {};
    const mode = ot.mode || 'unconfirmed';
    const normsSrc = c.shift.frozen?.norms || normsAll;
    const relevantNorms = normsSrc.filter((n) => alive(n) && n.employerId === c.employerId && (!n.contractId || n.contractId === c.contractId) &&
      (!n.validFrom || n.validFrom <= c.date) && (!n.validTo || n.validTo >= c.date));
    // versiunea curentă pentru fiecare serie de normă
    const bySeries = new Map();
    for (const n of relevantNorms) { const k = n.seriesId || n.id; const cur = bySeries.get(k); if (!cur || (n.validFrom || '') > (cur.validFrom || '')) bySeries.set(k, n); }
    const norms = [...bySeries.values()];
    const ctx = { production, today, dayClosed, effByDate, dailyNormMin: c.dailyNormMin };
    c.normEvals = norms.map((n) => {
      const key = `${n.id}|${c.date}`;
      if (!evalCache.has(key)) evalCache.set(key, evalNorm(n, c.date, ctx));
      return evalCache.get(key);
    });
    const governing = norms.filter((n) => n.governsOvertime);

    let status = 'unconfirmed', fraction = 0, reason = UNCONFIRMED_MSG;
    if (c.otMin <= 0) { status = 'none'; reason = ''; }
    else if (c.shift.otOverride && c.shift.otOverride !== 'auto') {
      status = c.shift.otOverride; fraction = status === 'eligible' ? 1 : 0;
      if (status === 'partial') { fraction = Math.min(1, Math.max(0, (c.shift.otEligibleMin || 0) / c.otMin)); }
      reason = 'Stabilit manual pentru această zi' + (c.shift.otOverrideNote ? `: ${c.shift.otOverrideNote}` : '.');
    } else if (mode === 'always') { status = 'eligible'; fraction = 1; reason = 'Regula configurată: plătite indiferent de producție.'; }
    else if (mode === 'unconfirmed' || mode === 'custom') { status = 'unconfirmed'; reason = mode === 'custom' ? 'Regulă personalizată – stabilește manual eligibilitatea pentru această zi.' : UNCONFIRMED_MSG; }
    else {
      if (!governing.length) { status = 'unconfirmed'; reason = 'Nu există o normă de producție care să decidă orele suplimentare. ' + UNCONFIRMED_MSG; }
      else {
        const forced = mode === 'norm_in_normal' ? 'before_normal_end' : mode === 'norm_incl_ot' ? 'incl_overtime' : null;
        const evs = governing.map((n) => (forced ? evalNorm(n, c.date, ctx, forced) : evalCache.get(`${n.id}|${c.date}`) || evalNorm(n, c.date, ctx)));
        c.governingEvals = evs;
        if (mode === 'proportional') {
          if (evs.some((e) => e.required == null)) { status = 'unconfirmed'; reason = evs.find((e) => e.required == null).reason + ' ' + UNCONFIRMED_MSG; }
          else {
            fraction = Math.min(1, ...evs.map((e) => (e.required > 0 ? e.done / e.required : 1)));
            const closed = evs.every((e) => e.closed);
            const confirmed = governing.every((n) => n.status === 'confirmat');
            if (!confirmed) { status = 'unconfirmed'; reason = 'Normă neconfirmată. ' + UNCONFIRMED_MSG; }
            else if (!closed) { status = 'unconfirmed'; reason = 'Perioada normei nu s-a încheiat – proporția este provizorie.'; }
            else { status = fraction >= 1 ? 'eligible' : fraction <= 0 ? 'ineligible' : 'partial'; reason = `Proporțional: ${Math.round(fraction * 100)}% din norma de producție.`; }
          }
        } else if (evs.every((e) => e.met === true)) { status = 'eligible'; fraction = 1; reason = 'Norma de producție este îndeplinită.'; }
        else if (evs.some((e) => e.met === false)) { status = 'ineligible'; fraction = 0; reason = 'Norma de producție NU este îndeplinită (conform regulii configurate). Orele rămân înregistrate.'; }
        else { status = 'unconfirmed'; reason = (evs.find((e) => e.met == null)?.reason || '') + ' ' + UNCONFIRMED_MSG; }
      }
    }
    c.otStatus = status; c.otFraction = fraction; c.otReason = reason.trim();
    c.otEligibleMin = status === 'eligible' ? c.otMin : status === 'partial' ? c.otMin * fraction : 0;
    c.otIneligibleMin = status === 'ineligible' ? c.otMin : status === 'partial' ? c.otMin * (1 - fraction) : 0;
    c.otUnconfirmedMin = status === 'unconfirmed' ? c.otMin : 0;

    // compensare
    const otComp = ot.comp || 'pay';
    const compRatio = Number(ot.compRatio ?? 1);
    c.compFromOtMin = otComp === 'comp' ? c.otEligibleMin * compRatio : 0;
    const hol = pol.holiday || {};
    const hmode = hol.mode || 'unconfirmed';
    c.holidayMode = hmode;
    c.compFromHolidayMin = 0;
    if (c.holidayMin > 0) {
      if (hmode === 'comp_hours' || hmode === 'pay_and_comp') c.compFromHolidayMin = c.holidayMin * Number(hol.compRatio ?? 1);
      else if (hmode === 'comp_day') {
        const days = new Set(c.slices.filter((s) => s.holiday).map((s) => s.date)).size;
        c.compFromHolidayMin = days * Number(hol.compDayMin ?? c.dailyNormMin ?? 0);
      } else if (hmode === 'custom' && c.shift.holidayCompMin != null) c.compFromHolidayMin = Number(c.shift.holidayCompMin) || 0;
    }

    // bani
    computeMoney(c, state, pol, otComp);
  }

  // 6) agregare pe zile
  const days = new Map();
  for (const c of calc.values()) {
    if (!days.has(c.date)) days.set(c.date, []);
    days.get(c.date).push(c);
  }
  return { calc, days, weekInfo, production, today, tz, now };
}

function zeroMoney() { return { eligible: 0, unconfirmed: 0, ineligible: 0, compValue: 0, production: 0, bonus: 0, missingRate: false, currency: null }; }

function computeMoney(c, state, pol, otComp) {
  const m = zeroMoney();
  const ratesSrc = c.shift.frozen?.rates || state.rates || [];
  const stack = pol.stackMode || 'max';
  const hmode = c.holidayMode;
  const breakdown = [];
  for (const s of c.slices) {
    const rate = resolveRate(ratesSrc, { employerId: c.employerId, contractId: c.contractId, activityId: s.activityId }, s.date);
    if (!rate || rate.normal == null || rate.normal === '') { m.missingRate = true; s.value = null; continue; }
    m.currency = m.currency || rate.currency || null;
    const base = Number(rate.normal);
    const h = s.min / 60;
    // spor zi (sâmbătă/duminică)
    let dayMult = 1;
    if (s.dow === 6 && rate.satMultiplier) dayMult = Number(rate.satMultiplier);
    if (s.dow === 7 && rate.sunMultiplier) dayMult = Number(rate.sunMultiplier);
    // sărbătoare
    let holMult = 1, holRate = null, holKnown = true;
    if (s.holiday) {
      if (hmode === 'multiplier' || hmode === 'pay_and_comp') holMult = Number(rate.holidayMultiplier || 1);
      else if (hmode === 'special_rate') {
        holRate = rate.holidayRate != null && rate.holidayRate !== '' ? Number(rate.holidayRate) : null;
        if (holRate == null) holKnown = false;
      }
      else if (hmode === 'unconfirmed' || hmode === 'custom') holKnown = false;
      if (!s.holiday.confirmed) holKnown = false;
      if (holRate != null) holMult = holRate / base;
      dayMult = Math.max(dayMult, 1); // sporul de zi rămâne; sărbătoarea se combină mai jos
    }
    // ore suplimentare
    let otMult = 1;
    if (s.ot) {
      if (rate.otRate != null && rate.otRate !== '') otMult = Number(rate.otRate) / base;
      else if (rate.otMultiplier) otMult = Number(rate.otMultiplier);
      else if (!c._otRateWarn) { c.flags.push('Tariful pentru ore suplimentare nu este configurat – se folosește tariful normal.'); c._otRateWarn = true; }
    }
    let mult;
    const prem = [dayMult, s.holiday ? holMult : 1, s.ot ? otMult : 1];
    if (stack === 'multiply') mult = prem.reduce((a, b) => a * b, 1);
    else if (stack === 'add') mult = 1 + prem.reduce((a, b) => a + (b - 1), 0);
    else mult = Math.max(...prem);
    const baseValue = base * h;
    const fullValue = base * mult * h;
    const premium = fullValue - baseValue;
    s.value = fullValue;
    if (!s.ot) {
      m.eligible += baseValue;
      if (s.holiday && !holKnown) m.unconfirmed += premium; else m.eligible += premium;
    } else {
      const st = c.otStatus;
      let elig = st === 'eligible' ? 1 : st === 'partial' ? c.otFraction : 0;
      const inel = st === 'ineligible' ? 1 : st === 'partial' ? 1 - c.otFraction : 0;
      const unc = st === 'unconfirmed' ? 1 : 0;
      if (otComp === 'comp') { m.compValue += fullValue * elig; elig = 0; }
      if (otComp === 'unconfirmed') { m.unconfirmed += fullValue * elig; elig = 0; }
      if (s.holiday && !holKnown) { m.eligible += (baseValue) * elig; m.unconfirmed += premium * elig; }
      else m.eligible += fullValue * elig;
      m.ineligible += fullValue * inel;
      m.unconfirmed += fullValue * unc;
    }
    breakdown.push({ ...s, rate: base, mult });
  }
  // plată pe producție
  const ratesForProd = c.shift.frozen?.rates || state.rates || [];
  const myProd = (state.production || []).filter((p) => alive(p) && p.date === c.date &&
    (p.shiftId ? p.shiftId === c.id : (c.firstOfDay && (!p.employerId || p.employerId === c.employerId))));
  for (const p of myProd) {
    const rate = resolveRate(ratesForProd, { employerId: c.employerId, contractId: c.contractId, activityId: p.activityId }, p.date);
    const pu = (rate?.perUnit || []).find((u) => u.unit === p.unit && (!u.activityId || u.activityId === p.activityId));
    if (pu && pu.price) { const v = Number(pu.price) * (Number(p.qty) || 0); m.production += v; m.eligible += v; }
  }
  // bonus zilnic
  const r0 = resolveRate(ratesForProd, { employerId: c.employerId, contractId: c.contractId, activityId: null }, c.date);
  if (r0 && Number(r0.dailyBonus) > 0 && c.t.effMin > 0 && c.firstOfDay) {
    const v = Number(r0.dailyBonus);
    if (r0.bonusCondition === 'norm_met') {
      const evs = c.normEvals || [];
      if (!evs.length || evs.some((e) => e.met == null)) m.unconfirmed += v;
      else if (evs.every((e) => e.met === true)) m.eligible += v;
      else m.ineligible += v;
    } else m.eligible += v;
    m.bonus += v;
  }
  for (const k of ['eligible', 'unconfirmed', 'ineligible', 'compValue', 'production', 'bonus']) m[k] = round2(m[k]);
  m.total = round2(m.eligible + m.unconfirmed + m.ineligible);
  c.money = m;
  c.breakdown = breakdown;
}

// ---------- Agregări pe perioadă ----------
export function emptyTotals() {
  return { days: 0, spanMin: 0, breakMin: 0, effMin: 0, normMin: 0, dailyOverMin: 0, otMin: 0, otEligibleMin: 0, otIneligibleMin: 0,
    otUnconfirmedMin: 0, holidayMin: 0, holidayDays: 0, satMin: 0, sunMin: 0, compEarnedMin: 0,
    money: { eligible: 0, unconfirmed: 0, ineligible: 0, compValue: 0, production: 0, bonus: 0, total: 0 }, missingRate: false, byActivity: {} };
}

export function addToTotals(T, c) {
  T.spanMin += c.t.spanMin; T.breakMin += c.t.breakMin; T.effMin += c.t.effMin;
  T.dailyOverMin += c.dailyOverMin || 0; T.otMin += c.otMin; T.otEligibleMin += c.otEligibleMin;
  T.otIneligibleMin += c.otIneligibleMin; T.otUnconfirmedMin += c.otUnconfirmedMin; T.holidayMin += c.holidayMin;
  T.satMin += c.satMin; T.sunMin += c.sunMin; T.compEarnedMin += (c.compFromOtMin || 0) + (c.compFromHolidayMin || 0);
  for (const k of Object.keys(T.money)) T.money[k] = round2(T.money[k] + (c.money?.[k] || 0));
  if (c.money?.missingRate) T.missingRate = true;
  for (const s of c.slices) T.byActivity[s.activityId || '_none'] = (T.byActivity[s.activityId || '_none'] || 0) + s.min;
}

/** Totaluri pentru intervalul [from,to] (date locale), opțional filtrat pe angajator/contract/activitate. */
export function totalsFor(result, from, to, filter = {}) {
  const T = emptyTotals();
  const seenDays = new Set(), holDays = new Set();
  for (const c of result.calc.values()) {
    if (c.date < from || c.date > to) continue;
    if (filter.employerId && c.employerId !== filter.employerId) continue;
    if (filter.contractId && c.contractId !== filter.contractId) continue;
    if (filter.country && (c.contract?.country || '') !== filter.country) continue;
    if (filter.activityId) {
      const sl = c.slices.filter((s) => s.activityId === filter.activityId);
      const min = sl.reduce((t, s) => t + s.min, 0);
      if (!min) continue;
      T.effMin += min; T.byActivity[filter.activityId] = (T.byActivity[filter.activityId] || 0) + min;
      seenDays.add(c.date); continue;
    }
    addToTotals(T, c);
    seenDays.add(c.date);
    for (const s of c.slices) if (s.holiday) holDays.add(s.date);
    if (c.dailyNormMin != null && !seenDays.has(c.date + '|n' + c.contractId)) { T.normMin += c.dailyNormMin; seenDays.add(c.date + '|n' + c.contractId); }
  }
  T.days = [...seenDays].filter((d) => !d.includes('|')).length;
  T.holidayDays = holDays.size;
  return T;
}

// ---------- Ore compensatorii ----------
export function compLedger(state, result, upTo = '9999-12-31') {
  const rows = [];
  for (const c of result.calc.values()) {
    if (c.date > upTo) continue;
    if (c.compFromHolidayMin > 0) rows.push({ date: c.date, kind: 'sarbatoare', min: c.compFromHolidayMin, ref: c.id, label: 'Acordat (calculat) – lucru de sărbătoare' });
    if (c.compFromOtMin > 0) rows.push({ date: c.date, kind: 'suplimentare', min: c.compFromOtMin, ref: c.id, label: 'Acordat (calculat) – ore suplimentare compensate' });
  }
  for (const e of (state.compEntries || []).filter(alive)) {
    if (e.date > upTo) continue;
    rows.push({ date: e.date, kind: 'manual', min: Number(e.minutes) || 0, ref: e.id, label: e.note || (Number(e.minutes) >= 0 ? 'Acordat manual' : 'Folosit / ajustare') });
  }
  for (const a of (state.absences || []).filter(alive)) {
    if (a.type !== 'compensatoriu' && a.type !== 'recuperare') continue;
    if (a.from > upTo) continue;
    rows.push({ date: a.from, kind: 'folosit', min: -(Number(a.minutes) || 0), ref: a.id, label: `Folosit: ${a.type === 'recuperare' ? 'zi de recuperare' : 'timp liber compensatoriu'}` });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let bal = 0, granted = 0, used = 0, fromHoliday = 0;
  for (const r of rows) {
    bal += r.min; r.balance = bal;
    if (r.min >= 0) granted += r.min; else used += -r.min;
    if (r.kind === 'sarbatoare') fromHoliday += r.min;
  }
  return { rows, balance: bal, granted, used, fromHoliday };
}

// ---------- Banca de ore extra ----------
/**
 * Soldul orelor extra: intră toate orele extra lucrate; ies orele plătite și zilele libere luate din ore extra.
 * Calcul în ordinea datelor: o zi liberă e acoperită doar de orele strânse până atunci; restul rămâne „neacoperit”.
 */
export function otBank(state, result, upTo = '9999-12-31') {
  const ev = [];
  for (const c of result.calc.values()) if (c.date <= upTo && c.otMin > 0 && !c.t.open) ev.push({ date: c.date, kind: 'earn', min: c.otMin, ref: c.id });
  for (const p of (state.otPayments || []).filter(alive)) if (p.date <= upTo) ev.push({ date: p.date, kind: 'paid', min: -(Number(p.minutes) || 0), ref: p.id, month: p.month || null, note: p.note || '' });
  for (const a of (state.absences || []).filter(alive)) {
    if ((a.type !== 'recuperare' && a.type !== 'compensatoriu') || a.from > upTo) continue;
    ev.push({ date: a.from, kind: 'dayoff', min: -(Number(a.minutes) || 0), ref: a.id, note: a.note || '', to: a.to || a.from });
  }
  for (const e of (state.compEntries || []).filter(alive)) if (e.date <= upTo) ev.push({ date: e.date, kind: 'adjust', min: Number(e.minutes) || 0, ref: e.id, note: e.note || '' });
  const order = { earn: 0, adjust: 1, paid: 2, dayoff: 3 };
  ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order[a.kind] - order[b.kind]));
  let bal = 0, earned = 0, paid = 0, used = 0;
  const uncovered = {}, byMonth = {};
  for (const r of ev) {
    const m = r.date.slice(0, 7);
    byMonth[m] = byMonth[m] || { earned: 0, paid: 0 };
    if (r.kind === 'earn') { earned += r.min; byMonth[m].earned += r.min; }
    if (r.kind === 'paid') { paid += -r.min; const pm = r.month || m; byMonth[pm] = byMonth[pm] || { earned: 0, paid: 0 }; byMonth[pm].paid += -r.min; }
    if (r.kind === 'dayoff') {
      used += -r.min;
      const need = -r.min; const cov = Math.max(0, Math.min(need, bal));
      r.covered = cov; r.uncovered = need - cov;
      if (r.uncovered > 0) uncovered[r.ref] = r.uncovered;
    }
    bal += r.min; r.balance = bal;
  }
  return { rows: ev, balance: bal, earned, paid, used, uncovered, byMonth };
}

// ---------- Bani: plăți, confirmări, restanțe ----------
export function moneySummary(state, result, from, to, filter = {}) {
  const T = totalsFor(result, from, to, filter);
  const inRange = (x) => {
    const a = x.periodFrom || x.date, b = x.periodTo || x.date;
    return !(b < from || a > to);
  };
  const byEmp = (x) => !filter.employerId || x.employerId === filter.employerId;
  const payments = (state.payments || []).filter((p) => alive(p) && byEmp(p) && inRange(p));
  const confirmations = (state.confirmations || []).filter((p) => alive(p) && byEmp(p) && inRange(p));
  const received = round2(payments.reduce((t, p) => t + (Number(p.amount) || 0), 0));
  const confirmed = round2(confirmations.reduce((t, p) => t + (Number(p.amount) || 0), 0));
  const estimated = T.money.total;
  const eligible = T.money.eligible;
  return {
    totals: T, estimated, eligible, unconfirmed: T.money.unconfirmed, ineligible: T.money.ineligible,
    confirmed, received,
    outstandingVsEligible: round2(eligible - received),
    outstandingVsConfirmed: confirmations.length ? round2(confirmed - received) : null,
    diffEligibleConfirmed: confirmations.length ? round2(confirmed - eligible) : null,
    payments, confirmations,
  };
}

/** Amprentă pentru detectarea plăților duplicate. */
export function paymentFingerprint(p) {
  return [p.employerId || '', p.date || '', round2(Number(p.amount) || 0), p.currency || '', p.periodFrom || '', p.periodTo || ''].join('|');
}
export function findDuplicatePayment(payments, p) {
  const fp = paymentFingerprint(p);
  return (payments || []).filter(alive).find((x) => x.id !== p.id && (paymentFingerprint(x) === fp ||
    (x.employerId === p.employerId && x.date === p.date && round2(Number(x.amount)) === round2(Number(p.amount))) ||
    (p.reference && x.reference && x.reference === p.reference)));
}

// ---------- Validări acțiuni pontaj ----------
export function openShift(state) {
  return (state.shifts || []).filter((s) => alive(s) && s.start && !s.end).sort((a, b) => toMs(b.start) - toMs(a.start))[0] || null;
}
export function shiftStatus(shift) {
  if (!shift) return 'idle';
  if (shift.end) return 'done';
  if ((shift.breaks || []).some((b) => alive(b) && !b.end)) return 'break';
  return 'working';
}
/** Returnează mesaj de eroare dacă acțiunea nu e permisă în starea curentă, altfel null. */
export function validateAction(state, action) {
  const open = openShift(state);
  const st = shiftStatus(open);
  switch (action) {
    case 'start': return open ? 'Ai deja o zi de lucru pornită. Termin-o înainte de a începe alta.' : null;
    case 'breakStart': return !open ? 'Nu ai pornit munca.' : st === 'break' ? 'Ești deja în pauză.' : null;
    case 'breakEnd': return st !== 'break' ? 'Nu ești în pauză.' : null;
    case 'switch': return !open ? 'Nu ai pornit munca.' : null;
    case 'end': return !open ? 'Nu poți termina munca fără să o fi început.' : null;
    default: return null;
  }
}

/** Verifică suprapuneri între ture (pentru adăugare/corectare manuală). */
export function shiftOverlaps(state, candidate, now = Date.now()) {
  const s = toMs(candidate.start), e = candidate.end ? toMs(candidate.end) : now;
  return (state.shifts || []).filter((x) => alive(x) && x.id !== candidate.id && x.start)
    .filter((x) => { const xs = toMs(x.start), xe = x.end ? toMs(x.end) : now; return xs < e && xe > s; });
}
/** Verifică suprapuneri între segmentele de activitate ale unei ture. */
export function segmentOverlaps(segments, now = Date.now()) {
  const l = (segments || []).filter(alive).map((g) => [toMs(g.start), g.end ? toMs(g.end) : now, g]);
  const out = [];
  for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
    if (l[i][0] < l[j][1] && l[j][0] < l[i][1]) out.push([l[i][2], l[j][2]]);
  }
  return out;
}
export { HOUR, MIN };

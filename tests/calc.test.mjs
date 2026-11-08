// Teste pentru motorul de calcul. Rulare: node tests/calc.test.mjs
import {
  otBank,
  computeAll, totalsFor, compLedger, moneySummary, validateAction, findDuplicatePayment, shiftOverlaps,
  segmentOverlaps, evalNorm, UNCONFIRMED_MSG,
} from '../js/calc.js';
import { zonedToUtc, toIso, localDate, addDays } from '../js/util.js';
import { buildProposals, easterOrthodox, easterWestern } from '../js/holidays.js';

const TZ = 'Europe/Madrid';
let pass = 0, fail = 0;
const results = [];
function t(name, fn) {
  try { fn(); pass++; results.push(['OK  ', name]); } catch (e) { fail++; results.push(['FAIL', name + ' → ' + e.message]); }
}
function eq(a, b, msg = '') { if (Math.abs(a - b) > 1e-6 && a !== b) throw new Error(`${msg} așteptat ${b}, primit ${a}`); }
function ok(v, msg = 'condiție falsă') { if (!v) throw new Error(msg); }
const at = (d, hm) => toIso(zonedToUtc(d, hm, TZ));

let n = 0;
const id = (p) => `${p}_${++n}`;
function baseState(over = {}) {
  return {
    settings: { tz: TZ },
    employers: [{ id: 'E1', name: 'Firma A' }],
    contracts: [{ id: 'C1', employerId: 'E1', name: 'Contract A', country: 'ES', region: 'GA', locality: 'Vigo' }],
    activities: [{ id: 'A1', name: 'Șofer camion' }, { id: 'A2', name: 'Încărcare lemn' }, { id: 'A3', name: 'Muncă în pădure' }],
    policies: [{ id: 'P1', contractId: 'C1', validFrom: '2020-01-01', schedule: { dailyNormMin: 600, weeklyNormMin: 3000, workDays: [1, 2, 3, 4, 5] },
      ot: { basis: 'daily', mode: 'unconfirmed', comp: 'pay' }, holiday: { mode: 'unconfirmed' }, stackMode: 'max' }],
    rates: [{ id: 'R1', employerId: 'E1', validFrom: '2020-01-01', currency: 'EUR', normal: 10, otMultiplier: 1.5, holidayMultiplier: 2 }],
    norms: [], shifts: [], production: [], holidays: [], absences: [], compEntries: [], payments: [], confirmations: [],
    ...over,
  };
}
const policy = (st, patch) => { st.policies[0] = { ...st.policies[0], ...patch, ot: { ...st.policies[0].ot, ...(patch.ot || {}) }, holiday: { ...st.policies[0].holiday, ...(patch.holiday || {}) } }; return st; };
function shift(d, s, e, { breaks = [], segments = [], date2, contractId = 'C1', employerId = 'E1', ...rest } = {}) {
  return { id: id('S'), employerId, contractId, start: at(d, s), end: e ? at(date2 || d, e) : null,
    breaks: breaks.map(([bs, be, bd]) => ({ id: id('B'), start: at(bd || d, bs), end: be ? at(bd || d, be) : null })),
    segments: segments.map(([a, ss, se, sd, ed]) => ({ id: id('G'), activityId: a, start: at(sd || d, ss), end: se ? at(ed || sd || d, se) : null })), ...rest };
}
const NOW = zonedToUtc('2026-12-31', '12:00', TZ);
const run = (st, now = NOW) => computeAll(st, { now, tz: TZ });
const one = (st, now) => [...run(st, now).calc.values()][0];

const D = '2026-03-02'; // luni

// 1–2
t('01 Începerea normală a unei zile (deschisă, calcul în timp real)', () => {
  const st = baseState({ shifts: [shift(D, '08:00', null)] });
  const c = one(st, zonedToUtc(D, '10:30', TZ));
  eq(c.t.effMin, 150); ok(c.t.open); eq(validateAction(st, 'start') !== null, true);
});
t('02 Terminarea normală a unei zile', () => {
  const st = baseState({ shifts: [shift(D, '08:00', '18:00', { breaks: [['12:00', '13:00']] })] });
  const c = one(st); eq(c.t.spanMin, 600); eq(c.t.breakMin, 60); eq(c.t.effMin, 540); ok(!c.t.open);
  eq(validateAction(st, 'end') !== null, true, 'nu se poate termina o zi deja terminată');
});
t('03 Mai multe pauze', () => {
  const c = one(baseState({ shifts: [shift(D, '07:00', '19:00', { breaks: [['09:00', '09:15'], ['12:00', '13:00'], ['16:00', '16:20']] })] }));
  eq(c.t.breakMin, 95); eq(c.t.effMin, 720 - 95);
});
t('04 Uitarea încheierii pauzei (pauza deschisă se închide la finalul zilei, semnalat)', () => {
  const c = one(baseState({ shifts: [shift(D, '08:00', '18:00', { breaks: [['12:00', null]] })] }));
  eq(c.t.breakMin, 360); ok(c.flags.some((f) => f.includes('Pauză neîncheiată')));
  const st2 = baseState({ shifts: [shift(D, '08:00', null, { breaks: [['12:00', null]] })] });
  eq(validateAction(st2, 'breakStart') !== null, true, 'două pauze simultane interzise');
});
t('05 Începerea unei zile de două ori (blocat)', () => {
  const st = baseState({ shifts: [shift(D, '08:00', null)] });
  ok(validateAction(st, 'start')?.includes('deja'));
});
t('06 Terminarea fără începere (blocat)', () => {
  ok(validateAction(baseState(), 'end')?.includes('fără'));
  ok(validateAction(baseState(), 'breakEnd'));
});
t('07 Schimbarea activității în timpul zilei (exemplul din cerințe)', () => {
  const c = one(baseState({ shifts: [shift(D, '07:00', '20:00', {
    breaks: [['13:00', '14:00']],
    segments: [['A1', '07:00', '10:00'], ['A2', '10:00', '13:00'], ['A3', '14:00', '18:00'], ['A1', '18:00', '20:00']] })] }));
  const by = {}; for (const s of c.slices) by[s.activityId] = (by[s.activityId] || 0) + s.min;
  eq(by.A1, 300); eq(by.A2, 180); eq(by.A3, 240); eq(c.t.effMin, 720);
});
t('07b Activități suprapuse accidental – timpul nu se dublează', () => {
  const st = baseState({ shifts: [shift(D, '08:00', '12:00', { segments: [['A1', '08:00', '11:00'], ['A2', '10:00', '12:00']] })] });
  const c = one(st);
  const sum = c.slices.reduce((x, s) => x + s.min, 0);
  eq(sum, 240); eq(c.t.effMin, 240); ok(c.t.overlaps.length === 1);
  ok(segmentOverlaps(st.shifts[0].segments).length === 1);
});
t('08 Program peste miezul nopții', () => {
  const c = one(baseState({ shifts: [shift('2026-03-05', '22:00', '06:00', { date2: '2026-03-06', breaks: [['02:00', '02:30', '2026-03-06']] })] }));
  eq(c.t.effMin, 450); eq(c.date, '2026-03-05');
  eq(c.slices.filter((s) => s.date === '2026-03-05').reduce((x, s) => x + s.min, 0), 120);
  eq(c.slices.filter((s) => s.date === '2026-03-06').reduce((x, s) => x + s.min, 0), 330);
});
t('08b Tură peste schimbarea orei de vară (29.03.2026, 02:00→03:00)', () => {
  const c = one(baseState({ shifts: [shift('2026-03-28', '22:00', '06:00', { date2: '2026-03-29' })] }));
  eq(c.t.effMin, 420, 'ora sărită nu se numără');
});
t('08c Tură peste schimbarea orei de iarnă (25.10.2026, 03:00→02:00)', () => {
  const c = one(baseState({ shifts: [shift('2026-10-24', '22:00', '06:00', { date2: '2026-10-25' })] }));
  eq(c.t.effMin, 540, 'ora repetată se numără');
});
t('09 Începerea la 07:00', () => {
  const c = one(baseState({ shifts: [shift(D, '07:00', '18:00', { breaks: [['12:00', '13:00']] })] }));
  eq(c.t.effMin, 600); eq(c.otMin, 0);
});
t('10 Program cu 10 ore efective și o oră pauză (07:00–18:00)', () => {
  const c = one(baseState({ shifts: [shift(D, '07:00', '18:00', { breaks: [['13:00', '14:00']] })] }));
  eq(c.t.spanMin, 660); eq(c.t.breakMin, 60); eq(c.t.effMin, 600); eq(c.otMin, 0); eq(c.dailyOverMin, 0);
});
t('11 Program 08:00–20:00 cu o oră pauză = 11 ore efective', () => {
  const c = one(baseState({ shifts: [shift(D, '08:00', '20:00', { breaks: [['13:00', '14:00']] })] }));
  eq(c.t.effMin, 660); eq(c.otMin, 60); eq(c.dailyOverMin, 60);
});
// 12–15: 12 ore, normă 10
function day12(mode, prodQty, prodTime = '17:00', normPatch = {}) {
  const st = policy(baseState({
    shifts: [shift(D, '07:00', '20:00', { breaks: [['12:00', '13:00']] })],
    norms: [{ id: 'N1', name: 'Normă lemn', employerId: 'E1', contractId: 'C1', quantity: 30, unit: 'm³', period: 'daily',
      fulfillment: 'incl_overtime', governsOvertime: true, status: 'confirmat', validFrom: '2026-01-01', ...normPatch }],
    production: prodQty == null ? [] : [{ id: 'P1', employerId: 'E1', contractId: 'C1', date: D, time: at(D, prodTime), qty: prodQty, unit: 'm³' }],
  }), { ot: { mode } });
  return one(st);
}
t('12 Zi cu 12 ore efective și normă de 10 ore – nimic nu se pierde', () => {
  const c = day12('if_norm', 10);
  eq(c.t.effMin, 720); eq(c.dailyNormMin, 600); eq(c.otMin, 120);
  eq(c.otEligibleMin + c.otIneligibleMin + c.otUnconfirmedMin, 120, 'cele 2 ore sunt păstrate într-o categorie');
});
t('13 Ore suplimentare eligibile (normă atinsă)', () => {
  const c = day12('if_norm', 35); eq(c.otStatus, 'eligible'); eq(c.otEligibleMin, 120);
  eq(c.money.eligible, 100 + 30, 'bani: 10h×10 + 2h×15'); eq(c.money.ineligible, 0);
});
t('14 Ore suplimentare neeligibile (normă neatinsă) – orele rămân vizibile', () => {
  const c = day12('if_norm', 20);
  eq(c.otStatus, 'ineligible'); eq(c.otIneligibleMin, 120); eq(c.t.effMin, 720);
  eq(c.money.eligible, 100); eq(c.money.ineligible, 30); eq(c.money.total, 130);
});
t('14b Normă atinsă abia în timpul suplimentar + regula "în programul normal" → neeligibil', () => {
  const c = day12('norm_in_normal', 35, '19:30'); eq(c.otStatus, 'ineligible');
  const c2 = day12('norm_incl_ot', 35, '19:30'); eq(c2.otStatus, 'eligible');
  const c3 = day12('norm_in_normal', 35, '15:00'); eq(c3.otStatus, 'eligible');
});
t('15 Ore suplimentare neconfirmate (regulă necunoscută)', () => {
  const c = day12('unconfirmed', 35); eq(c.otStatus, 'unconfirmed'); eq(c.otUnconfirmedMin, 120);
  ok(c.otReason.includes(UNCONFIRMED_MSG)); eq(c.money.unconfirmed, 30); eq(c.money.eligible, 100);
});
t('15b Normă neconfirmată → eligibilitate neconfirmată', () => {
  const c = day12('if_norm', 35, '17:00', { status: 'neconfirmat' }); eq(c.otStatus, 'unconfirmed');
});
t('15c Proporțional cu producția', () => {
  const c = day12('proportional', 15); eq(c.otStatus, 'partial'); eq(c.otEligibleMin, 60); eq(c.otIneligibleMin, 60);
});
// 16–20 producție
t('16 Producție fără normă configurată (nu se inventează necesarul)', () => {
  const st = baseState({ shifts: [shift(D, '08:00', '18:00')], production: [{ id: 'P1', employerId: 'E1', date: D, time: at(D, '10:00'), qty: 12, unit: 'tone' }] });
  const c = one(st); eq(c.normEvals.length, 0);
});
t('17 Producție cu normă zilnică – progres, rest, procent, moment atins', () => {
  const st = baseState({ shifts: [shift(D, '07:00', '20:00', { breaks: [['12:00', '13:00']] })],
    norms: [{ id: 'N1', name: 'n', employerId: 'E1', quantity: 30, unit: 'm³', period: 'daily', fulfillment: 'incl_overtime', status: 'confirmat' }],
    production: [{ id: 'p1', employerId: 'E1', date: D, time: at(D, '10:00'), qty: 12, unit: 'm³' },
      { id: 'p2', employerId: 'E1', date: D, time: at(D, '16:00'), qty: 10, unit: 'm³' },
      { id: 'p3', employerId: 'E1', date: D, time: at(D, '19:00'), qty: 9, unit: 'm³' }] });
  const e = one(st).normEvals[0];
  eq(e.done, 31); eq(e.remaining, 0); eq(e.met, true); eq(e.reachedAt, at(D, '19:00')); eq(e.reachedInNormal, false);
});
t('18 Producție cu normă săptămânală (în curs → neconfirmat, încheiată → decizie)', () => {
  const mk = (q) => baseState({ shifts: [shift(D, '08:00', '18:00')],
    norms: [{ id: 'N1', name: 'n', employerId: 'E1', quantity: 100, unit: 'm³', period: 'weekly', fulfillment: 'incl_overtime', status: 'confirmat' }],
    production: [{ id: 'p1', employerId: 'E1', date: D, time: at(D, '10:00'), qty: q, unit: 'm³' }, { id: 'p2', employerId: 'E1', date: '2026-03-05', qty: 30, unit: 'm³' }] });
  const mid = computeAll(mk(50), { now: zonedToUtc('2026-03-04', '20:00', TZ), tz: TZ });
  const e1 = [...mid.calc.values()][0].normEvals[0];
  eq(e1.met, null); eq(e1.range[0], '2026-03-02'); eq(e1.range[1], '2026-03-08');
  eq([...run(mk(50)).calc.values()][0].normEvals[0].met, false);
  eq([...run(mk(80)).calc.values()][0].normEvals[0].met, true);
});
t('19 Producție introdusă retroactiv (fără oră exactă) – se adună fără dubluri', () => {
  const st = baseState({ shifts: [shift(D, '08:00', '18:00')],
    norms: [{ id: 'N1', name: 'n', employerId: 'E1', quantity: 20, unit: 'tone', period: 'daily', fulfillment: 'before_normal_end', status: 'confirmat' }],
    production: [{ id: 'p1', employerId: 'E1', date: D, time: null, qty: 25, unit: 'tone' }] });
  const e = one(st).normEvals[0]; eq(e.done, 25); eq(e.met, null, 'fără oră nu se poate ști dacă e în programul normal');
  st.production.push({ ...st.production[0] }); // aceeași înregistrare (același ID) din sincronizare
  const uniq = [...new Map(st.production.map((p) => [p.id, p])).values()];
  eq(uniq.length, 1);
});
t('20 Modificarea normei/tarifului fără recalcularea automată a trecutului (reguli înghețate)', () => {
  const st = baseState({ shifts: [shift(D, '08:00', '18:00')] });
  st.shifts[0].frozen = { policy: st.policies[0], rates: [...st.rates], norms: [] };
  st.rates.push({ id: 'R2', employerId: 'E1', validFrom: '2026-01-01', normal: 20, currency: 'EUR' });
  eq(one(st).money.eligible, 100, 'ziua închisă păstrează tariful vechi');
  delete st.shifts[0].frozen; eq(one(st).money.eligible, 200, 'recalculare doar la cerere');
});
// 21–25 sărbători
const HOL = { id: 'H1', date: '2026-03-02', name: 'Test', country: 'ES', scope: 'national', status: 'confirmata' };
t('21 Lucru într-o zi de sărbătoare', () => {
  const c = one(baseState({ holidays: [HOL], shifts: [shift(D, '08:00', '14:00')] }));
  eq(c.holidayMin, 360); eq(c.t.effMin, 360);
});
t('22 Lucru 11 ore într-o zi de sărbătoare', () => {
  const c = one(policy(baseState({ holidays: [HOL], shifts: [shift(D, '08:00', '20:00', { breaks: [['13:00', '14:00']] })] }), { holiday: { mode: 'multiplier' }, ot: { mode: 'always' } }));
  eq(c.t.effMin, 660); eq(c.holidayMin, 660); eq(c.otMin, 60);
  eq(c.money.eligible, 10 * 20 + 1 * 20, 'max(spor 2.0, 1.5) pentru toate orele');
});
t('23 Ore simultan suplimentare și de sărbătoare – totalul nu se dublează', () => {
  const r = run(policy(baseState({ holidays: [HOL], shifts: [shift(D, '08:00', '20:00', { breaks: [['13:00', '14:00']] })] }), { ot: { mode: 'always' } }));
  const T = totalsFor(r, D, D);
  eq(T.effMin, 660); eq(T.holidayMin, 660); eq(T.otMin, 60);
  const sliceSum = [...r.calc.values()][0].slices.reduce((x, s) => x + s.min, 0); eq(sliceSum, 660);
});
t('23b Sărbătoare nespecificată în regiune nu se aplică altei regiuni', () => {
  const c = one(baseState({ holidays: [{ ...HOL, scope: 'regional', region: 'CT' }], shifts: [shift(D, '08:00', '14:00')] }));
  eq(c.holidayMin, 0);
});
t('24 Ore de sărbătoare plătite (tarif special) + regulă neconfirmată → spor neconfirmat', () => {
  const st = baseState({ holidays: [HOL], shifts: [shift(D, '08:00', '12:00')] });
  st.rates[0].holidayRate = 25;
  const c = one(policy(st, { holiday: { mode: 'special_rate' } })); eq(c.money.eligible, 100);
  const c2 = one(policy(baseState({ holidays: [HOL], shifts: [shift(D, '08:00', '12:00')] }), { holiday: { mode: 'unconfirmed' } }));
  eq(c2.money.eligible, 40); eq(c2.money.unconfirmed, 0, 'multiplicator necunoscut ⇒ fără spor inventat');
});
t('25 Ore de sărbătoare compensate cu timp liber + sold', () => {
  const st = policy(baseState({ holidays: [HOL], shifts: [shift(D, '08:00', '19:00', { breaks: [['13:00', '14:00']] })],
    absences: [{ id: 'ab1', type: 'compensatoriu', from: '2026-03-10', to: '2026-03-10', minutes: 240 }] }), { holiday: { mode: 'comp_hours', compRatio: 1 } });
  const r = run(st); const L = compLedger(st, r);
  eq(L.granted, 600); eq(L.used, 240); eq(L.balance, 360);
});
// 26–27 plăți
t('26 Plată parțială → sold restant corect', () => {
  const st = policy(baseState({ shifts: [shift(D, '08:00', '18:00')], payments: [{ id: 'pay1', employerId: 'E1', date: '2026-03-31', amount: 60, periodFrom: '2026-03-01', periodTo: '2026-03-31' }] }), { ot: { mode: 'always' } });
  const S = moneySummary(st, run(st), '2026-03-01', '2026-03-31');
  eq(S.eligible, 100); eq(S.received, 60); eq(S.outstandingVsEligible, 40);
});
t('27 Aceeași plată de două ori – detectată', () => {
  const p = { id: 'a', employerId: 'E1', date: '2026-03-31', amount: 60, currency: 'EUR' };
  ok(findDuplicatePayment([p], { ...p, id: 'b' })); ok(!findDuplicatePayment([p], { ...p, id: 'b', amount: 61 }));
});
t('31 Corectarea unei zile (suprapunere detectată la adăugare manuală)', () => {
  const st = baseState({ shifts: [shift(D, '08:00', '18:00')] });
  eq(shiftOverlaps(st, { id: 'new', start: at(D, '17:00'), end: at(D, '19:00') }).length, 1);
  eq(shiftOverlaps(st, { id: 'new', start: at(D, '18:00'), end: at(D, '19:00') }).length, 0);
});
t('33 Schimbarea tarifului pentru o perioadă nouă (istoric pe date)', () => {
  const st = policy(baseState({ shifts: [shift(D, '08:00', '18:00'), shift('2026-04-06', '08:00', '18:00')] }), { ot: { mode: 'always' } });
  st.rates[0].validTo = '2026-03-31';
  st.rates.push({ id: 'R2', employerId: 'E1', validFrom: '2026-04-01', normal: 12, currency: 'EUR' });
  const r = run(st);
  eq(totalsFor(r, '2026-03-01', '2026-03-31').money.eligible, 100);
  eq(totalsFor(r, '2026-04-01', '2026-04-30').money.eligible, 120);
});
t('34 Mai mulți angajatori – totaluri separate, norme separate', () => {
  const st = baseState({ shifts: [shift(D, '06:00', '10:00'), shift(D, '14:00', '20:00', { employerId: 'E2', contractId: 'C2' })] });
  st.employers.push({ id: 'E2', name: 'Firma B' });
  st.contracts.push({ id: 'C2', employerId: 'E2', country: 'FR' });
  st.policies.push({ id: 'P2', contractId: 'C2', validFrom: '2020-01-01', schedule: { dailyNormMin: 300 }, ot: { mode: 'always' } });
  st.rates.push({ id: 'R9', employerId: 'E2', validFrom: '2020-01-01', normal: 20, currency: 'EUR' });
  const r = run(st);
  eq(totalsFor(r, D, D, { employerId: 'E1' }).effMin, 240);
  eq(totalsFor(r, D, D, { employerId: 'E2' }).effMin, 360);
  eq(totalsFor(r, D, D, { employerId: 'E2' }).otMin, 60, 'normă separată pe contract');
  eq(totalsFor(r, D, D).effMin, 600);
});
t('Extra: OT pe bază săptămânală', () => {
  const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'];
  const st = policy(baseState({ shifts: days.map((d) => shift(d, '07:00', '18:00')) }), { ot: { basis: 'weekly', mode: 'always' } });
  const T = totalsFor(run(st), '2026-03-02', '2026-03-08');
  eq(T.effMin, 3300); eq(T.otMin, 300);
});
t('Extra: sărbători propuse sunt neconfirmate; Paște corect', () => {
  eq(easterWestern(2026), '2026-04-05'); eq(easterOrthodox(2026), '2026-04-12'); eq(easterOrthodox(2025), '2025-04-20');
  const p = buildProposals('ES', 'GA', 2026); ok(p.every((h) => h.status === 'neconfirmata')); ok(p.some((h) => h.date === '2026-07-25'));
});
t('Extra: sărbătoare neconfirmată → spor în categoria "neconfirmat"', () => {
  const st = policy(baseState({ holidays: [{ ...HOL, status: 'neconfirmata' }], shifts: [shift(D, '08:00', '12:00')] }), { holiday: { mode: 'multiplier' } });
  const c = one(st); eq(c.holidayMin, 240); eq(c.money.eligible, 40); eq(c.money.unconfirmed, 40);
});
t('Extra: suprascriere manuală a eligibilității pe zi', () => {
  const st = policy(baseState({ shifts: [shift(D, '07:00', '20:00', { breaks: [['12:00', '13:00']], otOverride: 'eligible' })] }), { ot: { mode: 'unconfirmed' } });
  eq(one(st).otStatus, 'eligible');
});

t('Extra: sâmbătă și sărbătoare – toate orele extra (ca pe foaia din octombrie)', () => {
  const st = baseState({ holidays: [{ ...HOL, date: '2026-10-12', status: 'confirmata' }],
    shifts: [shift('2026-10-03', '09:00', '11:30'), shift('2026-10-12', '08:00', '10:30'), shift('2026-10-13', '08:00', '20:00', { breaks: [['12:00', '13:00']] })] });
  st.policies[0].schedule = { ...st.policies[0].schedule, workDays: [1, 2, 3, 4, 5], offDayAllOvertime: true, holidayAllOvertime: true };
  const T = totalsFor(run(st), '2026-10-01', '2026-10-31');
  eq(T.effMin, 16 * 60); eq(T.otMin, 6 * 60);
});

t('Banca de ore extra: plată parțială, zi liberă acoperită și neacoperită', () => {
  const st = baseState({ shifts: ['2026-10-05', '2026-10-06', '2026-10-07'].map((d) => shift(d, '08:00', '20:00', { breaks: [['12:00', '13:00']] })) });
  st.otPayments = [{ id: 'op1', date: '2026-10-31', month: '2026-10', minutes: 60 }];
  st.absences = [{ id: 'a1', type: 'recuperare', from: '2026-11-03', to: '2026-11-03', minutes: 600 }];
  const B = otBank(st, run(st));
  eq(B.earned, 180); eq(B.paid, 60); eq(B.used, 600); eq(B.balance, 180 - 60 - 600);
  eq(B.uncovered.a1, 480, 'acoperit doar 2h din 10h');
  eq(B.byMonth['2026-10'].earned, 180); eq(B.byMonth['2026-10'].paid, 60);
});

for (const [s, m] of results) console.log(s, m);
console.log(`\n${pass} trecute, ${fail} eșuate`);
process.exit(fail ? 1 : 0);

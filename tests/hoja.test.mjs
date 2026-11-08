// Teste pentru foaia de ore (spaniolă) cu zile libere din ore extra și plăți. Rulare: node tests/hoja.test.mjs
import { computeAll } from '../js/calc.js';
import { buildHoja } from '../js/hoja.js';
import { toCSV } from '../js/export.js';
import { zonedToUtc, toIso } from '../js/util.js';

const TZ = 'Europe/Madrid';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('OK  ', n); } catch (e) { fail++; console.log('FAIL', n, '→', e.message); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'fals'); };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); };
const TYPES = { shift: 'shifts', absence: 'absences', otpay: 'otPayments', comp: 'compEntries', holiday: 'holidays' };

function mkState() {
  return {
    settings: { tz: TZ, activeContractId: 'C', workerName: 'Manuel' },
    employers: [{ id: 'E', name: 'Larreta' }], contracts: [{ id: 'C', employerId: 'E', country: 'ES', region: 'NA', locality: 'Arano' }],
    policies: [{ id: 'P', contractId: 'C', validFrom: '2000-01-01', schedule: { dailyNormMin: 600, workDays: [1, 2, 3, 4, 5], offDayAllOvertime: true, holidayAllOvertime: true }, ot: { mode: 'unconfirmed' } }],
    locations: [{ id: 'L', name: 'Arano', country: 'ES', region: 'NA', locality: 'Arano' }],
    shifts: [], absences: [], otPayments: [], compEntries: [], holidays: [], rates: [], norms: [], production: [], activities: [], payments: [], confirmations: [], expenses: [],
  };
}
let k = 0;
const day = (st, d, s = '08:00', e = '20:00', br = ['12:00', '13:00']) => st.shifts.push({ id: `s${++k}`, employerId: 'E', contractId: 'C', locationId: 'L', date: d, start: toIso(zonedToUtc(d, s, TZ)), end: toIso(zonedToUtc(d, e, TZ)),
  breaks: br ? [{ id: `b${k}`, start: toIso(zonedToUtc(d, br[0], TZ)), end: toIso(zonedToUtc(d, br[1], TZ)) }] : [] });
function appOf(st) {
  const R = computeAll(st, { tz: TZ, now: Date.parse('2026-12-31T12:00:00Z') });
  const all = new Map(); for (const k2 of Object.keys(st)) if (Array.isArray(st[k2])) for (const d of st[k2]) all.set(d.id, d);
  return { calc: () => R, tz: TZ, state: () => st, settings: () => st.settings, activeContract: () => st.contracts[0],
    store: { list: (type) => (st[TYPES[type]] || []).filter((x) => !x.deleted), get: (id) => all.get(id) } };
}
// Octombrie: 5 zile × 1h extra; noiembrie: fiesta 2.11 (11h extra) + 3–6.11 (4h extra)
function base() {
  const st = mkState();
  for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) day(st, d);
  st.holidays.push({ id: 'h', date: '2026-11-02', name: 'Fiesta Arano', country: 'ES', scope: 'local', region: 'NA', locality: 'Arano', status: 'confirmata' });
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) day(st, d);
  return st;
}
const obsText = (r) => r.observaciones.join('\n');

t('1. Lună fără zile libere/plăți: fără Observaciones, doar TOTAL HORAS EXTRA', () => {
  const r = buildHoja(appOf(base()), '2026-11');
  eq(r.observaciones.length, 0); eq(r.summaryLines.length, 1); eq(r.summaryLines[0].text, 'TOTAL HORAS EXTRA = 15 h');
});
t('2. Zi liberă din ore extra acoperită: rând clar + observație + sold corect', () => {
  const st = base(); st.absences.push({ id: 'a1', type: 'recuperare', from: '2026-11-09', to: '2026-11-09', minutes: 600 });
  const r = buildHoja(appOf(st), '2026-11');
  const row = r.sections[0].rows.find((x) => x.fecha === '09.11.2026');
  eq(row.horario, 'LIBRE – COMPENSA 10 h EXTRA'); eq(row.total, ''); eq(row.extra, '');
  ok(obsText(r).includes('09.11.2026 (lunes): día libre compensado con 10 h de horas extra acumuladas.'), obsText(r));
  ok(obsText(r).includes('anterior 5 h + generadas este mes 15 h − compensadas con días libres 10 h − pagadas 0 h = 10 h pendientes a 30.11.2026'), obsText(r));
  eq(r.summaryLines[0].text, 'TOTAL HORAS EXTRA = 15 h', 'totalul orelor extra lucrate nu se schimbă');
});
t('3. Plată ore extra din octombrie făcută în noiembrie', () => {
  const st = base(); st.otPayments.push({ id: 'p1', date: '2026-11-08', month: '2026-10', minutes: 300 });
  const r = buildHoja(appOf(st), '2026-11');
  ok(obsText(r).includes('08.11.2026: pagadas 5 h extra correspondientes a octubre 2026.'), obsText(r));
  ok(obsText(r).includes('= 15 h pendientes'), obsText(r));
  eq(buildHoja(appOf(st), '2026-10').observaciones.length, 0, 'octombrie nu are mișcări');
});
t('4. Zi liberă neacoperită: se vede câte ore lipsesc, sold negativ', () => {
  const st = mkState(); day(st, '2026-11-03'); day(st, '2026-11-04');
  st.absences.push({ id: 'a2', type: 'recuperare', from: '2026-11-05', to: '2026-11-05', minutes: 600 });
  const r = buildHoja(appOf(st), '2026-11');
  ok(obsText(r).includes('(2 h cubiertas por el saldo, 8 h sin cubrir)'), obsText(r));
  ok(obsText(r).includes('= −8 h pendientes'), obsText(r));
});
t('5. Ore lucrate DUPĂ ziua liberă nu o acoperă înapoi', () => {
  const st = mkState(); st.absences.push({ id: 'a3', type: 'recuperare', from: '2026-11-02', to: '2026-11-02', minutes: 600 });
  day(st, '2026-11-03', '06:00', '20:00');
  const r = buildHoja(appOf(st), '2026-11');
  ok(obsText(r).includes('(0 h cubiertas por el saldo, 10 h sin cubrir)'), obsText(r));
});
t('6. Zi liberă în decembrie acoperită de soldul din lunile trecute', () => {
  const st = base(); st.absences.push({ id: 'a4', type: 'recuperare', from: '2026-12-01', to: '2026-12-01', minutes: 600 });
  const r = buildHoja(appOf(st), '2026-12');
  ok(obsText(r).includes('anterior 20 h + generadas este mes 0 h − compensadas con días libres 10 h − pagadas 0 h = 10 h'), obsText(r));
  eq(r.sections[0].rows.length, 1); eq(r.summaryLines[0].text, 'TOTAL HORAS EXTRA = 0 h');
});
t('7. Sold: anterior + generate − compensate − plătite = final (mai multe mișcări)', () => {
  const st = base();
  st.absences.push({ id: 'a5', type: 'recuperare', from: '2026-11-10', to: '2026-11-10', minutes: 300 });
  st.otPayments.push({ id: 'p2', date: '2026-11-20', month: '2026-11', minutes: 120 });
  st.compEntries.push({ id: 'c1', date: '2026-11-21', minutes: -60, note: 'corectare' });
  const r = buildHoja(appOf(st), '2026-11');
  ok(obsText(r).includes('anterior 5 h + generadas este mes 15 h − compensadas con días libres 5 h − pagadas 2 h − ajustes 1 h = 12 h'), obsText(r));
  ok(obsText(r).includes('ajuste del saldo −1 h (corectare)'), obsText(r));
});
t('8. Zi liberă obișnuită (nu din ore extra) nu apare în observații', () => {
  const st = base(); st.absences.push({ id: 'a6', type: 'liber', from: '2026-11-09', to: '2026-11-09' });
  const r = buildHoja(appOf(st), '2026-11');
  eq(r.sections[0].rows.find((x) => x.fecha === '09.11.2026').horario, 'LIBRE'); eq(r.observaciones.length, 0);
});
t('9. Zi liberă ștearsă: dispare din foaie și soldul revine', () => {
  const st = base(); st.absences.push({ id: 'a7', type: 'recuperare', from: '2026-11-09', to: '2026-11-09', minutes: 600, deleted: true });
  const r = buildHoja(appOf(st), '2026-11');
  ok(!r.sections[0].rows.some((x) => x.fecha === '09.11.2026')); eq(r.observaciones.length, 0);
});
t('10. Ore la jumătate (7,5 h) se scriu cu virgulă', () => {
  const st = base(); st.absences.push({ id: 'a8', type: 'recuperare', from: '2026-11-09', to: '2026-11-09', minutes: 450 });
  const r = buildHoja(appOf(st), '2026-11');
  eq(r.sections[0].rows.find((x) => x.fecha === '09.11.2026').horario, 'LIBRE – COMPENSA 7,5 h EXTRA');
});
t('11. CSV/Excel conține și observațiile', () => {
  const st = base(); st.absences.push({ id: 'a9', type: 'recuperare', from: '2026-11-09', to: '2026-11-09', minutes: 600 });
  const csv = toCSV(buildHoja(appOf(st), '2026-11'));
  ok(csv.includes('OBSERVACIONES') && csv.includes('día libre compensado'), 'lipsesc observațiile din CSV');
});
t('12. Ziua de fiesta lucrată rămâne corectă (11 h extra)', () => {
  const r = buildHoja(appOf(base()), '2026-11');
  const row = r.sections[0].rows.find((x) => x.fecha === '02.11.2026');
  eq(row.dia, 'LUNES (FIESTA)'); eq(row.extra, 11);
});
console.log(`\n${pass} trecute, ${fail} eșuate`); process.exit(fail ? 1 : 0);

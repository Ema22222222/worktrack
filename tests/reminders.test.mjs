// Teste pentru logica notificărilor trimise de pe server. Rulare: node tests/reminders.test.mjs
import { evaluate } from '../scripts/send-reminders.mjs';
import { zonedToUtc, toIso } from '../js/util.js';
const TZ = 'Europe/Madrid';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('OK  ', n); } catch (e) { fail++; console.log('FAIL', n, '→', e.message); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); };
const base = () => ({ settings: { tz: TZ, activeContractId: 'C' }, contracts: [{ id: 'C', employerId: 'E', country: 'ES' }], policies: [{ id: 'P', contractId: 'C', validFrom: '2000-01-01', schedule: { dailyNormMin: 600, usualStart: '08:00', usualEnd: '20:00', workDays: [1, 2, 3, 4, 5] }, ot: { mode: 'unconfirmed' } }],
  shifts: [], absences: [], holidays: [], rates: [], norms: [], production: [], employers: [], activities: [], locations: [], compEntries: [], payments: [], confirmations: [], expenses: [] });
const D = '2026-11-09'; // luni
const at = (hm, d = D) => zonedToUtc(d, hm, TZ);
const keys = (st, now) => evaluate(st, now).map((r) => r.key.split('|')[0]);
t('Nimic dimineața devreme', () => eq(keys(base(), at('08:20')), []));
t('Ai uitat să începi (08:50)', () => eq(keys(base(), at('08:50')), ['start']));
t('Weekend: fără reminder de start', () => eq(keys(base(), at('09:00', '2026-11-08')), []));
t('Concediu: fără reminder', () => { const s = base(); s.absences.push({ from: D, to: D, type: 'concediu' }); eq(keys(s, at('09:00')), []); });
t('Seara fără zi trecută (21:45)', () => eq(keys(base(), at('21:45')), ['missing']));
t('Pauză uitată', () => { const s = base(); s.shifts.push({ id: 'S', employerId: 'E', contractId: 'C', start: toIso(at('08:00')), end: null, breaks: [{ id: 'b', start: toIso(at('12:00')), end: null }] }); eq(keys(s, at('13:30')), ['break']); });
t('Peste normă + uitat să închei', () => { const s = base(); s.shifts.push({ id: 'S', employerId: 'E', contractId: 'C', start: toIso(at('08:00')), end: null, breaks: [{ id: 'b', start: toIso(at('12:00')), end: toIso(at('13:00')) }] }); eq(keys(s, at('21:10')), ['over', 'end']); });
t('Zi închisă: nimic', () => { const s = base(); s.shifts.push({ id: 'S', employerId: 'E', contractId: 'C', start: toIso(at('08:00')), end: toIso(at('20:00')), breaks: [] }); eq(keys(s, at('21:45')), []); });
console.log(`\n${pass} trecute, ${fail} eșuate`); process.exit(fail ? 1 : 0);

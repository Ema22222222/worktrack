// Teste pentru logica notificărilor trimise de pe server. Rulare: node tests/reminders.test.mjs
import { evaluate } from '../scripts/send-reminders.mjs';
import { zonedToUtc, toIso } from '../js/util.js';
const TZ = 'Europe/Madrid';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('OK  ', n); } catch (e) { fail++; console.log('FAIL', n, '→', e.message); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); };
const base = () => ({ settings: { tz: TZ, activeContractId: 'C' }, contracts: [{ id: 'C', employerId: 'E', country: 'ES' }], policies: [{ id: 'P', contractId: 'C', validFrom: '2000-01-01', schedule: { dailyNormMin: 600, usualStart: '08:00', usualEnd: '20:00', breakStart: '12:00', breakMin: 60, workDays: [1, 2, 3, 4, 5] }, ot: { mode: 'unconfirmed' } }],
  shifts: [], absences: [], holidays: [], rates: [], norms: [], production: [], employers: [], activities: [], locations: [], compEntries: [], payments: [], confirmations: [], expenses: [] });
const D = '2026-11-09'; // luni
const at = (hm, d = D) => zonedToUtc(d, hm, TZ);
const keys = (st, now) => evaluate(st, now).map((r) => r.key.split('|')[0]);
t('Nimic dimineața devreme (07:54)', () => eq(keys(base(), at('07:54')), []));
t('07:55 fără START: „08:00 începe programul (în 5 min)”', () => { const r = evaluate(base(), at('07:55')); eq(r.map((x) => x.key.split('|')[0]), ['start']); if (!/în 5 min/.test(r[0].title)) throw new Error(r[0].title); });
t('Fără preaviz (leadMin 0): abia la 08:00', () => { const s = base(); s.settings.reminders = { leadMin: 0 }; eq(keys(s, at('07:59')), []); eq(keys(s, at('08:00')), ['start']); });
t('Mod vechi (fără ora exactă): abia la 08:15', () => { const s = base(); s.settings.reminders = { fixedTimes: false }; eq(keys(s, at('08:10')), []); eq(keys(s, at('08:15')), ['start']); });
t('Weekend: fără reminder de start', () => eq(keys(base(), at('09:00', '2026-11-08')), []));
t('Concediu: fără reminder', () => { const s = base(); s.absences.push({ from: D, to: D, type: 'concediu' }); eq(keys(s, at('09:00')), []); });
t('Seara fără zi trecută (20:30)', () => eq(keys(base(), at('20:30')), ['missing']));
t('Pauză uitată', () => { const s = base(); s.shifts.push({ id: 'S', employerId: 'E', contractId: 'C', start: toIso(at('08:00')), end: null, breaks: [{ id: 'b', start: toIso(at('12:00')), end: null }] }); eq(keys(s, at('13:30')), ['break']); });
t('Peste normă + uitat să închei', () => { const s = base(); s.shifts.push({ id: 'S', employerId: 'E', contractId: 'C', start: toIso(at('08:00')), end: null, breaks: [{ id: 'b', start: toIso(at('12:00')), end: toIso(at('13:00')) }] }); eq(keys(s, at('19:55')), ['over', 'end']); });
t('Ziua pornită, 19:54: doar „peste normă”', () => { const s = base(); s.shifts.push({ id: 'S', employerId: 'E', contractId: 'C', start: toIso(at('08:00')), end: null, breaks: [{ id: 'b', start: toIso(at('12:00')), end: toIso(at('13:00')) }] }); eq(keys(s, at('19:54')), ['over']); });
t('Ziua întreagă: 07:55 → 11:55 → 12:55 → 19:55', () => { const seq = []; const s = base(); const chk = (h) => seq.push(h + ':' + keys(s, at(h)).filter((k) => k !== 'over').join('+')); chk('07:54'); chk('07:55'); s.shifts.push({ id: 'S', employerId: 'E', contractId: 'C', start: toIso(at('08:00')), end: null, breaks: [] }); chk('11:54'); chk('11:55'); s.shifts[0].breaks.push({ id: 'b', start: toIso(at('12:00')), end: null }); chk('12:54'); chk('12:55'); s.shifts[0].breaks[0].end = toIso(at('13:00')); chk('19:54'); chk('19:55'); eq(seq, ['07:54:', '07:55:start', '11:54:', '11:55:pauza', '12:54:', '12:55:break', '19:54:', '19:55:end']); });
t('Zi închisă: nimic', () => { const s = base(); s.shifts.push({ id: 'S', employerId: 'E', contractId: 'C', start: toIso(at('08:00')), end: toIso(at('20:00')), breaks: [] }); eq(keys(s, at('21:45')), []); });
const open = (brk) => { const s = base(); s.shifts.push({ id: 'S', employerId: 'E', contractId: 'C', start: toIso(at('08:00')), end: null, breaks: brk || [] }); return s; };
t('Zi pornită, 11:54: nimic', () => eq(keys(open(), at('11:54')), []));
t('Zi pornită, 11:55 fără pauză: „începe pauza”', () => eq(keys(open(), at('11:55')), ['pauza']));
t('Pauza deja pornită la 12:00: fără „ora pauzei”', () => eq(keys(open([{ id: 'b', start: toIso(at('12:00')), end: null }]), at('12:05')), []));
t('Pauză pornită 12:00, la 12:55: „reîncepe lucrul”', () => eq(keys(open([{ id: 'b', start: toIso(at('12:00')), end: null }]), at('12:55')), ['break']));
t('Pauză pornită 12:00, la 12:54: nimic', () => eq(keys(open([{ id: 'b', start: toIso(at('12:00')), end: null }]), at('12:54')), []));
t('Pauză începută târziu (12:40): memento la 13:35, nu imediat', () => { const s = open([{ id: 'b', start: toIso(at('12:40')), end: null }]); eq(keys(s, at('12:50')), []); eq(keys(s, at('13:34')), []); eq(keys(s, at('13:35')), ['break']); });
t('Pauză încheiată, 15:00: nimic', () => eq(keys(open([{ id: 'b', start: toIso(at('12:00')), end: toIso(at('13:00')) }]), at('15:00')), []));
t('Fără pauză în program: nu întreabă de pauză', () => { const s = open(); s.policies[0].schedule.breakMin = 0; eq(keys(s, at('12:30')), []); });
t('Pauza dezactivată din setări', () => { const s = open(); s.settings.reminders = { breakPrompt: false }; eq(keys(s, at('12:30')), []); });
t('Zi completată dimineața (închisă): nimic toată ziua', () => { const s = base(); s.shifts.push({ id: 'S', employerId: 'E', contractId: 'C', start: toIso(at('08:00')), end: toIso(at('20:00')), breaks: [{ id: 'b', start: toIso(at('12:00')), end: toIso(at('13:00')) }] }); for (const h of ['08:15', '12:00', '13:00', '20:15', '20:30']) eq(keys(s, at(h)), []); });
t('Pauză începută 12:20: memento tot la 12:55', () => eq(keys(open([{ id: 'b', start: toIso(at('12:20')), end: null }]), at('12:55')), ['break']));
console.log(`\n${pass} trecute, ${fail} eșuate`); process.exit(fail ? 1 : 0);

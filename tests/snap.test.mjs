// Teste: ora apăsată aproape de ora din program se trece ca ora din program. Rulare: node tests/snap.test.mjs
import { snapTime, breakStart, breakEnd, endWork } from '../js/actions.js';
import { computeAll } from '../js/calc.js';
import { zonedToUtc, toIso, localTime } from '../js/util.js';
const TZ = 'Europe/Madrid', D = '2026-11-12';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('OK  ', n); } catch (e) { fail++; console.log('FAIL', n, '→', e.message); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); };
const at = (hm) => zonedToUtc(D, hm, TZ);
const hm = (ms) => localTime(ms, TZ);
function mkApp(settings = {}) {
  const docs = new Map();
  const base = { settings: { tz: TZ, activeContractId: 'C', ...settings }, employers: [{ id: 'E', name: 'X' }], contracts: [{ id: 'C', employerId: 'E', country: 'ES' }],
    policies: [{ id: 'P', contractId: 'C', validFrom: '2000-01-01', schedule: { dailyNormMin: 600, workDays: [1, 2, 3, 4, 5], usualStart: '08:00', usualEnd: '20:00', breakStart: '12:00', breakMin: 60 }, ot: { mode: 'unconfirmed' } }],
    absences: [], holidays: [], rates: [], norms: [], production: [], activities: [], locations: [], compEntries: [], payments: [], confirmations: [], expenses: [], otPayments: [] };
  const app = {
    tz: TZ, settings: () => base.settings, activeContract: () => base.contracts[0],
    state: () => ({ ...base, shifts: [...docs.values()].filter((d) => !d.deleted) }),
    store: { get: (id) => docs.get(id), put: (type, o) => { const id = o.id || 'S'; const b = { ...(docs.get(id) || {}), ...o, id, _t: type }; docs.set(id, b); return b; } },
  };
  app.open = (startHm) => app.store.put('shift', { id: 'S', employerId: 'E', contractId: 'C', date: D, start: toIso(at(startHm)), end: null, breaks: [], segments: [] });
  app.totals = () => { const c = computeAll(app.state(), { tz: TZ, now: at('23:00') }).calc.get('S'); return { lucrat: c.t.effMin / 60, pauza: c.t.breakMin / 60, extra: c.otMin / 60 }; };
  return app;
}
const A = mkApp();
t('START la 07:56 → 08:00', () => eq(hm(snapTime(A, at('07:56'), 'start')), '08:00'));
t('START la 08:09 → 08:00', () => eq(hm(snapTime(A, at('08:09'), 'start')), '08:00'));
t('START la 08:11 → rămâne 08:11 (prea departe)', () => eq(hm(snapTime(A, at('08:11'), 'start')), '08:11'));
t('TERMINĂ la 20:05 → 20:00', () => eq(hm(snapTime(A, at('20:05'), 'end')), '20:00'));
t('TERMINĂ la 19:52 → 20:00', () => eq(hm(snapTime(A, at('19:52'), 'end')), '20:00'));
t('TERMINĂ la 20:25 → rămâne 20:25', () => eq(hm(snapTime(A, at('20:25'), 'end')), '20:25'));
t('Rotunjire oprită (0 min): rămâne ora apăsată', () => eq(hm(snapTime(mkApp({ snapMin: 0 }), at('08:03'), 'start')), '08:03'));
t('Zi completă apăsată 08:03 / 12:02 / 13:02 / 20:05 → 11 h, pauză 1 h, 1 h extra', () => {
  const a = mkApp(); a.open(hm(snapTime(a, at('08:03'), 'start')));
  breakStart(a, { at: at('12:02'), snap: true }); breakEnd(a, { at: at('13:02'), snap: true });
  endWork(a, { at: snapTime(a, at('20:05'), 'end', D), pressedAt: at('20:05') });
  const s = a.store.get('S'); eq([hm(Date.parse(s.start)), hm(Date.parse(s.breaks[0].start)), hm(Date.parse(s.breaks[0].end)), hm(Date.parse(s.end))], ['08:00', '12:00', '13:00', '20:00']);
  eq(a.totals(), { lucrat: 11, pauza: 1, extra: 1 });
  eq([s.breaks[0].pressedStart != null, s.breaks[0].pressedEnd != null, s.endPressed != null], [true, true, true]);
});
t('Pauză începută târziu (12:30), terminată 13:33 → 13:30 (1 h)', () => {
  const a = mkApp(); a.open('08:00'); breakStart(a, { at: at('12:30'), snap: true }); const r = breakEnd(a, { at: at('13:33'), snap: true });
  eq(hm(r.at), '13:30'); eq(a.store.get('S').breaks[0].start, toIso(at('12:30')));
});
t('Pauză reală mai lungă (12:00 → 13:20) → rămâne 13:20', () => {
  const a = mkApp(); a.open('08:00'); breakStart(a, { at: at('12:00'), snap: true }); eq(hm(breakEnd(a, { at: at('13:20'), snap: true }).at), '13:20');
});
t('Pauză scurtă la 10:00 (cafea) → nu se mută la 12:00', () => {
  const a = mkApp(); a.open('08:00'); eq(hm(breakStart(a, { at: at('10:00'), snap: true }).at), '10:00'); eq(hm(breakEnd(a, { at: at('10:15'), snap: true }).at), '10:15');
});
t('Ora exactă apăsată: nu se salvează „ora apăsată” în plus', () => {
  const a = mkApp(); a.open('08:00'); breakStart(a, { at: at('12:00'), snap: true }); eq(a.store.get('S').breaks[0].pressedStart, undefined);
});
console.log(`\n${pass} trecute, ${fail} eșuate`); process.exit(fail ? 1 : 0);

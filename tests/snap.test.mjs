// Teste: ora apăsată aproape de ora din program se trece ca ora din program. Rulare: node tests/snap.test.mjs
import { snapTime, breakStart, breakEnd, endWork, normalizeShift } from '../js/actions.js';
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
t('START la 08:05 → 08:00', () => eq(hm(snapTime(A, at('08:05'), 'start')), '08:00'));
t('START la 08:30 → 08:00 (limita de 30 min)', () => eq(hm(snapTime(A, at('08:30'), 'start')), '08:00'));
t('START la 08:31 → rămâne 08:31', () => eq(hm(snapTime(A, at('08:31'), 'start')), '08:31'));
t('Secundele se scot: 08:40:40 → 08:41', () => eq(new Date(snapTime(A, at('08:40') + 40000, 'start')).getUTCSeconds(), 0));
t('TERMINĂ la 20:05 → 20:00', () => eq(hm(snapTime(A, at('20:05'), 'end')), '20:00'));
t('TERMINĂ la 19:50 → 20:00', () => eq(hm(snapTime(A, at('19:50'), 'end')), '20:00'));
t('TERMINĂ la 20:25 → 20:00', () => eq(hm(snapTime(A, at('20:25'), 'end')), '20:00'));
t('TERMINĂ la 20:45 → rămâne 20:45 (ore extra reale)', () => eq(hm(snapTime(A, at('20:45'), 'end')), '20:45'));
t('Rotunjire oprită (0 min): rămâne ora apăsată', () => eq(hm(snapTime(mkApp({ snapMin: 0 }), at('08:03'), 'start')), '08:03'));
t('Zi completă apăsată 08:03 / 12:02 / 13:02 / 20:05 → 11 h, pauză 1 h, 1 h extra', () => {
  const a = mkApp(); a.open(hm(snapTime(a, at('08:03'), 'start')));
  breakStart(a, { at: at('12:02'), snap: true }); breakEnd(a, { at: at('13:02'), snap: true });
  endWork(a, { at: snapTime(a, at('20:05'), 'end', D), pressedAt: at('20:05') });
  const s = a.store.get('S'); eq([hm(Date.parse(s.start)), hm(Date.parse(s.breaks[0].start)), hm(Date.parse(s.breaks[0].end)), hm(Date.parse(s.end))], ['08:00', '12:00', '13:00', '20:00']);
  eq(a.totals(), { lucrat: 11, pauza: 1, extra: 1 });
  eq([s.breaks[0].pressedStart != null, s.breaks[0].pressedEnd != null, s.endPressed != null], [true, true, true]);
});
t('Pauză începută târziu (12:40), terminată 13:42 → 13:40 (1 h)', () => {
  const a = mkApp(); a.open('08:00'); breakStart(a, { at: at('12:40'), snap: true }); const r = breakEnd(a, { at: at('13:42'), snap: true });
  eq(hm(r.at), '13:40'); eq(a.store.get('S').breaks[0].start, toIso(at('12:40')));
});
t('Pauză 12:00 → 13:20 → 13:00 (sub 30 min diferență)', () => {
  const a = mkApp(); a.open('08:00'); breakStart(a, { at: at('12:00'), snap: true }); eq(hm(breakEnd(a, { at: at('13:20'), snap: true }).at), '13:00');
});
t('Pauză 12:00 → 13:45 → rămâne 13:45 (pauză reală mai lungă)', () => {
  const a = mkApp(); a.open('08:00'); breakStart(a, { at: at('12:00'), snap: true }); eq(hm(breakEnd(a, { at: at('13:45'), snap: true }).at), '13:45');
});
t('Pauză scurtă la 10:00 (cafea) → nu se mută la 12:00', () => {
  const a = mkApp(); a.open('08:00'); eq(hm(breakStart(a, { at: at('10:00'), snap: true }).at), '10:00'); eq(hm(breakEnd(a, { at: at('10:15'), snap: true }).at), '10:15');
});
t('Ora exactă apăsată: nu se salvează „ora apăsată” în plus', () => {
  const a = mkApp(); a.open('08:00'); breakStart(a, { at: at('12:00'), snap: true }); eq(a.store.get('S').breaks[0].pressedStart, undefined);
});
// ---- Zilele tale reale din noiembrie (din PDF) ----
const day = (s0, b0, b1, e0, sec = 0) => ({ id: 'S', employerId: 'E', contractId: 'C', date: D, start: toIso(at(s0) + sec), end: toIso(at(e0)), breaks: b0 ? [{ id: 'b', start: toIso(at(b0)), end: toIso(at(b1)) }] : [], segments: [] });
const fix = (sh) => { const a = mkApp(); a.store.put('shift', sh); const p = normalizeShift(a, sh); if (p) a.store.put('shift', p); const x = a.store.get('S'); return { ore: [x.start, ...x.breaks.flatMap((b) => [b.start, b.end]), x.end].map((v) => hm(Date.parse(v))).join(' '), ...a.totals(), original: !!x.original }; };
t('10.11: 08:00–12:00 | 13:00–20:17 → 20:00, 11 h / 1 extra', () => eq(fix(day('08:00', '12:00', '13:00', '20:17')), { ore: '08:00 12:00 13:00 20:00', lucrat: 11, pauza: 1, extra: 1, original: true }));
t('11.11: 07:59–12:03 | 13:04–20:01 → program curat', () => eq(fix(day('07:59', '12:03', '13:04', '20:01')), { ore: '08:00 12:00 13:00 20:00', lucrat: 11, pauza: 1, extra: 1, original: true }));
t('12.11: 08:03–12:05 | 13:00–20:00 → pauză 1, 11 h', () => eq(fix(day('08:03', '12:05', '13:00', '20:00')), { ore: '08:00 12:00 13:00 20:00', lucrat: 11, pauza: 1, extra: 1, original: true }));
t('18.11: secunde la start (10,99) → 11 h', () => eq(fix(day('08:00', '12:00', '13:00', '20:00', 40000)), { ore: '08:00 12:00 13:00 20:00', lucrat: 11, pauza: 1, extra: 1, original: true }));
t('Zi deja curată: nu se schimbă nimic', () => { const a = mkApp(); eq(normalizeShift(a, day('08:00', '12:00', '13:00', '20:00')), null); });
t('5.10 zi în două bucăți (06:00–15:30 și 16:30–20:00): neatinsă', () => { const a = mkApp(); eq(normalizeShift(a, { ...day('06:00', null, null, '15:30') }), null); eq(normalizeShift(a, { ...day('16:30', null, null, '20:00'), id: 'S2' })?.start, undefined); });
t('1.10: 08–13, pauză 13–15, până la 20: neatins', () => { const a = mkApp(); eq(normalizeShift(a, day('08:00', '13:00', '15:00', '20:00')), null); });
t('Ore extra reale: 08:00–21:00 rămâne 21:00 (12 h, 2 extra)', () => eq(fix(day('08:00', '12:00', '13:00', '21:00')), { ore: '08:00 12:00 13:00 21:00', lucrat: 12, pauza: 1, extra: 2, original: false }));
t('Început târziu real 09:00 rămâne 09:00', () => eq(fix(day('09:00', '12:00', '13:00', '20:00')).ore, '09:00 12:00 13:00 20:00'));
t('Sâmbătă 08:05–13:10 → 08:00–13:10 (sfârșitul nu e lângă 20:00)', () => eq(fix(day('08:05', null, null, '13:10')).ore, '08:00 13:10'));
t('Rotunjire oprită (0): rămân orele, dar fără secunde', () => { const a = mkApp({ snapMin: 0 }); const p = normalizeShift(a, day('08:03', '12:00', '13:00', '20:00', 40000)); eq(hm(Date.parse(p.start)), '08:04'); });
console.log(`\n${pass} trecute, ${fail} eșuate`); process.exit(fail ? 1 : 0);

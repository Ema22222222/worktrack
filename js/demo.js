// demo.js — date de exemplu pentru cine vrea să vadă rapid cum arată aplicația „plină”.
// Toate înregistrările au demo:true și pot fi șterse dintr-un singur buton.
import { dateRange, monthStart, monthEnd, addDays, dowOf, toIso } from './util.js';
import { freezeRules } from './actions.js';
import { buildDay } from './pages/month.js';
import { DEFAULT_ACTIVITIES } from './editors.js';
import { toast, confirmDialog } from './ui.js';

const O = { reason: 'Date de exemplu', undoable: false };

export const demoDocs = (app) => [...app.store.docs.values()].filter((d) => d.demo && !d.deleted);
export const hasDemo = (app) => demoDocs(app).length > 0;

/** Încarcă o lună trecută completă și luna curentă până ieri: fiesta lucrată, sâmbătă, zi liberă din ore extra, plată ore extra. */
export function loadDemo(app) {
  if (app.employers().length) { toast('Ai deja date. Datele de exemplu se pot încărca doar într-un cont gol.', { bad: true }); return false; }
  const today = app.today();
  const prev = monthStart(addDays(monthStart(today), -1));
  const prevEnd = monthEnd(prev);
  const wd = (a, b) => [...dateRange(a, b)].filter((d) => dowOf(d) <= 5);
  const prevDays = wd(prev, prevEnd);
  const curDays = wd(monthStart(today), addDays(today, -1));
  const fiesta = prevDays[1];
  const dayOff = prevDays[prevDays.length - 3];
  const saturday = [...dateRange(prev, prevEnd)].find((d) => dowOf(d) === 6);

  app.saveSettings({ tz: 'Europe/Madrid', currency: 'EUR' }, 'Date de exemplu');
  const e = app.store.put('employer', { name: 'Firma Demo', country: 'ES', currency: 'EUR', demo: true }, O);
  const c = app.store.put('contract', { employerId: e.id, name: 'Contract principal', country: 'ES', region: 'NA', locality: 'Arano', from: prev, to: null, demo: true }, O);
  app.store.put('policy', {
    contractId: c.id, validFrom: '2000-01-01', validTo: null, reason: 'Date de exemplu', demo: true,
    schedule: { dailyNormMin: 600, weeklyNormMin: null, monthlyNormMin: null, usualStart: '08:00', usualEnd: '20:00', breakStart: '12:00', breakMin: 60, breakCount: 1, workDays: [1, 2, 3, 4, 5], offDayAllOvertime: true, holidayAllOvertime: true },
    ot: { basis: 'daily', mode: 'unconfirmed', comp: 'pay', compRatio: 1 }, holiday: { mode: 'unconfirmed', compRatio: 1 }, stackMode: 'max',
  }, O);
  const loc = app.store.put('location', { name: 'Arano', country: 'ES', region: 'NA', locality: 'Arano', kind: 'santier', demo: true }, O);
  for (const [name, color] of DEFAULT_ACTIVITIES) app.store.put('activity', { name, color, demo: true }, O);
  app.store.put('holiday', { date: fiesta, name: 'Fiesta Arano (exemplu)', country: 'ES', scope: 'local', region: 'NA', locality: 'Arano', status: 'confirmata', demo: true }, O);
  app.saveSettings({ activeContractId: c.id }, 'Date de exemplu');

  const addShift = (d, t) => {
    const b = buildDay(app, d, t); if (b.error) return;
    const sh = { employerId: e.id, contractId: c.id, date: d, start: toIso(b.start), end: toIso(b.end), breaks: b.breaks.map((x, i) => ({ id: `demo-brk-${d}-${i}`, ...x })),
      segments: [], notes: '', settlement: {}, source: 'date de exemplu', locationId: loc.id, demo: true };
    sh.frozen = freezeRules(app.state(), sh, d);
    app.store.put('shift', sh, O);
  };
  const std = { start: '08:00', end: '20:00', breakStart: '12:00', breakEnd: '13:00' };
  for (const d of [...prevDays, ...curDays]) if (d !== dayOff) addShift(d, std);
  if (saturday) addShift(saturday, { start: '08:00', end: '13:00' });
  app.store.put('absence', { type: 'recuperare', from: dayOff, to: dayOff, minutes: 600, employerId: e.id, note: 'Exemplu', demo: true }, O);
  app.store.put('otpay', { minutes: 600, month: prev.slice(0, 7), date: curDays[0] || today, note: 'Exemplu', demo: true }, O);
  return true;
}

export async function removeDemo(app) {
  const list = demoDocs(app);
  if (!list.length) return;
  const ok = await confirmDialog(`Ștergi datele de exemplu (${list.length} înregistrări)? Ce ai trecut tu rămâne neatins.`, { danger: true, okLabel: 'Șterge exemplele' });
  if (!ok) return;
  const contractIds = new Set(list.filter((d) => d._t === 'contract').map((d) => d.id));
  for (const d of list) app.store.remove(d.id, 'Ștergere date de exemplu');
  if (contractIds.has(app.settings().activeContractId)) app.saveSettings({ activeContractId: null }, 'Ștergere date de exemplu');
  toast('Datele de exemplu au fost șterse.');
  app.go('azi');
}

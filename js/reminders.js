// reminders.js — remindere afișate în aplicație (și notificare de sistem doar dacă browserul o permite).
// Notificările nu sunt garantate cu aplicația închisă; remindere apar sigur când deschizi aplicația.
import { localTime, localDate, toMs, dowOf, zonedToUtc, fmtDur, addDays } from './util.js';
import { shiftStatus, moneySummary } from './calc.js';

function dismissed() { try { return JSON.parse(localStorage.getItem('wt.rem.dismissed') || '{}'); } catch { return {}; } }
function setDismissed(o) { try { localStorage.setItem('wt.rem.dismissed', JSON.stringify(o)); } catch { /* ignorat */ } }

export function activeReminders(app) {
  const s = app.settings(); const rc = s.reminders;
  if (!rc.enabled || !app.employers().length) return [];
  const out = [];
  const st = app.state(); const R = app.calc(); const now = Date.now(); const today = app.today();
  const open = app.openShift();
  const contract = app.activeContract();
  const pol = contract && st.policies.filter((p) => p.contractId === contract.id && !p.deleted).sort((a, b) => (b.validFrom || '').localeCompare(a.validFrom || ''))[0];
  const sch = pol?.schedule || {};
  const workday = (sch.workDays || [1, 2, 3, 4, 5]).includes(dowOf(today));
  const startedToday = [...R.calc.values()].some((c) => c.date === today);
  const onLeave = st.absences.some((a) => !a.deleted && a.from <= today && (a.to || a.from) >= today && a.type !== 'compensatoriu');
  if (workday && !open && !startedToday && !onLeave && sch.usualStart) {
    const late = zonedToUtc(today, sch.usualStart, app.tz) + (rc.startLateMin || 45) * 60000;
    if (now > late && now < late + 6 * 3600000) out.push({ key: `start|${today}`, title: 'Ai uitat să începi programul?', text: `Ora obișnuită este ${sch.usualStart}.`, action: 'Am început deja – corectez ora', run: (a) => import('./editors.js').then((m) => m.editShift(a, null, { date: today })) });
  }
  if (open) {
    const c = R.calc.get(open.id);
    const brk = (open.breaks || []).find((b) => !b.deleted && !b.end);
    if (brk && now - toMs(brk.start) > (rc.breakLongMin || 75) * 60000) out.push({ key: `break|${brk.id}`, title: 'Pauza este încă deschisă', text: `din ${localTime(toMs(brk.start), app.tz)} (${fmtDur((now - toMs(brk.start)) / 60000)}).`, level: 'warn' });
    if (rc.overNorm && c?.dailyNormMin != null && c.t.effMin > c.dailyNormMin) out.push({ key: `over|${c.date}`, title: 'Ai depășit programul normal.', text: `+${fmtDur(c.t.effMin - c.dailyNormMin)} peste norma zilnică.`, level: 'info' });
    if (sch.usualEnd && c) {
      const endT = zonedToUtc(c.date, sch.usualEnd, app.tz) + (rc.endLateMin || 60) * 60000;
      if (now > endT) out.push({ key: `end|${c.date}`, title: 'Ai uitat să închei ziua?', text: `Ziua e deschisă de la ${localTime(c.t.start, app.tz)}.`, level: 'warn' });
    }
    if (localDate(toMs(open.start), app.tz) < addDays(today, -1)) out.push({ key: `stale|${open.id}`, title: 'Zi rămasă deschisă de mai mult timp', text: 'Corectează ora de terminare.', level: 'bad', action: 'Corectează', run: (a) => import('./editors.js').then((m) => m.editShift(a, open.id)) });
  }
  if (rc.noProduction) {
    const y = [...R.calc.values()].filter((c) => !c.t.open && c.normEvals?.length && c.date >= addDays(today, -3) && !R.production.some((p) => p.date === c.date));
    for (const c of y.slice(-1)) out.push({ key: `prod|${c.date}`, title: 'Nu ai înregistrat producția', text: `pentru ${c.date}.`, action: 'Adaugă', run: (a) => import('./editors.js').then((m) => m.editProduction(a, null, { date: c.date })) });
  }
  if (rc.incomplete) {
    const inc = [...R.calc.values()].filter((c) => !c.t.open && (c.shift.breaks || []).some((b) => !b.deleted && !b.end));
    if (inc.length) out.push({ key: `inc|${inc.length}`, title: 'Înregistrări incomplete', text: `${inc.length} zile cu pauze neînchise.`, action: 'Vezi calendarul', run: (a) => a.go('calendar') });
  }
  if (rc.paymentsOverdueDays) {
    const lim = addDays(today, -rc.paymentsOverdueDays);
    const from = addDays(lim, -365);
    const S = moneySummary(st, R, from, lim);
    if (S.outstandingVsEligible > 1 && S.totals.effMin > 0) out.push({ key: `pay|${lim.slice(0, 7)}`, title: 'Plăți restante', text: `Sume eligibile mai vechi de ${rc.paymentsOverdueDays} zile încă neîncasate (aprox. ${S.outstandingVsEligible.toFixed(2)} ${app.cur}).`, level: 'info', action: 'Vezi banii', run: (a) => a.go('bani') });
  }
  const dis = dismissed();
  return out.filter((r) => !dis[r.key]);
}

let notified = new Set();
export function checkReminders(app) {
  let list;
  try { list = activeReminders(app); } catch { return; }
  if (app.route === 'azi' && !document.querySelector('.overlay')) app.refresh();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || window.wtWeb?.push?.enabled) return;
  for (const r of list) {
    if (notified.has(r.key)) continue; // fără duplicate
    notified.add(r.key);
    try { new Notification('WorkTrack', { body: `${r.title} ${r.text}`, tag: r.key }); } catch { /* indisponibil */ }
  }
}
export function dismissReminder(key) { const d = dismissed(); d[key] = Date.now(); setDismissed(d); }

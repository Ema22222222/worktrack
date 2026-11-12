// send-reminders.mjs — rulează pe GitHub Actions la fiecare 5 minute.
// Citește pontajul fiecărui utilizator care a activat notificările și trimite alerta potrivită o singură dată.
// Folosește aceleași calcule ca aplicația (js/calc.js).
import { computeAll, resolvePolicy, holidayFor } from '../js/calc.js';
import { localDate, zonedToUtc, dowOf, toMs, fmtDur, localTime } from '../js/util.js';
import { ADMIN_UIDS } from '../js/web/config.js';

const DRY = process.argv.includes('--dry');
let admin, db;
const SITE = process.env.SITE_URL || 'https://ema22222222.github.io/worktrack/';
const TYPES = { employer: 'employers', contract: 'contracts', activity: 'activities', rate: 'rates', policy: 'policies', norm: 'norms', shift: 'shifts', production: 'production', holiday: 'holidays', absence: 'absences', comp: 'compEntries', payment: 'payments', confirmation: 'confirmations', expense: 'expenses', location: 'locations' };
const DEF = { enabled: true, fixedTimes: true, leadMin: 5, breakPrompt: true, startLateMin: 15, breakLongMin: 75, overNorm: true, endLateMin: 15, noProduction: true, incomplete: true, eveningMissing: true };

export function evaluate(state, now) {
  const s = state.settings || {};
  const rc = { ...DEF, ...(s.reminders || {}) };
  if (!rc.enabled) return [];
  const tz = s.tz || 'Europe/Madrid';
  const today = localDate(now, tz);
  const contract = state.contracts.find((c) => c.id === s.activeContractId) || state.contracts[0];
  if (!contract) return [];
  const pol = resolvePolicy(state, contract.id, today);
  const sch = pol?.schedule || {};
  const start = sch.usualStart || '08:00';
  const end = sch.usualEnd || '20:00';
  const workday = (sch.workDays || [1, 2, 3, 4, 5]).includes(dowOf(today));
  const R = computeAll(state, { tz, now });
  const open = state.shifts.filter((x) => x.start && !x.end).sort((a, b) => toMs(b.start) - toMs(a.start))[0];
  const todays = [...R.calc.values()].filter((c) => c.date === today);
  const absent = state.absences.some((a) => a.from <= today && (a.to || a.from) >= today);
  const hol = holidayFor(state, contract, today);
  const lead = rc.fixedTimes ? Math.max(0, Number(rc.leadMin) || 0) * 60000 : 0;
  const soon = lead ? ` (în ${Math.round(lead / 60000)} min)` : '';
  const out = [];
  const add = (key, title, body) => out.push({ key, title, body });
  if (process.env.WT_DEBUG) console.log('diagnostic', JSON.stringify({ today, ora: localTime(now, tz), tz, zi_de_lucru: workday, ture_azi: todays.length, tura_deschisa: !!open, absent, sarbatoare: !!hol, start, end }));

  if (!open && !todays.length && workday && !absent && !hol) {
    const late = zonedToUtc(today, start, tz) + (rc.fixedTimes ? 0 : rc.startLateMin) * 60000 - lead;
    if (now >= late && now < late + 4 * 3600000) add(`start|${today}`, `${start} – începe programul${soon}`, `Apasă START MUNCĂ în WorkTrack. Dacă apeși între ${localTime(zonedToUtc(today, start, tz) - 10 * 60000, tz)} și ${localTime(zonedToUtc(today, start, tz) + 10 * 60000, tz)}, se trece ${start}.`);
    const evening = zonedToUtc(today, end, tz) + 30 * 60000;
    if (rc.eveningMissing && now >= evening && now < evening + 2 * 3600000) add(`missing|${today}`, 'Nu ai trecut ziua de azi', 'Deschide WorkTrack și pune programul de azi (sau marchează zi liberă).');
  }
  if (open) {
    const c = R.calc.get(open.id);
    const brk = (open.breaks || []).find((b) => !b.deleted && !b.end);
    const bMin = Number(sch.breakMin) || 0;
    const anyBreak = (open.breaks || []).some((b) => !b.deleted);
    const dOpen = c?.date || today;
    // Pauza: la ora pauzei din program (ex. 12:00), dacă ziua e pornită și încă n-ai luat pauză.
    if (rc.breakPrompt !== false && bMin > 0 && sch.breakStart && !anyBreak) {
      const bs = zonedToUtc(dOpen, sch.breakStart, tz);
      if (now >= bs - lead && now < bs + 3 * 3600000) add(`pauza|${dOpen}`, `${sch.breakStart} – începe pauza${soon}`, 'Apasă PAUZĂ în WorkTrack când intri în pauză.');
    }
    // Pauza deschisă: la ora de sfârșit a pauzei din program (ex. 13:00); altfel după durata pauzei.
    if (brk) {
      const bStart = toMs(brk.start);
      const planEnd = bMin > 0 && sch.breakStart ? zonedToUtc(dOpen, sch.breakStart, tz) + bMin * 60000 : null;
      const due = rc.fixedTimes && planEnd && bStart <= planEnd - 30 * 60000 ? planEnd
        : bStart + (bMin > 0 ? Math.min(bMin, rc.breakLongMin) : rc.breakLongMin) * 60000;
      if (now >= Math.max(due - lead, bStart + 10 * 60000)) add(`break|${brk.id}`, `${localTime(due, tz)} – reîncepe lucrul${now < due ? soon : ''}`, `Pauza a început la ${localTime(bStart, tz)}. Apasă TERMINĂ PAUZA când reîncepi.`);
    }
    if (rc.overNorm && c?.dailyNormMin != null && c.t.effMin > c.dailyNormMin) add(`over|${c.date}`, 'Ai trecut de norma zilnică', `Ai lucrat ${fmtDur(c.t.effMin)}. De acum orele sunt extra.`);
    const endAt = zonedToUtc(c?.date || today, end, tz) + (rc.fixedTimes ? 0 : rc.endLateMin) * 60000 - lead;
    if (now >= endAt) add(`end|${c?.date || today}`, `${end} – se termină programul${now < endAt + lead ? soon : ''}`, `Apasă TERMINĂ MUNCA în WorkTrack. Se trece ${end} dacă apeși cu cel mult 10 minute înainte sau după.`);
  }
  return out;
}

/** Pentru administrator: o notificare pentru fiecare cerere nouă de acces (o singură dată). */
export function accessRequests(pending) {
  return pending.map((d) => ({ key: `acces|${d.id}`, title: 'Cerere nouă de acces', body: `${d.get('email') || d.get('name') || 'Cineva'} vrea să folosească WorkTrack. Deschide Utilizatori ca să aprobi sau să refuzi.`, link: '#utilizatori' }));
}

async function loadState(uid) {
  const snap = await db.collection(`users/${uid}/docs`).get();
  const st = { settings: null }; for (const k of Object.values(TYPES)) st[k] = [];
  for (const d of snap.docs) { const x = d.data(); if (!x || x.deleted) continue; if (x._t === 'settings') st.settings = x; else if (TYPES[x._t]) st[TYPES[x._t]].push(x); }
  return st;
}

async function main() {
  const SA0 = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!SA0) { console.log('Lipsește secretul FIREBASE_SERVICE_ACCOUNT – nu se trimit notificări.'); return; }
  admin = (await import('firebase-admin')).default;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA0)) });
  db = admin.firestore();
  if (process.env.WT_TEST_PUSH) { await testPush(); return; }
  // GitHub pornește rularea programată cam o dată pe oră; în interiorul ei verificăm la fiecare 5 minute.
  const loopMin = Number(process.env.WT_LOOP_MIN || 0);
  const t0 = Date.now();
  do {
    try { await tick(); } catch (e) { console.error('eroare la verificare', e?.message || e); }
    if (Date.now() - t0 + 5 * 60000 > loopMin * 60000) break;
    await new Promise((r) => setTimeout(r, 5 * 60000));
  } while (true);
}

async function testPush() {
  const snap = await db.collectionGroup('push').get();
  const toks = snap.docs.filter((d) => ADMIN_UIDS.includes(d.ref.parent.parent?.id)).map((d) => d.get('token'));
  console.log(`Test: ${toks.length} dispozitive.`);
  if (!toks.length) return;
  const res = await admin.messaging().sendEachForMulticast({ tokens: toks, webpush: { notification: { title: 'Test WorkTrack', body: 'Notificările funcționează. Dacă vezi mesajul ăsta, totul e în regulă.', icon: `${SITE}icons/icon-192.png`, tag: 'test' }, fcmOptions: { link: `${SITE}#azi` } } });
  res.responses.forEach((x, i) => console.log(`dispozitiv ${i + 1}:`, x.success ? 'trimis' : 'eroare ' + (x.error?.code || '')));
}

async function tick() {
  const now = Date.now();
  const tokSnap = await db.collectionGroup('push').get();
  const byUser = new Map();
  for (const d of tokSnap.docs) {
    const uid = d.ref.parent.parent?.id; if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push({ ref: d.ref, token: d.get('token') });
  }
  console.log(`${byUser.size} utilizatori cu notificări active.`);
  // Acces: doar administratorul și conturile aprobate primesc notificări.
  const accSnap = await db.collection('access').get();
  const access = new Map(accSnap.docs.map((d) => [d.id, d.data()]));
  const pending = accSnap.docs.filter((d) => d.get('status') === 'asteptare');
  for (const [uid, toks] of byUser) {
    const state = await loadState(uid);
    const rem = ADMIN_UIDS.includes(uid) ? accessRequests(pending) : [];
    if (!ADMIN_UIDS.includes(uid) && access.get(uid)?.status !== 'activ') continue;
    rem.push(...evaluate(state, now));
    if (!rem.length) continue;
    const metaRef = db.doc(`users/${uid}/meta/notify`);
    const sent = (await metaRef.get()).get('sent') || {};
    const fresh = rem.filter((r) => !sent[r.key]);
    for (const r of fresh) {
      console.log(`→ ${uid.slice(0, 6)}… ${r.key}`);
      if (DRY) continue;
      const res = await admin.messaging().sendEachForMulticast({
        tokens: toks.map((t) => t.token),
        webpush: { notification: { title: r.title, body: r.body, icon: `${SITE}icons/icon-192.png`, tag: r.key }, fcmOptions: { link: `${SITE}${r.link || '#azi'}` } },
      });
      console.log(`  trimis: ${res.successCount}/${toks.length}`);
      res.responses.forEach((x, i) => {
        const c = x.error?.code || '';
        if (c.includes('registration-token-not-registered') || c.includes('invalid-registration-token') || c.includes('invalid-argument')) toks[i].ref.delete().catch(() => {});
        else if (x.error) console.warn('eroare trimitere', c);
      });
      sent[r.key] = now;
    }
    if (fresh.length && !DRY) {
      const week = now - 8 * 86400000;
      for (const k of Object.keys(sent)) if (sent[k] < week) delete sent[k];
      await metaRef.set({ sent }, { merge: false });
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

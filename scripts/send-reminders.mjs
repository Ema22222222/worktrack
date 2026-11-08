// send-reminders.mjs — rulează pe GitHub Actions la fiecare 15 minute.
// Citește pontajul fiecărui utilizator care a activat notificările și trimite alerta potrivită o singură dată.
// Folosește aceleași calcule ca aplicația (js/calc.js).
import { computeAll, resolvePolicy, holidayFor } from '../js/calc.js';
import { localDate, zonedToUtc, dowOf, toMs, fmtDur, localTime } from '../js/util.js';

const DRY = process.argv.includes('--dry');
let admin, db;
const SITE = process.env.SITE_URL || 'https://ema22222222.github.io/worktrack/';
const TYPES = { employer: 'employers', contract: 'contracts', activity: 'activities', rate: 'rates', policy: 'policies', norm: 'norms', shift: 'shifts', production: 'production', holiday: 'holidays', absence: 'absences', comp: 'compEntries', payment: 'payments', confirmation: 'confirmations', expense: 'expenses', location: 'locations' };
const DEF = { enabled: true, startLateMin: 45, breakLongMin: 75, overNorm: true, endLateMin: 60, noProduction: true, incomplete: true, eveningMissing: true };

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
  const out = [];
  const add = (key, title, body) => out.push({ key, title, body });

  if (!open && !todays.length && workday && !absent && !hol) {
    const late = zonedToUtc(today, start, tz) + rc.startLateMin * 60000;
    if (now >= late && now < late + 4 * 3600000) add(`start|${today}`, 'Ai uitat să începi programul?', `Programul tău începe la ${start}. Apasă START sau trece ora corectă.`);
    const evening = zonedToUtc(today, '21:30', tz);
    if (rc.eveningMissing && now >= evening && now < evening + 2 * 3600000) add(`missing|${today}`, 'Nu ai trecut ziua de azi', 'Deschide WorkTrack și pune programul de azi (sau marchează zi liberă).');
  }
  if (open) {
    const c = R.calc.get(open.id);
    const brk = (open.breaks || []).find((b) => !b.deleted && !b.end);
    if (brk && now - toMs(brk.start) > rc.breakLongMin * 60000) add(`break|${brk.id}`, 'Pauza este încă deschisă', `Pauza a început la ${localTime(toMs(brk.start), tz)}. Ai uitat să apeși TERMINĂ PAUZA?`);
    if (rc.overNorm && c?.dailyNormMin != null && c.t.effMin > c.dailyNormMin) add(`over|${c.date}`, 'Ai trecut de norma zilnică', `Ai lucrat ${fmtDur(c.t.effMin)}. De acum orele sunt extra.`);
    const endAt = zonedToUtc(c?.date || today, end, tz) + rc.endLateMin * 60000;
    if (now >= endAt) add(`end|${c?.date || today}`, 'Ai uitat să închei ziua?', `Ziua e pornită de la ${localTime(toMs(open.start), tz)}. Apasă TERMINĂ MUNCA sau corectează ora.`);
  }
  return out;
}

async function loadState(uid) {
  const snap = await db.collection(`users/${uid}/docs`).get();
  const st = { settings: null }; for (const k of Object.values(TYPES)) st[k] = [];
  for (const d of snap.docs) { const x = d.data(); if (!x || x.deleted) continue; if (x._t === 'settings') st.settings = x; else if (TYPES[x._t]) st[TYPES[x._t]].push(x); }
  return st;
}

async function main() {
  const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!SA) { console.log('Lipsește secretul FIREBASE_SERVICE_ACCOUNT – nu se trimit notificări.'); return; }
  admin = (await import('firebase-admin')).default;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
  db = admin.firestore();
  const now = Date.now();
  const tokSnap = await db.collectionGroup('push').get();
  const byUser = new Map();
  for (const d of tokSnap.docs) {
    const uid = d.ref.parent.parent?.id; if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push({ ref: d.ref, token: d.get('token') });
  }
  console.log(`${byUser.size} utilizatori cu notificări active.`);
  for (const [uid, toks] of byUser) {
    const state = await loadState(uid);
    const rem = evaluate(state, now);
    if (!rem.length) continue;
    const metaRef = db.doc(`users/${uid}/meta/notify`);
    const sent = (await metaRef.get()).get('sent') || {};
    const fresh = rem.filter((r) => !sent[r.key]);
    for (const r of fresh) {
      console.log(`→ ${uid.slice(0, 6)}… ${r.key}`);
      if (DRY) continue;
      const res = await admin.messaging().sendEachForMulticast({
        tokens: toks.map((t) => t.token),
        webpush: { notification: { title: r.title, body: r.body, icon: `${SITE}icons/icon-192.png`, tag: r.key }, fcmOptions: { link: `${SITE}#azi` } },
      });
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

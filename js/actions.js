// actions.js — operațiunile de pontaj (start, pauză, schimbare activitate, final) și înghețarea regulilor.
import { validateAction, resolvePolicy, openShift, pickVersion } from './calc.js';
import { uid, localDate, toIso, zonedToUtc, localTime } from './util.js';

/** Copie a regulilor în vigoare pentru o zi (pentru ca modificările viitoare să nu schimbe trecutul). */
export function freezeRules(state, shift, date) {
  const policy = resolvePolicy(state, shift.contractId, date);
  const rates = (state.rates || []).filter((r) => !r.deleted && r.employerId === shift.employerId).map(stripMeta);
  const norms = (state.norms || []).filter((n) => !n.deleted && n.employerId === shift.employerId).map(stripMeta);
  return { at: new Date().toISOString(), policy: policy ? stripMeta(policy) : null, rates, norms };
}
function stripMeta(x) { const { history, ...r } = x; return r; }

export function getLocation(app) {
  if (!app.settings().gps || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 8000);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => { if (done) return; done = true; clearTimeout(t); resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy), at: toIso(p.timestamp || Date.now()), source: 'gps' }); },
        () => { if (done) return; done = true; clearTimeout(t); resolve(null); },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 },
      );
    } catch { done = true; clearTimeout(t); resolve(null); }
  });
}

/** Orele din program pentru o zi: start, început pauză, sfârșit pauză, final (ms UTC). */
export function planTimes(app, date) {
  const c = app.activeContract();
  const s = (c && resolvePolicy(app.state(), c.id, date)?.schedule) || {};
  const mk = (hm) => (hm ? zonedToUtc(date, hm, app.tz) : null);
  const bs = Number(s.breakMin) > 0 ? mk(s.breakStart) : null;
  return { start: mk(s.usualStart), breakStart: bs, breakEnd: bs != null ? bs + Number(s.breakMin) * 60000 : null, end: mk(s.usualEnd) };
}
/** Dacă ai apăsat aproape de ora din program (± câteva minute, din Setări), se trece ora din program. */
export function snapTime(app, at, kind, date = localDate(at, app.tz)) {
  const tol = Number(app.settings().snapMin ?? 10);
  if (!(tol > 0)) return at;
  const p = planTimes(app, date)[kind];
  return p != null && Math.abs(at - p) <= tol * 60000 ? p : at;
}
export const snapNote = (app, pressed, used) => (Math.abs(pressed - used) >= 60000 ? ` (ora din program; ai apăsat la ${localTime(pressed, app.tz)})` : '');

function fail(msg) { const e = new Error(msg); e.user = true; throw e; }

export function startWork(app, { activityId, at = Date.now(), note = '', locationId = null, geo = null, contractId, pressedAt = null } = {}) {
  const st = app.state();
  const err = validateAction(st, 'start'); if (err) fail(err);
  const contract = app.store.get(contractId) || app.activeContract();
  if (!contract) fail('Configurează mai întâi angajatorul și contractul.');
  const iso = toIso(at);
  const shift = {
    employerId: contract.employerId, contractId: contract.id, date: localDate(at, app.tz), start: iso, end: null,
    breaks: [], segments: activityId ? [{ id: uid('seg'), activityId, start: iso, end: null, locationId, geo }] : [],
    notes: note, locationId: locationId || null, startLoc: { locationId, geo }, endLoc: null, settlement: {},
    ...(pressedAt && Math.abs(pressedAt - at) >= 60000 ? { startPressed: toIso(pressedAt) } : {}),
  };
  return app.store.put('shift', shift, { action: 'START MUNCĂ', undoLabel: 'Start muncă' });
}

export function breakStart(app, { at = Date.now(), note = '', snap = false } = {}) {
  const st = app.state();
  const err = validateAction(st, 'breakStart'); if (err) fail(err);
  const sh = openShift(st);
  const pressed = at;
  if (snap) at = Math.max(snapTime(app, at, 'breakStart', localDate(Date.parse(sh.start), app.tz)), Date.parse(sh.start));
  const b = { id: uid('brk'), start: toIso(at), end: null, note, ...(Math.abs(pressed - at) >= 60000 ? { pressedStart: toIso(pressed) } : {}) };
  app.store.put('shift', { id: sh.id, breaks: [...(sh.breaks || []), b] }, { action: 'ÎNCEPE PAUZĂ', undoLabel: 'Începe pauză' });
  return { at, pressed };
}

export function breakEnd(app, { at = Date.now(), snap = false } = {}) {
  const st = app.state();
  const err = validateAction(st, 'breakEnd'); if (err) fail(err);
  const sh = openShift(st);
  const pressed = at;
  const ob = sh.breaks.find((b) => !b.deleted && !b.end);
  if (snap) {
    // Pauza începută la ora din program → se termină la ora din program (13:00);
    // începută mai târziu → se termină după durata pauzei din program (1h), dacă ai apăsat aproape de ea.
    const tol = Number(app.settings().snapMin ?? 10) * 60000;
    const P = planTimes(app, localDate(Date.parse(sh.start), app.tz));
    const st0 = Date.parse(ob.start);
    if (tol > 0 && P.breakStart != null) {
      const target = Math.abs(st0 - P.breakStart) <= tol ? P.breakEnd : st0 + (P.breakEnd - P.breakStart);
      if (Math.abs(at - target) <= tol) at = target;
    }
  }
  at = Math.max(at, Date.parse(ob.start));
  const breaks = sh.breaks.map((b) => (b === ob ? { ...b, end: toIso(at), ...(Math.abs(pressed - at) >= 60000 ? { pressedEnd: toIso(pressed) } : {}) } : b));
  app.store.put('shift', { id: sh.id, breaks }, { action: 'TERMINĂ PAUZĂ', undoLabel: 'Termină pauza' });
  return { at, pressed };
}

export function switchActivity(app, { activityId, at = Date.now(), locationId = null, geo = null } = {}) {
  const st = app.state();
  const err = validateAction(st, 'switch'); if (err) fail(err);
  const sh = openShift(st);
  const iso = toIso(at);
  const cur = (sh.segments || []).find((g) => !g.deleted && !g.end);
  if (cur && cur.activityId === activityId) fail('Lucrezi deja la această activitate.');
  const segments = (sh.segments || []).map((g) => (!g.deleted && !g.end ? { ...g, end: iso, endGeo: geo } : g));
  segments.push({ id: uid('seg'), activityId, start: iso, end: null, locationId, geo });
  return app.store.put('shift', { id: sh.id, segments }, { action: 'SCHIMBĂ ACTIVITATEA', undoLabel: 'Schimbare activitate' });
}

export function endWork(app, { at = Date.now(), note, locationId = null, geo = null, pressedAt = null } = {}) {
  const st = app.state();
  const err = validateAction(st, 'end'); if (err) fail(err);
  const sh = openShift(st);
  const iso = toIso(Math.max(at, Date.parse(sh.start)));
  const breaks = (sh.breaks || []).map((b) => (!b.deleted && !b.end ? { ...b, end: iso, note: (b.note ? b.note + ' · ' : '') + 'închisă automat la final' } : b));
  const segments = (sh.segments || []).map((g) => (!g.deleted && !g.end ? { ...g, end: iso, endGeo: geo } : g));
  const date = localDate(Date.parse(sh.start), app.tz);
  const patch = { id: sh.id, end: iso, breaks, segments, endLoc: { locationId, geo }, frozen: freezeRules(st, sh, date) };
  if (pressedAt && Math.abs(pressedAt - Date.parse(iso)) >= 60000) patch.endPressed = toIso(pressedAt);
  if (note) patch.notes = (sh.notes ? sh.notes + '\n' : '') + note;
  return app.store.put('shift', patch, { action: 'TERMINĂ MUNCA', undoLabel: 'Termină munca' });
}

export function addNote(app, text) {
  const sh = openShift(app.state());
  if (!sh) fail('Nu există o zi de lucru pornită.');
  const stamp = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: app.tz });
  return app.store.put('shift', { id: sh.id, notes: (sh.notes ? sh.notes + '\n' : '') + `[${stamp}] ${text}` }, { action: 'observație', undoLabel: 'Observație' });
}

/** Normele de producție aplicabile la o dată, pentru contractul dat. */
export function normsFor(app, contract, date) {
  if (!contract) return [];
  const all = app.store.list('norm').filter((n) => n.employerId === contract.employerId && (!n.contractId || n.contractId === contract.id));
  const series = new Map();
  for (const n of all) { const k = n.seriesId || n.id; if (!series.has(k)) series.set(k, []); series.get(k).push(n); }
  return [...series.values()].map((l) => pickVersion(l, date)).filter(Boolean);
}

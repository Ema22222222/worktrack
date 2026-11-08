// actions.js — operațiunile de pontaj (start, pauză, schimbare activitate, final) și înghețarea regulilor.
import { validateAction, resolvePolicy, openShift, pickVersion } from './calc.js';
import { uid, localDate, toIso } from './util.js';

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

function fail(msg) { const e = new Error(msg); e.user = true; throw e; }

export function startWork(app, { activityId, at = Date.now(), note = '', locationId = null, geo = null, contractId } = {}) {
  const st = app.state();
  const err = validateAction(st, 'start'); if (err) fail(err);
  const contract = app.store.get(contractId) || app.activeContract();
  if (!contract) fail('Configurează mai întâi angajatorul și contractul.');
  const iso = toIso(at);
  const shift = {
    employerId: contract.employerId, contractId: contract.id, date: localDate(at, app.tz), start: iso, end: null,
    breaks: [], segments: activityId ? [{ id: uid('seg'), activityId, start: iso, end: null, locationId, geo }] : [],
    notes: note, locationId: locationId || null, startLoc: { locationId, geo }, endLoc: null, settlement: {},
  };
  return app.store.put('shift', shift, { action: 'START MUNCĂ', undoLabel: 'Start muncă' });
}

export function breakStart(app, { at = Date.now(), note = '' } = {}) {
  const st = app.state();
  const err = validateAction(st, 'breakStart'); if (err) fail(err);
  const sh = openShift(st);
  return app.store.put('shift', { id: sh.id, breaks: [...(sh.breaks || []), { id: uid('brk'), start: toIso(at), end: null, note }] }, { action: 'ÎNCEPE PAUZĂ', undoLabel: 'Începe pauză' });
}

export function breakEnd(app, { at = Date.now() } = {}) {
  const st = app.state();
  const err = validateAction(st, 'breakEnd'); if (err) fail(err);
  const sh = openShift(st);
  const breaks = sh.breaks.map((b) => (!b.deleted && !b.end ? { ...b, end: toIso(Math.max(at, Date.parse(b.start))) } : b));
  return app.store.put('shift', { id: sh.id, breaks }, { action: 'TERMINĂ PAUZĂ', undoLabel: 'Termină pauza' });
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

export function endWork(app, { at = Date.now(), note, locationId = null, geo = null } = {}) {
  const st = app.state();
  const err = validateAction(st, 'end'); if (err) fail(err);
  const sh = openShift(st);
  const iso = toIso(Math.max(at, Date.parse(sh.start)));
  const breaks = (sh.breaks || []).map((b) => (!b.deleted && !b.end ? { ...b, end: iso, note: (b.note ? b.note + ' · ' : '') + 'închisă automat la final' } : b));
  const segments = (sh.segments || []).map((g) => (!g.deleted && !g.end ? { ...g, end: iso, endGeo: geo } : g));
  const date = localDate(Date.parse(sh.start), app.tz);
  const patch = { id: sh.id, end: iso, breaks, segments, endLoc: { locationId, geo }, frozen: freezeRules(st, sh, date) };
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

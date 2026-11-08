// store.js — stocare persistentă, sincronizare între dispozitive, coadă offline, istoric/audit, backup.
//
// • Fiecare înregistrare are ID unic generat pe dispozitiv → o reîncercare de sincronizare
//   rescrie ACELAȘI document, deci nu apar dubluri.
// • Scrierile merg întâi în cache-ul local + coada "outbox", apoi spre baza de date. Fără internet
//   rămân în coadă și se trimit automat când revine conexiunea.
// • Fiecare modificare păstrează valoarea veche în `history` (cine, când, de ce, ce s-a schimbat).
// • Ștergerile sunt "soft" (deleted: true) și pot fi restaurate.

import { uid } from './util.js';

export const TYPES = {
  employer: 'employers', contract: 'contracts', activity: 'activities', rate: 'rates', policy: 'policies',
  norm: 'norms', shift: 'shifts', production: 'production', holiday: 'holidays', absence: 'absences',
  comp: 'compEntries', payment: 'payments', confirmation: 'confirmations', expense: 'expenses', location: 'locations',
};
export const TYPE_LABEL = {
  employer: 'Angajator', contract: 'Contract', activity: 'Activitate', rate: 'Tarif', policy: 'Reguli program/ore',
  norm: 'Normă producție', shift: 'Zi de lucru', production: 'Producție', holiday: 'Sărbătoare', absence: 'Concediu/absență',
  comp: 'Ore compensatorii', payment: 'Plată', confirmation: 'Confirmare angajator', expense: 'Cheltuială', location: 'Locație', settings: 'Setări',
};
const HISTORY_MAX = 60;
const IGNORE_DIFF = new Set(['history', 'updatedAt', 'rev', 'updatedBy', 'device']);

export function emptyState() {
  const s = { settings: null };
  for (const k of Object.values(TYPES)) s[k] = [];
  return s;
}

/** Diferențele dintre două versiuni (doar câmpurile de nivel 1, valori serializate). */
export function diff(prev, next) {
  const out = {};
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  for (const k of keys) {
    if (IGNORE_DIFF.has(k) || k.startsWith('_')) continue;
    const a = JSON.stringify(prev?.[k] ?? null), b = JSON.stringify(next?.[k] ?? null);
    if (a !== b) out[k] = { from: prev?.[k] ?? null, to: next?.[k] ?? null };
  }
  return out;
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function safeStorage() {
  try { const ls = globalThis.localStorage; const k = '__wt_probe'; ls.setItem(k, '1'); ls.removeItem(k); return ls; }
  catch { return memoryStorage(); }
}

export class Store {
  constructor({ storage, deviceId, userLabel = 'eu' } = {}) {
    this.storage = storage || safeStorage();
    this.docs = new Map(); // id -> body (inclusiv _t)
    this.server = new Map(); // id -> ultima versiune confirmată de server
    this.outbox = [];
    this.listeners = new Set();
    this.db = null; this.uid = null; this.col = null;
    this.status = { mode: 'local', online: true, pending: 0, lastSync: null, error: null, loaded: false };
    this.deviceId = deviceId || this._get('wt.device') || uid('dev');
    this._set('wt.device', this.deviceId);
    this.userLabel = userLabel;
    this.undoStack = [];
    this._flushing = false;
    this._version = 0;
    this._loadCache();
  }

  // ---- persistență locală ----
  _get(k) { try { return this.storage.getItem(k); } catch { return null; } }
  _set(k, v) { try { this.storage.setItem(k, v); return true; } catch { return false; } }
  _key(k) { return `wt.${this.uid || 'local'}.${k}`; }
  _loadCache() {
    try {
      const c = JSON.parse(this._get(this._key('cache')) || 'null');
      if (c && Array.isArray(c.docs)) for (const d of c.docs) this.docs.set(d.id, d);
      const o = JSON.parse(this._get(this._key('outbox')) || '[]');
      if (Array.isArray(o)) this.outbox = o;
      for (const op of this.outbox) this.docs.set(op.id, op.body);
    } catch { /* cache corupt: ignorat, datele vin de pe server */ }
    this.status.pending = this.outbox.length;
  }
  _saveCache() {
    const ok1 = this._set(this._key('cache'), JSON.stringify({ at: Date.now(), docs: [...this.docs.values()] }));
    const ok2 = this._set(this._key('outbox'), JSON.stringify(this.outbox));
    if (!ok2) this.status.error = 'Spațiul local este plin – sincronizează cât mai curând.';
    return ok1 && ok2;
  }

  // ---- conectare la baza de date sincronizată ----
  async connect(db, userId) {
    if (!db || !userId) { this.status.mode = 'local'; this.status.loaded = true; this._emit(); return; }
    const prevLocal = this.uid ? null : { docs: [...this.docs.values()], outbox: this.outbox };
    this.db = db; this.uid = userId;
    this.docs = new Map(); this.outbox = [];
    this._loadCache();
    // date create în modul local înainte de autentificare → se urcă în cont
    if (prevLocal && prevLocal.outbox.length) for (const op of prevLocal.outbox) if (!this.outbox.find((o) => o.id === op.id)) { this.outbox.push(op); this.docs.set(op.id, op.body); }
    this.col = db.collection(`data/users/${userId}`);
    this.status.mode = 'sync';
    this._emit();
    let timer = setTimeout(() => { this.status.error = 'Serverul nu răspunde încă – lucrezi pe datele salvate local.'; this.status.loaded = true; this._emit(); }, 10000);
    this.unsub = this.col.onSnapshot((snap) => {
      if (!snap.metadata.fromCache && timer) { clearTimeout(timer); timer = null; this.status.error = null; }
      this._applySnapshot(snap);
      this.status.loaded = true;
      this.status.lastSync = snap.metadata.fromCache ? this.status.lastSync : Date.now();
      this._emit();
      this.flush();
    }, (e) => {
      if (timer) { clearTimeout(timer); timer = null; }
      this.status.error = `Sincronizare oprită (${e.code}). Datele rămân salvate local.`;
      this.status.loaded = true; this._emit();
    });
  }

  _applySnapshot(snap) {
    const seen = new Set();
    for (const d of snap.docs) {
      const body = d.data(); if (!body) continue;
      seen.add(d.id);
      this.server.set(d.id, body);
      const pending = this.outbox.find((o) => o.id === d.id);
      if (!pending) this.docs.set(d.id, body);
    }
    if (!snap.metadata.fromCache) {
      for (const id of [...this.docs.keys()]) if (!seen.has(id) && !this.outbox.find((o) => o.id === id)) this.docs.delete(id);
    }
    this._version++;
    this._saveCache();
  }

  setOnline(on) { this.status.online = on; this._emit(); if (on) this.flush(); }

  /** Trimite coada de scrieri spre server, una câte una, în ordine. Idempotent (același ID). */
  async flush() {
    if (!this.col || this._flushing || !this.status.online) return;
    this._flushing = true;
    try {
      while (this.outbox.length) {
        const op = this.outbox[0];
        let body = op.body;
        const srv = this.server.get(op.id);
        // conflict: alt dispozitiv a modificat între timp → păstrăm varianta lui în istoric
        if (srv && (srv.rev || 0) > (op.baseRev || 0) && srv.updatedAt !== body.updatedAt) {
          const conflict = { at: new Date().toISOString(), by: this.userLabel, device: this.deviceId, action: 'conflict',
            reason: 'Modificare simultană pe alt dispozitiv – varianta celuilalt dispozitiv este păstrată aici.', changes: diff(srv, body), overwritten: stripHistory(srv) };
          body = { ...body, rev: (srv.rev || 0) + 1, history: [...(body.history || []), conflict].slice(-HISTORY_MAX) };
        }
        try {
          await this.col.doc(op.id).set(body);
          this.server.set(op.id, body);
          if (this.outbox[0] === op) this.outbox.shift();
          else if (this.outbox[0]?.id === op.id) this.outbox[0].baseRev = body.rev; // rescris între timp: se trimite următorul
          if (this.docs.get(op.id) === op.body) this.docs.set(op.id, body);
          this.status.lastSync = Date.now(); this.status.error = null;
        } catch (e) {
          if (e?.code === 'unavailable' || e?.code === 'resource_exhausted' || !e?.code) {
            this.status.error = 'Fără conexiune – modificările așteaptă în coadă.';
            break;
          }
          if (e?.code === 'quota_exceeded') { this.status.error = 'Baza de date a atins limita de spațiu. Fă un backup și arhivează date vechi.'; break; }
          // eroare permanentă pentru acest document: îl păstrăm local, îl scoatem din coadă ca să nu blocheze restul
          this.status.error = `O înregistrare nu a putut fi salvată pe server (${e.code}). Rămâne pe acest dispozitiv.`;
          if (this.outbox[0] === op) this.outbox.shift();
          this._set(this._key('failed.' + op.id), JSON.stringify(op));
        }
      }
    } finally {
      this._flushing = false;
      this.status.pending = this.outbox.length;
      this._saveCache();
      this._emit();
    }
  }

  // ---- citire ----
  get version() { return this._version; }
  state() {
    if (this._stateCache && this._stateCacheV === this._version) return this._stateCache;
    const s = emptyState();
    for (const d of this.docs.values()) {
      if (d._t === 'settings') { s.settings = d; continue; }
      const k = TYPES[d._t]; if (k) s[k].push(d);
    }
    for (const k of Object.values(TYPES)) s[k].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    this._stateCache = s; this._stateCacheV = this._version;
    return s;
  }
  get(id) { return this.docs.get(id) || null; }
  list(type, { includeDeleted = false } = {}) {
    return [...this.docs.values()].filter((d) => d._t === type && (includeDeleted || !d.deleted));
  }

  // ---- scriere ----
  /**
   * Creează sau actualizează o înregistrare. Păstrează istoricul diferențelor.
   * @param type tipul (vezi TYPES) sau 'settings'
   * @param obj  corpul (cu sau fără id)
   * @param meta { reason, action }
   */
  put(type, obj, meta = {}) {
    const now = new Date().toISOString();
    const id = obj.id || (type === 'settings' ? 'settings' : uid(type));
    const prev = this.docs.get(id) || null;
    const body = { ...(prev || {}), ...obj, id, _t: type };
    delete body._calc;
    const changes = diff(prev, body);
    if (prev && !Object.keys(changes).length) return prev; // nimic de schimbat
    const entry = { at: now, by: this.userLabel, device: this.deviceId, action: meta.action || (prev ? 'modificare' : 'creare'),
      reason: meta.reason || '', changes: prev ? changes : undefined };
    body.createdAt = prev?.createdAt || now;
    body.updatedAt = now;
    body.rev = (prev?.rev || 0) + 1;
    body.history = [...(prev?.history || []), entry].slice(-HISTORY_MAX);
    if (meta.undoable !== false) {
      this.undoStack.push({ id, prev, label: meta.undoLabel || meta.reason || entry.action, at: Date.now() });
      if (this.undoStack.length > 20) this.undoStack.shift();
    }
    this._write(id, body, prev);
    return body;
  }

  _write(id, body, prev) {
    this.docs.set(id, body);
    const baseRev = this.server.get(id)?.rev ?? prev?.rev ?? 0;
    const i = this.outbox.findIndex((o) => o.id === id);
    if (i >= 0) this.outbox[i] = { id, body, baseRev: this.outbox[i].baseRev };
    else this.outbox.push({ id, body, baseRev });
    this.status.pending = this.outbox.length;
    this._version++;
    this._saveCache();
    this._emit();
    this.flush();
  }

  /** Ștergere recuperabilă. */
  remove(id, reason = '') {
    const d = this.docs.get(id); if (!d) return;
    return this.put(d._t, { id, deleted: true, deletedAt: new Date().toISOString() }, { action: 'ștergere', reason });
  }
  restore(id, reason = 'Restaurare') {
    const d = this.docs.get(id); if (!d) return;
    return this.put(d._t, { id, deleted: false, deletedAt: null }, { action: 'restaurare', reason });
  }
  /** Restaurează valoarea unui câmp dintr-o intrare de istoric. */
  restoreField(id, field, value, reason) {
    const d = this.docs.get(id); if (!d) return;
    return this.put(d._t, { id, [field]: value }, { action: 'restaurare valoare', reason: reason || `Restaurare câmp „${field}”` });
  }

  canUndo() { const u = this.undoStack[this.undoStack.length - 1]; return !!u && Date.now() - u.at < 10 * 60000; }
  lastUndoLabel() { return this.undoStack[this.undoStack.length - 1]?.label || ''; }
  /** Anulează ultima acțiune (în maxim 10 minute). Valoarea anulată rămâne în istoric. */
  undo() {
    if (!this.canUndo()) return false;
    const u = this.undoStack.pop();
    const cur = this.docs.get(u.id);
    if (!cur) return false;
    if (!u.prev) { this.put(cur._t, { id: u.id, deleted: true }, { action: 'anulare', reason: `Anulat: ${u.label}`, undoable: false }); return true; }
    const restored = { ...stripHistory(u.prev), id: u.id };
    for (const k of Object.keys(cur)) if (!(k in restored) && !IGNORE_DIFF.has(k) && k !== 'createdAt') restored[k] = null;
    this.put(cur._t, restored, { action: 'anulare', reason: `Anulat: ${u.label}`, undoable: false });
    return true;
  }

  // ---- backup / restaurare ----
  exportAll() {
    return { app: 'WorkTrack Pro Max', format: 1, exportedAt: new Date().toISOString(), device: this.deviceId,
      docs: [...this.docs.values()] };
  }
  /**
   * Plan de restaurare: ce se adaugă, ce se actualizează, ce rămâne neschimbat.
   * Restaurarea nu dublează nimic: documentele se potrivesc după ID.
   */
  planRestore(data) {
    if (!data || !Array.isArray(data.docs)) throw new Error('Fișierul nu este un backup WorkTrack valid.');
    const plan = { add: [], newer: [], older: [], same: [] };
    for (const d of data.docs) {
      if (!d || !d.id || !d._t) continue;
      const cur = this.docs.get(d.id);
      if (!cur) plan.add.push(d);
      else if (JSON.stringify(stripHistory(cur)) === JSON.stringify(stripHistory(d))) plan.same.push(d);
      else if ((d.updatedAt || '') > (cur.updatedAt || '')) plan.newer.push(d);
      else plan.older.push(d);
    }
    return plan;
  }
  /** mode: 'merge' (adaugă lipsă + actualizează doar unde backup-ul e mai nou) | 'overwrite' (backup-ul câștigă) */
  applyRestore(plan, mode = 'merge') {
    const list = [...plan.add, ...plan.newer, ...(mode === 'overwrite' ? plan.older : [])];
    for (const d of list) {
      const cur = this.docs.get(d.id);
      const entry = { at: new Date().toISOString(), by: this.userLabel, device: this.deviceId, action: 'restaurare din backup',
        reason: mode === 'overwrite' ? 'Restaurare completă din backup' : 'Îmbinare din backup', changes: cur ? diff(cur, d) : undefined,
        overwritten: cur ? stripHistory(cur) : undefined };
      const body = { ...d, rev: Math.max(cur?.rev || 0, d.rev || 0) + 1, updatedAt: new Date().toISOString(),
        history: [...(d.history || []), entry].slice(-HISTORY_MAX) };
      this._write(d.id, body, cur);
    }
    return list.length;
  }

  // ---- evenimente ----
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } } }
}

export function stripHistory(d) { if (!d) return d; const { history, ...rest } = d; return rest; }

/** Toate intrările de istoric, din toate înregistrările, cele mai noi primele (jurnal de audit). */
export function auditLog(store, limit = 500) {
  const out = [];
  for (const d of store.docs.values()) for (const h of d.history || []) out.push({ ...h, docId: d.id, type: d._t, deleted: !!d.deleted, doc: d });
  out.sort((a, b) => (a.at < b.at ? 1 : -1));
  return out.slice(0, limit);
}

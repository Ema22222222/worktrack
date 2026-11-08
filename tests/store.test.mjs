// Teste pentru stocare: offline, sincronizare, dubluri, conflicte, backup, anulare. Rulare: node tests/store.test.mjs
import { Store, auditLog } from '../js/store.js';

let pass = 0, fail = 0;
const out = [];
async function t(name, fn) { try { await fn(); pass++; out.push(['OK  ', name]); } catch (e) { fail++; out.push(['FAIL', `${name} → ${e.message}`]); } }
const ok = (v, m = 'condiție falsă') => { if (!v) throw new Error(m); };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} așteptat ${b}, primit ${a}`); };
const tick = () => new Promise((r) => setTimeout(r, 5));

/** Bază de date simulată, cu comutator online/offline și ascultători. */
function mockDb() {
  const data = new Map(); const subs = new Set(); let online = true; let writes = 0;
  const snap = () => ({ metadata: { fromCache: false, hasPendingWrites: false }, docs: [...data.entries()].map(([id, b]) => ({ id, exists: true, data: () => b })) });
  const notify = () => { for (const s of subs) s(snap()); };
  return {
    data, get writes() { return writes; }, setOnline(v) { online = v; },
    collection() {
      return {
        onSnapshot(next) { subs.add(next); setTimeout(() => next(snap()), 0); return () => subs.delete(next); },
        doc(id) { return { async set(b) { if (!online) throw { code: 'unavailable' }; writes++; data.set(id, JSON.parse(JSON.stringify(b))); setTimeout(notify, 0); } }; },
      };
    },
    external(id, body) { data.set(id, body); notify(); },
  };
}
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

await t('29 Lipsa internetului – înregistrările se salvează local, în coadă', async () => {
  const db = mockDb(); const s = new Store({ storage: mem() });
  await s.connect(db, 'u1'); await tick();
  db.setOnline(false); s.setOnline(true);
  s.put('shift', { id: 'shift_1', start: '2026-03-02T07:00:00Z' });
  s.put('production', { id: 'production_1', qty: 5, unit: 'm³', date: '2026-03-02' });
  await tick();
  eq(s.outbox.length, 2); eq(db.data.size, 0); eq(s.state().shifts.length, 1);
});
await t('30 Sincronizarea ulterioară – coada se golește, fără dubluri', async () => {
  const db = mockDb(); const storage = mem(); const s = new Store({ storage });
  await s.connect(db, 'u1'); await tick();
  db.setOnline(false);
  s.put('shift', { id: 'shift_1', start: 'x' });
  s.put('shift', { id: 'shift_1', end: 'y' }); // a doua modificare a aceleiași înregistrări
  await tick();
  // reîncărcarea paginii offline păstrează coada
  const s2 = new Store({ storage }); s2.uid = 'u1'; s2.docs = new Map(); s2.outbox = []; s2._loadCache();
  eq(s2.outbox.length, 1, 'aceeași înregistrare = o singură intrare în coadă');
  db.setOnline(true); await s.flush(); await tick();
  eq(s.outbox.length, 0); eq(db.data.size, 1); eq(db.data.get('shift_1').end, 'y');
  await s.flush(); eq(db.data.size, 1, 'reîncercarea nu dublează');
});
await t('06b Dublarea înregistrărilor la sincronizare offline este imposibilă (ID unic)', async () => {
  const db = mockDb(); const s = new Store({ storage: mem() }); await s.connect(db, 'u1'); await tick();
  const a = s.put('production', { qty: 1, unit: 'tone' }); const b = s.put('production', { qty: 1, unit: 'tone' });
  ok(a.id !== b.id); await tick(); eq(db.data.size, 2);
});
await t('Conflict între telefon și calculator – nicio valoare pierdută', async () => {
  const db = mockDb(); const s = new Store({ storage: mem() }); await s.connect(db, 'u1'); await tick();
  s.put('shift', { id: 'sh', notes: 'A' }); await tick(); await tick();
  db.setOnline(false);
  s.put('shift', { id: 'sh', notes: 'telefon' });
  const srv = db.data.get('sh');
  db.external('sh', { ...srv, notes: 'calculator', rev: srv.rev + 1, updatedAt: '2099-01-01T00:00:00Z' });
  await tick();
  db.setOnline(true); await s.flush(); await tick();
  const fin = db.data.get('sh');
  eq(fin.notes, 'telefon');
  ok(fin.history.some((h) => h.action === 'conflict' && h.overwritten.notes === 'calculator'), 'varianta celuilalt dispozitiv e în istoric');
});
await t('Istoric/audit: valoare inițială, nouă, motiv, autor, dată', async () => {
  const s = new Store({ storage: mem() });
  s.put('shift', { id: 'sh', start: '07:00' }); s.put('shift', { id: 'sh', start: '06:45' }, { reason: 'Am uitat să apăs START' });
  const h = s.get('sh').history[1];
  eq(h.changes.start.from, '07:00'); eq(h.changes.start.to, '06:45'); eq(h.reason, 'Am uitat să apăs START'); ok(h.at && h.by);
  ok(auditLog(s).length === 2);
});
await t('Ștergere recuperabilă + restaurare valoare', async () => {
  const s = new Store({ storage: mem() });
  s.put('payment', { id: 'p', amount: 100 }); s.remove('p', 'greșeală');
  eq(s.state().payments.length, 1); ok(s.get('p').deleted); s.restore('p'); ok(!s.get('p').deleted);
  s.put('payment', { id: 'p', amount: 120 }); s.restoreField('p', 'amount', 100); eq(s.get('p').amount, 100);
});
await t('Anularea ultimei acțiuni', async () => {
  const s = new Store({ storage: mem() });
  s.put('shift', { id: 'sh', start: 'a' }); s.put('shift', { id: 'sh', end: 'b' }, { undoLabel: 'Termină munca' });
  ok(s.undo()); eq(s.get('sh').end, null); eq(s.get('sh').start, 'a');
  ok(s.get('sh').history.some((h) => h.action === 'anulare'));
});
await t('32 Restaurarea din backup – îmbinare fără dubluri', async () => {
  const s = new Store({ storage: mem() });
  s.put('shift', { id: 'a', notes: '1' }); s.put('shift', { id: 'b', notes: '2' });
  const backup = JSON.parse(JSON.stringify(s.exportAll()));
  s.put('shift', { id: 'a', notes: 'modificat după backup' }); s.remove('b');
  const s2 = new Store({ storage: mem() });
  const plan2 = s2.planRestore(backup); eq(plan2.add.length, 2); s2.applyRestore(plan2); eq(s2.state().shifts.length, 2);
  const plan = s.planRestore(backup); eq(plan.add.length, 0); eq(plan.older.length, 2);
  eq(s.applyRestore(plan, 'merge'), 0, 'îmbinarea nu suprascrie date mai noi');
  eq(s.applyRestore(s.planRestore(backup), 'overwrite'), 2); eq(s.get('a').notes, '1'); ok(!s.get('b').deleted);
  eq(s.state().shifts.length, 2, 'fără dubluri');
  ok(s.get('a').history.some((h) => h.overwritten?.notes === 'modificat după backup'), 'valoarea înlocuită rămâne în istoric');
});

for (const [a, b] of out) console.log(a, b);
console.log(`\n${pass} trecute, ${fail} eșuate`);
process.exit(fail ? 1 : 0);

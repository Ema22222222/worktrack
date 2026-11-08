// backup.js — backup complet (fișier JSON), restaurare cu previzualizare, copii automate locale.
import { openDialog, toast, esc } from './ui.js';

const DB_NAME = 'worktrack-backups';
function idb() {
  return new Promise((resolve, reject) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('snap', { keyPath: 'at' });
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    } catch (e) { reject(e); }
  });
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('snap', mode); const s = t.objectStore('snap');
    const res = fn(s); t.oncomplete = () => resolve(res?.result ?? res); t.onerror = () => reject(t.error);
  });
}

/** Copie automată locală pe acest dispozitiv, cel mult o dată pe zi; păstrează ultimele 7. */
export async function autoBackup(app) {
  if (!app.settings().autoBackup) return;
  try {
    const list = await listLocal();
    const last = list[0];
    if (last && Date.now() - Date.parse(last.at) < 20 * 3600000) return;
    if (!app.store.docs.size) return;
    const data = app.store.exportAll();
    await tx('readwrite', (s) => s.put({ at: data.exportedAt, count: data.docs.length, data }));
    const all = await listLocal();
    for (const old of all.slice(7)) await tx('readwrite', (s) => s.delete(old.at));
  } catch { /* stocare locală indisponibilă în această vizualizare */ }
}
export async function listLocal() {
  try {
    const rows = await tx('readonly', (s) => s.getAll());
    return (rows || []).map((r) => ({ at: r.at, count: r.count })).sort((a, b) => b.at.localeCompare(a.at));
  } catch { return []; }
}
export async function getLocal(at) { try { const r = await tx('readonly', (s) => s.get(at)); return r?.data || null; } catch { return null; } }

export async function downloadBackup(app) {
  const data = app.store.exportAll();
  const name = `worktrack-backup-${app.today()}.json`;
  return app.download(name, JSON.stringify(data, null, 1));
}

/** Previzualizează și aplică restaurarea. */
export async function restoreFrom(app, data) {
  let plan;
  try { plan = app.store.planRestore(data); } catch (e) { toast(e.message, { bad: true }); return; }
  const mode = await openDialog({
    title: 'Restaurare din backup',
    body: `<p>Backup din <b>${esc(data.exportedAt ? new Date(data.exportedAt).toLocaleString('ro-RO') : '?')}</b>, ${data.docs.length} înregistrări.</p>
      <div class="kv"><div><span class="label">Lipsesc acum – se adaugă</span><b>${plan.add.length}</b></div><div><span class="label">Mai noi în backup</span><b>${plan.newer.length}</b></div>
      <div><span class="label">Mai vechi în backup</span><b>${plan.older.length}</b></div><div><span class="label">Identice</span><b>${plan.same.length}</b></div></div>
      <p class="small muted">Înregistrările se potrivesc după ID, deci nu apar dubluri. Orice valoare înlocuită rămâne în istoricul înregistrării.</p>`,
    actions: [
      { label: 'Renunță', value: null },
      { label: 'Îmbină (recomandat)', cls: 'btn-primary', value: 'merge' },
      { label: 'Restaurează complet (backup-ul câștigă)', cls: 'btn-danger', value: 'overwrite' },
    ],
  });
  if (!mode) return;
  const n = app.store.applyRestore(plan, mode);
  toast(n ? `${n} înregistrări restaurate.` : 'Nimic de restaurat – datele sunt deja la zi.');
  app.refresh();
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { try { resolve(JSON.parse(r.result)); } catch { reject(new Error('Fișierul nu este JSON valid.')); } };
    r.onerror = () => reject(new Error('Fișierul nu a putut fi citit.'));
    r.readAsText(file);
  });
}

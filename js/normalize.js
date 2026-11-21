// normalize.js — o singură dată: potrivește zilele deja trecute pe programul tău (±30 min, fără secunde).
// Orele originale rămân în istoric și în câmpul `original` al fiecărei zile.
import { normalizeShift } from './actions.js';
import { toast } from './ui.js';

const FLAG = 'normalizedV1';

export async function normalizeOnce(app) {
  for (let i = 0; i < 40 && !app.store.status.loaded; i++) await new Promise((r) => setTimeout(r, 500));
  if (!app.store.status.loaded || app.settings()[FLAG]) return 0;
  if (!app.activeContract()) return 0;
  const patch = { [FLAG]: new Date().toISOString() };
  if (!(Number(app.settings().snapMin) >= 30)) patch.snapMin = 30;
  app.saveSettings(patch, 'Potrivire ore pe program (±30 min)');
  let n = 0;
  for (const sh of app.store.list('shift')) {
    const p = normalizeShift(app, sh);
    if (!p) continue;
    app.store.put('shift', p, { reason: 'Potrivire automată pe ora din program (±30 min, fără secunde)', action: 'potrivire program', undoable: false });
    n++;
  }
  if (n) { toast(`Am potrivit ${n} zile pe ora din program (±30 min). Orele inițiale rămân în istoric.`, { ms: 8000 }); app.refresh(); }
  return n;
}

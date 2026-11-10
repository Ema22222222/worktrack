// Setări, sincronizare, backup/restaurare și jurnalul de audit.
import { esc, icon, pill, emptyState, toast, confirmDialog, formDialog, objOptions } from '../ui.js';
import { fmtDate } from '../util.js';
import { TYPE_LABEL, auditLog, stripHistory } from '../store.js';
import { downloadBackup, restoreFrom, readJsonFile, listLocal, getLocal } from '../backup.js';
import { CURRENCIES } from '../editors.js';
import { getLocation } from '../actions.js';
import { hasDemo, removeDemo } from '../demo.js';

const TZS = ['Europe/Madrid', 'Atlantic/Canary', 'Europe/Paris', 'Europe/Bucharest', 'Europe/Lisbon', 'Europe/London', 'Europe/Rome', 'Europe/Berlin', 'Europe/Vienna', 'Europe/Brussels', 'Europe/Zurich', 'Europe/Warsaw', 'Europe/Chisinau', 'UTC'];

export function render(root, app) {
  const s = app.settings(); const st = app.store.status;
  const contracts = app.contracts();
  const notif = typeof Notification === 'undefined' ? 'indisponibil' : Notification.permission;
  root.innerHTML = `<div class="pagehead"><div><h1>Setări și backup</h1></div></div>
  ${window.wtWeb ? webSection() : ''}
  <section class="panel"><h2>General</h2><div class="fgrid">
    <label class="f">Fus orar<select id="tz">${[...new Set([s.tz, ...TZS])].map((z) => `<option${z === s.tz ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select><span class="help">Ora de vară/iarnă se aplică automat. Pune ora țării în care lucrezi (Spania și Franța: Europe/Madrid sau Europe/Paris – aceeași oră). Dacă îl schimbi după ce ai introdus zile, orele lor se vor afișa decalat.</span></label>
    <label class="f">Moneda implicită<select id="cur">${CURRENCIES.map((c) => `<option${c === s.currency ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
    <label class="f">Aspect<select id="theme">${[['auto', 'Automat (ca sistemul)'], ['light', 'Luminos'], ['dark', 'Întunecat']].map(([v, l]) => `<option value="${v}"${v === s.theme ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f">Contract activ (pentru START)<select id="ac">${contracts.map((c) => `<option value="${c.id}"${c.id === app.activeContract()?.id ? ' selected' : ''}>${esc(app.name(c.employerId))} — ${esc(c.name)}</option>`).join('')}</select></label>
  </div></section>
  <section class="panel"><header><h2>Locație (GPS)</h2>${s.gps ? pill('Activat', 'ok') : pill('Dezactivat')}</header>
    <p class="small">Doar la acțiuni: start, schimbare activitate, producție, final. Fără urmărire continuă. Dacă GPS-ul nu răspunde, timpul se salvează fără locație.</p>
    <div class="row"><button id="gps">${s.gps ? 'Dezactivează GPS' : 'Activează și testează GPS'}</button></div></section>
  <section class="panel"><header><h2>Remindere</h2>${s.reminders.enabled ? pill('Active', 'ok') : pill('Oprite')}</header>
    <p class="small muted">Reminderele apar în aplicație când o deschizi. Notificările de sistem cu aplicația închisă nu sunt garantate de browser.</p>
    <div class="row"><button id="rem">${icon('gear')} Configurează reminderele</button>
    ${notif === 'default' ? '<button id="notif">Permite notificări de sistem</button>' : `<span class="small muted">Notificări de sistem: ${notif === 'granted' ? 'permise' : notif === 'denied' ? 'blocate de browser' : 'indisponibile aici'}</span>`}</div></section>
  <section class="panel"><header><h2>Sincronizare</h2>${st.mode === 'sync' ? pill('În cont – telefon și calculator', 'ok') : pill('Doar acest browser', 'warn')}</header>
    <div class="kv"><div><span class="label">În așteptare</span><b>${st.pending}</b></div><div><span class="label">Ultima sincronizare</span><b style="font-size:1rem">${st.lastSync ? new Date(st.lastSync).toLocaleString('ro-RO') : '—'}</b></div><div><span class="label">Înregistrări</span><b>${app.store.docs.size}</b></div></div>
    ${st.error ? `<p class="note warn small">${esc(st.error)}</p>` : ''}
    <p class="small muted">Folosește același cont pe telefon și pe calculator: datele se sincronizează automat. Fără internet, înregistrările se păstrează pe dispozitiv și se trimit când revine conexiunea. Fiecare înregistrare are un ID unic, așa că nu apar dubluri.</p>
    <div class="row"><button id="sync">${icon('comp')} Sincronizează acum</button></div></section>
  <section class="panel"><h2>Backup și restaurare</h2>
    <p class="small">Backup-ul conține toate datele (inclusiv istoricul modificărilor) într-un fișier JSON. Restaurarea arată înainte ce se schimbă și nu creează dubluri.</p>
    <div class="row"><button class="btn-primary" id="dl">${icon('dl')} Descarcă backup complet</button>
      <label class="btn" style="cursor:pointer">${icon('ul')} Restaurează din fișier<input type="file" id="ul" accept="application/json,.json" hidden></label></div>
    <label class="chk"><input type="checkbox" id="auto" ${s.autoBackup ? 'checked' : ''}> Copie automată zilnică pe acest dispozitiv (ultimele 7)</label>
    <div id="locals" class="stack"></div></section>
  ${hasDemo(app) ? `<section class="panel"><header><h2>Date de exemplu</h2>${pill('Încărcate', 'warn')}</header>
    <p class="small">Contul conține date de exemplu (Firma Demo). Când vrei să-ți treci orele tale, șterge-le de aici.</p>
    <div class="row"><button class="btn-danger" id="demo-rm">Șterge datele de exemplu</button></div></section>` : ''}
  <section class="panel"><h2>Istoric și date șterse</h2><p class="small">Toate modificările păstrează valoarea veche, data, motivul și autorul.</p><div class="row"><a class="btn" href="#istoric">${icon('history')} Deschide istoricul</a></div></section>`;

  if (window.wtWeb) bindWeb(root, app);
  const save = (patch, msg = 'Salvat.') => { app.saveSettings(patch); toast(msg); app.refresh(); };
  root.querySelector('#tz').onchange = (e) => save({ tz: e.target.value }, `Fus orar: ${e.target.value}`);
  root.querySelector('#cur').onchange = (e) => save({ currency: e.target.value });
  root.querySelector('#theme').onchange = (e) => save({ theme: e.target.value });
  root.querySelector('#ac').onchange = (e) => save({ activeContractId: e.target.value }, 'Contract activ schimbat.');
  root.querySelector('#gps').onclick = async () => {
    if (s.gps) return save({ gps: false }, 'GPS dezactivat.');
    app.saveSettings({ gps: true });
    const g = await getLocation(app);
    if (g) toast(`GPS funcționează: ${g.lat}, ${g.lng} (±${g.acc} m).`);
    else { app.saveSettings({ gps: false }); toast('Locația nu este disponibilă în această vizualizare sau a fost refuzată. Folosește locațiile salvate.', { bad: true, ms: 8000 }); }
    app.refresh();
  };
  root.querySelector('#rem').onclick = () => editReminders(app);
  root.querySelector('#notif')?.addEventListener('click', async () => { try { await Notification.requestPermission(); } catch { /* refuzat */ } app.refresh(); });
  root.querySelector('#sync').onclick = async () => { app.store.setOnline(navigator.onLine !== false); await app.store.flush(); toast(app.store.status.pending ? 'Încă sunt înregistrări în așteptare (fără conexiune).' : 'Totul este sincronizat.'); app.refresh(); };
  root.querySelector('#demo-rm')?.addEventListener('click', () => removeDemo(app));
  root.querySelector('#dl').onclick = () => downloadBackup(app);
  root.querySelector('#ul').onchange = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await restoreFrom(app, await readJsonFile(f)); } catch (err) { toast(err.message, { bad: true }); } e.target.value = ''; };
  root.querySelector('#auto').onchange = (e) => save({ autoBackup: e.target.checked });
  listLocal().then((l) => {
    const el = root.querySelector('#locals'); if (!el) return;
    el.innerHTML = l.length ? `<div class="label">Copii locale pe acest dispozitiv</div><div class="list">${l.map((b) => `<div class="item"><div class="grow">${new Date(b.at).toLocaleString('ro-RO')} <span class="small muted">· ${b.count} înregistrări</span></div><button class="btn-sm" data-at="${esc(b.at)}">Restaurează</button></div>`).join('')}</div>` : '';
    el.querySelectorAll('[data-at]').forEach((b) => { b.onclick = async () => { const d = await getLocal(b.dataset.at); if (d) restoreFrom(app, d); }; });
  });
}

async function editReminders(app) {
  const r = app.settings().reminders;
  const vals = await formDialog({
    title: 'Remindere',
    fields: [
      { name: 'enabled', label: 'Remindere active', type: 'checkbox', value: r.enabled, full: true },
      { name: 'fixedTimes', label: 'La ora exactă din program: începe programul (08:00), începe pauza (12:00), reîncepe lucrul (13:00), închide programul (20:00)', type: 'checkbox', value: r.fixedTimes !== false, full: true },
      { name: 'breakPrompt', label: 'Memento la ora pauzei', type: 'checkbox', value: r.breakPrompt !== false, full: true },
      { name: 'startLateMin', label: 'Dacă nu e la ora exactă: am uitat să încep, după câte minute', type: 'number', value: r.startLateMin },
      { name: 'breakLongMin', label: 'Am uitat să închei pauza: după câte minute', type: 'number', value: r.breakLongMin },
      { name: 'endLateMin', label: 'Dacă nu e la ora exactă: am uitat să închei ziua, după câte minute', type: 'number', value: r.endLateMin },
      { name: 'overNorm', label: 'Am depășit programul normal', type: 'checkbox', value: r.overNorm },
      { name: 'noProduction', label: 'Nu am înregistrat producția', type: 'checkbox', value: r.noProduction },
      { name: 'incomplete', label: 'Am înregistrări incomplete', type: 'checkbox', value: r.incomplete },
      { name: 'paymentsOverdueDays', label: 'Plăți restante: după câte zile (0 = oprit)', type: 'number', value: r.paymentsOverdueDays },
    ],
  });
  if (!vals) return;
  app.saveSettings({ reminders: vals }); toast('Remindere salvate.'); app.refresh();
}

// ---------- Jurnal de audit ----------
let auditFilter = '';
export function renderAudit(root, app) {
  const all = auditLog(app.store, 800).filter((h) => !auditFilter || h.type === auditFilter);
  const deleted = [...app.store.docs.values()].filter((d) => d.deleted);
  const v = (x) => (x == null || x === '' ? '—' : typeof x === 'object' ? JSON.stringify(x).slice(0, 160) : String(x).slice(0, 160));
  root.innerHTML = `<div class="pagehead"><div><h1>Istoric modificări</h1><p class="sub">Valoarea inițială, valoarea nouă, data, motivul și cine a făcut modificarea.</p></div>
    <select id="flt" aria-label="Filtru"><option value="">Toate tipurile</option>${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}"${k === auditFilter ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
  ${deleted.length ? `<section class="panel"><h2>Înregistrări șterse (recuperabile)</h2><div class="list">${deleted.map((d) => `<div class="item"><div class="grow"><b>${esc(TYPE_LABEL[d._t] || d._t)}</b> <span class="small muted">${esc(d.name || d.date || (d.start ? fmtDate(d.start.slice(0, 10)) : '') || d.id)}${d.amount ? ' · ' + d.amount : ''}${d.qty ? ' · ' + d.qty + ' ' + (d.unit || '') : ''} · șters ${d.deletedAt ? new Date(d.deletedAt).toLocaleString('ro-RO') : ''}</span></div><button class="btn-sm" data-restore="${d.id}">${icon('undo')} Restaurează</button></div>`).join('')}</div></section>` : ''}
  <section class="panel"><h2>Modificări</h2>${all.length ? `<div class="list">${all.map((h, i) => `<div class="item" style="align-items:start"><div class="grow">
    <div><b>${esc(TYPE_LABEL[h.type] || h.type)}</b> · ${esc(h.action || '')} <span class="small muted">· ${new Date(h.at).toLocaleString('ro-RO')} · ${esc(h.by || '')}</span>${h.deleted ? ' ' + pill('șters') : ''}${h.action === 'conflict' ? ' ' + pill('conflict între dispozitive', 'warn') : ''}</div>
    ${h.reason ? `<div class="small">Motiv: ${esc(h.reason)}</div>` : ''}
    ${h.changes ? `<div class="tablewrap" style="margin-top:6px"><table><thead><tr><th>Câmp</th><th>Înainte</th><th>După</th><th></th></tr></thead><tbody>${Object.entries(h.changes).map(([k, c]) => `<tr><td class="mono">${esc(k)}</td><td class="small">${esc(v(c.from))}</td><td class="small">${esc(v(c.to))}</td><td>${!h.deleted && typeof c.from !== 'undefined' ? `<button class="btn-sm" data-rf="${i}" data-k="${esc(k)}">Restaurează</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${h.overwritten ? `<details class="small"><summary>Varianta înlocuită</summary><pre class="mono" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(stripHistory(h.overwritten), null, 1).slice(0, 3000))}</pre></details>` : ''}
  </div></div>`).join('')}</div>` : emptyState('Niciun eveniment.')}</section>`;
  root.querySelector('#flt').onchange = (e) => { auditFilter = e.target.value; app.refresh(); };
  root.querySelectorAll('[data-restore]').forEach((b) => { b.onclick = () => { app.store.restore(b.dataset.restore); toast('Restaurat.'); app.refresh(); }; });
  root.querySelectorAll('[data-rf]').forEach((b) => { b.onclick = async () => {
    const h = all[+b.dataset.rf]; const k = b.dataset.k;
    const r = await confirmDialog(`Readuci câmpul „${esc(k)}” la valoarea de dinainte? Valoarea actuală rămâne în istoric.`, { okLabel: 'Restaurează', reason: true });
    if (!r) return;
    app.store.restoreField(h.docId, k, h.changes[k].from, r.reason || `Restaurare valoare din ${new Date(h.at).toLocaleString('ro-RO')}`);
    toast('Valoare restaurată.'); app.refresh();
  }; });
}

// ---------- doar pe site: notificări push și cont ----------
function webSection() {
  const w = window.wtWeb; const a = w.account;
  const iosHint = w.isIOS && !w.standalone;
  return `${w.admin ? `<section class="panel"><header><h2>Utilizatori</h2>${pill('Administrator', 'ok')}</header>
    <p class="small">Aprobi cine poate folosi aplicația și oprești accesul oricui, oricând.</p>
    <div class="row"><a class="btn btn-primary" href="#utilizatori">${icon('people')} Deschide utilizatorii</a></div></section>` : ''}
  <section class="panel"><header><h2>Notificări pe telefon</h2>${w.push.enabled ? pill('Active', 'ok') : pill('Oprite')}</header>
    ${iosHint ? '<p class="note warn small"><b>Pe iPhone</b> notificările merg doar din aplicația de pe ecranul principal: în Safari apasă <b>Partajează</b> → <b>Adaugă pe ecranul principal</b>, deschide WorkTrack de pe ecran și apasă aici „Activează”.</p>' : ''}
    <p class="small">Primești alertă când ai uitat să începi ziua, să închei pauza sau ziua, când treci de normă și seara dacă nu ai trecut ziua. Verificarea se face automat la fiecare câteva minute, chiar dacă aplicația e închisă.</p>
    <div class="row"><button class="btn-action" id="push-on">${w.push.enabled ? 'Reactivează pe acest dispozitiv' : 'Activează notificările'}</button>${w.push.enabled ? '<button id="push-test">Notificare de test</button>' : ''}</div>
    <p class="small" id="push-msg" role="status"></p></section>
  <section class="panel"><header><h2>Contul tău</h2></header>
    <p class="small">Conectat ca <b>${esc(a.email || a.name)}</b>${a.hasGoogle ? ' (Google)' : ''}.</p>
    ${a.hasGoogle && !a.hasPassword ? '<p class="small muted">Pe iPhone, în aplicația de pe ecran, logarea cu Google poate să nu meargă. Setează o parolă și intră acolo cu emailul și parola.</p>' : ''}
    <div class="row"><button id="acc-pw">${a.hasPassword ? 'Schimbă parola' : 'Setează o parolă'}</button><button class="btn-ghost" id="acc-out">Ieși din cont</button></div></section>`;
}
function bindWeb(root, app) {
  const w = window.wtWeb; const msg = (t, bad) => { const el = root.querySelector('#push-msg'); if (el) { el.textContent = t; el.style.color = bad ? 'var(--bad)' : 'var(--ok)'; } };
  root.querySelector('#push-on')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true; msg('Se activează…');
    try { await w.push.enable(); msg('Notificările sunt active pe acest dispozitiv.'); setTimeout(() => app.refresh(), 800); }
    catch (err) { msg(err.message || String(err), true); e.currentTarget.disabled = false; }
  });
  root.querySelector('#push-test')?.addEventListener('click', async () => { try { await w.push.test(); msg('Trimisă. Ar trebui să apară acum.'); } catch (err) { msg(err.message, true); } });
  root.querySelector('#acc-out')?.addEventListener('click', async () => { const r = await confirmDialog('Ieși din cont pe acest dispozitiv? Datele rămân salvate în cont.', { okLabel: 'Ieși' }); if (r) w.account.signOut(); });
  root.querySelector('#acc-pw')?.addEventListener('click', async () => {
    const v = await formDialog({ title: w.account.hasPassword ? 'Parolă nouă' : 'Setează o parolă', intro: `<p class="small muted">Vei putea intra cu <b>${esc(w.account.email)}</b> și această parolă.</p>`,
      fields: [{ name: 'p1', label: 'Parola (minim 6 caractere)', type: 'password', required: true }, { name: 'p2', label: 'Repetă parola', type: 'password', required: true }],
      validate: (x) => (x.p1.length < 6 ? 'Parola trebuie să aibă cel puțin 6 caractere.' : x.p1 !== x.p2 ? 'Parolele nu coincid.' : null) });
    if (!v) return;
    try { await w.account.setPassword(v.p1); toast('Parola a fost setată.'); app.refresh(); } catch (err) { toast(err.message, { bad: true, ms: 9000 }); }
  });
}

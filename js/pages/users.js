// users.js — doar pentru administrator (site): cine poate folosi aplicația. Aprobare, oprire, repornire.
import { esc, icon, pill, toast, confirmDialog } from '../ui.js';

const SITE = 'https://ema22222222.github.io/worktrack/';
const ST = { asteptare: ['Așteaptă aprobarea', 'warn'], activ: ['Activ', 'ok'], oprit: ['Oprit', 'bad'] };
let unsub = null;

const when = (iso) => (iso ? new Date(iso).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function render(root, app) {
  const A = window.wtWeb?.admin;
  if (!A) { root.innerHTML = '<div class="pagehead"><h1>Utilizatori</h1></div><section class="panel"><p>Pagina aceasta este doar pentru administratorul aplicației.</p></section>'; return; }
  root.innerHTML = `<div class="pagehead"><div><h1>Utilizatori</h1></div></div>
  <section class="panel"><h2>Invită pe cineva</h2>
    <p class="small">Trimite-i linkul. Își face cont cu Google sau cu email și parolă, apoi apare aici la „Așteaptă aprobarea”. Până nu-l aprobi, nu poate folosi aplicația.</p>
    <p class="small">Fiecare om își vede doar datele lui. Nimeni nu îți vede orele și nu poate modifica aplicația.</p>
    <div class="row"><button class="btn-primary" id="inv">${icon('ul')} Trimite invitația</button></div></section>
  <div id="ulist" class="stack"><section class="panel"><p class="small muted">Se încarcă…</p></section></div>`;
  root.querySelector('#inv').onclick = async () => {
    const text = `Încearcă WorkTrack, aplicația mea de pontaj: ${SITE}\nFă-ți cont cu Google sau cu email și parolă, apoi îți aprob accesul. Dacă vrei să vezi rapid cum merge, apasă „Încarcă date de exemplu”.`;
    try {
      if (navigator.share) { await navigator.share({ title: 'WorkTrack', text }); return; }
      await navigator.clipboard.writeText(text); toast('Invitația a fost copiată. Lipește-o în WhatsApp sau email.');
    } catch (e) { if (e?.name !== 'AbortError') toast('Linkul: ' + SITE, { ms: 9000 }); }
  };
  unsub?.();
  unsub = A.watch((list, err) => {
    const box = document.getElementById('ulist'); if (!box) { unsub?.(); unsub = null; return; }
    if (!list) { box.innerHTML = `<section class="panel"><p class="note warn small">Nu pot citi lista (${esc(err?.code || err?.message || 'eroare')}).</p></section>`; return; }
    const groups = [['asteptare', 'Așteaptă aprobarea'], ['activ', 'Au acces'], ['oprit', 'Acces oprit']];
    box.innerHTML = groups.map(([k, t]) => {
      const L = list.filter((u) => (u.status || 'asteptare') === k).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      if (!L.length && k !== 'asteptare') return '';
      return `<section class="panel"><header><h2>${t}</h2>${pill(String(L.length), ST[k][1])}</header>
        ${L.length ? `<div class="list">${L.map((u) => `<div class="item" style="flex-wrap:wrap">
          <div class="grow" style="min-width:0"><b style="word-break:break-all">${esc(u.email || u.name || u.uid)}</b>
            <div class="small muted">${u.name && u.email ? esc(u.name) + ' · ' : ''}înscris ${when(u.createdAt)}${u.lastSeen ? ` · ultima dată ${when(u.lastSeen)}` : ''}</div></div>
          <div class="row">${k === 'asteptare' ? `<button class="btn-sm btn-action" data-s="activ" data-u="${esc(u.uid)}">Aprobă</button><button class="btn-sm" data-s="oprit" data-u="${esc(u.uid)}">Refuză</button>`
            : k === 'activ' ? `<button class="btn-sm btn-danger" data-s="oprit" data-u="${esc(u.uid)}">Oprește accesul</button>`
            : `<button class="btn-sm" data-s="activ" data-u="${esc(u.uid)}">Pornește din nou</button><button class="btn-sm btn-ghost" data-del="${esc(u.uid)}">Scoate din listă</button>`}</div>
        </div>`).join('')}</div>` : '<p class="small muted">Nicio cerere nouă.</p>'}</section>`;
    }).join('') + `<p class="small muted">Contul de Google/email al unei persoane se poate șterge de tot din Firebase → Authentication. Oprirea accesului de aici e suficientă: nu mai poate deschide aplicația.</p>`;
    box.querySelectorAll('[data-s]').forEach((b) => { b.onclick = async () => {
      const u = list.find((x) => x.uid === b.dataset.u); const s = b.dataset.s;
      if (s === 'oprit') { const ok = await confirmDialog(`Oprești accesul pentru ${esc(u?.email || 'acest cont')}? Nu va mai putea deschide aplicația. Datele lui rămân păstrate; îl poți porni din nou oricând.`, { danger: true, okLabel: 'Oprește accesul' }); if (!ok) return; }
      b.disabled = true;
      try { await A.setStatus(b.dataset.u, s); toast(s === 'activ' ? 'Acces aprobat.' : 'Acces oprit.'); } catch (e) { toast('Nu a mers: ' + (e.code || e.message), { bad: true }); b.disabled = false; }
    }; });
    box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
      const ok = await confirmDialog('Scoți persoana din listă? Dacă intră din nou, apare iar la „Așteaptă aprobarea”.', { okLabel: 'Scoate' }); if (!ok) return;
      try { await A.remove(b.dataset.del); } catch (e) { toast('Nu a mers: ' + (e.code || e.message), { bad: true }); }
    }; });
  });
}

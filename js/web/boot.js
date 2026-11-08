// boot.js — versiunea site: logare (Google sau email + parolă), bază de date Firestore cu lucru offline,
// notificări push, apoi pornește aplicația (aceeași ca în Claude, prin interfața window.claude).
import { firebaseConfig, VAPID_KEY, FIREBASE_VERSION as V, ADMIN_UIDS } from './config.js';

const FB = `https://www.gstatic.com/firebasejs/${V}`;
const [{ initializeApp }, A, F, M] = await Promise.all([
  import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`), import(`${FB}/firebase-firestore.js`), import(`${FB}/firebase-messaging.js`).catch(() => null),
]);

const fbApp = initializeApp(firebaseConfig);
const auth = A.getAuth(fbApp);
auth.languageCode = 'ro';
let fs;
try { fs = F.initializeFirestore(fbApp, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
catch { fs = F.getFirestore(fbApp); }

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const root = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- service worker ----------
let swReg = null;
if ('serviceWorker' in navigator) {
  try { swReg = await navigator.serviceWorker.register('./sw.js', { scope: './' }); } catch (e) { console.warn('SW', e); }
}

// ---------- ecranul de logare ----------
const AUTH_ERR = {
  'auth/invalid-credential': 'Email sau parolă greșită.', 'auth/wrong-password': 'Parolă greșită.', 'auth/user-not-found': 'Nu există cont cu acest email.',
  'auth/email-already-in-use': 'Există deja un cont cu acest email. Apasă „Intră”, sau intră cu Google dacă așa ți-ai făcut contul.',
  'auth/weak-password': 'Parola trebuie să aibă cel puțin 6 caractere.', 'auth/invalid-email': 'Adresa de email nu este validă.',
  'auth/popup-closed-by-user': 'Fereastra Google a fost închisă înainte de logare.', 'auth/network-request-failed': 'Nu este conexiune la internet.',
  'auth/too-many-requests': 'Prea multe încercări. Așteaptă puțin și încearcă din nou.',
};
const errMsg = (e) => AUTH_ERR[e?.code] || `Nu a mers (${e?.code || e?.message || 'eroare'}).`;

function loginScreen() {
  document.body.classList.add('auth');
  root.innerHTML = `<main class="main" style="max-width:480px;padding-block:24px 40px">
    <section class="hero">
      <span class="small" style="color:var(--hero-muted);letter-spacing:.12em;font-weight:800">WORKTRACK PRO MAX</span>
      <h1 style="font-size:2rem">Orele tale, exact cum le-ai lucrat.</h1>
      <p style="color:var(--hero-muted)">Intră în contul tău. Datele se sincronizează între telefon și calculator.</p>
    </section>
    <section class="panel">
      ${isIOS && standalone ? '<p class="note small">Pe iPhone, în aplicația de pe ecran, cel mai sigur e să intri cu <b>email și parolă</b>.</p>' : ''}
      <button class="btn-primary" id="g" style="min-height:52px">Continuă cu Google</button>
      <div class="row" style="justify-content:center"><span class="small muted">sau cu email și parolă</span></div>
      <form id="f" class="stack" novalidate>
        <label class="f">Email<input id="em" type="email" autocomplete="username" inputmode="email" required></label>
        <label class="f">Parolă<input id="pw" type="password" autocomplete="current-password" minlength="6" required></label>
        <p class="small" id="err" role="alert" style="color:var(--bad)"></p>
        <div class="row"><button class="btn-action" id="in" type="submit" style="flex:1;min-height:50px">Intră</button><button type="button" id="new" style="flex:1;min-height:50px">Creează cont</button></div>
        <button type="button" class="btn-ghost btn-sm" id="forgot">Am uitat parola</button>
      </form>
    </section>
    ${isIOS && !standalone ? `<section class="panel"><h2>Pe iPhone</h2><p class="small">Ca să primești notificări, adaugă aplicația pe ecranul principal: apasă <b>Partajează</b> (pătratul cu săgeată) → <b>Adaugă pe ecranul principal</b>, apoi deschide-o de pe ecran.</p></section>` : ''}
  </main>`;
  const $ = (id) => root.querySelector('#' + id);
  const err = (e) => { $('err').textContent = typeof e === 'string' ? e : errMsg(e); };
  const busy = (on) => root.querySelectorAll('button').forEach((b) => { b.disabled = on; });
  $('g').onclick = async () => {
    busy(true); err('');
    try { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); }
    catch (e) {
      if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') { try { await A.signInWithRedirect(auth, new A.GoogleAuthProvider()); return; } catch (e2) { err(e2); } }
      else err(e);
    }
    busy(false);
  };
  $('f').onsubmit = async (ev) => {
    ev.preventDefault(); busy(true); err('');
    try { await A.signInWithEmailAndPassword(auth, $('em').value.trim(), $('pw').value); } catch (e) { err(e); }
    busy(false);
  };
  $('new').onclick = async () => {
    busy(true); err('');
    try { await A.createUserWithEmailAndPassword(auth, $('em').value.trim(), $('pw').value); } catch (e) { err(e); }
    busy(false);
  };
  $('forgot').onclick = async () => {
    const em = $('em').value.trim(); if (!em) { err('Scrie adresa de email, apoi apasă din nou.'); return; }
    try { await A.sendPasswordResetEmail(auth, em); err('Ți-am trimis pe email un link pentru o parolă nouă.'); } catch (e) { err(e); }
  };
}

// ---------- adaptorul bazei de date (aceeași interfață ca în Claude) ----------
const clean = (o) => JSON.parse(JSON.stringify(o));
const code = (e) => String(e?.code || '').replace(/^firestore\//, '').replace(/-/g, '_') || 'unavailable';
function makeDb(uid) {
  return {
    collection(path) {
      const m = String(path).match(/^data\/users\/([^/]+)$/);
      if (!m || m[1] !== uid) throw new Error('Cale necunoscută: ' + path);
      const col = F.collection(fs, 'users', uid, 'docs');
      return {
        onSnapshot(next, onErr) {
          return F.onSnapshot(col, { includeMetadataChanges: true },
            (snap) => next({ metadata: { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites }, docs: snap.docs.map((d) => ({ id: d.id, exists: true, data: () => d.data() })) }),
            (e) => onErr?.({ code: code(e), message: e.message }));
        },
        doc(id) {
          return { async set(body) { try { await F.setDoc(F.doc(col, id), clean(body)); } catch (e) { throw { code: code(e), message: e.message }; } } };
        },
      };
    },
  };
}

// ---------- notificări push ----------
const PUSH_FLAG = 'wt.push.enabled';
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32); }
const push = {
  get enabled() { try { return localStorage.getItem(PUSH_FLAG) === '1' && Notification.permission === 'granted'; } catch { return false; } },
  async supported() { return !!(M && swReg && 'Notification' in window && (await M.isSupported().catch(() => false))); },
  async enable() {
    if (isIOS && !standalone) throw new Error('Pe iPhone, notificările merg doar din aplicația adăugată pe ecranul principal: Partajează → Adaugă pe ecranul principal, apoi deschide-o de acolo.');
    if (!M || !swReg || !('Notification' in window)) throw new Error('Acest browser nu suportă notificări push.');
    const perm = await Notification.requestPermission();
    if (perm === 'granted' && !(await M.isSupported().catch(() => false))) throw new Error('Acest browser nu suportă notificări push.');
    if (perm !== 'granted') throw new Error('Notificările au fost refuzate. Le poți permite din setările telefonului pentru WorkTrack.');
    const messaging = M.getMessaging(fbApp);
    const token = await M.getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (!token) throw new Error('Nu am primit un identificator de notificări. Încearcă din nou.');
    const uid = auth.currentUser.uid;
    await F.setDoc(F.doc(fs, 'users', uid, 'push', await sha(token)), { token, ua: navigator.userAgent.slice(0, 200), standalone, at: F.serverTimestamp(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    try { localStorage.setItem(PUSH_FLAG, '1'); } catch { /* ignorat */ }
    M.onMessage(messaging, (p) => {
      const n = p.notification || p.data || {};
      swReg?.showNotification(n.title || 'WorkTrack', { body: n.body || '', icon: 'icons/icon-192.png' });
    });
    return true;
  },
  async test() {
    if (Notification.permission !== 'granted') throw new Error('Activează mai întâi notificările.');
    await swReg.showNotification('WorkTrack', { body: 'Notificările funcționează pe acest dispozitiv.', icon: 'icons/icon-192.png', tag: 'test' });
  },
};

// ---------- cont ----------
const account = {
  get email() { return auth.currentUser?.email || ''; },
  get name() { return auth.currentUser?.displayName || auth.currentUser?.email || ''; },
  get hasPassword() { return (auth.currentUser?.providerData || []).some((p) => p.providerId === 'password'); },
  get hasGoogle() { return (auth.currentUser?.providerData || []).some((p) => p.providerId === 'google.com'); },
  async setPassword(pw) {
    const u = auth.currentUser;
    try {
      if (account.hasPassword) await A.updatePassword(u, pw);
      else await A.linkWithCredential(u, A.EmailAuthProvider.credential(u.email, pw));
    } catch (e) {
      if (e?.code === 'auth/requires-recent-login') throw new Error('Din motive de siguranță, ieși din cont, intră din nou, apoi setează parola.');
      throw new Error(errMsg(e));
    }
  },
  async signOut() { await A.signOut(auth); location.reload(); },
};

window.wtWeb = { push, account, isIOS, standalone };

// ---------- acces: doar conturile aprobate de administrator ----------
const isAdmin = (u) => ADMIN_UIDS.includes(u?.uid);
const iso = (v) => (v?.toDate ? v.toDate().toISOString() : v || null);
function accessScreen(user, kind) {
  document.body.classList.add('auth');
  const T = {
    asteptare: ['Contul tău așteaptă aprobarea.', 'Administratorul a primit cererea ta. Aplicația se deschide singură imediat ce ești aprobat – poți lăsa pagina deschisă.'],
    oprit: ['Accesul tău este oprit.', 'Administratorul aplicației a oprit accesul pentru acest cont.'],
    offline: ['Fără conexiune la internet.', 'Prima intrare în cont are nevoie de internet. Pagina continuă singură când revine conexiunea.'],
    eroare: ['Nu am putut verifica accesul.', 'Încearcă din nou peste puțin timp.'],
  }[kind];
  root.innerHTML = `<main class="main" style="max-width:480px;padding-block:24px 40px">
    <section class="hero"><span class="small" style="color:var(--hero-muted);letter-spacing:.12em;font-weight:800">WORKTRACK PRO MAX</span>
      <h1 style="font-size:1.8rem">${T[0]}</h1><p style="color:var(--hero-muted)">${T[1]}</p></section>
    <section class="panel"><p class="small">Conectat ca <b>${esc(user.email || user.displayName || '')}</b></p>
      <div class="row"><button id="out">Ieși din cont</button>${kind === 'eroare' ? '<button id="re">Încearcă din nou</button>' : ''}</div></section></main>`;
  root.querySelector('#out').onclick = async () => { await A.signOut(auth); location.reload(); };
  root.querySelector('#re')?.addEventListener('click', () => location.reload());
}
async function lockOut() {
  // Accesul a fost oprit cât timp aplicația era deschisă: ștergem copia locală și repornim (apare ecranul „oprit”).
  try { await F.terminate(fs); await F.clearIndexedDbPersistence(fs); } catch { /* ignorat */ }
  location.reload();
}
function gate(user) {
  return new Promise((resolve) => {
    if (isAdmin(user)) { resolve(); return; }
    const ref = F.doc(fs, 'access', user.uid);
    let allowed = false, creating = false, seen = false;
    F.onSnapshot(ref, { includeMetadataChanges: true }, async (snap) => {
      const st = snap.exists() ? snap.get('status') : null;
      if (st === 'activ') {
        if (!seen && !snap.metadata.fromCache) { seen = true; F.updateDoc(ref, { lastSeen: F.serverTimestamp(), email: user.email || '', name: user.displayName || '' }).catch(() => {}); }
        if (!allowed) { allowed = true; resolve(); }
        return;
      }
      if (allowed) { if (!snap.metadata.fromCache) lockOut(); return; }
      if (!snap.exists()) {
        if (snap.metadata.fromCache) { if (navigator.onLine === false) accessScreen(user, 'offline'); return; }
        if (creating) return;
        creating = true;
        try { await F.setDoc(ref, { email: user.email || '', name: user.displayName || '', status: 'asteptare', createdAt: F.serverTimestamp() }); }
        catch (e) { console.warn('access', e); accessScreen(user, 'eroare'); }
        return;
      }
      accessScreen(user, st === 'oprit' ? 'oprit' : 'asteptare');
    }, (e) => { if (allowed) lockOut(); else { console.warn('access', e); accessScreen(user, 'eroare'); } });
  });
}
const admin = {
  watch(cb) {
    return F.onSnapshot(F.collection(fs, 'access'), (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data(), createdAt: iso(d.get('createdAt')), lastSeen: iso(d.get('lastSeen')), changedAt: iso(d.get('changedAt')) }))), (e) => cb(null, e));
  },
  setStatus(uid, status) { return F.updateDoc(F.doc(fs, 'access', uid), { status, changedAt: F.serverTimestamp() }); },
  remove(uid) { return F.deleteDoc(F.doc(fs, 'access', uid)); },
};

// ---------- pornire ----------
let started = false;
A.getRedirectResult(auth).catch(() => {});
A.onAuthStateChanged(auth, async (user) => {
  if (!user) { if (started) location.reload(); else loginScreen(); return; }
  if (started) return;
  started = true;
  root.innerHTML = '<div id="boot"><p>Se verifică accesul…</p></div>';
  await gate(user);
  window.wtWeb.admin = isAdmin(user) ? admin : null;
  document.body.classList.remove('auth');
  const shim = {
    db: makeDb(user.uid),
    user: { id: async () => user.uid, me: async () => ({ id: user.uid, name: user.displayName || user.email || 'eu' }), isOwner: () => true, canEdit: () => true },
    downloads: {
      async save({ filename, data }) {
        const type = /\.pdf$/i.test(filename) ? 'application/pdf' : /\.xlsx$/i.test(filename) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.csv$/i.test(filename) ? 'text/csv' : 'application/json';
        const file = new File([data], filename, { type });
        if ((isIOS || /Android/i.test(navigator.userAgent)) && navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e?.name === 'AbortError') throw { code: 'declined' }; }
        }
        const url = URL.createObjectURL(file);
        const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      },
    },
  };
  window.claude = { use: async (name) => shim[name] || null };
  root.innerHTML = '<div id="boot"><p>Se încarcă datele…</p></div>';
  await import('../app.js');
  if (push.enabled) push.enable().catch(() => {});
});

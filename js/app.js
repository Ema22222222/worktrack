// app.js — pornirea aplicației, contextul comun, navigarea, remindere.
import { Store } from './store.js';
import { computeAll, openShift, shiftStatus } from './calc.js';
import { localDate, fmtDur, toMs } from './util.js';
import { icon, esc, toast } from './ui.js';
import { ROUTES, NAV_MAIN, NAV_GROUPS } from './routes.js';
import { checkReminders } from './reminders.js';

export const DEFAULT_SETTINGS = {
  tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid'; } catch { return 'Europe/Madrid'; } })(),
  currency: 'EUR', theme: 'auto', activeContractId: null, gps: false, autoBackup: true,
  reminders: { enabled: true, startLateMin: 45, breakLongMin: 75, overNorm: true, endLateMin: 60, noProduction: true, incomplete: true, paymentsOverdueDays: 45 },
};

class App {
  constructor() {
    this.store = new Store();
    this.platform = { db: null, user: null, downloads: null, assets: null };
    this.route = 'azi';
    this._calc = null; this._calcKey = '';
    this.params = {};
  }
  state() { return this.store.state(); }
  settings() {
    const s = this.state().settings || {};
    return { ...DEFAULT_SETTINGS, ...s, reminders: { ...DEFAULT_SETTINGS.reminders, ...(s.reminders || {}) } };
  }
  saveSettings(patch, reason = 'Setări') { this.store.put('settings', { id: 'settings', ...patch }, { reason, undoable: false }); }
  get tz() { return this.settings().tz; }
  get cur() { return this.settings().currency; }
  now() { return Date.now(); }
  today() { return localDate(Date.now(), this.tz); }
  calc() {
    const key = `${this.store.version}|${Math.floor(Date.now() / 20000)}|${this.tz}`;
    if (this._calcKey !== key) {
      this._calc = computeAll(this.state(), { tz: this.tz, now: Date.now() });
      this._calcKey = key;
    }
    return this._calc;
  }
  // ---- nume și selecții ----
  byId(type, id) { return this.store.get(id) && this.store.get(id)._t === type ? this.store.get(id) : null; }
  name(id, fallback = '—') { const d = id && this.store.get(id); return d ? (d.name || fallback) : fallback; }
  employers() { return this.store.list('employer'); }
  contracts(employerId) { return this.store.list('contract').filter((c) => !employerId || c.employerId === employerId); }
  activities() { return this.store.list('activity').filter((a) => !a.archived); }
  activeContract() {
    const s = this.settings();
    const list = this.contracts();
    return list.find((c) => c.id === s.activeContractId) || list.find((c) => !c.to || c.to >= this.today()) || list[0] || null;
  }
  currencyFor(employerId) { const e = employerId && this.store.get(employerId); return e?.currency || this.cur; }
  openShift() { return openShift(this.state()); }

  // ---- navigare ----
  go(route, params = {}) {
    this.params = params;
    if (location.hash.slice(1) !== route) { try { history.replaceState(null, '', '#' + route); } catch { location.hash = route; } }
    this.route = route;
    this.render();
    window.scrollTo?.(0, 0);
  }
  render() {
    const r = ROUTES[this.route] ? this.route : 'azi';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === r || (a.dataset.nav === 'mai-mult' && !NAV_MAIN.includes(r))));
    const main = document.getElementById('main');
    const keepScroll = window.scrollY;
    try { ROUTES[r].render(main, this); }
    catch (e) { console.error(e); main.innerHTML = `<div class="note bad"><b>Eroare la afișare.</b> ${esc(e.message)}. Datele tale nu sunt afectate.</div>`; }
    if (this._soft) window.scrollTo?.(0, keepScroll);
    this._soft = false;
  }
  /** Re-randare fără a muta pagina (după salvări). */
  refresh() { this._soft = true; this.render(); this.renderSync(); }
  renderSync() {
    const el = document.getElementById('sync'); if (!el) return;
    const st = this.store.status;
    let cls = '', txt = '';
    if (st.mode === 'local') { cls = 'local'; txt = 'Doar pe acest dispozitiv'; }
    else if (st.error) { cls = 'error'; txt = st.error; }
    else if (st.pending) { cls = 'pending'; txt = `${st.pending} în așteptare`; }
    else if (!st.loaded) { cls = 'pending'; txt = 'Se încarcă…'; }
    else { txt = 'Sincronizat'; }
    el.className = 'sync ' + cls;
    el.title = txt;
    el.innerHTML = `<span class="dot"></span><span>${esc(txt)}</span>`;
  }
  applyTheme() {
    const t = this.settings().theme;
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else if (this._themeSet) root.removeAttribute('data-theme');
    this._themeSet = t !== 'auto';
  }
  async download(filename, data) {
    const dl = this.platform.downloads;
    if (!dl) { toast('Descărcarea fișierelor nu este disponibilă în această vizualizare.', { bad: true }); return false; }
    try { await dl.save({ filename, data }); toast('Fișier pregătit pentru salvare.'); return true; }
    catch (e) {
      if (e?.code === 'declined') return false;
      toast(e?.code === 'rate_limited' ? 'Așteaptă câteva secunde și încearcă din nou.' : `Nu s-a putut salva fișierul (${e?.code || 'eroare'}).`, { bad: true });
      return false;
    }
  }
}

export const app = new App();
window.__wt = app;

function shellHtml() {
  const navLink = (key) => { const r = ROUTES[key]; return `<a href="#${key}" data-nav="${key}">${icon(r.icon)}<span>${esc(r.short || r.title)}</span></a>`; };
  return `<div class="shell">
    <header class="topbar">
      <div class="brand">${icon('truck')}<span>WORKTRACK<small>Pro Max</small></span></div>
      <div class="sync" id="sync" role="status"></div>
    </header>
    <nav class="side" aria-label="Meniu">${NAV_GROUPS.map((g) => `<div class="label grp">${esc(g.title)}</div>${g.items.map((k) => { const r = ROUTES[k]; return `<a href="#${k}" data-nav="${k}">${icon(r.icon)}<span>${esc(r.title)}</span></a>`; }).join('')}`).join('')}</nav>
    <main class="main" id="main"></main>
    <nav class="bottomnav" aria-label="Navigare rapidă">${NAV_MAIN.map(navLink).join('')}<a href="#mai-mult" data-nav="mai-mult">${icon('more')}<span>Mai mult</span></a></nav>
  </div>`;
}

async function boot() {
  const root = document.getElementById('app');
  root.innerHTML = shellHtml();
  const fromHash = () => { const h = location.hash.slice(1); app.route = ROUTES[h] ? h : 'azi'; app.params = {}; app.render(); };
  window.addEventListener('hashchange', fromHash);
  app.store.subscribe(() => { app.applyTheme(); app.renderSync(); if (!app._suppress) scheduleRender(); });
  window.addEventListener('online', () => app.store.setOnline(true));
  window.addEventListener('offline', () => app.store.setOnline(false));
  app.store.status.online = navigator.onLine !== false;
  app.applyTheme();
  fromHash();
  app.renderSync();

  // conectare la platformă (asincron; pagina funcționează și fără)
  const use = (n) => (window.claude?.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
  const [db, user, downloads, assets] = await Promise.all([use('db'), use('user'), use('downloads'), use('assets')]);
  Object.assign(app.platform, { db, user, downloads, assets });
  let uidv = null;
  try { uidv = user ? await user.id() : null; } catch { uidv = null; }
  if (db && uidv) {
    try { const me = await user.me(); app.store.userLabel = me?.name || 'eu'; } catch { /* nume indisponibil */ }
    await app.store.connect(db, uidv);
  } else {
    await app.store.connect(null, null);
    toast('Mod local: datele se salvează doar în acest browser. Intră în cont pentru sincronizare.', { ms: 9000 });
  }
  app.refresh();

  // ceas + remindere
  setInterval(() => { if (app.route === 'azi' && !document.querySelector('.overlay')) app.refresh(); }, 15000);
  setInterval(() => checkReminders(app), 60000);
  setTimeout(() => checkReminders(app), 4000);
  setInterval(() => app.store.flush(), 30000);
  import('./backup.js').then((m) => m.autoBackup(app)).catch(() => {});
}

let renderTimer = null;
function scheduleRender() {
  if (document.querySelector('.overlay')) return; // nu re-randa sub un dialog deschis
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => app.refresh(), 60);
}

boot();
export { fmtDur, toMs, shiftStatus };

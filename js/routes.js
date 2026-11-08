// routes.js — paginile aplicației (ancorele #nume din adresă).
import * as today from './pages/today.js';
import * as month from './pages/month.js';
import * as calendar from './pages/calendar.js';
import * as production from './pages/production.js';
import * as overtime from './pages/overtime.js';
import * as holidays from './pages/holidays.js';
import * as leave from './pages/leave.js';
import * as money from './pages/money.js';
import * as reports from './pages/reports.js';
import * as stats from './pages/stats.js';
import * as employers from './pages/employers.js';
import * as expenses from './pages/expenses.js';
import * as settings from './pages/settings.js';
import * as users from './pages/users.js';
import { icon, esc } from './ui.js';

export const ROUTES = {
  azi: { title: 'Azi', icon: 'today', render: today.render },
  luna: { title: 'Pontaj lunar', short: 'Luna', icon: 'cal', render: month.render },
  calendar: { title: 'Calendar și detalii zi', short: 'Calendar', icon: 'grid', render: calendar.render },
  productie: { title: 'Producție și norme', short: 'Producție', icon: 'log', render: production.render },
  suplimentare: { title: 'Ore extra (suplimentare)', short: 'Ore extra', icon: 'ot', render: overtime.render },
  sarbatori: { title: 'Sărbători legale', icon: 'star', render: holidays.render },
  compensatorii: { title: 'Sold ore extra', icon: 'comp', render: leave.renderComp },
  concedii: { title: 'Concedii și zile libere', icon: 'leave', render: leave.renderLeave },
  bani: { title: 'Bani și plăți', short: 'Bani', icon: 'money', render: money.render },
  rapoarte: { title: 'Rapoarte și export', icon: 'report', render: reports.render },
  statistici: { title: 'Statistici', icon: 'stats', render: stats.render },
  angajatori: { title: 'Angajatori, contracte, reguli', short: 'Angajatori', icon: 'people', render: employers.render },
  locatii: { title: 'Locații', icon: 'pin', render: employers.renderLocations },
  cheltuieli: { title: 'Cheltuieli', icon: 'fuel', render: expenses.render },
  setari: { title: 'Setări și backup', icon: 'gear', render: settings.render },
  utilizatori: { title: 'Utilizatori', icon: 'people', render: users.render },
  istoric: { title: 'Istoric modificări', icon: 'history', render: settings.renderAudit },
  'mai-mult': { title: 'Mai mult', icon: 'more', render: renderMore },
};
export const NAV_MAIN = ['azi', 'luna', 'productie', 'bani'];
export const NAV_GROUPS = [
  { title: 'Pontaj', items: ['azi', 'luna', 'calendar', 'productie'] },
  { title: 'Ore', items: ['suplimentare', 'sarbatori', 'compensatorii', 'concedii'] },
  { title: 'Bani', items: ['bani', 'cheltuieli'] },
  { title: 'Analiză', items: ['rapoarte', 'statistici'] },
  { title: 'Configurare', items: ['angajatori', 'locatii', 'setari', 'istoric'] },
];

function renderMore(root) {
  root.innerHTML = `<div class="pagehead"><h1>Mai mult</h1></div>
  ${NAV_GROUPS.map((g) => `<section class="stack"><div class="label">${esc(g.title)}</div><div class="list">${g.items.map((k) =>
    `<a class="item click" href="#${k}" style="text-decoration:none;color:inherit">${icon(ROUTES[k].icon)}<div class="grow"><b>${esc(ROUTES[k].title)}</b></div>${icon('chev')}</a>`).join('')}</div></section>`).join('')}`;
}

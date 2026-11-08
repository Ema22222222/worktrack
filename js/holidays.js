// holidays.js — PROPUNERI de sărbători legale (calculate pe reguli cunoscute).
// Sunt importate cu statutul "neconfirmată": utilizatorul trebuie să le verifice și să le confirme,
// deoarece calendarele oficiale se pot schimba de la an la an și diferă pe regiuni și localități.

import { addDays, pad } from './util.js';

export function easterWestern(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(month)}-${pad(day)}`;
}
export function easterOrthodox(y) {
  const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1; // calendar iulian
  return addDays(`${y}-${pad(month)}-${pad(day)}`, 13); // valabil 1900–2099
}

const fx = (y, md, name, scope = 'national', region = '') => ({ date: `${y}-${md}`, name, scope, region });

export const PRESETS = {
  ES: {
    label: 'Spania',
    regions: { '': 'Doar naționale', NA: 'Navarra', GA: 'Galicia' },
    build(y, region) {
      const E = easterWestern(y);
      const out = [
        fx(y, '01-01', 'Anul Nou'), fx(y, '01-06', 'Bobotează (Epifanía)'),
        { date: addDays(E, -2), name: 'Vinerea Mare (Viernes Santo)', scope: 'national' },
        fx(y, '05-01', 'Ziua Muncii'), fx(y, '08-15', 'Adormirea Maicii Domnului (Asunción)'),
        fx(y, '10-12', 'Fiesta Nacional de España'), fx(y, '11-01', 'Ziua Tuturor Sfinților'),
        fx(y, '12-06', 'Ziua Constituției'), fx(y, '12-08', 'Imaculata Concepție'), fx(y, '12-25', 'Crăciunul'),
      ];
      if (region === 'NA') {
        out.push({ date: addDays(E, -3), name: 'Joia Mare (Jueves Santo) – Navarra', scope: 'regional', region: 'NA' });
        out.push({ date: addDays(E, 1), name: 'Lunes de Pascua – Navarra', scope: 'regional', region: 'NA' });
        out.push(fx(y, '12-03', 'San Francisco Javier – Navarra', 'regional', 'NA'));
      }
      if (region === 'GA') {
        out.push({ date: addDays(E, -3), name: 'Joia Mare (Jueves Santo) – Galicia', scope: 'regional', region: 'GA' });
        out.push(fx(y, '05-17', 'Día das Letras Galegas', 'regional', 'GA'));
        out.push(fx(y, '07-25', 'Día Nacional de Galicia', 'regional', 'GA'));
      }
      return out;
    },
    note: 'În Spania, comunitățile autonome pot muta sau înlocui unele sărbători în fiecare an, iar fiecare localitate are 2 sărbători locale proprii. Verifică BOE / DOG și adaugă manual sărbătorile locale.',
  },
  FR: {
    label: 'Franța',
    regions: { '': 'Franța metropolitană', AM: 'Alsacia-Moselle' },
    build(y, region) {
      const E = easterWestern(y);
      const out = [
        fx(y, '01-01', 'Jour de l’an'), { date: addDays(E, 1), name: 'Lundi de Pâques', scope: 'national' },
        fx(y, '05-01', 'Fête du Travail'), fx(y, '05-08', 'Victoire 1945'),
        { date: addDays(E, 39), name: 'Ascension', scope: 'national' }, { date: addDays(E, 50), name: 'Lundi de Pentecôte', scope: 'national' },
        fx(y, '07-14', 'Fête nationale'), fx(y, '08-15', 'Assomption'), fx(y, '11-01', 'Toussaint'),
        fx(y, '11-11', 'Armistice 1918'), fx(y, '12-25', 'Noël'),
      ];
      if (region === 'AM') {
        out.push({ date: addDays(E, -2), name: 'Vendredi saint (Alsace-Moselle)', scope: 'regional', region: 'AM' });
        out.push(fx(y, '12-26', 'Saint-Étienne (Alsace-Moselle)', 'regional', 'AM'));
      }
      return out;
    },
    note: 'În Franța, faptul că o zi este sărbătoare legală nu înseamnă automat că este nelucrătoare sau plătită cu spor – depinde de convenția colectivă și de contract. Lundi de Pentecôte poate fi „zi de solidaritate”.',
  },
  RO: {
    label: 'România',
    regions: { '': 'Național' },
    build(y) {
      const E = easterOrthodox(y);
      return [
        fx(y, '01-01', 'Anul Nou'), fx(y, '01-02', 'Anul Nou (a doua zi)'), fx(y, '01-06', 'Boboteaza'), fx(y, '01-07', 'Sf. Ioan Botezătorul'),
        fx(y, '01-24', 'Ziua Unirii Principatelor'),
        { date: addDays(E, -2), name: 'Vinerea Mare', scope: 'national' }, { date: E, name: 'Paștele', scope: 'national' },
        { date: addDays(E, 1), name: 'A doua zi de Paște', scope: 'national' },
        fx(y, '05-01', 'Ziua Muncii'), fx(y, '06-01', 'Ziua Copilului'),
        { date: addDays(E, 49), name: 'Rusaliile', scope: 'national' }, { date: addDays(E, 50), name: 'A doua zi de Rusalii', scope: 'national' },
        fx(y, '08-15', 'Adormirea Maicii Domnului'), fx(y, '11-30', 'Sf. Andrei'), fx(y, '12-01', 'Ziua Națională'),
        fx(y, '12-25', 'Crăciunul'), fx(y, '12-26', 'A doua zi de Crăciun'),
      ];
    },
    note: 'Lista se poate modifica prin lege; verifică Codul muncii (art. 139) pentru anul respectiv.',
  },
};

export const COUNTRIES = { ES: 'Spania', FR: 'Franța', RO: 'România', PT: 'Portugalia', IT: 'Italia', DE: 'Germania', AT: 'Austria', BE: 'Belgia', NL: 'Olanda', OTHER: 'Altă țară' };

/** Construiește propunerile (neconfirmate) pentru țară/regiune/an. */
export function buildProposals(country, region, year) {
  const p = PRESETS[country];
  if (!p) return [];
  return p.build(year, region).map((h) => ({ ...h, country, status: 'neconfirmata', source: `Propunere calculată (${p.label} ${year})` }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

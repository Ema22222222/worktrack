// places.js — locurile de muncă (ex. Arano, Franța): alegere dintr-o atingere, ultima folosită
// rămâne implicită. Dacă GPS-ul este permis, se propune automat locul salvat cel mai apropiat.
import { esc, icon } from './ui.js';
import { getLocation } from './actions.js';
import { COUNTRIES } from './holidays.js';

export const places = (app) => app.store.list('location');
export function defaultPlace(app) {
  const id = app.settings().lastLocationId;
  const d = id && app.store.get(id);
  return d && !d.deleted ? id : (places(app)[0]?.id || null);
}

export function placeChips(app, selected) {
  return `<div class="placechips" role="radiogroup" aria-label="Locul de muncă">${places(app).map((l) => `<button type="button" role="radio" aria-checked="${l.id === selected}" class="pchip${l.id === selected ? ' on' : ''}" data-place="${l.id}">${icon('pin')}<span>${esc(l.name)}${l.country ? `<small>${esc(COUNTRIES[l.country] || l.country)}</small>` : ''}</span></button>`).join('')}
    <button type="button" class="pchip add" data-place-add>${icon('plus')}<span>Alt loc</span></button></div>`;
}

/** Leagă alegerea; onChange(id). Re-desenează după adăugarea unui loc nou. */
export function bindPlaceChips(app, host, initial, onChange) {
  let cur = initial;
  const draw = () => {
    host.innerHTML = placeChips(app, cur);
    host.querySelectorAll('[data-place]').forEach((b) => { b.onclick = () => { cur = cur === b.dataset.place ? null : b.dataset.place; draw(); onChange(cur); }; });
    host.querySelector('[data-place-add]').onclick = async () => {
      const m = await import('./pages/employers.js');
      const created = await m.editLocation(app);
      if (created) { cur = created.id; onChange(cur); }
      draw();
    };
  };
  draw();
  return { set: (id) => { cur = id; draw(); onChange(cur); } };
}

const km = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
/** Locul salvat cel mai apropiat (max. 60 km), dacă GPS-ul e activat și funcționează. */
export async function nearestPlace(app) {
  const g = await getLocation(app);
  if (!g) return null;
  let best = null;
  for (const l of places(app)) {
    if (l.lat == null || l.lng == null) continue;
    const d = km(g, { lat: Number(l.lat), lng: Number(l.lng) });
    if (d <= 60 && (!best || d < best.d)) best = { id: l.id, d, geo: g };
  }
  return best || { id: null, geo: g };
}

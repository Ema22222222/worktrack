// util.js — funcții pure: ID-uri, fus orar, date calendaristice, formatare.
// Nu atinge DOM-ul; este importat și de teste (Node).

export function uid(prefix = 'x') {
  const r = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  return `${prefix}_${r}`;
}

export const MIN = 60000;
export const HOUR = 3600000;

export const toMs = (v) => (v == null || v === '' ? null : typeof v === 'number' ? v : Date.parse(v));
export const toIso = (ms) => (ms == null ? null : new Date(ms).toISOString());

// ---------- Fus orar ----------
const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}
const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Părțile orei locale pentru un moment (ms) într-un fus orar. dow: 1=luni..7=duminică */
export function tzParts(ms, tz) {
  const o = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, dow: WD[o.weekday] };
}
/** Decalajul fusului (ms) la momentul dat: oraLocală - UTC */
export function tzOffset(ms, tz) {
  const p = tzParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}
export const pad = (n, l = 2) => String(n).padStart(l, '0');
export function localDate(ms, tz) { const p = tzParts(ms, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
export function localTime(ms, tz) { const p = tzParts(ms, tz); return `${pad(p.h)}:${pad(p.mi)}`; }

/** Ora locală "YYYY-MM-DD" + "HH:MM" într-un fus → ms UTC. Corect la schimbarea orei (vară/iarnă).
 *  În ora "sărită" (primăvara) avansează; în ora dublată (toamna) alege prima apariție. */
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm || 0, 0);
  let guess = wall - tzOffset(wall, tz);
  const off2 = tzOffset(guess, tz);
  guess = wall - off2;
  // a doua verificare pentru tranziții
  const off3 = tzOffset(guess, tz);
  if (off3 !== off2) guess = wall - off3;
  // ora dublată: preferă prima apariție (offset mai mare)
  const earlier = guess - HOUR;
  if (localDate(earlier, tz) === dateStr && localTime(earlier, tz) === `${pad(hh)}:${pad(mm || 0)}`) return earlier;
  return guess;
}
export const startOfLocalDay = (dateStr, tz) => zonedToUtc(dateStr, '00:00', tz);

// ---------- Date calendaristice (șiruri YYYY-MM-DD, independente de fus) ----------
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function dowOf(dateStr) { // 1=luni..7=duminică
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}
export const weekStart = (dateStr) => addDays(dateStr, 1 - dowOf(dateStr));
export const monthKey = (dateStr) => dateStr.slice(0, 7);
export const monthStart = (dateStr) => dateStr.slice(0, 7) + '-01';
export function monthEnd(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m, 0));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function daysBetween(a, b) { // număr de zile de la a la b
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
export function dateRange(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
export function isoWeek(dateStr) {
  const thu = addDays(dateStr, 4 - dowOf(dateStr));
  const y = +thu.slice(0, 4);
  const w = Math.floor(daysBetween(`${y}-01-01`, thu) / 7) + 1;
  return { year: y, week: w };
}

// ---------- Intervale ----------
/** Unește intervale [s,e] suprapuse; returnează listă sortată. */
export function mergeIntervals(list) {
  const a = list.filter((x) => x[1] > x[0]).map((x) => [x[0], x[1]]).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const iv of a) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push(iv);
  }
  return out;
}
/** [s,e] minus lista de intervale (unite) → listă de intervale */
export function subtractIntervals([s, e], holes) {
  const out = []; let cur = s;
  for (const [hs, he] of mergeIntervals(holes)) {
    if (he <= cur || hs >= e) continue;
    if (hs > cur) out.push([cur, Math.min(hs, e)]);
    cur = Math.max(cur, he);
    if (cur >= e) break;
  }
  if (cur < e) out.push([cur, e]);
  return out;
}
export const sumIntervals = (l) => l.reduce((t, [s, e]) => t + Math.max(0, e - s), 0);
export function intersect(a, b) { const s = Math.max(a[0], b[0]); const e = Math.min(a[1], b[1]); return e > s ? [s, e] : null; }

// ---------- Formatare ----------
export function fmtDur(min, { sign = false } = {}) {
  if (min == null || Number.isNaN(min)) return '—';
  const neg = min < 0; let m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60); m %= 60;
  return `${neg ? '−' : sign ? '+' : ''}${h}h ${pad(m)}m`;
}
export const fmtH = (min) => (min == null ? '—' : (Math.round(min / 6) / 10).toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' h');
export function fmtMoney(v, cur = 'EUR') {
  if (v == null || Number.isNaN(v)) return '—';
  try { return new Intl.NumberFormat('ro-RO', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(v); }
  catch { return `${v.toFixed(2)} ${cur}`; }
}
export const fmtNum = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: d }));
const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const ZILE = ['', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă', 'duminică'];
export const monthName = (m) => LUNI[m - 1];
export const dayName = (dow) => ZILE[dow];
export function fmtDate(dateStr, { long = false } = {}) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  return long ? `${dayName(dowOf(dateStr))}, ${d} ${LUNI[m - 1]} ${y}` : `${pad(d)}.${pad(m)}.${y}`;
}
export const round2 = (v) => Math.round(v * 100) / 100;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

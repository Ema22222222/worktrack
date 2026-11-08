// hoja.js — foaia de ore lunară pentru birou, în spaniolă, după modelul foii scrise de mână:
// Nº · Fecha · Día · Horario · Pausa · Total · Horas extra · Lugar. Totaluri și semnătură.
import { dateRange, monthEnd, dowOf, localTime, round2, pad, addDays } from './util.js';
import { otBank } from './calc.js';
import { formDialog, toast } from './ui.js';
import { toPDF, toXLSX } from './export.js';

const DIAS = ['', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const AUS = { concediu: 'VACACIONES', liber: 'LIBRE', absenta: 'AUSENCIA', medical: 'BAJA MÉDICA', sarbatoare: 'FIESTA', recuperare: 'LIBRE (COMPENSA HORAS EXTRA)', compensatoriu: 'DESCANSO COMPENSATORIO' };
const PAISES = { ES: 'España', FR: 'Francia', RO: 'Rumanía', PT: 'Portugal', IT: 'Italia', DE: 'Alemania' };
const h = (min) => round2((min || 0) / 60);
const fmtN = (v) => Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 }).replace('-', '−');

export function buildHoja(app, month, { employerId } = {}) {
  const R = app.calc();
  const from = month + '-01', to = monthEnd(from);
  const [y, m] = month.split('-').map(Number);
  const rows = []; let n = 0;
  const places = new Set();
  let totMin = 0, extMin = 0, pauMin = 0;
  for (const d of dateRange(from, to)) {
    const shifts = (R.days.get(d) || []).filter((c) => !employerId || c.employerId === employerId).sort((a, b) => a.t.start - b.t.start);
    const abs = app.store.list('absence').filter((a) => a.from <= d && (a.to || a.from) >= d && (!employerId || !a.employerId || a.employerId === employerId));
    if (!shifts.length && !abs.length) continue;
    const fecha = `${pad(+d.slice(8))}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
    if (!shifts.length) {
      const a0 = abs[0];
      const fromBank = (a0.type === 'recuperare' || a0.type === 'compensatoriu') && Number(a0.minutes) > 0;
      const horario = fromBank ? `LIBRE – COMPENSA ${fmtN(h(a0.minutes))} h EXTRA` : (AUS[a0.type] || 'LIBRE');
      rows.push({ n: ++n, fecha, dia: DIAS[dowOf(d)], horario, pausa: '', total: '', extra: '', lugar: '' });
      continue;
    }
    const eff = shifts.reduce((t, c) => t + c.t.effMin, 0);
    const ot = shifts.reduce((t, c) => t + c.otMin, 0);
    const br = shifts.reduce((t, c) => t + c.t.breakMin, 0);
    totMin += eff; extMin += ot; pauMin += br;
    const hol = shifts.flatMap((c) => c.slices).find((s) => s.holiday);
    const horario = shifts.some((c) => c.shift.hoursOnly) ? (hol ? 'FIESTA' : '—')
      : shifts.flatMap((c) => c.t.effIntervals.map(([s, e]) => `${localTime(s, app.tz)}–${localTime(e, app.tz)}`)).join(' | ');
    const lugar = [...new Set(shifts.map((c) => c.location?.name).filter(Boolean))].join(', ');
    if (lugar) places.add(lugar);
    rows.push({ n: ++n, fecha, dia: DIAS[dowOf(d)] + (hol ? ' (FIESTA)' : ''), horario, pausa: br ? h(br) : '', total: h(eff), extra: ot ? h(ot) : '', lugar });
  }
  const emp = employerId ? app.store.get(employerId) : app.store.get(app.activeContract()?.employerId);
  const worker = app.settings().workerName || '';
  const showPlace = places.size > 0;
  const columns = [
    { key: 'n', label: 'Nº', num: true }, { key: 'fecha', label: 'FECHA' }, { key: 'dia', label: 'DÍA' }, { key: 'horario', label: 'HORARIO' },
    { key: 'pausa', label: 'PAUSA', num: true }, { key: 'total', label: 'TOTAL', num: true }, { key: 'extra', label: 'EXTRA', num: true },
    ...(showPlace ? [{ key: 'lugar', label: 'LUGAR' }] : []),
  ];
  const fmt = fmtN;
  // Observaciones: doar dacă în lună există zile libere din ore extra, plăți de ore extra sau ajustări.
  const obs = [];
  const st = app.state();
  const B = otBank(st, R, to);
  const inMonth = (r) => r.date >= from && r.date <= to;
  const dayoffs = B.rows.filter((r) => r.kind === 'dayoff' && inMonth(r));
  const paid = B.rows.filter((r) => r.kind === 'paid' && inMonth(r));
  const adj = B.rows.filter((r) => r.kind === 'adjust' && inMonth(r));
  if (dayoffs.length || paid.length || adj.length) {
    const fd = (iso) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    const items = [];
    for (const r of dayoffs) {
      const need = -r.min;
      items.push(r.date + '|' + `• ${fd(r.date)} (${DIAS[dowOf(r.date)].toLowerCase()}): día libre compensado con ${fmt(h(need))} h de horas extra acumuladas${r.uncovered > 0 ? ` (${fmt(h(r.covered))} h cubiertas por el saldo, ${fmt(h(r.uncovered))} h sin cubrir)` : ''}.`);
    }
    for (const r of paid) items.push(r.date + '|' + `• ${fd(r.date)}: pagadas ${fmt(h(-r.min))} h extra${r.month ? ` correspondientes a ${MESES[+r.month.slice(5, 7) - 1].toLowerCase()} ${r.month.slice(0, 4)}` : ''}.`);
    for (const r of adj) items.push(r.date + '|' + `• ${fd(r.date)}: ajuste del saldo ${r.min >= 0 ? '+' : '−'}${fmt(h(Math.abs(r.min)))} h${r.note ? ` (${r.note})` : ''}.`);
    items.sort();
    for (const it of items) obs.push(it.slice(11));
    const prev = otBank(st, R, addDays(from, -1)).balance;
    const sum = (k) => B.rows.filter((r) => r.kind === k && inMonth(r)).reduce((t, r) => t + r.min, 0);
    const earned = sum('earn'), used = -sum('dayoff'), payd = -sum('paid'), ad = sum('adjust');
    obs.push(`Saldo de horas extra: anterior ${fmt(h(prev))} h + generadas este mes ${fmt(h(earned))} h − compensadas con días libres ${fmt(h(used))} h − pagadas ${fmt(h(payd))} h${ad ? ` ${ad >= 0 ? '+' : '−'} ajustes ${fmt(h(Math.abs(ad)))} h` : ''} = ${fmt(h(B.balance))} h pendientes a ${fd(to)}.`);
  }
  return {
    title: `HOJA DE HORAS · ${MESES[m - 1]} ${y}`,
    headerLines: [
      `Trabajador: ${worker || '—'}`,
      `Empresa: ${emp?.name || '—'}${places.size ? `   ·   Lugar: ${[...places].join(', ')}` : ''}`,
      `Mes: ${pad(m)}/${y}`,
    ],
    subtitle: '', locale: 'es-ES', orientation: 'portrait', fontSize: 9.5, theme: 'grid',
    footer: (p) => `Página ${p}`,
    summaryLines: [{ text: `TOTAL HORAS EXTRA = ${fmt(h(extMin))} h`, size: 15 },
      ...(obs.length ? [{ text: ' ', size: 4 }, { text: 'OBSERVACIONES', size: 11 }, ...obs.map((t) => ({ text: t, size: 9.5 }))] : [])],
    observaciones: obs,
    sections: [{ title: 'Horas', sheet: `${MESES[m - 1]} ${y}`, columns, rows,
      totals: { n: '', fecha: 'TOTAL', total: h(totMin), extra: h(extMin) } }],
    totals: { totMin, extMin, rows: rows.length },
  };
}

async function ensureName(app) {
  if (app.settings().workerName) return true;
  const v = await formDialog({ title: 'Numele tău pe foaie', fields: [{ name: 'workerName', label: 'Nume și prenume (apare pe PDF)', required: true }], submitLabel: 'Continuă' });
  if (!v) return false;
  app.saveSettings({ workerName: v.workerName });
  return true;
}

export async function exportHoja(app, month, kind = 'pdf') {
  if (!(await ensureName(app))) return;
  const rep = buildHoja(app, month);
  if (!rep.sections[0].rows.length) { toast('Nu ai ore înregistrate în această lună.', { bad: true }); return; }
  const name = `horas-${month}`;
  try {
    if (kind === 'pdf') await app.download(`${name}.pdf`, await toPDF(rep));
    else await app.download(`${name}.xlsx`, await toXLSX(rep));
  } catch (e) { toast(e.message || 'Exportul nu a reușit.', { bad: true }); }
}

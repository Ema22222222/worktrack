// hoja.js — foaia de ore lunară pentru birou, în spaniolă, după modelul foii scrise de mână:
// Nº · Fecha · Día · Horario · Pausa · Total · Horas extra · Lugar. Totaluri și semnătură.
import { dateRange, monthEnd, dowOf, localTime, round2, pad } from './util.js';
import { formDialog, toast } from './ui.js';
import { toPDF, toXLSX } from './export.js';

const DIAS = ['', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const AUS = { concediu: 'VACACIONES', liber: 'LIBRE', absenta: 'AUSENCIA', medical: 'BAJA MÉDICA', sarbatoare: 'FIESTA', recuperare: 'LIBRE (COMPENSA HORAS EXTRA)', compensatoriu: 'DESCANSO COMPENSATORIO' };
const PAISES = { ES: 'España', FR: 'Francia', RO: 'Rumanía', PT: 'Portugal', IT: 'Italia', DE: 'Alemania' };
const h = (min) => round2((min || 0) / 60);

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
    if (!shifts.length) { rows.push({ n: ++n, fecha, dia: DIAS[dowOf(d)], horario: AUS[abs[0].type] || 'LIBRE', pausa: '', total: '', extra: '', lugar: '' }); continue; }
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
  const fmt = (v) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
  return {
    title: `HOJA DE HORAS · ${MESES[m - 1]} ${y}`,
    headerLines: [
      `Trabajador: ${worker || '—'}`,
      `Empresa: ${emp?.name || '—'}${places.size ? `   ·   Lugar: ${[...places].join(', ')}` : ''}`,
      `Mes: ${pad(m)}/${y}`,
    ],
    subtitle: '', locale: 'es-ES', orientation: 'portrait', fontSize: 9.5, theme: 'grid',
    footer: (p) => `Página ${p}`,
    summaryLines: [{ text: `TOTAL HORAS EXTRA = ${fmt(h(extMin))} h`, size: 15 }],
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

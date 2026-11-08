// export.js — export CSV, Excel (.xlsx) și PDF. Bibliotecile se încarcă doar când sunt folosite.
const LIBS = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
};
const loaded = new Map();
function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = resolve; s.onerror = () => reject(new Error('Biblioteca de export nu s-a putut încărca (verifică conexiunea).'));
    document.head.append(s);
  });
  loaded.set(src, p); return p;
}

/** CSV cu separator ";" și BOM, ca să fie deschis corect de Excel în limba română. */
export function toCSV(report) {
  const q = (v) => { const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [];
  for (const sec of report.sections) {
    if (report.sections.length > 1) lines.push(q(sec.title));
    lines.push(sec.columns.map((c) => q(c.label)).join(';'));
    for (const r of sec.rows) lines.push(sec.columns.map((c) => q(r[c.key])).join(';'));
    if (sec.totals) lines.push(sec.columns.map((c) => q(sec.totals[c.key])).join(';'));
    lines.push('');
  }
  return '﻿' + lines.join('\r\n');
}

export async function toXLSX(report) {
  await loadScript(LIBS.xlsx);
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  report.sections.forEach((sec, i) => {
    const aoa = [[report.title], [report.subtitle], [], sec.columns.map((c) => c.label), ...sec.rows.map((r) => sec.columns.map((c) => r[c.key] ?? '')),
      ...(sec.totals ? [sec.columns.map((c) => sec.totals[c.key] ?? '')] : [])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = sec.columns.map((c) => ({ wch: Math.max(10, Math.min(48, c.label.length + 4, c.w || 14)) }));
    XLSX.utils.book_append_sheet(wb, ws, (sec.sheet || sec.title || `Foaia ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  });
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}

let fontB64 = null;
async function font() {
  if (fontB64) return fontB64;
  const r = await fetch('fonts/DejaVuSans.ttf');
  if (!r.ok) throw new Error('Fontul pentru PDF nu s-a putut încărca.');
  const buf = new Uint8Array(await r.arrayBuffer());
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  fontB64 = btoa(s);
  return fontB64;
}

export async function toPDF(report) {
  await loadScript(LIBS.jspdf);
  await loadScript(LIBS.autotable);
  const { jsPDF } = window.jspdf;
  const wide = report.orientation ? report.orientation === 'landscape' : report.sections.some((s) => s.columns.length > 7);
  const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const loc = report.locale || 'ro-RO';
  const fs = report.fontSize || 7.5;
  const f = await font();
  doc.addFileToVFS('DejaVuSans.ttf', f);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  const W = doc.internal.pageSize.getWidth();
  doc.setFontSize(15); doc.text(report.title, 14, 16);
  let y = 22;
  doc.setFontSize(10); doc.setTextColor(40);
  for (const line of report.headerLines || [report.subtitle]) { doc.text(line, 14, y); y += 5; }
  doc.setFontSize(9); doc.setTextColor(90);
  if (report.note) { const l = doc.splitTextToSize(report.note, W - 28); doc.text(l, 14, y); y += l.length * 4; }
  y += 1;
  for (const sec of report.sections) {
    if (report.sections.length > 1) { doc.setFontSize(11); doc.setTextColor(20); doc.text(sec.title, 14, y); y += 3; }
    doc.autoTable({
      startY: y + 1,
      head: [sec.columns.map((c) => c.label)],
      body: sec.rows.map((r) => sec.columns.map((c) => fmtCell(r[c.key], c, loc))),
      foot: sec.totals ? [sec.columns.map((c) => fmtCell(sec.totals[c.key], c, loc))] : undefined,
      theme: report.theme || 'striped',
      styles: { font: 'DejaVu', fontSize: fs, cellPadding: fs > 8 ? 2.2 : 1.5, overflow: 'linebreak', lineColor: [150, 150, 150], lineWidth: report.theme === 'grid' ? 0.2 : 0 },
      headStyles: { fillColor: [31, 107, 69], textColor: 255, fontStyle: 'normal' },
      footStyles: { fillColor: [232, 238, 233], textColor: 20, fontStyle: 'normal' },
      columnStyles: Object.fromEntries(sec.columns.map((c, i) => [i, c.num ? { halign: 'right' } : {}])),
      margin: { left: 12, right: 12 },
      didParseCell: (d) => { if (sec.columns[d.column.index]?.num) d.cell.styles.halign = 'right'; },
      didDrawPage: () => {
        doc.setFontSize(7); doc.setTextColor(120);
        doc.text(report.footer ? report.footer(doc.internal.getNumberOfPages()) : `WorkTrack Pro Max · generat ${new Date().toLocaleString('ro-RO')} · pagina ${doc.internal.getNumberOfPages()}`, 12, doc.internal.pageSize.getHeight() - 6);
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }
  if (report.summaryLines?.length) {
    const H = doc.internal.pageSize.getHeight();
    if (y + report.summaryLines.length * 8 > H - 12) { doc.addPage(); y = 20; }
    doc.setTextColor(20);
    for (const l of report.summaryLines) { doc.setFontSize(l.size || 11); doc.text(l.text, 14, y); y += (l.size || 11) * 0.5 + 3; }
  }
  return doc.output('arraybuffer');
}
function fmtCell(v, c, loc = 'ro-RO') {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return v.toLocaleString(loc, { maximumFractionDigits: c.dec ?? 2, minimumFractionDigits: c.fixed ? (c.dec ?? 2) : 0 });
  return String(v);
}

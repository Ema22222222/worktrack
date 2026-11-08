// ui.js — componente de interfață reutilizabile: dialoguri, formulare, notificări, pictograme.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Pictograme (SVG simple, stroke) ----------
const P = {
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  resume: '<path d="M6 4.5v15l12.5-7.5z"/>',
  swap: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
  stack: '<path d="M3 17h18M5 13h14M7 9h10M9 5h6"/>',
  today: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  prod: '<path d="M4 18h16M6 18V9l6-4 6 4v9M10 18v-5h4v5"/>',
  log: '<ellipse cx="7" cy="12" rx="3" ry="5"/><path d="M7 7h11a3 5 0 0 1 0 10H7"/><ellipse cx="7" cy="12" rx="1" ry="1.8"/>',
  money: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  ot: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4h3M9.5 3h5"/>',
  star: '<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8z"/>',
  comp: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>',
  report: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M10 12h5M10 15.5h5"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  people: '<path d="M4 20v-1a5 5 0 0 1 10 0v1M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M16 11a3 3 0 1 0-1-5.8M17 14.5a4.5 4.5 0 0 1 3.5 4.4V20"/>',
  leave: '<path d="M3 20h18M5 20c0-6 3-10 7-12 4 2 7 6 7 12M12 8V3"/>',
  fuel: '<path d="M5 20V5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14 5v15M4 20h11M5 10h9M14 8l3 2.5V17a1.5 1.5 0 0 0 3 0V8l-2.5-2.5"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 1 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4.5V9H8M12 8v4.5l3 1.8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  note: '<path d="M5 4h14v12l-4 4H5zM15 20v-4h4M8.5 9h7M8.5 12.5h5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chev: '<path d="m9 6 6 6-6 6"/>', chevl: '<path d="m15 6-6 6 6 6"/>',
  dl: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  ul: '<path d="M12 16V5M7 9.5l5-5 5 5M5 20h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5 2.5 20h19zM12 10v4.5M12 17.2v.3"/>',
  truck: '<path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3.5 3.5v2.5h-7.5"/><circle cx="6.5" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>',
};
export const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// ---------- Notificări scurte ----------
export function toast(msg, { undo, bad = false, ms = 5000 } = {}) {
  let host = $('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('role', 'status'); document.body.append(host); }
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (undo) {
    const b = document.createElement('button'); b.textContent = 'Anulează'; b.className = 'btn-sm';
    b.onclick = () => { el.remove(); undo(); };
    el.append(b);
  }
  host.append(el);
  while (host.children.length > 2) host.firstElementChild.remove();
  setTimeout(() => el.remove(), undo ? Math.max(ms, 8000) : ms);
}

// ---------- Dialog generic ----------
let dialogDepth = 0;
export function openDialog({ title, body = '', actions = [], onMount, wide = false, dismissable = true }) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.style.zIndex = String(50 + dialogDepth++);
    ov.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="${wide ? 'max-width:900px' : ''}">
      <header><h2>${esc(title)}</h2><button class="btn-ghost iconbtn" data-x aria-label="Închide">${icon('x')}</button></header>
      <div class="dbody stack">${body}</div>
      ${actions.length ? `<footer>${actions.map((a, i) => `<button data-i="${i}" class="${a.cls || ''}" ${a.id ? `id="${a.id}"` : ''}>${a.label}</button>`).join('')}</footer>` : ''}
    </div>`;
    const close = (v) => { ov.remove(); dialogDepth--; document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
    document.addEventListener('keydown', key);
    ov.addEventListener('click', (e) => { if (e.target === ov && dismissable) close(null); });
    ov.querySelector('[data-x]').onclick = () => close(null);
    const dlg = ov.querySelector('.dialog');
    const api = { el: dlg, close };
    ov.querySelectorAll('footer [data-i]').forEach((b) => {
      b.onclick = async () => {
        const a = actions[+b.dataset.i];
        if (a.onClick) { const r = await a.onClick(api); if (r === false) return; close(r === undefined ? a.value : r); }
        else close(a.value);
      };
    });
    document.body.append(ov);
    onMount?.(api);
    const first = dlg.querySelector('input:not([type=checkbox]):not([type=hidden]), select, textarea');
    if (first && window.matchMedia('(min-width: 700px)').matches) first.focus();
  });
}

/** Confirmare construită în pagină (confirm() nu funcționează în acest mediu). */
export function confirmDialog(message, { title = 'Confirmare', okLabel = 'Confirmă', danger = false, reason = false, reasonLabel = 'Motivul (opțional)', reasonRequired = false } = {}) {
  return openDialog({
    title,
    body: `<p>${message}</p>${reason ? `<label class="f">${esc(reasonLabel)}${reasonRequired ? ' *' : ''}<input id="cf-reason" type="text" autocomplete="off"></label><p class="tiny muted" id="cf-err"></p>` : ''}`,
    actions: [
      { label: 'Renunță', value: null },
      { label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', onClick: (api) => {
        const r = api.el.querySelector('#cf-reason')?.value.trim() || '';
        if (reasonRequired && !r) { api.el.querySelector('#cf-err').textContent = 'Scrie un motiv – rămâne în istoric.'; return false; }
        return { ok: true, reason: r };
      } },
    ],
  });
}

// ---------- Formulare declarative ----------
/**
 * fields: [{ name, label, type: text|number|date|time|select|textarea|checkbox|checks|datetime|hidden|html|file,
 *            options: [[value,label]], value, required, help, step, min, full, placeholder, show: (vals)=>bool }]
 */
export function fieldHtml(f, idp) {
  const id = `${idp}-${f.name}`;
  const req = f.required ? ' required' : '';
  const v = f.value ?? '';
  const help = f.help ? `<span class="help">${f.help}</span>` : '';
  const cls = `f${f.full ? ' full' : ''}`;
  const wrap = (inner) => `<label class="${cls}" data-field="${f.name}">${esc(f.label)}${f.required ? ' *' : ''}${inner}${help}</label>`;
  switch (f.type) {
    case 'hidden': return `<input type="hidden" id="${id}" name="${f.name}" value="${esc(v)}">`;
    case 'html': return `<div class="${f.full !== false ? 'full' : ''}" data-field="${f.name}">${f.html}</div>`;
    case 'textarea': return wrap(`<textarea id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || '')}"${req}>${esc(v)}</textarea>`);
    case 'select': return wrap(`<select id="${id}" name="${f.name}"${req}>${(f.options || []).map(([ov, ol]) => `<option value="${esc(ov)}"${String(ov) === String(v) ? ' selected' : ''}>${esc(ol)}</option>`).join('')}</select>`);
    case 'checkbox': return `<label class="chk ${f.full ? 'full' : ''}" data-field="${f.name}"><input type="checkbox" id="${id}" name="${f.name}"${v ? ' checked' : ''}> ${esc(f.label)}${f.help ? ` <span class="tiny muted">${f.help}</span>` : ''}</label>`;
    case 'checks': return `<fieldset class="${f.full !== false ? 'full' : ''}" data-field="${f.name}"><legend>${esc(f.label)}</legend><div class="row">${(f.options || []).map(([ov, ol]) => `<label class="chk"><input type="checkbox" name="${f.name}" value="${esc(ov)}"${(v || []).map(String).includes(String(ov)) ? ' checked' : ''}> ${esc(ol)}</label>`).join('')}</div>${help}</fieldset>`;
    case 'file': return wrap(`<input type="file" id="${id}" name="${f.name}" ${f.accept ? `accept="${f.accept}"` : ''} ${f.multiple ? 'multiple' : ''}>`);
    default: return wrap(`<input type="${f.type || 'text'}" id="${id}" name="${f.name}" value="${esc(v)}"${f.step ? ` step="${f.step}"` : ''}${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''} placeholder="${esc(f.placeholder || '')}" autocomplete="off"${req}>`);
  }
}

export function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'html') continue;
    if (f.type === 'checks') { out[f.name] = [...root.querySelectorAll(`input[name="${f.name}"]:checked`)].map((i) => i.value); continue; }
    const el = root.querySelector(`[name="${f.name}"]`);
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (f.type === 'file') out[f.name] = [...(el.files || [])];
    else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value.replace(',', '.'));
    else out[f.name] = el.value.trim();
  }
  return out;
}

let formSeq = 0;
/** Dialog cu formular. Rezolvă cu valorile sau null. validate(vals) → mesaj de eroare sau null (poate fi async). */
export function formDialog({ title, fields, submitLabel = 'Salvează', validate, intro = '', extraActions = [], wide = false }) {
  const idp = `fm${++formSeq}`;
  const body = `${intro}<form class="fgrid" id="${idp}" novalidate>${fields.map((f) => fieldHtml(f, idp)).join('')}</form><p class="small" style="color:var(--bad)" id="${idp}-err" role="alert"></p>`;
  const applyShow = (root) => {
    const vals = readForm(root, fields);
    for (const f of fields) if (f.show) { const el = root.querySelector(`[data-field="${f.name}"]`); if (el) el.hidden = !f.show(vals); }
  };
  return openDialog({
    title, body, wide,
    onMount: (api) => {
      const form = api.el.querySelector('form');
      form.addEventListener('input', () => applyShow(api.el));
      form.addEventListener('change', () => applyShow(api.el));
      form.addEventListener('submit', (e) => { e.preventDefault(); api.el.querySelector('footer .btn-primary')?.click(); });
      applyShow(api.el);
    },
    actions: [
      { label: 'Renunță', value: null },
      ...extraActions,
      { label: submitLabel, cls: 'btn-primary', onClick: async (api) => {
        const vals = readForm(api.el, fields);
        for (const f of fields) {
          if (!f.required) continue;
          const hiddenField = api.el.querySelector(`[data-field="${f.name}"]`)?.hidden;
          if (hiddenField) continue;
          const v = vals[f.name];
          if (v == null || v === '' || (Array.isArray(v) && !v.length)) { api.el.querySelector(`#${idp}-err`).textContent = `Completează: ${f.label}`; return false; }
        }
        const err = validate ? await validate(vals, api) : null;
        if (err) { api.el.querySelector(`#${idp}-err`).textContent = err; return false; }
        return vals;
      } },
    ],
  });
}

/** Alegere rapidă dintr-o listă de butoane mari. */
export function choiceDialog({ title, choices, current, intro = '', extra = '' }) {
  return openDialog({
    title,
    body: `${intro}<div class="choicegrid">${choices.map((c, i) => `<button data-c="${i}" class="${c.value === current ? 'cur' : ''}">${c.color ? `<span class="swatch" style="background:${esc(c.color)}"></span>` : ''}<span>${esc(c.label)}</span></button>`).join('')}</div>${extra}`,
    onMount: (api) => api.el.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => api.close(choices[+b.dataset.c].value); }),
  });
}

export const options = (list, labelKey = 'name', { empty } = {}) => [
  ...(empty !== undefined ? [['', empty]] : []),
  ...list.map((x) => [x.id, x[labelKey] || '(fără nume)']),
];
export const objOptions = (obj) => Object.entries(obj);

export function pill(text, kind = '') { return `<span class="pill ${kind}">${esc(text)}</span>`; }
export function emptyState(text, actionHtml = '') { return `<div class="empty"><p>${text}</p>${actionHtml}</div>`; }

// Pagina „Azi”: ce se întâmplă acum, butoanele de pontaj potrivite momentului, rezumatul lunii.
import { esc, icon, toast, openDialog, pill } from '../ui.js';
import { fmtDur, fmtMoney, fmtDate, localTime, localDate, toMs, weekStart, addDays, monthStart, monthEnd, zonedToUtc, fmtNum } from '../util.js';
import { shiftStatus, totalsFor, validateAction, otBank } from '../calc.js';
import { startWork, breakStart, breakEnd, switchActivity, endWork, addNote, getLocation, normsFor, snapTime, snapNote } from '../actions.js';
import { setupWizard, editProduction, editShift, standardFor } from '../editors.js';
import { activeReminders, dismissReminder } from '../reminders.js';
import { fmtHM, applyStandard, dayDialog } from './month.js';
import { defaultPlace, bindPlaceChips, nearestPlace } from '../places.js';

const STATUS_TXT = { idle: 'Nu ai început', working: 'Lucrezi', break: 'În pauză', done: 'Zi terminată' };

export function render(root, app) {
  if (!app.employers().length) {
    root.innerHTML = `<section class="hero">
      <span class="label hmuted" style="color:var(--hero-muted)">WorkTrack Pro Max</span>
      <h1 style="font-size:2rem">Orele tale, exact cum le-ai lucrat.</h1>
      <p class="hmuted">Pontaj zilnic sau lunar, ore extra, sărbători, producție și bani. Fără date inventate: aplicația pornește goală.</p>
      <button class="go" id="setup">${icon('play')} ÎNCEPE CONFIGURAREA</button></section>
      <section class="panel"><h2>Vrei doar să vezi cum merge?</h2>
      <p class="small">Încarcă o lună de exemplu: zile lucrate, o fiesta, o sâmbătă, o zi liberă din ore extra și o plată de ore extra. Le ștergi oricând din Setări, dintr-un buton.</p>
      <div class="row"><button id="demo">Încarcă date de exemplu</button></div></section>`;
    root.querySelector('#setup').onclick = () => setupWizard(app);
    root.querySelector('#demo').onclick = async () => {
      const { loadDemo } = await import('../demo.js');
      if (loadDemo(app)) { toast('Date de exemplu încărcate. Uită-te prin „Luna”, „Sold ore extra” și „Rapoarte”.', { ms: 7000 }); app.go('luna'); }
    };
    return;
  }
  const st = app.state();
  const R = app.calc();
  const today = app.today();
  const open = app.openShift();
  const todays = [...R.calc.values()].filter((c) => c.date === today).sort((a, b) => a.t.start - b.t.start);
  const cOpen = open ? R.calc.get(open.id) : null;
  const focus = cOpen || todays[todays.length - 1] || null;
  const status = open ? shiftStatus(open) : (todays.length ? 'done' : 'idle');
  const dayKey = cOpen ? cOpen.date : today;
  const T = totalsFor(R, dayKey, dayKey);
  const contract = focus ? app.store.get(focus.contractId) : app.activeContract();
  const std = standardFor(app, contract);
  const norm = focus?.dailyNormMin ?? std.normMin;
  const M = totalsFor(R, monthStart(today), monthEnd(today));
  const mDays = new Set([...R.calc.values()].filter((c) => c.date >= monthStart(today) && c.date <= monthEnd(today) && c.t.effMin > 0).map((c) => c.date)).size;
  const curSeg = open && (open.segments || []).find((g) => !g.deleted && !g.end);
  const curAct = curSeg ? app.store.get(curSeg.activityId) : null;
  const firstStart = (cOpen ? [cOpen] : todays)[0]?.t.start ?? null;
  const prodToday = R.production.filter((p) => p.date === dayKey);
  const evals = focus?.normEvals || [];
  const hol = focus?.slices?.find((s) => s.holiday)?.holiday;
  const reminders = activeReminders(app);
  const cur = app.currencyFor(contract?.employerId);
  const pctNorm = norm ? Math.min(100, (Math.min(T.effMin, norm) / norm) * 100) : 0;
  const stdEndPassed = Date.now() >= zonedToUtc(today, std.end, app.tz) || std.end <= std.start;
  const dis = (a) => validateAction(st, a);
  const act = (a, cls, ic, label) => { const e = dis(a); return `<button class="act ${cls}" data-act="${a}" ${e ? `disabled title="${esc(e)}"` : ''}>${icon(ic)}<span>${label}</span></button>`; };

  let actions = '';
  if (status === 'working') {
    actions = `<div class="acts">${act('breakStart', 'pause', 'pause', 'Pauză')}${act('end', 'end', 'stop', 'Termină munca')}
      ${act('switch', '', 'swap', 'Schimbă activitatea')}<button class="act" data-act="prod">${icon('plus')}<span>Adaugă producție</span></button></div>`;
  } else if (status === 'break') {
    actions = `<button class="go pausego" data-act="breakEnd">${icon('resume')} TERMINĂ PAUZA</button>
      <div class="acts">${act('end', 'end', 'stop', 'Termină munca')}<button class="act" data-act="prod">${icon('plus')}<span>Adaugă producție</span></button></div>`;
  } else {
    actions = `<button class="go" data-act="start">${icon('play')} START MUNCĂ</button>
      ${!todays.length && stdEndPassed ? `<div class="acts"><button class="act wide" data-act="std">${icon('check')} Am lucrat azi programul standard (${std.start}–${std.end})</button></div>` : ''}`;
  }

  root.innerHTML = `
  ${reminders.map((r) => `<div class="note ${r.level || 'warn'}"><b>${esc(r.title)}</b> ${esc(r.text)} ${r.action ? `<button class="btn-sm" data-rem="${esc(r.key)}">${esc(r.action)}</button>` : ''} <button class="btn-sm btn-ghost" data-dis="${esc(r.key)}">Ascunde</button></div>`).join('')}
  <section class="hero" aria-label="Ziua de azi">
    <div class="hline"><span class="chip ${status}"><i></i>${STATUS_TXT[status]}${curAct ? ` · ${esc(curAct.name)}` : ''}</span><span class="hmuted small tabnum" id="clock">${esc(fmtDate(dayKey, { long: true }))}</span></div>
    ${focus?.location || hol ? `<div class="row">${focus?.location ? `<span class="chip">${icon('pin')} ${esc(focus.location.name)}</span>` : ''}${hol ? `<span class="chip">Sărbătoare: ${esc(hol.name)}</span>` : ''}</div>` : ''}
    <div class="bigtime">${fmtClock(T.effMin)}<small>lucrat</small></div>
    <div class="stack" style="gap:6px">
      <div class="hbar" role="img" aria-label="Progres față de normă"><i style="width:${pctNorm}%"></i></div>
      <div class="hline small hmuted"><span>Normă ${fmtHM(norm)}</span><span>${T.effMin < norm ? `mai ai <b style="color:var(--hero-fg)">${fmtHM(norm - T.effMin)}</b> până la normă` : `normă atinsă${T.otMin > 0 ? ` · <b style="color:var(--action)">+${fmtHM(T.otMin)} extra</b>` : ''}`}</span></div>
    </div>
    <div class="hstats">
      <div><span>Început</span><b>${firstStart ? localTime(firstStart, app.tz) : '—'}</b></div>
      <div><span>Pauză</span><b>${fmtHM(T.breakMin)}</b></div>
      <div class="x"><span>Extra</span><b>${fmtHM(T.otMin)}</b></div>
    </div>
  </section>
  ${actions}
  <div class="row">
    ${status !== 'idle' && status !== 'done' ? `<button class="btn-sm" data-act="note">${icon('note')} Observație</button>` : `<button class="btn-sm" data-act="prod">${icon('plus')} Producție</button>`}
    <button class="btn-sm" data-act="manual">${icon('edit')} ${focus ? 'Corectează ziua' : 'Completează ziua manual'}</button>
    ${app.store.canUndo() ? `<button class="btn-sm" data-act="undo">${icon('undo')} Anulează: ${esc(app.store.lastUndoLabel())}</button>` : ''}
  </div>
  ${focus && (focus.slices.length > 1 || curSeg) ? `<section class="panel">${timelineHtml(app, focus)}</section>` : ''}
  ${prodToday.length || evals.length ? `<section class="panel"><header><h2>Producție</h2><button class="btn-sm" data-act="prod">${icon('plus')} Adaugă</button></header>
    ${evals.map(normHtml).join('')}
    ${prodToday.length ? `<div class="list">${prodToday.sort((a, b) => (toMs(a.time) || 0) - (toMs(b.time) || 0)).map((p) => `<div class="item click" data-prod="${p.id}"><div class="grow"><b class="tabnum">${fmtNum(p.qty)} ${esc(p.unit)}</b> <span class="small muted">${p.time ? localTime(toMs(p.time), app.tz) : 'fără oră'}${p.activityId ? ' · ' + esc(app.name(p.activityId)) : ''}${p.note ? ' · ' + esc(p.note) : ''}</span></div>${icon('edit')}</div>`).join('')}</div>` : '<p class="small muted">Nimic înregistrat azi.</p>'}</section>` : ''}
  <section class="panel">
    <header><h2>Luna aceasta</h2><a class="btn btn-sm" href="#luna">${icon('cal')} Pontajul lunii</a></header>
    <div class="kv">
      <div><span class="label">Zile lucrate</span><b>${mDays}</b></div>
      <div><span class="label">Ore lucrate</span><b>${fmtHM(M.effMin)}</b></div>
      <div class="x"><span class="label">Ore extra</span><b>${fmtHM(M.otMin)}</b></div>
      <div class="x" role="link" tabindex="0" style="cursor:pointer;background:var(--action-soft)" onclick="location.hash='compensatorii'"><span class="label">Sold ore extra</span><b>${fmtHM(otBank(st, R).balance)}</b><span class="hint">toate lunile ›</span></div>
      ${M.holidayMin ? `<div class="hol"><span class="label">De sărbătoare</span><b>${fmtHM(M.holidayMin)}</b></div>` : ''}
      ${M.money.total ? `<div><span class="label">Câștig estimat</span><b>${fmtMoney(M.money.total, cur)}</b></div>` : ''}
    </div>
    ${!M.money.total && M.effMin ? '<p class="tiny muted">Pentru câștigul estimat, adaugă tariful orar în „Bani”.</p>' : ''}
  </section>
  ${focus?.shift?.notes ? `<section class="panel"><h2>Observații</h2><p style="white-space:pre-wrap">${esc(focus.shift.notes)}</p></section>` : ''}`;

  root.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => handle(app, b.dataset.act, { focus, open }); });
  root.querySelectorAll('[data-prod]').forEach((b) => { b.onclick = () => editProduction(app, b.dataset.prod); });
  root.querySelectorAll('[data-dis]').forEach((b) => { b.onclick = () => { dismissReminder(b.dataset.dis); app.refresh(); }; });
  root.querySelectorAll('[data-rem]').forEach((b) => { b.onclick = () => reminders.find((r) => r.key === b.dataset.rem)?.run?.(app); });
}

const fmtClock = (min) => { const m = Math.floor(min); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

export function otStatusPill(c) {
  const m = { eligible: ['Extra: se plătesc', 'ok'], ineligible: ['Extra: neplătibile', 'bad'], unconfirmed: ['Extra: plată neconfirmată', 'warn'], partial: ['Parțial eligibile', 'warn'] }[c.otStatus];
  return m ? pill(m[0], m[1]) : '';
}

export function normHtml(e) {
  const met = e.met === true ? pill('Normă îndeplinită', 'ok') : e.met === false ? pill('Normă neîndeplinită', 'bad') : pill('Normă neconfirmată / în curs', 'warn');
  const pct = e.pct ?? 0;
  return `<div class="stack" style="gap:6px">
    <div class="row" style="justify-content:space-between"><b>${esc(e.name || 'Normă')}</b>${met}</div>
    ${e.required != null ? `<div class="progress ${pct >= 100 ? '' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div>
      <div class="row small muted" style="justify-content:space-between"><span class="tabnum">${fmtNum(e.done)} / ${fmtNum(e.required)} ${esc(e.unit)} (${fmtNum(pct, 0)}%)</span><span>${e.remaining > 0 ? `Rămas: <b>${fmtNum(e.remaining)} ${esc(e.unit)}</b>` : 'Necesarul este acoperit'}</span></div>
      ${e.reachedAt ? `<p class="tiny muted">Atinsă la ${new Date(e.reachedAt).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })} · ${e.reachedInNormal === true ? 'în programul normal' : e.reachedInNormal === false ? 'după terminarea programului normal' : 'moment față de programul normal necunoscut'}</p>` : ''}`
    : `<p class="small muted">Realizat: <b class="tabnum">${fmtNum(e.done)} ${esc(e.unit)}</b>. ${esc(e.reason)}</p>`}
    ${e.reason && e.required != null ? `<p class="tiny muted">${esc(e.reason)}</p>` : ''}
  </div>`;
}

export function timelineHtml(app, c) {
  const s0 = c.t.start, s1 = c.t.end; const span = Math.max(1, s1 - s0);
  const parts = [];
  let cur = s0;
  const pieces = [...c.slices.map((s) => ({ s: s.s, e: s.e, act: s.activityId })), ...c.t.breaks.map(([s, e]) => ({ s, e, brk: true }))].sort((a, b) => a.s - b.s);
  for (const p of pieces) {
    if (p.s > cur) parts.push(`<i style="width:${((p.s - cur) / span) * 100}%;background:transparent"></i>`);
    const a = p.act && app.store.get(p.act);
    const color = p.brk ? 'var(--pause)' : (a?.color || 'var(--fg-3)');
    parts.push(`<i title="${esc(p.brk ? 'Pauză' : a?.name || 'Nealocat')} ${localTime(p.s, app.tz)}–${localTime(p.e, app.tz)}" style="width:${((p.e - p.s) / span) * 100}%;background:${esc(color)};${p.brk ? 'opacity:.55' : ''}"></i>`);
    cur = Math.max(cur, p.e);
  }
  const used = [...new Set(c.slices.map((s) => s.activityId))];
  return `<div class="stack" style="gap:6px"><div class="timeline" role="img" aria-label="Desfășurarea zilei">${parts.join('')}</div>
    <div class="legend">${used.map((id) => { const a = app.store.get(id); const min = c.slices.filter((s) => s.activityId === id).reduce((t, s) => t + s.min, 0); return `<span><span class="swatch" style="background:${esc(a?.color || 'var(--fg-3)')}"></span>${esc(a?.name || 'Nealocat')} ${fmtDur(min)}</span>`; }).join('')}
    ${c.t.breakMin ? `<span><span class="swatch" style="background:var(--pause);opacity:.55"></span>Pauze ${fmtDur(c.t.breakMin)}</span>` : ''}</div></div>`;
}

async function pickActivity(app, { title, current, withTime = true, startLabel, snapKind = null }) {
  const acts = app.activities();
  const locs = app.store.list('location');
  const now = Date.now();
  const def = snapKind ? snapTime(app, now, snapKind) : now;
  const nowT = localTime(def, app.tz);
  const help = def !== now ? `Ora din program (acum e ${localTime(now, app.tz)}). O poți schimba.` : 'Lasă ora curentă sau corectează dacă ai uitat să apeși.';
  const body = `${withTime ? `<div class="fgrid"><label class="f">Ora<input type="time" id="pa-time" value="${nowT}"><span class="help">${help}</span></label>
    <div class="f full"><span class="label">Unde lucrezi azi?</span><div id="pa-place"></div><span class="tiny muted" id="pa-gps"></span></div></div>` : ''}
    <div class="choicegrid">${acts.map((a) => `<button data-a="${a.id}" class="${a.id === current ? 'cur' : ''}"><span class="swatch" style="background:${esc(a.color || 'var(--accent)')}"></span>${esc(a.name)}</button>`).join('')}
      ${startLabel ? `<button data-a="">${esc(startLabel)}</button>` : ''}</div>
    ${acts.length ? '' : '<p class="small muted">Nu ai activități definite. Le poți adăuga din „Angajatori, contracte, reguli”.</p>'}`;
  return openDialog({
    title, body,
    onMount: (api) => {
      let place = defaultPlace(app); let geo = null;
      const host = api.el.querySelector('#pa-place');
      const chips = host ? bindPlaceChips(app, host, place, (id) => { place = id; }) : null;
      if (host && app.settings().gps) {
        api.el.querySelector('#pa-gps').textContent = 'Caut poziția GPS…';
        nearestPlace(app).then((r) => {
          const el = api.el.querySelector('#pa-gps'); if (!el) return;
          if (!r) { el.textContent = 'GPS indisponibil – alege locul.'; return; }
          geo = r.geo;
          if (r.id) { chips.set(r.id); el.textContent = `Detectat automat: ${app.name(r.id)} (${Math.round(r.d)} km).`; } else el.textContent = 'Poziția a fost salvată; niciun loc salvat în apropiere.';
        });
      }
      api.el.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => {
        const t = api.el.querySelector('#pa-time')?.value;
        if (place) app.saveSettings({ lastLocationId: place });
        api.close({ activityId: b.dataset.a || null, at: t ? atToday(app, t) : Date.now(), locationId: place || null, geo });
      }; });
    },
  });
}

/** Ora aleasă azi; dacă e în viitor cu peste 1 minut, înseamnă ieri (tură peste miezul nopții). */
function atToday(app, hhmm) {
  if (hhmm === localTime(Date.now(), app.tz)) return Date.now();
  let t = zonedToUtc(app.today(), hhmm, app.tz);
  // Câteva minute în viitor sunt permise (ora din program, ex. 08:00 apăsat la 07:56); mai mult = ieri.
  if (t > Date.now() + 30 * 60000) t = zonedToUtc(addDays(app.today(), -1), hhmm, app.tz);
  return t;
}

async function timeDialog(app, title, { note = true, extra = '', def = Date.now() } = {}) {
  const now = Date.now();
  return openDialog({
    title,
    body: `${extra}<div class="fgrid"><label class="f">Ora<input type="time" id="td-time" value="${localTime(def, app.tz)}">${def !== now ? `<span class="help">Ora din program (acum e ${localTime(now, app.tz)}). O poți schimba.</span>` : ''}</label>
      ${note ? '<label class="f full">Observație (opțional)<input type="text" id="td-note"></label>' : ''}</div>`,
    actions: [{ label: 'Renunță', value: null }, { label: 'Confirmă', cls: 'btn-primary', onClick: (api) => ({ at: atToday(app, api.el.querySelector('#td-time').value || localTime(Date.now(), app.tz)), note: api.el.querySelector('#td-note')?.value.trim() || '' }) }],
  });
}

async function handle(app, act, { focus, open }) {
  const done = (msg) => { toast(msg, { undo: () => { app.store.undo(); app.refresh(); } }); app.refresh(); };
  try {
    switch (act) {
      case 'start': {
        const last = [...app.store.list('shift')].sort((a, b) => (b.start || '').localeCompare(a.start || ''))[0];
        const lastAct = last?.segments?.filter((g) => !g.deleted).slice(-1)[0]?.activityId;
        const pressed = Date.now();
        const r = await pickActivity(app, { title: 'START MUNCĂ – cu ce începi?', current: lastAct, startLabel: 'Fără activitate (aleg mai târziu)', snapKind: 'start' });
        if (!r) return;
        startWork(app, { ...r, geo: r.geo || null, pressedAt: pressed });
        done(`Muncă pornită la ${localTime(r.at, app.tz)}.`); break;
      }
      case 'breakStart': { const x = breakStart(app, { snap: true }); done(`Pauză începută la ${localTime(x.at, app.tz)}${snapNote(app, x.pressed, x.at)}.`); break; }
      case 'breakEnd': { const x = breakEnd(app, { snap: true }); done(`Pauză terminată la ${localTime(x.at, app.tz)}${snapNote(app, x.pressed, x.at)}.`); break; }
      case 'switch': {
        const cur = (open.segments || []).find((g) => !g.deleted && !g.end);
        const r = await pickActivity(app, { title: 'Schimbă activitatea', current: cur?.activityId });
        if (!r || !r.activityId) return;
        const geo = await getLocation(app);
        switchActivity(app, { ...r, geo });
        done(`Activitate schimbată: ${app.name(r.activityId)}.`); break;
      }
      case 'prod': editProduction(app, null, { date: app.today() }); break;
      case 'end': {
        const c = app.calc().calc.get(open.id);
        const hasNorm = (c?.normEvals || []).length > 0;
        const noProd = !app.store.list('production').some((p) => p.date === c?.date);
        const pressed = Date.now();
        const r = await timeDialog(app, 'TERMINĂ MUNCA', { def: snapTime(app, pressed, 'end', c?.date),
          extra: `<p>Timp efectiv până acum: <b>${fmtDur(c?.t.effMin || 0)}</b>, pauze ${fmtDur(c?.t.breakMin || 0)}.</p>${c?.t.openBreak ? '<p class="note warn small">Pauza deschisă va fi închisă la ora terminării.</p>' : ''}${hasNorm && noProd ? '<p class="note warn small"><b>Nu ai înregistrat producția</b> pentru azi. O poți adăuga și după.</p>' : ''}`,
        });
        if (!r) return;
        const geo = await getLocation(app);
        endWork(app, { ...r, geo, pressedAt: pressed });
        done(`Zi încheiată la ${localTime(r.at, app.tz)}. Regulile de calcul ale zilei au fost salvate.`); break;
      }
      case 'note': {
        const r = await openDialog({ title: 'Observație', body: '<label class="f">Text<textarea id="n-t"></textarea></label>', actions: [{ label: 'Renunță' }, { label: 'Salvează', cls: 'btn-primary', onClick: (api) => api.el.querySelector('#n-t').value.trim() || false }] });
        if (!r) return; addNote(app, r); done('Observație adăugată.'); break;
      }
      case 'manual': if (focus && !open) dayDialog(app, focus.date); else if (focus) editShift(app, focus.id); else dayDialog(app, app.today()); break;
      case 'std': { const ids = applyStandard(app, [app.today()], { locationId: defaultPlace(app) }); if (ids.length) { toast('Programul standard a fost pus pentru azi.', { undo: () => { for (const id of ids) app.store.remove(id, 'Anulat'); app.refresh(); } }); app.refresh(); } else toast('Nu am putut adăuga ziua (se suprapune cu altă tură).', { bad: true }); break; }
      case 'undo': if (app.store.undo()) { toast('Ultima acțiune a fost anulată (rămâne în istoric).'); app.refresh(); } break;
      default: break;
    }
  } catch (e) {
    if (e.user) toast(e.message, { bad: true }); else { console.error(e); toast('Eroare: ' + e.message, { bad: true }); }
  }
}

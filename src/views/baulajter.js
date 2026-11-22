// Site leader (Vodja delovišča): weekly hours for the crew, own monthly
// overview, and per project reports with signatures.
import { t } from '../i18n.js';
import { $, escapeHtml, showToast, showError, show } from '../ui.js';
import { onAction, onChange } from '../actions.js';
import {
  state,
  mySites,
  userById,
  activeProjects,
  projectById,
  projectName,
  getEntry,
  saveEntry,
  loadEntries,
  loadSignatures,
  getSignature,
  isLocked,
  saveBauList,
  ensureProject,
  linkSiteProject,
  archiveProject,
} from '../store.js';
import { addDays, currentWeekStart, isoWeek, shiftWeek, todayStr, weekDates, weekKey, fmtDE } from '../dates.js';
import { buildMonthlyCardHtml, loadMonth } from './monthly.js';
import { downloadStundennachweis, renderElementToPdf } from '../pdf.js';
import { openSignatureModal, requestKundeSignature, findSiteForProject } from './signature.js';

const view = {
  weekStart: currentWeekStart(),
  activeSiteId: '',
  reportWeekStart: currentWeekStart(),
  reportProjectId: '',
};

const kwLabel = (weekStart) => {
  const { year, week } = isoWeek(weekStart);
  return `KW ${week} (${year})`;
};

// ---------------------------------------------------------------- site and list

function getActiveSite() {
  const sites = mySites();
  return sites.find((s) => s.id === view.activeSiteId) || sites[0] || null;
}

/** People the leader may enter hours for on this site. */
function allowedIds(site) {
  return site ? site.memberIds : [state.me.id];
}

/** The leader's working list; starts as the whole site group. */
function listIds(site) {
  if (!site) return [state.me.id];
  const saved = state.bauLists.get(site.id);
  const allowed = new Set(allowedIds(site));
  return (saved ? saved : [...site.memberIds]).filter((id) => allowed.has(id));
}

function initSiteSelector() {
  const sites = mySites();
  if (sites.length === 0) {
    show('bauSiteHeaderSelector', false);
    view.activeSiteId = '';
    return;
  }
  show('bauSiteHeaderSelector', true);
  if (!sites.some((s) => s.id === view.activeSiteId)) view.activeSiteId = sites[0].id;
  $('bauActiveSiteSelect').innerHTML = sites
    .map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === view.activeSiteId ? 'selected' : ''}>${escapeHtml(s.location)}</option>`)
    .join('');
}

function populateAddSelect() {
  const select = $('bauAddPersonSelect');
  const site = getActiveSite();
  if (!site) {
    select.innerHTML = `<option value="">${escapeHtml(t('bau.noSiteOption'))}</option>`;
    return;
  }
  const current = listIds(site);
  const options = site.memberIds
    .map(userById)
    .filter(Boolean)
    .filter((u) => !current.includes(u.id))
    .map((u) => {
      const label =
        u.id === state.me.id
          ? `⭐ ${u.name} (${t('bau.optMe')})`
          : u.role === 'baulajter'
            ? `🦺 ${u.name} (${t('bau.optLeader')})`
            : `👷 ${u.name} (${t('bau.optWorker')})`;
      return `<option value="${escapeHtml(u.id)}">${escapeHtml(label)}</option>`;
    })
    .join('');
  select.innerHTML = `<option value="">${escapeHtml(t('bau.pickFromGroup', { site: site.location }))}</option>${options}`;
}

function renderProjectsList() {
  const container = $('bauProjectsListContainer');
  const projects = activeProjects();
  if (projects.length === 0) {
    container.innerHTML = `<span class="text-[11px] text-slate-500 italic">${escapeHtml(t('bau.noProjects'))}</span>`;
    return;
  }
  container.innerHTML = projects
    .map(
      (p) => `
      <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-emerald-400 font-medium">
        <span>${escapeHtml(p.name)}</span>
        <button type="button" data-action="bau-project-remove" data-id="${escapeHtml(p.id)}" class="text-slate-500 hover:text-red-400"><i class="fa-solid fa-xmark"></i></button>
      </span>`,
    )
    .join('');
}

// ---------------------------------------------------------------- weekly table

function renderTable() {
  const tbody = $('bauTableBody');
  const site = getActiveSite();
  const dates = weekDates(view.weekStart);

  // Re-rendering replaces the inputs; put the cursor back where it was.
  const focused = document.activeElement?.closest?.('#bauTableBody [data-user]');
  const focusKey = focused
    ? `[data-user="${focused.dataset.user}"][data-date="${focused.dataset.date}"][data-kind="${focused.dataset.kind}"]`
    : '';

  $('bauCurrentSiteLabel').innerText = site ? `Baustelle: ${site.location}` : t('bau.noSite');

  const searchQ = ($('bauSearchListInput').value || '').trim().toLowerCase();
  const people = listIds(site)
    .map(userById)
    .filter(Boolean)
    .filter((u) => !searchQ || u.name.toLowerCase().includes(searchQ));

  $('bauActiveListCount').innerText = people.length;

  if (people.length === 0) {
    tbody.innerHTML = '';
    show('bauEmptyMessage', true);
    $('bauTotalWeeklyHours').innerText = '0 h';
    $('bauTotalWeeklyBreakdown').innerText = t('bau.breakdown', { w: 0, t: 0 });
    return;
  }
  show('bauEmptyMessage', false);

  const projects = activeProjects();
  let grandW = 0;
  let grandT = 0;

  tbody.innerHTML = people
    .map((person, idx) => {
      let pWork = 0;
      let pTravel = 0;

      const daysHtml = dates
        .map((date) => {
          const rec = getEntry(person.id, date);
          pWork += rec.workHours;
          pTravel += rec.travelHours;
          const locked = isLocked(rec.projectId, date);
          const dis = locked ? 'disabled' : '';
          const dim = locked ? 'opacity-50 cursor-not-allowed' : '';
          const ids = `data-user="${escapeHtml(person.id)}" data-date="${date}"`;

          let projOptions = `<option value="">${escapeHtml(t('bau.noProject'))}</option>`;
          if (rec.projectId && !projects.some((p) => p.id === rec.projectId)) {
            projOptions += `<option value="${escapeHtml(rec.projectId)}" selected>${escapeHtml(projectName(rec.projectId))}</option>`;
          }
          projOptions += projects
            .map((p) => `<option value="${escapeHtml(p.id)}" ${rec.projectId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
            .join('');

          return `
          <td class="p-2 align-top border-l border-slate-700/60">
            <div class="flex flex-col gap-1.5">
              <select ${dis} data-change="bau-project" ${ids} data-kind="project" class="project-select ${locked ? 'opacity-60 cursor-not-allowed' : ''}">
                ${projOptions}
              </select>
              ${locked ? `<div class="text-[10px] font-bold text-emerald-400 text-center"><i class="fa-solid fa-lock"></i> ${escapeHtml(t('bau.signedAg'))}</div>` : ''}
              <div class="flex items-center justify-between gap-1 bg-indigo-950/40 p-1 rounded border border-indigo-900/50">
                <button type="button" ${dis} data-action="bau-quick" ${ids} data-type="work" data-kind="quick-work"
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${rec.workHours > 0 ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 text-indigo-400 border-slate-700'} ${dim}">
                  10h (R)
                </button>
                <div class="flex items-center">
                  <span class="text-[10px] font-bold text-indigo-400 mr-1">R:</span>
                  <input type="number" min="0" max="24" step="0.5" inputmode="decimal" ${dis} value="${rec.workHours}"
                    data-change="bau-hours" ${ids} data-type="work" data-kind="work"
                    class="w-10 text-xs text-center p-0.5 bg-slate-900 border border-indigo-900/60 rounded text-white ${dim}">
                </div>
              </div>
              <div class="flex items-center justify-between gap-1 bg-amber-950/40 p-1 rounded border border-amber-900/50">
                <button type="button" ${dis} data-action="bau-quick" ${ids} data-type="travel" data-kind="quick-travel"
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${rec.travelHours > 0 ? 'bg-amber-600 text-white border-amber-500' : 'bg-slate-800 text-amber-400 border-slate-700'} ${dim}">
                  10h (P)
                </button>
                <div class="flex items-center">
                  <span class="text-[10px] font-bold text-amber-400 mr-1">P:</span>
                  <input type="number" min="0" max="24" step="0.5" inputmode="decimal" ${dis} value="${rec.travelHours}"
                    data-change="bau-hours" ${ids} data-type="travel" data-kind="travel"
                    class="w-10 text-xs text-center p-0.5 bg-slate-900 border border-amber-900/60 rounded text-white ${dim}">
                </div>
              </div>
            </div>
          </td>`;
        })
        .join('');

      grandW += pWork;
      grandT += pTravel;
      const pTotal = pWork + pTravel;

      const roleSub =
        person.role === 'baulajter'
          ? `<div class="text-[10px] font-bold text-emerald-400 uppercase mt-0.5">${escapeHtml(t('role.baulajter'))}</div>`
          : `<div class="text-[10px] text-slate-400 uppercase mt-0.5">${escapeHtml(t(`role.${person.role}`))}</div>`;

      return `
      <tr class="transition border-b border-slate-700/60 ${pTotal === 0 ? 'zero-hours-row' : ''}">
        <td class="p-3 font-bold text-center text-slate-400 align-top pt-4">
          <span class="row-number-text">${idx + 1}.</span>
          <span class="row-number"></span>
        </td>
        <td class="p-3 align-top pt-4">
          <div class="font-bold text-white">${escapeHtml(person.name)}</div>
          ${roleSub}
        </td>
        ${daysHtml}
        <td class="p-3 text-center align-middle border-l border-slate-700/60 bg-slate-900/30">
          <div class="flex flex-col gap-1 items-center">
            <span class="px-2 py-0.5 rounded text-xs font-bold bg-indigo-950 text-indigo-300 border border-indigo-800/60">R: ${pWork}h</span>
            <span class="px-2 py-0.5 rounded text-xs font-bold bg-amber-950 text-amber-300 border border-amber-800/60">P: ${pTravel}h</span>
            <span class="text-xs font-black text-white border-t border-slate-700 pt-1 w-full text-center mt-0.5">${escapeHtml(t('common.total'))}: ${pTotal}h</span>
          </div>
        </td>
        <td class="p-3 text-center align-middle border-l border-slate-700/60 no-pdf">
          <button type="button" data-action="bau-remove-person" data-user="${escapeHtml(person.id)}" class="text-slate-500 hover:text-red-400 p-2 rounded-lg hover:bg-slate-700 transition" title="${escapeHtml(t('bau.removeFromList'))}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </td>
      </tr>`;
    })
    .join('');

  $('bauTotalWeeklyHours').innerText = `${grandW + grandT} h`;
  $('bauTotalWeeklyBreakdown').innerText = t('bau.breakdown', { w: grandW, t: grandT });

  if (focusKey) tbody.querySelector(focusKey)?.focus();
}

async function loadWeek() {
  await Promise.all([
    loadEntries(view.weekStart, addDays(view.weekStart, 6)),
    loadSignatures(view.weekStart, view.weekStart),
  ]);
}

function renderWeeklyAll() {
  $('currentKwDisplay').innerText = kwLabel(view.weekStart);
  initSiteSelector();
  populateAddSelect();
  renderProjectsList();
  renderTable();
}

export async function showWeekly() {
  renderWeeklyAll();
  try {
    await loadWeek();
  } catch (err) {
    showError(err);
  }
  renderWeeklyAll();
}

/** Saves one day and redraws; on failure the table shows the stored value again. */
async function writeEntry(userId, date, patch) {
  const pending = saveEntry(userId, date, patch);
  renderTable();
  try {
    await pending;
  } catch (err) {
    showError(err);
    if (err.code === 'LOCKED') await loadWeek().catch(() => {});
    renderTable();
  }
}

function lockedToast() {
  showToast(t('bau.locked'), true);
}

// ---------------------------------------------------------------- my hours

export async function showMyHours() {
  const picker = $('bauMyMonthPicker');
  try {
    await loadMonth(picker.value);
  } catch (err) {
    showError(err);
  }
  $('bauMyMonthlyContent').innerHTML = buildMonthlyCardHtml(state.me, picker.value);
}

// ---------------------------------------------------------------- projects and signatures

function renderReport() {
  const container = $('bauTabProjects');
  const siteProjectIds = new Set(mySites().flatMap((s) => s.projectIds));
  const projects = activeProjects().filter((p) => siteProjectIds.has(p.id));
  if (!projects.some((p) => p.id === view.reportProjectId)) {
    const current = projectById(view.reportProjectId);
    if (!current) view.reportProjectId = projects[0]?.id || '';
  }
  const pid = view.reportProjectId;
  const pname = projectName(pid);
  const week = view.reportWeekStart;
  const kw = isoWeek(week).week;
  const sig = getSignature(pid, week);
  const kundeSigned = Boolean(sig.kundeSignature);

  const rows = [];
  if (pid) {
    for (const u of state.users) {
      let w = 0;
      let tr = 0;
      for (const date of weekDates(week)) {
        const e = getEntry(u.id, date);
        if (e.projectId === pid) {
          w += e.workHours;
          tr += e.travelHours;
        }
      }
      if (w + tr > 0) rows.push({ user: u, work: w, travel: tr, total: w + tr });
    }
  }
  const sum = (f) => rows.reduce((s, r) => s + r[f], 0);

  const selectable = projects.some((p) => p.id === pid) || !pid ? projects : [projectById(pid), ...projects];
  const pidAttr = escapeHtml(pid);

  container.innerHTML = `
    <div class="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-lg space-y-5">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700 pb-4">
        <div>
          <h2 class="text-base font-bold text-white">${escapeHtml(t('report.title'))}</h2>
          <p class="text-xs text-slate-400">${escapeHtml(t('report.hint'))}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <select data-change="report-project" class="project-select min-w-[200px]">
            ${selectable.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === pid ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
          <div class="flex items-center bg-slate-900 rounded-xl p-1 border border-slate-700">
            <button type="button" data-action="report-week" data-delta="-1" class="px-2.5 py-1 hover:bg-slate-800 rounded text-slate-300"><i class="fa-solid fa-chevron-left"></i></button>
            <span class="px-3 text-xs font-bold text-indigo-400">${kwLabel(week)}</span>
            <button type="button" data-action="report-week" data-delta="1" class="px-2.5 py-1 hover:bg-slate-800 rounded text-slate-300"><i class="fa-solid fa-chevron-right"></i></button>
          </div>
          <button type="button" data-action="report-pdf" data-mode="all" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition">
            <i class="fa-solid fa-file-pdf"></i> ${escapeHtml(t('report.pdfAll'))}
          </button>
          <button type="button" data-action="report-pdf" data-mode="signed" class="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition">
            <i class="fa-solid fa-file-signature"></i> ${escapeHtml(t('report.pdfSigned'))}
          </button>
          <button type="button" data-action="report-pdf" data-mode="unsigned" class="bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition">
            <i class="fa-solid fa-clock"></i> ${escapeHtml(t('report.pdfUnsigned'))}
          </button>
        </div>
      </div>

      ${
        rows.length === 0
          ? `<p class="text-xs text-slate-400">${escapeHtml(t('report.empty1'))} <strong>${escapeHtml(pname)}</strong> ${escapeHtml(t('report.empty2', { kw }))}</p>`
          : `<div class="space-y-3">
              <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr class="bg-slate-900 text-slate-400 uppercase border-b border-slate-700">
                      <th class="p-3">#</th>
                      <th class="p-3">${escapeHtml(t('admin.db.colName'))}</th>
                      <th class="p-3 text-center">${escapeHtml(t('month.work'))}</th>
                      <th class="p-3 text-center">${escapeHtml(t('month.travel'))}</th>
                      <th class="p-3 text-center">${escapeHtml(t('common.total'))}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-700/70">
                    ${rows
                      .map(
                        (r, i) => `
                      <tr>
                        <td class="p-3 font-bold text-slate-400">${i + 1}.</td>
                        <td class="p-3 font-bold text-white">${escapeHtml(r.user.name)}</td>
                        <td class="p-3 text-center text-indigo-300 font-bold">${r.work} h</td>
                        <td class="p-3 text-center text-amber-300 font-bold">${r.travel} h</td>
                        <td class="p-3 text-center text-emerald-400 font-extrabold">${r.total} h</td>
                      </tr>`,
                      )
                      .join('')}
                  </tbody>
                  <tfoot>
                    <tr class="bg-slate-900/95 border-t-2 border-indigo-500/60 font-extrabold text-xs">
                      <td colspan="2" class="p-3 text-right text-slate-200 uppercase">${escapeHtml(t('report.totalAll', { project: pname, kw }))}</td>
                      <td class="p-3 text-center text-indigo-300">${sum('work')} h</td>
                      <td class="p-3 text-center text-amber-300">${sum('travel')} h</td>
                      <td class="p-3 text-center text-emerald-400 text-sm">${sum('total')} h</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>`
      }

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        <div class="bg-slate-900/80 p-4 rounded-xl border ${sig.userSignature ? 'border-indigo-600' : 'border-slate-700'} space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-bold uppercase text-indigo-300">${escapeHtml(t('report.sigLeader'))}</span>
            <button type="button" ${kundeSigned || !pid ? 'disabled' : ''} data-action="report-sign-leader" data-project="${pidAttr}"
              class="px-3 py-1.5 rounded-lg text-xs font-bold ${kundeSigned || !pid ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}">
              ${escapeHtml(t('report.signHours'))}
            </button>
          </div>
          ${
            sig.userSignature
              ? `<img src="${escapeHtml(sig.userSignature)}" alt="" class="rounded-lg max-h-24 p-1" style="background:#ffffff"><p class="text-[11px] font-bold text-indigo-300">${escapeHtml(t('report.signedBy'))} ${escapeHtml(sig.userSignedBy || '')}</p>`
              : `<p class="text-xs text-slate-400 italic">${escapeHtml(t('report.signFirst'))}</p>`
          }
        </div>

        <div class="bg-slate-900/80 p-4 rounded-xl border ${kundeSigned ? 'border-emerald-600' : 'border-slate-700'} space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-bold uppercase text-emerald-300">${escapeHtml(t('report.sigKunde'))}</span>
            <button type="button" ${!sig.userSignature || kundeSigned ? 'disabled' : ''} data-action="report-sign-kunde" data-project="${pidAttr}"
              class="px-3 py-1.5 rounded-lg text-xs font-bold transition ${sig.userSignature && !kundeSigned ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer' : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'}">
              ${escapeHtml(sig.userSignature ? t('report.sigKunde') : t('report.kundeWaiting'))}
            </button>
          </div>
          ${
            kundeSigned
              ? `<img src="${escapeHtml(sig.kundeSignature)}" alt="" class="rounded-lg max-h-24 p-1" style="background:#ffffff"><p class="text-[11px] font-bold text-emerald-400"><i class="fa-solid fa-lock"></i> ${escapeHtml(t('report.lockedNote'))}</p>`
              : `<p class="text-xs text-slate-500 italic">${escapeHtml(sig.userSignature ? t('report.kundeHintReady') : t('report.kundeHintWait'))}</p>`
          }
        </div>
      </div>
    </div>
  `;
}

async function loadReportWeek() {
  await Promise.all([
    loadEntries(view.reportWeekStart, addDays(view.reportWeekStart, 6)),
    loadSignatures(view.reportWeekStart, view.reportWeekStart),
  ]);
}

export async function showReport() {
  renderReport();
  try {
    await loadReportWeek();
  } catch (err) {
    showError(err);
  }
  renderReport();
}

// ---------------------------------------------------------------- wiring

export function initBaulajter() {
  onAction('bau-week', async (d) => {
    view.weekStart = shiftWeek(view.weekStart, Number(d.delta));
    await showWeekly();
  });
  onAction('bau-week-today', async () => {
    view.weekStart = currentWeekStart();
    await showWeekly();
  });

  $('bauActiveSiteSelect').addEventListener('change', (e) => {
    view.activeSiteId = e.target.value;
    populateAddSelect();
    renderTable();
  });
  $('bauSearchListInput').addEventListener('input', renderTable);
  $('bauMyMonthPicker').addEventListener('change', showMyHours);

  onAction('bau-add-person', async () => {
    const personId = $('bauAddPersonSelect').value;
    const site = getActiveSite();
    if (!personId) return;
    if (!site || !site.memberIds.includes(personId)) {
      showToast(t('bau.onlyGroup'), true);
      return;
    }
    const ids = listIds(site);
    if (ids.includes(personId)) return;
    try {
      await saveBauList(site.id, [...ids, personId]);
      showToast(t('bau.personAdded'));
    } catch (err) {
      showError(err);
    }
    populateAddSelect();
    renderTable();
  });

  onAction('bau-remove-person', async (d) => {
    const personId = d.user;
    const lockedDate = weekDates(view.weekStart).find((date) => isLocked(getEntry(personId, date).projectId, date));
    if (lockedDate) {
      showToast(
        t('bau.removeLocked', {
          project: projectName(getEntry(personId, lockedDate).projectId),
          week: weekKey(view.weekStart),
        }),
        true,
      );
      return;
    }
    const site = getActiveSite();
    if (!site) return;
    try {
      await saveBauList(site.id, listIds(site).filter((id) => id !== personId));
    } catch (err) {
      showError(err);
    }
    populateAddSelect();
    renderTable();
  });

  onChange('bau-project', (d, el) => {
    const rec = getEntry(d.user, d.date);
    const projVal = el.value;
    if (isLocked(rec.projectId, d.date)) {
      showToast(t('bau.lockedSigned'), true);
      renderTable();
      return;
    }
    if (projVal && isLocked(projVal, d.date)) {
      showToast(t('bau.projectLocked', { project: projectName(projVal) }), true);
      renderTable();
      return;
    }
    const patch = { projectId: projVal };
    if (projVal && rec.workHours === 0 && rec.travelHours === 0) patch.workHours = 10;
    writeEntry(d.user, d.date, patch);
  });

  onAction('bau-quick', (d) => {
    const rec = getEntry(d.user, d.date);
    if (isLocked(rec.projectId, d.date)) return lockedToast();
    const patch = d.type === 'work' ? { workHours: rec.workHours === 10 ? 0 : 10 } : { travelHours: rec.travelHours === 10 ? 0 : 10 };
    writeEntry(d.user, d.date, patch);
  });

  onChange('bau-hours', (d, el) => {
    const rec = getEntry(d.user, d.date);
    if (isLocked(rec.projectId, d.date)) {
      lockedToast();
      renderTable();
      return;
    }
    const num = parseFloat(String(el.value).replace(',', '.'));
    const val = Number.isFinite(num) ? Math.min(24, Math.max(0, Math.round(num * 100) / 100)) : 0;
    writeEntry(d.user, d.date, d.type === 'work' ? { workHours: val } : { travelHours: val });
  });

  $('bauAddProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('bauNewProjectInput');
    const val = input.value.trim();
    input.value = '';
    if (!val) return;
    try {
      const projectId = await ensureProject(val);
      const site = getActiveSite();
      if (site) await linkSiteProject(site.id, projectId);
    } catch (err) {
      showError(err);
    }
    renderProjectsList();
    renderTable();
  });

  onAction('bau-project-remove', async (d) => {
    try {
      await archiveProject(d.id);
    } catch (err) {
      showError(err);
    }
    renderProjectsList();
    renderTable();
  });

  onAction('bau-weekly-pdf', async () => {
    const { year, week } = isoWeek(view.weekStart);
    $('pdfKwTitle').innerText = t('bau.pdf.week', { kw: week, year });
    $('pdfReportDate').innerText = fmtDE(todayStr());
    $('pdfTotalFooter').innerText = $('bauTotalWeeklyBreakdown').innerText;
    await renderElementToPdf($('pdfContent'), `Evidencija_Sati_KW${week}_${year}.pdf`);
  });

  // Projects and signatures tab
  onChange('report-project', async (_d, el) => {
    view.reportProjectId = el.value;
    renderReport();
  });
  onAction('report-week', async (d) => {
    view.reportWeekStart = shiftWeek(view.reportWeekStart, Number(d.delta));
    await showReport();
  });
  onAction('report-sign-leader', (d) => {
    openSignatureModal({ projectId: d.project, weekStart: view.reportWeekStart, signerType: 'bau', onSaved: renderReport });
  });
  onAction('report-sign-kunde', (d) => {
    requestKundeSignature(d.project, view.reportWeekStart, renderReport);
  });
  onAction('report-pdf', async (d) => {
    const pid = view.reportProjectId;
    if (!pid) {
      showToast(t('pdf.pickProject'), true);
      return;
    }
    const site = findSiteForProject(pid);
    const leader = site ? userById(site.baulajterId) : state.me;
    await downloadStundennachweis({
      projectId: pid,
      project: projectName(pid),
      weekStart: view.reportWeekStart,
      sig: getSignature(pid, view.reportWeekStart),
      filterMode: d.mode,
      company: site ? site.company : 'SCARA-Tec d.o.o.',
      location: site ? site.location : state.me.name,
      leaderName: leader?.name || '',
      fileLabel: projectName(pid),
    });
  });
}

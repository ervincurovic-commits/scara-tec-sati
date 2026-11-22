// Administrator: construction sites, staff accounts, monthly overview, backup.
import { t } from '../i18n.js';
import { $, escapeHtml, showToast, showError, showConfirmModal, openModal, closeModal, roleBadgeHtml } from '../ui.js';
import { onAction, onChange } from '../actions.js';
import {
  state,
  userById,
  activeProjects,
  projectName,
  getEntry,
  loadEntries,
  loadSignatures,
  getSignature,
  clearClientSignature,
  createSite,
  deleteSite,
  setSiteLeader,
  addSiteMember,
  removeSiteMember,
  setUserRole,
  adminUsers,
  exportAll,
  importAll,
} from '../store.js';
import { USERNAME_RE, MIN_PASSWORD } from '../config.js';
import { addDays, currentWeekStart, formatHoursHHMM, isoWeek, shiftWeek, todayStr, weekKey } from '../dates.js';
import { buildMonthlyCardHtml, loadMonth } from './monthly.js';
import { collectProjectWeek, downloadStundennachweis } from '../pdf.js';

const view = {
  siteId: '',
  projectId: '',
  weekStart: currentWeekStart(),
  filter: 'all',
};

const DAY_HEADS = ['Mon', 'Die', 'Mit', 'Don', 'Fre', 'Sam', 'Son'];

// ---------------------------------------------------------------- sites

function siteProjects(site) {
  const active = activeProjects();
  const own = active.filter((p) => site.projectIds.includes(p.id));
  return [...own, ...active.filter((p) => !site.projectIds.includes(p.id))];
}

function renderSites() {
  const leaders = state.users.filter((u) => u.role === 'baulajter');
  const leaderSelect = $('newSiteBaulajter');
  const keep = leaderSelect.value;
  leaderSelect.innerHTML =
    `<option value="">${escapeHtml(t('admin.site.pickLeader'))}</option>` +
    leaders.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('');
  if (leaders.some((b) => b.id === keep)) leaderSelect.value = keep;

  $('adminTotalSitesCount').innerText = state.sites.length;

  const grid = $('adminSitesGrid');
  if (state.sites.length === 0) {
    grid.innerHTML = `<div class="col-span-full bg-slate-800 border border-slate-700 rounded-xl p-6 text-center text-xs text-slate-400">${escapeHtml(t('admin.site.none'))}</div>`;
    $('adminSelectedSitePanel').classList.add('hidden');
    return;
  }

  if (!state.sites.some((s) => s.id === view.siteId)) view.siteId = state.sites[0].id;

  grid.innerHTML = state.sites
    .map((site) => {
      const leader = userById(site.baulajterId);
      const members = site.memberIds.map(userById).filter(Boolean);
      const selected = site.id === view.siteId;
      const chips = members.length
        ? members
            .map((m) => `<span class="text-[12px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200">${escapeHtml(m.name)}</span>`)
            .join('')
        : `<span class="text-xs text-slate-500 italic">${escapeHtml(t('admin.site.noMembers'))}</span>`;

      return `
      <div data-action="admin-select-site" data-id="${escapeHtml(site.id)}" class="bg-slate-800 rounded-xl border p-4 shadow-lg flex flex-col justify-between gap-3 cursor-pointer transition ${
        selected ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-slate-700 hover:border-slate-500'
      }">
        <div class="space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div>
              <span class="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Baustelle</span>
              <h3 class="text-base font-extrabold text-white">${escapeHtml(site.location)}</h3>
            </div>
            <button type="button" data-action="admin-delete-site" data-id="${escapeHtml(site.id)}" class="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-slate-700 transition" title="${escapeHtml(t('admin.site.delete'))}">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
          </div>
          <p class="text-xs text-slate-300"><strong class="text-slate-400">${escapeHtml(t('admin.site.company'))}</strong> ${escapeHtml(site.company)}</p>
          <p class="text-xs text-indigo-300"><strong class="text-slate-400">${escapeHtml(t('role.baulajter'))}:</strong> ${leader ? escapeHtml(leader.name) : escapeHtml(t('admin.site.noLeader'))}</p>
          <div class="pt-2 border-t border-slate-700/70">
            <p class="text-[12px] font-semibold text-slate-400 mb-1.5">${escapeHtml(t('admin.site.team', { n: members.length }))}</p>
            <div class="flex flex-wrap gap-1">${chips}</div>
          </div>
        </div>
        <div class="pt-2 border-t border-slate-700/60 flex items-center justify-between text-xs font-bold text-emerald-400">
          <span>${escapeHtml(t('admin.site.open'))}</span>
          <i class="fa-solid fa-arrow-right"></i>
        </div>
      </div>`;
    })
    .join('');

  renderSiteDetails();
}

function renderSiteDetails() {
  const panel = $('adminSelectedSitePanel');
  const site = state.sites.find((s) => s.id === view.siteId);
  if (!site) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');

  const leaders = state.users.filter((u) => u.role === 'baulajter');
  const available = state.users.filter((u) => (u.role === 'radnik' || u.role === 'baulajter') && !site.memberIds.includes(u.id));
  const members = site.memberIds.map(userById).filter(Boolean);

  const projects = siteProjects(site);
  if (!projects.some((p) => p.id === view.projectId)) view.projectId = projects[0]?.id || '';
  const pid = view.projectId;
  const pname = projectName(pid);

  const { week, year } = isoWeek(view.weekStart);
  const signed = Boolean(getSignature(pid, view.weekStart).kundeSignature);
  const { rows } = collectProjectWeek(pid, view.weekStart);
  const filtered = rows.filter(() => view.filter === 'all' || (view.filter === 'signed' ? signed : !signed));

  const filterBtn = (mode, label, on) =>
    `<button type="button" data-action="admin-filter" data-mode="${mode}" class="px-3 py-1.5 rounded-lg font-bold border ${view.filter === mode ? on : 'bg-slate-900 text-slate-300 border-slate-700'}">${label}</button>`;
  const sid = escapeHtml(site.id);

  panel.innerHTML = `
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-700 pb-4">
      <div>
        <span class="text-xs font-bold uppercase tracking-wider text-emerald-400">${escapeHtml(t('admin.site.details'))}</span>
        <h3 class="text-lg font-extrabold text-white">${escapeHtml(site.location)} — <span class="text-slate-300 font-semibold">${escapeHtml(site.company)}</span></h3>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" data-action="admin-site-pdf" data-mode="all" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition">
          <i class="fa-solid fa-file-pdf"></i> ${escapeHtml(t('admin.site.pdfAll'))}
        </button>
        <button type="button" data-action="admin-site-pdf" data-mode="signed" class="bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition">
          <i class="fa-solid fa-file-signature"></i> ${escapeHtml(t('report.pdfSigned'))}
        </button>
        <button type="button" data-action="admin-site-pdf" data-mode="unsigned" class="bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition">
          <i class="fa-solid fa-clock"></i> ${escapeHtml(t('report.pdfUnsigned'))}
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 bg-slate-900/70 p-4 rounded-xl border border-slate-700">
      <div class="space-y-2.5">
        <label class="block text-xs font-bold uppercase tracking-wider text-indigo-300">${escapeHtml(t('admin.site.mainLeader'))}</label>
        <select data-change="admin-site-leader" data-id="${sid}" class="project-select">
          <option value="">${escapeHtml(t('admin.site.pickLeaderShort'))}</option>
          ${leaders.map((b) => `<option value="${escapeHtml(b.id)}" ${b.id === site.baulajterId ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
        </select>

        <label class="block text-xs font-bold uppercase tracking-wider text-emerald-300 pt-2">${escapeHtml(t('admin.site.addMember'))}</label>
        <div class="flex gap-2">
          <select id="adminAddMemberToSiteSelect" class="project-select">
            <option value="">${escapeHtml(t('admin.site.pickPerson'))}</option>
            ${available.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(t(`role.${p.role}`))})</option>`).join('')}
          </select>
          <button type="button" data-action="admin-add-member" data-id="${sid}" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold shrink-0">
            ${escapeHtml(t('common.add'))}
          </button>
        </div>
      </div>

      <div class="space-y-2">
        <p class="text-xs font-bold uppercase tracking-wider text-slate-400">${escapeHtml(t('admin.site.members', { n: members.length }))}</p>
        <div class="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          ${members
            .map(
              (m) => `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-600 text-white">
              <span>${escapeHtml(m.name)} (${m.role === 'baulajter' ? 'VD' : 'R'})</span>
              <button type="button" data-action="admin-remove-member" data-id="${sid}" data-user="${escapeHtml(m.id)}" class="text-slate-400 hover:text-red-400">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </span>`,
            )
            .join('')}
        </div>
      </div>
    </div>

    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-900/50 p-3.5 rounded-xl border border-slate-700">
      <div class="flex flex-wrap items-center gap-2.5">
        <span class="text-xs font-bold text-slate-400">${escapeHtml(t('admin.site.project'))}</span>
        <select data-change="admin-site-project" class="project-select min-w-[200px]">
          ${projects.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === pid ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>

        <div class="flex items-center bg-slate-950 rounded-lg p-1 border border-slate-700">
          <button type="button" data-action="admin-week" data-delta="-1" class="px-2.5 py-1 hover:bg-slate-800 rounded text-slate-300">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="px-3 text-xs font-bold text-indigo-400">KW ${week} (${year})</span>
          <button type="button" data-action="admin-week" data-delta="1" class="px-2.5 py-1 hover:bg-slate-800 rounded text-slate-300">
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>

        ${
          signed
            ? `<button type="button" data-action="admin-clear-kunde" class="bg-red-950 hover:bg-red-900 text-red-200 border border-red-700 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition" title="${escapeHtml(t('admin.site.clearKundeTitle'))}">
                <i class="fa-solid fa-trash-can"></i> ${escapeHtml(t('admin.site.clearKunde'))}
              </button>`
            : ''
        }
      </div>

      <div class="flex flex-wrap items-center gap-1.5 text-xs">
        ${filterBtn('all', `${escapeHtml(t('admin.site.filterAll'))} (${rows.length})`, 'bg-indigo-600 text-white border-indigo-500')}
        ${filterBtn('signed', escapeHtml(t('admin.site.filterSigned')), 'bg-emerald-600 text-white border-emerald-500')}
        ${filterBtn('unsigned', escapeHtml(t('admin.site.filterUnsigned')), 'bg-amber-600 text-white border-amber-500')}
      </div>
    </div>

    <div class="overflow-x-auto">
      ${
        filtered.length === 0
          ? `<p class="text-xs text-slate-400 p-4 bg-slate-900/50 rounded-xl">${escapeHtml(t('admin.site.noHours1'))} <strong>${escapeHtml(pname)}</strong> ${escapeHtml(t('admin.site.noHours2', { kw: week }))}</p>`
          : `<table class="w-full text-left border-collapse min-w-[780px] text-xs">
              <thead>
                <tr class="bg-slate-900 text-slate-400 uppercase border-b border-slate-700">
                  <th class="p-2.5 text-center w-10">Nr.</th>
                  <th class="p-2.5">Name / Vorname</th>
                  <th class="p-2.5 text-center">Status</th>
                  ${DAY_HEADS.map((d) => `<th class="p-2.5 text-center">${d}</th>`).join('')}
                  <th class="p-2.5 text-center">Std. Summe</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-700/70">
                ${filtered
                  .map(
                    (r, i) => `
                  <tr>
                    <td class="p-2.5 text-center font-bold text-slate-400">${i + 1}</td>
                    <td class="p-2.5 font-bold text-white">${escapeHtml(r.person.name)}</td>
                    <td class="p-2.5 text-center">
                      <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${signed ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-amber-950 text-amber-300 border border-amber-700'}">
                        ${escapeHtml(signed ? t('admin.site.signed') : t('admin.site.unsigned'))}
                      </span>
                    </td>
                    ${r.days.map((d) => `<td class="p-2.5 text-center font-semibold text-slate-200">${formatHoursHHMM(d.sigma)}</td>`).join('')}
                    <td class="p-2.5 text-center font-extrabold text-emerald-300">${formatHoursHHMM(r.personSum)}</td>
                  </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    </div>
  `;
}

async function loadSiteWeek() {
  await Promise.all([
    loadEntries(view.weekStart, addDays(view.weekStart, 6)),
    loadSignatures(view.weekStart, view.weekStart),
  ]);
}

export async function showSites() {
  renderSites();
  try {
    await loadSiteWeek();
  } catch (err) {
    showError(err);
  }
  renderSites();
}

// ---------------------------------------------------------------- accounts

function renderUsers() {
  $('adminDbCountBadge').innerText = t('admin.db.count', { n: state.users.length });

  $('adminUsersTableBody').innerHTML = state.users
    .map((user) => {
      const id = escapeHtml(user.id);
      const roleBtn =
        user.role === 'radnik'
          ? `<button type="button" data-action="admin-toggle-role" data-id="${id}" class="px-2.5 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700 rounded-lg text-[12px] font-bold">${escapeHtml(t('admin.db.promote'))}</button>`
          : user.role === 'baulajter'
            ? `<button type="button" data-action="admin-toggle-role" data-id="${id}" class="px-2.5 py-1 bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-700 rounded-lg text-[12px] font-bold">${escapeHtml(t('admin.db.demote'))}</button>`
            : '';
      const editBtn = `<button type="button" data-action="admin-edit-cred" data-id="${id}" class="px-2.5 py-1 bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-700 rounded-lg text-[12px] font-bold flex items-center gap-1" title="${escapeHtml(t('admin.db.editTitle'))}"><i class="fa-solid fa-key text-[11px]"></i> ${escapeHtml(t('admin.db.edit'))}</button>`;
      const deleteBtn =
        user.id !== state.me.id
          ? `<button type="button" data-action="admin-delete-user" data-id="${id}" class="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-700" title="${escapeHtml(t('common.delete'))}"><i class="fa-solid fa-trash-can"></i></button>`
          : '';

      return `
      <tr>
        <td class="p-3 font-bold text-white">${escapeHtml(user.name)}</td>
        <td class="p-3">${roleBadgeHtml(user.role)}</td>
        <td class="p-3 font-mono font-semibold text-indigo-300">${escapeHtml(user.username)}</td>
        <td class="p-3"><span class="font-mono text-slate-400" title="${escapeHtml(t('admin.db.passwordHidden'))}">••••••••</span></td>
        <td class="p-3 text-slate-300">${escapeHtml(user.phone || '-')}</td>
        <td class="p-3 text-slate-300">${escapeHtml(user.email || '-')}</td>
        <td class="p-3 text-right flex items-center justify-end gap-2">${editBtn}${roleBtn}${deleteBtn}</td>
      </tr>`;
    })
    .join('');
}

function renderMonthly() {
  const container = $('adminMonthlySearchResult');
  const query = ($('adminSearchPersonInput').value || '').trim().toLowerCase();
  const monthVal = $('adminMonthPicker').value;

  const matches = state.users.filter(
    (u) => (u.role === 'radnik' || u.role === 'baulajter') && (!query || u.name.toLowerCase().includes(query)),
  );
  container.innerHTML =
    matches.length === 0
      ? `<p class="text-xs text-slate-400">${escapeHtml(t('admin.month.none'))}</p>`
      : matches.map((u) => buildMonthlyCardHtml(u, monthVal)).join('');
}

export async function showDatabase() {
  renderUsers();
  try {
    await loadMonth($('adminMonthPicker').value);
  } catch (err) {
    showError(err);
  }
  renderMonthly();
}

function readUsername(inputId) {
  const username = $(inputId).value.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    showToast(t('err.USERNAME_INVALID'), true);
    return null;
  }
  return username;
}

function openEditCredentials(userId) {
  const user = userById(userId);
  if (!user) return;
  $('editCredUserId').value = user.id;
  $('editCredUserDisplay').innerText = `${user.name} (${t(`role.${user.role}`).toUpperCase()})`;
  $('editCredUsername').value = user.username || '';
  $('editCredPassword').value = '';
  $('editCredPhone').value = user.phone || '';
  $('editCredEmail').value = user.email || '';
  openModal('editCredentialsModal');
}

// ---------------------------------------------------------------- wiring

export function initAdmin() {
  onAction('admin-select-site', (d) => {
    view.siteId = d.id;
    renderSites();
  });

  onAction('admin-delete-site', (d) => {
    const site = state.sites.find((s) => s.id === d.id);
    if (!site) return;
    showConfirmModal(t('admin.site.deleteTitle'), t('admin.site.deleteText', { name: site.location }), async () => {
      try {
        await deleteSite(site.id);
        if (view.siteId === site.id) view.siteId = '';
        showToast(t('admin.site.deleted', { name: site.location }));
      } catch (err) {
        showError(err);
      }
      renderSites();
    });
  });

  $('adminAddSiteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const location = $('newSiteName').value.trim();
    const company = $('newSiteCompany').value.trim();
    const baulajterId = $('newSiteBaulajter').value;
    const defaultProject = $('newSiteDefaultProject').value.trim();
    if (!location || !company) return;
    try {
      const { siteId, projectId } = await createSite({ location, company, baulajterId, defaultProject });
      view.siteId = siteId;
      if (projectId) view.projectId = projectId;
      e.target.reset();
      showToast(t('admin.site.created', { name: location }));
    } catch (err) {
      showError(err);
    }
    renderSites();
  });

  onChange('admin-site-leader', async (d, el) => {
    try {
      await setSiteLeader(d.id, el.value);
      showToast(t('admin.site.leaderSet'));
    } catch (err) {
      showError(err);
    }
    renderSites();
  });

  onAction('admin-add-member', async (d) => {
    const userId = $('adminAddMemberToSiteSelect')?.value;
    if (!userId) return;
    try {
      await addSiteMember(d.id, userId);
      showToast(t('admin.site.memberAdded'));
    } catch (err) {
      showError(err);
    }
    renderSites();
  });

  onAction('admin-remove-member', async (d) => {
    try {
      await removeSiteMember(d.id, d.user);
    } catch (err) {
      showError(err);
    }
    renderSites();
  });

  onChange('admin-site-project', (_d, el) => {
    view.projectId = el.value;
    renderSiteDetails();
  });

  onAction('admin-week', async (d) => {
    view.weekStart = shiftWeek(view.weekStart, Number(d.delta));
    await showSites();
  });

  onAction('admin-filter', (d) => {
    view.filter = d.mode;
    renderSiteDetails();
  });

  onAction('admin-clear-kunde', async () => {
    const pid = view.projectId;
    if (!pid) return;
    try {
      await clearClientSignature(pid, view.weekStart);
      showToast(t('admin.site.kundeCleared', { project: projectName(pid), week: weekKey(view.weekStart) }));
    } catch (err) {
      showError(err);
    }
    renderSiteDetails();
  });

  onAction('admin-site-pdf', async (d) => {
    const site = state.sites.find((s) => s.id === view.siteId);
    const pid = view.projectId;
    if (!site || !pid) {
      showToast(t('pdf.pickSite'), true);
      return;
    }
    await downloadStundennachweis({
      projectId: pid,
      project: projectName(pid),
      weekStart: view.weekStart,
      sig: getSignature(pid, view.weekStart),
      filterMode: d.mode,
      company: site.company,
      location: site.location,
      leaderName: userById(site.baulajterId)?.name || '',
      fileLabel: site.location,
    });
  });

  // Accounts
  $('adminAddUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('newUserName').value.trim();
    const username = readUsername('newUserUsername');
    const password = $('newUserPassword').value.trim();
    if (!name || !username) return;
    if (password.length < MIN_PASSWORD) {
      showToast(t('err.PASSWORD_TOO_SHORT'), true);
      return;
    }
    try {
      await adminUsers('create', {
        name,
        username,
        password,
        role: $('newUserRole').value,
        email: $('newUserEmail').value.trim(),
        phone: $('newUserPhone').value.trim(),
      });
      e.target.reset();
      showToast(t('admin.db.added', { name }));
    } catch (err) {
      showError(err);
    }
    renderUsers();
    renderMonthly();
  });

  onAction('admin-edit-cred', (d) => openEditCredentials(d.id));
  onAction('cred-close', () => closeModal('editCredentialsModal'));

  $('editCredentialsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = userById($('editCredUserId').value);
    const username = readUsername('editCredUsername');
    const password = $('editCredPassword').value.trim();
    if (!user || !username) return;
    if (password && password.length < MIN_PASSWORD) {
      showToast(t('err.PASSWORD_TOO_SHORT'), true);
      return;
    }
    try {
      await adminUsers('update', {
        id: user.id,
        username,
        password,
        phone: $('editCredPhone').value.trim(),
        email: $('editCredEmail').value.trim(),
      });
      closeModal('editCredentialsModal');
      showToast(t('admin.db.updated', { name: user.name }));
    } catch (err) {
      showError(err);
    }
    renderUsers();
  });

  onAction('admin-toggle-role', async (d) => {
    const user = userById(d.id);
    if (!user || user.role === 'admin') return;
    const role = user.role === 'radnik' ? 'baulajter' : 'radnik';
    try {
      await setUserRole(user.id, role);
      showToast(t('admin.db.roleChanged', { name: user.name, role: t(`role.${role}`).toUpperCase() }));
    } catch (err) {
      showError(err);
    }
    renderUsers();
  });

  onAction('admin-delete-user', (d) => {
    const user = userById(d.id);
    if (!user) return;
    showConfirmModal(t('admin.db.deleteTitle'), t('admin.db.deleteText', { name: user.name }), async () => {
      try {
        await adminUsers('delete', { id: user.id });
        showToast(t('admin.db.deleted', { name: user.name }));
      } catch (err) {
        showError(err);
      }
      renderUsers();
      renderMonthly();
    });
  });

  $('adminSearchPersonInput').addEventListener('input', renderMonthly);
  $('adminMonthPicker').addEventListener('change', showDatabase);

  // Backup
  onAction('backup-export', async () => {
    try {
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `evidencija_pro_kopija_${todayStr()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(t('admin.backup.saved'));
    } catch (err) {
      showError(err);
    }
  });

  $('importBackupInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    showConfirmModal(t('admin.backup.loadTitle'), t('admin.backup.loadText'), async () => {
      try {
        const parsed = JSON.parse(await file.text());
        const { skipped } = await importAll(parsed);
        showToast(skipped ? t('admin.backup.loadedSkipped', { n: skipped }) : t('admin.backup.loaded'));
      } catch (err) {
        if (err instanceof SyntaxError) showToast(t('admin.backup.readError'), true);
        else showError(err);
      }
      await showDatabase();
    });
  });
}

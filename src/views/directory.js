import { t } from '../i18n.js';
import { $, escapeHtml, roleBadgeHtml } from '../ui.js';
import { state } from '../store.js';

export function renderDirectory() {
  const grid = $('directoryCardsGrid');
  const query = ($('directorySearchInput').value || '').trim().toLowerCase();

  const list = state.users.filter(
    (u) =>
      !query ||
      u.name.toLowerCase().includes(query) ||
      (u.email || '').toLowerCase().includes(query) ||
      (u.phone || '').toLowerCase().includes(query) ||
      u.role.toLowerCase().includes(query) ||
      t(`role.${u.role}`).toLowerCase().includes(query),
  );

  if (list.length === 0) {
    grid.innerHTML = `<p class="col-span-full text-xs text-slate-400">${escapeHtml(t('dir.empty'))}</p>`;
    return;
  }

  grid.innerHTML = list
    .map(
      (u) => `
      <div class="bg-slate-900/90 border border-slate-700 rounded-xl p-4 space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="text-sm font-extrabold text-white">${escapeHtml(u.name)}</div>
            <div class="mt-1">${roleBadgeHtml(u.role)}</div>
          </div>
        </div>
        <div class="space-y-1 text-xs text-slate-300 pt-1 border-t border-slate-800">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-phone text-emerald-400 w-4"></i>
            ${u.phone ? `<a href="tel:${escapeHtml(u.phone.replace(/[^\d+]/g, ''))}" class="hover:underline text-emerald-300 font-semibold">${escapeHtml(u.phone)}</a>` : `<span class="text-slate-500">-</span>`}
          </div>
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-envelope text-indigo-400 w-4"></i>
            ${u.email ? `<a href="mailto:${encodeURIComponent(u.email).replace(/%40/g, '@')}" class="hover:underline text-indigo-300 break-all">${escapeHtml(u.email)}</a>` : `<span class="text-slate-500">-</span>`}
          </div>
        </div>
      </div>
    `,
    )
    .join('');
}

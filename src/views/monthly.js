import { t } from '../i18n.js';
import { escapeHtml } from '../ui.js';
import { getEntry, loadEntries, projectName } from '../store.js';
import { fromDateStr, isoWeek, monthDates } from '../dates.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export async function loadMonth(monthVal) {
  if (!monthVal) return;
  const days = monthDates(monthVal);
  await loadEntries(days[0], days[days.length - 1]);
}

/** One person's month: a row per day with project, work and travel hours. */
export function buildMonthlyCardHtml(user, monthVal) {
  if (!monthVal || !user) return '';
  const [year, month] = monthVal.split('-');

  let totalW = 0;
  let totalT = 0;
  let rowsHtml = '';

  for (const date of monthDates(monthVal)) {
    const rec = getEntry(user.id, date);
    const w = rec.workHours;
    const t2 = rec.travelHours;
    const proj = projectName(rec.projectId) || '-';
    const dow = fromDateStr(date).getUTCDay();
    totalW += w;
    totalT += t2;

    rowsHtml += `
      <tr class="${w + t2 > 0 ? 'bg-slate-800/80' : 'text-slate-500'}">
        <td class="p-2 font-semibold">${date.slice(8, 10)}.${month}.${year} (${escapeHtml(t(`dayShort.${DAY_KEYS[dow]}`))})</td>
        <td class="p-2">KW ${isoWeek(date).week}</td>
        <td class="p-2 text-emerald-300 font-medium">${escapeHtml(proj)}</td>
        <td class="p-2 text-center font-bold text-indigo-300">${w} h</td>
        <td class="p-2 text-center font-bold text-amber-300">${t2} h</td>
        <td class="p-2 text-center font-extrabold text-white">${w + t2} h</td>
      </tr>
    `;
  }

  return `
    <div class="bg-slate-900/90 border border-slate-700 rounded-xl overflow-hidden">
      <div class="p-3.5 bg-slate-950/70 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span class="text-sm font-extrabold text-white">${escapeHtml(user.name)}</span>
          <span class="ml-2 text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-slate-800 text-indigo-300">${escapeHtml(t(`role.${user.role}`))}</span>
        </div>
        <div class="flex items-center gap-3 text-xs font-bold">
          <span class="text-indigo-300">${escapeHtml(t('month.work'))}: ${totalW}h</span>
          <span class="text-amber-300">${escapeHtml(t('month.travel'))}: ${totalT}h</span>
          <span class="text-emerald-400">${escapeHtml(t('common.total'))}: ${totalW + totalT}h</span>
        </div>
      </div>
      <div class="overflow-x-auto max-h-80">
        <table class="w-full text-left border-collapse text-xs">
          <thead class="sticky top-0 bg-slate-900 text-slate-400 uppercase border-b border-slate-700">
            <tr>
              <th class="p-2">${escapeHtml(t('month.colDate'))}</th>
              <th class="p-2">KW</th>
              <th class="p-2">${escapeHtml(t('month.colProject'))}</th>
              <th class="p-2 text-center">${escapeHtml(t('month.work'))}</th>
              <th class="p-2 text-center">${escapeHtml(t('month.travel'))}</th>
              <th class="p-2 text-center">${escapeHtml(t('common.total'))}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800">${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

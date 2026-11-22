import { t } from './i18n.js';

export const $ = (id) => document.getElementById(id);

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let toastTimer = null;

export function showToast(msg, isError = false) {
  const toast = $('toastMessage');
  toast.innerText = msg;
  toast.className = `fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl text-xs font-bold border ${
    isError ? 'bg-red-950 text-red-200 border-red-700' : 'bg-slate-800 text-emerald-300 border-emerald-600'
  }`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), isError ? 5000 : 3200);
}

/** Shows a translated message for a store error ({ code } or thrown Error). */
export function showError(err) {
  const code = err?.code || 'UNKNOWN';
  const key = `err.${code}`;
  const msg = t(key);
  showToast(msg === key ? t('err.UNKNOWN') : msg, true);
  if (code === 'UNKNOWN') console.error(err);
}

export function openModal(id) {
  const modal = $(id);
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

export function closeModal(id) {
  const modal = $(id);
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

export function isModalOpen(id) {
  return !$(id).classList.contains('hidden');
}

let pendingConfirm = null;

export function showConfirmModal(title, text, onConfirm) {
  $('confirmModalTitle').innerText = title;
  $('confirmModalText').innerText = text;
  pendingConfirm = onConfirm;
  openModal('confirmModal');
}

export function initConfirmModal() {
  $('confirmModalCancelBtn').addEventListener('click', () => {
    pendingConfirm = null;
    closeModal('confirmModal');
  });
  $('confirmModalOkBtn').addEventListener('click', () => {
    const fn = pendingConfirm;
    pendingConfirm = null;
    closeModal('confirmModal');
    if (typeof fn === 'function') fn();
  });
}

export function show(id, visible = true) {
  $(id).classList.toggle('hidden', !visible);
}

export function roleBadgeHtml(role) {
  if (role === 'admin') {
    return `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-950 text-amber-300 border border-amber-700">${escapeHtml(t('role.admin'))}</span>`;
  }
  if (role === 'baulajter') {
    return `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">${escapeHtml(t('role.baulajter'))}</span>`;
  }
  return `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700">${escapeHtml(t('role.radnik'))}</span>`;
}

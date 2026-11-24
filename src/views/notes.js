// Notes (Napomene) of one construction site. Used by the administrator inside
// a site and by the site leader in their own tab.
import { t } from '../i18n.js';
import { escapeHtml, showToast, showError, showConfirmModal } from '../ui.js';
import { onAction } from '../actions.js';
import { state, loadNotes, getNotes, canEditNote, addNote, updateNote, deleteNote } from '../store.js';

const MAX = 4000;

// Text typed but not saved yet survives the periodic refresh.
const draft = { siteId: '', body: '', editId: '', editBody: '' };
let rerender = () => {};

function fmtStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Loads the notes of a site and remembers how to redraw the screen. */
export async function loadSiteNotes(siteId, redraw) {
  rerender = redraw;
  if (draft.siteId !== siteId) Object.assign(draft, { siteId, body: '', editId: '', editBody: '' });
  if (siteId) await loadNotes(siteId);
}

export function notesPanelHtml(siteId) {
  if (!siteId) return `<p class="text-xs text-slate-400">${escapeHtml(t('notes.noSite'))}</p>`;
  const notes = getNotes(siteId);
  const sid = escapeHtml(siteId);

  const list = notes.length
    ? notes
        .map((n) => {
          const id = escapeHtml(n.id);
          const editing = draft.editId === n.id;
          const edited = n.updatedAt && n.createdAt && new Date(n.updatedAt) - new Date(n.createdAt) > 1000;
          const tools = canEditNote(n)
            ? `<div class="flex items-center gap-1 shrink-0">
                <button type="button" data-action="note-edit" data-id="${id}" class="text-slate-400 hover:text-indigo-300 p-1.5 rounded-lg hover:bg-slate-700" title="${escapeHtml(t('notes.edit'))}"><i class="fa-solid fa-pen text-xs"></i></button>
                <button type="button" data-action="note-delete" data-id="${id}" class="text-slate-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-slate-700" title="${escapeHtml(t('common.delete'))}"><i class="fa-solid fa-trash-can text-xs"></i></button>
              </div>`
            : '';
          const body = editing
            ? `<textarea id="noteEditBody" data-note-input="edit" maxlength="${MAX}" rows="4" class="w-full px-3 py-2 bg-slate-950 border border-indigo-600 rounded-lg text-sm text-white focus:outline-none">${escapeHtml(draft.editBody)}</textarea>
               <div class="flex justify-end gap-2">
                 <button type="button" data-action="note-cancel" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">${escapeHtml(t('common.cancel'))}</button>
                 <button type="button" data-action="note-save" data-id="${id}" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white">${escapeHtml(t('notes.save'))}</button>
               </div>`
            : `<p class="text-sm text-slate-200 whitespace-pre-wrap break-words">${escapeHtml(n.body)}</p>`;
          return `
          <div class="bg-slate-900/80 border border-slate-700 rounded-xl p-4 space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div class="text-xs text-slate-400">
                <span class="font-bold text-white">${escapeHtml(n.authorName || '-')}</span>
                <span class="ml-1">${escapeHtml(fmtStamp(n.createdAt))}</span>
                ${edited ? `<span class="block text-[11px] text-slate-500">${escapeHtml(t('notes.editedBy', { name: n.updatedName || '-', at: fmtStamp(n.updatedAt) }))}</span>` : ''}
              </div>
              ${editing ? '' : tools}
            </div>
            ${body}
          </div>`;
        })
        .join('')
    : `<p class="text-xs text-slate-400 italic">${escapeHtml(t('notes.empty'))}</p>`;

  return `
    <div class="space-y-3">
      <div class="bg-slate-900/60 border border-slate-700 rounded-xl p-4 space-y-2">
        <label for="noteNewBody" class="block text-xs font-bold uppercase tracking-wider text-emerald-300">${escapeHtml(t('notes.new'))}</label>
        <textarea id="noteNewBody" data-note-input="new" maxlength="${MAX}" rows="4" placeholder="${escapeHtml(t('notes.ph'))}" class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500">${escapeHtml(draft.body)}</textarea>
        <div class="flex justify-end">
          <button type="button" data-action="note-add" data-site="${sid}" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5">
            <i class="fa-solid fa-plus"></i> ${escapeHtml(t('notes.add'))}
          </button>
        </div>
      </div>
      ${list}
    </div>`;
}

const findNote = (id) => getNotes(draft.siteId).find((n) => n.id === id) || null;

export function initNotes() {
  document.addEventListener('input', (e) => {
    const kind = e.target?.dataset?.noteInput;
    if (kind === 'new') draft.body = e.target.value;
    if (kind === 'edit') draft.editBody = e.target.value;
  });

  onAction('note-add', async (d) => {
    const body = draft.body.trim();
    if (!body) return;
    try {
      await addNote(d.site, body);
      draft.body = '';
      showToast(t('notes.added'));
    } catch (err) {
      showError(err);
    }
    rerender();
  });

  onAction('note-edit', (d) => {
    const note = findNote(d.id);
    if (!note || !canEditNote(note)) return;
    draft.editId = note.id;
    draft.editBody = note.body;
    rerender();
    document.getElementById('noteEditBody')?.focus();
  });

  onAction('note-cancel', () => {
    draft.editId = '';
    draft.editBody = '';
    rerender();
  });

  onAction('note-save', async (d) => {
    const note = findNote(d.id);
    const body = draft.editBody.trim();
    if (!note || !body) return;
    try {
      await updateNote(note, body);
      draft.editId = '';
      draft.editBody = '';
      showToast(t('notes.saved'));
    } catch (err) {
      showError(err);
    }
    rerender();
  });

  onAction('note-delete', (d) => {
    const note = findNote(d.id);
    if (!note || !state.me) return;
    showConfirmModal(t('notes.deleteTitle'), t('notes.deleteText'), async () => {
      try {
        await deleteNote(note);
      } catch (err) {
        showError(err);
      }
      rerender();
    });
  });
}

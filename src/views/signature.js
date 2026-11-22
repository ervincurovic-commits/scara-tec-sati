// Signature pad for the site leader and for the client (Baulaiter AG).
// The client signs on the leader's device; their dialog is shown in German
// or Slovenian regardless of the interface language.
import { t } from '../i18n.js';
import { $, escapeHtml, showToast, showError, openModal, closeModal } from '../ui.js';
import { onAction } from '../actions.js';
import { state, getSignature, signAsLeader, signAsClient, projectName } from '../store.js';
import { collectProjectWeek } from '../pdf.js';
import { weekKey } from '../dates.js';

let target = null; // { projectId, weekStart, signerType, lang, onSaved }
let pendingKunde = null;
let isDrawing = false;
let hasDrawn = false;
let saving = false;

/** The site a project week belongs to, as shown to the client. */
export function findSiteForProject(projectId) {
  const me = state.me;
  return (
    state.sites.find((s) => s.projectIds.includes(projectId)) ||
    state.sites.find((s) => me && (s.baulajterId === me.id || s.memberIds.includes(me.id))) ||
    null
  );
}

function clearPad() {
  const canvas = $('signatureCanvas');
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
  hasDrawn = false;
}

function renderKundeDetails(lang) {
  if (!target || target.signerType !== 'kunde') return;
  target.lang = lang;
  const project = projectName(target.projectId);
  const week = weekKey(target.weekStart);
  const site = findSiteForProject(target.projectId);
  const { rows } = collectProjectWeek(target.projectId, target.weekStart);

  const isDe = lang === 'de';
  const L = isDe
    ? {
        myCompany: 'Unser Unternehmen:',
        site: 'Baustelle / Ort:',
        client: 'Auftraggeber (Kunde):',
        explanation: `Bestätigung der geleisteten Arbeits- und Reisezeiten für Projekt ${project} (${week}).`,
        worker: 'Mitarbeiter',
        work: 'Arbeit (R)',
        travel: 'Reise (P)',
        sum: 'Summe',
        total: 'Gesamtsumme',
        title: 'Elektronische Unterschrift — Baulaiter AG',
        badge: 'DEUTSCH (DE)',
        clear: 'Unterschrift löschen',
        cancel: 'Abbrechen',
        save: 'Unterschrift speichern',
        empty: 'Keine Stunden erfasst.',
      }
    : {
        myCompany: 'Naše podjetje:',
        site: 'Gradbišče / Kraj:',
        client: 'Naročnik / Podjetje:',
        explanation: `Potrditev opravljenih delovnih in potnih ur za projekt ${project} (${week}).`,
        worker: 'Delavec',
        work: 'Delo (R)',
        travel: 'Pot (P)',
        sum: 'Skupaj',
        total: 'Skupaj vse ure',
        title: 'Elektronski podpis — Baulaiter AG',
        badge: 'SLOVENŠČINA (SL)',
        clear: 'Počisti podpis',
        cancel: 'Prekliči',
        save: 'Shrani podpis',
        empty: 'Ni zabeleženih ur.',
      };

  $('signatureModalTitle').innerText = L.title;
  $('signatureModalSubtitle').innerText = L.explanation;
  $('sigLangBadge').innerText = L.badge;
  $('sigClearBtn').innerText = L.clear;
  $('sigCancelBtn').innerText = L.cancel;
  $('sigSaveBtn').innerText = L.save;

  const meta = (label, value, color) => `
    <div class="bg-slate-800/90 border border-slate-700 rounded-lg p-2.5">
      <div class="text-[10px] font-bold uppercase text-slate-400">${label}</div>
      <div class="font-bold ${color} mt-0.5">${escapeHtml(value)}</div>
    </div>`;
  $('sigCompanyMetaGrid').innerHTML =
    meta(L.myCompany, 'SCARA-Tec d.o.o. (Gozdna ulica 2 C, SI-2311 Hoče)', 'text-white') +
    meta(L.site, site ? site.location : project || '-', 'text-emerald-300') +
    meta(L.client, site ? site.company : 'Auftraggeber', 'text-indigo-300');

  const totalAll = rows.reduce((acc, r) => acc + r.personSum, 0);
  $('sigHoursPreviewContainer').innerHTML = `
    <table class="w-full text-left border-collapse text-[11px]">
      <thead class="bg-slate-950 text-slate-300 border-b border-slate-800">
        <tr>
          <th class="p-2">${L.worker}</th>
          <th class="p-2 text-center">${L.work}</th>
          <th class="p-2 text-center">${L.travel}</th>
          <th class="p-2 text-center">${L.sum}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-800">
        ${
          rows.length
            ? rows
                .map(
                  (r) => `
              <tr>
                <td class="p-2 font-semibold text-white">${escapeHtml(r.person.name)}</td>
                <td class="p-2 text-center text-indigo-300">${r.work} h</td>
                <td class="p-2 text-center text-amber-300">${r.travel} h</td>
                <td class="p-2 text-center font-bold text-emerald-300">${r.personSum} h</td>
              </tr>`,
                )
                .join('')
            : `<tr><td colspan="4" class="p-2 text-center text-slate-400">${L.empty}</td></tr>`
        }
      </tbody>
      <tfoot class="bg-slate-950 font-bold text-emerald-400 border-t border-slate-800">
        <tr>
          <td colspan="3" class="p-2 text-right">${L.total}:</td>
          <td class="p-2 text-center">${totalAll} h</td>
        </tr>
      </tfoot>
    </table>
  `;
}

export function openSignatureModal({ projectId, weekStart, signerType, lang = 'de', onSaved }) {
  if (!projectId) {
    showToast(t('sig.pickProject'), true);
    return;
  }
  target = { projectId, weekStart, signerType, lang, onSaved };

  if (signerType === 'kunde') {
    $('signatureContextBox').classList.remove('hidden');
    renderKundeDetails(lang);
  } else {
    $('signatureContextBox').classList.add('hidden');
    $('signatureModalTitle').innerText = t('sig.leaderTitle');
    $('signatureModalSubtitle').innerText = t('sig.leaderSubtitle', {
      project: projectName(projectId),
      week: weekKey(weekStart),
    });
    $('sigClearBtn').innerText = t('sig.clear');
    $('sigCancelBtn').innerText = t('common.cancel');
    $('sigSaveBtn').innerText = t('sig.save');
  }

  openModal('signatureModal');

  const canvas = $('signatureCanvas');
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width) || 440;
  canvas.height = Math.round(rect.height) || 176;
  clearPad();
}

function closeSignatureModal() {
  target = null;
  closeModal('signatureModal');
}

/** The client may only sign after the site leader has. */
export function requestKundeSignature(projectId, weekStart, onSaved) {
  if (!getSignature(projectId, weekStart).userSignature) {
    showToast(t('sig.leaderFirst'), true);
    return;
  }
  pendingKunde = { projectId, weekStart, onSaved };
  openModal('kundeLangModal');
}

async function saveSignature() {
  if (saving) return;
  if (!target || !hasDrawn) {
    showToast(t('sig.empty'), true);
    return;
  }
  const dataUrl = $('signatureCanvas').toDataURL('image/png');
  const { projectId, weekStart, signerType, lang, onSaved } = target;
  saving = true;
  try {
    if (signerType === 'kunde') await signAsClient(projectId, weekStart, dataUrl, lang || 'de');
    else await signAsLeader(projectId, weekStart, dataUrl);
    closeSignatureModal();
    if (onSaved) onSaved();
    showToast(signerType === 'kunde' ? t('sig.savedKunde') : t('sig.saved'));
  } catch (err) {
    showError(err);
  } finally {
    saving = false;
  }
}

export function initSignature() {
  const canvas = $('signatureCanvas');
  const ctx = canvas.getContext('2d');

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const p = e.touches && e.touches.length > 0 ? e.touches[0] : e;
    // Map from CSS pixels to canvas pixels so strokes land under the pointer.
    return {
      x: (p.clientX - rect.left) * (canvas.width / rect.width),
      y: (p.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    isDrawing = true;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const drawMove = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    hasDrawn = true;
  };

  const endDraw = () => {
    if (!isDrawing) return;
    isDrawing = false;
    ctx.closePath();
  };

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', drawMove);
  window.addEventListener('mouseup', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', drawMove, { passive: false });
  window.addEventListener('touchend', endDraw);

  onAction('sig-clear', clearPad);
  onAction('sig-close', closeSignatureModal);
  onAction('sig-save', saveSignature);
  onAction('sig-switch-lang', () => {
    if (!target || target.signerType !== 'kunde') return;
    renderKundeDetails(target.lang === 'de' ? 'sl' : 'de');
  });
  onAction('kunde-lang-close', () => closeModal('kundeLangModal'));
  onAction('kunde-lang', (d) => {
    const ctxK = pendingKunde;
    pendingKunde = null;
    closeModal('kundeLangModal');
    if (ctxK) openSignatureModal({ ...ctxK, signerType: 'kunde', lang: d.lang === 'sl' ? 'sl' : 'de' });
  });
}

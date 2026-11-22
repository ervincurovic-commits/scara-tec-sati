// PDF output. The Stundennachweis is a fixed customer document, so its
// wording does not follow the interface language.
import { t } from './i18n.js';
import { $, escapeHtml, showToast } from './ui.js';
import { state, getEntry } from './store.js';
import { formatHoursHHMM, isoWeek, weekDates, weekRangeStr } from './dates.js';

async function loadHtml2Pdf() {
  const mod = await import('html2pdf.js');
  return mod.default || mod;
}

export const safeFilePart = (s) => String(s).replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.-]/gu, '');

/** Everybody with hours on the project in that week, split per day. */
export function collectProjectWeek(projectId, weekStart) {
  const dates = weekDates(weekStart);
  const rows = [];
  let total = 0;

  for (const person of state.users) {
    let hasAny = false;
    let personSum = 0;
    let work = 0;
    let travel = 0;
    const days = dates.map((date) => {
      const entry = getEntry(person.id, date);
      if (!projectId || entry.projectId !== projectId) return { delo: 0, deloOstalo: 0, odmor: 0, sigma: 0 };
      const w = entry.workHours;
      const tr = entry.travelHours;
      if (w > 0 || tr > 0) hasAny = true;
      personSum += w + tr;
      work += w;
      travel += tr;
      return { delo: w, deloOstalo: tr, odmor: w > 0 ? 0.5 : 0, sigma: w + tr };
    });
    if (hasAny) {
      rows.push({ person, days, personSum, work, travel });
      total += personSum;
    }
  }
  return { rows, total };
}

export function buildStundennachweisHtml({ weekStart, company, location, project, rows, total, sig, leaderName }) {
  const b = 'border:1px solid #334155;';
  const cell = (v) => `<td style="${b} text-align:center; padding:1.5px; font-size:9px;">${formatHoursHHMM(v)}</td>`;

  const workerBlocksHtml = rows
    .map(
      (r, idx) => `
      <tr>
        <td rowspan="4" style="${b} text-align:center; font-weight:700; padding:2px; vertical-align:middle;">${idx + 1}</td>
        <td rowspan="4" style="${b} font-weight:700; padding:2px 4px; vertical-align:middle;">${escapeHtml(r.person.name)}</td>
        <td style="${b} padding:1.5px 4px; font-size:9px;">Delo</td>
        ${r.days.map((d) => cell(d.delo)).join('')}
        <td rowspan="4" style="${b} text-align:center; font-weight:800; padding:2px; vertical-align:middle; font-size:10px;">${formatHoursHHMM(r.personSum)}</td>
      </tr>
      <tr>
        <td style="${b} padding:1.5px 4px; font-size:9px;">Delo ostalo</td>
        ${r.days.map((d) => cell(d.deloOstalo)).join('')}
      </tr>
      <tr>
        <td style="${b} padding:1.5px 4px; font-size:9px;">Odmor</td>
        ${r.days.map((d) => cell(d.odmor)).join('')}
      </tr>
      <tr style="background:#f1f5f9; font-weight:700;">
        <td style="${b} padding:1.5px 4px; font-size:9px;">Σ</td>
        ${r.days.map((d) => cell(d.sigma)).join('')}
      </tr>
    `,
    )
    .join('');

  const th = (label, extra = 'text-align:center;') => `<th style="${b} padding:2.5px; ${extra}">${label}</th>`;
  const metaRow = (label, value, first = false) => `
    <tr>
      <td style="${b} padding:2.5px 6px; ${first ? 'width:18%; ' : ''}font-weight:700; background:#f8fafc;">${label}</td>
      <td style="${b} padding:2.5px 6px; ${first ? 'width:82%; ' : ''}font-weight:700;">${escapeHtml(value)}</td>
    </tr>`;
  const sigImg = (src) =>
    src ? `<img src="${escapeHtml(src)}" style="max-height:32px; display:block; margin-bottom:2px;">` : `<div style="height:26px;"></div>`;

  return `
    <div style="padding:8px 10px; width:760px; box-sizing:border-box; font-family: Arial, sans-serif; color:#0f172a; background:#ffffff;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0f172a; padding-bottom:4px; margin-bottom:5px;">
        <div>
          <div style="font-size:15px; font-weight:900; letter-spacing:0.5px; color:#0f172a;">SCARA-Tec</div>
          <div style="font-size:8.5px; line-height:1.25; color:#334155;">
            <strong>SCARA-Tec d.o.o.</strong><br>
            Gozdna ulica 2 C, SI-2311 Hoče<br>
            PE: Slovenija vas 77, SI-2288 Hajdina
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:9.5px; font-weight:700; color:#334155;">${weekRangeStr(weekStart)}</div>
          <div style="font-size:13px; font-weight:900; margin-top:1px;">STUNDENNACHWEIS KW: <span style="font-size:15px;">${isoWeek(weekStart).week}</span></div>
        </div>
      </div>

      <table style="width:100%; border-collapse:collapse; margin-bottom:5px; font-size:9px;">
        ${metaRow('Auftraggeber:', company, true)}
        ${metaRow('Baustelle:', location)}
        ${metaRow('Projekt:', project)}
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:9px;">
        <thead>
          <tr style="background:#e2e8f0; font-weight:800;">
            ${th('Nr.', 'width:24px; text-align:center;')}
            ${th('Name / Vorname', 'width:112px; text-align:left;')}
            ${th('AZ', 'width:56px; text-align:left;')}
            ${th('Montag')}${th('Deinstag')}${th('Mittwoch')}${th('Donnerstag')}${th('Freitag')}${th('Samstag')}${th('Sonntag')}
            ${th('Std. Summe', 'width:56px; text-align:center;')}
          </tr>
        </thead>
        <tbody>${workerBlocksHtml}</tbody>
        <tfoot>
          <tr style="background:#e2e8f0; font-weight:900; font-size:9.5px;">
            <td colspan="10" style="${b} padding:3px 6px; text-align:right;">KW Std. zusammen:</td>
            <td style="${b} padding:3px; text-align:center;">${formatHoursHHMM(total)}</td>
          </tr>
        </tfoot>
      </table>

      <div style="display:flex; justify-content:space-between; gap:12px; margin-top:7px; font-size:9px; page-break-inside:avoid; break-inside:avoid;">
        <div style="flex:1; ${b} padding:5px 8px; min-height:58px;">
          <div style="font-weight:700; margin-bottom:2px;">Vodja delovišča Scara-Tec:</div>
          ${sigImg(sig.userSignature)}
          <div style="border-top:1px solid #94a3b8; padding-top:2px; color:#334155;">${escapeHtml(sig.userSignedBy || leaderName || '')}</div>
        </div>
        <div style="flex:1; ${b} padding:5px 8px; min-height:58px;">
          <div style="font-weight:700; margin-bottom:2px;">Baulaiter AG:</div>
          ${sigImg(sig.kundeSignature)}
          <div style="border-top:1px solid #94a3b8; padding-top:2px; color:#334155;">${sig.kundeSignature ? 'Potpisano (Baulaiter AG)' : 'Nije potpisano'}</div>
        </div>
      </div>

      <div style="margin-top:6px; padding-top:3px; border-top:1px solid #94a3b8; font-size:7.5px; color:#475569; display:flex; justify-content:space-between; page-break-inside:avoid; break-inside:avoid;">
        <span>+386 (0) 59 77 915 • info@scara-tec.si • www.scara-tec.si</span>
        <span>TRR: SI56 0287 8026 3295 750 • SWIFT: LJBASI2X (NLB d.d.) • Matična št.: 8588163000 • ID za DDV: SI38769620</span>
      </div>
    </div>
  `;
}

export async function renderPdfHtmlToFile(htmlString, filename) {
  const root = $('scaraPdfExportRoot');
  Object.assign(root.style, {
    opacity: '1',
    zIndex: '9999',
    left: '0px',
    top: '0px',
    width: '760px',
    maxWidth: '760px',
    height: 'auto',
    overflow: 'visible',
  });
  root.innerHTML = htmlString;

  const targetEl = root.firstElementChild;
  targetEl.style.transformOrigin = 'top left';
  targetEl.style.transform = 'none';

  const maxSinglePageHeight = 520;
  const naturalHeight = targetEl.scrollHeight || targetEl.offsetHeight || 520;
  targetEl.style.zoom =
    naturalHeight > maxSinglePageHeight ? String(Math.max(0.55, maxSinglePageHeight / naturalHeight)) : '1';

  const opt = {
    margin: [4, 4, 4, 4],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    pagebreak: { mode: ['avoid-all'] },
    html2canvas: {
      scale: 1.6,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      x: 0,
      y: 0,
      width: 760,
      windowWidth: 780,
      scrollX: 0,
      scrollY: 0,
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
  };

  const cleanup = () => {
    root.style.opacity = '0';
    root.style.zIndex = '-50';
    root.style.left = '-10000px';
    root.innerHTML = '';
  };

  try {
    const html2pdf = await loadHtml2Pdf();
    await html2pdf().set(opt).from(targetEl).save();
    showToast(t('pdf.done'));
  } catch (err) {
    console.error('PDF export error:', err);
    showToast(t('pdf.error'), true);
  } finally {
    cleanup();
  }
}

/** The site leader's weekly table, printed as it appears on screen. */
export async function renderElementToPdf(element, filename) {
  const opt = {
    margin: [8, 8, 8, 8],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
  };
  document.body.classList.add('pdf-mode');
  try {
    const html2pdf = await loadHtml2Pdf();
    await html2pdf().set(opt).from(element).save();
  } catch (err) {
    console.error('PDF export error:', err);
    showToast(t('pdf.error'), true);
  } finally {
    document.body.classList.remove('pdf-mode');
  }
}

/**
 * Builds and saves the Stundennachweis for one project week.
 * filterMode: 'all' | 'signed' | 'unsigned' (by client signature).
 */
export async function downloadStundennachweis({ projectId, project, weekStart, sig, filterMode, company, location, leaderName, fileLabel }) {
  const kw = isoWeek(weekStart).week;
  const signed = Boolean(sig.kundeSignature);

  if (filterMode === 'signed' && !signed) {
    showToast(t('pdf.noSigned', { project, kw }), true);
    return;
  }

  const { rows, total } = collectProjectWeek(projectId, weekStart);
  const include = filterMode === 'all' || (filterMode === 'signed' && signed) || (filterMode === 'unsigned' && !signed);
  if (!include || rows.length === 0) {
    showToast(t('pdf.noHours', { kw }), true);
    return;
  }

  const html = buildStundennachweisHtml({ weekStart, company, location, project, rows, total, sig, leaderName });
  await renderPdfHtmlToFile(html, `Stundennachweis_KW${kw}_${safeFilePart(fileLabel)}_${filterMode}.pdf`);
}

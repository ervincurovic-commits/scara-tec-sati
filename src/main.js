import './style.css';
import { initI18n, setLang, t, applyStaticI18n } from './i18n.js';
import { initActions, onAction } from './actions.js';
import { $, escapeHtml, show, showError, initConfirmModal, isModalOpen } from './ui.js';
import { supabase } from './supabase.js';
import { REFRESH_MS } from './config.js';
import { currentMonthStr } from './dates.js';
import { state, signIn, signOut, loadReference, getSessionUserId, resetState } from './store.js';
import { initSignature } from './views/signature.js';
import { initBaulajter, showWeekly, showMyHours, showReport, showNotes } from './views/baulajter.js';
import { initNotes } from './views/notes.js';
import { initAdmin, showSites, showDatabase } from './views/admin.js';
import { buildMonthlyCardHtml, loadMonth } from './views/monthly.js';
import { renderDirectory } from './views/directory.js';

// ---------------------------------------------------------------- theme

const THEME_KEY = 'scara_theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-icon').forEach((icon) => {
    // Show the target mode: a moon in light mode, a sun in dark mode.
    icon.classList.toggle('fa-sun', theme === 'dark');
    icon.classList.toggle('fa-moon', theme === 'light');
  });
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* not persisted in private mode */
  }
  applyTheme(next);
}

// ---------------------------------------------------------------- screens

let currentView = '';

const SECTIONS = ['adminSection', 'baulajterSection', 'radnikSection', 'directorySection'];
const HEADER_BAU_CONTROLS = ['kwControlsGroup', 'todayKwBtn', 'downloadPdfBtn', 'bauSiteHeaderSelector'];

const NAV = {
  admin: [
    { view: 'admin-sites', icon: 'fa-building', label: 'nav.sites' },
    { view: 'admin-db', icon: 'fa-users-gear', label: 'nav.database' },
    { view: 'directory', icon: 'fa-address-book', label: 'nav.directory' },
  ],
  baulajter: [
    { view: 'bau-weekly', icon: 'fa-calendar-week', label: 'nav.weekly' },
    { view: 'bau-my', icon: 'fa-user-clock', label: 'nav.myHours' },
    { view: 'bau-projects', icon: 'fa-file-signature', label: 'nav.projects' },
    { view: 'bau-notes', icon: 'fa-note-sticky', label: 'nav.notes' },
    { view: 'directory', icon: 'fa-address-book', label: 'nav.directory' },
  ],
  radnik: [
    { view: 'radnik', icon: 'fa-clock', label: 'nav.myHours' },
    { view: 'directory', icon: 'fa-address-book', label: 'nav.directory' },
  ],
};

const DEFAULT_VIEW = { admin: 'admin-sites', baulajter: 'bau-weekly', radnik: 'radnik' };

function renderHeader() {
  const me = state.me;
  $('headerRoleBadge').innerText = `${t(`role.${me.role}`).toUpperCase()} • ${me.name}`;
  $('headerSubtitle').innerText = t(`header.sub.${me.role}`);
  $('roleNavTabs').innerHTML = NAV[me.role]
    .map(
      (n) => `<button type="button" class="nav-btn ${n.view === currentView ? 'is-active' : ''}" data-action="nav" data-view="${n.view}">
        <i class="fa-solid ${n.icon}"></i> ${escapeHtml(t(n.label))}
      </button>`,
    )
    .join('');
}

function setMonthDefaults() {
  for (const id of ['adminMonthPicker', 'bauMyMonthPicker', 'radnikMonthPicker']) {
    if (!$(id).value) $(id).value = currentMonthStr();
  }
}

async function showRadnik() {
  const picker = $('radnikMonthPicker');
  try {
    await loadMonth(picker.value);
  } catch (err) {
    showError(err);
  }
  $('radnikMonthlyContent').innerHTML = buildMonthlyCardHtml(state.me, picker.value);
}

async function openView(view) {
  const role = state.me.role;
  if (!NAV[role].some((n) => n.view === view)) view = DEFAULT_VIEW[role];
  currentView = view;
  renderHeader();

  SECTIONS.forEach((id) => show(id, false));
  HEADER_BAU_CONTROLS.forEach((id) => show(id, false));

  if (view === 'directory') {
    show('directorySection');
    renderDirectory();
    return;
  }
  if (view === 'admin-sites' || view === 'admin-db') {
    show('adminSection');
    show('adminTabBaustelle', view === 'admin-sites');
    show('adminTabDatabase', view === 'admin-db');
    return view === 'admin-sites' ? showSites() : showDatabase();
  }
  if (view.startsWith('bau-')) {
    show('baulajterSection');
    show('bauTabWeekly', view === 'bau-weekly');
    show('bauTabMyHours', view === 'bau-my');
    show('bauTabProjects', view === 'bau-projects');
    show('bauTabNotes', view === 'bau-notes');
    if (view === 'bau-weekly') {
      ['kwControlsGroup', 'todayKwBtn', 'downloadPdfBtn'].forEach((id) => show(id));
      return showWeekly();
    }
    if (view === 'bau-notes') return showNotes();
    return view === 'bau-my' ? showMyHours() : showReport();
  }
  show('radnikSection');
  return showRadnik();
}

function showLogin() {
  show('appScreen', false);
  show('loginScreen');
  $('loginPassword').value = '';
}

function loginError(msg) {
  const el = $('loginErrorMsg');
  el.innerText = msg;
  el.classList.toggle('hidden', !msg);
}

/** Loads the signed in person's data and opens their start screen. */
async function enterApp(userId) {
  const me = await loadReference(userId);
  if (!me) {
    await signOut();
    showLogin();
    loginError(t('login.noProfile'));
    return;
  }
  loginError('');
  setMonthDefaults();
  show('loginScreen', false);
  show('appScreen');
  await openView(DEFAULT_VIEW[me.role]);
}

// ---------------------------------------------------------------- refresh

/** Re-reads data colleagues may have changed, unless the user is busy. */
async function quietRefresh() {
  if (!state.me || document.hidden) return;
  const active = document.activeElement;
  if (active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) return;
  if (['signatureModal', 'kundeLangModal', 'editCredentialsModal', 'confirmModal'].some(isModalOpen)) return;
  try {
    await loadReference();
    if (!state.me) return;
    await openView(currentView);
  } catch {
    /* next round will try again */
  }
}

// ---------------------------------------------------------------- start

function wire() {
  initActions();
  initConfirmModal();
  initSignature();
  initBaulajter();
  initAdmin();
  initNotes();

  onAction('toggle-theme', toggleTheme);
  onAction('set-lang', (d) => {
    setLang(d.lang);
    if (state.me) openView(currentView);
  });
  onAction('nav', (d) => openView(d.view));
  onAction('logout', async () => {
    await signOut();
    currentView = '';
    showLogin();
  });

  $('directorySearchInput').addEventListener('input', renderDirectory);
  $('radnikMonthPicker').addEventListener('change', showRadnik);

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('loginUsername').value;
    const password = $('loginPassword').value;
    const btn = $('loginSubmitBtn');
    btn.disabled = true;
    loginError('');
    try {
      await signIn(username, password);
      await enterApp(await getSessionUserId());
    } catch (err) {
      const key = `err.${err.code || 'UNKNOWN'}`;
      const msg = t(key);
      loginError(msg === key ? t('err.UNKNOWN') : msg);
    } finally {
      btn.disabled = false;
    }
  });

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && state.me) {
      resetState();
      currentView = '';
      showLogin();
    }
  });

  setInterval(quietRefresh, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) quietRefresh();
  });
}

async function start() {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  initI18n();
  wire();
  applyStaticI18n();

  const userId = await getSessionUserId();
  if (!userId) {
    showLogin();
    return;
  }
  try {
    await enterApp(userId);
  } catch (err) {
    showLogin();
    showError(err);
  }
}

start();

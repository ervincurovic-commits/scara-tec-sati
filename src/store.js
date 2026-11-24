// All reads and writes go through here. The server decides what each role may
// see or change (row level security); this module only mirrors the result.
import { supabase } from './supabase.js';
import { LOGIN_DOMAIN } from './config.js';
import { weekStartOf } from './dates.js';

export const state = {
  me: null,
  users: [],
  sites: [],
  projects: [],
  bauLists: new Map(), // siteId -> [userId]
  entries: new Map(), // `${userId}|${date}` -> { projectId, workHours, travelHours }
  signatures: new Map(), // `${projectId}|${weekStart}` -> signature row
  notes: new Map(), // siteId -> [note]
};

class StoreError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code;
    this.cause = cause;
  }
}

function toError(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  if (msg.includes('LOCKED_BY_CLIENT_SIGNATURE')) return new StoreError('LOCKED', error);
  if (msg.includes('SIGNED_BY_CLIENT')) return new StoreError('SIGNED_BY_CLIENT', error);
  if (error?.code === '23505') return new StoreError('DUPLICATE', error);
  if (error?.code === '42501' || error?.status === 403) return new StoreError('FORBIDDEN', error);
  if (/fetch|network/i.test(error?.message || '')) return new StoreError('NETWORK', error);
  return new StoreError('UNKNOWN', error);
}

function check({ data, error }) {
  if (error) throw toError(error);
  return data;
}

/** Reads every row of a query, past the API's 1000 row page limit. */
async function fetchAll(makeQuery) {
  const size = 1000;
  const rows = [];
  for (let from = 0; ; from += size) {
    const page = check(await makeQuery().range(from, from + size - 1));
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

const entryKey = (userId, date) => `${userId}|${date}`;
const sigKey = (projectId, weekStart) => `${projectId}|${weekStart}`;

// ---------------------------------------------------------------- session

export const usernameToEmail = (username) => `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`;

export async function signIn(username, password) {
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (error) {
    if (error.status === 400 || error.code === 'invalid_credentials') throw new StoreError('BAD_LOGIN', error);
    if (error.status === 429) throw new StoreError('RATE_LIMIT', error);
    throw toError(error);
  }
}

export async function signOut() {
  await supabase.auth.signOut({ scope: 'local' });
  resetState();
}

export function resetState() {
  state.me = null;
  state.users = [];
  state.sites = [];
  state.projects = [];
  state.bauLists = new Map();
  state.entries = new Map();
  state.signatures = new Map();
  state.notes = new Map();
}

export async function getSessionUserId() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id || null;
}

// ---------------------------------------------------------------- reference data

export async function loadReference(userId = state.me?.id) {
  const [users, sites, members, projects, siteProjects, bauLists] = await Promise.all([
    fetchAll(() => supabase.from('profiles').select('id,name,username,role,email,phone').order('created_at').order('id')),
    fetchAll(() => supabase.from('sites').select('id,location,company,baulajter_id').order('created_at').order('id')),
    fetchAll(() => supabase.from('site_members').select('site_id,user_id').order('added_at').order('user_id')),
    fetchAll(() => supabase.from('projects').select('id,name,archived').order('created_at').order('id')),
    fetchAll(() => supabase.from('site_projects').select('site_id,project_id').order('site_id').order('project_id')),
    fetchAll(() => supabase.from('bau_lists').select('site_id,member_ids').eq('owner_id', userId).order('site_id')),
  ]);

  state.users = users;
  state.projects = projects;
  state.sites = sites.map((s) => ({
    id: s.id,
    location: s.location,
    company: s.company,
    baulajterId: s.baulajter_id || '',
    memberIds: members.filter((m) => m.site_id === s.id).map((m) => m.user_id),
    projectIds: siteProjects.filter((p) => p.site_id === s.id).map((p) => p.project_id),
  }));
  state.bauLists = new Map(bauLists.map((b) => [b.site_id, b.member_ids || []]));
  state.me = users.find((u) => u.id === userId) || null;
  return state.me;
}

export const userById = (id) => state.users.find((u) => u.id === id) || null;
export const projectById = (id) => state.projects.find((p) => p.id === id) || null;
export const projectName = (id) => projectById(id)?.name || '';
export const activeProjects = () => state.projects.filter((p) => !p.archived);
export const siteById = (id) => state.sites.find((s) => s.id === id) || null;

/** Active projects of one site, in the order they were created. */
export function siteProjectList(siteId) {
  const site = siteById(siteId);
  if (!site) return [];
  return activeProjects().filter((p) => site.projectIds.includes(p.id));
}

/** Sites the signed in site leader runs or belongs to. */
export function mySites() {
  if (!state.me) return [];
  return state.sites.filter((s) => s.baulajterId === state.me.id || s.memberIds.includes(state.me.id));
}

// ---------------------------------------------------------------- hours

export async function loadEntries(from, to) {
  const rows = await fetchAll(() =>
    supabase
      .from('time_entries')
      .select('user_id,work_date,project_id,work_hours,travel_hours')
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date')
      .order('user_id'),
  );
  for (const key of [...state.entries.keys()]) {
    const date = key.slice(key.indexOf('|') + 1);
    if (date >= from && date <= to) state.entries.delete(key);
  }
  for (const r of rows) {
    state.entries.set(entryKey(r.user_id, r.work_date), {
      projectId: r.project_id || '',
      workHours: Number(r.work_hours) || 0,
      travelHours: Number(r.travel_hours) || 0,
    });
  }
}

const EMPTY_ENTRY = Object.freeze({ projectId: '', workHours: 0, travelHours: 0 });

export function getEntry(userId, date) {
  return state.entries.get(entryKey(userId, date)) || EMPTY_ENTRY;
}

/** Writes one day. The cache is updated first and rolled back on failure. */
export async function saveEntry(userId, date, patch) {
  const key = entryKey(userId, date);
  const previous = state.entries.get(key);
  const next = { ...(previous || EMPTY_ENTRY), ...patch };
  state.entries.set(key, next);

  const { error } = await supabase.from('time_entries').upsert(
    {
      user_id: userId,
      work_date: date,
      project_id: next.projectId || null,
      work_hours: next.workHours,
      travel_hours: next.travelHours,
    },
    { onConflict: 'user_id,work_date' },
  );
  if (error) {
    if (previous) state.entries.set(key, previous);
    else state.entries.delete(key);
    throw toError(error);
  }
}

// ---------------------------------------------------------------- signatures

export async function loadSignatures(from, to) {
  if (state.me?.role === 'radnik') return;
  const rows = await fetchAll(() =>
    supabase
      .from('signatures')
      .select('project_id,week_start,user_signature,user_signed_name,kunde_signature,kunde_signed_at,kunde_lang')
      .gte('week_start', from)
      .lte('week_start', to)
      .order('week_start')
      .order('project_id'),
  );
  for (const key of [...state.signatures.keys()]) {
    const week = key.slice(key.indexOf('|') + 1);
    if (week >= from && week <= to) state.signatures.delete(key);
  }
  for (const r of rows) {
    state.signatures.set(sigKey(r.project_id, r.week_start), {
      userSignature: r.user_signature || '',
      userSignedBy: r.user_signed_name || '',
      kundeSignature: r.kunde_signature || '',
      kundeSignedAt: r.kunde_signed_at || '',
      kundeLang: r.kunde_lang || '',
    });
  }
}

const EMPTY_SIG = Object.freeze({ userSignature: '', userSignedBy: '', kundeSignature: '', kundeSignedAt: '', kundeLang: '' });

export function getSignature(projectId, weekStart) {
  if (!projectId) return EMPTY_SIG;
  return state.signatures.get(sigKey(projectId, weekStart)) || EMPTY_SIG;
}

/** True once the client has signed this project week: its hours are frozen. */
export function isLocked(projectId, date) {
  if (!projectId) return false;
  return Boolean(getSignature(projectId, weekStartOf(date)).kundeSignature);
}

export async function signAsLeader(projectId, weekStart, dataUrl) {
  check(
    await supabase.from('signatures').upsert(
      {
        project_id: projectId,
        week_start: weekStart,
        user_signature: dataUrl,
        user_signed_by: state.me.id,
        user_signed_name: state.me.name,
        user_signed_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,week_start' },
    ),
  );
  await loadSignatures(weekStart, weekStart);
}

export async function signAsClient(projectId, weekStart, dataUrl, lang) {
  check(
    await supabase
      .from('signatures')
      .update({ kunde_signature: dataUrl, kunde_signed_at: new Date().toISOString(), kunde_lang: lang })
      .eq('project_id', projectId)
      .eq('week_start', weekStart)
      .select('project_id'),
  );
  await loadSignatures(weekStart, weekStart);
}

export async function clearClientSignature(projectId, weekStart) {
  check(
    await supabase
      .from('signatures')
      .update({ kunde_signature: null, kunde_signed_at: null, kunde_lang: null })
      .eq('project_id', projectId)
      .eq('week_start', weekStart),
  );
  await loadSignatures(weekStart, weekStart);
}

// ---------------------------------------------------------------- projects

/**
 * Returns the id of this site's project with this name, creating or restoring
 * it. Projects never move between sites: another site's project with the same
 * name stays separate.
 */
export async function ensureSiteProject(siteId, name) {
  const clean = name.trim();
  const site = siteById(siteId);
  if (!site) throw new StoreError('FORBIDDEN');
  const existing = state.projects.find((p) => p.name === clean && site.projectIds.includes(p.id));
  if (existing) {
    if (existing.archived) {
      check(await supabase.from('projects').update({ archived: false }).eq('id', existing.id));
      existing.archived = false;
    }
    return existing.id;
  }
  const row = check(await supabase.from('projects').insert({ name: clean }).select('id,name,archived').single());
  state.projects.push(row);
  check(await supabase.from('site_projects').insert({ site_id: siteId, project_id: row.id }));
  site.projectIds.push(row.id);
  return row.id;
}

export async function archiveProject(projectId) {
  check(await supabase.from('projects').update({ archived: true }).eq('id', projectId));
  const p = projectById(projectId);
  if (p) p.archived = true;
}

// ---------------------------------------------------------------- sites

export async function createSite({ location, company, baulajterId, defaultProject }) {
  const site = check(
    await supabase
      .from('sites')
      .insert({ location, company, baulajter_id: baulajterId || null })
      .select('id')
      .single(),
  );
  if (baulajterId) {
    check(await supabase.from('site_members').insert({ site_id: site.id, user_id: baulajterId }));
  }
  await loadReference();
  const projectId = defaultProject ? await ensureSiteProject(site.id, defaultProject) : '';
  return { siteId: site.id, projectId };
}

export async function deleteSite(siteId) {
  check(await supabase.from('sites').delete().eq('id', siteId));
  await loadReference();
}

export async function setSiteLeader(siteId, baulajterId) {
  check(await supabase.from('sites').update({ baulajter_id: baulajterId || null }).eq('id', siteId));
  if (baulajterId) {
    check(
      await supabase
        .from('site_members')
        .upsert({ site_id: siteId, user_id: baulajterId }, { onConflict: 'site_id,user_id', ignoreDuplicates: true }),
    );
  }
  await loadReference();
}

export async function addSiteMember(siteId, userId) {
  check(
    await supabase
      .from('site_members')
      .upsert({ site_id: siteId, user_id: userId }, { onConflict: 'site_id,user_id', ignoreDuplicates: true }),
  );
  await loadReference();
}

export async function removeSiteMember(siteId, userId) {
  check(await supabase.from('site_members').delete().eq('site_id', siteId).eq('user_id', userId));
  await loadReference();
}

export async function saveBauList(siteId, memberIds) {
  const previous = state.bauLists.get(siteId);
  state.bauLists.set(siteId, memberIds);
  const { error } = await supabase
    .from('bau_lists')
    .upsert({ owner_id: state.me.id, site_id: siteId, member_ids: memberIds }, { onConflict: 'owner_id,site_id' });
  if (error) {
    if (previous) state.bauLists.set(siteId, previous);
    else state.bauLists.delete(siteId);
    throw toError(error);
  }
}

// ---------------------------------------------------------------- notes

const NOTE_COLS = 'id,site_id,author_id,author_name,body,created_at,updated_name,updated_at';

const toNote = (r) => ({
  id: r.id,
  siteId: r.site_id,
  authorId: r.author_id || '',
  authorName: r.author_name || '',
  body: r.body,
  createdAt: r.created_at,
  updatedName: r.updated_name || '',
  updatedAt: r.updated_at,
});

export async function loadNotes(siteId) {
  const rows = await fetchAll(() =>
    supabase.from('site_notes').select(NOTE_COLS).eq('site_id', siteId).order('created_at', { ascending: false }).order('id'),
  );
  state.notes.set(siteId, rows.map(toNote));
}

export const getNotes = (siteId) => state.notes.get(siteId) || [];

/** Administrators edit every note, site leaders only their own. */
export function canEditNote(note) {
  return state.me?.role === 'admin' || (state.me?.role === 'baulajter' && note.authorId === state.me.id);
}

export async function addNote(siteId, body) {
  check(await supabase.from('site_notes').insert({ site_id: siteId, body }));
  await loadNotes(siteId);
}

export async function updateNote(note, body) {
  const rows = check(await supabase.from('site_notes').update({ body }).eq('id', note.id).select('id'));
  if (!rows.length) throw new StoreError('FORBIDDEN');
  await loadNotes(note.siteId);
}

export async function deleteNote(note) {
  const rows = check(await supabase.from('site_notes').delete().eq('id', note.id).select('id'));
  if (!rows.length) throw new StoreError('FORBIDDEN');
  await loadNotes(note.siteId);
}

// ---------------------------------------------------------------- accounts

export async function setUserRole(userId, role) {
  check(await supabase.from('profiles').update({ role }).eq('id', userId));
  const u = userById(userId);
  if (u) u.role = role;
}

/** Calls the admin-users edge function (create, update, delete). */
export async function adminUsers(action, payload) {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { action, ...payload },
  });
  if (error) {
    let code = 'UNKNOWN';
    try {
      const body = await error.context.json();
      if (body?.error) code = body.error;
    } catch {
      if (/fetch|network/i.test(error.message || '')) code = 'NETWORK';
    }
    throw new StoreError(code, error);
  }
  await loadReference();
  return data;
}

// ---------------------------------------------------------------- backup

export async function exportAll() {
  const [members, siteProjects, entries, signatures, notes] = await Promise.all([
    fetchAll(() => supabase.from('site_members').select('site_id,user_id').order('site_id').order('user_id')),
    fetchAll(() => supabase.from('site_projects').select('site_id,project_id').order('site_id').order('project_id')),
    fetchAll(() =>
      supabase
        .from('time_entries')
        .select('user_id,work_date,project_id,work_hours,travel_hours')
        .order('work_date')
        .order('user_id'),
    ),
    fetchAll(() => supabase.from('signatures').select('*').order('week_start').order('project_id')),
    fetchAll(() => supabase.from('site_notes').select(NOTE_COLS).order('created_at').order('id')),
  ]);
  const sites = await fetchAll(() => supabase.from('sites').select('id,location,company,baulajter_id').order('created_at').order('id'));
  return {
    format: 'scara-tec-sati',
    version: 2,
    exportedAt: new Date().toISOString(),
    users: state.users,
    projects: state.projects,
    sites,
    siteMembers: members,
    siteProjects,
    timeEntries: entries,
    signatures,
    siteNotes: notes,
  };
}

/**
 * Merges a backup into the database. Logins are never restored from a file:
 * rows that point at a user who no longer exists are skipped and counted.
 */
export async function importAll(backup) {
  if (backup?.format !== 'scara-tec-sati' || backup.version !== 2) throw new StoreError('BAD_BACKUP');
  const userIds = new Set(state.users.map((u) => u.id));
  let skipped = 0;
  const keep = (rows, ...userFields) =>
    (Array.isArray(rows) ? rows : []).filter((r) => {
      const ok = userFields.every((f) => !r[f] || userIds.has(r[f]));
      if (!ok) skipped += 1;
      return ok;
    });

  const chunks = (rows, size = 500) => {
    const out = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
  };
  const upsert = async (table, rows, onConflict, ignoreDuplicates = false) => {
    for (const part of chunks(rows)) {
      check(await supabase.from(table).upsert(part, { onConflict, ignoreDuplicates }));
    }
  };

  const projects = (Array.isArray(backup.projects) ? backup.projects : []).map((p) => ({
    id: p.id,
    name: p.name,
    archived: Boolean(p.archived),
  }));
  await upsert('projects', projects, 'id');

  const sites = (Array.isArray(backup.sites) ? backup.sites : []).map((s) => ({
    id: s.id,
    location: s.location,
    company: s.company,
    baulajter_id: s.baulajter_id && userIds.has(s.baulajter_id) ? s.baulajter_id : null,
  }));
  await upsert('sites', sites, 'id');

  await upsert('site_members', keep(backup.siteMembers, 'user_id').map((m) => ({ site_id: m.site_id, user_id: m.user_id })), 'site_id,user_id', true);
  await upsert('site_projects', (backup.siteProjects || []).map((p) => ({ site_id: p.site_id, project_id: p.project_id })), 'site_id,project_id', true);

  // Signatures first would freeze their weeks, so hours go in before them.
  const entries = keep(backup.timeEntries, 'user_id').map((e) => ({
    user_id: e.user_id,
    work_date: e.work_date,
    project_id: e.project_id || null,
    work_hours: e.work_hours,
    travel_hours: e.travel_hours,
  }));
  let locked = 0;
  for (const part of chunks(entries)) {
    const { error } = await supabase.from('time_entries').upsert(part, { onConflict: 'user_id,work_date' });
    if (!error) continue;
    if (toError(error).code !== 'LOCKED') throw toError(error);
    // A frozen week is somewhere in this batch: retry row by row, skip frozen ones.
    for (const row of part) {
      const res = await supabase.from('time_entries').upsert(row, { onConflict: 'user_id,work_date' });
      if (res.error) {
        if (toError(res.error).code === 'LOCKED') locked += 1;
        else throw toError(res.error);
      }
    }
  }

  const signatures = (Array.isArray(backup.signatures) ? backup.signatures : []).map((s) => ({
    project_id: s.project_id,
    week_start: s.week_start,
    user_signature: s.user_signature,
    user_signed_by: s.user_signed_by && userIds.has(s.user_signed_by) ? s.user_signed_by : null,
    user_signed_name: s.user_signed_name || '',
    user_signed_at: s.user_signed_at,
    kunde_signature: s.kunde_signature,
    kunde_signed_at: s.kunde_signed_at,
    kunde_lang: s.kunde_lang,
  }));
  await upsert('signatures', signatures, 'project_id,week_start');

  // Notes keep their text; author and time are stamped by the database.
  const notes = (Array.isArray(backup.siteNotes) ? backup.siteNotes : []).map((n) => ({ id: n.id, site_id: n.site_id, body: n.body }));
  await upsert('site_notes', notes, 'id');

  state.entries = new Map();
  state.signatures = new Map();
  state.notes = new Map();
  await loadReference();
  return { skipped: skipped + locked };
}

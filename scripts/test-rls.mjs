// Permission tests against the LOCAL database (run seed-local.mjs first).
//   SUPABASE_URL=http://127.0.0.1:56321 SUPABASE_KEY=<local publishable> SUPABASE_SECRET_KEY=<local secret> \
//   node --experimental-websocket scripts/test-rls.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || '';
const pub = process.env.SUPABASE_KEY || '';
const secret = process.env.SUPABASE_SECRET_KEY || '';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error('Local only.');
  process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, secret, opts);
let failed = 0;
const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed += 1;
};

async function as(username) {
  const c = createClient(url, pub, opts);
  const { error } = await c.auth.signInWithPassword({ email: `${username}@scara-tec.invalid`, password: 'test1234' });
  if (error) throw new Error(`login ${username}: ${error.message}`);
  return c;
}

const ids = Object.fromEntries((await service.from('profiles').select('id,username')).data.map((p) => [p.username, p.id]));
const project = (await service.from('projects').select('id').eq('name', '1768/25-1800149').single()).data.id;
const other = (await service.from('projects').select('id').eq('name', 'Hala A1').single()).data.id;

// An outsider worker who is on no site.
let outsider = ids.outsider;
if (!outsider) {
  const { data } = await service.auth.admin.createUser({ email: 'outsider@scara-tec.invalid', password: 'test1234', email_confirm: true });
  outsider = data.user.id;
  await service.from('profiles').insert({ id: outsider, name: 'Outsider', username: 'outsider', role: 'radnik' });
}

const monday = (() => {
  const n = new Date();
  const d = new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7) - 1) - 14); // two weeks back, clean week
  return d.toISOString().slice(0, 10);
})();

// ---------------------------------------------------------------- anonymous
const anon = createClient(url, pub, opts);
for (const table of ['profiles', 'sites', 'time_entries', 'signatures', 'projects']) {
  const { data, error } = await anon.from(table).select('*').limit(1);
  ok(error || (data || []).length === 0, `anonymous cannot read ${table}`);
}
ok((await anon.from('app_state').select('*')).error, 'legacy app_state table is gone');
ok((await anon.from('time_entries').insert({ user_id: ids.marko, work_date: monday, work_hours: 5 })).error, 'anonymous cannot write hours');

// ---------------------------------------------------------------- worker
const marko = await as('marko');
const markoEntries = (await marko.from('time_entries').select('user_id')).data;
ok(markoEntries.length > 0 && markoEntries.every((e) => e.user_id === ids.marko), 'worker sees only own hours');
ok((await marko.from('time_entries').upsert({ user_id: ids.marko, work_date: monday, work_hours: 24 })).error, 'worker cannot write own hours');
ok((await marko.from('time_entries').upsert({ user_id: ids.sasa, work_date: monday, work_hours: 24 })).error, 'worker cannot write others hours');
{
  const { data } = await marko.from('profiles').update({ role: 'admin' }).eq('id', ids.marko).select();
  ok(!data || data.length === 0, 'worker cannot make self admin');
}
ok(((await marko.from('signatures').select('*')).data || []).length === 0, 'worker cannot read signatures');
ok((await marko.from('sites').insert({ location: 'x', company: 'y' })).error, 'worker cannot create sites');
ok((await marko.from('profiles').select('id')).data.length >= 4, 'worker can read staff directory');

// ---------------------------------------------------------------- site leader
const bau = await as('baulajter');
ok(!(await bau.from('time_entries').upsert({ user_id: ids.marko, work_date: monday, project_id: project, work_hours: 10 })).error, 'leader writes hours for site member');
ok(!(await bau.from('time_entries').upsert({ user_id: ids.baulajter, work_date: monday, project_id: project, work_hours: 10 })).error, 'leader writes own hours');
ok((await bau.from('time_entries').upsert({ user_id: outsider, work_date: monday, work_hours: 10 })).error, 'leader cannot write hours for non-member');
ok((await bau.from('time_entries').upsert({ user_id: ids.marko, work_date: addDays(monday, 1), work_hours: 30 })).error, 'hours above 24 rejected');
{
  const { data } = await bau.from('profiles').update({ role: 'admin' }).eq('id', ids.baulajter).select();
  ok(!data || data.length === 0, 'leader cannot make self admin');
}
ok((await bau.from('site_members').insert({ site_id: (await bau.from('sites').select('id').limit(1).single()).data.id, user_id: outsider })).error, 'leader cannot add site members');
{
  const { data } = await bau.from('sites').delete().neq('id', '00000000-0000-0000-0000-000000000000').select();
  ok(!data || data.length === 0, 'leader cannot delete sites');
}
ok((await bau.from('bau_lists').upsert({ owner_id: ids.marko, site_id: (await bau.from('sites').select('id').limit(1).single()).data.id, member_ids: [] })).error, 'leader cannot write another person list');

// Signatures and locking
const png = 'data:image/png;base64,iVBORw0KGgo=';
ok(!(await bau.from('signatures').upsert({ project_id: project, week_start: monday, user_signature: png, user_signed_by: ids.marko, user_signed_name: 'Forged' })).error, 'leader signs week');
ok((await bau.from('signatures').upsert({ project_id: other, week_start: addDays(monday, 2), user_signature: png })).error, 'signature week must start on Monday');
ok((await bau.from('signatures').upsert({ project_id: other, week_start: monday, kunde_signature: png })).error, 'client cannot sign before leader');
ok(!(await bau.from('signatures').update({ kunde_signature: png, kunde_lang: 'de', kunde_signed_at: new Date().toISOString() }).eq('project_id', project).eq('week_start', monday)).error, 'client signs after leader');
{
  const { error } = await bau.from('time_entries').upsert({ user_id: ids.marko, work_date: monday, project_id: project, work_hours: 4 });
  ok(error && /LOCKED/.test(error.message), 'hours locked after client signature');
}
{
  const { error } = await bau.from('time_entries').upsert({ user_id: ids.marko, work_date: monday, project_id: null, work_hours: 4 });
  ok(error && /LOCKED/.test(error.message), 'cannot move locked hours off the project');
}
{
  const { error } = await bau.from('signatures').update({ kunde_signature: null }).eq('project_id', project).eq('week_start', monday);
  ok(error && /SIGNED_BY_CLIENT/.test(error.message), 'leader cannot remove client signature');
}

// Cross-site isolation: a project of another site.
const adm0 = await as('admin');
const foreignSite = (await service.from('sites').insert({ location: 'Foreign', company: 'Other' }).select('id').single()).data.id;
const foreignProject = (await service.from('projects').insert({ name: `Foreign ${Date.now()}` }).select('id').single()).data.id;
await service.from('site_projects').insert({ site_id: foreignSite, project_id: foreignProject });
await service.from('signatures').insert({ project_id: foreignProject, week_start: monday, user_signature: png, user_signed_name: 'Other' });
ok(((await bau.from('signatures').select('*').eq('project_id', foreignProject)).data || []).length === 0, 'leader cannot read other site signatures');
ok((await bau.from('signatures').upsert({ project_id: foreignProject, week_start: addDays(monday, 7), user_signature: png, kunde_signature: png })).error, 'leader cannot sign other site project');
{
  const ownSite = (await bau.from('sites').select('id').limit(1).single()).data.id;
  ok((await bau.from('site_projects').insert({ site_id: ownSite, project_id: foreignProject })).error, 'leader cannot link other site project');
  const { data } = await bau.from('projects').update({ archived: true }).eq('id', foreignProject).select();
  ok(!data || data.length === 0, 'leader cannot archive other site project');
}
{
  const { data } = await service.from('signatures').select('user_signed_by,user_signed_name').eq('project_id', project).eq('week_start', monday).single();
  ok(data.user_signed_by === ids.baulajter && data.user_signed_name === 'Ervin Ćurović', 'signer recorded by server, not client');
}
await service.from('sites').delete().eq('id', foreignSite);
await service.from('signatures').delete().eq('project_id', foreignProject);
await service.from('projects').delete().eq('id', foreignProject);

// ---------------------------------------------------------------- admin
const adm = await as('admin');
ok(!(await adm.from('signatures').update({ kunde_signature: null, kunde_lang: null, kunde_signed_at: null }).eq('project_id', project).eq('week_start', monday)).error, 'admin removes client signature');
ok(!(await bau.from('time_entries').upsert({ user_id: ids.marko, work_date: monday, project_id: project, work_hours: 8 })).error, 'hours editable again after admin unlock');

// Account function
const fn = (client, body) => client.functions.invoke('admin-users', { body });
const fnCode = async (res) => {
  if (!res.error) return 'OK';
  try {
    return (await res.error.context.json()).error;
  } catch {
    return 'ERR';
  }
};
ok((await fnCode(await fn(bau, { action: 'create', name: 'X', username: 'hacker', password: 'secret12', role: 'admin' }))) === 'FORBIDDEN', 'leader cannot create accounts');
ok((await fnCode(await fn(adm, { action: 'create', name: 'Neu Radnik', username: 'neu', password: 'secret12', role: 'radnik' }))) === 'OK', 'admin creates account');
{
  const c = createClient(url, pub, opts);
  ok(!(await c.auth.signInWithPassword({ email: 'neu@scara-tec.invalid', password: 'secret12' })).error, 'new account can log in');
}
const neuId = (await service.from('profiles').select('id').eq('username', 'neu').single()).data.id;
ok((await fnCode(await fn(adm, { action: 'update', id: neuId, username: 'neu2', password: 'other123' }))) === 'OK', 'admin changes login and password');
{
  const c = createClient(url, pub, opts);
  ok(!(await c.auth.signInWithPassword({ email: 'neu2@scara-tec.invalid', password: 'other123' })).error, 'changed login works');
}
ok((await fnCode(await fn(adm, { action: 'create', name: 'Dup', username: 'marko', password: 'secret12', role: 'radnik' }))) === 'USERNAME_TAKEN', 'duplicate username rejected');
ok((await fnCode(await fn(adm, { action: 'delete', id: ids.admin }))) === 'CANNOT_DELETE_SELF', 'admin cannot delete self');
ok((await fnCode(await fn(adm, { action: 'delete', id: neuId }))) === 'OK', 'admin deletes account');
ok(!(await service.from('profiles').select('id').eq('id', neuId).maybeSingle()).data, 'deleted profile is gone');
ok((await fnCode(await fn(anon, { action: 'delete', id: ids.marko }))) === 'UNAUTHENTICATED', 'anonymous cannot call account function');

// ---------------------------------------------------------------- site notes
{
  const ownSite = (await bau.from('sites').select('id').limit(1).single()).data.id;
  const far = (await service.from('sites').insert({ location: 'Notes Fremd', company: 'X' }).select('id').single()).data.id;

  const mine = await bau.from('site_notes').insert({ site_id: ownSite, body: 'Kran kommt Montag', author_id: ids.admin, author_name: 'Fake' }).select('id,author_id,author_name').single();
  ok(!mine.error, 'leader adds note on own site');
  ok(mine.data?.author_id === ids.baulajter && mine.data?.author_name === 'Ervin Ćurović', 'note author stamped by server');
  ok((await bau.from('site_notes').insert({ site_id: far, body: 'x' })).error, 'leader cannot add note on other site');
  ok((await marko.from('site_notes').insert({ site_id: ownSite, body: 'x' })).error, 'worker cannot add notes');
  ok(((await marko.from('site_notes').select('id')).data || []).length === 0, 'worker cannot read notes');

  const seen = (await adm.from('site_notes').select('id,body').eq('id', mine.data.id)).data || [];
  ok(seen.length === 1, 'admin reads leader note');
  const edited = await adm.from('site_notes').update({ body: 'Kran kommt Dienstag' }).eq('id', mine.data.id).select('body,author_id,updated_by').single();
  ok(edited.data?.body === 'Kran kommt Dienstag' && edited.data.author_id === ids.baulajter && edited.data.updated_by === ids.admin, 'admin edits leader note, author kept');

  const admNote = (await adm.from('site_notes').insert({ site_id: ownSite, body: 'Von Admin' }).select('id').single()).data.id;
  ok(((await bau.from('site_notes').select('id').eq('id', admNote)).data || []).length === 1, 'leader reads admin note on own site');
  ok(((await bau.from('site_notes').update({ body: 'hack' }).eq('id', admNote).select()).data || []).length === 0, 'leader cannot edit admin note');
  ok(((await bau.from('site_notes').delete().eq('id', admNote).select()).data || []).length === 0, 'leader cannot delete admin note');
  ok(((await bau.from('site_notes').update({ site_id: far }).eq('id', mine.data.id).select('site_id')).data || [])[0]?.site_id === ownSite, 'note cannot move to other site');

  const farNote = (await service.from('site_notes').insert({ site_id: far, body: 'geheim' }).select('id').single()).data.id;
  ok(((await bau.from('site_notes').select('id').eq('id', farNote)).data || []).length === 0, 'leader cannot read other site notes');
  ok(((await bau.from('site_notes').delete().eq('id', mine.data.id).select()).data || []).length === 1, 'leader deletes own note');

  // Same project name on two sites stays two separate projects.
  const p1 = await adm.from('projects').insert({ name: 'Doppelt' }).select('id').single();
  const p2 = await adm.from('projects').insert({ name: 'Doppelt' }).select('id').single();
  ok(!p1.error && !p2.error && p1.data.id !== p2.data.id, 'two sites may use the same project name');
  await service.from('projects').delete().in('id', [p1.data?.id, p2.data?.id].filter(Boolean));

  await service.from('sites').delete().eq('id', far);
  await service.from('site_notes').delete().eq('site_id', ownSite);
}

// cleanup
await service.from('time_entries').delete().eq('work_date', monday);
await service.from('signatures').delete().eq('week_start', monday);

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);

function addDays(d, n) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

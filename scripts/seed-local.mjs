// Fills the LOCAL development database with the demo content of the old app.
// Refuses to run against anything but 127.0.0.1 / localhost.
//
//   SUPABASE_URL=http://127.0.0.1:56321 SUPABASE_SECRET_KEY=<local secret> node scripts/seed-local.mjs
//   (Node 20 needs: node --experimental-websocket ...)
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SECRET_KEY || '';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) || !key) {
  console.error('seed-local only runs against a local Supabase (http://127.0.0.1:<port>).');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const must = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

const PASSWORD = 'test1234';
const people = [
  { key: 'admin', name: 'Administrator', username: 'admin', role: 'admin', email: 'admin@scara-tec.si', phone: '+386 59 77 915' },
  { key: 'bau', name: 'Ervin Ćurović', username: 'baulajter', role: 'baulajter', email: 'ervin.curovic@scara-tec.si', phone: '+386 41 111 222' },
  { key: 'marko', name: 'Marko Marković', username: 'marko', role: 'radnik', email: 'marko.m@scara-tec.si', phone: '+386 41 333 444' },
  { key: 'sasa', name: 'Saša Jovanović', username: 'sasa', role: 'radnik', email: 'sasa.j@scara-tec.si', phone: '+386 41 555 666' },
];

const ids = {};
const existing = must(await db.from('profiles').select('id,username'));
for (const p of people) {
  const found = existing.find((e) => e.username === p.username);
  if (found) {
    ids[p.key] = found.id;
    continue;
  }
  const { user } = must(
    await db.auth.admin.createUser({ email: `${p.username}@scara-tec.invalid`, password: PASSWORD, email_confirm: true }),
  );
  must(await db.from('profiles').insert({ id: user.id, name: p.name, username: p.username, role: p.role, email: p.email, phone: p.phone }));
  ids[p.key] = user.id;
}

const projects = {};
for (const name of ['1768/25-1800149', 'Objekat Centar', 'Hala A1']) {
  const row = must(await db.from('projects').upsert({ name }, { onConflict: 'name' }).select('id').single());
  projects[name] = row.id;
}

let site = must(await db.from('sites').select('id').eq('location', 'Stuttgart Mercedes Benz').maybeSingle());
if (!site) {
  site = must(
    await db
      .from('sites')
      .insert({ location: 'Stuttgart Mercedes Benz', company: 'KS ENGINEERS, Kristl, Seibt & Co Ges.m.b.H', baulajter_id: ids.bau })
      .select('id')
      .single(),
  );
}
must(
  await db
    .from('site_members')
    .upsert(['bau', 'marko', 'sasa'].map((k) => ({ site_id: site.id, user_id: ids[k] })), { onConflict: 'site_id,user_id', ignoreDuplicates: true }),
);
must(
  await db
    .from('site_projects')
    .upsert({ site_id: site.id, project_id: projects['1768/25-1800149'] }, { onConflict: 'site_id,project_id', ignoreDuplicates: true }),
);

// Current ISO week, Monday first.
const now = new Date();
const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
const monday = new Date(today);
monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() || 7) - 1));
const day = (i) => {
  const d = new Date(monday);
  d.setUTCDate(monday.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};

const pid = projects['1768/25-1800149'];
const entries = [
  ...[0, 1, 2, 4].map((i) => ({ user_id: ids.bau, work_date: day(i), project_id: pid, work_hours: 10, travel_hours: 0 })),
  ...[0, 1, 2, 3, 4].map((i) => ({ user_id: ids.marko, work_date: day(i), project_id: pid, work_hours: 10, travel_hours: 0 })),
];
must(await db.from('time_entries').upsert(entries, { onConflict: 'user_id,work_date' }));

console.log(`Local demo data ready. Logins: admin, baulajter, marko, sasa (password ${PASSWORD}).`);

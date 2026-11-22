// Creates the first administrator account. Run once per Supabase project:
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SECRET_KEY=<secret or service_role key> \
//   node scripts/create-admin.mjs <username> <password> "<Full Name>"
//   (Node 20 needs: node --experimental-websocket scripts/create-admin.mjs ...)
//
// The secret key bypasses row level security: never put it in the app,
// in git, or in a Vercel environment variable.
import { createClient } from '@supabase/supabase-js';

const LOGIN_DOMAIN = 'scara-tec.invalid';
const [username, password, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim() || 'Administrator';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key || !username || !password) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/create-admin.mjs <username> <password> "<Full Name>"');
  process.exit(1);
}
if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
  console.error('Username: 2 to 40 characters, lowercase letters, digits, dot, dash, underscore.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Use a password of at least 8 characters for the administrator.');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await admin.auth.admin.createUser({
  email: `${username}@${LOGIN_DOMAIN}`,
  password,
  email_confirm: true,
});
if (error) {
  console.error('Could not create the login:', error.message);
  process.exit(1);
}

const { error: profileError } = await admin
  .from('profiles')
  .insert({ id: data.user.id, name, username, role: 'admin' });
if (profileError) {
  await admin.auth.admin.deleteUser(data.user.id);
  console.error('Could not create the profile:', profileError.message);
  process.exit(1);
}

console.log(`Administrator "${username}" created.`);

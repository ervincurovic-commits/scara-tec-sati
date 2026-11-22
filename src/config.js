// Public client configuration. The publishable key is meant to be shipped to
// browsers: every table is protected by row level security and needs a login.
const PROD_URL = 'https://pjelwskexxjulhrzolsq.supabase.co';
const PROD_KEY = 'sb_publishable_gxpu5_zfkFrXKmrZOe9lCA_JnxEOp_l';

// Local development must name its database in .env.local, so a dev server
// can never write into the live project by accident.
if (import.meta.env.DEV && !import.meta.env.VITE_SUPABASE_URL) {
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY in .env.local for local development.');
}

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || PROD_URL;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || PROD_KEY;

// Logins are plain usernames. Supabase Auth wants an e-mail address, so the
// username is mapped onto a reserved domain that can never receive mail.
export const LOGIN_DOMAIN = 'scara-tec.invalid';

export const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;
export const MIN_PASSWORD = 6;

// How often open screens re-read data that colleagues may have changed.
export const REFRESH_MS = 15000;

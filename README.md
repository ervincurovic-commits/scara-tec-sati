# SCARA-Tec — Evidencija radnih i putnih sati

Hours tracker for SCARA-Tec d.o.o.: site leaders enter work and travel hours per
construction site and ISO week, workers see their own month, admins manage sites,
accounts and reports. The client (Baulaiter AG) signs each project week on the
leader's device; signed weeks are frozen.

Interface: Bosnian (original) and Slovenian, dark (original) and light theme.

## Stack

- Vite + Tailwind 3, plain JavaScript modules (`src/`)
- Supabase: Auth (username logins), Postgres with row level security,
  one edge function (`admin-users`) for account management
- Vercel hosting (`vercel.json` sets the build and security headers)

The original single-file app is kept in `legacy/index.html` for reference.

## Security model

- Every table needs a signed-in session; anonymous visitors get nothing.
- Roles live in `profiles.role` and are enforced in the database (RLS):
  - **radnik**: reads own hours and the staff directory
  - **baulajter**: enters hours for self and members of own sites, signs weeks
  - **admin**: everything
- Hours of a project week are locked by a trigger once the client has signed;
  only an admin can remove a client signature.
- Passwords are handled by Supabase Auth (hashed). Admins set new passwords
  but can never read existing ones.

## Local development

```bash
npm install
npx supabase start            # local Postgres/Auth/functions, ports 563xx
# put the local URL + publishable key printed above into .env.local:
#   VITE_SUPABASE_URL=http://127.0.0.1:56321
#   VITE_SUPABASE_KEY=sb_publishable_...
SUPABASE_URL=http://127.0.0.1:56321 SUPABASE_SECRET_KEY=<local secret> node scripts/seed-local.mjs
npm run dev                   # http://localhost:5183  (logins: admin, baulajter, marko, sasa / test1234)
```

Permission tests: `node scripts/test-rls.mjs` (see header for env vars).
On Node 20 add `--experimental-websocket` to node scripts.

## Going live (Supabase project of SCARA-Tec)

```bash
npx supabase login
npx supabase link --project-ref pjelwskexxjulhrzolsq
npx supabase db push                          # schema + RLS; drops the old app_state table
npx supabase functions deploy admin-users
SUPABASE_URL=https://pjelwskexxjulhrzolsq.supabase.co SUPABASE_SECRET_KEY=<secret key> \
  node scripts/create-admin.mjs <username> <password> "<Full Name>"
```

In the Supabase dashboard: Authentication → Sign In / Providers → turn off
"Allow new users to sign up". Then merge to `main`; Vercel builds and deploys.

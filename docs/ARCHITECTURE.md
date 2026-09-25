# Architecture

## Shape
Static React PWA hosted on Vercel (auto-deployed from a private GitHub repo) talking directly to Supabase. No custom server. The CSV is
parsed and classified in the browser; classified lines are upserted to Postgres. Supabase
Realtime keeps both phones in sync.

```
Phone / laptop ──► React PWA ──► Supabase Auth (email + password)
                      │   └────► Postgres (RLS: household members only)
                      └── classify.ts (pure, tested)
```

## Auth and access
- **Email and password** login (`signInWithPassword`). No emails are sent, so nothing depends on
  Supabase's email templates (which can't be edited without custom SMTP) and nothing opens a
  link in Safari instead of the installed app. Sessions refresh automatically, so each of you
  signs in rarely; the phones' password managers fill it in.
- Forgotten password: the owner sets a new one in the Supabase dashboard (Auth → Users). An
  in-app "change password" (`updateUser({ password })`) is available while signed in.
- Email one-time codes can be added later if custom SMTP is set up (`signInWithOtp` +
  `verifyOtp({ type: 'email' })`, template showing `{{ .Token }}`).
- Public sign-up **disabled** in Supabase.
- The owner creates both users in the Supabase dashboard, then runs the seed in
  `supabase/seed-household.sql` to create the household and add both as members.
- Every table has `household_id`; RLS allows select/insert/update/delete only where
  `is_member(household_id)`.

## Data model
See `supabase/migrations/0001_init.sql`. Key points:
- `lines` holds every classified line (all kinds), keyed by `(household_id, tx_id)` so
  re-imports upsert instead of duplicating.
- Monthly figures are computed from `lines` (SQL view `monthly_group_totals` or client-side);
  no stored aggregates to go stale.
- Trips store only definitions plus manual overrides (`trip_overrides`); allocation is computed
  by the shared pure function `allocateTrips(lines, trips, overrides)`.
- `line_overrides` holds manual changes to a line (kind or category), keyed by transaction id.
- Goals, targets and household settings are small per-household tables; `user_settings` holds
  per-person view choices (trip toggle, window).
- Child tables use composite foreign keys (`(id, household_id)`) so a row can only point at a
  parent in the same household.

## Environment
`.env.local` (git-ignored; `.env.example` lists the names with no values):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — used by the app; also added to Vercel.
- `SUPABASE_SERVICE_ROLE_KEY` — **local only**, no `VITE_` prefix so it can never reach the
  browser build. Used only by the RLS tests. Never add it to Vercel, GitHub secrets or CI.
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` — for `scripts/supabase.mjs` (migrations and
  types through the Supabase Management API). Local only. The token is project-scoped (Project
  read, Database read and write) and expires; generate a new one when the script says so.

## Database changes
Migrations live in `supabase/migrations/` (`<version>_<name>.sql`). `npm run db:push` applies
pending ones through the Management API, each in one transaction with its record in
`supabase_migrations.schema_migrations` (the table the Supabase CLI uses, so the CLI stays
compatible). `npm run db:types` writes `src/lib/database.types.ts`. No database password or CLI
link is needed.

## Installing on phones
vite-plugin-pwa with manifest (name "See The Money", short name "See The Money", theme #16242B),
icons 192/512, offline shell. On iPhone: Safari → Share → Add to Home Screen.

## Workflow
VS Code for editing, GitHub for the private repo and CI (GitHub Actions runs `npm test` and
`npm run build` on every push and pull request), Vercel for hosting (production from `main`,
preview deployments for pull requests). Work on a branch per phase and merge when its checks pass.

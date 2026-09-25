# Architecture

## Shape
Static React PWA hosted on Vercel (auto-deployed from a private GitHub repo) talking directly to Supabase. No custom server. The CSV is
parsed and classified in the browser; classified lines are upserted to Postgres. Supabase
Realtime keeps both phones in sync.

```
Phone / laptop ──► React PWA ──► Supabase Auth (email one-time code)
                      │   └────► Postgres (RLS: household members only)
                      └── classify.ts (pure, tested)
```

## Auth and access
- Email **6-digit code** login (`signInWithOtp` then `verifyOtp({ type: 'email' })`), not a
  link: a link opens Safari instead of the installed app. Supabase sends a link by default, so
  the Magic Link email template must be edited to show `{{ .Token }}` (a You step).
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
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` — for the Supabase CLI (`db push`,
  `gen types`). Local only.

## Database changes
Supabase CLI migrations in `supabase/migrations/`, applied with `npx supabase db push`.
`npm run db:types` = `npx supabase gen types typescript --project-id $SUPABASE_PROJECT_REF > src/lib/database.types.ts`.

## Installing on phones
vite-plugin-pwa with manifest (name "See The Money", short name "See The Money", theme #16242B),
icons 192/512, offline shell. On iPhone: Safari → Share → Add to Home Screen.

## Workflow
VS Code for editing, GitHub for the private repo and CI (GitHub Actions runs `npm test` and
`npm run build` on every push and pull request), Vercel for hosting (production from `main`,
preview deployments for pull requests). Work on a branch per phase and merge when its checks pass.

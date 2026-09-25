# Build plan

Each phase ends with acceptance checks. Don't start the next phase until they pass. One branch
per phase, merged to `main` when CI is green.

## Phase 0 — Repo
- **You:** open the unzipped folder in VS Code. Source Control → Publish to GitHub → **private**.
- Commit the package as-is and push. Check that `git check-ignore data/x.csv .env.local .vercel`
  prints all three, and that `data/expected-real.json` is not in the commit.
- CI runs but skips tests until a lockfile exists (Phase 1).
- **Accept:** repo is private; the first CI run is green (skipped); no real data in history.

## Phase 1 — Classifier (no UI, no database)
- Scaffold Vite + React + TS + Vitest on Node 22 (`"engines": {"node": ">=22"}`, `.nvmrc` 22).
- Port `reference/process.js` to `src/lib/classify.ts` returning typed `Line[]` (one per row, with
  the kinds in DATA-RULES) plus `summarise(lines, window)`. Apply the DATA-RULES changes the
  reference doesn't have yet: separate `loan_in`/`internal` kinds, manual overrides, window and
  covered days, the TCM repayment flag.
- Personal patterns in `src/config/household-rules.ts`.
- Port trip allocation and suggestions from `reference/prototype.html` to `src/lib/trips.ts`
  (dismissals by date range); planner maths to `src/lib/plan.ts`.
- **Accept:** all five DATA-RULES tests pass (real-data one locally); trip tests prove the
  Melbourne insurance line isn't auto-ticked, a manual include wins, a line can't be in two trips,
  and a dismissed range hides a shifted cluster; planner tests cover months-left, share-the-cut
  rounding and trim defaults; CI green.

## Phase 2 — Supabase
- **You:** create a Supabase project (region Sydney). Copy `.env.example` to `.env.local` and fill
  in URL, anon key, service-role key, project ref, and a personal access token (Account →
  Access Tokens).
- **You:** Auth → Providers → Email: turn off "Allow new users to sign up".
- **You:** Auth → Email Templates → Magic Link: replace the body with a message that shows the
  code, e.g. `Your See The Money code is {{ .Token }}`. (Without this, Supabase emails a link.)
- **You:** Auth → Users → add both email addresses.
- `npx supabase link --project-ref $SUPABASE_PROJECT_REF`, `npx supabase db push`, then run
  `supabase/seed-household.sql` with your real emails; `npm run db:types`.
- **Accept:** RLS tests (using the service-role key locally to create a throwaway outsider
  user) show members can read and write; the outsider reads nothing and can't write; a
  `trip_overrides` row can't point at a trip in another household.

## Phase 3 — Sign-in and import
- Sign-in screen: email → 6-digit code → household loaded.
- Data screen: pick CSV → classify on device → preview (totals, skipped rows with reasons,
  "Check: pay or loan repayment?" lines) → import (`imports` row, upsert `lines` in batches of 500).
- **Accept:** importing the real export twice leaves the same line count; a second export that
  leaves a gap shows the missing range.

## Phase 4 — Overview
- Window picker, headline, per-person trip toggle, stacked month chart (hand-drawn SVG is fine),
  Where it goes with drill-down, Not counted as spending (including Lent / Repaid / Still owed and
  "Mark as loan repayment").
- **Accept:** for the real export and a 12-month window, the Overview's totals and per-month
  figures match `data/expected-real.json` to the cent (these come from `reference/process.js`;
  the classifier in `reference/prototype.html` is older and is no longer the numbers reference).

## Phase 5 — Trips
- Suggestions, add/edit/delete trips, candidate lists with overrides, bucket totals, trips-goal
  button, type filter, "Recharge to TCM" flag with a list view.
- Realtime: a tick on one phone appears on the other within a few seconds.
- **Accept:** the real data gives exactly the seven suggestions in `data/expected-real.json`;
  adding all seven with the Add button (no manual ticks) gives exactly its `trips` totals.

## Phase 6 — Plan
- Goals, offset, left-to-spend equation, verdict, targets with trim defaults, share the cut,
  This month so far.
- **Accept:** planner numbers match the prototype for identical inputs.

## Phase 7 — Ship
- PWA manifest and icons, offline shell, empty and error states in the app's voice.
- Add `vercel.json` with an SPA rewrite (`/(.*)` → `/index.html`).
- **You:** Vercel → Add New → Project → import the GitHub repo (framework Vite, Node 22). Add
  only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Production and Preview). Deploy.
- **You:** Supabase → Auth → URL Configuration: Site URL = the Vercel production URL; add
  `https://*-<your-vercel-team>.vercel.app/**` as a redirect URL for preview deploys.
- **You:** each of you signs in on your phone and adds See The Money to the home screen.
- **Accept:** installable on iPhone Safari and Android Chrome; dark mode; the short name isn't cut
  off on the home screen (use "SeeTheMoney" if it is).

## Later
- Rules editor (move `household-rules.ts` into a table).
- Monthly check-in view: last month vs targets, goals progress, a one-line summary to talk through.
- Export Work trips and TCM loan movements as CSV for the accountant.

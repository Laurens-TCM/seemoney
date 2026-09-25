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
  in the project URL (no `/rest/v1/`), publishable (anon) key, secret (service-role) key, project
  ref, and a project-scoped access token (Account → Access Tokens: Project read, Database read and write).
- **You:** Auth → Sign In / Providers: turn off "Allow new users to sign up"; keep Email on with a
  minimum password length of 12.
- **You:** Auth → Users → Create new user for each of you: email, a strong password (save it in
  your password manager), and "Auto confirm user".
- `npm run db:push`, then create the household and add both users as members
  (`supabase/seed-household.sql`, or the same statements via the API); `npm run db:types`.
- **Accept:** RLS tests (using the service-role key locally to create a throwaway outsider
  user) show members can read and write; the outsider reads nothing and can't write; a
  `trip_overrides` row can't point at a trip in another household.

## Phase 3 — Sign-in and import
- Sign-in screen: email and password (with `autocomplete` hints so phones offer saved
  passwords) → household loaded. "Change password" in a small account menu.
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
- `vercel.json` (done in Phase 3) pins the Vite framework, `npm ci`, the `dist` output and the SPA
  rewrite (`/(.*)` → `/index.html`).
- **You (done early, in Phase 3):** Vercel project connected to the repo, with only
  `VITE_SUPABASE_URL` (project URL, no `/rest/v1/`) and `VITE_SUPABASE_ANON_KEY` (publishable key)
  for Production and Preview, **Sensitive off**. Vercel blanks the value of a `VITE_` variable
  marked Sensitive, and a variable's type can't be changed later: remove and re-add it. Never add
  the secret key, the access token or the project ref to Vercel.
- **You:** Supabase → Auth → URL Configuration: Site URL = the Vercel production URL; add
  `https://*-<your-vercel-team>.vercel.app/**` as a redirect URL for preview deploys.
- **You:** each of you signs in on your phone and adds See The Money to the home screen.
- **Accept:** installable on iPhone Safari and Android Chrome; dark mode; the short name isn't cut
  off on the home screen (use "SeeTheMoney" if it is).

## Later
- Rules editor (move `household-rules.ts` into a table).
- Monthly check-in view: last month vs targets, goals progress, a one-line summary to talk through.
- Export Work trips and TCM loan movements as CSV for the accountant.

# v2 — Back, Now, Ahead (see docs/V2-SPEC.md)

## Phase 8 — Regulars
- Port `reference/recurring.js` to `src/lib/recurring.ts`; tests against
  `fixtures/expected-recurring.json` and the real-data counts.
- `regulars` table (`0005_regulars.sql`), Regulars screen with Keep/Review/Cancel, Stopped,
  manual add, "Not a regular", price-rise and New badges, due-day calendar.
- **Accept:** fixture matches; real data finds the same series as `data/expected-real.json`.

## Phase 9 — Events and colour
- Apply `0006_events.sql` (from the reviewed draft): trips → events with types; automatic events on import;
  "Label this?" for big one-off lines; colour tokens and the planned (hatched) style.
- Overview toggle renamed "Leave events out of regular spending".
- **Accept:** existing trips unchanged in totals; the solar install and TCM loan appear as
  coloured events; contrast checked in both themes.

## Phase 10 — Home (this month) and budgets
- Budgets replace targets (start-from options, regulars shown as committed, roll-over).
- Home: Safe to spend, pace bar, budget bars, Coming up (14 days), Heads up.
- **Accept:** fixed-date tests for safe-to-spend and pace; Home fits one phone screen down to
  Budgets.

## Phase 11 — Plans, forecast and timeline
- Plans replace goals (migration keeps set-asides), recurring plans, matching to actuals.
- Offset forecast with buffer and lowest point.
- Timeline: 12 months back to 12 ahead, filters, planned styling, year summary.
- **Accept:** forecast tests pass; a planned trip that happens can be matched and turns solid.

## Phase 12 — Signals, scorecard and the monthly review (see docs/RHYTHM-AND-REVIEW.md)
- Signals engine (`src/lib/signals.ts`) with a fixture per rule; last-month scorecard with
  budget / 3-month / same-month-last-year comparisons; "Expected" dismissals.
- Sinking funds for lumpy regulars; plan trade-offs ("What would fund this sooner?").
- Supabase Edge Function `monthly-review` + `pg_cron` schedule; `reviews`, `decisions`,
  `signals` tables; Review screen with Apply buttons; Home card.
- **You:** add `ANTHROPIC_API_KEY` as an Edge Function secret (`npx supabase secrets set`).
  Never in `.env.local` with a `VITE_` prefix, never in Vercel.
- **Accept:** packet contains no raw lines and no real names of people; a malformed reply falls
  back to the signals view; "Review now" produces a review for the real data that the two of
  you find accurate (this one is judged by you, not a test).

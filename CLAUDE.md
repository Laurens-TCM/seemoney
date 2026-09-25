# CLAUDE.md

## What this is
**See The Money** — a private household finance app for two people (Loz and his wife) in Darwin. They bank with ANZ
(offset account, variable home loan, Visa card paid off automatically, a saver and an everyday
account) and export transactions from Frollo as CSV. The app turns those exports into a clear
picture of spending, separates trips (mostly Melbourne visits to friends and family) from regular
living costs, and plans goals. Cash always stays in the offset; goals only earmark part of it.

A working single-file prototype exists at `reference/prototype.html`. Treat it as the behavioural
reference for screens, trips and the planner. For classification numbers, `reference/process.js`
and docs/DATA-RULES.md are newer and win; the prototype's embedded classifier is out of date.

## Non-negotiables
- **Privacy.** Real exports live in `data/` (git-ignored). Never commit, log, paste into tests, or
  send real transaction data anywhere except the household's own Supabase project. CSVs are
  parsed in the browser; the server receives only classified lines. **Not yet decided (v2 Phase
  12):** whether a monthly summary (aggregates, merchant names, people as "Person A/B") may be sent
  to Anthropic for the AI review. Until the household says yes in so many words, nothing leaves
  Supabase.
- **Two users, one household.** No public sign-up. Row-level security on every table.
- **Numbers are sacred.** Classification lives in one pure, fully tested module
  (`src/lib/classify.ts`). UI code never re-implements a rule.
- **Match the reference.** `fixtures/expected-summary.json` must be reproduced exactly by the
  classifier for `fixtures/sample-frollo.csv`. Where docs/DATA-RULES.md differs from
  `reference/process.js`, the doc wins. Real expected figures live only in
  `data/expected-real.json` (git-ignored) and are read at test time.
- **Secrets.** Only `VITE_` variables reach the browser or Vercel. The service-role key and
  Supabase CLI token stay in `.env.local` and are never used in app code, CI or Vercel.
- **Personal patterns are config, not code.** Names like the loan-repayment payee and the business
  name live in `src/config/household-rules.ts`, so rules can later move to the database.

## Stack
Node 22, Vite + React + TypeScript, React Router, TanStack Query, Supabase (Auth, Postgres, Realtime),
PapaParse, vite-plugin-pwa, Vitest. Plain CSS with custom properties (design tokens in
docs/SPEC.md). No component library needed; keep dependencies few.

## Conventions
- Money is stored as numeric(12,2) in the database and handled as integer cents in TypeScript.
- Dates are ISO `YYYY-MM-DD` strings in the household's local time (Australia/Darwin).
- Averages per month = total ÷ (days in range ÷ 30.4375).
- Australian English in the UI, sentence case, plain words ("Leave trips out of regular spending").
- Mobile first (≈380px), works on desktop, light and dark themes, visible focus, reduced motion.

## Commands (create these)
- `npm run dev` — local app
- `npm test` — Vitest (classifier, trip allocation, planner maths)
- `npm run build` — production build
- `npm run db:push` — apply pending `supabase/migrations` (Management API via `scripts/supabase.mjs`; needs `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN`)
- `npm run db:status` — list applied and pending migrations
- `npm run db:types` — regenerate `src/lib/database.types.ts`

## Tooling
The user works in VS Code, keeps code in a private GitHub repo, and deploys with Vercel
(connected to GitHub). One branch per build phase, merged to `main` when checks pass; CI must be
green. Never put real data or `.env*` files in commits, issues, or PR descriptions.

## Working style
Small commits per task. Before changing classification behaviour, add a failing test. When a
phase needs something only the user can do (create accounts, paste keys, invite his wife), stop
and give numbered instructions.

# See The Money — build package for Claude Code

A private app for Loz and his wife to see where the household money goes, pull
trips out of regular spending, set goals, and plan what spending needs to look
like — while all cash stays in the ANZ offset.

This package is a brief for Claude Code. It contains:

| Path | What it is |
|---|---|
| `PROMPT.md` | The first message to paste into Claude Code |
| `CLAUDE.md` | Standing instructions Claude Code reads every session |
| `docs/SPEC.md` | What the app does, screen by screen |
| `docs/DATA-RULES.md` | Exactly how a Frollo export is classified |
| `docs/ARCHITECTURE.md` | Stack, data model, security, hosting |
| `docs/BUILD-PLAN.md` | Phased tasks with acceptance checks |
| `supabase/migrations/0001_init.sql` | Database tables and row-level security |
| `supabase/seed-household.sql` | Creates your household and adds you both |
| `.env.example` | Names of the keys you'll fill in locally |
| `data/` | Private, git-ignored: your CSVs and `expected-real.json` |
| `reference/process.js` | Working classification logic from the prototype |
| `reference/prototype.html` | The working single-page prototype (open in a browser) |
| `fixtures/sample-frollo.csv` | Made-up export that exercises every rule |
| `fixtures/expected-summary.json` | What processing that sample must produce |
| `.github/workflows/test.yml` | Runs tests and build on every push |

## How to use it

1. Unzip, open the folder in VS Code, and start Claude Code (the VS Code extension or `claude` in
   the VS Code terminal).
2. Put your real Frollo export in `data/` next to `expected-real.json`. The folder is git-ignored and never leaves your machine.
3. Paste the contents of `PROMPT.md` as your first message.
4. Claude Code works through `docs/BUILD-PLAN.md` phase by phase and stops for you at the checkpoints marked **You**.

You'll need GitHub (private repo), Vercel (hosting, auto-deploys from GitHub), a free Supabase project (database + login) and Node 22 or later.

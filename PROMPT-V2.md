Read docs/V2-SPEC.md, docs/RHYTHM-AND-REVIEW.md and the new v2 phases (8–11) at the end of docs/BUILD-PLAN.md, plus
reference/recurring.js and the new fixtures (fixtures/recurring-lines.json,
fixtures/expected-recurring.json). data/expected-real.json now also has a "recurring" section.

We're extending See The Money with three horizons: this month (Now), the last year (Back) and
what's coming (Ahead), plus regular-payment detection, budgets, plans and colour-coded events.

First, compare V2-SPEC.md with what's already built and list anything that conflicts or needs a
decision before starting. supabase/migrations/0005_v2.sql is a draft: check it against the live
schema and fix it before applying. Then work through Phases 8–12 in order, same rules as before:
tell me the plan for each phase, stop at "You" steps, and don't move on until its checks pass.

# See The Money v2 — Back, Now, Ahead

v1 answers "where did the money go over the last year?". v2 makes the app useful every week by
adding the other two time horizons:

| Horizon | Question it answers | Where |
|---|---|---|
| **Now** | How are we going this month? What's still to come? | Home (new default screen) |
| **Back** | What happened over the last year, and what were the big things? | Overview + Timeline |
| **Ahead** | What's coming, can we afford it, and what does the offset look like? | Timeline + Plan |

Navigation becomes: **Home · Timeline · Regulars · Plan · More** (More holds Overview, Trips list
and Data). On desktop, a side nav with the same items.

---

## 1. Event types and colour coding

Everything that isn't day-to-day spending is an **event**, past or planned. Each type has one
colour used everywhere: timeline chips, chart layers, list dots, badges.

| Type | Examples | Light | Dark |
|---|---|---|---|
| Trip | Melbourne visits, holidays | #A86A12 | #BF8726 |
| Big purchase | Solar, car, furniture, school fees in a lump | #824097 | #A06AF1 |
| Loan | Loan to TCM, repayments back, extra home-loan payments | #2997EA | #056EB8 |
| Income event | Tax refund, bonus, a big TCM payment | #0E8570 | #27A88C |
| Bill spike | Annual rego, yearly insurance, a big quarterly bill | #DC57AA | #BA3782 |

Colours as built (Phase 9). The first draft's set failed the colour check: loan and income were
too close even for full colour vision, loan and big purchase collapsed for red-green colour
blindness, and the bill brown read as grey. These pass the dataviz validator against the surface
in both themes: 3:1 contrast, and colour-blind and normal-vision separation for every pair of event
types and for the chart stack (regular spending, trips, big purchases, bill spikes). Trip and
income reuse the v1 chart colours. One pair can't clear the normal-vision floor in dark mode: loan
against regular-spending blue (never shown side by side; loans aren't spending). Chips are ink
text on a tint with the colour in the outline and icon, so text contrast never depends on the
event colour.

Rules:
- **Happened** = solid fill. **Planned** = same colour, dashed outline and light diagonal hatch.
  Colour is never the only signal: every chip also has a type icon and text.
- Regular spending stays the neutral spending blue; income markers stay green.
- Tokens go in the CSS `:root` alongside the v1 tokens (`--ev-trip`, `--ev-big`, `--ev-loan`,
  `--ev-income`, `--ev-bill`), with dark-mode values. Check 3:1 contrast against the surface.

### Where events come from
- **Trips** (v1) become events of type Trip. Same allocation and overrides as today.
- **Automatic events** are worked out from lines each time, never stored as rows (so re-imports
  can't duplicate them): `capital` lines → Big purchase; `business_loan` and
  `business_loan_repaid` → Loan; loan-account payments that aren't part of the weekly repayment
  series (an extra $1,000) → Loan; income lines ≥ $2,000 that aren't regular pay → Income event.
  As built: "not regular pay" means a tax refund, or more than 1.5× the median payment from the
  same income source (pay changed employer and amount during the year, so a detected series
  missed ordinary pay days). Business-loan lines within 7 days of each other are one event.
  Only trips, labelled big purchases and planned items are stored.
- **Suggested big purchases**: any single spending line ≥ $1,000 (configurable) that isn't
  recurring and isn't in a trip gets a "Label this?" prompt: name it, pick a type, or dismiss.
- **Planned events** from the Plan screen (section 4).
- Event spending comes out of "regular spending" when the Overview toggle (renamed **Leave
  events out of regular spending**) is on, exactly like trips in v1. Capital and loan lines are
  never regular spending anyway, so the toggle changes trips and labelled big purchases.

---

## 2. Home — this month (Now)

Top to bottom, one screen on a phone where possible:

1. **Safe to spend** — the headline number for the rest of this month:
   expected income this month − regulars still due − plan set-asides − spent so far on regular
   spending. Under it: "$X a day for the next N days". Red if negative, with the reason
   ("Regulars still due: $1,240").
2. **Pace bar** — month progress vs budget progress: spent $A of $B budget, and a marker for
   where you'd be at an even pace today. Label: "On pace", "$320 ahead of pace" or
   "$410 under pace".
3. **Budgets** — each group with a target: a thin bar of spent vs target, pace tick, and
   "left" amount. Tap for this month's lines in that group. Over-budget groups first.
4. **Coming up** — the next 14 days: regular payments due (from Regulars), planned events, and
   goal set-asides, each with its colour dot and date. "Still to come this month: $X".
5. **This month's events** — any trip or big purchase dated this month, colour chips.
6. **Heads up** — at most three notices, newest first: new regular detected, price rise,
   a regular that didn't appear when expected, a missing-data gap, an unlabelled big purchase.

Month figures use the calendar month to date in Australia/Darwin. Expected income = the regular
income series due this month (the same detector run over pay lines), falling back to the 3-month
average if none are detected.

---

## 3. Regulars — subscriptions and repeat payments

### Detection
Reference: `reference/recurring.js` (`detectRecurring(lines, dataEnd)`). Port to
`src/lib/recurring.ts` and match `fixtures/expected-recurring.json` for
`fixtures/recurring-lines.json`.

1. Group spending lines by merchant key (display name upper-cased, digits and place/company
   noise removed, first three words).
2. Within a merchant, cluster by amount (within 15% or $3), so one merchant can hold two
   series.
3. A cluster is a series if the median gap matches a cadence — weekly 7±2 days (4+ hits),
   fortnightly 14±3 (3+), monthly 30.4±4 (3+), quarterly 91±10 (3+), yearly 365±20 (2+) — and at
   least 60% of gaps fit it.
4. Spending you choose each time (Eating out, Groceries, Shopping, Car & transport, Pets,
   Fun & hobbies) only counts if the amount is near-identical (within 5%, 4+ hits, or a yearly
   pair), or there are 8+ hits with 75% within 15% of the typical amount (e.g. a meal-kit box).
5. Same merchant and cadence where one cluster ends before the next starts = one series with a
   **price change** (e.g. a streaming price rise).
6. Typical amount = median of the last three. Active if the last payment is within one cadence
   plus twice the tolerance of the data's end. Next due = last + cadence.
7. Home-loan interest is shown separately as the loan's cost, not as a subscription. (Detection
   still returns it, so the counts match the reference; the screen lists it as "Loan interest"
   and leaves it out of "Regulars cost $X a month".)
8. **Price steps over 15%** (decided in v2 review): after step 5, a short run at a new price (fewer
   hits than a series needs) that continues the same merchant and cadence, starts after the series'
   last payment, and is within 50% of the old typical amount joins that series as a price change.
   Typical amount is then the median of the new-price run. Without this, Allianz ($310.98 →
   $367.98) and Fernwood ($167.90 → $207.90) showed as stopped while still being paid. This is the
   one intended difference from `reference/recurring.js`; the fixture still matches, and the
   real-data counts in `data/expected-real.json` are the ones with this rule.
9. **Identity of a series**: a household's choice (Keep / Review / Cancel / Not a regular) is saved
   with the series' transaction IDs and matched to a detected series by any shared ID, falling
   back to merchant key + cadence. One merchant can hold two series (two TeamPay amounts), and a
   price change or the window moving on doesn't lose the choice.

Real-data check (local, from `data/expected-real.json`): the detector must reproduce the
`recurring` counts stored there.

### Screen
- Header: "Regulars cost **$X a month**" ($Y a year), split into Subscriptions, Bills &
  insurance, Kids & school, People, Other.
- Each regular: name, cadence, typical amount, per month, next due, last paid; badges for
  **Price up $2** and **New**; the group colour dot.
- A status the two of you set together: **Keep**, **Review**, **Cancel**. "Cancel" items show
  "Save $X a year" and stay listed until they stop appearing; then they move to **Stopped**
  with "Saving $X a year since <month>".
- **Stopped** list: series that ended in the window (useful for "did that really cancel?").
- **Add a regular** manually for things detection can't see yet (a new annual bill): name,
  amount, cadence, next due, group.
- "Not a regular" removes a false match and remembers it.
- A small month calendar showing which days regulars come out.

---

## 4. Plan — budgets and future plans (Ahead)

### Budgets
v1 monthly targets become **budgets**: one amount per group per month, with the same Trim ticks
and "share the cut" tool. New:
- **Start from**: last 12 months' average, last 3 months', or last month's actual.
- **Regulars are committed**: each group shows how much of its budget is already taken by
  regulars ("$650 of $1,100 is HelloFresh").
- **Roll-over** (off by default): unspent budget in a group carries into next month.

### Plans (replaces Goals)
A **plan** is a future event with money attached. Fields: name, type (colour), date or date
range, amount, how it's paid (**Save up first** / **Pay from the offset** / **Covered by
income that month**), set aside so far, notes. Examples: Melbourne at Christmas, Europe 2027,
school fees 2028, next car service, repaying the TCM loan (type Loan, money in).
- "Save up first" plans get a monthly set-aside (as v1 goals) and a progress bar.
- A plan can be recurring ("Melbourne trip, every 3 months, about $2,500").
- When the date passes, the plan asks to be **matched** to what happened: pick the trip/event,
  see planned vs actual, then it's marked done and turns solid on the timeline.
- "Save for the next 12 months of trips" (v1) creates a recurring trip plan instead of a goal.

### Offset forecast
A line chart of the offset balance for the next 12 months, starting from the entered balance:
+ expected income − budgets − regulars − plans paid from the offset or income, on their dates.
Plan and event markers sit on the line in their colours. Show the lowest point and its month
("Lowest: $18,400 in Feb 2027, after Europe flights"). A **buffer** setting (default $10,000)
turns the line red below it. Earmarked set-asides are shown as a shaded band under the line.

---

## 5. Timeline (Back and Ahead together)

One scrolling view from 12 months back to 12 months ahead, with a "Today" marker.
- **Mobile**: a vertical list of months (newest past month at the top of "Back", then Today,
  then "Ahead"). Each month row: income vs spending mini-bar (planned months use budget
  figures, lighter), then colour chips for that month's events and plans with amount.
- **Desktop**: horizontal months with stacked bars (regular spending + one layer per event
  type) and chips underneath.
- Filter chips by type (all on by default). Tap a chip for its detail: lines (past) or plan
  (future), with edit.
- Year summary at the top: "Last 12 months: 9 trips $X, big purchases $Y, lent to TCM $Z.
  Next 12 months: planned $A."

---

## 6. Data model changes (one migration per phase)
Reviewed against the live schema; the draft `0005_v2.sql` is split and fixed as
`0005_regulars.sql` (Phase 8), `0006_events.sql` (Phase 9) and `0007_plans_budgets.sql`
(Phases 10–11). Fixes over the draft: compatibility views are `security_invoker` (a plain view
bypasses row-level security) and include `trip_overrides` with a `trip_id` column so the deployed
app keeps working until it updates; `place`/`kind` lose their trip defaults for non-trip events;
the trips goal becomes a recurring trip plan and other goals keep their type; every step is safe to
re-run; `regulars` stores `tx_ids` instead of a unique merchant key; `dismissed_events` syncs live.
Phase 12 tables (`reviews`, `decisions`, `signals`) come in their own migration.
- Rename `trips` → `events` and `trip_overrides` → `event_overrides`; add
  `type text not null default 'trip' check (type in ('trip','big','loan','income','bill'))`;
  `place` becomes nullable (trips only). Keep a `trips` view for old code during the change.
- `plans`: id, household_id, name, type, start_date, end_date, amount, direction ('out'|'in'),
  funding ('save'|'offset'|'income'), saved, repeat_every_months (null = once), status
  ('planned'|'done'|'skipped'), matched_event_id (composite FK), notes, sort. Migrate each
  `goals` row into a 'save' plan dated its target month, then drop `goals`.
- `budgets`: replaces `targets` (household_id, grp, monthly_amount, trimmable, rollover).
- `regulars`: household_id, series_key, status ('keep'|'review'|'cancel'|'not_regular'),
  manual fields for hand-added regulars (name, amount, cadence, next_due, grp), note.
- `dismissed_events`: suggested big purchases the household dismissed (by tx_id).
- `settings`: add `offset_buffer numeric(12,2) default 10000`, `big_purchase_threshold
  numeric(12,2) default 1000`.
- Realtime on `events`, `event_overrides`, `plans`, `budgets`, `regulars`.

## 7. Tests to add
- Recurring: the fixture (price rise merged, weekly box with varying price counted,
  a restaurant with varying amounts *not* counted, annual rego pair counted, stopped gym marked
  stopped); real-data counts.
- Safe to spend and pace: fixed-date tests (e.g. 10th of a 30-day month).
- Offset forecast: plans on dates, recurring plans, buffer crossing, lowest point.
- Plan matching: planned vs actual, status change.
- Migration: goals become plans with the same monthly set-aside.

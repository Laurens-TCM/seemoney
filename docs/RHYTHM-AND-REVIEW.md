# Making it useful: the rhythm, the signals, and the AI review

The app is only useful if it fits into a rhythm the two of you actually keep. Everything below
is designed around three touchpoints:

| Rhythm | Time | Screen | Purpose |
|---|---|---|---|
| **Weekly glance** (Sunday) | 2 min | Home | Are we on pace? What's coming this week? |
| **Monthly review** (1st–3rd) | 15 min, together | Review | Close last month, read the AI review, decide 1–3 things |
| **Quarterly plan** | 30 min | Plan + Timeline | Add/adjust plans, re-set budgets for the season |

Every number in the app should answer "so what do we do?" — not just report.

---

## 1. Monthly tracking that's fair

A month is only comparable when you allow for how far through it you are and what's fixed.

**Three layers of a month**
1. **Committed** — regulars due this month (known amounts and dates).
2. **Planned** — set-asides and plans falling this month.
3. **Flexible** — everything else, judged against budget *by pace*.

**Home (current month) shows**
- **Projected month-end**: spent so far + regulars still due + (flexible daily rate × days left).
  Compared with budget: "Heading for $19,400 vs $18,000 budget" is more useful than "spent $9,000".
- **Pace** per flexible group: spent vs the even-pace line for today. Groups are sorted by
  projected overspend in dollars, not percent, so a $300 grocery drift ranks above a 200%
  overrun on a $20 line.
- **Safe to spend** for the rest of the month (income expected − regulars still due − set-asides
  − flexible spent so far), and per day.

**Last month (closes on the 1st) shows a scorecard**
- Budget vs actual per group, with three comparisons side by side: **budget**, **3-month
  average**, and **same month last year** (Christmas, school terms and wet-season power bills
  make year-on-year the fairest check).
- One sentence per group that moved more than $100 and 15%, naming the merchants behind it.
- The scorecard is frozen once reviewed, so later re-imports don't rewrite history.

**Weekly view** (small, on Home): this week vs your average week, flexible spending only.

---

## 2. Future planning that changes today's numbers

Plans must show their cost *per month from now*, or they stay abstract.

- Adding a plan immediately shows: "Europe 2027, $18,000 by June: **$1,636 a month** from now.
  Safe to spend drops from $2,900 to $1,264." The user can then push the date, lower the
  amount, or accept.
- **Lumpy bills become sinking funds**: annual rego, yearly insurance and quarterly bills detected
  in Regulars are spread into a monthly set-aside automatically, so the month they land isn't a
  shock. Shown as "Bills fund: $410 a month covers rego, insurance, pool".
- **Offset forecast** is the truth-teller: balance line for 12 months with every plan and
  regular on it. Its two outputs matter most: the **lowest point** and its date, and whether the
  line crosses the **buffer**. A plan that pushes the low point under the buffer gets a warning
  at the moment you add it.
- **Trade-offs**: on any plan, "What would fund this sooner?" lists the three largest flexible
  groups and Review/Cancel regulars with the months saved by each ("Cancel Fernwood: 1.2 months
  sooner"). Same for "What happens if we skip this?"
- **Seasonal budgets**: a budget can have a December variant and a school-holiday variant (a
  month override), because a flat monthly budget fails in the months that matter most.

---

## 3. Finding cost sinks and changes

Detected on every import and surfaced in the review. Each signal has a dollar impact so they
can be ranked; show the top five, not all of them.

| Signal | Rule | Example wording |
|---|---|---|
| **Category drift** | 3-month avg vs 12-month avg: > 15% and > $100/month | "Eating out is running $280 a month above your year average" |
| **Merchant creep** | Merchant's 3-month total vs prior 9 months' monthly rate, > $80/month | "Uber Eats is up from $60 to $210 a month" |
| **Price rises** | Regulars: typical amount up > 5% and > $1 | "Pet insurance is $34 more each fortnight ($890 a year)" |
| **New regulars** | First seen in the last 90 days | "New: Chalkie Pro, $15.51 a month" |
| **Frequency creep** | Same merchant, count per month up > 50% | "Coffee: 22 visits this month vs 14 average" |
| **Small leaks** | < $25, 15+ times a month, one group | "Takeaway & snacks: 31 purchases, $410" |
| **Fees and interest** | Any Service Charges/Fees, cash-advance interest, card interest | "$18.40 in card interest this year — the card wasn't fully paid on 4 May" |
| **Loan cost drift** | Home-loan interest 3-month avg vs first 3 months | "Loan interest is up $730 a month since October as the offset fell" |
| **Duplicates** | Same merchant, same amount, same day | "Two identical TCM pays on 28 Sep — check one wasn't a double" |
| **Wins** | The reverse of the above: a category down > 15%, a regular stopped, interest down | "Groceries down $210 a month for three months running" |

Each signal can be **actioned** in place: set a budget, mark a regular Review/Cancel, label an
event, or dismiss with "Expected" (e.g. Christmas) so it isn't raised again for that reason.

---

## 4. The cyclical AI review

### What it is
On the 1st of each month (and on demand), the app builds a compact, structured summary of the
household's month and asks Claude to write a short review. It appears on Home as a draft until
one of you opens it, then becomes the agenda for the monthly review.

### How it runs
- A Supabase **Edge Function** (`monthly-review`) scheduled by `pg_cron` at 06:00 Darwin time
  on the 1st. Also callable from a "Review now" button and after any import that adds a new
  month.
- The function reads the household's data, builds the **review packet** (below), calls the
  Claude API (`ANTHROPIC_API_KEY` stored as an Edge Function secret, never in the app), validates
  the JSON reply, and stores it in a `reviews` table. The app shows it; nothing is sent from the
  browser.
- Cost: one call a month of a few thousand tokens — cents.

### The review packet (what Claude sees)
Aggregates only, never raw lines:
- Month totals and last-3-month averages: income, regular spending, events, per group; same
  month last year.
- Budgets and pace outcome per group.
- Regulars: active count and monthly total; changes (new, price rises, stopped).
- The top ten **signals** from section 3, with their dollar impact.
- Plans: each plan's progress, set-aside due, forecast low point and buffer status.
- Events this month (trips, big purchases, loans) with totals.
- Previous review's decisions and whether the numbers say they held ("Decided: groceries
  budget $2,200 → actual $2,340").
- Merchant names are included (they're businesses); **payments to people are replaced by
  "Person A/B/C"**; no account numbers, balances beyond the offset figure, or IDs.

### The prompt (fixed, versioned)
System: you are reviewing a family's month for two adults who read this together on their
phones. Be specific, use their numbers, and never moralise. Output JSON only.

Ask for, in this order:
1. `headline` — one sentence on how the month went, with the single most important number.
2. `wins` — up to 3, each `{title, detail, amount}`.
3. `watch` — up to 3 changes or sinks, each `{title, detail, amount, suggested_action}` where
   the action is one the app can apply: set a budget, review a regular, label an event, add a
   set-aside, adjust a plan.
4. `plans` — one line on whether plans are on track and the forecast low point.
5. `questions` — up to 3 questions for the two of you to talk through (not advice).
6. `next_month` — 2–3 concrete, small commitments (each with a number).

Rules in the prompt: no more than 250 words total; prefer dollar amounts to percentages; if a
number was already up last month, say "for the second month"; never suggest cutting Kids &
school, Health or Pets without a caveat; refer to the previous review's decisions.

### How it shows up
- Home card: "September review is ready" with the headline.
- Review screen: the six sections as cards; each suggested action has an **Apply** button that
  performs it in the app (creating a budget, marking a regular, etc.) and records the decision.
- **Decisions** table: what was agreed, by whom, when — the next review reports on them.
- **Discussed** tick: both of you can mark it read; reviews stay in a history list.
- If the reply fails validation, the app shows the signals list (section 3) instead — the review
  is a layer on top of computed facts, never the only source.

### Optional: ask a question
A single-turn "Ask about this month" box that sends the same packet plus the question. No
memory beyond the packet; answers are labelled as estimates. Off by default.

### Data model
- `reviews`: id, household_id, period (month), packet jsonb, result jsonb, model, prompt_version,
  created_at, read_by uuid[].
- `decisions`: id, household_id, review_id, text, action jsonb, decided_by, decided_at,
  outcome text (filled by the next review).
- `signals`: computed on import, stored for ranking and dismissal: household_id, key, type,
  amount, period, dismissed_reason.

### Tests
- Packet builder: given a fixture month, produces the expected packet (no raw lines, people
  anonymised).
- Signals: each rule has a fixture that triggers it and one that doesn't.
- Review validation: malformed JSON falls back to the signals view.

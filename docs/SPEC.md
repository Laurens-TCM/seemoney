# See The Money — product spec

The app name appears as "See The Money" in the header, browser tab, sign-in screen and home-screen icon.

Two people, one household, one shared view. Everything either person changes (trips, goals,
targets, offset balance) is seen by the other straight away.

## Screens
Bottom tab bar on mobile, side nav on desktop: **Overview · Trips · Plan · Data**.

### Overview
- Window picker: 12 months (default), 6 months, 3 months. Every average uses the window defined
  in DATA-RULES. If the window has missing data, a one-line notice names the gap.
- Headline sentence: "Over the last 12 months you spent $X a month on regular living and earned $Y."
  Follow-up line: trips per month on top; gap to pay income; extra loan principal.
- Toggle **Leave trips out of regular spending**. It's saved per person, so each of you can view
  it your own way. Until someone sets it, it's on whenever at least one trip exists.
- **Month by month** chart: stacked bar per month (regular spending + trips in a second colour),
  income as a marker. First/last part-months faded. Tap a month for its detail.
- **Where it goes**: groups sorted by monthly average with bars; tap to expand categories (per
  month) and biggest payees (year).
- **Not counted as spending**: loan principal, capital items, and Loan to TCM shown as
  *Lent*, *Repaid* and *Still owed*. Incoming TCM lines flagged "Check: pay or loan repayment?"
  have a one-tap **Mark as loan repayment** (and undo).

### Trips
A trip is an expense project: name, from/to dates, type (Friends & family / Holiday / Work),
where (Melbourne & Victoria / Overseas / Somewhere else).
- **Suggestions**: clusters of Victoria-tagged lines in trip-like groups (Eating out, Groceries,
  Travel, Car & transport, Shopping, Fun & hobbies), gap ≤ 3 days, at least 2 days and 3 lines or
  6+ lines, not overlapping an existing trip or a dismissed range. Actions: Add trip
  (dates padded one day each side) / Not a trip. "Not a trip" stores the cluster's date range;
  any later cluster overlapping a dismissed range stays hidden, even if new data shifts its dates.
- **Auto-ticked lines**: during the trip dates AND (category Travel/Holidays, OR in a trip-like
  group with matching loc — `vic` for Melbourne, `fx` for Overseas). Bills, health, pets, kids
  and payments to people are never auto-ticked.
- **Candidate lines**: everything during the trip, plus Flights and Accommodation in the 120 days
  before start (shown unticked under "Booked in the 4 months before").
- Manual tick/untick is stored as an override and always wins. A line belongs to one trip at most
  (manual includes first, then automatic matches in trip-start order).
- Each trip shows total and bucket breakdown; the Trips header shows the year's total, monthly
  average and buckets, with **Save for the next 12 months of trips** (creates a goal).
- Filter by type; Work trips can be flagged "Recharge to TCM" (listed for the accountant).

### Plan
- **Goals**: name, amount, needed by (month), set aside so far → monthly saving needed
  = (amount − set aside) ÷ months left (inclusive of target month). Progress bar.
- **The offset**: balance + as-at date → earmarked for goals and free buffer.
- **What spending needs to look like**: Income − extra loan principal − goal savings = left to
  spend. Verdict: cut needed (or room to spare). If trips are hidden and no trip goal exists, say so.
- **Monthly targets** per group: average, editable target, "Trim" tick. Groups without a saved
  tick use `trimDefaults` from config (Eating out & drinks, Travel & holidays, Shopping,
  Fun & hobbies). Share the cut across ticked groups proportionally (rounded to $10); reset to
  averages.
- **This month so far** (new): actual vs target per group for the current calendar month.

### Data
Upload a Frollo CSV (parsed on the device), preview totals, rows skipped (with reasons, e.g.
"9 pending card payments, they'll come through in your next export") and any lines to check
("Check: pay or loan repayment?", "Check category"), then confirm to import. Show import history (who, when,
date range) and any missing-data gaps. Explain the built-in fixes in one short paragraph.

## Design tokens (from the prototype)
Light: bg #EEF2F1, surface #FFFFFF, ink #16242B, muted #5E6E75, line #D3DCDA, income #1F7A6B,
spending #3E5C8A, goals/trips #A86A12, warning #B42318, soft #E3EAE8.
Dark: bg #0F1719, surface #172226, ink #E6EEEC, muted #93A3A7, line #2A393D, income #4FB3A0,
spending #86A6D6, goals/trips #E0A84A, warning #F07167, soft #1E2B2F.
Font: Figtree (400/500/600/800), tabular numbers. Rounded 14px panels, one hairline border.

## Out of scope for v1
Direct bank connections, multiple households, budgeting notifications, investment tracking.

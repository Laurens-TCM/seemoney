# Data rules

`src/lib/classify.ts` is the single source of truth. It starts as a port of
`reference/process.js`; where this document and the reference differ, **this document wins**.
Personal patterns come from `src/config/household-rules.ts`:

```ts
loanRepaymentPayee: /PAYMENT\s+TO GOUD LAURENS/     // offset → home loan transfers
businessName:       /TRADE CREATIVE/                 // Trade Creative Media Pty Ltd (TCM)
businessLoanLabel:  'Loan to TCM (LandCruiser)'
capitalItems:       [{ pattern: /ONEROOF SOLAR/, label: 'Solar install (OneRoof)' }]
remaps:             [{ pattern: /WAGAMAN OSHC/, category: 'Child/Dependent Expenses' },
                     { pattern: /ASU UNION/,    category: 'Memberships & union' }]
trimDefaults:       ['Eating out & drinks', 'Travel & holidays', 'Shopping', 'Fun & hobbies']
cardAccount:        /VISA|MASTERCARD|CREDIT CARD/    // matched against account_name (upper case)
vicPlaces:          [...]                            // full list in reference/process.js (VIC_PLACES)
notAPlace:          [/\bVIC\s+PTY\b/, /^SP /, /PLAYHQ/, /TICKETMASTER/, ...]  // see Per-line tags
```

## Input
Frollo transactions CSV. Required columns: `transaction_id, description, amount,
transaction_date, account_name, category_name, merchant_name, included`. Missing columns →
reject the file and name them. Amounts are signed (money out is negative).

**Dates.** Current Frollo exports use plain `YYYY-MM-DD` (checked against the real export: every
row). Use them as-is. If a value ever contains a time, convert it to Australia/Darwin before
taking the date, and add a test for that case.

**Rows skipped (counted by reason, never stored):** no `transaction_id`, no date, a non-numeric
amount, or **pending**. Never invent an ID; two identical purchases on one day are both real.

**Pending rows.** A card authorisation that hasn't posted yet has an empty `posted_date` (the
real export had 9, all "POS AUTHORISATION …" in the last three days). When it posts, the bank
issues it again with a new ID and description, so storing it would count it twice. Skip it with
reason `pending`; the next export brings the posted version. If an export has no `posted_date`
column at all, nothing is treated as pending.

## Kinds (first match wins)

| # | Condition | Kind | Effect |
|---|---|---|---|
| 1 | `included` is false, or description starts "Increase account balance" | `excluded` | nothing |
| 2 | Home-loan account (name matches /loan/ and not /offset/), amount > 0 | `loan_in` | adds to loan repayments |
| 3 | Home-loan account, amount < 0 | `spend` | category **Mortgage interest** |
| 4 | Amount < 0 and matches `loanRepaymentPayee` | `internal` | nothing (the offset side of #2) |
| 5 | Category Credit Card Payments, amount > 0, **not** a card account (`cardAccount`) | `other_in` | shown separately (Frollo mislabel) |
| 6 | Category Credit Card Payments, amount < 0, on a card account | `spend` | category Uncategorised, flagged **Check category** (Frollo mislabel) |
| 7 | Category Credit Card Payments, Transfer Between Accounts, Savings or Mortgage | `internal` | nothing |
| 8 | Matches `businessName`, amount < 0 | `business_loan` | money lent to TCM |
| 9 | Line has a manual tag `business_loan_repaid` (see below) | `business_loan_repaid` | reduces what TCM owes; not income |
| 10 | Matches a `capitalItems` pattern, amount < 0 | `capital` | listed separately |
| 11 | Matches a `capitalItems` pattern, amount > 0 | `other_in` | labelled "Refund: <label>" |
| 12 | Amount > 0 and matches `businessName` | `income` | source **TCM pay** |
| 13 | Amount > 0 in Salary/Regular Income, Government Benefits, Interest Income, Taxes | `income` | Salary / Government / Interest / Tax refund |
| 14 | Amount > 0 in Transfer In, Refunds/Adjustments, Uncategorised | `other_in` | shown separately, not income |
| 15 | Amount > 0 in any other category | `spend` (refund) | nets against its category |
| 16 | Everything else | `spend` | its category after remaps |

A real card repayment is money **in** to the card or **out** of another account (#7). Rules 5–6
catch the other two combinations, which in the real export were a friend's transfer to the saver
and a clinic charge on the Visa. A manual override can recategorise a #6 line.

Only `loan_in` lines make up **loan repayments**. Loan principal = Σ `loan_in` − Σ Mortgage
interest. No two kinds cancel each other out, so any kind can be totalled straight from `lines`.

Remaps for `spend`: config `remaps`; Frollo "Transfer Out" → Payments to people;
"Other Expenses" → Other.

### Money back from TCM
Money in from TCM is pay by default (#12). A repayment of the LandCruiser loan is recognised
only by a **manual tag**: on any incoming TCM line, "Mark as loan repayment" stores a
`line_overrides` row (`kind = business_loan_repaid`). To make these easy to spot, the import
preview and the Data screen flag incoming TCM lines as **Check: pay or loan repayment?** when
the amount is at least 2× the median TCM pay in the window, or is a whole multiple of $1,000.
"Not counted as spending" shows *Lent to TCM*, *Repaid* and *Still owed*.

`line_overrides` can also change a line's category (a general "recategorise" for mistakes).
Overrides are keyed by `transaction_id` and survive re-imports.

## Groups
| Group | Categories |
|---|---|
| Home & bills | Mortgage interest, Utilities, Insurance, Home Renovation & Maintenance, Furniture & Homeware, Cable/Satellite/Telecom |
| Groceries | Groceries |
| Eating out & drinks | Restaurants, Takeaway & Snacks, Cafes & Coffee, Bars & Pubs, Alcohol |
| Travel & holidays | Travel/Holidays |
| Car & transport | Automotive, Petrol, Taxi & Rideshare, Public Transport |
| Health & fitness | Healthcare/Medical, Gyms & Fitness, Beauty & Well-being |
| Kids & school | Child/Dependent Expenses, Education |
| Pets | Pets/Pet Care |
| Shopping | Clothing/Shoes, General Merchandise, Electronics, Gifts |
| Fun & hobbies | Entertainment/Recreation, Hobbies, Subscriptions/Renewals, Gambling & Lotteries |
| Payments to people | Payments to people |
| Other | Memberships & union, Other, Uncategorised, and any category not listed above |

## Per-line tags (for trips)
- **bucket**: Flights (airline names, not "INFLIGHT"), Accommodation (hotel/motel/Airbnb/booking
  words AND category Travel/Holidays), Food & drink (Eating out or Groceries group, or
  "INFLIGHT"), Getting around (Car & transport), Activities (Fun & hobbies), else Other.
- **loc**: `vic` if the description contains a place from `vicPlaces`, or an ambiguous one
  (Carlton, Richmond, Sunshine, Brighton, Windsor, Kensington, Kew) together with VIC or MELB.
  `fx` if it shows a foreign-currency conversion. Otherwise empty.
  - **Cut-off names.** Card descriptions cut the place to 13 characters ("WEST FOOTSCRA"), so any
    place longer than 13 characters also matches on its first 13.
  - **Never a place (`notAPlace`).** If the description matches one of these, it gets no `vic` tag
    (`fx` still applies): company names with "VIC PTY" (Y & F Vic Pty Ltd is a Casuarina
    takeaway), Shopify online stores (`SP ` prefix), and online or Darwin merchants whose card
    machine says Melbourne: PlayHQ, Ticketmaster, Ticketebo, Trybooking, Telstra, Crocs
    Australia, Mollini, Windsor Smith, Stepping Stones, Gong Char, Nightcliff Seabreeze,
    Officeworks, Klook, Deft*Synergy. Keep health providers out of this committed list; they
    aren't in a trip-like group, so their tag never affects trips.
  - Checked against the real export: with these rules, the only `vic` lines in trip-like groups
    more than 3 days from a Melbourne visit are a Jetstar booking and a late hotel charge (both
    genuine travel). The
    suburbs added in this version (Reservoir, Campbellfield, Anglesea, Flemington, …) were all
    during visits.

## Display name
`merchant_name` unless "Unknown"; otherwise the description with ANZ banking prefixes, long
digit runs and extra spaces removed, cut to 34 characters, title case.

## Averaging window
All "per month" figures use a **window**: the last 365 days ending on the newest line's date
(the Overview also offers 3 and 6 months). Per month = window total ÷ (covered days ÷ 30.4375).
*Covered days* = days in the window that fall inside at least one import's date range (union of
`imports.from_date..to_date`). If covered days are fewer than the window's days, show
"Missing data: <ranges>" on the Overview and Data screens.

## Tests that must pass
1. **Sample:** `fixtures/sample-frollo.csv` → `fixtures/expected-summary.json`. The sample covers
   every kind above except #9, plus foreign currency, in-flight, union remap, Government,
   Interest and Tax income, an `included=False` row, a row without an ID (skipped), a pending row
   (skipped), an ambiguous place name without VIC (not tagged), a capital refund, a cut-off
   suburb (tagged), and "VIC PTY", Shopify and PlayHQ lines (not tagged). The expected output
   includes `skippedReasons` and `reviews`.
2. **Kinds:** summing each kind from classified lines never nets a transfer to zero; a manual
   `business_loan_repaid` tag moves a line out of income.
3. **Real data (local only):** for every CSV in `data/`, run the classifier and check invariants
   (no throw, every row either classified or skipped). If `data/expected-real.json` exists, the
   CSV it names must match its totals, skip reasons and review count exactly, and trip
   suggestions (`src/lib/trips.ts`, no trips or dismissals) must give exactly its `suggestions`
   date ranges. If there's no CSV, print
   `Real-data test skipped: no CSV in data/` rather than passing silently. Real numbers live only
   in `data/` (git-ignored) and are read at test time, never written into test code.
4. **Window:** a fixture with two imports and a gap produces the right covered days, per-month
   figures and "Missing data" range.
5. **Re-import:** importing the same file twice leaves the same number of lines (upsert on
   household + `transaction_id`).

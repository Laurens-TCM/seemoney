// Totals and averages over classified lines. All money is integer cents. See docs/DATA-RULES.md,
// "Averaging window".
import type { IncomeSource, Line } from './classify';

export interface DateRange { from: string; to: string } // inclusive, YYYY-MM-DD

export const DAYS_PER_MONTH = 30.4375;
const DAY_MS = 86_400_000;

const toMs = (d: string) => Date.parse(d + 'T00:00:00Z');
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY_MS);
/** Whole days from a to b (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS);
export const daysIn = (r: DateRange) => daysBetween(r.from, r.to) + 1;

export type WindowMonths = 3 | 6 | 12;
/** The last N months ending on `newest`: 12 → 365 days, 6 → 183, 3 → 91. */
export function windowFor(newest: string, months: WindowMonths): DateRange {
  return { from: addDays(newest, 1 - Math.round(months * DAYS_PER_MONTH)), to: newest };
}

/** Merges overlapping or touching ranges and clips them to `within`. */
function unionWithin(ranges: DateRange[], within: DateRange): DateRange[] {
  const clipped = ranges
    .map(r => ({ from: r.from > within.from ? r.from : within.from, to: r.to < within.to ? r.to : within.to }))
    .filter(r => r.from <= r.to)
    .sort((a, b) => (a.from < b.from ? -1 : 1));
  const out: DateRange[] = [];
  for (const r of clipped) {
    const last = out[out.length - 1];
    if (last && r.from <= addDays(last.to, 1)) { if (r.to > last.to) last.to = r.to; } else out.push({ ...r });
  }
  return out;
}

/** Days in `win` that fall inside at least one import's date range. */
export function coveredDays(win: DateRange, imports: DateRange[]): number {
  return unionWithin(imports, win).reduce((n, r) => n + daysIn(r), 0);
}

/** Parts of `win` that no import covers ("Missing data: …"). */
export function missingRanges(win: DateRange, imports: DateRange[]): DateRange[] {
  const gaps: DateRange[] = [];
  let next = win.from;
  for (const r of unionWithin(imports, win)) {
    if (r.from > next) gaps.push({ from: next, to: addDays(r.from, -1) });
    next = addDays(r.to, 1);
  }
  if (next <= win.to) gaps.push({ from: next, to: win.to });
  return gaps;
}

/** A window total as an amount per month. Returns cents (not rounded). */
export const perMonth = (totalCents: number, covered: number) =>
  covered > 0 ? totalCents / (covered / DAYS_PER_MONTH) : 0;

export interface MonthTotals {
  month: string; // YYYY-MM
  income: number;
  otherIn: number;
  spend: number; // money out is positive
  byGroup: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface OneOff { date: string; what: string; amount: number; kind: 'loan' | 'repaid' | 'capital' }

export interface Summary {
  range: DateRange | null; // first and last date among lines used
  used: number; // lines that aren't excluded
  excluded: number;
  totals: {
    income: number;
    incomeBySource: Partial<Record<IncomeSource, number>>;
    otherIn: number;
    spend: number;
    loanIn: number;
    loanInterest: number;
    loanPrincipal: number;
    businessLent: number;
    businessRepaid: number;
    capital: number;
  };
  months: MonthTotals[];
  oneOffs: OneOff[];
}

/** Totals for the lines inside `win` (all lines when no window is given). */
export function summarise(allLines: Line[], win?: DateRange): Summary {
  const lines = win ? allLines.filter(l => l.date >= win.from && l.date <= win.to) : allLines;
  const t: Summary['totals'] = {
    income: 0, incomeBySource: {}, otherIn: 0, spend: 0, loanIn: 0, loanInterest: 0, loanPrincipal: 0,
    businessLent: 0, businessRepaid: 0, capital: 0,
  };
  const months = new Map<string, MonthTotals>();
  const month = (d: string) => {
    const key = d.slice(0, 7);
    let m = months.get(key);
    if (!m) months.set(key, (m = { month: key, income: 0, otherIn: 0, spend: 0, byGroup: {}, byCategory: {} }));
    return m;
  };
  const oneOffs: OneOff[] = [];
  let from: string | null = null, to: string | null = null, used = 0, excluded = 0;

  for (const l of lines) {
    if (l.kind === 'excluded') { excluded++; continue; }
    used++;
    if (!from || l.date < from) from = l.date;
    if (!to || l.date > to) to = l.date;
    switch (l.kind) {
      case 'income': {
        t.income += l.amount; month(l.date).income += l.amount;
        const s = l.incomeSource!;
        t.incomeBySource[s] = (t.incomeBySource[s] ?? 0) + l.amount;
        break;
      }
      case 'other_in': t.otherIn += l.amount; month(l.date).otherIn += l.amount; break;
      case 'loan_in': t.loanIn += l.amount; break;
      case 'business_loan':
        t.businessLent -= l.amount;
        oneOffs.push({ date: l.date, what: l.label ?? l.name, amount: -l.amount, kind: 'loan' });
        break;
      case 'business_loan_repaid':
        t.businessRepaid += l.amount;
        oneOffs.push({ date: l.date, what: l.name, amount: l.amount, kind: 'repaid' });
        break;
      case 'capital':
        t.capital -= l.amount;
        oneOffs.push({ date: l.date, what: l.label ?? l.name, amount: -l.amount, kind: 'capital' });
        break;
      case 'spend': {
        const out = -l.amount, m = month(l.date), g = l.group!, c = l.category!;
        t.spend += out; m.spend += out;
        m.byGroup[g] = (m.byGroup[g] ?? 0) + out;
        m.byCategory[c] = (m.byCategory[c] ?? 0) + out;
        if (c === 'Mortgage interest') t.loanInterest += out;
        break;
      }
      case 'internal': break;
    }
  }
  t.loanPrincipal = t.loanIn - t.loanInterest;
  return {
    range: from && to ? { from, to } : null,
    used, excluded, totals: t,
    months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    oneOffs,
  };
}

/**
 * Incoming business lines worth a second look ("Check: pay or loan repayment?"): at least twice the
 * median business pay in these lines, or a whole multiple of $1,000.
 */
export function businessRepaymentChecks(lines: Line[]): Line[] {
  const incoming = lines.filter(l => (l.kind === 'income' && l.incomeSource === 'TCM pay') || l.kind === 'business_loan_repaid');
  const pay = incoming.filter(l => l.kind === 'income').map(l => l.amount).sort((a, b) => a - b);
  if (!pay.length) return [];
  const mid = pay.length >> 1;
  const median = pay.length % 2 ? pay[mid] : (pay[mid - 1] + pay[mid]) / 2;
  return incoming.filter(l => l.amount >= 2 * median || l.amount % 100_000 === 0);
}

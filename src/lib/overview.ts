// Everything the Overview shows, as one pure calculation over classified lines (overrides already
// applied). Money is cents; "per month" figures divide a window total by covered months.
import type { Line } from './classify';
import {
  coveredDays, daysIn, DAYS_PER_MONTH, missingRanges, perMonth, summarise, windowFor,
  type DateRange, type Summary, type WindowMonths,
} from './summary';
import type { EventType } from './events';

export interface MonthBar {
  month: string; // YYYY-MM
  regular: number; // spending not in an event (all spending when events aren't left out)
  events: number;
  /** Event spending by type (trips, labelled big purchases…). */
  byType: Partial<Record<EventType, number>>;
  income: number;
  /** The window or the data covers only part of this month. */
  partial: boolean;
}

export interface GroupRow {
  group: string;
  perMonth: number;
  categories: { category: string; perMonth: number }[];
  /** Biggest payees over the whole window (events included), by total. */
  payees: { name: string; total: number; count: number }[];
}

export interface Overview {
  window: DateRange;
  covered: number; // days
  months: number; // covered days ÷ 30.4375
  missing: DateRange[];
  hideEvents: boolean;
  summary: Summary;
  pm: { income: number; otherIn: number; spend: number; regular: number; events: number; principal: number };
  bars: MonthBar[];
  groups: GroupRow[];
  /** Capital items, one row per label (a solar install paid in two parts is one row). */
  capital: { what: string; amount: number; payments: number; from: string; to: string }[];
  business: { lent: number; repaid: number; lines: { date: string; what: string; amount: number; kind: 'loan' | 'repaid' }[] };
}

export interface OverviewInput {
  lines: Line[];
  imports: DateRange[];
  windowMonths: WindowMonths;
  hideEvents: boolean;
  /** Spend line → the event it belongs to (trips and labelled events). */
  events?: { owner: Map<string, { type: EventType }> } | null;
}

const PAYEES_SHOWN = 10;
const HALF_DOLLAR = 50;

export function buildOverview({ lines, imports, windowMonths, hideEvents, events }: OverviewInput): Overview | null {
  const counted = lines.filter(l => l.kind !== 'excluded');
  const newest = counted.reduce((d, l) => (l.date > d ? l.date : d), '');
  if (!newest) return null;

  const win = windowFor(newest, windowMonths);
  const covered = coveredDays(win, imports);
  const firstImport = imports.reduce((d, r) => (r.from < d ? r.from : d), newest);
  const missing = missingRanges({ from: firstImport > win.from ? firstImport : win.from, to: win.to }, imports);
  const summary = summarise(lines, win);
  const inWindow = counted.filter(l => l.date >= win.from && l.date <= win.to);
  const pm = (cents: number) => perMonth(cents, covered);

  // Event spending inside the window, by month / group / type.
  const owner = events?.owner;
  const eventLines = owner ? inWindow.filter(l => l.kind === 'spend' && owner.has(l.txId)) : [];
  const sumBy = (key: (l: Line) => string) => {
    const out: Record<string, number> = {};
    for (const l of eventLines) out[key(l)] = (out[key(l)] ?? 0) - l.amount;
    return out;
  };
  const eventByMonth = sumBy(l => l.date.slice(0, 7));
  const eventByGroup = sumBy(l => l.group!);
  const eventByMonthType = sumBy(l => `${l.date.slice(0, 7)}|${owner!.get(l.txId)!.type}`);
  const eventTotal = Object.values(eventByMonth).reduce((a, b) => a + b, 0);
  const hide = hideEvents && eventTotal !== 0;

  const t = summary.totals;
  const bars: MonthBar[] = summary.months.map(m => {
    const eventsThisMonth = eventByMonth[m.month] ?? 0;
    const byType: MonthBar['byType'] = {};
    for (const [k, v] of Object.entries(eventByMonthType)) if (k.startsWith(m.month)) byType[k.slice(8) as EventType] = v;
    const monthRange = { from: `${m.month}-01`, to: lastDay(m.month) };
    const inside = { from: maxDate(monthRange.from, win.from), to: minDate(monthRange.to, win.to) };
    return {
      month: m.month,
      regular: m.spend - eventsThisMonth,
      events: eventsThisMonth,
      byType,
      income: m.income,
      partial: coveredDays(inside, imports) < daysIn(monthRange),
    };
  });

  const groupTotals: Record<string, number> = {}, categoryTotals: Record<string, Record<string, number>> = {};
  for (const m of summary.months) {
    for (const [g, v] of Object.entries(m.byGroup)) groupTotals[g] = (groupTotals[g] ?? 0) + v;
  }
  if (hide) for (const [g, v] of Object.entries(eventByGroup)) groupTotals[g] -= v;
  for (const l of inWindow) {
    if (l.kind !== 'spend' || (hide && owner!.has(l.txId))) continue;
    const cats = (categoryTotals[l.group!] ??= {});
    cats[l.category!] = (cats[l.category!] ?? 0) - l.amount;
  }

  const payees = new Map<string, Map<string, { total: number; count: number }>>();
  for (const l of inWindow) {
    if (l.kind !== 'spend') continue;
    const byName = payees.get(l.group!) ?? new Map();
    payees.set(l.group!, byName);
    const p = byName.get(l.name) ?? { total: 0, count: 0 };
    p.total -= l.amount; p.count++;
    byName.set(l.name, p);
  }

  const groups: GroupRow[] = Object.entries(groupTotals)
    .map(([group, total]) => ({
      group,
      perMonth: pm(total),
      categories: Object.entries(categoryTotals[group] ?? {})
        .map(([category, v]) => ({ category, perMonth: pm(v) }))
        .filter(c => Math.abs(c.perMonth) >= HALF_DOLLAR)
        .sort((a, b) => b.perMonth - a.perMonth),
      payees: [...(payees.get(group) ?? new Map()).entries()]
        .map(([name, p]) => ({ name, ...p }))
        .filter(p => p.total >= HALF_DOLLAR)
        .sort((a, b) => b.total - a.total)
        .slice(0, PAYEES_SHOWN),
    }))
    .filter(g => g.perMonth >= HALF_DOLLAR)
    .sort((a, b) => b.perMonth - a.perMonth);

  return {
    window: win, covered, months: covered / DAYS_PER_MONTH, missing, hideEvents: hide, summary,
    pm: {
      income: pm(t.income), otherIn: pm(t.otherIn), spend: pm(t.spend),
      regular: pm(t.spend - (hide ? eventTotal : 0)), events: pm(eventTotal), principal: pm(t.loanPrincipal),
    },
    bars,
    groups,
    capital: groupCapital(summary.oneOffs.filter(o => o.kind === 'capital')),
    business: {
      lent: t.businessLent, repaid: t.businessRepaid,
      lines: summary.oneOffs.filter(o => o.kind !== 'capital').map(o => ({ date: o.date, what: o.what, amount: o.amount, kind: o.kind as 'loan' | 'repaid' })),
    },
  };
}

function groupCapital(items: { date: string; what: string; amount: number }[]): Overview['capital'] {
  const byLabel = new Map<string, Overview['capital'][number]>();
  for (const c of items) {
    const row = byLabel.get(c.what);
    if (!row) byLabel.set(c.what, { what: c.what, amount: c.amount, payments: 1, from: c.date, to: c.date });
    else { row.amount += c.amount; row.payments++; row.from = minDate(row.from, c.date); row.to = maxDate(row.to, c.date); }
  }
  return [...byLabel.values()];
}

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);
function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export interface BusinessBalance { owedBefore: number; asOf: string; lent: number; repaid: number; stillOwed: number }

/**
 * What the business still owes: the amount owed before `asOf`, plus everything lent since, minus
 * everything repaid since. Uses all lines from `asOf`, not the averaging window. Null until the
 * starting figure has been entered.
 */
export function businessBalance(lines: Line[], opening: { amount: number; asOf: string } | null): BusinessBalance | null {
  if (!opening) return null;
  let lent = 0, repaid = 0;
  for (const l of lines) {
    if (l.date < opening.asOf) continue;
    if (l.kind === 'business_loan') lent -= l.amount;
    if (l.kind === 'business_loan_repaid') repaid += l.amount;
  }
  return { owedBefore: opening.amount, asOf: opening.asOf, lent, repaid, stillOwed: opening.amount + lent - repaid };
}

// Regular payments (subscriptions, bills, repeat payments to people) found in spend lines.
// A port of reference/recurring.js, in cents, with one agreed addition (docs/V2-SPEC.md §3.8): a
// short run at a new price more than 15% away that continues a series joins it as a price change.
import type { Line } from './classify';
import { addDays, daysBetween } from './summary';

export type Cadence = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly';
interface CadenceRule { key: Cadence; days: number; tol: number; perMonth: number; min: number }

export const CADENCES: CadenceRule[] = [
  { key: 'weekly', days: 7, tol: 2, perMonth: 30.4375 / 7, min: 4 },
  { key: 'fortnightly', days: 14, tol: 3, perMonth: 30.4375 / 14, min: 3 },
  { key: 'monthly', days: 30.4, tol: 4, perMonth: 1, min: 3 },
  { key: 'quarterly', days: 91, tol: 10, perMonth: 1 / 3, min: 3 },
  { key: 'yearly', days: 365, tol: 20, perMonth: 1 / 12, min: 2 },
];
export const CADENCE_DAYS: Record<Cadence, number> = Object.fromEntries(CADENCES.map(c => [c.key, c.days])) as Record<Cadence, number>;

/** Groups where you choose what to spend each time: only near-identical amounts count as regular. */
const CHOSEN_EACH_TIME = new Set(['Eating out & drinks', 'Groceries', 'Shopping', 'Car & transport', 'Pets', 'Fun & hobbies']);
/** How far a later price may move and still continue the series (docs/V2-SPEC.md §3.8). */
const PRICE_STEP_LIMIT = 0.5;

export interface RecurringInput { id: string; date: string; name: string; amount: number; category: string | null; group: string | null } // amount: cents out

export interface RecurringSeries {
  key: string; // merchant key
  name: string;
  category: string | null;
  group: string | null;
  cadence: Cadence;
  count: number;
  typical: number; // cents
  last: number; // cents
  lastDate: string;
  next: string | null; // when active
  active: boolean;
  perMonth: number; // cents, not rounded
  perYear: number;
  priceChange: number; // cents; 0 when the price hasn't moved
  first: string;
  txIds: string[];
  /** Home-loan interest: listed as the loan's cost, not as a subscription. */
  loanInterest: boolean;
}

/** Merchant key: upper case, digits and place/company noise removed, first three words. */
export function merchantKey(name: string): string {
  return name.toUpperCase().replace(/\d+/g, ' ').replace(/[^A-Z& ]/g, ' ')
    .replace(/\b(PTY|LTD|AU|AUS|AUSTRALIA|COM|WWW|HTTPS|DARWIN|CASUARINA|NT|SYDNEY|MELBOURNE|NSW|VIC|CITY|THE|INT|SAN FRANCISCO|INTERNET|SINGAPORE|DUBLIN|IRL)\b/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const gapsOf = (it: RecurringInput[]) => it.slice(1).map((l, i) => daysBetween(it[i].date, l.date)).filter(g => g > 0);

interface Found { cad: CadenceRule; it: RecurringInput[]; stepAt: number | null }

function asSeries(it: RecurringInput[]): Found | null {
  const gaps = gapsOf(it);
  if (!gaps.length) return null;
  const g = median(gaps);
  const cad = CADENCES.find(x => Math.abs(g - x.days) <= x.tol);
  if (!cad || it.length < cad.min) return null;
  if (gaps.filter(x => Math.abs(x - cad.days) <= cad.tol * 1.5).length / gaps.length < 0.6) return null;
  const amounts = it.map(i => i.amount), typical = median(amounts);
  if (typical < 100) return null;
  const spread = (Math.max(...amounts) - Math.min(...amounts)) / typical;
  const near = amounts.filter(a => Math.abs(a - typical) <= typical * 0.15).length / amounts.length;
  if (CHOSEN_EACH_TIME.has(it[0].group ?? '') && !(spread <= 0.05 && (it.length >= 4 || cad.key === 'yearly')) && !(it.length >= 8 && near >= 0.75)) return null;
  return { cad, it, stepAt: null };
}

/** A later run at a new price that carries on the series' rhythm (docs/V2-SPEC.md §3.8). */
function continuesAtNewPrice(s: Found, run: RecurringInput[]): boolean {
  const last = s.it[s.it.length - 1];
  if (run[0].date <= last.date) return false;
  const fits = (gap: number) => Math.abs(gap - s.cad.days) <= s.cad.tol * 1.5;
  if (!fits(daysBetween(last.date, run[0].date)) || !gapsOf(run).every(fits)) return false;
  const before = median(s.it.slice(-3).map(i => i.amount)), after = median(run.map(i => i.amount));
  return Math.abs(after - before) <= before * PRICE_STEP_LIMIT;
}

/** `priceSteps: false` gives exactly reference/recurring.js (used to prove the port is faithful). */
export function detectRecurring(lines: RecurringInput[], dataEnd: string, { priceSteps = true } = {}): RecurringSeries[] {
  const byMerchant = new Map<string, RecurringInput[]>();
  for (const l of lines) {
    if (l.amount <= 0) continue;
    const k = merchantKey(l.name);
    if (k.length < 3) continue;
    byMerchant.set(k, [...(byMerchant.get(k) ?? []), l]);
  }
  const out: RecurringSeries[] = [];
  for (const [key, ls] of byMerchant) {
    if (ls.length < 2) continue;
    ls.sort((a, b) => (a.date < b.date ? -1 : 1));
    // Amount clusters (within 15% or $3), so one merchant can hold two series.
    const clusters: { ref: number; items: RecurringInput[] }[] = [];
    for (const l of ls) {
      const c = clusters.find(c => Math.abs(l.amount - c.ref) <= Math.max(300, c.ref * 0.15));
      if (c) { c.items.push(l); c.ref = median(c.items.map(i => i.amount)); } else clusters.push({ ref: l.amount, items: [l] });
    }
    const found: Found[] = [], leftovers: RecurringInput[][] = [];
    for (const c of clusters) {
      const s = c.items.length >= 2 ? asSeries(c.items) : null;
      if (s) found.push(s); else leftovers.push(c.items);
    }
    found.sort((a, b) => (a.it[0].date < b.it[0].date ? -1 : 1));
    // Same merchant, same cadence, one price after another = one series (a price change).
    const merged: Found[] = [];
    for (const f of found) {
      const p = merged[merged.length - 1];
      if (p && p.cad.key === f.cad.key && p.it[p.it.length - 1].date < f.it[0].date) p.it = p.it.concat(f.it);
      else merged.push(f);
    }
    // Agreed addition: a short run at a new price (too few hits to be a series itself).
    if (priceSteps) for (const run of leftovers.sort((a, b) => (a[0].date < b[0].date ? -1 : 1))) {
      const s = merged.find(m => continuesAtNewPrice(m, run));
      if (s) { s.stepAt = s.it.length; s.it = s.it.concat(run); }
    }

    for (const { cad, it, stepAt } of merged) {
      const amounts = it.map(i => i.amount), last = it[it.length - 1];
      const typical = median(stepAt === null ? amounts.slice(-3) : amounts.slice(stepAt).slice(-3));
      const prev = stepAt === null
        ? (amounts.length > 1 ? median(amounts.slice(0, Math.max(1, amounts.length - 3))) : typical)
        : median(amounts.slice(0, stepAt).slice(-3));
      const active = daysBetween(last.date, dataEnd) <= cad.days + cad.tol * 2;
      out.push({
        key, name: last.name, category: last.category, group: last.group, cadence: cad.key, count: it.length,
        typical, last: last.amount, lastDate: last.date,
        next: active ? addDays(last.date, Math.round(cad.days)) : null,
        active, perMonth: typical * cad.perMonth, perYear: typical * cad.perMonth * 12,
        priceChange: Math.abs(typical - prev) > Math.max(100, prev * 0.05) ? typical - prev : 0,
        first: it[0].date, txIds: it.map(i => i.id),
        loanInterest: last.category === 'Mortgage interest',
      });
    }
  }
  return out.sort((a, b) => b.perMonth - a.perMonth);
}

/** Spend lines in the shape the detector wants. */
export const recurringInputs = (lines: Line[]): RecurringInput[] =>
  lines.filter(l => l.kind === 'spend').map(l => ({ id: l.txId, date: l.date, name: l.name, amount: -l.amount, category: l.category, group: l.group }));

// The Regulars screen's figures: detected series joined to the household's choices, hand-added
// regulars, the header split, savings from cancelling, and which days regulars come out.
import { addDays, daysBetween } from './summary';
import { CADENCE_DAYS, CADENCES, type Cadence, type RecurringSeries } from './recurring';

export type RegularStatus = 'keep' | 'review' | 'cancel' | 'not_regular';

/** A saved choice or a hand-added regular (the `regulars` table). */
export interface StoredRegular {
  id: string;
  seriesKey: string | null;
  txIds: string[];
  status: RegularStatus;
  statusChangedAt: string | null;
  name: string | null; amount: number | null; cadence: Cadence | null; nextDue: string | null; group: string | null; // hand-added
  note: string | null;
}

export type Bucket = 'Subscriptions' | 'Bills & insurance' | 'Kids & school' | 'People' | 'Other';
export const BUCKETS: Bucket[] = ['Subscriptions', 'Bills & insurance', 'Kids & school', 'People', 'Other'];

export interface RegularRow {
  /** Stable across re-imports: the stored row's id if there is one, else the series' first transaction. */
  id: string;
  name: string;
  cadence: Cadence;
  typical: number; // cents per payment
  perMonth: number;
  perYear: number;
  lastDate: string | null;
  next: string | null;
  active: boolean;
  priceChange: number;
  isNew: boolean;
  bucket: Bucket;
  group: string | null;
  status: RegularStatus;
  stored: StoredRegular | null;
  series: RecurringSeries | null; // null for hand-added
  loanInterest: boolean;
}

export interface RegularsView {
  active: RegularRow[]; // what you pay now (not loan interest, not "not a regular")
  stopped: RegularRow[];
  notRegular: RegularRow[];
  loanInterest: RegularRow | null;
  perMonth: number;
  perYear: number;
  byBucket: Record<Bucket, number>; // per month
}

/** A regular counts as new if its first payment is within this many days of the data's end. */
export const NEW_WITHIN_DAYS = 90;

export const seriesKeyOf = (s: Pick<RecurringSeries, 'key' | 'cadence'>) => `${s.key}|${s.cadence}`;

export function bucketOf(group: string | null, category: string | null, name: string): Bucket {
  if (group === 'Payments to people') return 'People';
  if (group === 'Kids & school') return 'Kids & school';
  if (group === 'Home & bills' || /INSUR/i.test(`${name} ${category ?? ''}`)) return 'Bills & insurance';
  if (['Fun & hobbies', 'Shopping', 'Health & fitness'].includes(group ?? '')
    || ['Subscriptions/Renewals', 'Services/Supplies', 'Electronics', 'Entertainment/Recreation'].includes(category ?? '')) return 'Subscriptions';
  return 'Other';
}

const perMonthOf = (cadence: Cadence) => CADENCES.find(c => c.key === cadence)!.perMonth;

/** Joins stored choices to series: any shared transaction first, then merchant key + cadence. */
export function matchStored(series: RecurringSeries[], stored: StoredRegular[]): Map<RecurringSeries, StoredRegular> {
  const out = new Map<RecurringSeries, StoredRegular>();
  const used = new Set<string>();
  const choices = stored.filter(s => s.txIds.length || s.seriesKey);
  for (const s of series) {
    const ids = new Set(s.txIds);
    const hit = choices.find(c => !used.has(c.id) && c.txIds.some(id => ids.has(id)));
    if (hit) { out.set(s, hit); used.add(hit.id); }
  }
  // Fallback, once none of a choice's transactions are in the data any more.
  for (const s of series) {
    if (out.has(s)) continue;
    const hit = choices.find(c => !used.has(c.id) && c.seriesKey === seriesKeyOf(s));
    if (hit) { out.set(s, hit); used.add(hit.id); }
  }
  return out;
}

const MONTHS: Partial<Record<Cadence, number>> = { monthly: 1, quarterly: 3, yearly: 12 };

/**
 * One cadence step on from `d`. Monthly, quarterly and yearly keep the day of the month (the 31st
 * becomes the month's last day), so a bill due on the 1st stays on the 1st.
 */
export function nextDate(d: string, cadence: Cadence, anchorDay = Number(d.slice(8, 10))): string {
  const months = MONTHS[cadence];
  if (!months) return addDays(d, Math.round(CADENCE_DAYS[cadence]));
  const [y, m] = d.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, last));
  return target.toISOString().slice(0, 10);
}

/** The next due date on or after `today`, stepping by cadence from `from`. */
export function rollForward(from: string, cadence: Cadence, today: string): string {
  const day = Number(from.slice(8, 10));
  let d = from;
  while (d < today) d = nextDate(d, cadence, day);
  return d;
}

export function buildRegulars(series: RecurringSeries[], stored: StoredRegular[], dataEnd: string, today: string): RegularsView {
  const matched = matchStored(series, stored);
  const rows: RegularRow[] = series.map(s => {
    const st = matched.get(s) ?? null;
    return {
      id: st?.id ?? s.txIds[0], name: s.name, cadence: s.cadence, typical: s.typical, perMonth: s.perMonth, perYear: s.perYear,
      lastDate: s.lastDate, next: s.next, active: s.active, priceChange: s.priceChange,
      isNew: daysBetween(s.first, dataEnd) <= NEW_WITHIN_DAYS,
      bucket: bucketOf(s.group, s.category, s.name), group: s.group, status: st?.status ?? 'keep', stored: st, series: s, loanInterest: s.loanInterest,
    };
  });
  for (const m of stored.filter(s => !s.txIds.length && !s.seriesKey && s.name && s.amount != null && s.cadence)) {
    const pm = m.amount! * perMonthOf(m.cadence!);
    rows.push({
      id: m.id, name: m.name!, cadence: m.cadence!, typical: m.amount!, perMonth: pm, perYear: pm * 12, lastDate: null,
      next: m.nextDue ? rollForward(m.nextDue, m.cadence!, today) : null, active: true, priceChange: 0, isNew: false,
      bucket: bucketOf(m.group, null, m.name!), group: m.group, status: m.status, stored: m, series: null, loanInterest: false,
    });
  }
  const loanInterest = rows.find(r => r.loanInterest && r.active) ?? null;
  const shown = rows.filter(r => !r.loanInterest);
  const active = shown.filter(r => r.active && r.status !== 'not_regular').sort((a, b) => b.perMonth - a.perMonth);
  const byBucket = Object.fromEntries(BUCKETS.map(b => [b, 0])) as Record<Bucket, number>;
  for (const r of active) byBucket[r.bucket] += r.perMonth;
  const perMonth = active.reduce((a, r) => a + r.perMonth, 0);
  return {
    active,
    stopped: shown.filter(r => !r.active && r.status !== 'not_regular').sort((a, b) => ((b.lastDate ?? '') < (a.lastDate ?? '') ? -1 : 1)),
    notRegular: rows.filter(r => r.status === 'not_regular'),
    loanInterest,
    perMonth, perYear: perMonth * 12, byBucket,
  };
}

/** Days of `month` (YYYY-MM) on which each active regular is due. */
export function dueDays(view: RegularsView, month: string): Map<number, RegularRow[]> {
  const out = new Map<number, RegularRow[]>();
  const start = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  for (const r of [...view.active, ...(view.loanInterest ? [view.loanInterest] : [])]) {
    const anchor = r.lastDate ?? r.next;
    if (!anchor) continue;
    const anchorDay = Number(anchor.slice(8, 10));
    let d = anchor;
    while (d < start) d = nextDate(d, r.cadence, anchorDay);
    for (; d <= end; d = nextDate(d, r.cadence, anchorDay)) {
      const day = Number(d.slice(8, 10));
      out.set(day, [...(out.get(day) ?? []), r]);
    }
  }
  return out;
}

/** The first payment that didn't come: when a stopped regular's saving starts. */
export const stoppedFrom = (r: Pick<RegularRow, 'lastDate' | 'cadence'>) => (r.lastDate ? nextDate(r.lastDate, r.cadence) : null);

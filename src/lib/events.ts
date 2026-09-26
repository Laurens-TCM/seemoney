// Events: everything that isn't day-to-day spending (docs/V2-SPEC.md §1). Trips and labelled
// purchases are stored; automatic events (capital items, the business loan, extra home-loan
// payments, big one-off income) are worked out from lines every time, so re-imports can't
// duplicate them. Pure: no I/O.
import type { Line } from './classify';
import { detectRecurring, recurringInputs, type RecurringInput } from './recurring';
import { daysBetween } from './summary';
import { allocateTrips, type Allocation, type Trip, type TripOverride, type TripPlace } from './trips';

export type EventType = 'trip' | 'big' | 'loan' | 'income' | 'bill';
export const EVENT_TYPES: { key: EventType; label: string; plural: string }[] = [
  { key: 'trip', label: 'Trip', plural: 'Trips' },
  { key: 'big', label: 'Big purchase', plural: 'Big purchases' },
  { key: 'loan', label: 'Loan', plural: 'Loans' },
  { key: 'income', label: 'Income event', plural: 'Income events' },
  { key: 'bill', label: 'Bill spike', plural: 'Bill spikes' },
];
export const eventLabel = (t: EventType) => EVENT_TYPES.find(e => e.key === t)!.label;

export type TripKind = 'family' | 'holiday' | 'work';

/** A stored event (the `events` table). Trips have kind and place; other types don't. */
export interface StoredEvent {
  id: string;
  type: EventType;
  name: string;
  start: string;
  end: string;
  kind: TripKind | null;
  place: TripPlace | null;
  rechargeToBusiness: boolean;
}
/** A manual tick or untick of one line on one event (`event_overrides`). */
export interface EventOverride { eventId: string; txId: string; included: boolean }

/** Income at or above this, outside regular pay, is an income event. */
export const INCOME_EVENT_MIN = 200_000;
/** Income more than this many times its source's usual payment is an income event. */
export const UNUSUAL_INCOME = 1.5;
/** Default for "Label this?" (the household can change it in settings). */
export const BIG_PURCHASE_DEFAULT = 100_000;
/** Business-loan lines this close together (days) are one event. */
const MERGE_DAYS = 7;

export interface AutoEvent {
  id: string; // stable: type + first transaction id
  type: EventType;
  name: string;
  start: string;
  end: string;
  /** Cents, always positive: money out for spending and loans made, money in for income and repayments. */
  total: number;
  direction: 'out' | 'in';
  lines: Line[];
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const byDate = (a: Line, b: Line) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

function toEvent(type: EventType, name: string, lines: Line[], direction: 'out' | 'in'): AutoEvent {
  const sorted = [...lines].sort(byDate);
  return {
    id: `auto-${type}-${sorted[0].txId}`, type, name, start: sorted[0].date, end: sorted[sorted.length - 1].date,
    total: Math.abs(sorted.reduce((a, l) => a + l.amount, 0)), direction, lines: sorted,
  };
}

/** Lines with the same key, each within `days` of the previous one, become one group. */
function runs(lines: Line[], key: (l: Line) => string, days: number): Line[][] {
  const out: Line[][] = [], open = new Map<string, Line[]>();
  for (const l of [...lines].sort(byDate)) {
    const k = key(l), cur = open.get(k);
    if (cur && daysBetween(cur[cur.length - 1].date, l.date) <= days) cur.push(l);
    else { const run = [l]; out.push(run); open.set(k, run); }
  }
  return out;
}

/** Transactions that are part of a regular series (money in or out, by the recurring detector). */
function inSeries(inputs: RecurringInput[], dataEnd: string): Set<string> {
  return new Set(detectRecurring(inputs, dataEnd).flatMap(s => s.txIds));
}

/** Events worked out from lines: never stored, so a re-import can't duplicate them. */
export function automaticEvents(lines: Line[]): AutoEvent[] {
  const counted = lines.filter(l => l.kind !== 'excluded');
  const dataEnd = counted.reduce((d, l) => (l.date > d ? l.date : d), '');
  const out: AutoEvent[] = [];

  // Capital items, one event per label (a solar install paid in two parts is one event).
  const capital = new Map<string, Line[]>();
  for (const l of counted.filter(l => l.kind === 'capital')) capital.set(l.label ?? l.name, [...(capital.get(l.label ?? l.name) ?? []), l]);
  for (const [label, ls] of capital) out.push(toEvent('big', label, ls, 'out'));

  // Money lent to the business and repaid, merged when paid in quick succession.
  const business = counted.filter(l => l.kind === 'business_loan' || l.kind === 'business_loan_repaid');
  for (const run of runs(business, l => `${l.kind}|${l.label ?? ''}`, MERGE_DAYS)) {
    const lent = run[0].kind === 'business_loan';
    out.push(toEvent('loan', lent ? run[0].label ?? 'Business loan' : 'Business loan repaid', run, lent ? 'out' : 'in'));
  }

  // Home-loan payments that aren't part of the regular repayments (an extra $1,000).
  const loanIn = counted.filter(l => l.kind === 'loan_in');
  const repayments = inSeries(loanIn.map(l => ({ id: l.txId, date: l.date, name: l.name, amount: l.amount, category: null, group: null })), dataEnd);
  for (const l of loanIn.filter(l => !repayments.has(l.txId))) out.push(toEvent('loan', 'Extra home-loan payment', [l], 'out'));

  // Income of $2,000 or more that isn't ordinary pay: a tax refund, or a payment well above what
  // that source usually pays (a bonus, a big TCM payment). Pay changes employer and amount during
  // a year, so "usual" is the median for the source, not a detected series.
  const income = counted.filter(l => l.kind === 'income');
  const source = (l: Line) => l.incomeSource ?? '';
  const usual = new Map([...new Set(income.map(source))].map(s => [s, median(income.filter(l => source(l) === s).map(l => l.amount))]));
  for (const l of income) {
    if (l.amount < INCOME_EVENT_MIN) continue;
    const refund = l.incomeSource === 'Tax refund';
    if (!refund && l.amount <= usual.get(source(l))! * UNUSUAL_INCOME) continue;
    out.push(toEvent('income', refund ? 'Tax refund' : `${l.incomeSource ?? 'Income'}, more than usual`, [l], 'in'));
  }
  return out.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

export interface EventAllocation {
  /** Trips, allocated exactly as in v1. */
  trips: Allocation;
  /** Spend line → the stored event it belongs to (trips and labelled events). */
  owner: Map<string, { id: string; type: EventType }>;
  /** Per stored event: its spend lines and total (cents out). */
  perEvent: Record<string, { lines: Line[]; total: number }>;
}

const asTrip = (e: StoredEvent): Trip => ({ id: e.id, start: e.start, end: e.end, place: e.place ?? 'any' });

/**
 * Which spend lines belong to which stored event. Trips pick up lines by date and place, as in
 * v1; other events hold only the lines ticked onto them. A line belongs to one event at most,
 * and a trip wins.
 */
export function allocateEvents(lines: Line[], events: StoredEvent[], overrides: EventOverride[]): EventAllocation {
  const tripEvents = events.filter(e => e.type === 'trip');
  const tripIds = new Set(tripEvents.map(e => e.id));
  const trips = allocateTrips(lines, tripEvents.map(asTrip),
    overrides.filter(o => tripIds.has(o.eventId)).map((o): TripOverride => ({ tripId: o.eventId, txId: o.txId, included: o.included })));

  const owner = new Map<string, { id: string; type: EventType }>();
  const perEvent: EventAllocation['perEvent'] = {};
  const byId = new Map(events.map(e => [e.id, e]));
  for (const [txId, id] of trips.owner) owner.set(txId, { id, type: 'trip' });

  const spend = new Map(lines.filter(l => l.kind === 'spend').map(l => [l.txId, l]));
  for (const o of overrides) {
    const e = byId.get(o.eventId);
    if (!e || e.type === 'trip' || !o.included || owner.has(o.txId) || !spend.has(o.txId)) continue;
    owner.set(o.txId, { id: e.id, type: e.type });
  }
  for (const e of events) perEvent[e.id] = { lines: [], total: 0 };
  for (const [txId, { id }] of owner) {
    const l = spend.get(txId)!;
    perEvent[id].lines.push(l);
    perEvent[id].total -= l.amount;
  }
  return { trips, owner, perEvent };
}

/**
 * "Label this?": single spending lines at or above the threshold that aren't regulars, aren't in
 * an event and haven't been dismissed. Newest first.
 */
export function suggestLabels(lines: Line[], owner: Map<string, unknown>, dismissed: Set<string>, threshold = BIG_PURCHASE_DEFAULT): Line[] {
  const counted = lines.filter(l => l.kind !== 'excluded');
  const dataEnd = counted.reduce((d, l) => (l.date > d ? l.date : d), '');
  const regular = inSeries(recurringInputs(lines), dataEnd);
  return lines
    .filter(l => l.kind === 'spend' && -l.amount >= threshold && !regular.has(l.txId) && !owner.has(l.txId) && !dismissed.has(l.txId))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

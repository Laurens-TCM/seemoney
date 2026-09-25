// Trips: suggestions from Victoria-tagged lines, and which spend lines belong to which trip.
// Ported from reference/prototype.html (allocate, suggestions). See docs/SPEC.md, "Trips".
import type { Bucket, Line } from './classify';
import { addDays, daysBetween, type DateRange } from './summary';

export type TripPlace = 'melbourne' | 'overseas' | 'any';
export interface Trip { id: string; start: string; end: string; place: TripPlace }
/** A manual tick (included) or untick (not included) of one line on one trip. Always wins. */
export interface TripOverride { tripId: string; txId: string; included: boolean }

/** Groups whose lines can be auto-ticked onto a trip by place. */
export const TRIP_LIKE_GROUPS = new Set([
  'Eating out & drinks', 'Groceries', 'Travel & holidays', 'Car & transport', 'Shopping', 'Fun & hobbies',
]);
/** Flights and accommodation booked this many days before a trip are offered as candidates. */
export const BOOKED_BEFORE_DAYS = 120;

export interface Candidate { line: Line; during: boolean; auto: boolean }
export interface TripTotals { total: number; lines: number; buckets: Partial<Record<Bucket, number>> }

export interface Allocation {
  /** txId → trip id, for lines that belong to a trip. */
  owner: Map<string, string>;
  /** Per trip: lines during it, flights/stays booked before it, and manual includes. */
  candidates: Record<string, Candidate[]>;
  perTrip: Record<string, TripTotals>;
  byMonth: Record<string, number>;
  byGroup: Record<string, number>;
  byCategory: Record<string, number>;
  total: number; // cents out, all trips
}

const out = (l: Line) => -l.amount;
const byStart = (a: Trip, b: Trip) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

/**
 * Decides which spend lines belong to which trip. A line belongs to one trip at most: manual
 * includes first, then automatic matches, each in trip-start order. Manual unticks always win.
 */
export function allocateTrips(lines: Line[], trips: Trip[], overrides: TripOverride[]): Allocation {
  const spend = lines.filter(l => l.kind === 'spend');
  const ordered = [...trips].sort(byStart);
  const includes = new Map<string, Set<string>>(), excludes = new Map<string, Set<string>>();
  for (const o of overrides) {
    const m = o.included ? includes : excludes;
    if (!m.has(o.tripId)) m.set(o.tripId, new Set());
    m.get(o.tripId)!.add(o.txId);
  }
  const inc = (t: Trip) => includes.get(t.id) ?? new Set<string>();
  const exc = (t: Trip) => excludes.get(t.id) ?? new Set<string>();

  const candidates: Record<string, Candidate[]> = {};
  for (const t of ordered) {
    const early = addDays(t.start, -BOOKED_BEFORE_DAYS), forced = inc(t), list: Candidate[] = [];
    for (const line of spend) {
      const during = line.date >= t.start && line.date <= t.end;
      const before = !during && line.date >= early && line.date < t.start
        && (line.bucket === 'Flights' || line.bucket === 'Accommodation');
      if (!during && !before && !forced.has(line.txId)) continue;
      const placeHit = TRIP_LIKE_GROUPS.has(line.group!)
        && (t.place === 'melbourne' ? line.loc === 'vic' : t.place === 'overseas' ? line.loc === 'fx' : false);
      list.push({ line, during, auto: during && (placeHit || line.category === 'Travel/Holidays') });
    }
    candidates[t.id] = list;
  }

  const owner = new Map<string, string>();
  for (const t of ordered) for (const id of inc(t)) if (!owner.has(id)) owner.set(id, t.id);
  for (const t of ordered) {
    const unticked = exc(t);
    for (const c of candidates[t.id]) {
      if (c.auto && !unticked.has(c.line.txId) && !owner.has(c.line.txId)) owner.set(c.line.txId, t.id);
    }
  }

  const perTrip: Record<string, TripTotals> = {};
  for (const t of ordered) perTrip[t.id] = { total: 0, lines: 0, buckets: {} };
  const byMonth: Record<string, number> = {}, byGroup: Record<string, number> = {}, byCategory: Record<string, number> = {};
  let total = 0;
  for (const line of spend) {
    const id = owner.get(line.txId);
    if (!id || !perTrip[id]) continue;
    const p = perTrip[id], v = out(line), m = line.date.slice(0, 7);
    p.total += v; p.lines++;
    p.buckets[line.bucket!] = (p.buckets[line.bucket!] ?? 0) + v;
    byMonth[m] = (byMonth[m] ?? 0) + v;
    byGroup[line.group!] = (byGroup[line.group!] ?? 0) + v;
    byCategory[line.category!] = (byCategory[line.category!] ?? 0) + v;
    total += v;
  }
  return { owner, candidates, perTrip, byMonth, byGroup, byCategory, total };
}

export interface Suggestion { start: string; end: string; lines: number; total: number }

/** Largest gap in days between Victoria-tagged lines that still counts as one visit. */
export const SUGGESTION_GAP_DAYS = 3;

const overlaps = (a: DateRange, b: DateRange) => !(a.to < b.from || a.from > b.to);

/**
 * Clusters of Victoria-tagged, trip-like lines: gap ≤ 3 days, at least 2 days and 3 lines or
 * 6+ lines. Hidden if it overlaps an existing trip (± 2 days) or any dismissed range.
 */
export function suggestTrips(lines: Line[], trips: Trip[], dismissed: DateRange[]): Suggestion[] {
  const vic = lines.filter(l => l.kind === 'spend' && l.loc === 'vic' && TRIP_LIKE_GROUPS.has(l.group!));
  const clusters: { start: string; end: string; n: number }[] = [];
  for (const d of vic.map(l => l.date).sort()) {
    const c = clusters[clusters.length - 1];
    if (c && daysBetween(c.end, d) <= SUGGESTION_GAP_DAYS) { c.end = d; c.n++; } else clusters.push({ start: d, end: d, n: 1 });
  }
  return clusters
    .filter(c => (daysBetween(c.start, c.end) >= 1 && c.n >= 3) || c.n >= 6)
    .filter(c => !dismissed.some(r => overlaps(r, { from: c.start, to: c.end })))
    .filter(c => !trips.some(t => overlaps({ from: t.start, to: t.end }, { from: addDays(c.start, -2), to: addDays(c.end, 2) })))
    .map(c => ({
      start: c.start, end: c.end, lines: c.n,
      total: vic.filter(l => l.date >= c.start && l.date <= c.end).reduce((a, l) => a + out(l), 0),
    }));
}

/** The trip dates the "Add trip" button uses: the suggestion padded one day each side. */
export const tripDatesFor = (s: Suggestion): { start: string; end: string } =>
  ({ start: addDays(s.start, -1), end: addDays(s.end, 1) });

// Reading and writing household data in Supabase. Plain functions that take a client, so the
// app and the Node tests share them. Money crosses the wire as dollars (numeric(12,2)) and is
// integer cents everywhere else.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Bucket, ClassifyResult, IncomeSource, Kind, Line, LineOverride, Loc, SkipReason } from './classify';
import type { Database } from './database.types';
import type { DateRange } from './summary';
import type { Trip, TripOverride } from './trips';
import type { Cadence, RecurringSeries } from './recurring';
import { seriesKeyOf, type RegularStatus, type StoredRegular } from './regulars';

export type Db = SupabaseClient<Database>;
type LineRow = Database['public']['Tables']['lines']['Row'];
type LineInsert = Database['public']['Tables']['lines']['Insert'];

export const BATCH_SIZE = 500;
/** PostgREST returns at most this many rows per request, so reads page through. */
const PAGE_SIZE = 1000;

/** Unwraps a Supabase response: throws its error, or returns data (never null on success). */
function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export interface Member { userId: string; displayName: string | null }
export interface Household { id: string; name: string; members: Member[] }

/** The signed-in person's household, or null if they haven't been added to one. */
export async function loadHousehold(db: Db): Promise<Household | null> {
  const homes = must(await db.from('households').select('id, name').limit(1));
  if (!homes.length) return null;
  const members = must(await db.from('household_members').select('user_id, display_name').eq('household_id', homes[0].id));
  return { ...homes[0], members: members.map(m => ({ userId: m.user_id!, displayName: m.display_name })) };
}

export interface ImportRecord {
  id: string;
  uploadedBy: string | null;
  fileName: string | null;
  range: DateRange;
  lineCount: number;
  skippedCount: number;
  skippedReasons: Partial<Record<SkipReason | 'excluded', number>>;
  createdAt: string;
}

export async function loadImports(db: Db, householdId: string): Promise<ImportRecord[]> {
  const rows = must(await db.from('imports').select('*').eq('household_id', householdId).order('created_at', { ascending: false }));
  return rows.map(r => ({
    id: r.id, uploadedBy: r.uploaded_by, fileName: r.source_filename,
    range: { from: r.from_date, to: r.to_date }, lineCount: r.line_count ?? 0, skippedCount: r.skipped_count ?? 0,
    skippedReasons: (r.skipped_reasons ?? {}) as ImportRecord['skippedReasons'], createdAt: r.created_at!,
  }));
}

const toDollars = (cents: number) => cents / 100;
const toCents = (dollars: number) => Math.round(dollars * 100);

export function toLineRow(l: Line, householdId: string, importId: string): LineInsert {
  return {
    household_id: householdId, tx_id: l.txId, import_id: importId, date: l.date, name: l.name,
    amount: toDollars(l.amount), kind: l.kind, income_source: l.incomeSource, category: l.category,
    grp: l.group, bucket: l.bucket, loc: l.loc, account: l.account, label: l.label,
    review: l.review, needs_review: l.review !== null,
  };
}

export function fromLineRow(r: LineRow): Line {
  return {
    txId: r.tx_id, date: r.date, name: r.name, amount: toCents(r.amount), kind: r.kind as Kind,
    incomeSource: r.income_source as IncomeSource | null, category: r.category, group: r.grp,
    bucket: r.bucket as Bucket | null, loc: r.loc as Loc, account: r.account ?? '', label: r.label, review: r.review,
  };
}

/** Every stored line for the household, oldest first. */
export async function loadLines(db: Db, householdId: string): Promise<Line[]> {
  const out: Line[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = must(await db.from('lines').select('*').eq('household_id', householdId)
      .order('date').order('tx_id').range(from, from + PAGE_SIZE - 1));
    out.push(...page.map(fromLineRow));
    if (page.length < PAGE_SIZE) return out;
  }
}

/** Stored lines that count (excluded rows are stored but never counted). */
export async function countLines(db: Db, householdId: string): Promise<number> {
  const res = await db.from('lines').select('tx_id', { count: 'exact', head: true })
    .eq('household_id', householdId).neq('kind', 'excluded');
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

/** Counts are lines that count: excluded rows are stored too but left out of every figure. */
export interface ImportOutcome { importId: string; saved: number; newLines: number; total: number }

/**
 * Saves a classified file: one `imports` row, then the lines upserted by transaction id in
 * batches, so importing an overlapping export updates lines instead of duplicating them.
 * Manual changes live in line_overrides and are never touched. If any batch fails, the imports
 * row is removed again so the history never claims data that isn't there; re-running is safe.
 */
export async function importClassified(
  db: Db,
  householdId: string,
  fileName: string,
  result: ClassifyResult,
  onProgress?: (saved: number, total: number) => void,
): Promise<ImportOutcome> {
  const { lines, skipped } = result;
  // The range covers lines that count, like the averaging window; an excluded manual row (a
  // property valuation) can be dated after the export's last transaction.
  const dates = lines.filter(l => l.kind !== 'excluded').map(l => l.date).sort();
  if (!dates.length) throw new Error('This file has no transactions to import.');
  const excluded = lines.length - dates.length;
  const skippedReasons: Record<string, number> = excluded ? { excluded } : {};
  for (const s of skipped) skippedReasons[s.reason] = (skippedReasons[s.reason] ?? 0) + 1;

  const before = await countLines(db, householdId);
  const imp = must<{ id: string }>(await db.from('imports').insert({
    household_id: householdId, source_filename: fileName, from_date: dates[0], to_date: dates[dates.length - 1],
    line_count: dates.length, skipped_count: skipped.length + excluded, skipped_reasons: skippedReasons,
  }).select('id').single());

  try {
    for (let i = 0; i < lines.length; i += BATCH_SIZE) {
      const batch = lines.slice(i, i + BATCH_SIZE).map(l => toLineRow(l, householdId, imp.id));
      must(await db.from('lines').upsert(batch, { onConflict: 'household_id,tx_id' }));
      onProgress?.(Math.min(i + BATCH_SIZE, lines.length), lines.length);
    }
  } catch (e) {
    await db.from('imports').delete().eq('id', imp.id);
    throw e;
  }
  // Touch the imports row once every line is in: the other phone refetched lines when the row
  // appeared (before the lines), and this change tells it to fetch them again.
  must(await db.from('imports').update({ line_count: dates.length }).eq('id', imp.id));
  const total = await countLines(db, householdId);
  return { importId: imp.id, saved: dates.length, newLines: total - before, total };
}

export async function loadOverrides(db: Db, householdId: string): Promise<LineOverride[]> {
  const rows = must(await db.from('line_overrides').select('tx_id, kind, category').eq('household_id', householdId));
  return rows.map(r => ({ txId: r.tx_id, kind: r.kind as Kind | null, category: r.category }));
}

/** Saves one manual decision about a line. It survives re-imports: lines and overrides are separate. */
export async function saveOverride(db: Db, householdId: string, o: LineOverride): Promise<void> {
  const { data } = await db.auth.getUser();
  must(await db.from('line_overrides').upsert({
    household_id: householdId, tx_id: o.txId, kind: o.kind ?? null, category: o.category ?? null,
    updated_by: data.user?.id ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: 'household_id,tx_id' }));
}

export async function clearOverride(db: Db, householdId: string, txId: string): Promise<void> {
  must(await db.from('line_overrides').delete().eq('household_id', householdId).eq('tx_id', txId));
}

export interface UserSettings { hideTrips: boolean | null; windowMonths: 3 | 6 | 12 }

/** This person's own view choices (row-level security keeps them private to each of you). */
export async function loadUserSettings(db: Db, householdId: string, userId: string): Promise<UserSettings> {
  const rows = must(await db.from('user_settings').select('hide_trips, window_months').eq('household_id', householdId).eq('user_id', userId));
  const r = rows[0];
  return { hideTrips: r?.hide_trips ?? null, windowMonths: ((r?.window_months ?? 12) as UserSettings['windowMonths']) };
}

export async function saveUserSettings(db: Db, householdId: string, userId: string, s: UserSettings): Promise<void> {
  must(await db.from('user_settings').upsert(
    { household_id: householdId, user_id: userId, hide_trips: s.hideTrips, window_months: s.windowMonths },
    { onConflict: 'household_id,user_id' },
  ));
}

export interface StoredTrip extends Trip { name: string; kind: 'family' | 'holiday' | 'work'; rechargeToBusiness: boolean }

export async function loadTrips(db: Db, householdId: string): Promise<{ trips: StoredTrip[]; overrides: TripOverride[] }> {
  const trips = must(await db.from('trips').select('*').eq('household_id', householdId).order('start_date'));
  const overrides = must(await db.from('trip_overrides').select('trip_id, tx_id, included').eq('household_id', householdId));
  return {
    trips: trips.map(t => ({
      id: t.id, name: t.name, start: t.start_date, end: t.end_date, place: t.place as Trip['place'],
      kind: t.kind as StoredTrip['kind'], rechargeToBusiness: !!t.recharge_to_business,
    })),
    overrides: overrides.map(o => ({ tripId: o.trip_id, txId: o.tx_id, included: o.included })),
  };
}

/** What the business owed before the data starts (shared by the household), in cents. */
export async function loadBusinessOwed(db: Db, householdId: string): Promise<{ amount: number; asOf: string } | null> {
  const rows = must(await db.from('settings').select('business_owed_before, business_owed_as_of').eq('household_id', householdId));
  const r = rows[0];
  return r?.business_owed_before != null && r.business_owed_as_of ? { amount: toCents(r.business_owed_before), asOf: r.business_owed_as_of } : null;
}

/** Saves only these two columns, so the offset balance in the same row is untouched. */
export async function saveBusinessOwed(db: Db, householdId: string, value: { amount: number; asOf: string } | null): Promise<void> {
  must(await db.from('settings').upsert({
    household_id: householdId,
    business_owed_before: value ? toDollars(value.amount) : null,
    business_owed_as_of: value?.asOf ?? null,
  }, { onConflict: 'household_id' }));
}

export interface TripInput { name: string; start: string; end: string; kind: StoredTrip['kind']; place: Trip['place']; rechargeToBusiness?: boolean }

export async function createTrip(db: Db, householdId: string, t: TripInput): Promise<string> {
  const { data: user } = await db.auth.getUser();
  const row = must<{ id: string }>(await db.from('trips').insert({
    household_id: householdId, name: t.name, start_date: t.start, end_date: t.end, kind: t.kind, place: t.place,
    recharge_to_business: t.rechargeToBusiness ?? false, created_by: user.user?.id ?? null,
  }).select('id').single());
  return row.id;
}

export async function updateTrip(db: Db, householdId: string, id: string, t: TripInput): Promise<void> {
  must(await db.from('trips').update({
    name: t.name, start_date: t.start, end_date: t.end, kind: t.kind, place: t.place,
    recharge_to_business: t.kind === 'work' && (t.rechargeToBusiness ?? false),
  }).eq('household_id', householdId).eq('id', id));
}

/** Deleting a trip also removes its ticks and unticks (on delete cascade). */
export async function deleteTrip(db: Db, householdId: string, id: string): Promise<void> {
  must(await db.from('trips').delete().eq('household_id', householdId).eq('id', id));
}

/** Tick (true) or untick (false) a line on a trip; null goes back to the automatic choice. */
export async function setTripTick(db: Db, householdId: string, tripId: string, txId: string, included: boolean | null): Promise<void> {
  if (included === null) {
    must(await db.from('trip_overrides').delete().eq('household_id', householdId).eq('trip_id', tripId).eq('tx_id', txId));
  } else {
    must(await db.from('trip_overrides').upsert({ household_id: householdId, trip_id: tripId, tx_id: txId, included }, { onConflict: 'trip_id,tx_id' }));
  }
}

export async function loadDismissed(db: Db, householdId: string): Promise<DateRange[]> {
  const rows = must(await db.from('dismissed_suggestions').select('from_date, to_date').eq('household_id', householdId));
  return rows.map(r => ({ from: r.from_date, to: r.to_date }));
}

export async function dismissSuggestion(db: Db, householdId: string, r: DateRange): Promise<void> {
  must(await db.from('dismissed_suggestions').insert({ household_id: householdId, from_date: r.from, to_date: r.to }));
}

/** Undo "Not a trip": forget every dismissed range that overlaps this one. */
export async function undismiss(db: Db, householdId: string, r: DateRange): Promise<void> {
  must(await db.from('dismissed_suggestions').delete().eq('household_id', householdId).lte('from_date', r.to).gte('to_date', r.from));
}

export interface Goal { id: string; name: string; amount: number | null; targetMonth: string | null; saved: number; sort: number }

export async function loadGoals(db: Db, householdId: string): Promise<Goal[]> {
  const rows = must(await db.from('goals').select('*').eq('household_id', householdId).order('sort').order('id'));
  return rows.map(g => ({
    id: g.id, name: g.name, amount: g.amount == null ? null : toCents(g.amount),
    targetMonth: g.target_month ? g.target_month.slice(0, 7) : null, saved: toCents(g.saved ?? 0), sort: g.sort ?? 0,
  }));
}

export async function createGoal(db: Db, householdId: string, g: Omit<Goal, 'id'>): Promise<string> {
  const row = must<{ id: string }>(await db.from('goals').insert({
    household_id: householdId, name: g.name, amount: g.amount == null ? null : toDollars(g.amount),
    target_month: g.targetMonth ? `${g.targetMonth}-01` : null, saved: toDollars(g.saved), sort: g.sort,
  }).select('id').single());
  return row.id;
}

export async function updateGoal(db: Db, householdId: string, g: Goal): Promise<void> {
  must(await db.from('goals').update({
    name: g.name, amount: g.amount == null ? null : toDollars(g.amount),
    target_month: g.targetMonth ? `${g.targetMonth}-01` : null, saved: toDollars(g.saved), sort: g.sort,
  }).eq('household_id', householdId).eq('id', g.id));
}

export async function deleteGoal(db: Db, householdId: string, id: string): Promise<void> {
  must(await db.from('goals').delete().eq('household_id', householdId).eq('id', id));
}

export interface Targets { amounts: Record<string, number | null>; trim: Record<string, boolean | null> }

export async function loadTargets(db: Db, householdId: string): Promise<Targets> {
  const rows = must(await db.from('targets').select('grp, monthly_target, trimmable').eq('household_id', householdId));
  const out: Targets = { amounts: {}, trim: {} };
  for (const r of rows) {
    out.amounts[r.grp!] = r.monthly_target == null ? null : toCents(r.monthly_target);
    out.trim[r.grp!] = r.trimmable;
  }
  return out;
}

/** Saves targets for the given groups (null amount = use the average; null trim = use the default). */
export async function saveTargets(db: Db, householdId: string, rows: { group: string; amount: number | null; trim: boolean | null }[]): Promise<void> {
  if (!rows.length) return;
  must(await db.from('targets').upsert(rows.map(r => ({
    household_id: householdId, grp: r.group, monthly_target: r.amount == null ? null : toDollars(r.amount), trimmable: r.trim,
  })), { onConflict: 'household_id,grp' }));
}

export async function resetTargets(db: Db, householdId: string): Promise<void> {
  must(await db.from('targets').update({ monthly_target: null }).eq('household_id', householdId));
}

export interface Offset { balance: number | null; asOf: string | null }

export async function loadOffset(db: Db, householdId: string): Promise<Offset> {
  const rows = must(await db.from('settings').select('offset_balance, offset_as_of').eq('household_id', householdId));
  const r = rows[0];
  return { balance: r?.offset_balance == null ? null : toCents(r.offset_balance), asOf: r?.offset_as_of ?? null };
}

/** Saves only the offset columns, leaving the business starting figure in the same row alone. */
export async function saveOffset(db: Db, householdId: string, o: Offset): Promise<void> {
  must(await db.from('settings').upsert({
    household_id: householdId, offset_balance: o.balance == null ? null : toDollars(o.balance), offset_as_of: o.asOf,
  }, { onConflict: 'household_id' }));
}

const fromRegularRow = (r: Database['public']['Tables']['regulars']['Row']): StoredRegular => ({
  id: r.id, seriesKey: r.series_key, txIds: r.tx_ids, status: r.status as RegularStatus, statusChangedAt: r.status_changed_at,
  name: r.name, amount: r.amount == null ? null : toCents(r.amount), cadence: r.cadence as Cadence | null,
  nextDue: r.next_due, group: r.grp, note: r.note,
});

export async function loadRegulars(db: Db, householdId: string): Promise<StoredRegular[]> {
  return must(await db.from('regulars').select('*').eq('household_id', householdId).order('id')).map(fromRegularRow);
}

/**
 * Saves a choice about a detected series. The row keeps every transaction id it has seen, so the
 * choice still matches after a price change or once older payments leave the data.
 */
export async function setSeriesStatus(db: Db, householdId: string, series: RecurringSeries, stored: StoredRegular | null, status: RegularStatus): Promise<string> {
  const values = {
    series_key: seriesKeyOf(series), tx_ids: [...new Set([...(stored?.txIds ?? []), ...series.txIds])],
    status, status_changed_at: new Date().toISOString(),
  };
  if (stored) {
    must(await db.from('regulars').update(values).eq('household_id', householdId).eq('id', stored.id));
    return stored.id;
  }
  return must<{ id: string }>(await db.from('regulars').insert({ household_id: householdId, ...values }).select('id').single()).id;
}

export interface ManualRegular { name: string; amount: number; cadence: Cadence; nextDue: string | null; group: string | null; note?: string | null }

const manualRow = (m: ManualRegular) => ({
  name: m.name, amount: toDollars(m.amount), cadence: m.cadence, next_due: m.nextDue, grp: m.group, note: m.note ?? null,
});

export async function addRegular(db: Db, householdId: string, m: ManualRegular): Promise<string> {
  return must<{ id: string }>(await db.from('regulars').insert({ household_id: householdId, ...manualRow(m) }).select('id').single()).id;
}

export async function updateRegular(db: Db, householdId: string, id: string, m: ManualRegular): Promise<void> {
  must(await db.from('regulars').update(manualRow(m)).eq('household_id', householdId).eq('id', id));
}

export async function setRegularStatus(db: Db, householdId: string, id: string, status: RegularStatus): Promise<void> {
  must(await db.from('regulars').update({ status, status_changed_at: new Date().toISOString() }).eq('household_id', householdId).eq('id', id));
}

export async function deleteRegular(db: Db, householdId: string, id: string): Promise<void> {
  must(await db.from('regulars').delete().eq('household_id', householdId).eq('id', id));
}

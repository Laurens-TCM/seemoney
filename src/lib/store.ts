// Reading and writing household data in Supabase. Plain functions that take a client, so the
// app and the Node tests share them. Money crosses the wire as dollars (numeric(12,2)) and is
// integer cents everywhere else.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Bucket, ClassifyResult, IncomeSource, Kind, Line, Loc, SkipReason } from './classify';
import type { Database } from './database.types';
import type { DateRange } from './summary';

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
  const total = await countLines(db, householdId);
  return { importId: imp.id, saved: dates.length, newLines: total - before, total };
}

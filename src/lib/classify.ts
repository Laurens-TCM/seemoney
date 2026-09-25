// Turns Frollo export rows into classified lines. The single source of truth for classification:
// see docs/DATA-RULES.md (rule numbers below refer to its "Kinds" table). Pure: no I/O.
import { householdRules, type HouseholdRules } from '../config/household-rules';

export type Kind =
  | 'income' | 'other_in' | 'spend' | 'internal' | 'loan_in'
  | 'business_loan' | 'business_loan_repaid' | 'capital' | 'excluded';
export type IncomeSource = 'Salary' | 'TCM pay' | 'Government' | 'Interest' | 'Tax refund';
export type Bucket = 'Flights' | 'Accommodation' | 'Food & drink' | 'Getting around' | 'Activities' | 'Other';
export type Loc = 'vic' | 'fx' | null;

export interface Line {
  txId: string;
  date: string; // YYYY-MM-DD
  name: string;
  amount: number; // integer cents, signed as in Frollo (money out is negative)
  kind: Kind;
  incomeSource: IncomeSource | null;
  category: string | null; // spend lines only, after remaps
  group: string | null; // spend lines only
  bucket: Bucket | null; // spend lines only
  loc: Loc; // spend lines only
  account: string;
  label: string | null; // business loan / capital label
  review: string | null; // why this line needs a person to check it
}

export type SkipReason = 'no transaction id' | 'no date' | 'amount not a number' | 'pending';
export interface SkippedRow { row: number; reason: SkipReason; txId: string | null }
export interface ClassifyResult { lines: Line[]; skipped: SkippedRow[] }

/** A manual change to one line, keyed by transaction id. Survives re-imports. */
export interface LineOverride { txId: string; kind?: Kind | null; category?: string | null }

export type FrolloRow = Record<string, string | undefined>;

export const REQUIRED_COLUMNS = [
  'transaction_id', 'description', 'amount', 'transaction_date',
  'account_name', 'category_name', 'merchant_name', 'included',
] as const;

export function missingColumns(fields: readonly string[]): string[] {
  return REQUIRED_COLUMNS.filter(c => !fields.includes(c));
}

export const GROUPS: Record<string, string[]> = {
  'Home & bills': ['Mortgage interest', 'Utilities', 'Insurance', 'Home Renovation & Maintenance', 'Furniture & Homeware', 'Cable/Satellite/Telecom'],
  'Groceries': ['Groceries'],
  'Eating out & drinks': ['Restaurants', 'Takeaway & Snacks', 'Cafes & Coffee', 'Bars & Pubs', 'Alcohol'],
  'Travel & holidays': ['Travel/Holidays'],
  'Car & transport': ['Automotive', 'Petrol', 'Taxi & Rideshare', 'Public Transport'],
  'Health & fitness': ['Healthcare/Medical', 'Gyms & Fitness', 'Beauty & Well-being'],
  'Kids & school': ['Child/Dependent Expenses', 'Education'],
  'Pets': ['Pets/Pet Care'],
  'Shopping': ['Clothing/Shoes', 'General Merchandise', 'Electronics', 'Gifts'],
  'Fun & hobbies': ['Entertainment/Recreation', 'Hobbies', 'Subscriptions/Renewals', 'Gambling & Lotteries'],
  'Payments to people': ['Payments to people'],
  'Other': ['Memberships & union', 'Other', 'Uncategorised'],
};
const CATEGORY_GROUP = new Map(Object.entries(GROUPS).flatMap(([g, cats]) => cats.map(c => [c, g] as const)));
export const groupOf = (category: string): string => CATEGORY_GROUP.get(category) ?? 'Other';

const INCOME_CATEGORIES: Record<string, IncomeSource> = {
  'Salary/Regular Income': 'Salary',
  'Government Benefits': 'Government',
  'Interest Income': 'Interest',
  'Taxes': 'Tax refund',
};
const INTERNAL_CATEGORIES = new Set(['Credit Card Payments', 'Transfer Between Accounts', 'Savings', 'Mortgage']);
const OTHER_IN_CATEGORIES = new Set(['Transfer In', 'Refunds/Adjustments', 'Uncategorised']);

const FLIGHTS_RE = /QANTAS|JETSTAR|VIRGIN AU|AIRASIA|SINGAPOREAIR|HKEXPRESS|AIRWAYS|AIRLINES|REX AIR|BONZA/;
const STAY_RE = /HOTEL|MOTEL|AIRBNB|BOOKING\.COM|BKG\*|LODGE|YOTEL|APARTMENT|RESORT|STAYZ|HOSTEL/;
const FX_RE = /\b[A-Z]{3} \d+(\.\d+)? AUD\b|\b(USD|HKD|SGD|KRW|MYR|EUR|GBP|JPY|NZD|IDR|THB)\b/;
/** Card descriptions cut the place to this many characters ("WEST FOOTSCRA"). */
const PLACE_WIDTH = 13;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsRe = (words: string[]) => new RegExp('\\b(' + words.map(escapeRe).join('|') + ')\\b');

/** Money string to integer cents. NaN when it isn't a number. */
export function toCents(value: string | undefined): number {
  const n = parseFloat(value ?? '');
  return Number.isNaN(n) ? NaN : Math.round(n * 100);
}

/** Display name: merchant unless "Unknown", else the cleaned description. Matches the reference. */
export function displayName(row: FrolloRow): string {
  const merchant = (row.merchant_name ?? '').trim();
  if (merchant && merchant !== 'Unknown') return merchant;
  let d = (row.description ?? '').replace(/\s{2,}/g, ' ').trim();
  d = d.replace(/^ANZ (MOBILE|INTERNET) BANKING (PAYMENT|TRANSFER) \d+\s*/i, '');
  d = d.replace(/^PAYMENT\s+/i, '').replace(/^VISA DEBIT PURCHASE CARD \d+\s*/i, '');
  d = d.replace(/\b\d{5,}\b/g, '').replace(/\s{2,}/g, ' ').trim();
  d = d.replace(/^TO /i, '').replace(/^FROM /i, 'From ');
  return d.slice(0, 34).trim();
}

export const titleCase = (s: string): string =>
  s.replace(/\w\S*/g, w =>
    w.length <= 3 && /^(TO|OF|AND|THE|PTY|LTD|NT)$/i.test(w)
      ? (/^(To|of|and|the)$/i.test(w) ? w.toLowerCase() : w.toUpperCase())
      : w[0].toUpperCase() + w.slice(1).toLowerCase());

/** Builds the per-line tagging functions for a set of household rules. */
function tagger(rules: HouseholdRules) {
  const places = rules.vicPlaces.flatMap(p => (p.length > PLACE_WIDTH ? [p, p.slice(0, PLACE_WIDTH)] : [p]));
  const vicRe = wordsRe(places);
  const vicAmbiguousRe = wordsRe(rules.vicAmbiguous);
  return {
    loc(rawUpper: string): Loc {
      const place = rules.notAPlace.some(re => re.test(rawUpper)) ? '' : rawUpper;
      if (vicRe.test(place) || (vicAmbiguousRe.test(place) && /\b(VIC|MELB)/.test(place))) return 'vic';
      return FX_RE.test(rawUpper) ? 'fx' : null;
    },
    bucket(rawUpper: string, category: string, group: string): Bucket {
      if (FLIGHTS_RE.test(rawUpper) && !/INFLIGHT/.test(rawUpper)) return 'Flights';
      if (STAY_RE.test(rawUpper) && category === 'Travel/Holidays') return 'Accommodation';
      if (group === 'Eating out & drinks' || group === 'Groceries' || /INFLIGHT/.test(rawUpper)) return 'Food & drink';
      if (group === 'Car & transport') return 'Getting around';
      if (group === 'Fun & hobbies') return 'Activities';
      return 'Other';
    },
  };
}

function remap(category: string, descUpper: string, rules: HouseholdRules): string {
  for (const r of rules.remaps) if (r.pattern.test(descUpper)) return r.category;
  if (category === 'Transfer Out') return 'Payments to people';
  if (category === 'Other Expenses') return 'Other';
  return category;
}

type Draft = Pick<Line, 'kind'> & Partial<Pick<Line, 'incomeSource' | 'label' | 'review'>> & {
  /** Category for spend lines, and the name to use instead of the display name. */
  category?: string; name?: string;
};

/** Rules 2–16 for one row that wasn't skipped or excluded (rule 1). */
function kindOf(amt: number, descUpper: string, account: string, frolloCategory: string, rules: HouseholdRules): Draft {
  const isLoanAccount = /home loan|mortgage|loan/i.test(account) && !/offset/i.test(account);
  if (isLoanAccount) {
    if (amt > 0) return { kind: 'loan_in' }; // 2
    return { kind: 'spend', category: 'Mortgage interest', name: 'Home loan interest' }; // 3
  }
  if (amt < 0 && rules.loanRepaymentPayee.test(descUpper)) return { kind: 'internal' }; // 4
  if (frolloCategory === 'Credit Card Payments' && rules.cardAccount.test(account.toUpperCase()) !== amt > 0) {
    if (amt > 0) return { kind: 'other_in' }; // 5
    return { kind: 'spend', category: 'Uncategorised', review: 'Check category: Frollo called this a card repayment' }; // 6
  }
  if (INTERNAL_CATEGORIES.has(frolloCategory)) return { kind: 'internal' }; // 7
  if (rules.businessName.test(descUpper) && amt < 0) return { kind: 'business_loan', label: rules.businessLoanLabel }; // 8
  // 9 (business_loan_repaid) only comes from a manual override.
  const capital = rules.capitalItems.find(c => c.pattern.test(descUpper));
  if (capital && amt > 0) return { kind: 'other_in', label: `Refund: ${capital.label}` }; // 11
  if (capital) return { kind: 'capital', label: capital.label }; // 10
  if (amt > 0) {
    if (rules.businessName.test(descUpper)) return { kind: 'income', incomeSource: 'TCM pay' }; // 12
    const source = INCOME_CATEGORIES[frolloCategory];
    if (source) return { kind: 'income', incomeSource: source }; // 13
    if (OTHER_IN_CATEGORIES.has(frolloCategory)) return { kind: 'other_in' }; // 14
  }
  return { kind: 'spend', category: remap(frolloCategory, descUpper, rules) }; // 15 (refund), 16
}

/**
 * Applies saved manual changes to stored lines (which no longer have Frollo's raw description).
 * An override also answers any review question on the line. A new category re-derives the group
 * and trip bucket; the bucket reads the display name in place of the description, which still
 * recognises airlines and stays.
 */
export function applyOverrides(lines: Line[], overrides: LineOverride[], rules: HouseholdRules = householdRules): Line[] {
  if (!overrides.length) return lines;
  const tags = tagger(rules);
  const byId = new Map(overrides.map(o => [o.txId, o]));
  return lines.map(l => {
    const o = byId.get(l.txId);
    if (!o || l.kind === 'excluded') return l;
    const line: Line = { ...l, review: null };
    if (o.kind) {
      line.kind = o.kind;
      if (o.kind !== 'income') line.incomeSource = null;
    }
    if (line.kind === 'spend') {
      const category = (o.category ?? line.category) || 'Uncategorised';
      if (category !== l.category || line.group === null) {
        line.category = category;
        line.group = groupOf(category);
        line.bucket = tags.bucket(line.name.toUpperCase(), category, line.group);
      }
    } else {
      Object.assign(line, { category: null, group: null, bucket: null, loc: null });
    }
    return line;
  });
}

export function classifyRows(
  rows: FrolloRow[],
  rules: HouseholdRules = householdRules,
  overrides: LineOverride[] = [],
): ClassifyResult {
  const tags = tagger(rules);
  const overrideById = new Map(overrides.map(o => [o.txId, o]));
  const lines: Line[] = [];
  const skipped: SkippedRow[] = [];

  rows.forEach((r, i) => {
    const txId = String(r.transaction_id ?? '').trim();
    const amount = toCents(r.amount);
    const date = (r.transaction_date ?? '').slice(0, 10);
    const skip = (reason: SkipReason) => skipped.push({ row: i + 2, reason, txId: txId || null }); // +2: header, 1-based
    if (!txId) return skip('no transaction id');
    if (!date) return skip('no date');
    if (Number.isNaN(amount)) return skip('amount not a number');
    // Pending card authorisations have no posted date and come back with a new id once posted.
    if ('posted_date' in r && !String(r.posted_date ?? '').trim()) return skip('pending');

    const description = r.description ?? '';
    const descUpper = description.toUpperCase();
    const account = r.account_name ?? '';
    const frolloCategory = r.category_name || 'Uncategorised';
    const base: Line = {
      txId, date, amount, account, name: titleCase(displayName(r)),
      kind: 'excluded', incomeSource: null, category: null, group: null, bucket: null, loc: null,
      label: null, review: null,
    };
    if (String(r.included).toLowerCase() === 'false' || /increase account balance/i.test(description)) {
      lines.push(base); // 1
      return;
    }

    const draft = kindOf(amount, descUpper, account, frolloCategory, rules);
    const line: Line = {
      ...base, kind: draft.kind, incomeSource: draft.incomeSource ?? null, label: draft.label ?? null,
      review: draft.review ?? null,
    };
    let category = draft.category ?? null;
    if (draft.name) line.name = titleCase(draft.name);

    const override = overrideById.get(txId);
    if (override) line.review = null; // a manual decision answers any question about the line
    if (override?.kind) {
      line.kind = override.kind;
      if (line.kind !== 'income') line.incomeSource = null;
      if (line.kind === 'spend' && !category) category = remap(frolloCategory, descUpper, rules);
    }
    if (override?.category && line.kind === 'spend') category = override.category;

    if (line.kind === 'spend' && category) {
      line.category = category;
      line.group = groupOf(category);
      line.bucket = tags.bucket(descUpper, category, line.group);
      line.loc = tags.loc(descUpper);
    }
    lines.push(line);
  });
  return { lines, skipped };
}

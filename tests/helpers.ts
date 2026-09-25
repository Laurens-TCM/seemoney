// Test helpers: load CSVs and convert results to the shape of fixtures/expected-summary.json
// (dollars, field names from reference/process.js).
import { readFileSync } from 'node:fs';
import { classifyRows, type ClassifyResult, type Line } from '../src/lib/classify';
import { parseFrolloCsv } from '../src/lib/csv';
import { daysIn, summarise } from '../src/lib/summary';

export const dollars = (cents: number) => Math.round(cents) / 100;
const mapValues = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, dollars(v)]));

export function classifyFile(path: string): ClassifyResult {
  const { rows, missing } = parseFrolloCsv(readFileSync(path, 'utf8'));
  if (missing.length) throw new Error(`${path} is missing columns: ${missing.join(', ')}`);
  return classifyRows(rows);
}

export function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}

export function referenceShape({ lines, skipped }: ClassifyResult) {
  const s = summarise(lines);
  const spend = lines.filter(l => l.kind === 'spend');
  const t = s.totals;
  return {
    from: s.range?.from, to: s.range?.to, days: s.range ? daysIn(s.range) : 0,
    used: s.used,
    skipped: skipped.length + s.excluded,
    totals: {
      income: dollars(t.income), otherIn: dollars(t.otherIn), spend: dollars(t.spend),
      loanIn: dollars(t.loanIn), loanInterest: dollars(t.loanInterest), tcmLoan: dollars(t.businessLent),
      oneOff: dollars(t.capital), incomeBySource: mapValues(t.incomeBySource), loanPrincipal: dollars(t.loanPrincipal),
    },
    oneOffs: s.oneOffs.map(o => ({ d: o.date, what: o.what, amt: dollars(o.amount), kind: o.kind })),
    months: s.months.map(m => ({ m: m.month, income: dollars(m.income), otherIn: dollars(m.otherIn), spend: dollars(m.spend), byGroup: mapValues(m.byGroup) })),
    spendLineCount: spend.length,
    victoriaTagged: spend.filter(l => l.loc === 'vic').map(l => ({ id: l.txId, name: l.name, group: l.group })),
    foreignTagged: spend.filter(l => l.loc === 'fx').map(l => ({ id: l.txId, name: l.name })),
    flights: spend.filter(l => l.bucket === 'Flights').map(l => ({ id: l.txId, date: l.date, amount: dollars(-l.amount) })),
    buckets: countBy(spend, l => l.bucket!),
    skippedReasons: { ...countBy(skipped, r => r.reason), ...(s.excluded ? { excluded: s.excluded } : {}) },
    reviews: lines.filter(l => l.review).map(l => [l.txId, l.review]),
  };
}

export const byId = (lines: Line[], id: string) => {
  const l = lines.find(x => x.txId === id);
  if (!l) throw new Error(`no line ${id}`);
  return l;
};

// DATA-RULES test 3. Runs only on this machine: data/ is git-ignored, so CI has no CSVs.
// Real figures are read from data/expected-real.json at test time, never written here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFrolloCsv } from '../src/lib/csv';
import { businessRepaymentChecks } from '../src/lib/summary';
import { allocateTrips, suggestTrips, tripDatesFor } from '../src/lib/trips';
import { classifyFile, dollars, referenceShape } from './helpers';

const csvs = existsSync('data') ? readdirSync('data').filter(f => f.toLowerCase().endsWith('.csv')) : [];
const expected = existsSync('data/expected-real.json')
  ? JSON.parse(readFileSync('data/expected-real.json', 'utf8'))
  : null;
const named = expected && csvs.includes(expected.file) ? expected : null;

// Always runs, so the reason shows by name in the results instead of the checks passing silently.
const status = !csvs.length ? 'Real-data test skipped: no CSV in data/'
  : !named ? `Real-data totals skipped: ${expected ? `${expected.file} is not in data/` : 'no data/expected-real.json'}`
  : `Real-data test ran on ${csvs.join(', ')}`;
it(status, () => {});

describe.skipIf(!csvs.length)('real exports in data/', () => {
  for (const file of csvs) {
    it(`${file}: every row is classified or skipped, without throwing`, () => {
      const { rows } = parseFrolloCsv(readFileSync(`data/${file}`, 'utf8'));
      const { lines, skipped } = classifyFile(`data/${file}`);
      expect(lines.length + skipped.length).toBe(rows.length);
      expect(new Set(lines.map(l => l.txId)).size).toBe(lines.length);
    });
  }
});

describe.skipIf(!named)('matches data/expected-real.json', () => {
  const result = named ? classifyFile(`data/${named.file}`) : { lines: [], skipped: [] };
  const shape = referenceShape(result);

  for (const key of ['from', 'to', 'days', 'used', 'skipped', 'skippedReasons', 'spendLineCount', 'totals'] as const) {
    it(key, () => expect(shape[key]).toEqual(named[key]));
  }

  it('review count', () => expect(shape.reviews).toHaveLength(named.reviewCount));

  it('pay-or-repayment checks', () => {
    expect(businessRepaymentChecks(result.lines).map(l => dollars(l.amount))).toEqual(named.tcmReviewFlags);
  });

  const suggestions = suggestTrips(result.lines, [], []);
  it('trip suggestions', () => {
    expect(suggestions.map(s => ({ start: s.start, end: s.end, lines: s.lines }))).toEqual(named.suggestions);
  });

  it('trip totals after adding every suggestion', () => {
    const trips = suggestions.map((s, i) => ({ id: `t${i}`, ...tripDatesFor(s), place: 'melbourne' as const }));
    const a = allocateTrips(result.lines, trips, []);
    const got = trips.map(t => ({ start: t.start, end: t.end, lines: a.perTrip[t.id].lines, total: dollars(a.perTrip[t.id].total) }));
    expect(got).toEqual(named.trips.trips);
    expect(dollars(a.total)).toBe(named.trips.total);
  });
});

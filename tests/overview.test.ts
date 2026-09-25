// Phase 4 acceptance: Overview figures. Real-data checks read data/expected-real.json at test time.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { businessBalance, buildOverview } from '../src/lib/overview';
import { applyOverrides } from '../src/lib/classify';
import { DAYS_PER_MONTH } from '../src/lib/summary';
import { allocateTrips, suggestTrips, tripDatesFor } from '../src/lib/trips';
import { classifyFile, dollars } from './helpers';

const sumPm = (xs: { perMonth: number }[]) => xs.reduce((a, x) => a + x.perMonth, 0);

describe('what the business still owes', () => {
  const { lines } = classifyFile('fixtures/sample-frollo.csv');
  // Lent $10,000 on 5 Mar; tag a $2,950 pay line from 19 Jan as a repayment.
  const tagged = applyOverrides(lines, [{ txId: '1004', kind: 'business_loan_repaid' }]);

  it('adds lending and takes off repayments since the starting figure', () => {
    expect(businessBalance(tagged, { amount: 500_000, asOf: '2026-01-02' }))
      .toEqual({ owedBefore: 500_000, asOf: '2026-01-02', lent: 1_000_000, repaid: 295_000, stillOwed: 1_205_000 });
  });

  it('ignores movements before the starting date, and waits for a starting figure', () => {
    expect(businessBalance(tagged, { amount: 0, asOf: '2026-02-01' })).toMatchObject({ repaid: 0, stillOwed: 1_000_000 });
    expect(businessBalance(tagged, null)).toBeNull();
  });
});

describe('overview on the sample', () => {
  const { lines } = classifyFile('fixtures/sample-frollo.csv');
  const imports = [{ from: '2026-01-02', to: '2026-03-28' }];
  const o = buildOverview({ lines, imports, windowMonths: 3, hideTrips: false })!;

  it('averages over the days the data covers inside the window', () => {
    expect(o.window).toEqual({ from: '2025-12-28', to: '2026-03-28' });
    expect(o.covered).toBe(86);
    expect(o.pm.spend).toBeCloseTo(o.summary.totals.spend / (86 / DAYS_PER_MONTH), 6);
    expect(o.missing).toEqual([]);
  });

  it('adds every group up to the spending figure, and every category up to its group', () => {
    // Groups and categories under 50c a month aren't listed, so allow that much per hidden row.
    expect(Math.abs(sumPm(o.groups) - o.pm.spend)).toBeLessThan(50 * 12);
    for (const g of o.groups) expect(Math.abs(sumPm(g.categories) - g.perMonth), g.group).toBeLessThan(50 * 5);
  });

  it('marks part-months in the chart', () => {
    expect(o.bars.map(b => [b.month, b.partial])).toEqual([['2026-01', true], ['2026-02', false], ['2026-03', true]]);
  });

  it('names a gap between two imports', () => {
    const gapped = buildOverview({ lines, imports: [{ from: '2026-01-02', to: '2026-01-31' }, { from: '2026-03-02', to: '2026-03-28' }], windowMonths: 3, hideTrips: false })!;
    expect(gapped.missing).toEqual([{ from: '2026-02-01', to: '2026-03-01' }]);
    expect(gapped.covered).toBe(30 + 27);
  });

  it('lists capital items and business lending separately', () => {
    expect(o.capital).toEqual([{ what: 'Solar install (OneRoof)', amount: 500_000, payments: 1, from: '2026-02-20', to: '2026-02-20' }]);
    expect(o.business).toMatchObject({ lent: 1_000_000, repaid: 0 });
  });
});

const expected = existsSync('data/expected-real.json') ? JSON.parse(readFileSync('data/expected-real.json', 'utf8')) : null;
const realFile = expected && existsSync(`data/${expected.file}`) ? `data/${expected.file}` : null;

it(realFile ? 'Overview real-data test ran' : 'Overview real-data test skipped: no real export in data/', () => {});

describe.skipIf(!realFile)('overview on the real export (12 months)', () => {
  const { lines } = realFile ? classifyFile(realFile) : { lines: [] };
  const imports = expected ? [{ from: expected.from, to: expected.to }] : [];
  const o = realFile ? buildOverview({ lines, imports, windowMonths: 12, hideTrips: true })! : (null as never);

  it('covers exactly the verified 365 days', () => {
    expect(o.window).toEqual({ from: expected.from, to: expected.to });
    expect(o.covered).toBe(expected.days);
    expect(o.missing).toEqual([]);
  });

  it('matches the verified totals to the cent', () => {
    const t = o.summary.totals;
    expect(dollars(t.income)).toBe(expected.totals.income);
    expect(dollars(t.spend)).toBe(expected.totals.spend);
    expect(dollars(t.otherIn)).toBe(expected.totals.otherIn);
    expect(dollars(t.loanPrincipal)).toBe(expected.totals.loanPrincipal);
    expect(dollars(t.businessLent)).toBe(expected.totals.tcmLoan);
    expect(dollars(t.capital)).toBe(expected.totals.oneOff);
  });

  it('gives per-month figures as total ÷ (365 ÷ 30.4375)', () => {
    const months = expected.days / DAYS_PER_MONTH;
    expect(o.pm.spend).toBeCloseTo((expected.totals.spend * 100) / months, 6);
    expect(o.pm.income).toBeCloseTo((expected.totals.income * 100) / months, 6);
    expect(o.pm.principal).toBeCloseTo((expected.totals.loanPrincipal * 100) / months, 6);
  });

  it('leaves the verified trip spending out of regular spending when asked', () => {
    const trips = suggestTrips(lines, [], []).map((s, i) => ({ id: `t${i}`, ...tripDatesFor(s), place: 'melbourne' as const }));
    const alloc = allocateTrips(lines, trips, []);
    const withTrips = buildOverview({ lines, imports, windowMonths: 12, hideTrips: true, trips: alloc })!;
    const months = expected.days / DAYS_PER_MONTH;
    expect(withTrips.hideTrips).toBe(true);
    expect(withTrips.pm.trips).toBeCloseTo((expected.trips.total * 100) / months, 6);
    expect(withTrips.pm.regular).toBeCloseTo(((expected.totals.spend - expected.trips.total) * 100) / months, 4);
    const listed = sumPm(withTrips.groups);
    expect(Math.abs(listed - withTrips.pm.regular)).toBeLessThan(100); // only sub-50c groups are unlisted
    expect(withTrips.bars.reduce((a, b) => a + b.trips, 0)).toBe(Math.round(expected.trips.total * 100));
  });

  it('shows the solar install as one item paid in two parts', () => {
    expect(o.capital).toEqual([{ what: 'Solar install (OneRoof)', amount: expected.totals.oneOff * 100, payments: 2, from: '2026-02-22', to: '2026-02-23' }]);
  });

  it('shows 13 calendar months with the first and last faded as part-months', () => {
    expect(o.bars).toHaveLength(13);
    expect(o.bars.filter(b => b.partial).map(b => b.month)).toEqual(['2025-09', '2026-09']);
  });
});

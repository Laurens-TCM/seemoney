// DATA-RULES test 4: averaging window with two imports and a gap.
import { describe, expect, it } from 'vitest';
import type { Line } from '../src/lib/classify';
import { coveredDays, DAYS_PER_MONTH, missingRanges, perMonth, summarise, windowFor } from '../src/lib/summary';

const spend = (txId: string, date: string, dollarsOut: number): Line => ({
  txId, date, name: 'Shop', amount: -dollarsOut * 100, kind: 'spend', incomeSource: null,
  category: 'Groceries', group: 'Groceries', bucket: 'Food & drink', loc: null, account: 'Visa', label: null, review: null,
});

describe('averaging window', () => {
  it('uses 365, 183 and 91 days ending on the newest line', () => {
    expect(windowFor('2026-09-24', 12)).toEqual({ from: '2025-09-25', to: '2026-09-24' });
    expect(windowFor('2026-09-24', 6)).toEqual({ from: '2026-03-26', to: '2026-09-24' });
    expect(windowFor('2026-09-24', 3)).toEqual({ from: '2026-06-26', to: '2026-09-24' });
  });

  // Two exports: Jan to Mar and May to Jun 2026, so April is missing.
  const imports = [{ from: '2026-01-01', to: '2026-03-31' }, { from: '2026-05-01', to: '2026-06-30' }];
  const win = { from: '2026-01-01', to: '2026-06-30' };
  const lines = [spend('a', '2026-01-10', 100), spend('b', '2026-03-10', 200), spend('c', '2026-05-10', 300), spend('d', '2025-12-31', 999)];

  it('counts only the days an import covers', () => {
    expect(coveredDays(win, imports)).toBe(90 + 61);
  });

  it('names the missing range', () => {
    expect(missingRanges(win, imports)).toEqual([{ from: '2026-04-01', to: '2026-04-30' }]);
    expect(missingRanges(win, [{ from: '2025-06-01', to: '2026-12-31' }])).toEqual([]);
  });

  it('merges overlapping imports instead of double-counting days', () => {
    expect(coveredDays(win, [...imports, { from: '2026-03-01', to: '2026-05-15' }])).toBe(181);
  });

  it('averages the window total over covered days, ignoring lines outside the window', () => {
    const total = summarise(lines, win).totals.spend;
    expect(total).toBe(60_000);
    expect(perMonth(total, coveredDays(win, imports))).toBeCloseTo(60_000 / (151 / DAYS_PER_MONTH), 6);
  });
});

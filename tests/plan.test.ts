import { describe, expect, it } from 'vitest';
import { goalMonthly, leftToSpend, monthsUntil, shareCut, targetFor, trimGroups } from '../src/lib/plan';

describe('goals', () => {
  it('counts months left including this month and the target month', () => {
    expect(monthsUntil('2026-09', '2026-09-25')).toBe(1);
    expect(monthsUntil('2027-08', '2026-09-25')).toBe(12);
    expect(monthsUntil('2026-07', '2026-09-25')).toBe(-1);
    expect(monthsUntil(null, '2026-09-25')).toBe(0);
  });

  it('spreads what is left over the months left', () => {
    expect(goalMonthly({ amount: 1_200_000, saved: 200_000, targetMonth: '2027-08' }, '2026-09-25')).toBeCloseTo(1_000_000 / 12);
  });

  it('asks for the whole remainder once the month has passed, and nothing once saved', () => {
    expect(goalMonthly({ amount: 500_000, saved: 100_000, targetMonth: '2026-01' }, '2026-09-25')).toBe(400_000);
    expect(goalMonthly({ amount: 500_000, saved: 600_000, targetMonth: '2027-01' }, '2026-09-25')).toBe(0);
  });

  it('works out what is left to spend', () => {
    expect(leftToSpend(1_600_000, 180_000, 100_000)).toBe(1_320_000);
  });
});

describe('targets and sharing the cut', () => {
  const averages = { 'Home & bills': 500_000, 'Groceries': 180_040, 'Eating out & drinks': 90_000, 'Shopping': 60_000, 'Pets': 20 };

  it('uses a saved target, else the average rounded to $10', () => {
    expect(targetFor('Groceries', averages, {})).toBe(180_000);
    expect(targetFor('Groceries', averages, { Groceries: 150_000 })).toBe(150_000);
  });

  it('uses the trim defaults unless a tick was saved', () => {
    const groups = Object.keys(averages);
    expect([...trimGroups(groups, {})]).toEqual(['Eating out & drinks', 'Shopping']);
    expect([...trimGroups(groups, { Shopping: false, Groceries: true })]).toEqual(['Groceries', 'Eating out & drinks']);
  });

  it('cuts ticked groups in proportion and leaves the rest alone', () => {
    // Targets total 830,000; budget 780,000; need 50,000 from 150,000 ticked, so keep 2/3.
    const r = shareCut(averages, {}, new Set(['Eating out & drinks', 'Shopping']), 780_000);
    expect(r).toEqual({
      status: 'shared',
      targets: { 'Home & bills': 500_000, 'Groceries': 180_000, 'Eating out & drinks': 60_000, 'Shopping': 40_000 },
    });
  });

  it('rounds each cut target to the nearest $10', () => {
    // Need 37,770c from 150,000c ticked: ratio 0.7482, so $673.38 → $670 and $448.92 → $450.
    const r = shareCut(averages, {}, new Set(['Eating out & drinks', 'Shopping']), 792_230);
    expect(r).toMatchObject({ status: 'shared', targets: { 'Eating out & drinks': 67_000, 'Shopping': 45_000 } });
  });

  it('says so when targets already fit, nothing is ticked, or the cut is too deep', () => {
    expect(shareCut(averages, {}, new Set(['Shopping']), 900_000)).toEqual({ status: 'fits' });
    expect(shareCut(averages, {}, new Set(), 700_000)).toEqual({ status: 'nothing-ticked' });
    expect(shareCut(averages, {}, new Set(['Shopping']), 100_000)).toMatchObject({ status: 'not-enough', targets: { Shopping: 0 } });
  });
});

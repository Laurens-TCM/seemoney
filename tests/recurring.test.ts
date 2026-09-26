// v2 Phase 8: regular payments. Real figures are read from data/expected-real.json at test time.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectRecurring, recurringInputs, type RecurringInput } from '../src/lib/recurring';
import { classifyFile, dollars } from './helpers';

const fixture = JSON.parse(readFileSync('fixtures/recurring-lines.json', 'utf8'));
const expected = JSON.parse(readFileSync('fixtures/expected-recurring.json', 'utf8'));
const cents = (l: { amount: number }) => Math.round(l.amount * 100);
const inputs: RecurringInput[] = fixture.lines.map((l: RecurringInput) => ({ ...l, amount: cents(l) }));

/** Our series in the reference's shape (dollars, rounded as it rounds). */
const asReference = (r: ReturnType<typeof detectRecurring>[number]) => ({
  key: r.key, name: r.name, category: r.category, group: r.group, cadence: r.cadence, count: r.count,
  typical: dollars(r.typical), last: dollars(r.last), lastDate: r.lastDate, next: r.next, active: r.active,
  perMonth: dollars(r.perMonth), perYear: dollars(r.perYear), priceChange: dollars(r.priceChange), first: r.first, idCount: r.txIds.length,
});

describe('regular payments on the fixture', () => {
  it('matches fixtures/expected-recurring.json exactly', () => {
    expect(detectRecurring(inputs, fixture.dataEnd).map(asReference)).toEqual(expected);
  });

  it('gives the same result with or without the price-step rule', () => {
    expect(detectRecurring(inputs, fixture.dataEnd)).toEqual(detectRecurring(inputs, fixture.dataEnd, { priceSteps: false }));
  });

  it('merges a small price rise, counts a weekly box with a varying price, and skips a restaurant', () => {
    const found = detectRecurring(inputs, fixture.dataEnd);
    expect(found.find(r => r.key === 'NETFLIX')).toMatchObject({ count: 9, priceChange: 200, active: true });
    expect(found.find(r => r.key === 'HELLOFRESH')).toMatchObject({ cadence: 'weekly', count: 10 });
    const merchants = new Set(fixture.lines.map((l: RecurringInput) => l.name));
    expect(merchants.size).toBeGreaterThan(found.length); // something in the fixture is not a regular
    expect(found.find(r => r.key === 'FERNWOOD FITNESS')).toMatchObject({ active: false, next: null });
  });
});

describe('a price step over 15%', () => {
  const pay = (id: string, date: string, dollarsOut: number): RecurringInput =>
    ({ id, date, name: 'ALLIANZ INSURE', amount: Math.round(dollarsOut * 100), category: 'Insurance', group: 'Home & bills' });
  const months = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-07', '2026-05-05', '2026-06-05', '2026-07-06', '2026-08-05'];
  const lines = [...months.map((d, i) => pay(`a${i}`, d, 310.98)), pay('a8', '2026-09-07', 367.98)];

  it('continues the series at the new price instead of stopping it', () => {
    const [s] = detectRecurring(lines, '2026-09-24');
    expect(s).toMatchObject({ count: 9, active: true, typical: 36_798, priceChange: 36_798 - 31_098, next: '2026-10-07' });
  });

  it('is what the reference does without the rule: the old price looks stopped', () => {
    const [s] = detectRecurring(lines, '2026-09-24', { priceSteps: false });
    // Last old-price payment 5 Aug, data to 24 Sep: 50 days, more than a month plus tolerance.
    expect(s).toMatchObject({ count: 8, active: false, next: null, typical: 31_098, priceChange: 0 });
  });

  it('does not join a run that is more than 50% away', () => {
    const [s] = detectRecurring([...lines.slice(0, 8), pay('b', '2026-09-07', 900)], '2026-09-24');
    expect(s.count).toBe(8);
  });
});

const real = existsSync('data/expected-real.json') ? JSON.parse(readFileSync('data/expected-real.json', 'utf8')) : null;
const realFile = real?.recurring && existsSync(`data/${real.file}`) ? `data/${real.file}` : null;

it(realFile ? 'Recurring real-data test ran' : 'Recurring real-data test skipped: no real export in data/', () => {});

describe.skipIf(!realFile)('regular payments on the real export', () => {
  const lines = realFile ? recurringInputs(classifyFile(realFile).lines) : [];
  const summary = (priceSteps: boolean) => {
    const found = detectRecurring(lines, real.to, { priceSteps }), active = found.filter(r => r.active);
    return { found: found.length, active: active.length, activePerMonth: Math.round(active.reduce((a, r) => a + dollars(r.perMonth) * 100, 0)) / 100 };
  };

  it('reproduces the reference counts exactly without the price-step rule', () => {
    expect(summary(false)).toEqual(real.recurringReference ?? real.recurring);
  });

  it('matches the recorded counts with the price-step rule', () => {
    const { found, active, activePerMonth } = real.recurring;
    expect(summary(true)).toEqual({ found, active, activePerMonth });
  });
});

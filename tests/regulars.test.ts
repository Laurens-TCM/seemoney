import { describe, expect, it } from 'vitest';
import { detectRecurring, type RecurringInput } from '../src/lib/recurring';
import { bucketOf, buildRegulars, dueDays, matchStored, rollForward, seriesKeyOf, stoppedFrom, type StoredRegular } from '../src/lib/regulars';

const pay = (id: string, date: string, name: string, dollars: number, group: string, category = ''): RecurringInput =>
  ({ id, date, name, amount: Math.round(dollars * 100), group, category });
const weekly = (prefix: string, name: string, dollars: number, from: string, n: number, group = 'Fun & hobbies') =>
  Array.from({ length: n }, (_, i) => pay(`${prefix}${i}`, new Date(Date.parse(from) + i * 7 * 864e5).toISOString().slice(0, 10), name, dollars, group));

// Two TeamPay series (weekly $10 and $15), a monthly streaming service, and loan interest.
const lines = [
  ...weekly('t', 'TEAMPAY - SPORTS', 10, '2026-06-06', 16),
  ...weekly('u', 'TEAMPAY - SPORTS', 15, '2026-06-02', 16),
  ...['2026-04-14', '2026-05-14', '2026-06-14', '2026-07-14', '2026-08-14', '2026-09-14'].map((d, i) => pay(`d${i}`, d, 'Disney Plus', 24.99, 'Fun & hobbies', 'Entertainment/Recreation')),
  ...['2026-06-25', '2026-07-23', '2026-08-23', '2026-09-20'].map((d, i) => pay(`c${i}`, d, 'Chalkie Pro', 15.51, 'Shopping', 'Electronics')),
  ...['2026-05-30', '2026-06-30', '2026-07-30', '2026-08-31'].map((d, i) => pay(`i${i}`, d, 'Home Loan Interest', 2900, 'Home & bills', 'Mortgage interest')),
];
const DATA_END = '2026-09-20', TODAY = '2026-09-25';
const series = detectRecurring(lines, DATA_END);
const stored = (over: Partial<StoredRegular>): StoredRegular => ({
  id: 'r1', seriesKey: null, txIds: [], status: 'keep', statusChangedAt: null,
  name: null, amount: null, cadence: null, nextDue: null, group: null, note: null, ...over,
});

describe('joining choices to regulars', () => {
  it('keeps the two TeamPay series apart by their transactions', () => {
    const ten = series.find(s => s.typical === 1000)!, fifteen = series.find(s => s.typical === 1500)!;
    expect(seriesKeyOf(ten)).toBe(seriesKeyOf(fifteen));
    const m = matchStored(series, [stored({ id: 'cancel15', seriesKey: seriesKeyOf(fifteen), txIds: fifteen.txIds.slice(0, 3), status: 'cancel' })]);
    expect(m.get(fifteen)?.id).toBe('cancel15');
    expect(m.has(ten)).toBe(false);
  });

  it('still finds a choice by merchant and cadence once its transactions have left the data', () => {
    const disney = series.find(s => s.key.startsWith('DISNEY'))!;
    const m = matchStored(series, [stored({ id: 'old', seriesKey: seriesKeyOf(disney), txIds: ['gone-1', 'gone-2'], status: 'review' })]);
    expect(m.get(disney)?.id).toBe('old');
  });
});

describe('the Regulars view', () => {
  const view = buildRegulars(series, [
    stored({ id: 'nr', seriesKey: null, txIds: series.find(s => s.typical === 1000)!.txIds, status: 'not_regular' }),
    stored({ id: 'bin', name: 'Council bins', amount: 45_000, cadence: 'yearly', nextDue: '2026-07-01', group: 'Home & bills' }),
  ], DATA_END, TODAY);

  it('shows loan interest separately and leaves it out of the total', () => {
    expect(view.loanInterest?.name).toBe('Home Loan Interest');
    expect(view.active.some(r => r.loanInterest)).toBe(false);
    expect(view.perMonth).toBeCloseTo(view.active.reduce((a, r) => a + r.perMonth, 0), 6);
  });

  it('hides a "not a regular" series but keeps it listed for undo', () => {
    expect(view.active.some(r => r.id === 'nr')).toBe(false);
    expect(view.notRegular.map(r => r.id)).toEqual(['nr']);
  });

  it('adds hand-added regulars, rolling their due date forward past today', () => {
    const bins = view.active.find(r => r.id === 'bin')!;
    expect(bins).toMatchObject({ perMonth: 45_000 / 12, bucket: 'Bills & insurance' });
    expect(bins.next! >= TODAY).toBe(true);
  });

  it('splits the monthly cost into groups that add up to the total', () => {
    const sum = Object.values(view.byBucket).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(view.perMonth, 6);
    expect(view.byBucket.Subscriptions).toBeGreaterThan(0);
  });

  it('marks recently started regulars as new', () => {
    expect(view.active.find(r => r.name === 'Disney Plus')!.isNew).toBe(false); // since April
    expect(view.active.find(r => r.name === 'TEAMPAY - SPORTS')!.isNew).toBe(false); // since early June: 110 days
    expect(view.active.find(r => r.name === 'Chalkie Pro')!.isNew).toBe(true); // since 25 June: 87 days
  });
});

describe('helpers', () => {
  it('puts regulars in the right header group', () => {
    expect(bucketOf('Payments to people', 'Payments to people', 'Karen Taylor')).toBe('People');
    expect(bucketOf('Pets', 'Pets/Pet Care', 'Pet Insurance')).toBe('Bills & insurance');
    expect(bucketOf('Other', 'Services/Supplies', 'Chatgpt')).toBe('Subscriptions');
    expect(bucketOf('Kids & school', 'Child/Dependent Expenses', 'Wagaman Oshc')).toBe('Kids & school');
    expect(bucketOf('Other', 'Service Charges/Fees', 'Account Servicing Fee')).toBe('Other');
  });

  it('rolls a due date forward by its cadence', () => {
    expect(rollForward('2026-07-01', 'monthly', '2026-09-25')).toBe('2026-10-01'); // stays on the 1st
    expect(rollForward('2026-01-31', 'monthly', '2026-02-10')).toBe('2026-02-28'); // then back to the 31st
    expect(rollForward('2026-01-31', 'monthly', '2026-03-10')).toBe('2026-03-31');
    expect(rollForward('2026-09-11', 'fortnightly', '2026-09-25')).toBe('2026-09-25');
    expect(rollForward('2026-10-01', 'yearly', '2026-09-25')).toBe('2026-10-01');
  });

  it('puts each regular on the days it comes out this month', () => {
    const view = buildRegulars(series, [], DATA_END, TODAY);
    const days = dueDays(view, '2026-09');
    expect(days.get(14)?.map(r => r.name)).toContain('Disney Plus');
    const loanDay = [...days.entries()].find(([, rs]) => rs.some(r => r.loanInterest));
    expect(loanDay).toBeTruthy(); // loan interest shows on the calendar too
  });
});

describe('stopped regulars', () => {
  it('counts the saving from the first payment that did not come', () => {
    const old = [...['2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10'].map((d, i) => pay(`s${i}`, d, 'Stan', 12, 'Fun & hobbies', 'Entertainment/Recreation'))];
    const view = buildRegulars(detectRecurring(old, DATA_END), [], DATA_END, TODAY);
    expect(view.stopped.map(r => r.name)).toEqual(['Stan']);
    expect(stoppedFrom(view.stopped[0])).toBe('2026-05-10');
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Line } from '../src/lib/classify';
import { allocateEvents, automaticEvents, suggestLabels, type StoredEvent } from '../src/lib/events';
import { classifyFile } from './helpers';

let n = 0;
/** A classified line; amount in dollars, signed as in Frollo (money out is negative). */
const L = (date: string, dollars: number, over: Partial<Line> = {}): Line => ({
  txId: `x${n++}`, date, name: 'Something', amount: Math.round(dollars * 100), kind: 'spend', incomeSource: null,
  category: 'Shopping', group: 'Shopping', bucket: null, loc: null, account: 'Offset', label: null, review: null, ...over,
});
const weekly = (from: string, count: number, make: (d: string) => Line) =>
  Array.from({ length: count }, (_, i) => make(new Date(Date.parse(from) + i * 7 * 864e5).toISOString().slice(0, 10)));
const fortnightly = (from: string, count: number, make: (d: string) => Line) =>
  Array.from({ length: count }, (_, i) => make(new Date(Date.parse(from) + i * 14 * 864e5).toISOString().slice(0, 10)));
const trip = (id: string, start: string, end: string): StoredEvent =>
  ({ id, type: 'trip', name: id, start, end, kind: 'family', place: 'melbourne', rechargeToBusiness: false });
const big = (id: string, date: string): StoredEvent =>
  ({ id, type: 'big', name: id, start: date, end: date, kind: null, place: null, rechargeToBusiness: false });

describe('automatic events', () => {
  it('makes one big purchase from a capital item paid in two parts', () => {
    const ev = automaticEvents([
      L('2026-02-22', -14_050, { kind: 'capital', label: 'Solar install' }),
      L('2026-02-23', -14_050, { kind: 'capital', label: 'Solar install' }),
    ]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'big', name: 'Solar install', start: '2026-02-22', end: '2026-02-23', total: 2_810_000, direction: 'out' });
  });

  it('merges business-loan payments made within a week, and keeps repayments apart', () => {
    const label = 'Loan to the business';
    const ev = automaticEvents([
      L('2026-05-20', -5_000, { kind: 'business_loan', label }),
      L('2026-05-25', -20_000, { kind: 'business_loan', label }),
      L('2026-06-10', -20_000, { kind: 'business_loan', label }),
      L('2026-06-12', 10_000, { kind: 'business_loan_repaid' }),
    ]);
    expect(ev.map(e => [e.type, e.name, e.start, e.total, e.direction])).toEqual([
      ['loan', 'Business loan repaid', '2026-06-12', 1_000_000, 'in'],
      ['loan', label, '2026-06-10', 2_000_000, 'out'],
      ['loan', label, '2026-05-20', 2_500_000, 'out'],
    ]);
  });

  it('finds an extra home-loan payment outside the weekly repayments', () => {
    const repayments = weekly('2026-01-05', 20, d => L(d, 1_450, { kind: 'loan_in', name: 'Home loan repayment' }));
    const extra = L('2026-03-11', 1_000, { kind: 'loan_in', name: 'Home loan repayment' });
    const ev = automaticEvents([...repayments, extra]);
    expect(ev.map(e => [e.name, e.start, e.total])).toEqual([['Extra home-loan payment', '2026-03-11', 100_000]]);
  });

  it('finds income well above what its source usually pays, and big tax refunds', () => {
    const pay = fortnightly('2026-01-01', 20, d => L(d, 3_920.28, { kind: 'income', incomeSource: 'Salary', name: 'Pay' }));
    const ev = automaticEvents([
      ...pay,
      L('2026-01-26', 6_660.85, { kind: 'income', incomeSource: 'Salary', name: 'Pay' }), // more than 1.5× usual
      L('2026-02-02', 2_500, { kind: 'income', incomeSource: 'TCM pay' }),
      L('2026-02-16', 2_450, { kind: 'income', incomeSource: 'TCM pay' }),
      L('2026-03-02', 2_444, { kind: 'income', incomeSource: 'TCM pay' }),
      L('2026-03-09', 10_000, { kind: 'income', incomeSource: 'TCM pay' }),
      L('2026-07-03', 2_100, { kind: 'income', incomeSource: 'Tax refund' }),
      L('2026-07-04', 1_900, { kind: 'income', incomeSource: 'Tax refund' }), // under $2,000
    ]);
    expect(ev.map(e => [e.name, e.start, e.total, e.direction])).toEqual([
      ['Tax refund', '2026-07-03', 210_000, 'in'],
      ['TCM pay, more than usual', '2026-03-09', 1_000_000, 'in'],
      ['Salary, more than usual', '2026-01-26', 666_085, 'in'],
    ]);
  });

  it('finds the business loan in the sample export', () => {
    const { lines } = classifyFile('fixtures/sample-frollo.csv');
    const loans = automaticEvents(lines).filter(e => e.type === 'loan');
    expect(loans.some(e => e.direction === 'out' && e.total === 1_000_000 && e.start === '2026-03-05')).toBe(true);
  });

  it('gives each automatic event a stable id', () => {
    const lines = [L('2026-02-22', -500, { kind: 'capital', label: 'Car' })];
    expect(automaticEvents(lines)[0].id).toBe(automaticEvents(lines)[0].id);
    expect(automaticEvents(lines)[0].id).toBe(`auto-big-${lines[0].txId}`);
  });
});

describe('which lines belong to which event', () => {
  const hotel = L('2026-03-10', -400, { group: 'Travel & holidays', category: 'Travel/Holidays', loc: 'vic' });
  const fridge = L('2026-03-11', -2_400, { group: 'Home & bills' });
  const lines = [hotel, fridge];

  it('allocates trips as before and labelled events only by their ticks', () => {
    const a = allocateEvents(lines, [trip('melb', '2026-03-09', '2026-03-15'), big('fridge', '2026-03-11')],
      [{ eventId: 'fridge', txId: fridge.txId, included: true }]);
    expect(a.owner.get(hotel.txId)).toEqual({ id: 'melb', type: 'trip' });
    expect(a.owner.get(fridge.txId)).toEqual({ id: 'fridge', type: 'big' });
    expect(a.perEvent.fridge).toMatchObject({ total: 240_000 });
    expect(a.trips.perTrip.melb.total).toBe(40_000);
  });

  it('lets a trip win when a line is ticked onto both', () => {
    const a = allocateEvents(lines, [trip('melb', '2026-03-09', '2026-03-15'), big('hotel', '2026-03-10')],
      [{ eventId: 'hotel', txId: hotel.txId, included: true }]);
    expect(a.owner.get(hotel.txId)?.id).toBe('melb');
    expect(a.perEvent.hotel.total).toBe(0);
  });

  it('puts nothing on a labelled event without a tick', () => {
    const a = allocateEvents(lines, [big('fridge', '2026-03-11')], []);
    expect(a.owner.size).toBe(0);
  });
});

describe('"Label this?" suggestions', () => {
  const netflix = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05'].map(d => L(d, -1_200, { name: 'Private school fees', group: 'Kids & school', category: 'Education' }));
  const car = L('2026-03-17', -2_531.82, { name: 'Car repairs', group: 'Car & transport' });
  const small = L('2026-03-18', -999.99, { name: 'Almost', group: 'Shopping' });
  const refund = L('2026-03-19', 1_500, { name: 'Refund', group: 'Shopping' });
  const lines = [...netflix, car, small, refund];

  it('offers single purchases of $1,000 or more that are not regulars', () => {
    expect(suggestLabels(lines, new Map(), new Set()).map(l => l.txId)).toEqual([car.txId]);
  });

  it('leaves out lines already in an event, dismissed ones, and uses the threshold', () => {
    expect(suggestLabels(lines, new Map([[car.txId, {}]]), new Set())).toEqual([]);
    expect(suggestLabels(lines, new Map(), new Set([car.txId]))).toEqual([]);
    expect(suggestLabels(lines, new Map(), new Set(), 99_999).map(l => l.txId)).toEqual([small.txId, car.txId]); // newest first
  });
});

// Real-data acceptance (this machine only): figures come from data/expected-real.json.
const expected = existsSync('data/expected-real.json') ? JSON.parse(readFileSync('data/expected-real.json', 'utf8')) : null;
const realFile = expected && existsSync(`data/${expected.file}`) ? `data/${expected.file}` : null;
it(realFile ? 'Events real-data test ran' : 'Events real-data test skipped: no real export in data/', () => {});

describe.skipIf(!realFile)('events in the real export', () => {
  const events = realFile ? automaticEvents(classifyFile(realFile).lines) : [];

  it('shows the solar install as one big purchase with the verified total', () => {
    const big = events.filter(e => e.type === 'big');
    expect(big).toHaveLength(1);
    expect(big[0].total).toBe(Math.round(expected.totals.oneOff * 100));
  });

  it('shows the money lent to the business as loan events adding up to the verified total', () => {
    const lent = events.filter(e => e.type === 'loan' && e.direction === 'out' && e.name !== 'Extra home-loan payment');
    expect(lent.length).toBeGreaterThan(0);
    expect(lent.reduce((a, e) => a + e.total, 0)).toBe(Math.round(expected.totals.tcmLoan * 100));
  });
});

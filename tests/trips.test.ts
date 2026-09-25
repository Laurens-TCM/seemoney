import { describe, expect, it } from 'vitest';
import type { Line } from '../src/lib/classify';
import { allocateTrips, suggestTrips, type Trip } from '../src/lib/trips';
import { byId, classifyFile } from './helpers';

const { lines } = classifyFile('fixtures/sample-frollo.csv');
// The sample's Melbourne visit: hotel 10 Mar, Don Don 11 Mar, Myki 12 Mar, Victoria Hotel 13 Mar,
// insurance billed from Melbourne 14 Mar.
const melbourne: Trip = { id: 'melb', start: '2026-03-09', end: '2026-03-15', place: 'melbourne' };

describe('trip allocation', () => {
  it('auto-ticks Victorian trip-like lines during the trip', () => {
    const a = allocateTrips(lines, [melbourne], []);
    for (const id of ['1084', '1085', '1086', '1087', '1105', '1106']) expect(a.owner.get(id), id).toBe('melb');
  });

  it('never auto-ticks the insurance billed from Melbourne', () => {
    const a = allocateTrips(lines, [melbourne], []);
    const insurance = a.candidates.melb.find(c => c.line.txId === '1088')!;
    expect(insurance.during).toBe(true);
    expect(insurance.auto).toBe(false);
    expect(a.owner.has('1088')).toBe(false);
  });

  it('lets a manual include win, even outside the trip dates', () => {
    const a = allocateTrips(lines, [melbourne], [
      { tripId: 'melb', txId: '1088', included: true },
      { tripId: 'melb', txId: '1082', included: true },
    ]);
    expect(a.owner.get('1088')).toBe('melb');
    expect(a.owner.get('1082')).toBe('melb');
  });

  it('lets a manual untick win over an automatic match', () => {
    const a = allocateTrips(lines, [melbourne], [{ tripId: 'melb', txId: '1085', included: false }]);
    expect(a.owner.has('1085')).toBe(false);
  });

  it('puts a line in one trip at most: manual includes first, then the earliest trip', () => {
    const second: Trip = { id: 'second', start: '2026-03-11', end: '2026-03-20', place: 'melbourne' };
    const auto = allocateTrips(lines, [second, melbourne], []);
    expect(auto.owner.get('1086')).toBe('melb'); // both match; the earlier start wins
    const forced = allocateTrips(lines, [second, melbourne], [{ tripId: 'second', txId: '1086', included: true }]);
    expect(forced.owner.get('1086')).toBe('second');
    const counted = Object.values(forced.perTrip).reduce((n, t) => n + t.lines, 0);
    expect(counted).toBe(forced.owner.size);
  });

  it('offers flights booked in the 4 months before, unticked', () => {
    const a = allocateTrips(lines, [melbourne], []);
    const flight = a.candidates.melb.find(c => c.line.txId === '1083')!;
    expect(flight).toMatchObject({ during: false, auto: false });
    expect(byId(lines, '1083').bucket).toBe('Flights');
  });
});

describe('trip suggestions', () => {
  const at = (txId: string, date: string): Line => ({
    txId, date, name: 'Cafe', amount: -1000, kind: 'spend', incomeSource: null, category: 'Cafes & Coffee',
    group: 'Eating out & drinks', bucket: 'Food & drink', loc: 'vic', account: 'Visa', label: null, review: null,
  });
  const visit = [at('1', '2026-04-02'), at('2', '2026-04-03'), at('3', '2026-04-05')];

  it('suggests a cluster of Victorian lines', () => {
    expect(suggestTrips(visit, [], [])).toEqual([{ start: '2026-04-02', end: '2026-04-05', lines: 3, total: 3000 }]);
  });

  it('hides a dismissed cluster even after new data shifts its dates', () => {
    const dismissed = [{ from: '2026-04-02', to: '2026-04-05' }];
    const shifted = [at('0', '2026-03-31'), ...visit, at('4', '2026-04-07')];
    expect(suggestTrips(shifted, [], dismissed)).toEqual([]);
  });

  it('hides a cluster that overlaps an existing trip', () => {
    expect(suggestTrips(visit, [{ id: 't', start: '2026-04-06', end: '2026-04-09', place: 'melbourne' }], [])).toEqual([]);
  });

  it('ignores clusters too small to be a visit', () => {
    expect(suggestTrips(visit.slice(0, 2), [], [])).toEqual([]);
  });
});

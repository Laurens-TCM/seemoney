// Phase 2 acceptance: row-level security against the real Supabase project.
// Runs only where .env.local has the keys (never in CI). Everything created is deleted afterwards;
// the real household is never read or written here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, liveFixture, liveReady, type Client } from './live';

it(liveReady ? 'RLS tests ran against the Supabase project' : 'RLS tests skipped: no Supabase keys in .env.local', () => {});

describe.skipIf(!liveReady)('row-level security', () => {
  const live = liveReady ? liveFixture() : (null as never);
  const users = {} as Record<'member' | 'other' | 'outsider', { id: string; client: Client }>;
  let homeA = '', homeB = '', tripB = '';

  beforeAll(async () => {
    for (const role of ['member', 'other', 'outsider'] as const) users[role] = await live.user(role);
    homeA = await live.household('RLS test A', [users.member.id]);
    homeB = await live.household('RLS test B', [users.other.id]);
    const t = await live.admin.from('trips').insert({ household_id: homeB, name: 'B trip', start_date: '2026-01-01', end_date: '2026-01-05' }).select('id').single();
    if (t.error) throw t.error;
    tripB = t.data.id;
  }, 60_000);

  afterAll(() => live?.cleanup(), 60_000);

  it('lets a member see only their own household', async () => {
    const { data, error } = await users.member.client.from('households').select('id');
    expect(error).toBeNull();
    expect(data!.map(h => h.id)).toEqual([homeA]);
  });

  it('lets a member read and write their household rows', async () => {
    const c = users.member.client;
    const trip = await c.from('trips').insert({ household_id: homeA, name: 'Melbourne', start_date: '2026-03-01', end_date: '2026-03-05' }).select('id').single();
    expect(trip.error).toBeNull();
    const line = await c.from('lines').insert({ household_id: homeA, tx_id: `t-${live.run}`, date: '2026-03-02', name: 'Cafe', amount: -12.5, kind: 'spend' });
    expect(line.error).toBeNull();
    const goal = await c.from('goals').insert({ household_id: homeA, name: 'Trips', amount: 5000 });
    expect(goal.error).toBeNull();
    const override = await c.from('trip_overrides').insert({ trip_id: trip.data!.id, household_id: homeA, tx_id: `t-${live.run}`, included: true });
    expect(override.error).toBeNull();
    const read = await c.from('lines').select('tx_id, amount');
    expect(read.data).toEqual([{ tx_id: `t-${live.run}`, amount: -12.5 }]);
  });

  it('stops a member writing into another household', async () => {
    const c = users.member.client;
    const trip = await c.from('trips').insert({ household_id: homeB, name: 'Sneaky', start_date: '2026-03-01', end_date: '2026-03-02' });
    expect(trip.error?.code).toBe('42501'); // row violates row-level security
    const trips = await live.admin.from('trips').select('id').eq('household_id', homeB);
    expect(trips.data).toHaveLength(1);
  });

  it('stops a trip override pointing at a trip in another household', async () => {
    const c = users.member.client;
    const own = await c.from('trip_overrides').insert({ trip_id: tripB, household_id: homeA, tx_id: 'x', included: true });
    expect(own.error?.code).toBe('23503'); // foreign key: trip isn't in household A
    const theirs = await c.from('trip_overrides').insert({ trip_id: tripB, household_id: homeB, tx_id: 'x', included: true });
    expect(theirs.error?.code).toBe('42501');
  });

  it('stops a member adding themselves to another household', async () => {
    const res = await users.member.client.from('household_members').insert({ household_id: homeB, user_id: users.member.id });
    expect(res.error).not.toBeNull();
    const members = await live.admin.from('household_members').select('user_id').eq('household_id', homeB);
    expect(members.data).toEqual([{ user_id: users.other.id }]);
  });

  it('keeps each person\'s view settings to themselves', async () => {
    const c = users.member.client;
    expect((await c.from('user_settings').insert({ household_id: homeA, user_id: users.member.id, hide_trips: false })).error).toBeNull();
    expect((await c.from('user_settings').insert({ household_id: homeA, user_id: users.other.id, hide_trips: true })).error?.code).toBe('42501');
  });

  it('shows an outsider nothing and lets them write nothing', async () => {
    const c = users.outsider.client;
    for (const table of ['households', 'household_members', 'trips', 'lines', 'goals', 'trip_overrides', 'imports', 'settings'] as const) {
      const { data, error } = await c.from(table).select('*');
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
    const write = await c.from('goals').insert({ household_id: homeA, name: 'Hijack', amount: 1 });
    expect(write.error?.code).toBe('42501');
  });

  it('shows a visitor who is not signed in nothing', async () => {
    const anon = anonClient();
    for (const table of ['households', 'lines', 'trips'] as const) {
      const { data } = await anon.from(table).select('*');
      expect(data ?? [], table).toEqual([]);
    }
  });
});

// Phase 2 acceptance: row-level security against the real Supabase project.
// Runs only where .env.local has the keys (never in CI). Uses the secret key to create throwaway
// users and two throwaway households, signs in as those users with the publishable key, and
// deletes everything it created afterwards. The real household is never read or written here.
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/database.types';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.VITE_SUPABASE_URL;
const publishable = process.env.VITE_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(url && publishable && secret);

it(ready ? 'RLS tests ran against the Supabase project' : 'RLS tests skipped: no Supabase keys in .env.local', () => {});

type Client = SupabaseClient<Database>;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!ready)('row-level security', () => {
  const admin: Client = ready ? createClient<Database>(url!, secret!, noSession) : (null as never);
  const run = randomUUID().slice(0, 8);
  const password = `Test-${randomUUID()}`;
  const users: Record<'member' | 'other' | 'outsider', { id: string; client: Client }> = {} as never;
  let homeA = '', homeB = '', tripB = '';

  async function makeUser(role: keyof typeof users) {
    const email = `rls-${role}-${run}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const client = createClient<Database>(url!, publishable!, noSession);
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    users[role] = { id: data.user.id, client };
  }

  beforeAll(async () => {
    for (const role of ['member', 'other', 'outsider'] as const) await makeUser(role);
    const a = await admin.from('households').insert({ name: `RLS test A ${run}` }).select('id').single();
    const b = await admin.from('households').insert({ name: `RLS test B ${run}` }).select('id').single();
    if (a.error || b.error) throw a.error ?? b.error;
    homeA = a.data.id; homeB = b.data.id;
    const m = await admin.from('household_members').insert([
      { household_id: homeA, user_id: users.member.id, display_name: 'Member' },
      { household_id: homeB, user_id: users.other.id, display_name: 'Other' },
    ]);
    if (m.error) throw m.error;
    const t = await admin.from('trips').insert({ household_id: homeB, name: 'B trip', start_date: '2026-01-01', end_date: '2026-01-05' }).select('id').single();
    if (t.error) throw t.error;
    tripB = t.data.id;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (homeA || homeB) await admin.from('households').delete().in('id', [homeA, homeB].filter(Boolean));
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
  }, 60_000);

  it('lets a member see only their own household', async () => {
    const { data, error } = await users.member.client.from('households').select('id');
    expect(error).toBeNull();
    expect(data!.map(h => h.id)).toEqual([homeA]);
  });

  it('lets a member read and write their household rows', async () => {
    const c = users.member.client;
    const trip = await c.from('trips').insert({ household_id: homeA, name: 'Melbourne', start_date: '2026-03-01', end_date: '2026-03-05' }).select('id').single();
    expect(trip.error).toBeNull();
    const line = await c.from('lines').insert({ household_id: homeA, tx_id: `t-${run}`, date: '2026-03-02', name: 'Cafe', amount: -12.5, kind: 'spend' });
    expect(line.error).toBeNull();
    const goal = await c.from('goals').insert({ household_id: homeA, name: 'Trips', amount: 5000 });
    expect(goal.error).toBeNull();
    const override = await c.from('trip_overrides').insert({ trip_id: trip.data!.id, household_id: homeA, tx_id: `t-${run}`, included: true });
    expect(override.error).toBeNull();
    const read = await c.from('lines').select('tx_id, amount');
    expect(read.data).toEqual([{ tx_id: `t-${run}`, amount: -12.5 }]);
  });

  it('stops a member writing into another household', async () => {
    const c = users.member.client;
    const trip = await c.from('trips').insert({ household_id: homeB, name: 'Sneaky', start_date: '2026-03-01', end_date: '2026-03-02' });
    expect(trip.error?.code).toBe('42501'); // row violates row-level security
    const trips = await admin.from('trips').select('id').eq('household_id', homeB);
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
    const members = await admin.from('household_members').select('user_id').eq('household_id', homeB);
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
    const anon = createClient<Database>(url!, publishable!, noSession);
    for (const table of ['households', 'lines', 'trips'] as const) {
      const { data } = await anon.from(table).select('*');
      expect(data ?? [], table).toEqual([]);
    }
  });
});

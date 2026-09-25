// Phase 6: goals, targets and the offset saved to the real project (local only, throwaway household).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createGoal, deleteGoal, loadBusinessOwed, loadGoals, loadOffset, loadTargets, resetTargets,
  saveBusinessOwed, saveOffset, saveTargets, updateGoal,
} from '../src/lib/store';
import { liveFixture, liveReady, type Client } from './live';

it(liveReady ? 'Plan store tests ran against the Supabase project' : 'Plan store tests skipped: no Supabase keys in .env.local', () => {});

describe.skipIf(!liveReady)('saving the plan', () => {
  const live = liveReady ? liveFixture() : (null as never);
  let db: Client, home = '';
  beforeAll(async () => { const u = await live.user('planner'); db = u.client; home = await live.household('Plan test', [u.id]); }, 60_000);
  afterAll(() => live?.cleanup(), 60_000);

  it('creates, edits and removes goals, keeping cents exact', async () => {
    const id = await createGoal(db, home, { name: 'Bali', amount: 600_050, targetMonth: '2027-06', saved: 12_345, sort: 1 });
    await updateGoal(db, home, { id, name: 'Bali trip', amount: 700_000, targetMonth: '2027-07', saved: 50_000, sort: 1 });
    expect(await loadGoals(db, home)).toEqual([{ id, name: 'Bali trip', amount: 700_000, targetMonth: '2027-07', saved: 50_000, sort: 1 }]);
    await deleteGoal(db, home, id);
    expect(await loadGoals(db, home)).toEqual([]);
  }, 30_000);

  it('saves targets and trim ticks, and resets targets to averages without losing ticks', async () => {
    await saveTargets(db, home, [{ group: 'Groceries', amount: 180_000, trim: null }, { group: 'Shopping', amount: null, trim: false }]);
    expect(await loadTargets(db, home)).toEqual({ amounts: { Groceries: 180_000, Shopping: null }, trim: { Groceries: null, Shopping: false } });
    await resetTargets(db, home);
    expect(await loadTargets(db, home)).toEqual({ amounts: { Groceries: null, Shopping: null }, trim: { Groceries: null, Shopping: false } });
  }, 30_000);

  it('saves the offset and the business starting figure without overwriting each other', async () => {
    await saveBusinessOwed(db, home, { amount: 1_000_000, asOf: '2025-09-25' });
    await saveOffset(db, home, { balance: 8_512_345, asOf: '2026-09-25' });
    expect(await loadOffset(db, home)).toEqual({ balance: 8_512_345, asOf: '2026-09-25' });
    expect(await loadBusinessOwed(db, home)).toEqual({ amount: 1_000_000, asOf: '2025-09-25' });
  }, 30_000);
});

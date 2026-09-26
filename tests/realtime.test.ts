// Phase 5 acceptance: a tick on one phone reaches the other within a few seconds (local only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { subscribeHousehold } from '../src/lib/realtime';
import { createEvent, setEventTick } from '../src/lib/store';
import { liveFixture, liveReady, type Client } from './live';

it(liveReady ? 'Realtime test ran against the Supabase project' : 'Realtime test skipped: no Supabase keys in .env.local', () => {});

describe.skipIf(!liveReady)('live updates between two phones', () => {
  const live = liveReady ? liveFixture() : (null as never);
  let phoneA: Client, phoneB: Client, outsider: Client, home = '';

  beforeAll(async () => {
    const a = await live.user('phone-a'), b = await live.user('phone-b'), o = await live.user('rt-outsider');
    phoneA = a.client; phoneB = b.client; outsider = o.client;
    home = await live.household('Realtime test', [a.id, b.id]);
    await live.household('Realtime other', [o.id]);
  }, 60_000);

  afterAll(() => live?.cleanup(), 60_000);

  function listen(db: Client, householdId: string) {
    const seen: string[] = [];
    let ready!: () => void;
    const subscribed = new Promise<void>(r => { ready = r; });
    const stop = subscribeHousehold(db, householdId, t => seen.push(t), s => { if (s === 'SUBSCRIBED') ready(); });
    return { seen, subscribed, stop };
  }
  const waitFor = async (check: () => boolean, ms: number) => {
    const until = Date.now() + ms;
    while (!check() && Date.now() < until) await new Promise(r => setTimeout(r, 100));
    return check();
  };

  it('tells phone A within 5 seconds when phone B ticks a line, and tells an outsider nothing', async () => {
    const a = listen(phoneA, home), spy = listen(outsider, home);
    await Promise.all([a.subscribed, spy.subscribed]);
    // Database changes start flowing a moment after SUBSCRIBED; the app subscribes once when it opens.
    await new Promise(r => setTimeout(r, 1500));
    const tripId = await createEvent(phoneB, home, { type: 'trip', name: 'Melbourne', start: '2026-03-01', end: '2026-03-05', kind: 'family', place: 'melbourne' });
    const started = Date.now();
    await setEventTick(phoneB, home, tripId, 'tx-1', true);
    expect(await waitFor(() => a.seen.includes('event_overrides'), 5000)).toBe(true);
    console.log(`Phone A heard about the tick in ${Date.now() - started} ms`);
    expect(a.seen).toContain('events');
    await new Promise(r => setTimeout(r, 1500));
    expect(spy.seen).toEqual([]); // row-level security applies to live events too
    a.stop(); spy.stop();
  }, 30_000);
});

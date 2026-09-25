// Live updates: when either of you changes a trip, tick, answer, goal or setting, the other
// phone refetches it. Row-level security applies to these events too.
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Db } from './store';

/** Tables that sync live, and the data each one affects (query-key prefixes). */
export const LIVE_TABLES: Record<string, string[]> = {
  trips: ['trips'],
  trip_overrides: ['trips'],
  line_overrides: ['overrides'],
  dismissed_suggestions: ['dismissed'],
  goals: ['goals'],
  targets: ['targets'],
  settings: ['business-owed', 'settings'],
  imports: ['imports', 'lines'],
};

/** Subscribes to the household's changes; returns a function that unsubscribes. */
export function subscribeHousehold(
  db: Db,
  householdId: string,
  onChange: (table: string) => void,
  onStatus?: (status: string) => void,
): () => void {
  let channel: RealtimeChannel = db.channel(`household-${householdId}`);
  for (const table of Object.keys(LIVE_TABLES)) {
    channel = channel.on('postgres_changes',
      { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` },
      () => onChange(table));
  }
  channel.subscribe(status => onStatus?.(status));
  return () => { void db.removeChannel(channel); };
}

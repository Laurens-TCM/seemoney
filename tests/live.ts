// Shared setup for tests that run against the real Supabase project (local only: they need
// .env.local). Creates throwaway users and households and removes them afterwards.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.VITE_SUPABASE_URL;
const publishable = process.env.VITE_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const liveReady = Boolean(url && publishable && secret);
export type Client = SupabaseClient<Database>;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export const anonClient = (): Client => createClient<Database>(url!, publishable!, noSession);

/** Tracks what a test file creates so `cleanup` can remove all of it. */
export function liveFixture() {
  const admin: Client = createClient<Database>(url!, secret!, noSession);
  const run = randomUUID().slice(0, 8);
  const password = `Test-${randomUUID()}`;
  const userIds: string[] = [];
  const householdIds: string[] = [];

  return {
    admin,
    run,
    /** A confirmed throwaway user, signed in with the publishable key. */
    async user(role: string): Promise<{ id: string; client: Client }> {
      const email = `rls-${role}-${run}@example.invalid`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      userIds.push(data.user.id);
      const client = anonClient();
      const signIn = await client.auth.signInWithPassword({ email, password });
      if (signIn.error) throw signIn.error;
      return { id: data.user.id, client };
    },
    /** A throwaway household with the given users as members. */
    async household(name: string, memberIds: string[]): Promise<string> {
      const h = await admin.from('households').insert({ name: `${name} ${run}` }).select('id').single();
      if (h.error) throw h.error;
      householdIds.push(h.data.id);
      if (memberIds.length) {
        const m = await admin.from('household_members').insert(memberIds.map(user_id => ({ household_id: h.data.id, user_id })));
        if (m.error) throw m.error;
      }
      return h.data.id;
    },
    async cleanup() {
      if (householdIds.length) await admin.from('households').delete().in('id', householdIds);
      for (const id of userIds) await admin.auth.admin.deleteUser(id);
    },
  };
}

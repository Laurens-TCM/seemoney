// The app's Supabase client. Only the URL and publishable key reach the browser; row-level
// security does the protecting.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local');

// Only the origin: pasting the REST address (…/rest/v1/) would break sign-in.
export const supabase = createClient<Database>(new URL(url).origin, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

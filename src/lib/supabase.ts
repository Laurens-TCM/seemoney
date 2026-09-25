// The app's Supabase client. Only the URL and publishable key reach the browser; row-level
// security does the protecting.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Set when the build had no Supabase settings (e.g. a Vercel deploy without its env vars). */
export const configError = !url || !key
  ? 'This copy of See The Money was built without its Supabase settings (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).'
  : null;

// Only the origin: pasting the REST address (…/rest/v1/) would break sign-in. The placeholder is
// never used: main.tsx shows configError instead of the app.
export const supabase = createClient<Database>(url ? new URL(url).origin : 'https://not-configured.invalid', key ?? 'none', {
  auth: { persistSession: true, autoRefreshToken: true },
});

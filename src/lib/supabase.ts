// The app's Supabase client. Only the URL and publishable key reach the browser; row-level
// security does the protecting.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/^["']|["']$/g, '').trim() : '');

/** The project origin from whatever was pasted: adds https://, drops /rest/v1/ and the like. */
function projectOrigin(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.includes('.') ? u.origin : null;
  } catch {
    return null;
  }
}

const url = projectOrigin(clean(import.meta.env.VITE_SUPABASE_URL));
const key = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

/** VITE_ names this build received (names only; their values are public anyway). Shown on the error. */
export const builtWith = Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')).map(k => JSON.stringify(k));

/** Set when the build had no usable Supabase settings (e.g. a Vercel deploy without its env vars). */
export const configError = !url
  ? `This copy of See The Money was built without a usable VITE_SUPABASE_URL${import.meta.env.VITE_SUPABASE_URL ? ' (it should look like https://abcd1234.supabase.co)' : ''}.`
  : !key ? 'This copy of See The Money was built without VITE_SUPABASE_ANON_KEY.' : null;

// The placeholder is never used: main.tsx shows configError instead of the app.
export const supabase = createClient<Database>(url ?? 'https://not-configured.invalid', key || 'none', {
  auth: { persistSession: true, autoRefreshToken: true },
});

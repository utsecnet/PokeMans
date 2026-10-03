/**
 * The one Supabase client the app uses.
 *
 * Both values below are meant to be public: the URL is a hostname, and the anon key is
 * designed to ship inside the JavaScript bundle where anyone can read it. Neither grants
 * access on its own — every table has row level security, the signed-out role holds no
 * policy and no grant, so a caller armed with both still sees an empty database until
 * they hold a session. What protects the data is the policies, not the secrecy of the key.
 *
 * The service role key is the opposite: it bypasses row level security entirely. It must
 * never appear in this directory, in an environment variable Vite can see, or anywhere a
 * browser could reach. It belongs only to server-side functions.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Failing here beats failing later: without these, every query returns a confusing
  // network error instead of saying what is actually wrong.
  throw new Error(
    'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to ' +
      'client/.env.local, then restart the dev server — Vite only reads env files at startup.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Keep the session across reloads, and renew it before it expires.
    persistSession: true,
    autoRefreshToken: true,
    // After an OAuth round trip the provider returns here with the session in the URL;
    // this picks it up and then cleans the address bar.
    detectSessionInUrl: true,
  },
});

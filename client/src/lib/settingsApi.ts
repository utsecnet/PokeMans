import { supabase } from './supabase';
import type { UnitSystem } from './units';

/**
 * Reading preferences, stored on the account.
 *
 * user_settings is a key/value row per user with row level security on it, which is where
 * display.currency and last_used_box_id already live, so a preference needs a key rather
 * than a migration. The key follows that naming.
 */
const UNITS_KEY = 'display.units';

/** Null when the account has never chosen, which the caller reads as "still the default". */
export async function fetchUnitSystem(): Promise<UnitSystem | null> {
  // No user_id filter: row level security answers with this account's row and no other.
  // limit(1) rather than single(), because having never chosen is the normal case and not
  // an error.
  const { data } = await supabase
    .from('user_settings')
    .select('value')
    .eq('key', UNITS_KEY)
    .limit(1);
  const value = data?.[0]?.value;
  return value === 'imperial' || value === 'metric' ? value : null;
}

export async function saveUnitSystem(system: UnitSystem): Promise<void> {
  // user_id defaults to auth.uid(), so the row belongs to whoever is asking.
  await supabase.from('user_settings').upsert(
    { key: UNITS_KEY, value: system, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,key' },
  );
}

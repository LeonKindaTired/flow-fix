import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.');

export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export async function ensureAnonymousSession() {
  const existing = await supabase.auth.getSession();
  if (existing.data.session) return existing.data.session;
  const result = await supabase.auth.signInAnonymously();
  if (result.error || !result.data.session) throw new Error(result.error?.message ?? 'Anonymous sign-in failed.');
  return result.data.session;
}

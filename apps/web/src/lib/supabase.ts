import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'missing-publishable-key';

export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

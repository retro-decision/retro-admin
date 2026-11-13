import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://hrqxdfwuucrknqznrpse.supabase.co';

// Public anon / publishable key (same project as the mobile app). Security is RLS.
// Never put the service_role key in this repo, env examples, or the frontend.
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhycXhkZnd1dWNya25xem5ycHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MzExNDQsImV4cCI6MjEwNTEwNzE0NH0.OmwiGJy1QkHkbqg3aOcw18E7uzIw8ila5jz1qbAZV70';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

/** OAuth redirect: dev origin, or Pages origin + /retro-admin/ in production. */
export function authRedirectTo(): string {
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString();
}

export const HELP_IMAGE_BUCKET = 'help-post-images';

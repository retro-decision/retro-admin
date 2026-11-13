-- Add an admin to help_admins (run in the production Supabase SQL Editor).
-- 1) The person must sign in to the app or this admin site at least once
--    so an auth.users row exists.
-- 2) Supabase Dashboard → Authentication → Users → copy that user's UUID.
-- 3) Replace the placeholder below. Do not commit a real uid into git.

INSERT INTO public.help_admins (user_id, note)
VALUES ('00000000-0000-0000-0000-000000000000', 'Daniel Tam')
ON CONFLICT (user_id) DO NOTHING;

-- Optional check (should return 1 after the insert):
-- SELECT count(*) FROM public.help_admins;

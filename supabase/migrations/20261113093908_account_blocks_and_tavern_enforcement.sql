-- Retro web admin v1: account_blocks + tavern participation enforcement
-- Apply this file on the production project (hrqxdfwuucrknqznrpse) via the
-- SQL Editor or `supabase db query` when 營運 is ready.
-- Do NOT insert real admin uids here. Whitelist SQL is in docs/ops-whitelist.sql.
--
-- What this does
--   1) private schema helpers (SECURITY DEFINER stays off the exposed public API)
--   2) public.account_blocks: history-preserving blocks (unlock sets unblocked_*)
--   3) RLS: only is_admin() may insert/update; admins or the subject may SELECT
--   4) Triggers + tightened INSERT/UPDATE policies: a blocked user cannot
--      create posts, edit posts/options/comments, comment, vote, cheer (乾杯),
--      follow, or file reports. Login, user_backups, personal ranks/profiles
--      are unchanged.
--   5) Admin post delete remains the existing help_posts_delete_admin policy
--      (DELETE FROM help_posts). CASCADE already removes options, votes,
--      comments, cheers, follows, notifications, and related reports.
--
-- After apply: add Daniel to help_admins with docs/ops-whitelist.sql (placeholder uid).

-- ---------------------------------------------------------------------------
-- 1) private schema
-- ---------------------------------------------------------------------------
create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- 2) account_blocks (unlock = mark lifted; row kept for history)
--    Table is created before helper functions so LANGUAGE SQL can resolve it.
-- ---------------------------------------------------------------------------
create table if not exists public.account_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked_at timestamptz not null default now(),
  blocked_by uuid null references auth.users(id) on delete set null,
  reason text null check (reason is null or char_length(reason) <= 500),
  unblocked_at timestamptz null,
  unblocked_by uuid null references auth.users(id) on delete set null,
  unblock_reason text null check (unblock_reason is null or char_length(unblock_reason) <= 500),
  constraint account_blocks_unblock_consistency check (
    (
      unblocked_at is null
      and unblocked_by is null
      and unblock_reason is null
    )
    or (
      unblocked_at is not null
      and unblocked_by is not null
    )
  )
);

create unique index if not exists account_blocks_one_active_uidx
  on public.account_blocks (user_id)
  where unblocked_at is null;

create index if not exists account_blocks_user_idx
  on public.account_blocks (user_id, blocked_at desc);

create index if not exists account_blocks_active_idx
  on public.account_blocks (blocked_at desc)
  where unblocked_at is null;

create index if not exists account_blocks_history_idx
  on public.account_blocks (blocked_at desc);

alter table public.account_blocks enable row level security;

revoke all on table public.account_blocks from public, anon, authenticated;
grant select, insert, update on table public.account_blocks to authenticated;

comment on table public.account_blocks is
  'Fate Tavern account blocks. Active = unblocked_at is null. Unlock marks the row lifted; history is kept. Does not ban login or delete diaries/backups.';

-- ---------------------------------------------------------------------------
-- 3) helpers (SECURITY DEFINER lives in private, not the exposed public API)
-- ---------------------------------------------------------------------------
create or replace function private.is_account_blocked(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and exists (
      select 1
      from public.account_blocks b
      where b.user_id = p_user_id
        and b.unblocked_at is null
    );
$$;

revoke all on function private.is_account_blocked(uuid) from public, anon;
grant execute on function private.is_account_blocked(uuid) to authenticated;

comment on function private.is_account_blocked(uuid) is
  'True when the given user (default auth.uid()) has an active account_blocks row.';

create or replace function public.is_account_blocked()
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select private.is_account_blocked(auth.uid());
$$;

revoke all on function public.is_account_blocked() from public, anon;
grant execute on function public.is_account_blocked() to authenticated;

comment on function public.is_account_blocked() is
  'Client helper: true when the current user is blocked from Fate Tavern participation.';

-- ---------------------------------------------------------------------------
-- 4) RLS on account_blocks
-- ---------------------------------------------------------------------------
drop policy if exists "account_blocks_select_own_or_admin" on public.account_blocks;
create policy "account_blocks_select_own_or_admin"
  on public.account_blocks for select
  using (public.is_admin() or auth.uid() = user_id);

drop policy if exists "account_blocks_insert_admin" on public.account_blocks;
create policy "account_blocks_insert_admin"
  on public.account_blocks for insert
  with check (
    public.is_admin()
    and auth.uid() is not null
    and blocked_by = auth.uid()
    and unblocked_at is null
    and unblocked_by is null
    and unblock_reason is null
  );

drop policy if exists "account_blocks_update_admin" on public.account_blocks;
create policy "account_blocks_update_admin"
  on public.account_blocks for update
  using (public.is_admin() and unblocked_at is null)
  with check (
    public.is_admin()
    and unblocked_at is not null
    and unblocked_by = auth.uid()
  );

-- Guard writes even if a policy is later loosened.
create or replace function private.account_blocks_guard_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'account_blocks_admin_only'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.blocked_by := auth.uid();
    new.blocked_at := coalesce(new.blocked_at, now());
    new.unblocked_at := null;
    new.unblocked_by := null;
    new.unblock_reason := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
       or new.blocked_at is distinct from old.blocked_at
       or new.blocked_by is distinct from old.blocked_by
       or new.reason is distinct from old.reason then
      raise exception 'account_blocks_immutable'
        using errcode = 'P0001';
    end if;
    if old.unblocked_at is not null then
      raise exception 'account_blocks_already_lifted'
        using errcode = 'P0001';
    end if;
    if new.unblocked_at is null or new.unblocked_by is null then
      raise exception 'account_blocks_unblock_required'
        using errcode = 'P0001';
    end if;
    new.unblocked_by := auth.uid();
    return new;
  end if;

  raise exception 'account_blocks_admin_only'
    using errcode = '42501';
end;
$$;

drop trigger if exists account_blocks_guard_write_trg on public.account_blocks;
create trigger account_blocks_guard_write_trg
  before insert or update on public.account_blocks
  for each row execute function private.account_blocks_guard_write();

-- ---------------------------------------------------------------------------
-- 5) Block tavern participation (RLS + trigger)
-- ---------------------------------------------------------------------------
create or replace function private.enforce_tavern_not_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and private.is_account_blocked(auth.uid()) then
    raise exception 'account_blocked'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_tavern_not_blocked_trg on public.help_posts;
create trigger enforce_tavern_not_blocked_trg
  before insert or update on public.help_posts
  for each row execute function private.enforce_tavern_not_blocked();

drop trigger if exists enforce_tavern_not_blocked_trg on public.help_options;
create trigger enforce_tavern_not_blocked_trg
  before insert or update on public.help_options
  for each row execute function private.enforce_tavern_not_blocked();

drop trigger if exists enforce_tavern_not_blocked_trg on public.help_comments;
create trigger enforce_tavern_not_blocked_trg
  before insert or update on public.help_comments
  for each row execute function private.enforce_tavern_not_blocked();

drop trigger if exists enforce_tavern_not_blocked_trg on public.help_votes;
create trigger enforce_tavern_not_blocked_trg
  before insert on public.help_votes
  for each row execute function private.enforce_tavern_not_blocked();

drop trigger if exists enforce_tavern_not_blocked_trg on public.help_comment_cheers;
create trigger enforce_tavern_not_blocked_trg
  before insert on public.help_comment_cheers
  for each row execute function private.enforce_tavern_not_blocked();

drop trigger if exists enforce_tavern_not_blocked_trg on public.help_post_follows;
create trigger enforce_tavern_not_blocked_trg
  before insert on public.help_post_follows
  for each row execute function private.enforce_tavern_not_blocked();

drop trigger if exists enforce_tavern_not_blocked_trg on public.help_reports;
create trigger enforce_tavern_not_blocked_trg
  before insert on public.help_reports
  for each row execute function private.enforce_tavern_not_blocked();

-- Tighten existing participate policies (keep original predicates, add block check).
drop policy if exists "help_posts_insert_own" on public.help_posts;
create policy "help_posts_insert_own"
  on public.help_posts for insert
  with check (
    auth.uid() = author_id
    and not private.is_account_blocked(auth.uid())
  );

drop policy if exists "help_posts_update_own" on public.help_posts;
create policy "help_posts_update_own"
  on public.help_posts for update
  using (
    auth.uid() = author_id
    and not private.is_account_blocked(auth.uid())
  )
  with check (
    auth.uid() = author_id
    and not private.is_account_blocked(auth.uid())
  );

drop policy if exists "help_options_insert_author" on public.help_options;
create policy "help_options_insert_author"
  on public.help_options for insert
  with check (
    exists (
      select 1
      from public.help_posts p
      where p.id = help_options.post_id
        and p.author_id = auth.uid()
    )
    and not private.is_account_blocked(auth.uid())
  );

drop policy if exists "help_options_update_author" on public.help_options;
create policy "help_options_update_author"
  on public.help_options for update
  using (
    exists (
      select 1
      from public.help_posts p
      where p.id = help_options.post_id
        and p.author_id = auth.uid()
    )
    and not private.is_account_blocked(auth.uid())
  )
  with check (
    exists (
      select 1
      from public.help_posts p
      where p.id = help_options.post_id
        and p.author_id = auth.uid()
    )
    and not private.is_account_blocked(auth.uid())
  );

drop policy if exists "help_comments_insert_own" on public.help_comments;
create policy "help_comments_insert_own"
  on public.help_comments for insert
  with check (
    auth.uid() = author_id
    and not private.is_account_blocked(auth.uid())
  );

drop policy if exists "help_comments_update_own" on public.help_comments;
create policy "help_comments_update_own"
  on public.help_comments for update
  using (
    auth.uid() = author_id
    and not private.is_account_blocked(auth.uid())
  )
  with check (
    auth.uid() = author_id
    and not private.is_account_blocked(auth.uid())
  );

drop policy if exists "help_votes_insert_own" on public.help_votes;
create policy "help_votes_insert_own"
  on public.help_votes for insert
  with check (
    (auth.uid() = voter_id)
    and (not (exists (
      select 1
      from help_posts p
      where ((p.id = help_votes.post_id) and (p.author_id = auth.uid()))
    )))
    and (exists (
      select 1
      from help_posts p
      where ((p.id = help_votes.post_id) and (p.status = 'open'::text) and (p.deadline_at > now()))
    ))
    and (exists (
      select 1
      from help_options o
      where ((o.id = help_votes.option_id) and (o.post_id = o.post_id))
    ))
    and not private.is_account_blocked(auth.uid())
  );

drop policy if exists "help_comment_cheers_insert_own" on public.help_comment_cheers;
create policy "help_comment_cheers_insert_own"
  on public.help_comment_cheers for insert
  with check (
    auth.uid() = user_id
    and not private.is_account_blocked(auth.uid())
  );

drop policy if exists "help_post_follows_insert_own" on public.help_post_follows;
create policy "help_post_follows_insert_own"
  on public.help_post_follows for insert
  with check (
    auth.uid() = user_id
    and not private.is_account_blocked(auth.uid())
  );

drop policy if exists "help_reports_insert_own" on public.help_reports;
create policy "help_reports_insert_own"
  on public.help_reports for insert
  with check (
    auth.uid() = reporter_id
    and auth.uid() is not null
    and not private.is_account_blocked(auth.uid())
  );

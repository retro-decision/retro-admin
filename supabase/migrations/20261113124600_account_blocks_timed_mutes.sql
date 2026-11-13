-- Timed Fate Tavern mutes: duration_days / expires_at, auto-lift on re-block,
-- and public.my_tavern_mute() for the signed-in user's own mute status.
-- Apply on production project hrqxdfwuucrknqznrpse.
-- Existing rows with NULL duration_days and expires_at stay permanent.

-- ---------------------------------------------------------------------------
-- 1) Columns + checks
-- ---------------------------------------------------------------------------
alter table public.account_blocks
  add column if not exists duration_days integer null,
  add column if not exists expires_at timestamptz null;

alter table public.account_blocks
  drop constraint if exists account_blocks_duration_expiry;

alter table public.account_blocks
  add constraint account_blocks_duration_expiry check (
    (duration_days is null and expires_at is null)
    or (
      duration_days in (1, 3, 7, 10, 30, 90, 365)
      and expires_at is not null
    )
  );

-- Early admin unlock still requires unblocked_by.
-- Expiry auto-lifts may set unblocked_by null when unblock_reason = 'expired'.
alter table public.account_blocks
  drop constraint if exists account_blocks_unblock_consistency;

alter table public.account_blocks
  add constraint account_blocks_unblock_consistency check (
    (
      unblocked_at is null
      and unblocked_by is null
      and unblock_reason is null
    )
    or (
      unblocked_at is not null
      and unblocked_by is not null
    )
    or (
      unblocked_at is not null
      and unblocked_by is null
      and unblock_reason = 'expired'
    )
  );

comment on column public.account_blocks.duration_days is
  'Mute length in days: 1, 3, 7, 10, 30, 90, or 365. NULL means permanent.';

comment on column public.account_blocks.expires_at is
  'When the mute lifts. NULL means permanent. Set by the write guard from blocked_at + duration_days.';

comment on table public.account_blocks is
  'Fate Tavern account mutes. Active = unblocked_at is null AND (expires_at is null OR expires_at > now()). Unlock marks the row lifted; history is kept. Timed rows may be auto-stamped expired (unblock_reason = expired) before a new mute is inserted. Does not ban login or delete diaries/backups.';

-- ---------------------------------------------------------------------------
-- 2) is_account_blocked: treat expired (unstamped) rows as inactive
--    Read-only; no write side-effects (used by RLS).
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
        and (b.expires_at is null or b.expires_at > now())
    );
$$;

comment on function private.is_account_blocked(uuid) is
  'True when the given user (default auth.uid()) has an active (not unlocked, not expired) account_blocks row.';

-- ---------------------------------------------------------------------------
-- 3) Write guard: compute expires_at, auto-lift expired rows on insert,
--    allow expiry-shaped updates without admin unlock fields.
-- ---------------------------------------------------------------------------
create or replace function private.account_blocks_guard_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Auto-expiry stamp: allowed without admin unlock fields.
  -- Other columns stay immutable. Do not treat this as a normal admin unlock.
  if tg_op = 'UPDATE'
     and old.unblocked_at is null
     and old.expires_at is not null
     and old.expires_at <= now()
     and new.unblocked_at is not distinct from old.expires_at
     and new.unblocked_by is null
     and new.unblock_reason = 'expired'
     and new.user_id is not distinct from old.user_id
     and new.blocked_at is not distinct from old.blocked_at
     and new.blocked_by is not distinct from old.blocked_by
     and new.reason is not distinct from old.reason
     and new.duration_days is not distinct from old.duration_days
     and new.expires_at is not distinct from old.expires_at then
    return new;
  end if;

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

    -- Prefer server clock: always derive expires_at from duration_days + blocked_at.
    if new.duration_days is null then
      new.expires_at := null;
    elsif new.duration_days in (1, 3, 7, 10, 30, 90, 365) then
      new.expires_at := new.blocked_at + make_interval(days => new.duration_days);
    else
      raise exception 'account_blocks_invalid_duration'
        using errcode = 'P0001';
    end if;

    -- Free the unique (user_id) slot held by an expired-but-unstamped row.
    update public.account_blocks
    set
      unblocked_at = expires_at,
      unblocked_by = null,
      unblock_reason = 'expired'
    where user_id = new.user_id
      and unblocked_at is null
      and expires_at is not null
      and expires_at <= now();

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
       or new.blocked_at is distinct from old.blocked_at
       or new.blocked_by is distinct from old.blocked_by
       or new.reason is distinct from old.reason
       or new.duration_days is distinct from old.duration_days
       or new.expires_at is distinct from old.expires_at then
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

-- Admin unlock policy unchanged in spirit; add a narrow path for expiry stamps
-- so the insert-path auto-lift still works if FORCE ROW LEVEL SECURITY is on.
drop policy if exists "account_blocks_update_admin" on public.account_blocks;
create policy "account_blocks_update_admin"
  on public.account_blocks for update
  using (public.is_admin() and unblocked_at is null)
  with check (
    (
      public.is_admin()
      and unblocked_at is not null
      and unblocked_by = auth.uid()
    )
    or (
      public.is_admin()
      and unblocked_at is not null
      and unblocked_by is null
      and unblock_reason = 'expired'
      and unblocked_at = expires_at
    )
  );

-- ---------------------------------------------------------------------------
-- 4) public.my_tavern_mute() — signed-in user only; no admin ids or reason.
--    SECURITY INVOKER (not definer) so it cannot bypass RLS in an exposed schema.
-- ---------------------------------------------------------------------------
drop function if exists public.my_tavern_mute();

create or replace function public.my_tavern_mute()
returns table (
  blocked boolean,
  duration_days integer,
  expires_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return query
  select
    true::boolean,
    b.duration_days,
    b.expires_at
  from public.account_blocks b
  where b.user_id = auth.uid()
    and b.unblocked_at is null
    and (b.expires_at is null or b.expires_at > now())
  limit 1;

  if not found then
    blocked := false;
    duration_days := null;
    expires_at := null;
    return next;
  end if;
end;
$$;

revoke all on function public.my_tavern_mute() from public, anon;
grant execute on function public.my_tavern_mute() to authenticated;

comment on function public.my_tavern_mute() is
  'Returns the signed-in user''s active Fate Tavern mute (blocked, duration_days, expires_at). If not muted or the mute has expired, blocked is false and the other fields are null. Does not return admin ids or the internal reason.';

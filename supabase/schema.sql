-- ChangePlace Supabase schema for the free MVP backend.
-- Run this file in Supabase SQL Editor, then enable the auth hook described in BACKEND_SETUP.md.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  city_id text not null default 'spb',
  day_key date not null,
  full_name text not null,
  phone text,
  telegram text,
  max text,
  preferred_location text not null,
  comment text,
  status text not null check (status in ('search', 'agreed', 'unavailable')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists points_one_active_per_user_day
  on public.points(user_id, day_key)
  where deleted_at is null;

create table if not exists public.exchange_offers (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  from_point_id uuid not null references public.points(id) on delete cascade,
  to_point_id uuid not null references public.points(id) on delete cascade,
  day_key date not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user_id <> to_user_id),
  check (from_point_id <> to_point_id)
);

create unique index if not exists exchange_offers_one_pending_pair
  on public.exchange_offers(from_point_id, to_point_id)
  where status = 'pending';

create table if not exists public.exchange_stats (
  id boolean primary key default true,
  successful_exchanges_count integer not null default 0,
  updated_at timestamptz not null default now(),
  check (id = true)
);

insert into public.exchange_stats(id, successful_exchanges_count)
values (true, 0)
on conflict (id) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists points_set_updated_at on public.points;
create trigger points_set_updated_at
before update on public.points
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(user_id, email)
  values (new.id, lower(new.email))
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.hook_restrict_signup_by_email_domain(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  email text;
begin
  email := lower(coalesce(event->'user'->>'email', ''));

  if email like '%@alfabank.ru' then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Для регистрации используйте корпоративную почту @alfabank.ru.'
    )
  );
end;
$$;

grant execute on function public.hook_restrict_signup_by_email_domain(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_by_email_domain(jsonb) from authenticated, anon, public;

create or replace function public.accept_exchange_offer(offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  offer public.exchange_offers%rowtype;
  from_lat double precision;
  from_lng double precision;
begin
  select *
  into offer
  from public.exchange_offers
  where id = offer_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'Offer not found or already processed';
  end if;

  if offer.to_user_id <> auth.uid() then
    raise exception 'Only recipient can accept this offer';
  end if;

  select lat, lng into from_lat, from_lng
  from public.points
  where id = offer.from_point_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Source point not found';
  end if;

  update public.points p
  set lat = target.lat,
      lng = target.lng,
      status = 'agreed'
  from public.points target
  where p.id = offer.from_point_id
    and target.id = offer.to_point_id
    and target.deleted_at is null;

  if not found then
    raise exception 'Target point not found';
  end if;

  update public.points
  set lat = from_lat,
      lng = from_lng,
      status = 'agreed'
  where id = offer.to_point_id
    and deleted_at is null;

  update public.exchange_offers
  set status = 'accepted',
      responded_at = now()
  where id = offer.id;

  update public.exchange_stats
  set successful_exchanges_count = successful_exchanges_count + 1,
      updated_at = now()
  where id = true;
end;
$$;

create or replace function public.cleanup_daily_points()
returns void
language sql
security definer
set search_path = public
as $$
  update public.points
  set deleted_at = now()
  where deleted_at is null;

  update public.exchange_offers
  set status = 'declined',
      responded_at = coalesce(responded_at, now())
  where status = 'pending';
$$;

alter table public.profiles enable row level security;
alter table public.points enable row level security;
alter table public.exchange_offers enable row level security;
alter table public.exchange_stats enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "points_select_authenticated" on public.points;
create policy "points_select_authenticated"
on public.points for select
to authenticated
using (deleted_at is null);

drop policy if exists "points_insert_own" on public.points;
create policy "points_insert_own"
on public.points for insert
to authenticated
with check (user_id = auth.uid() and deleted_at is null);

drop policy if exists "points_update_own" on public.points;
create policy "points_update_own"
on public.points for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "points_delete_own" on public.points;
create policy "points_delete_own"
on public.points for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "offers_select_participant" on public.exchange_offers;
create policy "offers_select_participant"
on public.exchange_offers for select
to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists "offers_insert_sender" on public.exchange_offers;
create policy "offers_insert_sender"
on public.exchange_offers for insert
to authenticated
with check (
  from_user_id = auth.uid()
  and status = 'pending'
  and exists (
    select 1
    from public.points p
    where p.id = from_point_id
      and p.user_id = auth.uid()
      and p.deleted_at is null
  )
  and exists (
    select 1
    from public.points p
    where p.id = to_point_id
      and p.user_id = to_user_id
      and p.deleted_at is null
  )
);

drop policy if exists "offers_update_recipient_decline" on public.exchange_offers;
create policy "offers_update_recipient_decline"
on public.exchange_offers for update
to authenticated
using (to_user_id = auth.uid() and status = 'pending')
with check (to_user_id = auth.uid() and status = 'declined');

drop policy if exists "stats_select_authenticated" on public.exchange_stats;
create policy "stats_select_authenticated"
on public.exchange_stats for select
to authenticated
using (true);

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.points to authenticated;
grant select, insert, update on public.exchange_offers to authenticated;
grant select on public.exchange_stats to authenticated;
grant execute on function public.accept_exchange_offer(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.points;
exception when duplicate_object then
  null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.exchange_offers;
exception when duplicate_object then
  null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.exchange_stats;
exception when duplicate_object then
  null;
end;
$$;

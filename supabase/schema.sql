-- ChangePlace Supabase schema for the free MVP backend.
-- Public MVP mode: no registration, public read, writes are scoped by browser device_id.

create extension if not exists pgcrypto;

create table if not exists public.points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  device_id text,
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
  where deleted_at is null and user_id is not null;

create unique index if not exists points_one_active_per_device_day
  on public.points(device_id, day_key)
  where deleted_at is null and device_id is not null;

create table if not exists public.exchange_offers (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid references auth.users(id) on delete set null,
  to_user_id uuid references auth.users(id) on delete set null,
  from_device_id text,
  to_device_id text,
  from_point_id uuid not null references public.points(id) on delete cascade,
  to_point_id uuid not null references public.points(id) on delete cascade,
  day_key date not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user_id is null or to_user_id is null or from_user_id <> to_user_id),
  check (from_device_id is null or to_device_id is null or from_device_id <> to_device_id),
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

alter table public.points
  alter column user_id drop not null;

alter table public.points
  add column if not exists device_id text;

alter table public.exchange_offers
  alter column from_user_id drop not null,
  alter column to_user_id drop not null;

alter table public.exchange_offers
  add column if not exists from_device_id text,
  add column if not exists to_device_id text;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists points_set_updated_at on public.points;
create trigger points_set_updated_at
before update on public.points
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();
drop function if exists public.hook_restrict_signup_by_email_domain(jsonb);

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'drop trigger if exists profiles_set_updated_at on public.profiles';
    execute 'drop policy if exists "profiles_select_own" on public.profiles';
    execute 'drop policy if exists "profiles_update_own" on public.profiles';
  end if;
end;
$$;

create or replace function public.get_public_points(
  p_device_id text,
  p_city_id text,
  p_day_key date
)
returns table (
  id uuid,
  is_own boolean,
  city_id text,
  day_key date,
  full_name text,
  phone text,
  telegram text,
  max text,
  preferred_location text,
  comment text,
  status text,
  lat double precision,
  lng double precision,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.device_id = p_device_id as is_own,
    p.city_id,
    p.day_key,
    p.full_name,
    p.phone,
    p.telegram,
    p.max,
    p.preferred_location,
    p.comment,
    p.status,
    p.lat,
    p.lng,
    p.updated_at
  from public.points p
  where p.city_id = p_city_id
    and p.day_key = p_day_key
    and p.deleted_at is null
  order by p.updated_at desc;
$$;

create or replace function public.get_public_exchange_offers(
  p_device_id text,
  p_day_key date
)
returns table (
  id uuid,
  from_point_id uuid,
  to_point_id uuid,
  day_key date,
  status text,
  created_at timestamptz,
  responded_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    e.id,
    e.from_point_id,
    e.to_point_id,
    e.day_key,
    e.status,
    e.created_at,
    e.responded_at
  from public.exchange_offers e
  where e.day_key = p_day_key
    and (e.from_device_id = p_device_id or e.to_device_id = p_device_id)
  order by e.created_at desc;
$$;

create or replace function public.upsert_public_point(
  p_point_id uuid,
  p_device_id text,
  p_city_id text,
  p_day_key date,
  p_full_name text,
  p_phone text,
  p_telegram text,
  p_max text,
  p_preferred_location text,
  p_comment text,
  p_status text,
  p_lat double precision,
  p_lng double precision
)
returns public.points
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.points%rowtype;
  target_id uuid;
begin
  if length(coalesce(p_device_id, '')) < 16 then
    raise exception 'Invalid device_id';
  end if;

  if p_status not in ('search', 'agreed', 'unavailable') then
    raise exception 'Invalid status';
  end if;

  target_id := p_point_id;

  if target_id is null then
    select id into target_id
    from public.points
    where device_id = p_device_id
      and day_key = p_day_key
      and deleted_at is null
    limit 1;
  end if;

  if target_id is null then
    insert into public.points(
      device_id, city_id, day_key, full_name, phone, telegram, max,
      preferred_location, comment, status, lat, lng
    )
    values (
      p_device_id, p_city_id, p_day_key, p_full_name, p_phone, p_telegram, p_max,
      p_preferred_location, p_comment, p_status, p_lat, p_lng
    )
    returning * into saved;
  else
    update public.points
    set city_id = p_city_id,
        day_key = p_day_key,
        full_name = p_full_name,
        phone = p_phone,
        telegram = p_telegram,
        max = p_max,
        preferred_location = p_preferred_location,
        comment = p_comment,
        status = p_status,
        lat = p_lat,
        lng = p_lng,
        deleted_at = null
    where id = target_id
      and device_id = p_device_id
    returning * into saved;

    if not found then
      raise exception 'Point not found for this device';
    end if;
  end if;

  return saved;
end;
$$;

create or replace function public.delete_public_point(p_point_id uuid, p_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.points
  set deleted_at = now()
  where id = p_point_id
    and device_id = p_device_id
    and deleted_at is null;
end;
$$;

create or replace function public.create_public_exchange_offer(
  p_from_device_id text,
  p_to_point_id uuid,
  p_day_key date
)
returns public.exchange_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  source public.points%rowtype;
  target public.points%rowtype;
  saved public.exchange_offers%rowtype;
begin
  select * into source
  from public.points
  where device_id = p_from_device_id
    and day_key = p_day_key
    and deleted_at is null
  limit 1;

  if not found then
    raise exception 'Source point not found';
  end if;

  select * into target
  from public.points
  where id = p_to_point_id
    and day_key = p_day_key
    and deleted_at is null;

  if not found then
    raise exception 'Target point not found';
  end if;

  if target.device_id = source.device_id then
    raise exception 'Cannot create offer to yourself';
  end if;

  insert into public.exchange_offers(
    from_user_id, to_user_id, from_device_id, to_device_id,
    from_point_id, to_point_id, day_key, status
  )
  values (
    source.user_id, target.user_id, source.device_id, target.device_id,
    source.id, target.id, p_day_key, 'pending'
  )
  returning * into saved;

  return saved;
end;
$$;

create or replace function public.accept_exchange_offer(offer_id uuid, requester_device_id text)
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

  if offer.to_device_id <> requester_device_id then
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

create or replace function public.decline_exchange_offer(offer_id uuid, requester_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.exchange_offers
  set status = 'declined',
      responded_at = now()
  where id = offer_id
    and to_device_id = requester_device_id
    and status = 'pending';
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

alter table public.points enable row level security;
alter table public.exchange_offers enable row level security;
alter table public.exchange_stats enable row level security;

drop policy if exists "points_select_authenticated" on public.points;
drop policy if exists "points_select_public" on public.points;

drop policy if exists "points_insert_own" on public.points;
drop policy if exists "points_update_own" on public.points;
drop policy if exists "points_delete_own" on public.points;

drop policy if exists "offers_select_participant" on public.exchange_offers;
drop policy if exists "offers_select_public" on public.exchange_offers;

drop policy if exists "offers_insert_sender" on public.exchange_offers;
drop policy if exists "offers_update_recipient_decline" on public.exchange_offers;

drop policy if exists "stats_select_authenticated" on public.exchange_stats;
drop policy if exists "stats_select_public" on public.exchange_stats;
create policy "stats_select_public"
on public.exchange_stats for select
to anon, authenticated
using (true);

revoke select, insert, update, delete on public.points from anon, authenticated;
revoke select, insert, update, delete on public.exchange_offers from anon, authenticated;

grant select on public.exchange_stats to anon, authenticated;
grant execute on function public.get_public_points(text, text, date) to anon, authenticated;
grant execute on function public.get_public_exchange_offers(text, date) to anon, authenticated;
grant execute on function public.upsert_public_point(uuid, text, text, date, text, text, text, text, text, text, text, double precision, double precision) to anon, authenticated;
grant execute on function public.delete_public_point(uuid, text) to anon, authenticated;
grant execute on function public.create_public_exchange_offer(text, uuid, date) to anon, authenticated;
grant execute on function public.accept_exchange_offer(uuid, text) to anon, authenticated;
grant execute on function public.decline_exchange_offer(uuid, text) to anon, authenticated;

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

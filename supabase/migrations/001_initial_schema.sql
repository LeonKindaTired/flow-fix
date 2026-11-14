-- FlowFix F-002: schema, RLS, RPCs, safe public view, and private storage.
-- Apply locally or through the reviewed Supabase migration workflow.
-- Anonymous Auth must also be enabled in the Supabase Auth dashboard/config;
-- this repository records that requirement in supabase/config.toml.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

set search_path = public, extensions;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reporter_id uuid references auth.users(id) on delete cascade,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed', 'needs_review', 'duplicate')),
  image_path text not null,
  location extensions.geography(Point, 4326) not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  location_source text not null default 'gps' check (location_source = 'gps'),
  address_label text,
  road_type text not null default 'unknown',
  damage_type text not null default 'unknown'
    check (damage_type in ('pothole', 'crack', 'surface_damage', 'other', 'unknown')),
  severity smallint check (severity between 1 and 5),
  confidence numeric(4,3) check (confidence between 0 and 1),
  ai_summary text,
  priority_score smallint check (priority_score between 0 and 100),
  priority_band text check (priority_band in ('low', 'medium', 'high', 'urgent')),
  score_version text,
  corroboration_count integer not null default 0 check (corroboration_count >= 0),
  duplicate_of uuid references public.reports(id) on delete set null,
  duplicate_distance_m integer check (duplicate_distance_m is null or duplicate_distance_m >= 0),
  needs_human_review boolean not null default false,
  processing_error text,
  source text not null default 'citizen' check (source in ('citizen', 'seeded_demo')),
  constraint reports_reporter_required check (source = 'seeded_demo' or reporter_id is not null),
  constraint reports_location_coordinates_match check (
    abs((st_y(location::geometry)) - latitude) < 0.000001
    and abs((st_x(location::geometry)) - longitude) < 0.000001
  )
);

create table if not exists public.report_confirmations (
  id uuid primary key default gen_random_uuid(),
  original_report_id uuid not null references public.reports(id) on delete cascade,
  corroborating_report_id uuid not null references public.reports(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (original_report_id, reporter_id),
  unique (original_report_id, corroborating_report_id)
);

create table if not exists public.geocode_cache (
  cache_key text primary key,
  latitude_rounded numeric(8,5) not null check (latitude_rounded between -90 and 90),
  longitude_rounded numeric(8,5) not null check (longitude_rounded between -180 and 180),
  address_label text,
  road_type text not null default 'unknown',
  fetched_at timestamptz not null default now()
);

create index if not exists reports_location_gist_idx on public.reports using gist (location);
create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_priority_score_idx on public.reports (priority_score desc);
create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists report_confirmations_original_idx
  on public.report_confirmations (original_report_id);

create or replace function public.set_report_location()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.location := st_setsrid(st_makepoint(new.longitude, new.latitude), 4326)::geography;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists reports_set_location on public.reports;
create trigger reports_set_location
before insert or update of latitude, longitude on public.reports
for each row execute function public.set_report_location();

create or replace function public.find_nearby_report(
  p_lat double precision,
  p_lon double precision,
  p_radius_m double precision,
  p_damage_type text,
  p_exclude_id uuid default null
)
returns table (candidate_id uuid, distance_m double precision, damage_type text)
language sql stable security definer
set search_path = public, extensions
as $$
  select r.id,
         st_distance(r.location, st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography),
         r.damage_type
  from public.reports as r
  where r.status in ('uploaded', 'processing', 'ready', 'needs_review')
    and r.damage_type = p_damage_type
    and p_damage_type <> 'unknown'
    and r.source <> 'seeded_demo'
    and (p_exclude_id is null or r.id <> p_exclude_id)
    and st_dwithin(
      r.location,
      st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography,
      p_radius_m
    )
  order by r.location <-> st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography
  limit 1;
$$;

create or replace function public.add_report_corroboration(
  p_original_report_id uuid,
  p_corroborating_report_id uuid,
  p_reporter_id uuid
)
returns table (
  original_report_id uuid,
  corroboration_count integer,
  priority_score smallint,
  priority_band text,
  inserted boolean
)
language plpgsql security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  original_report public.reports%rowtype;
  confirmation_id uuid;
  did_insert boolean := false;
begin
  select * into original_report from public.reports
  where id = p_original_report_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'original report not found';
  end if;

  if original_report.reporter_id is not distinct from p_reporter_id then
    return query select original_report.id, original_report.corroboration_count,
      original_report.priority_score, original_report.priority_band, false;
  else
    insert into public.report_confirmations (
      original_report_id, corroborating_report_id, reporter_id
    ) values (
      p_original_report_id, p_corroborating_report_id, p_reporter_id
    ) on conflict (original_report_id, reporter_id) do nothing
    returning id into confirmation_id;

    if confirmation_id is not null then
      update public.reports
      set corroboration_count = corroboration_count + 1, updated_at = now()
      where id = p_original_report_id
      returning * into original_report;
      did_insert := true;
    end if;
  end if;

  return query select original_report.id, original_report.corroboration_count,
    original_report.priority_score, original_report.priority_band, did_insert;
end;
$$;

revoke all on function public.find_nearby_report(double precision, double precision, double precision, text, uuid)
  from public, anon, authenticated;
revoke all on function public.add_report_corroboration(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.find_nearby_report(double precision, double precision, double precision, text, uuid)
  to service_role;
grant execute on function public.add_report_corroboration(uuid, uuid, uuid) to service_role;

create or replace view public.public_reports as
select id, created_at, latitude, longitude, address_label, road_type, damage_type,
       severity, priority_score, priority_band, corroboration_count, status, source
from public.reports
where status in ('ready', 'needs_review');

revoke all on public.public_reports from public, anon, authenticated;
grant select on public.public_reports to anon, authenticated;

alter table public.reports enable row level security;
alter table public.report_confirmations enable row level security;
alter table public.geocode_cache enable row level security;

revoke all on public.reports, public.report_confirmations, public.geocode_cache
  from public, anon, authenticated;
grant select on public.reports to authenticated;

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
for select to authenticated
using (reporter_id = (select auth.uid()));

-- No client insert, update, or delete policies are created for reports.
-- Service-role Edge Functions bypass RLS for controlled server-side writes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-photos',
  'report-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[];

drop policy if exists report_photos_insert_own_folder on storage.objects;
create policy report_photos_insert_own_folder on storage.objects
for insert to authenticated
with check (
  bucket_id = 'report-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists report_photos_select_own_folder on storage.objects;
create policy report_photos_select_own_folder on storage.objects
for select to authenticated
using (
  bucket_id = 'report-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);


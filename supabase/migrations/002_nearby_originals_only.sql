-- F-109 defense in depth: duplicate lookup may only return original reports.
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
    and r.duplicate_of is null
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

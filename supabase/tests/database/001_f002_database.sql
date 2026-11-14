begin;

select plan(10);

insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f002-one@example.invalid'),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'f002-two@example.invalid'),
  ('00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'f002-three@example.invalid')
on conflict (id) do nothing;

insert into public.reports (
  id, reporter_id, image_path, latitude, longitude, damage_type, status, source
)
values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001/original.jpg',
  45.000000, 25.000000, 'pothole', 'ready', 'citizen'
), (
  '10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002/near.jpg',
  45.000000, 25.000100, 'pothole', 'ready', 'citizen'
), (
  '10000000-0000-0000-0000-000000000003',
  null,
  'seeded-demo/seed.jpg',
  45.000000, 25.000500, 'pothole', 'ready', 'seeded_demo'
), (
  '10000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000003/third.jpg',
  45.000000, 25.000150, 'pothole', 'ready', 'citizen'
), (
  '10000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000003/far.jpg',
  45.000000, 25.000500, 'crack', 'ready', 'citizen'
);

select is(
  (select count(*)::integer from public.find_nearby_report(
    45.000000, 25.000000, 20, 'pothole',
    '10000000-0000-0000-0000-000000000001'
  )),
  1,
  'finds a compatible report at about 10 m'
);

select is(
  (select count(*)::integer from public.find_nearby_report(
    45.000000, 25.000000, 20, 'pothole',
    '10000000-0000-0000-0000-000000000001'
  ) where candidate_id = '10000000-0000-0000-0000-000000000002'),
  1,
  'p_exclude_id excludes the original report from the nearby result'
);

select is(
  (select count(*)::integer from public.find_nearby_report(
    45.000000, 25.000000, 20, 'crack', null
  )),
  0,
  'a compatible report about 40 m away does not match'
);

select is(
  (select count(*)::integer from public.find_nearby_report(
    45.000000, 25.000500, 20, 'pothole', null
  )),
  0,
  'seeded demo rows never match'
);

select is(
  (select count(*)::integer from public.find_nearby_report(
    45.000000, 25.000000, 20, 'unknown', null
  )),
  0,
  'unknown damage type never matches'
);

select is(
  (select corroboration_count from public.add_report_corroboration(
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002'
  )),
  1,
  'first distinct reporter increments once'
);

select is(
  (select corroboration_count from public.add_report_corroboration(
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002'
  )),
  1,
  'second call by the same reporter does not increment'
);

select is(
  (select corroboration_count from public.add_report_corroboration(
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001'
  )),
  1,
  'the original reporter cannot corroborate their own report'
);

select is(
  (select corroboration_count from public.add_report_corroboration(
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000003'
  )),
  2,
  'two distinct reporters produce count 2'
);

select is(
  (select count(*)::integer from public.report_confirmations
   where original_report_id = '10000000-0000-0000-0000-000000000001'),
  2,
  'only the two distinct corroborations are stored'
);

select * from finish();
rollback;


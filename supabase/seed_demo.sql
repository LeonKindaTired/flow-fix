-- FlowFix demo-only seed data. Replace the coordinates below with the team's
-- chosen demo coordinates if needed; these defaults are central Timisoara.
-- This file contains no interviews, feedback, votes, or research metrics.

delete from public.reports where source = 'seeded_demo';

-- Score = round((65*severity_component + 15*road_component + 20*community_component) / 100).
insert into public.reports (
  reporter_id, status, image_path, latitude, longitude, location_source,
  address_label, road_type, damage_type, severity, confidence, ai_summary,
  priority_score, priority_band, score_version, corroboration_count,
  needs_human_review, source
) values
  -- (65*100 + 15*100 + 20*100) / 100 = 100, urgent.
  (null, 'ready', 'seed/none-01', 45.748900, 21.208700, 'gps', 'Demo Boulevard, Timisoara', 'primary', 'pothole', 5, 0.99, 'Synthetic demo record.', 100, 'urgent', 'v1', 5, false, 'seeded_demo'),
  -- (65*75 + 15*45 + 20*0) / 100 = 55.5 -> 56, high.
  (null, 'ready', 'seed/none-02', 45.749300, 21.210100, 'gps', 'Demo Residential Street, Timisoara', 'residential', 'crack', 4, 0.99, 'Synthetic demo record.', 56, 'high', 'v1', 0, false, 'seeded_demo'),
  -- (65*75 + 15*100 + 20*0) / 100 = 63.75 -> 64, high.
  (null, 'ready', 'seed/none-03', 45.747600, 21.206900, 'gps', 'Demo Primary Road, Timisoara', 'primary', 'surface_damage', 4, 0.99, 'Synthetic demo record.', 64, 'high', 'v1', 0, false, 'seeded_demo'),
  -- (65*50 + 15*80 + 20*40) / 100 = 52.5 -> 53, medium; corroboration_count = 2.
  (null, 'ready', 'seed/none-04', 45.750200, 21.207800, 'gps', 'Demo Secondary Street, Timisoara', 'secondary', 'pothole', 3, 0.99, 'Synthetic demo record.', 53, 'medium', 'v1', 2, false, 'seeded_demo'),
  -- (65*50 + 15*45 + 20*0) / 100 = 39.25 -> 39, medium.
  (null, 'ready', 'seed/none-05', 45.746900, 21.211000, 'gps', 'Demo Residential Street, Timisoara', 'residential', 'crack', 3, 0.99, 'Synthetic demo record.', 39, 'medium', 'v1', 0, false, 'seeded_demo'),
  -- (65*75 + 15*25 + 20*0) / 100 = 52.5 -> 53, medium.
  (null, 'ready', 'seed/none-06', 45.751100, 21.204900, 'gps', 'Demo Service Lane, Timisoara', 'service', 'surface_damage', 4, 0.99, 'Synthetic demo record.', 53, 'medium', 'v1', 0, false, 'seeded_demo'),
  -- (65*0 + 15*40 + 20*0) / 100 = 6, low.
  (null, 'ready', 'seed/none-07', 45.747800, 21.213000, 'gps', 'Demo Park Edge, Timisoara', 'unknown', 'other', 1, 0.99, 'Synthetic demo record.', 6, 'low', 'v1', 0, false, 'seeded_demo'),
  -- (65*25 + 15*25 + 20*0) / 100 = 20, low.
  (null, 'ready', 'seed/none-08', 45.752000, 21.210500, 'gps', 'Demo Service Lane, Timisoara', 'service', 'crack', 2, 0.99, 'Synthetic demo record.', 20, 'low', 'v1', 0, false, 'seeded_demo');

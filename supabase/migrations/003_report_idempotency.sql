-- F-109: make image retries atomic and track bounded reprocessing attempts.
alter table public.reports
  add column if not exists attempts smallint not null default 1;

alter table public.reports
  add constraint reports_attempts_valid check (attempts between 1 and 3);

create unique index if not exists reports_image_path_unique_idx
  on public.reports (image_path);

create or replace function public.reprocess_failed_report(p_report_id uuid)
returns setof public.reports
language sql security definer
set search_path = public, extensions
as $$
  update public.reports
  set status = 'processing',
      processing_error = null,
      attempts = attempts + 1,
      updated_at = now()
  where id = p_report_id
    and status = 'failed'
    and attempts < 3
  returning *;
$$;

revoke all on function public.reprocess_failed_report(uuid) from public, anon, authenticated;
grant execute on function public.reprocess_failed_report(uuid) to service_role;

create table if not exists pipeline_runs (
  run_id text primary key,
  run_date date not null,
  stage text not null,
  status text not null check (status in ('success','failure','partial')),
  duration_s numeric,
  source_freshness jsonb,
  started_at timestamptz not null,
  finished_at timestamptz,
  error text
);
create index if not exists pipeline_runs_run_date_idx on pipeline_runs (run_date desc);

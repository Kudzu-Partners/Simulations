-- Eureka Open Simulations: opt-in benchmarking ("Compare my run").
--
-- The browser holds only the public anon key, and the anon role can do exactly
-- one thing: call submit_run(). Every table has RLS on with no policies and no
-- table privileges, so nothing can be read, listed, updated or deleted through
-- the API. Comparisons are computed inside submit_run() and only aggregates
-- (counts, the median) come back; no other player's row is ever returned.
--
-- Nothing personal is stored: no account, email, IP or user agent. The rate
-- limiter keeps a salted hash of the caller's IP for two hours, then drops it.
-- See privacy.html and supabase/README.md.

-- ───────────────────────── tables ─────────────────────────

-- Catalog ids a run may name (seeded from player/manifest.json, see seed.sql).
create table public.known_sims (
  id text primary key check (id ~ '^[0-9]{3,4}$')
);

-- Class codes a lecturer hands out. Created by an admin with create_cohort().
create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique check (join_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  label text not null default '' check (char_length(label) <= 80),
  sim_id text references public.known_sims (id),           -- null = any simulation
  level text check (level in ('ug', 'masters', 'mba', 'professional', 'other')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 days'
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  sim_id text not null references public.known_sims (id),
  lang text not null check (lang ~ '^[a-z]{2}$'),
  level text not null check (level in ('ug', 'masters', 'mba', 'professional', 'other')),
  cohort_id uuid references public.cohorts (id) on delete set null,
  nickname text check (nickname is null or char_length(nickname) between 1 and 30),
  periods smallint not null check (periods between 1 and 100),
  score double precision not null check (score between -1e9 and 1e9),
  summary jsonb,
  created_at timestamptz not null default now()
);
create index runs_sim_score on public.runs (sim_id, score);
create index runs_sim_level_score on public.runs (sim_id, level, score);
create index runs_cohort_score on public.runs (cohort_id, score) where cohort_id is not null;

-- Rate limiting: hash(ip, secret salt, day), kept two hours.
create table public.submit_log (
  caller text not null,
  at timestamptz not null default now()
);
create index submit_log_caller_at on public.submit_log (caller, at);
create index submit_log_at on public.submit_log (at);

create table public.app_secrets (
  name text primary key,
  value text not null
);
insert into public.app_secrets (name, value)
values ('ip_salt', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text));

-- ───────────────────── lock everything down ─────────────────────

alter table public.known_sims enable row level security;
alter table public.cohorts enable row level security;
alter table public.runs enable row level security;
alter table public.submit_log enable row level security;
alter table public.app_secrets enable row level security;

revoke all on public.known_sims, public.cohorts, public.runs, public.submit_log, public.app_secrets
  from public, anon, authenticated;

-- ───────────────────────── submit_run ─────────────────────────
-- Records one finished run and returns how it compares, in one round trip:
--   { run_id, level,
--     all:    { n, below, equal, median },   other runs of this sim
--     peers:  { n, below, equal, median },   ...at the same level
--     cohort: { n, below, equal, label } | null }
-- or { error: 'unknown_code' | 'wrong_sim' | 'rate_limited' }.
-- Bad input (unknown sim, out-of-range numbers) raises 22023.

create function public.submit_run(
  p_sim_id text,
  p_lang text,
  p_level text,
  p_score double precision,
  p_periods integer,
  p_nickname text default null,
  p_join_code text default null,
  p_summary jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers json;
  v_ip text;
  v_caller text;
  v_recent integer;
  v_level text;
  v_lang text;
  v_nick text;
  v_summary jsonb;
  v_code text;
  v_cohort_id uuid;
  v_cohort_label text;
  v_cohort_sim text;
  v_cohort_level text;
  v_id uuid;
begin
  if p_sim_id is null or not exists (select 1 from known_sims where id = p_sim_id) then
    raise exception 'unknown simulation' using errcode = '22023';
  end if;
  if p_score is null or p_score = 'NaN'::double precision or p_score < -1e9 or p_score > 1e9 then
    raise exception 'score out of range' using errcode = '22023';
  end if;
  if p_periods is null or p_periods < 1 or p_periods > 100 then
    raise exception 'periods out of range' using errcode = '22023';
  end if;
  v_lang := lower(coalesce(p_lang, ''));
  if v_lang !~ '^[a-z]{2}$' then v_lang := 'en'; end if;
  v_level := case when p_level in ('ug', 'masters', 'mba', 'professional', 'other') then p_level else 'other' end;

  -- rate limit: 20 calls an hour per caller (failed class codes count too)
  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := trim(split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip', ''), ',', 1));
  v_caller := encode(sha256(convert_to(
    v_ip || '|' || (select value from app_secrets where name = 'ip_salt') || '|' || current_date::text, 'UTF8')), 'hex');
  delete from submit_log where at < now() - interval '2 hours';
  select count(*) into v_recent from submit_log where caller = v_caller and at > now() - interval '1 hour';
  if v_recent >= 20 then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  insert into submit_log (caller) values (v_caller);

  -- optional class code: its level wins over the one the player picked
  v_code := upper(trim(coalesce(p_join_code, '')));
  if v_code <> '' then
    select id, label, sim_id, level into v_cohort_id, v_cohort_label, v_cohort_sim, v_cohort_level
      from cohorts where join_code = v_code and expires_at > now();
    if v_cohort_id is null then
      return jsonb_build_object('error', 'unknown_code');
    end if;
    if v_cohort_sim is not null and v_cohort_sim <> p_sim_id then
      return jsonb_build_object('error', 'wrong_sim');
    end if;
    v_level := coalesce(v_cohort_level, v_level);
  end if;

  v_nick := nullif(left(regexp_replace(trim(coalesce(p_nickname, '')), '[[:cntrl:]<>&"]', '', 'g'), 30), '');
  if p_summary is not null and jsonb_typeof(p_summary) = 'object' and pg_column_size(p_summary) <= 16384 then
    v_summary := p_summary;
  end if;

  insert into runs (sim_id, lang, level, cohort_id, nickname, periods, score, summary)
  values (p_sim_id, v_lang, v_level, v_cohort_id, v_nick, p_periods, p_score, v_summary)
  returning id into v_id;

  return jsonb_build_object(
    'run_id', v_id,
    'level', v_level,
    'all', (select jsonb_build_object(
              'n', count(*),
              'below', count(*) filter (where score < p_score),
              'equal', count(*) filter (where score = p_score),
              'median', percentile_cont(0.5) within group (order by score))
            from runs where sim_id = p_sim_id and id <> v_id),
    'peers', (select jsonb_build_object(
              'n', count(*),
              'below', count(*) filter (where score < p_score),
              'equal', count(*) filter (where score = p_score),
              'median', percentile_cont(0.5) within group (order by score))
            from runs where sim_id = p_sim_id and level = v_level and id <> v_id),
    'cohort', case when v_cohort_id is null then null else (select jsonb_build_object(
              'n', count(*),
              'below', count(*) filter (where score < p_score),
              'equal', count(*) filter (where score = p_score),
              'label', v_cohort_label)
            from runs where cohort_id = v_cohort_id and id <> v_id) end
  );
end;
$$;

revoke all on function public.submit_run(text, text, text, double precision, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_run(text, text, text, double precision, integer, text, text, jsonb)
  to anon;

-- ─────────────────────── admin-only helpers ───────────────────────
-- Run from the SQL editor (postgres / service_role). Not callable by anon.

-- select public.create_cohort('MBA 2027 · Strategy', '015', 'mba');  → 'K7PQ2M'
create function public.create_cohort(
  p_label text,
  p_sim_id text default null,
  p_level text default null,
  p_days integer default 180
) returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  i integer;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from cohorts where join_code = v_code);
  end loop;
  insert into cohorts (join_code, label, sim_id, level, expires_at)
  values (v_code, coalesce(p_label, ''), p_sim_id, p_level, now() + make_interval(days => p_days));
  return v_code;
end;
$$;
revoke all on function public.create_cohort(text, text, text, integer) from public, anon, authenticated;

-- A lecturer's view of one class: select * from public.cohort_results where join_code = 'K7PQ2M';
create view public.cohort_results with (security_invoker = true) as
  select c.join_code, c.label, r.sim_id, r.nickname, r.level, r.lang, r.periods, r.score,
         rank() over (partition by c.id, r.sim_id order by r.score desc) as rank_in_class,
         r.created_at
    from public.runs r
    join public.cohorts c on c.id = r.cohort_id;
revoke all on public.cohort_results from public, anon, authenticated;

-- Retention: drop nicknames and summaries after a year; the scores stay as
-- anonymous benchmark points. Schedule with pg_cron, see supabase/README.md.
create function public.prune_runs() returns void
language sql
set search_path = public, pg_temp
as $$
  update runs set nickname = null, summary = null
   where created_at < now() - interval '12 months'
     and (nickname is not null or summary is not null);
  delete from cohorts where expires_at < now() - interval '12 months';
$$;
revoke all on function public.prune_runs() from public, anon, authenticated;

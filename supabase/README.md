# Benchmark backend (Supabase)

The player's opt-in **Compare your run** card stores a finished run and gets back how it compares. This folder is the
whole backend: one migration, one seed, no server code. What is collected and why is in [`privacy.html`](../privacy.html).

## Security model

The browser holds only the project's publishable (anon) key, which is public by design — it's in
[`player/js/config.js`](../player/js/config.js). With it, a client can do exactly one thing: call `submit_run()`.

- Every table has row-level security on, no policies, and all privileges revoked from `anon` and `authenticated`. Nothing
  can be read, listed, updated, or deleted through the API.
- `submit_run()` is `security definer`. It checks the sim id against `known_sims`, clamps every field, strips the
  nickname, drops oversized summaries, rate-limits each caller to 20 calls an hour, and returns only aggregates
  (counts and the median). No other player's row ever leaves the database.
- The rate limiter keys on `sha256(ip | secret salt | date)` and drops entries after two hours. The IP itself is never
  stored.
- `create_cohort()`, `prune_runs()`, and the `cohort_results` view aren't callable by `anon`. Use them from the SQL
  editor.

Anyone can still submit made-up scores for real sims through the API, within the rate limit. That's an accepted risk
for a low-stakes comparison. If it becomes a problem, add a minimum `periods` per sim or move submissions behind an
Edge Function with a captcha.

## Set up

1. In the Supabase dashboard, open **SQL Editor** and run
   [`migrations/20261015000000_benchmarks.sql`](migrations/20261015000000_benchmarks.sql), then
   [`seed.sql`](seed.sql). With the Supabase CLI, `supabase db push` does both.
2. Put the project URL and publishable key in [`player/js/config.js`](../player/js/config.js) (`supabaseUrl`,
   `supabaseAnonKey`).
3. Schedule the 12-month retention promised in the privacy page. Enable the `pg_cron` extension
   (**Database → Extensions**), then run:

   ```sql
   select cron.schedule('prune-runs', '17 3 * * *', 'select public.prune_runs()');
   ```

4. Check that the lockdown holds. Both of these should fail with the publishable key:

   ```bash
   curl "$SUPABASE_URL/rest/v1/runs?select=*" -H "apikey: $SUPABASE_KEY"
   curl "$SUPABASE_URL/rest/v1/rpc/create_cohort" -H "apikey: $SUPABASE_KEY" -H "Content-Type: application/json" -d '{"p_label":"x"}'
   ```

## Day to day

```sql
-- a class code for a lecturer (any sim, or pin it to one sim and level)
select public.create_cohort('MBA 2027 · Strategy');
select public.create_cohort('Ops 101 · Group B', '015', 'ug', 120);

-- that class's results
select * from public.cohort_results where join_code = 'K7PQ2M' order by sim_id, rank_in_class;

-- how much each sim is being compared
select sim_id, count(*), round(avg(score)::numeric, 1) from public.runs group by 1 order by 2 desc;
```

When `build_manifest.py` adds simulations, run `python supabase/gen_seed.py` and apply the new `seed.sql`. Until you
do, runs of the new sims are rejected and the card says the service is unavailable.

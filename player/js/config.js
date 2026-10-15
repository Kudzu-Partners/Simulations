/*
 * Telemetry configuration for the open site and player — the only place the
 * analytics and benchmarking endpoints are named. See privacy.html for what is
 * collected and supabase/README.md for the backend.
 *
 * Everything here is public by design: an Umami website id and a Supabase
 * publishable ("anon") key identify a project, they don't grant access to its data (the
 * database only exposes the submit_run function; see the migration).
 *
 * Leave a value empty to switch that layer off. Both layers also stay off on
 * any host not listed in `hosts`, so forks, mirrors, and local runs never
 * report into Eureka's numbers. To try them on localhost, run this once in
 * the devtools console:  localStorage.setItem('eureka-telemetry-dev', '1')
 * Events are then logged to the console instead of reaching Umami, and the
 * comparison card calls the real Supabase project, so test runs land there.
 */
window.EUREKA_CONFIG = {
  hosts: ['open.eurekasimulations.com'],

  /* Umami Cloud (cookieless, EU-hosted): anonymous page views + play events */
  umamiScript: 'https://cloud.umami.is/script.js',
  umamiWebsiteId: '21e37119-316d-4579-9dfb-0a601111b535',

  /* Supabase (EU region): opt-in "Compare my run" benchmarking */
  supabaseUrl: 'https://oyxgsfoidhhrhsgcvemf.supabase.co',
  supabaseAnonKey: 'sb_publishable_mBtSYCE7XRtUz15cAY3FTQ__brT-K2-'
};

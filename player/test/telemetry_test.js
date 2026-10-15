#!/usr/bin/env node
/*
 * Regression test for the player's analytics and opt-in benchmark
 * (js/config.js, js/analytics.js, js/benchmark.js, and their wiring in
 * js/player.js). Loads the real player/index.html in jsdom with its local
 * scripts inlined, serves repo files through a stubbed fetch, and plays the
 * part of the sim frame by posting the messages usf-shim.js sends.
 *
 * Nothing leaves the machine: Umami's script is never fetched (a stub stands
 * in for window.umami) and every Supabase call is answered by the test.
 *
 * Usage:   node telemetry_test.js          Requires: npm install jsdom
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PLAYER = path.join(ROOT, 'player');
const HOST = 'open.eurekasimulations.com';
const SIM = '523';

// config.js is plain JS that sets window.EUREKA_CONFIG; read it the same way the page does
const CONFIG = (() => { const w = {}; new Function('window', fs.readFileSync(path.join(PLAYER, 'js', 'config.js'), 'utf-8'))(w); return w.EUREKA_CONFIG; })();

/* index.html with every local <script src> inlined, so jsdom runs them in order */
function playerHtml() {
  return fs.readFileSync(path.join(PLAYER, 'index.html'), 'utf-8').replace(
    /<script src="((?:js|vendor)\/[^"]+)"><\/script>/g,
    (m, src) => '<script>' + fs.readFileSync(path.join(PLAYER, src), 'utf-8').replace(/<\/script/gi, '<\\/script') + '</script>'
  );
}
const HTML = playerHtml();

function response(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 3000) {
  for (let t = 0; t < ms; t += 10) { if (fn()) return; await sleep(10); }
  throw new Error('timed out waiting for ' + what);
}

/*
 * Boot the player. opts:
 *   host      page hostname (default: ours)
 *   search    query string (default: ?sim=523&lang=en)
 *   dnt       send Do Not Track
 *   supabase  (body, headers) => response | 'offline'   answers submit_run
 *   remote    { url: repoFile } extra URLs fetch may load (for ?src=)
 */
async function boot(opts = {}) {
  const host = opts.host || HOST;
  const errors = [];
  const rpc = [];
  const fetched = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String((e && e.message) || e);
    if (!/Could not parse CSS|Not implemented/.test(msg)) errors.push(msg);
  });
  const dom = new JSDOM(HTML, {
    url: 'https://' + host + '/player/' + (opts.search || '?sim=' + SIM + '&lang=en'),
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (opts.dnt) Object.defineProperty(window.navigator, 'doNotTrack', { value: '1' });
      window.fetch = (input, init) => {
        const url = new URL(String(input), window.location.href);
        fetched.push(url.href);
        if (CONFIG.supabaseUrl && url.href.startsWith(CONFIG.supabaseUrl)) {
          const call = { url: url.href, headers: init.headers, body: JSON.parse(init.body) };
          rpc.push(call);
          const answer = opts.supabase ? opts.supabase(call.body, call.headers) : response(200, {});
          return answer === 'offline' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(answer);
        }
        const remote = opts.remote && opts.remote[url.href];
        if (remote) return Promise.resolve(response(200, fs.readFileSync(path.join(ROOT, remote), 'utf-8')));
        if (url.hostname !== host) return Promise.reject(new TypeError('blocked in test: ' + url.href));
        const file = path.join(ROOT, decodeURIComponent(url.pathname));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return Promise.resolve(response(404, ''));
        return Promise.resolve(response(200, fs.readFileSync(file, 'utf-8')));
      };
      window.addEventListener('error', (e) => errors.push(String((e.error && e.error.stack) || e.message).split('\n')[0]));
    }
  });
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);
  const umamiTag = () => w.document.querySelector('script[src*="umami"]');
  const tracked = [];

  const env = {
    dom, w, $, errors, rpc, fetched, tracked, umamiTag,
    /* stand in for Umami's script finishing loading */
    // JSON round trip: objects built in jsdom's realm never deepStrictEqual Node's own
    umamiLoads() { w.umami = { track: (n, d) => tracked.push(JSON.parse(JSON.stringify([n, d]))) }; umamiTag().onload(); },
    umamiFails() { umamiTag().onerror(); },
    events(name) { return tracked.filter((e) => e[0] === name).map((e) => e[1]); },
    bench: () => $('bench'),
    benchShown: () => !!$('bench') && !$('bench').hidden,
    async play() {
      await until(() => $('viewPreview').classList.contains('active'), 'the preview');
      $('btnPlay').click();
      await until(() => $('frame').srcdoc && $('frame').srcdoc.length > 100, 'the play frame');
      await sleep(30);
    },
    /* what usf-shim.js posts, from the frame the host trusts */
    sim(msg) {
      w.dispatchEvent(new w.MessageEvent('message', { data: Object.assign({ usfPlayer: true }, msg), source: $('frame').contentWindow }));
    },
    finish(score = 60, extra = {}) { env.sim(Object.assign({ type: 'finished', score, periods: 4, summary: { overallScore: score } }, extra)); },
    async submit(fields) {
      const b = $('bench');
      if (fields.nick != null) b.querySelector('#benchNick').value = fields.nick;
      if (fields.level != null) b.querySelector('#benchLevel').value = fields.level;
      if (fields.code != null) b.querySelector('#benchCode').value = fields.code;
      b.querySelector('.bench-go').click();
      await sleep(30);
    },
    close() { w.close(); }
  };
  await until(() => w.EurekaBenchmark && w.eurekaTrack, 'the scripts');
  return env;
}

const comparison = (over = {}) => response(200, Object.assign({
  run_id: 'r1', level: 'mba',
  all: { n: 41, below: 30, equal: 1, median: 48.5 },
  peers: { n: 12, below: 6, equal: 0, median: 55 },
  cohort: null
}, over));

/* ───────────────────────── tests ───────────────────────── */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('config: Umami id and Supabase project are set, publishable key only', () => {
  assert.ok(CONFIG.hosts.includes(HOST));
  assert.match(CONFIG.umamiWebsiteId, /^[0-9a-f-]{36}$/);
  assert.match(CONFIG.supabaseUrl, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
  assert.ok(!/service_role|sb_secret_/.test(CONFIG.supabaseAnonKey), 'a secret key must never ship in config.js');
});

test('our host: Umami loads cookieless, queued events flush once it is ready', async () => {
  const t = await boot();
  const tag = t.umamiTag();
  assert.ok(tag, 'Umami script tag');
  assert.strictEqual(tag.getAttribute('data-website-id'), CONFIG.umamiWebsiteId);
  assert.strictEqual(tag.getAttribute('data-domains'), CONFIG.hosts.join(','));
  assert.strictEqual(tag.getAttribute('data-exclude-search'), 'true');
  assert.strictEqual(tag.getAttribute('data-do-not-track'), 'true');
  await until(() => t.$('viewPreview').classList.contains('active'), 'the preview');
  assert.strictEqual(t.tracked.length, 0, 'nothing sent before Umami is ready');
  t.umamiLoads();
  assert.deepStrictEqual(t.events('sim_preview'), [{ sim: SIM, via: 'link' }]);
  t.close();
});

test('play events: start, rounds (not undo), language, finish', async () => {
  const t = await boot();
  t.umamiLoads();
  await t.play();
  assert.deepStrictEqual(t.events('sim_play'), [{ sim: SIM, lang: 'en', level: 'advanced' }]);
  t.sim({ type: 'ready', lang: 'en', langs: ['en', 'es'] });
  t.sim({ type: 'progress', period: 1, maxPeriods: 4, finished: false });  // opening state
  t.sim({ type: 'progress', period: 2, maxPeriods: 4, finished: false });  // round 1 played
  t.sim({ type: 'progress', period: 1, maxPeriods: 4, finished: false });  // undo
  t.sim({ type: 'progress', period: 2, maxPeriods: 4, finished: false });  // round 1 again
  t.sim({ type: 'lang', lang: 'es' });
  t.finish(60);
  assert.deepStrictEqual(t.events('sim_round'), [{ sim: SIM, round: 1, of: 4 }, { sim: SIM, round: 1, of: 4 }]);
  assert.deepStrictEqual(t.events('sim_lang'), [{ sim: SIM, to: 'es' }]);
  assert.deepStrictEqual(t.events('sim_finish'), [{ sim: SIM, lang: 'es', rounds: 4, score: 60 }]);
  assert.deepStrictEqual(t.events('bench_shown'), [{ sim: SIM }]);
  assert.deepStrictEqual(t.errors, []);
  t.close();
});

test('card: nothing is sent until the player presses Compare', async () => {
  const t = await boot();
  await t.play();
  t.finish(60);
  assert.ok(t.benchShown(), 'card offered');
  assert.strictEqual(t.rpc.length, 0);
  t.bench().querySelector('.bench-no').click();
  assert.ok(!t.benchShown(), 'No thanks closes it');
  assert.strictEqual(t.rpc.length, 0);
  t.close();
});

test('card: level is required; the submit carries only what the card says', async () => {
  const t = await boot({ supabase: () => comparison() });
  t.umamiLoads();
  await t.play();
  t.sim({ type: 'ready', lang: 'en', langs: ['en', 'es'] });
  t.finish(60);
  await t.submit({ nick: 'Rocket', level: '' });
  assert.ok(/level/i.test(t.bench().querySelector('.bench-err').textContent));
  assert.strictEqual(t.rpc.length, 0);
  assert.strictEqual(t.bench().querySelector('#benchNick').value, 'Rocket', 'typed nickname survives the error');
  await t.submit({ level: 'mba', code: 'k7pq2m' });
  assert.strictEqual(t.rpc.length, 1);
  const call = t.rpc[0];
  assert.strictEqual(call.url, CONFIG.supabaseUrl + '/rest/v1/rpc/submit_run');
  assert.strictEqual(call.headers.apikey, CONFIG.supabaseAnonKey);
  if (!/^eyJ/.test(CONFIG.supabaseAnonKey)) assert.ok(!call.headers.Authorization, 'publishable keys go in apikey only');
  assert.deepStrictEqual(call.body, {
    p_sim_id: SIM, p_lang: 'en', p_level: 'mba', p_score: 60, p_periods: 4,
    p_nickname: 'Rocket', p_join_code: 'K7PQ2M', p_summary: { overallScore: 60 }
  });
  assert.deepStrictEqual(t.events('bench_submit'), [{ sim: SIM, level: 'mba', cohort: true }]);
  const text = t.bench().textContent;
  assert.ok(text.includes('Better than 74%'), text);   // (30 + 1/2) / 41
  assert.ok(text.includes('Better than 50%'), text);   // 6 / 12, at MBA level
  t.close();
});

test('card: a class result shows rank; too few runs says so', async () => {
  const t = await boot({ supabase: () => comparison({ all: { n: 3, below: 1, equal: 0, median: 50 }, cohort: { n: 4, below: 2, equal: 1, label: 'MBA 2027' } }) });
  await t.play();
  t.finish(60);
  await t.submit({ level: 'mba', code: 'K7PQ2M' });
  let text = t.bench().textContent;
  assert.ok(text.includes('MBA 2027') && text.includes('#2 of 5'), text);
  assert.ok(!text.includes('Everyone'), 'no "everyone" row under 10 runs');
  t.close();

  const u = await boot({ supabase: () => comparison({ all: { n: 2, below: 1, equal: 0, median: 50 }, peers: { n: 0, below: 0, equal: 0, median: null } }) });
  await u.play();
  u.finish(60);
  await u.submit({ level: 'ug' });
  text = u.bench().textContent;
  assert.ok(/Not enough runs yet .*3 so far/.test(text), text);
  u.close();
});

test('card: service errors keep the game untouched', async () => {
  const answers = [response(200, { error: 'unknown_code' }), response(200, { error: 'wrong_sim' }), response(200, { error: 'rate_limited' }), 'offline', response(500, 'boom')];
  for (const a of answers) {
    const t = await boot({ supabase: () => a });
    await t.play();
    t.finish(60);
    await t.submit({ level: 'mba', code: 'ZZZZZZ' });
    const text = t.bench().textContent;
    if (a === answers[0]) assert.ok(/class code wasn.t found/.test(text) && t.bench().querySelector('#benchCode'), 'stays on the form');
    else if (a === answers[1]) assert.ok(/different simulation/.test(text));
    else if (a === answers[2]) assert.ok(/Too many comparisons/.test(text));
    else assert.ok(/Couldn.t reach the comparison service/.test(text), text);
    assert.ok(t.$('viewPlay').classList.contains('active'), 'still playing');
    assert.deepStrictEqual(t.errors, []);
    t.close();
  }
});

test('card: offered once per play-through, again after a restart', async () => {
  const t = await boot({ supabase: () => comparison() });
  await t.play();
  t.finish(60);
  await t.submit({ level: 'mba' });
  t.bench().querySelector('.bench-close').click();
  t.finish(60);                                         // undo + finish again
  assert.ok(!t.benchShown(), 'not offered twice for one run');
  t.$('btnRestart').click();
  assert.ok(!t.benchShown());
  t.finish(55);
  assert.ok(t.benchShown(), 'offered for the new run');
  assert.strictEqual(t.bench().querySelector('#benchLevel').value, 'mba', 'level remembered in this browser');
  t.close();
});

test('card: no score, no card', async () => {
  const t = await boot();
  t.umamiLoads();
  await t.play();
  t.finish(null);
  t.finish('60');
  t.finish(NaN);
  assert.ok(!t.benchShown());
  assert.deepStrictEqual(t.events('sim_finish').map((e) => e.score), [null, null, null]);
  t.close();
});

test('custom sims: reported as "custom", never named, no card', async () => {
  const src = 'https://example.org/private/teacher-draft.json';
  const t = await boot({ search: '?src=' + encodeURIComponent(src), remote: { [src]: 'jsons/' + SIM + '.json' } });
  t.umamiLoads();
  await t.play();
  t.finish(60);
  assert.ok(!t.benchShown(), 'no card for a sim outside the catalog');
  assert.deepStrictEqual(t.events('sim_preview'), [{ sim: 'custom', via: 'url' }]);
  const sent = JSON.stringify(t.tracked);
  assert.ok(!sent.includes('example.org') && !sent.includes('teacher-draft'), sent);
  t.close();
});

test('other hosts (forks, mirrors, localhost): nothing loads, nothing is sent', async () => {
  for (const host of ['kudzu-partners.github.io', 'localhost']) {
    const t = await boot({ host });
    assert.strictEqual(t.umamiTag(), null, host + ': no Umami');
    await t.play();
    t.finish(60);
    assert.ok(!t.benchShown(), host + ': no card');
    assert.strictEqual(t.rpc.length, 0);
    assert.ok(!t.fetched.some((u) => !u.includes(host)), host + ' fetched only itself: ' + t.fetched.filter((u) => !u.includes(host)));
    t.close();
  }
});

test('Do Not Track: no Umami, but the explicit opt-in card still works', async () => {
  const t = await boot({ dnt: true, supabase: () => comparison() });
  assert.strictEqual(t.umamiTag(), null);
  await t.play();
  t.finish(60);
  assert.ok(t.benchShown());
  await t.submit({ level: 'mba' });
  assert.strictEqual(t.rpc.length, 1);
  t.close();
});

test('Umami blocked (ad blocker): events are dropped, the player carries on', async () => {
  const t = await boot({ supabase: () => comparison() });
  t.umamiFails();
  await t.play();
  t.sim({ type: 'progress', period: 1, maxPeriods: 4, finished: false });
  t.sim({ type: 'progress', period: 2, maxPeriods: 4, finished: false });
  t.finish(60);
  assert.strictEqual(t.tracked.length, 0);
  assert.ok(t.benchShown(), 'the comparison does not depend on Umami');
  assert.deepStrictEqual(t.errors, []);
  t.close();
});

test('Spanish: the card follows the page language', async () => {
  const t = await boot({ search: '?sim=' + SIM + '&lang=es' });
  await t.play();
  t.finish(60);
  assert.ok(t.bench().textContent.includes('Compara tu partida'));
  t.close();
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log('✔ ' + name); }
    catch (e) { failed++; console.log('✘ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();

#!/usr/bin/env node
/*
 * Headless smoke test for the Eureka Express Open Player.
 *
 * Assembles each simulation exactly like index.html does (same USF shim,
 * extracted from index.html so test == production), runs it in jsdom, and
 * plays every round by clicking #nextPeriodBtn with the sim's default inputs.
 * If a round refuses to advance (validateDecisions() = false), it nudges
 * generic inputs (sliders to mid, radios/checkboxes on, texts filled) and
 * retries. Sims that still refuse are healthy — they demand real human
 * choices — so the pass criterion is: bootstrapped with zero runtime errors.
 *
 * Usage:
 *   node headless_replay.js --sample 40          # stratified sample
 *   node headless_replay.js 001 002 271 1550     # specific sims
 *   node headless_replay.js --all                # entire catalog (slow)
 *   node headless_replay.js --jsons ../../jsons  # custom sims folder
 *
 * Requires: npm install jsdom
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function opt(name, dflt) {
  const i = args.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
const JSONS = opt('jsons', path.join(__dirname, '..', '..', 'jsons'));
const SAMPLE = parseInt(opt('sample', '0'), 10);
const ALL = args.includes('--all');
if (ALL) args.splice(args.indexOf('--all'), 1);

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const shimMatch = indexHtml.match(/<script type="text\/plain" id="usf-shim-src">([\s\S]*?)<\/script>/);
if (!shimMatch) { console.error('Could not extract USF shim from index.html'); process.exit(2); }
const SHIM = shimMatch[1];

function buildDoc(sim) {
  // mirror of buildFrame() in index.html (Chart.js replaced by a stub: jsdom has no canvas)
  const esc = (s) => String(s).replace(/<\/(script|style)/gi, (m) => '<\\/' + m.slice(2));
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>' + esc(sim.css || '') + '</style></head><body>' +
    (sim.view || '') +
    '<script>window.__USF_MAX_PERIODS__=' + (parseInt(sim.max_periods, 10) || 5) + ';</scr' + 'ipt>' +
    '<script>' + esc(SHIM) + '</scr' + 'ipt>' +
    '<script>' + esc(sim.js || '') + '</scr' + 'ipt>' +
    '</body></html>';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runSim(file) {
  const sim = JSON.parse(fs.readFileSync(path.join(JSONS, file), 'utf-8'));
  const maxP = parseInt(sim.max_periods, 10) || 5;
  const errors = [];
  const msgs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdom: ' + (e.detail && e.detail.message || e.message)));

  const dom = new JSDOM(buildDoc(sim), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.Chart = function (ctx, cfg) {
        this.data = (cfg && cfg.data) || { labels: [], datasets: [] };
        this.options = (cfg && cfg.options) || {};
        this.update = function () {};
        this.destroy = function () {};
        this.resize = function () {};
      };
      window.HTMLCanvasElement.prototype.getContext = function () { return {}; };
      window.parent.postMessage = (m) => { if (m && m.usfPlayer) msgs.push(m); };
      window.addEventListener('error', (e) => errors.push(String((e.error && e.error.stack) || e.message).split('\n')[0]));
    }
  });
  const { window } = dom;
  const doc = window.document;

  for (let i = 0; i < 60 && !window.mySimulation; i++) await sleep(10);
  if (!window.mySimulation) {
    dom.window.close();
    return { file, ok: false, stage: 'bootstrap', periods: 0, maxP, errors: errors.slice(0, 2) };
  }

  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  function nudgeInputs() {
    doc.querySelectorAll('input[type=range]').forEach((el) => {
      const min = +el.min || 0, max = +el.max || 100;
      el.value = String(Math.round((min + max) / 2));
      fire(el, 'input'); fire(el, 'change');
    });
    const groups = {};
    doc.querySelectorAll('input[type=radio]').forEach((el) => { (groups[el.name] = groups[el.name] || []).push(el); });
    Object.values(groups).forEach((g) => { if (!g.some((r) => r.checked)) { g[0].checked = true; fire(g[0], 'change'); fire(g[0], 'click'); } });
    doc.querySelectorAll('input[type=number]').forEach((el) => {
      if (el.value === '') { el.value = el.min !== '' ? el.min : '0'; fire(el, 'input'); fire(el, 'change'); }
    });
    doc.querySelectorAll('select').forEach((el) => { if (el.selectedIndex < 0 && el.options.length) { el.selectedIndex = 0; fire(el, 'change'); } });
    doc.querySelectorAll('input[type=checkbox]').forEach((el, i) => {
      if (!el.checked && i % 2 === 0) { el.checked = true; fire(el, 'change'); fire(el, 'click'); }
    });
    doc.querySelectorAll('input[type=text], input:not([type]), textarea').forEach((el) => {
      if (!el.value) {
        el.value = 'Ana Garcia - I would like to ask about your experience scaling operations, because your background fits our next milestone and I can share our market data in return.';
        fire(el, 'input'); fire(el, 'change');
      }
    });
  }

  const btn = () => doc.getElementById('nextPeriodBtn');
  let stuck = 0;
  for (let guard = 0; guard < maxP * 3 + 6; guard++) {
    const sim$ = window.mySimulation;
    if (sim$.state.currentPeriod > maxP) break;
    const before = sim$.state.currentPeriod;
    const b = btn();
    if (!b) break;
    b.click();
    await sleep(5);
    if (window.mySimulation.state.currentPeriod === before) {
      stuck++;
      if (stuck === 1) nudgeInputs();
      else if (stuck > 2) break; // genuinely requires human choices — not a runtime failure
    } else stuck = 0;
  }

  const st = window.mySimulation.state;
  const periods = window.mySimulation.history.length;
  const finished = msgs.some((m) => m.type === 'finished');
  const summary = finished ? msgs.find((m) => m.type === 'finished').summary : null;

  // exercise undo once if we played anything (regression guard for re-entrancy bugs)
  if (periods > 0 && st.currentPeriod <= maxP + 1) {
    try { window.mySimulation.undo(); window.mySimulation.submitPeriod(); } catch (e) { errors.push('undo/resubmit: ' + e.message); }
  }

  dom.window.close();
  // jsdom noise that is fine in real browsers: CSS it can't parse, unimplemented APIs (scrollTo, …)
  const hardErrors = errors.filter((e) => !/jsdom: (Could not parse CSS|Not implemented)/.test(e));
  // Pass = bootstrapped with zero runtime errors. Sims that refuse to advance
  // without meaningful human input (validateDecisions() = false) are healthy.
  const ok = hardErrors.length === 0;
  return {
    file, ok, maxP, periods, finished,
    hasSummary: summary != null,
    stage: hardErrors.length ? 'js-error' : (finished ? 'complete' : (periods > 0 ? 'partial(needs choices)' : 'blocked(needs choices)')),
    errors: hardErrors.slice(0, 2)
  };
}

(async () => {
  let files = fs.readdirSync(JSONS).filter((f) => f.endsWith('.json'));
  if (args.length) {
    files = args.map((a) => files.find((f) => f === a || f === a + '.json' || f.startsWith(a))).filter(Boolean);
  } else if (!ALL) {
    const n = SAMPLE || 40;
    const step = Math.max(1, Math.floor(files.length / n));
    files = files.filter((_, i) => i % step === 0).slice(0, n);
  }
  console.log(`Replaying ${files.length} simulation(s) from ${JSONS}\n`);
  let pass = 0, complete = 0, partial = 0, fail = 0;
  for (const f of files) {
    let r;
    try { r = await runSim(f); }
    catch (e) { r = { file: f, ok: false, stage: 'harness:' + e.message.split('\n')[0], periods: 0, errors: [] }; }
    if (r.ok) { pass++; if (r.finished) complete++; else partial++; }
    else fail++;
    const icon = r.ok ? (r.finished ? '✔' : '◐') : '✘';
    if (!r.ok || files.length <= 60 || process.env.VERBOSE)
      console.log(`${icon} ${r.file.padEnd(14)} ${String(r.periods).padStart(2)}/${r.maxP || '?'} rounds  ${r.stage}${r.hasSummary ? ' +summary' : ''}${r.errors && r.errors.length ? '  | ' + r.errors[0] : ''}`);
  }
  console.log(`\n${pass}/${files.length} ok (${complete} played to completion, ${partial} advanced but blocked on human choices), ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

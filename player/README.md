# Eureka Express — Open Simulation Player

A standalone, zero-backend player for **Eureka Express business simulations**. Each simulation is a single self-contained JSON file; this player provides an open implementation of the runtime they need, entirely in the browser. No account and no cookies; the sims themselves make no network calls. On the hosted site the player counts anonymous visits and offers an opt-in score comparison (see [Analytics and benchmarking](#analytics-and-benchmarking)).

**License: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)** — simulations and player code © Eureka Simulations / Kudzu Partners, shared for non-commercial use with attribution, share-alike. The case studies in `../cases/` are the exception: all rights reserved (see [`LICENSE.md`](../LICENSE.md)).

## Quick start

**▶ Hosted player: [open.eurekasimulations.com/player](https://open.eurekasimulations.com/player/)** — this repository is published with GitHub Pages, so the player is live as-is. Nothing to install.

Deep links: [`?sim=015`](https://open.eurekasimulations.com/player/?sim=015) loads a catalog sim by external id; `?src=https://…/sim.json` loads one from any CORS-enabled URL; `?lang=es` opens the player *and* the simulation in Spanish ([`?sim=015&lang=es`](https://open.eurekasimulations.com/player/?sim=015&lang=es)).

The language choice is remembered (`eureka-lang` in `localStorage`, shared with the landing page), so it carries from link to link. Without it the player follows the browser language, falling back to English.

To run it locally instead (development, offline use):

```bash
# from the repository root (the folder containing player/ and jsons/)
python -m http.server 8000
# then open http://localhost:8000/player/
```

Or simply open `player/index.html` from disk and **drag & drop** any simulation JSON onto the page (the catalog and charts need HTTP, but drag & drop works from `file://` too).

## What's in the box

```
player/
  index.html           the player: markup only, links css/player.css + js/player.js — three views (catalog grid, preview, play)
  css/player.css        chrome styles (catalog grid, preview screen, top bar, welcome screen)
  js/player.js           host logic: catalog browsing/filtering, preview routing, driving sims
  js/usf-shim.js         the USF runtime, fetched as text and injected into each sim's iframe
  js/config.js           Umami + Supabase settings, and the hosts they're allowed on
  js/analytics.js        anonymous Umami events (eurekaTrack)
  js/benchmark.js        the opt-in "Compare your run" card
  manifest.json        generated catalog index (id, name, category, level, rounds, langs, case…)
  build_manifest.py    regenerates manifest.json from a folder of sim JSONs
  vendor/chart.umd.min.js   Chart.js 4.4.0 (MIT), inlined into each sim for charts
  vendor/marked.min.js      marked 9.1.6 (MIT), renders the case studies in the host page
  test/headless_replay.js   jsdom smoke test that auto-plays sims round by round
  test/telemetry_test.js    jsdom test of the analytics events and the opt-in comparison card
jsons/                 the simulation catalog — one JSON per simulation
svgs/                  optional cover illustrations, matched by external id
cases/                 optional case studies, {externalid}.md — all rights reserved
```

## The simulation format

A simulation is one JSON object:

| Field | Type | Purpose |
|---|---|---|
| `externalid` | string | Stable unique id (e.g. `"015"`) |
| `name` | string | Display title |
| `description` | string | What you'll play and learn |
| `category` | string | `business`, `finance`, `education`, `sustainability`, … |
| `level` | string | `basic` / `intermediate` / `advanced` |
| `max_periods` | int | Number of rounds |
| `view` | HTML | The simulation's UI (uses `data-i18n` keys for text) |
| `css` | CSS | Scoped styles for the view |
| `js` | JS | The simulation model: a class extending `USF.SimulationAdapter` |

The `js` payload registers itself on `DOMContentLoaded`:

```js
class MySimAdapter extends USF.SimulationAdapter {
    initialize(state)            { /* seed state.domainState */ }
    setupUI(uiManager)           { /* uiManager.bind(elementId, 'domainState.kpi', fmt) */ }
    validateDecisions(decisions) { /* read inputs; return false to block the round */ }
    calculateResults(state)      { /* advance the model; return results object */ }
    getTranslations()            { return { en: {...}, es: {...} }; }
    getChartConfig()             { /* {canvasId: Chart.js config} or null */ }
    getChartData(state)          { /* fresh labels/datasets per round */ }
    getHistoryTableConfig()      { /* columns for #usfHistoryTable */ }
    getHint(state, results)      { /* coaching string or null */ }
    getPerformanceSummary(hist)  { /* final verdict object */ }
}
document.addEventListener('DOMContentLoaded', function () {
    window.mySimulation = new USF.SimulationFramework();
    window.mySimulation.initialize(new MySimAdapter(), { maxPeriods: 5 });
});
```

The view must include a `#nextPeriodBtn` (submit round) and conventionally `#undoBtn`, `#currentDay`, `#maxPeriods`, and `#usfHistoryTable`. Translations use `data-i18n` / `data-i18n-placeholder` attributes.

The **USF runtime shim** (`js/usf-shim.js`) implements this contract: i18n with live language switching, data bindings, the round loop with undo, Chart.js charts, the history table, hints, notifications, and an end-of-game summary. `js/player.js` fetches it as text and inlines it into each sim's iframe — it never runs in the host page itself. Sims run inside a sandboxed iframe (`sandbox="allow-scripts"`, opaque origin) and talk to the player chrome only via `postMessage` — a community-contributed JSON can't touch your page, storage, or network.

## Player features

Catalog search and category/level/**language** filters, cover thumbnails, random pick, round progress, on-demand hints from the sim's own coach logic, restart, fullscreen, and **session export** (downloads your decisions, per-round results, and final summary as JSON — handy for classroom debriefs).

The read-only **preview** runs the sim in its own sandboxed frame, so it opens in the page language with the opening briefing and KPIs filled in. A guard script swallows every click, key and focus before the sim sees it (the mouse wheel still scrolls), so nothing can be played there, and it pins the view to the top. Until the runtime shim has loaded, a static render of the `view` stands in, with designer defaults stripped (lists render blank; boxes and radios unticked; disabled mandatory items keep their state) so it never shows an option as if it had already been chosen.

Next to Play, **Request access for my class** links to Eureka's licensing page (`utm_medium=player`, `utm_content=sim-{id}`): classroom use is the licensed part.

### Languages

`build_manifest.py` reads each sim's `getTranslations()` and records the languages it ships as `langs` in `manifest.json`, so the catalog knows what's available before anything loads:

- **Filter** the catalog down to the sims you can teach in (`Any language` → `English` / `Spanish`).
- Each catalog row carries an `EN·ES` badge listing what that sim ships.
- A sim **starts in your language** — the player sets `<html lang>` on the sandboxed frame and the shim picks it up — instead of always opening in English.
- The per-sim buttons in the top bar switch a running sim live; the chrome follows, so the page never ends up half-translated.
- The choice persists (`eureka-lang`) and is reflected in the URL (`?lang=`), so a link you paste into a syllabus opens the way you left it.

A sim that doesn't ship the preferred language (only reachable via `?src=`) falls back to English and says so in a notice.

The JSON's `name` ships in one language, so `build_manifest.py` also records the sim's own title in each other language as `names` (e.g. `{"es": "Disrupción Fintech: BancaVerde"}`): the translation of the i18n key on the view's first `<h1>`, the title the sim shows once it runs. Catalog cards, the preview and the play bar use it in that language, sorting by name follows it, and search matches every name. English keeps the catalog `name`.

### Case studies

A catalog sim can have a companion case, `cases/{externalid}.md`: the teaching case it is built on (protagonist, company, baseline numbers, what the player controls). `build_manifest.py` records it as `case` (relative path) and `caseLang` (the case's language, detected from its text: cases ship in one language) in `manifest.json`, and counts them in the top-level `cases` field.

- The preview screen shows **📄 Case study** next to Play, and the top bar shows **📄 Case** while playing. Catalog cards with a case carry a 📄 marker.
- When `caseLang` differs from the page language the button says so, e.g. *Caso (en inglés)*.
- The case opens in a reader dialog in the host page, rendered with `vendor/marked.min.js`. Raw HTML in the Markdown is shown as text, never rendered; links open in a new tab. Esc, the ✕ button or a click on the backdrop closes it.
- The reader states above every case that it is all rights reserved and not covered by the CC license.
- The catalogue header a case opens with — the fenced `Case Code: … Keywords: …` block, or the bold `**Case Code:** …` / `**Time required: …**` lines — is library bookkeeping, so the reader leaves it out and shows only the subtitle.
- The preview reads the teacher-facing fields from that header — `Level`, `Time required` (or `Tiempo de clase`), `Discipline(s)` — plus the numbered `## Learning Objectives`, and shows them under the hero, noting the case's language when it differs from the page's. Cases that have none of them show nothing. **Copy objectives** puts them on the clipboard as a numbered list under the sim's name, ready for a syllabus.

Cases are copied verbatim from the Express source library; they are not edited here.

## Analytics and benchmarking

Both live in the host page and only listen to messages the sim frame already sends, so no simulation JSON changes.
They're configured in `js/config.js` and are off on any host not listed in `hosts` (forks, mirrors, `localhost`). To
try them locally, run `localStorage.setItem('eureka-telemetry-dev', '1')` in the console and reload.

**Umami events** (`js/analytics.js`, cookieless, skipped under Do Not Track / Global Privacy Control). Page views
drop the query string. A sim loaded from a file or `?src=` is reported as `custom`.

| Event | Data |
| --- | --- |
| `sim_preview` | `sim`, `via` (`catalog`, `link`, `random`, `file`, `url`) |
| `sim_play` | `sim`, `lang`, `level` |
| `sim_round` | `sim`, `round`, `of` |
| `sim_finish` | `sim`, `lang`, `rounds`, `score` |
| `sim_restart` | `sim`, `from` (`bar` or `summary`), `round` |
| `sim_lang`, `hint`, `case_open`, `session_export` | `sim`, plus `to` / `from` |
| `access_click` | `sim`, `lang` — the **Request access for my class** button |
| `objectives_copy` | `sim` |
| `bench_shown`, `bench_submit`, `bench_decline` | `sim`, plus `level` and `cohort` on submit |

**Compare your run** (`js/benchmark.js`). When a catalog sim finishes, a card offers to compare the score. Only if
the player presses *Compare my run* does it call the Supabase function `submit_run()`, which stores the run and returns
percentiles for everyone, the player's level, and their class (with a lecturer's class code). Backend, security model,
and class codes: [`../supabase/README.md`](../supabase/README.md).

**The score.** The shim's `finished` message carries `score`: the first finite `overallScore`, then `score`, found in
the summary, `domainState.performance`, or the last round's results. A sim with none gets no comparison card.
`headless_replay.js` prints `score=` for each completed run and `NO-SCORE` when a finished sim has none.

**Tests.** From `player/test` (after `npm install jsdom`):

```bash
node telemetry_test.js
node headless_replay.js --force --require-score --all
```

- `telemetry_test.js` loads the real player in jsdom with Umami and Supabase stubbed, so nothing is sent. It checks:
  - which events fire, with what data, and that a custom sim's name or URL never appears in them;
  - that nothing is sent until the player presses Compare, and exactly what is sent then;
  - every error answer from Supabase (unknown or wrong class code, rate limited, offline, server error);
  - that forks and `localhost` load and send nothing;
  - Do Not Track, a blocked Umami script, and the Spanish card.
- `--force` accepts any inputs, so every sim reaches its summary. `--require-score` fails a sim that finishes with no
  score field. A NaN score under `--force` is reported but not failed, because forced inputs can be ones the model
  rejects.

## Adding or updating simulations

1. Drop the new `{externalid}.json` into `jsons/` (and its case, if it has one, as `cases/{externalid}.md`).
2. Regenerate the catalog: `cd player && python build_manifest.py` — it reports any sim that ships fewer than two languages.
3. Refresh the benchmark allowlist: `python supabase/gen_seed.py`, then apply `supabase/seed.sql` (see [`../supabase/README.md`](../supabase/README.md)).
4. Smoke-test: `cd player/test && npm install jsdom && node headless_replay.js <id>` — it plays every round headlessly and reports runtime errors. Add `--lang es` for one language, or `--lang all` to replay each sim once per language it ships.

## Hosting (GitHub Pages)

The player is served with **GitHub Pages** straight from this repository, at the custom domain `open.eurekasimulations.com` (the repo-root `CNAME` file). Everything is static and relative — no build step. Forks deploy the same way: keep `player/`, `jsons/`, and `svgs/` intact, remove/replace the `CNAME` file, enable Pages on your fork, and the player works from any path.

## Attribution

Created by [Eureka Simulations](https://www.eurekasimulations.com/) (Kudzu Partners S.L.). Chart.js and marked are © their contributors, MIT-licensed. If you remix or redistribute, keep the attribution and the CC BY-NC-SA 4.0 terms.

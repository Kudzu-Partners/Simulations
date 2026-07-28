# Eureka Express — Open Simulation Player

A standalone, zero-backend player for **Eureka Express business simulations**. Each simulation is a single self-contained JSON file; this player provides an open implementation of the runtime they need, entirely in the browser. No server, no account, no tracking, no network calls at play time.

**License: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)** — simulations and player code © Eureka Simulations / Kudzu Partners, shared for non-commercial use with attribution, share-alike.

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
  manifest.json        generated catalog index (id, name, category, level, rounds, langs…)
  build_manifest.py    regenerates manifest.json from a folder of sim JSONs
  vendor/chart.umd.min.js   Chart.js 4.4.0 (MIT), inlined into each sim for charts
  test/headless_replay.js   jsdom smoke test that auto-plays sims round by round
jsons/                 the simulation catalog — one JSON per simulation
svgs/                  optional cover illustrations, matched by external id
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

### Languages

`build_manifest.py` reads each sim's `getTranslations()` and records the languages it ships as `langs` in `manifest.json`, so the catalog knows what's available before anything loads:

- **Filter** the catalog down to the sims you can teach in (`Any language` → `English` / `Spanish`).
- Each catalog row carries an `EN·ES` badge listing what that sim ships.
- A sim **starts in your language** — the player sets `<html lang>` on the sandboxed frame and the shim picks it up — instead of always opening in English.
- The per-sim buttons in the top bar switch a running sim live; the chrome follows, so the page never ends up half-translated.
- The choice persists (`eureka-lang`) and is reflected in the URL (`?lang=`), so a link you paste into a syllabus opens the way you left it.

A sim that doesn't ship the preferred language (only reachable via `?src=`) falls back to English and says so in a notice.

## Adding or updating simulations

1. Drop the new `{externalid}.json` into `jsons/`.
2. Regenerate the catalog: `cd player && python build_manifest.py` — it reports any sim that ships fewer than two languages.
3. Smoke-test: `cd player/test && npm install jsdom && node headless_replay.js <id>` — it plays every round headlessly and reports runtime errors. Add `--lang es` for one language, or `--lang all` to replay each sim once per language it ships.

## Hosting (GitHub Pages)

The player is served with **GitHub Pages** straight from this repository, at the custom domain `open.eurekasimulations.com` (the repo-root `CNAME` file). Everything is static and relative — no build step. Forks deploy the same way: keep `player/`, `jsons/`, and `svgs/` intact, remove/replace the `CNAME` file, enable Pages on your fork, and the player works from any path.

## Attribution

Created by [Eureka Simulations](https://www.eurekasimulations.com/) (Kudzu Partners S.L.). Chart.js is © its contributors, MIT-licensed. If you remix or redistribute, keep the attribution and the CC BY-NC-SA 4.0 terms.

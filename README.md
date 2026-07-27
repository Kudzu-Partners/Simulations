# Eureka Express — Open Simulations

Playable business simulations by [Eureka Simulations](https://www.eurekasimulations.com/) (Kudzu Partners S.L.), shared openly with a standalone player. Each simulation is a single self-contained JSON file — model, UI, styles, and translations included. The player runs them entirely in your browser: no backend, no account, no tracking.

**License: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)** — free to use, share, and adapt for **personal, non-commercial purposes** with attribution. Classroom and institutional teaching deployment is commercial use under the NC clause ([details](LICENSE.md)). For licensing — class runs, corporate training, LMS integration — [contact Eureka Simulations](https://www.eurekasimulations.com/).

## Play

**▶ [Play in your browser — open.eurekasimulations.com/player](https://open.eurekasimulations.com/player/)** — hosted with GitHub Pages. No install, no account.

Deep links work too: [`player/?sim=015`](https://open.eurekasimulations.com/player/?sim=015) (by external id), `player/?src=<url>` (any CORS-enabled JSON), or `?lang=es` to open the player and the simulation in Spanish — [`player/?sim=015&lang=es`](https://open.eurekasimulations.com/player/?sim=015&lang=es).

Every simulation ships in **English and Spanish**. The player records which languages each one supports, lets you filter the catalog by language, and starts a simulation in your language rather than defaulting to English; the choice follows you across the site and into shared links.

Prefer to run it locally (development, offline evaluation)?

```bash
git clone https://github.com/Kudzu-Partners/Simulations.git
cd Simulations
python -m http.server 8000
# open http://localhost:8000/player/
```

Or open `player/index.html` directly from disk and drag & drop any JSON from `jsons/` onto it.

## Teach this with a real class

The player above is single-learner, in your browser. To teach any of these simulations with a real cohort — LTI launch inside Moodle/Canvas, rosters, class mode with teams and competition, decision-level analytics, auto-debrief, and grade passback — Eureka runs it for you, class-ready:

**🎓 [Teach this with a real class →](https://www.eurekasimulations.com/basics/?utm_source=github&utm_medium=readme&utm_campaign=open_simulations)**

## What's here

```
player/    the standalone player: catalog browser + open USF runtime + headless test
jsons/     the simulations — one JSON per simulation
svgs/      cover illustrations
```

This catalog is seeded progressively as simulations pass our quality-review lifecycle; the full Express library holds 1,600+ simulations across business, finance, education, sustainability, hospitality, and tourism. Watch or star the repo to follow new drops.

## The format, in short

A simulation JSON carries metadata (`externalid`, `name`, `description`, `category`, `level`, `max_periods`) plus three payloads: `view` (HTML), `css`, and `js` — a class extending `USF.SimulationAdapter` that implements the round loop: `initialize`, `setupUI`, `validateDecisions`, `calculateResults`, charts, history, hints, translations (`en`/`es`), and a final performance summary. The player embeds an open implementation of that runtime and sandboxes each sim in an iframe. Full details in [`player/README.md`](player/README.md).

Round-trip smoke test for any sim, in one language or in every language it ships:

```bash
cd player/test
npm install jsdom
node headless_replay.js 015
node headless_replay.js --lang all 015
```

## Contribute

Bug reports, fixes, localizations, and new simulations are welcome — every contribution goes through the same quality gate as our own releases (format validation → headless replay in both languages → human review). See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`GOVERNANCE.md`](GOVERNANCE.md). Citing the catalog in a syllabus or paper? Use [`CITATION.cff`](CITATION.cff).

## Attribution

© 2026 Kudzu Partners S.L. / Eureka Simulations · Simulations and player shared under CC BY-NC-SA 4.0 ([full terms](LICENSE.md)) · Chart.js (bundled in `player/vendor/`) is MIT-licensed by its contributors.

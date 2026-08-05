# Contributing to Open Simulations

Thanks for wanting to improve the catalog. Every contribution — a bug report, a fix, a translation, a whole new simulation — goes through the same quality gate we apply to our own releases. No unreviewed content ships.

## Ways to contribute (the ladder)

1. **Report an issue.** Broken round, wrong score, untranslated string, accessibility problem — open a GitHub issue with the sim id (e.g. `015`), the round, the language you played in, and what you expected.
2. **Fix a sim.** PRs welcome on any `jsons/*.json`. Keep fixes scoped: one sim per PR, `js`/`view`/`css` payload changes only, and never change the `externalid`.
3. **Localize a sim.** Add or improve a language inside the sim's translation block (`en`/`es` today). Keep keys complete — partial translations fail review.
4. **Author a new simulation.** New sims follow the USF format documented in [`player/README.md`](player/README.md). Propose it in an issue first so we can check topic fit and avoid duplicates.
5. **Curate.** Professors who adopt sims in class and review one release wave get named credit on the catalog. Open an issue titled `Curator: <your name>` if you want in.

## The quality gate (what your PR must pass)

Every PR — ours included — must clear all four before merge, **in this order**:

1. **Format validation.** The JSON parses, carries the required metadata (`externalid`, `name`, `description`, `category`, `level`, `max_periods`) and the three payloads (`view`, `css`, `js`).
2. **Security review — read the payload before you run it.** A simulation's `js`, `view`, and `css` are executable code. Simulations are self-contained by design, so a payload is rejected if it makes network calls of any kind (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, remote `src` attributes, CSS `@import`, webfont URLs), uses `eval` / `new Function`, touches storage or cookies, reaches for `parent`/`top` outside the documented `postMessage` contract, shows credential- or payment-shaped UI, or arrives obfuscated or minified. Full threat model in [`SECURITY.md`](SECURITY.md).
3. **Headless replay.** A full round-trip run in both languages with zero JS errors:
   ```bash
   cd player/test
   npm install jsdom
   node headless_replay.js <externalid>
   ```
   ⚠️ The replay harness executes the sim's `js` with jsdom's `runScripts: 'dangerously'` — in Node, outside the browser sandbox, with filesystem and network access. That's why step 2 comes first. Reviewers: prefer a container or throwaway VM for unfamiliar contributions.
4. **Human review.** A maintainer (or curator) plays the sim and checks the pedagogy: decisions must matter, scores must react, feedback must teach.

## Rules

- **Don't change `externalid`** — it's the sim's permanent identity and deep-link anchor.
- **One sim per PR**, with a description of what was broken and how you verified the fix (replay output welcome).
- **Both languages or nothing.** UI text, chart labels, and performance summaries must work in `en` and `es`. Hard-coded strings in `js` are the most common review failure.
- **No real people, no real companies as protagonists,** no client names, no trademarks beyond fair descriptive use. Fictional scenarios only.
- **Found a security bug? Don't open an issue.** Report it privately — see [`SECURITY.md`](SECURITY.md).
- **License.** By contributing you agree your contribution is released under the repo license (CC BY-NC-SA 4.0). See [`GOVERNANCE.md`](GOVERNANCE.md) for how decisions get made.

## New releases

Sims are added in waves as they pass our quality-review lifecycle (see the release notes for each wave). Watch or star the repo to follow new drops.

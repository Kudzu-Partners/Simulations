# Security Policy

This repository has no backend, no accounts, and no database. It is a catalog of
self-contained simulation JSON files plus a static player, served from GitHub Pages
at [open.eurekasimulations.com](https://open.eurekasimulations.com/player/).

So the security surface here isn't a server — it's **arbitrary JavaScript from a
simulation JSON running in your browser**, and the player chrome that hosts it. A
simulation's `js`, `css`, and `view` payloads are code. The player confines them to a
sandboxed, opaque-origin iframe and talks to them only over `postMessage`. That
boundary is the thing we care most about keeping intact.

## Supported versions

This catalog ships in **waves**, not semantic versions, so there is nothing to
back-port and no old release to patch.

| What | Supported |
| --- | --- |
| `main` branch — current wave (`2026.07`) | :white_check_mark: |
| Hosted player at `open.eurekasimulations.com` (always serves `main`) | :white_check_mark: |
| Earlier wave tags and older commits | :x: — fixes land on `main` only |
| Forks and re-hosted copies | :x: — you maintain your own deployment |

Because Pages serves the tip of `main`, "upgrading" is a hard refresh. If you run a
local or forked copy, `git pull` before reporting anything.

## Reporting a vulnerability

**Use GitHub private vulnerability reporting** — the *Security* tab → *Report a
vulnerability*. Please don't open a public issue for a security bug; a working
sandbox-escape payload is a weapon until it's patched.

If that isn't available to you, write to **security@eurekasimulations.com**.

Useful report contents:

- The sim `externalid` (e.g. `015`) or the exact deep link, and the round it happens in.
- Browser and version — sandbox behaviour differs across engines.
- A **minimal** simulation JSON that reproduces it, attached to the private report rather
  than pasted anywhere public.
- What you observed versus what the boundary should have prevented.

What happens next:

| Stage | Timing |
| --- | --- |
| Acknowledgement | within 5 business days |
| Triage and severity call | within 10 business days |
| Sandbox escape / host-page XSS | patched on `main` and Pages as fast as we can verify a fix, target 7 days |
| Malicious or compromised catalog sim | pulled from `manifest.json` within 48h of confirmation (the file stays in git history) |
| Vendored dependency advisory | refreshed in the next wave, sooner if it's exploitable through the player |

If we accept a report, you get credit in the release notes for the wave that fixes it —
say the word and we'll keep you anonymous instead. Where a fix needs anyone to act
(a pulled sim, a re-hosted fork to update), we publish an advisory. If we decline, we
explain why, and if the answer is "that's a documented design boundary" we say so
plainly rather than closing in silence.

Please don't run automated scanners or load tests against the hosted domain, and note
that Eureka's commercial platform (LTI launch, class mode, rosters, grade passback) is a
separate codebase — report anything there through
[eurekasimulations.com](https://www.eurekasimulations.com/).

## In scope

1. **Sandbox escape.** Any way a simulation payload reaches the host page, its
   `localStorage`, the parent DOM, or the network from inside the play iframe.
2. **Host-page XSS.** Catalog metadata (`name`, `description`, `category`, manifest
   fields), deep-link parameters (`?sim=`, `?src=`, `?lang=`), dropped filenames, or
   `postMessage` payloads that execute in the player's origin instead of being escaped.
3. **`postMessage` trust.** Anything the chrome acts on that didn't come from the play
   frame, or any chrome action a sim can drive that it shouldn't.
4. **Malicious catalog content.** A sim in `jsons/` that exfiltrates, mines, phishes
   (credential-shaped prompts inside a simulation), or abuses `allow-modals`. Report it
   privately and we pull it.
5. **Supply chain.** The vendored Chart.js copy in `player/vendor/` and the cdnjs
   fallback path, `build_manifest.py`, and the jsdom test harness and its npm
   dependencies.
6. **Reviewer-side execution.** `player/test/headless_replay.js` runs a sim's `js` with
   jsdom's `runScripts: 'dangerously'` — in Node, outside the browser sandbox, with
   filesystem and network access. A contributed payload that targets a reviewer's machine
   there is a vulnerability report, not a bug report.
7. **Deployment.** CNAME or subdomain hijack of `open.eurekasimulations.com`, Pages
   misconfiguration, or anything serving content we didn't commit.

## Out of scope

- **Wrong numbers, unbalanced models, weak pedagogy, missing translations.** Open a normal
  issue — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **A sim that hangs, spins the CPU, or eats memory in its own frame.** Refresh the tab.
  Interesting only if it takes down the host page or survives a reload.
- **Response headers we cannot set.** GitHub Pages serves static files, so there is no
  custom CSP, HSTS, COOP, or COEP to configure.
- **`eureka-lang` in `localStorage`.** It's a two-letter language code and it's the only
  thing stored. No sessions, cookies, accounts, analytics, or personal data exist in this
  repo — there are no authentication bugs to find because there is no authentication.
- **Choosing to `?src=` a JSON you already know is hostile**, or anything you can only do
  to your own browser through devtools. Loading untrusted simulations is a documented
  feature and the sandbox is the boundary. Break the sandbox itself and you're squarely
  in scope under (1).
- **License and NonCommercial-clause violations.** Real, but not security — contact us.

## What the sandbox guarantees

- The play frame is `sandbox="allow-scripts allow-modals"`. No `allow-same-origin`, so
  it runs at an opaque origin with no access to the player's DOM, storage, cookies, or
  same-origin `fetch`. No `allow-forms`, `allow-popups`, or `allow-top-navigation`.
- The preview frame is `sandbox=""` — scripts never run there at all.
- The chrome checks `event.source` against the play frame's `contentWindow` before acting
  on any message. (Origin checks are useless against an opaque origin; source identity
  isn't.)
- The `css` and `js` payloads are escaped against `</script>` and `</style>` breakout when
  inlined into the frame document, so they can't restructure it.
- The USF runtime shim is injected into the frame, never executed in the host page.

What it does **not** guarantee: a simulation can still burn CPU and memory inside its own
frame, and `allow-modals` lets it raise `alert`/`confirm` dialogs. Treat any simulation
JSON from outside this repository as untrusted code that the sandbox makes safe to click.

## For contributors

Security review sits alongside format validation, headless replay, and human review in
the quality gate described in [`CONTRIBUTING.md`](CONTRIBUTING.md). A payload fails review
if it contains:

- **Network calls of any kind** — `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `navigator.sendBeacon`, remote `src` attributes, CSS `@import`, or webfont URLs.
  Simulations are self-contained by design; one that phones home is rejected regardless of
  intent.
- **`eval`, `new Function`, or other string-to-code paths** beyond what the USF contract
  needs.
- **Storage, cookie, or `parent`/`top` access** outside the documented `postMessage`
  contract.
- **Credential-shaped or payment-shaped UI**, or outbound links to anything other than the
  documented Eureka domains.
- **Obfuscated or minified `js`.** Review means reading it. Unreadable means rejected.

Keep `player/vendor/` pinned to a real upstream release, and don't add runtime
dependencies to the player — Chart.js is the only one, and that's deliberate.

**If you review PRs:** read the payload before you run `headless_replay.js`, and prefer a
container or throwaway VM. `runScripts: 'dangerously'` means exactly what it says.

---

© 2026 Kudzu Partners S.L. / [Eureka Simulations](https://www.eurekasimulations.com/) ·
Governance and maintainer roles: [`GOVERNANCE.md`](GOVERNANCE.md)

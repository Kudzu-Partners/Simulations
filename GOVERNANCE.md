# Governance

How this catalog is maintained, who decides what ships, and how you gain a voice in it.

## Roles

| Role | Who | What they do |
|---|---|---|
| **Maintainers** | Eureka Simulations (Kudzu Partners S.L.) | Own the release waves, run the QA pipeline, merge PRs, hold final say on catalog content |
| **Founding Curators** | Named professors who adopt and review sims | Review one wave per term, adopt 1–2 sims in class, advise on discipline coverage; credited on the catalog |
| **Contributors** | Anyone | Issues, fixes, localizations, new sims — see [`CONTRIBUTING.md`](CONTRIBUTING.md) |

## How content ships

- **Waves, not trickles.** New simulations land in periodic themed waves. Every sim in a wave has passed the full quality gate: automated validation, headless replay in both languages, and human review. The wave cadence is the commitment; wave size flexes to whatever passed review.
- **The canonical catalog lives here.** Forks are allowed by the license (BY-NC-SA), but issues, fixes, curation, and new waves happen in this repo. Improvements must flow back (ShareAlike).
- **Community PRs** go through the identical gate as our own releases. Nothing ships under this catalog's name without passing it — that's the deal that keeps a library this size trustworthy.
- **Deprecation.** A sim that fails QA and has no fix gets pulled from the manifest (the file stays in git history). We'd rather have fewer, working sims than a bigger, broken list.

## Decision-making

Maintainers decide merges and wave content, weighing curator input on pedagogy and discipline balance. Disagreements happen in the open, in issues. If we ever stop cutting waves, the catalog stays up and the license keeps everything usable — the repo doesn't retract.

## Quality transparency

Our review method (automated replay, defect classes we scan for, fix logs) is documented in the run reports we publish with each wave. "AI-generated" is how these sims are built; "human-reviewed and replay-tested" is why they're here.

## Contact

Commercial licensing, institutional hosting, or anything that doesn't fit an issue: [eurekasimulations.com](https://www.eurekasimulations.com/).

# shipcheck — Studio plugin (Creator Store edition)

**Automated pre-launch QA for your Roblox experience.** One click runs a
ship-readiness audit over the open place and returns a **SHIP / REVIEW / HOLD**
verdict with a 0–100 score and a categorized, actionable report — entirely inside
Studio. No companion server, no account hookup, no game data leaves your machine.

> This is the self-contained Creator Store plugin. It is a separate product from the
> repository's MCP-server edition (`src/`, `plugin/`), which drives audits from an AI
> client over a localhost bridge. This edition ships as a single `.rbxm`.

## What it checks

30+ heuristics across **9 categories**:

| Category | Examples |
|---|---|
| Security & Exploits | unvalidated RemoteEvents, `loadstring`/`require(id)` backdoors, client-readable secrets, client-authority leaks |
| Reliability & Data | DataStore without `pcall`, missing `BindToClose`, unguarded teleports, `HttpEnabled` mismatch |
| Monetization | missing `ProcessReceipt`, granting on prompt-finished, no monetization surface |
| Performance | unanchored static parts, streaming off on large places, Future lighting cost, precise mesh collision |
| Mobile & Low-End | offset-only UI, tiny touch targets, no mobile input path |
| UX & Accessibility | low text contrast, tiny text, default/empty baseplate |
| Policy & Compliance | unfiltered user text, off-platform links, maturity content signals |
| Analytics | no AnalyticsService, client-side analytics, missing economy events |
| Discovery & ASO | leftover debug/admin artifacts, misconfigured MaxPlayers, legacy lighting |

Every finding carries a severity, a confidence (`exact` for property checks,
`heuristic` for source scans), an explanation, a suggested fix, and a **jump-to-
instance** button. Findings never auto-change your place.

## Free vs Pro

- **Free**: full scan, verdict + score, and the top 10 blocker/high findings.
- **Pro**: every finding across all categories, all severities, exports, suppression
  lists, and baseline diffs.

## Architecture

```
src/
  init.server.luau   entry (only file using the `plugin` global)
  Bootstrap.luau     wires toolbar + dock widget + the scan→engine→report flow
  Config.luau        build-time edition + free-tier limits
  core/              PURE Luau, no Roblox API at require-time (headless-testable)
    Types/Severity/Categories/Scoring/Engine
    util/Source, util/Contrast
    rules/<category>/<Rule>.luau   one isolated, testable module per rule
  services/          Roblox-coupled adapters (DataModelScanner, ScriptReader,
                     Settings, Selection, License)
  ui/                dock widget, report view, components, palette
tests/               Lune specs for the pure core + every rule
```

The **service layer** scans the open DataModel once into a normalized, plain-data
inventory; the **pure core** runs every rule over that inventory under per-rule
`pcall` isolation. Because the core never touches live Instances, it runs headless
under [Lune](https://lune-org.github.io/docs) and every rule is unit-tested.

## Develop

Toolchain is pinned in `rokit.toml` (rojo, lune, selene, stylua). Install with
[Rokit](https://github.com/rojo-rbx/rokit): `rokit install`.

```bash
./scripts/check.sh        # format check + lint + headless tests + build
stylua src tests          # auto-format
lune run tests/runner.luau "$PWD"   # run the test suite
rojo build default.project.json -o build/shipcheck.rbxm
```

`scripts/build.sh` produces both the Pro and Free `.rbxm` artifacts.

## Publish

See [`docs/UPLOAD_GUIDE.md`](docs/UPLOAD_GUIDE.md) for the exact Creator Store steps,
[`docs/STORE_LISTING.md`](docs/STORE_LISTING.md) for ready-to-paste listing copy, and
[`docs/PRIVACY.md`](docs/PRIVACY.md) for the privacy statement.

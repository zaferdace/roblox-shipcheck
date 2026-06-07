# Changelog — shipcheck Studio plugin

All notable changes to the self-contained Creator Store edition.

## [1.0.0] — unreleased

Initial release of the standalone Studio plugin.

- Self-contained, in-Studio ship-readiness audit: **SHIP / REVIEW / HOLD** verdict +
  0–100 score, no companion server required.
- 30+ rules across 9 categories (Security, Reliability, Monetization, Performance,
  Mobile, UX/Accessibility, Policy, Analytics, Discovery).
- Pure Luau rules engine with per-rule `pcall` isolation, per-rule penalty-capped
  scoring, and a normalized plain-data scan context.
- Dockable report UI: severity-sorted findings, fix guidance, confidence labels, and
  jump-to-instance.
- Free vs Pro feature gating (top-10 blocker/high in Free; everything in Pro).
- Headless test suite (Lune) covering the engine, scoring, source lexer and every
  rule; CI runs stylua + selene + tests + a build.

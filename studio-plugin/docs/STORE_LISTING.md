# Creator Store listing — ready-to-paste copy

## Title (front-load the keyword + job-to-be-done)

```
shipcheck — Ship-Readiness Audit & Pre-Launch Checker
```

## Short hook (first ~100 chars matter; shown in listings)

```
One-click pre-launch audit: catch performance, security, monetization, mobile and policy issues before your players do.
```

## Description

```
shipcheck runs an automated ship-readiness audit over your open place and returns a SHIP / REVIEW / HOLD verdict with a 0–100 score — entirely inside Studio. No companion app, no account hookup, and your game data never leaves your machine.

WHAT IT CHECKS (30+ rules across 9 categories)
• Security & Exploits — unvalidated RemoteEvents, loadstring/require backdoors, client-readable secrets, client-authority leaks
• Reliability & Data — DataStore without pcall, missing BindToClose, unguarded teleports
• Monetization — missing ProcessReceipt, unsafe purchase grants
• Performance — unanchored static geometry, streaming off on large maps, heavy lighting, precise mesh collision
• Mobile & Low-End — offset-only UI, tiny touch targets, no mobile input path
• UX & Accessibility — low text contrast, unreadable text, default/empty places
• Policy & Compliance — unfiltered user text, off-platform links, maturity signals
• Analytics — missing AnalyticsService instrumentation, client-side analytics
• Discovery & ASO — leftover debug/admin artifacts, misconfigured MaxPlayers, legacy lighting

WHY IT'S DIFFERENT
Every other quality plugin checks one thing. shipcheck is the only opinionated, scored, cross-category launch gate — it tells you whether you're ready to ship, not just lists warnings. Each finding has a severity, an explanation, a suggested fix, and a one-click jump-to-instance. It never edits your place.

FREE vs PRO
• Free: full scan, verdict + score, top 10 blocker/high findings.
• Pro: every finding across all categories and severities, exports, suppression lists, and baseline diffs.

PRIVACY
Runs 100% locally in Studio. No network requests; no data leaves your machine.

Built by a mobile/Unity studio dev — actively maintained. Feedback and rule requests welcome on the DevForum thread.
```

## Tags (up to 5, search-intent)

```
audit, optimization, checklist, qa, release
```

## Pricing recommendation

- **Pro launch price: $24.99** (Creator Store plugin range is $4.99–$249.99; you keep
  ~100% of net). Rationale: no competitor offers a unified, scored, multi-category
  audit, so this is a premium B2B dev tool, not a $4.99 toy. Research clusters useful
  tools at $9.99–$19.99; a launch-gate report justifies the top of that band and above.
- **Launch week: 20% off** (~$19.99) to seed early sales and reviews.
- **After ~20 reviews / featuring: raise to $29.99.**
- **Free edition**: a separate $0 listing built from the same source
  (`scripts/build.sh` → `shipcheck-free.rbxm`) as the loss-leader that drives installs.

## Media plan (author native 16:9, 1920×1080 PNG; up to 5)

1. **Hero** — "Ship with confidence" + the shield/check icon + tagline.
2. **The report** (money shot) — the docked widget showing a real run: SHIP/REVIEW/HOLD
   header, score, and color-coded blocker/high/medium/low rows.
3. **Categories** — a 3×3 grid of the nine pillars.
4. **Finding detail** — one expanded finding with severity, fix and the "Select
   instance" button.
5. **CTA / trust** — "Catch issues before your players do" + the toolbar button.

Store icon: `assets/shipcheck_store_icon_512.png`. Toolbar icon:
`assets/shipcheck_toolbar_32.png`.

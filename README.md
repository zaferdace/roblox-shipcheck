# roblox-shipcheck

![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)

**Heuristic release checks for Roblox projects, with a report you can act on.**

`roblox-shipcheck` inspects a Roblox place and returns a release-readiness report in Markdown and JSON. It is built for pre-release review: security smells, DataStore mistakes, mobile/UI issues, marketplace wiring, localization gaps, teleport problems, package drift, and content-review flags.

```text
"Run shipcheck on my experience"
→ Returns a report with findings, severity, confidence, recommendations
→ Produces a verdict: SHIP / REVIEW / HOLD
→ Outputs Markdown + JSON
```

Smoke tests are included for basic structural verification, but shipcheck is the main product.

## Quick Start

1. Install the Studio plugin from [Releases](https://github.com/zaferdace/roblox-shipcheck/releases) and enable it in Roblox Studio.
2. Add this MCP server to your client config:

```json
{
  "mcpServers": {
    "roblox-shipcheck": {
      "command": "npx",
      "args": ["-y", "roblox-shipcheck"]
    }
  }
}
```

3. Open Studio and click **Toggle Connection** in the plugin toolbar.

## What It Checks

Shipcheck runs a focused release audit and returns one report.

Current report areas:
- Content maturity flags for manual review
- Remote security patterns
- DataStore safety issues
- Marketplace receipt and product wiring
- Mobile UI readiness
- Accessibility basics
- Localization coverage
- Teleport graph issues
- Package drift
- Performance hotspots

Each finding includes:
- Severity: `blocker`, `warning`, or `info`
- Confidence: `high`, `medium`, `heuristic`, or `manual_review`
- Recommendation: what to inspect or fix next

Smoke tests are available as secondary checks for a few common flows:
- `spawn_flow`
- `shop_flow`
- `tutorial_flow`
- `mobile_ux`

These are structural smoke tests, not gameplay automation.

## Sample Report

```markdown
# Shipcheck Report — My Obby Game
**Date:** 2026-03-29T18:00:00Z
**Verdict:** REVIEW — Score: 72/100

## Summary
- Blockers: 0
- Warnings: 3
- Info: 2
- Manual review needed: 2

## Issues

### Warnings
#### [remote-001] Unvalidated RemoteEvent handler
**Confidence:** high | **Category:** security | **Remediation:** assisted
Server handler for "PurchaseRequest" does not validate argument types.
**Evidence:** ServerScriptService.ShopHandler:14
**Recommendation:** Add type checks for all RemoteEvent arguments.

#### [mobile-001] Touch target below minimum size
**Confidence:** high | **Category:** mobile | **Remediation:** auto
TextButton "BuyBtn" is 32x28px, below 44x44 for reliable touch input.
**Evidence:** StarterGui.ShopUI.BuyBtn
**Recommendation:** Increase button size to at least 44x44.

#### [maturity-001] Social link reference detected
**Confidence:** manual_review | **Category:** social | **Remediation:** manual
Script contains "discord.gg" reference.
**Evidence:** ServerScriptService.WelcomeHandler:8
**Recommendation:** Verify all external references for policy compliance.
```

See [examples/](examples/) for full sample reports in Markdown and JSON.

## Limitations

Read this section literally. This tool is useful, but narrow.

- It does not play your game. It inspects project structure and script source.
- Content maturity checks are heuristic only. They flag review candidates, not policy violations.
- Smoke tests verify expected setup exists. They do not prove a player flow works.
- The verdict is a scoring rule, not a guarantee that a release is safe to ship.
- It can miss issues and it can raise false positives. A passing report means "nothing obvious was flagged by these checks," not "safe to publish."

## Architecture

```text
MCP Client <-stdio-> MCP Server <-http-> Bridge Server <-long-poll-> Studio Plugin
```

The server runs locally. The plugin connects over localhost. The plugin inspects the current Studio state and returns findings through the MCP server.

## Development

```bash
git clone https://github.com/zaferdace/roblox-shipcheck.git
cd roblox-shipcheck
npm install
npm run build
```

Useful scripts:
- `npm run build` — compile TypeScript
- `npm run dev` — watch mode
- `npm run check` — full gate (tsc + eslint + prettier + publint)

## Roadmap

- More report examples and sample fixtures
- Better baseline and diff support
- CI-friendly report export
- More targeted smoke test presets

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

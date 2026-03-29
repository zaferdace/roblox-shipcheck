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

## Quick Start

### Step 1: Install the Studio Plugin

1. Go to the [Releases page](https://github.com/zaferdace/roblox-shipcheck/releases)
2. Download `RobloxShipcheck.rbxm` from the latest release
3. Find your Roblox Studio plugins folder:
   - **Windows:** `%LOCALAPPDATA%\Roblox\Plugins\`
   - **Mac:** `~/Documents/Roblox/Plugins/`
   - **Or in Studio:** go to the **Plugins** tab → click **Plugins Folder** to open it
4. Copy `RobloxShipcheck.rbxm` into that folder
5. Restart Roblox Studio — you should see a **"Roblox Workflow MCP"** toolbar

### Step 2: Add the MCP Server

Add this to your AI client's MCP config file (works with Claude Desktop, Cursor, VS Code + Copilot, Windsurf, Cline):

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

> You need [Node.js](https://nodejs.org/) 18 or newer installed. `npx` will download the server automatically.

### Step 3: Connect

1. Open a place in Roblox Studio
2. Click the **"Toggle Connection"** button in the plugin toolbar
3. The Studio Output window should show: `[RBX-MCP] Connected to bridge`
4. Now you can ask your AI client to run shipcheck

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

### Smoke Tests (Experimental)

Structural smoke tests are available for a few common flows. These verify that expected setup exists, not that gameplay works at runtime.

- `spawn_flow` — Player spawn setup, starter scripts, spawn locations
- `shop_flow` — MarketplaceService usage, ProcessReceipt, shop UI presence
- `tutorial_flow` — Tutorial scripts, state persistence setup
- `mobile_ux` — Touch targets, input compatibility, GUI sizing

Smoke tests are experimental and best-effort. They are not a substitute for human QA.

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

## What Shipcheck Does Not Do

- It does not play your game or simulate users.
- It does not certify compliance or guarantee publish safety.
- It does not replace human QA or platform review processes.
- It does not access runtime state, network traffic, or live player data.
- It is a pre-release review assistant, not a release gate.

## Limitations

- Content maturity checks are heuristic only. They flag review candidates, not policy violations.
- Smoke tests verify expected setup exists. They do not prove a player flow works at runtime.
- The verdict is a scoring rule based on issue counts, not a comprehensive release policy.
- It can miss issues and it can raise false positives. A passing report means "nothing obvious was flagged," not "safe to publish."
- Some checks depend on Open Cloud API keys for full coverage. Without them, metadata-based checks are skipped.

## Tested Properties

Shipcheck has been tested against real Roblox Studio projects with the following results:

- Deterministic output: same verdict, score, and issues across repeated runs on the same project.
- False positive fixes: root path resolution and internal service filtering have been corrected.
- Edge cases handled gracefully: wrong port, invalid check names, invalid presets, missing results, zero-issue reports, and partial check selection all return clear errors or valid empty output.

## Architecture

```text
MCP Client <-stdio-> MCP Server <-http-> Bridge Server <-long-poll-> Studio Plugin
```

The server runs locally. The plugin connects over localhost (`127.0.0.1:33796`). The plugin inspects the current Studio state and returns findings through the MCP server. All mutations use `ChangeHistoryService` for undo support.

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
- Improved smoke test presets with clearer pass/fail semantics

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

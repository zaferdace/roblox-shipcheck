# roblox-shipcheck

![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)

**AI-assisted release readiness and guided playtesting for Roblox experiences.**

Catch publish blockers, maturity/compliance gaps, and gameplay flow issues before release. Built on top of MCP.

> MCP is the engine, not the product. The value is in **Shipcheck** (release readiness) and **Playtester** (guided scenario testing).

---

## What can it do?

### Shipcheck — Is it safe to publish?

Run one command. Get a structured report with blockers, warnings, and recommendations.

```
"Run shipcheck on my experience — can I publish?"
→ Scans for security risks, mobile issues, DataStore problems,
  content maturity flags, marketplace compliance, localization gaps
→ Returns SHIP / HOLD / REVIEW verdict with 0-100 score
→ Generates Markdown + JSON report
```

**13 automated checks:**

| Check | What it catches |
|-------|-----------------|
| Content maturity | Violence, language, social links, gambling mechanics flagged for review |
| Remote security | RemoteEvents without validation, missing rate limiting, trust boundary violations |
| DataStore safety | Unwrapped pcall, hardcoded keys, missing retry logic |
| Marketplace compliance | Missing ProcessReceipt, non-idempotent receipts, broken product references |
| Mobile UI readiness | Touch targets, safe areas, overlap, text readability |
| Accessibility | WCAG contrast, touch targets, text scaling |
| Localization coverage | Hardcoded text, missing locale entries |
| Teleport graph | Dead PlaceIds, circular teleports |
| Package drift | Stale packages, version mismatches |
| Performance hotspots | Instance counts, script complexity, physics pressure |
| Release diff | Baseline comparison, change risk scoring |
| Publish readiness | Aggregated gate across all checks |
| Structural sanity | Script placement, missing configuration |

Every finding includes:
- **Severity**: blocker / warning / info
- **Confidence**: high / medium / heuristic / manual_review
- **Remediation**: auto / assisted / manual

### Playtester — Does the experience actually work?

Run guided scenarios against your experience. Get evidence and failure reports.

```
"Run the spawn flow test on my game"
→ Checks StarterPlayer, SpawnLocation, starter scripts
→ Verifies shop UI, receipt handling, tutorial system
→ Reports pass/fail per step with evidence
```

**4 built-in presets:**
- `spawn_flow` — Player spawn, starter scripts, spawn locations
- `shop_flow` — MarketplaceService, ProcessReceipt, shop UI
- `tutorial_flow` — Tutorial scripts, state persistence
- `mobile_ux` — Touch targets, input compatibility, GUI sizing

Custom scenarios supported via JSON spec.

### Build — Let AI create, not just inspect

```
"Build a shop UI with title, scroll list, and buy buttons"
"Apply sunset lighting"
"Generate hilly terrain from -256 to 256"
```

### Full Studio Control — 16 CRUD primitives

Execute code, read/write scripts, create/delete/clone/move instances, manage tags and attributes, control playtest, read console output.

---

## Quick Start

**1. Install the Studio plugin**

Download `RobloxWorkflowMCP.rbxm` from [Releases](https://github.com/zaferdace/roblox-shipcheck/releases) and place it in your Roblox Studio plugins folder.

**2. Add to your MCP config** (Claude Desktop, Cursor, VS Code, or any MCP client):
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

**3. Connect**

Open Studio, click **"Toggle Connection"** in the plugin toolbar.

---

## Architecture

```
AI Client ←stdio→ MCP Server ←http→ Bridge Server ←long-poll→ Studio Plugin
              (Node.js)         (same process)        (Lua, outbound)
```

```
src/
├── tools/
│   ├── core/           16 CRUD primitives
│   ├── shipcheck/      13 audit & safety checks + report generator
│   ├── playtester/     Scenario engine with presets
│   ├── automation/     Safe patches, fix plans, publish, tests
│   ├── building/       UI builder, lighting, terrain
│   └── cloud/          Open Cloud API tools
├── bridge/             HTTP bridge server (127.0.0.1:33796)
├── roblox/             Studio Bridge + Open Cloud clients
└── types/              Shared type definitions
```

---

## Why not just use Roblox's built-in MCP?

Roblox's built-in MCP gives you **primitives** — create, read, update, delete, playtest.

`roblox-shipcheck` gives you **workflows**:

| Need | Built-in MCP | This project |
|------|:--:|:--:|
| Create a Part | Yes | Yes |
| Know if RemoteEvents are exploitable | - | Shipcheck |
| Know if DataStore calls will lose data | - | Shipcheck |
| Know if your UI works on iPhone SE | - | Shipcheck |
| Know if content maturity flags are needed | - | Shipcheck |
| Know if you can safely publish | - | Shipcheck |
| Test spawn → shop → tutorial flow | - | Playtester |
| Get a Markdown release report | - | Shipcheck |
| See what changed since last publish | - | Release diff |

---

## Prompt Cookbook

**"Can I ship this?"**
> "Run `rbx_shipcheck_report` with all checks. Show me the verdict and any blockers."

**"Test if my game works"**
> "Run `rbx_playtester` with the spawn_flow preset. Then run shop_flow."

**"What changed since last publish?"**
> "Save a baseline with `rbx_release_diff`, then run it again after changes."

**"Check content maturity risks"**
> "Run `rbx_content_maturity_check` on my experience."

---

## Shipcheck Report Example

```markdown
# Shipcheck Report — My Obby Game
**Date:** 2026-03-29T18:00:00Z
**Verdict:** REVIEW — Score: 72/100

## Summary
- 🔴 Blockers: 0
- 🟡 Warnings: 3
- ℹ️ Info: 2
- 👁 Manual review needed: 2

## Issues

### 🟡 Warnings
#### [remote-001] Unvalidated RemoteEvent handler
**Confidence:** high | **Category:** security | **Remediation:** assisted
Server handler for "PurchaseRequest" does not validate argument types.
**Evidence:** ServerScriptService.ShopHandler:14
**Recommendation:** Add type checks for all RemoteEvent arguments.
```

---

## Development

```bash
git clone https://github.com/zaferdace/roblox-shipcheck.git
cd roblox-shipcheck
npm install
npm run build
```

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Watch mode |
| `npm run check` | Full gate: tsc + eslint + prettier + publint |

---

## Roadmap

- [ ] npm publish
- [ ] Demo video (60s: shipcheck → playtester → report)
- [ ] Custom scenario editor
- [ ] CI/CD integration (shipcheck in GitHub Actions)
- [ ] Roblox Creator Marketplace plugin listing
- [ ] More playtest presets (PvP, economy, social)

---

## License

MIT

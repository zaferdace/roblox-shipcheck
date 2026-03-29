# roblox-shipcheck

![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)

**Static release checks and scenario smoke tests for Roblox experiences.**

Catch publish blockers, maturity flags, and structural issues before release. Get a Markdown report instead of vague AI advice. Built on MCP.

---

## What it does

### Shipcheck — Release audit

Run checks against your Roblox project. Get a structured report with findings, severity, confidence, and recommendations.

```
"Run shipcheck on my experience"
→ Scans scripts, UI, DataStores, remotes, marketplace setup
→ Flags issues with severity (blocker/warning/info) and confidence level
→ Returns SHIP / HOLD / REVIEW verdict with 0-100 score
→ Outputs Markdown + JSON report
```

**10 checks in the unified report:**

| Check | What it inspects |
|-------|-----------------|
| Content maturity | Heuristic keyword scan for violence, language, social links, gambling mechanics — flags for manual review |
| Remote security | RemoteEvents without validation, missing rate limiting, trust boundary patterns |
| DataStore safety | Unwrapped pcall, hardcoded keys, missing retry logic, budget unawareness |
| Marketplace compliance | ProcessReceipt handling, idempotency, product references |
| Mobile UI readiness | Touch targets, safe areas, overlap, text readability |
| Accessibility | Contrast ratios, touch targets, text scaling |
| Localization coverage | Hardcoded text, missing locale entries |
| Teleport graph | Dead PlaceIds, circular teleports, missing error handling |
| Package drift | Stale packages, version mismatches, disabled auto-update |
| Performance hotspots | Instance counts, script complexity, physics pressure |

Every finding includes:
- **Severity**: blocker / warning / info
- **Confidence**: high / medium / heuristic / manual_review
- **Remediation**: auto / assisted / manual

> Confidence labels reflect rule strength, not statistical accuracy. All content maturity findings require human review.

### Smoke Tests — Structural verification

Run scenario-based checks to verify your experience has expected structure.

```
"Run the spawn flow smoke test"
→ Checks StarterPlayer, SpawnLocation, starter scripts exist
→ Verifies shop UI and receipt handling structure
→ Reports pass/fail per step
```

**4 built-in presets:**
- `spawn_flow` — Player spawn setup, starter scripts, spawn locations
- `shop_flow` — MarketplaceService usage, ProcessReceipt, shop UI presence
- `tutorial_flow` — Tutorial scripts, state persistence setup
- `mobile_ux` — Touch targets, input compatibility, GUI sizing

> Smoke tests verify structural presence, not runtime gameplay. They check "does the shop system exist and have receipt handling?" not "can a player buy an item."

---

## Quick Start

**1. Install the Studio plugin**

Download `RobloxWorkflowMCP.rbxm` from [Releases](https://github.com/zaferdace/roblox-shipcheck/releases) and place it in your Roblox Studio plugins folder.

**2. Add to your MCP config:**
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

**3. Connect:** Open Studio, click **"Toggle Connection"** in the plugin toolbar.

---

## Sample Report

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

#### [mobile-001] Touch target below minimum size
**Confidence:** high | **Category:** mobile | **Remediation:** auto
TextButton "BuyBtn" is 32x28px, below 44px minimum for reliable touch input.
**Evidence:** StarterGui.ShopUI.BuyBtn
**Recommendation:** Increase button size to at least 44x44.

#### [maturity-001] Social link reference detected
**Confidence:** manual_review | **Category:** social | **Remediation:** manual
Script contains "discord.gg" reference.
**Evidence:** ServerScriptService.WelcomeHandler:8
**Recommendation:** Verify all external references for policy compliance.
```

---

## Why not just use Roblox's built-in MCP?

Built-in MCP gives you primitives — create, read, update, delete, playtest.

`roblox-shipcheck` adds a **check-and-report layer**:

| Need | Built-in MCP | Shipcheck |
|------|:--:|:--:|
| Create a Part | Yes | Yes |
| Know if RemoteEvents are exploitable | - | Check |
| Know if DataStore calls handle failures | - | Check |
| Know if UI works on mobile | - | Check |
| Flag content maturity risks for review | - | Check |
| Get a release report with verdict | - | Report |
| Verify spawn/shop/tutorial structure | - | Smoke test |

---

## Limitations

**Be aware of what this tool can and cannot do:**

- **Content maturity checks are heuristic.** They scan for keywords and patterns. They cannot determine actual content policy violations. All findings require human review.
- **Smoke tests verify structure, not gameplay.** They check if systems exist and are wired correctly, not whether a player can complete a flow at runtime.
- **Confidence labels are rule-based.** "High confidence" means the rule is specific and reliable, not that the finding is statistically validated.
- **The verdict is arithmetic.** SHIP/HOLD/REVIEW is computed from issue counts and severity weights, not from a comprehensive release policy.
- **No autonomous gameplay.** The tool does not play your game, simulate users, or test runtime behavior. It inspects the DataModel and script sources.
- **Plugin runs on localhost only.** Bridge server binds to `127.0.0.1:33796`. No remote access.
- **Some checks need Open Cloud API keys.** Experience metadata, asset status, and place publishing require Roblox Open Cloud credentials passed per-call.

---

## Architecture

```
AI Client ←stdio→ MCP Server ←http→ Bridge Server ←long-poll→ Studio Plugin
              (Node.js)         (same process)        (Lua, outbound)
```

```
src/tools/
├── shipcheck/      10 audit checks + content maturity + report generator
├── playtester/     Scenario smoke test engine with presets
├── core/           16 Studio primitives (CRUD, scripts, tags, playtest)
├── automation/     Safe patches, fix plans, publish, test runner
├── building/       UI builder, lighting presets, terrain generation
└── cloud/          Open Cloud API tools (experience info, assets, products)
```

The plugin communicates via HTTP long-polling. All mutations use `ChangeHistoryService` for full undo support. Session tokens authenticate the connection.

---

## Prompt Cookbook

**"Can I ship this?"**
> "Run `rbx_shipcheck_report` with all checks."

**"Check content maturity risks"**
> "Run `rbx_content_maturity_check` on my experience."

**"Verify my spawn flow"**
> "Run `rbx_playtester` with the `spawn_flow` preset."

**"What changed since last publish?"**
> "Save a baseline with `rbx_release_diff`, then run it again after changes."

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

- [ ] npm publish (beta)
- [ ] Sample reports in `examples/`
- [ ] Demo video (shipcheck → smoke test → report)
- [ ] CI/CD integration mode
- [ ] Roblox Creator Marketplace plugin listing
- [ ] More smoke test presets
- [ ] Custom scenario DSL

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

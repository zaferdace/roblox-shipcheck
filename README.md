# roblox-workflow-mcp

![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)

**Release and safety automation for Roblox Studio.** Audit your project, catch issues before players do, and ship with confidence — all through MCP.

Works with **any MCP-compatible client**: Claude Code, Claude Desktop, Cursor, VS Code + Copilot, Windsurf, Cline, Continue.dev, Zed.

> **Works alongside Roblox's built-in MCP.** This is not a replacement — it's a workflow layer on top. Roblox handles primitives; `roblox-workflow-mcp` handles guardrails, audits, and release engineering.

---

## What can it do?

### Build
Create UI, set lighting, generate terrain — let an AI agent build, not just inspect.

```
"Build a shop screen with a title, scrolling item list, and buy buttons."
"Apply sunset lighting to my scene."
"Generate hilly terrain from -256 to 256."
```

### Audit
10 automated checks that catch what manual review misses.

```
"Are my RemoteEvents validated against exploits?"
"Will my UI work on iPhone SE?"
"Are my DataStore calls wrapped in pcall with retry logic?"
"Do I have untranslated text?"
```

### Ship
One command to know if you can publish.

```
"Run release_readiness_gate — can I ship this?"
→ Checks security, mobile, datastores, marketplace, localization
→ Returns SHIP or HOLD with blocking issues
→ Suggests exactly what to fix
```

---

## The demo (60 seconds)

```
1. "Save a baseline of my current project."
   → rbx_release_diff saves a snapshot

2. ... you make changes ...

3. "What changed since my baseline? Can I ship?"
   → rbx_release_diff compares, finds 12 modified scripts
   → 2 touch RemoteEvents without validation → HIGH RISK
   → Recommends: run remote_contract_audit, validate_mobile_ui

4. "Run those audits and fix the issues."
   → Agent runs audits, generates fix plan
   → apply_patch_safe shows dry-run preview
   → You approve → changes applied with full undo

5. "Run the release gate again."
   → SHIP ✓ — all checks pass
```

---

## Quick Start

**1. Install the companion Studio plugin**

Copy `plugin/src/init.server.lua` into your Roblox Studio plugins folder, or use [Rojo](https://rojo.space) to build from `plugin/default.project.json`.

**2. Add to your MCP config** (Claude Desktop, Cursor, VS Code, or any MCP client):
```json
{
  "mcpServers": {
    "roblox-workflow-mcp": {
      "command": "npx",
      "args": ["-y", "roblox-workflow-mcp"]
    }
  }
}
```

**3. Connect the plugin**

Open Roblox Studio, click **"Toggle Connection"** in the plugin toolbar.

**4. Start using tools.**

> **Security note:** Roblox Open Cloud API keys are passed as tool arguments per-call. Never commit them to version control.

---

## Architecture

```
AI Client ←stdio→ MCP Server ←http→ Bridge Server ←long-poll→ Studio Plugin
              (Node.js)         (same process)        (Lua, outbound)
```

- **Bridge Server**: `node:http` on `127.0.0.1:33796`, command queue, session token auth
- **Studio Plugin**: `ChangeHistoryService` for full undo on all mutations
- **Open Cloud Client**: Roblox REST API with filesystem cache
- **Zero external dependencies** beyond MCP SDK and Zod

---

## Tools

### Audit & Safety

The core of this project — automated checks for Roblox-specific failure modes.

| Tool | What it catches |
|------|-----------------|
| `rbx_release_diff` | Baseline-aware diff: what changed, risk score, targeted audit recommendations, SAFE/REVIEW/HIGH_RISK verdict |
| `rbx_release_readiness_gate` | Aggregated ship/no-ship decision across all audit categories |
| `rbx_prepublish_audit` | Security, performance, quality, mobile, accessibility (0-100 per category) |
| `rbx_remote_contract_audit` | RemoteEvents without validation, missing rate limiting, trust boundary violations |
| `rbx_datastore_schema_guard` | Unwrapped pcall, hardcoded keys, missing retry logic, budget unawareness |
| `rbx_marketplace_compliance_audit` | Missing ProcessReceipt, non-idempotent receipts, broken product references |
| `rbx_localization_coverage_audit` | Hardcoded text, missing locale entries, dynamic string bypass |
| `rbx_accessibility_audit` | WCAG contrast, touch targets, text scaling, navigation |
| `rbx_validate_mobile_ui` | Safe areas, touch target overlap, text readability across devices |
| `rbx_teleport_graph_audit` | Dead PlaceIds, circular teleports, missing error handling |
| `rbx_package_drift_audit` | Stale packages, version mismatches, disabled auto-update |
| `rbx_profile_runtime_hotspots` | Instance/script hotspots with baseline regression detection |

### Automation & Release

| Tool | What it does |
|------|-------------|
| `rbx_apply_patch_safe` | Batch mutations with dry-run preview and Ctrl+Z undo |
| `rbx_generate_fix_plan` | Map a goal to a step-by-step tool execution plan |
| `rbx_publish_place` | Publish via Open Cloud API |
| `rbx_run_test_matrix` | TestService across server/client/multi-client configs |

### Building

| Tool | What it does |
|------|-------------|
| `rbx_execute_code` | Run Lua code in Studio |
| `rbx_ui_builder` | Create UI hierarchies from a declarative JSON spec |
| `rbx_lighting_preset` | 6 presets (realistic day/night, sunset, foggy, neon, studio flat) + custom |
| `rbx_terrain_generate` | Fill, clear, or generate landscapes with Perlin noise |

### Studio Primitives

Full CRUD for AI agents — every action needed to inspect and modify a project.

| Tool | Description |
|------|-------------|
| `rbx_project_snapshot` | DataModel tree snapshot with depth control |
| `rbx_search_project` | Search by name, class, property, or script content |
| `rbx_get_script_source` / `rbx_set_script_source` | Read/write script source |
| `rbx_create_instance` / `rbx_delete_instance` | Create or delete instances |
| `rbx_clone_instance` / `rbx_move_instance` | Clone or reparent |
| `rbx_get_instance_properties` / `rbx_set_instance_property` | Read/write properties |
| `rbx_get_children` / `rbx_get_selection` / `rbx_get_output` | Inspect hierarchy, selection, console |
| `rbx_manage_tags` / `rbx_manage_attributes` | CollectionService tags, instance attributes |
| `rbx_start_playtest` / `rbx_stop_playtest` | Playtest control |

### Open Cloud

| Tool | Description |
|------|-------------|
| `rbx_opencloud_experience_info` | Universe/place metadata |
| `rbx_asset_publish_status` | Asset moderation status |
| `rbx_list_products` | DevProducts and GamePasses |

---

## Why not just use Roblox's built-in MCP?

Roblox's built-in MCP gives you **primitives** — create, read, update, delete, playtest.

`roblox-workflow-mcp` gives you **workflows**:

| Need | Built-in MCP | This project |
|------|:--:|:--:|
| Create a Part | Yes | Yes |
| Know if your RemoteEvents are exploitable | - | `remote_contract_audit` |
| Know if your DataStore calls will lose data | - | `datastore_schema_guard` |
| Know if your UI works on iPhone SE | - | `validate_mobile_ui` |
| Know if you can safely publish | - | `release_readiness_gate` |
| See what changed since last publish | - | `release_diff` |
| Apply fixes with undo | - | `apply_patch_safe` |
| Get a step-by-step remediation plan | - | `generate_fix_plan` |

Use both. Let Roblox handle transport; let this project handle guardrails.

---

## Prompt Cookbook

**"Can I ship this?"**
> "Run `rbx_release_readiness_gate` with all checks. Show me blocking issues and how to fix them."

**"What changed since last publish?"**
> "Run `rbx_release_diff` against my baseline at `./baseline.json`. What's the risk?"

**"Audit my security"**
> "Run `rbx_remote_contract_audit` and `rbx_datastore_schema_guard`. Summarize high-severity issues."

**"Build a shop UI"**
> "Use `rbx_ui_builder` to create a shop screen under StarterGui with title, scroll list, and buy buttons."

**"Fix all mobile issues"**
> "Run `rbx_validate_mobile_ui`, then use `rbx_generate_fix_plan` to create a fix plan, then `rbx_apply_patch_safe` in dry-run mode."

---

## Response Shape

Every tool returns a consistent envelope:

```json
{
  "schema_version": "0.1.0",
  "source": { "studio_port": 33796 },
  "freshness": { "fresh": true, "timestamp": "2026-03-28T12:00:00.000Z", "ttl_ms": 3600000 },
  "warnings": [],
  "data": { }
}
```

---

## Plugin Setup

### Option A: Manual install
Copy `plugin/src/init.server.lua` to your Studio plugins folder → restart → click **"Toggle Connection"**.

### Option B: Rojo
```bash
cd plugin && rojo build -o RobloxWorkflowMCP.rbxm
```

### Plugin features
- One-click connect/disconnect
- Session token authentication
- Full undo via `ChangeHistoryService` — every mutation is Ctrl+Z reversible
- `ScriptEditorService` for accurate script reads
- `LogService` for console output capture

---

## Development

```bash
git clone https://github.com/zaferdace/roblox-workflow-mcp.git
cd roblox-workflow-mcp
npm install
npm run build
```

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Watch mode |
| `npm run check` | Full gate: tsc + eslint + prettier + publint |

### Adding a tool

1. Create `src/tools/your-tool.ts` with Zod schema + handler + `registerTool()`
2. Add import to `src/tools/register-all.ts`
3. If bridge needed: update `src/bridge/server.ts`, `src/roblox/studio-bridge-client.ts`, `plugin/src/init.server.lua`

---

## Roadmap

- [ ] npm publish
- [ ] Unit tests
- [ ] Demo video (60s end-to-end: baseline → changes → audit → fix → ship)
- [ ] SonarCloud integration
- [ ] awesome-mcp-servers PR

---

## License

MIT

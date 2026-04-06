# roblox-shipcheck

[![npm version](https://img.shields.io/npm/v/roblox-shipcheck)](https://www.npmjs.com/package/roblox-shipcheck)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![GitHub Stars](https://img.shields.io/github/stars/zaferdace/roblox-shipcheck?style=social)](https://github.com/zaferdace/roblox-shipcheck)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)](https://modelcontextprotocol.io/)

**~80 MCP tools for Roblox Studio — release audits, structural diffs, accessibility checks, playtester automation, asset insertion, gameplay scaffolding, and more.**

`roblox-shipcheck` connects your AI client directly to a live Roblox Studio session via a companion plugin. Ask your AI to run a full release audit, compare two versions of your project, fix mobile UI issues, or script the Studio — all without leaving your editor.

```text
"Run shipcheck on my experience"
→ Inspects security, DataStore safety, mobile UI, localization, and more
→ Returns a verdict: SHIP / REVIEW / HOLD with a score out of 100
→ Outputs Markdown + JSON
```

## Why roblox-shipcheck?

Roblox ships move fast. Before you hit publish, you need to know:

- Did I leave a RemoteEvent without server-side validation?
- Did the last refactor break any DataStore pcall wrappers?
- Are my buttons too small for mobile players?
- Did I accidentally hardcode an API key?
- What actually changed since the last build?

`roblox-shipcheck` gives your AI the tools to answer those questions against your live Studio state — not a static file export. It reads your DataModel, inspects script sources, checks GUI sizes and contrast ratios, and returns structured findings with severity, confidence, and remediation guidance.

It is a pre-release review assistant, not a release gate. It can miss things and it can raise false positives. A passing report means "nothing obvious was flagged," not "safe to publish."

## Quick Start

### Step 1: Install the Studio Plugin

1. Go to the [Releases page](https://github.com/zaferdace/roblox-shipcheck/releases)
2. Download `RobloxShipcheck.rbxm` from the latest release
3. Find your Roblox Studio plugins folder:
   - **Windows:** `%LOCALAPPDATA%\Roblox\Plugins\`
   - **Mac:** `~/Documents/Roblox/Plugins/`
   - **Or in Studio:** go to the **Plugins** tab → click **Plugins Folder**
4. Copy `RobloxShipcheck.rbxm` into that folder
5. Restart Roblox Studio — you should see a **"Roblox Workflow MCP"** toolbar

### Step 2: Add the MCP Server

Add this to your AI client's MCP config (Claude Desktop, Cursor, VS Code + Copilot, Windsurf, Cline):

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

> You need [Node.js](https://nodejs.org/) 18 or newer. `npx` downloads the server automatically on first use.

### Step 3: Connect and Run

1. Open a place in Roblox Studio
2. Click **"Toggle Connection"** in the plugin toolbar
3. Studio Output should show: `[RBX-MCP] Connected to bridge`
4. Ask your AI: `"Run shipcheck on my experience"` or `"Run a full pre-publish audit"`

**Example prompts:**

```
Run shipcheck on my experience and give me the full report.

Run a prepublish audit — security and mobile categories only.

Save a release baseline for my current project.

Check accessibility on all my GUI elements.

What changed since my last baseline? Recommend audits for the diff.

Run the spawn_flow smoke test and tell me if it passes.
```

## Tool Categories

~80 tools across 15 categories, all integration-tested against a live Studio session.

### Core (18 tools) — Studio inspection and mutation

| Tool | Description |
|------|-------------|
| `rbx_project_snapshot` | Capture the full DataModel tree |
| `rbx_get_children` | List children of an instance |
| `rbx_get_instance_properties` | Read all properties of an instance |
| `rbx_get_selection` | Get current Studio selection |
| `rbx_get_output` | Fetch Studio output log entries |
| `rbx_search_project` | Search by class, name, or script content |
| `rbx_get_script_source` | Read script source |
| `rbx_set_script_source` | Write script source |
| `rbx_execute_code` | Execute Lua code in Studio and capture output |
| `rbx_create_instance` | Create a new instance |
| `rbx_delete_instance` | Delete an instance |
| `rbx_clone_instance` | Clone an instance |
| `rbx_move_instance` | Move an instance to a new parent |
| `rbx_set_instance_property` | Set a property on an instance |
| `rbx_manage_tags` | Add, list, or remove CollectionService tags |
| `rbx_manage_attributes` | Get, set, or delete instance attributes |
| `rbx_start_playtest` | Start a Studio playtest |
| `rbx_stop_playtest` | Stop a Studio playtest |

### Shipcheck (14 tools) — Release audits and readiness

| Tool | Description |
|------|-------------|
| `rbx_shipcheck_report` | Full release audit — all checks, Markdown + JSON output |
| `rbx_prepublish_audit` | Categorized audit: security, performance, quality, mobile, accessibility |
| `rbx_validate_mobile_ui` | Mobile UI check — touch target sizes, safe area, font size |
| `rbx_accessibility_audit` | WCAG-style audit: contrast ratios, touch targets, text scaling, navigation |
| `rbx_remote_contract_audit` | Inspect RemoteEvent/Function validation patterns |
| `rbx_content_maturity_check` | Flag content maturity review candidates |
| `rbx_datastore_schema_guard` | Check DataStore safety — pcall coverage, key patterns |
| `rbx_localization_coverage_audit` | Detect hardcoded strings and localization gaps |
| `rbx_marketplace_compliance_audit` | Check ProcessReceipt wiring and product setup |
| `rbx_package_drift_audit` | Detect out-of-date or misconfigured PackageLinks |
| `rbx_teleport_graph_audit` | Analyze TeleportService usage and graph structure |
| `rbx_profile_runtime_hotspots` | Identify performance hotspots by instance counts and script size |
| `rbx_release_diff` | Diff current project against a saved baseline; recommend targeted audits |
| `rbx_release_readiness_gate` | Score-based go/no-go gate with configurable thresholds |

### Automation (4 tools) — Fix planning and testing

| Tool | Description |
|------|-------------|
| `rbx_apply_patch_safe` | Apply a patch to the DataModel with dry-run support |
| `rbx_generate_fix_plan` | Map a goal to a step-by-step remediation plan |
| `rbx_run_test_matrix` | Run TestService suites across server/client configurations |
| `rbx_publish_place` | Publish a place via Open Cloud API |

### Building (5 tools) — Studio scene building

| Tool | Description |
|------|-------------|
| `rbx_lighting_preset` | Apply a lighting preset (Neon, Retro, Realistic, etc.) |
| `rbx_terrain_generate` | Generate terrain fills and shapes |
| `rbx_ui_builder` | Build nested GUI hierarchies from JSON descriptions |
| `rbx_marketplace_insert` | Insert an asset from the Roblox Creator Marketplace by asset ID |
| `rbx_asset_preset` | Browse and insert assets from curated preset categories |

### Gameplay (4 tools) — Gameplay systems scaffolding

| Tool | Description |
|------|-------------|
| `rbx_create_system` | Generate a gameplay system scaffold (round loop, inventory, etc.) |
| `rbx_wire_system_dependencies` | Wire dependencies between gameplay systems |
| `rbx_shop_builder` | Build a shop UI and transaction handler |
| `rbx_economy_designer` | Design and balance in-experience economy parameters |

### NPC/AI (3 tools) — NPC and enemy design

| Tool | Description |
|------|-------------|
| `rbx_npc_builder` | Scaffold an NPC with pathfinding and behavior hooks |
| `rbx_navmesh_path_audit` | Audit NavMesh reachability and path quality |
| `rbx_enemy_wave_designer` | Design enemy wave sequences and spawn timing |

### Content (5 tools) — Asset and content audits

| Tool | Description |
|------|-------------|
| `rbx_animation_audit` | Audit animation assets for missing events and weight issues |
| `rbx_audio_audit` | Audit audio assets for missing sounds and volume consistency |
| `rbx_asset_dependency_graph` | Map asset dependencies and detect circular references |
| `rbx_prefab_builder` | Build gameplay prefabs (chest, door, turret, etc.) from templates |
| `rbx_security_scan_deep` | Deep security scan beyond standard remote contract checks |

### Telemetry (3 tools) — Analytics and profiling

| Tool | Description |
|------|-------------|
| `rbx_telemetry_session_trace` | Trace a session event flow for analytics validation |
| `rbx_remote_budget_profiler` | Profile remote event bandwidth usage |
| `rbx_funnel_analysis` | Analyze player funnel drop-off points |

### Level Design (2 tools) — Layout and flow

| Tool | Description |
|------|-------------|
| `rbx_level_flow_builder` | Build level flow graphs and transition logic |
| `rbx_procedural_layout` | Generate procedural layout templates for rapid prototyping |

### Genre — Tycoon (3 tools) — Tycoon-specific checks

| Tool | Description |
|------|-------------|
| `rbx_tycoon_plot_system_audit` | Audit plot ownership and claim system integrity |
| `rbx_tycoon_dropper_balance` | Analyze dropper output rates and balance |
| `rbx_tycoon_idle_earnings_check` | Validate idle earnings caps and anti-exploit patterns |

### Genre — Obby (3 tools) — Obstacle course checks

| Tool | Description |
|------|-------------|
| `rbx_obby_checkpoint_graph` | Map checkpoint ordering and reachability |
| `rbx_obby_difficulty_ramp` | Analyze difficulty progression across sections |
| `rbx_obby_mobile_jump_audit` | Audit jump gaps and platform sizes for mobile players |

### Genre — RPG (3 tools) — RPG-specific checks

| Tool | Description |
|------|-------------|
| `rbx_rpg_quest_system_audit` | Audit quest state machines and reward wiring |
| `rbx_rpg_loot_table_audit` | Validate loot table weights and edge cases |
| `rbx_rpg_combat_stat_balance` | Analyze combat stat formulas for balance outliers |

### Cloud (3 tools) — Open Cloud API

| Tool | Description |
|------|-------------|
| `rbx_opencloud_experience_info` | Fetch universe and place metadata |
| `rbx_asset_publish_status` | Check asset publish status |
| `rbx_list_products` | List developer products and game passes |

### Playtester (1 tool) — Structural smoke tests

| Tool | Description |
|------|-------------|
| `rbx_playtester` | Run structural smoke tests: `spawn_flow`, `shop_flow`, `tutorial_flow`, `mobile_ux` |

### Genre — Shooter (9 tools) — Opt-in genre checks

| Tool | Description |
|------|-------------|
| `rbx_shooter_weapon_remote_trust` | Analyze weapon Remote trust and validation patterns |
| `rbx_shooter_spawn_clustering` | Check spawn placement fairness heuristics |
| `rbx_shooter_combat_content_maturity` | Flag combat-related content for maturity review |
| `rbx_shooter_anticheat_surface` | Audit anti-cheat surface area and exploitable patterns |
| `rbx_shooter_hitbox_audit` | Inspect hitbox sizes and registration accuracy |
| `rbx_shooter_mobile_hud` | Validate mobile HUD layout for shooter controls |
| `rbx_shooter_scope_ui_check` | Check scope and ADS UI for clarity and occlusion |
| `rbx_shooter_team_infrastructure` | Audit team assignment and respawn infrastructure |
| `rbx_shooter_weapon_config_sanity` | Validate weapon configuration values for outliers |

## Asset Insertion

roblox-shipcheck includes tools for inserting assets from the Roblox Creator Marketplace into your project.

### Methods

**1. Direct Marketplace Insert (requires published place)**

```bash
# Insert by asset ID
rbx_marketplace_insert --asset_id 1234567 --position '{"x":0,"y":5,"z":0}'
```

`InsertService:LoadAsset` requires the place to be published to Roblox. For unpublished places, use the Toolbox Clone method below.

**2. Toolbox Clone (works everywhere)**

For unpublished places or when InsertService is restricted:

1. Open **Toolbox** in Roblox Studio (View → Toolbox)
2. Search for the asset you want (e.g., "Oak Tree")
3. Click to add it to the scene (one time only)
4. Use `rbx_clone_instance` to duplicate and position it anywhere:

```
rbx_clone_instance --path "Workspace.Oak Tree" --new_parent "Workspace"
```

This is the recommended workflow for building environments — add one template from Toolbox, then clone it programmatically across your scene.

**3. Preset Library**

Browse and insert from curated asset categories:

```bash
# List available presets
rbx_asset_preset --category environment --preset list

# Insert a preset
rbx_asset_preset --category environment --preset oak_tree
```

Available categories: `environment`, `characters`, `vehicles`, `weapons`, `furniture`, `effects`, `structures`, `ui_kits`

> **Note:** Preset asset IDs may need to be updated with real Roblox marketplace IDs. The preset system works best with published places.

**4. Procedural Generation**

For quick prototyping without marketplace dependencies, use the prefab builder:

```bash
# Create gameplay prefabs from code
rbx_prefab_builder --prefab_type chest --prefab_name "RewardChest" --position '{"x":10,"y":5,"z":0}'
```

Available prefab types: `chest`, `door`, `turret`, `trap`, `pickup`, `checkpoint`, `vendor`, `portal`

## Studio Plugin

The Roblox Studio plugin automatically reconnects to the MCP bridge when the connection is lost. No manual intervention needed — the plugin retries every 5 seconds until the bridge is available.

Install: copy `plugin/src/RobloxShipcheck.rbxm` to your Roblox Plugins folder:

```bash
cp plugin/src/RobloxShipcheck.rbxm ~/Documents/Roblox/Plugins/
```

## What Shipcheck Checks

When you run `rbx_shipcheck_report`, it runs up to 10 checks and returns one report:

- Remote security patterns (unvalidated handlers, payload sanitization)
- DataStore safety (pcall coverage, transient failure handling)
- Marketplace receipt and product wiring
- Mobile UI readiness (touch targets, safe area)
- Accessibility basics (contrast, text size, keyboard navigation)
- Localization coverage (hardcoded string detection)
- Teleport graph issues
- Package drift
- Content maturity flags (for manual review)
- Performance hotspots (part counts, script sizes, UI depth)

Each finding includes severity (`blocker`, `warning`, `info`), confidence (`high`, `medium`, `heuristic`, `manual_review`), and a recommendation.

### Sample Report

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
```

See [examples/](examples/) for full sample reports in Markdown and JSON.

## Studio-Tested

38 PASS, 4 SKIP, 1 PARTIAL (original 43 tools). New tools integration-tested as added. Tested against a live Roblox Studio session on 2026-03-29.

| Category | Tools | Pass | Skip | Partial |
|----------|-------|------|------|---------|
| Core | 18 | 17 | 0 | 1 |
| Shipcheck | 14 | 14 | 0 | 0 |
| Automation | 4 | 3 | 1 | 0 |
| Building | 5 | 5 | 0 | 0 |
| Cloud | 3 | 0 | 3 | 0 |
| Playtester | 1 | 1 | 0 | 0 |
| Genre — Shooter | 9 | 9 | 0 | 0 |
| Gameplay | 4 | 4 | 0 | 0 |
| NPC/AI | 3 | 3 | 0 | 0 |
| Content | 5 | 5 | 0 | 0 |
| Telemetry | 3 | 3 | 0 | 0 |
| Level Design | 2 | 2 | 0 | 0 |
| Genre — Tycoon | 3 | 3 | 0 | 0 |
| Genre — Obby | 3 | 3 | 0 | 0 |
| Genre — RPG | 3 | 3 | 0 | 0 |
| **Total** | **~80** | **75** | **4** | **1** |

- **Skip:** Cloud tools require an Open Cloud API key (schema validated, not callable without credentials).
- **Partial:** `rbx_start_playtest` returns a plugin capability error (`StartDecal`). Playtest control may require manual interaction in some Studio configurations.

See [TESTING.md](TESTING.md) for the full per-tool test matrix.

## What Shipcheck Does Not Do

- It does not play your game or simulate users.
- It does not certify compliance or guarantee publish safety.
- It does not replace human QA or platform review processes.
- It does not access runtime state, network traffic, or live player data.

## Limitations

- Content maturity checks are heuristic only. They flag review candidates, not policy violations.
- Smoke tests verify that expected setup exists, not that a player flow works at runtime.
- The verdict is a scoring rule based on issue counts, not a comprehensive release policy.
- Some checks depend on Open Cloud API keys for full coverage.
- Genre-specific checks use keyword and pattern matching. Unconventional architectures may produce false positives or missed detections.

## Architecture

```text
MCP Client <-stdio-> MCP Server <-http-> Bridge Server <-long-poll-> Studio Plugin
```

The server runs locally. The plugin connects over localhost (`127.0.0.1:33796`). All mutations use `ChangeHistoryService` for undo support.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code style, and the PR process.

Quick summary:

1. Fork and create a branch (`feat/` or `fix/`)
2. Add your tool file, call `registerTool()`, import it in `register-all.ts`
3. Run `npm run check` — must pass before opening a PR
4. Open a PR against `main`

Code style: TypeScript strict, no `any`, minimal comments, all imports use `.js` extension (ESM Node16 resolution).

## Roadmap

- More report examples and sample fixtures
- Better baseline and diff support
- CI-friendly report export
- Improved smoke test presets with clearer pass/fail semantics

## License

MIT

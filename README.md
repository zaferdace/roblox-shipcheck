# roblox-workflow-mcp

![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)
![Tools: 39](https://img.shields.io/badge/tools-39-purple)

**Workflow-grade MCP server for Roblox.** Inspection, CRUD, mobile QA, pre-publish audit, test runner, safe automation, UI building, terrain generation, and more — all through MCP.

Works with **any MCP-compatible client**: Claude Code, Claude Desktop, Cursor, VS Code + Copilot, Windsurf, Cline, Continue.dev, Zed.

> **Not just another wrapper.** Competitors offer ~10 basic CRUD tools. `roblox-workflow-mcp` provides **39 tools** spanning primitives, workflow automation, security audits, release gates, and creative building — the most comprehensive Roblox MCP server available.

---

## Quick Start

**1. Install the companion Roblox Studio plugin**

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

Open Roblox Studio, click the **"Toggle Connection"** button in the plugin toolbar. The bridge server starts automatically with the MCP server on `127.0.0.1:33796`.

**4. Start using tools in your AI client.**

> **Security note:** API keys for Roblox Open Cloud are passed as tool arguments per-call. Never commit them to version control. Use environment variables or your AI client's secret management.

---

## Architecture

```
AI Client ←stdio→ MCP Server ←http→ Bridge Server ←long-poll→ Studio Plugin
              (Node.js)         (same process)        (Lua, outbound)
```

- **Bridge Server**: `node:http` on `127.0.0.1:33796`, command queue, session token auth, long-poll (25s)
- **Studio Plugin**: Outbound HTTP client, toolbar connect/disconnect toggle, `ChangeHistoryService` for full undo on all mutations
- **Open Cloud Client**: Roblox Open Cloud REST API with filesystem cache (SHA-256 keyed, 1h TTL)
- **Zero external dependencies** beyond MCP SDK and Zod

---

## Tools (39)

### CRUD Primitives

The building blocks — every action an agent needs to inspect and modify a Roblox project.

| Tool | Description |
|------|-------------|
| `rbx_execute_code` | Execute arbitrary Lua code in Roblox Studio |
| `rbx_get_script_source` | Read script source by DataModel path |
| `rbx_set_script_source` | Write/update script source with undo support |
| `rbx_create_instance` | Create a new instance under a parent path |
| `rbx_delete_instance` | Delete an instance by DataModel path |
| `rbx_clone_instance` | Clone an instance, optionally to a new parent |
| `rbx_move_instance` | Move/reparent an instance |
| `rbx_get_instance_properties` | Read all properties of an instance |
| `rbx_set_instance_property` | Set a single instance property |
| `rbx_get_children` | List children of an instance with depth control |
| `rbx_get_selection` | Get current Studio selection |
| `rbx_get_output` | Fetch Studio output/console log entries |
| `rbx_manage_tags` | Add, remove, or list CollectionService tags |
| `rbx_manage_attributes` | Get, set, or delete instance attributes |
| `rbx_start_playtest` | Start a Studio playtest session |
| `rbx_stop_playtest` | Stop the current playtest session |

### Inspection & Search

Understand your project structure without manual browsing.

| Tool | Description |
|------|-------------|
| `rbx_project_snapshot` | Stable DataModel tree snapshot with depth limiting |
| `rbx_search_project` | Search instances by name, class, property, or script content |
| `rbx_get_instance_properties` | Detailed property inspection by path |

### Quality & Security Audits

Automated checks that catch issues before they reach players.

| Tool | Description |
|------|-------------|
| `rbx_prepublish_audit` | Categorized quality audit (security, performance, quality, mobile, accessibility) with 0-100 score |
| `rbx_remote_contract_audit` | Audit RemoteEvents/Functions for validation, rate limiting, and trust boundary issues |
| `rbx_datastore_schema_guard` | Validate DataStore usage: pcall wrapping, key hygiene, retry logic, budget awareness |
| `rbx_marketplace_compliance_audit` | Audit monetization: ProcessReceipt handling, idempotency, product references, failover UX |
| `rbx_localization_coverage_audit` | Find untranslated text, hardcoded strings, and locale coverage gaps |
| `rbx_accessibility_audit` | WCAG-style audit: contrast ratios, touch targets, text scaling, navigation |
| `rbx_validate_mobile_ui` | Mobile-specific validation: safe areas, touch targets, overlap detection, text readability |
| `rbx_teleport_graph_audit` | Dead PlaceIds, circular teleports, missing error handling, graph visualization |
| `rbx_package_drift_audit` | Stale packages, version mismatches, disabled auto-update detection |
| `rbx_profile_runtime_hotspots` | Performance hotspot analysis with baseline comparison and regression detection |

### Testing & Release

Ship with confidence.

| Tool | Description |
|------|-------------|
| `rbx_run_test_matrix` | Run TestService tests across server/client/multi-client configurations |
| `rbx_release_readiness_gate` | Aggregated ship/no-ship verdict from all audit checks with configurable thresholds |
| `rbx_publish_place` | Publish a place version via Open Cloud API |

### Safe Automation

Make changes with dry-run previews and full undo support.

| Tool | Description |
|------|-------------|
| `rbx_apply_patch_safe` | Batch instance mutations with dry-run preview and ChangeHistoryService rollback |
| `rbx_generate_fix_plan` | Map a high-level goal to a step-by-step tool execution plan |

### Open Cloud

Interact with Roblox services without opening Studio.

| Tool | Description |
|------|-------------|
| `rbx_opencloud_experience_info` | Fetch universe/place metadata (name, description, visibility, timestamps) |
| `rbx_asset_publish_status` | Check asset moderation and publish status for up to 10 assets |
| `rbx_list_products` | List all DevProducts and GamePasses for a universe |

### Creative Building

Tools that let an AI agent create, not just inspect.

| Tool | Description |
|------|-------------|
| `rbx_ui_builder` | Build complete UI hierarchies from a declarative JSON spec |
| `rbx_lighting_preset` | Apply lighting/atmosphere presets (realistic day, night, sunset, foggy, neon, studio flat) or custom config |
| `rbx_terrain_generate` | Generate terrain: fill block/ball/cylinder/wedge, clear regions, generate flat or hilly landscapes |

---

## Comparison

| Feature | roblox-workflow-mcp | boshyxd/robloxstudio-mcp | Roblox Built-in |
|---------|:--:|:--:|:--:|
| Total tools | **39** | ~10 | ~5 |
| CRUD primitives | 16 | ~8 | ~5 |
| Security audits | 3 | - | - |
| Mobile/accessibility QA | 3 | - | - |
| Pre-publish gate | 1 | - | - |
| DataStore validation | 1 | - | - |
| Marketplace audit | 1 | - | - |
| Localization audit | 1 | - | - |
| Teleport graph analysis | 1 | - | - |
| Package drift detection | 1 | - | - |
| UI builder | 1 | - | - |
| Terrain generation | 1 | - | - |
| Lighting presets | 1 | - | - |
| Open Cloud integration | 4 | - | - |
| Release readiness gate | 1 | - | - |
| Performance profiling | 1 | - | - |
| Fix plan generator | 1 | - | - |
| Dry-run + undo | Yes | - | - |
| ChangeHistoryService | Yes | - | - |
| Session auth | Yes | - | - |

---

## Response Shape

Every tool returns a consistent envelope:

```json
{
  "schema_version": "0.1.0",
  "source": {
    "studio_port": 33796
  },
  "freshness": {
    "fresh": true,
    "timestamp": "2026-03-28T12:00:00.000Z",
    "ttl_ms": 3600000
  },
  "warnings": [],
  "data": { }
}
```

---

## Prompt Cookbook

Ready-to-use prompts for your AI client:

**Find and fix mobile UI issues:**
> "Run `rbx_validate_mobile_ui` on my game, then use `rbx_set_instance_property` to fix any touch targets that are too small."

**Pre-publish check:**
> "Run `rbx_release_readiness_gate` with all checks. If it says HOLD, show me the blocking issues and suggest fixes."

**Build a shop UI:**
> "Use `rbx_ui_builder` to create a shop screen under StarterGui with a title, scrolling item list, and buy buttons."

**Set mood lighting:**
> "Apply the `neon_night` lighting preset to my game using `rbx_lighting_preset`."

**Security audit:**
> "Run `rbx_remote_contract_audit` and `rbx_datastore_schema_guard` on my project. Summarize the high-severity issues."

**Generate terrain:**
> "Use `rbx_terrain_generate` to create a hilly grass landscape from -256 to 256 on X/Z with 30 amplitude."

---

## Plugin Setup

### Option A: Manual install
1. Copy `plugin/src/init.server.lua` to your Roblox Studio plugins folder
2. Restart Studio
3. Click **"Toggle Connection"** in the toolbar

### Option B: Rojo build
```bash
cd plugin
rojo build -o RobloxWorkflowMCP.rbxm
```
Then install the `.rbxm` as a Studio plugin.

### Plugin features
- One-click connect/disconnect
- Session token authentication
- `ChangeHistoryService` integration — every mutation is undoable via Ctrl+Z
- `ScriptEditorService:GetEditorSource()` for accurate script reads
- `LogService:GetLogHistory()` for console output capture

---

## Development

```bash
git clone https://github.com/zaferdace/roblox-workflow-mcp.git
cd roblox-workflow-mcp
npm install
npm run build
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Watch mode |
| `npm run check` | Full quality gate: tsc + eslint + prettier + publint |
| `npm run lint` | ESLint |
| `npm run format` | Prettier auto-fix |

### Adding a new tool

1. Create `src/tools/your-tool.ts`
2. Define a Zod schema and handler function
3. Call `registerTool()` at the bottom of the file
4. Add `import "./your-tool.js"` to `src/tools/register-all.ts`
5. If the tool needs a new bridge command, update `src/bridge/server.ts`, `src/roblox/studio-bridge-client.ts`, and `plugin/src/init.server.lua`

---

## Roadmap

- [ ] npm publish (after real Studio testing)
- [ ] Unit tests for shared utilities and tool logic
- [ ] Demo video (60s end-to-end workflow)
- [ ] SonarCloud integration
- [ ] Studio plugin icon
- [ ] awesome-mcp-servers PR

---

## License

MIT

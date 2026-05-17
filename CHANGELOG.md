# Changelog

## 0.2.0 — 2026-05-17

**BREAKING:** Plugin must now pair before connecting. Existing v0.1.x plugin installs will fail with `RBX.AUTH.MISSING_TOKEN` until re-paired.

### Added

- Challenge-response pairing: 6-digit pairing code → exchange for `pairing_secret` + `session_token`
- HMAC-SHA256 PROOF handshake on `/studio/connect` (server nonce + plugin nonce, pairing secret never transmitted)
- `Authorization: Bearer <session_token>` required on every `/studio/*` and `/api/*` route except `/api/ping`
- Stateless `/studio/refresh-token` for 24h token expiry (no user re-pair needed)
- Structured error envelope: `{ ok: false, error: { code, message, retryable, request_id, data?, remediation? } }`
- Error code namespace `RBX.<CATEGORY>.<REASON>` (21+ codes)
- Session lifecycle state machine: idle/active/reload_grace/quitting with configurable 45s grace (`RBX_RELOAD_GRACE_MS`)
- `/studio/disconnect` endpoint for explicit `studio_quitting` vs `plugin_unloading` signaling
- Bounded command queue (default 100, `RBX_QUEUE_MAX` env) with newest-reject backpressure
- Server↔plugin major version handshake (HTTP 426 on mismatch)
- Plugin source restored to `plugin/src/init.server.lua`; Rojo build pipeline via `aftman.toml`
- Embedded sha2.lua (pure_lua_SHA, MIT) for HMAC-SHA256 in plugin
- Rate limiting on `/studio/pair` AND `/studio/refresh-token` (5 attempts/min each, independent buckets)

### Changed

- `/studio/poll` and `/studio/response` migrate from `?token=` query param to `Authorization: Bearer` header
- All 19 legacy `sendError` call sites migrated to `RbxError` throws + middleware envelope
- MCP `CallToolRequest` errors include structured payload via `isError: true`
- Plugin reconnects with stored credentials; surfaces "Re-pair required" UI on `RBX.AUTH.PROOF_FAILED`
- `keytar` moved to `optionalDependencies` — graceful fallback to file-based secret storage

### Security

- Closes localhost session-hijack vector — any localhost process previously could overwrite the active plugin session or call `/api/*` once a session was established
- Pairing secret is the root of trust; session tokens are short-lived challenge-response derivatives
- Constant-time HMAC comparison via `crypto.timingSafeEqual`
- Lazy TTL pruning on internal challenge/code/token maps prevents memory growth under floods
- Refresh flow revokes all prior session tokens (single-instance constraint)

## [0.1.0] - 2026-03-29

### Added

- 43 tools across 6 categories: core (18), shipcheck (14), automation (4), building (3), cloud (3), playtester (1), plus 3 shooter genre tools
- Full Roblox Studio integration via companion plugin (`RobloxShipcheck.rbxm`) over localhost bridge on port 33796
- 9 shipcheck audit tools: `rbx_shipcheck_report`, `rbx_prepublish_audit`, `rbx_accessibility_audit`, `rbx_remote_contract_audit`, `rbx_content_maturity_check`, `rbx_datastore_schema_guard`, `rbx_localization_coverage_audit`, `rbx_marketplace_compliance_audit`, `rbx_teleport_graph_audit`
- Release workflow tools: `rbx_release_diff` (baseline snapshot + diff), `rbx_release_readiness_gate` (score-based go/no-go), `rbx_package_drift_audit`, `rbx_profile_runtime_hotspots`
- Real-time Studio output monitoring via `rbx_get_output`
- Lua code execution in Studio via `rbx_execute_code` with return value capture
- Full DataModel inspection: `rbx_project_snapshot`, `rbx_get_children`, `rbx_get_instance_properties`, `rbx_get_selection`, `rbx_search_project`
- DataModel mutation: `rbx_create_instance`, `rbx_delete_instance`, `rbx_clone_instance`, `rbx_move_instance`, `rbx_set_instance_property`, `rbx_set_script_source`
- Attribute and tag management: `rbx_manage_attributes`, `rbx_manage_tags`
- Playtest control: `rbx_start_playtest`, `rbx_stop_playtest`
- Automation: `rbx_apply_patch_safe` (dry-run support), `rbx_generate_fix_plan`, `rbx_run_test_matrix` (server/client/multi-client configurations)
- Scene building: `rbx_lighting_preset`, `rbx_terrain_generate`, `rbx_ui_builder`
- Open Cloud API integration: `rbx_opencloud_experience_info`, `rbx_asset_publish_status`, `rbx_list_products`, `rbx_publish_place`
- Structural smoke tests via `rbx_playtester`: `spawn_flow`, `shop_flow`, `tutorial_flow`, `mobile_ux`
- Shooter genre checks: `rbx_shooter_weapon_remote_trust`, `rbx_shooter_spawn_clustering`, `rbx_shooter_combat_content_maturity`
- WCAG-style accessibility audit with contrast ratio calculation, touch target size check, text scaling, and keyboard navigation affordance
- Mobile UI validation against configurable screen profiles (iPhone SE, iPhone 14 Pro)
- `rbx_release_diff` move detection: identifies reparented instances instead of reporting them as add+remove pairs
- `rbx_generate_fix_plan` maps natural-language goals to ordered tool call sequences

### Fixed

- Bridge server stability: replaced try/finally cleanup with OS signal handlers (`SIGINT`, `SIGTERM`) to prevent zombie bridge processes
- Route ordering for `rbx_get_instance_properties`: wildcard routes no longer shadow specific named routes
- Bridge client request timeout increased from 15s to 45s to accommodate large DataModel traversals
- Accessibility audit crash on instances with missing or inaccessible properties: errors are caught per-node and traversal continues
- `rbx_apply_patch_safe` create operation: parent path parsing now correctly handles root-level targets
- `rbx_lighting_preset` Technology property: preset values are applied via TS-side definitions, bypassing a Studio plugin capability limitation
- `rbx_release_diff` script comparison: uses instance paths instead of instance IDs so diffs survive Studio restarts

### Known Issues

- `rbx_start_playtest`: Returns `"StartDecal is not a valid member of Plugin"` capability error. Playtest start may require manual interaction in some Studio configurations. Plugin rebuild in progress.
- Cloud tools (`rbx_opencloud_experience_info`, `rbx_asset_publish_status`, `rbx_list_products`, `rbx_publish_place`): Require a valid Open Cloud API key. Schema is validated but tools are untested against the live Roblox API in CI.

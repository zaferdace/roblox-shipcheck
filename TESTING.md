# Test Matrix

All 43 tools tested against a live Roblox Studio session on 2026-03-29.

**Environment:** macOS, Roblox Studio with companion plugin (RobloxShipcheck.rbxm), bridge on `127.0.0.1:33796`.

## Core (18 tools)

| Tool | Result | Notes |
|------|--------|-------|
| `rbx_project_snapshot` | PASS | Full DataModel tree returned |
| `rbx_get_children` | PASS | |
| `rbx_get_instance_properties` | PASS | |
| `rbx_get_selection` | PASS | Empty selection returned correctly |
| `rbx_get_output` | PASS | Studio output log entries returned |
| `rbx_search_project` | PASS | Class, name, script_content search working |
| `rbx_get_script_source` | PASS | |
| `rbx_set_script_source` | PASS | |
| `rbx_execute_code` | PASS | Lua code executed, return values captured |
| `rbx_create_instance` | PASS | |
| `rbx_delete_instance` | PASS | |
| `rbx_clone_instance` | PASS | |
| `rbx_move_instance` | PASS | |
| `rbx_set_instance_property` | PASS | |
| `rbx_manage_tags` | PASS | add, list, remove all working |
| `rbx_manage_attributes` | PASS | get, set, delete all working |
| `rbx_start_playtest` | PARTIAL | Plugin returns "StartDecal is not a valid member of Plugin". Playtest control may require manual interaction in some Studio configurations. |
| `rbx_stop_playtest` | PASS | |

## Shipcheck (14 tools)

| Tool | Result | Notes |
|------|--------|-------|
| `rbx_shipcheck_report` | PASS | SHIP 90/100, 10 checks run |
| `rbx_prepublish_audit` | PASS | Full categorized audit returned |
| `rbx_validate_mobile_ui` | PASS | 100/100 |
| `rbx_accessibility_audit` | PASS | WCAG AA, gracefully skips missing instances |
| `rbx_remote_contract_audit` | PASS | 9 remotes analyzed |
| `rbx_content_maturity_check` | PASS | No flags detected |
| `rbx_datastore_schema_guard` | PASS | |
| `rbx_localization_coverage_audit` | PASS | Empty table warning (expected) |
| `rbx_marketplace_compliance_audit` | PASS | |
| `rbx_package_drift_audit` | PASS | |
| `rbx_teleport_graph_audit` | PASS | |
| `rbx_profile_runtime_hotspots` | PASS | 8 hotspots, full instance counts |
| `rbx_release_diff` | PASS | Baseline saved (4139 instances, 3 scripts) |
| `rbx_release_readiness_gate` | PASS | SHIP 83/100 |

## Automation (4 tools)

| Tool | Result | Notes |
|------|--------|-------|
| `rbx_apply_patch_safe` | PASS | Dry-run and actual apply both working |
| `rbx_generate_fix_plan` | PASS | Step-by-step plan returned |
| `rbx_run_test_matrix` | PASS | 0 tests (no TestService suites in project) |
| `rbx_publish_place` | SKIP | Requires Open Cloud API key |

## Building (3 tools)

| Tool | Result | Notes |
|------|--------|-------|
| `rbx_lighting_preset` | PASS | Presets applied via TS-side definitions (bypasses plugin Technology limitation) |
| `rbx_terrain_generate` | PASS | fill_block with Grass material |
| `rbx_ui_builder` | PASS | Nested ScreenGui + TextLabel created. UDim2 properties must use Lua types, not strings. |

## Cloud (3 tools)

| Tool | Result | Notes |
|------|--------|-------|
| `rbx_asset_publish_status` | SKIP | Requires Open Cloud API key |
| `rbx_list_products` | SKIP | Requires Open Cloud API key |
| `rbx_opencloud_experience_info` | SKIP | Requires Open Cloud API key |

## Playtester (1 tool)

| Tool | Result | Notes |
|------|--------|-------|
| `rbx_playtester` | PASS | list_scenarios, run_scenario (spawn_flow PASS), get_result all working |

## Shooter Genre (3 tools + 2 presets)

Tested against a non-shooter Roblox project (expected: clean output, no false positives).

| Tool | Result | Notes |
|------|--------|-------|
| `rbx_shooter_weapon_remote_trust` | PASS | 0 weapon remotes found (correct for non-shooter) |
| `rbx_shooter_spawn_clustering` | PASS | 0 spawns found (correct) |
| `rbx_shooter_combat_content_maturity` | PASS | 30 scripts + 37 UI elements scanned, 0 findings |
| `shooter_weapon_equip` preset | PARTIAL | No weapons in StarterPack (expected for non-shooter) |
| `shooter_respawn_cycle` preset | PASS | CharacterAutoLoads=true, RespawnTime=3, 7 CharacterAdded handlers |

## Known Limitations

- **`start_playtest`**: Plugin cannot invoke playtest in all Studio configurations due to `StartDecal` capability error. Use manual Play button as a workaround.
- **Cloud tools**: Require a Roblox Open Cloud API key. Schema and registration validated, but not callable without credentials.
- **`ui_builder`**: Complex property types (UDim2, Color3, Vector3) must be set via Lua-native types, not string representations.
- **Large projects**: DataModel serialization for very large places may take several seconds. The bridge client timeout is set to 45 seconds.

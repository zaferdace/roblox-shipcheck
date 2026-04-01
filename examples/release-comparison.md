# Example: Release Comparison (Diff Two Versions)

Compare the current state of your project against a saved baseline to understand what changed and which audits to run before shipping.

## Prerequisites

- Studio plugin installed and connected
- A place open in Roblox Studio
- A writable path on disk to store the baseline file

## Workflow Overview

1. Save a baseline before you start a sprint or before a known-stable build
2. Make your changes in Studio
3. Diff the current state against the baseline to see what changed
4. Use the recommended audits list to run targeted checks on changed areas

---

## Step 1: Save a Baseline

Run this before your changes. The baseline captures the full DataModel tree and all script sources.

```json
{
  "tool": "rbx_release_diff",
  "arguments": {
    "studio_port": 33796,
    "save_baseline": true,
    "output_path": "/Users/you/baselines/my-game-v1.json"
  }
}
```

Expected output:

```json
{
  "mode": "baseline_saved",
  "timestamp": "2026-03-29T18:00:00.000Z",
  "metadata": {
    "instance_count": 4139,
    "script_count": 3
  },
  "path": "/Users/you/baselines/my-game-v1.json"
}
```

The baseline file is a JSON snapshot of the DataModel tree at that point in time. Keep it as long as you want to be able to diff against it.

---

## Step 2: Run the Diff

After making changes in Studio, run the diff against the saved baseline:

```json
{
  "tool": "rbx_release_diff",
  "arguments": {
    "studio_port": 33796,
    "baseline_path": "/Users/you/baselines/my-game-v1.json",
    "run_targeted_audits": true
  }
}
```

To also write the diff report to disk:

```json
{
  "tool": "rbx_release_diff",
  "arguments": {
    "studio_port": 33796,
    "baseline_path": "/Users/you/baselines/my-game-v1.json",
    "run_targeted_audits": true,
    "output_path": "/Users/you/diffs/diff-v1-to-v2.json"
  }
}
```

---

## Expected Output Structure

```json
{
  "mode": "diff",
  "baseline_timestamp": "2026-03-29T18:00:00.000Z",
  "current_timestamp": "2026-03-29T20:15:00.000Z",
  "summary": {
    "instances_added": 12,
    "instances_removed": 3,
    "instances_modified": 8,
    "scripts_changed": 2,
    "total_changes": 25,
    "risk_score": 54,
    "risk_level": "medium"
  },
  "changes": {
    "added": [
      { "path": "ServerScriptService.ShopHandler", "className": "Script" },
      { "path": "StarterGui.ShopUI", "className": "ScreenGui" }
    ],
    "removed": [
      { "path": "ServerScriptService.OldPurchaseHandler", "className": "Script" }
    ],
    "modified": [
      {
        "path": "StarterGui.HUD.CoinLabel",
        "className": "TextLabel",
        "changed_properties": ["TextColor3", "TextSize"]
      }
    ],
    "moved": [
      {
        "from_path": "ReplicatedStorage.Modules.InventoryModule",
        "to_path": "ServerScriptService.Modules.InventoryModule",
        "className": "ModuleScript"
      }
    ],
    "scripts_changed": [
      {
        "path": "ServerScriptService.ShopHandler",
        "line_delta": 45,
        "touches_sensitive_api": true,
        "sensitive_apis": ["remotes", "marketplace"]
      }
    ]
  },
  "structure": {
    "top_level_added": ["ShopUI"],
    "top_level_removed": ["OldPurchaseHandler"],
    "class_distribution_delta": {
      "Script": 1,
      "ScreenGui": 1,
      "TextButton": 4
    }
  },
  "recommended_audits": [
    "rbx_remote_contract_audit",
    "rbx_marketplace_compliance_audit",
    "rbx_validate_mobile_ui"
  ],
  "verdict": "REVIEW_RECOMMENDED"
}
```

---

## Reading the Output

**`summary.risk_score`**

A 0–100 score computed from the number and type of changes. Script changes touching sensitive APIs (remotes, DataStore, marketplace, teleports) contribute the most. Removed scripts are weighted more heavily than added ones (removing a handler is riskier than adding one).

| Risk Score | Risk Level | Verdict |
|------------|------------|---------|
| 0–29 | low | `SAFE_TO_SHIP` |
| 30–59 | medium | `REVIEW_RECOMMENDED` |
| 60–79 | high | `HIGH_RISK` |
| 80–100 | critical | `HIGH_RISK` |

**`changes.scripts_changed[].sensitive_apis`**

Each changed script is analyzed for usage of:

- `remotes` — RemoteEvent, RemoteFunction, FireServer, OnServerEvent, etc.
- `datastores` — DataStoreService, GetAsync, SetAsync, UpdateAsync
- `marketplace` — MarketplaceService, ProcessReceipt, PromptProductPurchase
- `teleports` — TeleportService, TeleportAsync
- `http` — HttpService, RequestAsync

If a changed script touches any of these, `touches_sensitive_api` is `true` and the specific APIs are listed.

**`changes.moved`**

Instances that appear to have been reparented (same name and class, different parent path). Reported separately from adds and removes to reduce noise.

**`recommended_audits`**

When `run_targeted_audits` is `true`, the diff suggests which specialized audit tools to run based on what changed:

- Scripts touching `remotes` → `rbx_remote_contract_audit`
- Scripts touching `datastores` → `rbx_datastore_schema_guard`
- Scripts touching `marketplace` → `rbx_marketplace_compliance_audit`
- Scripts touching `teleports` → `rbx_teleport_graph_audit`
- Any GUI class added, removed, or modified → `rbx_validate_mobile_ui`

---

## Step 3: Run Recommended Audits

After reviewing the diff, run each recommended audit. For the example above:

```json
{
  "tool": "rbx_remote_contract_audit",
  "arguments": { "studio_port": 33796 }
}
```

```json
{
  "tool": "rbx_marketplace_compliance_audit",
  "arguments": { "studio_port": 33796 }
}
```

```json
{
  "tool": "rbx_validate_mobile_ui",
  "arguments": { "studio_port": 33796 }
}
```

---

## Step 4: Final Gate

Once targeted audits pass, run the release readiness gate for a final go/no-go score:

```json
{
  "tool": "rbx_release_readiness_gate",
  "arguments": {
    "studio_port": 33796,
    "thresholds": {
      "min_overall_score": 70,
      "max_high_severity_issues": 0
    }
  }
}
```

A passing gate returns `"verdict": "SHIP"`. A failing gate returns `"verdict": "HOLD"` with the specific checks that did not meet threshold.

---

## Tips

- Save baselines at meaningful checkpoints: before a sprint starts, after a stable build, before merging a large feature.
- The baseline file is plain JSON — safe to commit to source control alongside your project for a permanent audit trail.
- If you open a different place in Studio between saving the baseline and running the diff, the instance paths will not match and the diff will report everything as added. Always diff against a baseline taken from the same place.

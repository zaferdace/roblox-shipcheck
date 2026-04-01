# Example: Pre-Publish Audit

Run a categorized pre-publish audit across security, performance, quality, mobile, and accessibility before shipping your experience.

## Prerequisites

- Studio plugin installed and connected (plugin toolbar shows "Connected")
- A place open in Roblox Studio

## Tool Call

```json
{
  "tool": "rbx_prepublish_audit",
  "arguments": {
    "studio_port": 33796,
    "categories": ["security", "performance", "quality", "mobile", "accessibility"]
  }
}
```

To also check experience metadata (empty description, etc.), pass Open Cloud credentials:

```json
{
  "tool": "rbx_prepublish_audit",
  "arguments": {
    "studio_port": 33796,
    "categories": ["security", "quality"],
    "api_key": "roblox-api-key-here",
    "universe_id": "123456789"
  }
}
```

## Expected Output Structure

```json
{
  "overall_score": 84,
  "categories": [
    {
      "name": "security",
      "score": 78,
      "issues": [
        {
          "severity": "medium",
          "element_path": "ReplicatedStorage.Remotes.PurchaseRequest",
          "rule": "remote_validation",
          "message": "Remote endpoint name does not indicate validation or sanitization flow.",
          "suggestion": "Review server-side validation for all client-originating payloads."
        }
      ],
      "summary": "1 medium issue found."
    },
    {
      "name": "performance",
      "score": 95,
      "issues": [],
      "summary": "No issues found."
    },
    {
      "name": "quality",
      "score": 80,
      "issues": [
        {
          "severity": "medium",
          "element_path": "ServerScriptService.Handler",
          "rule": "deprecated_api_usage",
          "message": "Legacy scheduling API usage detected.",
          "suggestion": "Prefer task.wait, task.spawn, and task.delay."
        }
      ],
      "summary": "1 medium issue found."
    },
    {
      "name": "mobile",
      "score": 100,
      "issues": [],
      "summary": "No issues found."
    },
    {
      "name": "accessibility",
      "score": 67,
      "issues": [
        {
          "severity": "medium",
          "element_path": "StarterGui.HUD.ScoreLabel",
          "rule": "small_text",
          "message": "Text size 10 may be hard to read.",
          "suggestion": "Increase text size or strengthen contrast for accessibility."
        }
      ],
      "summary": "1 medium issue found."
    }
  ],
  "recommendations": [
    "Review server-side validation for all client-originating payloads.",
    "Prefer task.wait, task.spawn, and task.delay.",
    "Increase text size or strengthen contrast for accessibility."
  ]
}
```

## What to Look For

**Security category:**

- `embedded_secret` (high) — hardcoded API key or token in a script. Fix immediately before publishing.
- `remote_validation` (medium) — RemoteEvent/Function whose name doesn't indicate server-side validation. Review each one manually.
- `http_enabled` (medium) — HttpService is enabled. Verify all outbound endpoints are necessary.
- `loadlibrary` (high) — deprecated dynamic library loading. Replace with versioned local modules.

**Performance category:**

- `part_count` (high) — workspace has more than 5,000 parts. Consider streaming or instancing.
- `unanchored_parts` (medium) — more than 200 unanchored parts simulate unnecessary physics.
- `large_script` (medium) — a script source exceeds 10,000 characters. Consider splitting it.
- `deep_ui_nesting` (low) — UI hierarchy depth above 6 increases layout recalculation cost.

**Quality category:**

- `deprecated_api_usage` (medium) — `wait()`, `spawn()`, `delay()` still in use. Replace with `task.*` equivalents.
- `empty_script` (low) — empty Script or LocalScript. Remove or implement.
- `generic_name` (low) — instances named after their class (e.g. `Part`, `Script`). Rename for clarity.
- `missing_description` (medium, requires Open Cloud key) — experience description is empty.

**Mobile category:**

- Touch targets below 44px minimum.
- Elements outside safe area on common device profiles (iPhone SE, iPhone 14 Pro).
- Font sizes below 11px.

**Accessibility category:**

- `contrast` (medium) — text/background contrast below 4.5:1.
- `small_text` (medium) — TextSize below 12 without TextScaled enabled.
- `missing_alt_text` (low) — ImageButton or ImageLabel without AccessibleDescription.
- `keyboard_navigation` (low) — interactive element with `Selectable = false`.

## Run Order Recommendation

For a pre-publish workflow, consider running in this order:

1. `rbx_prepublish_audit` — get the category-level summary and overall score
2. For any flagged category, run the dedicated tool for more detail:
   - Security findings → `rbx_remote_contract_audit`
   - Mobile findings → `rbx_validate_mobile_ui`
   - Accessibility findings → `rbx_accessibility_audit`
3. `rbx_shipcheck_report` — run the full shipcheck for the final verdict and Markdown report

A score of 70 or above with zero high-severity issues is a reasonable bar before running `rbx_release_readiness_gate`.

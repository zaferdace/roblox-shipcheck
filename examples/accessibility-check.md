# Example: Accessibility Audit

Audit all GUI elements in your experience for contrast, touch target size, text scaling, and keyboard/gamepad navigation affordance.

## Prerequisites

- Studio plugin installed and connected
- A place open in Roblox Studio with at least one ScreenGui

## Tool Call

Run all four checks (default):

```json
{
  "tool": "rbx_accessibility_audit",
  "arguments": {
    "studio_port": 33796
  }
}
```

Run only contrast and touch target checks:

```json
{
  "tool": "rbx_accessibility_audit",
  "arguments": {
    "studio_port": 33796,
    "check_contrast": true,
    "check_touch_targets": true,
    "check_text_scaling": false,
    "check_navigation": false
  }
}
```

## Expected Output Structure

```json
{
  "score": 76,
  "wcag_level": "AA",
  "issues": [
    {
      "severity": "high",
      "rule": "contrast_ratio",
      "message": "StarterGui.HUD.TimerLabel has a text/background contrast ratio below 4.5:1.",
      "element_path": "StarterGui.HUD.TimerLabel",
      "suggestion": "Adjust TextColor3 or BackgroundColor3 to improve readability."
    },
    {
      "severity": "medium",
      "rule": "touch_target_size",
      "message": "StarterGui.ShopUI.BuyButton is smaller than the 44px touch target guideline.",
      "element_path": "StarterGui.ShopUI.BuyButton",
      "suggestion": "Increase AbsoluteSize or add transparent padding around the control."
    },
    {
      "severity": "medium",
      "rule": "text_scaling",
      "message": "StarterGui.HUD.CoinLabel uses a small text size without text scaling.",
      "element_path": "StarterGui.HUD.CoinLabel",
      "suggestion": "Raise TextSize or enable TextScaled with clipping checks."
    },
    {
      "severity": "low",
      "rule": "navigation_affordance",
      "message": "StarterGui.MainMenu.SettingsButton may not have a clear visual interactive affordance.",
      "element_path": "StarterGui.MainMenu.SettingsButton",
      "suggestion": "Add a visible state, outline, or stronger contrast for interactive controls."
    }
  ]
}
```

## Score Interpretation

The score starts at 100 and drops 8 points per issue. `wcag_level` is:

- `AA` — no contrast ratio violations found
- `A` — one or more `contrast_ratio` issues found (did not meet WCAG AA threshold of 4.5:1)

| Score | Interpretation |
|-------|----------------|
| 100 | No accessibility issues detected |
| 84–99 | 1–2 minor issues |
| 68–83 | 2–4 issues, some user impact expected |
| Below 68 | Multiple issues — likely affects mobile and accessibility-dependent players |

## What Each Rule Checks

**`contrast_ratio` (high)**

Checks TextColor3 against BackgroundColor3 for all TextLabel, TextButton, and TextBox elements. Flags elements with a calculated contrast ratio below 4.5:1 (WCAG AA for normal text). The check skips elements where either color is missing.

Common causes:
- Gray text on a light background
- White text on a yellow or light-colored frame
- Semi-transparent backgrounds behind white text

Fix: Use a darker text color or a darker/lighter background. A ratio of 4.5:1 or higher passes.

**`touch_target_size` (medium)**

Checks that all TextButton and ImageButton elements are at least 44×44 pixels in AbsoluteSize. Skips elements with `Visible = false`.

Common causes:
- Close or dismiss buttons sized for desktop (16×16 or 24×24)
- Icon buttons without padding
- Buttons inside ScrollingFrame items

Fix: Increase `Size` to at least 44×44 pixels, or wrap a small visual button in a transparent frame that is 44×44 and intercepts input.

**`text_scaling` (medium)**

Flags TextLabel, TextButton, and TextBox elements with `TextSize < 12` and `TextScaled = false`. Text this small is unreadable at typical mobile viewing distances.

Fix: Set `TextSize` to 12 or higher, or enable `TextScaled = true` with a `UITextSizeConstraint` to prevent overflow.

**`navigation_affordance` (low)**

Flags interactive controls (buttons, text boxes) with fully transparent backgrounds (`BackgroundTransparency >= 1`). These elements may be invisible to players navigating with a gamepad or keyboard.

Fix: Add a visible background, an outline (`UIStroke`), or a hover/selection state that makes the interactive area visible.

## Workflow: Fix Contrast Issues

After running the audit, use `rbx_get_instance_properties` to read the current colors, then `rbx_set_instance_property` to fix them:

```json
{
  "tool": "rbx_get_instance_properties",
  "arguments": {
    "path": "StarterGui.HUD.TimerLabel"
  }
}
```

```json
{
  "tool": "rbx_set_instance_property",
  "arguments": {
    "path": "StarterGui.HUD.TimerLabel",
    "property": "TextColor3",
    "value": { "r": 0.1, "g": 0.1, "b": 0.1 }
  }
}
```

Re-run `rbx_accessibility_audit` to confirm the fix cleared the finding.

## Running Both Accessibility and Mobile Checks

`rbx_accessibility_audit` and `rbx_validate_mobile_ui` cover overlapping but distinct concerns:

- `rbx_accessibility_audit` — contrast, text size, keyboard navigation
- `rbx_validate_mobile_ui` — touch target minimums, safe area overlap, font size floor across specific device screen profiles

For a thorough UI review before publishing, run both.

import { describe, it, expect, vi } from "vitest";
import type { InstanceNode, RobloxPropertyValue } from "../types/roblox.js";

// ── mocks ─────────────────────────────────────────────────────────────────────

function makeNode(
  name: string,
  className: string,
  children: InstanceNode[] = [],
  properties: Record<string, RobloxPropertyValue> = {},
): InstanceNode {
  return { id: `id-${name}`, name, className, children, properties };
}

// Factory to produce a tree with a single element as a child of a ScreenGui.
function treeWithGui(child: InstanceNode): InstanceNode {
  const screenGui = makeNode("HUD", "ScreenGui", [child]);
  return makeNode("game", "DataModel", [makeNode("StarterGui", "StarterGui", [screenGui])]);
}

// The accessibility-audit handler calls `client.getDataModel()` once and
// `client.getProperties(path)` for each GUI node it encounters.
// We control the data model by swapping the mock implementation per test.

const mockGetDataModel = vi.fn();
const mockGetProperties = vi.fn();

vi.mock("../roblox/studio-bridge-client.js", () => ({
  StudioBridgeClient: class MockStudioBridgeClient {
    ping = vi.fn().mockResolvedValue({ ok: true });
    getDataModel = mockGetDataModel;
    getProperties = mockGetProperties;
  },
  StudioBridgeError: class StudioBridgeError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "StudioBridgeError";
    }
  },
}));

import { executeTool } from "../tools/registry.js";
await import("../tools/shipcheck/accessibility-audit.js");

// ── helpers ───────────────────────────────────────────────────────────────────

async function runAudit(
  tree: InstanceNode,
  propertiesMap: Record<string, Record<string, RobloxPropertyValue>>,
  options: Record<string, unknown> = {},
) {
  mockGetDataModel.mockResolvedValue(tree);
  mockGetProperties.mockImplementation((path: string) => {
    return Promise.resolve(propertiesMap[path] ?? {});
  });
  return (await executeTool("rbx_accessibility_audit", options)) as Record<string, unknown>;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("rbx_accessibility_audit", () => {
  it("returns a well-formed response envelope", async () => {
    const tree = makeNode("game", "DataModel", []);
    const result = await runAudit(tree, {});
    expect(result).toHaveProperty("data");
    const data = result["data"] as Record<string, unknown>;
    expect(typeof data["score"]).toBe("number");
    expect(Array.isArray(data["issues"])).toBe(true);
    expect(typeof data["wcag_level"]).toBe("string");
  });

  it("scores 100 and AA for an empty tree", async () => {
    const tree = makeNode("game", "DataModel", []);
    const result = await runAudit(tree, {});
    const data = result["data"] as Record<string, unknown>;
    expect(data["score"]).toBe(100);
    expect(data["wcag_level"]).toBe("AA");
  });

  it("flags small text without text scaling", async () => {
    const label = makeNode("Lbl", "TextLabel");
    const tree = treeWithGui(label);
    const result = await runAudit(tree, {
      "game.StarterGui.HUD.Lbl": {
        TextSize: 8,
        TextScaled: false,
        Visible: true,
        AbsoluteSize: { x: 100, y: 30 },
      },
    });
    const data = result["data"] as Record<string, unknown>;
    const issues = data["issues"] as Array<Record<string, unknown>>;
    const textScalingIssue = issues.find((i) => i["rule"] === "text_scaling");
    expect(textScalingIssue).toBeDefined();
    expect(textScalingIssue?.["severity"]).toBe("medium");
  });

  it("does NOT flag text that uses TextScaled=true even when TextSize is small", async () => {
    const label = makeNode("Lbl", "TextLabel");
    const tree = treeWithGui(label);
    const result = await runAudit(tree, {
      "game.StarterGui.HUD.Lbl": {
        TextSize: 8,
        TextScaled: true,
        Visible: true,
      },
    });
    const data = result["data"] as Record<string, unknown>;
    const issues = data["issues"] as Array<Record<string, unknown>>;
    const textScalingIssue = issues.find((i) => i["rule"] === "text_scaling");
    expect(textScalingIssue).toBeUndefined();
  });

  it("flags small touch targets on buttons", async () => {
    const btn = makeNode("Btn", "TextButton");
    const tree = treeWithGui(btn);
    const result = await runAudit(tree, {
      "game.StarterGui.HUD.Btn": {
        AbsoluteSize: { x: 20, y: 20 },
        Visible: true,
        BackgroundTransparency: 0,
      },
    });
    const data = result["data"] as Record<string, unknown>;
    const issues = data["issues"] as Array<Record<string, unknown>>;
    const touchIssue = issues.find((i) => i["rule"] === "touch_target_size");
    expect(touchIssue).toBeDefined();
    expect(touchIssue?.["severity"]).toBe("medium");
  });

  it("does NOT flag adequately-sized touch targets", async () => {
    const btn = makeNode("Btn", "TextButton");
    const tree = treeWithGui(btn);
    const result = await runAudit(tree, {
      "game.StarterGui.HUD.Btn": {
        AbsoluteSize: { x: 60, y: 60 },
        Visible: true,
        BackgroundTransparency: 0,
      },
    });
    const data = result["data"] as Record<string, unknown>;
    const issues = data["issues"] as Array<Record<string, unknown>>;
    const touchIssue = issues.find((i) => i["rule"] === "touch_target_size");
    expect(touchIssue).toBeUndefined();
  });

  it("flags poor contrast ratio (below 4.5:1)", async () => {
    const label = makeNode("Lbl", "TextLabel");
    const tree = treeWithGui(label);
    // Near-identical light colors → very low contrast
    const result = await runAudit(tree, {
      "game.StarterGui.HUD.Lbl": {
        TextColor3: { r: 0.9, g: 0.9, b: 0.9 },
        BackgroundColor3: { r: 0.8, g: 0.8, b: 0.8 },
        Visible: true,
        AbsoluteSize: { x: 100, y: 30 },
      },
    });
    const data = result["data"] as Record<string, unknown>;
    const issues = data["issues"] as Array<Record<string, unknown>>;
    const contrastIssue = issues.find((i) => i["rule"] === "contrast_ratio");
    expect(contrastIssue).toBeDefined();
    expect(contrastIssue?.["severity"]).toBe("high");
  });

  it("sets wcag_level to A when contrast issue exists", async () => {
    const label = makeNode("Lbl", "TextLabel");
    const tree = treeWithGui(label);
    const result = await runAudit(tree, {
      "game.StarterGui.HUD.Lbl": {
        TextColor3: { r: 0.9, g: 0.9, b: 0.9 },
        BackgroundColor3: { r: 0.85, g: 0.85, b: 0.85 },
        Visible: true,
      },
    });
    const data = result["data"] as Record<string, unknown>;
    expect(data["wcag_level"]).toBe("A");
  });

  it("flags fully transparent interactive element (navigation affordance)", async () => {
    const btn = makeNode("Btn", "TextButton");
    const tree = treeWithGui(btn);
    const result = await runAudit(tree, {
      "game.StarterGui.HUD.Btn": {
        BackgroundTransparency: 1,
        AbsoluteSize: { x: 60, y: 60 },
        Visible: true,
      },
    });
    const data = result["data"] as Record<string, unknown>;
    const issues = data["issues"] as Array<Record<string, unknown>>;
    const navIssue = issues.find((i) => i["rule"] === "navigation_affordance");
    expect(navIssue).toBeDefined();
  });

  it("skips invisible elements", async () => {
    const btn = makeNode("Btn", "TextButton");
    const tree = treeWithGui(btn);
    const result = await runAudit(tree, {
      "game.StarterGui.HUD.Btn": {
        AbsoluteSize: { x: 20, y: 20 },
        Visible: false,
      },
    });
    const data = result["data"] as Record<string, unknown>;
    const issues = data["issues"] as Array<Record<string, unknown>>;
    // Invisible element — no touch-target issue.
    const touchIssue = issues.find((i) => i["rule"] === "touch_target_size");
    expect(touchIssue).toBeUndefined();
  });

  it("validates studio_port must be a positive integer", async () => {
    await expect(executeTool("rbx_accessibility_audit", { studio_port: 0 })).rejects.toThrow();
  });

  it("reduces score proportionally to number of issues", async () => {
    const label = makeNode("Lbl", "TextLabel");
    const tree = treeWithGui(label);
    const result = await runAudit(tree, {
      "game.StarterGui.HUD.Lbl": {
        TextSize: 8,
        TextScaled: false,
        Visible: true,
        AbsoluteSize: { x: 100, y: 30 },
      },
    });
    const data = result["data"] as Record<string, unknown>;
    // 1 issue × 8 penalty = score 92
    expect(data["score"]).toBe(92);
  });
});

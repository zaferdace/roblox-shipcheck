import { describe, it, expect, vi } from "vitest";
import type { InstanceNode } from "../types/roblox.js";

// Mock the bridge client before importing the tool (which calls registerTool at module load).
vi.mock("../roblox/studio-bridge-client.js", () => {
  return {
    StudioBridgeClient: class MockStudioBridgeClient {
      ping = vi.fn().mockResolvedValue({ ok: true, version: "test" });
      getDataModel = vi.fn().mockResolvedValue(makeMinimalDataModel());
    },
    StudioBridgeError: class StudioBridgeError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "StudioBridgeError";
      }
    },
  };
});

// Mock OpenCloudClient to avoid real network calls.
vi.mock("../roblox/open-cloud-client.js", () => {
  return {
    OpenCloudClient: class MockOpenCloudClient {
      getExperienceInfo = vi.fn().mockResolvedValue({ name: "Test Game", description: "desc" });
    },
  };
});

// Mock the mobile-UI sub-audit so that the prepublish handler doesn't need
// a fully-hydrated tree for the mobile category.
vi.mock("../tools/shipcheck/validate-mobile-ui.js", () => ({
  analyzeMobileUi: vi.fn().mockResolvedValue({
    score: 90,
    issues: [],
    summary: "No mobile issues.",
  }),
}));

function makeMinimalDataModel(): InstanceNode {
  return {
    id: "root",
    name: "game",
    className: "DataModel",
    children: [
      {
        id: "ws",
        name: "Workspace",
        className: "Workspace",
        children: [],
      },
    ],
  };
}

// Import AFTER mocks are in place.
import { executeTool } from "../tools/registry.js";

// Ensure the tool is registered.
await import("../tools/shipcheck/prepublish-audit.js");

describe("rbx_prepublish_audit", () => {
  it("returns a response envelope with overall_score and categories", async () => {
    const result = (await executeTool("rbx_prepublish_audit", {})) as Record<string, unknown>;
    expect(result).toHaveProperty("data");
    const data = result["data"] as Record<string, unknown>;
    expect(typeof data["overall_score"]).toBe("number");
    expect(Array.isArray(data["categories"])).toBe(true);
    expect(Array.isArray(data["recommendations"])).toBe(true);
  });

  it("runs only the requested categories", async () => {
    const result = (await executeTool("rbx_prepublish_audit", {
      categories: ["security"],
    })) as Record<string, unknown>;
    const data = result["data"] as Record<string, unknown>;
    const categories = data["categories"] as Array<Record<string, unknown>>;
    expect(categories).toHaveLength(1);
    expect(categories[0]?.["name"]).toBe("security");
  });

  it("scores 100 for a clean data model with no issues", async () => {
    // Use only categories that are clean for the minimal empty tree.
    // quality fires a low-severity "generic_name" issue on the Workspace node
    // (name === className), so we exclude it here.
    const result = (await executeTool("rbx_prepublish_audit", {
      categories: ["security", "performance", "accessibility"],
    })) as Record<string, unknown>;
    const data = result["data"] as Record<string, unknown>;
    expect(data["overall_score"]).toBe(100);
  });

  it("includes Open-Cloud-skipped warning when api_key is omitted", async () => {
    const result = (await executeTool("rbx_prepublish_audit", {})) as Record<string, unknown>;
    const warnings = result["warnings"] as string[];
    expect(warnings.some((w) => w.toLowerCase().includes("open cloud"))).toBe(true);
  });

  it("validates studio_port as positive integer", async () => {
    await expect(executeTool("rbx_prepublish_audit", { studio_port: -1 })).rejects.toThrow();
    await expect(executeTool("rbx_prepublish_audit", { studio_port: 0 })).rejects.toThrow();
  });

  it("schema accepts default values", async () => {
    // Empty input should not throw due to defaults.
    await expect(executeTool("rbx_prepublish_audit", {})).resolves.toBeDefined();
  });

  it("each category result has score, issues, and summary", async () => {
    const result = (await executeTool("rbx_prepublish_audit", {
      categories: ["security", "performance"],
    })) as Record<string, unknown>;
    const data = result["data"] as Record<string, unknown>;
    const categories = data["categories"] as Array<Record<string, unknown>>;
    for (const cat of categories) {
      expect(typeof cat["score"]).toBe("number");
      expect(Array.isArray(cat["issues"])).toBe(true);
      expect(typeof cat["summary"]).toBe("string");
    }
  });
});

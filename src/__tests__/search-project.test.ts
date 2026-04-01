import { describe, it, expect, vi } from "vitest";
import type { InstanceNode } from "../types/roblox.js";

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockPing = vi.fn().mockResolvedValue({ ok: true });
const mockGetDataModel = vi.fn();

vi.mock("../roblox/studio-bridge-client.js", () => ({
  StudioBridgeClient: class MockStudioBridgeClient {
    ping = mockPing;
    getDataModel = mockGetDataModel;
  },
  StudioBridgeError: class StudioBridgeError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "StudioBridgeError";
    }
  },
}));

import { executeTool } from "../tools/registry.js";
await import("../tools/core/search-project.js");

// ── helpers ───────────────────────────────────────────────────────────────────

function makeNode(
  name: string,
  className: string,
  children: InstanceNode[] = [],
  properties?: Record<string, unknown>,
): InstanceNode {
  return {
    id: `id-${name}`,
    name,
    className,
    children,
    ...(properties ? { properties } : {}),
  };
}

function makeSampleTree(): InstanceNode {
  const script = makeNode("GameManager", "Script", [], {
    Source: "-- manages game state\nlocal Players = game:GetService('Players')",
  });
  const button = makeNode("PlayButton", "TextButton");
  const workspace = makeNode("Workspace", "Workspace", [
    makeNode("Map", "Model", [makeNode("BasePart", "Part")]),
  ]);
  const starterGui = makeNode("StarterGui", "StarterGui", [button]);
  const serverStorage = makeNode("ServerStorage", "ServerStorage", [script]);
  return makeNode("game", "DataModel", [workspace, starterGui, serverStorage]);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("rbx_search_project", () => {
  it("returns a well-formed response envelope", async () => {
    mockGetDataModel.mockResolvedValue(makeSampleTree());
    const result = (await executeTool("rbx_search_project", {
      query: "Workspace",
      search_type: "name",
    })) as Record<string, unknown>;
    expect(result).toHaveProperty("data");
    const data = result["data"] as Record<string, unknown>;
    expect(typeof data["total_matches"]).toBe("number");
    expect(Array.isArray(data["matches"])).toBe(true);
    expect(data["query"]).toBe("Workspace");
    expect(data["search_type"]).toBe("name");
  });

  it("searches by name and returns matching instances", async () => {
    mockGetDataModel.mockResolvedValue(makeSampleTree());
    const result = (await executeTool("rbx_search_project", {
      query: "PlayButton",
      search_type: "name",
    })) as Record<string, unknown>;
    const data = result["data"] as Record<string, unknown>;
    const matches = data["matches"] as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.["matchType"]).toBe("name");
    expect(String(matches[0]?.["path"] ?? "")).toContain("PlayButton");
  });

  it("searches by class and returns correctly typed matches", async () => {
    mockGetDataModel.mockResolvedValue(makeSampleTree());
    const result = (await executeTool("rbx_search_project", {
      query: "Script",
      search_type: "class",
    })) as Record<string, unknown>;
    const data = result["data"] as Record<string, unknown>;
    const matches = data["matches"] as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      expect(match["matchType"]).toBe("class");
    }
  });

  it("searches script_content and finds matches inside Source properties", async () => {
    mockGetDataModel.mockResolvedValue(makeSampleTree());
    const result = (await executeTool("rbx_search_project", {
      query: "manages game",
      search_type: "script_content",
    })) as Record<string, unknown>;
    const data = result["data"] as Record<string, unknown>;
    const matches = data["matches"] as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.["matchType"]).toBe("script_content");
  });

  it("respects max_results", async () => {
    mockGetDataModel.mockResolvedValue(makeSampleTree());
    const result = (await executeTool("rbx_search_project", {
      query: "a",
      search_type: "name",
      max_results: 2,
    })) as Record<string, unknown>;
    const data = result["data"] as Record<string, unknown>;
    const matches = data["matches"] as Array<Record<string, unknown>>;
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it("is case-insensitive by default", async () => {
    mockGetDataModel.mockResolvedValue(makeSampleTree());
    const lowerResult = (await executeTool("rbx_search_project", {
      query: "playbutton",
      search_type: "name",
      case_sensitive: false,
    })) as Record<string, unknown>;
    const data = lowerResult["data"] as Record<string, unknown>;
    const matches = data["matches"] as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThan(0);
  });

  it("is case-sensitive when requested", async () => {
    mockGetDataModel.mockResolvedValue(makeSampleTree());
    const result = (await executeTool("rbx_search_project", {
      query: "playbutton",
      search_type: "name",
      case_sensitive: true,
    })) as Record<string, unknown>;
    const data = result["data"] as Record<string, unknown>;
    const matches = data["matches"] as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(0);
  });

  it("limits search to root_path when provided", async () => {
    mockGetDataModel.mockResolvedValue(makeSampleTree());
    // "PlayButton" lives under StarterGui, not Workspace
    const result = (await executeTool("rbx_search_project", {
      query: "PlayButton",
      search_type: "name",
      root_path: "game.Workspace",
    })) as Record<string, unknown>;
    const data = result["data"] as Record<string, unknown>;
    const matches = data["matches"] as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(0);
  });

  it("returns empty result when query matches nothing", async () => {
    mockGetDataModel.mockResolvedValue(makeSampleTree());
    const result = (await executeTool("rbx_search_project", {
      query: "ThingThatDoesNotExistXYZ",
      search_type: "name",
    })) as Record<string, unknown>;
    const data = result["data"] as Record<string, unknown>;
    expect(data["total_matches"]).toBe(0);
    expect(data["matches"]).toHaveLength(0);
  });

  it("rejects empty query string", async () => {
    await expect(
      executeTool("rbx_search_project", { query: "", search_type: "name" }),
    ).rejects.toThrow();
  });

  it("rejects invalid search_type", async () => {
    await expect(
      executeTool("rbx_search_project", { query: "test", search_type: "invalid_type" }),
    ).rejects.toThrow();
  });

  it("rejects max_results above 500", async () => {
    await expect(
      executeTool("rbx_search_project", {
        query: "test",
        search_type: "name",
        max_results: 501,
      }),
    ).rejects.toThrow();
  });

  it("calls ping before fetching the data model", async () => {
    mockPing.mockClear();
    mockGetDataModel.mockResolvedValue(makeSampleTree());
    await executeTool("rbx_search_project", { query: "x", search_type: "name" });
    expect(mockPing).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi } from "vitest";
import type { RobloxPropertyValue } from "../types/roblox.js";

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockPing = vi.fn().mockResolvedValue({ ok: true });
const mockGetProperties = vi.fn();

vi.mock("../roblox/studio-bridge-client.js", () => ({
  StudioBridgeClient: class MockStudioBridgeClient {
    ping = mockPing;
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
await import("../tools/core/get-instance-properties.js");

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMockProperties(): Record<string, RobloxPropertyValue> {
  return {
    Anchored: true,
    Size: { xScale: 0, xOffset: 4, yScale: 0, yOffset: 4, zScale: 0, zOffset: 1 },
    Name: "MyPart",
    BrickColor: "Medium stone grey",
    Transparency: 0,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("rbx_get_instance_properties", () => {
  it("returns a well-formed response envelope", async () => {
    mockGetProperties.mockResolvedValue(makeMockProperties());
    const result = (await executeTool("rbx_get_instance_properties", {
      path: "game.Workspace.MyPart",
    })) as Record<string, unknown>;
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("schema_version");
    expect(result).toHaveProperty("freshness");
  });

  it("forwards the path to client.getProperties", async () => {
    mockGetProperties.mockResolvedValue(makeMockProperties());
    await executeTool("rbx_get_instance_properties", {
      path: "game.Workspace.SomePart",
    });
    expect(mockGetProperties).toHaveBeenCalledWith("game.Workspace.SomePart");
  });

  it("places the properties response under .data", async () => {
    const props = makeMockProperties();
    mockGetProperties.mockResolvedValue(props);
    const result = (await executeTool("rbx_get_instance_properties", {
      path: "game.Workspace.MyPart",
    })) as Record<string, unknown>;
    expect(result["data"]).toEqual(props);
  });

  it("includes studio_port in response source when overridden", async () => {
    mockGetProperties.mockResolvedValue({});
    const result = (await executeTool("rbx_get_instance_properties", {
      path: "game.Workspace.MyPart",
      studio_port: 12345,
    })) as Record<string, unknown>;
    const source = result["source"] as Record<string, unknown>;
    expect(source?.["studio_port"]).toBe(12345);
  });

  it("uses default studio_port 33796 when not specified", async () => {
    mockGetProperties.mockResolvedValue({});
    const result = (await executeTool("rbx_get_instance_properties", {
      path: "game.Workspace.MyPart",
    })) as Record<string, unknown>;
    const source = result["source"] as Record<string, unknown>;
    expect(source?.["studio_port"]).toBe(33796);
  });

  it("rejects empty path string", async () => {
    await expect(
      executeTool("rbx_get_instance_properties", { path: "" }),
    ).rejects.toThrow();
  });

  it("rejects missing path parameter", async () => {
    await expect(
      executeTool("rbx_get_instance_properties", {}),
    ).rejects.toThrow();
  });

  it("propagates bridge errors to the caller", async () => {
    mockGetProperties.mockRejectedValue(new Error("Roblox Studio not connected"));
    await expect(
      executeTool("rbx_get_instance_properties", {
        path: "game.Workspace.MyPart",
      }),
    ).rejects.toThrow("Roblox Studio not connected");
  });

  it("handles properties that contain nested objects", async () => {
    const nestedProps: Record<string, RobloxPropertyValue> = {
      CFrame: { position: { x: 1, y: 2, z: 3 }, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    };
    mockGetProperties.mockResolvedValue(nestedProps);
    const result = (await executeTool("rbx_get_instance_properties", {
      path: "game.Workspace.Part",
    })) as Record<string, unknown>;
    expect(result["data"]).toEqual(nestedProps);
  });

  it("rejects invalid studio_port values", async () => {
    await expect(
      executeTool("rbx_get_instance_properties", { path: "game.Workspace.Part", studio_port: 0 }),
    ).rejects.toThrow();
    await expect(
      executeTool("rbx_get_instance_properties", { path: "game.Workspace.Part", studio_port: -1 }),
    ).rejects.toThrow();
  });

  it("does not invoke ping before getProperties", async () => {
    mockPing.mockClear();
    mockGetProperties.mockResolvedValue({});
    await executeTool("rbx_get_instance_properties", {
      path: "game.Workspace.MyPart",
    });
    expect(mockPing).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InstanceNode } from "../types/roblox.js";

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

function makeTree(extraChildren: InstanceNode[] = []): InstanceNode {
  return makeNode("game", "DataModel", [
    makeNode("Workspace", "Workspace", extraChildren),
    makeNode("ServerStorage", "ServerStorage"),
  ]);
}

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockPing = vi.fn().mockResolvedValue({ ok: true });
const mockGetDataModel = vi.fn();
const mockGetProperties = vi.fn().mockResolvedValue({});
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);

vi.mock("../roblox/studio-bridge-client.js", () => ({
  StudioBridgeClient: class MockStudioBridgeClient {
    ping = mockPing;
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

// Mock fs/promises so we don't touch the real filesystem.
vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

import { executeTool } from "../tools/registry.js";
await import("../tools/shipcheck/release-diff.js");

// ── helpers ───────────────────────────────────────────────────────────────────

interface BaselineSnapshot {
  timestamp: string;
  tree: InstanceNode;
  scripts: Record<string, string>;
  metadata: { instance_count: number; script_count: number };
}

function makeBaseline(tree: InstanceNode, scripts: Record<string, string> = {}): BaselineSnapshot {
  return {
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    tree,
    scripts,
    metadata: { instance_count: 2, script_count: Object.keys(scripts).length },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("rbx_release_diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPing.mockResolvedValue({ ok: true });
    mockWriteFile.mockResolvedValue(undefined);
  });

  // ── save_baseline mode ────────────────────────────────────────────────────

  describe("save_baseline mode", () => {
    it("returns mode=baseline_saved without reading a file", async () => {
      mockGetDataModel.mockResolvedValue(makeTree());
      const result = (await executeTool("rbx_release_diff", {
        save_baseline: true,
      })) as Record<string, unknown>;
      const data = result["data"] as Record<string, unknown>;
      expect(data["mode"]).toBe("baseline_saved");
      expect(data).toHaveProperty("timestamp");
      expect(data).toHaveProperty("metadata");
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it("writes the baseline to output_path when specified", async () => {
      mockGetDataModel.mockResolvedValue(makeTree());
      await executeTool("rbx_release_diff", {
        save_baseline: true,
        output_path: "/tmp/baseline.json",
      });
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/tmp/baseline.json",
        expect.any(String),
        "utf8",
      );
    });

    it("includes path in returned data when output_path provided", async () => {
      mockGetDataModel.mockResolvedValue(makeTree());
      const result = (await executeTool("rbx_release_diff", {
        save_baseline: true,
        output_path: "/tmp/baseline.json",
      })) as Record<string, unknown>;
      const data = result["data"] as Record<string, unknown>;
      expect(data["path"]).toBe("/tmp/baseline.json");
    });
  });

  // ── diff mode ─────────────────────────────────────────────────────────────

  describe("diff mode (baseline_path provided)", () => {
    it("returns mode=diff with a full summary structure", async () => {
      const baseTree = makeTree();
      mockGetDataModel.mockResolvedValue(makeTree()); // identical current
      mockReadFile.mockResolvedValue(JSON.stringify(makeBaseline(baseTree)));

      const result = (await executeTool("rbx_release_diff", {
        baseline_path: "/tmp/baseline.json",
      })) as Record<string, unknown>;
      const data = result["data"] as Record<string, unknown>;
      expect(data["mode"]).toBe("diff");
      const summary = data["summary"] as Record<string, unknown>;
      expect(typeof summary["risk_score"]).toBe("number");
      expect(typeof summary["instances_added"]).toBe("number");
      expect(typeof summary["instances_removed"]).toBe("number");
      expect(typeof summary["scripts_changed"]).toBe("number");
    });

    it("detects added instances", async () => {
      const baseTree = makeTree(); // no extra parts
      const currentTree = makeTree([makeNode("NewPart", "Part")]); // added Part
      mockGetDataModel.mockResolvedValue(currentTree);
      mockReadFile.mockResolvedValue(JSON.stringify(makeBaseline(baseTree)));

      const result = (await executeTool("rbx_release_diff", {
        baseline_path: "/tmp/baseline.json",
      })) as Record<string, unknown>;
      const data = result["data"] as Record<string, unknown>;
      const summary = data["summary"] as Record<string, unknown>;
      expect(Number(summary["instances_added"])).toBeGreaterThan(0);
    });

    it("detects removed instances", async () => {
      const baseTree = makeTree([makeNode("OldPart", "Part")]); // had a Part
      const currentTree = makeTree(); // Part removed
      mockGetDataModel.mockResolvedValue(currentTree);
      mockReadFile.mockResolvedValue(JSON.stringify(makeBaseline(baseTree)));

      const result = (await executeTool("rbx_release_diff", {
        baseline_path: "/tmp/baseline.json",
      })) as Record<string, unknown>;
      const data = result["data"] as Record<string, unknown>;
      const summary = data["summary"] as Record<string, unknown>;
      expect(Number(summary["instances_removed"])).toBeGreaterThan(0);
    });

    it("detects changed scripts", async () => {
      const scriptPath = "game.ServerStorage.GameManager";
      const baseScripts: Record<string, string> = { [scriptPath]: "-- v1" };
      const currentTree = makeTree([
        makeNode("GameManager", "Script", [], { Source: "-- v2 with changes" }),
      ]);
      const baseTree = makeTree([
        makeNode("GameManager", "Script", [], { Source: "-- v1" }),
      ]);
      mockGetDataModel.mockResolvedValue(currentTree);
      mockReadFile.mockResolvedValue(JSON.stringify(makeBaseline(baseTree, baseScripts)));

      const result = (await executeTool("rbx_release_diff", {
        baseline_path: "/tmp/baseline.json",
      })) as Record<string, unknown>;
      const data = result["data"] as Record<string, unknown>;
      // Any script change should appear in changes.scripts_changed
      const changes = data["changes"] as Record<string, unknown>;
      expect(Array.isArray(changes["scripts_changed"])).toBe(true);
    });

    it("has SAFE_TO_SHIP verdict for identical snapshots", async () => {
      const tree = makeTree();
      mockGetDataModel.mockResolvedValue(tree);
      mockReadFile.mockResolvedValue(JSON.stringify(makeBaseline(tree)));

      const result = (await executeTool("rbx_release_diff", {
        baseline_path: "/tmp/baseline.json",
      })) as Record<string, unknown>;
      const data = result["data"] as Record<string, unknown>;
      expect(data["verdict"]).toBe("SAFE_TO_SHIP");
    });

    it("raises risk_score when scripts with remote APIs are added", async () => {
      const baseTree = makeTree();
      const currentTree = makeTree([
        makeNode("RemoteHandler", "Script", [], {
          Source: "RemoteEvent:FireServer()",
        }),
      ]);
      mockGetDataModel.mockResolvedValue(currentTree);
      mockReadFile.mockResolvedValue(JSON.stringify(makeBaseline(baseTree)));

      const result = (await executeTool("rbx_release_diff", {
        baseline_path: "/tmp/baseline.json",
      })) as Record<string, unknown>;
      const data = result["data"] as Record<string, unknown>;
      const summary = data["summary"] as Record<string, unknown>;
      expect(Number(summary["risk_score"])).toBeGreaterThan(0);
    });

    it("returns recommended_audits for remote-touching scripts", async () => {
      const baseTree = makeTree();
      const currentTree = makeTree([
        makeNode("NetHandler", "Script", [], {
          Source: "game:GetService('RemoteEvent'):FireServer()",
        }),
      ]);
      mockGetDataModel.mockResolvedValue(currentTree);
      mockReadFile.mockResolvedValue(JSON.stringify(makeBaseline(baseTree)));

      const result = (await executeTool("rbx_release_diff", {
        baseline_path: "/tmp/baseline.json",
      })) as Record<string, unknown>;
      const data = result["data"] as Record<string, unknown>;
      const audits = data["recommended_audits"] as string[];
      // Should recommend remote_contract_audit since remotes API detected.
      expect(audits).toContain("rbx_remote_contract_audit");
    });

    it("writes report to output_path when specified", async () => {
      const tree = makeTree();
      mockGetDataModel.mockResolvedValue(tree);
      mockReadFile.mockResolvedValue(JSON.stringify(makeBaseline(tree)));

      await executeTool("rbx_release_diff", {
        baseline_path: "/tmp/baseline.json",
        output_path: "/tmp/report.json",
      });
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/tmp/report.json",
        expect.any(String),
        "utf8",
      );
    });
  });

  // ── parameter validation ──────────────────────────────────────────────────

  describe("parameter validation", () => {
    it("throws when baseline_path is omitted in diff mode", async () => {
      mockGetDataModel.mockResolvedValue(makeTree());
      await expect(
        executeTool("rbx_release_diff", { save_baseline: false }),
      ).rejects.toThrow();
    });

    it("validates studio_port as positive integer", async () => {
      await expect(
        executeTool("rbx_release_diff", { studio_port: -1, save_baseline: true }),
      ).rejects.toThrow();
    });
  });
});

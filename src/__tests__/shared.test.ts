import { describe, it, expect } from "vitest";
import {
  scoreFromIssues,
  summarizeIssues,
  pathToSegments,
  getNodePath,
  findNodeByPath,
  limitInstanceDepth,
  traverseInstances,
  searchDataModel,
  snippetAroundMatch,
  normalizeText,
  renderPropertyValue,
  createResponseEnvelope,
  sourceInfo,
  isInteractiveGui,
  parseUDim2Like,
  parseVector2Like,
  computeGuiBounds,
  overlap,
  buildPatchOperationsPreview,
  type AuditIssue,
} from "../shared.js";
import type { PatchOperation } from "../types/roblox.js";
import { makeNode } from "./test-helpers.js";

// ── scoreFromIssues ───────────────────────────────────────────────────────────

describe("scoreFromIssues", () => {
  it("returns 100 for no issues", () => {
    expect(scoreFromIssues([])).toBe(100);
  });

  it("deducts 20 per high issue", () => {
    const issues: AuditIssue[] = [
      { severity: "high", element_path: "a", rule: "r", message: "m", suggestion: "s" },
    ];
    expect(scoreFromIssues(issues)).toBe(80);
  });

  it("deducts 10 per medium issue", () => {
    const issues: AuditIssue[] = [
      { severity: "medium", element_path: "a", rule: "r", message: "m", suggestion: "s" },
      { severity: "medium", element_path: "b", rule: "r", message: "m", suggestion: "s" },
    ];
    expect(scoreFromIssues(issues)).toBe(80);
  });

  it("deducts 4 per low issue", () => {
    const issues: AuditIssue[] = [
      { severity: "low", element_path: "a", rule: "r", message: "m", suggestion: "s" },
    ];
    expect(scoreFromIssues(issues)).toBe(96);
  });

  it("clamps to 0 with many issues", () => {
    const issues: AuditIssue[] = Array.from({ length: 20 }, () => ({
      severity: "high" as const,
      element_path: "x",
      rule: "r",
      message: "m",
      suggestion: "s",
    }));
    expect(scoreFromIssues(issues)).toBe(0);
  });
});

// ── summarizeIssues ───────────────────────────────────────────────────────────

describe("summarizeIssues", () => {
  it("returns no-issues message for empty array", () => {
    expect(summarizeIssues([])).toBe("No issues detected.");
  });

  it("summarizes counts correctly", () => {
    const issues: AuditIssue[] = [
      { severity: "high", element_path: "a", rule: "r", message: "m", suggestion: "s" },
      { severity: "medium", element_path: "b", rule: "r", message: "m", suggestion: "s" },
      { severity: "low", element_path: "c", rule: "r", message: "m", suggestion: "s" },
    ];
    const result = summarizeIssues(issues);
    expect(result).toContain("3 issues detected");
    expect(result).toContain("1 high");
    expect(result).toContain("1 medium");
    expect(result).toContain("1 low");
  });
});

// ── pathToSegments ────────────────────────────────────────────────────────────

describe("pathToSegments", () => {
  it("splits on dots", () => {
    expect(pathToSegments("game.Workspace.Part")).toEqual(["game", "Workspace", "Part"]);
  });

  it("trims whitespace around segments", () => {
    expect(pathToSegments("game . Workspace . Part")).toEqual(["game", "Workspace", "Part"]);
  });

  it("returns empty for empty string", () => {
    expect(pathToSegments("")).toEqual([]);
  });
});

// ── getNodePath ───────────────────────────────────────────────────────────────

describe("getNodePath", () => {
  it("returns name when no ancestors", () => {
    const node = makeNode("Part", "Part");
    expect(getNodePath(node)).toBe("Part");
  });

  it("joins ancestors with dots", () => {
    const node = makeNode("Part", "Part");
    expect(getNodePath(node, ["game", "Workspace"])).toBe("game.Workspace.Part");
  });
});

// ── findNodeByPath ────────────────────────────────────────────────────────────

describe("findNodeByPath", () => {
  const workspace = makeNode("Workspace", "Workspace", [makeNode("Part", "Part")]);
  const root = makeNode("game", "DataModel", [workspace]);

  it("returns root for empty path", () => {
    expect(findNodeByPath(root, "")).toBe(root);
  });

  it("finds node at path", () => {
    const result = findNodeByPath(root, "game.Workspace.Part");
    expect(result?.name).toBe("Part");
  });

  it("returns null for missing node", () => {
    expect(findNodeByPath(root, "game.Workspace.Missing")).toBeNull();
  });

  it("handles root alias 'game'", () => {
    const result = findNodeByPath(root, "game.Workspace");
    expect(result?.name).toBe("Workspace");
  });
});

// ── limitInstanceDepth ────────────────────────────────────────────────────────

describe("limitInstanceDepth", () => {
  it("truncates children at max depth", () => {
    const child = makeNode("Child", "Part");
    const root = makeNode("Root", "Model", [child]);
    const result = limitInstanceDepth(root, 0);
    expect(result.children).toHaveLength(0);
  });

  it("includes children within depth", () => {
    const child = makeNode("Child", "Part");
    const root = makeNode("Root", "Model", [child]);
    const result = limitInstanceDepth(root, 1);
    expect(result.children).toHaveLength(1);
  });

  it("includes properties when requested", () => {
    const node = makeNode("Root", "Model", [], { Anchored: true });
    const result = limitInstanceDepth(node, 0, 0, true);
    expect(result.properties).toBeDefined();
    expect(result.properties?.["Anchored"]).toBe(true);
  });
});

// ── traverseInstances ─────────────────────────────────────────────────────────

describe("traverseInstances", () => {
  it("visits all nodes", () => {
    const child = makeNode("Child", "Part");
    const root = makeNode("Root", "Model", [child]);
    const visited: string[] = [];
    traverseInstances(root, (node) => {
      visited.push(node.name);
    });
    expect(visited).toContain("Root");
    expect(visited).toContain("Child");
  });

  it("stops traversal when visitor returns false", () => {
    const child = makeNode("Child", "Part");
    const root = makeNode("Root", "Model", [child]);
    const visited: string[] = [];
    traverseInstances(root, (node) => {
      visited.push(node.name);
      return false;
    });
    expect(visited).toHaveLength(1);
    expect(visited[0]).toBe("Root");
  });
});

// ── searchDataModel ───────────────────────────────────────────────────────────

describe("searchDataModel", () => {
  const scriptNode = makeNode("MyScript", "Script", [], { Source: "print('hello world')" });
  const buttonNode = makeNode("PlayButton", "TextButton");
  const workspace = makeNode("Workspace", "Workspace", [
    makeNode("Part", "Part"),
    buttonNode,
    scriptNode,
  ]);
  const root = makeNode("game", "DataModel", [workspace]);

  it("searches by name", () => {
    const matches = searchDataModel(root, {
      query: "Play",
      searchType: "name",
      caseSensitive: false,
      maxResults: 10,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.matchType).toBe("name");
    expect(matches[0]?.path).toContain("PlayButton");
  });

  it("searches by class", () => {
    const matches = searchDataModel(root, {
      query: "TextButton",
      searchType: "class",
      caseSensitive: false,
      maxResults: 10,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.className).toBe("TextButton");
  });

  it("searches script_content", () => {
    const matches = searchDataModel(root, {
      query: "hello",
      searchType: "script_content",
      caseSensitive: false,
      maxResults: 10,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.matchType).toBe("script_content");
  });

  it("respects maxResults", () => {
    const matches = searchDataModel(root, {
      query: "a",
      searchType: "name",
      caseSensitive: false,
      maxResults: 1,
    });
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  it("returns empty array when rootPath is not found", () => {
    const matches = searchDataModel(root, {
      query: "anything",
      searchType: "name",
      caseSensitive: false,
      maxResults: 10,
      rootPath: "game.NonExistent",
    });
    expect(matches).toHaveLength(0);
  });

  it("is case-insensitive by default", () => {
    const matchesLower = searchDataModel(root, {
      query: "myScript",
      searchType: "name",
      caseSensitive: false,
      maxResults: 10,
    });
    expect(matchesLower.length).toBeGreaterThan(0);
  });

  it("is case-sensitive when requested", () => {
    const matchesExact = searchDataModel(root, {
      query: "MyScript",
      searchType: "name",
      caseSensitive: true,
      maxResults: 10,
    });
    const matchesWrongCase = searchDataModel(root, {
      query: "myscript",
      searchType: "name",
      caseSensitive: true,
      maxResults: 10,
    });
    expect(matchesExact.length).toBeGreaterThan(0);
    expect(matchesWrongCase).toHaveLength(0);
  });
});

// ── snippetAroundMatch ────────────────────────────────────────────────────────

describe("snippetAroundMatch", () => {
  it("returns snippet centred around the match", () => {
    const content = "a".repeat(50) + "TARGET" + "b".repeat(50);
    const snippet = snippetAroundMatch(content, "TARGET", true);
    expect(snippet).toContain("TARGET");
  });

  it("falls back to first 120 chars when no match", () => {
    const content = "x".repeat(200);
    const snippet = snippetAroundMatch(content, "notfound", true);
    expect(snippet.length).toBe(120);
  });
});

// ── normalizeText ─────────────────────────────────────────────────────────────

describe("normalizeText", () => {
  it("lowercases when not case-sensitive", () => {
    expect(normalizeText("Hello", false)).toBe("hello");
  });

  it("preserves case when case-sensitive", () => {
    expect(normalizeText("Hello", true)).toBe("Hello");
  });
});

// ── renderPropertyValue ───────────────────────────────────────────────────────

describe("renderPropertyValue", () => {
  it("renders null", () => {
    expect(renderPropertyValue(null)).toBe("null");
  });

  it("renders string", () => {
    expect(renderPropertyValue("hello")).toBe("hello");
  });

  it("renders number", () => {
    expect(renderPropertyValue(42)).toBe("42");
  });

  it("renders boolean", () => {
    expect(renderPropertyValue(true)).toBe("true");
  });

  it("renders object as JSON", () => {
    const value = { r: 1, g: 0, b: 0 };
    const result = renderPropertyValue(value);
    expect(result).toBe(JSON.stringify(value));
  });
});

// ── createResponseEnvelope ────────────────────────────────────────────────────

describe("createResponseEnvelope", () => {
  it("includes schema_version", () => {
    const envelope = createResponseEnvelope({ key: "value" });
    expect(envelope.schema_version).toBeDefined();
  });

  it("includes provided data under .data", () => {
    const data = { items: [1, 2, 3] };
    const envelope = createResponseEnvelope(data);
    expect(envelope.data).toEqual(data);
  });

  it("includes freshness info", () => {
    const envelope = createResponseEnvelope({});
    expect(envelope.freshness.fresh).toBe(true);
    expect(typeof envelope.freshness.timestamp).toBe("string");
  });

  it("passes warnings through", () => {
    const envelope = createResponseEnvelope({}, { warnings: ["test warning"] });
    expect(envelope.warnings).toContain("test warning");
  });

  it("includes source when provided", () => {
    const envelope = createResponseEnvelope({}, { source: { studio_port: 12345 } });
    expect(envelope.source.studio_port).toBe(12345);
  });
});

// ── sourceInfo ────────────────────────────────────────────────────────────────

describe("sourceInfo", () => {
  it("filters out undefined values", () => {
    const result = sourceInfo({ studio_port: 33796 });
    expect(result.studio_port).toBe(33796);
    expect(result.universe_id).toBeUndefined();
  });

  it("includes all provided fields", () => {
    const result = sourceInfo({ studio_port: 33796, universe_id: "123", place_id: "456" });
    expect(result.studio_port).toBe(33796);
    expect(result.universe_id).toBe("123");
    expect(result.place_id).toBe("456");
  });

  it("handles undefined input gracefully", () => {
    const result = sourceInfo(undefined);
    expect(result).toEqual({});
  });
});

// ── isInteractiveGui ──────────────────────────────────────────────────────────

describe("isInteractiveGui", () => {
  it("recognizes interactive GUI classes", () => {
    expect(isInteractiveGui("TextButton")).toBe(true);
    expect(isInteractiveGui("ImageButton")).toBe(true);
    expect(isInteractiveGui("Frame")).toBe(true);
    expect(isInteractiveGui("ScrollingFrame")).toBe(true);
  });

  it("returns false for non-GUI classes", () => {
    expect(isInteractiveGui("Part")).toBe(false);
    expect(isInteractiveGui("Script")).toBe(false);
  });
});

// ── parseUDim2Like ────────────────────────────────────────────────────────────

describe("parseUDim2Like", () => {
  it("parses valid UDim2 object", () => {
    const result = parseUDim2Like({ xScale: 0.5, xOffset: 10, yScale: 0.25, yOffset: 5 });
    expect(result).toEqual({ xScale: 0.5, xOffset: 10, yScale: 0.25, yOffset: 5 });
  });

  it("returns null for non-object values", () => {
    expect(parseUDim2Like("not-an-object")).toBeNull();
    expect(parseUDim2Like(null)).toBeNull();
    expect(parseUDim2Like([1, 2, 3])).toBeNull();
  });

  it("returns null for incomplete objects", () => {
    expect(parseUDim2Like({ xScale: 0.5 })).toBeNull();
  });
});

// ── parseVector2Like ──────────────────────────────────────────────────────────

describe("parseVector2Like", () => {
  it("parses valid Vector2 object", () => {
    const result = parseVector2Like({ x: 100, y: 200 });
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it("returns null for non-objects", () => {
    expect(parseVector2Like(null)).toBeNull();
    expect(parseVector2Like("string")).toBeNull();
  });
});

// ── computeGuiBounds ──────────────────────────────────────────────────────────

describe("computeGuiBounds", () => {
  const screen = { name: "iPhone SE", width: 375, height: 667 };

  it("uses AbsolutePosition/AbsoluteSize when available", () => {
    const props = {
      AbsolutePosition: { x: 10, y: 20 },
      AbsoluteSize: { x: 100, y: 50 },
    };
    const bounds = computeGuiBounds(props, screen);
    expect(bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("falls back to Size/Position UDim2 values", () => {
    const props = {
      Position: { xScale: 0, xOffset: 0, yScale: 0, yOffset: 0 },
      Size: { xScale: 1, xOffset: 0, yScale: 0.5, yOffset: 0 },
    };
    const bounds = computeGuiBounds(props, screen);
    expect(bounds?.width).toBeCloseTo(375);
    expect(bounds?.height).toBeCloseTo(333.5);
  });

  it("returns null when no position/size available", () => {
    expect(computeGuiBounds({}, screen)).toBeNull();
  });
});

// ── overlap ───────────────────────────────────────────────────────────────────

describe("overlap", () => {
  it("detects overlapping rectangles", () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 50, y: 50, width: 100, height: 100 };
    expect(overlap(a, b)).toBe(true);
  });

  it("returns false for non-overlapping rectangles", () => {
    const a = { x: 0, y: 0, width: 50, height: 50 };
    const b = { x: 100, y: 100, width: 50, height: 50 };
    expect(overlap(a, b)).toBe(false);
  });

  it("returns false for touching-edge rectangles (not overlapping)", () => {
    const a = { x: 0, y: 0, width: 50, height: 50 };
    const b = { x: 50, y: 0, width: 50, height: 50 };
    expect(overlap(a, b)).toBe(false);
  });
});

// ── buildPatchOperationsPreview ───────────────────────────────────────────────

describe("buildPatchOperationsPreview", () => {
  const partNode = makeNode("Part", "Part", [], { Anchored: true });
  const workspace = makeNode("Workspace", "Workspace", [partNode]);
  const root = makeNode("game", "DataModel", [workspace]);

  it("previews a create operation", () => {
    const ops: PatchOperation[] = [
      {
        type: "create",
        target_path: "game.Workspace.NewPart",
        class_name: "Part",
        properties: { Anchored: true },
      },
    ];
    const preview = buildPatchOperationsPreview(ops, root);
    expect(preview).toHaveLength(1);
    expect(preview[0]?.operation).toBe("create");
    expect(preview[0]?.before).toBeNull();
    expect((preview[0]?.after as Record<string, unknown>)?.className).toBe("Part");
  });

  it("previews a delete operation", () => {
    const ops: PatchOperation[] = [
      { type: "delete", target_path: "game.Workspace.Part" },
    ];
    const preview = buildPatchOperationsPreview(ops, root);
    expect(preview[0]?.operation).toBe("delete");
    expect(preview[0]?.after).toBeNull();
  });

  it("previews an update operation", () => {
    const ops: PatchOperation[] = [
      {
        type: "update",
        target_path: "game.Workspace.Part",
        properties: { Anchored: false },
      },
    ];
    const preview = buildPatchOperationsPreview(ops, root);
    expect(preview[0]?.operation).toBe("update");
  });

  it("previews a reparent operation", () => {
    const ops: PatchOperation[] = [
      {
        type: "reparent",
        target_path: "game.Workspace.Part",
        new_parent_path: "game.ReplicatedStorage",
      },
    ];
    const preview = buildPatchOperationsPreview(ops, root);
    expect(preview[0]?.operation).toBe("reparent");
  });

  it("returns an entry with null before when deleting a missing node", () => {
    const ops: PatchOperation[] = [
      { type: "delete", target_path: "game.Workspace.MissingPart" },
    ];
    const preview = buildPatchOperationsPreview(ops, root);
    expect(preview).toHaveLength(1);
    expect(preview[0]?.operation).toBe("delete");
    expect(preview[0]?.before).toBeNull();
    expect(preview[0]?.after).toBeNull();
  });

  it("returns an entry with null before when updating a missing node", () => {
    const ops: PatchOperation[] = [
      {
        type: "update",
        target_path: "game.Workspace.MissingPart",
        properties: { Anchored: false },
      },
    ];
    const preview = buildPatchOperationsPreview(ops, root);
    expect(preview).toHaveLength(1);
    expect(preview[0]?.operation).toBe("update");
    expect(preview[0]?.before).toBeNull();
  });

  it("returns an entry with null before when reparenting a missing node", () => {
    const ops: PatchOperation[] = [
      {
        type: "reparent",
        target_path: "game.Workspace.MissingPart",
        new_parent_path: "game.ReplicatedStorage",
      },
    ];
    const preview = buildPatchOperationsPreview(ops, root);
    expect(preview).toHaveLength(1);
    expect(preview[0]?.operation).toBe("reparent");
    expect(preview[0]?.before).toBeNull();
  });

  it("returns an entry with the new_parent_path even when parent does not exist", () => {
    const ops: PatchOperation[] = [
      {
        type: "reparent",
        target_path: "game.Workspace.Part",
        new_parent_path: "game.Workspace.MissingFolder",
      },
    ];
    const preview = buildPatchOperationsPreview(ops, root);
    expect(preview).toHaveLength(1);
    expect(preview[0]?.operation).toBe("reparent");
    const after = preview[0]?.after as Record<string, unknown>;
    expect(after?.["new_parent_path"]).toBe("game.Workspace.MissingFolder");
  });
});

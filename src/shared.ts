import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  InstanceNode,
  InstanceSnapshot,
  PatchOperation,
  RobloxPropertyValue,
  SearchType,
  StudioSearchMatch,
} from "./types/roblox.js";
import type { ResponseEnvelope } from "./types/tools.js";

export const SCHEMA_VERSION = "0.1.0";
export const SERVER_VERSION = "0.1.0";
const CACHE_ROOT = path.join(tmpdir(), "roblox-workflow-mcp-cache");

export interface SourceInfo {
  universe_id?: string;
  place_id?: string;
  studio_port?: number;
}

export interface AuditIssue {
  severity: "low" | "medium" | "high";
  element_path: string;
  rule: string;
  message: string;
  suggestion: string;
}

export interface MobileScreenSize {
  width: number;
  height: number;
  name: string;
}

export function sourceInfo(source?: SourceInfo): SourceInfo {
  return {
    ...(source?.universe_id ? { universe_id: source.universe_id } : {}),
    ...(source?.place_id ? { place_id: source.place_id } : {}),
    ...(typeof source?.studio_port === "number" ? { studio_port: source.studio_port } : {}),
  };
}

export function createResponseEnvelope<T>(
  data: T,
  options?: {
    source?: SourceInfo;
    warnings?: string[];
    fresh?: boolean;
    ttlMs?: number;
    timestamp?: string;
  },
): ResponseEnvelope<T> {
  return {
    schema_version: SCHEMA_VERSION,
    source: sourceInfo(options?.source),
    freshness: {
      fresh: options?.fresh ?? true,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      ttl_ms: options?.ttlMs ?? 0,
    },
    warnings: options?.warnings ?? [],
    data,
  };
}

export function pathToSegments(input: string): string[] {
  return input
    .split(/[./]/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function getNodePath(node: InstanceNode, ancestors: string[] = []): string {
  return [...ancestors, node.name].join(".");
}

export function findNodeByPath(root: InstanceNode, targetPath: string): InstanceNode | null {
  const segments = pathToSegments(targetPath);
  if (segments.length === 0) {
    return root;
  }
  return findNodeBySegments(root, segments);
}

function findNodeBySegments(node: InstanceNode, segments: string[]): InstanceNode | null {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return node;
  }
  if (node.name !== head && node.className !== head) {
    const childMatch = node.children.find(
      (child) => child.name === head || child.className === head,
    );
    if (!childMatch) {
      return null;
    }
    return findNodeBySegments(childMatch, rest);
  }
  if (rest.length === 0) {
    return node;
  }
  const child = node.children.find(
    (candidate) => candidate.name === rest[0] || candidate.className === rest[0],
  );
  if (!child) {
    return null;
  }
  return findNodeBySegments(child, rest);
}

export function limitInstanceDepth(
  node: InstanceNode,
  maxDepth: number,
  depth = 0,
  includeProperties = false,
): InstanceSnapshot {
  const snapshot: InstanceSnapshot = {
    id: node.id,
    name: node.name,
    className: node.className,
    children:
      depth >= maxDepth
        ? []
        : node.children.map((child) =>
            limitInstanceDepth(child, maxDepth, depth + 1, includeProperties),
          ),
  };
  if (includeProperties && node.properties) {
    snapshot.properties = node.properties;
  }
  return snapshot;
}

export function traverseInstances(
  node: InstanceNode,
  visitor: (node: InstanceNode, path: string, depth: number) => void,
  ancestors: string[] = [],
  depth = 0,
): void {
  const currentPath = getNodePath(node, ancestors);
  visitor(node, currentPath, depth);
  for (const child of node.children) {
    traverseInstances(child, visitor, [...ancestors, node.name], depth + 1);
  }
}

export function normalizeText(input: string, caseSensitive: boolean): string {
  return caseSensitive ? input : input.toLowerCase();
}

export function snippetAroundMatch(content: string, query: string, caseSensitive: boolean): string {
  const haystack = normalizeText(content, caseSensitive);
  const needle = normalizeText(query, caseSensitive);
  const index = haystack.indexOf(needle);
  if (index === -1) {
    return content.slice(0, 120);
  }
  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + query.length + 40);
  return content.slice(start, end).replace(/\s+/gu, " ").trim();
}

export function searchDataModel(
  root: InstanceNode,
  options: {
    query: string;
    searchType: SearchType;
    caseSensitive: boolean;
    maxResults: number;
    rootPath?: string;
  },
): StudioSearchMatch[] {
  const baseNode = options.rootPath ? findNodeByPath(root, options.rootPath) : root;
  if (!baseNode) {
    return [];
  }
  const matches: StudioSearchMatch[] = [];
  const normalizedQuery = normalizeText(options.query, options.caseSensitive);
  traverseInstances(baseNode, (node, currentPath) => {
    if (matches.length >= options.maxResults) {
      return;
    }
    const properties = node.properties ?? {};
    if (options.searchType === "name") {
      if (normalizeText(node.name, options.caseSensitive).includes(normalizedQuery)) {
        matches.push({
          path: currentPath,
          className: node.className,
          snippet: node.name,
          matchType: "name",
        });
      }
      return;
    }
    if (options.searchType === "class") {
      if (normalizeText(node.className, options.caseSensitive).includes(normalizedQuery)) {
        matches.push({
          path: currentPath,
          className: node.className,
          snippet: node.className,
          matchType: "class",
        });
      }
      return;
    }
    if (options.searchType === "property") {
      for (const [key, value] of Object.entries(properties)) {
        const rendered = renderPropertyValue(value);
        const combined = `${key}:${rendered}`;
        if (normalizeText(combined, options.caseSensitive).includes(normalizedQuery)) {
          matches.push({
            path: currentPath,
            className: node.className,
            snippet: `${key}=${rendered}`.slice(0, 160),
            matchType: "property",
          });
          break;
        }
      }
      return;
    }
    const source = readScriptSource(node);
    if (source && normalizeText(source, options.caseSensitive).includes(normalizedQuery)) {
      matches.push({
        path: currentPath,
        className: node.className,
        snippet: snippetAroundMatch(source, options.query, options.caseSensitive),
        matchType: "script_content",
      });
    }
  });
  return matches;
}

export function readScriptSource(node: InstanceNode): string | null {
  if (!["Script", "LocalScript", "ModuleScript"].includes(node.className)) {
    return null;
  }
  const properties = node.properties ?? {};
  const source = properties["Source"];
  if (typeof source === "string") {
    return source;
  }
  return null;
}

export function renderPropertyValue(value: RobloxPropertyValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export async function ensureCacheDir(): Promise<string> {
  await mkdir(CACHE_ROOT, { recursive: true });
  return CACHE_ROOT;
}

export async function readCachedJson<T>(
  namespace: string,
  key: string,
  ttlMs: number,
): Promise<T | null> {
  const cacheDir = await ensureCacheDir();
  const filename = path.join(cacheDir, `${namespace}-${sha256(key)}.json`);
  try {
    const raw = await readFile(filename, "utf8");
    const parsed = JSON.parse(raw) as { timestamp: number; data: T };
    if (Date.now() - parsed.timestamp > ttlMs) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function writeCachedJson<T>(namespace: string, key: string, data: T): Promise<void> {
  const cacheDir = await ensureCacheDir();
  const filename = path.join(cacheDir, `${namespace}-${sha256(key)}.json`);
  await writeFile(filename, JSON.stringify({ timestamp: Date.now(), data }, null, 2), "utf8");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function scoreFromIssues(issues: AuditIssue[]): number {
  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === "high") {
      return sum + 20;
    }
    if (issue.severity === "medium") {
      return sum + 10;
    }
    return sum + 4;
  }, 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

export function isInteractiveGui(className: string): boolean {
  return ["TextButton", "ImageButton", "ImageLabel", "Frame", "ScrollingFrame"].includes(className);
}

export function parseUDim2Like(value: RobloxPropertyValue): {
  xScale: number;
  xOffset: number;
  yScale: number;
  yOffset: number;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["xScale"] === "number" &&
    typeof record["xOffset"] === "number" &&
    typeof record["yScale"] === "number" &&
    typeof record["yOffset"] === "number"
  ) {
    return {
      xScale: record["xScale"],
      xOffset: record["xOffset"],
      yScale: record["yScale"],
      yOffset: record["yOffset"],
    };
  }
  return null;
}

export function parseVector2Like(value: RobloxPropertyValue): { x: number; y: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record["x"] === "number" && typeof record["y"] === "number") {
    return { x: record["x"], y: record["y"] };
  }
  return null;
}

export function computeGuiBounds(
  properties: Record<string, RobloxPropertyValue>,
  screen: MobileScreenSize,
): { x: number; y: number; width: number; height: number } | null {
  const absPosVal = properties["AbsolutePosition"];
  const absSizeVal = properties["AbsoluteSize"];
  const absolutePosition = absPosVal !== undefined ? parseVector2Like(absPosVal) : null;
  const absoluteSize = absSizeVal !== undefined ? parseVector2Like(absSizeVal) : null;
  if (absolutePosition && absoluteSize) {
    return {
      x: absolutePosition.x,
      y: absolutePosition.y,
      width: absoluteSize.x,
      height: absoluteSize.y,
    };
  }
  const sizeVal = properties["Size"];
  const posVal = properties["Position"];
  const size = sizeVal !== undefined ? parseUDim2Like(sizeVal) : null;
  const position = posVal !== undefined ? parseUDim2Like(posVal) : null;
  if (!size || !position) {
    return null;
  }
  return {
    x: position.xScale * screen.width + position.xOffset,
    y: position.yScale * screen.height + position.yOffset,
    width: size.xScale * screen.width + size.xOffset,
    height: size.yScale * screen.height + size.yOffset,
  };
}

export function overlap(
  a: { x: number; y: number; width: number; height: number },
  b: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function defaultMobileScreens(): MobileScreenSize[] {
  return [
    { name: "iPhone SE", width: 375, height: 667 },
    { name: "iPhone 14 Pro", width: 393, height: 852 },
    { name: "Pixel 7", width: 412, height: 915 },
    { name: "iPad Mini Portrait", width: 744, height: 1133 },
  ];
}

export function summarizeIssues(issues: AuditIssue[]): string {
  if (issues.length === 0) {
    return "No issues detected.";
  }
  const counts = issues.reduce(
    (acc, issue) => {
      acc[issue.severity] += 1;
      return acc;
    },
    { low: 0, medium: 0, high: 0 },
  );
  return `${issues.length} issues detected (${counts.high} high, ${counts.medium} medium, ${counts.low} low).`;
}

export function buildPatchOperationsPreview(
  operations: PatchOperation[],
  root: InstanceNode,
): Array<Record<string, unknown>> {
  return operations.map((operation) => {
    const beforeNode =
      operation.type === "create" ? null : findNodeByPath(root, operation.target_path);
    const before = beforeNode
      ? {
          path: operation.target_path,
          className: beforeNode.className,
          properties: beforeNode.properties ?? {},
        }
      : null;
    let after: Record<string, unknown> | null;
    if (operation.type === "create") {
      after = {
        path: operation.target_path,
        className: operation.class_name,
        properties: operation.properties ?? {},
      };
    } else if (operation.type === "delete") {
      after = null;
    } else if (operation.type === "reparent") {
      after = {
        path: operation.target_path,
        new_parent_path: operation.new_parent_path,
      };
    } else {
      after = {
        path: operation.target_path,
        properties: { ...(beforeNode?.properties ?? {}), ...(operation.properties ?? {}) },
      };
    }
    return {
      operation: operation.type,
      target: operation.target_path,
      before,
      after,
    };
  });
}

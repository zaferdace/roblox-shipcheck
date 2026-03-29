import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import {
  createResponseEnvelope,
  readScriptSource,
  sourceInfo,
  traverseInstances,
} from "../../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../../types/roblox.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  baseline_path: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Path to a previously saved baseline JSON file. If omitted, captures current state as baseline.",
    ),
  save_baseline: z
    .boolean()
    .default(false)
    .describe("If true, save current state as baseline and return it without diffing."),
  api_key: z.string().min(1).optional(),
  universe_id: z.string().min(1).optional(),
  run_targeted_audits: z
    .boolean()
    .default(true)
    .describe("Run relevant audits only on changed areas"),
  output_path: z
    .string()
    .optional()
    .describe("If provided, write the diff report to this file path"),
});

const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);
const GUI_CLASSES = new Set([
  "ScreenGui",
  "SurfaceGui",
  "BillboardGui",
  "Frame",
  "ScrollingFrame",
  "TextLabel",
  "TextButton",
  "TextBox",
  "ImageLabel",
  "ImageButton",
  "ViewportFrame",
  "CanvasGroup",
  "UIListLayout",
  "UIGridLayout",
  "UIPageLayout",
  "UITableLayout",
  "UIAspectRatioConstraint",
  "UISizeConstraint",
  "UITextSizeConstraint",
  "UIPadding",
  "UICorner",
  "UIStroke",
  "UIGradient",
]);

const SENSITIVE_PATTERNS = {
  remotes:
    /RemoteEvent|RemoteFunction|OnServerEvent|OnClientEvent|FireServer|FireClient|InvokeServer/u,
  datastores: /DataStoreService|GetDataStore|GetAsync|SetAsync|UpdateAsync/u,
  marketplace: /MarketplaceService|PromptProductPurchase|ProcessReceipt|UserOwnsGamePassAsync/u,
  teleports: /TeleportService|Teleport|TeleportAsync/u,
  http: /HttpService|RequestAsync|GetAsync|PostAsync/u,
} as const;

type SensitiveApiName = keyof typeof SENSITIVE_PATTERNS;

interface BaselineSnapshot {
  timestamp: string;
  tree: InstanceNode;
  scripts: Record<string, string>;
  metadata: {
    instance_count: number;
    script_count: number;
  };
}

interface FlatNodeRecord {
  path: string;
  name: string;
  className: string;
  properties: Record<string, RobloxPropertyValue>;
  parentPath: string | null;
}

interface ScriptChange {
  path: string;
  line_delta: number;
  touches_sensitive_api: boolean;
  sensitive_apis: SensitiveApiName[];
}

interface InstanceChange {
  path: string;
  className: string;
}

interface ModifiedInstanceChange extends InstanceChange {
  changed_properties: string[];
}

interface MovedInstanceChange {
  from_path: string;
  to_path: string;
  className: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeValue(value: RobloxPropertyValue): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      const entry = value[key] as RobloxPropertyValue;
      normalized[key] = normalizeValue(entry);
    }
    return normalized;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeProperties(
  properties?: Record<string, RobloxPropertyValue>,
): Record<string, RobloxPropertyValue> {
  if (!properties) {
    return {};
  }
  return properties;
}

function flattenTree(node: InstanceNode, path = ""): Map<string, FlatNodeRecord> {
  const currentPath = path ? `${path}.${node.name}` : node.name;
  const parentPath = path.length > 0 ? path : null;
  const map = new Map<string, FlatNodeRecord>();
  map.set(currentPath, {
    path: currentPath,
    name: node.name,
    className: node.className,
    properties: normalizeProperties(node.properties),
    parentPath,
  });
  for (const child of node.children) {
    const childMap = flattenTree(child, currentPath);
    for (const [childPath, record] of childMap) {
      map.set(childPath, record);
    }
  }
  return map;
}

function countLines(source: string): number {
  if (source.length === 0) {
    return 0;
  }
  return source.split(/\r?\n/u).length;
}

function detectSensitiveApis(source: string): SensitiveApiName[] {
  const hits: SensitiveApiName[] = [];
  for (const [name, pattern] of Object.entries(SENSITIVE_PATTERNS) as Array<
    [SensitiveApiName, RegExp]
  >) {
    if (pattern.test(source)) {
      hits.push(name);
    }
  }
  return hits;
}

function isGuiClass(className: string): boolean {
  return GUI_CLASSES.has(className) || className.endsWith("Gui");
}

function diffProperties(
  baselineProperties: Record<string, RobloxPropertyValue>,
  currentProperties: Record<string, RobloxPropertyValue>,
): string[] {
  const keys = new Set([...Object.keys(baselineProperties), ...Object.keys(currentProperties)]);
  const changed: string[] = [];
  for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
    const before = stableStringify(normalizeValue(baselineProperties[key] ?? null));
    const after = stableStringify(normalizeValue(currentProperties[key] ?? null));
    if (before !== after) {
      changed.push(key);
    }
  }
  return changed;
}

function collectScripts(root: InstanceNode): Record<string, string> {
  const scripts: Record<string, string> = {};
  traverseInstances(root, (node, currentPath) => {
    const source = readScriptSource(node);
    if (source !== null) {
      scripts[currentPath] = source;
    }
  });
  return scripts;
}

async function hydrateProperties(
  client: StudioBridgeClient,
  node: InstanceNode,
  parentPath?: string,
): Promise<void> {
  const path = parentPath ? `${parentPath}.${node.name}` : node.name;
  if (!node.properties) {
    try {
      node.properties = await client.getProperties(path);
    } catch {
      node.properties = {};
    }
  }
  await Promise.all(node.children.map((child) => hydrateProperties(client, child, path)));
}

async function captureBaseline(client: StudioBridgeClient): Promise<BaselineSnapshot> {
  const tree = await client.getDataModel();
  await hydrateProperties(client, tree);
  const scripts = collectScripts(tree);
  let instanceCount = 0;
  traverseInstances(tree, () => {
    instanceCount += 1;
  });
  return {
    timestamp: new Date().toISOString(),
    tree,
    scripts,
    metadata: {
      instance_count: instanceCount,
      script_count: Object.keys(scripts).length,
    },
  };
}

function classifyRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 80) {
    return "critical";
  }
  if (score >= 60) {
    return "high";
  }
  if (score >= 30) {
    return "medium";
  }
  return "low";
}

function classifyVerdict(
  riskLevel: "low" | "medium" | "high" | "critical",
): "SAFE_TO_SHIP" | "REVIEW_RECOMMENDED" | "HIGH_RISK" {
  if (riskLevel === "high" || riskLevel === "critical") {
    return "HIGH_RISK";
  }
  if (riskLevel === "medium") {
    return "REVIEW_RECOMMENDED";
  }
  return "SAFE_TO_SHIP";
}

function getTopLevelName(path: string): string | null {
  const segments = path.split(".");
  return segments.length >= 2 ? (segments[1] ?? null) : null;
}

function getClassDistributionDelta(
  baselineMap: Map<string, FlatNodeRecord>,
  currentMap: Map<string, FlatNodeRecord>,
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const record of baselineMap.values()) {
    counts.set(record.className, (counts.get(record.className) ?? 0) - 1);
  }
  for (const record of currentMap.values()) {
    counts.set(record.className, (counts.get(record.className) ?? 0) + 1);
  }
  const delta: Record<string, number> = {};
  for (const [className, value] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (value !== 0) {
      delta[className] = value;
    }
  }
  return delta;
}

function buildMoveCandidates(
  records: InstanceChange[],
  flatMap: Map<string, FlatNodeRecord>,
): Map<string, InstanceChange[]> {
  const buckets = new Map<string, InstanceChange[]>();
  for (const record of records) {
    const flatRecord = flatMap.get(record.path);
    if (!flatRecord) {
      continue;
    }
    const key = `${flatRecord.className}:${flatRecord.name}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
  return buckets;
}

function detectMoves(
  added: InstanceChange[],
  removed: InstanceChange[],
  baselineMap: Map<string, FlatNodeRecord>,
  currentMap: Map<string, FlatNodeRecord>,
): {
  moved: MovedInstanceChange[];
  remainingAdded: InstanceChange[];
  remainingRemoved: InstanceChange[];
} {
  const addedBuckets = buildMoveCandidates(added, currentMap);
  const removedBuckets = buildMoveCandidates(removed, baselineMap);
  const moved: MovedInstanceChange[] = [];
  const addedMatched = new Set<string>();
  const removedMatched = new Set<string>();

  for (const [key, removedBucket] of removedBuckets) {
    const addedBucket = addedBuckets.get(key);
    if (!addedBucket || addedBucket.length === 0) {
      continue;
    }
    const removedSorted = [...removedBucket].sort((a, b) => a.path.localeCompare(b.path));
    const addedSorted = [...addedBucket].sort((a, b) => a.path.localeCompare(b.path));
    const pairCount = Math.min(removedSorted.length, addedSorted.length);
    for (let index = 0; index < pairCount; index += 1) {
      const from = removedSorted[index];
      const to = addedSorted[index];
      if (!from || !to) {
        continue;
      }
      removedMatched.add(from.path);
      addedMatched.add(to.path);
      moved.push({
        from_path: from.path,
        to_path: to.path,
        className: from.className,
      });
    }
  }

  return {
    moved: moved.sort((a, b) => a.from_path.localeCompare(b.from_path)),
    remainingAdded: added.filter((record) => !addedMatched.has(record.path)),
    remainingRemoved: removed.filter((record) => !removedMatched.has(record.path)),
  };
}

function recommendAudits(
  runTargetedAudits: boolean,
  scriptChanges: ScriptChange[],
  modified: ModifiedInstanceChange[],
  added: InstanceChange[],
  removed: InstanceChange[],
  moved: MovedInstanceChange[],
): string[] {
  if (!runTargetedAudits) {
    return [];
  }
  const recommendations = new Set<string>();
  const changedGui = [...modified, ...added, ...removed].some((change) =>
    isGuiClass(change.className),
  );
  const movedGui = moved.some((change) => isGuiClass(change.className));
  const sensitiveApis = new Set(scriptChanges.flatMap((change) => change.sensitive_apis));
  if (sensitiveApis.has("remotes")) {
    recommendations.add("rbx_remote_contract_audit");
  }
  if (sensitiveApis.has("datastores")) {
    recommendations.add("rbx_datastore_schema_guard");
  }
  if (changedGui || movedGui) {
    recommendations.add("rbx_validate_mobile_ui");
  }
  if (sensitiveApis.has("marketplace")) {
    recommendations.add("rbx_marketplace_compliance_audit");
  }
  if (sensitiveApis.has("teleports")) {
    recommendations.add("rbx_teleport_graph_audit");
  }
  return [...recommendations];
}

function scoreRisk(input: {
  added: InstanceChange[];
  removed: InstanceChange[];
  modified: ModifiedInstanceChange[];
  moved: MovedInstanceChange[];
  scriptChanges: ScriptChange[];
}): number {
  let score = 0;
  for (const change of input.scriptChanges) {
    score += 12;
    if (change.touches_sensitive_api) {
      score += 18;
    }
    if (change.sensitive_apis.includes("remotes") || change.sensitive_apis.includes("datastores")) {
      score += 8;
    }
  }
  for (const change of input.added) {
    if (SCRIPT_CLASSES.has(change.className)) {
      score += 10;
      continue;
    }
    if (isGuiClass(change.className)) {
      score += 6;
      continue;
    }
    score += 2;
  }
  for (const change of input.removed) {
    if (SCRIPT_CLASSES.has(change.className)) {
      score += 20;
      continue;
    }
    if (isGuiClass(change.className)) {
      score += 8;
      continue;
    }
    score += 3;
  }
  for (const change of input.modified) {
    if (SCRIPT_CLASSES.has(change.className)) {
      score += 10;
      continue;
    }
    if (isGuiClass(change.className)) {
      score += 7;
      continue;
    }
    score += 2;
  }
  score += input.moved.length * 4;
  return Math.min(100, score);
}

registerTool({
  name: "rbx_release_diff",
  description:
    "Compare the current project against a saved baseline snapshot, summarize changes, and recommend targeted release audits.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    await client.ping();

    const baseline = await captureBaseline(client);
    if (input.save_baseline) {
      if (input.output_path) {
        await writeFile(input.output_path, JSON.stringify(baseline, null, 2), "utf8");
      }
      return createResponseEnvelope(
        {
          mode: "baseline_saved" as const,
          timestamp: baseline.timestamp,
          metadata: baseline.metadata,
          ...(input.output_path ? { path: input.output_path } : {}),
        },
        {
          source: sourceInfo({
            studio_port: input.studio_port,
            ...(input.universe_id ? { universe_id: input.universe_id } : {}),
          }),
        },
      );
    }

    if (!input.baseline_path) {
      throw new Error("baseline_path is required unless save_baseline is true.");
    }

    const baselineRaw = await readFile(input.baseline_path, "utf8");
    const parsedBaseline = JSON.parse(baselineRaw) as BaselineSnapshot;
    const baselineMap = flattenTree(parsedBaseline.tree);
    const currentMap = flattenTree(baseline.tree);

    const added: InstanceChange[] = [];
    const removed: InstanceChange[] = [];
    const modified: ModifiedInstanceChange[] = [];

    for (const [path, currentRecord] of currentMap) {
      const baselineRecord = baselineMap.get(path);
      if (!baselineRecord) {
        added.push({ path, className: currentRecord.className });
        continue;
      }
      if (baselineRecord.className !== currentRecord.className) {
        removed.push({ path, className: baselineRecord.className });
        added.push({ path, className: currentRecord.className });
        continue;
      }
      const changedProperties = diffProperties(baselineRecord.properties, currentRecord.properties);
      if (changedProperties.length > 0) {
        modified.push({
          path,
          className: currentRecord.className,
          changed_properties: changedProperties,
        });
      }
    }

    for (const [path, baselineRecord] of baselineMap) {
      if (!currentMap.has(path)) {
        removed.push({ path, className: baselineRecord.className });
      }
    }

    const moveResult = detectMoves(added, removed, baselineMap, currentMap);

    const baselineScripts = parsedBaseline.scripts ?? {};
    const currentScripts = baseline.scripts;
    const scriptPaths = new Set([...Object.keys(baselineScripts), ...Object.keys(currentScripts)]);
    const scriptChanges: ScriptChange[] = [];
    for (const path of [...scriptPaths].sort((a, b) => a.localeCompare(b))) {
      const before = baselineScripts[path] ?? "";
      const after = currentScripts[path] ?? "";
      if (before === after) {
        continue;
      }
      const sensitiveApis = detectSensitiveApis(after || before);
      scriptChanges.push({
        path,
        line_delta: countLines(after) - countLines(before),
        touches_sensitive_api: sensitiveApis.length > 0,
        sensitive_apis: sensitiveApis,
      });
    }

    const topLevelBaseline = new Set(
      [...baselineMap.keys()]
        .map((path) => getTopLevelName(path))
        .filter((name): name is string => name !== null),
    );
    const topLevelCurrent = new Set(
      [...currentMap.keys()]
        .map((path) => getTopLevelName(path))
        .filter((name): name is string => name !== null),
    );
    const topLevelAdded = [...topLevelCurrent].filter((name) => !topLevelBaseline.has(name)).sort();
    const topLevelRemoved = [...topLevelBaseline]
      .filter((name) => !topLevelCurrent.has(name))
      .sort();
    const riskScore = scoreRisk({
      added: moveResult.remainingAdded,
      removed: moveResult.remainingRemoved,
      modified,
      moved: moveResult.moved,
      scriptChanges,
    });
    const riskLevel = classifyRiskLevel(riskScore);
    const recommendedAudits = recommendAudits(
      input.run_targeted_audits,
      scriptChanges,
      modified,
      moveResult.remainingAdded,
      moveResult.remainingRemoved,
      moveResult.moved,
    );

    const report = {
      mode: "diff" as const,
      baseline_timestamp: parsedBaseline.timestamp,
      current_timestamp: baseline.timestamp,
      summary: {
        instances_added: moveResult.remainingAdded.length,
        instances_removed: moveResult.remainingRemoved.length,
        instances_modified: modified.length,
        scripts_changed: scriptChanges.length,
        total_changes:
          moveResult.remainingAdded.length +
          moveResult.remainingRemoved.length +
          modified.length +
          moveResult.moved.length +
          scriptChanges.length,
        risk_score: riskScore,
        risk_level: riskLevel,
      },
      changes: {
        added: moveResult.remainingAdded,
        removed: moveResult.remainingRemoved,
        modified,
        moved: moveResult.moved,
        scripts_changed: scriptChanges,
      },
      structure: {
        top_level_added: topLevelAdded,
        top_level_removed: topLevelRemoved,
        class_distribution_delta: getClassDistributionDelta(baselineMap, currentMap),
      },
      recommended_audits: recommendedAudits,
      verdict: classifyVerdict(riskLevel),
      ...(input.output_path ? { report_path: input.output_path } : {}),
    };

    if (input.output_path) {
      await writeFile(input.output_path, JSON.stringify(report, null, 2), "utf8");
    }

    return createResponseEnvelope(report, {
      source: sourceInfo({
        studio_port: input.studio_port,
        ...(input.universe_id ? { universe_id: input.universe_id } : {}),
      }),
    });
  },
});

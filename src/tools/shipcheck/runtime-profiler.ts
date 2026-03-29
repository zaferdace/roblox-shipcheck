import { readFile } from "node:fs/promises";
import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import {
  createResponseEnvelope,
  readScriptSource,
  sourceInfo,
  traverseInstances,
} from "../../shared.js";
import type { InstanceNode } from "../../types/roblox.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  capture_duration_seconds: z.number().positive().max(300).default(10),
  include_memory: z.boolean().default(true),
  include_script_time: z.boolean().default(true),
  include_instance_count: z.boolean().default(true),
  baseline_file: z.string().min(1).optional(),
});

interface RuntimeHotspot {
  category: "instances" | "scripts" | "memory" | "physics" | "rendering";
  label: string;
  severity: "low" | "medium" | "high";
  metric: number;
  details: string;
}

interface RuntimeProfilerResult {
  summary: string;
  instance_counts: Record<string, number>;
  hotspots: RuntimeHotspot[];
  suggestions: string[];
  regression_warnings?: string[];
}

interface ScriptComplexityRecord {
  path: string;
  lineCount: number;
  maxIndent: number;
  connectionCount: number;
  complexityScore: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectInstanceCounts(root: InstanceNode): Record<string, number> {
  const counts: Record<string, number> = {};
  traverseInstances(root, (node) => {
    counts[node.className] = (counts[node.className] ?? 0) + 1;
  });
  return counts;
}

function analyzeScripts(root: InstanceNode): ScriptComplexityRecord[] {
  const scripts: ScriptComplexityRecord[] = [];
  traverseInstances(root, (node, currentPath) => {
    const source = readScriptSource(node);
    if (!source) {
      return;
    }
    const lines = source.split(/\r?\n/u);
    const maxIndent = lines.reduce((max, line) => {
      const indent = line.match(/^\s*/u)?.[0].length ?? 0;
      return Math.max(max, indent);
    }, 0);
    const connectionCount = (source.match(/:Connect\s*\(/gu) ?? []).length;
    const loopCount = (source.match(/\b(?:for|while|repeat)\b/gu) ?? []).length;
    const complexityScore = lines.length + maxIndent * 2 + connectionCount * 20 + loopCount * 10;
    scripts.push({
      path: currentPath,
      lineCount: lines.length,
      maxIndent,
      connectionCount,
      complexityScore,
    });
  });
  return scripts.sort((a, b) => b.complexityScore - a.complexityScore);
}

function estimateMemoryPressure(counts: Record<string, number>): number {
  const weights: Record<string, number> = {
    MeshPart: 4,
    Part: 1,
    Texture: 3,
    Decal: 2,
    ImageLabel: 2,
    ImageButton: 2,
    ParticleEmitter: 4,
    Trail: 3,
    Sound: 2,
    Beam: 3,
    PointLight: 1,
    SpotLight: 1,
    SurfaceLight: 1,
  };
  return Object.entries(counts).reduce(
    (sum, [className, count]) => sum + count * (weights[className] ?? 1),
    0,
  );
}

function collectPhysicsMetrics(root: InstanceNode): {
  unanchoredParts: number;
  constraints: number;
  collisionGroupAssignments: number;
} {
  let unanchoredParts = 0;
  let constraints = 0;
  let collisionGroupAssignments = 0;
  traverseInstances(root, (node) => {
    if (
      ["Part", "MeshPart", "UnionOperation", "BasePart"].includes(node.className) &&
      node.properties?.["Anchored"] === false
    ) {
      unanchoredParts += 1;
    }
    if (node.className.endsWith("Constraint")) {
      constraints += 1;
    }
    if (
      typeof node.properties?.["CollisionGroup"] === "string" ||
      typeof node.properties?.["CollisionGroupId"] === "number"
    ) {
      collisionGroupAssignments += 1;
    }
  });
  return { unanchoredParts, constraints, collisionGroupAssignments };
}

function buildHotspots(
  counts: Record<string, number>,
  scripts: ScriptComplexityRecord[],
  memoryPressure: number,
  physics: { unanchoredParts: number; constraints: number; collisionGroupAssignments: number },
  includeMemory: boolean,
  includeScriptTime: boolean,
): RuntimeHotspot[] {
  const hotspots: RuntimeHotspot[] = [];
  const topClasses = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [className, count] of topClasses) {
    hotspots.push({
      category: "instances",
      label: className,
      severity: count > 2000 ? "high" : count > 500 ? "medium" : "low",
      metric: count,
      details: `${count} instances of ${className} detected.`,
    });
  }
  if (includeScriptTime) {
    for (const script of scripts.slice(0, 5)) {
      hotspots.push({
        category: "scripts",
        label: script.path,
        severity:
          script.complexityScore > 1200 ? "high" : script.complexityScore > 400 ? "medium" : "low",
        metric: script.complexityScore,
        details: `${script.lineCount} lines, ${script.connectionCount} event connections, max indent ${script.maxIndent}.`,
      });
    }
  }
  if (includeMemory) {
    hotspots.push({
      category: "memory",
      label: "Estimated memory pressure",
      severity: memoryPressure > 10_000 ? "high" : memoryPressure > 4_000 ? "medium" : "low",
      metric: memoryPressure,
      details: "Heuristic score based on heavy instance classes and visual assets.",
    });
  }
  hotspots.push({
    category: "physics",
    label: "Unanchored parts",
    severity:
      physics.unanchoredParts > 500 ? "high" : physics.unanchoredParts > 100 ? "medium" : "low",
    metric: physics.unanchoredParts,
    details: `${physics.constraints} constraints, ${physics.collisionGroupAssignments} collision-group assignments.`,
  });
  const renderingCount =
    (counts["MeshPart"] ?? 0) +
    (counts["ParticleEmitter"] ?? 0) +
    (counts["Beam"] ?? 0) +
    (counts["PointLight"] ?? 0) +
    (counts["SpotLight"] ?? 0) +
    (counts["SurfaceLight"] ?? 0);
  hotspots.push({
    category: "rendering",
    label: "Rendering-heavy instances",
    severity: renderingCount > 2000 ? "high" : renderingCount > 500 ? "medium" : "low",
    metric: renderingCount,
    details: "Combined count of MeshParts, particles, beams, and lights.",
  });
  return hotspots.sort((a, b) => b.metric - a.metric);
}

function buildSuggestions(hotspots: RuntimeHotspot[]): string[] {
  const suggestions = new Set<string>();
  for (const hotspot of hotspots) {
    if (hotspot.category === "instances" && hotspot.severity !== "low") {
      suggestions.add(
        "Reduce repeated instance counts through instancing, streaming, or pooled objects.",
      );
    }
    if (hotspot.category === "scripts" && hotspot.severity !== "low") {
      suggestions.add("Split complex scripts and reduce hot-path event connections.");
    }
    if (hotspot.category === "memory" && hotspot.severity !== "low") {
      suggestions.add("Audit large visual assets and reuse textures or effects where possible.");
    }
    if (hotspot.category === "physics" && hotspot.severity !== "low") {
      suggestions.add("Anchor decorative parts and simplify physics interactions before release.");
    }
    if (hotspot.category === "rendering" && hotspot.severity !== "low") {
      suggestions.add(
        "Reduce MeshPart density and expensive particle or light usage in busy scenes.",
      );
    }
  }
  return [...suggestions];
}

async function readBaselineCounts(baselineFile: string): Promise<Record<string, number> | null> {
  try {
    const raw = await readFile(baselineFile, "utf8");
    const parsed = JSON.parse(raw) as { instance_counts?: Record<string, number> };
    return parsed.instance_counts ?? null;
  } catch {
    return null;
  }
}

function compareBaseline(
  baselineCounts: Record<string, number>,
  currentCounts: Record<string, number>,
): string[] {
  const warnings: string[] = [];
  for (const [className, currentCount] of Object.entries(currentCounts)) {
    const baselineCount = baselineCounts[className];
    if (baselineCount === undefined || baselineCount === 0) {
      continue;
    }
    const delta = ((currentCount - baselineCount) / baselineCount) * 100;
    if (delta > 10) {
      warnings.push(`${className} increased by ${Math.round(delta)}% versus baseline.`);
    }
  }
  return warnings;
}

export async function runRuntimeProfiler(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<RuntimeProfilerResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const baselineTree = await client.getDataModel();
  await sleep(input.capture_duration_seconds * 1000);
  const finalTree = await client.getDataModel();

  const baselineCounts = collectInstanceCounts(baselineTree);
  const instanceCounts = input.include_instance_count ? collectInstanceCounts(finalTree) : {};
  const scripts = analyzeScripts(finalTree);
  const memoryPressure = input.include_memory ? estimateMemoryPressure(instanceCounts) : 0;
  const physics = collectPhysicsMetrics(finalTree);
  const hotspots = buildHotspots(
    instanceCounts,
    scripts,
    memoryPressure,
    physics,
    input.include_memory,
    input.include_script_time,
  );
  const suggestions = buildSuggestions(hotspots);
  const regressionWarnings: string[] = [];
  for (const warning of compareBaseline(baselineCounts, instanceCounts)) {
    regressionWarnings.push(`Capture regression: ${warning}`);
  }
  if (input.baseline_file) {
    const fileBaseline = await readBaselineCounts(input.baseline_file);
    if (fileBaseline) {
      regressionWarnings.push(...compareBaseline(fileBaseline, instanceCounts));
    } else {
      regressionWarnings.push(`Unable to read baseline file "${input.baseline_file}".`);
    }
  }

  return createResponseEnvelope(
    {
      summary: `Captured ${hotspots.length} heuristic hotspots from two Studio snapshots over ${input.capture_duration_seconds} seconds.`,
      instance_counts: instanceCounts,
      hotspots,
      suggestions,
      ...(regressionWarnings.length > 0 ? { regression_warnings: regressionWarnings } : {}),
    },
    {
      source: sourceInfo({ studio_port: input.studio_port }),
      warnings: [
        "Runtime profiling uses DataModel snapshot heuristics because the current Studio bridge client does not expose CPU or memory counters.",
      ],
    },
  );
}

registerTool({
  name: "rbx_profile_runtime_hotspots",
  description:
    "Capture heuristic runtime hotspots from Roblox Studio snapshots and compare them to a baseline.",
  schema,
  handler: runRuntimeProfiler,
});

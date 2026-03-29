import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../../../shared.js";
import type { RobloxPropertyValue, StudioSearchMatch } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  min_spread_studs: z.number().min(1).default(30),
  check_team_balance: z.boolean().default(true),
});

interface SpawnClusteringIssue {
  severity: "warning" | "info";
  rule: "spawn_clustering" | "team_spawn_imbalance" | "suspicious_spawn_height";
  message: string;
  spawn_path?: string;
  confidence?: "heuristic";
}

interface SpawnClusteringResult {
  score: number;
  spawn_count: number;
  team_distribution: Record<string, number>;
  avg_spread_studs: number;
  issues: SpawnClusteringIssue[];
}

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

const searchMatchSchema = z.array(
  z.object({
    path: z.string(),
    className: z.string(),
    snippet: z.string(),
    matchType: z.enum(["name", "class", "property", "script_content"]),
  }),
);

function parseMatches(raw: unknown): StudioSearchMatch[] {
  return searchMatchSchema.safeParse(raw).data ?? [];
}

function getVector3(value: RobloxPropertyValue | undefined): Vector3Like | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const x = typeof value["x"] === "number" ? value["x"] : null;
  const y = typeof value["y"] === "number" ? value["y"] : null;
  const z = typeof value["z"] === "number" ? value["z"] : null;
  if (x === null || y === null || z === null) {
    return null;
  }
  return { x, y, z };
}

function stringifyProperty(value: RobloxPropertyValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return "Unknown";
}

function distance(a: Vector3Like, b: Vector3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export async function runSpawnClustering(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<SpawnClusteringResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const matches = parseMatches(
    await client.searchInstances({
      query: "SpawnLocation",
      search_type: "class",
      case_sensitive: false,
      max_results: 200,
    }),
  );

  const issues: SpawnClusteringIssue[] = [];
  const spawns: Array<{
    path: string;
    name: string;
    position: Vector3Like | null;
    teamColor: string;
    neutral: boolean;
  }> = [];

  for (const match of matches) {
    try {
      const properties = await client.getProperties(match.path);
      const position = getVector3(properties["Position"]);
      const teamColor = stringifyProperty(properties["TeamColor"]);
      const neutral = typeof properties["Neutral"] === "boolean" ? properties["Neutral"] : false;
      const name = typeof properties["Name"] === "string" ? properties["Name"] : match.path;
      spawns.push({ path: match.path, name, position, teamColor, neutral });

      if (position && (position.y < -10 || position.y > 1000)) {
        issues.push({
          severity: "info",
          rule: "suspicious_spawn_height",
          message: `${match.path} is placed at a suspicious height (${position.y}).`,
          spawn_path: match.path,
        });
      }
    } catch {
      continue;
    }
  }

  const positionedSpawns = spawns.filter((spawn) => spawn.position !== null);
  let totalDistance = 0;
  let pairCount = 0;
  for (let index = 0; index < positionedSpawns.length; index += 1) {
    const current = positionedSpawns[index]?.position;
    if (!current) {
      continue;
    }
    for (let otherIndex = index + 1; otherIndex < positionedSpawns.length; otherIndex += 1) {
      const other = positionedSpawns[otherIndex]?.position;
      if (!other) {
        continue;
      }
      totalDistance += distance(current, other);
      pairCount += 1;
    }
  }
  const avgSpread = pairCount === 0 ? 0 : Number((totalDistance / pairCount).toFixed(2));

  if (pairCount > 0 && avgSpread < input.min_spread_studs) {
    issues.push({
      severity: "warning",
      rule: "spawn_clustering",
      message: `Average spawn spread is ${avgSpread} studs, below the ${input.min_spread_studs} stud threshold.`,
      confidence: "heuristic",
    });
  }

  const teamDistribution: Record<string, number> = {};
  for (const spawn of spawns) {
    const key = spawn.neutral ? "Neutral" : spawn.teamColor;
    teamDistribution[key] = (teamDistribution[key] ?? 0) + 1;
  }

  if (input.check_team_balance) {
    const nonNeutralCounts = Object.entries(teamDistribution)
      .filter(([team]) => team !== "Neutral")
      .map(([, count]) => count)
      .filter((count) => count > 0);
    if (nonNeutralCounts.length >= 2) {
      const minCount = Math.min(...nonNeutralCounts);
      const maxCount = Math.max(...nonNeutralCounts);
      if (minCount > 0 && maxCount / minCount > 2) {
        issues.push({
          severity: "warning",
          rule: "team_spawn_imbalance",
          message: "Team-based spawn counts differ by more than 2x across teams.",
        });
      }
    }
  }

  return createResponseEnvelope(
    {
      score: Math.max(0, 100 - issues.length * 15),
      spawn_count: spawns.length,
      team_distribution: teamDistribution,
      avg_spread_studs: avgSpread,
      issues,
    },
    {
      source: sourceInfo({ studio_port: input.studio_port }),
    },
  );
}

registerTool({
  name: "rbx_shooter_spawn_clustering",
  description:
    "Analyze SpawnLocation distribution for clustering, team balance, and placement issues in shooter games.",
  schema,
  handler: runSpawnClustering,
});

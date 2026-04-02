import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo, traverseInstances } from "../../../../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  require_teams: z.boolean().default(false),
});

interface TeamInfrastructureIssue {
  severity: "low" | "medium" | "high";
  rule: "no_teams" | "unassigned_spawns" | "all_neutral" | "uneven_spawn_count";
  message: string;
  element_path?: string;
}

interface TeamInfo {
  path: string;
  name: string;
  auto_assignable: boolean | null;
  team_color: string;
}

interface SpawnInfo {
  path: string;
  name: string;
  neutral: boolean;
  team_color: string;
}

interface TeamInfrastructureResult {
  score: number;
  issues: TeamInfrastructureIssue[];
  teams: TeamInfo[];
  spawns: SpawnInfo[];
}

function renderColor(value: RobloxPropertyValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return "Unknown";
}

export async function runTeamInfrastructure(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<TeamInfrastructureResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = (await client.getChildren("game", 10)) as InstanceNode;

  let hasTeamsService = false;
  const teams: TeamInfo[] = [];
  const spawns: SpawnInfo[] = [];

  traverseInstances(root, (node, currentPath) => {
    if (node.className === "Teams") {
      hasTeamsService = true;
    }
    if (node.className === "Team") {
      const autoAssignable =
        typeof node.properties?.["AutoAssignable"] === "boolean"
          ? node.properties["AutoAssignable"]
          : null;
      teams.push({
        path: currentPath,
        name: node.name,
        auto_assignable: autoAssignable,
        team_color: renderColor(node.properties?.["TeamColor"]),
      });
    }
    if (node.className === "SpawnLocation") {
      const neutral =
        typeof node.properties?.["Neutral"] === "boolean" ? node.properties["Neutral"] : false;
      spawns.push({
        path: currentPath,
        name: node.name,
        neutral,
        team_color: renderColor(node.properties?.["TeamColor"]),
      });
    }
  });

  const issues: TeamInfrastructureIssue[] = [];
  if (input.require_teams && (!hasTeamsService || teams.length === 0)) {
    issues.push({
      severity: "medium",
      rule: "no_teams",
      message:
        "No Teams service or Team objects were found. FFA shooters are valid without teams, but this game has require_teams enabled.",
    });
  }

  const teamColorSet = new Set(teams.map((team) => team.team_color));
  for (const spawn of spawns) {
    if (!spawn.neutral && !teamColorSet.has(spawn.team_color)) {
      issues.push({
        severity: "high",
        rule: "unassigned_spawns",
        message: `${spawn.path} is non-neutral but its TeamColor does not match any Team object.`,
        element_path: spawn.path,
      });
    }
  }

  if (spawns.length > 0 && spawns.every((spawn) => spawn.neutral)) {
    issues.push({
      severity: "low",
      rule: "all_neutral",
      message: "All SpawnLocations are neutral, so teams may not get dedicated spawn infrastructure.",
    });
  }

  const spawnCountsByColor: Record<string, number> = {};
  for (const spawn of spawns) {
    if (spawn.neutral) {
      continue;
    }
    spawnCountsByColor[spawn.team_color] = (spawnCountsByColor[spawn.team_color] ?? 0) + 1;
  }
  const spawnCounts = Object.values(spawnCountsByColor);
  if (spawnCounts.length >= 2) {
    const minCount = Math.min(...spawnCounts);
    const maxCount = Math.max(...spawnCounts);
    if (maxCount - minCount > 1) {
      issues.push({
        severity: "low",
        rule: "uneven_spawn_count",
        message: "Spawn counts are uneven across team colors by more than one SpawnLocation.",
      });
    }
  }

  return createResponseEnvelope(
    {
      score: Math.max(0, 100 - issues.length * 15),
      issues,
      teams,
      spawns,
    },
    {
      source: sourceInfo({ studio_port: input.studio_port }),
    },
  );
}

registerTool({
  name: "rbx_shooter_team_infrastructure",
  description:
    "Validate Teams service setup, Team objects, and SpawnLocations for team-based shooter spawning infrastructure.",
  schema,
  handler: runTeamInfrastructure,
});

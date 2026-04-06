import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

interface AuditIssue {
  severity: "low" | "medium" | "high";
  type: "blocked" | "unreachable" | "no_path_found";
  from: string;
  to: string;
  message: string;
}

interface NavmeshAuditResult {
  routes_checked: number;
  passable: number;
  blocked: number;
  unreachable_objectives: string[];
  issues: AuditIssue[];
}

const schema = z.object({
  check_spawn_to_objectives: z.boolean().default(true),
  check_npc_patrols: z.boolean().default(true),
  max_checks: z.number().default(20),
  studio_port: z.number().int().positive().default(33796),
});

function buildNavmeshAuditLua(
  checkSpawnToObjectives: boolean,
  checkNpcPatrols: boolean,
  maxChecks: number,
): string {
  return `
local PathfindingService = game:GetService("PathfindingService")

local results = {
  routes_checked = 0,
  passable = 0,
  blocked = 0,
  unreachable_objectives = {},
  issues = {},
}

local function getPosition(instance)
  if instance:IsA("BasePart") then
    return instance.Position
  elseif instance.PrimaryPart then
    return instance.PrimaryPart.Position
  end
  return nil
end

local function checkPath(fromPos, toPos, fromLabel, toLabel)
  if results.routes_checked >= ${maxChecks} then return end
  results.routes_checked = results.routes_checked + 1

  local path = PathfindingService:CreatePath({
    AgentRadius = 2,
    AgentHeight = 5,
    AgentCanJump = true,
  })

  local success, err = pcall(function()
    path:ComputeAsync(fromPos, toPos)
  end)

  if not success or path.Status == Enum.PathStatus.NoPath then
    results.blocked = results.blocked + 1
    table.insert(results.issues, {
      severity = "high",
      type = "blocked",
      from = fromLabel,
      to = toLabel,
      message = "No valid path found between " .. fromLabel .. " and " .. toLabel,
    })
    return false
  end

  results.passable = results.passable + 1
  return true
end

-- Collect spawn locations
local spawns = {}
for _, v in ipairs(workspace:GetDescendants()) do
  if v:IsA("SpawnLocation") then
    table.insert(spawns, v)
  end
end

-- Collect objectives (tagged or named)
local objectives = {}
for _, v in ipairs(workspace:GetDescendants()) do
  local isTagged = false
  pcall(function()
    isTagged = game:GetService("CollectionService"):HasTag(v, "Objective")
  end)
  local name = v.Name:lower()
  if isTagged or name:find("objective") or name:find("goal") or name:find("checkpoint") then
    local pos = getPosition(v)
    if pos then
      table.insert(objectives, v)
    end
  end
end

-- Collect patrol points
local patrolPoints = {}
for _, v in ipairs(workspace:GetDescendants()) do
  local isTagged = false
  pcall(function()
    isTagged = game:GetService("CollectionService"):HasTag(v, "PatrolPoint")
  end)
  if isTagged or v.Name:lower():find("patrolpoint") or v.Name:lower():find("patrol_point") then
    local pos = getPosition(v)
    if pos then
      table.insert(patrolPoints, v)
    end
  end
end

${
  checkSpawnToObjectives
    ? `
-- Check spawn → objective routes
for _, spawn in ipairs(spawns) do
  local spawnPos = getPosition(spawn)
  if not spawnPos then continue end

  for _, obj in ipairs(objectives) do
    local objPos = getPosition(obj)
    if not objPos then continue end

    local reachable = checkPath(spawnPos, objPos, spawn.Name, obj.Name)
    if not reachable then
      table.insert(results.unreachable_objectives, obj.Name)
    end

    if results.routes_checked >= ${maxChecks} then break end
  end

  if results.routes_checked >= ${maxChecks} then break end
end
`
    : ""
}

${
  checkNpcPatrols
    ? `
-- Check patrol point connectivity
for i = 1, #patrolPoints - 1 do
  if results.routes_checked >= ${maxChecks} then break end
  local fromPos = getPosition(patrolPoints[i])
  local toPos = getPosition(patrolPoints[i + 1])
  if fromPos and toPos then
    local reachable = checkPath(fromPos, toPos, patrolPoints[i].Name, patrolPoints[i + 1].Name)
    if not reachable then
      table.insert(results.issues, {
        severity = "medium",
        type = "no_path_found",
        from = patrolPoints[i].Name,
        to = patrolPoints[i + 1].Name,
        message = "NPC patrol route blocked between consecutive patrol points",
      })
    end
  end
end
`
    : ""
}

-- Deduplicate unreachable objectives
local seen = {}
local unique = {}
for _, name in ipairs(results.unreachable_objectives) do
  if not seen[name] then
    seen[name] = true
    table.insert(unique, name)
  end
end
results.unreachable_objectives = unique

return results
`;
}

registerTool({
  name: "rbx_navmesh_path_audit",
  description:
    "Validate walkability, blocked routes, unreachable objectives, and NPC stuck zones using pathfinding analysis",
  schema,
  handler: async (input): Promise<ResponseEnvelope<NavmeshAuditResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });

    const code = buildNavmeshAuditLua(
      input.check_spawn_to_objectives,
      input.check_npc_patrols,
      input.max_checks,
    );

    const raw = (await client.executeCode(code, true)) as Record<string, unknown>;

    const issuesRaw = Array.isArray(raw["issues"]) ? raw["issues"] : [];
    const issues: AuditIssue[] = issuesRaw.map((item) => {
      const i = item as Record<string, unknown>;
      return {
        severity: (i["severity"] as AuditIssue["severity"]) ?? "low",
        type: (i["type"] as AuditIssue["type"]) ?? "no_path_found",
        from: String(i["from"] ?? ""),
        to: String(i["to"] ?? ""),
        message: String(i["message"] ?? ""),
      };
    });

    const unreachableRaw = Array.isArray(raw["unreachable_objectives"])
      ? raw["unreachable_objectives"]
      : [];

    const result: NavmeshAuditResult = {
      routes_checked: typeof raw["routes_checked"] === "number" ? raw["routes_checked"] : 0,
      passable: typeof raw["passable"] === "number" ? raw["passable"] : 0,
      blocked: typeof raw["blocked"] === "number" ? raw["blocked"] : 0,
      unreachable_objectives: unreachableRaw.map(String),
      issues,
    };

    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

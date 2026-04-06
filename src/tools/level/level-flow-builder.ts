import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, escapeLuaString, sourceInfo } from "../../shared.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  level_type: z.enum(["linear", "hub", "arena", "open_world"]).default("linear"),
  checkpoint_count: z.number().default(5),
  objective_count: z.number().default(3),
  include_gates: z.boolean().default(true),
  parent_path: z.string().default("Workspace"),
  studio_port: z.number().int().positive().default(33796),
});

interface LevelFlowResult {
  level_type: string;
  spawns: number;
  checkpoints: number;
  objectives: number;
  gates: number;
  total_parts_created: number;
}

function buildLinearScript(
  parent: string,
  checkpointCount: number,
  objectiveCount: number,
  includeGates: boolean,
): string {
  const safeParent = escapeLuaString(parent);
  return `
local parent = game:GetService("Workspace")
if "${safeParent}" ~= "Workspace" then
  parent = game:GetService("Workspace"):FindFirstChild("${safeParent}") or game:GetService("Workspace")
end

local totalParts = 0
local spacing = 40

-- Spawn
local spawn = Instance.new("SpawnLocation")
spawn.Name = "Spawn_Start"
spawn.Size = Vector3.new(6, 1, 6)
spawn.Position = Vector3.new(0, 1, 0)
spawn.BrickColor = BrickColor.new("Bright green")
spawn.Parent = parent
totalParts = totalParts + 1

-- Checkpoints
for i = 1, ${checkpointCount} do
  local cp = Instance.new("Part")
  cp.Name = "Checkpoint_" .. i
  cp.Size = Vector3.new(8, 2, 2)
  cp.Position = Vector3.new(0, 1, i * spacing)
  cp.BrickColor = BrickColor.new("Bright yellow")
  cp.Anchored = true
  cp.Parent = parent
  game:GetService("CollectionService"):AddTag(cp, "Checkpoint")
  totalParts = totalParts + 1

  -- Gate before checkpoint
  if ${includeGates ? "true" : "false"} and i > 1 then
    local gate = Instance.new("Part")
    gate.Name = "Gate_" .. i
    gate.Size = Vector3.new(8, 6, 1)
    gate.Position = Vector3.new(0, 3, i * spacing - spacing / 2)
    gate.BrickColor = BrickColor.new("Bright red")
    gate.Anchored = true
    gate.Transparency = 0.5
    gate.Parent = parent
    game:GetService("CollectionService"):AddTag(gate, "Gate")
    totalParts = totalParts + 1
  end
end

-- Objectives distributed along path
for i = 1, ${objectiveCount} do
  local obj = Instance.new("Part")
  obj.Name = "Objective_" .. i
  obj.Shape = Enum.PartType.Ball
  obj.Size = Vector3.new(4, 4, 4)
  local zPos = math.floor(i * ${checkpointCount} * spacing / (${objectiveCount} + 1))
  obj.Position = Vector3.new(15, 3, zPos)
  obj.BrickColor = BrickColor.new("Bright orange")
  obj.Anchored = true
  obj.Parent = parent
  game:GetService("CollectionService"):AddTag(obj, "Objective")
  totalParts = totalParts + 1
end

-- Finish
local finish = Instance.new("Part")
finish.Name = "Finish_Line"
finish.Size = Vector3.new(10, 4, 2)
finish.Position = Vector3.new(0, 2, (${checkpointCount} + 1) * spacing)
finish.BrickColor = BrickColor.new("Bright blue")
finish.Anchored = true
finish.Parent = parent
game:GetService("CollectionService"):AddTag(finish, "Finish")
totalParts = totalParts + 1

return { total_parts = totalParts }
`;
}

function buildHubScript(
  parent: string,
  objectiveCount: number,
  includeGates: boolean,
): string {
  const safeParent = escapeLuaString(parent);
  return `
local parent = game:GetService("Workspace")
if "${safeParent}" ~= "Workspace" then
  parent = game:GetService("Workspace"):FindFirstChild("${safeParent}") or game:GetService("Workspace")
end

local totalParts = 0
local radius = 60

-- Central spawn
local spawn = Instance.new("SpawnLocation")
spawn.Name = "Spawn_Hub"
spawn.Size = Vector3.new(10, 1, 10)
spawn.Position = Vector3.new(0, 1, 0)
spawn.BrickColor = BrickColor.new("Bright green")
spawn.Parent = parent
totalParts = totalParts + 1

-- Branching objectives around hub
for i = 1, ${objectiveCount} do
  local angle = (i - 1) * (2 * math.pi / ${objectiveCount})
  local x = math.cos(angle) * radius
  local z = math.sin(angle) * radius

  local obj = Instance.new("Part")
  obj.Name = "Objective_" .. i
  obj.Shape = Enum.PartType.Ball
  obj.Size = Vector3.new(5, 5, 5)
  obj.Position = Vector3.new(x, 3, z)
  obj.BrickColor = BrickColor.new("Bright orange")
  obj.Anchored = true
  obj.Parent = parent
  game:GetService("CollectionService"):AddTag(obj, "Objective")
  totalParts = totalParts + 1

  if ${includeGates ? "true" : "false"} then
    local gate = Instance.new("Part")
    gate.Name = "Gate_" .. i
    gate.Size = Vector3.new(8, 6, 1)
    gate.Position = Vector3.new(x * 0.6, 3, z * 0.6)
    gate.Orientation = Vector3.new(0, math.deg(angle) + 90, 0)
    gate.BrickColor = BrickColor.new("Bright red")
    gate.Anchored = true
    gate.Transparency = 0.5
    gate.Parent = parent
    game:GetService("CollectionService"):AddTag(gate, "Gate")
    totalParts = totalParts + 1
  end
end

return { total_parts = totalParts }
`;
}

function buildArenaScript(parent: string, checkpointCount: number): string {
  const safeParent = escapeLuaString(parent);
  return `
local parent = game:GetService("Workspace")
if "${safeParent}" ~= "Workspace" then
  parent = game:GetService("Workspace"):FindFirstChild("${safeParent}") or game:GetService("Workspace")
end

local totalParts = 0
local arenaRadius = 80
local spawns = ${checkpointCount}

-- Perimeter spawns
for i = 1, spawns do
  local angle = (i - 1) * (2 * math.pi / spawns)
  local x = math.cos(angle) * arenaRadius
  local z = math.sin(angle) * arenaRadius
  local spawn = Instance.new("SpawnLocation")
  spawn.Name = "Spawn_" .. i
  spawn.Size = Vector3.new(5, 1, 5)
  spawn.Position = Vector3.new(x, 1, z)
  spawn.BrickColor = BrickColor.new("Bright green")
  spawn.Parent = parent
  totalParts = totalParts + 1
end

-- Central objective
local center = Instance.new("Part")
center.Name = "Objective_Center"
center.Shape = Enum.PartType.Ball
center.Size = Vector3.new(6, 6, 6)
center.Position = Vector3.new(0, 4, 0)
center.BrickColor = BrickColor.new("Bright orange")
center.Anchored = true
center.Parent = parent
game:GetService("CollectionService"):AddTag(center, "Objective")
totalParts = totalParts + 1

-- Pickup spots
for i = 1, 4 do
  local angle = (i - 1) * math.pi / 2
  local pickup = Instance.new("Part")
  pickup.Name = "Pickup_" .. i
  pickup.Size = Vector3.new(3, 1, 3)
  pickup.Position = Vector3.new(math.cos(angle) * 30, 1, math.sin(angle) * 30)
  pickup.BrickColor = BrickColor.new("Bright yellow")
  pickup.Anchored = true
  pickup.Parent = parent
  game:GetService("CollectionService"):AddTag(pickup, "Pickup")
  totalParts = totalParts + 1
end

return { total_parts = totalParts }
`;
}

function buildOpenWorldScript(
  parent: string,
  objectiveCount: number,
  checkpointCount: number,
  includeGates: boolean,
): string {
  const safeParent = escapeLuaString(parent);
  return `
local parent = game:GetService("Workspace")
if "${safeParent}" ~= "Workspace" then
  parent = game:GetService("Workspace"):FindFirstChild("${safeParent}") or game:GetService("Workspace")
end

local totalParts = 0
math.randomseed(12345)

-- Central spawn
local spawn = Instance.new("SpawnLocation")
spawn.Name = "Spawn_Main"
spawn.Size = Vector3.new(8, 1, 8)
spawn.Position = Vector3.new(0, 1, 0)
spawn.BrickColor = BrickColor.new("Bright green")
spawn.Parent = parent
totalParts = totalParts + 1

-- Scattered POIs
for i = 1, ${objectiveCount} do
  local x = math.random(-200, 200)
  local z = math.random(-200, 200)
  local poi = Instance.new("Part")
  poi.Name = "POI_" .. i
  poi.Shape = Enum.PartType.Ball
  poi.Size = Vector3.new(5, 5, 5)
  poi.Position = Vector3.new(x, 4, z)
  poi.BrickColor = BrickColor.new("Bright orange")
  poi.Anchored = true
  poi.Parent = parent
  game:GetService("CollectionService"):AddTag(poi, "Objective")
  totalParts = totalParts + 1
end

-- Waypoint checkpoints
for i = 1, ${checkpointCount} do
  local x = math.random(-150, 150)
  local z = math.random(-150, 150)
  local wp = Instance.new("Part")
  wp.Name = "Waypoint_" .. i
  wp.Size = Vector3.new(6, 2, 6)
  wp.Position = Vector3.new(x, 1, z)
  wp.BrickColor = BrickColor.new("Bright yellow")
  wp.Anchored = true
  wp.Parent = parent
  game:GetService("CollectionService"):AddTag(wp, "Checkpoint")
  totalParts = totalParts + 1
end

if ${includeGates ? "true" : "false"} then
  for i = 1, 3 do
    local gate = Instance.new("Part")
    gate.Name = "RegionGate_" .. i
    gate.Size = Vector3.new(10, 8, 1)
    gate.Position = Vector3.new((i - 2) * 80, 4, (i - 2) * 80)
    gate.BrickColor = BrickColor.new("Bright red")
    gate.Anchored = true
    gate.Transparency = 0.5
    gate.Parent = parent
    game:GetService("CollectionService"):AddTag(gate, "Gate")
    totalParts = totalParts + 1
  end
end

return { total_parts = totalParts }
`;
}

registerTool({
  name: "rbx_level_flow_builder",
  description:
    "Generate spawn points, checkpoints, objective markers, gates, and reward placements for a level",
  schema,
  handler: async (input): Promise<ResponseEnvelope<LevelFlowResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });

    let script: string;
    let spawnsCount: number;
    let gatesCount: number;

    switch (input.level_type) {
      case "hub":
        script = buildHubScript(input.parent_path, input.objective_count, input.include_gates);
        spawnsCount = 1;
        gatesCount = input.include_gates ? input.objective_count : 0;
        break;
      case "arena":
        script = buildArenaScript(input.parent_path, input.checkpoint_count);
        spawnsCount = input.checkpoint_count;
        gatesCount = 0;
        break;
      case "open_world":
        script = buildOpenWorldScript(
          input.parent_path,
          input.objective_count,
          input.checkpoint_count,
          input.include_gates,
        );
        spawnsCount = 1;
        gatesCount = input.include_gates ? 3 : 0;
        break;
      default:
        script = buildLinearScript(
          input.parent_path,
          input.checkpoint_count,
          input.objective_count,
          input.include_gates,
        );
        spawnsCount = 1;
        gatesCount = input.include_gates ? Math.max(0, input.checkpoint_count - 1) : 0;
    }

    const raw = (await client.executeCode(script, true)) as { total_parts?: number };
    const totalParts = typeof raw.total_parts === "number" ? raw.total_parts : 0;

    return createResponseEnvelope(
      {
        level_type: input.level_type,
        spawns: spawnsCount,
        checkpoints: input.level_type === "arena" ? 0 : input.checkpoint_count,
        objectives: input.objective_count,
        gates: gatesCount,
        total_parts_created: totalParts,
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

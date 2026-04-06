import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, escapeLuaString, sourceInfo } from "../../shared.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  layout_type: z.enum(["tycoon_pad", "obby_sequence", "dungeon_rooms", "simulator_zone"]),
  count: z.number().min(1).max(50).default(10),
  spacing: z.number().default(20),
  difficulty_ramp: z.boolean().default(true),
  parent_path: z.string().default("Workspace"),
  studio_port: z.number().int().positive().default(33796),
});

interface ProceduralLayoutResult {
  layout_type: string;
  elements_created: number;
  total_parts: number;
  dimensions: { width: number; height: number; depth: number };
}

function buildTycoonPadScript(
  count: number,
  spacing: number,
  difficultyRamp: boolean,
  parent: string,
): string {
  const safeParent = escapeLuaString(parent);
  return `
local parent = game:GetService("Workspace")
if "${safeParent}" ~= "Workspace" then
  parent = game:GetService("Workspace"):FindFirstChild("${safeParent}") or game:GetService("Workspace")
end

local totalParts = 0
local elements = 0

for i = 1, ${count} do
  local xOffset = (i - 1) * ${spacing} * 3
  local ramp = ${difficultyRamp ? "true" : "false"}
  local tier = ramp and math.ceil(i / math.max(1, ${count} / 3)) or 1

  -- Base pad
  local pad = Instance.new("Model")
  pad.Name = "TycoonPad_" .. i
  pad.Parent = parent

  local base = Instance.new("Part")
  base.Name = "Base"
  base.Size = Vector3.new(${spacing} * 2.5, 1, ${spacing} * 2.5)
  base.Position = Vector3.new(xOffset + ${spacing} * 1.25, 0.5, ${spacing} * 1.25)
  base.BrickColor = BrickColor.new("Medium stone grey")
  base.Anchored = true
  base.Parent = pad
  totalParts = totalParts + 1

  -- Dropper
  local dropper = Instance.new("Part")
  dropper.Name = "Dropper"
  dropper.Size = Vector3.new(4, 4, 4)
  dropper.Position = Vector3.new(xOffset + 4, 5, 4)
  dropper.BrickColor = BrickColor.new("Bright blue")
  dropper.Anchored = true
  dropper.Parent = pad
  totalParts = totalParts + 1

  -- Conveyor
  local conveyor = Instance.new("Part")
  conveyor.Name = "Conveyor"
  conveyor.Size = Vector3.new(3, 0.5, ${spacing} * 1.5)
  conveyor.Position = Vector3.new(xOffset + 4, 2, ${spacing} * 0.75 + 4)
  conveyor.BrickColor = BrickColor.new("Dark grey")
  conveyor.Anchored = true
  conveyor.Parent = pad
  totalParts = totalParts + 1

  -- Collector
  local collector = Instance.new("Part")
  collector.Name = "Collector"
  collector.Size = Vector3.new(6, 4, 6)
  collector.Position = Vector3.new(xOffset + 4, 2, ${spacing} * 1.5 + 4)
  collector.BrickColor = BrickColor.new("Bright green")
  collector.Anchored = true
  collector.Parent = pad
  totalParts = totalParts + 1

  -- Upgrade button (higher tier = more upgrade slots)
  for u = 1, tier do
    local btn = Instance.new("Part")
    btn.Name = "UpgradeButton_" .. u
    btn.Size = Vector3.new(3, 0.5, 3)
    btn.Position = Vector3.new(xOffset + 10 + (u - 1) * 4, 1, 4)
    btn.BrickColor = BrickColor.new("Bright yellow")
    btn.Anchored = true
    btn.Parent = pad
    game:GetService("CollectionService"):AddTag(btn, "UpgradeButton")
    totalParts = totalParts + 1
  end

  elements = elements + 1
end

return { elements = elements, total_parts = totalParts }
`;
}

function buildObbySequenceScript(
  count: number,
  spacing: number,
  difficultyRamp: boolean,
  parent: string,
): string {
  const safeParent = escapeLuaString(parent);
  return `
local parent = game:GetService("Workspace")
if "${safeParent}" ~= "Workspace" then
  parent = game:GetService("Workspace"):FindFirstChild("${safeParent}") or game:GetService("Workspace")
end

local totalParts = 0
local elements = 0
local ramp = ${difficultyRamp ? "true" : "false"}
local prevZ = 0

-- Start platform
local start = Instance.new("Part")
start.Name = "Obby_Start"
start.Size = Vector3.new(10, 1, 10)
start.Position = Vector3.new(0, 1, 0)
start.BrickColor = BrickColor.new("Bright green")
start.Anchored = true
start.Parent = parent
totalParts = totalParts + 1
prevZ = 10

for i = 1, ${count} do
  local difficulty = ramp and (i / ${count}) or 0.5
  local gap = 4 + difficulty * 6
  local heightVar = ramp and (difficulty * 8) or 2
  local platformSize = math.max(2, 8 - difficulty * 4)

  local z = prevZ + gap + ${spacing}
  local y = 1 + math.random() * heightVar

  local platform = Instance.new("Part")
  platform.Name = "Platform_" .. i
  platform.Size = Vector3.new(platformSize, 1, platformSize)
  platform.Position = Vector3.new(math.random(-4, 4), y, z)
  platform.BrickColor = i % 3 == 0
    and BrickColor.new("Bright red")
    or BrickColor.new("Medium stone grey")
  platform.Anchored = true
  platform.Parent = parent
  totalParts = totalParts + 1

  -- Obstacle on harder platforms
  if ramp and difficulty > 0.5 and i % 2 == 0 then
    local obstacle = Instance.new("Part")
    obstacle.Name = "Obstacle_" .. i
    obstacle.Size = Vector3.new(platformSize, 3, 1)
    obstacle.Position = Vector3.new(platform.Position.X, y + 2, z)
    obstacle.BrickColor = BrickColor.new("Bright orange")
    obstacle.Anchored = true
    obstacle.Parent = parent
    game:GetService("CollectionService"):AddTag(obstacle, "Obstacle")
    totalParts = totalParts + 1
  end

  prevZ = z + platformSize
  elements = elements + 1
end

-- Finish platform
local finish = Instance.new("Part")
finish.Name = "Obby_Finish"
finish.Size = Vector3.new(10, 1, 10)
finish.Position = Vector3.new(0, 1 + (ramp and 8 or 1), prevZ + ${spacing})
finish.BrickColor = BrickColor.new("Bright blue")
finish.Anchored = true
finish.Parent = parent
totalParts = totalParts + 1

return { elements = elements, total_parts = totalParts }
`;
}

function buildDungeonRoomsScript(
  count: number,
  spacing: number,
  difficultyRamp: boolean,
  parent: string,
): string {
  const safeParent = escapeLuaString(parent);
  return `
local parent = game:GetService("Workspace")
if "${safeParent}" ~= "Workspace" then
  parent = game:GetService("Workspace"):FindFirstChild("${safeParent}") or game:GetService("Workspace")
end

local totalParts = 0
local elements = 0
local ramp = ${difficultyRamp ? "true" : "false"}

for i = 1, ${count} do
  local difficulty = ramp and (i / ${count}) or 0.5
  local roomW = math.max(16, 30 - difficulty * 14)
  local roomD = math.max(16, 30 - difficulty * 14)
  local roomH = 10
  local xOff = (i - 1) * (${spacing} + 30)

  local room = Instance.new("Model")
  room.Name = "DungeonRoom_" .. i
  room.Parent = parent

  -- Floor
  local floor = Instance.new("Part")
  floor.Name = "Floor"
  floor.Size = Vector3.new(roomW, 1, roomD)
  floor.Position = Vector3.new(xOff + roomW / 2, 0.5, roomD / 2)
  floor.BrickColor = BrickColor.new("Dark grey")
  floor.Anchored = true
  floor.Parent = room
  totalParts = totalParts + 1

  -- Ceiling
  local ceiling = Instance.new("Part")
  ceiling.Name = "Ceiling"
  ceiling.Size = Vector3.new(roomW, 1, roomD)
  ceiling.Position = Vector3.new(xOff + roomW / 2, roomH + 0.5, roomD / 2)
  ceiling.BrickColor = BrickColor.new("Dark grey")
  ceiling.Anchored = true
  ceiling.Parent = room
  totalParts = totalParts + 1

  -- Walls (4 sides)
  local wallDefs = {
    { size = Vector3.new(1, roomH, roomD), pos = Vector3.new(xOff, roomH / 2, roomD / 2) },
    { size = Vector3.new(1, roomH, roomD), pos = Vector3.new(xOff + roomW, roomH / 2, roomD / 2) },
    { size = Vector3.new(roomW, roomH, 1), pos = Vector3.new(xOff + roomW / 2, roomH / 2, 0) },
    { size = Vector3.new(roomW, roomH, 1), pos = Vector3.new(xOff + roomW / 2, roomH / 2, roomD) },
  }
  for _, def in ipairs(wallDefs) do
    local wall = Instance.new("Part")
    wall.Name = "Wall"
    wall.Size = def.size
    wall.Position = def.pos
    wall.BrickColor = BrickColor.new("Medium stone grey")
    wall.Anchored = true
    wall.Parent = room
    totalParts = totalParts + 1
  end

  -- Door to next room
  if i < ${count} then
    local door = Instance.new("Part")
    door.Name = "Door_Next"
    door.Size = Vector3.new(4, 6, 1)
    door.Position = Vector3.new(xOff + roomW, roomH / 2, roomD / 2)
    door.BrickColor = BrickColor.new("Bright brown")
    door.Anchored = true
    door.Transparency = 0.3
    door.Parent = room
    game:GetService("CollectionService"):AddTag(door, "Door")
    totalParts = totalParts + 1
  end

  -- Spawn in first room
  if i == 1 then
    local spawn = Instance.new("SpawnLocation")
    spawn.Name = "Dungeon_Spawn"
    spawn.Size = Vector3.new(4, 1, 4)
    spawn.Position = Vector3.new(xOff + 5, 1, roomD / 2)
    spawn.BrickColor = BrickColor.new("Bright green")
    spawn.Parent = room
    totalParts = totalParts + 1
  end

  -- Boss chest in last room
  if i == ${count} then
    local chest = Instance.new("Part")
    chest.Name = "BossChest"
    chest.Size = Vector3.new(3, 2, 2)
    chest.Position = Vector3.new(xOff + roomW - 5, 1.5, roomD / 2)
    chest.BrickColor = BrickColor.new("Bright yellow")
    chest.Anchored = true
    chest.Parent = room
    game:GetService("CollectionService"):AddTag(chest, "Reward")
    totalParts = totalParts + 1
  end

  elements = elements + 1
end

return { elements = elements, total_parts = totalParts }
`;
}

function buildSimulatorZoneScript(
  count: number,
  spacing: number,
  difficultyRamp: boolean,
  parent: string,
): string {
  const safeParent = escapeLuaString(parent);
  return `
local parent = game:GetService("Workspace")
if "${safeParent}" ~= "Workspace" then
  parent = game:GetService("Workspace"):FindFirstChild("${safeParent}") or game:GetService("Workspace")
end

local totalParts = 0
local elements = 0
local ramp = ${difficultyRamp ? "true" : "false"}

for i = 1, ${count} do
  local difficulty = ramp and (i / ${count}) or 0.5
  local zoneSize = 20 + difficulty * 20
  local nodeCount = math.floor(3 + difficulty * 5)
  local xOff = (i - 1) * (${spacing} + zoneSize)

  local zone = Instance.new("Model")
  zone.Name = "SimZone_" .. i
  zone.Parent = parent

  -- Zone base
  local base = Instance.new("Part")
  base.Name = "ZoneBase"
  base.Size = Vector3.new(zoneSize, 0.5, zoneSize)
  base.Position = Vector3.new(xOff + zoneSize / 2, 0.25, zoneSize / 2)
  base.BrickColor = BrickColor.new("Bright green")
  base.Anchored = true
  base.Parent = zone
  totalParts = totalParts + 1

  -- Zone boundary marker
  local marker = Instance.new("Part")
  marker.Name = "ZoneMarker"
  marker.Size = Vector3.new(zoneSize + 2, 8, zoneSize + 2)
  marker.Position = Vector3.new(xOff + zoneSize / 2, 4, zoneSize / 2)
  marker.BrickColor = BrickColor.new("Bright blue")
  marker.Anchored = true
  marker.Transparency = 0.85
  marker.CanCollide = false
  marker.Parent = zone
  game:GetService("CollectionService"):AddTag(marker, "ZoneBoundary")
  totalParts = totalParts + 1

  -- Spawning nodes within the zone
  for n = 1, nodeCount do
    local nx = xOff + math.random(2, math.floor(zoneSize - 2))
    local nz = math.random(2, math.floor(zoneSize - 2))
    local node = Instance.new("Part")
    node.Name = "SpawnNode_" .. n
    node.Size = Vector3.new(2, 2, 2)
    node.Position = Vector3.new(nx, 2, nz)
    node.BrickColor = BrickColor.new("Bright orange")
    node.Anchored = true
    node.Parent = zone
    game:GetService("CollectionService"):AddTag(node, "SpawnNode")
    totalParts = totalParts + 1
  end

  -- Collection area
  local collector = Instance.new("Part")
  collector.Name = "CollectionArea"
  collector.Size = Vector3.new(5, 0.5, 5)
  collector.Position = Vector3.new(xOff + zoneSize / 2, 0.75, zoneSize / 2)
  collector.BrickColor = BrickColor.new("Bright yellow")
  collector.Anchored = true
  collector.Parent = zone
  game:GetService("CollectionService"):AddTag(collector, "CollectionArea")
  totalParts = totalParts + 1

  elements = elements + 1
end

return { elements = elements, total_parts = totalParts }
`;
}

registerTool({
  name: "rbx_procedural_layout",
  description:
    "Generate tycoon pads, obby sequences, dungeon rooms, or simulator zones from parameterized templates",
  schema,
  handler: async (input): Promise<ResponseEnvelope<ProceduralLayoutResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });

    let script: string;

    switch (input.layout_type) {
      case "tycoon_pad":
        script = buildTycoonPadScript(
          input.count,
          input.spacing,
          input.difficulty_ramp,
          input.parent_path,
        );
        break;
      case "obby_sequence":
        script = buildObbySequenceScript(
          input.count,
          input.spacing,
          input.difficulty_ramp,
          input.parent_path,
        );
        break;
      case "dungeon_rooms":
        script = buildDungeonRoomsScript(
          input.count,
          input.spacing,
          input.difficulty_ramp,
          input.parent_path,
        );
        break;
      default:
        script = buildSimulatorZoneScript(
          input.count,
          input.spacing,
          input.difficulty_ramp,
          input.parent_path,
        );
    }

    const raw = (await client.executeCode(script, true)) as {
      elements?: number;
      total_parts?: number;
    };

    const elementsCreated = typeof raw.elements === "number" ? raw.elements : input.count;
    const totalParts = typeof raw.total_parts === "number" ? raw.total_parts : 0;

    const extentPerElement = input.spacing + 30;
    const totalLength = elementsCreated * extentPerElement;

    return createResponseEnvelope(
      {
        layout_type: input.layout_type,
        elements_created: elementsCreated,
        total_parts: totalParts,
        dimensions: {
          width: input.layout_type === "tycoon_pad" ? totalLength : 50,
          height: input.layout_type === "obby_sequence" ? 30 : 15,
          depth: input.layout_type === "tycoon_pad" ? 50 : totalLength,
        },
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, escapeLuaString, sourceInfo } from "../../shared.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

interface NpcBuildResult {
  npc_path: string;
  behavior_states: string[];
  has_dialogue: boolean;
  has_interaction: boolean;
}

const schema = z.object({
  npc_name: z.string().min(1),
  npc_type: z.enum(["humanoid", "custom_model"]).default("humanoid"),
  behavior: z
    .object({
      idle: z.boolean().default(true),
      patrol: z.boolean().default(false),
      chase: z.boolean().default(false),
      interact: z.boolean().default(true),
    })
    .optional(),
  dialogue: z.array(z.string()).optional(),
  spawn_position: z
    .object({ x: z.number(), y: z.number(), z: z.number() })
    .optional(),
  parent_path: z.string().default("Workspace"),
  studio_port: z.number().int().positive().default(33796),
});

const BEHAVIOR_STATE_MACHINE_SOURCE = `-- NPC Behavior State Machine
local NpcBehavior = {}

NpcBehavior.States = {
  IDLE = "idle",
  PATROL = "patrol",
  CHASE = "chase",
  INTERACT = "interact",
}

function NpcBehavior.new(npc)
  local self = setmetatable({}, { __index = NpcBehavior })
  self.npc = npc
  self.currentState = NpcBehavior.States.IDLE
  self.target = nil
  self.patrolPoints = {}
  self.patrolIndex = 1
  return self
end

function NpcBehavior:transition(newState)
  self.currentState = newState
end

function NpcBehavior:update()
  if self.currentState == NpcBehavior.States.IDLE then
    self:onIdle()
  elseif self.currentState == NpcBehavior.States.PATROL then
    self:onPatrol()
  elseif self.currentState == NpcBehavior.States.CHASE then
    self:onChase()
  elseif self.currentState == NpcBehavior.States.INTERACT then
    self:onInteract()
  end
end

function NpcBehavior:onIdle()
  -- Stand still; detect players nearby to transition states
end

function NpcBehavior:onPatrol()
  -- Move between patrol points
  if #self.patrolPoints == 0 then return end
  local target = self.patrolPoints[self.patrolIndex]
  local humanoid = self.npc:FindFirstChildOfClass("Humanoid")
  if humanoid then
    humanoid:MoveTo(target)
  end
end

function NpcBehavior:onChase()
  -- Move toward chase target
  if not self.target then
    self:transition(NpcBehavior.States.IDLE)
    return
  end
  local humanoid = self.npc:FindFirstChildOfClass("Humanoid")
  if humanoid and self.target.PrimaryPart then
    humanoid:MoveTo(self.target.PrimaryPart.Position)
  end
end

function NpcBehavior:onInteract()
  -- Wait for interaction to complete
end

return NpcBehavior
`;

const DIALOGUE_HANDLER_SOURCE = `-- NPC Dialogue Handler
local DialogueHandler = {}

local dialogueLines = DIALOGUE_PLACEHOLDER

local currentLine = 1

function DialogueHandler.getNextLine()
  local line = dialogueLines[currentLine]
  currentLine = currentLine % #dialogueLines + 1
  return line
end

function DialogueHandler.reset()
  currentLine = 1
end

return DialogueHandler
`;

const AI_LOOP_SOURCE = `-- NPC AI Loop (Server Script)
local npc = script.Parent
local BehaviorModule = require(npc:FindFirstChild("NpcBehavior"))
local behavior = BehaviorModule.new(npc)

local patrolPoints = workspace:FindFirstChild("PatrolPoints")
if patrolPoints then
  for _, point in ipairs(patrolPoints:GetChildren()) do
    table.insert(behavior.patrolPoints, point.Position)
  end
end

local DETECT_RADIUS = 30
local UPDATE_RATE = 0.5

while true do
  task.wait(UPDATE_RATE)

  local rootPart = npc:FindFirstChild("HumanoidRootPart")
  if not rootPart then continue end

  local nearestPlayer = nil
  local nearestDist = DETECT_RADIUS

  for _, player in ipairs(game.Players:GetPlayers()) do
    local char = player.Character
    if char and char.PrimaryPart then
      local dist = (char.PrimaryPart.Position - rootPart.Position).Magnitude
      if dist < nearestDist then
        nearestDist = dist
        nearestPlayer = char
      end
    end
  end

  if nearestPlayer then
    behavior.target = nearestPlayer
    if behavior.currentState ~= "chase" and behavior.currentState ~= "interact" then
      behavior:transition(BehaviorModule.States.CHASE)
    end
  else
    behavior.target = nil
    if behavior.currentState == "chase" then
      if #behavior.patrolPoints > 0 then
        behavior:transition(BehaviorModule.States.PATROL)
      else
        behavior:transition(BehaviorModule.States.IDLE)
      end
    end
  end

  behavior:update()
end
`;

function buildNpcLua(
  npcName: string,
  npcType: string,
  parentPath: string,
  spawnPos: { x: number; y: number; z: number } | undefined,
  behaviorStates: string[],
  dialogue: string[] | undefined,
): string {
  const posX = spawnPos?.x ?? 0;
  const posY = spawnPos?.y ?? 5;
  const posZ = spawnPos?.z ?? 0;

  const dialogueJson = dialogue
    ? JSON.stringify(dialogue).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    : null;

  const dialogueSource = dialogue
    ? DIALOGUE_HANDLER_SOURCE.replace(
        "DIALOGUE_PLACEHOLDER",
        `{${dialogue.map((l) => `"${escapeLuaString(l)}"`).join(", ")}}`,
      )
    : null;

  const hasBehaviorScript = behaviorStates.length > 0;

  const safeParentPath = escapeLuaString(parentPath);
  const safeNpcName = escapeLuaString(npcName);

  return `
local function resolvePath(root, path)
  local node = root
  for part in path:gmatch("[^.]+") do
    local child = node:FindFirstChild(part)
    if not child then
      pcall(function() child = game:GetService(part) end)
    end
    if not child then return nil, path end
    node = child
  end
  return node
end

local parentInstance, err = resolvePath(game, "${safeParentPath}")
if not parentInstance then
  return '{"error":"parent path not found: ${safeParentPath}"}'
end

-- Create NPC Model
local npcModel = Instance.new("Model")
npcModel.Name = "${safeNpcName}"
npcModel.Parent = parentInstance

${
  npcType === "humanoid"
    ? `
-- Create R6 body parts
local hrp = Instance.new("Part")
hrp.Name = "HumanoidRootPart"
hrp.Size = Vector3.new(2, 2, 1)
hrp.Position = Vector3.new(${posX}, ${posY}, ${posZ})
hrp.Anchored = false
hrp.Transparency = 1
hrp.Parent = npcModel

local head = Instance.new("Part")
head.Name = "Head"
head.Size = Vector3.new(2, 1, 1)
head.Position = Vector3.new(${posX}, ${posY + 1.5}, ${posZ})
head.Parent = npcModel

local humanoid = Instance.new("Humanoid")
humanoid.Name = "Humanoid"
humanoid.Parent = npcModel

npcModel.PrimaryPart = hrp

local weld = Instance.new("WeldConstraint")
weld.Part0 = hrp
weld.Part1 = head
weld.Parent = hrp
`
    : `
-- Custom model placeholder: set PrimaryPart manually after importing
local rootPart = Instance.new("Part")
rootPart.Name = "HumanoidRootPart"
rootPart.Size = Vector3.new(2, 2, 1)
rootPart.Position = Vector3.new(${posX}, ${posY}, ${posZ})
rootPart.Transparency = 1
rootPart.Parent = npcModel
npcModel.PrimaryPart = rootPart
`
}

-- Create ProximityPrompt for interaction
local prompt = Instance.new("ProximityPrompt")
prompt.ActionText = "Talk"
prompt.ObjectText = "${safeNpcName}"
prompt.MaxActivationDistance = 10
prompt.Parent = npcModel:FindFirstChild("Head") or npcModel:FindFirstChild("HumanoidRootPart")

${
  hasBehaviorScript
    ? `
-- Create NpcBehavior ModuleScript
local behaviorModule = Instance.new("ModuleScript")
behaviorModule.Name = "NpcBehavior"
behaviorModule.Source = ${JSON.stringify(BEHAVIOR_STATE_MACHINE_SOURCE)}
behaviorModule.Parent = npcModel
`
    : ""
}

${
  dialogueSource
    ? `
-- Create Dialogue ModuleScript
local dialogueModule = Instance.new("ModuleScript")
dialogueModule.Name = "DialogueHandler"
dialogueModule.Source = ${JSON.stringify(dialogueSource)}
dialogueModule.Parent = npcModel
`
    : ""
}

${
  hasBehaviorScript
    ? `-- Create AI loop Script
local aiScript = Instance.new("Script")
aiScript.Name = "NpcAI"
aiScript.Source = ${JSON.stringify(AI_LOOP_SOURCE)}
aiScript.Parent = npcModel`
    : "-- No AI loop: all behavior flags disabled"
}

return {
  npc_path = "${safeParentPath}.${safeNpcName}",
  behavior_states = {${behaviorStates.map((s) => `"${escapeLuaString(s)}"`).join(", ")}},
  has_dialogue = ${dialogue && dialogue.length > 0 ? "true" : "false"},
  has_interaction = true,
}
`;
}

registerTool({
  name: "rbx_npc_builder",
  description:
    "Create an NPC with model, behavior states (idle/patrol/chase/interact), dialogue, and interaction prompts",
  schema,
  handler: async (input): Promise<ResponseEnvelope<NpcBuildResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });

    const behavior = input.behavior ?? {
      idle: true,
      patrol: false,
      chase: false,
      interact: true,
    };

    const behaviorStates: string[] = [];
    if (behavior.idle) behaviorStates.push("idle");
    if (behavior.patrol) behaviorStates.push("patrol");
    if (behavior.chase) behaviorStates.push("chase");
    if (behavior.interact) behaviorStates.push("interact");

    const code = buildNpcLua(
      input.npc_name,
      input.npc_type,
      input.parent_path,
      input.spawn_position,
      behaviorStates,
      input.dialogue,
    );

    await client.executeCode(code, true);

    const result: NpcBuildResult = {
      npc_path: `${input.parent_path}.${input.npc_name}`,
      behavior_states: behaviorStates,
      has_dialogue: (input.dialogue?.length ?? 0) > 0,
      has_interaction: true,
    };

    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

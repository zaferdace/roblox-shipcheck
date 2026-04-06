import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, escapeLuaString, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  prefab_type: z.enum(["chest", "door", "turret", "trap", "pickup", "checkpoint", "vendor", "portal"]),
  prefab_name: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
  parent_path: z.string().default("Workspace"),
  options: z.record(z.unknown()).optional(),
  studio_port: z.number().int().positive().default(33796),
});

type PrefabType = z.infer<typeof schema>["prefab_type"];

function buildPrefabLua(
  type: PrefabType,
  name: string,
  parentPath: string,
  pos: { x: number; y: number; z: number },
): string {
  const posStr = `Vector3.new(${pos.x}, ${pos.y}, ${pos.z})`;
  const safeName = escapeLuaString(name);
  const safeParentPath = escapeLuaString(parentPath);

  const templates: Record<PrefabType, string> = {
    chest: `
local parent = game:GetService("Workspace")
for _, seg in ipairs(string.split("${safeParentPath}", ".")) do
  if seg ~= "Workspace" and seg ~= "game" then parent = parent:FindFirstChild(seg) or parent end
end
local model = Instance.new("Model", parent)
model.Name = "${safeName}"
local part = Instance.new("Part", model)
part.Name = "ChestBody"
part.Size = Vector3.new(4, 3, 2)
part.Position = ${posStr}
part.Anchored = true
part.BrickColor = BrickColor.new("Bright yellow")
model.PrimaryPart = part
local click = Instance.new("ClickDetector", part)
click.MaxActivationDistance = 10
local script = Instance.new("Script", model)
script.Name = "ChestScript"
script.Source = [[
local click = script.Parent.ChestBody:FindFirstChild("ClickDetector")
local opened = false
click.MouseClick:Connect(function(player)
  if opened then return end
  opened = true
  -- reward logic here
  print(player.Name .. " opened the chest!")
end)
]]
return model.Name
`,
    door: `
local parent = game:GetService("Workspace")
for _, seg in ipairs(string.split("${safeParentPath}", ".")) do
  if seg ~= "Workspace" and seg ~= "game" then parent = parent:FindFirstChild(seg) or parent end
end
local model = Instance.new("Model", parent)
model.Name = "${safeName}"
local part = Instance.new("Part", model)
part.Name = "DoorFrame"
part.Size = Vector3.new(6, 8, 1)
part.Position = ${posStr}
part.Anchored = true
part.BrickColor = BrickColor.new("Brown")
model.PrimaryPart = part
local prompt = Instance.new("ProximityPrompt", part)
prompt.ActionText = "Open"
prompt.ObjectText = "Door"
prompt.MaxActivationDistance = 8
local script = Instance.new("Script", model)
script.Name = "DoorScript"
script.Source = [[
local TweenService = game:GetService("TweenService")
local door = script.Parent.DoorFrame
local prompt = door:FindFirstChild("ProximityPrompt")
local isOpen = false
local info = TweenInfo.new(0.5)
prompt.Triggered:Connect(function()
  isOpen = not isOpen
  local goal = { CFrame = door.CFrame * CFrame.new(isOpen and 4 or -4, 0, 0) }
  TweenService:Create(door, info, goal):Play()
  prompt.ActionText = isOpen and "Close" or "Open"
end)
]]
return model.Name
`,
    turret: `
local parent = game:GetService("Workspace")
for _, seg in ipairs(string.split("${safeParentPath}", ".")) do
  if seg ~= "Workspace" and seg ~= "game" then parent = parent:FindFirstChild(seg) or parent end
end
local model = Instance.new("Model", parent)
model.Name = "${safeName}"
local base = Instance.new("Part", model)
base.Name = "Base"
base.Size = Vector3.new(3, 1, 3)
base.Position = ${posStr}
base.Anchored = true
base.BrickColor = BrickColor.new("Dark stone grey")
local barrel = Instance.new("Part", model)
barrel.Name = "Barrel"
barrel.Size = Vector3.new(0.5, 0.5, 4)
barrel.Position = base.Position + Vector3.new(0, 1.5, 0)
barrel.Anchored = true
barrel.BrickColor = BrickColor.new("Black")
model.PrimaryPart = base
local script = Instance.new("Script", model)
script.Name = "TurretScript"
script.Source = [[
local turret = script.Parent
local barrel = turret.Barrel
local range = 50
local fireRate = 1
local damage = 10
while true do
  task.wait(fireRate)
  local nearest, dist = nil, range
  for _, player in ipairs(game:GetService("Players"):GetPlayers()) do
    local char = player.Character
    if char and char:FindFirstChild("HumanoidRootPart") then
      local d = (char.HumanoidRootPart.Position - barrel.Position).Magnitude
      if d < dist then nearest, dist = char, d end
    end
  end
  if nearest then
    barrel.CFrame = CFrame.lookAt(barrel.Position, nearest.HumanoidRootPart.Position)
    local projectile = Instance.new("Part", workspace)
    projectile.Size = Vector3.new(0.3, 0.3, 0.3)
    projectile.Position = barrel.Position + barrel.CFrame.LookVector * 2
    projectile.BrickColor = BrickColor.new("Bright red")
    local vel = Instance.new("LinearVelocity", projectile)
    vel.MaxForce = math.huge
    vel.VectorVelocity = barrel.CFrame.LookVector * 80
    local att = Instance.new("Attachment", projectile)
    vel.Attachment0 = att
    game:GetService("Debris"):AddItem(projectile, 3)
    projectile.Touched:Once(function(hit)
      local hum = hit.Parent:FindFirstChildOfClass("Humanoid")
      if hum then hum:TakeDamage(damage) end
      projectile:Destroy()
    end)
  end
end
]]
return model.Name
`,
    trap: `
local parent = game:GetService("Workspace")
for _, seg in ipairs(string.split("${safeParentPath}", ".")) do
  if seg ~= "Workspace" and seg ~= "game" then parent = parent:FindFirstChild(seg) or parent end
end
local part = Instance.new("Part", parent)
part.Name = "${safeName}"
part.Size = Vector3.new(4, 0.2, 4)
part.Position = ${posStr}
part.Anchored = true
part.BrickColor = BrickColor.new("Bright red")
part.Material = Enum.Material.Neon
part.Transparency = 0.5
local script = Instance.new("Script", part)
script.Name = "TrapScript"
script.Source = [[
local damage = 20
local cooldown = {}
script.Parent.Touched:Connect(function(hit)
  local hum = hit.Parent:FindFirstChildOfClass("Humanoid")
  local player = game:GetService("Players"):GetPlayerFromCharacter(hit.Parent)
  if hum and player and not cooldown[player] then
    cooldown[player] = true
    hum:TakeDamage(damage)
    task.delay(1, function() cooldown[player] = nil end)
  end
end)
]]
return part.Name
`,
    pickup: `
local parent = game:GetService("Workspace")
for _, seg in ipairs(string.split("${safeParentPath}", ".")) do
  if seg ~= "Workspace" and seg ~= "game" then parent = parent:FindFirstChild(seg) or parent end
end
local part = Instance.new("Part", parent)
part.Name = "${safeName}"
part.Size = Vector3.new(1.5, 1.5, 1.5)
part.Position = ${posStr}
part.Anchored = true
part.CanCollide = false
part.BrickColor = BrickColor.new("Bright blue")
part.Material = Enum.Material.Neon
local script = Instance.new("Script", part)
script.Name = "PickupScript"
script.Source = [[
local respawnTime = 10
local pickup = script.Parent
local active = true
pickup.Touched:Connect(function(hit)
  if not active then return end
  local player = game:GetService("Players"):GetPlayerFromCharacter(hit.Parent)
  if player then
    active = false
    pickup.Transparency = 1
    pickup.CanCollide = false
    -- collect logic here
    print(player.Name .. " collected " .. pickup.Name)
    task.delay(respawnTime, function()
      pickup.Transparency = 0
      pickup.CanCollide = false
      active = true
    end)
  end
end)
]]
return part.Name
`,
    checkpoint: `
local parent = game:GetService("Workspace")
for _, seg in ipairs(string.split("${safeParentPath}", ".")) do
  if seg ~= "Workspace" and seg ~= "game" then parent = parent:FindFirstChild(seg) or parent end
end
local spawn = Instance.new("SpawnLocation", parent)
spawn.Name = "${safeName}"
spawn.Size = Vector3.new(6, 1, 6)
spawn.Position = ${posStr}
spawn.Anchored = true
spawn.BrickColor = BrickColor.new("Bright green")
spawn.Neutral = false
spawn.AllowTeamChangeOnTouch = false
spawn.Duration = 0
local script = Instance.new("Script", spawn)
script.Name = "CheckpointScript"
script.Source = [[
local checkpoint = script.Parent
local saved = {}
checkpoint.Touched:Connect(function(hit)
  local player = game:GetService("Players"):GetPlayerFromCharacter(hit.Parent)
  if player and not saved[player.UserId] then
    saved[player.UserId] = true
    player.RespawnLocation = checkpoint
    print(player.Name .. " reached checkpoint: " .. checkpoint.Name)
  end
end)
]]
return spawn.Name
`,
    vendor: `
local parent = game:GetService("Workspace")
for _, seg in ipairs(string.split("${safeParentPath}", ".")) do
  if seg ~= "Workspace" and seg ~= "game" then parent = parent:FindFirstChild(seg) or parent end
end
local model = Instance.new("Model", parent)
model.Name = "${safeName}"
local body = Instance.new("Part", model)
body.Name = "VendorBody"
body.Size = Vector3.new(4, 5, 2)
body.Position = ${posStr}
body.Anchored = true
body.BrickColor = BrickColor.new("Medium blue")
model.PrimaryPart = body
local prompt = Instance.new("ProximityPrompt", body)
prompt.ActionText = "Shop"
prompt.ObjectText = "Vendor"
prompt.MaxActivationDistance = 8
local label = Instance.new("BillboardGui", body)
label.Size = UDim2.new(0, 200, 0, 50)
label.StudsOffset = Vector3.new(0, 3, 0)
local text = Instance.new("TextLabel", label)
text.Size = UDim2.new(1, 0, 1, 0)
text.Text = "${safeName}"
text.BackgroundTransparency = 1
text.TextColor3 = Color3.new(1, 1, 1)
text.TextScaled = true
local script = Instance.new("Script", model)
script.Name = "VendorScript"
script.Source = [[
local prompt = script.Parent.VendorBody:FindFirstChild("ProximityPrompt")
prompt.Triggered:Connect(function(player)
  -- open shop UI here
  print(player.Name .. " opened vendor: " .. script.Parent.Name)
end)
]]
return model.Name
`,
    portal: `
local parent = game:GetService("Workspace")
for _, seg in ipairs(string.split("${safeParentPath}", ".")) do
  if seg ~= "Workspace" and seg ~= "game" then parent = parent:FindFirstChild(seg) or parent end
end
local part = Instance.new("Part", parent)
part.Name = "${safeName}"
part.Size = Vector3.new(6, 8, 1)
part.Position = ${posStr}
part.Anchored = true
part.CanCollide = false
part.BrickColor = BrickColor.new("Cyan")
part.Material = Enum.Material.Neon
part.Transparency = 0.4
local script = Instance.new("Script", part)
script.Name = "PortalScript"
script.Source = [[
local TeleportService = game:GetService("TeleportService")
local Players = game:GetService("Players")
local portal = script.Parent
local targetPlaceId = 0 -- set this to your destination place ID
local cooldown = {}
portal.Touched:Connect(function(hit)
  local player = Players:GetPlayerFromCharacter(hit.Parent)
  if player and not cooldown[player] then
    cooldown[player] = true
    if targetPlaceId ~= 0 then
      TeleportService:TeleportAsync(targetPlaceId, {player})
    else
      print(player.Name .. " touched portal: " .. portal.Name .. " (no targetPlaceId set)")
    end
    task.delay(3, function() cooldown[player] = nil end)
  end
end)
]]
return part.Name
`,
  };

  return templates[type];
}

registerTool({
  name: "rbx_prefab_builder",
  description:
    "Create reusable gameplay prefabs: chest, door, turret, trap, pickup, checkpoint, vendor, portal",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });

    const name = input.prefab_name ?? `${input.prefab_type.charAt(0).toUpperCase()}${input.prefab_type.slice(1)}_Prefab`;
    const pos = input.position ?? { x: 0, y: 5, z: 0 };

    const lua = buildPrefabLua(input.prefab_type, name, input.parent_path, pos);
    const result = await client.executeCode(lua, true);

    const componentMap: Record<PrefabType, string[]> = {
      chest: ["Part (ChestBody)", "ClickDetector", "Script (ChestScript)"],
      door: ["Part (DoorFrame)", "ProximityPrompt", "Script (DoorScript)"],
      turret: ["Part (Base)", "Part (Barrel)", "Script (TurretScript)"],
      trap: ["Part", "Script (TrapScript)"],
      pickup: ["Part", "Script (PickupScript)"],
      checkpoint: ["SpawnLocation", "Script (CheckpointScript)"],
      vendor: ["Part (VendorBody)", "ProximityPrompt", "BillboardGui", "Script (VendorScript)"],
      portal: ["Part", "Script (PortalScript)"],
    };

    return createResponseEnvelope(
      {
        prefab_path: `${input.parent_path}.${name}`,
        prefab_type: input.prefab_type,
        components_created: componentMap[input.prefab_type],
        studio_result: result,
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

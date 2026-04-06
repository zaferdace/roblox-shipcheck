import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const TEMPLATES: Record<string, { source: string; api: string[] }> = {
  inventory: {
    api: ["add", "remove", "has", "getAll", "getCount"],
    source: `local Inventory = {}
Inventory.__index = Inventory

function Inventory.new()
  local self = setmetatable({}, Inventory)
  self._items = {}
  return self
end

function Inventory:add(itemId, quantity)
  quantity = quantity or 1
  self._items[itemId] = (self._items[itemId] or 0) + quantity
  return self._items[itemId]
end

function Inventory:remove(itemId, quantity)
  quantity = quantity or 1
  if not self:has(itemId, quantity) then
    return false, "Not enough items"
  end
  self._items[itemId] = self._items[itemId] - quantity
  if self._items[itemId] <= 0 then
    self._items[itemId] = nil
  end
  return true
end

function Inventory:has(itemId, quantity)
  quantity = quantity or 1
  return (self._items[itemId] or 0) >= quantity
end

function Inventory:getAll()
  local result = {}
  for id, count in pairs(self._items) do
    result[id] = count
  end
  return result
end

function Inventory:getCount(itemId)
  return self._items[itemId] or 0
end

return Inventory`,
  },
  shop: {
    api: ["getProducts", "getProduct", "purchase", "canAfford"],
    source: `local Shop = {}
Shop.__index = Shop

local PRODUCTS = {
  -- { id = "item1", name = "Item 1", price = 100, currency = "Coins" },
}

function Shop.new(products)
  local self = setmetatable({}, Shop)
  self._products = products or PRODUCTS
  return self
end

function Shop:getProducts()
  return self._products
end

function Shop:getProduct(productId)
  for _, product in ipairs(self._products) do
    if product.id == productId then
      return product
    end
  end
  return nil
end

function Shop:canAfford(playerCurrency, productId)
  local product = self:getProduct(productId)
  if not product then return false, "Product not found" end
  if playerCurrency < product.price then
    return false, "Insufficient currency"
  end
  return true
end

function Shop:purchase(playerCurrency, productId)
  local canBuy, reason = self:canAfford(playerCurrency, productId)
  if not canBuy then
    return false, reason
  end
  local product = self:getProduct(productId)
  return true, product
end

return Shop`,
  },
  quest: {
    api: ["start", "complete", "fail", "getActive", "getCompleted", "isComplete"],
    source: `local QuestSystem = {}
QuestSystem.__index = QuestSystem

local QUEST_DEFINITIONS = {
  -- {
  --   id = "quest1",
  --   name = "First Quest",
  --   description = "Complete your first task",
  --   objectives = { { id = "obj1", description = "Do something", target = 1 } },
  --   rewards = { { currency = "Coins", amount = 100 } },
  -- },
}

function QuestSystem.new()
  local self = setmetatable({}, QuestSystem)
  self._active = {}
  self._completed = {}
  self._definitions = QUEST_DEFINITIONS
  return self
end

function QuestSystem:start(questId)
  if self._active[questId] then return false, "Quest already active" end
  if self._completed[questId] then return false, "Quest already completed" end
  local def = self:_getDefinition(questId)
  if not def then return false, "Quest not found" end
  self._active[questId] = {
    id = questId,
    progress = {},
    startedAt = os.time(),
  }
  for _, obj in ipairs(def.objectives) do
    self._active[questId].progress[obj.id] = 0
  end
  return true, self._active[questId]
end

function QuestSystem:complete(questId)
  if not self._active[questId] then return false, "Quest not active" end
  local quest = self._active[questId]
  self._active[questId] = nil
  self._completed[questId] = true
  local def = self:_getDefinition(questId)
  return true, def and def.rewards or {}
end

function QuestSystem:fail(questId)
  if not self._active[questId] then return false, "Quest not active" end
  self._active[questId] = nil
  return true
end

function QuestSystem:getActive()
  return self._active
end

function QuestSystem:getCompleted()
  return self._completed
end

function QuestSystem:isComplete(questId)
  return self._completed[questId] == true
end

function QuestSystem:_getDefinition(questId)
  for _, def in ipairs(self._definitions) do
    if def.id == questId then return def end
  end
  return nil
end

return QuestSystem`,
  },
  checkpoint: {
    api: ["save", "load", "getLatest", "onTouchCheckpoint"],
    source: `local CheckpointSystem = {}
CheckpointSystem.__index = CheckpointSystem

function CheckpointSystem.new()
  local self = setmetatable({}, CheckpointSystem)
  self._checkpoints = {}
  return self
end

function CheckpointSystem:save(playerId, position)
  self._checkpoints[playerId] = {
    position = position,
    savedAt = os.time(),
  }
  return true
end

function CheckpointSystem:load(playerId)
  return self._checkpoints[playerId]
end

function CheckpointSystem:getLatest(playerId)
  local data = self._checkpoints[playerId]
  if data then return data.position end
  return nil
end

function CheckpointSystem:onTouchCheckpoint(part, playerId)
  if not part or not playerId then return end
  local position = part.Position
  self:save(playerId, position)
  return position
end

-- Auto-setup: tag Parts named "Checkpoint" to trigger saves
function CheckpointSystem:setupAutoCheckpoints(workspace)
  for _, obj in ipairs(workspace:GetDescendants()) do
    if obj:IsA("BasePart") and obj.Name == "Checkpoint" then
      obj.Touched:Connect(function(hit)
        local character = hit.Parent
        if character then
          local player = game.Players:GetPlayerFromCharacter(character)
          if player then
            self:onTouchCheckpoint(obj, player.UserId)
          end
        end
      end)
    end
  end
end

return CheckpointSystem`,
  },
  round_manager: {
    api: ["startRound", "endRound", "getState", "getTimer", "addPlayer", "removePlayer", "getPlayers"],
    source: `local RoundManager = {}
RoundManager.__index = RoundManager

local STATES = {
  WAITING = "waiting",
  PLAYING = "playing",
  ENDED = "ended",
}
RoundManager.STATES = STATES

function RoundManager.new(config)
  local self = setmetatable({}, RoundManager)
  self._state = STATES.WAITING
  self._players = {}
  self._startTime = nil
  self._endTime = nil
  self._config = config or {
    minPlayers = 1,
    roundDuration = 120,
    waitingDuration = 30,
  }
  return self
end

function RoundManager:startRound()
  if self._state ~= STATES.WAITING then
    return false, "Not in waiting state"
  end
  if #self._players < self._config.minPlayers then
    return false, "Not enough players"
  end
  self._state = STATES.PLAYING
  self._startTime = os.time()
  self._endTime = self._startTime + self._config.roundDuration
  return true
end

function RoundManager:endRound(reason)
  if self._state ~= STATES.PLAYING then
    return false, "Round not in progress"
  end
  self._state = STATES.ENDED
  local result = {
    reason = reason or "time_up",
    duration = os.time() - (self._startTime or os.time()),
    players = self._players,
  }
  task.delay(5, function()
    self:_reset()
  end)
  return true, result
end

function RoundManager:getState()
  return self._state
end

function RoundManager:getTimer()
  if self._state ~= STATES.PLAYING then return nil end
  local remaining = (self._endTime or 0) - os.time()
  return math.max(0, remaining)
end

function RoundManager:addPlayer(playerId)
  table.insert(self._players, playerId)
  return #self._players
end

function RoundManager:removePlayer(playerId)
  for i, id in ipairs(self._players) do
    if id == playerId then
      table.remove(self._players, i)
      return true
    end
  end
  return false
end

function RoundManager:getPlayers()
  return self._players
end

function RoundManager:_reset()
  self._state = STATES.WAITING
  self._players = {}
  self._startTime = nil
  self._endTime = nil
end

return RoundManager`,
  },
  daily_rewards: {
    api: ["claim", "canClaim", "getStreak", "resetStreak", "getNextReward"],
    source: `local DailyRewards = {}
DailyRewards.__index = DailyRewards

local REWARDS = {
  { day = 1,  reward = { currency = "Coins", amount = 50 } },
  { day = 2,  reward = { currency = "Coins", amount = 100 } },
  { day = 3,  reward = { currency = "Coins", amount = 150 } },
  { day = 4,  reward = { currency = "Coins", amount = 200 } },
  { day = 5,  reward = { currency = "Coins", amount = 250 } },
  { day = 6,  reward = { currency = "Coins", amount = 300 } },
  { day = 7,  reward = { currency = "Gems",  amount = 10  } },
}

function DailyRewards.new()
  local self = setmetatable({}, DailyRewards)
  self._players = {}
  return self
end

function DailyRewards:_getPlayerData(playerId)
  if not self._players[playerId] then
    self._players[playerId] = {
      streak = 0,
      lastClaimDay = nil,
    }
  end
  return self._players[playerId]
end

function DailyRewards:canClaim(playerId)
  local data = self:_getPlayerData(playerId)
  if not data.lastClaimDay then return true end
  local today = os.date("*t")
  local todayKey = string.format("%d-%d-%d", today.year, today.month, today.day)
  return data.lastClaimDay ~= todayKey
end

function DailyRewards:claim(playerId)
  if not self:canClaim(playerId) then
    return false, "Already claimed today"
  end
  local data = self:_getPlayerData(playerId)
  local today = os.date("*t")
  local todayKey = string.format("%d-%d-%d", today.year, today.month, today.day)
  data.streak = data.streak + 1
  if data.streak > #REWARDS then
    data.streak = 1
  end
  data.lastClaimDay = todayKey
  local rewardEntry = REWARDS[data.streak]
  return true, rewardEntry and rewardEntry.reward or nil
end

function DailyRewards:getStreak(playerId)
  return self:_getPlayerData(playerId).streak
end

function DailyRewards:resetStreak(playerId)
  local data = self:_getPlayerData(playerId)
  data.streak = 0
  data.lastClaimDay = nil
  return true
end

function DailyRewards:getNextReward(playerId)
  local data = self:_getPlayerData(playerId)
  local nextDay = (data.streak % #REWARDS) + 1
  local entry = REWARDS[nextDay]
  return entry and entry.reward or nil
end

return DailyRewards`,
  },
  crafting: {
    api: ["craft", "canCraft", "getRecipes", "getRecipe"],
    source: `local CraftingSystem = {}
CraftingSystem.__index = CraftingSystem

local RECIPES = {
  -- {
  --   id = "recipe1",
  --   name = "Iron Sword",
  --   ingredients = { { id = "iron_ore", quantity = 3 }, { id = "wood", quantity = 1 } },
  --   result = { id = "iron_sword", quantity = 1 },
  -- },
}

function CraftingSystem.new(recipes)
  local self = setmetatable({}, CraftingSystem)
  self._recipes = recipes or RECIPES
  return self
end

function CraftingSystem:getRecipes()
  return self._recipes
end

function CraftingSystem:getRecipe(recipeId)
  for _, recipe in ipairs(self._recipes) do
    if recipe.id == recipeId then
      return recipe
    end
  end
  return nil
end

function CraftingSystem:canCraft(recipeId, inventory)
  local recipe = self:getRecipe(recipeId)
  if not recipe then return false, "Recipe not found" end
  for _, ingredient in ipairs(recipe.ingredients) do
    local count = inventory[ingredient.id] or 0
    if count < ingredient.quantity then
      return false, string.format("Need %d %s, have %d", ingredient.quantity, ingredient.id, count)
    end
  end
  return true
end

function CraftingSystem:craft(recipeId, inventory)
  local canDo, reason = self:canCraft(recipeId, inventory)
  if not canDo then
    return false, reason
  end
  local recipe = self:getRecipe(recipeId)
  local consumed = {}
  for _, ingredient in ipairs(recipe.ingredients) do
    inventory[ingredient.id] = (inventory[ingredient.id] or 0) - ingredient.quantity
    consumed[ingredient.id] = ingredient.quantity
  end
  return true, { result = recipe.result, consumed = consumed }
end

return CraftingSystem`,
  },
  dialogue: {
    api: ["start", "advance", "getNode", "getCurrent", "reset", "getChoices"],
    source: `local DialogueSystem = {}
DialogueSystem.__index = DialogueSystem

-- Example dialogue tree structure:
-- {
--   id = "npc_intro",
--   nodes = {
--     start = {
--       text = "Hello traveler!",
--       speaker = "NPC",
--       choices = {
--         { text = "Hello!", next = "greet" },
--         { text = "Bye.", next = "farewell" },
--       },
--     },
--     greet = { text = "Welcome to our village.", speaker = "NPC", next = "end" },
--     farewell = { text = "Farewell!", speaker = "NPC", next = "end" },
--   },
-- }

function DialogueSystem.new(trees)
  local self = setmetatable({}, DialogueSystem)
  self._trees = trees or {}
  self._sessions = {}
  return self
end

function DialogueSystem:start(playerId, treeId)
  local tree = self._trees[treeId]
  if not tree then return false, "Dialogue tree not found" end
  self._sessions[playerId] = {
    treeId = treeId,
    currentNode = "start",
  }
  return true, self:getCurrent(playerId)
end

function DialogueSystem:getCurrent(playerId)
  local session = self._sessions[playerId]
  if not session then return nil end
  return self:getNode(session.treeId, session.currentNode)
end

function DialogueSystem:getNode(treeId, nodeId)
  local tree = self._trees[treeId]
  if not tree then return nil end
  return tree.nodes[nodeId]
end

function DialogueSystem:getChoices(playerId)
  local node = self:getCurrent(playerId)
  if not node then return {} end
  return node.choices or {}
end

function DialogueSystem:advance(playerId, choiceIndex)
  local session = self._sessions[playerId]
  if not session then return false, "No active dialogue" end
  local node = self:getCurrent(playerId)
  if not node then return false, "Invalid node" end
  local nextNode
  if node.choices and choiceIndex then
    local choice = node.choices[choiceIndex]
    if not choice then return false, "Invalid choice" end
    nextNode = choice.next
  elseif node.next then
    nextNode = node.next
  end
  if nextNode == "end" or not nextNode then
    self._sessions[playerId] = nil
    return true, nil
  end
  session.currentNode = nextNode
  return true, self:getCurrent(playerId)
end

function DialogueSystem:reset(playerId)
  self._sessions[playerId] = nil
  return true
end

return DialogueSystem`,
  },
  abilities: {
    api: ["activate", "canUse", "getCooldownRemaining", "resetCooldown", "getAbilities", "addAbility"],
    source: `local AbilitySystem = {}
AbilitySystem.__index = AbilitySystem

function AbilitySystem.new(abilities)
  local self = setmetatable({}, AbilitySystem)
  self._abilities = abilities or {}
  self._cooldowns = {}
  return self
end

function AbilitySystem:addAbility(ability)
  -- ability: { id, name, cooldown (seconds), cost, costType }
  table.insert(self._abilities, ability)
  return true
end

function AbilitySystem:getAbilities()
  return self._abilities
end

function AbilitySystem:_getAbility(abilityId)
  for _, ability in ipairs(self._abilities) do
    if ability.id == abilityId then
      return ability
    end
  end
  return nil
end

function AbilitySystem:canUse(playerId, abilityId)
  local ability = self:_getAbility(abilityId)
  if not ability then return false, "Ability not found" end
  local remaining = self:getCooldownRemaining(playerId, abilityId)
  if remaining > 0 then
    return false, string.format("On cooldown: %.1fs remaining", remaining)
  end
  return true
end

function AbilitySystem:activate(playerId, abilityId)
  local canDo, reason = self:canUse(playerId, abilityId)
  if not canDo then
    return false, reason
  end
  local ability = self:_getAbility(abilityId)
  local key = playerId .. "_" .. abilityId
  self._cooldowns[key] = os.clock() + (ability.cooldown or 0)
  return true, { ability = ability, cooldownEnds = self._cooldowns[key] }
end

function AbilitySystem:getCooldownRemaining(playerId, abilityId)
  local key = playerId .. "_" .. abilityId
  local endsAt = self._cooldowns[key]
  if not endsAt then return 0 end
  return math.max(0, endsAt - os.clock())
end

function AbilitySystem:resetCooldown(playerId, abilityId)
  local key = playerId .. "_" .. abilityId
  self._cooldowns[key] = nil
  return true
end

return AbilitySystem`,
  },
};

const schema = z.object({
  system_type: z.enum([
    "inventory",
    "shop",
    "quest",
    "checkpoint",
    "round_manager",
    "daily_rewards",
    "crafting",
    "dialogue",
    "abilities",
  ]),
  system_name: z.string().optional(),
  studio_port: z.number().int().positive().default(33796),
});

registerTool({
  name: "rbx_create_system",
  description:
    "Create a common gameplay system from templates: inventory, shop, quest, checkpoint, round-manager, daily-rewards, crafting, dialogue, abilities",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const template = TEMPLATES[input.system_type];
    if (!template) {
      throw new Error(`Unknown system_type: ${input.system_type}`);
    }
    const moduleName = input.system_name ?? input.system_type
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");

    await client.createInstance(
      "ServerScriptService",
      "ModuleScript",
      moduleName,
    );
    const createdPath = `ServerScriptService.${moduleName}`;
    await client.setScriptSource(createdPath, template.source);

    return createResponseEnvelope(
      {
        system_type: input.system_type,
        created_path: createdPath,
        module_api: template.api,
      },
      { source: sourceInfo({ studio_port: input.studio_port }) },
    );
  },
});

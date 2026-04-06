import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

type Tier = "common" | "uncommon" | "rare" | "boss";
type DifficultyCurve = "linear" | "exponential" | "plateau";

interface EnemyType {
  name: string;
  health: number;
  damage: number;
  speed: number;
  tier: Tier;
}

interface WaveEnemy {
  name: string;
  count: number;
}

interface WaveConfig {
  wave: number;
  enemies: WaveEnemy[];
  total_enemies: number;
  reward: number;
  difficulty_multiplier: number;
}

interface EnemyWaveDesignerResult {
  waves: WaveConfig[];
  total_enemies: number;
  estimated_duration_seconds: number;
  reward_total: number;
}

const schema = z.object({
  total_waves: z.number().min(1).max(100).default(10),
  enemy_types: z
    .array(
      z.object({
        name: z.string().min(1),
        health: z.number().default(100),
        damage: z.number().default(10),
        speed: z.number().default(16),
        tier: z.enum(["common", "uncommon", "rare", "boss"]).default("common"),
      }),
    )
    .min(1),
  difficulty_curve: z.enum(["linear", "exponential", "plateau"]).default("exponential"),
  base_reward: z.number().default(10),
  studio_port: z.number().int().positive().default(33796),
});

const TIER_WEIGHT: Record<Tier, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  boss: 5,
};

function computeDifficultyMultiplier(
  wave: number,
  totalWaves: number,
  curve: DifficultyCurve,
): number {
  const progress = wave / totalWaves;
  switch (curve) {
    case "linear":
      return 1 + progress * 2;
    case "exponential":
      return Math.pow(1.3, wave - 1);
    case "plateau": {
      if (progress < 0.4) {
        return 1 + (progress / 0.4) * 3;
      } else if (progress < 0.8) {
        return 4;
      } else {
        return 4 + (progress - 0.8) / 0.2;
      }
    }
  }
}

function selectEnemiesForWave(
  waveNumber: number,
  totalWaves: number,
  enemyTypes: EnemyType[],
  curve: DifficultyCurve,
): WaveEnemy[] {
  const progress = waveNumber / totalWaves;
  const isBossWave =
    curve === "plateau"
      ? waveNumber % Math.max(1, Math.floor(totalWaves / 3)) === 0
      : waveNumber === totalWaves;

  const eligible = enemyTypes.filter((e) => {
    if (isBossWave && e.tier === "boss") return true;
    if (isBossWave && e.tier !== "boss") return true;
    if (e.tier === "boss") return false;
    if (e.tier === "rare") return progress >= 0.6;
    if (e.tier === "uncommon") return progress >= 0.3;
    return true;
  });

  const tierPool = isBossWave
    ? eligible
    : eligible.filter((e) => e.tier !== "boss");

  const fallback = enemyTypes[0];
  if (tierPool.length === 0 || !fallback) return [{ name: fallback?.name ?? "Enemy", count: 1 }];

  const diffMult = computeDifficultyMultiplier(waveNumber, totalWaves, curve);
  const baseCount = Math.max(1, Math.round(3 * diffMult));

  const waveEnemies: WaveEnemy[] = [];

  if (isBossWave) {
    const boss = eligible.find((e) => e.tier === "boss");
    if (boss) {
      waveEnemies.push({ name: boss.name, count: 1 });
    }
    const commons = tierPool.filter((e) => e.tier === "common");
    const escort = commons[0];
    if (escort) {
      waveEnemies.push({ name: escort.name, count: Math.max(1, Math.floor(baseCount / 2)) });
    }
  } else {
    const sorted = [...tierPool].sort(
      (a, b) => TIER_WEIGHT[a.tier] - TIER_WEIGHT[b.tier],
    );
    const primary = sorted[0];
    if (primary) {
      waveEnemies.push({ name: primary.name, count: baseCount });

      if (sorted.length > 1 && progress >= 0.3) {
        const secondary = sorted[Math.min(1, sorted.length - 1)];
        if (secondary && secondary.name !== primary.name) {
          waveEnemies.push({
            name: secondary.name,
            count: Math.max(1, Math.floor(baseCount / 3)),
          });
        }
      }
    }
  }

  return waveEnemies;
}

function generateWaves(
  totalWaves: number,
  enemyTypes: EnemyType[],
  curve: DifficultyCurve,
  baseReward: number,
): WaveConfig[] {
  const waves: WaveConfig[] = [];

  for (let w = 1; w <= totalWaves; w++) {
    const diffMult = computeDifficultyMultiplier(w, totalWaves, curve);
    const enemies = selectEnemiesForWave(w, totalWaves, enemyTypes, curve);
    const totalEnemiesInWave = enemies.reduce((sum, e) => sum + e.count, 0);
    const reward = Math.round(baseReward * diffMult);

    waves.push({
      wave: w,
      enemies,
      total_enemies: totalEnemiesInWave,
      reward,
      difficulty_multiplier: Math.round(diffMult * 100) / 100,
    });
  }

  return waves;
}

function buildWaveConfigLua(waves: WaveConfig[], enemyTypes: EnemyType[]): string {
  const wavesLua = waves
    .map(
      (w) => `  {
    wave = ${w.wave},
    difficulty_multiplier = ${w.difficulty_multiplier},
    reward = ${w.reward},
    enemies = {
${w.enemies.map((e) => `      { name = "${e.name}", count = ${e.count} },`).join("\n")}
    },
  }`,
    )
    .join(",\n");

  const enemyDefsLua = enemyTypes
    .map(
      (e) => `  ["${e.name}"] = {
    health = ${e.health},
    damage = ${e.damage},
    speed = ${e.speed},
    tier = "${e.tier}",
  }`,
    )
    .join(",\n");

  return `-- WaveConfig Module (auto-generated)
local WaveConfig = {}

WaveConfig.Waves = {
${wavesLua}
}

WaveConfig.EnemyDefinitions = {
${enemyDefsLua}
}

return WaveConfig
`;
}

function buildWaveManagerLua(): string {
  return `-- WaveManager Script
local WaveConfig = require(game:GetService("ServerScriptService"):FindFirstChild("WaveConfig"))
local Players = game:GetService("Players")

local currentWave = 0
local activeEnemies = 0
local SPAWN_DELAY = 0.5
local BETWEEN_WAVE_DELAY = 5

local function spawnEnemy(enemyName, spawnPos)
  local def = WaveConfig.EnemyDefinitions[enemyName]
  if not def then return end

  local model = Instance.new("Model")
  model.Name = enemyName

  local hrp = Instance.new("Part")
  hrp.Name = "HumanoidRootPart"
  hrp.Size = Vector3.new(2, 2, 1)
  hrp.Position = spawnPos
  hrp.Transparency = 1
  hrp.Parent = model

  local humanoid = Instance.new("Humanoid")
  humanoid.MaxHealth = def.health
  humanoid.Health = def.health
  humanoid.WalkSpeed = def.speed
  humanoid.Parent = model

  local head = Instance.new("Part")
  head.Name = "Head"
  head.Size = Vector3.new(2, 1, 1)
  head.Position = spawnPos + Vector3.new(0, 1.5, 0)
  head.Parent = model

  model.PrimaryPart = hrp
  model.Parent = workspace

  activeEnemies = activeEnemies + 1

  humanoid.Died:Connect(function()
    activeEnemies = activeEnemies - 1
    task.delay(3, function() model:Destroy() end)
  end)
end

local function getSpawnPosition()
  local spawns = workspace:GetDescendants()
  local spawnParts = {}
  for _, v in ipairs(spawns) do
    if v:IsA("SpawnLocation") then
      table.insert(spawnParts, v)
    end
  end
  if #spawnParts > 0 then
    local chosen = spawnParts[math.random(#spawnParts)]
    return chosen.Position + Vector3.new(0, 3, 0)
  end
  return Vector3.new(0, 5, 0)
end

local function runWave(waveData)
  currentWave = waveData.wave
  print(string.format("[WaveManager] Starting Wave %d", currentWave))

  for _, enemyGroup in ipairs(waveData.enemies) do
    for i = 1, enemyGroup.count do
      local pos = getSpawnPosition()
      spawnEnemy(enemyGroup.name, pos)
      task.wait(SPAWN_DELAY)
    end
  end

  -- Wait until all enemies defeated
  while activeEnemies > 0 do
    task.wait(1)
  end

  print(string.format("[WaveManager] Wave %d complete. Reward: %d", currentWave, waveData.reward))
  -- Fire reward event here if needed
end

-- Main loop
task.wait(3) -- Initial delay
for _, waveData in ipairs(WaveConfig.Waves) do
  runWave(waveData)
  task.wait(BETWEEN_WAVE_DELAY)
end

print("[WaveManager] All waves complete!")
`;
}

function estimateDuration(waves: WaveConfig[]): number {
  const avgEnemiesPerWave =
    waves.reduce((sum, w) => sum + w.total_enemies, 0) / waves.length;
  const spawnTime = avgEnemiesPerWave * 0.5;
  const combatTime = avgEnemiesPerWave * 4;
  const betweenWaveTime = waves.length * 5;
  return Math.round((spawnTime + combatTime) * waves.length + betweenWaveTime);
}

registerTool({
  name: "rbx_enemy_wave_designer",
  description:
    "Generate wave tables with spawn logic, enemy types, pacing ramps, and reward curves for combat/survival games",
  schema,
  handler: async (input): Promise<ResponseEnvelope<EnemyWaveDesignerResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });

    const enemyTypes: EnemyType[] = input.enemy_types.map((e) => ({
      name: e.name,
      health: e.health,
      damage: e.damage,
      speed: e.speed,
      tier: e.tier,
    }));

    const waves = generateWaves(
      input.total_waves,
      enemyTypes,
      input.difficulty_curve,
      input.base_reward,
    );

    const waveConfigSource = buildWaveConfigLua(waves, enemyTypes);
    const waveManagerSource = buildWaveManagerLua();

    const installCode = `
local sss = game:GetService("ServerScriptService")

local existing = sss:FindFirstChild("WaveConfig")
if existing then existing:Destroy() end

local waveConfig = Instance.new("ModuleScript")
waveConfig.Name = "WaveConfig"
waveConfig.Source = ${JSON.stringify(waveConfigSource)}
waveConfig.Parent = sss

local existingManager = sss:FindFirstChild("WaveManager")
if existingManager then existingManager:Destroy() end

local waveManager = Instance.new("Script")
waveManager.Name = "WaveManager"
waveManager.Source = ${JSON.stringify(waveManagerSource)}
waveManager.Disabled = false
waveManager.Parent = sss

return { ok = true }
`;

    await client.executeCode(installCode, true);

    const totalEnemies = waves.reduce((sum, w) => sum + w.total_enemies, 0);
    const rewardTotal = waves.reduce((sum, w) => sum + w.reward, 0);
    const estimatedDuration = estimateDuration(waves);

    const result: EnemyWaveDesignerResult = {
      waves,
      total_enemies: totalEnemies,
      estimated_duration_seconds: estimatedDuration,
      reward_total: rewardTotal,
    };

    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

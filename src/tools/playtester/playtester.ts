import { createHash } from "node:crypto";
import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo, traverseInstances } from "../../shared.js";
import type { InstanceNode } from "../../types/roblox.js";
import type {
  PlaytestAction,
  PlaytestResult,
  PlaytestScenario,
  PlaytestStepResult,
  ShipcheckIssue,
} from "../../types/shipcheck.js";
import { registerTool } from "../registry.js";

const playtestActionSchema = z.object({
  type: z.enum(["execute_code", "wait", "verify_state", "capture_evidence", "note"]),
  description: z.string().min(1),
  code: z.string().min(1).optional(),
  wait_seconds: z.number().positive().optional(),
  expected: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

const playtestScenarioSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  steps: z.array(playtestActionSchema).min(1),
  timeout_seconds: z.number().positive().optional(),
});

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  action: z.enum(["run_scenario", "list_scenarios", "get_result"]),
  scenario: playtestScenarioSchema.optional(),
  scenario_preset: z
    .enum([
      "spawn_flow",
      "shop_flow",
      "tutorial_flow",
      "mobile_ux",
      "shooter_weapon_equip",
      "shooter_respawn_cycle",
    ])
    .optional(),
  result_id: z.string().min(1).optional(),
});

const resultsStore = new Map<string, PlaytestResult>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyExecutionResult(result: Record<string, unknown>): string {
  return JSON.stringify(result);
}

function summarizeTree(root: InstanceNode): string {
  let total = 0;
  traverseInstances(root, () => {
    total += 1;
  });
  return `DataModel snapshot contains ${total} instances.`;
}

function scenarioPresets(): Record<string, PlaytestScenario> {
  return {
    spawn_flow: {
      name: "spawn_flow",
      description: "Validate basic spawn infrastructure and required spawn instances.",
      steps: [
        {
          type: "execute_code",
          description: "Check if StarterPlayer exists",
          code: "return { ok = game:FindFirstChild('StarterPlayer') ~= nil, found = game:FindFirstChild('StarterPlayer') ~= nil }",
        },
        {
          type: "execute_code",
          description: "Check if StarterPlayerScripts has content",
          code: "local sp = game:FindFirstChild('StarterPlayer'); local scripts = sp and sp:FindFirstChild('StarterPlayerScripts'); return { ok = scripts ~= nil and #scripts:GetChildren() > 0, count = scripts and #scripts:GetChildren() or 0 }",
        },
        {
          type: "execute_code",
          description: "Check for SpawnLocation in Workspace",
          code: "return { ok = game.Workspace:FindFirstChildWhichIsA('SpawnLocation', true) ~= nil }",
        },
        {
          type: "verify_state",
          description: "Verify spawn location exists and is valid",
          expected: '"ok":true',
        },
        {
          type: "note",
          description: "Record spawn flow note",
          note: "Spawn flow verified",
        },
      ],
      timeout_seconds: 30,
    },
    shop_flow: {
      name: "shop_flow",
      description: "Validate basic marketplace shop structure and receipt handling.",
      steps: [
        {
          type: "execute_code",
          description: "Find MarketplaceService usage in scripts",
          code: "local count = 0; for _, d in ipairs(game:GetDescendants()) do if d:IsA('LuaSourceContainer') and string.find(d.Source, 'MarketplaceService') then count += 1 end end return { ok = count > 0, count = count }",
        },
        {
          type: "execute_code",
          description: "Check for ProcessReceipt handler",
          code: "local found = false; for _, d in ipairs(game:GetDescendants()) do if d:IsA('LuaSourceContainer') and string.find(d.Source, 'ProcessReceipt') then found = true end end return { ok = found }",
        },
        {
          type: "execute_code",
          description: "Find GUI elements with shop or store in name",
          code: "local count = 0; for _, d in ipairs(game:GetDescendants()) do if d:IsA('GuiObject') and (string.find(string.lower(d.Name), 'shop') or string.find(string.lower(d.Name), 'store')) then count += 1 end end return { ok = count > 0, count = count }",
        },
        {
          type: "verify_state",
          description: "Verify shop UI exists",
          expected: '"ok":true',
        },
        {
          type: "note",
          description: "Record shop flow note",
          note: "Shop flow basic structure verified",
        },
      ],
      timeout_seconds: 30,
    },
    tutorial_flow: {
      name: "tutorial_flow",
      description: "Validate tutorial-related scripts, UI, and persistence hooks.",
      steps: [
        {
          type: "execute_code",
          description: "Search for tutorial-related scripts or GUIs",
          code: "local count = 0; for _, d in ipairs(game:GetDescendants()) do local name = string.lower(d.Name); if string.find(name, 'tutorial') then count += 1 end end return { ok = count > 0, count = count }",
        },
        {
          type: "execute_code",
          description: "Check if tutorial state is persisted",
          code: "local found = false; for _, d in ipairs(game:GetDescendants()) do if d:IsA('LuaSourceContainer') and string.find(d.Source, 'DataStore') and string.find(string.lower(d.Source), 'tutorial') then found = true end end return { ok = found }",
        },
        {
          type: "verify_state",
          description: "Verify tutorial system exists",
          expected: '"ok":true',
        },
        {
          type: "note",
          description: "Record tutorial flow note",
          note: "Tutorial flow structure verified",
        },
      ],
      timeout_seconds: 30,
    },
    mobile_ux: {
      name: "mobile_ux",
      description: "Validate mobile UI density, touch targets, and mouse-only assumptions.",
      steps: [
        {
          type: "execute_code",
          description: "Count GUI elements",
          code: "local count = 0; for _, d in ipairs(game:GetDescendants()) do if d:IsA('GuiObject') then count += 1 end end return { ok = count > 0, count = count }",
        },
        {
          type: "execute_code",
          description: "Check button sizes for touch targets",
          code: "local undersized = 0; for _, d in ipairs(game:GetDescendants()) do if d:IsA('TextButton') or d:IsA('ImageButton') then local size = d.AbsoluteSize; if size.X < 44 or size.Y < 44 then undersized += 1 end end end return { ok = undersized == 0, undersized = undersized }",
        },
        {
          type: "execute_code",
          description: "Verify no obvious mouse-only input handling",
          code: "local found = false; for _, d in ipairs(game:GetDescendants()) do if d:IsA('LuaSourceContainer') and string.find(d.Source, 'MouseButton1Click') and not string.find(d.Source, 'Touch') then found = true end end return { ok = not found, mouse_only = found }",
        },
        {
          type: "verify_state",
          description: "Verify mobile-friendly UI",
          expected: '"ok":true',
        },
        {
          type: "note",
          description: "Record mobile UX note",
          note: "Mobile UX basic checks completed",
        },
      ],
      timeout_seconds: 45,
    },
    shooter_weapon_equip: {
      name: "shooter_weapon_equip",
      description: "Verify weapon tools exist with proper configuration for a shooter game.",
      steps: [
        {
          type: "execute_code",
          description: "Check StarterPack for Tool instances",
          code: "local starterPack = game:FindFirstChild('StarterPack'); local names = {}; local count = 0; if starterPack then for _, child in ipairs(starterPack:GetChildren()) do if child:IsA('Tool') then count += 1; table.insert(names, child.Name) end end end return { ok = count > 0, count = count, names = names }",
        },
        {
          type: "execute_code",
          description: "Verify weapons have Handle parts",
          code: "local starterPack = game:FindFirstChild('StarterPack'); local missing = {}; if starterPack then for _, child in ipairs(starterPack:GetChildren()) do if child:IsA('Tool') and child:FindFirstChild('Handle') == nil then table.insert(missing, child.Name) end end end return { ok = #missing == 0, missing_handles = missing }",
        },
        {
          type: "execute_code",
          description: "Check for weapon config values",
          code: "local starterPack = game:FindFirstChild('StarterPack'); local weaponConfigs = {}; if starterPack then for _, child in ipairs(starterPack:GetChildren()) do if child:IsA('Tool') then local config = { name = child.Name, Damage = false, Ammo = false, FireRate = false }; for _, descendant in ipairs(child:GetDescendants()) do if descendant:IsA('NumberValue') or descendant:IsA('IntValue') then local lowered = string.lower(descendant.Name); if lowered == 'damage' then config.Damage = true end; if lowered == 'ammo' then config.Ammo = true end; if lowered == 'firerate' or lowered == 'fire_rate' then config.FireRate = true end end end; if config.Damage or config.Ammo or config.FireRate then table.insert(weaponConfigs, config) end end end end return { ok = #weaponConfigs > 0, weapon_configs = weaponConfigs }",
        },
        {
          type: "verify_state",
          description: "Confirm at least one configured weapon exists",
          expected: '"ok":true',
        },
        {
          type: "note",
          description: "Record weapon equip note",
          note: "Weapon equip flow verified",
        },
      ],
      timeout_seconds: 30,
    },
    shooter_respawn_cycle: {
      name: "shooter_respawn_cycle",
      description: "Validate respawn infrastructure for a shooter game.",
      steps: [
        {
          type: "execute_code",
          description: "Check Players.CharacterAutoLoads and RespawnTime",
          code: "local players = game:GetService('Players'); return { auto_loads = players.CharacterAutoLoads, respawn_time = players.RespawnTime }",
        },
        {
          type: "execute_code",
          description: "Check SpawnLocation count and team assignment",
          code: "local count = 0; local teams = {}; for _, descendant in ipairs(game:GetDescendants()) do if descendant:IsA('SpawnLocation') then count += 1; local key = descendant.Neutral and 'Neutral' or tostring(descendant.TeamColor); teams[key] = (teams[key] or 0) + 1 end end return { ok = count > 0, count = count, teams = teams }",
        },
        {
          type: "execute_code",
          description: "Search for CharacterAdded handlers in scripts",
          code: "local handlers = 0; for _, descendant in ipairs(game:GetDescendants()) do if descendant:IsA('LuaSourceContainer') and string.find(string.lower(descendant.Source), 'characteradded') then handlers += 1 end end return { ok = handlers > 0, handlers_found = handlers }",
        },
        {
          type: "verify_state",
          description: "Confirm spawn infrastructure exists",
          expected: '"ok":true',
        },
        {
          type: "note",
          description: "Record respawn cycle note",
          note: "Respawn cycle infrastructure verified",
        },
      ],
      timeout_seconds: 30,
    },
  };
}

function resolveScenario(
  inputScenario?: PlaytestScenario,
  presetName?: string,
): PlaytestScenario | null {
  if (inputScenario) {
    return inputScenario;
  }
  if (!presetName) {
    return null;
  }
  const preset = scenarioPresets()[presetName];
  return preset ?? null;
}

function normalizeScenario(input: z.infer<typeof playtestScenarioSchema>): PlaytestScenario {
  return {
    name: input.name,
    description: input.description,
    steps: input.steps.map((step) => ({
      type: step.type,
      description: step.description,
      ...(step.code ? { code: step.code } : {}),
      ...(typeof step.wait_seconds === "number" ? { wait_seconds: step.wait_seconds } : {}),
      ...(step.expected ? { expected: step.expected } : {}),
      ...(step.note ? { note: step.note } : {}),
    })),
    ...(typeof input.timeout_seconds === "number"
      ? { timeout_seconds: input.timeout_seconds }
      : {}),
  };
}

function evaluateVerification(
  expected: string,
  history: PlaytestStepResult[],
): { status: PlaytestStepResult["status"]; actual: string } {
  const relevant = [...history].reverse().find((step) => step.action.type === "execute_code");
  const actual = relevant?.actual_result ?? "";
  if (actual.toLowerCase().includes(expected.toLowerCase())) {
    return { status: "pass", actual };
  }
  if (actual.length === 0) {
    return {
      status: "manual_review",
      actual: "No execute_code result available to verify against.",
    };
  }
  return { status: "fail", actual };
}

function issuesFromSteps(scenarioName: string, steps: PlaytestStepResult[]): ShipcheckIssue[] {
  return steps
    .filter(
      (step) =>
        step.status === "fail" || step.status === "timeout" || step.status === "manual_review",
    )
    .map((step, index) => ({
      id: `playtest-${scenarioName}-${index + 1}`,
      title:
        step.status === "manual_review"
          ? "Playtest step requires manual review"
          : step.status === "timeout"
            ? "Playtest step timed out"
            : "Playtest step failed",
      summary: `${scenarioName} step ${step.step_index + 1} did not complete cleanly: ${step.action.description}`,
      severity: step.status === "fail" || step.status === "timeout" ? "warning" : "info",
      confidence: step.status === "manual_review" ? "manual_review" : "medium",
      category: "playtest",
      evidence: [
        `Step: ${step.action.description}`,
        ...(step.actual_result ? [`Actual: ${step.actual_result}`] : []),
        ...(step.error ? [`Error: ${step.error}`] : []),
      ],
      recommendation:
        step.status === "manual_review"
          ? "Inspect the step manually and confirm the scenario outcome in Studio."
          : "Investigate the failed scenario step and resolve the structural or runtime issue.",
      remediation: "manual",
      source_check: "rbx_playtester",
    }));
}

function computeOverallStatus(steps: PlaytestStepResult[]): PlaytestResult["overall_status"] {
  if (steps.some((step) => step.status === "timeout")) {
    return "timeout";
  }
  if (steps.some((step) => step.status === "fail")) {
    return steps.some((step) => step.status === "pass") ? "partial" : "fail";
  }
  if (steps.some((step) => step.status === "manual_review")) {
    return "partial";
  }
  return "pass";
}

async function runStep(
  client: StudioBridgeClient,
  root: InstanceNode,
  action: PlaytestAction,
  history: PlaytestStepResult[],
  startedAt: number,
  timeoutMs: number,
): Promise<PlaytestStepResult> {
  const stepStart = Date.now();
  if (stepStart - startedAt > timeoutMs) {
    return {
      step_index: history.length,
      action,
      status: "timeout",
      duration_ms: 0,
      error: "Scenario timeout exceeded before step execution.",
    };
  }

  try {
    if (action.type === "execute_code") {
      if (!action.code) {
        return {
          step_index: history.length,
          action,
          status: "fail",
          duration_ms: Date.now() - stepStart,
          error: "Missing Lua code for execute_code step.",
        };
      }
      const raw = await client.executeCode(action.code, true);
      const actual = stringifyExecutionResult(raw);
      if (Date.now() - startedAt > timeoutMs) {
        return {
          step_index: history.length,
          action,
          status: "timeout",
          duration_ms: Date.now() - stepStart,
          error: "Scenario timeout exceeded during step execution.",
        };
      }
      const hasResult = actual.length > 5 && actual !== "null" && actual !== "undefined";
      const status = hasResult ? "pass" : "manual_review";
      return {
        step_index: history.length,
        action,
        status,
        actual_result: actual,
        duration_ms: Date.now() - stepStart,
      };
    }
    if (action.type === "wait") {
      const waitSeconds = action.wait_seconds ?? 1;
      await sleep(waitSeconds * 1000);
      return {
        step_index: history.length,
        action,
        status: "pass",
        actual_result: `Waited ${waitSeconds} seconds.`,
        duration_ms: Date.now() - stepStart,
      };
    }
    if (action.type === "verify_state") {
      const expected = action.expected ?? "";
      const verification = evaluateVerification(expected, history);
      return {
        step_index: history.length,
        action,
        status: verification.status,
        actual_result: verification.actual,
        duration_ms: Date.now() - stepStart,
      };
    }
    if (action.type === "capture_evidence") {
      return {
        step_index: history.length,
        action,
        status: "pass",
        actual_result: summarizeTree(root),
        duration_ms: Date.now() - stepStart,
        evidence: [summarizeTree(root)],
      };
    }
    return {
      step_index: history.length,
      action,
      status: "pass",
      actual_result: action.note ?? action.description,
      duration_ms: Date.now() - stepStart,
      ...(action.note ? { evidence: [action.note] } : {}),
    };
  } catch (error) {
    return {
      step_index: history.length,
      action,
      status: "fail",
      duration_ms: Date.now() - stepStart,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

registerTool({
  name: "rbx_playtester",
  description:
    "Run guided playtest scenarios, list built-in presets, or fetch previous playtest results.",
  schema,
  handler: async (input) => {
    if (input.action === "list_scenarios") {
      const presets = Object.values(scenarioPresets()).map((scenario) => ({
        name: scenario.name,
        description: scenario.description,
        steps: scenario.steps.length,
      }));
      return createResponseEnvelope(
        {
          scenarios: presets,
        },
        {
          source: sourceInfo({ studio_port: input.studio_port }),
        },
      );
    }

    if (input.action === "get_result") {
      const existing = input.result_id ? resultsStore.get(input.result_id) : undefined;
      return createResponseEnvelope(
        {
          result: existing ?? null,
        },
        {
          source: sourceInfo({ studio_port: input.studio_port }),
          warnings: existing ? [] : ["Result not found in the current process store."],
        },
      );
    }

    const scenario = resolveScenario(
      input.scenario ? normalizeScenario(input.scenario) : undefined,
      input.scenario_preset,
    );
    if (!scenario) {
      return createResponseEnvelope(
        {
          error: "Provide either scenario or scenario_preset when action is run_scenario.",
        },
        {
          source: sourceInfo({ studio_port: input.studio_port }),
          warnings: ["Scenario was not provided."],
        },
      );
    }

    const client = new StudioBridgeClient({ port: input.studio_port });
    await client.ping();
    const root = await client.getDataModel();
    const startedAtIso = new Date().toISOString();
    const startedAt = Date.now();
    const timeoutMs = (scenario.timeout_seconds ?? 60) * 1000;
    const steps: PlaytestStepResult[] = [];

    for (const action of scenario.steps) {
      const result = await runStep(client, root, action, steps, startedAt, timeoutMs);
      steps.push(result);
      if (result.status === "timeout") {
        break;
      }
    }

    const overallStatus = computeOverallStatus(steps);
    const issuesFound = issuesFromSteps(scenario.name, steps);
    const finishedAt = new Date().toISOString();
    const id = createHash("sha256")
      .update(`${scenario.name}:${startedAtIso}:${JSON.stringify(steps)}`)
      .digest("hex")
      .slice(0, 16);

    const result: PlaytestResult = {
      id,
      scenario_name: scenario.name,
      started_at: startedAtIso,
      finished_at: finishedAt,
      overall_status: overallStatus,
      steps,
      summary: `${scenario.name} completed with status ${overallStatus}. ${issuesFound.length} issues recorded.`,
      issues_found: issuesFound,
    };

    resultsStore.set(id, result);

    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

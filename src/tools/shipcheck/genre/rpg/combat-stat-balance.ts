import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../../../shared.js";
import type { AuditIssue } from "../../../../shared.js";
import type { StudioSearchMatch } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
});

interface TtkAnalysis {
  low_level_ttk: string;
  high_level_ttk: string;
  one_shot_risk: boolean;
}

interface CombatStatBalanceResult {
  stats_found: number;
  ttk_analysis: TtkAnalysis;
  balance_issues: string[];
  issues: AuditIssue[];
}

export async function runCombatStatBalance(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<CombatStatBalanceResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const issues: AuditIssue[] = [];
  const balanceIssues: string[] = [];

  const damageMatches = await client.searchInstances({
    query: "Damage",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const damageArray: StudioSearchMatch[] = Array.isArray(damageMatches) ? damageMatches : [];

  const healthMatches = await client.searchInstances({
    query: "MaxHealth",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const healthArray: StudioSearchMatch[] = Array.isArray(healthMatches) ? healthMatches : [];

  // Also read MaxHealth from Humanoid instances directly (it's a number property, not a child)
  const humanoidMatches = await client.searchInstances({
    query: "Humanoid",
    search_type: "class",
    case_sensitive: false,
    max_results: 50,
  });
  const humanoidArray: StudioSearchMatch[] = Array.isArray(humanoidMatches) ? humanoidMatches : [];

  const defenseMatches = await client.searchInstances({
    query: "Defense",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const defenseArray: StudioSearchMatch[] = Array.isArray(defenseMatches) ? defenseMatches : [];

  const statsFound = damageArray.length + healthArray.length + defenseArray.length + humanoidArray.length;

  const combatModuleMatches = await client.searchInstances({
    query: "CombatModule",
    search_type: "name",
    case_sensitive: false,
    max_results: 30,
  });
  const combatModuleArray: StudioSearchMatch[] = Array.isArray(combatModuleMatches)
    ? combatModuleMatches
    : [];

  const damageFormulaMatches = await client.searchInstances({
    query: "TakeDamage",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 50,
  });
  const damageFormulaArray: StudioSearchMatch[] = Array.isArray(damageFormulaMatches)
    ? damageFormulaMatches
    : [];

  let lowLevelTtk = "unknown";
  let highLevelTtk = "unknown";
  let oneShotRisk = false;

  if (damageArray.length > 0 && healthArray.length > 0) {
    const damageValues: number[] = [];
    const healthValues: number[] = [];

    for (const match of damageArray.slice(0, 10)) {
      try {
        const props = await client.getProperties(match.path);
        const val = props["Value"];
        if (typeof val === "number" && val > 0) {
          damageValues.push(val);
        }
      } catch {
        continue;
      }
    }

    for (const match of healthArray.slice(0, 10)) {
      try {
        const props = await client.getProperties(match.path);
        const val = props["Value"];
        if (typeof val === "number" && val > 0) {
          healthValues.push(val);
        }
      } catch {
        continue;
      }
    }

    for (const match of humanoidArray.slice(0, 10)) {
      try {
        const props = await client.getProperties(match.path);
        const val = props["MaxHealth"];
        if (typeof val === "number" && val > 0) {
          healthValues.push(val);
        }
      } catch {
        continue;
      }
    }

    if (damageValues.length > 0 && healthValues.length > 0) {
      const avgDamage = damageValues.reduce((a, b) => a + b, 0) / damageValues.length;
      const minHealth = Math.min(...healthValues);
      const maxHealth = Math.max(...healthValues);

      const hitsToKillLow = Math.ceil(minHealth / avgDamage);
      const hitsToKillHigh = Math.ceil(maxHealth / avgDamage);

      lowLevelTtk = `~${hitsToKillLow} hit(s) at avg ${avgDamage.toFixed(1)} dmg vs ${minHealth} HP`;
      highLevelTtk = `~${hitsToKillHigh} hit(s) at avg ${avgDamage.toFixed(1)} dmg vs ${maxHealth} HP`;

      if (hitsToKillLow <= 1) {
        oneShotRisk = true;
        balanceIssues.push(`One-shot risk: ${avgDamage.toFixed(1)} avg damage vs ${minHealth} min HP`);
        issues.push({
          severity: "high",
          element_path: damageArray[0]?.path ?? "Workspace",
          rule: "one_shot_risk",
          message: `Average damage (${avgDamage.toFixed(1)}) can one-shot low-health targets (${minHealth} HP).`,
          suggestion:
            "Reduce base damage or increase minimum health to ensure at least 2-3 hits to kill.",
        });
      }

      if (hitsToKillHigh > 50) {
        balanceIssues.push(`Unkillable risk: ${hitsToKillHigh} hits needed for high-HP targets`);
        issues.push({
          severity: "medium",
          element_path: healthArray[0]?.path ?? "Workspace",
          rule: "unkillable_target_risk",
          message: `High-HP targets require ${hitsToKillHigh} hits — combat may feel unresponsive.`,
          suggestion: "Scale damage up for high-level content or add armor-piercing mechanics.",
        });
      }
    }
  }

  if (statsFound === 0 && combatModuleArray.length === 0 && damageFormulaArray.length === 0) {
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "no_combat_stats",
      message: "No combat stat definitions (Damage, MaxHealth, Defense) or TakeDamage calls found.",
      suggestion:
        "Define combat stats in NumberValues or a config ModuleScript and wire them to a damage formula.",
    });
  }

  if (defenseArray.length === 0 && damageArray.length > 0 && healthArray.length > 0) {
    balanceIssues.push("No Defense stat found — damage reduction mechanic may be missing");
    issues.push({
      severity: "low",
      element_path: "ServerScriptService",
      rule: "no_defense_stat",
      message: "Damage and health stats found but no Defense stat detected.",
      suggestion: "Add a Defense or Armor stat to allow meaningful build diversity.",
    });
  }

  return createResponseEnvelope(
    {
      stats_found: statsFound,
      ttk_analysis: {
        low_level_ttk: lowLevelTtk,
        high_level_ttk: highLevelTtk,
        one_shot_risk: oneShotRisk,
      },
      balance_issues: balanceIssues,
      issues,
    },
    { source: sourceInfo({ studio_port: input.studio_port }) },
  );
}

registerTool({
  name: "rbx_rpg_combat_stat_balance",
  description:
    "Analyze combat stats, damage formulas, and TTK (time-to-kill) balance across player levels",
  schema,
  handler: runCombatStatBalance,
});

import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo, traverseInstances } from "../../../../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
});

interface CombatContentMaturityIssue {
  severity: "warning" | "info";
  category: "violence_explicit" | "violence_moderate" | "weapon_refs" | "social_risk";
  rule: "combat_content_match";
  message: string;
  element_path: string;
  confidence: "manual_review";
}

interface CombatContentMaturityResult {
  score: number;
  scripts_scanned: number;
  ui_elements_scanned: number;
  findings_by_category: Record<
    "violence_explicit" | "violence_moderate" | "weapon_refs" | "social_risk",
    number
  >;
  issues: CombatContentMaturityIssue[];
}

const categories = {
  violence_explicit: ["gore", "dismember", "decapitat", "mutilat", "torture", "execution"],
  violence_moderate: ["blood", "bleed", "corpse", "dead body", "body bag"],
  weapon_refs: [
    "assault rifle",
    "ak-47",
    "ak47",
    "m16",
    "shotgun",
    "sniper rifle",
    "grenade launcher",
    "rpg",
    "rocket launcher",
  ],
  social_risk: ["discord.gg", "discord.com/invite", "youtube.com", "twitter.com", "tiktok.com"],
} as const;

function renderValue(value: RobloxPropertyValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function textForUiNode(node: InstanceNode): string {
  return renderValue(node.properties?.["Text"]);
}

function collectScriptPaths(root: InstanceNode): string[] {
  const scriptPaths: string[] = [];
  traverseInstances(root, (node, currentPath) => {
    if (
      node.className === "Script" ||
      node.className === "LocalScript" ||
      node.className === "ModuleScript"
    ) {
      scriptPaths.push(currentPath);
    }
  });
  return scriptPaths;
}

function pushIssue(
  issues: CombatContentMaturityIssue[],
  findingsByCategory: CombatContentMaturityResult["findings_by_category"],
  category: keyof typeof categories,
  elementPath: string,
  match: string,
): void {
  findingsByCategory[category] += 1;
  issues.push({
    severity: category === "violence_explicit" || category === "social_risk" ? "warning" : "info",
    category,
    rule: "combat_content_match",
    message: `${elementPath} contains "${match}" which may affect shooter content maturity review.`,
    element_path: elementPath,
    confidence: "manual_review",
  });
}

function scanText(
  content: string,
  elementPath: string,
  issues: CombatContentMaturityIssue[],
  findingsByCategory: CombatContentMaturityResult["findings_by_category"],
): void {
  const normalized = content.toLowerCase();
  for (const [category, keywords] of Object.entries(categories) as Array<
    [keyof typeof categories, readonly string[]]
  >) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        pushIssue(issues, findingsByCategory, category, elementPath, keyword);
      }
    }
  }
}

export async function runCombatContentMaturity(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<CombatContentMaturityResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const root = (await client.getChildren("game", 10)) as InstanceNode;
  const scriptPaths = collectScriptPaths(root);
  const issues: CombatContentMaturityIssue[] = [];
  const findingsByCategory: CombatContentMaturityResult["findings_by_category"] = {
    violence_explicit: 0,
    violence_moderate: 0,
    weapon_refs: 0,
    social_risk: 0,
  };

  for (const scriptPath of scriptPaths) {
    try {
      const script = await client.getScriptSource(scriptPath);
      scanText(script.source, scriptPath, issues, findingsByCategory);
    } catch {
      continue;
    }
  }

  let uiElementsScanned = 0;
  traverseInstances(root, (node, currentPath) => {
    if (node.className !== "TextLabel" && node.className !== "TextButton") {
      return;
    }
    uiElementsScanned += 1;
    const text = textForUiNode(node);
    if (text.trim().length === 0) {
      return;
    }
    scanText(text, currentPath, issues, findingsByCategory);
  });

  return createResponseEnvelope(
    {
      score: Math.max(0, 100 - issues.length * 15),
      scripts_scanned: scriptPaths.length,
      ui_elements_scanned: uiElementsScanned,
      findings_by_category: findingsByCategory,
      issues,
    },
    {
      source: sourceInfo({ studio_port: input.studio_port }),
    },
  );
}

registerTool({
  name: "rbx_shooter_combat_content_maturity",
  description:
    "Scan scripts and UI for combat-specific content that may affect age rating or content maturity classification.",
  schema,
  handler: runCombatContentMaturity,
});

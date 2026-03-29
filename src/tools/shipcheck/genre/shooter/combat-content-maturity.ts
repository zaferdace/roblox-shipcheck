import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo, traverseInstances } from "../../../../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const categoryKeys = [
  "violence_explicit",
  "violence_moderate",
  "weapon_refs",
  "social_risk",
] as const;

type CategoryKey = (typeof categoryKeys)[number];
type CustomKeywords = {
  [Key in CategoryKey]?: string[] | undefined;
};

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  custom_keywords: z
    .object({
      violence_explicit: z.array(z.string()).optional(),
      violence_moderate: z.array(z.string()).optional(),
      weapon_refs: z.array(z.string()).optional(),
      social_risk: z.array(z.string()).optional(),
    } satisfies z.ZodRawShape)
    .optional(),
});

interface CombatContentMaturityIssue {
  severity: "warning" | "info";
  category: CategoryKey;
  rule: "combat_content_match";
  message: string;
  element_path: string;
  confidence: "manual_review";
}

interface CombatContentMaturityResult {
  score: number;
  scripts_scanned: number;
  ui_elements_scanned: number;
  findings_by_category: Record<CategoryKey, number>;
  issues: CombatContentMaturityIssue[];
}

const defaultCategories: Record<CategoryKey, string[]> = {
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
};

function buildCategories(customKeywords?: CustomKeywords): Record<CategoryKey, string[]> {
  return Object.fromEntries(
    categoryKeys.map((category) => [
      category,
      [...defaultCategories[category], ...(customKeywords?.[category] ?? [])],
    ]),
  ) as Record<CategoryKey, string[]>;
}

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
  category: CategoryKey,
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
  categories: Record<CategoryKey, string[]>,
  issues: CombatContentMaturityIssue[],
  findingsByCategory: CombatContentMaturityResult["findings_by_category"],
): void {
  const normalized = content.toLowerCase();
  for (const [category, keywords] of Object.entries(categories) as Array<[CategoryKey, string[]]>) {
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
  const categories = buildCategories(input.custom_keywords);

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
      scanText(script.source, scriptPath, categories, issues, findingsByCategory);
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
    scanText(text, currentPath, categories, issues, findingsByCategory);
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

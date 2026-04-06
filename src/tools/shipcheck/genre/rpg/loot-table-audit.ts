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

interface RarityDistribution {
  common_pct: string;
  rare_pct: string;
  epic_pct: string;
  legendary_pct: string;
}

interface LootTableResult {
  tables_found: number;
  probability_valid: boolean;
  rarity_distribution: RarityDistribution;
  issues: AuditIssue[];
}

export async function runLootTableAudit(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<LootTableResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const issues: AuditIssue[] = [];

  const lootMatches = await client.searchInstances({
    query: "LootTable",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const lootArray: StudioSearchMatch[] = Array.isArray(lootMatches) ? lootMatches : [];

  const dropTableMatches = await client.searchInstances({
    query: "DropTable",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const dropTableArray: StudioSearchMatch[] = Array.isArray(dropTableMatches) ? dropTableMatches : [];

  const dropScriptMatches = await client.searchInstances({
    query: "LootTable",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 50,
  });
  const dropScriptArray: StudioSearchMatch[] = Array.isArray(dropScriptMatches) ? dropScriptMatches : [];

  const tablesFound = lootArray.length + dropTableArray.length + dropScriptArray.length;

  const commonMatches = await client.searchInstances({
    query: "Common",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const commonArray: StudioSearchMatch[] = Array.isArray(commonMatches) ? commonMatches : [];

  const rareMatches = await client.searchInstances({
    query: "Rare",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const rareArray: StudioSearchMatch[] = Array.isArray(rareMatches) ? rareMatches : [];

  const epicMatches = await client.searchInstances({
    query: "Epic",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const epicArray: StudioSearchMatch[] = Array.isArray(epicMatches) ? epicMatches : [];

  const legendaryMatches = await client.searchInstances({
    query: "Legendary",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const legendaryArray: StudioSearchMatch[] = Array.isArray(legendaryMatches) ? legendaryMatches : [];

  const totalRarityItems =
    commonArray.length + rareArray.length + epicArray.length + legendaryArray.length;

  const rarityDistribution: RarityDistribution = {
    common_pct:
      totalRarityItems > 0
        ? `${((commonArray.length / totalRarityItems) * 100).toFixed(1)}%`
        : "unknown",
    rare_pct:
      totalRarityItems > 0
        ? `${((rareArray.length / totalRarityItems) * 100).toFixed(1)}%`
        : "unknown",
    epic_pct:
      totalRarityItems > 0
        ? `${((epicArray.length / totalRarityItems) * 100).toFixed(1)}%`
        : "unknown",
    legendary_pct:
      totalRarityItems > 0
        ? `${((legendaryArray.length / totalRarityItems) * 100).toFixed(1)}%`
        : "unknown",
  };

  const probabilityScriptMatches = await client.searchInstances({
    query: "math.random",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 30,
  });
  const probArray: StudioSearchMatch[] = Array.isArray(probabilityScriptMatches)
    ? probabilityScriptMatches
    : [];

  const probabilityValid = tablesFound > 0 && probArray.length > 0;

  if (tablesFound === 0) {
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "no_loot_tables",
      message: "No LootTable or DropTable definitions found.",
      suggestion: "Define loot tables in a ModuleScript with probability-weighted entries.",
    });
  }

  if (tablesFound > 0 && probArray.length === 0) {
    issues.push({
      severity: "high",
      element_path: "ServerScriptService",
      rule: "no_probability_logic",
      message: "Loot tables found but no math.random or probability logic detected.",
      suggestion: "Use math.random() with weighted ranges to determine drop outcomes.",
    });
  }

  if (totalRarityItems > 0 && legendaryArray.length > commonArray.length) {
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "inverted_rarity_distribution",
      message: `More Legendary (${legendaryArray.length}) items than Common (${commonArray.length}) — rarity distribution is inverted.`,
      suggestion: "Common items should be the most frequent. Adjust drop rates accordingly.",
    });
  }

  if (totalRarityItems > 0 && commonArray.length === 0) {
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "no_common_items",
      message: "No Common rarity items detected — players may find nothing from most drops.",
      suggestion: "Add Common-tier items as the baseline drop to ensure players always receive something.",
    });
  }

  return createResponseEnvelope(
    {
      tables_found: tablesFound,
      probability_valid: probabilityValid,
      rarity_distribution: rarityDistribution,
      issues,
    },
    { source: sourceInfo({ studio_port: input.studio_port }) },
  );
}

registerTool({
  name: "rbx_rpg_loot_table_audit",
  description: "Validate loot table probabilities, rarity distribution, and drop rate fairness",
  schema,
  handler: runLootTableAudit,
});

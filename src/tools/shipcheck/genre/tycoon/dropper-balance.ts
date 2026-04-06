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

interface IncomeAnalysis {
  dropper_names: string[];
  has_number_values: boolean;
  estimated_rate: string;
}

interface UpgradeCurve {
  upgrades_found: number;
  scaling_type: "exponential" | "linear" | "unknown";
}

interface DropperBalanceResult {
  droppers_found: number;
  income_analysis: IncomeAnalysis;
  upgrade_curve: UpgradeCurve;
  rebirth_roi: string;
  issues: AuditIssue[];
}

export async function runDropperBalance(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<DropperBalanceResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const issues: AuditIssue[] = [];

  const dropperMatches = await client.searchInstances({
    query: "Dropper",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const dropperArray: StudioSearchMatch[] = Array.isArray(dropperMatches) ? dropperMatches : [];

  const conveyorMatches = await client.searchInstances({
    query: "Conveyor",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const conveyorArray: StudioSearchMatch[] = Array.isArray(conveyorMatches) ? conveyorMatches : [];

  const collectorMatches = await client.searchInstances({
    query: "Collector",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const collectorArray: StudioSearchMatch[] = Array.isArray(collectorMatches) ? collectorMatches : [];

  const droppersFound = dropperArray.length + conveyorArray.length + collectorArray.length;
  const dropperNames = [
    ...dropperArray.map((m) => m.path),
    ...conveyorArray.map((m) => m.path),
    ...collectorArray.map((m) => m.path),
  ].slice(0, 10);

  const numberValueMatches = await client.searchInstances({
    query: "NumberValue",
    search_type: "class",
    case_sensitive: false,
    max_results: 50,
  });
  const nvArray: StudioSearchMatch[] = Array.isArray(numberValueMatches) ? numberValueMatches : [];
  const hasNumberValues = nvArray.length > 0;

  const upgradeMatches = await client.searchInstances({
    query: "Upgrade",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const upgradeArray: StudioSearchMatch[] = Array.isArray(upgradeMatches) ? upgradeMatches : [];

  const upgradeCostMatches = await client.searchInstances({
    query: "UpgradeCost",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 30,
  });
  const costArray: StudioSearchMatch[] = Array.isArray(upgradeCostMatches) ? upgradeCostMatches : [];

  let scalingType: "exponential" | "linear" | "unknown" = "unknown";
  if (costArray.length > 0) {
    const exponentialMatches = await client.searchInstances({
      query: "math.pow",
      search_type: "script_content",
      case_sensitive: false,
      max_results: 10,
    });
    const expArray: StudioSearchMatch[] = Array.isArray(exponentialMatches) ? exponentialMatches : [];
    scalingType = expArray.length > 0 ? "exponential" : "linear";
  }

  const rebirthMatches = await client.searchInstances({
    query: "Rebirth",
    search_type: "name",
    case_sensitive: false,
    max_results: 50,
  });
  const rebirthArray: StudioSearchMatch[] = Array.isArray(rebirthMatches) ? rebirthMatches : [];
  const hasRebirth = rebirthArray.length > 0;

  if (droppersFound === 0) {
    issues.push({
      severity: "high",
      element_path: "Workspace",
      rule: "no_droppers_found",
      message: "No Dropper, Conveyor, or Collector instances found.",
      suggestion: "Add tycoon dropper and collector models to drive income generation.",
    });
  }

  if (upgradeArray.length === 0) {
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "no_upgrades_found",
      message: "No Upgrade instances detected — game may lack progression.",
      suggestion: "Implement an upgrade system that increases dropper output or frequency.",
    });
  }

  if (upgradeArray.length > 0 && scalingType === "linear") {
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "linear_upgrade_scaling",
      message: "Upgrade costs appear to scale linearly — this can make late-game trivial.",
      suggestion: "Use exponential scaling (e.g. math.pow) for upgrade costs to maintain challenge.",
    });
  }

  return createResponseEnvelope(
    {
      droppers_found: droppersFound,
      income_analysis: {
        dropper_names: dropperNames,
        has_number_values: hasNumberValues,
        estimated_rate: hasNumberValues ? "NumberValues present — rate data available" : "No NumberValues found",
      },
      upgrade_curve: {
        upgrades_found: upgradeArray.length,
        scaling_type: scalingType,
      },
      rebirth_roi: hasRebirth
        ? `Rebirth system detected (${rebirthArray.length} instances) — verify ROI is positive`
        : "No rebirth system detected",
      issues,
    },
    { source: sourceInfo({ studio_port: input.studio_port }) },
  );
}

registerTool({
  name: "rbx_tycoon_dropper_balance",
  description: "Scan for dropper/conveyor patterns, upgrade scaling indicators, and rebirth system presence",
  schema,
  handler: runDropperBalance,
});

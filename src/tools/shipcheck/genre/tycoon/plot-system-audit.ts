import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../../../shared.js";
import type { AuditIssue } from "../../../../shared.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
});

interface PlotSystemResult {
  plots_found: number;
  datastore_persistence: boolean;
  cleanup_on_leave: boolean;
  issues: AuditIssue[];
}

export async function runPlotSystemAudit(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<PlotSystemResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const issues: AuditIssue[] = [];

  const plotMatches = await client.searchInstances({
    query: "Plot",
    search_type: "name",
    case_sensitive: false,
    max_results: 200,
  });

  const plotArray = Array.isArray(plotMatches) ? plotMatches : [];
  const plotsFound = plotArray.length;

  const ownerMatches = await client.searchInstances({
    query: "Owner",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const ownerArray = Array.isArray(ownerMatches) ? ownerMatches : [];

  const dsMatches = await client.searchInstances({
    query: "DataStore",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 50,
  });
  const dsArray = Array.isArray(dsMatches) ? dsMatches : [];
  const datastorePersistence = dsArray.length > 0;

  const cleanupMatches = await client.searchInstances({
    query: "PlayerRemoving",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 50,
  });
  const cleanupArray = Array.isArray(cleanupMatches) ? cleanupMatches : [];
  const cleanupOnLeave = cleanupArray.length > 0;

  if (plotsFound === 0) {
    issues.push({
      severity: "high",
      element_path: "Workspace",
      rule: "no_plots_found",
      message: "No Plot instances found in the game.",
      suggestion: "Add Plot models/folders to represent tycoon plots.",
    });
  }

  if (!datastorePersistence) {
    issues.push({
      severity: "high",
      element_path: "ServerScriptService",
      rule: "no_datastore_persistence",
      message: "No DataStore usage detected — plot ownership may not persist across sessions.",
      suggestion: "Use DataStoreService to save and load plot ownership per player.",
    });
  }

  if (!cleanupOnLeave) {
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "no_cleanup_on_leave",
      message: "No PlayerRemoving handler detected — plots may not be freed when players leave.",
      suggestion: "Connect to Players.PlayerRemoving to release plot ownership on disconnect.",
    });
  }

  if (ownerArray.length === 0 && plotsFound > 0) {
    issues.push({
      severity: "medium",
      element_path: "Workspace",
      rule: "no_owner_tracking",
      message: "Plots found but no Owner value instances detected.",
      suggestion: "Add a StringValue or ObjectValue named 'Owner' inside each plot to track ownership.",
    });
  }

  if (plotsFound > 1 && ownerArray.length < plotsFound) {
    issues.push({
      severity: "low",
      element_path: "Workspace",
      rule: "multi_plot_conflict_risk",
      message: `${plotsFound} plots found but only ${ownerArray.length} owner trackers — multi-plot isolation may be incomplete.`,
      suggestion: "Ensure every plot has its own Owner value to prevent cross-plot conflicts.",
    });
  }

  return createResponseEnvelope(
    {
      plots_found: plotsFound,
      datastore_persistence: datastorePersistence,
      cleanup_on_leave: cleanupOnLeave,
      issues,
    },
    { source: sourceInfo({ studio_port: input.studio_port }) },
  );
}

registerTool({
  name: "rbx_tycoon_plot_system_audit",
  description: "Audit tycoon plot claiming, ownership persistence, and multi-plot isolation",
  schema,
  handler: runPlotSystemAudit,
});

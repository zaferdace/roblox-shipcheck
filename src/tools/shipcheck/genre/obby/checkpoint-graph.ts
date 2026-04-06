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

interface CheckpointGraphResult {
  checkpoints_found: number;
  ordering_valid: boolean;
  save_load_exists: boolean;
  issues: AuditIssue[];
}

export async function runCheckpointGraph(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<CheckpointGraphResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const issues: AuditIssue[] = [];

  const spawnMatches = await client.searchInstances({
    query: "SpawnLocation",
    search_type: "class",
    case_sensitive: false,
    max_results: 200,
  });
  const spawnArray: StudioSearchMatch[] = Array.isArray(spawnMatches) ? spawnMatches : [];

  const checkpointMatches = await client.searchInstances({
    query: "Checkpoint",
    search_type: "name",
    case_sensitive: false,
    max_results: 200,
  });
  const checkpointArray: StudioSearchMatch[] = Array.isArray(checkpointMatches) ? checkpointMatches : [];

  const checkpointsFound = spawnArray.length + checkpointArray.length;

  const stageMatches = await client.searchInstances({
    query: "Stage",
    search_type: "name",
    case_sensitive: false,
    max_results: 200,
  });
  const stageArray: StudioSearchMatch[] = Array.isArray(stageMatches) ? stageMatches : [];

  const stageNumbers = stageArray
    .map((m) => {
      const segment = m.path.split("/").pop() ?? "";
      const match = /(\d+)/.exec(segment);
      return match?.[1] ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  let orderingValid = true;
  if (stageNumbers.length > 1) {
    for (let i = 1; i < stageNumbers.length; i++) {
      const prev = stageNumbers[i - 1];
      const curr = stageNumbers[i];
      if (prev !== undefined && curr !== undefined && curr - prev > 1) {
        orderingValid = false;
        issues.push({
          severity: "medium",
          element_path: "Workspace",
          rule: "checkpoint_gap_in_sequence",
          message: `Stage numbering gap detected between ${prev} and ${curr}.`,
          suggestion: "Ensure stage numbers are sequential with no gaps.",
        });
        break;
      }
    }
  }

  const saveLoadMatches = await client.searchInstances({
    query: "leaderstats",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 30,
  });
  const saveLoadArray: StudioSearchMatch[] = Array.isArray(saveLoadMatches) ? saveLoadMatches : [];

  const dsMatches = await client.searchInstances({
    query: "DataStore",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 30,
  });
  const dsArray: StudioSearchMatch[] = Array.isArray(dsMatches) ? dsMatches : [];
  const saveLoadExists = saveLoadArray.length > 0 || dsArray.length > 0;

  if (checkpointsFound === 0) {
    issues.push({
      severity: "high",
      element_path: "Workspace",
      rule: "no_checkpoints_found",
      message: "No SpawnLocations or Checkpoint parts found.",
      suggestion: "Add SpawnLocations at regular intervals throughout the obby.",
    });
  }

  if (!saveLoadExists && checkpointsFound > 0) {
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "no_checkpoint_persistence",
      message: "No DataStore or leaderstats detected — checkpoint progress may not save between sessions.",
      suggestion: "Save the player's latest checkpoint number to DataStore on each checkpoint touch.",
    });
  }

  if (checkpointsFound > 0 && checkpointsFound < 3) {
    issues.push({
      severity: "low",
      element_path: "Workspace",
      rule: "too_few_checkpoints",
      message: `Only ${checkpointsFound} checkpoint(s) found — players may lose significant progress on death.`,
      suggestion: "Add more checkpoints — aim for one every 20-30 stages.",
    });
  }

  return createResponseEnvelope(
    {
      checkpoints_found: checkpointsFound,
      ordering_valid: orderingValid,
      save_load_exists: saveLoadExists,
      issues,
    },
    { source: sourceInfo({ studio_port: input.studio_port }) },
  );
}

registerTool({
  name: "rbx_obby_checkpoint_graph",
  description: "Validate checkpoint ordering, spacing, and completeness for obby progression",
  schema,
  handler: runCheckpointGraph,
});

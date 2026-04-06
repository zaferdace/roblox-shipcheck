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

interface IdleEarningsResult {
  time_patterns_found: number;
  server_side_validation: boolean;
  client_side_time_reliance: boolean;
  issues: AuditIssue[];
}

export async function runIdleEarningsCheck(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<IdleEarningsResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const issues: AuditIssue[] = [];

  const osTimeMatches = await client.searchInstances({
    query: "os.time",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 100,
  });
  const osTimeArray: StudioSearchMatch[] = Array.isArray(osTimeMatches) ? osTimeMatches : [];

  const tickMatches = await client.searchInstances({
    query: "tick()",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 100,
  });
  const tickArray: StudioSearchMatch[] = Array.isArray(tickMatches) ? tickMatches : [];

  const dateTimeMatches = await client.searchInstances({
    query: "DateTime",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 100,
  });
  const dateTimeArray: StudioSearchMatch[] = Array.isArray(dateTimeMatches) ? dateTimeMatches : [];

  const timePatternsFound = osTimeArray.length + tickArray.length + dateTimeArray.length;

  const allTimeMatches = [...osTimeArray, ...tickArray, ...dateTimeArray];
  const localScriptTimeMatches = allTimeMatches.filter((m) =>
    m.path.toLowerCase().includes("local") || m.path.toLowerCase().includes("client"),
  );
  const clientSideTimeReliance = localScriptTimeMatches.length > 0;

  const serverValidationMatches = await client.searchInstances({
    query: "ServerScriptService",
    search_type: "name",
    case_sensitive: false,
    max_results: 10,
  });
  const serverValidationArray: StudioSearchMatch[] = Array.isArray(serverValidationMatches)
    ? serverValidationMatches
    : [];

  const dsTimeMatches = await client.searchInstances({
    query: "os.time",
    search_type: "script_content",
    case_sensitive: true,
    max_results: 50,
  });
  const dsTimeArray: StudioSearchMatch[] = Array.isArray(dsTimeMatches) ? dsTimeMatches : [];
  const serverSideValidation =
    serverValidationArray.length > 0 &&
    dsTimeArray.some((m) => !m.path.toLowerCase().includes("local") && !m.path.toLowerCase().includes("client"));

  if (clientSideTimeReliance) {
    issues.push({
      severity: "high",
      element_path: localScriptTimeMatches[0]?.path ?? "LocalScript",
      rule: "client_side_time_reliance",
      message: `Time functions used in ${localScriptTimeMatches.length} LocalScript(s) — exploitable via time manipulation.`,
      suggestion:
        "Move all time calculations to the server. Never trust client-reported timestamps for earnings.",
    });
  }

  if (!serverSideValidation && timePatternsFound > 0) {
    issues.push({
      severity: "high",
      element_path: "ServerScriptService",
      rule: "no_server_time_validation",
      message: "No server-side time validation detected for idle earnings.",
      suggestion: "Validate elapsed time on the server using os.time() stored in DataStore on session start.",
    });
  }

  if (timePatternsFound === 0) {
    issues.push({
      severity: "low",
      element_path: "ServerScriptService",
      rule: "no_idle_earnings_system",
      message: "No time-based patterns detected — idle/offline earnings may not be implemented.",
      suggestion: "Consider adding offline earnings using server-side os.time() delta calculations.",
    });
  }

  return createResponseEnvelope(
    {
      time_patterns_found: timePatternsFound,
      server_side_validation: serverSideValidation,
      client_side_time_reliance: clientSideTimeReliance,
      issues,
    },
    { source: sourceInfo({ studio_port: input.studio_port }) },
  );
}

registerTool({
  name: "rbx_tycoon_idle_earnings_check",
  description: "Check offline/idle earnings implementation for exploits and time-manipulation safety",
  schema,
  handler: runIdleEarningsCheck,
});

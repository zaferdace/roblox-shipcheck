import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import {
  createResponseEnvelope,
  findNodeByPath,
  readScriptSource,
  sourceInfo,
  traverseInstances,
} from "../shared.js";
import type { AuditSeverity, InstanceNode } from "../types/roblox.js";
import type { ResponseEnvelope } from "../types/tools.js";
import { registerTool } from "./registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  root_path: z.string().min(1).default("game"),
  check_payload_validation: z.boolean().default(true),
  check_rate_limiting: z.boolean().default(true),
  check_trust_boundary: z.boolean().default(true),
});

interface RemoteAuditIssue {
  severity: AuditSeverity;
  remote_path: string;
  rule: string;
  message: string;
  suggestion: string;
  script_path?: string;
}

interface RemoteAuditResult {
  score: number;
  remotes_analyzed: number;
  issues: RemoteAuditIssue[];
  summary: string;
}

interface ScriptRecord {
  path: string;
  source: string;
}

interface RemoteAuditOptions {
  rootPath: string;
  checkPayloadValidation: boolean;
  checkRateLimiting: boolean;
  checkTrustBoundary: boolean;
}

export function analyzeRemoteContracts(
  root: InstanceNode,
  options: RemoteAuditOptions,
): RemoteAuditResult {
  const baseNode = findNodeByPath(root, options.rootPath);
  if (!baseNode) {
    return {
      score: 0,
      remotes_analyzed: 0,
      issues: [
        {
          severity: "high",
          remote_path: options.rootPath,
          rule: "invalid_root_path",
          message: `Root path "${options.rootPath}" was not found in the DataModel.`,
          suggestion:
            "Provide a valid ancestor path that contains your remotes and server handlers.",
        },
      ],
      summary: `Root path "${options.rootPath}" was not found.`,
    };
  }

  const remotes: Array<{ node: InstanceNode; path: string }> = [];
  const scripts: ScriptRecord[] = [];
  traverseInstances(baseNode, (node, currentPath) => {
    if (node.className === "RemoteEvent" || node.className === "RemoteFunction") {
      remotes.push({ node, path: currentPath });
    }
    if (node.className === "Script" || node.className === "ModuleScript") {
      const source = readScriptSource(node);
      if (source) {
        scripts.push({ path: currentPath, source });
      }
    }
  });

  const issues: RemoteAuditIssue[] = [];
  let passingRemotes = 0;
  for (const remote of remotes) {
    const relevantScripts = scripts.filter(
      (script) =>
        script.source.includes(remote.node.name) ||
        script.source.includes(`"${remote.path}"`) ||
        script.source.includes(`'${remote.path}'`),
    );
    if (relevantScripts.length === 0) {
      issues.push({
        severity: "medium",
        remote_path: remote.path,
        rule: "handler_discovery",
        message: "No server-side script referencing this remote was detected.",
        suggestion:
          "Ensure remotes are handled by audited server scripts and referenced through stable paths.",
      });
      continue;
    }

    const remoteIssuesBefore = issues.length;
    const combinedSource = relevantScripts.map((script) => script.source).join("\n");
    const firstScriptPath = relevantScripts[0]?.path;

    if (options.checkPayloadValidation && !hasPayloadValidation(combinedSource)) {
      issues.push({
        severity: "high",
        remote_path: remote.path,
        rule: "payload_validation",
        message: "Remote handler does not show clear payload type or shape validation.",
        suggestion:
          "Validate every client argument with typeof/type/assert guards before using it.",
        ...(firstScriptPath ? { script_path: firstScriptPath } : {}),
      });
    }

    if (options.checkRateLimiting && !hasRateLimiting(combinedSource)) {
      issues.push({
        severity: "medium",
        remote_path: remote.path,
        rule: "rate_limiting",
        message: "Remote handler does not show debounce, cooldown, or per-player throttling.",
        suggestion: "Add per-player rate limits using os.clock/tick/time and a last-call table.",
        ...(firstScriptPath ? { script_path: firstScriptPath } : {}),
      });
    }

    if (
      options.checkTrustBoundary &&
      hasDangerousMutation(combinedSource) &&
      !hasPayloadValidation(combinedSource)
    ) {
      issues.push({
        severity: "high",
        remote_path: remote.path,
        rule: "trust_boundary",
        message:
          "Remote handler appears to mutate game state directly from unvalidated client input.",
        suggestion:
          "Separate validation from state mutation and map client input to server-owned objects.",
        ...(firstScriptPath ? { script_path: firstScriptPath } : {}),
      });
    }

    if (isSensitiveRemoteName(remote.node.name) && !hasPermissionCheck(combinedSource)) {
      issues.push({
        severity: "high",
        remote_path: remote.path,
        rule: "admin_action_exposed",
        message:
          "Sensitive remote name detected without an obvious permission check in the handler.",
        suggestion:
          "Gate admin/debug remotes behind explicit permission checks and server-side allowlists.",
        ...(firstScriptPath ? { script_path: firstScriptPath } : {}),
      });
    }

    if (issues.length === remoteIssuesBefore) {
      passingRemotes += 1;
    }
  }

  const score = remotes.length === 0 ? 100 : Math.round((passingRemotes / remotes.length) * 100);
  return {
    score,
    remotes_analyzed: remotes.length,
    issues,
    summary:
      remotes.length === 0
        ? "No RemoteEvent or RemoteFunction instances were found."
        : `${passingRemotes} of ${remotes.length} remotes passed the selected contract checks.`,
  };
}

function hasPayloadValidation(source: string): boolean {
  return /(typeof\s*\(|type\s*\(|assert\s*\(|if\s+not\s+|tonumber\s*\(|table\.find\s*\(|string\.match\s*\()/iu.test(
    source,
  );
}

function hasRateLimiting(source: string): boolean {
  return /(debounce|cooldown|rate.?limit|lastCall|lastInvoke|os\.clock\s*\(|tick\s*\(|time\s*\(|task\.wait\s*\(|wait\s*\(|\[[^\]]*player[^\]]*\]\s*=)/iu.test(
    source,
  );
}

function hasDangerousMutation(source: string): boolean {
  return /(:Clone\s*\(|:Destroy\s*\(|\.Value\s*=|Parent\s*=|PivotTo\s*\(|SetPrimaryPartCFrame\s*\()/u.test(
    source,
  );
}

function isSensitiveRemoteName(name: string): boolean {
  return /(admin|debug|dev|cheat)/iu.test(name);
}

function hasPermissionCheck(source: string): boolean {
  return /(UserId|GetRankInGroup\s*\(|IsInGroup\s*\(|hasPermission|isAdmin|admins?\s*\[|table\.find\s*\(\s*admins|CreatorId)/iu.test(
    source,
  );
}

export async function runRemoteContractAudit(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<RemoteAuditResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = await client.getDataModel();
  const result = analyzeRemoteContracts(root, {
    rootPath: input.root_path,
    checkPayloadValidation: input.check_payload_validation,
    checkRateLimiting: input.check_rate_limiting,
    checkTrustBoundary: input.check_trust_boundary,
  });
  return createResponseEnvelope(result, {
    source: sourceInfo({ studio_port: input.studio_port }),
  });
}

registerTool({
  name: "rbx_remote_contract_audit",
  description:
    "Audit RemoteEvent and RemoteFunction handlers for validation, throttling, and trust-boundary issues.",
  schema,
  handler: runRemoteContractAudit,
});

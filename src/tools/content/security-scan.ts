import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { InstanceNode } from "../../types/roblox.js";
import { registerTool } from "../registry.js";

interface AuditIssue {
  severity: "low" | "medium" | "high" | "critical";
  rule: string;
  message: string;
  path: string;
  suggestion: string;
}

const DANGEROUS_PATTERNS: Array<{
  rule: string;
  re: RegExp;
  severity: AuditIssue["severity"];
  suggestion: string;
}> = [
  {
    rule: "loadstring_usage",
    re: /\bloadstring\s*\(/u,
    severity: "critical",
    suggestion: "Remove loadstring — it executes arbitrary code and is disabled in most contexts. Use ModuleScripts instead.",
  },
  {
    rule: "require_suspicious_id",
    re: /\brequire\s*\(\s*\d{6,}/u,
    severity: "high",
    suggestion: "Require with a numeric ID loads external modules which may be malicious. Use local ModuleScript paths.",
  },
  {
    rule: "getfenv_setfenv_usage",
    re: /\b(?:getfenv|setfenv)\s*\(/u,
    severity: "high",
    suggestion: "getfenv/setfenv can manipulate execution environments. Remove unless strictly necessary.",
  },
  {
    rule: "http_dynamic_url",
    re: /HttpService\s*:\s*GetAsync\s*\(\s*(?!["']https?:\/\/[^"']+["'])/u,
    severity: "high",
    suggestion: "HttpService:GetAsync with a dynamic URL may fetch malicious content. Use static, allowlisted URLs.",
  },
  {
    rule: "rawset_rawget_global",
    re: /\b(?:rawset|rawget)\s*\(\s*(?:_G|shared|script\.Globals)/u,
    severity: "medium",
    suggestion: "rawset/rawget on global tables can be used to inject code. Prefer explicit variable passing.",
  },
  {
    rule: "debug_getinfo",
    re: /\bdebug\s*\.\s*getinfo\s*\(/u,
    severity: "medium",
    suggestion: "debug.getinfo can be used to bypass security checks. Avoid in production code.",
  },
  {
    rule: "newproxy_usage",
    re: /\bnewproxy\s*\(/u,
    severity: "low",
    suggestion: "newproxy creates userdata objects; unusual in game scripts. Verify intent.",
  },
];

const SAFE_REMOTE_PARENTS = new Set(["ReplicatedStorage", "ReplicatedFirst"]);

const schema = z.object({
  scan_scripts: z.boolean().default(true),
  scan_remotes: z.boolean().default(true),
  scan_hidden: z.boolean().default(true),
  studio_port: z.number().int().positive().default(33796),
});

function getPath(node: InstanceNode, parentPath?: string): string {
  return parentPath ? `${parentPath}.${node.name}` : node.name;
}

interface CollectResult {
  scripts: Array<{ path: string; className: string }>;
  remotes: Array<{ path: string; parentServiceName: string }>;
  hiddenInstances: Array<{ path: string; reason: string }>;
}

function collectInstances(
  node: InstanceNode,
  result: CollectResult,
  options: { scanRemotes: boolean; scanHidden: boolean },
  parentPath?: string,
  parentServiceName?: string,
): void {
  const path = getPath(node, parentPath);
  const isService = !parentPath;
  const serviceName = isService ? node.name : (parentServiceName ?? "");

  const isScript =
    node.className === "Script" ||
    node.className === "LocalScript" ||
    node.className === "ModuleScript";

  if (isScript) {
    result.scripts.push({ path, className: node.className });
  }

  if (
    options.scanRemotes &&
    (node.className === "RemoteEvent" || node.className === "RemoteFunction")
  ) {
    result.remotes.push({ path, parentServiceName: serviceName });
  }

  if (options.scanHidden) {
    const archivable = node.properties?.["Archivable"];
    if (archivable === false) {
      result.hiddenInstances.push({ path, reason: "Archivable=false" });
    }
  }

  for (const child of node.children) {
    collectInstances(child, result, options, path, isService ? node.name : serviceName);
  }
}

registerTool({
  name: "rbx_security_scan_deep",
  description:
    "Scan for loadstring, require abuse, backdoors, hidden remotes, admin surfaces, and trust violations",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const root = await client.getDataModel();
    const issues: AuditIssue[] = [];

    const collected: CollectResult = {
      scripts: [],
      remotes: [],
      hiddenInstances: [],
    };

    collectInstances(root, collected, {
      scanRemotes: input.scan_remotes,
      scanHidden: input.scan_hidden,
    });

    let scriptsScanned = 0;

    if (input.scan_scripts) {
      for (const { path, className } of collected.scripts) {
        let source: string;
        try {
          const result = await client.getScriptSource(path);
          source = result.source;
          scriptsScanned++;
        } catch {
          continue;
        }

        for (const { rule, re, severity, suggestion } of DANGEROUS_PATTERNS) {
          if (re.test(source)) {
            issues.push({
              severity,
              rule,
              message: `${className} "${path}" contains pattern: ${rule}`,
              path,
              suggestion,
            });
          }
        }
      }
    }

    if (input.scan_remotes) {
      for (const { path, parentServiceName } of collected.remotes) {
        if (!SAFE_REMOTE_PARENTS.has(parentServiceName)) {
          issues.push({
            severity: "high",
            rule: "remote_unusual_location",
            message: `Remote "${path}" is located outside ReplicatedStorage/ReplicatedFirst (in "${parentServiceName}").`,
            path,
            suggestion:
              "Move RemoteEvents/RemoteFunctions to ReplicatedStorage or ReplicatedFirst to follow standard patterns.",
          });
        }
      }
    }

    if (input.scan_hidden) {
      for (const { path, reason } of collected.hiddenInstances) {
        issues.push({
          severity: "low",
          rule: "hidden_instance",
          message: `Instance "${path}" has ${reason} — informational, not necessarily a security issue`,
          path,
          suggestion: "Verify this instance is intentionally non-archivable; confirm it does not conceal unexpected logic.",
        });
      }
    }

    // Risk score: weighted by severity
    const weights: Record<AuditIssue["severity"], number> = {
      critical: 30,
      high: 15,
      medium: 8,
      low: 3,
    };
    const rawScore = issues.reduce((sum, issue) => sum + weights[issue.severity], 0);
    const riskScore = Math.min(100, rawScore);

    return createResponseEnvelope(
      {
        scripts_scanned: scriptsScanned,
        remotes_scanned: collected.remotes.length,
        issues,
        risk_score: riskScore,
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

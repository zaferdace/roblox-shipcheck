import { z } from "zod";
import { OpenCloudClient } from "../../roblox/open-cloud-client.js";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import {
  createResponseEnvelope,
  defaultMobileScreens,
  readScriptSource,
  sourceInfo,
  traverseInstances,
} from "../../shared.js";
import type { AuditSeverity, InstanceNode, ReleaseReadinessCheck } from "../../types/roblox.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { analyzeDataStoreSchema } from "./datastore-schema-guard.js";
import { analyzeLocalizationCoverage } from "./localization-coverage.js";
import { analyzeMarketplaceCompliance } from "./marketplace-compliance.js";
import { registerTool } from "../registry.js";
import { analyzeRemoteContracts } from "./remote-contract-audit.js";
import { analyzeMobileUi } from "./validate-mobile-ui.js";

const checkNames = [
  "audit",
  "mobile",
  "remotes",
  "datastores",
  "marketplace",
  "localization",
] as const satisfies readonly ReleaseReadinessCheck[];

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  api_key: z.string().min(1).optional(),
  universe_id: z.string().min(1).optional(),
  required_checks: z.array(z.enum(checkNames)).default([...checkNames]),
  thresholds: z
    .object({
      min_overall_score: z.number().min(0).max(100).default(70),
      max_high_severity_issues: z.number().int().min(0).default(0),
    })
    .default({
      min_overall_score: 70,
      max_high_severity_issues: 0,
    }),
});

interface GateIssue {
  severity: AuditSeverity;
  check: ReleaseReadinessCheck;
  path: string;
  rule: string;
  message: string;
  suggestion?: string;
}

interface GateCheckResult {
  name: ReleaseReadinessCheck;
  score: number;
  issue_counts: Record<AuditSeverity, number>;
  pass: boolean;
}

interface ReleaseReadinessResult {
  verdict: "SHIP" | "HOLD";
  overall_score: number;
  checks: GateCheckResult[];
  blocking_issues: GateIssue[];
  recommendations: string[];
}

function makeIssueCounts(
  issues: Array<{ severity: AuditSeverity }>,
): Record<AuditSeverity, number> {
  return issues.reduce(
    (acc, issue) => {
      acc[issue.severity] += 1;
      return acc;
    },
    { low: 0, medium: 0, high: 0 },
  );
}

function normalizeIssues(check: ReleaseReadinessCheck, issues: unknown[]): GateIssue[] {
  const normalized: GateIssue[] = [];
  for (const rawIssue of issues) {
    if (!rawIssue || typeof rawIssue !== "object") {
      continue;
    }
    const issue = rawIssue as Record<string, unknown>;
    const severity = issue["severity"];
    if (severity !== "low" && severity !== "medium" && severity !== "high") {
      continue;
    }
    const path =
      typeof issue["remote_path"] === "string"
        ? issue["remote_path"]
        : typeof issue["script_path"] === "string"
          ? issue["script_path"]
          : typeof issue["element_path"] === "string"
            ? issue["element_path"]
            : check;
    normalized.push({
      severity,
      check,
      path,
      rule: typeof issue["rule"] === "string" ? issue["rule"] : "unknown",
      message: typeof issue["message"] === "string" ? issue["message"] : "Issue detected.",
      ...(typeof issue["suggestion"] === "string" ? { suggestion: issue["suggestion"] } : {}),
    });
  }
  return normalized;
}

function analyzePrepublishLight(root: InstanceNode): { score: number; issues: GateIssue[] } {
  const issues: GateIssue[] = [];
  let unanchoredParts = 0;
  traverseInstances(root, (node, currentPath) => {
    const source = readScriptSource(node);
    if (source && /(api[_-]?key|roblosecurity|secret)\s*=\s*["'][^"']+["']/iu.test(source)) {
      issues.push({
        severity: "high",
        check: "audit",
        path: currentPath,
        rule: "embedded_secret",
        message: "Possible secret embedded directly in script source.",
        suggestion: "Remove secrets from scripts and load them from a secure external boundary.",
      });
    }
    if (source && /LoadLibrary\s*\(/u.test(source)) {
      issues.push({
        severity: "high",
        check: "audit",
        path: currentPath,
        rule: "loadlibrary",
        message: "LoadLibrary usage detected.",
        suggestion: "Replace dynamic library loads with pinned local modules.",
      });
    }
    if (
      ["Part", "MeshPart", "UnionOperation", "BasePart"].includes(node.className) &&
      node.properties?.["Anchored"] === false
    ) {
      unanchoredParts += 1;
    }
    if (
      (node.className === "Script" || node.className === "ModuleScript") &&
      source &&
      source.length > 10_000
    ) {
      issues.push({
        severity: "medium",
        check: "audit",
        path: currentPath,
        rule: "large_script",
        message: `Large script detected (${source.length} characters).`,
        suggestion: "Split long scripts into focused modules before release.",
      });
    }
  });
  if (unanchoredParts > 200) {
    issues.push({
      severity: "medium",
      check: "audit",
      path: "Workspace",
      rule: "unanchored_parts",
      message: `${unanchoredParts} unanchored parts detected.`,
      suggestion: "Anchor non-physical parts and review expensive physics objects.",
    });
  }
  const score = Math.max(
    0,
    100 - issues.reduce((sum, issue) => sum + (issue.severity === "high" ? 20 : 10), 0),
  );
  return { score, issues };
}

export async function runReleaseReadinessGate(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<ReleaseReadinessResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = await client.getDataModel();
  const openCloudClient =
    input.api_key && input.universe_id ? new OpenCloudClient(input.api_key) : undefined;
  const checks: GateCheckResult[] = [];
  const aggregatedIssues: GateIssue[] = [];

  for (const check of input.required_checks) {
    if (check === "audit") {
      const result = analyzePrepublishLight(root);
      aggregatedIssues.push(...result.issues);
      checks.push({
        name: check,
        score: result.score,
        issue_counts: makeIssueCounts(result.issues),
        pass: result.score >= 70 && result.issues.every((issue) => issue.severity !== "high"),
      });
      continue;
    }
    if (check === "mobile") {
      const result = await analyzeMobileUi(root, {
        screens: defaultMobileScreens(),
        minTouchTarget: 44,
        minFontSize: 11,
        checkSafeArea: true,
      });
      const normalized = normalizeIssues(check, result.issues as unknown[]);
      aggregatedIssues.push(...normalized);
      checks.push({
        name: check,
        score: result.score,
        issue_counts: makeIssueCounts(normalized),
        pass: result.score >= 70 && normalized.every((issue) => issue.severity !== "high"),
      });
      continue;
    }
    if (check === "remotes") {
      const result = analyzeRemoteContracts(root, {
        rootPath: "game",
        checkPayloadValidation: true,
        checkRateLimiting: true,
        checkTrustBoundary: true,
      });
      const normalized = normalizeIssues(check, result.issues as unknown[]);
      aggregatedIssues.push(...normalized);
      checks.push({
        name: check,
        score: result.score,
        issue_counts: makeIssueCounts(normalized),
        pass: result.score >= 70 && normalized.every((issue) => issue.severity !== "high"),
      });
      continue;
    }
    if (check === "datastores") {
      const result = analyzeDataStoreSchema(root, {
        rootPath: "ServerScriptService",
        checkPcallWrapping: true,
        checkKeyPatterns: true,
        checkRetryLogic: true,
        checkBudgetAwareness: true,
      });
      const normalized = normalizeIssues(check, result.issues as unknown[]);
      aggregatedIssues.push(...normalized);
      checks.push({
        name: check,
        score: result.score,
        issue_counts: makeIssueCounts(normalized),
        pass: result.score >= 70 && normalized.every((issue) => issue.severity !== "high"),
      });
      continue;
    }
    if (check === "marketplace") {
      const result = await analyzeMarketplaceCompliance(root, {
        checkReceiptHandling: true,
        checkProductReferences: true,
        checkFailoverUx: true,
        ...(openCloudClient ? { openCloudClient } : {}),
      });
      const normalized = normalizeIssues(check, result.issues as unknown[]);
      aggregatedIssues.push(...normalized);
      checks.push({
        name: check,
        score: result.score,
        issue_counts: makeIssueCounts(normalized),
        pass: result.score >= 70 && normalized.every((issue) => issue.severity !== "high"),
      });
      continue;
    }
    if (check === "localization") {
      const result = analyzeLocalizationCoverage(root, {
        rootPaths: ["StarterGui", "ReplicatedStorage"],
        checkHardcodedText: true,
        checkLocalizationTable: true,
        checkDynamicStrings: true,
      });
      const normalized = normalizeIssues(check, result.issues as unknown[]);
      aggregatedIssues.push(...normalized);
      checks.push({
        name: check,
        score: result.score,
        issue_counts: makeIssueCounts(normalized),
        pass: result.score >= 70 && normalized.every((issue) => issue.severity !== "high"),
      });
    }
  }

  const overallScore =
    checks.length === 0
      ? 100
      : Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
  const highSeverityIssues = aggregatedIssues.filter((issue) => issue.severity === "high");
  const verdict =
    overallScore >= input.thresholds.min_overall_score &&
    highSeverityIssues.length <= input.thresholds.max_high_severity_issues
      ? "SHIP"
      : "HOLD";
  const recommendations = [
    ...new Set(
      aggregatedIssues
        .map((issue) => issue.suggestion)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];

  return createResponseEnvelope(
    {
      verdict,
      overall_score: overallScore,
      checks,
      blocking_issues: highSeverityIssues,
      recommendations,
    },
    {
      source: sourceInfo({
        studio_port: input.studio_port,
        ...(input.universe_id ? { universe_id: input.universe_id } : {}),
      }),
      warnings: openCloudClient
        ? []
        : ["Open Cloud cross-reference checks were skipped for marketplace validation."],
    },
  );
}

registerTool({
  name: "rbx_release_readiness_gate",
  description:
    "Aggregate multiple project health checks into a single Roblox ship or hold readiness verdict.",
  schema,
  handler: runReleaseReadinessGate,
});

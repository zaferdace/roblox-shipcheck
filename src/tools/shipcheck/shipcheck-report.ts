import { writeFile } from "node:fs/promises";
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
import type { InstanceNode, RobloxPropertyValue } from "../../types/roblox.js";
import type { ShipcheckIssue, ShipcheckReport } from "../../types/shipcheck.js";
import { analyzeContentMaturity } from "./content-maturity-check.js";
import { analyzeDataStoreSchema } from "./datastore-schema-guard.js";
import { analyzeLocalizationCoverage } from "./localization-coverage.js";
import { analyzeMarketplaceCompliance } from "./marketplace-compliance.js";
import { analyzeRemoteContracts } from "./remote-contract-audit.js";
import { analyzeMobileUi } from "./validate-mobile-ui.js";
import { registerTool } from "../registry.js";

const checkNames = [
  "content_maturity",
  "remote_contract_security",
  "datastore_safety",
  "mobile_ui_readiness",
  "localization_coverage",
  "marketplace_compliance",
  "teleport_graph",
  "package_drift",
  "accessibility",
  "performance_hotspots",
] as const;

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  api_key: z.string().min(1).optional(),
  universe_id: z.string().min(1).optional(),
  output_format: z.enum(["json", "markdown", "both"]).default("both"),
  output_path: z.string().min(1).optional(),
  checks: z.array(z.enum(checkNames)).optional(),
});

interface ShipcheckToolResult {
  report: ShipcheckReport;
  markdown?: string;
  files_written?: string[];
}

function severityFromAudit(severity: "low" | "medium" | "high"): ShipcheckIssue["severity"] {
  if (severity === "high") {
    return "blocker";
  }
  if (severity === "medium") {
    return "warning";
  }
  return "info";
}

function issueId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function toShipcheckIssues(
  prefix: string,
  sourceCheck: string,
  issues: Array<{
    severity: "low" | "medium" | "high";
    rule: string;
    message: string;
    suggestion: string;
    element_path?: string;
    script_path?: string;
    remote_path?: string;
  }>,
  category: string,
): ShipcheckIssue[] {
  return issues.map((issue, index) => {
    const target = issue.element_path ?? issue.script_path ?? issue.remote_path ?? "DataModel";
    return {
      id: issueId(prefix, index),
      title: issue.rule.replaceAll("_", " "),
      summary: issue.message,
      severity: severityFromAudit(issue.severity),
      confidence: issue.severity === "high" ? "high" : "medium",
      category,
      evidence: [`Target: ${target}`],
      recommendation: issue.suggestion,
      remediation: issue.severity === "high" ? "assisted" : "manual",
      source_check: sourceCheck,
    };
  });
}

function getProjectName(root: InstanceNode, universeInfo?: Record<string, unknown>): string {
  const displayName = universeInfo?.["displayName"];
  if (typeof displayName === "string" && displayName.trim().length > 0) {
    return displayName;
  }
  const name = universeInfo?.["name"];
  if (typeof name === "string" && name.trim().length > 0) {
    return name;
  }
  return root.name;
}

function getNumber(value: RobloxPropertyValue | undefined, key: string): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const nested = value[key];
  return typeof nested === "number" ? nested : null;
}

function contrastRatio(
  foreground: RobloxPropertyValue | undefined,
  background: RobloxPropertyValue | undefined,
): number | null {
  if (
    typeof foreground !== "object" ||
    foreground === null ||
    Array.isArray(foreground) ||
    typeof background !== "object" ||
    background === null ||
    Array.isArray(background)
  ) {
    return null;
  }
  const fr = typeof foreground["r"] === "number" ? foreground["r"] : null;
  const fg = typeof foreground["g"] === "number" ? foreground["g"] : null;
  const fb = typeof foreground["b"] === "number" ? foreground["b"] : null;
  const br = typeof background["r"] === "number" ? background["r"] : null;
  const bg = typeof background["g"] === "number" ? background["g"] : null;
  const bb = typeof background["b"] === "number" ? background["b"] : null;
  if (fr === null || fg === null || fb === null || br === null || bg === null || bb === null) {
    return null;
  }
  const fgLum =
    0.2126 * channelLuminance(fr) + 0.7152 * channelLuminance(fg) + 0.0722 * channelLuminance(fb);
  const bgLum =
    0.2126 * channelLuminance(br) + 0.7152 * channelLuminance(bg) + 0.0722 * channelLuminance(bb);
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

function channelLuminance(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function auditAccessibility(root: InstanceNode): ShipcheckIssue[] {
  const issues: ShipcheckIssue[] = [];
  traverseInstances(root, (node, currentPath) => {
    const properties = node.properties ?? {};
    if (/Button|TextBox/u.test(node.className)) {
      const width = getNumber(properties["AbsoluteSize"], "x");
      const height = getNumber(properties["AbsoluteSize"], "y");
      if ((width ?? 0) > 0 && (height ?? 0) > 0 && ((width ?? 0) < 44 || (height ?? 0) < 44)) {
        issues.push({
          id: issueId("accessibility-touch", issues.length),
          title: "Touch target below guideline",
          summary: `${currentPath} appears smaller than the 44px touch target guideline.`,
          severity: "warning",
          confidence: "medium",
          category: "accessibility",
          evidence: [`Path: ${currentPath}`, `Size: ${width ?? 0}x${height ?? 0}`],
          recommendation: "Increase the control size or add larger tappable padding.",
          remediation: "assisted",
          source_check: "rbx_shipcheck_report",
        });
      }
    }
    if (/TextLabel|TextButton|TextBox/u.test(node.className)) {
      const textSize = typeof properties["TextSize"] === "number" ? properties["TextSize"] : null;
      if (textSize !== null && textSize < 12 && properties["TextScaled"] !== true) {
        issues.push({
          id: issueId("accessibility-text", issues.length),
          title: "Text readability risk",
          summary: `${currentPath} uses small text without scaling.`,
          severity: "warning",
          confidence: "medium",
          category: "accessibility",
          evidence: [`Path: ${currentPath}`, `TextSize: ${textSize}`],
          recommendation:
            "Increase TextSize or enable TextScaled after validating layout behavior.",
          remediation: "assisted",
          source_check: "rbx_shipcheck_report",
        });
      }
      const ratio = contrastRatio(properties["TextColor3"], properties["BackgroundColor3"]);
      if (ratio !== null && ratio < 4.5) {
        issues.push({
          id: issueId("accessibility-contrast", issues.length),
          title: "Low text contrast detected",
          summary: `${currentPath} appears to fall below a 4.5:1 text contrast ratio.`,
          severity: "blocker",
          confidence: "medium",
          category: "accessibility",
          evidence: [`Path: ${currentPath}`, `Contrast ratio: ${ratio.toFixed(2)}`],
          recommendation: "Adjust foreground or background colors to improve readability.",
          remediation: "assisted",
          source_check: "rbx_shipcheck_report",
        });
      }
    }
  });
  return issues;
}

function auditPerformance(root: InstanceNode): ShipcheckIssue[] {
  const issues: ShipcheckIssue[] = [];
  let partCount = 0;
  let scriptCount = 0;
  let unanchoredParts = 0;
  let guiCount = 0;

  traverseInstances(root, (node, currentPath, depth) => {
    if (["Part", "MeshPart", "UnionOperation", "BasePart"].includes(node.className)) {
      partCount += 1;
      if (node.properties?.["Anchored"] === false) {
        unanchoredParts += 1;
      }
    }
    if (["Script", "ModuleScript", "LocalScript"].includes(node.className)) {
      scriptCount += 1;
      const source = readScriptSource(node);
      if (source && source.length > 10000) {
        issues.push({
          id: issueId("performance-script", issues.length),
          title: "Large script detected",
          summary: `${currentPath} contains a large script source body.`,
          severity: "warning",
          confidence: "medium",
          category: "performance",
          evidence: [`Path: ${currentPath}`, `Source length: ${source.length}`],
          recommendation:
            "Split large scripts into focused modules and reduce hot-path complexity.",
          remediation: "assisted",
          source_check: "rbx_shipcheck_report",
        });
      }
    }
    if (
      node.className.endsWith("Gui") ||
      node.className.endsWith("Label") ||
      node.className.endsWith("Button")
    ) {
      guiCount += 1;
      if (depth > 8) {
        issues.push({
          id: issueId("performance-gui", issues.length),
          title: "Deep UI hierarchy detected",
          summary: `${currentPath} sits deep in the UI tree and may cost extra layout work.`,
          severity: "info",
          confidence: "medium",
          category: "performance",
          evidence: [`Path: ${currentPath}`, `Depth: ${depth}`],
          recommendation: "Flatten deeply nested UI where practical.",
          remediation: "manual",
          source_check: "rbx_shipcheck_report",
        });
      }
    }
  });

  if (partCount > 5000) {
    issues.push({
      id: issueId("performance-parts", issues.length),
      title: "High part count",
      summary: `Workspace-scale part count is high at ${partCount}.`,
      severity: "blocker",
      confidence: "medium",
      category: "performance",
      evidence: [`Part count: ${partCount}`],
      recommendation: "Reduce part count or apply streaming and instancing strategies.",
      remediation: "assisted",
      source_check: "rbx_shipcheck_report",
    });
  }
  if (unanchoredParts > 200) {
    issues.push({
      id: issueId("performance-physics", issues.length),
      title: "High unanchored physics count",
      summary: `${unanchoredParts} parts are unanchored, which may increase physics cost.`,
      severity: "warning",
      confidence: "medium",
      category: "performance",
      evidence: [`Unanchored parts: ${unanchoredParts}`],
      recommendation: "Anchor decorative parts and reduce unnecessary physics simulation.",
      remediation: "assisted",
      source_check: "rbx_shipcheck_report",
    });
  }
  if (scriptCount > 500) {
    issues.push({
      id: issueId("performance-script-count", issues.length),
      title: "High script count",
      summary: `${scriptCount} scripts were detected in the DataModel.`,
      severity: "warning",
      confidence: "medium",
      category: "performance",
      evidence: [`Script count: ${scriptCount}`],
      recommendation:
        "Consolidate entry points and move shared logic into modules where appropriate.",
      remediation: "manual",
      source_check: "rbx_shipcheck_report",
    });
  }
  if (guiCount > 1000) {
    issues.push({
      id: issueId("performance-gui-count", issues.length),
      title: "High GUI count",
      summary: `${guiCount} GUI-related instances were detected.`,
      severity: "info",
      confidence: "medium",
      category: "performance",
      evidence: [`GUI count: ${guiCount}`],
      recommendation: "Review large GUI trees for redundant containers and off-screen content.",
      remediation: "manual",
      source_check: "rbx_shipcheck_report",
    });
  }

  return issues;
}

async function auditTeleportGraph(
  client: StudioBridgeClient,
  apiKey?: string,
  universeId?: string,
): Promise<ShipcheckIssue[]> {
  const raw = (await client.getTeleportGraph()) as {
    edges?: Array<{ from_script?: string; to_place_id?: string; source?: string }>;
  };
  const issues: ShipcheckIssue[] = [];
  const placeIds = new Set<string>();
  for (const edge of raw.edges ?? []) {
    if (typeof edge.to_place_id === "string") {
      placeIds.add(edge.to_place_id);
    }
    if (typeof edge.source === "string" && !/pcall|retry|TeleportInitFailed/u.test(edge.source)) {
      issues.push({
        id: issueId("teleport-error", issues.length),
        title: "Teleport flow lacks visible error handling",
        summary: `${edge.from_script ?? "TeleportService usage"} may not handle teleport failures.`,
        severity: "info",
        confidence: "medium",
        category: "teleport",
        evidence: [
          `From: ${edge.from_script ?? "unknown"}`,
          ...(typeof edge.to_place_id === "string" ? [`PlaceId: ${edge.to_place_id}`] : []),
        ],
        recommendation: "Add retry handling and failure UX around TeleportService calls.",
        remediation: "assisted",
        source_check: "rbx_shipcheck_report",
      });
    }
  }

  if (apiKey && universeId && placeIds.size > 0) {
    const openCloudClient = new OpenCloudClient(apiKey);
    const knownPlaces = new Set<string>();
    const places = await openCloudClient.listPlaces(universeId);
    for (const place of places) {
      const path = typeof place.path === "string" ? place.path : "";
      const placeId = path.split("/").pop();
      if (placeId) {
        knownPlaces.add(placeId);
      }
    }
    for (const placeId of placeIds) {
      if (!knownPlaces.has(placeId)) {
        issues.push({
          id: issueId("teleport-place", issues.length),
          title: "Teleport target not found in universe",
          summary: `PlaceId ${placeId} was not found through Open Cloud for the provided universe.`,
          severity: "blocker",
          confidence: "high",
          category: "teleport",
          evidence: [`PlaceId: ${placeId}`, `UniverseId: ${universeId}`],
          recommendation: "Update stale PlaceId references or remove dead teleport targets.",
          remediation: "assisted",
          source_check: "rbx_shipcheck_report",
        });
      }
    }
  }

  return issues;
}

async function auditPackageDrift(client: StudioBridgeClient): Promise<ShipcheckIssue[]> {
  const raw = (await client.getPackageInfo()) as {
    packages?: Array<{
      path?: string;
      package_id?: string;
      version_number?: number;
      auto_update?: boolean;
    }>;
  };
  const issues: ShipcheckIssue[] = [];
  const byPackage = new Map<string, number[]>();

  for (const entry of raw.packages ?? []) {
    if (typeof entry.path !== "string" || typeof entry.package_id !== "string") {
      continue;
    }
    if (entry.auto_update === false) {
      issues.push({
        id: issueId("package-autoupdate", issues.length),
        title: "Package auto-update disabled",
        summary: `${entry.path} is linked to a package without auto-update enabled.`,
        severity: "warning",
        confidence: "medium",
        category: "packages",
        evidence: [`Path: ${entry.path}`, `PackageId: ${entry.package_id}`],
        recommendation: "Enable auto-update or document the deliberate fork strategy.",
        remediation: "manual",
        source_check: "rbx_shipcheck_report",
      });
    }
    const versions = byPackage.get(entry.package_id) ?? [];
    if (typeof entry.version_number === "number") {
      versions.push(entry.version_number);
    }
    byPackage.set(entry.package_id, versions);
  }

  for (const [packageId, versions] of byPackage.entries()) {
    if (new Set(versions).size > 1) {
      issues.push({
        id: issueId("package-drift", issues.length),
        title: "Package version drift detected",
        summary: `Package ${packageId} appears at multiple versions in the project.`,
        severity: "blocker",
        confidence: "high",
        category: "packages",
        evidence: [`PackageId: ${packageId}`, `Versions: ${[...new Set(versions)].join(", ")}`],
        recommendation: "Align all linked instances to the same package version before shipping.",
        remediation: "assisted",
        source_check: "rbx_shipcheck_report",
      });
    }
  }

  return issues;
}

function escapeMd(text: string): string {
  return text.replace(/[#|`<>]/g, (ch) => `\\${ch}`).replace(/\n/g, " ");
}

function formatMarkdown(report: ShipcheckReport): string {
  const sections: Array<{ label: string; severity: ShipcheckIssue["severity"]; emoji: string }> = [
    { label: "Blockers", severity: "blocker", emoji: "🔴" },
    { label: "Warnings", severity: "warning", emoji: "🟡" },
    { label: "Info", severity: "info", emoji: "ℹ️" },
  ];
  const lines = [
    `# Shipcheck Report — ${report.project_name}`,
    `**Date:** ${report.timestamp}`,
    `**Verdict:** ${report.verdict} — Score: ${report.overall_score}/100`,
    "",
    "## Summary",
    `- 🔴 Blockers: ${report.summary.blockers}`,
    `- 🟡 Warnings: ${report.summary.warnings}`,
    `- ℹ️ Info: ${report.summary.info}`,
    `- 👁 Manual review needed: ${report.summary.manual_review_needed}`,
    "",
    "## Issues",
    "",
  ];

  for (const section of sections) {
    lines.push(`### ${section.emoji} ${section.label}`);
    const issues = report.issues.filter((issue) => issue.severity === section.severity);
    if (issues.length === 0) {
      lines.push("No issues.");
      lines.push("");
      continue;
    }
    for (const issue of issues) {
      lines.push(`#### [${escapeMd(issue.id)}] ${escapeMd(issue.title)}`);
      lines.push(
        `**Confidence:** ${issue.confidence} | **Category:** ${issue.category} | **Remediation:** ${issue.remediation}`,
      );
      lines.push(escapeMd(issue.summary));
      lines.push(`**Evidence:** ${issue.evidence.map(escapeMd).join("; ") || "None"}`);
      lines.push(`**Recommendation:** ${escapeMd(issue.recommendation)}`);
      lines.push("");
    }
  }

  lines.push("## Checks Run");
  for (const check of report.checks_run) {
    lines.push(`- ${check}`);
  }
  return lines.join("\n");
}

registerTool({
  name: "rbx_shipcheck_report",
  description:
    "Run a unified ship-readiness report across security, quality, compliance, accessibility, and performance checks.",
  schema,
  handler: async (input) => {
    const selectedChecks = input.checks ?? [...checkNames];
    const client = new StudioBridgeClient({ port: input.studio_port });
    await client.ping();
    const root = await client.getDataModel();

    const openCloudClient =
      input.api_key && input.universe_id ? new OpenCloudClient(input.api_key) : undefined;
    const universeInfo =
      openCloudClient && input.universe_id
        ? await openCloudClient.getExperienceInfo(input.universe_id)
        : undefined;

    const issues: ShipcheckIssue[] = [];

    if (selectedChecks.includes("content_maturity")) {
      const contentResult = analyzeContentMaturity(root, {
        checkViolence: true,
        checkLanguage: true,
        checkSocial: true,
        checkGambling: true,
        ...(universeInfo ? { metadata: universeInfo } : {}),
      });
      issues.push(...contentResult.issues);
    }
    if (selectedChecks.includes("remote_contract_security")) {
      const remoteResult = analyzeRemoteContracts(root, {
        rootPath: "game",
        checkPayloadValidation: true,
        checkRateLimiting: true,
        checkTrustBoundary: true,
      });
      issues.push(
        ...toShipcheckIssues(
          "remote",
          "rbx_remote_contract_audit",
          remoteResult.issues,
          "security",
        ),
      );
    }
    if (selectedChecks.includes("datastore_safety")) {
      const datastoreResult = analyzeDataStoreSchema(root, {
        rootPath: "ServerScriptService",
        checkPcallWrapping: true,
        checkKeyPatterns: true,
        checkRetryLogic: true,
        checkBudgetAwareness: true,
      });
      issues.push(
        ...toShipcheckIssues(
          "datastore",
          "rbx_datastore_schema_guard",
          datastoreResult.issues,
          "data",
        ),
      );
    }
    if (selectedChecks.includes("mobile_ui_readiness")) {
      const mobileResult = await analyzeMobileUi(root, {
        screens: defaultMobileScreens(),
        minTouchTarget: 44,
        minFontSize: 11,
        checkSafeArea: true,
      });
      issues.push(
        ...toShipcheckIssues("mobile", "rbx_validate_mobile_ui", mobileResult.issues, "mobile"),
      );
    }
    if (selectedChecks.includes("localization_coverage")) {
      const localizationResult = analyzeLocalizationCoverage(root, {
        rootPaths: ["StarterGui", "ReplicatedStorage"],
        checkHardcodedText: true,
        checkLocalizationTable: true,
        checkDynamicStrings: true,
      });
      issues.push(
        ...toShipcheckIssues(
          "localization",
          "rbx_localization_coverage_audit",
          localizationResult.issues,
          "localization",
        ),
      );
    }
    if (selectedChecks.includes("marketplace_compliance")) {
      const marketplaceResult = await analyzeMarketplaceCompliance(root, {
        checkReceiptHandling: true,
        checkProductReferences: true,
        checkFailoverUx: true,
        ...(openCloudClient ? { openCloudClient } : {}),
      });
      issues.push(
        ...toShipcheckIssues(
          "marketplace",
          "rbx_marketplace_compliance_audit",
          marketplaceResult.issues,
          "marketplace",
        ),
      );
    }
    if (selectedChecks.includes("teleport_graph")) {
      issues.push(...(await auditTeleportGraph(client, input.api_key, input.universe_id)));
    }
    if (selectedChecks.includes("package_drift")) {
      issues.push(...(await auditPackageDrift(client)));
    }
    if (selectedChecks.includes("accessibility")) {
      issues.push(...auditAccessibility(root));
    }
    if (selectedChecks.includes("performance_hotspots")) {
      issues.push(...auditPerformance(root));
    }

    const blockers = issues.filter((issue) => issue.severity === "blocker").length;
    const warnings = issues.filter((issue) => issue.severity === "warning").length;
    const info = issues.filter((issue) => issue.severity === "info").length;
    const manualReviewNeeded = issues.filter(
      (issue) => issue.confidence === "manual_review",
    ).length;
    const verdict =
      blockers > 0 ? "HOLD" : warnings <= 2 && manualReviewNeeded === 0 ? "SHIP" : "REVIEW";
    const overallScore = Math.max(0, Math.min(100, 100 - blockers * 25 - warnings * 10 - info * 2));

    const report: ShipcheckReport = {
      project_name: getProjectName(root, universeInfo),
      timestamp: new Date().toISOString(),
      verdict,
      overall_score: overallScore,
      summary: {
        blockers,
        warnings,
        info,
        manual_review_needed: manualReviewNeeded,
      },
      issues,
      checks_run: selectedChecks.map((check) => check),
    };

    const markdown = input.output_format === "json" ? undefined : formatMarkdown(report);
    const filesWritten: string[] = [];

    if (input.output_path) {
      if (input.output_format === "json") {
        await writeFile(input.output_path, JSON.stringify(report, null, 2), "utf8");
        filesWritten.push(input.output_path);
      } else if (input.output_format === "markdown") {
        await writeFile(input.output_path, markdown ?? "", "utf8");
        filesWritten.push(input.output_path);
      } else {
        await writeFile(input.output_path, markdown ?? "", "utf8");
        await writeFile(`${input.output_path}.json`, JSON.stringify(report, null, 2), "utf8");
        filesWritten.push(input.output_path, `${input.output_path}.json`);
      }
    }

    return createResponseEnvelope<ShipcheckToolResult>(
      {
        report,
        ...(markdown ? { markdown } : {}),
        ...(filesWritten.length > 0 ? { files_written: filesWritten } : {}),
      },
      {
        source: sourceInfo({
          studio_port: input.studio_port,
          ...(input.universe_id ? { universe_id: input.universe_id } : {}),
        }),
        warnings: openCloudClient
          ? []
          : ["Open Cloud metadata-backed checks were skipped where applicable."],
      },
    );
  },
});

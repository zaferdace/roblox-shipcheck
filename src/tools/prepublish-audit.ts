import { z } from "zod";
import { OpenCloudClient } from "../roblox/open-cloud-client.js";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import {
  createResponseEnvelope,
  readScriptSource,
  scoreFromIssues,
  sourceInfo,
  summarizeIssues,
  traverseInstances,
  type AuditIssue,
} from "../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../types/roblox.js";
import { analyzeMobileUi } from "./validate-mobile-ui.js";
import { registerTool } from "./registry.js";

const categorySchema = z.enum(["security", "performance", "quality", "mobile", "accessibility"]);

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  api_key: z.string().min(1).optional(),
  universe_id: z.string().min(1).optional(),
  categories: z
    .array(categorySchema)
    .default(["security", "performance", "quality", "mobile", "accessibility"]),
});

registerTool({
  name: "rbx_prepublish_audit",
  description:
    "Run a categorized Roblox pre-publish audit across security, quality, mobile, and performance.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    await client.ping();
    const root = await client.getDataModel();
    const categoryResults: Array<{
      name: string;
      score: number;
      issues: AuditIssue[];
      summary: string;
    }> = [];
    const recommendations = new Set<string>();
    let universeInfo: Record<string, unknown> | undefined;

    if (input.api_key && input.universe_id) {
      const openCloud = new OpenCloudClient(input.api_key);
      universeInfo = await openCloud.getExperienceInfo(input.universe_id);
    }

    for (const category of input.categories) {
      if (category === "security") {
        const issues = auditSecurity(root);
        issues.forEach((issue) => recommendations.add(issue.suggestion));
        categoryResults.push({
          name: category,
          score: scoreFromIssues(issues),
          issues,
          summary: summarizeIssues(issues),
        });
      } else if (category === "performance") {
        const issues = auditPerformance(root);
        issues.forEach((issue) => recommendations.add(issue.suggestion));
        categoryResults.push({
          name: category,
          score: scoreFromIssues(issues),
          issues,
          summary: summarizeIssues(issues),
        });
      } else if (category === "quality") {
        const issues = auditQuality(root, universeInfo);
        issues.forEach((issue) => recommendations.add(issue.suggestion));
        categoryResults.push({
          name: category,
          score: scoreFromIssues(issues),
          issues,
          summary: summarizeIssues(issues),
        });
      } else if (category === "mobile") {
        const mobile = await analyzeMobileUi(root, {
          screens: [
            { name: "iPhone SE", width: 375, height: 667 },
            { name: "iPhone 14 Pro", width: 393, height: 852 },
          ],
          minTouchTarget: 44,
          minFontSize: 11,
          checkSafeArea: true,
        });
        mobile.issues.forEach((issue) => recommendations.add(issue.suggestion));
        categoryResults.push({
          name: category,
          score: mobile.score,
          issues: mobile.issues,
          summary: mobile.summary,
        });
      } else if (category === "accessibility") {
        const issues = auditAccessibility(root);
        issues.forEach((issue) => recommendations.add(issue.suggestion));
        categoryResults.push({
          name: category,
          score: scoreFromIssues(issues),
          issues,
          summary: summarizeIssues(issues),
        });
      }
    }

    const overallScore =
      categoryResults.length === 0
        ? 100
        : Math.round(
            categoryResults.reduce((sum, entry) => sum + entry.score, 0) / categoryResults.length,
          );

    return createResponseEnvelope(
      {
        overall_score: overallScore,
        categories: categoryResults,
        recommendations: [...recommendations],
      },
      {
        source: sourceInfo({
          studio_port: input.studio_port,
          ...(input.universe_id ? { universe_id: input.universe_id } : {}),
        }),
        warnings:
          !input.api_key || !input.universe_id ? ["Open Cloud metadata checks skipped."] : [],
      },
    );
  },
});

function auditSecurity(root: InstanceNode): AuditIssue[] {
  const issues: AuditIssue[] = [];
  traverseInstances(root, (node, currentPath) => {
    if (node.className === "HttpService" && node.properties?.["HttpEnabled"] === true) {
      issues.push({
        severity: "medium",
        element_path: currentPath,
        rule: "http_enabled",
        message: "HttpService is enabled.",
        suggestion: "Document external calls and ensure endpoints are necessary and secured.",
      });
    }
    const source = readScriptSource(node);
    if (node.className === "RemoteEvent" || node.className === "RemoteFunction") {
      if (!/validated|servercheck|sanitiz/iu.test(node.name)) {
        issues.push({
          severity: "medium",
          element_path: currentPath,
          rule: "remote_validation",
          message: "Remote endpoint name does not indicate validation or sanitization flow.",
          suggestion: "Review server-side validation for all client-originating payloads.",
        });
      }
    }
    if (!source) {
      return;
    }
    if (/(api[_-]?key|roblosecurity|secret)\s*=\s*["'][^"']+["']/iu.test(source)) {
      issues.push({
        severity: "high",
        element_path: currentPath,
        rule: "embedded_secret",
        message: "Possible secret or API key embedded directly in script source.",
        suggestion: "Remove secrets from scripts and inject them through secure external systems.",
      });
    }
    if (/LoadLibrary\s*\(/u.test(source)) {
      issues.push({
        severity: "high",
        element_path: currentPath,
        rule: "loadlibrary",
        message: "LoadLibrary usage detected.",
        suggestion: "Replace dynamic library loading with versioned local modules.",
      });
    }
  });
  return issues;
}

function auditPerformance(root: InstanceNode): AuditIssue[] {
  const issues: AuditIssue[] = [];
  let partCount = 0;
  let unanchoredParts = 0;
  let scriptCount = 0;
  traverseInstances(root, (node, currentPath, depth) => {
    if (["Part", "MeshPart", "UnionOperation", "BasePart"].includes(node.className)) {
      partCount += 1;
      if (node.properties?.["Anchored"] === false) {
        unanchoredParts += 1;
      }
    }
    if (["Script", "LocalScript", "ModuleScript"].includes(node.className)) {
      scriptCount += 1;
      const source = readScriptSource(node);
      if (source && source.length > 10_000) {
        issues.push({
          severity: "medium",
          element_path: currentPath,
          rule: "large_script",
          message: `Script source is ${source.length} characters long.`,
          suggestion:
            "Split large scripts into focused modules to reduce maintenance and compile overhead.",
        });
      }
    }
    if (node.className === "ScreenGui" && depth > 6) {
      issues.push({
        severity: "low",
        element_path: currentPath,
        rule: "deep_ui_nesting",
        message: `UI hierarchy depth ${depth} may increase layout cost.`,
        suggestion: "Flatten UI hierarchy where possible.",
      });
    }
  });
  if (partCount > 5000) {
    issues.push({
      severity: "high",
      element_path: "Workspace",
      rule: "part_count",
      message: `Workspace contains ${partCount} parts.`,
      suggestion: "Reduce part count or use streaming and instancing patterns.",
    });
  }
  if (unanchoredParts > 200) {
    issues.push({
      severity: "medium",
      element_path: "Workspace",
      rule: "unanchored_parts",
      message: `${unanchoredParts} parts are unanchored.`,
      suggestion: "Anchor decorative geometry and review unnecessary physics simulation.",
    });
  }
  if (scriptCount > 500) {
    issues.push({
      severity: "medium",
      element_path: "DataModel",
      rule: "script_count",
      message: `${scriptCount} scripts detected.`,
      suggestion: "Consolidate script entry points and move shared logic into modules.",
    });
  }
  return issues;
}

function auditQuality(root: InstanceNode, universeInfo?: Record<string, unknown>): AuditIssue[] {
  const issues: AuditIssue[] = [];
  traverseInstances(root, (node, currentPath) => {
    if (node.name === node.className || /^Part\d*$/u.test(node.name)) {
      issues.push({
        severity: "low",
        element_path: currentPath,
        rule: "generic_name",
        message: `Instance name "${node.name}" is generic.`,
        suggestion: "Rename instances to reflect purpose and ownership.",
      });
    }
    const source = readScriptSource(node);
    if (source !== null && source.trim().length === 0) {
      issues.push({
        severity: "low",
        element_path: currentPath,
        rule: "empty_script",
        message: "Script is empty.",
        suggestion: "Remove empty scripts or add the intended implementation.",
      });
    }
    if (source && /\b(wait|spawn|delay)\s*\(/u.test(source)) {
      issues.push({
        severity: "medium",
        element_path: currentPath,
        rule: "deprecated_api_usage",
        message: "Legacy scheduling API usage detected.",
        suggestion: "Prefer task.wait, task.spawn, and task.delay.",
      });
    }
  });
  if (universeInfo) {
    const description = universeInfo["description"];
    if (typeof description !== "string" || description.trim().length === 0) {
      issues.push({
        severity: "medium",
        element_path: "Universe",
        rule: "missing_description",
        message: "Experience description is empty.",
        suggestion: "Add a concise public-facing description before publishing.",
      });
    }
  }
  return issues;
}

function auditAccessibility(root: InstanceNode): AuditIssue[] {
  const issues: AuditIssue[] = [];
  traverseInstances(root, (node, currentPath) => {
    const props = node.properties ?? {};
    if (["TextLabel", "TextButton", "TextBox"].includes(node.className)) {
      const textSize = props["TextSize"];
      if (typeof textSize === "number" && textSize < 12) {
        issues.push({
          severity: "medium",
          element_path: currentPath,
          rule: "small_text",
          message: `Text size ${textSize} may be hard to read.`,
          suggestion: "Increase text size or strengthen contrast for accessibility.",
        });
      }
      const contrast = estimateContrast(props["TextColor3"], props["BackgroundColor3"]);
      if (contrast !== null && contrast < 4.5) {
        issues.push({
          severity: "medium",
          element_path: currentPath,
          rule: "contrast",
          message: `Estimated contrast ratio ${contrast.toFixed(2)} is below 4.5.`,
          suggestion: "Adjust text and background colors to improve readability.",
        });
      }
    }
    if (["ImageButton", "ImageLabel"].includes(node.className)) {
      const alt = props["AccessibleDescription"] ?? props["AltText"];
      if (typeof alt !== "string" || alt.trim().length === 0) {
        issues.push({
          severity: "low",
          element_path: currentPath,
          rule: "missing_alt_text",
          message: "Image UI element lacks accessible description metadata.",
          suggestion: "Populate AccessibleDescription or equivalent descriptive metadata.",
        });
      }
    }
    if (["TextButton", "ImageButton"].includes(node.className) && props["Selectable"] === false) {
      issues.push({
        severity: "low",
        element_path: currentPath,
        rule: "keyboard_navigation",
        message: "Interactive UI element is not selectable for keyboard/gamepad navigation.",
        suggestion: "Enable Selectable or define explicit selection behavior.",
      });
    }
  });
  return issues;
}

function estimateContrast(
  foreground: RobloxPropertyValue | undefined,
  background: RobloxPropertyValue | undefined,
): number | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) {
    return null;
  }
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function parseColor(
  value: RobloxPropertyValue | undefined,
): { r: number; g: number; b: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["r"] === "number" &&
    typeof record["g"] === "number" &&
    typeof record["b"] === "number"
  ) {
    return { r: record["r"], g: record["g"], b: record["b"] };
  }
  return null;
}

function relativeLuminance(color: { r: number; g: number; b: number }): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel > 1 ? channel / 255 : channel;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

import { z } from "zod";
import { OpenCloudClient } from "../../roblox/open-cloud-client.js";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import {
  createResponseEnvelope,
  readScriptSource,
  sourceInfo,
  traverseInstances,
} from "../../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../../types/roblox.js";
import type { IssueConfidence, IssueSeverity, ShipcheckIssue } from "../../types/shipcheck.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  api_key: z.string().min(1).optional(),
  universe_id: z.string().min(1).optional(),
  check_violence: z.boolean().default(true),
  check_language: z.boolean().default(true),
  check_social: z.boolean().default(true),
  check_gambling: z.boolean().default(true),
});

interface RiskAreaSummary {
  findings: number;
  flagged: boolean;
  confidence: IssueConfidence;
}

interface ContentMaturityResult {
  issues: ShipcheckIssue[];
  risk_areas: {
    violence: RiskAreaSummary;
    language: RiskAreaSummary;
    social: RiskAreaSummary;
    gambling: RiskAreaSummary;
  };
  recommendation: string;
}

interface ContentMaturityOptions {
  checkViolence: boolean;
  checkLanguage: boolean;
  checkSocial: boolean;
  checkGambling: boolean;
  metadata?: Record<string, unknown>;
}

interface MatchDefinition {
  title: string;
  category: string;
  pattern: RegExp;
  severity: IssueSeverity;
  confidence: IssueConfidence;
  recommendation: string;
}

const violencePatterns: MatchDefinition[] = [
  {
    title: "Violence-related keywords detected",
    category: "violence",
    pattern: /\b(kill|death|blood|weapon|damage|explode|gun|sword|fight)\b/giu,
    severity: "warning",
    confidence: "heuristic",
    recommendation:
      "Review combat and damage presentation manually against Roblox content maturity guidance.",
  },
];

const languagePatterns: MatchDefinition[] = [
  {
    title: "Potential profanity or bypass logic detected",
    category: "language",
    pattern:
      /\b(profanity|swear|curse|uncensor|filter.?bypass|bypass.?filter|unfiltered|badword)\b/giu,
    severity: "warning",
    confidence: "manual_review",
    recommendation:
      "Review chat, text input, and moderation handling manually to confirm language safety.",
  },
];

const socialPatterns: MatchDefinition[] = [
  {
    title: "External social or link reference detected",
    category: "social",
    pattern:
      /\b(discord|twitter|x\.com|youtube|tiktok|instagram|http:\/\/|https:\/\/|www\.|discord\.gg)\b/giu,
    severity: "warning",
    confidence: "manual_review",
    recommendation:
      "Verify all external references, community links, and off-platform messaging for policy compliance.",
  },
];

const gamblingPatterns: MatchDefinition[] = [
  {
    title: "Random reward or chance mechanic keywords detected",
    category: "gambling",
    pattern:
      /\b(lootbox|gacha|spin|gamble|odds|chance|crate|roulette|jackpot|egg|roll|draw|pull|reroll)\b/giu,
    severity: "warning",
    confidence: "manual_review",
    recommendation:
      "Review random reward mechanics, especially monetized flows, before release and confirm compliance manually.",
  },
  {
    title: "Monetized random reward pattern detected",
    category: "gambling",
    pattern:
      /\b(robux|PromptProductPurchase|PromptPurchase|developer product|gamepass)\b[\s\S]{0,200}\b(random|chance|spin|crate|loot|gacha|egg|roll|draw|pull|reroll)\b/giu,
    severity: "warning",
    confidence: "manual_review",
    recommendation:
      "Manually review purchase flows that may combine paid access with randomized rewards.",
  },
];

function renderValue(value: RobloxPropertyValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function collectGuiTextEvidence(node: InstanceNode): string[] {
  const properties = node.properties ?? {};
  const textFields = ["Text", "PlaceholderText", "Title", "ContentText"];
  const evidence: string[] = [];
  for (const field of textFields) {
    const value = renderValue(properties[field]);
    if (value.trim().length > 0) {
      evidence.push(`${field}: ${value.slice(0, 140)}`);
    }
  }
  return evidence;
}

function extractMatches(content: string, pattern: RegExp): string[] {
  const matches = new Set<string>();
  let match = pattern.exec(content);
  while (match) {
    const value = match[0]?.trim();
    if (value) {
      matches.add(value.slice(0, 80));
    }
    match = pattern.exec(content);
  }
  pattern.lastIndex = 0;
  return [...matches];
}

function pushIssues(
  issues: ShipcheckIssue[],
  category: string,
  path: string,
  content: string,
  definitions: MatchDefinition[],
): void {
  for (const definition of definitions) {
    const matches = extractMatches(content, definition.pattern);
    if (matches.length === 0) {
      continue;
    }
    issues.push({
      id: `content-${category}-${issues.length + 1}`,
      title: definition.title,
      summary: `${path} contains heuristic signals related to ${category}.`,
      severity: definition.severity,
      confidence: definition.confidence,
      category,
      evidence: [`Path: ${path}`, ...matches.slice(0, 5).map((match) => `Matched: ${match}`)],
      recommendation: definition.recommendation,
      remediation: "manual",
      source_check: "rbx_content_maturity_check",
    });
  }
}

function summarizeRiskArea(issues: ShipcheckIssue[], category: string): RiskAreaSummary {
  const matching = issues.filter((issue) => issue.category === category);
  const hasManualReview = matching.some((issue) => issue.confidence === "manual_review");
  return {
    findings: matching.length,
    flagged: matching.length > 0,
    confidence: hasManualReview ? "manual_review" : "heuristic",
  };
}

function metadataStrings(metadata: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values.push(`${key}: ${String(value)}`);
      continue;
    }
    if (value && typeof value === "object") {
      values.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return values;
}

export function analyzeContentMaturity(
  root: InstanceNode,
  options: ContentMaturityOptions,
): ContentMaturityResult {
  const issues: ShipcheckIssue[] = [];

  traverseInstances(root, (node, currentPath) => {
    const source = readScriptSource(node);
    if (source) {
      if (options.checkViolence) {
        pushIssues(issues, "violence", currentPath, source, violencePatterns);
      }
      if (options.checkLanguage) {
        pushIssues(issues, "language", currentPath, source, languagePatterns);
      }
      if (options.checkSocial) {
        pushIssues(issues, "social", currentPath, source, socialPatterns);
      }
      if (options.checkGambling) {
        pushIssues(issues, "gambling", currentPath, source, gamblingPatterns);
      }
    }

    const guiEvidence = collectGuiTextEvidence(node);
    if (guiEvidence.length === 0) {
      return;
    }
    const combined = guiEvidence.join("\n");
    if (options.checkLanguage) {
      pushIssues(issues, "language", currentPath, combined, languagePatterns);
    }
    if (options.checkSocial) {
      pushIssues(issues, "social", currentPath, combined, socialPatterns);
    }
    if (options.checkGambling) {
      pushIssues(issues, "gambling", currentPath, combined, gamblingPatterns);
    }
  });

  if (options.metadata) {
    const combinedMetadata = metadataStrings(options.metadata).join("\n");
    if (
      /\b(age|maturity|content|rating|violence|blood|gambling|social|language)\b/iu.test(
        combinedMetadata,
      )
    ) {
      issues.push({
        id: `content-metadata-${issues.length + 1}`,
        title: "Experience metadata includes content rating signals",
        summary:
          "Open Cloud metadata contains age-rating or content descriptors that should be reviewed together with in-experience content.",
        severity: "info",
        confidence: "manual_review",
        category: "metadata",
        evidence: metadataStrings(options.metadata).slice(0, 6),
        recommendation:
          "Confirm your configured age guidance and disclosure settings match the shipped experience content.",
        remediation: "manual",
        source_check: "rbx_content_maturity_check",
      });
    }
  }

  const riskAreas = {
    violence: summarizeRiskArea(issues, "violence"),
    language: summarizeRiskArea(issues, "language"),
    social: summarizeRiskArea(issues, "social"),
    gambling: summarizeRiskArea(issues, "gambling"),
  };

  const flaggedCategories = Object.entries(riskAreas)
    .filter(([, summary]) => summary.flagged)
    .map(([name]) => name);

  return {
    issues,
    risk_areas: riskAreas,
    recommendation:
      flaggedCategories.length === 0
        ? "No obvious content maturity keywords were detected, but a manual content review is still recommended before shipping."
        : `Manual review recommended for: ${flaggedCategories.join(", ")}.`,
  };
}

registerTool({
  name: "rbx_content_maturity_check",
  description:
    "Flag heuristic content maturity risks across scripts, UI text, and optional experience metadata.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    await client.ping();
    const root = await client.getDataModel();

    let metadata: Record<string, unknown> | undefined;
    if (input.api_key && input.universe_id) {
      const openCloudClient = new OpenCloudClient(input.api_key);
      metadata = await openCloudClient.getExperienceInfo(input.universe_id);
    }

    const result = analyzeContentMaturity(root, {
      checkViolence: input.check_violence,
      checkLanguage: input.check_language,
      checkSocial: input.check_social,
      checkGambling: input.check_gambling,
      ...(metadata ? { metadata } : {}),
    });

    return createResponseEnvelope(result, {
      source: sourceInfo({
        studio_port: input.studio_port,
        ...(input.universe_id ? { universe_id: input.universe_id } : {}),
      }),
      warnings:
        input.api_key && input.universe_id ? [] : ["Open Cloud age-rating metadata check skipped."],
    });
  },
});

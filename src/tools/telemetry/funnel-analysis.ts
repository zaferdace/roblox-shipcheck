import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, readScriptSource, sourceInfo, traverseInstances } from "../../shared.js";
import type { AuditIssue } from "../../shared.js";
import type { InstanceNode } from "../../types/roblox.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  funnel_type: z
    .enum(["tutorial", "shop", "quest", "onboarding", "custom"])
    .default("tutorial"),
  studio_port: z.number().int().positive().default(33796),
});

interface FunnelStep {
  label: string;
  script_path: string;
  pattern_found: string;
}

interface FunnelAnalysisResult {
  funnel_steps: FunnelStep[];
  potential_dropoffs: string[];
  has_analytics: boolean;
  issues: AuditIssue[];
  recommendations: string[];
}

const FUNNEL_KEYWORDS: Record<string, string[]> = {
  tutorial: ["tutorial", "intro", "guide", "onboard", "hint", "tip", "welcome"],
  shop: ["shop", "store", "purchase", "buy", "product", "marketplace", "catalog"],
  quest: ["quest", "mission", "task", "objective", "challenge", "bounty"],
  onboarding: ["onboard", "firsttime", "newplayer", "welcome", "start"],
  custom: ["step", "stage", "phase", "checkpoint", "progress"],
};

const STEP_PATTERNS = [
  /Step\s*\d+/i,
  /Stage\s*\d+/i,
  /Phase\s*\d+/i,
  /state\s*=\s*\d+/i,
  /currentStep/i,
  /progressTo/i,
  /checkpoint/i,
];

const DROPOFF_PATTERNS = [
  { pattern: /WaitForChild\s*\([^)]+,\s*\d+\)/g, label: "Timed WaitForChild — may silently fail" },
  { pattern: /task\.wait\(\d{2,}\)/g, label: "Long task.wait delay — player may quit" },
  { pattern: /yield|coroutine\.yield/g, label: "Coroutine yield without feedback" },
  { pattern: /:\s*Destroy\s*\(\s*\)/g, label: "UI destruction without completion check" },
];

const ANALYTICS_PATTERNS = [
  /AnalyticsService/,
  /LogEvent/,
  /TrackEvent/,
  /FireEvent/,
  /analytics/i,
];

function findFunnelScripts(
  root: InstanceNode,
  keywords: string[],
): Array<{ path: string; source: string }> {
  const found: Array<{ path: string; source: string }> = [];
  traverseInstances(root, (node, currentPath) => {
    const source = readScriptSource(node);
    if (!source) return;
    const lowerName = node.name.toLowerCase();
    const lowerSource = source.toLowerCase();
    const isRelevant =
      keywords.some((kw) => lowerName.includes(kw)) ||
      keywords.some((kw) => lowerSource.includes(kw));
    if (isRelevant) {
      found.push({ path: currentPath, source });
    }
  });
  return found;
}

function extractFunnelSteps(scripts: Array<{ path: string; source: string }>): FunnelStep[] {
  const steps: FunnelStep[] = [];
  for (const { path, source } of scripts) {
    for (const pattern of STEP_PATTERNS) {
      const matches = source.match(pattern);
      if (matches) {
        for (const match of matches) {
          if (!steps.some((s) => s.script_path === path && s.pattern_found === match)) {
            steps.push({ label: match.trim(), script_path: path, pattern_found: match });
          }
        }
        break;
      }
    }
  }
  return steps;
}

function findDropoffs(scripts: Array<{ path: string; source: string }>): string[] {
  const dropoffs = new Set<string>();
  for (const { path, source } of scripts) {
    for (const { pattern, label } of DROPOFF_PATTERNS) {
      if (pattern.test(source)) {
        dropoffs.add(`${label} in ${path}`);
      }
      pattern.lastIndex = 0;
    }
  }
  return [...dropoffs];
}

function checkAnalytics(scripts: Array<{ path: string; source: string }>): boolean {
  return scripts.some(({ source }) => ANALYTICS_PATTERNS.some((p) => p.test(source)));
}

function buildIssues(
  steps: FunnelStep[],
  hasAnalytics: boolean,
  dropoffs: string[],
  funnelType: string,
): AuditIssue[] {
  const issues: AuditIssue[] = [];

  if (steps.length === 0) {
    issues.push({
      severity: "medium",
      element_path: "DataModel",
      rule: "no_funnel_steps_found",
      message: `No ${funnelType} funnel step patterns found in scripts.`,
      suggestion: "Add clearly named step/stage markers or state transitions to track funnel flow.",
    });
  }

  if (!hasAnalytics) {
    issues.push({
      severity: "medium",
      element_path: "DataModel",
      rule: "no_analytics",
      message: "No AnalyticsService usage detected in funnel scripts.",
      suggestion: "Instrument funnel steps with AnalyticsService:LogEvent to measure drop-off rates.",
    });
  }

  for (const dropoff of dropoffs) {
    issues.push({
      severity: "low",
      element_path: dropoff,
      rule: "potential_dropoff",
      message: `Potential player drop-off point detected: ${dropoff}`,
      suggestion: "Add visual feedback or progress indicators around this point.",
    });
  }

  return issues;
}

function buildRecommendations(
  steps: FunnelStep[],
  hasAnalytics: boolean,
  funnelType: string,
): string[] {
  const recs: string[] = [];

  if (steps.length < 3) {
    recs.push(`Add at least 3 explicit ${funnelType} steps to accurately measure completion rates.`);
  }

  if (!hasAnalytics) {
    recs.push("Integrate AnalyticsService to track step completion and identify drop-off points.");
  }

  if (funnelType === "tutorial") {
    recs.push("Ensure each tutorial step has a clear visual cue and success confirmation.");
    recs.push("Consider a skip option for returning players to reduce friction.");
  }

  if (funnelType === "shop") {
    recs.push("Track add-to-cart and purchase-complete separately to identify conversion bottlenecks.");
  }

  if (steps.length > 0) {
    recs.push(`${steps.length} step pattern(s) found — verify they cover the full funnel flow.`);
  }

  return recs;
}

registerTool({
  name: "rbx_funnel_analysis",
  description:
    "Analyze tutorial, shop, and quest completion funnels by inspecting UI flow and script checkpoints",
  schema,
  handler: async (input): Promise<ResponseEnvelope<FunnelAnalysisResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const root = await client.getDataModel();

    const keywords: string[] = FUNNEL_KEYWORDS[input.funnel_type] ?? FUNNEL_KEYWORDS["custom"] ?? [];
    const scripts = findFunnelScripts(root, keywords);
    const funnelSteps = extractFunnelSteps(scripts);
    const potentialDropoffs = findDropoffs(scripts);
    const hasAnalytics = checkAnalytics(scripts);
    const issues = buildIssues(funnelSteps, hasAnalytics, potentialDropoffs, input.funnel_type);
    const recommendations = buildRecommendations(funnelSteps, hasAnalytics, input.funnel_type);

    return createResponseEnvelope(
      {
        funnel_steps: funnelSteps,
        potential_dropoffs: potentialDropoffs,
        has_analytics: hasAnalytics,
        issues,
        recommendations,
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

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

interface GapAnalysis {
  avg_gap_studs: string;
  max_gap_studs: string;
  min_gap_studs: string;
}

interface DifficultyRampResult {
  stages_found: number;
  gap_analysis: GapAnalysis;
  killbrick_density: string;
  difficulty_curve: string;
  issues: AuditIssue[];
}

export async function runDifficultyRamp(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<DifficultyRampResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const issues: AuditIssue[] = [];

  const stageMatches = await client.searchInstances({
    query: "Stage",
    search_type: "name",
    case_sensitive: false,
    max_results: 300,
  });
  const stageArray: StudioSearchMatch[] = Array.isArray(stageMatches) ? stageMatches : [];
  const stagesFound = stageArray.length;

  const killbrickMatches = await client.searchInstances({
    query: "KillBrick",
    search_type: "name",
    case_sensitive: false,
    max_results: 300,
  });
  const killbrickArray: StudioSearchMatch[] = Array.isArray(killbrickMatches) ? killbrickMatches : [];

  const killPartMatches = await client.searchInstances({
    query: "Kill",
    search_type: "name",
    case_sensitive: false,
    max_results: 200,
  });
  const killPartArray: StudioSearchMatch[] = Array.isArray(killPartMatches) ? killPartMatches : [];

  const totalKillbricks = killbrickArray.length + killPartArray.length;

  const platformMatches = await client.searchInstances({
    query: "Platform",
    search_type: "name",
    case_sensitive: false,
    max_results: 300,
  });
  const platformArray: StudioSearchMatch[] = Array.isArray(platformMatches) ? platformMatches : [];

  let gapAnalysis: GapAnalysis = {
    avg_gap_studs: "unknown",
    max_gap_studs: "unknown",
    min_gap_studs: "unknown",
  };

  const positionedPlatforms: Array<{ x: number; y: number; z: number }> = [];
  for (const match of platformArray.slice(0, 50)) {
    try {
      const props = await client.getProperties(match.path);
      const pos = props["Position"];
      if (pos && typeof pos === "object" && !Array.isArray(pos)) {
        const x = typeof pos["x"] === "number" ? pos["x"] : null;
        const y = typeof pos["y"] === "number" ? pos["y"] : null;
        const z = typeof pos["z"] === "number" ? pos["z"] : null;
        if (x !== null && y !== null && z !== null) {
          positionedPlatforms.push({ x, y, z });
        }
      }
    } catch {
      continue;
    }
  }

  if (positionedPlatforms.length >= 2) {
    const sorted = positionedPlatforms.sort((a, b) => a.z - b.z);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev && curr) {
        const dx = curr.x - prev.x;
        const dz = curr.z - prev.z;
        gaps.push(Math.sqrt(dx * dx + dz * dz));
      }
    }
    if (gaps.length > 0) {
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const max = Math.max(...gaps);
      const min = Math.min(...gaps);
      gapAnalysis = {
        avg_gap_studs: avg.toFixed(1),
        max_gap_studs: max.toFixed(1),
        min_gap_studs: min.toFixed(1),
      };

      const maxGap = Math.max(...gaps);
      if (maxGap > 50) {
        issues.push({
          severity: "medium",
          element_path: "Workspace",
          rule: "extreme_platform_gap",
          message: `Maximum platform gap of ${maxGap.toFixed(1)} studs detected — may be impossible to cross.`,
          suggestion: "Keep platform gaps under 50 studs for default jump height.",
        });
      }
    }
  }

  if (stagesFound > 0 && totalKillbricks === 0) {
    issues.push({
      severity: "low",
      element_path: "Workspace",
      rule: "no_killbricks",
      message: "No killbrick or kill part instances found.",
      suggestion: "Add kill parts to void/lava areas so players respawn at their last checkpoint.",
    });
  }

  const killbrickDensity =
    stagesFound > 0 ? `${(totalKillbricks / stagesFound).toFixed(2)} per stage` : `${totalKillbricks} total`;

  let difficultyCurve = "unknown";
  if (stagesFound > 10 && totalKillbricks > 0) {
    difficultyCurve = "gradual ramp detected (stages + killbricks present)";
  } else if (stagesFound > 0 && totalKillbricks === 0) {
    difficultyCurve = "flat — no killbricks to create difficulty spikes";
  } else if (stagesFound === 0) {
    difficultyCurve = "indeterminate — no stages found";
  }

  if (stagesFound > 5 && totalKillbricks > stagesFound * 3) {
    issues.push({
      severity: "medium",
      element_path: "Workspace",
      rule: "high_killbrick_density",
      message: `High killbrick density: ${totalKillbricks} kill parts across ${stagesFound} stages.`,
      suggestion: "Reduce killbrick count in early stages to allow gradual difficulty ramp.",
    });
  }

  return createResponseEnvelope(
    {
      stages_found: stagesFound,
      gap_analysis: gapAnalysis,
      killbrick_density: killbrickDensity,
      difficulty_curve: difficultyCurve,
      issues,
    },
    { source: sourceInfo({ studio_port: input.studio_port }) },
  );
}

registerTool({
  name: "rbx_obby_difficulty_ramp",
  description:
    "Analyze platform spacing, killbrick density, and difficulty progression across obby stages",
  schema,
  handler: runDifficultyRamp,
});

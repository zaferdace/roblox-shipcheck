import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../../../shared.js";
import type { AuditIssue } from "../../../../shared.js";
import type { StudioSearchMatch } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  min_platform_size_studs: z.number().min(0.1).default(4),
  max_jump_distance_studs: z.number().min(1).default(20),
});

interface MobileJumpResult {
  platforms_found: number;
  mobile_friendly_pct: number;
  issues: AuditIssue[];
}

export async function runMobileJumpAudit(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<MobileJumpResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const issues: AuditIssue[] = [];

  const platformMatches = await client.searchInstances({
    query: "Platform",
    search_type: "name",
    case_sensitive: false,
    max_results: 200,
  });
  const platformArray: StudioSearchMatch[] = Array.isArray(platformMatches) ? platformMatches : [];

  const stageMatches = await client.searchInstances({
    query: "Stage",
    search_type: "name",
    case_sensitive: false,
    max_results: 200,
  });
  const stageArray: StudioSearchMatch[] = Array.isArray(stageMatches) ? stageMatches : [];

  const allParts = [...platformArray, ...stageArray];
  const platformsFound = allParts.length;

  let friendlyCount = 0;
  let checkedCount = 0;
  const positions: Array<{ x: number; y: number; z: number }> = [];

  for (const match of allParts.slice(0, 60)) {
    try {
      const props = await client.getProperties(match.path);
      const size = props["Size"];
      const pos = props["Position"];

      if (size && typeof size === "object" && !Array.isArray(size)) {
        const sx = typeof size["x"] === "number" ? size["x"] : 0;
        const sz = typeof size["z"] === "number" ? size["z"] : 0;
        const minDim = Math.min(sx, sz);
        checkedCount++;
        if (minDim >= input.min_platform_size_studs) {
          friendlyCount++;
        } else {
          issues.push({
            severity: "low",
            element_path: match.path,
            rule: "platform_too_small_for_mobile",
            message: `Platform at ${match.path} is ${minDim.toFixed(1)} studs — below the ${input.min_platform_size_studs} stud mobile minimum.`,
            suggestion: "Widen small platforms to at least 4 studs for comfortable mobile touch play.",
          });
        }
      }

      if (pos && typeof pos === "object" && !Array.isArray(pos)) {
        const x = typeof pos["x"] === "number" ? pos["x"] : null;
        const y = typeof pos["y"] === "number" ? pos["y"] : null;
        const z = typeof pos["z"] === "number" ? pos["z"] : null;
        if (x !== null && y !== null && z !== null) {
          positions.push({ x, y, z });
        }
      }
    } catch {
      continue;
    }
  }

  if (positions.length >= 2) {
    const sorted = positions.sort((a, b) => a.z - b.z);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev && curr) {
        const dx = curr.x - prev.x;
        const dz = curr.z - prev.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > input.max_jump_distance_studs) {
          issues.push({
            severity: "medium",
            element_path: "Workspace",
            rule: "jump_distance_too_large_for_mobile",
            message: `Gap of ${dist.toFixed(1)} studs between platforms exceeds mobile jump range of ${input.max_jump_distance_studs} studs.`,
            suggestion: "Reduce platform gap or add intermediate stepping stones for mobile players.",
          });
          break;
        }
      }
    }
  }

  const mobileFriendlyPct = checkedCount > 0 ? Math.round((friendlyCount / checkedCount) * 100) : 100;

  if (mobileFriendlyPct < 80) {
    issues.push({
      severity: "medium",
      element_path: "Workspace",
      rule: "low_mobile_platform_coverage",
      message: `Only ${mobileFriendlyPct}% of platforms meet mobile size requirements.`,
      suggestion: "Expand platforms to at least 4x4 studs for reliable mobile touch input.",
    });
  }

  return createResponseEnvelope(
    {
      platforms_found: platformsFound,
      mobile_friendly_pct: mobileFriendlyPct,
      issues,
    },
    { source: sourceInfo({ studio_port: input.studio_port }) },
  );
}

registerTool({
  name: "rbx_obby_mobile_jump_audit",
  description: "Check jump distances and platform sizes for mobile playability with touch controls",
  schema,
  handler: runMobileJumpAudit,
});

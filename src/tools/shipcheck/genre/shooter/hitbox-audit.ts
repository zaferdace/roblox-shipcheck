import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo, traverseInstances } from "../../../../shared.js";
import type { InstanceNode } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
});

interface HitboxAuditIssue {
  severity: "low" | "medium" | "high";
  rule:
    | "raycast_distance_extreme"
    | "client_only_raycast"
    | "deprecated_find_part_on_ray"
    | "no_hit_detection"
    | "touching_parts_hit_detection";
  message: string;
  script_path: string;
}

interface RaycastPattern {
  path: string;
  class_name: string;
  uses_raycast: boolean;
  max_distance: number | null;
  client_only: boolean;
  uses_deprecated_find_part_on_ray: boolean;
  uses_get_touching_parts: boolean;
  has_hit_detection: boolean;
}

interface HitboxAuditResult {
  score: number;
  issues: HitboxAuditIssue[];
  raycast_patterns: RaycastPattern[];
}

const scriptClasses = new Set(["Script", "LocalScript", "ModuleScript"]);
const weaponPattern = /\b(weapon|gun|rifle|pistol|shotgun|sniper|bullet|projectile|shoot|fire)\b/iu;
const raycastPattern = /\b(Raycast|raycast)\b/u;
const hitDetectionPattern =
  /\b(Raycast|FindPartOnRay|TakeDamage|Humanoid|Touched|GetTouchingParts)\b/u;

function extractNumericLiteralsNearRaycast(source: string): number[] {
  const matches =
    source.match(/(?:Raycast|FindPartOnRay)[\s\S]{0,160}?(\d{2,6}(?:\.\d+)?)/gu) ?? [];
  const values: number[] = [];
  for (const match of matches) {
    const numbers = match.match(/\d{2,6}(?:\.\d+)?/gu) ?? [];
    for (const numberText of numbers) {
      const value = Number(numberText);
      if (!Number.isNaN(value)) {
        values.push(value);
      }
    }
  }
  return values;
}

export async function runHitboxAudit(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<HitboxAuditResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = (await client.getChildren("game", 10)) as InstanceNode;

  const scriptNodes: Array<{ path: string; className: string }> = [];
  traverseInstances(root, (node, currentPath) => {
    if (scriptClasses.has(node.className)) {
      scriptNodes.push({ path: currentPath, className: node.className });
    }
  });

  const issues: HitboxAuditIssue[] = [];
  const raycastPatterns: RaycastPattern[] = [];

  for (const scriptNode of scriptNodes) {
    let source: string;
    try {
      source = (await client.getScriptSource(scriptNode.path)).source;
    } catch {
      continue;
    }

    const usesRaycast = raycastPattern.test(source);
    const usesDeprecatedFindPartOnRay = /\bFindPartOnRay\b/u.test(source);
    const usesGetTouchingParts = /\bGetTouchingParts\b/u.test(source);
    const hasHitDetection = hitDetectionPattern.test(source);
    const numericLiterals = extractNumericLiteralsNearRaycast(source);
    const maxDistance = numericLiterals.length > 0 ? Math.max(...numericLiterals) : null;
    const clientOnly =
      scriptNode.className === "LocalScript" && (usesRaycast || usesDeprecatedFindPartOnRay);
    const looksLikeWeaponScript = weaponPattern.test(source) || weaponPattern.test(scriptNode.path);

    raycastPatterns.push({
      path: scriptNode.path,
      class_name: scriptNode.className,
      uses_raycast: usesRaycast,
      max_distance: maxDistance,
      client_only: clientOnly,
      uses_deprecated_find_part_on_ray: usesDeprecatedFindPartOnRay,
      uses_get_touching_parts: usesGetTouchingParts,
      has_hit_detection: hasHitDetection,
    });

    if (maxDistance !== null && maxDistance > 1000) {
      issues.push({
        severity: "high",
        rule: "raycast_distance_extreme",
        message: `${scriptNode.path} appears to raycast with a distance of ${maxDistance}, above 1000 studs.`,
        script_path: scriptNode.path,
      });
    }
    if (clientOnly) {
      issues.push({
        severity: "medium",
        rule: "client_only_raycast",
        message: `${scriptNode.path} performs raycasting from a LocalScript — this is a potential concern if no server validation exists, but is normal when paired with server-side verification.`,
        script_path: scriptNode.path,
      });
    }
    if (usesDeprecatedFindPartOnRay) {
      issues.push({
        severity: "medium",
        rule: "deprecated_find_part_on_ray",
        message: `${scriptNode.path} uses deprecated FindPartOnRay APIs for hit detection.`,
        script_path: scriptNode.path,
      });
    }
    if (looksLikeWeaponScript && !hasHitDetection) {
      issues.push({
        severity: "low",
        rule: "no_hit_detection",
        message: `${scriptNode.path} looks weapon-related but does not show a hit detection path.`,
        script_path: scriptNode.path,
      });
    }
    if (usesGetTouchingParts) {
      issues.push({
        severity: "low",
        rule: "touching_parts_hit_detection",
        message: `${scriptNode.path} uses GetTouchingParts for hits, which is weak for fast shooter validation.`,
        script_path: scriptNode.path,
      });
    }
  }

  return createResponseEnvelope(
    {
      score: Math.max(0, 100 - issues.length * 15),
      issues,
      raycast_patterns: raycastPatterns,
    },
    {
      source: sourceInfo({ studio_port: input.studio_port }),
    },
  );
}

registerTool({
  name: "rbx_shooter_hitbox_audit",
  description:
    "Scan shooter scripts for raycast and hitbox patterns, including extreme ranges, client-side hits, and deprecated APIs.",
  schema,
  handler: runHitboxAudit,
});

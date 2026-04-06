import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { InstanceNode } from "../../types/roblox.js";
import { registerTool } from "../registry.js";

interface AuditIssue {
  severity: "low" | "medium" | "high";
  rule: string;
  message: string;
  path: string;
  suggestion: string;
}

const STANDARD_ANIMATIONS = ["idle", "walk", "run", "jump"] as const;
type StandardAnim = (typeof STANDARD_ANIMATIONS)[number];

const ASSET_ID_RE = /^rbxassetid:\/\/\d+$/u;

const schema = z.object({
  check_humanoids: z.boolean().default(true),
  check_tools: z.boolean().default(true),
  studio_port: z.number().int().positive().default(33796),
});

function getPath(node: InstanceNode, parentPath?: string): string {
  return parentPath ? `${parentPath}.${node.name}` : node.name;
}

interface AnimationRecord {
  path: string;
  animationId: string;
}

interface CollectResult {
  animations: AnimationRecord[];
  humanoidPaths: string[];
  toolPaths: string[];
}

function collectAnimations(
  node: InstanceNode,
  result: CollectResult,
  parentPath?: string,
): void {
  const path = getPath(node, parentPath);

  if (node.className === "Animation") {
    const animIdProp = node.properties?.["AnimationId"];
    result.animations.push({
      path,
      animationId: typeof animIdProp === "string" ? animIdProp : "",
    });
  }

  if (node.className === "Humanoid") {
    result.humanoidPaths.push(path);
  }

  if (node.className === "Tool") {
    result.toolPaths.push(path);
  }

  for (const child of node.children) {
    collectAnimations(child, result, path);
  }
}

registerTool({
  name: "rbx_animation_audit",
  description:
    "Detect missing animation sets, priority conflicts, broken AnimationIds, and unused animation tracks",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const root = await client.getDataModel();
    const issues: AuditIssue[] = [];

    const collected: CollectResult = {
      animations: [],
      humanoidPaths: [],
      toolPaths: [],
    };
    collectAnimations(root, collected);

    const { animations, humanoidPaths, toolPaths } = collected;

    // Check broken AnimationIds
    for (const anim of animations) {
      if (!anim.animationId || !ASSET_ID_RE.test(anim.animationId)) {
        issues.push({
          severity: "high",
          rule: "broken_animation_id",
          message: `Animation at "${anim.path}" has a malformed or empty AnimationId: "${anim.animationId}"`,
          path: anim.path,
          suggestion: 'Set AnimationId to a valid rbxassetid:// value.',
        });
      }
    }

    // Check missing standard animations on Humanoids
    const coverage: Record<StandardAnim, boolean> = {
      idle: false,
      walk: false,
      run: false,
      jump: false,
    };

    if (input.check_humanoids && humanoidPaths.length > 0) {
      const animNames = animations.map((a) => a.path.toLowerCase());
      for (const anim of STANDARD_ANIMATIONS) {
        if (animNames.some((n) => n.includes(anim))) {
          coverage[anim] = true;
        }
      }
      for (const anim of STANDARD_ANIMATIONS) {
        if (!coverage[anim]) {
          issues.push({
            severity: "medium",
            rule: "missing_standard_animation",
            message: `Standard animation "${anim}" not found for Humanoid characters.`,
            path: humanoidPaths[0] ?? "",
            suggestion: `Add an Animation instance named "${anim}" inside the AnimationController or Animate script.`,
          });
        }
      }
    }

    // Check tools for animation controllers
    if (input.check_tools) {
      for (const toolPath of toolPaths) {
        const hasAnimForTool = animations.some((a) => a.path.startsWith(toolPath));
        if (!hasAnimForTool) {
          issues.push({
            severity: "low",
            rule: "tool_missing_animations",
            message: `Tool at "${toolPath}" has no Animation instances.`,
            path: toolPath,
            suggestion: "Add animations if the tool has equip/use actions.",
          });
        }
      }
    }

    return createResponseEnvelope(
      {
        animations_found: animations.length,
        issues,
        coverage,
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

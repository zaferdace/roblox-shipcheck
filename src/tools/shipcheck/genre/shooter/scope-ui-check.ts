import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import {
  createResponseEnvelope,
  findNodeByPath,
  sourceInfo,
  traverseInstances,
} from "../../../../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
});

interface ScopeUiCheckIssue {
  severity: "low" | "medium" | "high";
  rule: "no_scope_overlay" | "no_fov_script" | "scope_outside_screen_gui" | "no_ads_pattern";
  message: string;
  element_path?: string;
  script_path?: string;
}

interface ScopeElement {
  path: string;
  name: string;
  class_name: string;
  inside_screen_gui: boolean;
}

interface FovScript {
  path: string;
  class_name: string;
  manipulates_fov: boolean;
  has_ads_pattern: boolean;
}

interface ScopeUiCheckResult {
  score: number;
  issues: ScopeUiCheckIssue[];
  scope_elements: ScopeElement[];
  fov_scripts: FovScript[];
}

const starterGuiRoot = "game.StarterGui";
const scopeKeywords = /\b(scope|crosshair|reticle)\b/iu;
const guiClasses = new Set(["ImageLabel", "ImageButton", "Frame"]);
const scriptClasses = new Set(["Script", "LocalScript", "ModuleScript"]);

function renderString(value: RobloxPropertyValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function isDescendantOf(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}.`);
}

function hasScreenGuiAncestor(root: InstanceNode, currentPath: string): boolean {
  const segments = currentPath.split(".");
  for (let length = segments.length - 1; length > 0; length -= 1) {
    const parentPath = segments.slice(0, length).join(".");
    const node = findNodeByPath(root, parentPath);
    if (node?.className === "ScreenGui") {
      return true;
    }
  }
  return false;
}

export async function runScopeUiCheck(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<ScopeUiCheckResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = (await client.getChildren("game", 10)) as InstanceNode;

  const issues: ScopeUiCheckIssue[] = [];
  const scopeElements: ScopeElement[] = [];
  const scriptNodes: Array<{ path: string; className: string }> = [];

  traverseInstances(root, (node, currentPath) => {
    if (scriptClasses.has(node.className)) {
      scriptNodes.push({ path: currentPath, className: node.className });
    }

    if (!isDescendantOf(currentPath, starterGuiRoot) || !guiClasses.has(node.className)) {
      return;
    }

    const image = renderString(node.properties?.["Image"]);
    const candidateText = `${node.name} ${image}`;
    if (!scopeKeywords.test(candidateText)) {
      return;
    }

    const insideScreenGui = hasScreenGuiAncestor(root, currentPath);
    scopeElements.push({
      path: currentPath,
      name: node.name,
      class_name: node.className,
      inside_screen_gui: insideScreenGui,
    });

    if (!insideScreenGui) {
      issues.push({
        severity: "medium",
        rule: "scope_outside_screen_gui",
        message: `${currentPath} looks like a scope element but is not nested under a ScreenGui.`,
        element_path: currentPath,
      });
    }
  });

  const fovScripts: FovScript[] = [];
  let hasAdsPattern = false;
  for (const scriptNode of scriptNodes) {
    let source: string;
    try {
      source = (await client.getScriptSource(scriptNode.path)).source;
    } catch {
      continue;
    }

    const manipulatesFov = /\bFieldOfView\b/u.test(source);
    const adsPattern =
      /\b(MouseButton2|UserInputType\.MouseButton2|ADS|AimDownSights|right.?click|rightclick|zoom)\b/iu.test(
        source,
      );
    hasAdsPattern ||= adsPattern;

    if (manipulatesFov || adsPattern) {
      fovScripts.push({
        path: scriptNode.path,
        class_name: scriptNode.className,
        manipulates_fov: manipulatesFov,
        has_ads_pattern: adsPattern,
      });
    }
  }

  if (scopeElements.length === 0) {
    issues.push({
      severity: "medium",
      rule: "no_scope_overlay",
      message:
        "No scope, crosshair, or reticle overlay element was found under StarterGui. Note: not all snipers use an overlay, and runtime-created UI will not be detected by static analysis.",
    });
  }
  if (!fovScripts.some((script) => script.manipulates_fov)) {
    issues.push({
      severity: "high",
      rule: "no_fov_script",
      message: "No script manipulating Camera.FieldOfView was found for scoped or ADS behavior.",
    });
  }
  if (!hasAdsPattern) {
    issues.push({
      severity: "low",
      rule: "no_ads_pattern",
      message: "No obvious ADS or right-click zoom pattern was found in scripts.",
    });
  }

  return createResponseEnvelope(
    {
      score: Math.max(0, 100 - issues.length * 15),
      issues,
      scope_elements: scopeElements,
      fov_scripts: fovScripts,
    },
    {
      source: sourceInfo({ studio_port: input.studio_port }),
    },
  );
}

registerTool({
  name: "rbx_shooter_scope_ui_check",
  description:
    "Check StarterGui scope overlays and script-side FieldOfView or ADS patterns used by scoped shooter weapons.",
  schema,
  handler: runScopeUiCheck,
});

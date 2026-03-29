import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../../types/roblox.js";
import { registerTool } from "../registry.js";

interface AccessibilityIssue {
  severity: "low" | "medium" | "high";
  rule: string;
  message: string;
  element_path: string;
  suggestion: string;
}

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  check_contrast: z.boolean().default(true),
  check_touch_targets: z.boolean().default(true),
  check_text_scaling: z.boolean().default(true),
  check_navigation: z.boolean().default(true),
});

function getPath(node: InstanceNode, parentPath?: string): string {
  return parentPath ? `${parentPath}.${node.name}` : node.name;
}

function getNumber(value: RobloxPropertyValue | undefined, key: string): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const nested = value[key];
  return typeof nested === "number" ? nested : null;
}

function luminance(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
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
  const fgLum = 0.2126 * luminance(fr) + 0.7152 * luminance(fg) + 0.0722 * luminance(fb);
  const bgLum = 0.2126 * luminance(br) + 0.7152 * luminance(bg) + 0.0722 * luminance(bb);
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

registerTool({
  name: "rbx_accessibility_audit",
  description: "Audit Roblox GUI accessibility risks across touch, text, and contrast.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const root = await client.getDataModel();
    const issues: AccessibilityIssue[] = [];

    const visit = async (node: InstanceNode, parentPath?: string): Promise<void> => {
      const path = getPath(node, parentPath);
      if (
        node.className.endsWith("Gui") ||
        node.className.endsWith("Label") ||
        node.className.endsWith("Button") ||
        node.className.endsWith("Box") ||
        node.className === "ScrollingFrame" ||
        node.className === "ViewportFrame"
      ) {
        const properties = await client.getProperties(path);
        const width = getNumber(properties["AbsoluteSize"], "x");
        const height = getNumber(properties["AbsoluteSize"], "y");
        const textSize = typeof properties["TextSize"] === "number" ? properties["TextSize"] : null;
        const textScaled =
          typeof properties["TextScaled"] === "boolean" ? properties["TextScaled"] : null;
        const visible = typeof properties["Visible"] === "boolean" ? properties["Visible"] : true;
        if (visible && input.check_touch_targets && /Button|ImageButton/u.test(node.className)) {
          if ((width ?? 0) < 44 || (height ?? 0) < 44) {
            issues.push({
              severity: "medium",
              rule: "touch_target_size",
              message: `${path} is smaller than the 44px touch target guideline.`,
              element_path: path,
              suggestion: "Increase AbsoluteSize or add transparent padding around the control.",
            });
          }
        }
        if (
          visible &&
          input.check_text_scaling &&
          /TextLabel|TextButton|TextBox/u.test(node.className)
        ) {
          if (textSize !== null && textSize < 12 && textScaled !== true) {
            issues.push({
              severity: "medium",
              rule: "text_scaling",
              message: `${path} uses a small text size without text scaling.`,
              element_path: path,
              suggestion: "Raise TextSize or enable TextScaled with clipping checks.",
            });
          }
        }
        if (visible && input.check_navigation && /Button|TextBox/u.test(node.className)) {
          const backgroundTransparency =
            typeof properties["BackgroundTransparency"] === "number"
              ? properties["BackgroundTransparency"]
              : 0;
          if (backgroundTransparency >= 1) {
            issues.push({
              severity: "low",
              rule: "navigation_affordance",
              message: `${path} may not have a clear visual interactive affordance.`,
              element_path: path,
              suggestion:
                "Add a visible state, outline, or stronger contrast for interactive controls.",
            });
          }
        }
        if (
          visible &&
          input.check_contrast &&
          /TextLabel|TextButton|TextBox/u.test(node.className)
        ) {
          const ratio = contrastRatio(properties["TextColor3"], properties["BackgroundColor3"]);
          if (ratio !== null && ratio < 4.5) {
            issues.push({
              severity: "high",
              rule: "contrast_ratio",
              message: `${path} has a text/background contrast ratio below 4.5:1.`,
              element_path: path,
              suggestion: "Adjust TextColor3 or BackgroundColor3 to improve readability.",
            });
          }
        }
      }
      await Promise.all(node.children.map((child) => visit(child, path)));
    };

    await visit(root);

    const score = Math.max(0, 100 - issues.length * 8);
    const wcagLevel = issues.some((issue) => issue.rule === "contrast_ratio") ? "A" : "AA";
    return createResponseEnvelope(
      {
        score,
        issues,
        wcag_level: wcagLevel,
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

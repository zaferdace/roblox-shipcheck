import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import {
  computeGuiBounds,
  createResponseEnvelope,
  defaultMobileScreens,
  isInteractiveGui,
  overlap,
  scoreFromIssues,
  summarizeIssues,
  traverseInstances,
  type AuditIssue,
  type MobileScreenSize,
} from "../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../types/roblox.js";
import { registerTool } from "./registry.js";

const screenSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  name: z.string().min(1),
});

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  screen_sizes: z.array(screenSchema).default(defaultMobileScreens()),
  min_touch_target: z.number().positive().default(44),
  min_font_size: z.number().positive().default(11),
  check_safe_area: z.boolean().default(true),
});

interface UiElementRecord {
  node: InstanceNode;
  path: string;
  properties: Record<string, RobloxPropertyValue>;
}

export async function analyzeMobileUi(
  root: InstanceNode,
  options: {
    screens: MobileScreenSize[];
    minTouchTarget: number;
    minFontSize: number;
    checkSafeArea: boolean;
  },
): Promise<{ score: number; issues: AuditIssue[]; summary: string }> {
  const uiElements: UiElementRecord[] = [];
  traverseInstances(root, (node, currentPath) => {
    const properties = node.properties ?? {};
    if (
      currentPath.includes("StarterGui") ||
      currentPath.includes("PlayerGui") ||
      properties["AbsoluteSize"] ||
      properties["Size"]
    ) {
      uiElements.push({ node, path: currentPath, properties });
    }
  });

  const issues: AuditIssue[] = [];
  for (const screen of options.screens) {
    const boundsByPath = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const element of uiElements) {
      const bounds = computeGuiBounds(element.properties, screen);
      if (!bounds) {
        continue;
      }
      boundsByPath.set(element.path, bounds);
      if (
        isInteractiveGui(element.node.className) &&
        (bounds.width < options.minTouchTarget || bounds.height < options.minTouchTarget)
      ) {
        issues.push({
          severity: "medium",
          element_path: element.path,
          rule: "touch_target",
          message: `${screen.name}: interactive element is ${Math.round(bounds.width)}x${Math.round(bounds.height)}.`,
          suggestion: `Increase size to at least ${options.minTouchTarget}px on both axes.`,
        });
      }
      const textSize = element.properties["TextSize"];
      if (
        ["TextLabel", "TextButton", "TextBox"].includes(element.node.className) &&
        typeof textSize === "number" &&
        textSize < options.minFontSize
      ) {
        issues.push({
          severity: "medium",
          element_path: element.path,
          rule: "text_readability",
          message: `${screen.name}: text size ${textSize} is below minimum ${options.minFontSize}.`,
          suggestion: "Increase TextSize or adjust layout density for mobile.",
        });
      }
      if (options.checkSafeArea) {
        const safeTop = 44;
        const safeBottom = 34;
        if (bounds.y < safeTop || bounds.y + bounds.height > screen.height - safeBottom) {
          issues.push({
            severity: "medium",
            element_path: element.path,
            rule: "safe_area",
            message: `${screen.name}: element intrudes into unsafe top/bottom area.`,
            suggestion: "Add padding or use safe-area aware layout constraints.",
          });
        }
      }
      const size = element.properties["Size"];
      if (
        size &&
        typeof size === "object" &&
        !Array.isArray(size) &&
        typeof size["xScale"] === "number" &&
        typeof size["yScale"] === "number" &&
        (size["xScale"] > 1 || size["yScale"] > 1)
      ) {
        issues.push({
          severity: "low",
          element_path: element.path,
          rule: "aspect_ratio",
          message: `${screen.name}: element uses scale values above 1 and may overflow on narrow screens.`,
          suggestion: "Review Size scale usage and test against common mobile aspect ratios.",
        });
      }
    }

    const interactivePaths = uiElements
      .filter((element) => isInteractiveGui(element.node.className))
      .map((element) => element.path);
    for (let index = 0; index < interactivePaths.length; index += 1) {
      const firstPath = interactivePaths[index];
      const first = firstPath ? boundsByPath.get(firstPath) : undefined;
      if (!first || !firstPath) {
        continue;
      }
      for (let otherIndex = index + 1; otherIndex < interactivePaths.length; otherIndex += 1) {
        const secondPath = interactivePaths[otherIndex];
        const second = secondPath ? boundsByPath.get(secondPath) : undefined;
        if (!second || !secondPath) {
          continue;
        }
        if (overlap(first, second)) {
          issues.push({
            severity: "high",
            element_path: `${firstPath} <> ${secondPath}`,
            rule: "overlap",
            message: `${screen.name}: interactive elements overlap.`,
            suggestion: "Separate hitboxes or adjust ZIndex/layout to avoid ambiguous taps.",
          });
        }
      }
    }
  }

  const deduped = dedupeIssues(issues);
  return {
    score: scoreFromIssues(deduped),
    issues: deduped,
    summary: summarizeIssues(deduped),
  };
}

function dedupeIssues(issues: AuditIssue[]): AuditIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.element_path}:${issue.rule}:${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

registerTool({
  name: "rbx_validate_mobile_ui",
  description: "Validate Roblox UI for mobile compatibility, readability, and touch safety.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    await client.ping();
    const root = await client.getDataModel();
    const result = await analyzeMobileUi(root, {
      screens: input.screen_sizes,
      minTouchTarget: input.min_touch_target,
      minFontSize: input.min_font_size,
      checkSafeArea: input.check_safe_area,
    });
    return createResponseEnvelope(result, {
      source: { studio_port: input.studio_port },
    });
  },
});

import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo, traverseInstances } from "../../../../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  require_minimap: z.boolean().default(false),
  require_kill_feed: z.boolean().default(false),
});

interface MobileHudIssue {
  severity: "low" | "medium" | "high";
  rule:
    | "missing_ammo_display"
    | "missing_health_bar"
    | "missing_minimap"
    | "missing_kill_feed"
    | "missing_fire_button"
    | "missing_reload_button"
    | "no_touch_detection";
  message: string;
}

interface HudElements {
  ammo_display: boolean;
  health_bar: boolean;
  minimap: boolean;
  kill_feed: boolean;
  fire_button: boolean;
  reload_button: boolean;
  touch_detection: boolean;
}

interface MobileHudResult {
  score: number;
  issues: MobileHudIssue[];
  hud_elements: HudElements;
  mobile_ready: boolean;
}

const starterGuiRoot = "game.StarterGui";
const hudClasses = new Set(["ScreenGui", "Frame", "TextLabel", "TextButton", "ImageLabel", "ImageButton"]);
const scriptClasses = new Set(["Script", "LocalScript", "ModuleScript"]);

function renderString(value: RobloxPropertyValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function isDescendantOf(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}.`);
}

export async function runMobileHud(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<MobileHudResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = (await client.getChildren("game", 10)) as InstanceNode;

  const hudElements: HudElements = {
    ammo_display: false,
    health_bar: false,
    minimap: false,
    kill_feed: false,
    fire_button: false,
    reload_button: false,
    touch_detection: false,
  };

  const scriptNodes: string[] = [];
  traverseInstances(root, (node, currentPath) => {
    if (scriptClasses.has(node.className)) {
      scriptNodes.push(currentPath);
    }

    if (!isDescendantOf(currentPath, starterGuiRoot) || !hudClasses.has(node.className)) {
      return;
    }

    const text = renderString(node.properties?.["Text"]);
    const image = renderString(node.properties?.["Image"]);
    const candidateText = `${node.name} ${text} ${image}`.toLowerCase();

    if (/\bammo|mag|clip|bullet(s)?\b/u.test(candidateText)) {
      hudElements.ammo_display = true;
    }
    if (/\bhealth|hp\b/u.test(candidateText)) {
      hudElements.health_bar = true;
    }
    if (/\bmini.?map|radar\b/u.test(candidateText)) {
      hudElements.minimap = true;
    }
    if (/\bkill ?feed|eliminations?|killstreak|feed\b/u.test(candidateText)) {
      hudElements.kill_feed = true;
    }
    if (node.className === "TextButton" || node.className === "ImageButton") {
      if (/\bfire|shoot|tap ?to ?fire\b/u.test(candidateText)) {
        hudElements.fire_button = true;
      }
      if (/\breload\b/u.test(candidateText)) {
        hudElements.reload_button = true;
      }
    }
  });

  for (const scriptPath of scriptNodes) {
    let source: string;
    try {
      source = (await client.getScriptSource(scriptPath)).source;
    } catch {
      continue;
    }
    if (
      /\b(TouchEnabled|UserInputService\.TouchEnabled|TouchTap|TouchLongPress|TouchPan|TouchSwipe|Activated)\b/u.test(
        source,
      )
    ) {
      hudElements.touch_detection = true;
      break;
    }
  }

  const issues: MobileHudIssue[] = [];
  if (!hudElements.ammo_display) {
    issues.push({
      severity: "high",
      rule: "missing_ammo_display",
      message: "No ammo display was found under StarterGui for the shooter HUD.",
    });
  }
  if (!hudElements.health_bar) {
    issues.push({
      severity: "high",
      rule: "missing_health_bar",
      message: "No health bar or HP display was found under StarterGui.",
    });
  }
  if (input.require_minimap && !hudElements.minimap) {
    issues.push({
      severity: "low",
      rule: "missing_minimap",
      message: "No minimap or radar element was found under StarterGui.",
    });
  }
  if (input.require_kill_feed && !hudElements.kill_feed) {
    issues.push({
      severity: "low",
      rule: "missing_kill_feed",
      message: "No kill feed element was found under StarterGui.",
    });
  }
  if (!hudElements.fire_button) {
    issues.push({
      severity: "high",
      rule: "missing_fire_button",
      message: "No mobile fire button was found under StarterGui.",
    });
  }
  if (!hudElements.reload_button) {
    issues.push({
      severity: "medium",
      rule: "missing_reload_button",
      message: "No reload button was found under StarterGui.",
    });
  }
  if (!hudElements.touch_detection) {
    issues.push({
      severity: "low",
      rule: "no_touch_detection",
      message:
        "No script references TouchEnabled or related mobile input. Note: the Activated event works for touch without explicit TouchEnabled checks.",
    });
  }

  const mobileReady =
    hudElements.ammo_display &&
    hudElements.health_bar &&
    hudElements.fire_button &&
    hudElements.reload_button &&
    hudElements.touch_detection;

  return createResponseEnvelope(
    {
      score: Math.max(0, 100 - issues.length * 15),
      issues,
      hud_elements: hudElements,
      mobile_ready: mobileReady,
    },
    {
      source: sourceInfo({ studio_port: input.studio_port }),
    },
  );
}

registerTool({
  name: "rbx_shooter_mobile_hud",
  description:
    "Audit StarterGui for mobile shooter HUD coverage, including ammo, health, minimap, kill feed, and touch controls.",
  schema,
  handler: runMobileHud,
});

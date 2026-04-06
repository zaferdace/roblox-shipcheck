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

interface SoundCoverage {
  music: number;
  sfx: number;
  ambient: number;
  ui: number;
}

const ASSET_ID_RE = /^rbxassetid:\/\/\d+$/u;

const schema = z.object({
  volume_threshold_low: z.number().default(0.1),
  volume_threshold_high: z.number().default(1.5),
  studio_port: z.number().int().positive().default(33796),
});

function getPath(node: InstanceNode, parentPath?: string): string {
  return parentPath ? `${parentPath}.${node.name}` : node.name;
}

function classifySound(name: string): keyof SoundCoverage {
  const lower = name.toLowerCase();
  if (lower.includes("music") || lower.includes("bgm") || lower.includes("theme")) return "music";
  if (lower.includes("ambient") || lower.includes("env") || lower.includes("atmo")) return "ambient";
  if (lower.includes("ui") || lower.includes("click") || lower.includes("button") || lower.includes("menu")) return "ui";
  return "sfx";
}

function collectSounds(
  node: InstanceNode,
  sounds: Array<{ path: string; node: InstanceNode }>,
  groups: Array<{ path: string }>,
  parentPath?: string,
): void {
  const path = getPath(node, parentPath);
  if (node.className === "Sound") {
    sounds.push({ path, node });
  }
  if (node.className === "SoundGroup") {
    groups.push({ path });
  }
  for (const child of node.children) {
    collectSounds(child, sounds, groups, path);
  }
}

registerTool({
  name: "rbx_audio_audit",
  description:
    "Check sound volume consistency, missing SFX coverage, looping errors, and spatial audio configuration",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const root = await client.getDataModel();
    const issues: AuditIssue[] = [];
    const coverage: SoundCoverage = { music: 0, sfx: 0, ambient: 0, ui: 0 };

    const sounds: Array<{ path: string; node: InstanceNode }> = [];
    const groups: Array<{ path: string }> = [];
    collectSounds(root, sounds, groups, undefined);

    for (const { path, node } of sounds) {
      const props = node.properties ?? {};

      const volume = typeof props["Volume"] === "number" ? props["Volume"] : null;
      const looped = typeof props["Looped"] === "boolean" ? props["Looped"] : null;
      const soundId = typeof props["SoundId"] === "string" ? props["SoundId"] : "";
      const rollOffMode = typeof props["RollOffMode"] === "string" ? props["RollOffMode"] : null;
      const rollOffMin =
        typeof props["RollOffMinDistance"] === "number" ? props["RollOffMinDistance"] : null;
      const rollOffMax =
        typeof props["RollOffMaxDistance"] === "number" ? props["RollOffMaxDistance"] : null;
      const soundGroup =
        typeof props["SoundGroup"] === "string" ? props["SoundGroup"] : null;

      const category = classifySound(node.name);
      coverage[category]++;

      if (!soundId || !ASSET_ID_RE.test(soundId)) {
        issues.push({
          severity: "high",
          rule: "broken_sound_id",
          message: `Sound "${path}" has an empty or malformed SoundId: "${soundId}"`,
          path,
          suggestion: "Set SoundId to a valid rbxassetid:// value.",
        });
      }

      if (volume !== null && volume < input.volume_threshold_low) {
        issues.push({
          severity: "low",
          rule: "volume_too_low",
          message: `Sound "${path}" volume (${volume}) is below threshold (${input.volume_threshold_low}).`,
          path,
          suggestion: "Raise Volume or verify this is intentional (e.g. fade-in start).",
        });
      }

      if (volume !== null && volume > input.volume_threshold_high) {
        issues.push({
          severity: "medium",
          rule: "volume_too_high",
          message: `Sound "${path}" volume (${volume}) exceeds threshold (${input.volume_threshold_high}).`,
          path,
          suggestion: "Lower Volume to avoid audio clipping.",
        });
      }

      if (category === "sfx" && looped === true) {
        issues.push({
          severity: "medium",
          rule: "sfx_looping",
          message: `SFX sound "${path}" has Looped=true, which is unusual for one-shot effects.`,
          path,
          suggestion: "Set Looped=false unless intentional (e.g. engine hum).",
        });
      }

      if ((category === "music" || category === "ambient") && looped === false) {
        issues.push({
          severity: "low",
          rule: "ambient_not_looping",
          message: `${category} sound "${path}" has Looped=false and will not repeat.`,
          path,
          suggestion: "Set Looped=true for continuous music or ambient audio.",
        });
      }

      // 3D spatial audio sanity checks (sounds inside Parts/Models)
      if (rollOffMode !== null) {
        if (rollOffMin !== null && rollOffMax !== null && rollOffMin >= rollOffMax) {
          issues.push({
            severity: "medium",
            rule: "spatial_rolloff_range",
            message: `Sound "${path}" has RollOffMinDistance (${rollOffMin}) >= RollOffMaxDistance (${rollOffMax}).`,
            path,
            suggestion:
              "Ensure RollOffMinDistance < RollOffMaxDistance for correct spatial falloff.",
          });
        }
      }

      if (!soundGroup) {
        issues.push({
          severity: "low",
          rule: "no_sound_group",
          message: `Sound "${path}" is not assigned to a SoundGroup.`,
          path,
          suggestion: "Assign sounds to SoundGroups (Music, SFX, Ambient) for volume mixing control.",
        });
      }
    }

    return createResponseEnvelope(
      {
        sounds_found: sounds.length,
        issues,
        coverage,
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

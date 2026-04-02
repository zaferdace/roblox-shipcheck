import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo, traverseInstances } from "../../../../shared.js";
import type { InstanceNode } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
});

interface AnticheatSurfaceIssue {
  severity: "low" | "medium" | "high";
  rule: "no_server_raycast_validation" | "no_damage_validation" | "no_speed_detection";
  message: string;
}

interface AnticheatChecks {
  speed_validation: boolean;
  server_raycast_validation: boolean;
  teleport_detection: boolean;
  damage_validation: boolean;
  anticheat_scripts: number;
}

interface SecurityRemote {
  path: string;
  class_name: string;
}

interface AnticheatSurfaceResult {
  score: number;
  issues: AnticheatSurfaceIssue[];
  notes: string[];
  checks: AnticheatChecks;
  security_remotes: SecurityRemote[];
}

const scriptClasses = new Set(["Script", "ModuleScript"]);
const securityRemotePattern =
  /\b(anticheat|anti_cheat|security|validate|verification|sanity|guard|check)\b/iu;

function isDescendantOf(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}.`);
}

export async function runAnticheatSurface(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<AnticheatSurfaceResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = (await client.getChildren("game", 10)) as InstanceNode;

  const serverScripts: string[] = [];
  const securityRemotes: SecurityRemote[] = [];

  traverseInstances(root, (node, currentPath) => {
    if (
      scriptClasses.has(node.className) &&
      isDescendantOf(currentPath, "game.ServerScriptService")
    ) {
      serverScripts.push(currentPath);
    }

    if (
      (node.className === "RemoteEvent" || node.className === "RemoteFunction") &&
      securityRemotePattern.test(node.name)
    ) {
      securityRemotes.push({
        path: currentPath,
        class_name: node.className,
      });
    }
  });

  const checks: AnticheatChecks = {
    speed_validation: false,
    server_raycast_validation: false,
    teleport_detection: false,
    damage_validation: false,
    anticheat_scripts: 0,
  };

  for (const scriptPath of serverScripts) {
    let source: string;
    try {
      source = (await client.getScriptSource(scriptPath)).source;
    } catch {
      continue;
    }

    if (/\b(anticheat|anti_cheat|speedhack|teleport|validate|sanity|exploit)\b/iu.test(source)) {
      checks.anticheat_scripts += 1;
    }
    if (/\b(WalkSpeed|AssemblyLinearVelocity|Velocity|Magnitude)\b/u.test(source)) {
      checks.speed_validation = true;
    }
    if (
      /\bRaycast\b/u.test(source) &&
      /\b(OnServerEvent|OnServerInvoke|ServerScriptService)\b/u.test(source)
    ) {
      checks.server_raycast_validation = true;
    }
    if (
      /\b(position|Position|CFrame)\b/u.test(source) &&
      /\b(delta|magnitude|distance|teleport)\b/iu.test(source)
    ) {
      checks.teleport_detection = true;
    }
    if (
      /\b(TakeDamage|Humanoid\.Health)\b/u.test(source) &&
      /\b(OnServerEvent|Humanoid|server)\b/iu.test(source)
    ) {
      checks.damage_validation = true;
    }
  }

  const issues: AnticheatSurfaceIssue[] = [];
  const notes: string[] = [];
  if (checks.anticheat_scripts === 0) {
    notes.push(
      "No obvious anti-cheat or validation-focused server script was detected. This is informational — many games use helper modules via require() for validation logic.",
    );
  }
  if (!checks.server_raycast_validation) {
    issues.push({
      severity: "high",
      rule: "no_server_raycast_validation",
      message: "No server-side raycast validation was found in ServerScriptService scripts.",
    });
  }
  if (!checks.damage_validation) {
    issues.push({
      severity: "high",
      rule: "no_damage_validation",
      message:
        "No server-side damage validation path using TakeDamage or Humanoid.Health modification was found.",
    });
  }
  if (!checks.speed_validation) {
    issues.push({
      severity: "medium",
      rule: "no_speed_detection",
      message: "No speed or movement validation was found in ServerScriptService scripts.",
    });
  }

  return createResponseEnvelope(
    {
      score: Math.max(0, 100 - issues.length * 15),
      issues,
      notes,
      checks,
      security_remotes: securityRemotes,
    },
    {
      source: sourceInfo({ studio_port: input.studio_port }),
    },
  );
}

registerTool({
  name: "rbx_shooter_anticheat_surface",
  description:
    "Scan ServerScriptService for shooter anti-cheat coverage such as speed, raycast, teleport, and damage validation.",
  schema,
  handler: runAnticheatSurface,
});

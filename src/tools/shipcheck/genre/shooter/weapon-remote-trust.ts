import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../../../shared.js";
import type { StudioSearchMatch } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  check_rate_limiting: z.boolean().default(true),
  check_type_validation: z.boolean().default(true),
});

interface WeaponRemoteTrustIssue {
  severity: "low" | "medium";
  remote_path: string;
  rule: "no_server_handler" | "missing_type_validation" | "no_rate_limiting";
  message: string;
  suggestion: string;
  script_path?: string;
}

interface WeaponRemoteTrustResult {
  score: number;
  weapon_remotes_found: number;
  issues: WeaponRemoteTrustIssue[];
}

const searchMatchSchema = z.array(
  z.object({
    path: z.string(),
    className: z.string(),
    snippet: z.string(),
    matchType: z.enum(["name", "class", "property", "script_content"]),
  }),
);

const weaponRemotePattern =
  /\b(fire|shoot|damage|hit|reload|equip|weapon|gun|bullet|projectile)\b/iu;
const typeValidationPattern =
  /(typeof\s*\(|type\s*\(|tonumber\s*\(|tostring\s*\(|assert\s*\(|~=\s*"number"|~=\s*"string")/iu;
const rateLimitingPattern =
  /(tick\s*\(|os\.clock\s*\(|throttle|cooldown|debounce|lastFire|last_fire)/iu;

function parseMatches(raw: unknown): StudioSearchMatch[] {
  return searchMatchSchema.safeParse(raw).data ?? [];
}

function uniqueByPath(matches: StudioSearchMatch[]): StudioSearchMatch[] {
  const seen = new Set<string>();
  const deduped: StudioSearchMatch[] = [];
  for (const match of matches) {
    if (seen.has(match.path)) {
      continue;
    }
    seen.add(match.path);
    deduped.push(match);
  }
  return deduped;
}

export async function runWeaponRemoteTrust(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<WeaponRemoteTrustResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const remoteEventMatches = parseMatches(
    await client.searchInstances({
      query: "RemoteEvent",
      search_type: "class",
      case_sensitive: false,
      max_results: 200,
    }),
  );
  const remoteFunctionMatches = parseMatches(
    await client.searchInstances({
      query: "RemoteFunction",
      search_type: "class",
      case_sensitive: false,
      max_results: 200,
    }),
  );

  const weaponRemotes = uniqueByPath([...remoteEventMatches, ...remoteFunctionMatches]).filter(
    (match) => weaponRemotePattern.test(match.path),
  );
  const issues: WeaponRemoteTrustIssue[] = [];

  for (const remote of weaponRemotes) {
    const remoteName = remote.path.split(".").pop() ?? remote.path;
    const handlers = parseMatches(
      await client.searchInstances({
        query: remoteName,
        search_type: "script_content",
        case_sensitive: false,
        max_results: 50,
        root_path: "game.ServerScriptService",
      }),
    );

    if (handlers.length === 0) {
      issues.push({
        severity: "medium",
        remote_path: remote.path,
        rule: "no_server_handler",
        message: `No ServerScriptService handler referencing ${remoteName} was found.`,
        suggestion: "Add a server-side remote handler and validate weapon actions before applying them.",
      });
      continue;
    }

    let combinedSource = "";
    let firstScriptPath: string | undefined;
    for (const handler of uniqueByPath(handlers)) {
      if (!firstScriptPath) {
        firstScriptPath = handler.path;
      }
      try {
        const script = await client.getScriptSource(handler.path);
        combinedSource += `\n${script.source}`;
      } catch {
        continue;
      }
    }

    if (input.check_type_validation && !typeValidationPattern.test(combinedSource)) {
      issues.push({
        severity: "medium",
        remote_path: remote.path,
        rule: "missing_type_validation",
        message: `Handler scripts for ${remoteName} do not show clear argument type validation.`,
        suggestion: "Validate remote payload types with typeof, type, tonumber, or assert before use.",
        ...(firstScriptPath ? { script_path: firstScriptPath } : {}),
      });
    }

    if (input.check_rate_limiting && !rateLimitingPattern.test(combinedSource)) {
      issues.push({
        severity: "low",
        remote_path: remote.path,
        rule: "no_rate_limiting",
        message: `Handler scripts for ${remoteName} do not show a throttle, cooldown, or debounce.`,
        suggestion: "Add per-player fire-rate limiting to prevent remote spam.",
        ...(firstScriptPath ? { script_path: firstScriptPath } : {}),
      });
    }
  }

  return createResponseEnvelope(
    {
      score: Math.max(0, 100 - issues.length * 15),
      weapon_remotes_found: weaponRemotes.length,
      issues,
    },
    {
      source: sourceInfo({ studio_port: input.studio_port }),
    },
  );
}

registerTool({
  name: "rbx_shooter_weapon_remote_trust",
  description:
    "Audit weapon-related RemoteEvents for server-side validation and rate limiting in shooter games.",
  schema,
  handler: runWeaponRemoteTrust,
});

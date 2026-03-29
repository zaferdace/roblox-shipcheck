import { z } from "zod";
import { OpenCloudClient } from "../../roblox/open-cloud-client.js";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

interface TeleportNode {
  id: string;
  kind: "script" | "place";
}

interface TeleportEdge {
  from: string;
  to: string;
  meta?: Record<string, unknown>;
}

interface TeleportIssue {
  severity: "low" | "medium" | "high";
  rule: string;
  message: string;
  element_path: string;
  suggestion: string;
}

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  api_key: z.string().min(1).optional(),
  universe_id: z.string().min(1).optional(),
});

function pushNode(nodes: Map<string, TeleportNode>, id: string, kind: TeleportNode["kind"]): void {
  if (!nodes.has(id)) {
    nodes.set(id, { id, kind });
  }
}

async function verifyPlaces(
  apiKey: string,
  universeId: string,
  placeIds: string[],
): Promise<Set<string>> {
  const client = new OpenCloudClient(apiKey);
  const knownPlaces = new Set<string>();
  const places = await client.listPlaces(universeId);
  for (const place of places) {
    const path = typeof place.path === "string" ? place.path : "";
    const placeId = path.split("/").pop();
    if (placeId) {
      knownPlaces.add(placeId);
    }
  }
  const toCheck = placeIds.filter((placeId) => !knownPlaces.has(placeId));
  await Promise.all(
    toCheck.map(async (placeId) => {
      try {
        await client.getPlaceInfo(universeId, placeId);
        knownPlaces.add(placeId);
      } catch {
        return undefined;
      }
    }),
  );
  return knownPlaces;
}

registerTool({
  name: "rbx_teleport_graph_audit",
  description: "Audit TeleportService usage for broken targets and graph risks.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const raw = (await client.getTeleportGraph()) as {
      nodes?: Array<{ path?: string; className?: string }>;
      edges?: Array<{
        from_script?: string;
        to_place_id?: string;
        private?: boolean;
        source?: string;
      }>;
    };
    const nodeMap = new Map<string, TeleportNode>();
    const edges: TeleportEdge[] = [];
    const issues: TeleportIssue[] = [];
    const placeIds = new Set<string>();

    for (const node of raw.nodes ?? []) {
      if (typeof node.path === "string") {
        pushNode(nodeMap, node.path, "script");
      }
    }

    for (const edge of raw.edges ?? []) {
      if (typeof edge.from_script !== "string" || typeof edge.to_place_id !== "string") {
        continue;
      }
      pushNode(nodeMap, edge.from_script, "script");
      pushNode(nodeMap, edge.to_place_id, "place");
      placeIds.add(edge.to_place_id);
      edges.push({
        from: edge.from_script,
        to: edge.to_place_id,
        meta: {
          ...(edge.private ? { private: true } : {}),
          ...(typeof edge.source === "string" ? { source: edge.source } : {}),
        },
      });
    }

    let knownPlaces: Set<string> | null = null;
    if (input.api_key && input.universe_id) {
      knownPlaces = await verifyPlaces(input.api_key, input.universe_id, [...placeIds]);
    }

    for (const placeId of placeIds) {
      if (knownPlaces && !knownPlaces.has(placeId)) {
        issues.push({
          severity: "high",
          rule: "dead_place_reference",
          message: `Teleport target ${placeId} was not found in Open Cloud place data.`,
          element_path: placeId,
          suggestion: "Update the target PlaceId or remove the stale teleport.",
        });
      }
    }

    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      const existing = adjacency.get(edge.from) ?? new Set<string>();
      existing.add(edge.to);
      adjacency.set(edge.from, existing);
    }

    const placeInbound = new Map<string, number>();
    for (const placeId of placeIds) {
      placeInbound.set(placeId, 0);
    }
    for (const edge of edges) {
      placeInbound.set(edge.to, (placeInbound.get(edge.to) ?? 0) + 1);
    }

    for (const [placeId, inbound] of placeInbound.entries()) {
      if (inbound === 0) {
        issues.push({
          severity: "medium",
          rule: "orphan_place",
          message: `Place ${placeId} has no inbound teleport edges.`,
          element_path: placeId,
          suggestion: "Confirm the place is intentionally standalone or add navigation into it.",
        });
      }
    }

    for (const edge of edges) {
      if (adjacency.get(edge.to)?.has(edge.from)) {
        issues.push({
          severity: "medium",
          rule: "circular_teleport",
          message: `Detected a two-way teleport loop between ${edge.from} and ${edge.to}.`,
          element_path: edge.from,
          suggestion: "Add loop guards or cooldown handling around repeated teleports.",
        });
      }
      const source = typeof edge.meta?.["source"] === "string" ? edge.meta["source"] : "";
      if (!/pcall|retry|TeleportInitFailed|ReconnectTeleportInitFailed/u.test(source)) {
        issues.push({
          severity: "low",
          rule: "missing_error_handling",
          message: `Teleport call in ${edge.from} may not include error handling.`,
          element_path: edge.from,
          suggestion: "Wrap teleports with retry and failure handling.",
        });
      }
    }

    const score = Math.max(0, 100 - issues.length * 10);
    return createResponseEnvelope(
      {
        graph: {
          nodes: [...nodeMap.values()],
          edges,
        },
        issues,
        score,
      },
      {
        source: sourceInfo({
          studio_port: input.studio_port,
          ...(input.universe_id ? { universe_id: input.universe_id } : {}),
        }),
      },
    );
  },
});

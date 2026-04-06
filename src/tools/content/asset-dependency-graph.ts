import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../../types/roblox.js";
import { registerTool } from "../registry.js";

const ASSET_ID_RE = /rbxassetid:\/\/(\d+)/gu;
const BROKEN_ID_RE = /rbxassetid:\/\/0+$/u;

const schema = z.object({
  include_scripts: z.boolean().default(true),
  studio_port: z.number().int().positive().default(33796),
});

function getPath(node: InstanceNode, parentPath?: string): string {
  return parentPath ? `${parentPath}.${node.name}` : node.name;
}

function extractAssetIds(text: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(ASSET_ID_RE.source, "gu");
  while ((match = re.exec(text)) !== null) {
    ids.push(`rbxassetid://${match[1]}`);
  }
  return ids;
}

function extractFromValue(value: RobloxPropertyValue): string[] {
  if (typeof value === "string") {
    return extractAssetIds(value);
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const ids: string[] = [];
    for (const v of Object.values(value)) {
      ids.push(...extractFromValue(v as RobloxPropertyValue));
    }
    return ids;
  }
  return [];
}

function traverseDataModel(
  node: InstanceNode,
  dependencyMap: Map<string, Set<string>>,
  scriptNodes: Array<{ path: string; node: InstanceNode }>,
  parentPath?: string,
): void {
  const path = getPath(node, parentPath);

  for (const [, value] of Object.entries(node.properties ?? {})) {
    const ids = extractFromValue(value);
    for (const id of ids) {
      const usages = dependencyMap.get(id) ?? new Set<string>();
      usages.add(path);
      dependencyMap.set(id, usages);
    }
  }

  const isScript =
    node.className === "Script" ||
    node.className === "LocalScript" ||
    node.className === "ModuleScript";
  if (isScript) {
    scriptNodes.push({ path, node });
  }

  for (const child of node.children) {
    traverseDataModel(child, dependencyMap, scriptNodes, path);
  }
}

registerTool({
  name: "rbx_asset_dependency_graph",
  description:
    "Map all referenced asset IDs (meshes, decals, sounds, animations, images) and their usage sites",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const root = await client.getDataModel();

    const dependencyMap = new Map<string, Set<string>>();
    const scriptNodes: Array<{ path: string; node: InstanceNode }> = [];

    traverseDataModel(root, dependencyMap, scriptNodes, undefined);

    if (input.include_scripts) {
      for (const { path, node } of scriptNodes) {
        try {
          const result = await client.getScriptSource(path);
          const ids = extractAssetIds(result.source);
          for (const id of ids) {
            const usages = dependencyMap.get(id) ?? new Set<string>();
            usages.add(`${path} (script source)`);
            dependencyMap.set(id, usages);
          }
        } catch {
          // Skip scripts that can't be read
        }
        void node;
      }
    }

    const duplicates: string[] = [];
    const brokenReferences: string[] = [];
    const allAssets = Array.from(dependencyMap.entries());

    for (const [id, usages] of allAssets) {
      if (usages.size > 1) {
        duplicates.push(id);
      }
      if (BROKEN_ID_RE.test(id) || id === "rbxassetid://") {
        brokenReferences.push(id);
      }
    }

    // Top 50 by usage count
    const top50 = allAssets
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 50)
      .reduce<Record<string, string[]>>((acc, [id, usages]) => {
        acc[id] = Array.from(usages);
        return acc;
      }, {});

    const totalReferences = allAssets.reduce((sum, [, usages]) => sum + usages.size, 0);

    return createResponseEnvelope(
      {
        unique_assets: allAssets.length,
        total_references: totalReferences,
        duplicates,
        broken_references: brokenReferences,
        dependency_map: top50,
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

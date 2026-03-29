import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, findNodeByPath, limitInstanceDepth } from "../../shared.js";
import type { InstanceNode } from "../../types/roblox.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  max_depth: z.number().int().min(0).max(25).default(10),
  include_properties: z.boolean().default(false),
  root_path: z.string().min(1).optional(),
});

async function hydrateProperties(
  client: StudioBridgeClient,
  node: InstanceNode,
  maxDepth: number,
  depth = 0,
): Promise<void> {
  if (depth > maxDepth) {
    return;
  }
  if (!node.properties) {
    const properties = await client.getProperties(node.id);
    node.properties = properties;
  }
  await Promise.all(
    node.children.map((child) => hydrateProperties(client, child, maxDepth, depth + 1)),
  );
}

registerTool({
  name: "rbx_project_snapshot",
  description: "Return a stable snapshot of the Roblox DataModel tree.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    await client.ping();
    const root = await client.getDataModel();
    const selectedRoot = input.root_path ? findNodeByPath(root, input.root_path) : root;
    if (!selectedRoot) {
      throw new Error(`Root path not found: ${input.root_path}`);
    }
    if (input.include_properties) {
      await hydrateProperties(client, selectedRoot, input.max_depth);
    }
    const tree = limitInstanceDepth(selectedRoot, input.max_depth, 0, input.include_properties);
    return createResponseEnvelope(tree, {
      source: { studio_port: input.studio_port },
    });
  },
});

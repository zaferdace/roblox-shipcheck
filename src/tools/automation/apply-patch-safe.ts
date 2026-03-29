import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import {
  buildPatchOperationsPreview,
  createResponseEnvelope,
  findNodeByPath,
} from "../../shared.js";
import type { InstanceNode, PatchOperation } from "../../types/roblox.js";
import { registerTool } from "../registry.js";

const operationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    target_path: z.string().min(1),
    properties: z.record(z.unknown()).optional(),
    class_name: z.string().min(1),
  }),
  z.object({
    type: z.literal("update"),
    target_path: z.string().min(1),
    properties: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("delete"),
    target_path: z.string().min(1),
  }),
  z.object({
    type: z.literal("reparent"),
    target_path: z.string().min(1),
    new_parent_path: z.string().min(1),
    properties: z.record(z.unknown()).optional(),
  }),
]);

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  operations: z.array(operationSchema).default([]),
  dry_run: z.boolean().default(true),
  description: z.string().optional(),
  undo_patch_id: z.string().optional(),
});

registerTool({
  name: "rbx_apply_patch_safe",
  description: "Preview or apply safe instance tree mutations with rollback support.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    await client.ping();

    if (input.undo_patch_id) {
      const result = await client.undoPatch(input.undo_patch_id);
      return createResponseEnvelope(
        {
          undone: true,
          patch_id: input.undo_patch_id,
          result,
        },
        {
          source: { studio_port: input.studio_port },
        },
      );
    }

    if (input.operations.length === 0) {
      throw new Error("Provide at least one operation or an undo_patch_id.");
    }

    const root = await client.getDataModel();
    const operations = input.operations as PatchOperation[];
    validateOperations(root, operations);
    const preview = buildPatchOperationsPreview(operations, root);

    if (input.dry_run) {
      return createResponseEnvelope(
        {
          dry_run: true,
          preview,
        },
        {
          source: { studio_port: input.studio_port },
        },
      );
    }

    const result = await client.applyPatch(
      {
        operations: operations.map((op) => {
          if (op.type === "create") {
            const segments = op.target_path.split(/[./]/u).filter(Boolean);
            const name = segments[segments.length - 1] ?? op.target_path;
            const parentPath = segments.slice(0, -1).join(".");
            return { ...op, parent_path: parentPath, name };
          }
          return op;
        }),
        ...(input.description ? { description: input.description } : {}),
      },
      false,
    );
    const patchId = typeof result["patchId"] === "string" ? result["patchId"] : undefined;
    return createResponseEnvelope(
      {
        applied: true,
        patch_id: patchId,
        changes: preview,
        rollback_command: patchId
          ? {
              tool: "rbx_apply_patch_safe",
              arguments: { studio_port: input.studio_port, undo_patch_id: patchId },
            }
          : null,
        bridge_result: result,
      },
      {
        source: { studio_port: input.studio_port },
      },
    );
  },
});

function validateOperations(
  root: InstanceNode,
  operations: z.infer<typeof operationSchema>[],
): void {
  for (const operation of operations) {
    if (operation.type === "create") {
      const parentPath = parentPathOf(operation.target_path);
      if (!parentPath) {
        throw new Error(`Cannot create root-level instance at ${operation.target_path}`);
      }
      const parent = findNodeByPath(root, parentPath);
      if (!parent) {
        throw new Error(`Parent path does not exist for create: ${parentPath}`);
      }
      continue;
    }
    const target = findNodeByPath(root, operation.target_path);
    if (!target) {
      throw new Error(`Target path does not exist: ${operation.target_path}`);
    }
    if (operation.type === "reparent") {
      const newParent = findNodeByPath(root, operation.new_parent_path);
      if (!newParent) {
        throw new Error(`New parent path does not exist: ${operation.new_parent_path}`);
      }
    }
  }
}

function parentPathOf(targetPath: string): string {
  const segments = targetPath.split(/[./]/u).filter(Boolean);
  return segments.slice(0, -1).join(".");
}

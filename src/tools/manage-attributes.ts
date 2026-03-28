import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../shared.js";
import { registerTool } from "./registry.js";

const schema = z
  .object({
    studio_port: z.number().int().positive().default(33796),
    path: z.string().min(1),
    action: z.enum(["get", "set", "delete"]),
    key: z.string().min(1).optional(),
    value: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.action === "set" || value.action === "delete") && !value.key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["key"],
        message: "key is required for set and delete actions",
      });
    }
  });

registerTool({
  name: "rbx_manage_attributes",
  description: "Get, set, or delete Roblox instance attributes.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.manageAttributes(input.path, input.action, input.key, input.value);
    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

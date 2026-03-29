import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const schema = z
  .object({
    studio_port: z.number().int().positive().default(33796),
    path: z.string().min(1),
    action: z.enum(["add", "remove", "list"]),
    tag: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action !== "list" && !value.tag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tag"],
        message: "tag is required for add and remove actions",
      });
    }
  });

registerTool({
  name: "rbx_manage_tags",
  description: "Add, remove, or list CollectionService tags on an instance.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.manageTags(input.path, input.action, input.tag);
    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

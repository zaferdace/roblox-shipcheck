import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../shared.js";
import { registerTool } from "./registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  path: z.string().min(1),
  depth: z.number().int().min(0).max(25).optional(),
});

registerTool({
  name: "rbx_get_children",
  description: "Return the children of a Roblox instance path.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.getChildren(input.path, input.depth);
    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

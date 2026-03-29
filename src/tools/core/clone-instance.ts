import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  path: z.string().min(1),
  new_parent_path: z.string().min(1).optional(),
});

registerTool({
  name: "rbx_clone_instance",
  description: "Clone a Roblox instance and optionally reparent the clone.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.cloneInstance(input.path, input.new_parent_path);
    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

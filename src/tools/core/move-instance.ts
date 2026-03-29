import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  path: z.string().min(1),
  new_parent_path: z.string().min(1),
});

registerTool({
  name: "rbx_move_instance",
  description: "Move a Roblox instance to a new parent path.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.moveInstance(input.path, input.new_parent_path);
    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

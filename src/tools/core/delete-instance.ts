import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  path: z.string().min(1),
});

registerTool({
  name: "rbx_delete_instance",
  description: "Delete a Roblox instance by DataModel path.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.deleteInstance(input.path);
    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

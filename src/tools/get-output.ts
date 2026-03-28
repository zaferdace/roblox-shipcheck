import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../shared.js";
import { registerTool } from "./registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  limit: z.number().int().min(1).max(1000).optional(),
});

registerTool({
  name: "rbx_get_output",
  description: "Fetch Roblox Studio output log entries.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.getOutput(input.limit);
    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

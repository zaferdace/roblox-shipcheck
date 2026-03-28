import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../shared.js";
import { registerTool } from "./registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  code: z.string().min(1),
});

registerTool({
  name: "rbx_execute_code",
  description: "Execute arbitrary Lua code in Roblox Studio.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.executeCode(input.code);
    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

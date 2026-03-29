import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  parent_path: z.string().min(1),
  class_name: z.string().min(1),
  name: z.string().min(1).optional(),
  properties: z.record(z.unknown()).optional(),
});

registerTool({
  name: "rbx_create_instance",
  description: "Create a new Roblox instance under a parent path.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.createInstance(
      input.parent_path,
      input.class_name,
      input.name,
      input.properties,
    );
    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

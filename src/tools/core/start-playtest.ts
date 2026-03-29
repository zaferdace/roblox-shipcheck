import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  mode: z.enum(["play", "run", "pause"]).optional(),
});

registerTool({
  name: "rbx_start_playtest",
  description: "Request Roblox Studio playtest start.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.startPlaytest(input.mode);
    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

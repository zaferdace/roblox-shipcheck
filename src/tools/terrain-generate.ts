import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../shared.js";
import type { ResponseEnvelope } from "../types/tools.js";
import { registerTool } from "./registry.js";

const vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const paramsSchema = z.object({
  position: vector3Schema.optional(),
  size: vector3Schema.optional(),
  radius: z.number().positive().optional(),
  height: z.number().positive().optional(),
  material: z.string().min(1).optional(),
  region_start: vector3Schema.optional(),
  region_end: vector3Schema.optional(),
  base_height: z.number().optional(),
  amplitude: z.number().optional(),
  frequency: z.number().positive().optional(),
  seed: z.number().int().optional(),
});

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  operation: z.enum([
    "fill_block",
    "fill_ball",
    "fill_cylinder",
    "fill_wedge",
    "clear_region",
    "set_material_region",
    "generate_flat",
    "generate_hills",
  ]),
  params: paramsSchema,
});

const terrainResultSchema = z.object({
  operation: z.string().min(1),
  material: z.string().min(1).optional(),
  success: z.literal(true),
});

type TerrainResult = z.infer<typeof terrainResultSchema>;

registerTool({
  name: "rbx_terrain_generate",
  description: "Generate or modify Roblox terrain using Studio terrain APIs.",
  schema,
  handler: async (input): Promise<ResponseEnvelope<TerrainResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.terrainGenerate(
      input.operation,
      input.params as Record<string, unknown>,
    );
    return createResponseEnvelope(terrainResultSchema.parse(result), {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

const customConfigSchema = z
  .object({
    lighting: z.record(z.unknown()).optional(),
    atmosphere: z.record(z.unknown()).optional(),
    sky: z.record(z.unknown()).optional(),
    bloom: z.record(z.unknown()).optional(),
    color_correction: z.record(z.unknown()).optional(),
    sun_rays: z.record(z.unknown()).optional(),
  })
  .strict();

const schema = z
  .object({
    studio_port: z.number().int().positive().default(33796),
    preset: z
      .enum([
        "realistic_day",
        "realistic_night",
        "sunset",
        "foggy",
        "neon_night",
        "studio_flat",
        "custom",
      ])
      .optional(),
    custom_config: customConfigSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.preset && !value.custom_config) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "preset or custom_config is required",
        path: ["preset"],
      });
    }
    if (value.preset === "custom" && !value.custom_config) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "custom_config is required when preset is custom",
        path: ["custom_config"],
      });
    }
  });

interface LightingResult {
  preset_applied: string;
  properties_set: number;
}

const lightingResultSchema = z.object({
  preset_applied: z.string().min(1),
  properties_set: z.number().int().nonnegative(),
});

registerTool({
  name: "rbx_lighting_preset",
  description: "Apply a built-in or custom Roblox lighting and atmosphere preset.",
  schema,
  handler: async (input): Promise<ResponseEnvelope<LightingResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.applyLighting(input.preset, input.custom_config);
    return createResponseEnvelope(lightingResultSchema.parse(result), {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

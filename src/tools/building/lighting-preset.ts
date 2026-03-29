import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

type PresetConfig = Record<string, Record<string, unknown>>;

const PRESETS: Record<string, PresetConfig> = {
  realistic_day: {
    lighting: {
      Brightness: 2,
      ClockTime: 14,
      GeographicLatitude: 35,
      EnvironmentDiffuseScale: 1,
      EnvironmentSpecularScale: 1,
      GlobalShadows: true,
    },
    atmosphere: {
      Density: 0.3,
      Offset: 0.25,
      Glare: 0,
      Haze: 1,
    },
    sky: {
      CelestialBodiesShown: true,
      StarCount: 3000,
    },
  },
  realistic_night: {
    lighting: {
      Brightness: 0,
      ClockTime: 0,
      GlobalShadows: true,
    },
    atmosphere: {
      Density: 0.35,
      Offset: 0,
      Glare: 0,
      Haze: 2,
    },
    sky: {
      CelestialBodiesShown: true,
      StarCount: 5000,
    },
  },
  sunset: {
    lighting: {
      Brightness: 1,
      ClockTime: 18,
      GeographicLatitude: 35,
      GlobalShadows: true,
    },
    atmosphere: {
      Density: 0.35,
      Offset: 0.2,
      Glare: 0.5,
      Haze: 2,
    },
    sky: {
      CelestialBodiesShown: true,
      StarCount: 2000,
    },
  },
  foggy: {
    lighting: {
      Brightness: 1,
      ClockTime: 10,
      GlobalShadows: true,
    },
    atmosphere: {
      Density: 0.8,
      Offset: 0.5,
      Glare: 0,
      Haze: 10,
    },
  },
  neon_night: {
    lighting: {
      Brightness: 0,
      ClockTime: 22,
      GlobalShadows: true,
    },
    atmosphere: {
      Density: 0.4,
      Offset: 0,
      Glare: 0,
      Haze: 0,
    },
    bloom: {
      Intensity: 0.8,
      Size: 24,
      Threshold: 0.8,
    },
  },
  studio_flat: {
    lighting: {
      Brightness: 2,
      ClockTime: 12,
      GlobalShadows: false,
      EnvironmentDiffuseScale: 0,
      EnvironmentSpecularScale: 0,
    },
    atmosphere: {
      Density: 0,
      Offset: 0,
      Glare: 0,
      Haze: 0,
    },
  },
};

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

function filterTechnology(config: PresetConfig): PresetConfig {
  if (config["lighting"]) {
    const { Technology: _, ...safe } = config["lighting"];
    return { ...config, lighting: safe };
  }
  return config;
}

registerTool({
  name: "rbx_lighting_preset",
  description: "Apply a built-in or custom Roblox lighting and atmosphere preset.",
  schema,
  handler: async (input): Promise<ResponseEnvelope<LightingResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });

    let config: PresetConfig;
    let presetName: string;

    if (input.preset && input.preset !== "custom" && PRESETS[input.preset]) {
      config = filterTechnology({ ...PRESETS[input.preset] });
      presetName = input.preset;
    } else if (input.custom_config) {
      config = filterTechnology({ ...input.custom_config } as PresetConfig);
      presetName = input.preset ?? "custom";
    } else {
      config = {};
      presetName = input.preset ?? "custom";
    }

    const result = await client.applyLighting(undefined, config);
    return createResponseEnvelope(lightingResultSchema.parse(result), {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

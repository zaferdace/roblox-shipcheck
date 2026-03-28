import { z } from "zod";
import { OpenCloudClient } from "../roblox/open-cloud-client.js";
import { createResponseEnvelope, sourceInfo } from "../shared.js";
import { registerTool } from "./registry.js";

const schema = z.object({
  api_key: z.string().min(1),
  universe_id: z.string().min(1),
  include_places: z.boolean().default(true),
  include_stats: z.boolean().default(false),
});

registerTool({
  name: "rbx_opencloud_experience_info",
  description: "Fetch Roblox universe and place metadata from Open Cloud.",
  schema,
  handler: async (input) => {
    const client = new OpenCloudClient(input.api_key);
    const universe = await client.getExperienceInfo(input.universe_id);
    let places: unknown[] = [];
    if (input.include_places) {
      const listed = await client.listPlaces(input.universe_id);
      places = await Promise.all(
        listed.map(async (place) => {
          const path = typeof place.path === "string" ? place.path : "";
          const placeId = path.split("/").pop() ?? "";
          if (!placeId) {
            return place;
          }
          try {
            return await client.getPlaceInfo(input.universe_id, placeId);
          } catch {
            return place;
          }
        }),
      );
    }
    const stats =
      input.include_stats && Array.isArray(places)
        ? {
            place_count: places.length,
          }
        : undefined;
    return createResponseEnvelope(
      {
        universe,
        places,
        ...(stats ? { stats } : {}),
      },
      {
        source: sourceInfo({ universe_id: input.universe_id }),
        ttlMs: 60 * 60 * 1000,
      },
    );
  },
});

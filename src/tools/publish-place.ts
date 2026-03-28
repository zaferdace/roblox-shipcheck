import { z } from "zod";
import { createResponseEnvelope, sourceInfo } from "../shared.js";
import { registerTool } from "./registry.js";

const schema = z.object({
  api_key: z.string().min(1),
  universe_id: z.string().min(1),
  place_id: z.string().min(1),
  version_type: z.enum(["Saved", "Published"]).default("Published"),
});

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}

registerTool({
  name: "rbx_publish_place",
  description: "Publish a Roblox place version through Open Cloud.",
  schema,
  handler: async (input) => {
    const response = await fetch(
      `https://apis.roblox.com/universes/v1/${encodeURIComponent(input.universe_id)}/places/${encodeURIComponent(input.place_id)}/versions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": input.api_key,
        },
        body: JSON.stringify({
          versionType: input.version_type,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Roblox Open Cloud publish failed (${response.status}): ${await safeReadBody(response)}`,
      );
    }
    const result = (await response.json()) as Record<string, unknown>;
    return createResponseEnvelope(result, {
      source: sourceInfo({
        universe_id: input.universe_id,
        place_id: input.place_id,
      }),
    });
  },
});

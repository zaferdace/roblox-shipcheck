import { z } from "zod";
import { OpenCloudClient } from "../roblox/open-cloud-client.js";
import { createResponseEnvelope } from "../shared.js";
import { registerTool } from "./registry.js";

const schema = z.object({
  api_key: z.string().min(1),
  asset_ids: z.array(z.string().min(1)).min(1).max(10),
});

registerTool({
  name: "rbx_asset_publish_status",
  description: "Check Roblox asset publish and moderation status for up to 10 assets.",
  schema,
  handler: async (input) => {
    const client = new OpenCloudClient(input.api_key);
    const assets = await Promise.all(
      input.asset_ids.map(async (assetId) => {
        const [info, moderation] = await Promise.all([
          client.getAssetInfo(assetId),
          client.getAssetModerationStatus(assetId),
        ]);
        return {
          id: assetId,
          name: info.displayName ?? info["name"] ?? null,
          status: moderation["status"] ?? info.state ?? null,
          moderation_status: moderation["moderationStatus"] ?? moderation["state"] ?? null,
          visibility: moderation["visibility"] ?? info["visibility"] ?? null,
          created: info.createTime ?? null,
          updated: info.updateTime ?? null,
          raw: {
            info,
            moderation,
          },
        };
      }),
    );
    return createResponseEnvelope(
      {
        assets,
      },
      {
        ttlMs: 60 * 60 * 1000,
      },
    );
  },
});

import { z } from "zod";
import { OpenCloudClient } from "../../roblox/open-cloud-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  api_key: z.string().min(1),
  universe_id: z.string().min(1),
  include_dev_products: z.boolean().default(true),
  include_game_passes: z.boolean().default(true),
});

interface ProductEntry {
  id?: string;
  name?: string;
  description?: string;
  priceInRobux?: number;
  iconImageAssetId?: string;
}

interface ProductListResult {
  dev_products: ProductEntry[];
  game_passes: ProductEntry[];
  total_products: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toProductEntry(value: unknown): ProductEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const entry: ProductEntry = {};
  if (typeof value["id"] === "string") {
    entry.id = value["id"];
  }
  if (typeof value["name"] === "string") {
    entry.name = value["name"];
  }
  if (typeof value["description"] === "string") {
    entry.description = value["description"];
  }
  if (typeof value["priceInRobux"] === "number") {
    entry.priceInRobux = value["priceInRobux"];
  }
  if (typeof value["iconImageAssetId"] === "string") {
    entry.iconImageAssetId = value["iconImageAssetId"];
  }
  return entry;
}

function extractEntries(payload: unknown): ProductEntry[] {
  if (Array.isArray(payload)) {
    return payload.map(toProductEntry).filter((entry): entry is ProductEntry => entry !== null);
  }
  if (!isRecord(payload)) {
    return [];
  }
  const candidates = [
    payload["developerProducts"],
    payload["gamePasses"],
    payload["data"],
    payload["items"],
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(toProductEntry).filter((entry): entry is ProductEntry => entry !== null);
    }
  }
  return [];
}

registerTool({
  name: "rbx_list_products",
  description: "List Roblox developer products and game passes for a universe via Open Cloud.",
  schema,
  handler: async (input): Promise<ResponseEnvelope<ProductListResult>> => {
    const client = new OpenCloudClient(input.api_key);
    const devProducts = input.include_dev_products
      ? extractEntries(await client.listDevProducts(input.universe_id))
      : [];
    const gamePasses = input.include_game_passes
      ? extractEntries(await client.listGamePasses(input.universe_id))
      : [];
    return createResponseEnvelope(
      {
        dev_products: devProducts,
        game_passes: gamePasses,
        total_products: devProducts.length + gamePasses.length,
      },
      {
        source: sourceInfo({ universe_id: input.universe_id }),
        ttlMs: 60 * 60 * 1000,
      },
    );
  },
});

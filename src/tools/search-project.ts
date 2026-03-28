import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import { createResponseEnvelope, searchDataModel } from "../shared.js";
import { registerTool } from "./registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  query: z.string().min(1),
  search_type: z.enum(["name", "class", "property", "script_content"]),
  case_sensitive: z.boolean().default(false),
  max_results: z.number().int().min(1).max(500).default(50),
  root_path: z.string().min(1).optional(),
});

registerTool({
  name: "rbx_search_project",
  description: "Search Roblox instances by name, class, property values, or script content.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    await client.ping();
    const root = await client.getDataModel();
    const matches = searchDataModel(root, {
      query: input.query,
      searchType: input.search_type,
      caseSensitive: input.case_sensitive,
      maxResults: input.max_results,
      ...(input.root_path ? { rootPath: input.root_path } : {}),
    });
    return createResponseEnvelope(
      {
        query: input.query,
        search_type: input.search_type,
        total_matches: matches.length,
        matches,
      },
      {
        source: { studio_port: input.studio_port },
      },
    );
  },
});

import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../shared.js";
import type { ResponseEnvelope } from "../types/tools.js";
import { registerTool } from "./registry.js";

interface UIElement {
  class: string;
  name?: string | undefined;
  properties?: Record<string, unknown> | undefined;
  children?: UIElement[] | undefined;
}

const uiElementSchema: z.ZodType<UIElement> = z.lazy(() =>
  z.object({
    class: z.string().min(1),
    name: z.string().min(1).optional(),
    properties: z.record(z.unknown()).optional(),
    children: z.array(uiElementSchema).optional(),
  }),
);

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  parent_path: z.string().min(1),
  spec: uiElementSchema,
});

const uiBuildResultSchema = z.object({
  created_count: z.number().int().nonnegative(),
  root_path: z.string().min(1),
  tree: z.array(z.string()),
});

type UIBuildResult = z.infer<typeof uiBuildResultSchema>;

registerTool({
  name: "rbx_ui_builder",
  description: "Build a Roblox UI hierarchy from a declarative nested spec.",
  schema,
  handler: async (input): Promise<ResponseEnvelope<UIBuildResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const result = await client.buildUI(input.parent_path, input.spec);
    return createResponseEnvelope(uiBuildResultSchema.parse(result), {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

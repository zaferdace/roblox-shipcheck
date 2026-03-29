import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

interface ToolRegistration<T extends z.ZodType> {
  name: string;
  description: string;
  schema: T;
  handler: (input: z.infer<T>) => Promise<unknown>;
}

const registry = new Map<string, ToolRegistration<z.ZodType>>();

export function registerTool<T extends z.ZodType>(reg: ToolRegistration<T>): void {
  if (registry.has(reg.name)) {
    console.error(`[roblox-shipcheck] Duplicate tool registration: ${reg.name}`);
  }
  registry.set(reg.name, reg as unknown as ToolRegistration<z.ZodType>);
}

export function getToolDefinitions(): Tool[] {
  return [...registry.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, reg]) => ({
      name: reg.name,
      description: reg.description,
      inputSchema: zodToJsonSchema(reg.schema) as Tool["inputSchema"],
    }));
}

export async function executeTool(name: string, args: unknown): Promise<unknown> {
  const reg = registry.get(name);
  if (!reg) throw new Error(`Unknown tool: ${name}`);
  const parsed = reg.schema.parse(args);
  return reg.handler(parsed);
}

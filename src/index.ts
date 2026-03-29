#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { startBridgeServer } from "./bridge/index.js";
import { SERVER_VERSION } from "./shared.js";
import "./tools/register-all.js";
import { executeTool, getToolDefinitions } from "./tools/registry.js";

const server = new Server(
  { name: "roblox-shipcheck", version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

const tools = getToolDefinitions();

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await executeTool(name, args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      throw new Error(`Invalid input: ${error.message}`, { cause: error });
    }
    throw error;
  }
});

async function main(): Promise<void> {
  const bridge = await startBridgeServer().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("EADDRINUSE")) {
      console.error("Bridge port 33796 is already in use. Is another instance running?");
    }
    throw error;
  });

  const shutdown = () => {
    bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

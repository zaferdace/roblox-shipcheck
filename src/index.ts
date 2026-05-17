#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { startBridgeServer } from "./bridge/index.js";
import { RbxError } from "./bridge/errors.js";
import { PairingService } from "./bridge/pairing.js";
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
  const requestId = randomUUID();
  const { name, arguments: args } = request.params;
  try {
    const result = await executeTool(name, args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    if (error instanceof RbxError) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: {
                  code: error.code,
                  message: error.message,
                  retryable: error.retryable,
                  request_id: requestId,
                  ...(error.data !== undefined ? { data: error.data } : {}),
                  ...(error.remediation !== undefined ? { remediation: error.remediation } : {}),
                },
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
    if (error instanceof Error && error.name === "ZodError") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: {
                  code: "RBX.VALIDATION.INVALID_INPUT",
                  message: `Invalid input: ${error.message}`,
                  retryable: false,
                  request_id: requestId,
                },
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
});

const pairingService = new PairingService(); // storage: "auto" — keytar first, file fallback

async function main(): Promise<void> {
  // Pre-load pairing secret so the cache is hot and storage errors surface early.
  await pairingService.loadOrCreatePairingSecret();

  const bridge = await startBridgeServer({ pairingService }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("EADDRINUSE")) {
      console.error("Bridge port 33796 is already in use. Is another instance running?");
    }
    throw error;
  });

  // Print a fresh pairing code on every cold-start. The plugin can ignore this
  // if it's already paired; it's only required for first-time pair OR re-pair.
  const initialPair = pairingService.issuePairingCode();
  const codeLine = `│  Studio plugin pairing code: ${initialPair.code}                       │`;
  console.error("");
  console.error("┌─────────────────────────────────────────────────────────────┐");
  console.error(codeLine);
  console.error("│  Valid for 60 seconds. Open Roblox Studio plugin and click  │");
  console.error("│  'Pair Plugin', then enter the code above.                  │");
  console.error("│  Already paired? You can ignore this.                       │");
  console.error("└─────────────────────────────────────────────────────────────┘");
  console.error("");

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

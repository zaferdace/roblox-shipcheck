import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { SERVER_VERSION } from "../shared.js";

interface PendingCommand {
  id: string;
  command:
    | "get_datamodel"
    | "search"
    | "get_properties"
    | "apply_patch"
    | "undo_patch"
    | "run_tests"
    | "get_test_results"
    | "execute_code"
    | "set_script_source"
    | "get_script_source"
    | "create_instance"
    | "delete_instance"
    | "clone_instance"
    | "move_instance"
    | "set_instance_property"
    | "get_children"
    | "get_selection"
    | "manage_tags"
    | "manage_attributes"
    | "start_playtest"
    | "stop_playtest"
    | "get_output"
    | "teleport_graph"
    | "package_info"
    | "get_screenshot"
    | "build_ui"
    | "apply_lighting"
    | "terrain_generate";
  params: unknown;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

interface PluginSession {
  id: string;
  token: string;
  connectedAt: number;
  lastPollAt: number;
}

interface QueuedCommand extends PendingCommand {
  timeout: NodeJS.Timeout;
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_PORT = 33796;
const POLL_WAIT_MS = 25_000;
const POLL_CHECK_MS = 100;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_BODY_SIZE = 10 * 1024 * 1024;

function withCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (
    origin === "http://localhost" ||
    origin === "https://localhost" ||
    origin === "http://127.0.0.1" ||
    origin === "https://127.0.0.1" ||
    /^https?:\/\/localhost:\d+$/u.test(origin ?? "") ||
    /^https?:\/\/127\.0\.0\.1:\d+$/u.test(origin ?? "")
  ) {
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
    }
  }
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  withCorsHeaders(request, response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendError(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  message: string,
): void {
  sendJson(request, response, statusCode, { error: message });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buffer.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return undefined;
  }
  return JSON.parse(raw) as unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSingleQueryValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return value?.[0];
}

function coerceBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

function coerceInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function startBridgeServer(
  port = DEFAULT_PORT,
): Promise<{ port: number; stop: () => void }> {
  let activeSession: PluginSession | null = null;
  const queuedCommands: QueuedCommand[] = [];
  const commandsById = new Map<string, QueuedCommand>();
  const pollWaiters = new Set<{
    response: ServerResponse;
    request: IncomingMessage;
    interval: NodeJS.Timeout;
    timeout: NodeJS.Timeout;
  }>();
  let stopping = false;

  const cleanupCommand = (commandId: string): QueuedCommand | undefined => {
    const command = commandsById.get(commandId);
    if (!command) {
      return undefined;
    }
    clearTimeout(command.timeout);
    commandsById.delete(commandId);
    const queueIndex = queuedCommands.findIndex((entry) => entry.id === commandId);
    if (queueIndex !== -1) {
      queuedCommands.splice(queueIndex, 1);
    }
    return command;
  };

  const flushPollWaiters = (): void => {
    if (queuedCommands.length === 0) {
      return;
    }
    for (const waiter of [...pollWaiters]) {
      if (waiter.response.writableEnded || waiter.response.destroyed) {
        clearInterval(waiter.interval);
        clearTimeout(waiter.timeout);
        pollWaiters.delete(waiter);
        continue;
      }
      const next = queuedCommands.shift();
      if (!next) {
        break;
      }
      clearInterval(waiter.interval);
      clearTimeout(waiter.timeout);
      pollWaiters.delete(waiter);
      if (activeSession) {
        activeSession.lastPollAt = Date.now();
      }
      sendJson(waiter.request, waiter.response, 200, {
        id: next.id,
        command: next.command,
        params: next.params,
      });
    }
  };

  const enqueueCommand = <T>(command: QueuedCommand["command"], params: unknown): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const entry: QueuedCommand = {
        id: randomUUID(),
        command,
        params,
        resolve: (result) => resolve(result as T),
        reject,
        createdAt: Date.now(),
        timeout: setTimeout(() => {
          cleanupCommand(entry.id);
          reject(new Error(`Bridge command timed out after ${COMMAND_TIMEOUT_MS}ms: ${command}`));
        }, COMMAND_TIMEOUT_MS),
      };
      queuedCommands.push(entry);
      commandsById.set(entry.id, entry);
      flushPollWaiters();
    });

  const requireToken = (token: string | undefined): boolean =>
    typeof token === "string" && activeSession !== null && activeSession.token === token;

  const requirePluginSession = (request: IncomingMessage, response: ServerResponse): boolean => {
    if (activeSession !== null) {
      return true;
    }
    sendError(request, response, 503, "Roblox Studio plugin is not connected");
    return false;
  };

  const server = createServer(async (request, response) => {
    try {
      if (!request.url || !request.method) {
        sendError(request, response, 400, "Invalid request");
        return;
      }

      if (request.method === "OPTIONS") {
        withCorsHeaders(request, response);
        response.statusCode = 204;
        response.end();
        return;
      }

      const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
      const pathname = url.pathname;

      if (request.method === "POST" && pathname === "/studio/connect") {
        await readJsonBody(request);
        activeSession = {
          id: randomUUID(),
          token: randomUUID(),
          connectedAt: Date.now(),
          lastPollAt: 0,
        };
        sendJson(request, response, 200, {
          sessionId: activeSession.id,
          token: activeSession.token,
        });
        flushPollWaiters();
        return;
      }

      if (request.method === "GET" && pathname === "/studio/poll") {
        const token = getSingleQueryValue(url.searchParams.get("token") ?? undefined);
        if (!requireToken(token)) {
          sendError(request, response, 401, "Invalid session token");
          return;
        }
        const session = activeSession;
        if (!session) {
          sendError(request, response, 401, "Invalid session token");
          return;
        }
        session.lastPollAt = Date.now();
        const next = queuedCommands.shift();
        if (next) {
          sendJson(request, response, 200, {
            id: next.id,
            command: next.command,
            params: next.params,
          });
          return;
        }
        const waiter = {
          response,
          request,
          interval: setInterval(() => {
            if (!requireToken(token) || response.writableEnded || response.destroyed || stopping) {
              clearInterval(waiter.interval);
              clearTimeout(waiter.timeout);
              pollWaiters.delete(waiter);
              if (!response.writableEnded) {
                if (!requireToken(token)) {
                  sendError(request, response, 401, "Invalid session token");
                } else {
                  sendJson(request, response, 200, { command: null });
                }
              }
              return;
            }
            if (queuedCommands.length === 0) {
              return;
            }
            const command = queuedCommands.shift();
            if (!command) {
              return;
            }
            const currentSession = activeSession;
            if (currentSession) {
              currentSession.lastPollAt = Date.now();
            }
            clearInterval(waiter.interval);
            clearTimeout(waiter.timeout);
            pollWaiters.delete(waiter);
            sendJson(request, response, 200, {
              id: command.id,
              command: command.command,
              params: command.params,
            });
          }, POLL_CHECK_MS),
          timeout: setTimeout(() => {
            clearInterval(waiter.interval);
            pollWaiters.delete(waiter);
            if (!response.writableEnded) {
              sendJson(request, response, 200, { command: null });
            }
          }, POLL_WAIT_MS),
        };
        pollWaiters.add(waiter);
        request.on("close", () => {
          clearInterval(waiter.interval);
          clearTimeout(waiter.timeout);
          pollWaiters.delete(waiter);
        });
        return;
      }

      if (request.method === "POST" && pathname === "/studio/response") {
        const body = await readJsonBody(request);
        if (!isRecord(body)) {
          sendError(request, response, 400, "Request body must be a JSON object");
          return;
        }
        const token = asString(body["token"]);
        if (!requireToken(token)) {
          sendError(request, response, 401, "Invalid session token");
          return;
        }
        const commandId = asString(body["commandId"]);
        if (!commandId) {
          sendError(request, response, 400, "Missing commandId");
          return;
        }
        const command = cleanupCommand(commandId);
        if (!command) {
          sendError(request, response, 404, "Command not found");
          return;
        }
        const errorMessage = asString(body["error"]);
        if (errorMessage) {
          command.reject(new Error(errorMessage));
        } else {
          command.resolve(body["result"]);
        }
        sendJson(request, response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && pathname === "/api/ping") {
        sendJson(request, response, 200, {
          ok: true,
          version: SERVER_VERSION,
          plugin_connected: activeSession !== null,
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/datamodel") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const params = {
          max_depth: coerceInteger(url.searchParams.get("max_depth") ?? undefined),
          root_path: url.searchParams.get("root_path") ?? undefined,
          include_properties: coerceBoolean(
            url.searchParams.get("include_properties") ?? undefined,
          ),
        };
        const result = await enqueueCommand("get_datamodel", params);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/search") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("search", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/screenshot") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const viewport = url.searchParams.get("viewport") ?? "game";
        const result = await enqueueCommand("get_screenshot", { viewport });
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/tests/run") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("run_tests", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname.startsWith("/api/tests/results/")) {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const runId = decodeURIComponent(pathname.slice("/api/tests/results/".length));
        if (!runId) {
          sendError(request, response, 400, "Missing runId");
          return;
        }
        const result = await enqueueCommand("get_test_results", { runId });
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/patch") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("apply_patch", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/patch/undo") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("undo_patch", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/execute") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("execute_code", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/script/source") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const path = url.searchParams.get("path") ?? undefined;
        if (!path) {
          sendError(request, response, 400, "Missing path");
          return;
        }
        const result = await enqueueCommand("get_script_source", { path });
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/script/source") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("set_script_source", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (
        request.method === "GET" &&
        pathname.startsWith("/api/instance/") &&
        pathname.endsWith("/properties") &&
        pathname !== "/api/instance/properties"
      ) {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const instanceId = decodeURIComponent(
          pathname.slice("/api/instance/".length, -"/properties".length),
        );
        if (!instanceId) {
          sendError(request, response, 400, "Missing instance id");
          return;
        }
        const result = await enqueueCommand("get_properties", { id: instanceId });
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/instance/properties") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const path = url.searchParams.get("path") ?? undefined;
        if (!path) {
          sendError(request, response, 400, "Missing path");
          return;
        }
        const result = await enqueueCommand("get_properties", { path });
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/instance/create") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("create_instance", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/instance/delete") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("delete_instance", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/instance/clone") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("clone_instance", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/instance/move") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("move_instance", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/instance/set-property") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("set_instance_property", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/instance/children") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const path = url.searchParams.get("path") ?? undefined;
        const depth = coerceInteger(url.searchParams.get("depth") ?? undefined);
        const result = await enqueueCommand("get_children", {
          ...(path ? { path } : {}),
          ...(depth !== undefined ? { depth } : {}),
        });
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/selection") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const result = await enqueueCommand("get_selection", {});
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/tags") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("manage_tags", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/attributes") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("manage_attributes", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/playtest/start") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("start_playtest", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/playtest/stop") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const result = await enqueueCommand("stop_playtest", {});
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/output") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const limit = coerceInteger(url.searchParams.get("limit") ?? undefined);
        const result = await enqueueCommand("get_output", {
          ...(limit !== undefined ? { limit } : {}),
        });
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/teleport-graph") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const result = await enqueueCommand("teleport_graph", {});
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/packages") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const result = await enqueueCommand("package_info", {});
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/ui/build") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("build_ui", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/lighting/apply") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("apply_lighting", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/terrain/generate") {
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("terrain_generate", body);
        sendJson(request, response, 200, result);
        return;
      }

      sendError(request, response, 404, "Route not found");
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendError(request, response, 400, "Invalid JSON in request body");
        return;
      }
      const message = error instanceof Error ? error.message : "Internal server error";
      if (message === "Request body too large") {
        sendError(request, response, 413, message);
        return;
      }
      sendError(request, response, 500, message);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve({
        port,
        stop: () => {
          stopping = true;
          activeSession = null;
          for (const waiter of pollWaiters) {
            clearInterval(waiter.interval);
            clearTimeout(waiter.timeout);
            if (!waiter.response.writableEnded) {
              sendJson(waiter.request, waiter.response, 200, { command: null });
            }
          }
          pollWaiters.clear();
          for (const command of [...commandsById.values()]) {
            cleanupCommand(command.id);
            command.reject(new Error("Bridge server stopped"));
          }
          server.close(() => undefined);
        },
      });
    });
  });
}

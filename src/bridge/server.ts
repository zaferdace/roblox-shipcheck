import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { SERVER_VERSION } from "../shared.js";
import { RbxError, sendErrorEnvelope } from "./errors.js";
import { PairingService } from "./pairing.js";
import { setCurrentSessionToken } from "./session-registry.js";
import { checkVersionCompat } from "./version-check.js";

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

function verifyBearerAuth(
  request: IncomingMessage,
  pairing: PairingService,
): { outcome: "valid" | "missing" | "invalid" | "expired"; token: string } {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.toLowerCase().startsWith("bearer ")) {
    return { outcome: "missing", token: "" };
  }
  const token = header.slice(7).trim();
  if (!token) return { outcome: "missing", token: "" };
  const status = pairing.verifySessionToken(token);
  if (status === "valid") return { outcome: "valid", token };
  if (status === "expired") return { outcome: "expired", token };
  return { outcome: "invalid", token };
}

function bearerOutcomeToError(outcome: "missing" | "invalid" | "expired"): RbxError {
  if (outcome === "missing") {
    return new RbxError(
      "RBX.AUTH.MISSING_TOKEN",
      "Authorization: Bearer header required",
      false,
      undefined,
      "Plugin must pair via /studio/pair first to obtain a session_token",
      401,
    );
  }
  if (outcome === "expired") {
    return new RbxError(
      "RBX.AUTH.TOKEN_EXPIRED",
      "Session token expired (24h TTL)",
      true,
      undefined,
      "Plugin should refresh via /studio/refresh-token with stored pairing_secret",
      401,
    );
  }
  return new RbxError(
    "RBX.AUTH.INVALID_TOKEN",
    "Session token not recognized",
    false,
    undefined,
    "Plugin must re-pair via 'Pair Plugin' toolbar button",
    401,
  );
}

function requireAuth(request: IncomingMessage, pairing: PairingService): { token: string } {
  const status = verifyBearerAuth(request, pairing);
  if (status.outcome === "valid") return { token: status.token };
  throw bearerOutcomeToError(status.outcome);
}

export interface BridgeServerOptions {
  port?: number;
  pairingService: PairingService;
}

export function startBridgeServer(
  options: BridgeServerOptions,
): Promise<{ port: number; stop: () => void }> {
  const port = options.port ?? DEFAULT_PORT;
  const pairingService = options.pairingService;
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

      // POST /studio/pair { code, plugin_version } → { pairing_secret, session_token }
      // One-time exchange. Rate-limited (F4).
      if (request.method === "POST" && pathname === "/studio/pair") {
        try {
          const rl = pairingService.checkPairRateLimit();
          if (!rl.allowed) {
            throw new RbxError(
              "RBX.HANDSHAKE.RATE_LIMITED",
              `Too many pair attempts; try again in ${Math.ceil(rl.resetInMs / 1000)}s`,
              true,
              { resetInMs: rl.resetInMs },
              "Wait then retry. If you didn't trigger this, check for another process abusing /studio/pair.",
              429,
              rl.resetInMs,
            );
          }
          const body = await readJsonBody(request);
          if (!isRecord(body)) {
            throw new RbxError(
              "RBX.VALIDATION.INVALID_INPUT",
              "Body must be JSON object",
              false,
              undefined,
              undefined,
              400,
            );
          }
          const code = asString(body["code"]);
          const pluginVersion = asString(body["plugin_version"]);
          if (!code || !pluginVersion) {
            throw new RbxError(
              "RBX.HANDSHAKE.MISSING_FIELDS",
              "Body must include {code, plugin_version}",
              false,
              undefined,
              undefined,
              400,
            );
          }
          const compat = checkVersionCompat(SERVER_VERSION, pluginVersion);
          if (compat === "major_mismatch") {
            throw new RbxError(
              "RBX.HANDSHAKE.VERSION_MISMATCH",
              `Server v${SERVER_VERSION} cannot pair with plugin v${pluginVersion}`,
              false,
              { server: SERVER_VERSION, plugin: pluginVersion },
              "Upgrade the older component to a matching major version",
              426,
            );
          }
          if (!pairingService.consumePairingCode(code)) {
            throw new RbxError(
              "RBX.HANDSHAKE.INVALID_CODE",
              "Pairing code is invalid or expired",
              false,
              undefined,
              "Restart `npx roblox-shipcheck` to get a new code, then try again within 60s",
              401,
            );
          }
          // F10: clobber existing session on re-pair
          if (activeSession) {
            pairingService.revokeSessionToken(activeSession.token);
            activeSession = null;
            setCurrentSessionToken(undefined);
          }
          const pairingSecret = await pairingService.loadOrCreatePairingSecret();
          const session = pairingService.issueSessionToken();
          sendJson(request, response, 200, {
            ok: true,
            pairing_secret: pairingSecret,
            session_token: session.token,
            session_token_expires_at: session.expiresAt,
            server_version: SERVER_VERSION,
          });
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        return;
      }

      // POST /studio/connect { version, nonce_client }
      // Bearer required. Issues HMAC challenge.
      if (request.method === "POST" && pathname === "/studio/connect") {
        try {
          const tokenStatus = verifyBearerAuth(request, pairingService);
          if (tokenStatus.outcome !== "valid") {
            throw bearerOutcomeToError(tokenStatus.outcome);
          }
          const body = await readJsonBody(request);
          if (!isRecord(body)) {
            throw new RbxError(
              "RBX.VALIDATION.INVALID_INPUT",
              "Body must be JSON object",
              false,
              undefined,
              undefined,
              400,
            );
          }
          const pluginVersion = asString(body["version"]);
          const nonceClient = asString(body["nonce_client"]);
          if (!pluginVersion || !nonceClient) {
            throw new RbxError(
              "RBX.HANDSHAKE.MISSING_FIELDS",
              "/studio/connect body must include {version, nonce_client}",
              false,
              undefined,
              undefined,
              400,
            );
          }
          const compat = checkVersionCompat(SERVER_VERSION, pluginVersion);
          if (compat === "major_mismatch") {
            throw new RbxError(
              "RBX.HANDSHAKE.VERSION_MISMATCH",
              `Server v${SERVER_VERSION} cannot pair with plugin v${pluginVersion}`,
              false,
              { server: SERVER_VERSION, plugin: pluginVersion },
              "Upgrade the older component",
              426,
            );
          }
          if (compat === "minor_warning") {
            console.error(
              `[roblox-shipcheck] WARN: minor drift server ${SERVER_VERSION} vs plugin ${pluginVersion}`,
            );
          }
          const { challengeId, nonceServer } = pairingService.issueChallenge(nonceClient);
          sendJson(request, response, 200, {
            ok: true,
            challenge_id: challengeId,
            nonce_server: nonceServer,
          });
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        return;
      }

      // POST /studio/connect/proof { challenge_id, proof }
      // Final handshake step. On success, marks plugin connected.
      if (request.method === "POST" && pathname === "/studio/connect/proof") {
        try {
          const tokenStatus = verifyBearerAuth(request, pairingService);
          if (tokenStatus.outcome !== "valid") {
            throw bearerOutcomeToError(tokenStatus.outcome);
          }
          const body = await readJsonBody(request);
          if (!isRecord(body)) {
            throw new RbxError(
              "RBX.VALIDATION.INVALID_INPUT",
              "Body must be JSON object",
              false,
              undefined,
              undefined,
              400,
            );
          }
          const challengeId = asString(body["challenge_id"]);
          const proof = asString(body["proof"]);
          if (!challengeId || !proof) {
            throw new RbxError(
              "RBX.HANDSHAKE.MISSING_FIELDS",
              "Body must include {challenge_id, proof}",
              false,
              undefined,
              undefined,
              400,
            );
          }
          const pairingSecret = await pairingService.loadOrCreatePairingSecret();
          if (!pairingService.verifyProof(challengeId, proof, pairingSecret)) {
            // F10: clear stale registry value on proof failure
            setCurrentSessionToken(undefined);
            throw new RbxError(
              "RBX.AUTH.PROOF_FAILED",
              "PROOF challenge failed — invalid HMAC or expired challenge",
              false,
              undefined,
              "Re-pair the plugin via the 'Pair Plugin' toolbar button",
              401,
            );
          }
          activeSession = {
            id: randomUUID(),
            token: tokenStatus.token,
            connectedAt: Date.now(),
            lastPollAt: Date.now(),
          };
          setCurrentSessionToken(activeSession.token);
          sendJson(request, response, 200, {
            ok: true,
            session_id: activeSession.id,
          });
          flushPollWaiters();
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        return;
      }

      // POST /studio/refresh-token { plugin_version, nonce_client }
      // Open endpoint (rate-limited). Plugin proves possession of pairing_secret
      // to mint a fresh session_token. The expired bearer is not consulted (F5).
      if (request.method === "POST" && pathname === "/studio/refresh-token") {
        try {
          const rl = pairingService.checkRefreshRateLimit();
          if (!rl.allowed) {
            throw new RbxError(
              "RBX.HANDSHAKE.RATE_LIMITED",
              `Too many refresh attempts; try again in ${Math.ceil(rl.resetInMs / 1000)}s`,
              true,
              { resetInMs: rl.resetInMs },
              undefined,
              429,
              rl.resetInMs,
            );
          }
          const body = await readJsonBody(request);
          if (!isRecord(body)) {
            throw new RbxError(
              "RBX.VALIDATION.INVALID_INPUT",
              "Body must be JSON",
              false,
              undefined,
              undefined,
              400,
            );
          }
          const pluginVersion = asString(body["plugin_version"]);
          const nonceClient = asString(body["nonce_client"]);
          if (!pluginVersion || !nonceClient) {
            throw new RbxError(
              "RBX.HANDSHAKE.MISSING_FIELDS",
              "Body must include {plugin_version, nonce_client}",
              false,
              undefined,
              undefined,
              400,
            );
          }
          if (checkVersionCompat(SERVER_VERSION, pluginVersion) === "major_mismatch") {
            throw new RbxError(
              "RBX.HANDSHAKE.VERSION_MISMATCH",
              `Cannot refresh: server v${SERVER_VERSION} vs plugin v${pluginVersion}`,
              false,
              { server: SERVER_VERSION, plugin: pluginVersion },
              "Upgrade the older component",
              426,
            );
          }
          const { challengeId, nonceServer } = pairingService.issueChallenge(nonceClient);
          sendJson(request, response, 200, {
            ok: true,
            challenge_id: challengeId,
            nonce_server: nonceServer,
          });
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        return;
      }

      // POST /studio/refresh-token/proof { challenge_id, proof }
      // Verifies HMAC against current pairing_secret. Mints fresh session_token.
      if (request.method === "POST" && pathname === "/studio/refresh-token/proof") {
        try {
          const body = await readJsonBody(request);
          if (!isRecord(body)) {
            throw new RbxError(
              "RBX.VALIDATION.INVALID_INPUT",
              "Body must be JSON",
              false,
              undefined,
              undefined,
              400,
            );
          }
          const challengeId = asString(body["challenge_id"]);
          const proof = asString(body["proof"]);
          if (!challengeId || !proof) {
            throw new RbxError(
              "RBX.HANDSHAKE.MISSING_FIELDS",
              "Body must include {challenge_id, proof}",
              false,
              undefined,
              undefined,
              400,
            );
          }
          const pairingSecret = await pairingService.loadOrCreatePairingSecret();
          if (!pairingService.verifyProof(challengeId, proof, pairingSecret)) {
            // F10: a refresh failure invalidates trust in the current credential state.
            // Clear registry BEFORE the throw so subsequent MCP-side requests get
            // RBX.AUTH.MISSING_TOKEN rather than continuing with a stale token.
            setCurrentSessionToken(undefined);
            throw new RbxError(
              "RBX.AUTH.PROOF_FAILED",
              "Refresh PROOF failed — pairing_secret mismatch or expired challenge",
              false,
              undefined,
              "Re-pair via 'Pair Plugin' toolbar button",
              401,
            );
          }
          // F11-followup (review item 11): revoke ALL session tokens before issuing new one.
          // Single-instance scope: only one paired plugin at a time, so stale tokens left over
          // from prior pair attempts are NOT desirable. Refresh = reset.
          // F10: clear registry before revoking stale tokens
          setCurrentSessionToken(undefined);
          pairingService.revokeAllSessionTokens();
          const fresh = pairingService.issueSessionToken();
          if (activeSession) {
            activeSession.token = fresh.token;
          }
          setCurrentSessionToken(fresh.token);
          sendJson(request, response, 200, {
            ok: true,
            session_token: fresh.token,
            session_token_expires_at: fresh.expiresAt,
          });
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        return;
      }

      if (request.method === "GET" && pathname === "/studio/poll") {
        // Capture the token at poll entry so the long-poll waiter can detect
        // session replacement (re-pair, refresh, revoke) and bail out instead
        // of delivering commands meant for the old plugin connection.
        let boundToken: string;
        try {
          const auth = requireAuth(request, pairingService);
          if (!activeSession || activeSession.token !== auth.token) {
            throw new RbxError(
              "RBX.AUTH.SESSION_REVOKED",
              "Session token not bound to active plugin connection",
              false,
              undefined,
              "Plugin must re-run /studio/connect",
              401,
            );
          }
          activeSession.lastPollAt = Date.now();
          boundToken = auth.token;
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
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
            const sessionMismatch = !activeSession || activeSession.token !== boundToken;
            if (sessionMismatch || response.writableEnded || response.destroyed || stopping) {
              clearInterval(waiter.interval);
              clearTimeout(waiter.timeout);
              pollWaiters.delete(waiter);
              if (!response.writableEnded) {
                if (sessionMismatch) {
                  // activeSession is null OR was replaced by a new pair/refresh.
                  // Either way: don't deliver commands for a stale plugin connection.
                  sendErrorEnvelope(
                    request,
                    response,
                    new RbxError(
                      "RBX.AUTH.SESSION_REVOKED",
                      "Session ended or replaced during long-poll",
                      false,
                      undefined,
                      "Reconnect",
                      401,
                    ),
                    randomUUID(),
                  );
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
        try {
          const auth = requireAuth(request, pairingService);
          if (!activeSession || activeSession.token !== auth.token) {
            throw new RbxError(
              "RBX.AUTH.SESSION_REVOKED",
              "Session token not bound to active plugin connection",
              false,
              undefined,
              "Plugin must re-run /studio/connect",
              401,
            );
          }
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        const body = await readJsonBody(request);
        if (!isRecord(body)) {
          sendError(request, response, 400, "Request body must be a JSON object");
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
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
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
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("search", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/screenshot") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const viewport = url.searchParams.get("viewport") ?? "game";
        const result = await enqueueCommand("get_screenshot", { viewport });
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/tests/run") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("run_tests", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname.startsWith("/api/tests/results/")) {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
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
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("apply_patch", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/patch/undo") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("undo_patch", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/execute") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("execute_code", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/script/source") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
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
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
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
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
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
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
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
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("create_instance", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/instance/delete") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("delete_instance", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/instance/clone") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("clone_instance", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/instance/move") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("move_instance", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/instance/set-property") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("set_instance_property", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/instance/children") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
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
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const result = await enqueueCommand("get_selection", {});
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/tags") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("manage_tags", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/attributes") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("manage_attributes", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/playtest/start") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("start_playtest", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/playtest/stop") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const result = await enqueueCommand("stop_playtest", {});
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/output") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
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
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const result = await enqueueCommand("teleport_graph", {});
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "GET" && pathname === "/api/packages") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const result = await enqueueCommand("package_info", {});
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/ui/build") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("build_ui", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/lighting/apply") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
        if (!requirePluginSession(request, response)) {
          return;
        }
        const body = await readJsonBody(request);
        const result = await enqueueCommand("apply_lighting", body);
        sendJson(request, response, 200, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/terrain/generate") {
        try {
          requireAuth(request, pairingService);
        } catch (err) {
          if (err instanceof RbxError) {
            sendErrorEnvelope(request, response, err, randomUUID());
            return;
          }
          throw err;
        }
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
      const addr = server.address();
      const boundPort = addr !== null && typeof addr === "object" ? addr.port : port;
      resolve({
        port: boundPort,
        stop: () => {
          stopping = true;
          activeSession = null;
          setCurrentSessionToken(undefined);
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

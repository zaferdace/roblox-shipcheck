import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { SERVER_VERSION } from "../shared.js";
import { CommandQueue } from "./command-queue.js";
import { RbxError, tryCatchHandler } from "./errors.js";
import { SessionLifecycle } from "./lifecycle.js";
import { PairingService } from "./pairing.js";
import { setCurrentSessionToken } from "./session-registry.js";
import { checkVersionCompat } from "./version-check.js";

type JsonRecord = Record<string, unknown>;

const DEFAULT_PORT = 33796;
const POLL_WAIT_MS = 25_000;
const POLL_CHECK_MS = 100;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_BODY_SIZE = 10 * 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 5_000;

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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buffer.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw new RbxError(
        "RBX.VALIDATION.BODY_TOO_LARGE",
        `Request body exceeds ${MAX_BODY_SIZE} bytes`,
        false,
        { max_bytes: MAX_BODY_SIZE },
        undefined,
        413,
      );
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
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new RbxError(
      "RBX.VALIDATION.INVALID_JSON",
      "Request body is not valid JSON",
      false,
      undefined,
      undefined,
      400,
    );
  }
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
  const lifecycle = new SessionLifecycle();
  const commandQueue = new CommandQueue({ timeoutMs: COMMAND_TIMEOUT_MS });
  const pollWaiters = new Set<{
    response: ServerResponse;
    request: IncomingMessage;
    interval: NodeJS.Timeout;
    timeout: NodeJS.Timeout;
  }>();
  let stopping = false;

  commandQueue.onEnqueue(() => flushPollWaiters());

  const requirePluginSession = (): void => {
    if (lifecycle.state() !== "active") {
      throw lifecycle.commandError();
    }
  };

  const flushPollWaiters = (): void => {
    if (commandQueue.size() === 0) {
      return;
    }
    for (const waiter of [...pollWaiters]) {
      if (waiter.response.writableEnded || waiter.response.destroyed) {
        clearInterval(waiter.interval);
        clearTimeout(waiter.timeout);
        pollWaiters.delete(waiter);
        continue;
      }
      const next = commandQueue.shift();
      if (!next) {
        break;
      }
      clearInterval(waiter.interval);
      clearTimeout(waiter.timeout);
      pollWaiters.delete(waiter);
      lifecycle.heartbeat();
      sendJson(waiter.request, waiter.response, 200, {
        id: next.id,
        command: next.command,
        params: next.params,
      });
    }
  };

  // F8: 5-second heartbeat timer ticks the lifecycle and rejects in-flight commands on terminal expiry.
  // Snapshot the error BEFORE tick() transitions state to idle so commands get the correct error code.
  const heartbeatInterval = setInterval(() => {
    const prevState = lifecycle.state();
    let expiryError: RbxError | undefined;
    if (prevState === "reload_grace") {
      expiryError = new RbxError(
        "RBX.PLUGIN.RELOAD_TIMEOUT",
        "Plugin reload grace window exceeded; session terminated",
        false,
        undefined,
        "Restart the plugin in Studio and reconnect",
        503,
      );
    } else if (prevState === "quitting") {
      expiryError = new RbxError(
        "RBX.STUDIO.QUITTING",
        "Studio quit; in-flight commands rejected",
        false,
        undefined,
        "Reopen Studio and reconnect",
        503,
      );
    }
    lifecycle.tick();
    if (prevState !== "idle" && lifecycle.state() === "idle") {
      if (expiryError) {
        commandQueue.rejectAll(expiryError);
      }
      setCurrentSessionToken(undefined);
    }
  }, HEARTBEAT_INTERVAL_MS);

  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);
    await tryCatchHandler(async (req, res) => {
      if (!req.url || !req.method) {
        throw new RbxError(
          "RBX.VALIDATION.INVALID_INPUT",
          "Invalid request — missing URL or method",
          false,
          undefined,
          undefined,
          400,
        );
      }

      if (req.method === "OPTIONS") {
        withCorsHeaders(req, res);
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);
      const pathname = url.pathname;

      // POST /studio/pair { code, plugin_version } → { pairing_secret, session_token }
      // One-time exchange. Rate-limited (F4).
      if (req.method === "POST" && pathname === "/studio/pair") {
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
        const body = await readJsonBody(req);
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
        if (lifecycle.session()) {
          pairingService.revokeSessionToken(lifecycle.session()!.token);
          setCurrentSessionToken(undefined);
        }
        const pairingSecret = await pairingService.loadOrCreatePairingSecret();
        const session = pairingService.issueSessionToken();
        sendJson(req, res, 200, {
          ok: true,
          pairing_secret: pairingSecret,
          session_token: session.token,
          session_token_expires_at: session.expiresAt,
          server_version: SERVER_VERSION,
        });
        return;
      }

      // POST /studio/connect { version, nonce_client }
      // Bearer required. Issues HMAC challenge.
      if (req.method === "POST" && pathname === "/studio/connect") {
        const tokenStatus = verifyBearerAuth(req, pairingService);
        if (tokenStatus.outcome !== "valid") {
          throw bearerOutcomeToError(tokenStatus.outcome);
        }
        const body = await readJsonBody(req);
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
        sendJson(req, res, 200, {
          ok: true,
          challenge_id: challengeId,
          nonce_server: nonceServer,
        });
        return;
      }

      // POST /studio/connect/proof { challenge_id, proof }
      // Final handshake step. On success, marks plugin connected.
      if (req.method === "POST" && pathname === "/studio/connect/proof") {
        const tokenStatus = verifyBearerAuth(req, pairingService);
        if (tokenStatus.outcome !== "valid") {
          throw bearerOutcomeToError(tokenStatus.outcome);
        }
        const body = await readJsonBody(req);
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
        const sessionId = randomUUID();
        lifecycle.attach({ id: sessionId, token: tokenStatus.token, connectedAt: Date.now() });
        setCurrentSessionToken(tokenStatus.token);
        sendJson(req, res, 200, {
          ok: true,
          session_id: sessionId,
        });
        flushPollWaiters();
        return;
      }

      // POST /studio/refresh-token { plugin_version, nonce_client }
      // Open endpoint (rate-limited). Plugin proves possession of pairing_secret
      // to mint a fresh session_token. The expired bearer is not consulted (F5).
      if (req.method === "POST" && pathname === "/studio/refresh-token") {
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
        const body = await readJsonBody(req);
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
        sendJson(req, res, 200, {
          ok: true,
          challenge_id: challengeId,
          nonce_server: nonceServer,
        });
        return;
      }

      // POST /studio/refresh-token/proof { challenge_id, proof }
      // Verifies HMAC against current pairing_secret. Mints fresh session_token.
      if (req.method === "POST" && pathname === "/studio/refresh-token/proof") {
        const body = await readJsonBody(req);
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
        // Update the session token in the lifecycle if there's an active session
        const currentSession = lifecycle.session();
        if (currentSession) {
          lifecycle.attach({ ...currentSession, token: fresh.token });
        }
        setCurrentSessionToken(fresh.token);
        sendJson(req, res, 200, {
          ok: true,
          session_token: fresh.token,
          session_token_expires_at: fresh.expiresAt,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/studio/poll") {
        // Capture the token at poll entry so the long-poll waiter can detect
        // session replacement (re-pair, refresh, revoke) and bail out instead
        // of delivering commands meant for the old plugin connection.
        const auth = requireAuth(req, pairingService);
        if (lifecycle.state() !== "active" || lifecycle.session()?.token !== auth.token) {
          throw new RbxError(
            "RBX.AUTH.SESSION_REVOKED",
            "Session token not bound to active plugin connection",
            false,
            undefined,
            "Plugin must re-run /studio/connect",
            401,
          );
        }
        const heartbeatResult = lifecycle.heartbeat();
        // F18: plugin reattached during grace — commands queued targeted the
        // pre-reload context. Reject them so caller retries against fresh state.
        if (heartbeatResult.reconnected) {
          commandQueue.rejectAll(
            new RbxError(
              "RBX.PLUGIN.RECONNECTED",
              "Plugin reconnected after grace; queued commands invalidated for state consistency",
              true,
              undefined,
              "Retry the original tool call — fresh plugin context now active",
              503,
            ),
          );
        }
        const boundToken = auth.token;
        const next = commandQueue.shift();
        if (next) {
          sendJson(req, res, 200, {
            id: next.id,
            command: next.command,
            params: next.params,
          });
          return;
        }
        const waiter = {
          response: res,
          request: req,
          interval: setInterval(() => {
            const sessionMismatch =
              lifecycle.state() !== "active" || lifecycle.session()?.token !== boundToken;
            if (sessionMismatch || res.writableEnded || res.destroyed || stopping) {
              clearInterval(waiter.interval);
              clearTimeout(waiter.timeout);
              pollWaiters.delete(waiter);
              if (!res.writableEnded) {
                if (sessionMismatch) {
                  // lifecycle is not active OR token was replaced by a new pair/refresh.
                  // Either way: don't deliver commands for a stale plugin connection.
                  sendJson(req, res, 401, {
                    ok: false,
                    error: {
                      code: "RBX.AUTH.SESSION_REVOKED",
                      message: "Session ended or replaced during long-poll",
                      retryable: false,
                      request_id: requestId,
                      remediation: "Reconnect",
                    },
                  });
                } else {
                  sendJson(req, res, 200, { command: null });
                }
              }
              return;
            }
            if (commandQueue.size() === 0) {
              return;
            }
            const command = commandQueue.shift();
            if (!command) {
              return;
            }
            lifecycle.heartbeat();
            clearInterval(waiter.interval);
            clearTimeout(waiter.timeout);
            pollWaiters.delete(waiter);
            sendJson(req, res, 200, {
              id: command.id,
              command: command.command,
              params: command.params,
            });
          }, POLL_CHECK_MS),
          timeout: setTimeout(() => {
            clearInterval(waiter.interval);
            pollWaiters.delete(waiter);
            if (!res.writableEnded) {
              sendJson(req, res, 200, { command: null });
            }
          }, POLL_WAIT_MS),
        };
        pollWaiters.add(waiter);
        req.on("close", () => {
          clearInterval(waiter.interval);
          clearTimeout(waiter.timeout);
          pollWaiters.delete(waiter);
        });
        return;
      }

      if (req.method === "POST" && pathname === "/studio/response") {
        const auth = requireAuth(req, pairingService);
        if (lifecycle.session()?.token !== auth.token) {
          throw new RbxError(
            "RBX.AUTH.SESSION_REVOKED",
            "Session token not bound to active plugin connection",
            false,
            undefined,
            "Plugin must re-run /studio/connect",
            401,
          );
        }
        const body = await readJsonBody(req);
        if (!isRecord(body)) {
          throw new RbxError(
            "RBX.VALIDATION.INVALID_INPUT",
            "Request body must be a JSON object",
            false,
            undefined,
            undefined,
            400,
          );
        }
        const commandId = asString(body["commandId"]);
        if (!commandId) {
          throw new RbxError(
            "RBX.VALIDATION.MISSING_FIELD",
            "Missing commandId",
            false,
            undefined,
            undefined,
            400,
          );
        }
        const command = commandQueue.cleanup(commandId);
        if (!command) {
          throw new RbxError(
            "RBX.VALIDATION.UNKNOWN_COMMAND",
            "Command ID not found in pending queue",
            false,
            undefined,
            undefined,
            404,
          );
        }
        const errorMessage = asString(body["error"]);
        if (errorMessage) {
          command.reject(new Error(errorMessage));
        } else {
          command.resolve(body["result"]);
        }
        sendJson(req, res, 200, { ok: true });
        return;
      }

      // POST /studio/disconnect { reason: "studio_quitting" | "plugin_unloading" }
      // Plugin POSTs this on Unloading or BindToClose (F9).
      if (req.method === "POST" && pathname === "/studio/disconnect") {
        const auth = requireAuth(req, pairingService);
        if (lifecycle.session()?.token !== auth.token) {
          throw new RbxError(
            "RBX.AUTH.SESSION_REVOKED",
            "Session token not bound to active plugin connection",
            false,
            undefined,
            "Plugin must re-run /studio/connect",
            401,
          );
        }
        const body = await readJsonBody(req);
        const reason = isRecord(body) ? asString(body["reason"]) : undefined;
        if (reason === "studio_quitting") {
          // F9: non-retryable terminal — Studio is closing
          lifecycle.markQuitting();
        } else if (reason === "plugin_unloading") {
          // F9: immediately enter reload_grace so subsequent /api/* gets RELOADING
          lifecycle.markReloading();
        }
        sendJson(req, res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && pathname === "/api/ping") {
        sendJson(req, res, 200, {
          ok: true,
          version: SERVER_VERSION,
          plugin_connected: lifecycle.state() === "active",
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/datamodel") {
        requireAuth(req, pairingService);
        requirePluginSession();
        const params = {
          max_depth: coerceInteger(url.searchParams.get("max_depth") ?? undefined),
          root_path: url.searchParams.get("root_path") ?? undefined,
          include_properties: coerceBoolean(
            url.searchParams.get("include_properties") ?? undefined,
          ),
        };
        const result = await commandQueue.enqueue("get_datamodel", params);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/search") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("search", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "GET" && pathname === "/api/screenshot") {
        requireAuth(req, pairingService);
        requirePluginSession();
        const viewport = url.searchParams.get("viewport") ?? "game";
        const result = await commandQueue.enqueue("get_screenshot", { viewport });
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/tests/run") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("run_tests", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/api/tests/results/")) {
        requireAuth(req, pairingService);
        requirePluginSession();
        const runId = decodeURIComponent(pathname.slice("/api/tests/results/".length));
        if (!runId) {
          throw new RbxError(
            "RBX.VALIDATION.MISSING_FIELD",
            "Missing runId in URL",
            false,
            undefined,
            undefined,
            400,
          );
        }
        const result = await commandQueue.enqueue("get_test_results", { runId });
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/patch") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("apply_patch", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/patch/undo") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("undo_patch", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/execute") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("execute_code", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "GET" && pathname === "/api/script/source") {
        requireAuth(req, pairingService);
        requirePluginSession();
        const path = url.searchParams.get("path") ?? undefined;
        if (!path) {
          throw new RbxError(
            "RBX.VALIDATION.MISSING_FIELD",
            "Missing 'path' query param",
            false,
            { field: "path" },
            undefined,
            400,
          );
        }
        const result = await commandQueue.enqueue("get_script_source", { path });
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/script/source") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("set_script_source", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (
        req.method === "GET" &&
        pathname.startsWith("/api/instance/") &&
        pathname.endsWith("/properties") &&
        pathname !== "/api/instance/properties"
      ) {
        requireAuth(req, pairingService);
        requirePluginSession();
        const instanceId = decodeURIComponent(
          pathname.slice("/api/instance/".length, -"/properties".length),
        );
        if (!instanceId) {
          throw new RbxError(
            "RBX.VALIDATION.MISSING_FIELD",
            "Missing instance id in URL",
            false,
            undefined,
            undefined,
            400,
          );
        }
        const result = await commandQueue.enqueue("get_properties", { id: instanceId });
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "GET" && pathname === "/api/instance/properties") {
        requireAuth(req, pairingService);
        requirePluginSession();
        const path = url.searchParams.get("path") ?? undefined;
        if (!path) {
          throw new RbxError(
            "RBX.VALIDATION.MISSING_FIELD",
            "Missing 'path' query param",
            false,
            { field: "path" },
            undefined,
            400,
          );
        }
        const result = await commandQueue.enqueue("get_properties", { path });
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/instance/create") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("create_instance", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/instance/delete") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("delete_instance", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/instance/clone") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("clone_instance", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/instance/move") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("move_instance", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/instance/set-property") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("set_instance_property", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "GET" && pathname === "/api/instance/children") {
        requireAuth(req, pairingService);
        requirePluginSession();
        const path = url.searchParams.get("path") ?? undefined;
        const depth = coerceInteger(url.searchParams.get("depth") ?? undefined);
        const result = await commandQueue.enqueue("get_children", {
          ...(path ? { path } : {}),
          ...(depth !== undefined ? { depth } : {}),
        });
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "GET" && pathname === "/api/selection") {
        requireAuth(req, pairingService);
        requirePluginSession();
        const result = await commandQueue.enqueue("get_selection", {});
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/tags") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("manage_tags", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/attributes") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("manage_attributes", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/playtest/start") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("start_playtest", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/playtest/stop") {
        requireAuth(req, pairingService);
        requirePluginSession();
        const result = await commandQueue.enqueue("stop_playtest", {});
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "GET" && pathname === "/api/output") {
        requireAuth(req, pairingService);
        requirePluginSession();
        const limit = coerceInteger(url.searchParams.get("limit") ?? undefined);
        const result = await commandQueue.enqueue("get_output", {
          ...(limit !== undefined ? { limit } : {}),
        });
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "GET" && pathname === "/api/teleport-graph") {
        requireAuth(req, pairingService);
        requirePluginSession();
        const result = await commandQueue.enqueue("teleport_graph", {});
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "GET" && pathname === "/api/packages") {
        requireAuth(req, pairingService);
        requirePluginSession();
        const result = await commandQueue.enqueue("package_info", {});
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/ui/build") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("build_ui", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/lighting/apply") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("apply_lighting", body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/terrain/generate") {
        requireAuth(req, pairingService);
        const body = await readJsonBody(req);
        requirePluginSession();
        const result = await commandQueue.enqueue("terrain_generate", body);
        sendJson(req, res, 200, result);
        return;
      }

      throw new RbxError(
        "RBX.VALIDATION.UNKNOWN_ROUTE",
        `${req.method} ${pathname}`,
        false,
        undefined,
        undefined,
        404,
      );
    })(request, response, requestId);
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
          clearInterval(heartbeatInterval);
          stopping = true;
          setCurrentSessionToken(undefined);
          lifecycle.markQuitting();
          lifecycle.tick();
          for (const waiter of pollWaiters) {
            clearInterval(waiter.interval);
            clearTimeout(waiter.timeout);
            if (!waiter.response.writableEnded) {
              sendJson(waiter.request, waiter.response, 200, { command: null });
            }
          }
          pollWaiters.clear();
          commandQueue.rejectAll(
            new RbxError(
              "RBX.BRIDGE.SHUTDOWN",
              "Bridge server stopped; in-flight commands rejected",
              false,
              undefined,
              "Restart the MCP server",
              503,
            ),
          );
          server.close(() => undefined);
        },
      });
    });
  });
}

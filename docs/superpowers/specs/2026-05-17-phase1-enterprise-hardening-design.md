# Phase 1 — Enterprise Hardening Design

**Date:** 2026-05-17
**Version target:** `0.2.0` (breaking: auth required)
**Scope constraint:** SINGLE Studio instance only. No multi-window, no per-project state, no agent-tracking.
**Status:** Approved by user 2026-05-17. Ready for plan generation.

---

## 1. Problem Statement

`roblox-shipcheck` v0.1.0 exposes a localhost HTTP bridge on `127.0.0.1:33796` with three critical exposure surfaces:

1. `POST /studio/connect` is unauthenticated and unconditionally overwrites the active plugin session. Any localhost process can hijack the Studio session in flight.
2. The 23 `/api/*` endpoints only check `activeSession !== null` — they never verify the session token. Once a plugin is connected, any localhost caller can drive Studio.
3. There is no server↔plugin version handshake. The plugin already sends `{version}` on `/studio/connect` (line 1564 of the recovered `init.server.lua`) but the server ignores it.

Additional production-readiness gaps: flat `{error: string}` responses (no structured codes or retry semantics), `lastPollAt` recorded but never read (stale-session leak), no `plugin_reload` vs `studio_quitting` distinction, unbounded `queuedCommands` array, plugin Lua source lost from repo (only `.rbxm` binary present).

The plugin Lua source IS recoverable from git history (`56100b0^:plugin/src/init.server.lua`, 1591 lines).

## 2. Goals

Phase 1 ships seven atomic, ordered concerns that close the security and correctness gaps. After Phase 1:

- No localhost process other than the paired Studio plugin can connect to the bridge or invoke `/api/*` endpoints.
- Server and plugin refuse mismatched major versions; minor mismatches warn loudly.
- Every error response carries a machine-readable code with retry semantics.
- Session expiration is deterministic; in-flight commands cannot leak past plugin reload or Studio quit.
- The plugin Lua source is back in the repo, version-controlled and Rojo-buildable.
- A single feature branch with seven atomic commits and one PR delivers the work; version bumps to `0.2.0`.

Phase 1 does NOT include: module catalog, `/healthz`, metrics, lockstep release of `.rbxm`, tool-mode declarations, plugin auto-update. Those are Phase 2 / Phase 3.

## 3. Architecture (post-Phase 1)

```
MCP Client <-stdio-> Node MCP server <-HTTP 127.0.0.1:33796-> Bridge (same process) <-long-poll-> Studio Plugin (.rbxm)
                                              ↑
                                       Bearer auth on every route
                                       (HMAC-PROOF on initial pair)
```

**New persistence surfaces:**

- Server: `pairing_secret` (32 bytes base64url) stored in OS keychain via `keytar`, with `~/.config/roblox-shipcheck/pairing.json` (mode 0600) as fallback when `keytar` is unavailable.
- Plugin: `pairing_secret` and `session_token` stored via `plugin:SetSetting()`.

**New process surfaces:**

- Background heartbeat timer (5s tick) reads `lastPollAt` and expires the active session when grace window exceeded.
- Bounded command queue (newest-reject backpressure) replaces the unbounded `queuedCommands: QueuedCommand[]`.

## 4. Component Design

### 4.1 Plugin Source Restore + Rojo Build (Item 1)

**Recovery:**
```bash
git checkout 56100b0^ -- plugin/src/init.server.lua
```

**Decisions:**
- **D1.1** Keep monolithic 1591-line `init.server.lua` AS-IS for Phase 1. Modular split is its own concern; mixing source-recovery with refactor risks Phase 1's atomic value.
- **D1.2** `.gitignore` the built `.rbxm`. CI workflow (Phase 2) will build and attach to GitHub releases. For Phase 1, devs build locally via Rojo.
- **D1.3** `npm run build` triggers both `tsc` AND `rojo build plugin/default.project.json -o dist/RobloxShipcheck.rbxm`. Single command, single artifact dir.
- **D1.4** Require local Rojo via aftman (already standard Roblox toolchain). `aftman.toml` lives at repo root pinning a Rojo version. CI installs aftman; local devs install once.

**Files touched:**
- `plugin/src/init.server.lua` (restored from git history)
- `.gitignore` (add `plugin/src/RobloxShipcheck.rbxm`, `dist/*.rbxm`)
- `aftman.toml` (new — pin Rojo)
- `package.json` (build script gains rojo step)
- `plugin/default.project.json` (verify tree)

### 4.2 Version Handshake (Item 2)

**Decisions:**
- **D2.1** Major must match, minor mismatch warns, patch ignored.
- **D2.2** Return HTTP 426 Upgrade Required on major mismatch.
- **D2.3** Block both directions (server-newer-than-plugin AND plugin-newer-than-server). Mismatch = untested state.

**Server-side change (`src/bridge/server.ts:262`):**
```ts
if (request.method === "POST" && pathname === "/studio/connect") {
  const body = await readJsonBody(request);
  const pluginVersion = isRecord(body) ? asString(body["version"]) : undefined;
  if (!pluginVersion) {
    return sendStructuredError(req, res, 400, {
      code: "RBX.HANDSHAKE.MISSING_VERSION",
      message: "Plugin must send version in request body",
      retryable: false,
    });
  }
  const compat = checkVersionCompat(SERVER_VERSION, pluginVersion);
  if (compat === "major_mismatch") {
    return sendStructuredError(req, res, 426, {
      code: "RBX.HANDSHAKE.VERSION_MISMATCH",
      message: `Server v${SERVER_VERSION} cannot pair with plugin v${pluginVersion}`,
      data: { server: SERVER_VERSION, plugin: pluginVersion },
      retryable: false,
      remediation: "Update the older component to a matching major version",
    });
  }
  // ... pair flow continues
}
```

**Plugin already sends `{version: PLUGIN_VERSION}`** — no plugin-side change required for this item.

### 4.3 Pairing Secret + PROOF Handshake (Item 3) — Centerpiece

**Flow:**

```
[INSTALL — one time per user/machine]
1. User runs `npx roblox-shipcheck` for the first time on this machine.
2. Server generates pairing_secret (32 bytes base64url), stores in keytar
   (fallback: ~/.config/roblox-shipcheck/pairing.json mode 0600).
3. Server prints to stderr:
     ┌─────────────────────────────────────────┐
     │  Plugin pairing required.               │
     │  Pairing code: 749182 (valid 60s)       │
     │  In Studio: click 'Pair Plugin' button. │
     └─────────────────────────────────────────┘
4. User opens Studio plugin → clicks 'Pair Plugin' → enters 749182.
5. Plugin POST /studio/pair { code: "749182", plugin_version: "0.2.0" }
6. Server validates code (time-bound, single-use), returns:
     { pairing_secret: "<base64url>", session_token: "<base64url>" }
7. Plugin SetSetting pairing_secret + session_token. Persisted.

[CONNECT — every Studio open]
1. Plugin reads pairing_secret + session_token from SetSetting.
2. Plugin POST /studio/connect with header `Authorization: Bearer <session_token>`
   and body { version, nonce_client: "<16-byte b64>" }.
3. Server validates session_token (still fresh; <24h since last use).
4. Server replies with { nonce_server: "<16 bytes>", challenge_id: "<uuid>" }.
   challenge_id is the server-side correlation key; the server holds an
   in-memory Map<challenge_id, {nonce_server, nonce_client, issuedAt}> with
   60s TTL so it can verify proof without re-checking session state.
5. Plugin computes HMAC-SHA256(pairing_secret, nonce_server || nonce_client)
   and POST /studio/connect/proof { challenge_id, proof }.
6. Server verifies HMAC. On success: session_id assigned; activeSession set.
   On failure: 401 RBX.AUTH.PROOF_FAILED, plugin must re-pair.

[REFRESH — every 24h since issuance]
   session_token has a hard TTL of 24h from issuance (NOT from last use —
   keeps the protocol stateless). On any /api/* call past TTL, server
   returns 401 RBX.AUTH.TOKEN_EXPIRED.

   Plugin then POST /studio/refresh-token with the EXPIRED Bearer plus
   body { nonce_client }. Server validates: (a) bearer was issued by us
   even though expired, (b) issues new nonce_server + challenge_id.
   Plugin computes HMAC over stored pairing_secret and POSTs
   /studio/refresh-token/proof. Server verifies, issues fresh
   session_token + new challenge_id for the active connection.

   No user interaction required since pairing_secret is still valid.
   The refresh endpoint is the ONLY route that accepts expired bearers
   (and only to issue replacements, not to read state).

[STALE OR INVALID SECRET]
   401 codes RBX.AUTH.PROOF_FAILED or RBX.AUTH.SESSION_REVOKED indicate the
   stored pairing_secret no longer works (server-side rotation, manual
   revoke, or corrupted SetSetting). Plugin clears stored secret + token via
   plugin:SetSetting(key, nil) and surfaces 'Re-pair required' toolbar
   state. RBX.AUTH.TOKEN_EXPIRED is a different case — refresh, do NOT wipe.
```

**Decisions in summary:**
- **D3.1** Short pairing code (6-digit, 60s TTL, single-use).
- **D3.2** HMAC-SHA256 challenge-response on every `/studio/connect`.
- **D3.3** Long-lived `pairing_secret` (lives until user revokes) + short-lived `session_token` (24h TTL).
- **D3.4** `base64url`, 32 bytes (43 chars).
- **D3.5** `keytar` primary, file fallback (`~/.config/roblox-shipcheck/pairing.json` 0600).
- **D3.6** `plugin:SetSetting("pairing_secret", ...)` and `plugin:SetSetting("session_token", ...)` plain.
- **D3.7** On 401 with code `RBX.AUTH.PROOF_FAILED`, `RBX.AUTH.INVALID_TOKEN`, or `RBX.AUTH.SESSION_REVOKED`: plugin wipes stored credentials and shows "Re-pair required" toolbar state with `Pair Plugin` button. (Note: `RBX.AUTH.TOKEN_EXPIRED` is a DIFFERENT case — plugin calls `/studio/refresh-token` instead of wiping.) Plugin uses empty-string sentinel for delete: `plugin:SetSetting(key, "")` because Roblox docs do not guarantee `nil` deletes; `getStoredSecret()` treats empty string as missing.

**New server endpoints:**
- `POST /studio/pair` (open, rate-limited 5 attempts/min global sliding window) — accepts pairing code, returns secret+token
- `POST /studio/connect/proof` — accepts HMAC proof, completes handshake
- `POST /studio/refresh-token` — accepts expired Bearer + does PROOF challenge with stored `pairing_secret`; returns fresh session_token without user re-pair. Required so plugin can recover from 24h expiry programmatically.

**New server module:** `src/bridge/pairing.ts`
- `generatePairingCode(): { code: string, expiresAt: number }` — 6-digit, 60s TTL, stored in-memory `Map<code, expiresAt>`
- `loadOrCreatePairingSecret(): Promise<string>` — tries keytar, falls back to file
- `issueSessionToken(): string` — 32-byte base64url
- `verifyProof(pairingSecret, nonceServer, nonceClient, proof): boolean`

**New plugin code paths** (in `plugin/src/init.server.lua`):
- Toolbar button `Pair Plugin` (PluginToolbarButton) → opens DockWidgetPlugin GUI with TextBox for code entry
- New top-level: `connect()` function (line 1554) restructured to do connect → receive nonce_server → compute HMAC → POST /studio/connect/proof
- Storage helpers: `getStoredSecret() / setStoredSecret(secret) / clearStored()` via `plugin:GetSetting / SetSetting`

### 4.4 Bearer Middleware on /api/* (Item 4)

**Decisions:**
- **D4.1** `Authorization: Bearer <session_token>` header.
- **D4.2** Reuse the session_token from pair flow (no separate MCP-side token).
- **D4.3** All auth failures return 401 with body `error.code` distinguishing reasons:
  - `RBX.AUTH.MISSING_TOKEN`
  - `RBX.AUTH.INVALID_TOKEN`
  - `RBX.AUTH.TOKEN_EXPIRED` (>24h since issuance — retryable via `/studio/refresh-token`)
  - `RBX.AUTH.SESSION_REVOKED`
  - `RBX.AUTH.PROOF_FAILED` (HMAC verification failed)
- **D4.4** Migrate `/studio/poll` from `?token=<>` query param to header. 0.2.0 is breaking anyway.
- **D4.5** Sole public endpoint: `GET /api/ping`. Used for liveness probes by both the MCP-side client and external monitors; returns `{ok, version, plugin_connected}`. Every other `/api/*` and `/studio/*` route (except `/studio/pair`) requires `Authorization: Bearer`. `/studio/pair` is open BUT rate-limited (5 attempts/min) and code-gated.

**Implementation:** A single `requireAuth(request, response): SessionContext | null` helper at the top of every route block. Returning `null` means the helper already sent the 401 — handler returns immediately.

```ts
const session = requireAuth(request, response);
if (!session) return;
// proceed with handler logic
```

The MCP-side caller (this same Node process — `src/index.ts`) holds the `session_token` in-memory after pair completion, and adds the Authorization header on all internal HTTP calls to the bridge. This means `src/roblox/studio-bridge-client.ts` gains a token-injection step.

### 4.5 Structured Error Envelope (Item 5)

**Decisions:**
- **D5.1** Namespace: `RBX.<CATEGORY>.<REASON>` (kebab-cap, period-separated). Categories: `AUTH`, `HANDSHAKE`, `PLUGIN`, `STUDIO`, `BRIDGE`, `TOOL`, `VALIDATION`.
- **D5.2** HTTP body shape:
  ```json
  {
    "ok": false,
    "error": {
      "code": "RBX.PLUGIN.NOT_CONNECTED",
      "message": "Studio plugin is not connected",
      "data": { "last_poll_at": 1747491200 },
      "retryable": true,
      "remediation": "Open Roblox Studio and click 'Toggle Connection' in the plugin toolbar",
      "request_id": "9b3f-..."
    }
  }
  ```
- **D5.3** `retryable: boolean` + `Retry-After` HTTP header when applicable (queue full, plugin reloading).
- **D5.4** Hybrid pipeline: top-level Express-style middleware (`tryCatchHandler`) catches all unhandled throws and converts to 500 `RBX.BRIDGE.INTERNAL` envelope. Handlers throw `RbxError` instances for known cases.
- **D5.5** MCP integration: `src/index.ts` `CallToolRequestSchema` handler's catch block detects `RbxError`, returns `{ content: [{type:"text", text: JSON.stringify(envelope)}], isError: true }`. Existing Zod errors become `RBX.VALIDATION.INVALID_INPUT`.

**New server module:** `src/bridge/errors.ts`
```ts
export class RbxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly data?: Record<string, unknown>,
    public readonly remediation?: string,
    public readonly httpStatus: number = 500,
    public readonly retryAfterMs?: number,
  ) { super(message); }
}

export function sendErrorEnvelope(req, res, err: RbxError, requestId: string): void { ... }
export function tryCatchHandler(handler: RouteHandler): RouteHandler { ... }
```

**Request ID generation:** Every request gets a `request_id` via `randomUUID()` at the very top of the createServer callback (before route dispatch). Stored on a local variable, threaded through to `sendErrorEnvelope` and any structured logging. Echoed in successful responses too via an `X-Request-Id` header so clients can correlate.

**Migration:** All 19 `sendError(...)` call sites in `src/bridge/server.ts` rewritten to throw `RbxError(...)` or call `sendErrorEnvelope(...)`. CORS + JSON-parse errors get fixed codes (`RBX.VALIDATION.INVALID_JSON`, etc.).

### 4.6 Session Lifecycle (Item 6)

**Decisions:**
- **D6.1** Grace window: `process.env.RBX_RELOAD_GRACE_MS` default `45000`.
- **D6.2** Both: 5s timer + per-request `lastPollAt` check.
- **D6.3** Explicit `plugin.Unloading:Connect` POSTs `/studio/disconnect { reason: "studio_quitting" }` (line 1588 of the recovered plugin already has Unloading connect — needs explicit POST). Heartbeat fallback: 45s without poll = expire.
- **D6.4** Apply distinction: `RBX.STUDIO.QUITTING` is non-retryable; `RBX.PLUGIN.RELOADING` is retryable within grace.
- **D6.5** Hold in-flight commands for the grace window. **If plugin reattaches → reject all with `RBX.PLUGIN.RECONNECTED` (retryable) for state-consistency safety** (queued commands targeted the pre-reload context; replaying mutations against the new context risks corruption — let caller retry with fresh context). If grace expires → reject all with `RBX.PLUGIN.RELOAD_TIMEOUT` (non-retryable).

**Implementation in `src/bridge/server.ts`:**
- New session state machine: `{ state: "active" | "reload_grace" | "quitting", lastPollAt, graceUntil }`
- 5s heartbeat timer: if `state === "active"` and `now - lastPollAt > 45000` → transition to `reload_grace` with `graceUntil = now + 45000`. If `state === "reload_grace"` and `now > graceUntil` → reject in-flight, clear `activeSession`.
- Per /api/* call: check `state`; if `reload_grace` → 503 with `RBX.PLUGIN.RELOADING` + `Retry-After: <ms-until-graceUntil>`; if `quitting` → 503 with `RBX.STUDIO.QUITTING` non-retryable.

**New endpoint:** `POST /studio/disconnect { reason }` — plugin signals clean quit/unpair.

### 4.7 Queue Cap (Item 7)

**Decisions:**
- **D7.1** Max: `process.env.RBX_QUEUE_MAX` default `100`.
- **D7.2** Newest-reject. On enqueue when full, throw `RbxError("RBX.BRIDGE.QUEUE_FULL", retryable=true, retryAfterMs=1000)`.
- **D7.3** Flat queue, no per-tool reserved slots. Revisit in Phase 2/3 if real workload shows starvation.

**Implementation in `src/bridge/server.ts:215 enqueueCommand`:**
```ts
const MAX_QUEUE = Number.parseInt(process.env.RBX_QUEUE_MAX ?? "100", 10);
const enqueueCommand = <T>(command, params): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (queuedCommands.length >= MAX_QUEUE) {
      // Reject promise instead of throwing — outer caller's
      // tryCatchHandler converts to error envelope.
      reject(new RbxError(
        "RBX.BRIDGE.QUEUE_FULL",
        `Command queue full (${queuedCommands.length}/${MAX_QUEUE})`,
        /*retryable*/ true,
        { current: queuedCommands.length, max: MAX_QUEUE },
        "Wait for in-flight commands to drain, then retry.",
        503,
        /*retryAfterMs*/ 1000,
      ));
      return;
    }
    // ... existing enqueue logic
  });
```

## 5. Cross-Cutting Decisions

- **C1** Single feature branch `feat/phase1-enterprise-hardening` with **exactly 7 commits**, one PR for review/merge. Sequencing: Commit 1 (plugin source + Rojo + CI Aftman install), Commit 2 (version handshake + 0.2.0 bump), Commit 3 (pairing + PROOF + errors module skeleton + plugin pair UI), Commit 4 (Bearer middleware on /api/*), Commit 5 (full error envelope migration), Commit 6 (session lifecycle), **Commit 7 (queue cap + integration test + README/CHANGELOG/docs in one commit)**. Solo-dev: no stacked-PR tooling.
- **C2** Version bump `0.1.0 → 0.2.0` (auth = breaking).
- **C3** Tests: vitest unit tests for new modules (`pairing.ts`, `errors.ts`, queue cap, lifecycle state machine) + integration test against a TypeScript mock-plugin (no real Studio needed). Live-smoke against real Studio is the post-merge validation gate, not CI.
- **C4** README.md gains a new section "Pairing your Studio plugin" with screenshots/diagram. SECURITY.md deferred.
- **C5** Rollback: revert problem commits + `0.2.1` patch release.

## 6. New Error Codes Index

| Code | HTTP | Retryable | Surface |
|------|------|-----------|---------|
| `RBX.HANDSHAKE.MISSING_VERSION` | 400 | no | `/studio/connect` body missing `version` |
| `RBX.HANDSHAKE.VERSION_MISMATCH` | 426 | no | server↔plugin major mismatch |
| `RBX.AUTH.PROOF_FAILED` | 401 | no | HMAC verification failed (post-pair auth concern) |
| `RBX.AUTH.MISSING_TOKEN` | 401 | no | no `Authorization: Bearer` header |
| `RBX.AUTH.INVALID_TOKEN` | 401 | no | bearer ≠ known session token |
| `RBX.AUTH.TOKEN_EXPIRED` | 401 | yes | session token >24h, refresh via re-pair |
| `RBX.AUTH.SESSION_REVOKED` | 401 | no | server stopped recognizing session (restart) |
| `RBX.PLUGIN.NOT_CONNECTED` | 503 | yes | bridge has no active session |
| `RBX.PLUGIN.RELOADING` | 503 | yes | grace window — Retry-After ms |
| `RBX.PLUGIN.RELOAD_TIMEOUT` | 503 | no | grace window exceeded; plugin did not reattach |
| `RBX.PLUGIN.RECONNECTED` | 503 | yes | plugin reattached during grace; in-flight commands invalidated for state consistency |
| `RBX.STUDIO.QUITTING` | 503 | no | clean Studio quit received |
| `RBX.HANDSHAKE.INVALID_CODE` | 401 | no | pairing code wrong/expired/already-used |
| `RBX.HANDSHAKE.MISSING_FIELDS` | 400 | no | body missing required pair/connect fields |
| `RBX.HANDSHAKE.RATE_LIMITED` | 429 | yes | `/studio/pair` >5 attempts/min; Retry-After 60s |
| `RBX.VALIDATION.MISSING_FIELD` | 400 | no | required field missing in request |
| `RBX.VALIDATION.UNKNOWN_ROUTE` | 404 | no | unknown method/path combination |
| `RBX.VALIDATION.UNKNOWN_COMMAND` | 404 | no | commandId not in pending queue |
| `RBX.BRIDGE.SHUTDOWN` | 503 | no | bridge process stopping — in-flight rejected |
| `RBX.BRIDGE.QUEUE_FULL` | 503 | yes | Retry-After 1s |
| `RBX.BRIDGE.COMMAND_TIMEOUT` | 504 | yes | per-tool timeout exceeded |
| `RBX.BRIDGE.INTERNAL` | 500 | no | uncaught throw — bug |
| `RBX.VALIDATION.INVALID_INPUT` | 400 | no | Zod rejection |
| `RBX.VALIDATION.INVALID_JSON` | 400 | no | request body malformed |
| `RBX.VALIDATION.BODY_TOO_LARGE` | 413 | no | body > 10MB |

## 7. File Inventory (rough estimate)

**New files:**
- `aftman.toml` (Rojo version pin)
- `src/bridge/pairing.ts` (~250 LOC)
- `src/bridge/errors.ts` (~150 LOC)
- `src/bridge/lifecycle.ts` (~200 LOC — session state machine)
- `src/__tests__/pairing.test.ts`
- `src/__tests__/errors.test.ts`
- `src/__tests__/lifecycle.test.ts`
- `src/__tests__/integration.bridge.test.ts` (mock plugin)
- `plugin/src/init.server.lua` (restored from git, +~150 LOC for pair UI + PROOF flow)

**Modified files:**
- `src/bridge/server.ts` (~+200 LOC, ~-50 LOC for sendError → errors module)
- `src/index.ts` (MCP RbxError catch translation)
- `src/roblox/studio-bridge-client.ts` (Authorization header injection)
- `src/shared.ts` (SERVER_VERSION → 0.2.0)
- `package.json` (version, build script, keytar dep)
- `.gitignore` (`.rbxm` artifact)
- `plugin/default.project.json` (verify tree)
- `README.md` (pair flow docs)
- `CHANGELOG.md` (0.2.0 entry)

**Deletions:** `plugin/src/RobloxShipcheck.rbxm` (moves to release artifact).

## 8. Out of Scope (Phase 2/3)

Recorded so they don't sneak into Phase 1:

- Module catalog (80→13 default tools, MCP `tools/list_changed`) — Phase 2
- `/healthz` + bridge state history + tool-call latency metrics — Phase 2
- Lockstep `.rbxm` build in `publish.yml` + GitHub release upload — Phase 2
- Per-tool timeout override + Zod bridge-input validation — Phase 2
- Plugin auto-update prompt on version mismatch — Phase 3
- Tool mode declaration (`requires: "edit"|"run"|"any"`) — Phase 3
- Structured logger (`pino` JSON to stderr) — Phase 3
- Plugin source modular split (`Bridge.lua`, `Commands.lua`, `UI.lua`) — Phase 2 or later

## 9. Open Risks

- **`keytar` install failure** on some Linux distros — fallback to `~/.config/...` 0600 handles this gracefully; documented in README.
- **Plugin paste UI ergonomics** — Studio's `TextBox` is functional but not pretty; acceptable for v0.2.0, polish in Phase 3.
- **`tools/list_changed` Claude Code bug** ([anthropics/claude-code#13646](https://github.com/anthropics/claude-code/issues/13646)) — irrelevant for Phase 1 (no module catalog yet); will matter when Phase 2 ships.
- **HMAC clock-skew** — nonces are random per challenge, not time-based; no clock dependency.
- **Single Studio constraint** — if user opens 2 Studio windows of same place, both plugins try to claim `activeSession`. Last-write wins; second plugin gets `RBX.AUTH.SESSION_REVOKED` on next call. Acceptable per scope. Documented in README.

## 10. Validation Gate

Before merging the PR:

1. `npm run check` passes (tsc + eslint + prettier + publint).
2. `vitest run` passes (unit + integration).
3. Live smoke: open Studio, run `npx roblox-shipcheck`, pair via 6-digit code, run `rbx_project_snapshot` + `rbx_set_instance_property` + `rbx_shipcheck_report`. All succeed. Re-pair after `rm ~/.config/roblox-shipcheck/pairing.json` and confirm 401 → re-pair flow works.
4. Negative test: a separate localhost process attempts `POST /studio/connect` without code AND `GET /api/datamodel` without Bearer — both return 401 with appropriate codes.
5. Concurrent: while a long-running tool is mid-flight, kill the plugin from the Studio plugins panel. Verify grace window holds command for 45s, then rejects with `RBX.PLUGIN.RELOADING`. Restart plugin → command completes.

## 11. Implementation Sequencing (for writing-plans skill)

Commits in order, each independently testable:

1. **`restore: plugin Lua source + Rojo build`** — Item 1, no behavior change, plugin still builds same `.rbxm`
2. **`feat: server-side version handshake`** — Item 2, plugin already sends version
3. **`feat: pairing secret + PROOF handshake`** — Item 3, biggest commit, introduces new modules and plugin UI
4. **`feat: Bearer auth middleware on /api/*`** — Item 4, depends on commit 3's session_token
5. **`feat: structured error envelope`** — Item 5, may overlap with commit 3 — handle by introducing `errors.ts` in commit 3 and migrating all sites in commit 5
6. **`feat: session lifecycle state machine`** — Item 6, depends on commit 5's error pipeline
7. **`feat: bounded command queue with backpressure`** — Item 7, depends on commit 5's error pipeline

Commit 3 introduces `errors.ts` (for `RBX.HANDSHAKE.*` codes) but commit 5 migrates ALL `sendError` sites; commit 6 introduces lifecycle codes; commit 7 introduces queue codes. Each commit is mergeable in isolation but the PR ships them together.

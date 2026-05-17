# Codex Review: Phase 1 Plan (2026-05-17)

**Reviewer:** Codex (gpt-5 default, via `mcp__codex__codex`, read-only sandbox)
**Subject:** `docs/superpowers/plans/2026-05-17-phase1-enterprise-hardening.md`
**Spec:** `docs/superpowers/specs/2026-05-17-phase1-enterprise-hardening-design.md`
**Verdict:** READY WITH FIXUPS — 7 BLOCKERs, 8 HIGHs, 5 MEDIUMs

## BLOCKERs (must fix before code)

1. Plan creates 8 commits, not 7 (Task 10 is the 8th). Violates branch/PR constraint. **Fix:** merge Task 10 into the final functional commit (Commit 7) or restructure.
2. CI workflow not updated to install Aftman/Rojo before `npm run build`. Commit 1 breaks CI immediately. **Fix:** add aftman/rojo install steps to `.github/workflows/{ci.yml, publish.yml}` in Task 1.
3. Token refresh after 24h is impossible. `/studio/connect` requires valid Bearer; expired tokens get 401 and have no refresh path. **Fix:** new `/studio/refresh-token` endpoint that accepts expired token + does PROOF challenge with stored `pairing_secret`.
4. `/studio/pair` not rate-limited despite spec calling for 5/min. **Fix:** sliding-window counter in `PairingService`.
5. Lua `pcall` mishandled — `local parsed = pcall(fn)` makes `parsed` boolean. 3+ sites. **Fix:** `local ok, parsed = pcall(...)` then check `ok and parsed and parsed.error`.
6. Lifecycle expiry captures wrong error: heartbeat does `tick()` first → state becomes `idle` → `commandError()` returns `RBX.PLUGIN.NOT_CONNECTED`, not `RBX.PLUGIN.RELOADING`. **Fix:** snapshot `commandError()` BEFORE `tick()`.
7. `/studio/disconnect { reason: plugin_unloading }` doesn't enter `reload_grace`. Just calls `tick()` (no-op). **Fix:** add `lifecycle.markReloading()` method that transitions active→reload_grace immediately.

## HIGH

- Error code naming: spec index has `RBX.HANDSHAKE.PROOF_FAILED`; plan uses `RBX.AUTH.PROOF_FAILED`. Spec self-inconsistent. **Fix:** pick `RBX.AUTH.PROOF_FAILED` (it's an auth concern post-pair), update spec index.
- `/api/ping` exception contradicts spec wording "all /api/*". **Fix:** spec D4.x adds explicit "/api/ping is the sole public liveness endpoint".
- `keytar` as production dep — `npm ci` may fail on Linux/Docker without build-essentials. **Fix:** move to `optionalDependencies` (already dynamic-imported).
- `CommandQueue.command: string` loses 27-value union. **Fix:** export `BridgeCommand` union from new `types/bridge.ts` and use it.
- session-registry only cleared in `stop()`. Stale token risk. **Fix:** clear on `/studio/disconnect`, lifecycle expiry, proof failure, session revoke.
- Task 2 tests literal `"0.2.0"` but `SERVER_VERSION` stays `"0.1.0"` until Task 10. **Fix:** bump `SERVER_VERSION` in Task 2.
- `readJsonBody` still throws plain `Error("Request body too large")`. **Fix:** throw `RbxError("RBX.VALIDATION.BODY_TOO_LARGE", ...)` directly.
- MCP `CallToolRequest` translation missing `request_id`. **Fix:** generate via `randomUUID()` and include.

## MEDIUM

- Queue-full integration test is a placeholder `expect(true).toBe(true)`. **Fix:** real assertion via mock plugin holding a long-poll open while 4+ enqueues run.
- Lua HMAC parity: no automated KAT. **Fix:** add Node fixture + Studio-side script that prints HMAC over a deterministic input; document expected output in TESTING.md.
- `HttpService.HttpEnabled` not verified post-restore. **Fix:** add to live-smoke checklist.
- TextBox lacks `CaptureFocus()` on pair-widget open + Enter-submit. **Fix:** add focus + InputBegan handler.
- `plugin:SetSetting(key, nil)` delete semantics unclear. **Fix:** use empty-string sentinel + `plugin:SetSetting(key, "")` then `getSetting()` treats empty as missing.

## LOW / NITS

- "Pollping" typo (plan line ~1579)
- "OAuth-style" misleading — it's local pairing + bearer + HMAC PROOF
- README rotate-secret instructions only cover file fallback, not keytar
- `RBX.AUTH.UNKNOWN_TOKEN` mentioned in spec D3.7 but doesn't exist in index

## Hidden assumptions verified

- `HttpService:RequestAsync` GET with custom headers: SUPPORTED per [Roblox docs](https://create.roblox.com/docs/reference/engine/classes/HttpService#RequestAsync); smoke-test required.
- `keytar` for `npx`-spawned npm on macOS: NOT proven; treat as optional.
- `plugin:SetSetting(nil)` delete: docs unclear; use empty-string sentinel.
- `plugin.Unloading` vs `BindToClose` distinguishability: NOT reliable; heartbeat must be authoritative — already addressed in spec D6.3 + B7 fix.

## Per-commit verification (Codex)

1. Commit 1 — CI installs Rojo before npm build; `.rbxm` not published without source; Rojo output is plugin-runnable.
2. Commit 2 — `/studio/connect` rejects missing/malformed version; minor mismatch logs but connects; major returns 426.
3. Commit 3 — Pair code single-use TTL-bound rate-limited; expired-token refresh issues new token without re-pair; Lua HMAC == Node HMAC.
4. Commit 4 — Every non-ping `/api/*` has `requireAuth` before `requirePluginSession`; `/studio/poll`+`/studio/response` reject mismatched tokens; registry clears on disconnect/expiry.
5. Commit 5 — No legacy `{error: string}` left; `Retry-After` units are seconds; MCP `isError: true` carries machine-readable payload.
6. Commit 6 — `plugin_unloading` enters reload grace immediately; grace expiry rejects with intended code; heartbeat timer cleared on stop.
7. Commit 7 — Queue cap rejects newest; `shift()` removes from both queue and map; `rejectAll()` clears all timers.

## Final patch list (10 items)

1. Collapse Task 10 into Commit 7 OR redefine to 7.
2. Add CI Aftman/Rojo install.
3. Add `/studio/pair` rate limit.
4. Design expired-token refresh path.
5. Fix Lua `pcall` destructuring everywhere.
6. `plugin_unloading` enters reload grace immediately.
7. Preserve expiry error before lifecycle → idle.
8. Resolve error-code inconsistencies and update index.
9. Replace placeholder queue integration test with real assertion.
10. Make `keytar` optional.

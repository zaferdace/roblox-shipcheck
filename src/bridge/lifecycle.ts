import { RbxError } from "./errors.js";

export type LifecycleState = "idle" | "active" | "reload_grace" | "quitting";

export interface SessionSnapshot {
  id: string;
  token: string;
  connectedAt: number;
}

export interface LifecycleOptions {
  reloadGraceMs?: number;
  staleMs?: number;
}

export class SessionLifecycle {
  private _state: LifecycleState = "idle";
  private _session: SessionSnapshot | undefined;
  private _lastPollAt = 0;
  private _graceUntil = 0;
  private readonly graceMs: number;
  private readonly staleMs: number;

  constructor(opts: LifecycleOptions = {}) {
    this.graceMs =
      opts.reloadGraceMs ?? Number.parseInt(process.env["RBX_RELOAD_GRACE_MS"] ?? "45000", 10);
    this.staleMs = opts.staleMs ?? Number.parseInt(process.env["RBX_STALE_MS"] ?? "45000", 10);
  }

  state(): LifecycleState {
    return this._state;
  }
  session(): SessionSnapshot | undefined {
    return this._session;
  }
  lastPollAt(): number {
    return this._lastPollAt;
  }
  graceUntil(): number {
    return this._graceUntil;
  }

  attach(session: SessionSnapshot): void {
    this._session = session;
    this._state = "active";
    this._lastPollAt = Date.now();
  }

  heartbeat(): { reconnected: boolean } {
    if (this._state === "quitting" || this._state === "idle") {
      return { reconnected: false };
    }
    const wasInGrace = this._state === "reload_grace";
    this._lastPollAt = Date.now();
    if (wasInGrace) this._state = "active";
    return { reconnected: wasInGrace };
  }

  markReloading(): void {
    if (this._state === "active") {
      this._state = "reload_grace";
      this._graceUntil = Date.now() + this.graceMs;
    }
  }

  markQuitting(): void {
    if (this._state !== "idle") this._state = "quitting";
  }

  tick(): void {
    const now = Date.now();
    if (this._state === "active") {
      if (now - this._lastPollAt > this.staleMs) {
        this._state = "reload_grace";
        this._graceUntil = now + this.graceMs;
      }
      return;
    }
    if (this._state === "reload_grace") {
      if (now > this._graceUntil) {
        this._state = "idle";
        this._session = undefined;
      }
      return;
    }
    if (this._state === "quitting") {
      this._state = "idle";
      this._session = undefined;
      return;
    }
  }

  commandError(): RbxError {
    if (this._state === "active") {
      return new RbxError(
        "RBX.BRIDGE.INTERNAL",
        "Unexpected: commandError() called in active state",
        false,
        undefined,
        undefined,
        500,
      );
    }
    if (this._state === "quitting") {
      return new RbxError(
        "RBX.STUDIO.QUITTING",
        "Roblox Studio is quitting; new commands cannot be queued",
        false,
        undefined,
        "Reopen Studio and reconnect the plugin",
        503,
      );
    }
    if (this._state === "reload_grace") {
      const retryAfterMs = Math.max(1000, this._graceUntil - Date.now());
      return new RbxError(
        "RBX.PLUGIN.RELOADING",
        "Plugin is reloading; command will be held for grace window",
        true,
        { graceUntil: this._graceUntil },
        "Retry after grace expires; in-flight commands resume if plugin reattaches",
        503,
        retryAfterMs,
      );
    }
    return new RbxError(
      "RBX.PLUGIN.NOT_CONNECTED",
      "Roblox Studio plugin is not connected",
      true,
      undefined,
      "Open Roblox Studio and click 'Toggle Connection' in the plugin toolbar",
      503,
    );
  }
}

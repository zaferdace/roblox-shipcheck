import { describe, it, expect, vi, afterEach } from "vitest";
import { SessionLifecycle } from "../bridge/lifecycle.js";

function makeLifecycle(opts?: { graceMs?: number; staleMs?: number }) {
  return new SessionLifecycle({
    reloadGraceMs: opts?.graceMs ?? 500,
    staleMs: opts?.staleMs ?? 500,
  });
}

describe("SessionLifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in idle state", () => {
    const lc = makeLifecycle();
    expect(lc.state()).toBe("idle");
    expect(lc.session()).toBeUndefined();
  });

  it("transitions idle → active on attach", () => {
    const lc = makeLifecycle();
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    expect(lc.state()).toBe("active");
    expect(lc.session()?.id).toBe("s1");
  });

  it("heartbeat in active state returns reconnected:false and stays active", () => {
    const lc = makeLifecycle();
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    const result = lc.heartbeat();
    expect(result.reconnected).toBe(false);
    expect(lc.state()).toBe("active");
  });

  it("heartbeat returns reconnected:false in normal active state", () => {
    const lc = makeLifecycle();
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    expect(lc.heartbeat().reconnected).toBe(false);
  });

  it("tick transitions active → reload_grace when stale", () => {
    const lc = makeLifecycle({ staleMs: 50, graceMs: 1000 });
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    lc.tick();
    expect(lc.state()).toBe("reload_grace");
    vi.useRealTimers();
  });

  it("tick transitions reload_grace → idle when grace expires", () => {
    const lc = makeLifecycle({ staleMs: 50, graceMs: 100 });
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    lc.tick(); // active → reload_grace
    vi.advanceTimersByTime(200);
    lc.tick(); // reload_grace → idle
    expect(lc.state()).toBe("idle");
    expect(lc.session()).toBeUndefined();
    vi.useRealTimers();
  });

  it("markQuitting transitions active → quitting", () => {
    const lc = makeLifecycle();
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    lc.markQuitting();
    expect(lc.state()).toBe("quitting");
  });

  it("tick transitions quitting → idle", () => {
    const lc = makeLifecycle();
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    lc.markQuitting();
    lc.tick();
    expect(lc.state()).toBe("idle");
    expect(lc.session()).toBeUndefined();
  });

  it("commandError in idle returns NOT_CONNECTED", () => {
    const lc = makeLifecycle();
    const err = lc.commandError();
    expect(err.code).toBe("RBX.PLUGIN.NOT_CONNECTED");
    expect(err.retryable).toBe(true);
    expect(err.httpStatus).toBe(503);
  });

  it("commandError in quitting returns STUDIO.QUITTING", () => {
    const lc = makeLifecycle();
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    lc.markQuitting();
    const err = lc.commandError();
    expect(err.code).toBe("RBX.STUDIO.QUITTING");
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(503);
  });

  it("commandError in reload_grace returns PLUGIN.RELOADING with retryAfterMs", () => {
    const lc = makeLifecycle({ staleMs: 50, graceMs: 1000 });
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    lc.tick();
    expect(lc.state()).toBe("reload_grace");
    const err = lc.commandError();
    expect(err.code).toBe("RBX.PLUGIN.RELOADING");
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("markReloading transitions active → reload_grace immediately", () => {
    const lc = makeLifecycle({ graceMs: 1000, staleMs: 99999 });
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    lc.markReloading();
    expect(lc.state()).toBe("reload_grace");
  });

  it("markReloading is a no-op from idle", () => {
    const lc = makeLifecycle();
    lc.markReloading();
    expect(lc.state()).toBe("idle");
  });

  it("markReloading is a no-op from quitting", () => {
    const lc = makeLifecycle();
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    lc.markQuitting();
    lc.markReloading();
    expect(lc.state()).toBe("quitting");
  });

  it("heartbeat returns reconnected:true when transitioning reload_grace → active", () => {
    const lc = makeLifecycle({ staleMs: 50, graceMs: 1000 });
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    lc.tick();
    expect(lc.state()).toBe("reload_grace");
    const result = lc.heartbeat();
    expect(result.reconnected).toBe(true);
    expect(lc.state()).toBe("active");
    vi.useRealTimers();
  });

  it("heartbeat in idle returns reconnected:false and stays idle", () => {
    const lc = makeLifecycle();
    const result = lc.heartbeat();
    expect(result.reconnected).toBe(false);
    expect(lc.state()).toBe("idle");
  });

  it("heartbeat in quitting returns reconnected:false", () => {
    const lc = makeLifecycle();
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    lc.markQuitting();
    const result = lc.heartbeat();
    expect(result.reconnected).toBe(false);
    expect(lc.state()).toBe("quitting");
  });

  it("graceUntil is set when entering reload_grace via markReloading", () => {
    const lc = makeLifecycle({ graceMs: 5000, staleMs: 99999 });
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    const before = Date.now();
    lc.markReloading();
    expect(lc.graceUntil()).toBeGreaterThanOrEqual(before + 5000);
  });

  it("attach overwrites existing session", () => {
    const lc = makeLifecycle();
    lc.attach({ id: "s1", token: "t1", connectedAt: Date.now() });
    lc.attach({ id: "s2", token: "t2", connectedAt: Date.now() });
    expect(lc.session()?.id).toBe("s2");
    expect(lc.session()?.token).toBe("t2");
  });

  it("tick does nothing in idle state", () => {
    const lc = makeLifecycle();
    lc.tick();
    expect(lc.state()).toBe("idle");
  });
});

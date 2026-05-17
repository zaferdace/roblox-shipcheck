import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandQueue } from "../bridge/command-queue.js";

describe("CommandQueue cap with backpressure", () => {
  beforeEach(() => {
    process.env["RBX_QUEUE_MAX"] = "3";
  });
  afterEach(() => {
    delete process.env["RBX_QUEUE_MAX"];
  });

  it("accepts commands up to max", () => {
    const q = new CommandQueue();
    void q.enqueue("get_datamodel", {});
    void q.enqueue("search", {});
    void q.enqueue("get_properties", {});
    expect(q.size()).toBe(3);
  });

  it("rejects 4th enqueue with RBX.BRIDGE.QUEUE_FULL", async () => {
    const q = new CommandQueue();
    void q.enqueue("get_datamodel", {});
    void q.enqueue("search", {});
    void q.enqueue("get_properties", {});
    await expect(q.enqueue("apply_patch", {})).rejects.toMatchObject({
      code: "RBX.BRIDGE.QUEUE_FULL",
      retryable: true,
      retryAfterMs: 1000,
    });
  });

  it("draining via shift() makes room for new", async () => {
    const q = new CommandQueue();
    void q.enqueue("get_datamodel", {});
    void q.enqueue("search", {});
    void q.enqueue("get_properties", {});
    q.shift();
    expect(q.size()).toBe(2);
    void q.enqueue("apply_patch", {});
    expect(q.size()).toBe(3);
  });

  it("rejectAll fires all pending with given error", async () => {
    const q = new CommandQueue();
    const p1 = q.enqueue("get_datamodel", {});
    const p2 = q.enqueue("search", {});
    const sentinel = new Error("kaboom");
    q.rejectAll(sentinel);
    await expect(p1).rejects.toBe(sentinel);
    await expect(p2).rejects.toBe(sentinel);
    expect(q.size()).toBe(0);
  });

  it("cleanup() removes from both queue and byId map", () => {
    const q = new CommandQueue();
    void q.enqueue("get_datamodel", {});
    const ids = q.allIds();
    expect(ids.length).toBe(1);
    q.cleanup(ids[0]!);
    expect(q.size()).toBe(0);
    expect(q.get(ids[0]!)).toBeUndefined();
  });

  it("default max is 100 when env unset", () => {
    delete process.env["RBX_QUEUE_MAX"];
    const q = new CommandQueue();
    for (let i = 0; i < 100; i++) void q.enqueue("get_datamodel", {});
    expect(q.size()).toBe(100);
  });
});

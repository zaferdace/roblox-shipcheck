import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { RbxError, sendErrorEnvelope, tryCatchHandler } from "../bridge/errors.js";

function makeReqRes() {
  const req = { headers: {} } as unknown as IncomingMessage;
  const headers: Record<string, string | number> = {};
  let statusCode = 0;
  let body = "";
  let ended = false;
  const res = {
    setHeader(name: string, value: string | number) {
      headers[name.toLowerCase()] = value;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    get statusCode() {
      return statusCode;
    },
    end(payload?: string) {
      body = payload ?? "";
      ended = true;
    },
    get writableEnded() {
      return ended;
    },
  } as unknown as ServerResponse;
  return {
    req,
    res,
    getHeaders: () => headers,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

describe("RbxError", () => {
  it("stores all fields and inherits from Error", () => {
    const err = new RbxError(
      "RBX.PLUGIN.NOT_CONNECTED",
      "no plugin",
      true,
      { last_poll_at: 1234 },
      "Open Studio and toggle connection",
      503,
      2000,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("RBX.PLUGIN.NOT_CONNECTED");
    expect(err.message).toBe("no plugin");
    expect(err.retryable).toBe(true);
    expect(err.data).toEqual({ last_poll_at: 1234 });
    expect(err.remediation).toBe("Open Studio and toggle connection");
    expect(err.httpStatus).toBe(503);
    expect(err.retryAfterMs).toBe(2000);
  });

  it("defaults httpStatus to 500 and retryAfterMs to undefined", () => {
    const err = new RbxError("RBX.BRIDGE.INTERNAL", "oops", false);
    expect(err.httpStatus).toBe(500);
    expect(err.retryAfterMs).toBeUndefined();
  });
});

describe("sendErrorEnvelope", () => {
  it("writes envelope with ok=false and full error payload", () => {
    const { req, res, getStatus, getBody, getHeaders } = makeReqRes();
    const err = new RbxError(
      "RBX.PLUGIN.NOT_CONNECTED",
      "no plugin",
      true,
      undefined,
      "Open Studio",
      503,
    );
    sendErrorEnvelope(req, res, err, "req-123");
    expect(getStatus()).toBe(503);
    expect(getHeaders()["content-type"]).toContain("application/json");
    expect(getHeaders()["x-request-id"]).toBe("req-123");
    const body = JSON.parse(getBody());
    expect(body).toEqual({
      ok: false,
      error: {
        code: "RBX.PLUGIN.NOT_CONNECTED",
        message: "no plugin",
        retryable: true,
        remediation: "Open Studio",
        request_id: "req-123",
      },
    });
  });

  it("sets Retry-After header when retryAfterMs present", () => {
    const { req, res, getHeaders } = makeReqRes();
    const err = new RbxError(
      "RBX.BRIDGE.QUEUE_FULL",
      "full",
      true,
      undefined,
      undefined,
      503,
      1000,
    );
    sendErrorEnvelope(req, res, err, "req-1");
    expect(getHeaders()["retry-after"]).toBe(1);
  });

  it("includes data when present", () => {
    const { req, res, getBody } = makeReqRes();
    const err = new RbxError("RBX.BRIDGE.QUEUE_FULL", "full", true, { current: 100, max: 100 });
    sendErrorEnvelope(req, res, err, "req-2");
    expect(JSON.parse(getBody()).error.data).toEqual({ current: 100, max: 100 });
  });
});

describe("tryCatchHandler", () => {
  it("calls underlying handler and lets it complete on success", async () => {
    const inner = vi.fn().mockResolvedValue(undefined);
    const wrapped = tryCatchHandler(inner);
    const { req, res } = makeReqRes();
    await wrapped(req, res, "req-1");
    expect(inner).toHaveBeenCalledOnce();
  });

  it("converts thrown RbxError to envelope", async () => {
    const wrapped = tryCatchHandler(async () => {
      throw new RbxError("RBX.PLUGIN.NOT_CONNECTED", "no", true, undefined, undefined, 503);
    });
    const { req, res, getStatus, getBody } = makeReqRes();
    await wrapped(req, res, "req-1");
    expect(getStatus()).toBe(503);
    expect(JSON.parse(getBody()).error.code).toBe("RBX.PLUGIN.NOT_CONNECTED");
  });

  it("converts unknown thrown error to RBX.BRIDGE.INTERNAL", async () => {
    const wrapped = tryCatchHandler(async () => {
      throw new Error("kaboom");
    });
    const { req, res, getStatus, getBody } = makeReqRes();
    await wrapped(req, res, "req-1");
    expect(getStatus()).toBe(500);
    const body = JSON.parse(getBody());
    expect(body.error.code).toBe("RBX.BRIDGE.INTERNAL");
    expect(body.error.retryable).toBe(false);
  });

  it("converts SyntaxError (bad JSON) to RBX.VALIDATION.INVALID_JSON", async () => {
    const wrapped = tryCatchHandler(async () => {
      throw new SyntaxError("Unexpected token");
    });
    const { req, res, getStatus, getBody } = makeReqRes();
    await wrapped(req, res, "req-1");
    expect(getStatus()).toBe(400);
    expect(JSON.parse(getBody()).error.code).toBe("RBX.VALIDATION.INVALID_JSON");
  });
});

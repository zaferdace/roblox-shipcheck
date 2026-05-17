import type { IncomingMessage, ServerResponse } from "node:http";

export class RbxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly data?: Record<string, unknown>,
    public readonly remediation?: string,
    public readonly httpStatus: number = 500,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RbxError";
  }
}

export type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
) => Promise<void>;

interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    request_id: string;
    data?: Record<string, unknown>;
    remediation?: string;
  };
}

export function withCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (
    typeof origin === "string" &&
    (origin === "http://localhost" ||
      origin === "https://localhost" ||
      origin === "http://127.0.0.1" ||
      origin === "https://127.0.0.1" ||
      /^https?:\/\/localhost:\d+$/u.test(origin) ||
      /^https?:\/\/127\.0\.0\.1:\d+$/u.test(origin))
  ) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
  response.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

export function sendErrorEnvelope(
  request: IncomingMessage,
  response: ServerResponse,
  err: RbxError,
  requestId: string,
): void {
  withCors(request, response);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Request-Id", requestId);
  if (err.retryAfterMs !== undefined && err.retryAfterMs > 0) {
    response.setHeader("Retry-After", Math.max(1, Math.ceil(err.retryAfterMs / 1000)));
  }
  response.statusCode = err.httpStatus;
  const envelope: ErrorEnvelope = {
    ok: false,
    error: {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      request_id: requestId,
      ...(err.data !== undefined ? { data: err.data } : {}),
      ...(err.remediation !== undefined ? { remediation: err.remediation } : {}),
    },
  };
  response.end(JSON.stringify(envelope));
}

export function tryCatchHandler(inner: RouteHandler): RouteHandler {
  return async (request, response, requestId) => {
    try {
      await inner(request, response, requestId);
    } catch (error) {
      if (response.writableEnded) return;
      if (error instanceof RbxError) {
        sendErrorEnvelope(request, response, error, requestId);
        return;
      }
      if (error instanceof SyntaxError) {
        sendErrorEnvelope(
          request,
          response,
          new RbxError(
            "RBX.VALIDATION.INVALID_JSON",
            "Request body is not valid JSON",
            false,
            undefined,
            undefined,
            400,
          ),
          requestId,
        );
        return;
      }
      const message = error instanceof Error ? error.message : "Internal server error";
      sendErrorEnvelope(
        request,
        response,
        new RbxError(
          "RBX.BRIDGE.INTERNAL",
          message,
          false,
          undefined,
          "This is a server bug. Open an issue with the request_id.",
          500,
        ),
        requestId,
      );
    }
  };
}

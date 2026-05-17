import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PairingService } from "../bridge/pairing.js";
import { startBridgeServer } from "../bridge/server.js";
import { setCurrentSessionToken } from "../bridge/session-registry.js";

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json() : await res.text();
  return { status: res.status, body };
}

describe("Bearer middleware on /api/*", () => {
  let tmpDir: string;
  let pairing: PairingService;
  let bridge: { port: number; stop: () => void };
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "rbx-bearer-test-"));
    pairing = new PairingService({ storage: "file", fileDir: tmpDir });
    await pairing.loadOrCreatePairingSecret();
    bridge = await startBridgeServer({ pairingService: pairing, port: 0 });
    baseUrl = `http://127.0.0.1:${bridge.port}`;
  });

  afterEach(() => {
    bridge.stop();
    setCurrentSessionToken(undefined);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ping is unauthenticated", async () => {
    const { status } = await fetchJson(`${baseUrl}/api/ping`);
    expect(status).toBe(200);
  });

  it("api/datamodel returns 401 RBX.AUTH.MISSING_TOKEN without header", async () => {
    const { status, body } = await fetchJson(`${baseUrl}/api/datamodel`);
    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe("RBX.AUTH.MISSING_TOKEN");
  });

  it("api/datamodel returns 401 RBX.AUTH.INVALID_TOKEN with bogus header", async () => {
    const { status, body } = await fetchJson(`${baseUrl}/api/datamodel`, {
      headers: { authorization: "Bearer not_a_real_token_xxxxxxxxxxxxxxxxxxxxxxx" },
    });
    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe("RBX.AUTH.INVALID_TOKEN");
  });

  it("api/datamodel returns 401 RBX.AUTH.TOKEN_EXPIRED for expired token", async () => {
    const { token } = pairing.issueSessionToken({ ttlMs: -1 });
    const { status, body } = await fetchJson(`${baseUrl}/api/datamodel`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe("RBX.AUTH.TOKEN_EXPIRED");
  });

  // This test verifies auth passes but plugin isn't connected → legacy 503 response.
  // Commit 5 will migrate this to RBX.PLUGIN.NOT_CONNECTED envelope.
  it("api/datamodel with valid token but no plugin returns 503", async () => {
    const { token } = pairing.issueSessionToken();
    const { status } = await fetchJson(`${baseUrl}/api/datamodel`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status).toBe(503);
  });
});

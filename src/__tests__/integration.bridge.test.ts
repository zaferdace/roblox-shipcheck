import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PairingService, computeProof } from "../bridge/pairing.js";
import { startBridgeServer } from "../bridge/server.js";
import { setCurrentSessionToken } from "../bridge/session-registry.js";

async function jsonReq(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

describe("End-to-end bridge integration", () => {
  let tmpDir: string;
  let pairing: PairingService;
  let bridge: { port: number; stop: () => void };
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "rbx-int-"));
    pairing = new PairingService({ storage: "file", fileDir: tmpDir });
    bridge = await startBridgeServer({ pairingService: pairing, port: 0 });
    baseUrl = `http://127.0.0.1:${bridge.port}`;
  });

  afterEach(() => {
    bridge.stop();
    setCurrentSessionToken(undefined);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects unpaired /studio/connect with 401 MISSING_TOKEN", async () => {
    const r = await jsonReq(`${baseUrl}/studio/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "0.2.0", nonce_client: "abc" }),
    });
    expect(r.status).toBe(401);
    expect((r.body as { error: { code: string } }).error.code).toBe("RBX.AUTH.MISSING_TOKEN");
  });

  it("rejects bogus pairing code", async () => {
    const r = await jsonReq(`${baseUrl}/studio/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "000000", plugin_version: "0.2.0" }),
    });
    expect(r.status).toBe(401);
    expect((r.body as { error: { code: string } }).error.code).toBe("RBX.HANDSHAKE.INVALID_CODE");
  });

  it("rejects major version mismatch on /studio/pair", async () => {
    const code = pairing.issuePairingCode();
    const r = await jsonReq(`${baseUrl}/studio/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.code, plugin_version: "99.0.0" }),
    });
    expect(r.status).toBe(426);
    expect((r.body as { error: { code: string } }).error.code).toBe(
      "RBX.HANDSHAKE.VERSION_MISMATCH",
    );
  });

  it("full handshake: pair → connect → proof → /api/ping succeeds", async () => {
    const codeIssued = pairing.issuePairingCode();
    const pairRes = await jsonReq(`${baseUrl}/studio/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: codeIssued.code, plugin_version: "0.2.0" }),
    });
    expect(pairRes.status).toBe(200);
    const { pairing_secret, session_token } = pairRes.body as {
      pairing_secret: string;
      session_token: string;
    };

    const connectRes = await jsonReq(`${baseUrl}/studio/connect`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session_token}` },
      body: JSON.stringify({ version: "0.2.0", nonce_client: "client_nonce_abc" }),
    });
    expect(connectRes.status).toBe(200);
    const { challenge_id, nonce_server } = connectRes.body as {
      challenge_id: string;
      nonce_server: string;
    };

    const proof = computeProof(pairing_secret, nonce_server, "client_nonce_abc");
    const proofRes = await jsonReq(`${baseUrl}/studio/connect/proof`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session_token}` },
      body: JSON.stringify({ challenge_id, proof }),
    });
    expect(proofRes.status).toBe(200);

    const pingRes = await jsonReq(`${baseUrl}/api/ping`);
    expect(pingRes.status).toBe(200);
    expect((pingRes.body as { plugin_connected: boolean }).plugin_connected).toBe(true);
  });

  it("queue full triggers RBX.BRIDGE.QUEUE_FULL with Retry-After header", async () => {
    process.env["RBX_QUEUE_MAX"] = "3";
    try {
      bridge.stop();
      bridge = await startBridgeServer({ pairingService: pairing, port: 0 });
      baseUrl = `http://127.0.0.1:${bridge.port}`;

      // Full handshake
      const codeIssued = pairing.issuePairingCode();
      const pairRes = await jsonReq(`${baseUrl}/studio/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: codeIssued.code, plugin_version: "0.2.0" }),
      });
      const { pairing_secret, session_token } = pairRes.body as {
        pairing_secret: string;
        session_token: string;
      };
      const connectRes = await jsonReq(`${baseUrl}/studio/connect`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session_token}` },
        body: JSON.stringify({ version: "0.2.0", nonce_client: "nc" }),
      });
      const { challenge_id, nonce_server } = connectRes.body as {
        challenge_id: string;
        nonce_server: string;
      };
      const proof = computeProof(pairing_secret, nonce_server, "nc");
      await jsonReq(`${baseUrl}/studio/connect/proof`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session_token}` },
        body: JSON.stringify({ challenge_id, proof }),
      });

      // Fire 3 requests that will queue (no plugin polling to drain them)
      const promises = [
        jsonReq(`${baseUrl}/api/datamodel`, {
          headers: { authorization: `Bearer ${session_token}` },
        }),
        jsonReq(`${baseUrl}/api/datamodel`, {
          headers: { authorization: `Bearer ${session_token}` },
        }),
        jsonReq(`${baseUrl}/api/datamodel`, {
          headers: { authorization: `Bearer ${session_token}` },
        }),
      ];
      // Allow a tick for the promises to enter the queue
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 4th must get QUEUE_FULL immediately
      const fourth = await jsonReq(`${baseUrl}/api/datamodel`, {
        headers: { authorization: `Bearer ${session_token}` },
      });
      expect(fourth.status).toBe(503);
      expect((fourth.body as { error: { code: string } }).error.code).toBe("RBX.BRIDGE.QUEUE_FULL");
      expect(fourth.headers.get("retry-after")).toBe("1");

      // Cleanup: stop bridge to drain in-flight promises
      bridge.stop();
      await Promise.allSettled(promises);
    } finally {
      delete process.env["RBX_QUEUE_MAX"];
    }
  });
});

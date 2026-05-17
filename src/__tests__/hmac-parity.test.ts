import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { computeProof } from "../bridge/pairing.js";

const require = createRequire(import.meta.url);

interface Fixture {
  _purpose?: string;
  cases: Array<{
    label: string;
    pairing_secret: string;
    nonce_server: string;
    nonce_client: string;
    expected_proof_base64url: string;
  }>;
}

const fixtures = require("./fixtures/hmac-parity.json") as Fixture;

describe("HMAC-SHA256 Node↔Lua parity (computeProof)", () => {
  for (const c of fixtures.cases) {
    it(`Node side matches fixture: ${c.label}`, () => {
      expect(computeProof(c.pairing_secret, c.nonce_server, c.nonce_client)).toBe(
        c.expected_proof_base64url,
      );
    });
  }
});

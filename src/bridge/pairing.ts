import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const SECRET_BYTES = 32;
const TOKEN_BYTES = 32;
const PAIRING_CODE_TTL_MS = 60_000;
const SESSION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 60_000;
const KEYTAR_SERVICE_DEFAULT = "roblox-shipcheck";
const KEYTAR_ACCOUNT = "pairing-secret";
const FILE_NAME = "pairing.json";

export function generatePairingCode(): { code: string; expiresAt: number } {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return { code, expiresAt: Date.now() + PAIRING_CODE_TTL_MS };
}

export function computeProof(
  pairingSecret: string,
  nonceServer: string,
  nonceClient: string,
): string {
  return createHmac("sha256", pairingSecret)
    .update(`${nonceServer}|${nonceClient}`, "utf8")
    .digest("base64url");
}

type StorageMode = "auto" | "keytar" | "file";

interface ServiceOptions {
  storage?: StorageMode;
  fileDir?: string;
  keytarService?: string;
}

interface PendingChallenge {
  nonceServer: string;
  nonceClient: string;
  expiresAt: number;
}

interface IssuedToken {
  expiresAt: number;
}

export class PairingService {
  private readonly storage: StorageMode;
  private readonly fileDir: string;
  private readonly keytarService: string;
  private pairingCodes = new Map<string, { expiresAt: number }>();
  private issuedTokens = new Map<string, IssuedToken>();
  private pendingChallenges = new Map<string, PendingChallenge>();
  private cachedSecret: string | undefined;

  // F4 — sliding-window rate limits: one bucket per endpoint to prevent cross-exhaustion
  private pairAttempts: number[] = [];
  private refreshAttempts: number[] = [];
  private readonly pairRateLimitMs = 60_000;
  private readonly pairRateLimitMax = 5;

  constructor(options: ServiceOptions = {}) {
    this.storage = options.storage ?? "auto";
    this.fileDir = options.fileDir ?? path.join(homedir(), ".config", "roblox-shipcheck");
    this.keytarService = options.keytarService ?? KEYTAR_SERVICE_DEFAULT;
  }

  async loadOrCreatePairingSecret(): Promise<string> {
    if (this.cachedSecret) return this.cachedSecret;
    const existing = await this.read();
    if (existing) {
      this.cachedSecret = existing;
      return existing;
    }
    const fresh = randomBytes(SECRET_BYTES).toString("base64url");
    await this.write(fresh);
    this.cachedSecret = fresh;
    return fresh;
  }

  // F10 — onRotate callback so server.ts can clear session-registry on rotate
  async rotateSecret(opts: { onRotate?: () => void } = {}): Promise<string> {
    const fresh = randomBytes(SECRET_BYTES).toString("base64url");
    await this.write(fresh);
    this.cachedSecret = fresh;
    this.issuedTokens.clear();
    opts.onRotate?.();
    return fresh;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [code, { expiresAt }] of this.pairingCodes) {
      if (expiresAt <= now) this.pairingCodes.delete(code);
    }
    for (const [id, { expiresAt }] of this.pendingChallenges) {
      if (expiresAt <= now) this.pendingChallenges.delete(id);
    }
    for (const [token, { expiresAt }] of this.issuedTokens) {
      if (expiresAt <= now) this.issuedTokens.delete(token);
    }
  }

  issuePairingCode(opts: { ttlMs?: number } = {}): { code: string; expiresAt: number } {
    this.pruneExpired();
    const ttl = opts.ttlMs ?? PAIRING_CODE_TTL_MS;
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = Date.now() + ttl;
    this.pairingCodes.set(code, { expiresAt });
    return { code, expiresAt };
  }

  consumePairingCode(code: string): boolean {
    const entry = this.pairingCodes.get(code);
    if (!entry) return false;
    this.pairingCodes.delete(code);
    return entry.expiresAt > Date.now();
  }

  issueSessionToken(opts: { ttlMs?: number } = {}): {
    token: string;
    issuedAt: number;
    expiresAt: number;
  } {
    this.pruneExpired();
    const ttl = opts.ttlMs ?? SESSION_TOKEN_TTL_MS;
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const issuedAt = Date.now();
    const expiresAt = issuedAt + ttl;
    this.issuedTokens.set(token, { expiresAt });
    return { token, issuedAt, expiresAt };
  }

  verifySessionToken(token: string): "valid" | "expired" | "unknown" {
    const entry = this.issuedTokens.get(token);
    if (!entry) return "unknown";
    if (entry.expiresAt <= Date.now()) {
      this.issuedTokens.delete(token);
      return "expired";
    }
    return "valid";
  }

  revokeSessionToken(token: string): void {
    this.issuedTokens.delete(token);
  }

  revokeAllSessionTokens(): void {
    this.issuedTokens.clear();
  }

  issueChallenge(nonceClient: string): { challengeId: string; nonceServer: string } {
    this.pruneExpired();
    const challengeId = randomBytes(16).toString("base64url");
    const nonceServer = randomBytes(16).toString("base64url");
    this.pendingChallenges.set(challengeId, {
      nonceServer,
      nonceClient,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return { challengeId, nonceServer };
  }

  verifyProof(challengeId: string, presentedProof: string, pairingSecret: string): boolean {
    const entry = this.pendingChallenges.get(challengeId);
    if (!entry) return false;
    this.pendingChallenges.delete(challengeId); // single-use
    if (entry.expiresAt <= Date.now()) return false;
    const expected = computeProof(pairingSecret, entry.nonceServer, entry.nonceClient);
    if (expected.length !== presentedProof.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(presentedProof, "utf8"));
    } catch {
      return false;
    }
  }

  // F4 — separate sliding-window rate limits so /studio/pair and /studio/refresh-token
  // cannot exhaust each other's budget.
  checkPairRateLimit(): { allowed: boolean; resetInMs: number } {
    return this.checkBucket(this.pairAttempts);
  }

  checkRefreshRateLimit(): { allowed: boolean; resetInMs: number } {
    return this.checkBucket(this.refreshAttempts);
  }

  private checkBucket(bucket: number[]): { allowed: boolean; resetInMs: number } {
    const now = Date.now();
    const inWindow = bucket.filter((t) => now - t < this.pairRateLimitMs);
    bucket.length = 0;
    bucket.push(...inWindow);
    if (bucket.length >= this.pairRateLimitMax) {
      const oldest = bucket[0] ?? now;
      return { allowed: false, resetInMs: this.pairRateLimitMs - (now - oldest) };
    }
    bucket.push(now);
    return { allowed: true, resetInMs: 0 };
  }

  // ---- storage internals ----

  private async read(): Promise<string | undefined> {
    if (this.storage === "keytar" || this.storage === "auto") {
      const fromKeytar = await this.tryKeytarRead();
      if (fromKeytar) return fromKeytar;
      if (this.storage === "keytar") return undefined;
    }
    return this.readFromFile();
  }

  private async write(secret: string): Promise<void> {
    if (this.storage === "keytar" || this.storage === "auto") {
      const ok = await this.tryKeytarWrite(secret);
      if (ok) return;
      if (this.storage === "keytar") {
        throw new Error("keytar write failed and storage=keytar (no fallback)");
      }
    }
    await this.writeToFile(secret);
  }

  private async tryKeytarRead(): Promise<string | undefined> {
    try {
      const keytar = await import("keytar");
      const value = await keytar.getPassword(this.keytarService, KEYTAR_ACCOUNT);
      return value ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async tryKeytarWrite(secret: string): Promise<boolean> {
    try {
      const keytar = await import("keytar");
      await keytar.setPassword(this.keytarService, KEYTAR_ACCOUNT, secret);
      return true;
    } catch {
      return false;
    }
  }

  private async readFromFile(): Promise<string | undefined> {
    try {
      const raw = await readFile(path.join(this.fileDir, FILE_NAME), "utf8");
      const parsed = JSON.parse(raw) as { pairing_secret?: unknown };
      if (typeof parsed.pairing_secret === "string") return parsed.pairing_secret;
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async writeToFile(secret: string): Promise<void> {
    await mkdir(this.fileDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(this.fileDir, FILE_NAME);
    await writeFile(filePath, JSON.stringify({ pairing_secret: secret }, null, 2), {
      mode: 0o600,
    });
  }
}

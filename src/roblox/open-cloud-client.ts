import { URL } from "node:url";
import { readCachedJson, writeCachedJson } from "../shared.js";
import type { RobloxAssetInfo, RobloxPlaceInfo, RobloxUniverseInfo } from "../types/roblox.js";

export class RobloxApiError extends Error {
  status: number;
  retryAfterMs?: number;

  constructor(message: string, options: { status: number; retryAfterMs?: number }) {
    super(message);
    this.name = "RobloxApiError";
    this.status = options.status;
    if (typeof options.retryAfterMs === "number") {
      this.retryAfterMs = options.retryAfterMs;
    }
  }
}

interface OpenCloudOptions {
  baseUrl?: string;
  cacheTtlMs?: number;
}

export class OpenCloudClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;

  constructor(apiKey: string, options?: OpenCloudOptions) {
    this.apiKey = apiKey;
    this.baseUrl = options?.baseUrl ?? "https://apis.roblox.com";
    this.cacheTtlMs = options?.cacheTtlMs ?? 60 * 60 * 1000;
  }

  async getExperienceInfo(universeId: string): Promise<RobloxUniverseInfo> {
    return this.getJson<RobloxUniverseInfo>(`/cloud/v2/universes/${universeId}`);
  }

  async getPlaceInfo(universeId: string, placeId: string): Promise<RobloxPlaceInfo> {
    return this.getJson<RobloxPlaceInfo>(`/cloud/v2/universes/${universeId}/places/${placeId}`);
  }

  async getAssetInfo(assetId: string): Promise<RobloxAssetInfo> {
    return this.getJson<RobloxAssetInfo>(`/assets/v1/assets/${assetId}`);
  }

  async getAssetModerationStatus(assetId: string): Promise<Record<string, unknown>> {
    const candidates = [
      `/assets/v1/assets/${assetId}/moderation`,
      `/assets/v1/assets/${assetId}/status`,
      `/assets/v1/assets/${assetId}/publish-status`,
    ];
    let lastError: Error | null = null;
    for (const endpoint of candidates) {
      try {
        return await this.getJson<Record<string, unknown>>(endpoint);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (lastError instanceof RobloxApiError && lastError.status !== 404) {
          throw lastError;
        }
      }
    }
    throw lastError ?? new Error(`Unable to resolve moderation status for asset ${assetId}`);
  }

  async listPlaces(universeId: string): Promise<RobloxPlaceInfo[]> {
    const response = await this.getJson<{
      data?: RobloxPlaceInfo[];
      universePlaces?: RobloxPlaceInfo[];
    }>(`/cloud/v2/universes/${universeId}/places`);
    return response.data ?? response.universePlaces ?? [];
  }

  private async getJson<T>(pathname: string): Promise<T> {
    const cacheKey = pathname;
    const cached = await readCachedJson<T>("open-cloud", cacheKey, this.cacheTtlMs);
    if (cached) {
      return cached;
    }
    const url = new URL(pathname, this.baseUrl);
    const response = await fetch(url, {
      headers: {
        "x-api-key": this.apiKey,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const body = await safeReadBody(response);
      const retryAfter = response.headers.get("retry-after");
      throw new RobloxApiError(
        `Roblox Open Cloud request failed (${response.status}) for ${url.pathname}: ${body}`,
        {
          status: response.status,
          ...(retryAfter ? { retryAfterMs: Number(retryAfter) * 1000 } : {}),
        },
      );
    }
    const json = (await response.json()) as T;
    await writeCachedJson("open-cloud", cacheKey, json);
    return json;
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}

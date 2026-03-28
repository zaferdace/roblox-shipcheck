import type {
  InstanceNode,
  Patch,
  RobloxPropertyValue,
  SearchQuery,
  TestConfig,
  TestRunResult,
} from "../types/roblox.js";

export class StudioBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioBridgeError";
  }
}

interface StudioBridgeOptions {
  host?: string;
  port?: number;
  timeout?: number;
}

export class StudioBridgeClient {
  readonly host: string;
  readonly port: number;
  readonly timeout: number;

  constructor(options?: StudioBridgeOptions) {
    this.host = options?.host ?? "localhost";
    this.port = options?.port ?? 33796;
    this.timeout = options?.timeout ?? 10_000;
  }

  async ping(): Promise<{ ok: boolean; version?: string }> {
    return this.request<{ ok: boolean; version?: string }>("/api/ping");
  }

  async getDataModel(): Promise<InstanceNode> {
    return this.request<InstanceNode>("/api/datamodel");
  }

  async searchInstances(query: SearchQuery): Promise<unknown> {
    return this.request("/api/search", { method: "POST", body: query });
  }

  async getScreenshot(viewport: "game" | "scene"): Promise<{ pngBase64: string }> {
    return this.request<{ pngBase64: string }>(
      `/api/screenshot?viewport=${encodeURIComponent(viewport)}`,
    );
  }

  async runTests(config: TestConfig): Promise<{ runId: string }> {
    return this.request<{ runId: string }>("/api/tests/run", { method: "POST", body: config });
  }

  async getTestResults(runId: string): Promise<TestRunResult> {
    return this.request<TestRunResult>(`/api/tests/results/${encodeURIComponent(runId)}`);
  }

  async applyPatch(patch: Patch, dryRun: boolean): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/patch", {
      method: "POST",
      body: { patch, dryRun },
    });
  }

  async undoPatch(patchId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/patch/undo", {
      method: "POST",
      body: { patchId },
    });
  }

  async executeCode(code: string, acknowledgeRisk = false): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/execute", {
      method: "POST",
      body: { code, acknowledge_risk: acknowledgeRisk },
    });
  }

  async getScriptSource(path: string): Promise<{ path: string; source: string }> {
    return this.request<{ path: string; source: string }>(
      `/api/script/source?path=${encodeURIComponent(path)}`,
    );
  }

  async setScriptSource(path: string, source: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/script/source", {
      method: "POST",
      body: { path, source },
    });
  }

  async getProperties(target: string): Promise<Record<string, RobloxPropertyValue>> {
    const knownRoots = new Set([
      "game",
      "DataModel",
      "Workspace",
      "Players",
      "ServerScriptService",
      "ReplicatedStorage",
      "ReplicatedFirst",
      "StarterGui",
      "StarterPack",
      "StarterPlayer",
      "ServerStorage",
      "Lighting",
      "Chat",
      "TestService",
      "SoundService",
      "Teams",
      "TextChatService",
      "LocalizationService",
      "MaterialService",
    ]);
    const normalizedTarget = target.replaceAll("/", ".");
    const firstSegment = normalizedTarget.split(".")[0] ?? "";
    if (knownRoots.has(firstSegment)) {
      return this.request<Record<string, RobloxPropertyValue>>(
        `/api/instance/properties?path=${encodeURIComponent(target)}`,
      );
    }
    return this.request<Record<string, RobloxPropertyValue>>(
      `/api/instance/${encodeURIComponent(target)}/properties`,
    );
  }

  async createInstance(
    parentPath: string,
    className: string,
    name?: string,
    properties?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/instance/create", {
      method: "POST",
      body: {
        parent_path: parentPath,
        class_name: className,
        ...(name ? { name } : {}),
        ...(properties ? { properties } : {}),
      },
    });
  }

  async deleteInstance(path: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/instance/delete", {
      method: "POST",
      body: { path },
    });
  }

  async cloneInstance(path: string, newParentPath?: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/instance/clone", {
      method: "POST",
      body: {
        path,
        ...(newParentPath ? { new_parent_path: newParentPath } : {}),
      },
    });
  }

  async moveInstance(path: string, newParentPath: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/instance/move", {
      method: "POST",
      body: { path, new_parent_path: newParentPath },
    });
  }

  async setInstanceProperty(
    path: string,
    property: string,
    value: unknown,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/instance/set-property", {
      method: "POST",
      body: { path, property, value },
    });
  }

  async getChildren(path: string, depth?: number): Promise<unknown> {
    const searchParams = new URLSearchParams({ path });
    if (depth !== undefined) {
      searchParams.set("depth", String(depth));
    }
    return this.request(`/api/instance/children?${searchParams.toString()}`);
  }

  async getSelection(): Promise<unknown> {
    return this.request("/api/selection");
  }

  async manageTags(
    path: string,
    action: "add" | "remove" | "list",
    tag?: string,
  ): Promise<unknown> {
    return this.request("/api/tags", {
      method: "POST",
      body: {
        path,
        action,
        ...(tag ? { tag } : {}),
      },
    });
  }

  async manageAttributes(
    path: string,
    action: "get" | "set" | "delete",
    key?: string,
    value?: unknown,
  ): Promise<unknown> {
    return this.request("/api/attributes", {
      method: "POST",
      body: {
        path,
        action,
        ...(key ? { key } : {}),
        ...(value !== undefined ? { value } : {}),
      },
    });
  }

  async startPlaytest(mode?: "play" | "run" | "pause"): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/playtest/start", {
      method: "POST",
      body: {
        ...(mode ? { mode } : {}),
      },
    });
  }

  async stopPlaytest(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/playtest/stop", {
      method: "POST",
    });
  }

  async getOutput(limit?: number): Promise<unknown> {
    const query = typeof limit === "number" ? `?limit=${encodeURIComponent(String(limit))}` : "";
    return this.request(`/api/output${query}`);
  }

  async getTeleportGraph(): Promise<unknown> {
    return this.request("/api/teleport-graph");
  }

  async getPackageInfo(): Promise<unknown> {
    return this.request("/api/packages");
  }

  async buildUI(parentPath: string, spec: unknown): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/ui/build", {
      method: "POST",
      body: { parent_path: parentPath, spec },
    });
  }

  async applyLighting(
    preset?: string,
    customConfig?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/lighting/apply", {
      method: "POST",
      body: {
        ...(preset ? { preset } : {}),
        ...(customConfig ? { custom_config: customConfig } : {}),
      },
    });
  }

  async terrainGenerate(
    operation: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/terrain/generate", {
      method: "POST",
      body: { operation, params },
    });
  }

  private async request<T>(
    route: string,
    options?: { method?: "GET" | "POST"; body?: unknown },
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const url = `http://${this.host}:${this.port}${route}`;
    try {
      const requestInit: RequestInit = {
        method: options?.method ?? "GET",
        signal: controller.signal,
      };
      if (options?.body !== undefined) {
        requestInit.headers = {
          "content-type": "application/json",
        };
        requestInit.body = JSON.stringify(options.body);
      }
      const response = await fetch(url, requestInit);
      if (!response.ok) {
        const body = await safeReadBody(response);
        throw new StudioBridgeError(
          `Roblox Studio bridge request failed (${response.status}) at ${route}: ${body}`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof StudioBridgeError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new StudioBridgeError(
          `Roblox Studio bridge timed out after ${this.timeout}ms at ${route}. Ensure the companion plugin is running on port ${this.port}.`,
        );
      }
      throw new StudioBridgeError(
        `Unable to reach Roblox Studio bridge at http://${this.host}:${this.port}. Ensure Roblox Studio is open and the companion plugin HTTP server is running.`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}

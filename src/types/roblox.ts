export type Primitive = string | number | boolean | null;

export type RobloxPropertyValue =
  | Primitive
  | { [key: string]: RobloxPropertyValue }
  | RobloxPropertyValue[];

export interface InstanceNode {
  id: string;
  name: string;
  className: string;
  properties?: Record<string, RobloxPropertyValue>;
  children: InstanceNode[];
}

export interface InstanceSnapshot {
  id: string;
  name: string;
  className: string;
  properties?: Record<string, RobloxPropertyValue>;
  children: InstanceSnapshot[];
}

export type SearchType = "name" | "class" | "property" | "script_content";

export interface SearchQuery {
  query: string;
  search_type: SearchType;
  case_sensitive?: boolean;
  max_results?: number;
  root_path?: string;
}

export interface StudioSearchMatch {
  path: string;
  className: string;
  snippet: string;
  matchType: SearchType;
}

export interface TestConfig {
  configuration: "server" | "client" | "multi_client";
  testFilter?: string;
  multiClientCount?: number;
  timeoutSeconds?: number;
}

export interface TestCaseResult {
  name: string;
  status: "pass" | "fail" | "skip" | "error";
  durationMs: number;
  errorMessage?: string;
}

export interface TestRunResult {
  runId: string;
  status: "queued" | "running" | "completed" | "failed";
  configuration: TestConfig["configuration"];
  startedAt?: string;
  finishedAt?: string;
  results: TestCaseResult[];
}

export type PatchOperation =
  | {
      type: "create";
      target_path: string;
      properties?: Record<string, RobloxPropertyValue>;
      class_name: string;
    }
  | {
      type: "update";
      target_path: string;
      properties?: Record<string, RobloxPropertyValue>;
    }
  | {
      type: "delete";
      target_path: string;
    }
  | {
      type: "reparent";
      target_path: string;
      new_parent_path: string;
      properties?: Record<string, RobloxPropertyValue>;
    };

export interface Patch {
  description?: string;
  operations: PatchOperation[];
}

export interface RobloxUniverseInfo {
  path?: string;
  name?: string;
  displayName?: string;
  description?: string;
  createTime?: string;
  updateTime?: string;
  visibility?: string;
  [key: string]: unknown;
}

export interface RobloxPlaceInfo {
  path?: string;
  name?: string;
  displayName?: string;
  description?: string;
  createTime?: string;
  updateTime?: string;
  [key: string]: unknown;
}

export interface RobloxAssetInfo {
  id?: string;
  path?: string;
  displayName?: string;
  assetType?: string;
  createTime?: string;
  updateTime?: string;
  state?: string;
  moderationResult?: string;
  [key: string]: unknown;
}

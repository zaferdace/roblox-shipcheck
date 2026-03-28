import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import {
  createResponseEnvelope,
  findNodeByPath,
  readScriptSource,
  sourceInfo,
  traverseInstances,
} from "../shared.js";
import type { AuditSeverity, InstanceNode } from "../types/roblox.js";
import type { ResponseEnvelope } from "../types/tools.js";
import { registerTool } from "./registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  root_path: z.string().min(1).default("ServerScriptService"),
  check_pcall_wrapping: z.boolean().default(true),
  check_key_patterns: z.boolean().default(true),
  check_retry_logic: z.boolean().default(true),
  check_budget_awareness: z.boolean().default(true),
});

interface DataStoreIssue {
  severity: AuditSeverity;
  script_path: string;
  rule: string;
  message: string;
  suggestion: string;
}

interface KeyInventoryEntry {
  store_name: string;
  key_pattern: string;
  operations: string[];
}

interface DataStoreGuardResult {
  score: number;
  scripts_analyzed: number;
  datastores_found: number;
  issues: DataStoreIssue[];
  key_inventory: KeyInventoryEntry[];
}

interface ScriptRecord {
  path: string;
  source: string;
}

interface DataStoreGuardOptions {
  rootPath: string;
  checkPcallWrapping: boolean;
  checkKeyPatterns: boolean;
  checkRetryLogic: boolean;
  checkBudgetAwareness: boolean;
}

const operations = [
  "GetAsync",
  "SetAsync",
  "UpdateAsync",
  "RemoveAsync",
  "GetSortedAsync",
] as const;

export function analyzeDataStoreSchema(
  root: InstanceNode,
  options: DataStoreGuardOptions,
): DataStoreGuardResult {
  const baseNode = findNodeByPath(root, options.rootPath);
  if (!baseNode) {
    return {
      score: 0,
      scripts_analyzed: 0,
      datastores_found: 0,
      issues: [
        {
          severity: "high",
          script_path: options.rootPath,
          rule: "invalid_root_path",
          message: `Root path "${options.rootPath}" was not found in the DataModel.`,
          suggestion: "Provide a valid script container such as ServerScriptService.",
        },
      ],
      key_inventory: [],
    };
  }

  const scripts: ScriptRecord[] = [];
  traverseInstances(baseNode, (node, currentPath) => {
    if (node.className === "Script" || node.className === "ModuleScript") {
      const source = readScriptSource(node);
      if (source) {
        scripts.push({ path: currentPath, source });
      }
    }
  });

  const issues: DataStoreIssue[] = [];
  const keyInventory = new Map<string, KeyInventoryEntry>();
  let datastoreUsageCount = 0;
  let compliantScripts = 0;

  for (const script of scripts) {
    const usesDataStore =
      /DataStoreService\s*:\s*GetDataStore\s*\(|MemoryStoreService|OrderedDataStore|GetAsync\s*\(|SetAsync\s*\(|UpdateAsync\s*\(|RemoveAsync\s*\(|GetSortedAsync\s*\(/u.test(
        script.source,
      );
    if (!usesDataStore) {
      continue;
    }

    datastoreUsageCount += 1;
    const beforeIssues = issues.length;
    const storeNames = extractStoreNames(script.source);
    const opNames = extractOperations(script.source);
    const keyPatterns = extractKeyPatterns(script.source);

    for (const storeName of storeNames) {
      for (const keyPattern of keyPatterns.length > 0 ? keyPatterns : ["<unknown>"]) {
        const key = `${storeName}:${keyPattern}`;
        const existing = keyInventory.get(key);
        if (existing) {
          for (const opName of opNames) {
            if (!existing.operations.includes(opName)) {
              existing.operations.push(opName);
            }
          }
          continue;
        }
        keyInventory.set(key, {
          store_name: storeName,
          key_pattern: keyPattern,
          operations: [...opNames],
        });
      }
    }

    if (
      options.checkPcallWrapping &&
      opNames.length > 0 &&
      !/\b(?:p|x)pcall\s*\(/u.test(script.source)
    ) {
      issues.push({
        severity: "high",
        script_path: script.path,
        rule: "pcall_wrapping",
        message: "DataStore operations were detected without pcall/xpcall protection.",
        suggestion: "Wrap DataStore requests in pcall or xpcall and handle transient failures.",
      });
    }

    if (options.checkKeyPatterns) {
      const hardcodedKey = keyPatterns.find((keyPattern) => /^["'][^"']+["']$/u.test(keyPattern));
      if (hardcodedKey) {
        issues.push({
          severity: "medium",
          script_path: script.path,
          rule: "hardcoded_key",
          message: `Hardcoded key pattern detected: ${hardcodedKey}.`,
          suggestion: "Compose keys from stable prefixes and scoped identifiers such as userId.",
        });
      }
      if (
        keyPatterns.length > 0 &&
        !keyPatterns.some((keyPattern) => /userId|UserId|Player_/u.test(keyPattern))
      ) {
        issues.push({
          severity: "low",
          script_path: script.path,
          rule: "key_scope",
          message: "Detected key patterns do not show clear player- or entity-scoped namespacing.",
          suggestion: 'Use explicit namespaces like "Player_" .. userId to avoid key collisions.',
        });
      }
    }

    if (options.checkRetryLogic && opNames.length > 0 && !hasRetryLogic(script.source)) {
      issues.push({
        severity: "medium",
        script_path: script.path,
        rule: "retry_logic",
        message: "DataStore usage does not show retry logic after failures.",
        suggestion: "Retry transient failures with bounded attempts and task.wait backoff.",
      });
    }

    if (
      options.checkBudgetAwareness &&
      opNames.length > 0 &&
      !/GetRequestBudgetForRequestType\s*\(/u.test(script.source)
    ) {
      issues.push({
        severity: "low",
        script_path: script.path,
        rule: "budget_awareness",
        message: "No request-budget checks were found near DataStore usage.",
        suggestion: "Check request budgets before bursts of reads or writes.",
      });
    }

    if (hasConcurrentWriteRisk(script.source)) {
      issues.push({
        severity: "medium",
        script_path: script.path,
        rule: "race_condition",
        message:
          "Multiple writes to likely-shared keys were detected without obvious UpdateAsync usage.",
        suggestion:
          "Prefer UpdateAsync for concurrent writes and centralize mutation logic per key.",
      });
    }

    if (hasLargeValueRisk(script.source)) {
      issues.push({
        severity: "low",
        script_path: script.path,
        rule: "large_value",
        message: "Serialized payload storage detected without an obvious size guard.",
        suggestion: "Check encoded payload size before writes to avoid the 4 MB limit.",
      });
    }

    if (issues.length === beforeIssues) {
      compliantScripts += 1;
    }
  }

  const score =
    datastoreUsageCount === 0 ? 100 : Math.round((compliantScripts / datastoreUsageCount) * 100);
  return {
    score,
    scripts_analyzed: scripts.length,
    datastores_found: datastoreUsageCount,
    issues,
    key_inventory: [...keyInventory.values()].sort((a, b) =>
      `${a.store_name}:${a.key_pattern}`.localeCompare(`${b.store_name}:${b.key_pattern}`),
    ),
  };
}

function extractStoreNames(source: string): string[] {
  const names = new Set<string>();
  const regex = /GetDataStore\s*\(\s*(["'][^"']+["'])/gu;
  let match = regex.exec(source);
  while (match) {
    const name = match[1];
    if (name) {
      names.add(name.slice(1, -1));
    }
    match = regex.exec(source);
  }
  if (names.size === 0 && /MemoryStoreService/u.test(source)) {
    names.add("MemoryStoreService");
  }
  return [...names];
}

function extractOperations(source: string): string[] {
  return operations.filter((name) => new RegExp(`:${name}\\s*\\(`, "u").test(source));
}

function extractKeyPatterns(source: string): string[] {
  const results = new Set<string>();
  const regex = /:(?:GetAsync|SetAsync|UpdateAsync|RemoveAsync|GetSortedAsync)\s*\(\s*([^,\n)]+)/gu;
  let match = regex.exec(source);
  while (match) {
    const keyPattern = match[1]?.trim();
    if (keyPattern) {
      results.add(keyPattern);
    }
    match = regex.exec(source);
  }
  return [...results];
}

function hasRetryLogic(source: string): boolean {
  return /(retry|attempt|for\s+\w+\s*=\s*\d+|while\s+|repeat\s+|task\.wait\s*\(|wait\s*\()/iu.test(
    source,
  );
}

function hasConcurrentWriteRisk(source: string): boolean {
  const setAsyncCount = (source.match(/:SetAsync\s*\(/gu) ?? []).length;
  return setAsyncCount > 1 && !/:UpdateAsync\s*\(/u.test(source);
}

function hasLargeValueRisk(source: string): boolean {
  return (
    /(JSONEncode\s*\(|HttpService\s*:\s*JSONEncode\s*\(|serialize|Serialize)/u.test(source) &&
    !/(string\.len\s*\(|utf8\.len\s*\(|#\s*\w+\s*[<>]=?\s*\d+)/u.test(source)
  );
}

export async function runDataStoreSchemaGuard(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<DataStoreGuardResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = await client.getDataModel();
  const result = analyzeDataStoreSchema(root, {
    rootPath: input.root_path,
    checkPcallWrapping: input.check_pcall_wrapping,
    checkKeyPatterns: input.check_key_patterns,
    checkRetryLogic: input.check_retry_logic,
    checkBudgetAwareness: input.check_budget_awareness,
  });
  return createResponseEnvelope(result, {
    source: sourceInfo({ studio_port: input.studio_port }),
  });
}

registerTool({
  name: "rbx_datastore_schema_guard",
  description:
    "Audit Roblox DataStore and MemoryStore usage for resiliency, key hygiene, and write safety.",
  schema,
  handler: runDataStoreSchemaGuard,
});

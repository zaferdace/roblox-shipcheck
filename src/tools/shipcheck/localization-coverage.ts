import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import {
  createResponseEnvelope,
  findNodeByPath,
  readScriptSource,
  sourceInfo,
  traverseInstances,
} from "../../shared.js";
import type { AuditSeverity, InstanceNode, RobloxPropertyValue } from "../../types/roblox.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  root_paths: z.array(z.string().min(1)).default(["StarterGui", "ReplicatedStorage"]),
  check_hardcoded_text: z.boolean().default(true),
  check_localization_table: z.boolean().default(true),
  check_dynamic_strings: z.boolean().default(true),
});

interface LocalizationIssue {
  severity: AuditSeverity;
  element_path: string;
  rule: string;
  message: string;
  suggestion: string;
}

interface LocalizationCoverageResult {
  score: number;
  text_elements_found: number;
  localized_count: number;
  hardcoded_count: number;
  issues: LocalizationIssue[];
  coverage_by_locale: Record<string, number>;
}

interface TextElementRecord {
  path: string;
  text: string;
  autoLocalize: boolean;
}

interface LocalizationOptions {
  rootPaths: string[];
  checkHardcodedText: boolean;
  checkLocalizationTable: boolean;
  checkDynamicStrings: boolean;
}

export function analyzeLocalizationCoverage(
  root: InstanceNode,
  options: LocalizationOptions,
): LocalizationCoverageResult {
  const textElements: TextElementRecord[] = [];
  const issues: LocalizationIssue[] = [];
  const localizationEntries = new Map<string, Set<string>>();

  for (const rootPath of options.rootPaths) {
    const baseNode = findNodeByPath(root, rootPath);
    if (!baseNode) {
      issues.push({
        severity: "low",
        element_path: rootPath,
        rule: "missing_root_path",
        message: `Root path "${rootPath}" was not found in the DataModel.`,
        suggestion: "Adjust root_paths to match the containers that hold localizable UI content.",
      });
      continue;
    }
    traverseInstances(baseNode, (node, currentPath) => {
      if (["TextLabel", "TextButton", "TextBox"].includes(node.className)) {
        const properties = node.properties ?? {};
        const text = readStringProperty(properties["Text"]);
        textElements.push({
          path: currentPath,
          text,
          autoLocalize: properties["AutoLocalize"] !== false,
        });
      }
    });
  }

  traverseInstances(root, (node, currentPath) => {
    if (node.className === "LocalizationTable") {
      for (const [locale, keys] of extractLocalizationEntries(node.properties ?? {})) {
        const bucket = localizationEntries.get(locale) ?? new Set<string>();
        for (const key of keys) {
          bucket.add(key);
        }
        localizationEntries.set(locale, bucket);
      }
      if (options.checkLocalizationTable && localizationEntries.size === 0) {
        issues.push({
          severity: "medium",
          element_path: currentPath,
          rule: "empty_localization_table",
          message: "LocalizationTable was found but no entries could be extracted.",
          suggestion:
            "Ensure localization data is populated and serialized in a readable property.",
        });
      }
    }
    if (
      options.checkDynamicStrings &&
      (node.className === "Script" ||
        node.className === "ModuleScript" ||
        node.className === "LocalScript")
    ) {
      const source = readScriptSource(node);
      if (source && hasDynamicStringBypass(source)) {
        issues.push({
          severity: "low",
          element_path: currentPath,
          rule: "dynamic_string_bypass",
          message: "String concatenation or string.format literals may bypass localization keys.",
          suggestion:
            "Build localized strings through localization tables instead of inline literals.",
        });
      }
    }
  });

  let localizedCount = 0;
  let hardcodedCount = 0;
  const knownKeys = new Set<string>();
  for (const keys of localizationEntries.values()) {
    for (const key of keys) {
      knownKeys.add(key);
    }
  }

  for (const element of textElements) {
    const isEmpty = element.text.trim().length === 0;
    const isKeyLike = isLocalizationKey(element.text);
    const hasKnownKey = isKeyLike && knownKeys.has(element.text);
    if (!element.autoLocalize) {
      issues.push({
        severity: "medium",
        element_path: element.path,
        rule: "auto_localize_disabled",
        message: "AutoLocalize is disabled on a text element.",
        suggestion: "Enable AutoLocalize unless the element is intentionally exempt.",
      });
    }
    if (!isEmpty && options.checkHardcodedText && !isKeyLike) {
      hardcodedCount += 1;
      issues.push({
        severity: "medium",
        element_path: element.path,
        rule: "hardcoded_text",
        message: `Visible text appears hardcoded: "${element.text.slice(0, 48)}".`,
        suggestion: "Replace visible text literals with localization keys or table-backed content.",
      });
      continue;
    }
    if (!isEmpty && isKeyLike && options.checkLocalizationTable && !hasKnownKey) {
      issues.push({
        severity: "medium",
        element_path: element.path,
        rule: "missing_localization_key",
        message: `Localization key "${element.text}" was not found in extracted localization tables.`,
        suggestion:
          "Add this key to your localization table or update the UI binding to an existing key.",
      });
    }
    if (!isEmpty && (hasKnownKey || (isKeyLike && element.autoLocalize))) {
      localizedCount += 1;
    }
  }

  const score =
    textElements.length === 0
      ? 100
      : Math.round((localizedCount / Math.max(1, localizedCount + hardcodedCount)) * 100);
  return {
    score,
    text_elements_found: textElements.length,
    localized_count: localizedCount,
    hardcoded_count: hardcodedCount,
    issues,
    coverage_by_locale: computeCoverageByLocale(localizationEntries),
  };
}

function readStringProperty(value: RobloxPropertyValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function isLocalizationKey(value: string): boolean {
  return /^[A-Z0-9_.-]+$/u.test(value.trim());
}

function extractLocalizationEntries(
  properties: Record<string, RobloxPropertyValue>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const candidates = [
    properties["Contents"],
    properties["Source"],
    properties["TableContents"],
    properties["Entries"],
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as unknown;
      collectLocalizationEntries(parsed, result);
    } catch {
      const localeMatch = candidate.match(/\b[a-z]{2}(?:-[A-Z]{2})?\b/gu) ?? [];
      const keyMatch = candidate.match(/\b[A-Z0-9_.-]{3,}\b/gu) ?? [];
      for (const locale of localeMatch) {
        const bucket = result.get(locale) ?? new Set<string>();
        for (const key of keyMatch) {
          bucket.add(key);
        }
        result.set(locale, bucket);
      }
    }
  }
  return result;
}

function collectLocalizationEntries(
  value: unknown,
  output: Map<string, Set<string>>,
  currentLocale?: string,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectLocalizationEntries(item, output, currentLocale);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  const localeCandidate =
    typeof record["locale"] === "string"
      ? record["locale"]
      : typeof record["sourceLocaleId"] === "string"
        ? record["sourceLocaleId"]
        : currentLocale;
  if (typeof record["key"] === "string") {
    const locale = localeCandidate ?? "unknown";
    const bucket = output.get(locale) ?? new Set<string>();
    bucket.add(record["key"]);
    output.set(locale, bucket);
  }
  for (const nestedValue of Object.values(record)) {
    collectLocalizationEntries(nestedValue, output, localeCandidate);
  }
}

function hasDynamicStringBypass(source: string): boolean {
  return /(?:\.\.\s*["'][^"']+["'])|(?:string\.format\s*\(\s*["'][^"']+["'])/u.test(source);
}

function computeCoverageByLocale(entries: Map<string, Set<string>>): Record<string, number> {
  const coverage: Record<string, number> = {};
  const allKeys = new Set<string>();
  for (const keys of entries.values()) {
    for (const key of keys) {
      allKeys.add(key);
    }
  }
  const totalKeys = allKeys.size;
  for (const [locale, keys] of entries.entries()) {
    coverage[locale] = totalKeys === 0 ? 0 : Math.round((keys.size / totalKeys) * 100);
  }
  return coverage;
}

export async function runLocalizationCoverageAudit(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<LocalizationCoverageResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = await client.getDataModel();
  const result = analyzeLocalizationCoverage(root, {
    rootPaths: input.root_paths,
    checkHardcodedText: input.check_hardcoded_text,
    checkLocalizationTable: input.check_localization_table,
    checkDynamicStrings: input.check_dynamic_strings,
  });
  return createResponseEnvelope(result, {
    source: sourceInfo({ studio_port: input.studio_port }),
  });
}

registerTool({
  name: "rbx_localization_coverage_audit",
  description:
    "Audit Roblox UI and scripts for localization coverage, hardcoded text, and locale-table gaps.",
  schema,
  handler: runLocalizationCoverageAudit,
});

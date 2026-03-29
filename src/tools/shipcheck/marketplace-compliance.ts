import { z } from "zod";
import { OpenCloudClient } from "../../roblox/open-cloud-client.js";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import {
  createResponseEnvelope,
  readScriptSource,
  sourceInfo,
  traverseInstances,
} from "../../shared.js";
import type { AuditSeverity, InstanceNode } from "../../types/roblox.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  api_key: z.string().min(1).optional(),
  universe_id: z.string().min(1).optional(),
  check_receipt_handling: z.boolean().default(true),
  check_product_references: z.boolean().default(true),
  check_failover_ux: z.boolean().default(true),
});

interface MarketplaceIssue {
  severity: AuditSeverity;
  script_path: string;
  rule: string;
  message: string;
  suggestion: string;
}

interface ProductInventoryEntry {
  id: string;
  kind: "developer_product" | "game_pass" | "subscription" | "unknown";
  scripts: string[];
  open_cloud_status?: "validated" | "lookup_failed";
}

interface MarketplaceComplianceResult {
  score: number;
  products_found: number;
  issues: MarketplaceIssue[];
  product_inventory: ProductInventoryEntry[];
}

interface ScriptRecord {
  path: string;
  source: string;
}

interface MarketplaceOptions {
  checkReceiptHandling: boolean;
  checkProductReferences: boolean;
  checkFailoverUx: boolean;
  openCloudClient?: OpenCloudClient;
}

export async function analyzeMarketplaceCompliance(
  root: InstanceNode,
  options: MarketplaceOptions,
): Promise<MarketplaceComplianceResult> {
  const scripts: ScriptRecord[] = [];
  traverseInstances(root, (node, currentPath) => {
    if (
      node.className === "Script" ||
      node.className === "ModuleScript" ||
      node.className === "LocalScript"
    ) {
      const source = readScriptSource(node);
      if (source) {
        scripts.push({ path: currentPath, source });
      }
    }
  });

  const issues: MarketplaceIssue[] = [];
  const inventory = new Map<string, ProductInventoryEntry>();
  const processReceiptScripts = scripts.filter((script) =>
    /MarketplaceService\s*\.\s*ProcessReceipt|MarketplaceService\.ProcessReceipt/u.test(
      script.source,
    ),
  );
  const usesPromptProductPurchase = scripts.some((script) =>
    /PromptProductPurchase\s*\(/u.test(script.source),
  );

  for (const script of scripts) {
    for (const reference of extractMarketplaceReferences(script.source)) {
      const key = `${reference.kind}:${reference.id}`;
      const existing = inventory.get(key);
      if (existing) {
        if (!existing.scripts.includes(script.path)) {
          existing.scripts.push(script.path);
        }
      } else {
        inventory.set(key, {
          id: reference.id,
          kind: reference.kind,
          scripts: [script.path],
        });
      }
    }

    if (
      options.checkProductReferences &&
      /PromptProductPurchase\s*\(|PromptPurchase\s*\(|GetProductInfo\s*\(/u.test(script.source)
    ) {
      const hardcodedIds = extractNumericIds(script.source);
      if (
        hardcodedIds.length > 0 &&
        !/Config|Constants|MarketplaceIds|PRODUCT_IDS/u.test(script.path + script.source)
      ) {
        issues.push({
          severity: "low",
          script_path: script.path,
          rule: "hardcoded_product_ids",
          message: `Hardcoded marketplace IDs detected: ${hardcodedIds.slice(0, 3).join(", ")}.`,
          suggestion:
            "Move marketplace IDs into a shared config module to reduce drift and copy-paste errors.",
        });
      }
    }

    if (
      /UserOwnsGamePassAsync\s*\(/u.test(script.source) &&
      !/\b(?:p|x)pcall\s*\(/u.test(script.source)
    ) {
      issues.push({
        severity: "medium",
        script_path: script.path,
        rule: "gamepass_pcall",
        message: "UserOwnsGamePassAsync is used without pcall/xpcall protection.",
        suggestion: "Wrap game pass ownership checks in pcall and handle service failures.",
      });
    }

    if (
      options.checkFailoverUx &&
      hasPromptUsage(script.source) &&
      !hasPurchaseFailoverUx(script.source)
    ) {
      issues.push({
        severity: "low",
        script_path: script.path,
        rule: "failover_ux",
        message: "Purchase prompts are used without obvious completion or failure handling.",
        suggestion:
          "Handle prompt finished callbacks and surface retry or failure UX to the player.",
      });
    }
  }

  if (
    options.checkReceiptHandling &&
    usesPromptProductPurchase &&
    processReceiptScripts.length === 0
  ) {
    issues.push({
      severity: "high",
      script_path: "MarketplaceService",
      rule: "missing_process_receipt",
      message:
        "PromptProductPurchase is used but no MarketplaceService.ProcessReceipt handler was found.",
      suggestion: "Add a server-side ProcessReceipt handler before shipping developer products.",
    });
  }

  for (const script of processReceiptScripts) {
    if (!/PurchaseGranted/u.test(script.source)) {
      issues.push({
        severity: "high",
        script_path: script.path,
        rule: "receipt_return_value",
        message: "ProcessReceipt handler does not appear to return PurchaseGranted.",
        suggestion: "Return Enum.ProductPurchaseDecision.PurchaseGranted after a successful grant.",
      });
    }
    if (!/\b(?:p|x)pcall\s*\(/u.test(script.source)) {
      issues.push({
        severity: "medium",
        script_path: script.path,
        rule: "receipt_pcall",
        message: "ProcessReceipt handler does not show pcall/xpcall protection around grant logic.",
        suggestion: "Wrap receipt processing and persistence in pcall to avoid accidental retries.",
      });
    }
    if (!hasIdempotencyCheck(script.source)) {
      issues.push({
        severity: "high",
        script_path: script.path,
        rule: "receipt_idempotency",
        message:
          "ProcessReceipt handler does not show an idempotency check before granting rewards.",
        suggestion:
          "Record processed PurchaseId values or durable grant markers before returning PurchaseGranted.",
      });
    }
  }

  if (options.openCloudClient) {
    for (const entry of inventory.values()) {
      try {
        await options.openCloudClient.getAssetInfo(entry.id);
        entry.open_cloud_status = "validated";
      } catch {
        entry.open_cloud_status = "lookup_failed";
        issues.push({
          severity: "low",
          script_path: entry.scripts[0] ?? "MarketplaceService",
          rule: "open_cloud_cross_reference",
          message: `Open Cloud lookup failed for marketplace ID ${entry.id}.`,
          suggestion:
            "Verify the product or pass ID is correct and accessible to the provided API key.",
        });
      }
    }
  }

  const compliantReferences = Math.max(0, inventory.size - countDistinctIssueTargets(issues));
  const score =
    inventory.size === 0
      ? 100
      : Math.round((compliantReferences / Math.max(1, inventory.size)) * 100);
  return {
    score,
    products_found: inventory.size,
    issues,
    product_inventory: [...inventory.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function extractMarketplaceReferences(
  source: string,
): Array<{ id: string; kind: ProductInventoryEntry["kind"] }> {
  const matches: Array<{ id: string; kind: ProductInventoryEntry["kind"] }> = [];
  const patterns: Array<{ regex: RegExp; kind: ProductInventoryEntry["kind"] }> = [
    { regex: /PromptProductPurchase\s*\([^,\n]+,\s*(\d{4,})/gu, kind: "developer_product" },
    { regex: /PromptPurchase\s*\([^,\n]+,\s*(\d{4,})/gu, kind: "game_pass" },
    { regex: /PromptSubscriptionPurchase\s*\([^,\n]+,\s*(\d{4,})/gu, kind: "subscription" },
    { regex: /GetProductInfo\s*\(\s*(\d{4,})/gu, kind: "unknown" },
  ];
  for (const pattern of patterns) {
    let match = pattern.regex.exec(source);
    while (match) {
      const id = match[1];
      if (id) {
        matches.push({ id, kind: pattern.kind });
      }
      match = pattern.regex.exec(source);
    }
  }
  return matches;
}

function extractNumericIds(source: string): string[] {
  const ids = new Set<string>();
  const regex = /\b(\d{4,})\b/gu;
  let match = regex.exec(source);
  while (match) {
    const id = match[1];
    if (id) {
      ids.add(id);
    }
    match = regex.exec(source);
  }
  return [...ids];
}

function hasPromptUsage(source: string): boolean {
  return /PromptProductPurchase\s*\(|PromptPurchase\s*\(|PromptSubscriptionPurchase\s*\(/u.test(
    source,
  );
}

function hasPurchaseFailoverUx(source: string): boolean {
  return /(PromptProductPurchaseFinished|PromptPurchaseFinished|PromptGamePassPurchaseFinished|pcall\s*\(|warn\s*\(|notify|toast|errorLabel)/iu.test(
    source,
  );
}

function hasIdempotencyCheck(source: string): boolean {
  return /(PurchaseId|purchaseId|processedReceipts|grantHistory|alreadyGranted|UpdateAsync\s*\(|receiptInfo\.PurchaseId)/u.test(
    source,
  );
}

function countDistinctIssueTargets(issues: MarketplaceIssue[]): number {
  return new Set(issues.map((issue) => `${issue.rule}:${issue.script_path}`)).size;
}

export async function runMarketplaceComplianceAudit(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<MarketplaceComplianceResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = await client.getDataModel();
  const openCloudClient =
    input.api_key && input.universe_id ? new OpenCloudClient(input.api_key) : undefined;
  const result = await analyzeMarketplaceCompliance(root, {
    checkReceiptHandling: input.check_receipt_handling,
    checkProductReferences: input.check_product_references,
    checkFailoverUx: input.check_failover_ux,
    ...(openCloudClient ? { openCloudClient } : {}),
  });
  return createResponseEnvelope(result, {
    source: sourceInfo({
      studio_port: input.studio_port,
      ...(input.universe_id ? { universe_id: input.universe_id } : {}),
    }),
    warnings: openCloudClient ? [] : ["Open Cloud marketplace cross-reference skipped."],
  });
}

registerTool({
  name: "rbx_marketplace_compliance_audit",
  description:
    "Audit Roblox marketplace purchase flows, receipt handling, and product reference hygiene.",
  schema,
  handler: runMarketplaceComplianceAudit,
});

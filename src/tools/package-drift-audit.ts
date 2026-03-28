import { z } from "zod";
import { StudioBridgeClient } from "../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../shared.js";
import { registerTool } from "./registry.js";

interface PackageRecord {
  path: string;
  package_id: string;
  version_number: number | null;
  auto_update: boolean | null;
  parent_name?: string;
  parent_class?: string;
}

interface PackageIssue {
  severity: "low" | "medium" | "high";
  rule: string;
  message: string;
  element_path: string;
  suggestion: string;
}

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
});

registerTool({
  name: "rbx_package_drift_audit",
  description: "Detect package version drift and disabled auto-update settings.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const raw = (await client.getPackageInfo()) as {
      packages?: Array<{
        path?: string;
        package_id?: string;
        version_number?: number;
        auto_update?: boolean;
        parent_name?: string;
        parent_class?: string;
      }>;
    };
    const packages: PackageRecord[] = [];
    const issues: PackageIssue[] = [];
    const groups = new Map<string, PackageRecord[]>();

    for (const entry of raw.packages ?? []) {
      if (typeof entry.path !== "string" || typeof entry.package_id !== "string") {
        continue;
      }
      const record: PackageRecord = {
        path: entry.path,
        package_id: entry.package_id,
        version_number: typeof entry.version_number === "number" ? entry.version_number : null,
        auto_update: typeof entry.auto_update === "boolean" ? entry.auto_update : null,
        ...(typeof entry.parent_name === "string" ? { parent_name: entry.parent_name } : {}),
        ...(typeof entry.parent_class === "string" ? { parent_class: entry.parent_class } : {}),
      };
      packages.push(record);
      const group = groups.get(record.package_id) ?? [];
      group.push(record);
      groups.set(record.package_id, group);
    }

    for (const record of packages) {
      if (record.auto_update === false) {
        issues.push({
          severity: "medium",
          rule: "auto_update_disabled",
          message: `Package ${record.package_id} is not configured for auto-update.`,
          element_path: record.path,
          suggestion: "Enable auto-update or document the fork strategy.",
        });
      }
    }

    for (const [packageId, records] of groups.entries()) {
      const versions = new Set(
        records.map((record) => record.version_number).filter((v): v is number => v !== null),
      );
      if (versions.size > 1) {
        issues.push({
          severity: "high",
          rule: "version_drift",
          message: `Package ${packageId} appears in multiple versions.`,
          element_path: packageId,
          suggestion: "Align all linked instances to the same package version.",
        });
      }
      for (const record of records) {
        if (record.version_number === null || record.version_number <= 0) {
          issues.push({
            severity: "medium",
            rule: "stale_package",
            message: `Package ${packageId} at ${record.path} has no valid version metadata.`,
            element_path: record.path,
            suggestion: "Refresh the package link in Studio.",
          });
        }
      }
    }

    const score = Math.max(0, 100 - issues.length * 12);
    return createResponseEnvelope(
      {
        packages,
        issues,
        score,
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo, traverseInstances } from "../../../../shared.js";
import type { InstanceNode, RobloxPropertyValue } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
});

interface WeaponConfigSanityIssue {
  severity: "low" | "medium" | "high";
  rule:
    | "damage_extreme"
    | "fire_rate_extreme"
    | "dps_extreme"
    | "range_extreme"
    | "magazine_extreme"
    | "headshot_multiplier_extreme";
  message: string;
  weapon_path: string;
}

interface WeaponStats {
  path: string;
  name: string;
  damage: number | null;
  fire_rate: number | null;
  dps: number | null;
  range: number | null;
  magazine_size: number | null;
  headshot_multiplier: number | null;
}

interface WeaponConfigSanityResult {
  score: number;
  issues: WeaponConfigSanityIssue[];
  weapons: WeaponStats[];
}

const numericConfigNames = new Set([
  "Damage",
  "FireRate",
  "Range",
  "MagazineSize",
  "HeadshotMultiplier",
]);

function getNumericValue(value: RobloxPropertyValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function getChildNumberValue(node: InstanceNode, childName: string): number | null {
  const numericClasses = new Set(["NumberValue", "IntValue"]);
  // Search direct children first
  const directChild = node.children.find(
    (candidate) => numericClasses.has(candidate.className) && candidate.name === childName,
  );
  if (directChild) {
    return getNumericValue(directChild.properties?.["Value"]);
  }
  // Also search inside Configuration child folders
  for (const child of node.children) {
    if (child.className === "Configuration") {
      const nested = child.children.find(
        (candidate) => numericClasses.has(candidate.className) && candidate.name === childName,
      );
      if (nested) {
        return getNumericValue(nested.properties?.["Value"]);
      }
    }
  }
  return null;
}

export async function runWeaponConfigSanity(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<WeaponConfigSanityResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();
  const root = (await client.getChildren("game", 10)) as InstanceNode;

  const issues: WeaponConfigSanityIssue[] = [];
  const weapons: WeaponStats[] = [];

  traverseInstances(root, (node, currentPath) => {
    if (node.className !== "Tool") {
      return;
    }

    const numericClasses = new Set(["NumberValue", "IntValue"]);
    const hasConfigChild =
      node.children.some(
        (child) => numericClasses.has(child.className) && numericConfigNames.has(child.name),
      ) ||
      node.children.some(
        (child) =>
          child.className === "Configuration" &&
          child.children.some(
            (nested) => numericClasses.has(nested.className) && numericConfigNames.has(nested.name),
          ),
      );
    if (!hasConfigChild) {
      return;
    }

    const damage = getChildNumberValue(node, "Damage");
    const fireRate = getChildNumberValue(node, "FireRate");
    const range = getChildNumberValue(node, "Range");
    const magazineSize = getChildNumberValue(node, "MagazineSize");
    const headshotMultiplier = getChildNumberValue(node, "HeadshotMultiplier");
    const dps =
      damage !== null && fireRate !== null ? Number((damage * fireRate).toFixed(2)) : null;

    weapons.push({
      path: currentPath,
      name: node.name,
      damage,
      fire_rate: fireRate,
      dps,
      range,
      magazine_size: magazineSize,
      headshot_multiplier: headshotMultiplier,
    });

    if (damage !== null && damage > 150) {
      issues.push({
        severity: "high",
        rule: "damage_extreme",
        message: `${currentPath} has Damage ${damage}, which is above the 150 threshold.`,
        weapon_path: currentPath,
      });
    }
    if (fireRate !== null && fireRate > 20) {
      issues.push({
        severity: "high",
        rule: "fire_rate_extreme",
        message: `${currentPath} has FireRate ${fireRate}, which is above the 20 threshold.`,
        weapon_path: currentPath,
      });
    }
    if (dps !== null && dps > 1000) {
      issues.push({
        severity: "high",
        rule: "dps_extreme",
        message: `${currentPath} has DPS ${dps}, which is above the 1000 threshold. Note: FireRate interpretation varies — it may represent a cooldown, RPM, or shots-per-second depending on your weapon system.`,
        weapon_path: currentPath,
      });
    }
    if (range !== null && range > 2000) {
      issues.push({
        severity: "medium",
        rule: "range_extreme",
        message: `${currentPath} has Range ${range}, which is above the 2000 threshold.`,
        weapon_path: currentPath,
      });
    }
    if (magazineSize !== null && magazineSize > 100) {
      issues.push({
        severity: "medium",
        rule: "magazine_extreme",
        message: `${currentPath} has MagazineSize ${magazineSize}, which is above the 100 threshold.`,
        weapon_path: currentPath,
      });
    }
    if (headshotMultiplier !== null && headshotMultiplier > 5) {
      issues.push({
        severity: "low",
        rule: "headshot_multiplier_extreme",
        message: `${currentPath} has HeadshotMultiplier ${headshotMultiplier}, above the 5 threshold.`,
        weapon_path: currentPath,
      });
    }
  });

  return createResponseEnvelope(
    {
      score: Math.max(0, 100 - issues.length * 15),
      issues,
      weapons,
    },
    {
      source: sourceInfo({ studio_port: input.studio_port }),
    },
  );
}

registerTool({
  name: "rbx_shooter_weapon_config_sanity",
  description:
    "Inspect shooter weapon NumberValue configs for extreme damage, fire-rate, DPS, range, magazine, and headshot settings.",
  schema,
  handler: runWeaponConfigSanity,
});

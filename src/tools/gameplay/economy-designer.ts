import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, escapeLuaString, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  currencies: z
    .array(
      z.object({
        name: z.string(),
        starting_amount: z.number().default(0),
        earn_rate_per_minute: z.number().optional(),
        is_premium: z.boolean().default(false),
      }),
    )
    .min(1),
  sinks: z
    .array(
      z.object({
        name: z.string(),
        cost: z.number(),
        currency: z.string(),
        category: z.string().optional(),
      }),
    )
    .optional(),
  session_length_minutes: z.number().default(15),
  studio_port: z.number().int().positive().default(33796),
});

interface EconomyAnalysis {
  balance_score: number;
  inflation_risk: boolean;
  grind_walls: string[];
  time_to_unlock: Record<string, number>;
}

registerTool({
  name: "rbx_economy_designer",
  description:
    "Design and validate game economy: currencies, sinks, sources, reward curves, and monetization touchpoints",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });
    const { currencies, sinks = [], session_length_minutes } = input;

    // --- Economy Analysis ---
    const earnRates: Record<string, number> = {};
    for (const currency of currencies) {
      earnRates[currency.name] = currency.earn_rate_per_minute ?? 0;
    }

    const spendRates: Record<string, number> = {};
    for (const sink of sinks) {
      spendRates[sink.currency] = (spendRates[sink.currency] ?? 0) + sink.cost;
    }

    // Estimate session earnings
    const sessionEarnings: Record<string, number> = {};
    for (const currency of currencies) {
      const rate = currency.earn_rate_per_minute ?? 0;
      sessionEarnings[currency.name] = rate * session_length_minutes;
    }

    // Time to unlock each sink (in minutes)
    const time_to_unlock: Record<string, number> = {};
    for (const sink of sinks) {
      const rate = earnRates[sink.currency] ?? 0;
      if (rate > 0) {
        time_to_unlock[sink.name] = Math.round((sink.cost / rate) * 10) / 10;
      } else {
        time_to_unlock[sink.name] = -1; // Cannot unlock via earning
      }
    }

    // Inflation risk: total earn rate significantly exceeds total spend capacity
    let totalEarnValue = 0;
    let totalSpendValue = 0;
    for (const currency of currencies) {
      if (!currency.is_premium) {
        totalEarnValue += (currency.earn_rate_per_minute ?? 0) * session_length_minutes;
      }
    }
    for (const sink of sinks) {
      const currency = currencies.find((c) => c.name === sink.currency);
      if (currency && !currency.is_premium) {
        totalSpendValue += sink.cost;
      }
    }
    const inflation_risk =
      totalSpendValue > 0 ? totalEarnValue / totalSpendValue > 3 : totalEarnValue > 0;

    // Grind walls: sinks that take more than 2 hours (120 minutes) to unlock
    const grind_walls: string[] = [];
    for (const [sinkName, minutes] of Object.entries(time_to_unlock)) {
      if (minutes > 120 || minutes === -1) {
        grind_walls.push(
          minutes === -1
            ? `${sinkName} (requires premium or alternate source)`
            : `${sinkName} (${minutes} min)`,
        );
      }
    }

    // Balance score: 0-100
    // Penalize inflation risk and grind walls, reward balanced design
    let balance_score = 100;
    if (inflation_risk) balance_score -= 25;
    balance_score -= Math.min(50, grind_walls.length * 15);
    if (sinks.length === 0) balance_score -= 20; // No sinks = no economy loop
    if (currencies.filter((c) => !c.is_premium).length === 0) balance_score -= 15;
    balance_score = Math.max(0, balance_score);

    const analysis: EconomyAnalysis = {
      balance_score,
      inflation_risk,
      grind_walls,
      time_to_unlock,
    };

    // --- Create Economy Config ModuleScript ---
    const currenciesLua = currencies
      .map(
        (c) =>
          `  ["${escapeLuaString(c.name)}"] = { startingAmount = ${c.starting_amount}, earnRatePerMinute = ${c.earn_rate_per_minute ?? 0}, isPremium = ${c.is_premium} }`,
      )
      .join(",\n");

    const sinksLua =
      sinks.length > 0
        ? sinks
            .map(
              (s) =>
                `  { name = "${escapeLuaString(s.name)}", cost = ${s.cost}, currency = "${escapeLuaString(s.currency)}", category = "${escapeLuaString(s.category ?? "General")}" }`,
            )
            .join(",\n")
        : "  -- no sinks defined";

    const configSource = `-- Economy Config (auto-generated)
-- Balance score: ${balance_score}/100
-- Inflation risk: ${inflation_risk}
-- Grind walls: ${grind_walls.length}

local EconomyConfig = {}

EconomyConfig.Currencies = {
${currenciesLua},
}

EconomyConfig.Sinks = {
${sinksLua},
}

EconomyConfig.SessionLengthMinutes = ${session_length_minutes}

-- Analysis snapshot
EconomyConfig.Analysis = {
  balanceScore = ${balance_score},
  inflationRisk = ${inflation_risk},
  grindWalls = { ${grind_walls.map((w) => `"${escapeLuaString(w)}"`).join(", ")} },
}

-- Helper: get starting wallet for a new player
function EconomyConfig.getStartingWallet()
  local wallet = {}
  for name, config in pairs(EconomyConfig.Currencies) do
    wallet[name] = config.startingAmount
  end
  return wallet
end

return EconomyConfig
`;

    await client.createInstance("ServerScriptService", "ModuleScript", "EconomyConfig");
    const configPath = "ServerScriptService.EconomyConfig";
    await client.setScriptSource(configPath, configSource);

    return createResponseEnvelope(
      { analysis, config_path: configPath },
      { source: sourceInfo({ studio_port: input.studio_port }) },
    );
  },
});

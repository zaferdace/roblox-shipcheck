import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { AuditIssue } from "../../shared.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  sample_duration_seconds: z.number().default(10),
  studio_port: z.number().int().positive().default(33796),
});

interface RemoteStat {
  name: string;
  path: string;
  fire_count: number;
  fires_per_second: number;
  is_spam: boolean;
}

interface RemoteBudgetResult {
  remotes_monitored: number;
  total_fires: number;
  spam_remotes: string[];
  issues: AuditIssue[];
  per_remote_stats: RemoteStat[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

registerTool({
  name: "rbx_remote_budget_profiler",
  description:
    "Measure RemoteEvent fire frequency, payload patterns, and detect spam or bandwidth-heavy remotes",
  schema,
  handler: async (input): Promise<ResponseEnvelope<RemoteBudgetResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });

    const monitorScript = `
local remoteStats = {}
local startTime = tick()

local function trackRemote(obj, path)
  local entry = { name = obj.Name, path = path, fire_count = 0 }
  remoteStats[path] = entry

  if obj:IsA("RemoteEvent") then
    obj.OnServerEvent:Connect(function()
      entry.fire_count = entry.fire_count + 1
    end)
  end
  -- RemoteFunctions are not monitored: overwriting OnServerInvoke would break live game handlers
end

local function collectRemotes(root, basePath)
  for _, obj in ipairs(root:GetDescendants()) do
    if obj:IsA("RemoteEvent") then
      local p = basePath .. "." .. obj:GetFullName()
      trackRemote(obj, p)
    end
  end
end

collectRemotes(game, "")
_G.__remoteStats = remoteStats
_G.__remoteStartTime = startTime
local monitoredCount = 0
for _ in pairs(remoteStats) do monitoredCount = monitoredCount + 1 end
return { monitored = monitoredCount }
`;

    await client.executeCode(monitorScript, true);
    await sleep(input.sample_duration_seconds * 1000);

    const collectScript = `
local stats = _G.__remoteStats or {}
local elapsed = tick() - (_G.__remoteStartTime or tick())
local results = {}
for path, entry in pairs(stats) do
  table.insert(results, {
    name = entry.name,
    path = path,
    fire_count = entry.fire_count,
    elapsed = elapsed,
  })
end
return { results = results, elapsed = elapsed }
`;

    const raw = (await client.executeCode(collectScript, true)) as {
      results?: Array<{ name: string; path: string; fire_count: number; elapsed: number }>;
      elapsed?: number;
    };

    const elapsed =
      typeof raw.elapsed === "number" && raw.elapsed > 0
        ? raw.elapsed
        : input.sample_duration_seconds;

    const entries = Array.isArray(raw.results) ? raw.results : [];
    const perRemoteStats: RemoteStat[] = entries.map((e) => {
      const fps = e.fire_count / elapsed;
      return {
        name: e.name,
        path: e.path,
        fire_count: e.fire_count,
        fires_per_second: Math.round(fps * 100) / 100,
        is_spam: fps > 10,
      };
    });

    const spamRemotes = perRemoteStats.filter((r) => r.is_spam).map((r) => r.name);
    const totalFires = perRemoteStats.reduce((sum, r) => sum + r.fire_count, 0);
    const issues: AuditIssue[] = [];

    for (const remote of perRemoteStats) {
      if (remote.is_spam) {
        issues.push({
          severity: "high",
          element_path: remote.path,
          rule: "remote_spam",
          message: `RemoteEvent "${remote.name}" fires ${remote.fires_per_second}/sec, exceeding the 10/sec spam threshold.`,
          suggestion: "Throttle this remote or batch its payloads to reduce bandwidth usage.",
        });
      } else if (remote.fires_per_second > 5) {
        issues.push({
          severity: "medium",
          element_path: remote.path,
          rule: "remote_high_frequency",
          message: `RemoteEvent "${remote.name}" fires ${remote.fires_per_second}/sec, which is elevated.`,
          suggestion: "Consider whether this frequency is necessary or can be reduced.",
        });
      }
    }

    return createResponseEnvelope(
      {
        remotes_monitored: perRemoteStats.length,
        total_fires: totalFires,
        spam_remotes: spamRemotes,
        issues,
        per_remote_stats: perRemoteStats.sort((a, b) => b.fires_per_second - a.fires_per_second),
      },
      {
        source: sourceInfo({ studio_port: input.studio_port }),
      },
    );
  },
});

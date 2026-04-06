import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import type { ResponseEnvelope } from "../../types/tools.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  duration_seconds: z.number().default(30),
  capture_remotes: z.boolean().default(true),
  capture_errors: z.boolean().default(true),
  studio_port: z.number().int().positive().default(33796),
});

interface TraceEvent {
  timestamp: number;
  type: "error" | "death" | "remote_fire" | "state_change";
  label: string;
  detail?: string;
}

interface SessionTraceResult {
  duration: number;
  events: TraceEvent[];
  error_count: number;
  remote_fires: number;
  deaths: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

registerTool({
  name: "rbx_telemetry_session_trace",
  description:
    "Capture a playtest timeline of key events: script errors, player deaths, and RemoteEvent fires",
  schema,
  handler: async (input): Promise<ResponseEnvelope<SessionTraceResult>> => {
    const client = new StudioBridgeClient({ port: input.studio_port });

    await client.startPlaytest("play");

    const collectorScript = `
local traceData = {
  events = {},
  error_count = 0,
  remote_fires = 0,
  deaths = 0,
  start_time = tick(),
}

-- Hook into LogService for errors
${
  input.capture_errors
    ? `
local LogService = game:GetService("LogService")
LogService.MessageOut:Connect(function(message, messageType)
  if messageType == Enum.MessageType.MessageError then
    traceData.error_count = traceData.error_count + 1
    table.insert(traceData.events, {
      timestamp = tick() - traceData.start_time,
      type = "error",
      label = "Script Error",
      detail = string.sub(message, 1, 200),
    })
  end
end)
`
    : ""
}

-- Monitor player deaths
local Players = game:GetService("Players")
local function hookPlayer(player)
  player.CharacterAdded:Connect(function(character)
    local humanoid = character:WaitForChild("Humanoid", 5)
    if humanoid then
      humanoid.Died:Connect(function()
        traceData.deaths = traceData.deaths + 1
        table.insert(traceData.events, {
          timestamp = tick() - traceData.start_time,
          type = "death",
          label = "Player Died",
          detail = player.Name,
        })
      end)
    end
  end)
end
for _, player in ipairs(Players:GetPlayers()) do
  hookPlayer(player)
end
Players.PlayerAdded:Connect(hookPlayer)

-- Track RemoteEvent fires
${
  input.capture_remotes
    ? `
local function hookRemotes(container)
  for _, obj in ipairs(container:GetDescendants()) do
    if obj:IsA("RemoteEvent") then
      obj.OnServerEvent:Connect(function()
        traceData.remote_fires = traceData.remote_fires + 1
        table.insert(traceData.events, {
          timestamp = tick() - traceData.start_time,
          type = "remote_fire",
          label = obj.Name,
        })
      end)
    end
  end
end
hookRemotes(game)
`
    : ""
}

-- Store trace globally for retrieval
_G.__sessionTrace = traceData
return { ok = true }
`;

    await client.executeCode(collectorScript, true);
    await sleep(input.duration_seconds * 1000);

    const retrievalScript = `
local data = _G.__sessionTrace
if not data then
  return { events = {}, error_count = 0, remote_fires = 0, deaths = 0 }
end
return {
  events = data.events,
  error_count = data.error_count,
  remote_fires = data.remote_fires,
  deaths = data.deaths,
}
`;

    const raw = (await client.executeCode(retrievalScript, true)) as {
      events?: TraceEvent[];
      error_count?: number;
      remote_fires?: number;
      deaths?: number;
    };

    const events = Array.isArray(raw.events) ? (raw.events as TraceEvent[]) : [];
    const result: SessionTraceResult = {
      duration: input.duration_seconds,
      events,
      error_count: typeof raw.error_count === "number" ? raw.error_count : 0,
      remote_fires: typeof raw.remote_fires === "number" ? raw.remote_fires : 0,
      deaths: typeof raw.deaths === "number" ? raw.deaths : 0,
    };

    return createResponseEnvelope(result, {
      source: sourceInfo({ studio_port: input.studio_port }),
    });
  },
});

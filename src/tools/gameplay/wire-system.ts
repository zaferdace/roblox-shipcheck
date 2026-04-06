import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  system_path: z.string().describe("DataModel path to the system ModuleScript"),
  wire_ui: z.boolean().default(true),
  wire_remotes: z.boolean().default(true),
  wire_datastore: z.boolean().default(true),
  studio_port: z.number().int().positive().default(33796),
});

registerTool({
  name: "rbx_wire_system_dependencies",
  description:
    "Scaffold RemoteEvents, UI, and DataStore templates for a gameplay system — creates the infrastructure for manual wiring",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port });

    const pathParts = input.system_path.split(".");
    const systemName = pathParts[pathParts.length - 1] ?? "System";

    const wired: { remotes: string[]; ui: string[]; datastore: string[] } = {
      remotes: [],
      ui: [],
      datastore: [],
    };

    let scriptSource = "";
    try {
      const sourceResult = await client.getScriptSource(input.system_path);
      scriptSource = sourceResult.source;
    } catch {
      // proceed without source analysis
    }

    // Infer event names from source patterns
    const inferredEvents: string[] = [];
    const eventPatterns = [
      /function\s+\w+:([\w]+)\s*\(/g,
      /RemoteEvent\s*--\s*([\w]+)/g,
    ];
    for (const pattern of eventPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(scriptSource)) !== null) {
        if (match[1]) inferredEvents.push(match[1]);
      }
    }
    const remoteNames =
      inferredEvents.length > 0
        ? inferredEvents.slice(0, 6).map((n) => `${systemName}_${n}`)
        : [`${systemName}Request`, `${systemName}Response`, `${systemName}Update`];

    if (input.wire_remotes) {
      // Ensure RemoteEvents folder exists
      try {
        await client.createInstance("ReplicatedStorage", "Folder", `${systemName}Remotes`);
      } catch {
        // folder may already exist
      }
      const folderPath = `ReplicatedStorage.${systemName}Remotes`;
      for (const remoteName of remoteNames) {
        try {
          await client.createInstance(folderPath, "RemoteEvent", remoteName);
          wired.remotes.push(`${folderPath}.${remoteName}`);
        } catch {
          // remote may already exist
        }
      }

      // Also create a RemoteFunction for request/response patterns
      try {
        await client.createInstance(folderPath, "RemoteFunction", `${systemName}Invoke`);
        wired.remotes.push(`${folderPath}.${systemName}Invoke`);
      } catch {
        // may already exist
      }
    }

    if (input.wire_ui) {
      try {
        await client.createInstance("StarterGui", "ScreenGui", `${systemName}Gui`);
        const guiPath = `StarterGui.${systemName}Gui`;

        await client.createInstance(guiPath, "Frame", `${systemName}Frame`);
        const framePath = `${guiPath}.${systemName}Frame`;

        await client.setInstanceProperty(framePath, "Size", {
          X: { Scale: 0.4, Offset: 0 },
          Y: { Scale: 0.6, Offset: 0 },
        });
        await client.setInstanceProperty(framePath, "Position", {
          X: { Scale: 0.3, Offset: 0 },
          Y: { Scale: 0.2, Offset: 0 },
        });
        await client.setInstanceProperty(framePath, "BackgroundColor3", [0.1, 0.1, 0.15]);

        await client.createInstance(framePath, "TextLabel", "Title");
        const titlePath = `${framePath}.Title`;
        await client.setInstanceProperty(titlePath, "Text", systemName);
        await client.setInstanceProperty(titlePath, "Size", {
          X: { Scale: 1, Offset: 0 },
          Y: { Scale: 0.1, Offset: 0 },
        });

        wired.ui.push(guiPath);
        wired.ui.push(framePath);
      } catch {
        // UI creation may partially fail
      }
    }

    if (input.wire_datastore) {
      const dsScriptName = `${systemName}DataStore`;
      try {
        await client.createInstance("ServerScriptService", "Script", dsScriptName);
        const dsPath = `ServerScriptService.${dsScriptName}`;

        const dsSource = `-- DataStore handler for ${systemName}
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local STORE_KEY = "${systemName}Data_v1"
local store = DataStoreService:GetDataStore(STORE_KEY)

local function loadData(player)
  local key = "player_" .. player.UserId
  local success, data = pcall(function()
    return store:GetAsync(key)
  end)
  if success then
    return data or {}
  end
  return {}
end

local function saveData(player, data)
  local key = "player_" .. player.UserId
  local success, err = pcall(function()
    store:SetAsync(key, data)
  end)
  if not success then
    warn("[${systemName}DataStore] Save failed for", player.Name, err)
  end
end

Players.PlayerAdded:Connect(function(player)
  local data = loadData(player)
  -- TODO: apply data to ${systemName} system for this player
  _ = data
end)

Players.PlayerRemoving:Connect(function(player)
  -- TODO: retrieve data from ${systemName} system for this player
  local data = {}
  saveData(player, data)
end)
`;

        await client.setScriptSource(dsPath, dsSource);
        wired.datastore.push(dsPath);
      } catch {
        // script creation may fail
      }
    }

    return createResponseEnvelope(
      { wired },
      { source: sourceInfo({ studio_port: input.studio_port }) },
    );
  },
});

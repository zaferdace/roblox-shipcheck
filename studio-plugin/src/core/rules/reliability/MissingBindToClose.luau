--!strict
-- Flags DataStore saving with no BindToClose handler (last-players data loss).
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "missing-bindtoclose",
	title = "No BindToClose to flush data on shutdown",
	category = "reliability",
	kind = "source",
	severity = "high",
	description = "Saving DataStore data without BindToClose risks losing the last players' data on shutdown.",
	docs = "https://create.roblox.com/docs/reference/engine/classes/DataModel",
	defaultEnabled = true,
	tags = { "datastore", "data-loss" },
}

local SAVE_CALLS = { "SetAsync", "UpdateAsync", "IncrementAsync" }

function Rule.run(ctx)
	local savesData = false
	local hasBindToClose = false
	local samplePath: string? = nil

	for _, scriptRec in ctx.inventory.scripts do
		if not scriptRec.isServer then
			continue
		end
		local source = Source.strip(scriptRec.source)
		if Source.has(source, "BindToClose") then
			hasBindToClose = true
		end
		for _, call in SAVE_CALLS do
			if Source.hasMethodCall(source, call) then
				savesData = true
				if samplePath == nil then
					samplePath = scriptRec.path
				end
				break
			end
		end
	end

	if savesData and not hasBindToClose then
		return {
			{
				title = "DataStore saving without game:BindToClose",
				detail = "Player data is written to DataStores but no BindToClose handler was found, so data for players still in the server at shutdown can be lost.",
				fix = "Add game:BindToClose(function() ... end) to save all players' data before the server closes (the engine waits up to 30s).",
				path = samplePath,
			},
		}
	end

	return {}
end

return Rule

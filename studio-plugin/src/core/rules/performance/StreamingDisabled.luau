--!strict
-- Flags a large place that ships with instance streaming disabled.
local Rule = {
	id = "streaming-disabled",
	title = "Instance streaming disabled on a large place",
	category = "performance",
	kind = "property",
	severity = "high",
	description = "StreamingEnabled off on a large place inflates client memory and join time.",
	docs = "https://create.roblox.com/docs/workspace/streaming",
	defaultEnabled = true,
	tags = { "streaming", "memory" },
}

local WARN_PARTS = 1000
local SEVERE_PARTS = 5000

function Rule.run(ctx)
	if ctx.inventory.services.workspace.streamingEnabled ~= false then
		return {}
	end
	local partCount = #ctx.inventory.parts
	if partCount < WARN_PARTS then
		return {}
	end
	return {
		{
			severity = if partCount >= SEVERE_PARTS then "high" else "medium",
			title = ("StreamingEnabled is off with %d parts"):format(partCount),
			detail = "With streaming disabled the whole map is always loaded on every client, raising memory use and join time, especially on mobile.",
			fix = "Enable Workspace.StreamingEnabled, then audit LocalScripts for WaitForChild on instances that may stream in late.",
			path = "Workspace",
			evidence = { value = partCount, threshold = WARN_PARTS },
		},
	}
end

return Rule

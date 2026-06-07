--!strict
-- Flags server scripts that call DataStore APIs with insufficient pcall protection,
-- the single most common cause of silent save-data loss on Roblox. Two tiers:
--   * NO pcall at all alongside DataStore calls -> blocker
--   * fewer pcalls than DataStore calls (likely some unprotected) -> high
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "datastore-no-pcall",
	title = "DataStore calls without pcall",
	category = "reliability",
	kind = "source",
	severity = "blocker",
	description = "DataStore calls not wrapped in pcall throw on transient failures and can wipe player data.",
	docs = "https://create.roblox.com/docs/cloud-services/data-stores/error-codes-and-limits",
	defaultEnabled = true,
	tags = { "datastore", "data-loss" },
}

local DATASTORE_CALLS = { "GetAsync", "SetAsync", "UpdateAsync", "IncrementAsync", "RemoveAsync" }

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		if not scriptRec.isServer then
			continue
		end

		local source = Source.strip(scriptRec.source)
		local dsCount = 0
		local firstPos: number? = nil
		for _, call in DATASTORE_CALLS do
			dsCount += Source.count(source, ":%s*" .. call .. "%s*%(")
			local pos = Source.findMethodCall(source, call)
			if pos and (firstPos == nil or pos < firstPos) then
				firstPos = pos
			end
		end

		if dsCount > 0 then
			local pcalls = Source.count(source, "[^%w_]pcall%s*%(")
				+ Source.count(source, "[^%w_]xpcall%s*%(")
			local line = if firstPos then Source.lineOf(scriptRec.source, firstPos) else nil

			if pcalls == 0 then
				table.insert(findings, {
					severity = "blocker",
					title = ("'%s' calls DataStore APIs with no pcall"):format(scriptRec.name),
					detail = "A DataStore request that errors (throttling, outage, bad key) will propagate and can corrupt or wipe saves if unhandled.",
					fix = "Wrap every DataStore call in pcall and handle failure: retry with backoff, and never overwrite good data with a default after a failed read.",
					path = scriptRec.path,
					evidence = { line = line, count = dsCount },
				})
			elseif pcalls < dsCount then
				table.insert(findings, {
					severity = "high",
					title = ("'%s' has DataStore calls that may be unprotected"):format(
						scriptRec.name
					),
					detail = ("Found %d DataStore call(s) but only %d pcall/xpcall guard(s); some calls are likely unprotected."):format(
						dsCount,
						pcalls
					),
					fix = "Ensure EVERY DataStore call is inside its own pcall; review each GetAsync/SetAsync/UpdateAsync.",
					path = scriptRec.path,
					evidence = { line = line, count = dsCount },
				})
			end
		end
	end

	return findings
end

return Rule

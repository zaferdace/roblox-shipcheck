--!strict
-- Flags client scripts that call AnalyticsService Log*Event methods. These calls
-- do not fire in published Roblox places from LocalScripts and are silently ignored,
-- making the instrumentation useless.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "analytics-from-client",
	title = "AnalyticsService Log*Event called from a client script",
	category = "analytics",
	kind = "source",
	severity = "low",
	description = "AnalyticsService Log*Event calls in LocalScripts are silently ignored in published places; move them to server Scripts.",
	docs = "https://create.roblox.com/docs/production/analytics/analytics-dashboard",
	defaultEnabled = true,
	tags = { "analytics", "client" },
}

local LOG_EVENTS = {
	"LogOnboardingFunnelStepEvent",
	"LogEconomyEvent",
	"LogProgressionEvent",
	"LogCustomEvent",
}

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		if not scriptRec.isClient then
			continue
		end

		local stripped = Source.strip(scriptRec.source)
		local firstEvent: string? = nil
		local firstPos: number? = nil

		for _, event in LOG_EVENTS do
			local pos = Source.findMethodCall(stripped, event)
			if pos and (firstPos == nil or pos < firstPos) then
				firstPos = pos
				firstEvent = event
			end
		end

		if firstEvent ~= nil then
			local line = if firstPos then Source.lineOf(scriptRec.source, firstPos) else nil
			table.insert(findings, {
				title = ("'%s' calls AnalyticsService from a client script"):format(scriptRec.name),
				detail = ("'%s' is a client script that calls :%s. AnalyticsService Log*Event methods are no-ops in LocalScripts running in published places — the events will never be recorded."):format(
					scriptRec.name,
					firstEvent
				),
				fix = "Move analytics calls to a server Script. Fire a RemoteEvent from the client and log from the server if you need client-side triggers.",
				path = scriptRec.path,
				evidence = { line = line },
			})
		end
	end

	return findings
end

return Rule

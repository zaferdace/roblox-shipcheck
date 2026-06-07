--!strict
-- Flags a game that ships with zero analytics instrumentation: no AnalyticsService
-- references and no Log*Event calls anywhere in the codebase. Emits one advisory
-- finding (no path) so developers know analytics telemetry is absent.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "no-analytics-events",
	title = "No analytics instrumentation found",
	category = "analytics",
	kind = "source",
	severity = "low",
	description = "The game ships with no AnalyticsService usage or Log*Event calls, so player behaviour is invisible after launch.",
	docs = "https://create.roblox.com/docs/production/analytics/analytics-dashboard",
	defaultEnabled = true,
	tags = { "analytics", "observability" },
}

local LOG_EVENTS = {
	"LogOnboardingFunnelStepEvent",
	"LogEconomyEvent",
	"LogProgressionEvent",
	"LogCustomEvent",
}

function Rule.run(ctx)
	for _, scriptRec in ctx.inventory.scripts do
		local withStrings = Source.stripComments(scriptRec.source)
		if Source.usesService(withStrings, "AnalyticsService") then
			return {}
		end
		local stripped = Source.strip(scriptRec.source)
		for _, event in LOG_EVENTS do
			if Source.hasMethodCall(stripped, event) then
				return {}
			end
		end
	end

	return {
		{
			title = "No analytics instrumentation found",
			detail = "No script references AnalyticsService or calls any Log*Event method. Without analytics you cannot measure retention, economy balance, or progression drop-offs after launch.",
			fix = "Instrument key moments with AnalyticsService:LogProgressionEvent, LogEconomyEvent, or LogCustomEvent from a server Script.",
			evidence = { count = 0 },
		},
	}
end

return Rule

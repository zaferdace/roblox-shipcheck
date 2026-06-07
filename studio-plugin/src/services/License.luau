--!strict
-- Free-vs-pro feature gating. Derived from the build-time Config.edition constant.
-- Designed so a future hosted-entitlement check can replace `isPro()` without
-- touching callers.
local Config = require(script.Parent.Parent.Config)

local License = {}

function License.isPro(): boolean
	return Config.edition == "pro"
end

function License.limits()
	if License.isPro() then
		return {
			maxFindings = math.huge,
			minSeverity = "low",
			allowExport = true,
			allowSuppressions = true,
			allowBaseline = true,
		}
	end
	return Config.free
end

return License

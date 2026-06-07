--!strict
-- Registry: requires every rule module and returns them as a flat array.
-- Adding a rule = drop a file in a category folder and require it here.
local performance = script.performance
local reliability = script.reliability

local rules = {
	require(performance.UnanchoredStaticParts),
	require(reliability.DataStoreNoPcall),
}

return rules

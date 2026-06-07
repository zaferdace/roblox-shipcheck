--!nonstrict
-- Aggregates every category's rules into one flat array. Each category folder is a
-- module (its own init.luau) returning that category's rule list. Add a category =
-- create the folder + init.luau and list it here.
local categories = {
	script.performance,
	script.reliability,
	script.security,
	script.monetization,
	script.mobile,
	script.ux_accessibility,
	script.policy,
	script.analytics,
	script.discovery,
}

local rules = {}
for _, category in categories do
	for _, rule in require(category) do
		table.insert(rules, rule)
	end
end

return rules

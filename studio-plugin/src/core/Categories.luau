--!strict
-- The nine audit categories. `id` is the stable key rules tag themselves with;
-- label/description/accent drive the report UI grouping.
local Categories = {}

export type Category = {
	id: string,
	label: string,
	description: string,
	accent: string,
}

Categories.list = {
	{
		id = "security",
		label = "Security & Exploits",
		description = "Remote validation, client-trust leaks, backdoors and secret exposure.",
		accent = "#FF5A5F",
	},
	{
		id = "reliability",
		label = "Reliability & Data",
		description = "DataStore safety, shutdown saves, teleport and error handling.",
		accent = "#1FB6C9",
	},
	{
		id = "monetization",
		label = "Monetization",
		description = "ProcessReceipt correctness, passes/products and reward grants.",
		accent = "#2BD37A",
	},
	{
		id = "performance",
		label = "Performance",
		description = "Geometry budget, streaming, mesh/texture and lighting cost.",
		accent = "#FFB020",
	},
	{
		id = "mobile",
		label = "Mobile & Low-End",
		description = "UI scaling, touch targets and low-end device headroom.",
		accent = "#7C8DA6",
	},
	{
		id = "ux_accessibility",
		label = "UX & Accessibility",
		description = "Readability, contrast, default-place hygiene and feedback.",
		accent = "#1FB6C9",
	},
	{
		id = "policy",
		label = "Policy & Compliance",
		description = "Content maturity, text filtering, off-platform links and gating.",
		accent = "#FF5A5F",
	},
	{
		id = "analytics",
		label = "Analytics",
		description = "Funnel, economy and progression instrumentation.",
		accent = "#2BD37A",
	},
	{
		id = "discovery",
		label = "Discovery & ASO",
		description = "Place settings, debug artifacts and launch hygiene.",
		accent = "#FFB020",
	},
}

Categories.byId = {} :: { [string]: Category }
for _, category in Categories.list do
	Categories.byId[category.id] = category
end

function Categories.exists(id: string): boolean
	return Categories.byId[id] ~= nil
end

return Categories

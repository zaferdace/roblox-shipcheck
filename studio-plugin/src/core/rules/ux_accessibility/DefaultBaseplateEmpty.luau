--!strict
-- Flags places that appear to be unedited Roblox templates: very few instances
-- and a part named "Baseplate" still present. This usually means a developer
-- forgot to build out the place before publishing.
local Rule = {
	id = "default-baseplate-empty",
	title = "Place looks like an unedited template",
	category = "ux_accessibility",
	kind = "property",
	severity = "high",
	description = "Very few instances and a default Baseplate suggest the place was published before any content was added.",
	docs = "https://create.roblox.com/docs/studio/places",
	defaultEnabled = true,
	tags = { "content", "template" },
}

local INSTANCE_THRESHOLD = 50

function Rule.run(ctx)
	if ctx.inventory.totalInstances >= INSTANCE_THRESHOLD then
		return {}
	end

	local hasBaseplate = false
	for _, rec in ctx.inventory.parts do
		if rec.name == "Baseplate" then
			hasBaseplate = true
			break
		end
	end

	if not hasBaseplate then
		return {}
	end

	return {
		{
			title = "Place looks like an unedited template",
			detail = ("Only %d instance(s) found and the default Baseplate is still present. This place may have been published before content was added."):format(
				ctx.inventory.totalInstances
			),
			fix = "Build out the place with actual content, or remove the default Baseplate and add your own terrain/parts before publishing.",
			path = "Workspace.Baseplate",
			evidence = { count = ctx.inventory.totalInstances, threshold = INSTANCE_THRESHOLD },
		},
	}
end

return Rule

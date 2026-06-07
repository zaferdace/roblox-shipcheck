--!strict
-- Flags GuiObjects that use pure pixel sizing (sizeXScale==0 and sizeYScale==0)
-- with large pixel values. These break on small phone screens because they do not
-- scale with the viewport. The threshold of >200px catches menus/panels that are
-- clearly designed for desktop but not phones; tiny decorative elements are ignored.
local Rule = {
	id = "ui-offset-only-layout",
	title = "GUI uses pixel-only sizing (breaks on phones)",
	category = "mobile",
	kind = "property",
	severity = "high",
	description = "GuiObjects sized only in pixels do not scale with the viewport and break on small phone screens.",
	docs = "https://create.roblox.com/docs/ui/size-and-position",
	defaultEnabled = true,
	tags = { "mobile", "ui", "responsive" },
}

local OFFSET_THRESHOLD = 200
local SUBJECTS_CAP = 25
local HIGH_COUNT = 10

function Rule.run(ctx)
	local subjects = {}
	local count = 0

	for _, rec in ctx.inventory.guiObjects do
		local p = rec.props
		local xScale = p.sizeXScale
		local yScale = p.sizeYScale
		local xOffset = p.sizeXOffset
		local yOffset = p.sizeYOffset

		if
			xScale == 0
			and yScale == 0
			and (xOffset ~= nil or yOffset ~= nil)
			and ((xOffset or 0) > OFFSET_THRESHOLD or (yOffset or 0) > OFFSET_THRESHOLD)
		then
			count += 1
			if #subjects < SUBJECTS_CAP then
				table.insert(subjects, { path = rec.path, className = rec.className })
			end
		end
	end

	if count == 0 then
		return {}
	end

	return {
		{
			severity = if count > HIGH_COUNT then "high" else "medium",
			title = ("%d GuiObject(s) use pixel-only sizing"):format(count),
			detail = ("Found %d element(s) whose UDim2 size has Scale=0 on both axes and an Offset >%d px. These do not scale with the viewport and will overflow or be clipped on small phone screens."):format(
				count,
				OFFSET_THRESHOLD
			),
			fix = "Replace pixel-only sizes with UDim2.fromScale(...) or mixed UDim2.new(scale, offset, scale, offset) values. Use a UIAspectRatioConstraint or SizeConstraint to lock proportions.",
			subjects = subjects,
			evidence = { count = count, threshold = OFFSET_THRESHOLD },
		},
	}
end

return Rule

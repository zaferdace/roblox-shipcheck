--!strict
-- Flags interactive GuiObjects (buttons) whose approximate height on a 1280px-tall
-- phone would be under 44px — the minimum touch target recommended by mobile HIG
-- guidelines. Approx height = sizeYScale * 1280 + sizeYOffset.
local Rule = {
	id = "touch-target-too-small",
	title = "Button touch target too small for phones",
	category = "mobile",
	kind = "property",
	severity = "medium",
	description = "Buttons whose approximate height on a 1280px phone is under 44px are hard to tap reliably.",
	docs = "https://create.roblox.com/docs/ui/buttons",
	defaultEnabled = true,
	tags = { "mobile", "ui", "accessibility" },
}

local PHONE_HEIGHT_PX = 1280
local MIN_TOUCH_PX = 44
local SUBJECTS_CAP = 25

function Rule.run(ctx)
	local subjects = {}
	local count = 0

	for _, rec in ctx.inventory.guiObjects do
		local p = rec.props
		if not p.isButton then
			continue
		end

		local approxHeight = (p.sizeYScale or 0) * PHONE_HEIGHT_PX + (p.sizeYOffset or 0)
		if approxHeight > 0 and approxHeight < MIN_TOUCH_PX then
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
			title = ("%d button(s) have a touch target under %dpx"):format(count, MIN_TOUCH_PX),
			detail = ("Found %d interactive element(s) whose approximate height on a %dpx-tall phone is below the %dpx minimum touch target. Small targets cause mis-taps and frustration on mobile."):format(
				count,
				PHONE_HEIGHT_PX,
				MIN_TOUCH_PX
			),
			fix = ("Increase the button height so that sizeYScale*%d + sizeYOffset >= %d. For a scale-only button at minimum size, sizeYScale should be at least %.4f."):format(
				PHONE_HEIGHT_PX,
				MIN_TOUCH_PX,
				MIN_TOUCH_PX / PHONE_HEIGHT_PX
			),
			subjects = subjects,
			evidence = { count = count, threshold = MIN_TOUCH_PX },
		},
	}
end

return Rule

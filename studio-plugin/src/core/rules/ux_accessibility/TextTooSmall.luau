--!strict
-- Flags non-scaled text objects with a TextSize below the readable minimum.
-- TextScaled objects are excluded because Roblox scales them to fit the container.
local Rule = {
	id = "text-too-small",
	title = "Text size below readable minimum (12 px)",
	category = "ux_accessibility",
	kind = "property",
	severity = "medium",
	description = "Fixed TextSize below 12 is hard to read on small screens such as phones.",
	docs = "https://create.roblox.com/docs/ui/text-label",
	defaultEnabled = true,
	tags = { "accessibility", "text", "readability" },
}

local MIN_TEXT_SIZE = 12
local MAX_SUBJECTS = 20

function Rule.run(ctx)
	local subjects = {}

	for _, rec in ctx.inventory.textObjects do
		-- Skip auto-scaled text; Roblox will size it appropriately.
		if rec.props.textScaled == true then
			continue
		end

		local textSize = rec.props.textSize
		if type(textSize) ~= "number" then
			continue
		end

		if textSize < MIN_TEXT_SIZE then
			table.insert(subjects, { path = rec.path, className = rec.className })
		end
	end

	if #subjects == 0 then
		return {}
	end

	local capped = {}
	for i = 1, math.min(#subjects, MAX_SUBJECTS) do
		table.insert(capped, subjects[i])
	end

	return {
		{
			title = ("Text size too small on %d object(s)"):format(#subjects),
			detail = ("Found %d text object(s) with TextSize below %d and TextScaled disabled. On small devices this text may be unreadable."):format(
				#subjects,
				MIN_TEXT_SIZE
			),
			fix = ("Set TextSize to at least %d, or enable TextScaled so Roblox sizes the text to fit its container."):format(
				MIN_TEXT_SIZE
			),
			subjects = capped,
			evidence = { count = #subjects, threshold = MIN_TEXT_SIZE },
		},
	}
end

return Rule

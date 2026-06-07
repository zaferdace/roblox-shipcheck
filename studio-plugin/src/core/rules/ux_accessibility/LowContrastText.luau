--!strict
-- Flags text objects whose foreground/background contrast ratio is below the
-- WCAG AA threshold of 4.5 (applies only when the background is opaque enough
-- to be meaningful, i.e. bgTransparency < 0.5).
local Contrast = require(script.Parent.Parent.Parent.util.Contrast)

local Rule = {
	id = "low-contrast-text",
	title = "Text contrast below WCAG AA (4.5:1)",
	category = "ux_accessibility",
	kind = "property",
	severity = "medium",
	description = "Text whose foreground/background contrast is below 4.5:1 is hard to read for players with low vision.",
	docs = "https://create.roblox.com/docs/ui/text-label",
	defaultEnabled = true,
	tags = { "accessibility", "text", "contrast" },
}

local WCAG_AA = 4.5
local MAX_SUBJECTS = 20

local function round(n: number, places: number): number
	local factor = 10 ^ places
	return math.floor(n * factor + 0.5) / factor
end

function Rule.run(ctx)
	local subjects = {}

	for _, rec in ctx.inventory.textObjects do
		local textColor = rec.props.textColorHex
		local bgColor = rec.props.bgColorHex
		if type(textColor) ~= "string" or type(bgColor) ~= "string" then
			continue
		end

		local bgTransparency = rec.props.bgTransparency
		if type(bgTransparency) == "number" and bgTransparency >= 0.5 then
			continue
		end

		local ratio = Contrast.contrastRatio(textColor, bgColor)
		if ratio < WCAG_AA then
			table.insert(subjects, {
				path = rec.path,
				className = rec.className,
				_ratio = ratio,
			})
		end
	end

	if #subjects == 0 then
		return {}
	end

	-- Cap reported subjects to avoid overwhelming the panel.
	local capped = {}
	for i = 1, math.min(#subjects, MAX_SUBJECTS) do
		table.insert(capped, { path = subjects[i].path, className = subjects[i].className })
	end

	-- Use the worst (lowest) ratio for evidence.
	local worstRatio = math.huge
	for _, s in subjects do
		if s._ratio < worstRatio then
			worstRatio = s._ratio
		end
	end

	return {
		{
			title = ("Low-contrast text on %d object(s)"):format(#subjects),
			detail = ("Found %d text object(s) with a foreground-to-background contrast ratio below %.1f:1 (WCAG AA). Low contrast text is hard to read for players with vision impairments."):format(
				#subjects,
				WCAG_AA
			),
			fix = "Increase the contrast between TextColor3 and BackgroundColor3 to at least 4.5:1. Use a WCAG contrast checker to verify.",
			subjects = capped,
			evidence = { value = round(worstRatio, 2), threshold = WCAG_AA },
		},
	}
end

return Rule

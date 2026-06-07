--!strict
-- Flags large unanchored parts that look like static map geometry, which the
-- physics solver simulates every step for no reason.
local Rule = {
	id = "unanchored-static-parts",
	title = "Unanchored static parts",
	category = "performance",
	kind = "property",
	severity = "high",
	description = "Static map geometry left unanchored is simulated by the physics solver every frame.",
	docs = "https://create.roblox.com/docs/performance-optimization/improve",
	defaultEnabled = true,
	tags = { "physics", "geometry" },
	autoFixable = true,
}

-- Longest-axis size (studs) above which an unanchored part looks like static
-- geometry rather than a deliberately dynamic prop.
local STATIC_SIZE_THRESHOLD = 8
local MAX_SUBJECTS = 25

function Rule.run(ctx)
	local threshold = ctx.config["unanchored-static-parts.size"] or STATIC_SIZE_THRESHOLD
	local subjects = {}
	local count = 0

	-- `parts` includes every BasePart (Part / MeshPart / Union / ...).
	for _, part in ctx.inventory.parts do
		local props = part.props
		if props.anchored == false and props.isCharacterPart ~= true then
			local size = props.sizeMagnitude or 0
			if size >= threshold then
				count += 1
				if #subjects < MAX_SUBJECTS then
					table.insert(subjects, { path = part.path, className = part.className })
				end
			end
		end
	end

	if count == 0 then
		return {}
	end

	return {
		{
			severity = if count > 50 then "high" else "medium",
			title = ("%d large unanchored part(s) being physically simulated"):format(count),
			detail = "Unanchored parts are simulated by the physics engine every frame. Static map geometry should be anchored so it costs nothing at runtime.",
			fix = "Select the flagged parts and set Anchored = true; keep only genuinely dynamic objects unanchored.",
			subjects = subjects,
			evidence = { count = count, threshold = threshold },
		},
	}
end

return Rule

--!strict
-- Flags Future lighting with many shadow-casting lights, which is heavy on mobile.
local Rule = {
	id = "lighting-technology-cost",
	title = "Heavy lighting technology for low-end devices",
	category = "performance",
	kind = "property",
	severity = "medium",
	description = "Future lighting with shadow-casting local lights is expensive on mobile / low-end hardware.",
	docs = "https://create.roblox.com/docs/reference/engine/classes/Lighting",
	defaultEnabled = true,
	tags = { "lighting", "mobile" },
}

local MANY_SHADOW_LIGHTS = 15

function Rule.run(ctx)
	if ctx.inventory.services.lighting.technology ~= "Future" then
		return {}
	end
	local shadowLights = 0
	for _, light in ctx.inventory.lights do
		if light.props.shadows == true then
			shadowLights += 1
		end
	end
	return {
		{
			severity = if shadowLights > MANY_SHADOW_LIGHTS then "high" else "medium",
			title = "Future lighting may be heavy on low-end devices",
			detail = ("Lighting.Technology is Future with %d shadow-casting light(s). Future lighting is GPU-heavy and falls back to voxel on low graphics quality anyway."):format(
				shadowLights
			),
			fix = "Use ShadowMap (or Voxel) unless Future visuals are core, and reduce the number of shadow-casting dynamic lights.",
			path = "Lighting",
			evidence = { count = shadowLights },
		},
	}
end

return Rule

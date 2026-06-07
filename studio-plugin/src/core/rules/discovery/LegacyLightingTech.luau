--!strict
-- Flags Lighting.Technology == "Legacy", which is deprecated and produces
-- inconsistent visuals with missing shadows and poor performance.
local Rule = {
	id = "legacy-lighting-tech",
	title = "Lighting technology is set to Legacy",
	category = "discovery",
	kind = "property",
	severity = "high",
	description = "Legacy lighting is deprecated, produces poor shadow quality, and can cause inconsistent visuals across devices.",
	docs = "https://create.roblox.com/docs/environment/lighting",
	defaultEnabled = true,
	tags = { "lighting", "deprecated" },
}

function Rule.run(ctx)
	if ctx.inventory.services.lighting.technology ~= "Legacy" then
		return {}
	end

	return {
		{
			title = "Lighting.Technology is set to Legacy (deprecated)",
			detail = "Legacy lighting is the oldest Roblox rendering pipeline. It lacks proper shadow support, produces flat and inconsistent visuals, and is no longer maintained. Roblox recommends ShadowMap, Voxel, or Future.",
			fix = "Open Lighting in Explorer and change Technology to ShadowMap (balanced), Voxel (stylised/performance), or Future (highest quality). Review your scene for lighting adjustments after switching.",
			path = "Lighting",
			evidence = { value = "Legacy" },
		},
	}
end

return Rule

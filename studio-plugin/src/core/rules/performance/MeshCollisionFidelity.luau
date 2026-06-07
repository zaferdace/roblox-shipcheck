--!strict
-- Flags overuse of PreciseConvexDecomposition mesh collision.
local Rule = {
	id = "mesh-collision-fidelity",
	title = "Expensive mesh collision fidelity",
	category = "performance",
	kind = "property",
	severity = "medium",
	description = "MeshParts using PreciseConvexDecomposition collision are costly where a simpler hull would do.",
	docs = "https://create.roblox.com/docs/reference/engine/classes/MeshPart",
	defaultEnabled = true,
	tags = { "physics", "mesh" },
}

local MAX_SUBJECTS = 25
local WARN_COUNT = 20

function Rule.run(ctx)
	local subjects = {}
	local count = 0
	for _, mesh in ctx.inventory.meshParts do
		local props = mesh.props
		if
			props.collisionFidelity == "PreciseConvexDecomposition"
			and props.canCollide ~= false
		then
			count += 1
			if #subjects < MAX_SUBJECTS then
				table.insert(subjects, { path = mesh.path, className = mesh.className })
			end
		end
	end
	if count < WARN_COUNT then
		return {}
	end
	return {
		{
			severity = if count > 100 then "high" else "medium",
			title = ("%d mesh(es) use PreciseConvexDecomposition collision"):format(count),
			detail = "Precise mesh collision is expensive in memory and physics. Most meshes are fine with Box or Hull collision.",
			fix = "Set CollisionFidelity to Box (small/non-interactive) or Hull (simple shapes); set CanCollide = false on purely decorative meshes.",
			subjects = subjects,
			evidence = { count = count },
		},
	}
end

return Rule

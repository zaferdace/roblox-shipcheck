--!nonstrict
local Streaming = requireSrc("core/rules/performance/StreamingDisabled")
local Lighting = requireSrc("core/rules/performance/LightingTechnologyCost")
local MeshCol = requireSrc("core/rules/performance/MeshCollisionFidelity")
local Context = requireTest("mocks/Context")

describe("rule: streaming-disabled", function()
	it("flags a large place with streaming off", function()
		local ctx = Context.new({ parts = Context.bulkParts(2000) })
		ctx.inventory.services.workspace.streamingEnabled = false
		expect(Streaming.run(ctx)).toHaveLength(1)
	end)

	it("passes when streaming is on", function()
		local ctx = Context.new({ parts = Context.bulkParts(2000) })
		ctx.inventory.services.workspace.streamingEnabled = true
		expect(Streaming.run(ctx)).toHaveLength(0)
	end)

	it("passes a small place even with streaming off", function()
		local ctx = Context.new({ parts = Context.bulkParts(50) })
		ctx.inventory.services.workspace.streamingEnabled = false
		expect(Streaming.run(ctx)).toHaveLength(0)
	end)
end)

describe("rule: lighting-technology-cost", function()
	it("flags Future lighting", function()
		local ctx = Context.new()
		ctx.inventory.services.lighting.technology = "Future"
		expect(Lighting.run(ctx)).toHaveLength(1)
	end)

	it("escalates to high with many shadow lights", function()
		local lights = {}
		for index = 1, 20 do
			lights[index] =
				Context.instance("Workspace.L" .. index, "PointLight", { shadows = true })
		end
		local ctx = Context.new({ lights = lights })
		ctx.inventory.services.lighting.technology = "Future"
		expect(Lighting.run(ctx)[1].severity).toBe("high")
	end)

	it("passes ShadowMap lighting", function()
		local ctx = Context.new()
		ctx.inventory.services.lighting.technology = "ShadowMap"
		expect(Lighting.run(ctx)).toHaveLength(0)
	end)
end)

describe("rule: mesh-collision-fidelity", function()
	local function preciseMeshes(count, canCollide)
		local meshes = {}
		for index = 1, count do
			meshes[index] = Context.instance("Workspace.M" .. index, "MeshPart", {
				collisionFidelity = "PreciseConvexDecomposition",
				canCollide = canCollide,
			})
		end
		return meshes
	end

	it("flags many precise-collision meshes", function()
		expect(MeshCol.run(Context.new({ meshParts = preciseMeshes(25) }))).toHaveLength(1)
	end)

	it("ignores a small number of precise meshes", function()
		expect(MeshCol.run(Context.new({ meshParts = preciseMeshes(5) }))).toHaveLength(0)
	end)

	it("ignores non-colliding decorative meshes", function()
		expect(MeshCol.run(Context.new({ meshParts = preciseMeshes(30, false) }))).toHaveLength(0)
	end)
end)

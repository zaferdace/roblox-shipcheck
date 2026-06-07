--!nonstrict
local Rule = requireSrc("core/rules/performance/UnanchoredStaticParts")
local Context = requireTest("mocks/Context")

describe("rule: unanchored-static-parts", function()
	it("ignores an anchored part", function()
		local ctx = Context.new({
			parts = { Context.part("Workspace.Wall", { anchored = true, sizeMagnitude = 40 }) },
		})
		expect(Rule.run(ctx)).toHaveLength(0)
	end)

	it("ignores a small unanchored prop below the static threshold", function()
		local ctx = Context.new({
			parts = { Context.part("Workspace.Ball", { anchored = false, sizeMagnitude = 2 }) },
		})
		expect(Rule.run(ctx)).toHaveLength(0)
	end)

	it("flags a large unanchored part and reports its path + count", function()
		local ctx = Context.new({
			parts = {
				Context.part("Workspace.Map.Floor", { anchored = false, sizeMagnitude = 60 }),
			},
		})
		local findings = Rule.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].subjects[1].path).toBe("Workspace.Map.Floor")
		expect(findings[1].evidence.count).toBe(1)
		expect(findings[1].severity).toBe("medium")
	end)

	it("escalates to high and caps subjects when many parts are flagged", function()
		local parts = {}
		for index = 1, 60 do
			parts[index] =
				Context.part("Workspace.Rock" .. index, { anchored = false, sizeMagnitude = 20 })
		end
		local findings = Rule.run(Context.new({ parts = parts }))
		expect(findings[1].severity).toBe("high")
		expect(findings[1].evidence.count).toBe(60)
		-- subjects are capped at 25 even though 60 are counted
		expect(findings[1].subjects).toHaveLength(25)
	end)

	it("ignores unanchored character parts", function()
		local ctx = Context.new({
			parts = {
				Context.part(
					"Workspace.NPC.Torso",
					{ anchored = false, sizeMagnitude = 20, isCharacterPart = true }
				),
			},
		})
		expect(Rule.run(ctx)).toHaveLength(0)
	end)

	it("respects a config threshold override", function()
		local ctx = Context.new({
			parts = { Context.part("Workspace.Crate", { anchored = false, sizeMagnitude = 5 }) },
		})
		ctx.config["unanchored-static-parts.size"] = 3
		expect(Rule.run(ctx)).toHaveLength(1)
	end)
end)

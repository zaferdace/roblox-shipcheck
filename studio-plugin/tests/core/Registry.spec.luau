--!nonstrict
local Engine = requireSrc("core/Engine")
local rules = requireSrc("core/rules")
local Context = requireTest("mocks/Context")

describe("rule registry", function()
	it("is well-formed (unique ids, known categories, valid kinds)", function()
		local problems = Engine.validate(rules)
		if #problems > 0 then
			error(table.concat(problems, "; "))
		end
		expect(#problems).toBe(0)
	end)

	it("runs cleanly over an empty project with no rule errors", function()
		local engine = Engine.new(rules)
		local findings, _rulesRun, rulesErrored = engine:run(Context.new())
		expect(type(findings)).toBe("table")
		expect(rulesErrored).toBe(0)
	end)
end)

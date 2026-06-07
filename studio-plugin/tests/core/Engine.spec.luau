--!nonstrict
local Engine = requireSrc("core/Engine")

local function rule(id, findings, opts)
	opts = opts or {}
	return {
		id = id,
		title = id,
		category = opts.category or "performance",
		kind = opts.kind or "property",
		severity = opts.severity or "high",
		description = "",
		defaultEnabled = opts.defaultEnabled ~= false,
		run = opts.run or function()
			return findings
		end,
	}
end

local EMPTY = { inventory = {}, config = {} }

describe("Engine", function()
	it("attaches ruleId, category and exact confidence to property findings", function()
		local engine = Engine.new({ rule("r1", { { title = "t", detail = "d", fix = "f" } }) })
		local findings = engine:run(EMPTY)
		expect(findings).toHaveLength(1)
		expect(findings[1].ruleId).toBe("r1")
		expect(findings[1].category).toBe("performance")
		expect(findings[1].confidence).toBe("exact")
		expect(findings[1].severity).toBe("high")
	end)

	it("normalizes a single `path` into subjects + primaryPath", function()
		local engine = Engine.new({
			rule("r2", { { title = "t", detail = "d", fix = "f", path = "Workspace.X" } }),
		})
		local finding = engine:run(EMPTY)[1]
		expect(finding.primaryPath).toBe("Workspace.X")
		expect(finding.subjects).toHaveLength(1)
		expect(finding.subjects[1].path).toBe("Workspace.X")
	end)

	it("marks source-kind rule findings heuristic", function()
		local engine = Engine.new({
			rule("r3", { { title = "t", detail = "d", fix = "f" } }, { kind = "source" }),
		})
		expect(engine:run(EMPTY)[1].confidence).toBe("heuristic")
	end)

	it("coerces an invalid confidence to heuristic", function()
		local engine = Engine.new({
			rule("r4", { { title = "t", detail = "d", fix = "f", confidence = "bogus" } }),
		})
		expect(engine:run(EMPTY)[1].confidence).toBe("heuristic")
	end)

	it("drops a malformed finding (missing title) and counts it as an error", function()
		local engine = Engine.new({ rule("r5", { { detail = "no title" } }) })
		local findings, _run, errored = engine:run(EMPTY)
		expect(findings).toHaveLength(0)
		expect(errored).toBe(1)
	end)

	it("isolates a throwing rule without aborting the scan", function()
		local bad = rule("bad", {}, {
			run = function()
				error("boom")
			end,
		})
		local good = rule("good", { { title = "t", detail = "d", fix = "f" } })
		local engine = Engine.new({ bad, good })
		local findings, rulesRun, rulesErrored = engine:run(EMPTY)
		expect(findings).toHaveLength(1)
		expect(rulesRun).toBe(2)
		expect(rulesErrored).toBe(1)
	end)

	it("respects a config enable override", function()
		local engine = Engine.new({ rule("r6", { { title = "t", detail = "d", fix = "f" } }) })
		local findings = engine:run({ inventory = {}, config = { ["r6.enabled"] = false } })
		expect(findings).toHaveLength(0)
	end)
end)

describe("Engine.validate", function()
	it("accepts a well-formed registry", function()
		local ok = { rule("a", {}), rule("b", {}) }
		expect(Engine.validate(ok)).toHaveLength(0)
	end)

	it("flags duplicate ids, unknown categories and bad kinds", function()
		local bad = {
			rule("dup", {}),
			rule("dup", {}),
			rule("x", {}, { category = "not-a-category" }),
			rule("y", {}, { kind = "weird" }),
		}
		expect(#Engine.validate(bad)).toBeGreaterThan(2)
	end)
end)

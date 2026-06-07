--!nonstrict
local Scoring = requireSrc("core/Scoring")

describe("Scoring", function()
	it("scores a clean project at 100 / SHIP", function()
		local report = Scoring.build({})
		expect(report.score).toBe(100)
		expect(report.verdict).toBe("SHIP")
	end)

	it("HOLDs on any blocker and deducts 25", function()
		local report = Scoring.build({ { severity = "blocker", ruleId = "r" } })
		expect(report.verdict).toBe("HOLD")
		expect(report.score).toBe(75)
	end)

	it("REVIEWs when a high finding exists even at a good score", function()
		local report = Scoring.build({ { severity = "high", ruleId = "r" } })
		expect(report.verdict).toBe("REVIEW")
		expect(report.score).toBe(88)
	end)

	it("caps a single rule's penalty so it cannot zero the score", function()
		local findings = {}
		for index = 1, 10 do
			findings[index] = { severity = "blocker", ruleId = "same" }
		end
		local report = Scoring.build(findings)
		-- 10 blockers from ONE rule -> capped at 40 -> 60, but still HOLD
		expect(report.score).toBe(60)
		expect(report.verdict).toBe("HOLD")
	end)

	it("does not cap across distinct rules", function()
		local findings = {}
		for index = 1, 5 do
			findings[index] = { severity = "medium", ruleId = "rule" .. index }
		end
		local report = Scoring.build(findings)
		expect(report.score).toBe(75)
		expect(report.verdict).toBe("REVIEW")
	end)

	it("clamps the score at 0", function()
		local findings = {}
		for index = 1, 10 do
			findings[index] = { severity = "blocker", ruleId = "rule" .. index }
		end
		expect(Scoring.build(findings).score).toBe(0)
	end)

	it("counts a summary across severities", function()
		local summary = Scoring.summarize({
			{ severity = "blocker" },
			{ severity = "high" },
			{ severity = "high" },
			{ severity = "low" },
		})
		expect(summary.blocker).toBe(1)
		expect(summary.high).toBe(2)
		expect(summary.low).toBe(1)
		expect(summary.total).toBe(4)
	end)
end)

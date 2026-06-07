--!nonstrict
local ReportExport = requireSrc("core/ReportExport")

local REPORT = {
	verdict = "REVIEW",
	score = 72,
	rulesRun = 30,
	summary = { blocker = 0, high = 1, medium = 2, low = 0, total = 3 },
	findings = {
		{
			ruleId = "streaming-disabled",
			severity = "high",
			confidence = "exact",
			title = "StreamingEnabled is off",
			detail = "Large map with streaming disabled.",
			fix = "Enable Workspace.StreamingEnabled.",
			primaryPath = "Workspace",
		},
	},
}

describe("ReportExport.toMarkdown", function()
	it("includes the verdict and score header", function()
		local md = ReportExport.toMarkdown(REPORT)
		expect(md:find("shipcheck report", 1, true) ~= nil).toBeTruthy()
		expect(md:find("REVIEW", 1, true) ~= nil).toBeTruthy()
		expect(md:find("72/100", 1, true) ~= nil).toBeTruthy()
	end)

	it("renders each finding with path, fix and rule id", function()
		local md = ReportExport.toMarkdown(REPORT)
		expect(md:find("StreamingEnabled is off", 1, true) ~= nil).toBeTruthy()
		expect(md:find("`Workspace`", 1, true) ~= nil).toBeTruthy()
		expect(md:find("Fix: Enable", 1, true) ~= nil).toBeTruthy()
		expect(md:find("`streaming-disabled`", 1, true) ~= nil).toBeTruthy()
	end)

	it("handles an empty report", function()
		local md = ReportExport.toMarkdown({
			verdict = "SHIP",
			score = 100,
			rulesRun = 30,
			summary = { blocker = 0, high = 0, medium = 0, low = 0, total = 0 },
			findings = {},
		})
		expect(md:find("SHIP", 1, true) ~= nil).toBeTruthy()
	end)
end)

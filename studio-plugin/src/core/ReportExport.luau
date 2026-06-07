--!strict
-- Pure report -> Markdown serializer (Pro export). No Roblox APIs, so it is
-- headless-testable; the UI prints the result to the Output window.
local ReportExport = {}

function ReportExport.toMarkdown(report): string
	local lines = {}
	local function add(text: string)
		table.insert(lines, text)
	end

	add(("# shipcheck report — %s (%d/100)"):format(report.verdict, report.score))
	local summary = report.summary
	add("")
	add(
		("**%d blocker · %d high · %d medium · %d low** across %d rules"):format(
			summary.blocker,
			summary.high,
			summary.medium,
			summary.low,
			report.rulesRun or 0
		)
	)

	for _, finding in report.findings do
		add("")
		add(("## [%s] %s"):format(string.upper(finding.severity), finding.title))
		if finding.primaryPath then
			add(("- Path: `%s`"):format(finding.primaryPath))
		end
		if finding.detail and finding.detail ~= "" then
			add(("- %s"):format(finding.detail))
		end
		if finding.fix and finding.fix ~= "" then
			add(("- Fix: %s"):format(finding.fix))
		end
		add(("- Rule: `%s` (%s)"):format(finding.ruleId or "", finding.confidence or ""))
	end

	return table.concat(lines, "\n")
end

return ReportExport

--!strict
-- Renders a Report into the dock widget: a verdict header, summary counts, and a
-- scrollable, severity-sorted list of findings with jump-to-instance + fix guidance.
-- Applies free-tier limits (top-N, min-severity) with an upgrade prompt.
local Palette = require(script.Parent.Palette)
local Components = require(script.Parent.Components)

local ReportView = {}

local SEV_LABEL = { blocker = "BLOCKER", high = "HIGH", medium = "MEDIUM", low = "LOW" }
local SEV_RANK = { blocker = 4, high = 3, medium = 2, low = 1 }

local function destroyContent(container: Instance)
	for _, child in container:GetChildren() do
		if child:IsA("GuiObject") then
			child:Destroy()
		end
	end
end

local function severityAllowed(severity: string, limits): boolean
	local minRank = SEV_RANK[limits.minSeverity] or 1
	return (SEV_RANK[severity] or 0) >= minRank
end

local function findingRow(finding, deps): Frame
	local row = Components.frame({
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = Palette.navy700,
	})
	Components.corner(row, 6)
	Components.pad(row, 10)
	Components.list(row, 5)

	local head = Components.frame({
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundTransparency = 1,
	}, row)
	Components.list(head, 8, Enum.FillDirection.Horizontal)
	Components.label({
		Text = SEV_LABEL[finding.severity] or "?",
		TextColor3 = Palette.severityColor(finding.severity),
		Font = Enum.Font.GothamBold,
		TextSize = 12,
		AutomaticSize = Enum.AutomaticSize.X,
		Size = UDim2.new(0, 0, 0, 16),
	}, head)
	Components.label({
		Text = finding.title,
		Font = Enum.Font.GothamMedium,
		TextSize = 14,
		TextWrapped = true,
		AutomaticSize = Enum.AutomaticSize.Y,
		Size = UDim2.new(1, -80, 0, 0),
	}, head)

	Components.label({
		Text = finding.detail,
		TextColor3 = Palette.slate,
		TextSize = 13,
		TextWrapped = true,
		AutomaticSize = Enum.AutomaticSize.Y,
		Size = UDim2.new(1, 0, 0, 0),
	}, row)

	if finding.fix and finding.fix ~= "" then
		Components.label({
			Text = "Fix: " .. finding.fix,
			TextColor3 = Palette.green,
			TextSize = 13,
			TextWrapped = true,
			AutomaticSize = Enum.AutomaticSize.Y,
			Size = UDim2.new(1, 0, 0, 0),
		}, row)
	end

	local confidenceText = if finding.confidence == "heuristic" then "heuristic" else "exact"
	Components.label({
		Text = ("%s · %s"):format(finding.ruleId or "", confidenceText),
		TextColor3 = Palette.slate,
		TextSize = 11,
		Size = UDim2.new(1, 0, 0, 14),
	}, row)

	if finding.primaryPath then
		Components.button("Select instance", {
			Size = UDim2.new(0, 150, 0, 26),
			BackgroundColor3 = Palette.navy,
			TextSize = 13,
		}, function()
			deps.onJump(finding.primaryPath)
		end, row)
	end

	return row
end

function ReportView.render(container: Instance, report, _refs, deps)
	destroyContent(container)

	local header = Components.frame({
		Size = UDim2.new(1, 0, 0, 60),
		Position = UDim2.new(0, 0, 0, 0),
		BackgroundColor3 = Palette.verdictColor(report.verdict),
	}, container)
	Components.corner(header, 8)
	Components.pad(header, 12)
	Components.label({
		Text = report.verdict,
		Font = Enum.Font.GothamBold,
		TextColor3 = Palette.navy,
		TextSize = 24,
		Size = UDim2.new(0.6, 0, 1, 0),
		TextYAlignment = Enum.TextYAlignment.Center,
	}, header)
	Components.label({
		Text = ("%d/100"):format(report.score),
		Font = Enum.Font.GothamBold,
		TextColor3 = Palette.navy,
		TextSize = 24,
		TextXAlignment = Enum.TextXAlignment.Right,
		TextYAlignment = Enum.TextYAlignment.Center,
		Size = UDim2.new(0.4, 0, 1, 0),
		Position = UDim2.new(0.6, 0, 0, 0),
	}, header)

	local summary = report.summary
	Components.label({
		Text = ("%d blocker · %d high · %d medium · %d low   (%d rules)"):format(
			summary.blocker,
			summary.high,
			summary.medium,
			summary.low,
			report.rulesRun or 0
		),
		TextColor3 = Palette.slate,
		TextSize = 13,
		Position = UDim2.new(0, 0, 0, 66),
		Size = UDim2.new(1, 0, 0, 18),
	}, container)

	local scroller = Instance.new("ScrollingFrame")
	scroller.Size = UDim2.new(1, 0, 1, -90)
	scroller.Position = UDim2.new(0, 0, 0, 90)
	scroller.BackgroundTransparency = 1
	scroller.BorderSizePixel = 0
	scroller.ScrollBarThickness = 6
	scroller.AutomaticCanvasSize = Enum.AutomaticSize.Y
	scroller.CanvasSize = UDim2.new()
	scroller.Parent = container
	Components.list(scroller, 8)

	local sorted = table.clone(report.findings)
	table.sort(sorted, function(a, b)
		return (SEV_RANK[a.severity] or 0) > (SEV_RANK[b.severity] or 0)
	end)

	local shown = 0
	local hidden = 0
	for _, finding in sorted do
		if severityAllowed(finding.severity, deps.limits) and shown < deps.limits.maxFindings then
			local row = findingRow(finding, deps)
			row.LayoutOrder = shown + 1
			row.Parent = scroller
			shown += 1
		else
			hidden += 1
		end
	end

	if shown == 0 then
		Components.label({
			Text = "No issues in the shown tiers. Looking ship-ready!",
			TextColor3 = Palette.green,
			TextSize = 14,
			Size = UDim2.new(1, 0, 0, 40),
		}, scroller)
	end

	if hidden > 0 and not deps.isPro then
		local upsell = Components.frame({
			Size = UDim2.new(1, 0, 0, 0),
			AutomaticSize = Enum.AutomaticSize.Y,
			BackgroundColor3 = Palette.teal,
			LayoutOrder = 1000000,
		}, scroller)
		Components.corner(upsell, 6)
		Components.pad(upsell, 10)
		Components.label({
			Text = ("%d more finding(s) plus exports, suppressions and baseline diffs are in shipcheck Pro."):format(
				hidden
			),
			TextColor3 = Palette.navy,
			Font = Enum.Font.GothamMedium,
			TextSize = 13,
			TextWrapped = true,
			AutomaticSize = Enum.AutomaticSize.Y,
			Size = UDim2.new(1, 0, 0, 0),
		}, upsell)
	end
end

return ReportView

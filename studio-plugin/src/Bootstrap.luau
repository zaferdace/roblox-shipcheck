--!strict
-- Wires the toolbar button, dock widget and the scan -> engine -> report flow.
-- Receives the `plugin` global from the entry script so nothing else depends on it.
local Engine = require(script.Parent.core.Engine)
local Scoring = require(script.Parent.core.Scoring)
local rules = require(script.Parent.core.rules)

local DataModelScanner = require(script.Parent.services.DataModelScanner)
local License = require(script.Parent.services.License)
local Selection = require(script.Parent.services.Selection)

local Widget = require(script.Parent.ui.Widget)
local ReportView = require(script.Parent.ui.ReportView)
local Components = require(script.Parent.ui.Components)
local Palette = require(script.Parent.ui.Palette)
local Version = require(script.Parent.Version)

local Bootstrap = {}

function Bootstrap.start(plugin: Plugin)
	local toolbar = plugin:CreateToolbar("shipcheck")
	local button =
		toolbar:CreateButton("Audit", "Run a ship-readiness audit on this place", "rbxassetid://0")
	button.ClickableWhenViewportHidden = true

	local gui, root = Widget.create(plugin)

	local topBar = Components.frame({
		Size = UDim2.new(1, 0, 0, 44),
		BackgroundColor3 = Palette.navy700,
	}, root)
	Components.pad(topBar, 8)

	local runButton = Components.button("Run audit", {
		Size = UDim2.new(0, 130, 1, -16),
		Position = UDim2.new(0, 0, 0, 8),
	}, nil, topBar)

	Components.label({
		Text = ("shipcheck v%s%s"):format(Version, if License.isPro() then "  Pro" else "  Free"),
		TextColor3 = Palette.slate,
		TextSize = 12,
		TextXAlignment = Enum.TextXAlignment.Right,
		Position = UDim2.new(0, 140, 0, 0),
		Size = UDim2.new(1, -140, 1, 0),
		TextYAlignment = Enum.TextYAlignment.Center,
	}, topBar)

	local content = Components.frame({
		Size = UDim2.new(1, -16, 1, -52),
		Position = UDim2.new(0, 8, 0, 48),
		BackgroundTransparency = 1,
	}, root)

	Components.label({
		Text = "Run an audit to check this place for ship-readiness across performance, security, monetization, mobile, accessibility, policy, analytics and reliability.",
		TextColor3 = Palette.slate,
		TextSize = 14,
		TextWrapped = true,
		Size = UDim2.new(1, 0, 0, 80),
	}, content)

	local engine = Engine.new(rules)

	local function runAudit()
		runButton.Text = "Scanning..."
		local result = DataModelScanner.scan({})
		local findings, rulesRun, rulesErrored = engine:run(result.context)
		local scored = Scoring.build(findings)
		local report = {
			verdict = scored.verdict,
			score = scored.score,
			summary = scored.summary,
			findings = findings,
			rulesRun = rulesRun,
			rulesErrored = rulesErrored,
		}
		ReportView.render(content, report, result.refs, {
			onJump = function(path)
				Selection.jumpTo(result.refs, path)
			end,
			limits = License.limits(),
			isPro = License.isPro(),
		})
		runButton.Text = "Re-run audit"
	end

	runButton.Activated:Connect(runAudit)

	local function setOpen(open: boolean)
		gui.Enabled = open
		button:SetActive(open)
	end

	button.Click:Connect(function()
		setOpen(not gui.Enabled)
	end)
	gui:GetPropertyChangedSignal("Enabled"):Connect(function()
		button:SetActive(gui.Enabled)
	end)
	-- Sync the toolbar button to whatever dock state Studio restored on load.
	button:SetActive(gui.Enabled)
end

return Bootstrap

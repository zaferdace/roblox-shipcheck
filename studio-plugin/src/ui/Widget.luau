--!strict
-- Creates the dock widget shell (stable id so Studio remembers its position).
local Palette = require(script.Parent.Palette)
local Components = require(script.Parent.Components)

local Widget = {}

function Widget.create(plugin: Plugin)
	local info = DockWidgetPluginGuiInfo.new(
		Enum.InitialDockState.Right,
		false, -- enabled on create
		false, -- override saved state
		380, -- default width
		560, -- default height
		300, -- min width
		380 -- min height
	)
	local gui = plugin:CreateDockWidgetPluginGui("Shipcheck_Main_v1", info)
	gui.Name = "ShipcheckWidget"
	gui.Title = "shipcheck"
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

	local root = Components.frame({
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Palette.navy,
	}, gui)

	return gui, root
end

return Widget

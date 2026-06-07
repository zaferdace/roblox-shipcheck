--!strict
-- Small imperative UI builders so the rest of the UI reads declaratively.
local Palette = require(script.Parent.Palette)

local Components = {}

local function apply(instance: Instance, props: { [string]: any }?)
	if props then
		for key, value in props do
			(instance :: any)[key] = value
		end
	end
	return instance
end

function Components.corner(parent: Instance, radius: number?)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius or 6)
	corner.Parent = parent
	return corner
end

function Components.pad(parent: Instance, px: number?)
	local padding = Instance.new("UIPadding")
	local amount = UDim.new(0, px or 8)
	padding.PaddingTop = amount
	padding.PaddingBottom = amount
	padding.PaddingLeft = amount
	padding.PaddingRight = amount
	padding.Parent = parent
	return padding
end

function Components.list(parent: Instance, padding: number?, direction: Enum.FillDirection?)
	local layout = Instance.new("UIListLayout")
	layout.FillDirection = direction or Enum.FillDirection.Vertical
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, padding or 6)
	layout.Parent = parent
	return layout
end

function Components.frame(props: { [string]: any }?, parent: Instance?)
	local frame = Instance.new("Frame")
	frame.BackgroundColor3 = Palette.navy700
	frame.BorderSizePixel = 0
	apply(frame, props)
	if parent then
		frame.Parent = parent
	end
	return frame
end

function Components.label(props: { [string]: any }?, parent: Instance?)
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.Gotham
	label.TextColor3 = Palette.white
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Top
	label.TextSize = 14
	label.RichText = true
	apply(label, props)
	if parent then
		label.Parent = parent
	end
	return label
end

function Components.button(
	text: string,
	props: { [string]: any }?,
	onClick: (() -> ())?,
	parent: Instance?
)
	local button = Instance.new("TextButton")
	button.AutoButtonColor = true
	button.Font = Enum.Font.GothamMedium
	button.TextColor3 = Palette.white
	button.TextSize = 14
	button.BackgroundColor3 = Palette.teal
	button.BorderSizePixel = 0
	button.Text = text
	apply(button, props)
	Components.corner(button, 6)
	if onClick then
		button.Activated:Connect(onClick)
	end
	if parent then
		button.Parent = parent
	end
	return button
end

return Components

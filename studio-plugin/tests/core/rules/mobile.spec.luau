--!nonstrict
local UiOffsetOnly = requireSrc("core/rules/mobile/UiOffsetOnlyLayout")
local TouchTarget = requireSrc("core/rules/mobile/TouchTargetTooSmall")
local NoMobileInput = requireSrc("core/rules/mobile/NoMobileInput")
local Context = requireTest("mocks/Context")

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

local function guiObj(path, props, className)
	return Context.instance(path, className or "Frame", props, "PlayerGui")
end

local function button(path, props)
	local merged = { isButton = true }
	for k, v in props do
		merged[k] = v
	end
	return Context.instance(path, "TextButton", merged, "PlayerGui")
end

-- ---------------------------------------------------------------------------
-- ui-offset-only-layout
-- ---------------------------------------------------------------------------

describe("rule: ui-offset-only-layout", function()
	it("flags pixel-only large elements", function()
		local ctx = Context.new({
			guiObjects = {
				guiObj("PlayerGui.Main.Panel", {
					sizeXScale = 0,
					sizeYScale = 0,
					sizeXOffset = 300,
					sizeYOffset = 250,
				}),
			},
		})
		local findings = UiOffsetOnly.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].evidence.count).toBe(1)
	end)

	it("passes when scale dimensions are non-zero", function()
		local ctx = Context.new({
			guiObjects = {
				guiObj("PlayerGui.Main.Panel", {
					sizeXScale = 0.5,
					sizeYScale = 0.1,
					sizeXOffset = 300,
					sizeYOffset = 250,
				}),
			},
		})
		expect(UiOffsetOnly.run(ctx)).toHaveLength(0)
	end)

	it("passes when pixel offset is small (<=200)", function()
		local ctx = Context.new({
			guiObjects = {
				guiObj("PlayerGui.Icon", {
					sizeXScale = 0,
					sizeYScale = 0,
					sizeXOffset = 32,
					sizeYOffset = 32,
				}),
			},
		})
		expect(UiOffsetOnly.run(ctx)).toHaveLength(0)
	end)

	it("uses medium severity when count <= 10 and high when count > 10", function()
		local small = {}
		for i = 1, 5 do
			table.insert(
				small,
				guiObj("PlayerGui.P" .. i, {
					sizeXScale = 0,
					sizeYScale = 0,
					sizeXOffset = 300,
					sizeYOffset = 0,
				})
			)
		end
		local ctxSmall = Context.new({ guiObjects = small })
		local fSmall = UiOffsetOnly.run(ctxSmall)
		expect(fSmall).toHaveLength(1)
		expect(fSmall[1].severity).toBe("medium")

		local large = {}
		for i = 1, 15 do
			table.insert(
				large,
				guiObj("PlayerGui.Q" .. i, {
					sizeXScale = 0,
					sizeYScale = 0,
					sizeXOffset = 300,
					sizeYOffset = 0,
				})
			)
		end
		local ctxLarge = Context.new({ guiObjects = large })
		local fLarge = UiOffsetOnly.run(ctxLarge)
		expect(fLarge).toHaveLength(1)
		expect(fLarge[1].severity).toBe("high")
	end)

	it("evidence.count reflects true total even when subjects list is capped", function()
		-- Create 30 matching elements (> SUBJECTS_CAP of 25).
		local many = {}
		for i = 1, 30 do
			table.insert(
				many,
				guiObj("PlayerGui.R" .. i, {
					sizeXScale = 0,
					sizeYScale = 0,
					sizeXOffset = 300,
					sizeYOffset = 0,
				})
			)
		end
		local ctx = Context.new({ guiObjects = many })
		local findings = UiOffsetOnly.run(ctx)
		expect(findings).toHaveLength(1)
		-- evidence.count must be the true total (30), not the capped subjects size (25).
		expect(findings[1].evidence.count).toBe(30)
		expect(#findings[1].subjects).toBe(25)
	end)
end)

-- ---------------------------------------------------------------------------
-- touch-target-too-small
-- ---------------------------------------------------------------------------

describe("rule: touch-target-too-small", function()
	it("flags a button that is too short on a 1280px phone", function()
		-- approxHeight = 0 * 1280 + 30 = 30 < 44
		local ctx = Context.new({
			guiObjects = {
				button("PlayerGui.Menu.Btn", {
					sizeYScale = 0,
					sizeYOffset = 30,
				}),
			},
		})
		local findings = TouchTarget.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].evidence.count).toBe(1)
	end)

	it("passes a button that meets the minimum height via scale", function()
		-- approxHeight = 0.05 * 1280 + 0 = 64 >= 44
		local ctx = Context.new({
			guiObjects = {
				button("PlayerGui.Menu.Btn", {
					sizeYScale = 0.05,
					sizeYOffset = 0,
				}),
			},
		})
		expect(TouchTarget.run(ctx)).toHaveLength(0)
	end)

	it("passes non-button GuiObjects regardless of size", function()
		local ctx = Context.new({
			guiObjects = {
				guiObj("PlayerGui.Label", {
					isButton = false,
					sizeYScale = 0,
					sizeYOffset = 10,
				}),
			},
		})
		expect(TouchTarget.run(ctx)).toHaveLength(0)
	end)

	it("passes a mixed button with scale+offset summing to >= 44", function()
		-- approxHeight = 0.02 * 1280 + 20 = 25.6 + 20 = 45.6 >= 44
		local ctx = Context.new({
			guiObjects = {
				button("PlayerGui.Menu.SmallBtn", {
					sizeYScale = 0.02,
					sizeYOffset = 20,
				}),
			},
		})
		expect(TouchTarget.run(ctx)).toHaveLength(0)
	end)

	it("evidence.count reflects true total even when subjects list is capped", function()
		-- Create 30 tiny buttons (> SUBJECTS_CAP of 25).
		local many = {}
		for i = 1, 30 do
			table.insert(
				many,
				button("PlayerGui.Btn" .. i, {
					sizeYScale = 0,
					sizeYOffset = 20,
				})
			)
		end
		local ctx = Context.new({ guiObjects = many })
		local findings = TouchTarget.run(ctx)
		expect(findings).toHaveLength(1)
		-- evidence.count must be the true total (30), not the capped subjects size (25).
		expect(findings[1].evidence.count).toBe(30)
		expect(#findings[1].subjects).toBe(25)
	end)
end)

-- ---------------------------------------------------------------------------
-- no-mobile-input
-- ---------------------------------------------------------------------------

describe("rule: no-mobile-input", function()
	local KEYBOARD_ONLY = [[
		local uis = game:GetService("UserInputService")
		uis.InputBegan:Connect(function(input)
			if input.KeyCode == Enum.KeyCode.E then
				doAction()
			end
		end)
	]]

	local WITH_TOUCH = [[
		local uis = game:GetService("UserInputService")
		uis.InputBegan:Connect(function(input)
			if input.KeyCode == Enum.KeyCode.E then
				doAction()
			end
		end)
		if uis.TouchEnabled then
			-- mobile path exists
		end
	]]

	local WITH_CAS = [[
		local uis = game:GetService("UserInputService")
		local cas = game:GetService("ContextActionService")
		uis.InputBegan:Connect(function(input)
			if input.KeyCode == Enum.KeyCode.E then end
		end)
		cas:BindAction("Use", handler, true, Enum.KeyCode.E)
	]]

	it("flags a keyboard-only input script with no touch path", function()
		local ctx = Context.new({
			scripts = { Context.script("StarterPlayerScripts.Input", KEYBOARD_ONLY) },
		})
		local findings = NoMobileInput.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].path).toBe("StarterPlayerScripts.Input")
	end)

	it("passes when TouchEnabled check is present", function()
		local ctx = Context.new({
			scripts = { Context.script("StarterPlayerScripts.Input", WITH_TOUCH) },
		})
		expect(NoMobileInput.run(ctx)).toHaveLength(0)
	end)

	it("passes when ContextActionService is used alongside keyboard", function()
		local ctx = Context.new({
			scripts = { Context.script("StarterPlayerScripts.Input", WITH_CAS) },
		})
		expect(NoMobileInput.run(ctx)).toHaveLength(0)
	end)

	it("passes a script that uses none of the keyboard signals", function()
		local ctx = Context.new({
			scripts = {
				Context.script("StarterPlayerScripts.Idle", "print('hello world')"),
			},
		})
		expect(NoMobileInput.run(ctx)).toHaveLength(0)
	end)
end)

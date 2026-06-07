--!nonstrict
local LowContrast = requireSrc("core/rules/ux_accessibility/LowContrastText")
local TextTooSmall = requireSrc("core/rules/ux_accessibility/TextTooSmall")
local DefaultBaseplate = requireSrc("core/rules/ux_accessibility/DefaultBaseplateEmpty")
local Context = requireTest("mocks/Context")

-- Helpers to build textObject records.
local function textObj(path, textColorHex, bgColorHex, bgTransparency)
	return Context.instance(path, "TextLabel", {
		textColorHex = textColorHex,
		bgColorHex = bgColorHex,
		bgTransparency = bgTransparency or 0,
	}, "PlayerGui")
end

local function textObjScaled(path, textSize)
	return Context.instance(path, "TextLabel", {
		textScaled = true,
		textSize = textSize,
	}, "PlayerGui")
end

local function textObjFixed(path, textSize)
	return Context.instance(path, "TextLabel", {
		textScaled = false,
		textSize = textSize,
	}, "PlayerGui")
end

-- ─────────────────────────────────────────────────────────────────────────────
describe("rule: low-contrast-text", function()
	it("flags text with contrast ratio below 4.5", function()
		-- White on white-ish gray: very low contrast
		local ctx = Context.new({
			textObjects = {
				textObj("PlayerGui.Screen.Label", "#cccccc", "#ffffff", 0),
			},
		})
		local findings = LowContrast.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].evidence.value).toBeTruthy()
		-- evidence.value is the worst ratio (rounded); must be below the 4.5 threshold
		expect(4.5).toBeGreaterThan(findings[1].evidence.value)
	end)

	it("passes text with sufficient contrast (black on white = 21:1)", function()
		local ctx = Context.new({
			textObjects = {
				textObj("PlayerGui.Screen.Label", "#000000", "#ffffff", 0),
			},
		})
		expect(LowContrast.run(ctx)).toHaveLength(0)
	end)

	it("skips text whose background is nearly transparent (bgTransparency >= 0.5)", function()
		-- Low contrast pair but bg is transparent so background colour is irrelevant.
		local ctx = Context.new({
			textObjects = {
				textObj("PlayerGui.Screen.Label", "#cccccc", "#ffffff", 0.8),
			},
		})
		expect(LowContrast.run(ctx)).toHaveLength(0)
	end)

	it("caps subjects at 20 when many objects fail", function()
		local objs = {}
		for i = 1, 30 do
			table.insert(objs, textObj("PlayerGui.Screen.L" .. i, "#cccccc", "#ffffff", 0))
		end
		local ctx = Context.new({ textObjects = objs })
		local findings = LowContrast.run(ctx)
		expect(findings).toHaveLength(1)
		-- subjects are capped; 20 is <= 30 total offenders
		expect(#findings[1].subjects).toBeGreaterThan(0)
		expect(21).toBeGreaterThan(#findings[1].subjects)
	end)
end)

-- ─────────────────────────────────────────────────────────────────────────────
describe("rule: text-too-small", function()
	it("flags a fixed-size label with TextSize below 12", function()
		local ctx = Context.new({
			textObjects = { textObjFixed("PlayerGui.Screen.Tiny", 8) },
		})
		local findings = TextTooSmall.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].subjects).toBeTruthy()
	end)

	it("passes a fixed-size label at exactly 12", function()
		local ctx = Context.new({
			textObjects = { textObjFixed("PlayerGui.Screen.Fine", 12) },
		})
		expect(TextTooSmall.run(ctx)).toHaveLength(0)
	end)

	it("passes a TextScaled label regardless of TextSize", function()
		local ctx = Context.new({
			textObjects = { textObjScaled("PlayerGui.Screen.Scaled", 6) },
		})
		expect(TextTooSmall.run(ctx)).toHaveLength(0)
	end)

	it("caps subjects at 20 when many objects fail", function()
		local objs = {}
		for i = 1, 25 do
			table.insert(objs, textObjFixed("PlayerGui.Screen.T" .. i, 6))
		end
		local ctx = Context.new({ textObjects = objs })
		local findings = TextTooSmall.run(ctx)
		expect(findings).toHaveLength(1)
		-- subjects are capped; 20 is <= 25 total offenders
		expect(#findings[1].subjects).toBeGreaterThan(0)
		expect(21).toBeGreaterThan(#findings[1].subjects)
	end)
end)

-- ─────────────────────────────────────────────────────────────────────────────
describe("rule: default-baseplate-empty", function()
	it("flags a small place with a Baseplate still present", function()
		local ctx = Context.new({
			parts = { Context.part("Workspace.Baseplate", {}) },
			totalInstances = 10,
		})
		local findings = DefaultBaseplate.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].path).toBe("Workspace.Baseplate")
	end)

	it("passes when totalInstances is above the threshold", function()
		local ctx = Context.new({
			parts = { Context.part("Workspace.Baseplate", {}) },
			totalInstances = 200,
		})
		expect(DefaultBaseplate.run(ctx)).toHaveLength(0)
	end)

	it("passes when no Baseplate exists even with few instances", function()
		local ctx = Context.new({
			parts = { Context.part("Workspace.Floor", {}) },
			totalInstances = 5,
		})
		expect(DefaultBaseplate.run(ctx)).toHaveLength(0)
	end)

	it("passes an empty place with no parts at all", function()
		local ctx = Context.new({ totalInstances = 3 })
		expect(DefaultBaseplate.run(ctx)).toHaveLength(0)
	end)
end)

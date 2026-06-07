--!nonstrict
local UnfilteredUserText = requireSrc("core/rules/policy/UnfilteredUserText")
local OffsiteLinks = requireSrc("core/rules/policy/OffsiteLinks")
local MaturityContentSignals = requireSrc("core/rules/policy/MaturityContentSignals")
local Context = requireTest("mocks/Context")

-- ---------------------------------------------------------------------------
-- rule: unfiltered-user-text
-- ---------------------------------------------------------------------------
describe("rule: unfiltered-user-text", function()
	it("flags a script that reads TextBox.Text and assigns it to a separate label", function()
		local source = [[
			local box = script.Parent.TextBox
			local label = script.Parent.TextLabel
			label.Text = box.Text
		]]
		local ctx = Context.new({
			scripts = { Context.script("StarterGui.Chat.Handler", source) },
		})
		expect(UnfilteredUserText.run(ctx)).toHaveLength(1)
	end)

	it("flags a script that reads TextBox.Text and fires it to server without filtering", function()
		local source = [[
			local box = script.Parent.TextBox
			chatRemote:FireServer(box.Text)
		]]
		local ctx = Context.new({
			scripts = { Context.script("StarterGui.Chat.Sender", source) },
		})
		expect(UnfilteredUserText.run(ctx)).toHaveLength(1)
	end)

	it("passes when FilterStringAsync is present in the same script", function()
		local source = [[
			local box = script.Parent.TextBox
			local label = script.Parent.TextLabel
			local filtered = TextService:FilterStringAsync(box.Text, player.UserId)
			label.Text = filtered:GetNonChatStringForBroadcastAsync()
		]]
		local ctx = Context.new({
			scripts = { Context.script("StarterGui.Chat.Handler", source) },
		})
		expect(UnfilteredUserText.run(ctx)).toHaveLength(0)
	end)

	it("passes when no TextBox reference exists", function()
		local source = [[
			local label = script.Parent.TextLabel
			label.Text = "Hello world"
		]]
		local ctx = Context.new({
			scripts = { Context.script("StarterGui.Static.Label", source) },
		})
		expect(UnfilteredUserText.run(ctx)).toHaveLength(0)
	end)

	it("passes when GetNonChatStringForBroadcastAsync is the only filter (still valid)", function()
		local source = [[
			local result = filterObj:GetNonChatStringForBroadcastAsync()
			local box = script.Parent.TextBox
			label.Text = result
		]]
		local ctx = Context.new({
			scripts = { Context.script("StarterGui.Chat.Filter2", source) },
		})
		expect(UnfilteredUserText.run(ctx)).toHaveLength(0)
	end)

	it("does NOT flag a local-only echo into the same TextBox (no sharing)", function()
		-- The script only reads and writes back to the same TextBox — no remote or SurfaceGui.
		local source = [[
			local box = script.Parent.TextBox
			box.FocusLost:Connect(function()
				box.Text = box.Text:upper()
			end)
		]]
		local ctx = Context.new({
			scripts = { Context.script("StarterGui.Input.Normalizer", source) },
		})
		expect(UnfilteredUserText.run(ctx)).toHaveLength(0)
	end)
end)

-- ---------------------------------------------------------------------------
-- rule: offsite-links
-- ---------------------------------------------------------------------------
describe("rule: offsite-links", function()
	it("flags a discord.gg link in script source", function()
		local source = 'local url = "discord.gg/mygame"'
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Info", source) },
		})
		expect(OffsiteLinks.run(ctx)).toHaveLength(1)
	end)

	it("flags a discord.com/invite link in script source", function()
		local source = 'print("Join us at discord.com/invite/abc123")'
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Info", source) },
		})
		expect(OffsiteLinks.run(ctx)).toHaveLength(1)
	end)

	it("flags an external http URL in a CLIENT script (player-reachable)", function()
		local source = 'local api = "https://myserver.com/api/data"'
		local ctx = Context.new({
			scripts = {
				Context.script(
					"StarterPlayerScripts.Api",
					source,
					{ isServer = false, isClient = true }
				),
			},
		})
		expect(OffsiteLinks.run(ctx)).toHaveLength(1)
	end)

	it("does NOT flag a server-only script with a private backend URL", function()
		local source = 'local api = "https://internal.mybackend.com/api/data"'
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Api", source) },
		})
		expect(OffsiteLinks.run(ctx)).toHaveLength(0)
	end)

	it("passes for roblox.com URLs in script", function()
		local source = 'local link = "https://www.roblox.com/catalog"'
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Store", source) },
		})
		expect(OffsiteLinks.run(ctx)).toHaveLength(0)
	end)

	it("flags free robux solicitation in a text object", function()
		local textRec = Context.instance(
			"StarterGui.Screen.Banner",
			"TextLabel",
			{ text = "Click here for FREE ROBUX!" },
			"StarterGui"
		)
		local ctx = Context.new({ textObjects = { textRec } })
		expect(OffsiteLinks.run(ctx)).toHaveLength(1)
	end)

	it("flags an external URL in a text object", function()
		local textRec = Context.instance(
			"StarterGui.Screen.Info",
			"TextLabel",
			{ text = "Visit https://notarobloxsite.io for more!" },
			"StarterGui"
		)
		local ctx = Context.new({ textObjects = { textRec } })
		expect(OffsiteLinks.run(ctx)).toHaveLength(1)
	end)

	it("passes when no links or solicitations are present", function()
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Idle", "print('hello')") },
		})
		expect(OffsiteLinks.run(ctx)).toHaveLength(0)
	end)
end)

-- ---------------------------------------------------------------------------
-- rule: maturity-content-signals
-- ---------------------------------------------------------------------------
describe("rule: maturity-content-signals", function()
	it("flags a script containing 'gambling'", function()
		local source = "-- gambling system v2\nlocal payout = rollSlots()"
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Slots", source) },
		})
		local findings = MaturityContentSignals.run(ctx)
		expect(findings).toHaveLength(1)
		-- evidence.value should mention gambling
		expect(findings[1].evidence.value:find("gambling")).toBeTruthy()
	end)

	it("flags multiple signals and lists them all in one finding", function()
		local source = "-- blood particles + alcohol shop"
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.FX", source) },
		})
		local findings = MaturityContentSignals.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].evidence.value:find("blood")).toBeTruthy()
		expect(findings[1].evidence.value:find("alcohol")).toBeTruthy()
	end)

	it("passes when no maturity keywords are present", function()
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Safe", "print('clean game')") },
		})
		expect(MaturityContentSignals.run(ctx)).toHaveLength(0)
	end)

	it("flags a signal found in an instance name", function()
		local part = Context.part("Workspace.CasinoTable", { anchored = true, sizeMagnitude = 5 })
		local ctx = Context.new({ parts = { part } })
		local findings = MaturityContentSignals.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].evidence.value:find("casino")).toBeTruthy()
	end)

	it("passes for a script with no maturity keywords in any form", function()
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Hound", "local x = 'greyhound racer'") },
		})
		expect(MaturityContentSignals.run(ctx)).toHaveLength(0)
	end)
end)

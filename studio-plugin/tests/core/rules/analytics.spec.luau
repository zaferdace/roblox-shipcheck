--!nonstrict
local NoAnalytics = requireSrc("core/rules/analytics/NoAnalyticsEvents")
local FromClient = requireSrc("core/rules/analytics/AnalyticsFromClient")
local MissingEconomy = requireSrc("core/rules/analytics/MissingEconomyEvents")
local Context = requireTest("mocks/Context")

-- ── no-analytics-events ──────────────────────────────────────────────────────

describe("rule: no-analytics-events", function()
	it("flags a project with no analytics at all", function()
		local ctx = Context.new({
			scripts = {
				Context.script("ServerScriptService.Main", "print('hello world')"),
			},
		})
		local findings = NoAnalytics.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].evidence.count).toBe(0)
	end)

	it("passes when a server script uses AnalyticsService", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"ServerScriptService.Analytics",
					"local a = game:GetService('AnalyticsService')\na:LogCustomEvent(p, 'test', 1)"
				),
			},
		})
		expect(NoAnalytics.run(ctx)).toHaveLength(0)
	end)

	it("passes when a script calls LogProgressionEvent", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"ServerScriptService.Progress",
					"AnalyticsService:LogProgressionEvent(p, Enum.AnalyticsProgressionType.Complete, 'Level1')"
				),
			},
		})
		expect(NoAnalytics.run(ctx)).toHaveLength(0)
	end)

	it("passes when a script calls LogEconomyEvent", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"ServerScriptService.Economy",
					"analytics:LogEconomyEvent(p, Enum.AnalyticsEconomyFlowType.Source, 'Coins', 100, 500)"
				),
			},
		})
		expect(NoAnalytics.run(ctx)).toHaveLength(0)
	end)
end)

-- ── analytics-from-client ────────────────────────────────────────────────────

describe("rule: analytics-from-client", function()
	it("flags a client script that calls LogCustomEvent", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"StarterPlayerScripts.Track",
					"local a = game:GetService('AnalyticsService')\na:LogCustomEvent(p, 'ButtonPress', 1)",
					{ isServer = false, isClient = true }
				),
			},
		})
		local findings = FromClient.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].path).toBe("StarterPlayerScripts.Track")
	end)

	it("flags a client script that calls LogEconomyEvent", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"StarterPlayerScripts.Economy",
					"analytics:LogEconomyEvent(p, Enum.AnalyticsEconomyFlowType.Source, 'Coins', 50, 550)",
					{ isServer = false, isClient = true }
				),
			},
		})
		expect(FromClient.run(ctx)).toHaveLength(1)
	end)

	it("passes a server script that calls LogCustomEvent", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"ServerScriptService.Track",
					"local a = game:GetService('AnalyticsService')\na:LogCustomEvent(p, 'Kill', 1)"
				),
			},
		})
		expect(FromClient.run(ctx)).toHaveLength(0)
	end)

	it("passes a client script with no analytics calls", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"StarterPlayerScripts.UI",
					"script.Parent.Button.Activated:Connect(function() end)",
					{ isServer = false, isClient = true }
				),
			},
		})
		expect(FromClient.run(ctx)).toHaveLength(0)
	end)
end)

-- ── missing-economy-events ───────────────────────────────────────────────────

describe("rule: missing-economy-events", function()
	it("flags a project that grants currency without LogEconomyEvent", function()
		local grantSource = [[
			local ls = player:WaitForChild("leaderstats")
			ls.Coins.Value = ls.Coins.Value + 100
		]]
		local ctx = Context.new({
			scripts = {
				Context.script("ServerScriptService.Grant", grantSource),
			},
		})
		expect(MissingEconomy.run(ctx)).toHaveLength(1)
	end)

	it("passes when economy events are logged alongside grants", function()
		local grantSource = [[
			ls.Coins.Value = ls.Coins.Value + 100
			AnalyticsService:LogEconomyEvent(player, Enum.AnalyticsEconomyFlowType.Source, "Coins", 100, ls.Coins.Value)
		]]
		local ctx = Context.new({
			scripts = {
				Context.script("ServerScriptService.Shop", grantSource),
			},
		})
		expect(MissingEconomy.run(ctx)).toHaveLength(0)
	end)

	it("passes when no currency is granted at all", function()
		local ctx = Context.new({
			scripts = {
				Context.script("ServerScriptService.Main", "print('no economy here')"),
			},
		})
		expect(MissingEconomy.run(ctx)).toHaveLength(0)
	end)

	it("flags ProcessReceipt grant with no LogEconomyEvent", function()
		local receiptSource = [[
			MarketplaceService.ProcessReceipt = function(receiptInfo)
				local player = Players:GetPlayerByUserId(receiptInfo.PlayerId)
				local ls = player:WaitForChild("leaderstats")
				ls.Cash.Value += 500
				return Enum.ProductPurchaseDecision.PurchaseGranted
			end
		]]
		local ctx = Context.new({
			scripts = {
				Context.script("ServerScriptService.Purchases", receiptSource),
			},
		})
		expect(MissingEconomy.run(ctx)).toHaveLength(1)
	end)

	it(
		"does NOT flag a server script that only mentions Gold as a generic word without a leaderstats write",
		function()
			-- "Gold" appears as a description string, not as a leaderstats child Value assignment.
			local source = [[
			-- Award the player with gold medals for completion
			local description = "You earned a Gold trophy!"
			player:SetAttribute("TrophyType", "Gold")
		]]
			local ctx = Context.new({
				scripts = {
					Context.script("ServerScriptService.Trophies", source),
				},
			})
			expect(MissingEconomy.run(ctx)).toHaveLength(0)
		end
	)
end)

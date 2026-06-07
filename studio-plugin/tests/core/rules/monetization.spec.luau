--!nonstrict
local MissingProcessReceipt = requireSrc("core/rules/monetization/MissingProcessReceipt")
local GrantOnPromptFinished = requireSrc("core/rules/monetization/GrantOnPromptFinished")
local NoMonetizationSurface = requireSrc("core/rules/monetization/NoMonetizationSurface")
local Context = requireTest("mocks/Context")

-- ---------------------------------------------------------------------------
-- missing-processreceipt
-- ---------------------------------------------------------------------------
describe("rule: missing-processreceipt", function()
	it("flags when PromptProductPurchase is used but ProcessReceipt is never assigned", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"ServerScriptService.Shop",
					"MarketplaceService:PromptProductPurchase(player, 12345)"
				),
			},
		})
		local findings = MissingProcessReceipt.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].severity).toBe("blocker")
	end)

	it("passes when ProcessReceipt is assigned in the same script", function()
		local source = "MarketplaceService:PromptProductPurchase(player, 12345)\n"
			.. "MarketplaceService.ProcessReceipt = function(info) return Enum.ProductPurchaseDecision.PurchaseGranted end"
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Shop", source) },
		})
		expect(MissingProcessReceipt.run(ctx)).toHaveLength(0)
	end)

	it("passes when ProcessReceipt is assigned in a different server script", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"ServerScriptService.Shop",
					"MarketplaceService:PromptProductPurchase(player, 99)"
				),
				Context.script(
					"ServerScriptService.Receipts",
					"MarketplaceService.ProcessReceipt = handler"
				),
			},
		})
		expect(MissingProcessReceipt.run(ctx)).toHaveLength(0)
	end)

	it("passes when no developer products are used at all", function()
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Idle", "print('hello')") },
		})
		expect(MissingProcessReceipt.run(ctx)).toHaveLength(0)
	end)
end)

-- ---------------------------------------------------------------------------
-- grant-on-prompt-finished
-- ---------------------------------------------------------------------------
describe("rule: grant-on-prompt-finished", function()
	it("flags a script that connects to PromptProductPurchaseFinished and grants items", function()
		local source =
			"MarketplaceService.PromptProductPurchaseFinished:Connect(function(player, id, purchased) grantItem(player) end)"
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.BadGrant", source) },
		})
		local findings = GrantOnPromptFinished.run(ctx)
		expect(findings).toHaveLength(1)
		-- severity defaults to the rule's "high" via the engine; finding does not need to carry it.
		expect(findings[1].path).toBe("ServerScriptService.BadGrant")
	end)

	it("flags a script that connects to PromptPurchaseFinished and writes a Value", function()
		local source = [[
MarketplaceService.PromptPurchaseFinished:Connect(function(player, id, purchased)
	player.leaderstats.Cash.Value += 100
end)
]]
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.BadGrant2", source) },
		})
		expect(GrantOnPromptFinished.run(ctx)).toHaveLength(1)
	end)

	it("passes when neither signal is connected", function()
		local source =
			"MarketplaceService.ProcessReceipt = function(info) return Enum.ProductPurchaseDecision.PurchaseGranted end"
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Good", source) },
		})
		expect(GrantOnPromptFinished.run(ctx)).toHaveLength(0)
	end)

	it("reports correct path when flagged with a grant keyword", function()
		local source =
			"MarketplaceService.PromptProductPurchaseFinished:Connect(function(p) unlock(p) end)"
		local ctx = Context.new({
			scripts = {
				Context.script("ServerScriptService.Exploit", source),
			},
		})
		local findings = GrantOnPromptFinished.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].path).toBe("ServerScriptService.Exploit")
	end)

	it("does NOT flag a pure analytics/print handler with no grant context", function()
		local source = [[
MarketplaceService.PromptProductPurchaseFinished:Connect(function(player, id, purchased)
	print("Purchase finished", id, purchased)
	AnalyticsService:LogCustomEvent(player, "PurchaseAttempt", 1)
end)
]]
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Analytics", source) },
		})
		expect(GrantOnPromptFinished.run(ctx)).toHaveLength(0)
	end)
end)

-- ---------------------------------------------------------------------------
-- no-monetization-surface
-- ---------------------------------------------------------------------------
describe("rule: no-monetization-surface", function()
	it("flags when no script has any monetization reference", function()
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Idle", "print('hello world')") },
		})
		local findings = NoMonetizationSurface.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].severity).toBe("low")
	end)

	it("passes when PromptGamePassPurchase is present", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"ServerScriptService.Passes",
					"MarketplaceService:PromptGamePassPurchase(player, 111)"
				),
			},
		})
		expect(NoMonetizationSurface.run(ctx)).toHaveLength(0)
	end)

	it("passes when UserOwnsGamePassAsync is referenced", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"ServerScriptService.Check",
					"local owns = MarketplaceService:UserOwnsGamePassAsync(userId, passId)"
				),
			},
		})
		expect(NoMonetizationSurface.run(ctx)).toHaveLength(0)
	end)

	it("passes with an empty scripts list", function()
		-- Edge: no scripts at all -> nothing to scan -> still fires advisory
		local ctx = Context.new({ scripts = {} })
		local findings = NoMonetizationSurface.run(ctx)
		expect(findings).toHaveLength(1)
	end)
end)

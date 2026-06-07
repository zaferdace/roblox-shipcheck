--!nonstrict
local BindToClose = requireSrc("core/rules/reliability/MissingBindToClose")
local Teleport = requireSrc("core/rules/reliability/TeleportNoErrorHandling")
local HttpMismatch = requireSrc("core/rules/reliability/HttpEnabledMismatch")
local Context = requireTest("mocks/Context")

describe("rule: missing-bindtoclose", function()
	it("flags DataStore saving with no BindToClose", function()
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Save", "store:SetAsync(k, v)") },
		})
		expect(BindToClose.run(ctx)).toHaveLength(1)
	end)

	it("passes when a BindToClose handler exists", function()
		local source = "store:SetAsync(k, v)\ngame:BindToClose(function() end)"
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Save", source) },
		})
		expect(BindToClose.run(ctx)).toHaveLength(0)
	end)

	it("passes when no saving happens", function()
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Idle", "print('hi')") },
		})
		expect(BindToClose.run(ctx)).toHaveLength(0)
	end)
end)

describe("rule: teleport-no-error-handling", function()
	it("flags an unguarded teleport", function()
		local ctx = Context.new({
			scripts = {
				Context.script(
					"ServerScriptService.TP",
					"TeleportService:TeleportAsync(id, { plr })"
				),
			},
		})
		expect(Teleport.run(ctx)).toHaveLength(1)
	end)

	it("passes a pcall-guarded teleport", function()
		local source = "pcall(function() TeleportService:TeleportAsync(id, { plr }) end)"
		local ctx = Context.new({ scripts = { Context.script("ServerScriptService.TP", source) } })
		expect(Teleport.run(ctx)).toHaveLength(0)
	end)
end)

describe("rule: httpenabled-mismatch", function()
	local SOURCE = "local h = game:GetService('HttpService')\nh:GetAsync('http://example.com')"

	it("flags HttpService use when HttpEnabled is off", function()
		local ctx =
			Context.new({ scripts = { Context.script("ServerScriptService.Http", SOURCE) } })
		ctx.inventory.services.httpService.httpEnabled = false
		expect(HttpMismatch.run(ctx)).toHaveLength(1)
	end)

	it("passes when HttpEnabled is on", function()
		local ctx =
			Context.new({ scripts = { Context.script("ServerScriptService.Http", SOURCE) } })
		ctx.inventory.services.httpService.httpEnabled = true
		expect(HttpMismatch.run(ctx)).toHaveLength(0)
	end)
end)

--!nonstrict
local RemoteNoServerValidation = requireSrc("core/rules/security/RemoteNoServerValidation")
local InsecureLoadstringRequire = requireSrc("core/rules/security/InsecureLoadstringRequire")
local ClientReadableSecret = requireSrc("core/rules/security/ClientReadableSecret")
local ClientAuthorityLeak = requireSrc("core/rules/security/ClientAuthorityLeak")
local Context = requireTest("mocks/Context")

-- ---------------------------------------------------------------------------
-- remote-no-server-validation
-- ---------------------------------------------------------------------------
describe("rule: remote-no-server-validation", function()
	it("flags a server handler with no validation tokens", function()
		local source = [[
local myRemote = game:GetService("ReplicatedStorage").BuyItem
myRemote.OnServerEvent:Connect(function(player, itemId)
    giveItem(player, itemId)
end)
]]
		local ctx =
			Context.new({ scripts = { Context.script("ServerScriptService.Shop", source) } })
		local findings = RemoteNoServerValidation.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].path).toBe("ServerScriptService.Shop")
		expect(findings[1].severity).toBe("blocker")
	end)

	it("passes when the handler also uses typeof()", function()
		local source = [[
myRemote.OnServerEvent:Connect(function(player, itemId)
    if typeof(itemId) ~= "number" then return end
    giveItem(player, itemId)
end)
]]
		local ctx =
			Context.new({ scripts = { Context.script("ServerScriptService.Shop", source) } })
		expect(RemoteNoServerValidation.run(ctx)).toHaveLength(0)
	end)

	it("passes when the handler uses assert()", function()
		local source = [[
myRemote.OnServerEvent:Connect(function(player, amount)
    assert(type(amount) == "number", "bad amount")
    spend(player, amount)
end)
]]
		local ctx =
			Context.new({ scripts = { Context.script("ServerScriptService.Economy", source) } })
		expect(RemoteNoServerValidation.run(ctx)).toHaveLength(0)
	end)

	it("passes for a server script with no remote handler at all", function()
		local source = "print('server started')"
		local ctx =
			Context.new({ scripts = { Context.script("ServerScriptService.Init", source) } })
		expect(RemoteNoServerValidation.run(ctx)).toHaveLength(0)
	end)

	it("does not flag client scripts", function()
		local source = [[
myRemote.OnServerEvent:Connect(function(player)
    doSomething()
end)
]]
		local ctx = Context.new({
			scripts = {
				Context.script("StarterGui.UI", source, { isServer = false, isClient = true }),
			},
		})
		expect(RemoteNoServerValidation.run(ctx)).toHaveLength(0)
	end)
end)

-- ---------------------------------------------------------------------------
-- insecure-loadstring-require
-- ---------------------------------------------------------------------------
describe("rule: insecure-loadstring-require", function()
	it("flags a script that uses loadstring()", function()
		local source = 'local fn = loadstring(game:GetService("HttpService"):GetAsync(url))()'
		local ctx =
			Context.new({ scripts = { Context.script("ServerScriptService.Loader", source) } })
		local findings = InsecureLoadstringRequire.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].path).toBe("ServerScriptService.Loader")
	end)

	it("flags a script that uses require() with a bare number", function()
		local source = "local mod = require(7621986278)"
		local ctx = Context.new({ scripts = { Context.script("ServerScriptService.Mod", source) } })
		local findings = InsecureLoadstringRequire.run(ctx)
		expect(findings).toHaveLength(1)
	end)

	it("passes a script with only normal module requires", function()
		local source = "local mod = require(game.ServerScriptService.MyModule)"
		local ctx =
			Context.new({ scripts = { Context.script("ServerScriptService.Safe", source) } })
		expect(InsecureLoadstringRequire.run(ctx)).toHaveLength(0)
	end)

	it("does not flag loadstring in a comment", function()
		local source = "-- loadstring( is banned\nprint('hello')"
		local ctx =
			Context.new({ scripts = { Context.script("ServerScriptService.Docs", source) } })
		expect(InsecureLoadstringRequire.run(ctx)).toHaveLength(0)
	end)

	it("does not flag require() with a string argument", function()
		local source = 'local mod = require("SomeModule")'
		local ctx = Context.new({ scripts = { Context.script("ServerScriptService.Ok", source) } })
		expect(InsecureLoadstringRequire.run(ctx)).toHaveLength(0)
	end)
end)

-- ---------------------------------------------------------------------------
-- client-readable-secret
-- ---------------------------------------------------------------------------
describe("rule: client-readable-secret", function()
	it("flags a LocalScript with a Discord webhook URL", function()
		local source =
			'local WEBHOOK = "https://discord.com/api/webhooks/123456/abcdef"\nHttpService:PostAsync(WEBHOOK, data)'
		local ctx = Context.new({
			scripts = {
				Context.script(
					"StarterGui.WebhookSender",
					source,
					{ isServer = false, isClient = true }
				),
			},
		})
		local findings = ClientReadableSecret.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].path).toBe("StarterGui.WebhookSender")
	end)

	it("flags a ReplicatedStorage module with an Authorization header", function()
		local source = 'local headers = { Authorization = "Bearer mytoken123" }'
		local ctx = Context.new({
			scripts = {
				Context.script(
					"ReplicatedStorage.API",
					source,
					{ container = "ReplicatedStorage" }
				),
			},
		})
		local findings = ClientReadableSecret.run(ctx)
		expect(findings).toHaveLength(1)
	end)

	it("passes a server-only script with a webhook URL", function()
		local source = 'local WEBHOOK = "https://discord.com/api/webhooks/123/abc"'
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Notifier", source) },
		})
		expect(ClientReadableSecret.run(ctx)).toHaveLength(0)
	end)

	it("passes a client script with no secrets", function()
		local source = "local x = 5\nprint(x)"
		local ctx = Context.new({
			scripts = {
				Context.script("StarterGui.Clean", source, { isServer = false, isClient = true }),
			},
		})
		expect(ClientReadableSecret.run(ctx)).toHaveLength(0)
	end)

	it("flags a client script with an api_key string", function()
		local source = 'local cfg = { api_key = "supersecret123" }'
		local ctx = Context.new({
			scripts = {
				Context.script("StarterPlayer.Cfg", source, { isServer = false, isClient = true }),
			},
		})
		expect(ClientReadableSecret.run(ctx)).toHaveLength(1)
	end)

	it(
		"does NOT flag a client script that only uses Authorization as a key name (no literal secret)",
		function()
			-- { Authorization = headerVar } — key name without an embedded secret value
			local source = "local headers = { Authorization = headerVar }"
			local ctx = Context.new({
				scripts = {
					Context.script(
						"StarterGui.HttpClient",
						source,
						{ isServer = false, isClient = true }
					),
				},
			})
			expect(ClientReadableSecret.run(ctx)).toHaveLength(0)
		end
	)
end)

-- ---------------------------------------------------------------------------
-- client-authority-leak
-- ---------------------------------------------------------------------------
describe("rule: client-authority-leak", function()
	it("flags a LocalScript that assigns to a leaderstats child", function()
		local source = [[
local stats = player:FindFirstChild("leaderstats")
stats.Points.Value = 9999
]]
		local ctx = Context.new({
			scripts = {
				Context.script("StarterGui.Cheat", source, { isServer = false, isClient = true }),
			},
		})
		local findings = ClientAuthorityLeak.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].path).toBe("StarterGui.Cheat")
	end)

	it("flags a LocalScript that sets Humanoid.Health", function()
		local source = [[
local hum = char:FindFirstChildOfClass("Humanoid")
hum.Health = 100
Humanoid.Health = 100
]]
		local ctx = Context.new({
			scripts = {
				Context.script(
					"StarterGui.HealSelf",
					source,
					{ isServer = false, isClient = true }
				),
			},
		})
		expect(ClientAuthorityLeak.run(ctx)).toHaveLength(1)
	end)

	it("flags a LocalScript that sets Cash.Value", function()
		local source = "player.leaderstats.Cash.Value = 99999"
		local ctx = Context.new({
			scripts = {
				Context.script(
					"StarterGui.CashHack",
					source,
					{ isServer = false, isClient = true }
				),
			},
		})
		expect(ClientAuthorityLeak.run(ctx)).toHaveLength(1)
	end)

	it("passes a server script that legitimately sets leaderstats", function()
		local source = [[
local stats = player:FindFirstChild("leaderstats")
stats.Points.Value = stats.Points.Value + 10
]]
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Points", source) },
		})
		expect(ClientAuthorityLeak.run(ctx)).toHaveLength(0)
	end)

	it("does NOT flag a client HUD that only reads leaderstats (no write)", function()
		local source = [[
local stats = player:FindFirstChild("leaderstats")
local pts = stats.Points.Value
display(pts)
]]
		local ctx = Context.new({
			scripts = {
				Context.script("StarterGui.HUD", source, { isServer = false, isClient = true }),
			},
		})
		-- Only reads leaderstats — no .Value = write or += — must be 0 findings.
		expect(ClientAuthorityLeak.run(ctx)).toHaveLength(0)
	end)
end)

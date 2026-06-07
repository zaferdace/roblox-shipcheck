--!nonstrict
local Rule = requireSrc("core/rules/reliability/DataStoreNoPcall")
local Context = requireTest("mocks/Context")

local UNSAFE = [[
	local DataStoreService = game:GetService("DataStoreService")
	local store = DataStoreService:GetDataStore("Saves")
	local data = store:GetAsync(player.UserId)
	store:SetAsync(player.UserId, data)
]]

local SAFE = [[
	local DataStoreService = game:GetService("DataStoreService")
	local store = DataStoreService:GetDataStore("Saves")
	local ok, data = pcall(function()
		return store:GetAsync(player.UserId)
	end)
]]

-- pcall guards the read but the write is left unprotected
local MIXED = [[
	local ok, data = pcall(function()
		return store:GetAsync(key)
	end)
	store:SetAsync(key, value)
]]

describe("rule: datastore-no-pcall", function()
	it("blocks a server script using DataStore with no pcall", function()
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Data", UNSAFE) },
		})
		local findings = Rule.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].severity).toBe("blocker")
		expect(findings[1].path).toBe("ServerScriptService.Data")
	end)

	it("passes a server script that wraps DataStore in pcall", function()
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Data", SAFE) },
		})
		expect(Rule.run(ctx)).toHaveLength(0)
	end)

	it("flags (high) a script with more DataStore calls than pcalls", function()
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Data", MIXED) },
		})
		local findings = Rule.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].severity).toBe("high")
	end)

	it("ignores client scripts", function()
		local ctx = Context.new({
			scripts = {
				Context.script("StarterPlayerScripts.Local", UNSAFE, {
					className = "LocalScript",
					container = "StarterPlayer",
					isServer = false,
					isClient = true,
				}),
			},
		})
		expect(Rule.run(ctx)).toHaveLength(0)
	end)

	it("does not match DataStore calls that only appear in comments", function()
		local commented = [[
			-- store:SetAsync(key, value)
			print("no datastore here")
		]]
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Noop", commented) },
		})
		expect(Rule.run(ctx)).toHaveLength(0)
	end)
end)

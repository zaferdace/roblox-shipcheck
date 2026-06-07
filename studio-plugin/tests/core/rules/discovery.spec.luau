--!nonstrict
local DebugArtifacts = requireSrc("core/rules/discovery/LeftoverDebugArtifacts")
local MaxPlayers = requireSrc("core/rules/discovery/MaxPlayersMisconfigured")
local LegacyLighting = requireSrc("core/rules/discovery/LegacyLightingTech")
local Context = requireTest("mocks/Context")

-- ────────────────────────────────────────────────────────────────────────────
describe("rule: leftover-debug-artifacts", function()
	it("flags a script with more than 5 print() calls", function()
		local source = table.concat({
			"print('a')",
			"print('b')",
			"print('c')",
			"print('d')",
			"print('e')",
			"print('f')",
		}, "\n")
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Debug", source) },
		})
		local findings = DebugArtifacts.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].evidence.count).toBeGreaterThan(5)
	end)

	it("passes a script with 5 or fewer print() calls", function()
		local source = "print('a')\nprint('b')\nprint('c')\nprint('d')\nprint('e')"
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Ok", source) },
		})
		expect(DebugArtifacts.run(ctx)).toHaveLength(0)
	end)

	it("flags an unguarded noclip handler with no permission check", function()
		local source = [[
			game.Players.PlayerAdded:Connect(function(player)
				player.Chatted:Connect(function(msg)
					if msg == "noclip" then
						player.Character.HumanoidRootPart.CanCollide = false
					end
				end)
			end)
		]]
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.Admin", source) },
		})
		local findings = DebugArtifacts.run(ctx)
		expect(findings).toHaveLength(1)
	end)

	it("passes a cheat handler that has a UserId permission check", function()
		local source = [[
			local ADMIN_ID = 123456
			player.Chatted:Connect(function(msg)
				if player.UserId == ADMIN_ID and msg == "noclip" then
					player.Character.HumanoidRootPart.CanCollide = false
				end
			end)
		]]
		local ctx = Context.new({
			scripts = { Context.script("ServerScriptService.AdminSafe", source) },
		})
		expect(DebugArtifacts.run(ctx)).toHaveLength(0)
	end)

	it("does NOT flag a string constant containing 'godmode' with no handler signal", function()
		-- "godmode" appears only in a description string — no Chatted / OnServerEvent binding.
		local source = [[
			local MODES = {
				{ id = "godmode", label = "God Mode", description = "Become invincible in godmode" },
				{ id = "normal", label = "Normal Mode" },
			}
			return MODES
		]]
		local ctx = Context.new({
			scripts = { Context.script("ReplicatedStorage.Modes", source) },
		})
		expect(DebugArtifacts.run(ctx)).toHaveLength(0)
	end)
end)

-- ────────────────────────────────────────────────────────────────────────────
describe("rule: max-players-misconfigured", function()
	it("flags maxPlayers above 50", function()
		local ctx = Context.new()
		ctx.inventory.services.players.maxPlayers = 100
		local findings = MaxPlayers.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].evidence.value).toBe(100)
	end)

	it("flags maxPlayers == 1", function()
		local ctx = Context.new()
		ctx.inventory.services.players.maxPlayers = 1
		local findings = MaxPlayers.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].evidence.value).toBe(1)
	end)

	it("passes a typical value of 30", function()
		local ctx = Context.new()
		ctx.inventory.services.players.maxPlayers = 30
		expect(MaxPlayers.run(ctx)).toHaveLength(0)
	end)

	it("passes the upper boundary of 50", function()
		local ctx = Context.new()
		ctx.inventory.services.players.maxPlayers = 50
		expect(MaxPlayers.run(ctx)).toHaveLength(0)
	end)
end)

-- ────────────────────────────────────────────────────────────────────────────
describe("rule: legacy-lighting-tech", function()
	it("flags Lighting.Technology == Legacy", function()
		local ctx = Context.new()
		ctx.inventory.services.lighting.technology = "Legacy"
		local findings = LegacyLighting.run(ctx)
		expect(findings).toHaveLength(1)
		expect(findings[1].path).toBe("Lighting")
	end)

	it("passes ShadowMap technology", function()
		local ctx = Context.new()
		ctx.inventory.services.lighting.technology = "ShadowMap"
		expect(LegacyLighting.run(ctx)).toHaveLength(0)
	end)

	it("passes Future technology", function()
		local ctx = Context.new()
		ctx.inventory.services.lighting.technology = "Future"
		expect(LegacyLighting.run(ctx)).toHaveLength(0)
	end)

	it("passes Voxel technology", function()
		local ctx = Context.new()
		ctx.inventory.services.lighting.technology = "Voxel"
		expect(LegacyLighting.run(ctx)).toHaveLength(0)
	end)
end)

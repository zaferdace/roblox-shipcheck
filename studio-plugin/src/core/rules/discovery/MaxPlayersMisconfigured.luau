--!strict
-- Flags Players.MaxPlayers that is either unreasonably high (> 50) or
-- suspiciously set to 1 (likely a dev oversight).
local Rule = {
	id = "max-players-misconfigured",
	title = "MaxPlayers is misconfigured",
	category = "discovery",
	kind = "property",
	severity = "medium",
	description = "MaxPlayers above 50 risks empty-server feel and performance issues; MaxPlayers of 1 is almost always unintentional.",
	docs = "https://create.roblox.com/docs/reference/engine/classes/Players#MaxPlayers",
	defaultEnabled = true,
	tags = { "players", "configuration" },
}

local MAX_PLAYERS_UPPER = 50
local UNINTENTIONAL_SINGLE = 1

function Rule.run(ctx)
	local maxPlayers = ctx.inventory.services.players.maxPlayers

	if maxPlayers > MAX_PLAYERS_UPPER then
		return {
			{
				title = ("MaxPlayers is set to %d (too high)"):format(maxPlayers),
				detail = ("MaxPlayers = %d can lead to empty-server feel due to player spread and may degrade per-player server performance. Most experiences use 6–30."):format(
					maxPlayers
				),
				fix = "Lower MaxPlayers to a value that keeps servers feeling populated (typically 6–30) and matches your target player density.",
				path = "Players",
				evidence = { value = maxPlayers, threshold = MAX_PLAYERS_UPPER },
			},
		}
	end

	if maxPlayers == UNINTENTIONAL_SINGLE then
		return {
			{
				title = "MaxPlayers is set to 1 (likely unintentional)",
				detail = "MaxPlayers = 1 means every player gets a private server, which is almost always a configuration oversight rather than an intended design.",
				fix = "Set MaxPlayers to the intended value for your experience. If solo instances are intentional, consider Reserved Servers instead.",
				path = "Players",
				evidence = { value = maxPlayers },
			},
		}
	end

	return {}
end

return Rule

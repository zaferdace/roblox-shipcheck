--!strict
-- Flags server scripts that teleport players with no failure handling.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "teleport-no-error-handling",
	title = "Teleports without failure handling",
	category = "reliability",
	kind = "source",
	severity = "high",
	description = "Teleport calls without pcall / TeleportInitFailed strand players when teleports fail.",
	docs = "https://create.roblox.com/docs/reference/engine/classes/TeleportService",
	defaultEnabled = true,
	tags = { "teleport" },
}

local TELEPORT_CALLS =
	{ "TeleportAsync", "Teleport", "TeleportToPrivateServer", "TeleportPartyAsync" }

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		if not scriptRec.isServer then
			continue
		end
		local source = Source.strip(scriptRec.source)

		local usesTeleport = false
		local pos: number? = nil
		for _, call in TELEPORT_CALLS do
			if Source.hasMethodCall(source, call) then
				usesTeleport = true
				pos = pos or Source.findMethodCall(source, call)
			end
		end

		if usesTeleport then
			local guarded = Source.hasCall(source, "pcall")
				or Source.has(source, "TeleportInitFailed")
			if not guarded then
				table.insert(findings, {
					title = ("'%s' teleports players with no failure handling"):format(
						scriptRec.name
					),
					detail = "TeleportService calls can fail (full servers, rate limits). Without handling, players are silently stranded.",
					fix = "Wrap teleports in pcall and handle TeleportService.TeleportInitFailed (retry or notify the player).",
					path = scriptRec.path,
					evidence = { line = if pos then Source.lineOf(scriptRec.source, pos) else nil },
				})
			end
		end
	end

	return findings
end

return Rule
